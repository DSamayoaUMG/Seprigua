"""Reporte mensual de fotografías para Wendy's y Little Caesars.

Se genera desde las OT reales. El archivo recibido como ejemplo contiene trabajos
históricos y por eso nunca se distribuye como plantilla de salida.
"""

from collections import defaultdict
from datetime import datetime
from io import BytesIO
from zoneinfo import ZoneInfo

from openpyxl import Workbook
from openpyxl.drawing.image import Image as ExcelImage
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from PIL import Image as PILImage, ImageOps


NAVY = "103B6C"
BLUE = "1976BA"
PALE = "EAF3FA"
MUTED = "637D95"
GOLD = "FFC000"


def _brand(row):
    text = " ".join(str(row.get(key) or "") for key in ("cliente", "sede")).lower()
    if "wendy" in text or "we-" in text:
        return "Wendy's"
    if "caesar" in text or "lc-" in text:
        return "Little Caesars"
    return "Coralsa"


def _photo_bytes(raw):
    try:
        with PILImage.open(BytesIO(raw)) as source:
            source = ImageOps.exif_transpose(source)
            source.thumbnail((1200, 850))
            if source.mode != "RGB":
                source = source.convert("RGB")
            out = BytesIO()
            source.save(out, format="JPEG", quality=78, optimize=True)
            out.seek(0)
            return out
    except (OSError, ValueError):
        return None


def _work_photos(b, order_id):
    rows = b.query_all("""
        SELECT TOP (4) e.Etapa AS etapa,e.NombreArchivo AS nombre,
               e.RutaArchivo AS ruta,a.Contenido AS contenido
        FROM srv.EvidenciaServicio e
        LEFT JOIN srv.ArchivoEvidencia a ON a.EvidenciaServicioId=e.EvidenciaServicioId
        WHERE e.OrdenTrabajoId=? AND e.Categoria='FOTO_TRABAJO'
          AND e.TipoMime IN ('image/jpeg','image/png','image/webp')
        ORDER BY CASE UPPER(COALESCE(e.Etapa,'')) WHEN 'ANTES' THEN 0
                 WHEN 'DURANTE' THEN 1 WHEN 'DESPUES' THEN 2 ELSE 3 END,
                 e.CreadoEn,e.EvidenciaServicioId
    """, (order_id,))
    photos = []
    for row in rows:
        raw = bytes(row['contenido']) if row.get('contenido') is not None else None
        if raw is None:
            path = b.resolve_evidence_path(row.get('ruta'))
            if path and path.is_file() and path.stat().st_size <= 10 * 1024 * 1024:
                raw = path.read_bytes()
        if raw and len(raw) <= 10 * 1024 * 1024:
            converted = _photo_bytes(raw)
            if converted:
                photos.append((str(row.get('etapa') or 'TRABAJO').upper(), converted))
    return photos


def _orders(b, year, month):
    start = datetime(year, month, 1)
    end = datetime(year + (month == 12), month % 12 + 1, 1)
    rows = b.query_all("""
        SELECT TOP (251) o.OrdenTrabajoId AS id,o.NumeroOrden AS numero,
               o.NumeroOrdenPapel AS numero_papel,o.NumeroTicketCliente AS ticket,
               o.CreadoEn AS creada,o.FinalizadaEn AS finalizada,
               c.NombreComercial AS cliente,
               COALESCE(sc.Nombre,u.NombreReferencia,N'Sin sede') AS sede,
               ts.Nombre AS servicio,eo.Nombre AS estado
        FROM srv.OrdenTrabajo o
        JOIN srv.SolicitudServicio s ON s.SolicitudServicioId=o.SolicitudServicioId
        JOIN crm.Cliente c ON c.ClienteId=s.ClienteId
        JOIN srv.TipoServicio ts ON ts.TipoServicioId=s.TipoServicioId
        JOIN srv.EstadoOrdenTrabajo eo ON eo.EstadoOrdenTrabajoId=o.EstadoOrdenTrabajoId
        LEFT JOIN crm.UbicacionServicio u ON u.UbicacionServicioId=s.UbicacionServicioId
        LEFT JOIN crm.SucursalCliente sc ON sc.SucursalClienteId=u.SucursalClienteId
        WHERE (LOWER(c.NombreComercial) LIKE '%wendy%'
            OR LOWER(c.NombreComercial) LIKE '%caesar%'
            OR LOWER(COALESCE(sc.Nombre,'')) LIKE '%wendy%'
            OR LOWER(COALESCE(sc.Nombre,'')) LIKE '%caesar%'
            OR LOWER(COALESCE(sc.Nombre,'')) LIKE 'lc-%'
            OR LOWER(COALESCE(sc.Nombre,'')) LIKE 'we-%'
            OR LOWER(COALESCE(u.NombreReferencia,'')) LIKE '%wendy%'
            OR LOWER(COALESCE(u.NombreReferencia,'')) LIKE '%caesar%'
            OR LOWER(COALESCE(u.NombreReferencia,'')) LIKE 'lc-%'
            OR LOWER(COALESCE(u.NombreReferencia,'')) LIKE 'we-%')
          AND COALESCE(o.FinalizadaEn,o.IniciadaEn,o.CreadoEn)>=?
          AND COALESCE(o.FinalizadaEn,o.IniciadaEn,o.CreadoEn)<?
        ORDER BY COALESCE(o.FinalizadaEn,o.IniciadaEn,o.CreadoEn),o.OrdenTrabajoId
    """, (start, end))
    if len(rows) > 250:
        raise ValueError('El mes tiene más de 250 órdenes; dividí la entrega por período.')
    return rows


