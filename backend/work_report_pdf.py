"""PDF visual del seguimiento de una cotización y su trabajo asociado."""

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from io import BytesIO
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from PIL import Image as PILImage, ImageDraw, ImageFont, ImageOps
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.pagesizes import A4
from reportlab.platypus import (CondPageBreak, Image, Paragraph, SimpleDocTemplate,
                                Spacer, Table, TableStyle, PageBreak)

if __package__:
    from .pdf_styles import (BORDER, BLUE, INK, MUTED, NAVY, PALE, RED,
                             data_table, page_frame, pdf_text, portal_styles, section_header)
else:
    from pdf_styles import (BORDER, BLUE, INK, MUTED, NAVY, PALE, RED,
                            data_table, page_frame, pdf_text, portal_styles, section_header)


try:
    GT = ZoneInfo('America/Guatemala')
except ZoneInfoNotFoundError:
    GT = timezone(timedelta(hours=-6))


def _when(value):
    if not value:
        return 'Sin registro'
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.rstrip('Z'))
        except ValueError:
            return value
    if isinstance(value, datetime):
        stamp = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value
        return stamp.astimezone(GT).strftime('%d/%m/%Y · %I:%M %p')
    if isinstance(value, date):
        return value.strftime('%d/%m/%Y')
    return str(value)


def _money(value, currency='GTQ'):
    try:
        amount = Decimal(str(value or 0))
    except Exception:
        amount = Decimal(0)
    return f"{'Q' if str(currency or 'GTQ').upper() == 'GTQ' else currency} {amount:,.2f}"


def _font(size, bold=False):
    names = ['C:/Windows/Fonts/arialbd.ttf' if bold else 'C:/Windows/Fonts/arial.ttf',
             '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' if bold else
             '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']
    for name in names:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def _quote_image(data):
    """Vista previa visual de los datos actuales, sin fingir ser un archivo firmado."""
    quote = data['cotizacion']
    version = data.get('version') or {}
    lines = data.get('lineas') or []
    shown = lines[:8]
    height = 390 + len(shown) * 49
    image = PILImage.new('RGB', (1100, height), '#ffffff')
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 1100, 114), fill='#0d3968')
    draw.rectangle((0, 110, 1100, 116), fill='#e73559')
    draw.text((48, 28), 'SEPRIGUA', font=_font(43, True), fill='#ffffff')
    draw.text((48, 78), 'VISTA DE COTIZACIÓN · VERSIÓN ACTUAL', font=_font(15, True), fill='#dcecff')
    draw.text((48, 143), str(quote.get('numero') or ''), font=_font(31, True), fill='#0d3968')
    draw.text((48, 193), 'Cliente: ' + str(quote.get('cliente') or ''), font=_font(19), fill='#334d68')
    draw.text((48, 224), 'Estado: ' + str(quote.get('estado') or ''), font=_font(19), fill='#334d68')
    draw.text((48, 255), 'Emisión: ' + _when(version.get('emision')), font=_font(18), fill='#334d68')
    draw.rectangle((48, 296, 1052, 336), fill='#eaf3fa')
    draw.text((64, 305), 'CONCEPTO', font=_font(17, True), fill='#0d3968')
    draw.text((890, 305), 'TOTAL', font=_font(17, True), fill='#0d3968')
    y = 349
    for item in shown:
        description = str(item.get('descripcion') or '').replace('\n', ' ')
        if len(description) > 88:
            description = description[:85] + '...'
        draw.text((64, y), description, font=_font(16), fill='#213b57')
        draw.text((880, y), _money(item.get('total'), version.get('moneda')),
                  font=_font(16, True), fill='#213b57')
        draw.line((48, y + 35, 1052, y + 35), fill='#d9e6f0', width=2)
        y += 49
    if len(lines) > len(shown):
        draw.text((64, y), f'+ {len(lines) - len(shown)} conceptos más en el detalle completo',
                  font=_font(14), fill='#6c839a')
    draw.text((640, height - 52), 'TOTAL  ' + _money(version.get('total'), version.get('moneda')),
              font=_font(27, True), fill='#0d3968')
    out = BytesIO()
    image.save(out, 'JPEG', quality=84, optimize=True)
    out.seek(0)
    return out, image.size


