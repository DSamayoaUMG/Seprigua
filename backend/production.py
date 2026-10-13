"""Historial y producción semanal; no convierte duraciones de OT en salarios."""
from datetime import date,timedelta
from flask import request,jsonify
from werkzeug.exceptions import NotFound

def period(planning,args):
    today=planning.local_day();start=date.fromisoformat(args['desde']) if args.get('desde') else today-timedelta(days=today.weekday())
    end=date.fromisoformat(args['hasta']) if args.get('hasta') else start+timedelta(days=6)
    if end<start or (end-start).days>366:raise ValueError('Selecciona un período de hasta 367 días.')
    return start,end

def search_pattern(value):
    value=str(value or '').strip()[:150]
    return value,'%'+value.replace('~','~~').replace('%','~%').replace('_','~_').replace('[','~[')+'%'

BASE="""WITH participaciones AS (
 SELECT t.*,ROW_NUMBER() OVER(PARTITION BY t.EmpleadoId,t.OrdenTrabajoId ORDER BY t.AsignadoEn DESC,t.TecnicoOrdenId DESC) AS posicion FROM srv.TecnicoOrden t
),datos AS (
 SELECT t.EmpleadoId AS empleado_id,o.OrdenTrabajoId AS orden_id,o.NumeroOrden AS numero,CONCAT(p.Nombres,N' ',p.Apellidos) AS nombre,pu.Nombre AS puesto,
 CASE WHEN UPPER(pu.Nombre) LIKE '%SUPERV%' THEN 'SUPERVISOR' ELSE 'OPERARIO' END AS categoria,t.FuncionCuadrilla AS participacion,t.Estado AS estado_participacion,
 eo.Codigo AS estado,c.NombreComercial AS cliente,COALESCE(sc.Nombre,ub.NombreReferencia,N'Sin sede') AS sede,ts.Nombre AS servicio,
 o.ProgramadaPara AS programada,o.IniciadaEn AS iniciada,o.FinalizadaEn AS finalizada,COALESCE(o.FinalizadaEn,o.IniciadaEn,o.ProgramadaPara,o.CreadoEn) AS fecha,
 CASE WHEN ss.Clasificacion='EMERGENCIA' OR o.Prioridad='CRITICA' THEN 1 ELSE 0 END AS emergencia,
 CASE WHEN eo.Codigo='COMPLETADA' AND t.Estado<>'CANCELADO' AND o.FinalizadaEn>=o.IniciadaEn THEN DATEDIFF(MINUTE,o.IniciadaEn,o.FinalizadaEn) ELSE NULL END AS minutos_servicio
 FROM participaciones t JOIN rh.Empleado e ON e.EmpleadoId=t.EmpleadoId JOIN rh.Persona p ON p.PersonaId=e.PersonaId JOIN rh.Puesto pu ON pu.PuestoId=e.PuestoId
 JOIN srv.OrdenTrabajo o ON o.OrdenTrabajoId=t.OrdenTrabajoId JOIN srv.EstadoOrdenTrabajo eo ON eo.EstadoOrdenTrabajoId=o.EstadoOrdenTrabajoId
 JOIN srv.SolicitudServicio ss ON ss.SolicitudServicioId=o.SolicitudServicioId JOIN crm.Cliente c ON c.ClienteId=ss.ClienteId
 LEFT JOIN crm.UbicacionServicio ub ON ub.UbicacionServicioId=ss.UbicacionServicioId LEFT JOIN crm.SucursalCliente sc ON sc.SucursalClienteId=ub.SucursalClienteId
 JOIN srv.TipoServicio ts ON ts.TipoServicioId=ss.TipoServicioId WHERE t.posicion=1
),filtrados AS (SELECT * FROM datos WHERE fecha>=? AND fecha<? AND (?='' OR categoria=?) AND (?='' OR estado=?)
 AND (?='' OR cliente LIKE ? ESCAPE '~') AND (?='' OR servicio LIKE ? ESCAPE '~') AND (?='' OR nombre LIKE ? ESCAPE '~') AND (?=0 OR empleado_id=?)) """

