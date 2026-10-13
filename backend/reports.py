"""Reporte de OT sobre el expediente autorizado del portal."""
from io import BytesIO
from html import escape
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate,Paragraph,Spacer,Table,TableStyle
if __package__:from .pdf_styles import portal_styles
else:from pdf_styles import portal_styles

def build_order_report(data):
    out=BytesIO();item=data['item'];styles=portal_styles()
    body=ParagraphStyle('Body',parent=styles['BodyText'],fontSize=9,leading=13,spaceAfter=5)
    head=ParagraphStyle('Head',parent=body,textColor=colors.white,fontName='PortalSans-Bold')
    text=lambda value:escape(str(value if value not in (None,'') else '-'))
    paragraph=lambda value:Paragraph(text(value),body)
    doc=SimpleDocTemplate(out,pagesize=A4,leftMargin=17*mm,rightMargin=17*mm,topMargin=17*mm,bottomMargin=17*mm,title='Reporte '+str(item['numero']),author='SEPRIGUA')
    story=[Paragraph('SEPRIGUA',styles['Title']),Paragraph('Reporte de servicio · '+text(item['numero']),styles['Heading2'])]
    for label,key in [('Cliente','cliente'),('Sede','sede'),('Servicio','tipo'),('Estado','estado'),('Ticket','ticket'),('OT física','orden_papel'),('Solicitud','solicitud')]:story.append(Paragraph('<b>'+label+':</b> '+text(item.get(key)),body))
    def section(title,headers,rows,widths):
        story.extend([Spacer(1,5*mm),Paragraph(title,styles['Heading2'])])
        if not rows:story.append(paragraph('Sin registros.'));return
        cells=[[Paragraph(text(v),head) for v in headers]]+[[paragraph(v) for v in row] for row in rows]
        table=Table(cells,colWidths=[x*mm for x in widths],repeatRows=1)
        table.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#0B3C78')),('VALIGN',(0,0),(-1,-1),'TOP'),('GRID',(0,0),(-1,-1),.35,colors.HexColor('#D7E2F0')),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6)]));story.append(table)
    section('Cuadrilla',['Nombre','Función','Estado'],[[x.get('nombre'),x.get('funcion'),x.get('estado')] for x in data.get('tecnicos',[])],[80,48,48])
    section('Trabajo realizado',['Descripción','Resultado','Responsable'],[[x.get('Descripcion'),x.get('Resultado'),x.get('empleado')] for x in data.get('actividades',[])],[88,50,38])
    section('Evidencias',['Archivo','Tipo','Descripción'],[[x.get('nombre'),x.get('tipo'),x.get('Descripcion') or x.get('descripcion')] for x in data.get('evidencias',[])],[64,24,88])
    story.extend([Spacer(1,5*mm),paragraph('Los archivos originales se consultan desde el expediente autorizado del portal. La cotización comercial se administra por separado.')])
    def footer(canvas,document):
        canvas.saveState();canvas.setFont('PortalSans',8);canvas.drawRightString(A4[0]-17*mm,9*mm,f'Página {document.page}');canvas.restoreState()
    doc.build(story,onFirstPage=footer,onLaterPages=footer);out.seek(0);return out
