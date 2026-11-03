"""Fuentes embebidas para PDF consistentes en Windows y Linux."""
from pathlib import Path
import reportlab
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, Table, TableStyle
from html import escape

def portal_styles():
    folder=Path(reportlab.__file__).parent/'fonts'
    for name,file in {'PortalSans':'Vera.ttf','PortalSans-Bold':'VeraBd.ttf','PortalSans-Italic':'VeraIt.ttf','PortalSans-BoldItalic':'VeraBI.ttf'}.items():
        if name not in pdfmetrics.getRegisteredFontNames():pdfmetrics.registerFont(TTFont(name,str(folder/file)))
    pdfmetrics.registerFontFamily('PortalSans',normal='PortalSans',bold='PortalSans-Bold',italic='PortalSans-Italic',boldItalic='PortalSans-BoldItalic')
    styles=getSampleStyleSheet()
    for style in styles.byName.values():
        if hasattr(style,'fontName'):style.fontName='PortalSans-Bold' if 'Bold' in style.fontName else 'PortalSans'
    return styles


NAVY = colors.HexColor('#092F60')
BLUE = colors.HexColor('#176BAE')
RED = colors.HexColor('#E9234B')
INK = colors.HexColor('#15375B')
MUTED = colors.HexColor('#607A94')
PALE = colors.HexColor('#EFF5FA')
PALE_BLUE = colors.HexColor('#F7FAFD')
BORDER = colors.HexColor('#D7E3EE')


def pdf_text(value, empty='—'):
    """Escapa contenido del sistema antes de usarlo en un Paragraph."""
    return escape(str(value if value not in (None, '') else empty)).replace('\n', '<br/>')


def page_frame(canvas, document, document_type, reference='', note='Documento generado desde el portal SEPRIGUA'):
    """Encabezado y pie repetidos en todas las páginas."""
    canvas.saveState()
    width, height = document.pagesize
    left, right = document.leftMargin, width - document.rightMargin
    canvas.setFillColor(NAVY)
    canvas.rect(0, height - 5 * mm, width, 5 * mm, stroke=0, fill=1)
    canvas.setFillColor(RED)
    canvas.rect(0, height - 5 * mm, 29 * mm, 1.1 * mm, stroke=0, fill=1)
    logo = Path(__file__).resolve().parents[1] / 'assets' / 'img' / 'logo-seprigua-hd.png'
    if logo.is_file():
        canvas.drawImage(str(logo), left, height - 25.5 * mm,
                         width=39 * mm, height=18 * mm, preserveAspectRatio=True, anchor='c', mask='auto')
    else:
        canvas.setFillColor(NAVY)
        canvas.setFont('PortalSans-Bold', 14)
        canvas.drawString(left, height - 18 * mm, 'SEPRIGUA')
    canvas.setFillColor(MUTED)
    canvas.setFont('PortalSans-Bold', 8)
    canvas.drawRightString(right, height - 14 * mm, document_type.upper())
    if reference:
        canvas.setFillColor(INK)
        canvas.setFont('PortalSans', 8)
        canvas.drawRightString(right, height - 20 * mm, str(reference)[:55])
    canvas.setStrokeColor(BORDER)
    canvas.setLineWidth(.6)
    canvas.line(left, height - 30 * mm, right, height - 30 * mm)
    canvas.line(left, 17 * mm, right, 17 * mm)
    canvas.setFillColor(MUTED)
    canvas.setFont('PortalSans', 7)
    canvas.drawString(left, 11.5 * mm, note[:90])
    canvas.drawRightString(right, 11.5 * mm, f'Página {document.page}')
    canvas.restoreState()


def section_header(title, width, styles):
    style = ParagraphStyle('PdfSection', parent=styles['Normal'], fontName='PortalSans-Bold',
                           fontSize=10, leading=13, textColor=NAVY)
    table = Table([[Paragraph(pdf_text(title), style)]], colWidths=[width], hAlign='LEFT')
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), PALE),
        ('LINEBEFORE', (0, 0), (0, -1), 3, BLUE),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ('TOPPADDING', (0, 0), (-1, -1), 7),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
    ]))
    return table


def data_table(headers, rows, widths, styles, *, font_size=8, row_padding=6):
    """Tabla con cabecera repetida y filas alternas."""
    body = ParagraphStyle('PdfTableBody', parent=styles['Normal'], fontSize=font_size,
                          leading=font_size + 3.5, textColor=INK)
    head = ParagraphStyle('PdfTableHead', parent=body, fontName='PortalSans-Bold',
                          fontSize=font_size - .2, textColor=colors.white)
    matrix = [[Paragraph(pdf_text(value), head) for value in headers]]
    matrix += [[Paragraph(pdf_text(value), body) for value in row] for row in rows]
    table = Table(matrix, colWidths=widths, repeatRows=1, hAlign='LEFT')
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), NAVY),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, PALE_BLUE]),
        ('LINEBELOW', (0, 0), (-1, 0), 1.3, BLUE),
        ('LINEBELOW', (0, 1), (-1, -1), .35, BORDER),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 7),
        ('RIGHTPADDING', (0, 0), (-1, -1), 7),
        ('TOPPADDING', (0, 0), (-1, 0), 8),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 8),
        ('TOPPADDING', (0, 1), (-1, -1), row_padding),
        ('BOTTOMPADDING', (0, 1), (-1, -1), row_padding),
    ]))
    return table
