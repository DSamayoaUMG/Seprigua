"""Reporte semanal operativo del coordinador, con fechas de Guatemala."""
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from html import escape
from io import BytesIO
from zoneinfo import ZoneInfo

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import CondPageBreak, Paragraph, SimpleDocTemplate, Table, TableStyle

from .pdf_styles import portal_styles


GUATEMALA = ZoneInfo("America/Guatemala")


def week_bounds(value=None):
    """Devuelve lunes local y límites UTC exclusivos para consultar SQL Server."""
    selected = date.fromisoformat(value) if value else datetime.now(GUATEMALA).date()
    if not date(2000, 1, 1) <= selected <= date(2100, 12, 31):
        raise ValueError("Selecciona una fecha entre 2000 y 2100.")
    monday = selected - timedelta(days=selected.weekday())
    start = datetime.combine(monday, time.min, GUATEMALA).astimezone(timezone.utc).replace(tzinfo=None)
    end = datetime.combine(monday + timedelta(days=7), time.min, GUATEMALA).astimezone(timezone.utc).replace(tzinfo=None)
    return monday, start, end


def collect_weekly_data(query_all, monday, start, end):
    period = (start, end)
    requests = query_all("""
        SELECT s.SolicitudServicioId AS id,c.NombreComercial AS cliente,
               ts.Nombre AS servicio,s.DescripcionProblema AS descripcion,s.Estado AS estado,
               s.CreadoEn AS fecha,o.NumeroOrden AS orden
        FROM srv.SolicitudServicio s
        JOIN crm.Cliente c ON c.ClienteId=s.ClienteId
        JOIN srv.TipoServicio ts ON ts.TipoServicioId=s.TipoServicioId
        LEFT JOIN srv.OrdenTrabajo o ON o.SolicitudServicioId=s.SolicitudServicioId
        WHERE s.CreadoEn>=? AND s.CreadoEn<? ORDER BY c.NombreComercial,s.CreadoEn
    """, period)
    completed = query_all("""
        SELECT o.OrdenTrabajoId AS id,o.NumeroOrden AS orden,c.NombreComercial AS cliente,
               ts.Nombre AS servicio,s.DescripcionProblema AS descripcion,o.FinalizadaEn AS fecha,
               COALESCE(crew.nombres,N'Sin asignación registrada') AS tecnicos
        FROM srv.OrdenTrabajo o
        JOIN srv.SolicitudServicio s ON s.SolicitudServicioId=o.SolicitudServicioId
        JOIN crm.Cliente c ON c.ClienteId=s.ClienteId
        JOIN srv.TipoServicio ts ON ts.TipoServicioId=s.TipoServicioId
        OUTER APPLY (
          SELECT STRING_AGG(CAST(CONCAT(p.Nombres,N' ',p.Apellidos,
            CASE WHEN t.FuncionCuadrilla IS NULL THEN N'' ELSE CONCAT(N' (',t.FuncionCuadrilla,N')') END)
            AS nvarchar(max)),N', ') AS nombres
          FROM srv.TecnicoOrden t JOIN rh.Empleado e ON e.EmpleadoId=t.EmpleadoId
          JOIN rh.Persona p ON p.PersonaId=e.PersonaId
          WHERE t.OrdenTrabajoId=o.OrdenTrabajoId AND t.Estado<>'CANCELADO'
        ) crew
        WHERE o.FinalizadaEn>=? AND o.FinalizadaEn<? ORDER BY c.NombreComercial,o.FinalizadaEn
    """, period)
    rescheduled = query_all("""
        SELECT h.HistorialEstadoOrdenId AS id,o.NumeroOrden AS orden,c.NombreComercial AS cliente,
               ts.Nombre AS servicio,h.Comentario AS detalle,h.FechaCambio AS fecha
        FROM srv.HistorialEstadoOrden h
        JOIN srv.OrdenTrabajo o ON o.OrdenTrabajoId=h.OrdenTrabajoId
        JOIN srv.SolicitudServicio s ON s.SolicitudServicioId=o.SolicitudServicioId
        JOIN crm.Cliente c ON c.ClienteId=s.ClienteId
        JOIN srv.TipoServicio ts ON ts.TipoServicioId=s.TipoServicioId
        WHERE h.FechaCambio>=? AND h.FechaCambio<?
          AND (h.Comentario LIKE N'Reprogramada:%' OR h.Comentario LIKE N'Reprogramación%')
        ORDER BY c.NombreComercial,h.FechaCambio
    """, period)
    cancelled = query_all("""
        SELECT o.NumeroOrden AS referencia,c.NombreComercial AS cliente,
               ts.Nombre AS servicio,COALESCE(o.MotivoCancelacion,s.Observaciones,N'') AS motivo,
               o.CanceladaEn AS fecha
        FROM srv.OrdenTrabajo o
        JOIN srv.SolicitudServicio s ON s.SolicitudServicioId=o.SolicitudServicioId
        JOIN crm.Cliente c ON c.ClienteId=s.ClienteId
        JOIN srv.TipoServicio ts ON ts.TipoServicioId=s.TipoServicioId
        WHERE o.CanceladaEn>=? AND o.CanceladaEn<?
        UNION ALL
        SELECT CONCAT(N'Solicitud #',s.SolicitudServicioId),c.NombreComercial,ts.Nombre,
               COALESCE(s.Observaciones,N''),s.ActualizadoEn
        FROM srv.SolicitudServicio s
        JOIN crm.Cliente c ON c.ClienteId=s.ClienteId
        JOIN srv.TipoServicio ts ON ts.TipoServicioId=s.TipoServicioId
        WHERE s.Estado='CANCELADA' AND s.ActualizadoEn>=? AND s.ActualizadoEn<?
          AND NOT EXISTS(SELECT 1 FROM srv.OrdenTrabajo o WHERE o.SolicitudServicioId=s.SolicitudServicioId)
        ORDER BY cliente,fecha
    """, (*period, *period))
    warranties = query_all("""
        SELECT i.IncidenciaOrdenId AS id,o.NumeroOrden AS orden,c.NombreComercial AS cliente,
               ts.Nombre AS servicio,i.Descripcion AS descripcion,i.ResueltaEn AS fecha,
               JSON_VALUE(CASE WHEN ISJSON(i.AccionTomada)=1 THEN i.AccionTomada ELSE N'{}' END,
                 '$.revision_orden_id') AS revision_id
        FROM srv.IncidenciaOrden i
        JOIN srv.OrdenTrabajo o ON o.OrdenTrabajoId=i.OrdenTrabajoId
        JOIN srv.SolicitudServicio s ON s.SolicitudServicioId=o.SolicitudServicioId
        JOIN crm.Cliente c ON c.ClienteId=s.ClienteId
        JOIN srv.TipoServicio ts ON ts.TipoServicioId=s.TipoServicioId
        WHERE i.ResueltaEn>=? AND i.ResueltaEn<?
          AND JSON_VALUE(CASE WHEN ISJSON(i.AccionTomada)=1 THEN i.AccionTomada ELSE N'{}' END,
            '$.portal_tipo')='garantia_solicitud'
          AND JSON_VALUE(CASE WHEN ISJSON(i.AccionTomada)=1 THEN i.AccionTomada ELSE N'{}' END,
            '$.estado')='ATENDIDA'
        ORDER BY c.NombreComercial,i.ResueltaEn
    """, period)
    activities = query_all("""
        SELECT a.ActividadServicioId AS id,o.NumeroOrden AS orden,c.NombreComercial AS cliente,
               CONCAT(p.Nombres,N' ',p.Apellidos) AS tecnico,a.Descripcion AS trabajo,
               a.Resultado AS resultado,a.RealizadaEn AS fecha
        FROM srv.ActividadServicio a
        JOIN srv.OrdenTrabajo o ON o.OrdenTrabajoId=a.OrdenTrabajoId
        JOIN srv.SolicitudServicio s ON s.SolicitudServicioId=o.SolicitudServicioId
        JOIN crm.Cliente c ON c.ClienteId=s.ClienteId
        JOIN rh.Empleado e ON e.EmpleadoId=a.EmpleadoId
        JOIN rh.Persona p ON p.PersonaId=e.PersonaId
        WHERE a.RealizadaEn>=? AND a.RealizadaEn<?
        ORDER BY p.Nombres,p.Apellidos,a.RealizadaEn
    """, period)
    return dict(monday=monday, requests=requests, completed=completed,
                rescheduled=rescheduled, cancelled=cancelled,
                warranties=warranties, activities=activities)


