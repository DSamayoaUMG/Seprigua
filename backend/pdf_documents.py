"""Fichas administrativas y cotizaciones con diseño del portal."""
from datetime import datetime
from decimal import Decimal
from io import BytesIO
from zoneinfo import ZoneInfo

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import CondPageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

if __package__:
    from .pdf_styles import (BORDER, BLUE, INK, MUTED, NAVY, PALE, PALE_BLUE, RED,
                             data_table, page_frame, pdf_text, portal_styles, section_header)
else:
    from pdf_styles import (BORDER, BLUE, INK, MUTED, NAVY, PALE, PALE_BLUE, RED,
                            data_table, page_frame, pdf_text, portal_styles, section_header)


def _date(value):
    if value in (None, ''):
        return '—'
    if isinstance(value, datetime):
        return value.strftime('%d/%m/%Y')
    if hasattr(value, 'strftime'):
        return value.strftime('%d/%m/%Y')
    return str(value)


def _money(value, currency='GTQ'):
    try:
        amount = Decimal(str(value or 0))
    except Exception:
        amount = Decimal(0)
    prefix = 'Q' if str(currency or 'GTQ').upper() == 'GTQ' else str(currency or '')
    return f'{prefix} {amount:,.2f}'.strip()


def _meta_card(label, value, caption_style, value_style):
    shown = pdf_text(value) if value not in (None, '') else '&#160;'
    return [Paragraph(pdf_text(label), caption_style), Paragraph(shown, value_style)]


def build_user_report(item):
    out = BytesIO()
    styles = portal_styles()
    width = 176 * mm
    doc = SimpleDocTemplate(out, pagesize=A4, leftMargin=17 * mm, rightMargin=17 * mm,
                            topMargin=39 * mm, bottomMargin=23 * mm,
                            title=f"Ficha de usuario {item.get('usuario') or ''}", author='SEPRIGUA')
    kicker = ParagraphStyle('UserKicker', parent=styles['Normal'], fontName='PortalSans-Bold',
                            fontSize=8, leading=11, textColor=BLUE, spaceAfter=4)
    title = ParagraphStyle('UserTitle', parent=styles['Title'], fontName='PortalSans-Bold',
                           fontSize=19, leading=23, textColor=NAVY, alignment=0, spaceAfter=4)
    small = ParagraphStyle('UserSmall', parent=styles['Normal'], fontSize=8,
                           leading=12, textColor=MUTED)
    hero_name = ParagraphStyle('UserHeroName', parent=styles['Normal'], fontName='PortalSans-Bold',
                               fontSize=14, leading=18, textColor=NAVY)
    hero_user = ParagraphStyle('UserHeroAccount', parent=styles['Normal'], fontSize=8,
                               leading=12, textColor=MUTED)
    state = 'Bloqueado' if item.get('bloqueado') else 'Activo' if item.get('activo') else 'Inactivo'
    stamp = datetime.now(ZoneInfo('America/Guatemala')).strftime('%d/%m/%Y %H:%M')
    story = [
        Paragraph('ADMINISTRACIÓN DE ACCESOS', kicker),
        Paragraph('Ficha de usuario', title),
        Paragraph(f'Generada el {stamp} · Uso interno de Coordinación', small),
        Spacer(1, 7 * mm),
    ]
    hero = Table([[
        [Paragraph(pdf_text(item.get('nombre')), hero_name),
         Paragraph('Usuario: ' + pdf_text(item.get('usuario')), hero_user)],
        Paragraph(pdf_text(state).upper(), ParagraphStyle('UserStatus', parent=styles['Normal'],
                  fontName='PortalSans-Bold', fontSize=9, textColor=NAVY, alignment=TA_RIGHT)),
    ]], colWidths=[124 * mm, 52 * mm])
    hero.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), PALE),
        ('BOX', (0, 0), (-1, -1), .7, BORDER),
        ('LINEBEFORE', (0, 0), (0, -1), 3, RED),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 12),
        ('RIGHTPADDING', (0, 0), (-1, -1), 12),
        ('TOPPADDING', (0, 0), (-1, -1), 12),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 12),
    ]))
    story += [hero, Spacer(1, 8 * mm)]
    groups = [
        ('Identidad y acceso', [
            ('Nombre', item.get('nombre')), ('Usuario', item.get('usuario')),
            ('Correo de acceso', item.get('correo')), ('Rol', item.get('rol')),
            ('Tipo de cuenta', item.get('tipo_cuenta')), ('Estado', state),
        ]),
        ('Vinculación', [
            ('Empresa cliente', item.get('cliente')),
            ('Código de empleado', item.get('codigo_empleado')),
            ('Puesto', item.get('puesto')),
        ]),
        ('Actividad y seguridad', [
            ('Fecha de registro', _date(item.get('creado_en'))),
            ('Último acceso', _date(item.get('ultimo_acceso'))),
            ('Intentos fallidos', item.get('intentos_fallidos')),
            ('Cambio de contraseña', 'Pendiente' if item.get('requiere_cambio_contrasena') else 'Al día'),
        ]),
    ]
    for name, rows in groups:
        story.extend([CondPageBreak(31 * mm), section_header(name, width, styles), Spacer(1, 3 * mm),
                      data_table(['Campo', 'Información'], rows, [59 * mm, 117 * mm], styles,
                                 font_size=8.2, row_padding=4),
                      Spacer(1, 5 * mm)])
    story.append(Paragraph('Esta ficha no incluye contraseñas ni códigos de recuperación.', small))
    draw = lambda canvas, document: page_frame(canvas, document, 'Ficha de usuario',
                                                str(item.get('usuario') or ''),
                                                note='Información administrativa · Uso interno')
    doc.build(story, onFirstPage=draw, onLaterPages=draw)
    out.seek(0)
    return out