def register_production(b):
    def load(session,employee_id=0):
        start,end=(date(1900,1,1),b.planning.local_day()) if employee_id and not request.args.get('desde') and not request.args.get('hasta') else period(b.planning,request.args);first,last=b.planning.date_bounds(start,end)
        category=str(request.args.get('categoria') or '').upper();status=str(request.args.get('estado') or '').upper()
        if category not in {'','SUPERVISOR','OPERARIO'}:raise ValueError('Categoría inválida.')
        if status not in {'','PENDIENTE','PROGRAMADA','EN_PROCESO','POR_CONFIRMAR','COMPLETADA','CANCELADA'}:raise ValueError('Estado inválido.')
        args=(first,last,category,category,status,status,*search_pattern(request.args.get('cliente')),*search_pattern(request.args.get('servicio')),*search_pattern(request.args.get('q')),employee_id,employee_id)
        page,size=b.pagination_args(20,100)
        with b.get_db_connection() as conn:
            cur=conn.cursor();employee=None
            if employee_id:
                employee=b.exec_proc_row(cur,"SELECT e.EmpleadoId AS id,CONCAT(p.Nombres,N' ',p.Apellidos) AS nombre,pu.Nombre AS puesto FROM rh.Empleado e JOIN rh.Persona p ON p.PersonaId=e.PersonaId JOIN rh.Puesto pu ON pu.PuestoId=e.PuestoId WHERE e.EmpleadoId=?",(employee_id,))
                if not employee:raise NotFound('Empleado no encontrado.')
            totals=b.exec_proc_row(cur,BASE+"""SELECT COUNT(DISTINCT orden_id) AS ordenes_unicas,COUNT_BIG(*) AS participaciones,
              COUNT(DISTINCT CASE WHEN estado='COMPLETADA' AND estado_participacion<>'CANCELADO' THEN orden_id END) AS completadas,
              COUNT(DISTINCT CASE WHEN estado='CANCELADA' THEN orden_id END) AS canceladas,
              COUNT(DISTINCT CASE WHEN emergencia=1 THEN orden_id END) AS emergencias FROM filtrados""",args)
            if employee_id:
                total=int(totals['participaciones'] or 0);pages=max(1,(total+size-1)//size);page=min(page,pages)
                items=b.exec_proc_rows(cur,BASE+'SELECT * FROM filtrados ORDER BY fecha DESC,orden_id DESC OFFSET ? ROWS FETCH NEXT ? ROWS ONLY',(*args,(page-1)*size,size))
            else:
                total=int(b.exec_proc_row(cur,BASE+'SELECT COUNT(DISTINCT empleado_id) AS total FROM filtrados',args)['total']);pages=max(1,(total+size-1)//size);page=min(page,pages)
                items=b.exec_proc_rows(cur,BASE+"""SELECT empleado_id AS id,nombre,puesto,categoria,COUNT_BIG(*) AS asignadas,
                  SUM(CASE WHEN estado='COMPLETADA' AND estado_participacion<>'CANCELADO' THEN 1 ELSE 0 END) AS completadas,
                  SUM(CASE WHEN estado NOT IN ('COMPLETADA','CANCELADA') AND estado_participacion<>'CANCELADO' THEN 1 ELSE 0 END) AS pendientes,
                  SUM(CASE WHEN estado='CANCELADA' OR estado_participacion='CANCELADO' THEN 1 ELSE 0 END) AS canceladas,
                  SUM(emergencia) AS emergencias,SUM(minutos_servicio) AS minutos_servicio,COUNT(minutos_servicio) AS servicios_con_duracion
                  FROM filtrados GROUP BY empleado_id,nombre,puesto,categoria ORDER BY nombre,empleado_id OFFSET ? ROWS FETCH NEXT ? ROWS ONLY""",(*args,(page-1)*size,size))
        return jsonify(ok=True,items=items,total=total,pagina=page,tamano=size,paginas=pages,resumen=totals,empleado=employee,desde=start,hasta=end,
          nota_horas='Duración de la OT con inicio y fin registrados; no representa horas pagables individuales.',categoria_historica=False,
          criterio_fecha='Finalización; si no existe, inicio, programación o creación.')
    @b.app.get('/api/produccion')
    @b.require_session('COORDINADOR')
    def production_list(session):return load(session)
    @b.app.get('/api/produccion/<int:employee_id>')
    @b.require_session('COORDINADOR')
    def production_employee(session,employee_id):return load(session,employee_id)