def _activities(b, order_id):
    rows = b.query_all("""SELECT Descripcion AS descripcion,Resultado AS resultado
        FROM srv.ActividadServicio WHERE OrdenTrabajoId=? ORDER BY NumeroSecuencia""",
                       (order_id,))
    return '\n'.join(f"{index}. {str(row.get('descripcion') or '').strip()}" +
                     (f" — {str(row['resultado']).strip()}" if row.get('resultado') else '')
                     for index, row in enumerate(rows, 1)) or 'Sin actividades registradas'


def _make_page(ws, order, photos, index):
    ws.sheet_view.showGridLines = False
    for col in range(1, 14):
        ws.column_dimensions[get_column_letter(col)].width = 10.5
    ws.column_dimensions['A'].width = 3
    ws.column_dimensions['F'].width = 3
    ws.column_dimensions['K'].width = 3
    for row in range(1, 56):
        ws.row_dimensions[row].height = 19
    ws.merge_cells('A2:M2')
    ws['A2'] = 'Departamento de mantenimiento'
    ws['A2'].fill = PatternFill('solid', fgColor=GOLD)
    ws['A2'].font = Font(name='Aptos', bold=True, size=11, color=NAVY)
    ws['A2'].alignment = Alignment(horizontal='center', vertical='center')
    ws.merge_cells('A3:M3')
    ws['A3'] = 'REPORTE DE TRABAJO PARA EMERGENCIAS Y CORRECTIVOS'
    ws['A3'].fill = PatternFill('solid', fgColor=NAVY)
    ws['A3'].font = Font(name='Aptos', bold=True, size=12, color='FFFFFF')
    ws['A3'].alignment = Alignment(horizontal='center', vertical='center')
    ws.row_dimensions[3].height = 27
    ws['B5'], ws['B7'], ws['B9'] = 'MARCA:', 'UNIDAD:', 'REPORTE:'
    for cell in ('B5', 'B7', 'B9'):
        ws[cell].font = Font(name='Aptos', bold=True, color=NAVY)
    ws.merge_cells('D5:J5')
    ws.merge_cells('D7:M7')
    ws.merge_cells('D9:J9')
    ws['D5'] = _brand(order)
    ws['D7'] = order.get('sede') or 'Sin sede'
    ws['D9'] = str(order.get('numero_papel') or order.get('ticket') or order.get('numero') or '')
    ws['K9'] = 'OT: ' + str(order.get('numero') or '')
    for cell in ('D5', 'D7', 'D9', 'K9'):
        ws[cell].font = Font(name='Aptos', size=10, color=NAVY)
    ws.merge_cells('B11:M11')
    ws['B11'] = 'Constancia de trabajo · ' + str(order.get('servicio') or 'Servicio')
    ws['B11'].font = Font(name='Aptos', bold=True, color=NAVY, size=11)
    ws['B12'] = 'Estado: ' + str(order.get('estado') or '')
    when = order.get('finalizada') or order.get('creada')
    ws['G12'] = 'Fecha: ' + (when.strftime('%d/%m/%Y') if isinstance(when, datetime) else '')
    slots = [('B14:E27', 'B15'), ('G14:J27', 'G15'),
             ('B30:E43', 'B31'), ('G30:J43', 'G31')]
    edge = Side(style='thin', color='C9DDEB')
    for position, (bounds, anchor) in enumerate(slots):
        ws.merge_cells(bounds)
        cell = ws[bounds.split(':')[0]]
        cell.fill = PatternFill('solid', fgColor='F6FAFD')
        cell.border = Border(left=edge, right=edge, top=edge, bottom=edge)
        cell.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
        cell.font = Font(name='Aptos', color=MUTED, size=10)
        if position < len(photos):
            stage, raw = photos[position]
            cell.value = ''
            image = ExcelImage(raw)
            image.width = 320
            image.height = 220
            ws.add_image(image, anchor)
            ws.cell(28 if position < 2 else 44, 2 if position % 2 == 0 else 7,
                    'ANTES' if stage == 'ANTES' else 'DESPUÉS' if stage == 'DESPUES' else stage)
        else:
            cell.value = 'Sin fotografía registrada'
    ws.merge_cells('B47:M48')
    ws['B47'] = ('Trabajo: ' + str(order.get('actividades') or 'Sin actividades registradas')[:380])
    ws['B47'].alignment = Alignment(wrap_text=True, vertical='top')
    ws['B47'].font = Font(name='Aptos', size=10, color=NAVY)
    ws.merge_cells('B51:M51')
    ws['B51'] = 'Reporte generado desde las OT de SEPRIGUA. La OT física original se entrega por separado.'
    ws['B51'].font = Font(name='Aptos', italic=True, size=9, color=MUTED)
    ws.print_area = 'A1:M52'
    ws.page_setup.orientation = 'portrait'
    ws.page_setup.fitToWidth = 1
    ws.sheet_properties.pageSetUpPr.fitToPage = True