def build_quote_pdf(item, details):
    out = BytesIO()
    styles = portal_styles()
    number = str(item.get('numero_cotizacion') or 'Sin número')
    doc = SimpleDocTemplate(out, pagesize=A4, leftMargin=13 * mm, rightMargin=13 * mm,
                            topMargin=31 * mm, bottomMargin=18 * mm,
                            title=f'Cotización {number}', author='SEPRIGUA - Corporación Turam, S.A.')
    kicker = ParagraphStyle('QuoteKicker', parent=styles['Normal'], fontName='PortalSans-Bold',
                            fontSize=8, leading=10, textColor=BLUE, spaceAfter=2)
    title = ParagraphStyle('QuoteTitle', parent=styles['Title'], fontName='PortalSans-Bold',
                           fontSize=16, leading=19, textColor=NAVY, alignment=0, spaceAfter=2)
    subtitle = ParagraphStyle('QuoteSubtitle', parent=styles['Normal'], fontSize=8.5,
                              leading=10.5, textColor=MUTED)
    label = ParagraphStyle('QuoteLabel', parent=styles['Normal'], fontName='PortalSans-Bold',
                           fontSize=7, leading=10, textColor=MUTED)
    value = ParagraphStyle('QuoteValue', parent=styles['Normal'], fontName='PortalSans-Bold',
                           fontSize=8.5, leading=10.5, textColor=INK)
    body = ParagraphStyle('QuoteBody', parent=styles['Normal'], fontSize=8,
                          leading=10.5, textColor=INK)
    head = ParagraphStyle('QuoteHead', parent=body, fontName='PortalSans-Bold',
                          textColor=colors.white)
    right = ParagraphStyle('QuoteRight', parent=body, alignment=TA_RIGHT)
    total_right = ParagraphStyle('QuoteTotalRight', parent=right, fontName='PortalSans-Bold',
                                 fontSize=11, leading=14, textColor=colors.white)
    total_left = ParagraphStyle('QuoteTotalLeft', parent=body, fontName='PortalSans-Bold',
                                fontSize=10, leading=14, textColor=colors.white)

    version = item.get('numero_version')
    version_label = f' · Versión {pdf_text(version)}' if version not in (None, '') else ''
    story = [
        Paragraph('PROPUESTA COMERCIAL', kicker),
        Paragraph(pdf_text(item.get('nombre_cotizacion') or 'Cotización'), title),
        Paragraph(f'Número {pdf_text(number)}{version_label} · Estado: {pdf_text(item.get("cotizacion_estado"))}', subtitle),
        Spacer(1, 3 * mm),
    ]
    guest = bool(item.get('prospecto_nombre'))
    meta_values = [
        ('CLIENTE', item.get('cliente')),
        ('SEDE / UBICACIÓN', item.get('sede')),
        ('OT DEL SISTEMA', item.get('numero_orden')),
        ('REFERENCIA FÍSICA (OT U OC)', item.get('numero_orden_papel')),
        ('EMISIÓN', _date(item.get('fecha_emision'))),
        ('VENCIMIENTO', _date(item.get('fecha_expiracion'))),
    ]
    meta_rows = [
        [_meta_card(name, content, label, value) for name, content in meta_values[0:3]],
        [_meta_card(name, content, label, value) for name, content in meta_values[3:6]],
    ]
    if guest:
        meta_rows.append([
            _meta_card('CORREO DE CONTACTO', item.get('prospecto_correo'), label, value),
            '',
            _meta_card('TELÉFONO', item.get('prospecto_telefono'), label, value),
        ])
    metadata = Table(meta_rows, colWidths=[61 * mm, 75 * mm, 48 * mm], hAlign='LEFT')
    metadata.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), PALE),
        ('BOX', (0, 0), (-1, -1), .7, BORDER),
        ('INNERGRID', (0, 0), (-1, -1), .4, BORDER),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 9),
        ('RIGHTPADDING', (0, 0), (-1, -1), 9),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]))
    if guest:
        metadata.setStyle(TableStyle([('SPAN', (0, 2), (1, 2))]))
    story += [metadata, Spacer(1, 3 * mm)]

    matrix = [[Paragraph(pdf_text(name), head) for name in
               ('#', 'Descripción', 'Cant.', 'Tipo', 'Precio unit.', 'Total')]]
    for line in details:
        description = pdf_text(line.get('descripcion'))
        adjustments = []
        discount = Decimal(str(line.get('descuento') or 0))
        tax_rate = Decimal(str(line.get('porcentaje_impuesto') or 0))
        if discount:
            adjustments.append(f"Descuento: {_money(discount, item.get('moneda'))}")
        if tax_rate:
            adjustments.append(f'Impuesto: {tax_rate:f}%')
        if adjustments:
            description += f"<br/><font color='#607A94' size='7'>{pdf_text(' · '.join(adjustments))}</font>"
        if line.get('observaciones'):
            description += f"<br/><font color='#607A94' size='7'>{pdf_text(line['observaciones'])}</font>"
        matrix.append([
            Paragraph(pdf_text(line.get('numero_linea')), body), Paragraph(description, body),
            Paragraph(pdf_text(line.get('cantidad')), body),
            Paragraph('Bien' if str(line.get('tipo_articulo') or '').upper() == 'BIEN' else 'Servicio', body),
            Paragraph(pdf_text(_money(line.get('precio_unitario'), item.get('moneda'))), right),
            Paragraph(pdf_text(_money(line.get('total_linea'), item.get('moneda'))), right),
        ])
    if len(matrix) == 1:
        matrix.append([Paragraph('—', body), Paragraph('Sin líneas registradas.', body),
                       Paragraph('—', body), Paragraph('—', body), Paragraph('—', body), Paragraph('—', body)])
    lines = Table(matrix, colWidths=[9 * mm, 87 * mm, 17 * mm, 17 * mm, 26 * mm, 28 * mm],
                  repeatRows=1, splitInRow=1, hAlign='LEFT')
    lines.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), NAVY),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, PALE_BLUE]),
        ('LINEBELOW', (0, 0), (-1, 0), 1.3, BLUE),
        ('LINEBELOW', (0, 1), (-1, -1), .35, BORDER),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
    ]))
    payment = _meta_card('FORMA DE PAGO', item.get('condicion_pago'), label, value)
    payment += [
        Spacer(1, 2 * mm),
        Paragraph('Documento generado desde el portal privado de SEPRIGUA. '
                  'No constituye un comprobante de pago.', subtitle),
    ]
    currency = item.get('moneda')
    totals = Table([
        [payment, Paragraph('Subtotal', body), Paragraph(pdf_text(_money(item.get('subtotal'), currency)), right)],
        ['', Paragraph('Descuento', body), Paragraph(pdf_text(_money(item.get('descuento_total'), currency)), right)],
        ['', Paragraph('Impuesto', body), Paragraph(pdf_text(_money(item.get('impuesto_total'), currency)), right)],
        ['', Paragraph('TOTAL', total_left), Paragraph(pdf_text(_money(item.get('total'), currency)), total_right)],
    ], colWidths=[106 * mm, 36 * mm, 42 * mm], splitByRow=0, hAlign='LEFT')
    totals.setStyle(TableStyle([
        ('SPAN', (0, 0), (0, 3)),
        ('BACKGROUND', (0, 0), (-1, -1), PALE),
        ('BACKGROUND', (1, 3), (-1, 3), NAVY),
        ('LINEABOVE', (1, 3), (-1, 3), 1.2, RED),
        ('LINEBEFORE', (1, 0), (1, -1), .6, BORDER),
        ('BOX', (0, 0), (-1, -1), .6, BORDER),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('TOPPADDING', (0, 0), (0, 0), 6),
    ]))
    story += [lines, Spacer(1, 3 * mm), totals]
    draw = lambda canvas, document: page_frame(canvas, document, 'Cotización', number,
                                                note='Propuesta comercial · Corporación Turam, S.A.')
    doc.build(story, onFirstPage=draw, onLaterPages=draw)
    out.seek(0)
    return out