def _evidence_image(item):
    try:
        source = PILImage.open(BytesIO(item['contenido']))
        source = ImageOps.exif_transpose(source)
        source.thumbnail((1300, 1250), PILImage.Resampling.LANCZOS)
        source = source.convert('RGB')
        out = BytesIO()
        source.save(out, 'JPEG', quality=82, optimize=True)
        out.seek(0)
        width, height = source.size
        scale = min(160 * mm / width, 105 * mm / height)
        return Image(out, width=width * scale, height=height * scale)
    except Exception:
        return None


def _collage_pages(source, page_width):
    """Divide un collage vertical en páginas legibles sin reducirlo a una miniatura."""
    source.seek(0)
    with PILImage.open(source) as raw:
        collage = raw.convert('RGB')
    pixel_width, pixel_height = collage.size
    max_pixels = int(pixel_width * 1.12)
    def stage_bar_near(row, page_top):
        for preceding in range(max(page_top, row - 135), row, 10):
            red, green, blue = collage.getpixel((pixel_width // 2, preceding))
            if red < 45 and green < 105 and blue < 170:
                return True
        return False
    pages = []
    top = 0
    while top < pixel_height:
        end = min(top + max_pixels, pixel_height)
        if end < pixel_height:
            # Busca el espacio blanco entre filas para evitar cortar una fotografía.
            sample_x = range(90, pixel_width - 90, max(1, pixel_width // 48))
            choices = range(max(top + max_pixels - 740, top + 700),
                            min(top + max_pixels + 1, pixel_height), 8)
            white_rows = []
            for row in choices:
                clear = sum(1 for x in sample_x if min(collage.getpixel((x, row))) >= 252)
                # No dejar una barra de etapa sola al final de la página.
                header_above = stage_bar_near(row, top)
                outside_cards = all(min(collage.getpixel((x, row))) >= 252
                                    for x in (70, 74, pixel_width - 70, pixel_width - 74))
                if clear >= len(sample_x) * .97 and outside_cards and not header_above:
                    white_rows.append(row)
            if white_rows:
                end = max(white_rows)
        piece = collage.crop((0, top, pixel_width, end))
        stream = BytesIO()
        piece.save(stream, 'JPEG', quality=84, optimize=True)
        stream.seek(0)
        pages.append(Image(stream, width=page_width,
                           height=page_width * (end - top) / pixel_width))
        top = end
    return pages


def build_work_report_pdf(data, images, collage=None):
    quote = data['cotizacion']
    version = data.get('version') or {}
    order = data.get('orden') or {}
    styles = portal_styles()
    small = ParagraphStyle('WorkSmall', parent=styles['Normal'], fontSize=8, leading=12, textColor=MUTED)
    body = ParagraphStyle('WorkBody', parent=styles['Normal'], fontSize=9, leading=14, textColor=INK)
    strong = ParagraphStyle('WorkStrong', parent=body, fontName='PortalSans-Bold', textColor=NAVY)
    title = ParagraphStyle('WorkTitle', parent=styles['Title'], fontName='PortalSans-Bold',
                           fontSize=21, leading=25, textColor=NAVY)
    kicker = ParagraphStyle('WorkKicker', parent=styles['Normal'], fontName='PortalSans-Bold',
                            fontSize=8, leading=11, textColor=BLUE)
    out = BytesIO()
    doc = SimpleDocTemplate(out, pagesize=A4, leftMargin=17 * mm, rightMargin=17 * mm,
                            topMargin=39 * mm, bottomMargin=23 * mm,
                            title='Reporte de trabajo ' + str(quote.get('numero') or ''), author='SEPRIGUA')
    width = 176 * mm
    story = [Paragraph('EXPEDIENTE INTEGRAL', kicker),
             Paragraph('Reporte de trabajo', title),
             Paragraph('Cotización ' + pdf_text(quote.get('numero')) + ' · Generado ' +
                       datetime.now(GT).strftime('%d/%m/%Y · %I:%M %p') + ' (Guatemala)', small),
             Spacer(1, 6 * mm)]

    facts = [
        [('CLIENTE', quote.get('cliente')), ('COTIZACIÓN', quote.get('numero'))],
        [('ESTADO COTIZACIÓN', quote.get('estado')), ('ORDEN DE TRABAJO', order.get('numero') or 'Aún sin OT')],
        [('SERVICIO', order.get('servicio') or quote.get('nombre')), ('SEDE', order.get('sede') or 'Por definir')],
    ]
    rows = [[[Paragraph(pdf_text(label), small), Paragraph(pdf_text(value), strong)]
             for label, value in pair] for pair in facts]
    card = Table(rows, colWidths=[88 * mm, 88 * mm])
    card.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),PALE),
                              ('BOX',(0,0),(-1,-1),.7,BORDER),
                              ('INNERGRID',(0,0),(-1,-1),.4,BORDER),
                              ('LINEBEFORE',(0,0),(0,-1),3,RED),
                              ('VALIGN',(0,0),(-1,-1),'TOP'),
                              ('LEFTPADDING',(0,0),(-1,-1),9),('RIGHTPADDING',(0,0),(-1,-1),9),
                              ('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8)]))
    story += [card, Spacer(1, 7 * mm), section_header('Momentos clave', width, styles), Spacer(1, 3 * mm)]
    milestones = [('Solicitud registrada', order.get('solicitud_creada')),
                  ('OT registrada', order.get('creada')),
                  ('Llegada al sitio', (data.get('llegadas') or [{}])[0].get('fecha')),
                  ('Inicio de trabajo', order.get('iniciada')),
                  ('Finalización', order.get('finalizada'))]
    story += [data_table(['Evento', 'Fecha y hora'], [(name, _when(value)) for name, value in milestones],
                         [70 * mm, 106 * mm], styles), Spacer(1, 6 * mm)]

    story += [CondPageBreak(40 * mm), section_header('Documentos relacionados', width, styles), Spacer(1, 3 * mm)]
    references = [('Cotización actual', str(quote.get('numero') or '—'))]
    if order:
        references.append(('Reporte de la OT', str(order.get('numero') or '—')))
    for item in data.get('documentos', []):
        if item.get('categoria'):
            references.append((str(item.get('categoria') or 'Evidencia'), str(item.get('titulo') or '—')))
    if data.get('garantias'):
        references.append(('Revisión de garantía', f"{len(data['garantias'])} registro(s)"))
    story += [data_table(['Documento / evidencia', 'Referencia'], references,
                         [65 * mm, 111 * mm], styles),
              Paragraph('Los archivos originales se abren desde el expediente autorizado del portal.', small),
              Spacer(1, 7 * mm)]

    story += [CondPageBreak(42 * mm), section_header('Bitácora cronológica', width, styles), Spacer(1, 3 * mm)]
    events = data.get('eventos') or []
    if events:
        event_rows = [(_when(e.get('fecha')), e.get('titulo'),
                       (str(e.get('detalle') or '') +
                        ((' · ' + str(e['actor'])) if e.get('actor') else ''))[:650]) for e in events]
        story += [data_table(['Fecha y hora', 'Evento', 'Detalle / responsable'], event_rows,
                             [42 * mm, 53 * mm, 81 * mm], styles, font_size=7.2, row_padding=4),
                  Spacer(1, 7 * mm)]
    else:
        story += [Paragraph('Aún no hay eventos registrados.', body), Spacer(1, 7 * mm)]

    story += [CondPageBreak(43 * mm), section_header('Trabajo realizado', width, styles), Spacer(1, 3 * mm)]
    activities = data.get('actividades') or []
    if activities:
        story += [data_table(['Fecha y hora', 'Técnico', 'Actividad / resultado'],
                             [(_when(a.get('fecha')), a.get('tecnico'),
                               (str(a.get('descripcion') or '') +
                                ((' · ' + str(a['resultado'])) if a.get('resultado') else '')))
                              for a in activities], [42 * mm, 43 * mm, 91 * mm], styles,
                             font_size=7.7), Spacer(1, 7 * mm)]
    else:
        story += [Paragraph('Todavía no se han registrado actividades de ejecución.', body), Spacer(1, 7 * mm)]

    story += [CondPageBreak(37 * mm), section_header('Seguimiento de garantía', width, styles), Spacer(1, 3 * mm)]
    warranties = data.get('garantias') or []
    if warranties:
        story += [data_table(['Solicitada', 'Estado', 'Cobertura / atención'],
                             [(_when(w.get('reportada')), w.get('estado'),
                               ('Sin cobro · ' if w.get('sin_cobro') else '') +
                               str(w.get('descripcion') or '') +
                               ((' · OT de revisión #' + str(w['revision_orden_id']))
                                if w.get('revision_orden_id') else '')) for w in warranties],
                             [42 * mm, 43 * mm, 91 * mm], styles, font_size=7.7), Spacer(1, 7 * mm)]
    else:
        story += [Paragraph('No hay solicitudes de garantía vinculadas a esta OT.', body), Spacer(1, 7 * mm)]

    story += [CondPageBreak(90 * mm), section_header('Vista de la cotización actual', width, styles), Spacer(1, 3 * mm)]
    preview, size = _quote_image(data)
    story.append(Image(preview, width=width, height=width * size[1] / size[0]))
    story += [Spacer(1, 3 * mm),
              Paragraph('Esta vista se genera con la versión actual. El PDF original de la cotización '
                        'se descarga por separado desde el portal.', small), Spacer(1, 5 * mm)]
    if data.get('lineas'):
        story += [data_table(['Descripción', 'Cantidad', 'Precio', 'Total'],
                             [(l.get('descripcion'), l.get('cantidad'),
                               _money(l.get('precio'), version.get('moneda')),
                               _money(l.get('total'), version.get('moneda')))
                              for l in data['lineas']],
                             [92 * mm, 20 * mm, 31 * mm, 33 * mm], styles, font_size=7.6),
                  Spacer(1, 4 * mm)]
    story.append(Paragraph('Total cotizado: ' + pdf_text(_money(version.get('total'), version.get('moneda'))), strong))

    if order:
        if collage is not None:
            story += [PageBreak(), section_header('Collage fotográfico de la OT', width, styles),
                      Spacer(1, 3 * mm), Paragraph('Evidencias del trabajo organizadas por etapa.', small),
                      Spacer(1, 4 * mm)]
            for number, page in enumerate(_collage_pages(collage, width)):
                if number:
                    story += [PageBreak(), section_header('Collage de la OT · continuación', width, styles),
                              Spacer(1, 4 * mm)]
                story += [page, Spacer(1, 4 * mm)]
        else:
            story += [Spacer(1, 7 * mm), CondPageBreak(25 * mm),
                      section_header('Collage fotográfico de la OT', width, styles), Spacer(1, 3 * mm),
                      Paragraph('Todavía no hay fotografías de trabajo para generar el collage.', body)]

    if images:
        story += ([PageBreak()] if collage is not None else [Spacer(1, 8 * mm), CondPageBreak(55 * mm)])
        story += [section_header('OT firmada y constancias', width, styles), Spacer(1, 3 * mm)]
        for item in images:
            visual = _evidence_image(item)
            if visual is not None:
                story += [CondPageBreak(55 * mm), Paragraph(pdf_text(item.get('nombre')), strong),
                          Spacer(1, 2 * mm), visual, Spacer(1, 6 * mm)]
    elif order:
        story += [Spacer(1, 6 * mm), CondPageBreak(24 * mm),
                  section_header('OT firmada y constancias', width, styles), Spacer(1, 3 * mm),
                  Paragraph('Todavía no hay una imagen de la OT firmada cargada en el expediente.', body)]

    draw = lambda canvas, document: page_frame(canvas, document, 'Reporte de trabajo',
                                                str(quote.get('numero') or ''),
                                                note='Expediente de servicio · Hora de Guatemala')
    doc.build(story, onFirstPage=draw, onLaterPages=draw)
    out.seek(0)
    return out