def build_monthly_coralsa_report(b, year, month):
    orders = _orders(b, year, month)
    wb = Workbook()
    summary = wb.active
    summary.title = 'RESUMEN'
    summary.sheet_view.showGridLines = False
    summary.append(['CORALSA · REPORTE MENSUAL DE TRABAJOS'])
    summary.append([f'Período: {month:02d}/{year}'])
    summary.append(['Generado: ' + datetime.now(ZoneInfo('America/Guatemala')).strftime('%d/%m/%Y %H:%M')])
    summary.append([])
    summary.append(['N.º', 'Marca', 'Unidad / sede', 'Reporte', 'OT', 'Servicio', 'Estado', 'Fecha', 'Fotos', 'Trabajos realizados'])
    for cell in summary[5]:
        cell.fill = PatternFill('solid', fgColor=NAVY)
        cell.font = Font(name='Aptos', bold=True, color='FFFFFF')
    for col, width in {'A': 7, 'B': 20, 'C': 42, 'D': 18, 'E': 24,
                       'F': 38, 'G': 20, 'H': 17, 'I': 9, 'J': 85}.items():
        summary.column_dimensions[col].width = width
    summary.freeze_panes = 'A6'
    for index, order in enumerate(orders, 1):
        order['actividades'] = _activities(b, int(order['id']))
        photos = _work_photos(b, int(order['id']))
        when = order.get('finalizada') or order.get('creada')
        summary.append([index, _brand(order), order.get('sede'),
                        str(order.get('numero_papel') or order.get('ticket') or ''),
                        order.get('numero'), order.get('servicio'), order.get('estado'),
                        when.strftime('%d/%m/%Y') if isinstance(when, datetime) else '',
                        len(photos), order['actividades']])
        summary.cell(5 + index, 10).alignment = Alignment(wrap_text=True, vertical='top')
        summary.row_dimensions[5 + index].height = min(90, 28 + 14 * order['actividades'].count('\n'))
        title = f'FOTOS {index:03d}'
        _make_page(wb.create_sheet(title), order, photos, index)
    if not orders:
        summary.append(['No hay trabajos Wendy\'s / Little Caesars registrados en este mes.'])
    summary.auto_filter.ref = f'A5:J{max(6, 5 + len(orders))}'
    output = BytesIO()
    wb.save(output)
    output.seek(0)
    return output, len(orders)
