"""Agenda operativa de SEPRIGUA.

Vista/calendario operativo sobre las tablas existentes. No crea estructura nueva:
- personal técnico desde rh.Empleado/rh.Puesto/rh.Persona
- asignaciones desde srv.TecnicoOrden
- programación desde srv.OrdenTrabajo.ProgramadaPara

Los cambios de horario se aplican únicamente al pulsar Guardar planificación.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo
from flask import request, jsonify
from werkzeug.exceptions import Conflict, NotFound
import os


def register_agenda_operativa(b):
    app = b.app
    auth = b.require_session
    local_zone = ZoneInfo(os.getenv("APP_TIMEZONE", "America/Guatemala"))

    def _selected_date() -> date:
        raw = str(request.args.get("fecha") or "").strip()
        if not raw:
            return datetime.now(local_zone).date()
        try:
            return date.fromisoformat(raw)
        except ValueError as exc:
            raise ValueError("La fecha de la agenda no es válida.") from exc

    def _utc_range(day: date):
        start_local = datetime.combine(day, time.min, tzinfo=local_zone)
        end_local = start_local + timedelta(days=1)
        start_utc = start_local.astimezone(timezone.utc).replace(tzinfo=None)
        end_utc = end_local.astimezone(timezone.utc).replace(tzinfo=None)
        return start_utc, end_utc

    def _to_local(dt):
        if not dt:
            return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(local_zone)

    def _iso_local(dt):
        value = _to_local(dt)
        return value.isoformat(timespec="minutes") if value else None

    def _minute_of_day(dt):
        value = _to_local(dt)
        return value.hour * 60 + value.minute if value else None

    def _initials(name: str) -> str:
        parts = [p for p in str(name or "").split() if p]
        if not parts:
            return "--"
        return "".join(p[0].upper() for p in parts[:2])

    def _priority_rank(value):
        return {"CRITICA": 0, "ALTA": 1, "MEDIA": 2, "BAJA": 3}.get(str(value or "").upper(), 9)

    def _serialize_order(row):
        return {
            "id": int(row["id"]),
            "numero": row.get("numero"),
            "cliente": row.get("cliente"),
            "sede": row.get("sede"),
            "direccion": row.get("direccion"),
            "municipio": row.get("municipio"),
            "departamento": row.get("departamento"),
            "servicio": row.get("servicio"),
            "estado": row.get("estado"),
            "estado_codigo": row.get("estado_codigo"),
            "prioridad": row.get("prioridad"),
            "clasificacion": row.get("clasificacion"),
            "programada": _iso_local(row.get("programada")),
            "programada_version": row["programada"].isoformat()+"Z" if row.get("programada") else None,
            "minuto": _minute_of_day(row.get("programada")),
            "iniciada": _iso_local(row.get("iniciada")),
            "funcion": row.get("funcion"),
            "asignacion_estado": row.get("asignacion_estado"),
            "integrantes": int(row.get("integrantes") or 1),
            "encargado": row.get("encargado"),
            "tiene_cotizacion": bool(row.get("tiene_cotizacion")),
        }

    @app.get("/api/agenda-operativa")
    @auth("COORDINADOR", "TECNICO")
    def agenda_operativa(session):
        day = _selected_date()
        start_utc, end_utc = _utc_range(day)
        today = datetime.now(local_zone).date()
        include_live = day == today

        employee_filter = ""
        employee_params = []
        if session["rol"] == "TECNICO":
            if not session.get("empleado_id"):
                raise NotFound("Tu cuenta no está vinculada a un empleado.")
            employee_filter = " AND e.EmpleadoId=?"
            employee_params.append(int(session["empleado_id"]))

        with b.get_db_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                f"""
                SELECT e.EmpleadoId AS id,
                       LTRIM(RTRIM(CONCAT(p.Nombres,N' ',p.Apellidos))) AS nombre,
                       pu.Nombre AS puesto,
                       e.Disponibilidad AS disponibilidad,
                       e.EstadoLaboral AS estado_laboral
                FROM rh.Empleado e
                INNER JOIN rh.Persona p ON p.PersonaId=e.PersonaId
                INNER JOIN rh.Puesto pu ON pu.PuestoId=e.PuestoId
                WHERE e.EstadoLaboral='ACTIVO' AND p.Activo=1 AND pu.Activo=1 AND pu.EsTecnico=1
                {employee_filter}
                ORDER BY CASE WHEN UPPER(pu.Nombre) LIKE '%SUPERV%' THEN 0 ELSE 1 END,p.Nombres,p.Apellidos
                """,
                *employee_params,
            )
            employees = b.rows_to_dicts(cur, cur.fetchall())
            b.planning.apply_vacations(b,cur,employees,day)
            employee_ids = [int(x["id"]) for x in employees]

            assignments = []
            if employee_ids:
                marks = ",".join("?" for _ in employee_ids)
                live_sql = " OR eo.Codigo='EN_PROCESO' OR o.ProgramadaPara IS NULL" if include_live else ""
                cur.execute(
                    f"""
                    SELECT t.EmpleadoId AS empleado_id,
                           o.OrdenTrabajoId AS id,o.NumeroOrden AS numero,
                           c.NombreComercial AS cliente,
                           COALESCE(sc.Nombre,ub.NombreReferencia,N'Sin sede') AS sede,
                           ub.Direccion AS direccion,ub.Municipio AS municipio,ub.Departamento AS departamento,
                           ts.Nombre AS servicio,
                           eo.Codigo AS estado_codigo,eo.Nombre AS estado,
                           o.Prioridad AS prioridad,s.Clasificacion AS clasificacion,
                           o.ProgramadaPara AS programada,o.IniciadaEn AS iniciada,
                           t.FuncionCuadrilla AS funcion,t.Estado AS asignacion_estado,
                           (SELECT COUNT_BIG(*) FROM srv.TecnicoOrden tc
                            WHERE tc.OrdenTrabajoId=o.OrdenTrabajoId AND tc.Estado IN ('ASIGNADO','CONFIRMADO')) AS integrantes,
                           (SELECT TOP(1) LTRIM(RTRIM(CONCAT(pp.Nombres,N' ',pp.Apellidos)))
                            FROM srv.TecnicoOrden te
                            INNER JOIN rh.Empleado ee ON ee.EmpleadoId=te.EmpleadoId
                            INNER JOIN rh.Persona pp ON pp.PersonaId=ee.PersonaId
                            WHERE te.OrdenTrabajoId=o.OrdenTrabajoId AND te.Estado IN ('ASIGNADO','CONFIRMADO')
                            ORDER BY CASE WHEN te.FuncionCuadrilla='ENCARGADO' THEN 0 ELSE 1 END,te.AsignadoEn) AS encargado,
                           CASE WHEN EXISTS(SELECT 1 FROM cot.Cotizacion cq WHERE cq.OrdenTrabajoId=o.OrdenTrabajoId) THEN 1 ELSE 0 END AS tiene_cotizacion
                    FROM srv.TecnicoOrden t
                    INNER JOIN srv.OrdenTrabajo o ON o.OrdenTrabajoId=t.OrdenTrabajoId
                    INNER JOIN srv.EstadoOrdenTrabajo eo ON eo.EstadoOrdenTrabajoId=o.EstadoOrdenTrabajoId
                    INNER JOIN srv.SolicitudServicio s ON s.SolicitudServicioId=o.SolicitudServicioId
                    INNER JOIN crm.Cliente c ON c.ClienteId=s.ClienteId
                    LEFT JOIN crm.UbicacionServicio ub ON ub.UbicacionServicioId=s.UbicacionServicioId
                    LEFT JOIN crm.SucursalCliente sc ON sc.SucursalClienteId=ub.SucursalClienteId
                    INNER JOIN srv.TipoServicio ts ON ts.TipoServicioId=s.TipoServicioId
                    WHERE t.EmpleadoId IN ({marks})
                      AND t.Estado IN ('ASIGNADO','CONFIRMADO')
                      AND eo.EsFinal=0
                      AND ((o.ProgramadaPara>=? AND o.ProgramadaPara<?){live_sql})
                    ORDER BY t.EmpleadoId,
                             CASE WHEN eo.Codigo='EN_PROCESO' THEN 0 ELSE 1 END,
                             CASE o.Prioridad WHEN 'CRITICA' THEN 0 WHEN 'ALTA' THEN 1 WHEN 'MEDIA' THEN 2 ELSE 3 END,
                             o.ProgramadaPara,o.OrdenTrabajoId
                    """,
                    *employee_ids,
                    start_utc,
                    end_utc,
                )
                assignments = b.rows_to_dicts(cur, cur.fetchall())

        by_employee = {eid: [] for eid in employee_ids}
        unique_orders = {}
        for row in assignments:
            item = _serialize_order(row)
            by_employee.setdefault(int(row["empleado_id"]), []).append(item)
            unique_orders[item["id"]] = item

        technicians = []
        for employee in employees:
            eid = int(employee["id"])
            orders = by_employee.get(eid, [])
            orders.sort(key=lambda x: (
                0 if str(x.get("estado_codigo") or "").upper() == "EN_PROCESO" else 1,
                0 if x.get("clasificacion")=="EMERGENCIA" else 1,
                x.get("minuto") if x.get("minuto") is not None else 9999,
                _priority_rank(x.get("prioridad")),
                x["id"],
            ))
            active = [o for o in orders if str(o.get("estado_codigo") or "").upper() == "EN_PROCESO"]
            queued = [o for o in orders if o not in active]
            for index, order in enumerate(queued, 1):
                order["cola_posicion"] = index
                order["estado_visual"] = "SIGUIENTE" if index == 1 else "EN_COLA"
            for order in active:
                order["cola_posicion"] = 0
                order["estado_visual"] = "EN_SERVICIO"

            availability = str(employee.get("disponibilidad") or "DISPONIBLE").upper()
            if availability in {"VACACIONES", "INACTIVO","NO_DISPONIBLE"}:
                operational = availability
            elif active:
                operational = "EN_SERVICIO"
            elif queued:
                operational = "EN_COLA"
            else:
                operational = "DISPONIBLE"

            technicians.append({
                "id": eid,
                "nombre": employee.get("nombre"),
                "iniciales": _initials(employee.get("nombre")),
                "puesto": employee.get("puesto"),
                "disponibilidad": availability,
                "estado_operativo": operational,
                "cola_cantidad": len(queued),
                "en_equipo": any(int(o.get("integrantes") or 1) > 1 for o in orders),
                "ordenes": orders,
            })

        unique = list(unique_orders.values())
        summary = {
            "tecnicos": len(technicians),
            "ordenes": len(unique),
            "en_servicio": sum(1 for o in unique if str(o.get("estado_codigo") or "").upper() == "EN_PROCESO"),
            "emergencias": sum(1 for o in unique if str(o.get("clasificacion") or "").upper() == "EMERGENCIA" or str(o.get("prioridad") or "").upper() == "CRITICA"),
            "sin_hora": sum(1 for o in unique if o.get("minuto") is None),
        }
        now_local = datetime.now(local_zone)
        return jsonify(
            ok=True,
            fecha=day.isoformat(),
            hoy=today.isoformat(),
            ahora=now_local.isoformat(timespec="minutes"),
            editable=session["rol"] == "COORDINADOR",
            resumen=summary,
            tecnicos=technicians,
        )

    @app.post('/api/agenda-operativa/guardar')
    @auth('COORDINADOR')
    def guardar_agenda_operativa(session):
        payload=request.get_json(silent=True) or {};changes=payload.get('cambios')
        if not isinstance(changes,list) or not 1<=len(changes)<=120:raise ValueError('Selecciona entre 1 y 120 cambios.')
        normalized=[];seen=set();affected=set()
        for change in changes:
            if not isinstance(change,dict):raise ValueError('Cambio inválido.')
            oid=int(change.get('orden_id') or 0)
            if oid<=0 or oid in seen:raise ValueError('La planificación contiene una orden inválida o repetida.')
            seen.add(oid);scheduled=b.parse_datetime_local(change.get('programada_para'),'Fecha de la agenda')
            if not scheduled:raise ValueError('Cada orden debe conservar una fecha y hora.')
            normalized.append((oid,scheduled,change))
        with b.get_db_connection() as conn:
            cur=conn.cursor();b.planning.lock_planning(b,cur);b.set_audit_context(cur,session,'Planificación de agenda')
            for oid,scheduled,change in normalized:
                current=b.exec_proc_row(cur,'SELECT o.ProgramadaPara AS programada,eo.Codigo AS estado FROM srv.OrdenTrabajo o JOIN srv.EstadoOrdenTrabajo eo ON eo.EstadoOrdenTrabajoId=o.EstadoOrdenTrabajoId WHERE o.OrdenTrabajoId=?',(oid,))
                if not current:raise NotFound('Orden no encontrada.')
                if current['estado'] not in {'PENDIENTE','PROGRAMADA'}:raise Conflict('Una orden ya se inició o está cerrada. Actualiza la agenda.')
                if 'programada_original' in change:
                    original=b.parse_datetime_local(change['programada_original'],'Fecha original') if change['programada_original'] else None
                    if original!=current['programada']:raise Conflict('Otra persona modificó la agenda. Actualiza antes de guardar.')
                crew=b.exec_proc_rows(cur,"SELECT EmpleadoId AS id,FuncionCuadrilla AS funcion FROM srv.TecnicoOrden WHERE OrdenTrabajoId=? AND Estado IN ('ASIGNADO','CONFIRMADO')",(oid,))
                affected.update(int(t['id']) for t in crew)
                source=int(change.get('empleado_origen') or 0);target=int(change.get('empleado_destino') or 0)
                if source!=target:
                    old=next((t for t in crew if int(t['id'])==source),None)
                    if not old or target<=0:raise Conflict('La asignación original cambió. Actualiza la agenda.')
                    if any(int(t['id'])==target for t in crew):raise Conflict('La persona de destino ya forma parte de la cuadrilla.')
                    cur.execute("UPDATE srv.TecnicoOrden SET Estado='CANCELADO',DesasignadoEn=SYSUTCDATETIME() WHERE OrdenTrabajoId=? AND EmpleadoId=? AND Estado IN ('ASIGNADO','CONFIRMADO')",oid,source)
                    b.exec_proc_row(cur,'EXEC srv.usp_AppAsignarTecnico ?,?,?,?',(oid,target,session['usuario_id'],old['funcion']))
                    affected.add(target)
                    cur.execute("""UPDATE rh.Empleado SET Disponibilidad='DISPONIBLE',ActualizadoEn=SYSUTCDATETIME() WHERE EmpleadoId=? AND Disponibilidad='ASIGNADO' AND EstadoLaboral='ACTIVO'
                      AND NOT EXISTS(SELECT 1 FROM srv.TecnicoOrden t JOIN srv.OrdenTrabajo o ON o.OrdenTrabajoId=t.OrdenTrabajoId JOIN srv.EstadoOrdenTrabajo eo ON eo.EstadoOrdenTrabajoId=o.EstadoOrdenTrabajoId WHERE t.EmpleadoId=? AND t.Estado IN ('ASIGNADO','CONFIRMADO') AND eo.EsFinal=0)""",source,source)
                cur.execute('UPDATE srv.OrdenTrabajo SET ProgramadaPara=?,ActualizadoEn=SYSUTCDATETIME() WHERE OrdenTrabajoId=?',scheduled,oid)
                if current['estado']=='PENDIENTE':
                    state=b.exec_proc_row(cur,"SELECT EstadoOrdenTrabajoId AS id FROM srv.EstadoOrdenTrabajo WHERE Codigo='PROGRAMADA' AND Activo=1")
                    if not state:raise Conflict('Falta PROGRAMADA activa en el catálogo de estados.')
                    b.exec_proc_row(cur,'EXEC srv.usp_AppCambiarEstadoOrden ?,?,?,?',(oid,state['id'],session['usuario_id'],'Programada desde agenda'))
            # Valida el resultado completo: permite intercambiar horarios en una sola operación.
            for oid,scheduled,_ in normalized:b.planning.validate_order(b,cur,oid,scheduled=scheduled)
            from .notifications import employee_users,notify_users
            recipients=[]
            for employee in affected:recipients+=employee_users(b,cur,employee)
            notify_users(b,cur,recipients,'AGENDA_ACTUALIZADA','Agenda actualizada','Coordinación actualizó horarios o integrantes de tu ruta.','AgendaOperativa',payload.get('fecha') or '')
        b.queue_web_push(recipients,title='Agenda actualizada',body='Revisa los horarios y asignaciones de tu ruta.',role='TECNICO',entity='AgendaOperativa')
        return jsonify(ok=True,message=f'Planificación guardada. {len(normalized)} orden(es) actualizada(s).',actualizadas=len(normalized))

    return {'agenda_operativa':agenda_operativa,'guardar_agenda_operativa':guardar_agenda_operativa}
