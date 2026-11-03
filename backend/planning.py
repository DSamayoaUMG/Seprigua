"""Planificación sobre el esquema congelado. No inventa duraciones previstas."""
from datetime import datetime,time,timedelta,timezone
from zoneinfo import ZoneInfo
import os
from werkzeug.exceptions import Conflict,NotFound
_UNSET=object()

def local_day(value=None):
    value=value or datetime.now(timezone.utc)
    if value.tzinfo is None:value=value.replace(tzinfo=timezone.utc)
    return value.astimezone(ZoneInfo(os.getenv('APP_TIMEZONE','America/Guatemala'))).date()

def date_bounds(start,end):
    zone=ZoneInfo(os.getenv('APP_TIMEZONE','America/Guatemala'))
    return tuple(datetime.combine(d,time.min,tzinfo=zone).astimezone(timezone.utc).replace(tzinfo=None) for d in (start,end+timedelta(days=1)))

def lock_planning(b,cur):
    result=b.exec_proc_row(cur,"""IF @@TRANCOUNT=0 BEGIN TRANSACTION;
      DECLARE @result int;
      EXEC @result=sys.sp_getapplock @Resource=N'SEPRIGUA:planificacion',@LockMode=N'Exclusive',@LockOwner=N'Transaction',@LockTimeout=8000;
      SELECT @result AS resultado;""")
    if not result or int(result['resultado'])<0:raise Conflict('Otra persona está actualizando la planificación. Intenta nuevamente.')

def crew_ids(b,cur,order_id):
    return [int(r['id']) for r in b.exec_proc_rows(cur,"SELECT DISTINCT EmpleadoId AS id FROM srv.TecnicoOrden WHERE OrdenTrabajoId=? AND Estado IN ('ASIGNADO','CONFIRMADO')",(order_id,))]

def validate_order(b,cur,order_id,scheduled=_UNSET,employee_ids=None,starting=False):
    order=b.exec_proc_row(cur,"""SELECT o.ProgramadaPara AS programada,eo.Codigo AS estado FROM srv.OrdenTrabajo o
      JOIN srv.EstadoOrdenTrabajo eo ON eo.EstadoOrdenTrabajoId=o.EstadoOrdenTrabajoId WHERE o.OrdenTrabajoId=?""",(order_id,))
    if not order:raise NotFound('Orden no encontrada.')
    if scheduled is _UNSET:scheduled=order['programada']
    ids=sorted(set(employee_ids if employee_ids is not None else crew_ids(b,cur,order_id)))
    if starting and not ids:raise Conflict('Asigna la cuadrilla antes de iniciar la orden.')
    day=local_day() if starting else local_day(scheduled)
    for employee_id in ids:
        employee=b.exec_proc_row(cur,"""SELECT e.EstadoLaboral AS estado,e.Disponibilidad AS disponibilidad,p.Activo AS persona_activa,
          pu.EsTecnico AS tecnico,pu.Activo AS puesto_activo,CONCAT(p.Nombres,N' ',p.Apellidos) AS nombre
          FROM rh.Empleado e JOIN rh.Persona p ON p.PersonaId=e.PersonaId JOIN rh.Puesto pu ON pu.PuestoId=e.PuestoId WHERE e.EmpleadoId=?""",(employee_id,))
        if not employee or employee['estado']!='ACTIVO' or not employee['persona_activa'] or not employee['tecnico'] or not employee['puesto_activo']:
            raise Conflict('Todos los integrantes deben ser empleados operativos activos.')
        if employee['disponibilidad'] not in {'DISPONIBLE','ASIGNADO'}:raise Conflict(f"{employee['nombre']} figura como no disponible.")
        if b.exec_proc_row(cur,"SELECT TOP 1 SolicitudVacacionId AS id FROM rh.SolicitudVacacion WHERE EmpleadoId=? AND Estado='APROBADA' AND FechaInicio<=? AND FechaFin>=?",(employee_id,day,day)):
            raise Conflict(f"{employee['nombre']} tiene vacaciones aprobadas para esa fecha.")
        if starting:condition="eo.Codigo='EN_PROCESO'";params=(employee_id,order_id)
        elif scheduled:condition='eo.EsFinal=0 AND o.ProgramadaPara=?';params=(employee_id,order_id,scheduled)
        else:continue
        other=b.exec_proc_row(cur,"""SELECT TOP 1 o.NumeroOrden AS numero FROM srv.TecnicoOrden t
          JOIN srv.OrdenTrabajo o ON o.OrdenTrabajoId=t.OrdenTrabajoId JOIN srv.EstadoOrdenTrabajo eo ON eo.EstadoOrdenTrabajoId=o.EstadoOrdenTrabajoId
          WHERE t.EmpleadoId=? AND o.OrdenTrabajoId<>? AND t.Estado IN ('ASIGNADO','CONFIRMADO') AND """+condition,params)
        if other:raise Conflict(f"{employee['nombre']} tiene conflicto con {other['numero']}. Reprograma o ajusta la cuadrilla.")

def validate_vacation(b,cur,employee_id,start,end,exclude_id=0,approving=False):
    if b.exec_proc_row(cur,"""SELECT TOP 1 SolicitudVacacionId AS id FROM rh.SolicitudVacacion WHERE EmpleadoId=?
      AND SolicitudVacacionId<>? AND Estado IN ('PENDIENTE','APROBADA','REPROGRAMAR') AND FechaInicio<=? AND FechaFin>=?""",(employee_id,exclude_id,end,start)):
        raise Conflict('Las fechas coinciden con otra solicitud pendiente o aprobada.')
    if approving:
        first,last=date_bounds(start,end)
        busy=b.exec_proc_row(cur,"""SELECT TOP 1 o.NumeroOrden AS numero FROM srv.TecnicoOrden t JOIN srv.OrdenTrabajo o ON o.OrdenTrabajoId=t.OrdenTrabajoId
          JOIN srv.EstadoOrdenTrabajo eo ON eo.EstadoOrdenTrabajoId=o.EstadoOrdenTrabajoId WHERE t.EmpleadoId=? AND t.Estado IN ('ASIGNADO','CONFIRMADO')
          AND eo.EsFinal=0 AND ((o.ProgramadaPara>=? AND o.ProgramadaPara<?) OR (eo.Codigo='EN_PROCESO' AND ?<=? AND ?>=?))""",
          (employee_id,first,last,start,local_day(),end,local_day()))
        if busy:raise Conflict(f"Reasigna o reprograma {busy['numero']} antes de aprobar estas vacaciones.")

def apply_vacations(b,cur,people,day=None):
    day=day or local_day();ids=[int(p['id']) for p in people]
    approved=set()
    for start in range(0,len(ids),500):
        batch=ids[start:start+500]
        approved.update(int(r['id']) for r in b.exec_proc_rows(cur,"SELECT DISTINCT EmpleadoId AS id FROM rh.SolicitudVacacion WHERE Estado='APROBADA' AND FechaInicio<=? AND FechaFin>=? AND EmpleadoId IN ("+','.join('?' for _ in batch)+')',(day,day,*batch)))
    for p in people:
        if int(p['id']) in approved:p['disponibilidad']='VACACIONES'
    return people
