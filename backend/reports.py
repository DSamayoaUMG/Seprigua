"""Reporte PDF de la orden sobre el expediente autorizado del portal."""
from datetime import datetime
from io import BytesIO
from zoneinfo import ZoneInfo

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import CondPageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

if __package__:
    from .pdf_styles import (BORDER, BLUE, INK, MUTED, NAVY, PALE, data_table,
                             page_frame, pdf_text, portal_styles, section_header)
else:
    from pdf_styles import (BORDER, BLUE, INK, MUTED, NAVY, PALE, data_table,
                            page_frame, pdf_text, portal_styles, section_header)


def build_order_report(data):
    output = BytesIO()
    item = data['item']
    styles = portal_styles()
    page_width = 176 * mm
    kicker = ParagraphStyle('OrderKicker', parent=styles['Normal'], fontName='PortalSans-Bold',
                            fontSize=8, leading=11, textColor=BLUE, spaceAfter=4)
    title = ParagraphStyle('OrderTitle', parent=styles['Title'], fontName='PortalSans-Bold',
                           fontSize=19, leading=23, textColor=NAVY, alignment=0, spaceAfter=4)
    sub = ParagraphStyle('OrderSubtitle', parent=styles['Normal'], fontSize=8.5,
                         leading=12, textColor=MUTED)
    label = ParagraphStyle('OrderLabel', parent=styles['Normal'], fontName='PortalSans-Bold',
                           fontSize=7, leading=10, textColor=MUTED)
    value = ParagraphStyle('OrderValue', parent=styles['Normal'], fontName='PortalSans-Bold',
                           fontSize=9, leading=12, textColor=INK)
    note_style = ParagraphStyle('OrderNote', parent=styles['Normal'], fontSize=8,
                                leading=12, textColor=MUTED)
    number = str(item.get('numero') or 'Sin número')
    doc = SimpleDocTemplate(output, pagesize=A4, leftMargin=17 * mm, rightMargin=17 * mm,
                            topMargin=39 * mm, bottomMargin=23 * mm,
                            title=f'Reporte de servicio {number}', author='SEPRIGUA')
    generated = datetime.now(ZoneInfo('America/Guatemala')).strftime('%d/%m/%Y %H:%M')
    story = [
        Paragraph('EXPEDIENTE DE SERVICIO', kicker),
        Paragraph('Reporte de orden de trabajo', title),
        Paragraph(f'Orden {pdf_text(number)} · Emitido el {generated} · Hora de Guatemala', sub),
        Spacer(1, 7 * mm),
    ]
    blocks = [
        ('CLIENTE', item.get('cliente')), ('SEDE', item.get('sede')),
        ('SERVICIO', item.get('tipo')), ('ESTADO', item.get('estado')),
        ('TICKET', item.get('ticket')), ('OT FÍSICA', item.get('orden_papel')),
        ('SOLICITUD', item.get('solicitud')), ('REFERENCIA', number),
    ]
    cards = []
    for index in range(0, len(blocks), 2):
        row = []
        for caption, content in blocks[index:index + 2]:
            row.append([Paragraph(caption, label), Paragraph(pdf_text(content), value)])
        cards.append(row)
    meta = Table(cards, colWidths=[88 * mm, 88 * mm], hAlign='LEFT')
    meta.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), PALE),
        ('BOX', (0, 0), (-1, -1), .6, BORDER),
        ('INNERGRID', (0, 0), (-1, -1), .4, BORDER),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ('RIGHTPADDING', (0, 0), (-1, -1), 10),
        ('TOPPADDING', (0, 0), (-1, -1), 9),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 9),
    ]))
    story.extend([meta, Spacer(1, 8 * mm)])

    sections = [
        ('Cuadrilla asignada', ['Nombre', 'Función', 'Estado'],
         [[x.get('nombre'), x.get('funcion'), x.get('estado')] for x in data.get('tecnicos', [])],
         [80 * mm, 48 * mm, 48 * mm]),
        ('Trabajo realizado', ['Descripción', 'Resultado', 'Responsable'],
         [[x.get('Descripcion'), x.get('Resultado'), x.get('empleado')]
          for x in data.get('actividades', [])], [88 * mm, 50 * mm, 38 * mm]),
        ('Evidencias registradas', ['Archivo', 'Tipo', 'Descripción'],
         [[x.get('nombre'), x.get('tipo'), x.get('Descripcion') or x.get('descripcion')]
          for x in data.get('evidencias', [])], [64 * mm, 24 * mm, 88 * mm]),
    ]
    for caption, headers, rows, widths in sections:
        story.extend([CondPageBreak(31 * mm), section_header(caption, page_width, styles), Spacer(1, 3 * mm)])
        if rows:
            story.append(data_table(headers, rows, widths, styles, font_size=8))
        else:
            story.append(Paragraph('Sin registros en esta sección.', note_style))
        story.append(Spacer(1, 7 * mm))
    story.append(Paragraph('Los archivos originales se consultan desde el expediente autorizado del portal. '
                           'La cotización comercial se administra por separado.', note_style))
    draw = lambda canvas, document: page_frame(canvas, document, 'Orden de trabajo', number,
                                                note='Expediente operativo · Información para uso autorizado')
    doc.build(story, onFirstPage=draw, onLaterPages=draw)
    output.seek(0)
    return output
