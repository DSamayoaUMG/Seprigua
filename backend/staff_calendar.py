"""Horario semanal de campo y vacaciones por empleado."""
from datetime import date, time, timedelta
import json

from flask import jsonify, request
from werkzeug.exceptions import Conflict, NotFound


STAFF = """FROM rh.Empleado e
 JOIN rh.Persona p ON p.PersonaId=e.PersonaId
 JOIN rh.Puesto pu ON pu.PuestoId=e.PuestoId
 WHERE e.EstadoLaboral='ACTIVO' AND p.Activo=1 AND pu.Activo=1 AND pu.EsTecnico=1"""


def week_start(value, today):
    day = date.fromisoformat(value) if value else today
    if not 2000 <= day.year <= 2100:
        raise ValueError('Selecciona una fecha entre 2000 y 2100.')
    return day - timedelta(days=day.weekday())


def shifts_for_week(items, start, single_day=None):
    expected = {single_day} if single_day else {start + timedelta(days=i) for i in range(7)}
    if not isinstance(items, list) or len(items) != len(expected):
        raise ValueError('Envía un horario para el día seleccionado.' if single_day
                         else 'Envía los siete días de la semana.')
    shifts = {}
    for item in items:
        if not isinstance(item, dict):
            raise ValueError('Horario inválido.')
        day = date.fromisoformat(item.get('fecha') or '')
        if day in shifts or day not in expected:
            raise ValueError('Las fechas deben ser únicas y coincidir con los días seleccionados.')
        begin, end = item.get('inicio'), item.get('fin')
        if not begin and not end:
            shifts[day] = None
            continue
        if (not isinstance(begin, str) or not isinstance(end, str)
                or len(begin) != 5 or len(end) != 5 or begin[2] != ':' or end[2] != ':'):
            raise ValueError('Completa la entrada y salida en formato HH:MM.')
        if time.fromisoformat(begin) >= time.fromisoformat(end):
            raise ValueError('La salida debe ser posterior a la entrada del mismo día.')
        shifts[day] = (begin, end)
    return shifts