def _local(value):
    if not value:
        return "—"
    if isinstance(value, datetime):
        stamp = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value
        return stamp.astimezone(GUATEMALA).strftime("%d/%m/%Y %H:%M")
    return str(value)


def build_weekly_pdf(data):
    """Presenta la semana como tablero ejecutivo seguido del detalle operativo."""
    from .pdf_styles import (BORDER, BLUE, INK, MUTED, NAVY, PALE, PALE_BLUE,
                             data_table, page_frame, pdf_text, section_header)
    from reportlab.platypus import Spacer

    out = BytesIO()
    styles = portal_styles()
    monday = data['monday']
    sunday = monday + timedelta(days=6)
    doc = SimpleDocTemplate(out, pagesize=landscape(A4), leftMargin=14 * mm,
                            rightMargin=14 * mm, topMargin=39 * mm, bottomMargin=23 * mm,
                            title=f'Reporte semanal SEPRIGUA {monday:%Y-%m-%d}', author='SEPRIGUA')
    width = 269 * mm
    kicker = ParagraphStyle('WeeklyKicker', parent=styles['Normal'], fontName='PortalSans-Bold',
                            fontSize=8, leading=11, textColor=BLUE, spaceAfter=4)
    title = ParagraphStyle('WeeklyTitleModern', parent=styles['Title'], fontName='PortalSans-Bold',
                           fontSize=20, leading=24, textColor=NAVY, alignment=0, spaceAfter=4)
    subtitle = ParagraphStyle('WeeklySubtitleModern', parent=styles['Normal'], fontSize=9,
                              leading=13, textColor=MUTED)
    small = ParagraphStyle('WeeklySmallModern', parent=styles['Normal'], fontSize=7.5,
                           leading=11, textColor=MUTED)
    metric_value = ParagraphStyle('WeeklyMetricValue', parent=styles['Normal'],
                                  fontName='PortalSans-Bold', fontSize=17, leading=20, textColor=NAVY)
    metric_label = ParagraphStyle('WeeklyMetricLabel', parent=styles['Normal'],
                                  fontSize=7.5, leading=10, textColor=MUTED)

    story = [
        Paragraph('CENTRO DE CONTROL · RESUMEN OPERATIVO', kicker),
        Paragraph('Reporte semanal', title),
        Paragraph(f'Del {monday:%d/%m/%Y} al {sunday:%d/%m/%Y} · Hora de Guatemala', subtitle),
        Spacer(1, 7 * mm),
    ]
    metrics = [
        ('Solicitudes recibidas', len(data['requests'])),
        ('Órdenes atendidas', len(data['completed'])),
        ('Reprogramaciones', len(data['rescheduled'])),
        ('Cancelaciones', len(data['cancelled'])),
        ('Garantías atendidas', len(data['warranties'])),
        ('Actividades técnicas', len(data['activities'])),
    ]
    metric_rows = []
    for offset in (0, 3):
        metric_rows.append([
            [Paragraph(str(total), metric_value), Paragraph(pdf_text(label), metric_label)]
            for label, total in metrics[offset:offset + 3]
        ])
    cards = Table(metric_rows, colWidths=[width / 3] * 3, hAlign='LEFT')
    cards.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), PALE),
        ('BOX', (0, 0), (-1, -1), .7, BORDER),
        ('INNERGRID', (0, 0), (-1, -1), .5, BORDER),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 12),
        ('TOPPADDING', (0, 0), (-1, -1), 11),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 11),
    ]))
    story += [cards, Spacer(1, 5 * mm),
              Paragraph('Los totales se calculan por fecha del evento durante la semana. '
                        'El estado mostrado de una solicitud corresponde a su estado actual.', small),
              Spacer(1, 8 * mm)]

    def table_section(label, headers, rows, widths):
        story.extend([CondPageBreak(28 * mm), section_header(f'{label}  ·  {len(rows)}', width, styles),
                      Spacer(1, 2.5 * mm)])
        if rows:
            story.append(data_table(headers, rows, [w * mm for w in widths], styles,
                                    font_size=7.1, row_padding=4))
        else:
            story.append(Paragraph('Sin movimientos registrados en esta sección.', small))
        story.append(Spacer(1, 7 * mm))

    by_client = defaultdict(lambda: defaultdict(int))
    for key, field in [('requests', 'Solicitadas'), ('completed', 'Atendidas'),
                       ('rescheduled', 'Reprogramadas'), ('cancelled', 'Canceladas'),
                       ('warranties', 'Garantías atendidas')]:
        for item in data[key]:
            by_client[item.get('cliente') or 'Sin cliente'][field] += 1
    client_rows = [[name] + [values[field] for field in
                   ('Solicitadas', 'Atendidas', 'Reprogramadas', 'Canceladas', 'Garantías atendidas')]
                   for name, values in sorted(by_client.items())]
    table_section('Resumen por cliente',
                  ['Cliente', 'Solicitadas', 'Atendidas', 'Reprogramadas', 'Canceladas', 'Garantías'],
                  client_rows, [83, 38, 38, 40, 38, 32])
    table_section('Solicitudes recibidas', ['Fecha', 'Cliente', 'Servicio y trabajo solicitado', 'Estado', 'OT'],
                  [[_local(x.get('fecha')), x.get('cliente'),
                    f"{x.get('servicio') or ''}: {x.get('descripcion') or ''}",
                    x.get('estado'), x.get('orden')] for x in data['requests']],
                  [37, 53, 104, 42, 33])
    table_section('Trabajos atendidos', ['Finalización', 'OT', 'Cliente', 'Trabajo', 'Técnicos asignados'],
                  [[_local(x.get('fecha')), x.get('orden'), x.get('cliente'),
                    f"{x.get('servicio') or ''}: {x.get('descripcion') or ''}", x.get('tecnicos')]
                   for x in data['completed']], [38, 28, 50, 85, 68])
    table_section('Trabajos reprogramados', ['Fecha', 'OT', 'Cliente', 'Servicio', 'Cambio registrado'],
                  [[_local(x.get('fecha')), x.get('orden'), x.get('cliente'), x.get('servicio'),
                    x.get('detalle')] for x in data['rescheduled']], [38, 28, 52, 52, 99])
    table_section('Solicitudes y órdenes canceladas', ['Fecha', 'Referencia', 'Cliente', 'Servicio', 'Motivo'],
                  [[_local(x.get('fecha')), x.get('referencia'), x.get('cliente'), x.get('servicio'),
                    x.get('motivo')] for x in data['cancelled']], [38, 35, 52, 52, 92])
    table_section('Garantías atendidas', ['Cierre', 'OT original', 'Cliente', 'Servicio', 'Atención'],
                  [[_local(x.get('fecha')), x.get('orden'), x.get('cliente'), x.get('servicio'),
                    x.get('descripcion')] for x in data['warranties']], [38, 34, 52, 53, 92])
    table_section('Trabajos realizados por técnicos',
                  ['Fecha', 'Técnico', 'OT', 'Cliente', 'Trabajo y resultado'],
                  [[_local(x.get('fecha')), x.get('tecnico'), x.get('orden'), x.get('cliente'),
                    f"{x.get('trabajo') or ''} · {x.get('resultado') or 'Sin resultado registrado'}"]
                   for x in data['activities']], [38, 51, 29, 52, 99])

    draw = lambda canvas, document: page_frame(canvas, document, 'Reporte semanal',
                                                f'{monday:%d/%m/%Y} - {sunday:%d/%m/%Y}',
                                                note='Información operativa · Uso de Coordinación')
    doc.build(story, onFirstPage=draw, onLaterPages=draw)
    out.seek(0)
    return out
