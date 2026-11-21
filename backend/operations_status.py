"""Criterios compartidos para pendientes comerciales y filtros del Centro de control."""
from calendar import monthrange
from datetime import date, timedelta


QUOTE_PENDING = """eo.Codigo<>'CANCELADA'
 AND NOT EXISTS (SELECT 1 FROM cot.Cotizacion cq WHERE cq.OrdenTrabajoId=o.OrdenTrabajoId)
 AND NOT EXISTS (
    SELECT 1 FROM srv.IncidenciaOrden gi
    CROSS APPLY (VALUES(CASE WHEN ISJSON(gi.AccionTomada)=1 THEN gi.AccionTomada ELSE N'{}' END)) m(info)
    WHERE JSON_VALUE(m.info,'$.portal_tipo')='garantia_solicitud'
      AND TRY_CONVERT(bigint,JSON_VALUE(m.info,'$.revision_orden_id'))=o.OrdenTrabajoId
 )"""


def dashboard_range(kind, value, today):
    if kind not in ('dia', 'semana', 'mes'):
        raise ValueError('Selecciona día, semana o mes.')
    day = date.fromisoformat(value) if value else today
    if not 2000 <= day.year <= 2100:
        raise ValueError('Selecciona una fecha entre 2000 y 2100.')
    if kind == 'semana':
        start = day - timedelta(days=day.weekday())
        return start, start + timedelta(days=6)
    if kind == 'mes':
        return day.replace(day=1), day.replace(day=monthrange(day.year, day.month)[1])
    return day, day