def register_staff_calendar(b):
    @b.app.get('/api/vacaciones/calendario')
    @b.require_session('COORDINADOR', 'TECNICO')
    def staff_calendar(session):
        today = b.planning.local_day()
        start = week_start(request.args.get('semana'), today)
        end = start + timedelta(days=6)
        coord = session['rol'] == 'COORDINADOR'
        team = coord and request.args.get('vista') == 'equipo'
        employee = int(request.args.get('empleado_id') or 0) if coord else int(session.get('empleado_id') or -1)
        people = b.query_all("SELECT e.EmpleadoId AS id,CONCAT_WS(N' ',p.Nombres,p.Apellidos) AS nombre,pu.Nombre AS puesto "
                             + STAFF + " AND (?=1 OR e.EmpleadoId=?) ORDER BY nombre,e.EmpleadoId", (int(coord), employee))
        ids = {p['id'] for p in people}
        if not employee and coord and people and not team:
            employee = people[0]['id']
        if team or employee not in ids:
            employee = None
        shifts, vacations = [], []
        if people and (team or employee):
            staff_scope = f"EXISTS (SELECT 1 {STAFF} AND e.EmpleadoId=x.EmpleadoId AND (?=1 OR e.EmpleadoId=?))"
            shifts = b.query_all(f"""SELECT x.EmpleadoId AS empleado_id, x.Fecha AS fecha,
                                            CONVERT(char(5),x.Inicio,108) AS inicio,CONVERT(char(5),x.Fin,108) AS fin
                                     FROM rh.HorarioEmpleado x WHERE x.Fecha BETWEEN ? AND ? AND {staff_scope}
                                     ORDER BY x.EmpleadoId,x.Fecha""",
                                 (start, end, int(team), employee))
            vacations = b.query_all(f"""SELECT x.EmpleadoId AS empleado_id, x.SolicitudVacacionId AS id,
                                               x.FechaInicio AS inicio,x.FechaFin AS fin,x.Estado AS estado
                                        FROM rh.SolicitudVacacion x WHERE x.FechaInicio<=? AND x.FechaFin>=?
                                          AND x.Estado IN ('APROBADA','PENDIENTE','REPROGRAMAR') AND {staff_scope}
                                        ORDER BY x.EmpleadoId,x.FechaInicio""",
                                    (end, start, int(team), employee))
        return jsonify(ok=True, hoy=today, lunes=start, domingo=end, empleado_id=employee,
                       personal=people, horarios=shifts, vacaciones=vacations)

    @b.app.put('/api/vacaciones/calendario')
    @b.require_session('COORDINADOR')
    def save_staff_calendar(session):
        payload = request.get_json(silent=True) or {}
        employee = int(payload.get('empleado_id') or 0)
        start = week_start(payload.get('semana'), b.planning.local_day())
        end = start + timedelta(days=6)
        single_day = date.fromisoformat(payload['fecha']) if payload.get('fecha') else None
        if single_day and not start <= single_day <= end:
            raise ValueError('El día debe pertenecer a la semana seleccionada.')
        shifts = shifts_for_week(payload.get('horarios'), start, single_day)
        original = shifts_for_week(payload.get('original'), start, single_day)
        with b.get_db_connection() as conn:
            cur = conn.cursor()
            b.planning.lock_planning(b, cur)
            if not b.exec_proc_row(cur, "SELECT e.EmpleadoId AS id " + STAFF + " AND e.EmpleadoId=?", (employee,)):
                raise NotFound('Empleado operativo no disponible.')
            current = b.exec_proc_rows(cur, """SELECT Fecha AS fecha,CONVERT(char(5),Inicio,108) AS inicio,CONVERT(char(5),Fin,108) AS fin
                                             FROM rh.HorarioEmpleado WHERE EmpleadoId=? AND Fecha BETWEEN ? AND ?""",
                                       (employee, single_day or start, single_day or end))
            current_by_date = {row['fecha']: (row['inicio'], row['fin']) for row in current}
            if any(current_by_date.get(day) != shift for day, shift in original.items()):
                raise Conflict('El horario cambió mientras lo editabas. Cierra y vuelve a abrir la edición.')
            b.set_audit_context(cur, session, 'Edición de horario diario' if single_day else 'Edición de horario semanal')
            for day, shift in shifts.items():
                if shift == original[day]:
                    continue
                if shift:
                    cur.execute("""UPDATE rh.HorarioEmpleado SET Inicio=?,Fin=? WHERE EmpleadoId=? AND Fecha=?;
                                IF @@ROWCOUNT=0 INSERT INTO rh.HorarioEmpleado(EmpleadoId,Fecha,Inicio,Fin) VALUES(?,?,?,?);""",
                                *shift, employee, day, employee, day, *shift)
                else:
                    cur.execute('DELETE FROM rh.HorarioEmpleado WHERE EmpleadoId=? AND Fecha=?', employee, day)
        return jsonify(ok=True, message='Horario guardado.' if single_day else 'Horario semanal guardado.')

    @b.app.post('/api/vacaciones/calendario/copiar')
    @b.require_session('COORDINADOR')
    def copy_staff_calendar(session):
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            raise ValueError('Indica el horario que quieres copiar.')
        employees = payload.get('empleados')
        origin_week, target_week = payload.get('semana_origen'), payload.get('semana_destino')
        replace = payload.get('reemplazar', False)
        if not isinstance(employees, list) or not employees:
            raise ValueError('Selecciona de quiénes quieres copiar el horario.')
        if any(type(employee) is not int or not 0 < employee < 2**63 for employee in employees):
            raise ValueError('El personal seleccionado no es válido.')
        if not isinstance(origin_week, str) or not origin_week or not isinstance(target_week, str) or not target_week or type(replace) is not bool:
            raise ValueError('Indica las semanas de origen y destino.')
        today = b.planning.local_day()
        origin = week_start(origin_week, today)
        target = week_start(target_week, today)
        if origin == target:
            raise ValueError('Selecciona una semana de destino distinta.')
        ids = set(employees)
        with b.get_db_connection() as conn:
            cur = conn.cursor()
            b.planning.lock_planning(b, cur)
            staff = b.exec_proc_rows(cur, 'SELECT e.EmpleadoId AS id ' + STAFF
                                    + ' AND e.EmpleadoId IN (SELECT CONVERT(bigint,value) FROM OPENJSON(?))',
                                    (json.dumps(sorted(ids)),))
            if {row['id'] for row in staff} != ids:
                raise NotFound('Una persona seleccionada ya no está disponible en el calendario.')
            b.set_audit_context(cur, session, 'Copia de horario semanal')
            result = b.exec_proc_row(cur, """
                SET NOCOUNT ON;
                DECLARE @Desde date=?, @Destino date=?, @Reemplazar bit=?;
                DECLARE @Personas table (Id bigint PRIMARY KEY);
                INSERT INTO @Personas SELECT CONVERT(bigint,value) FROM OPENJSON(?);
                DECLARE @Horarios table (EmpleadoId bigint, Fecha date, Inicio time(0), Fin time(0),
                                        PRIMARY KEY (EmpleadoId,Fecha));
                INSERT INTO @Horarios
                    SELECT h.EmpleadoId,DATEADD(day,DATEDIFF(day,@Desde,h.Fecha),@Destino),h.Inicio,h.Fin
                    FROM rh.HorarioEmpleado h JOIN @Personas p ON p.Id=h.EmpleadoId
                    WHERE h.Fecha>=@Desde AND h.Fecha<DATEADD(day,7,@Desde);
                DECLARE @Dias int=@@ROWCOUNT, @Actualizados int=0;
                IF @Reemplazar=1
                BEGIN
                    UPDATE h SET Inicio=s.Inicio,Fin=s.Fin
                    FROM rh.HorarioEmpleado h JOIN @Horarios s ON s.EmpleadoId=h.EmpleadoId AND s.Fecha=h.Fecha
                    WHERE h.Inicio<>s.Inicio OR h.Fin<>s.Fin;
                    SET @Actualizados=@@ROWCOUNT;
                END;
                INSERT INTO rh.HorarioEmpleado(EmpleadoId,Fecha,Inicio,Fin)
                    SELECT s.EmpleadoId,s.Fecha,s.Inicio,s.Fin FROM @Horarios s
                    WHERE NOT EXISTS (SELECT 1 FROM rh.HorarioEmpleado h WHERE h.EmpleadoId=s.EmpleadoId AND h.Fecha=s.Fecha);
                DECLARE @Creados int=@@ROWCOUNT;
                SELECT @Dias AS dias,@Creados AS creados,@Actualizados AS reemplazados,
                    @Dias-@Creados-@Actualizados AS conservados;
                """, (origin, target, replace, json.dumps(sorted(ids))))
            if not result['dias']:
                raise ValueError('El personal seleccionado no tiene horarios en esa semana.')
        return jsonify(ok=True, **result)
