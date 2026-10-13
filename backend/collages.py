"""Generación dinámica del collage fotográfico de una Orden de Trabajo.

No crea tablas ni duplica archivos: usa las fotografías que ya están vinculadas a
srv.EvidenciaServicio / srv.ArchivoEvidencia y genera un JPEG al momento de la descarga.
"""
from __future__ import annotations

import io
import os
from pathlib import Path
from typing import Callable, Iterable

from PIL import Image, ImageDraw, ImageFont, ImageOps, UnidentifiedImageError

NAVY = "#0B3C78"
BLUE = "#1769C2"
RED = "#E9234B"
INK = "#17324D"
MUTED = "#64748B"
LINE = "#D9E4F2"
LIGHT = "#F4F8FC"
WHITE = "#FFFFFF"

STAGE_ORDER = {"ANTES": 0, "DURANTE": 1, "DESPUES": 2, "DESPUÉS": 2, "OTRO": 3, "": 3}
STAGE_LABEL = {"ANTES": "ANTES", "DURANTE": "DURANTE", "DESPUES": "DESPUÉS", "DESPUÉS": "DESPUÉS", "OTRO": "OTRAS EVIDENCIAS", "": "OTRAS EVIDENCIAS"}


def _font(size: int, bold: bool = False):
    candidates = []
    if os.name == "nt":
        candidates += [
            r"C:\Windows\Fonts\arialbd.ttf" if bold else r"C:\Windows\Fonts\arial.ttf",
            r"C:\Windows\Fonts\segoeuib.ttf" if bold else r"C:\Windows\Fonts\segoeui.ttf",
        ]
    else:
        candidates += [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
        ]
    for path in candidates:
        try:
            if Path(path).is_file():
                return ImageFont.truetype(path, size=size)
        except OSError:
            pass
    return ImageFont.load_default()


def _txt(value, fallback="—") -> str:
    value = str(value or "").strip()
    return value or fallback


def _stage(row: dict) -> str:
    value = str(row.get("Etapa") or row.get("etapa") or "").strip().upper()
    if value == "DESPUÉS":
        value = "DESPUES"
    return value if value in {"ANTES", "DURANTE", "DESPUES"} else "OTRO"


def _image_bytes(row: dict, legacy_resolver: Callable[[str | None], Path | None] | None = None) -> bytes | None:
    raw = row.get("Contenido") if "Contenido" in row else row.get("contenido")
    if raw is not None:
        data = bytes(raw)
        if data:
            return data
    if legacy_resolver:
        try:
            path = legacy_resolver(row.get("RutaArchivo") or row.get("ruta_archivo"))
            if path and path.is_file():
                return path.read_bytes()
        except (OSError, ValueError):
            return None
    return None


def _prepare_photo(data: bytes, target: tuple[int, int]) -> Image.Image | None:
    try:
        with Image.open(io.BytesIO(data)) as source:
            image = ImageOps.exif_transpose(source)
            image.load()
            if image.mode != "RGB":
                background = Image.new("RGB", image.size, WHITE)
                if "A" in image.getbands():
                    background.paste(image, mask=image.getchannel("A"))
                    image = background
                else:
                    image = image.convert("RGB")
            return ImageOps.fit(image, target, method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        return None


def _truncate(draw: ImageDraw.ImageDraw, text: str, font, max_width: int) -> str:
    text = " ".join(str(text or "").split())
    if not text:
        return ""
    if draw.textbbox((0, 0), text, font=font)[2] <= max_width:
        return text
    suffix = "…"
    lo, hi = 0, len(text)
    while lo < hi:
        mid = (lo + hi + 1) // 2
        candidate = text[:mid].rstrip() + suffix
        if draw.textbbox((0, 0), candidate, font=font)[2] <= max_width:
            lo = mid
        else:
            hi = mid - 1
    return text[:lo].rstrip() + suffix


def build_order_collage(rows: Iterable[dict], order: dict, legacy_resolver=None) -> io.BytesIO:
    """Devuelve un JPEG vertical listo para visualizar o descargar."""
    source_rows = [dict(r) for r in rows]
    if not source_rows:
        raise ValueError("La orden todavía no tiene fotografías para generar el collage.")

    # Si existe selección explícita, respétala. En órdenes antiguas sin selección,
    # usa todas las FOTO_TRABAJO disponibles para no dejar el collage vacío.
    selected = [r for r in source_rows if bool(r.get("IncluirEnCollage") if "IncluirEnCollage" in r else r.get("incluir_en_collage"))]
    use_rows = selected or source_rows
    use_rows.sort(key=lambda r: (
        STAGE_ORDER.get(_stage(r), 3),
        int(r.get("OrdenCollage") or r.get("orden_collage") or 32767),
        int(r.get("EvidenciaServicioId") or r.get("id") or 0),
    ))

    max_photos = max(4, min(60, int(os.getenv("COLLAGE_MAX_PHOTOS", "30"))))
    omitted = max(0, len(use_rows) - max_photos)
    use_rows = use_rows[:max_photos]

    photos = []
    for row in use_rows:
        data = _image_bytes(row, legacy_resolver)
        if not data:
            continue
        image = _prepare_photo(data, (690, 430))
        if image is not None:
            photos.append((row, image))
    if not photos:
        raise ValueError("Las fotografías del collage no tienen contenido disponible.")

    grouped = []
    for key in ("ANTES", "DURANTE", "DESPUES", "OTRO"):
        items = [(r, im) for r, im in photos if _stage(r) == key]
        if items:
            grouped.append((key, items))

    width = 1600
    margin = 70
    gap = 34
    cell_w = 713
    photo_h = 430
    caption_h = 92
    card_h = photo_h + caption_h
    header_h = 300
    stage_h = 82
    footer_h = 105

    content_h = header_h
    for _key, items in grouped:
        rows_count = (len(items) + 1) // 2
        content_h += stage_h + rows_count * card_h + max(0, rows_count - 1) * gap + 36
    content_h += footer_h

    canvas = Image.new("RGB", (width, content_h), WHITE)
    draw = ImageDraw.Draw(canvas)
    f_title = _font(46, True)
    f_sub = _font(24, False)
    f_meta = _font(22, True)
    f_stage = _font(28, True)
    f_caption = _font(20, True)
    f_small = _font(18, False)
    f_footer = _font(17, False)

    draw.rectangle((0, 0, width, 16), fill=RED)
    draw.text((margin, 52), "SEPRIGUA", fill=NAVY, font=f_title)
    draw.text((margin, 112), "COLLAGE DE EVIDENCIAS DEL SERVICIO", fill=INK, font=f_sub)

    number = _txt(order.get("numero") or order.get("NumeroOrden") or order.get("numero_orden"), "OT")
    client = _txt(order.get("cliente"), "Cliente no especificado")
    service = _txt(order.get("tipo"), "Servicio")
    site = _txt(order.get("sede"), "")
    meta_left = f"{number}  ·  {client}"
    meta_right = service + (f"  ·  {site}" if site not in {"", "—"} else "")
    draw.rounded_rectangle((margin, 178, width - margin, 260), radius=18, fill=LIGHT, outline=LINE, width=2)
    draw.text((margin + 24, 196), _truncate(draw, meta_left, f_meta, 680), fill=NAVY, font=f_meta)
    right_text = _truncate(draw, meta_right, f_small, 650)
    bbox = draw.textbbox((0, 0), right_text, font=f_small)
    draw.text((width - margin - 24 - (bbox[2] - bbox[0]), 202), right_text, fill=MUTED, font=f_small)

    y = header_h
    global_index = 1
    for stage, items in grouped:
        label = STAGE_LABEL.get(stage, stage)
        draw.rounded_rectangle((margin, y, width - margin, y + 58), radius=16, fill=NAVY)
        draw.text((margin + 22, y + 12), label, fill=WHITE, font=f_stage)
        stage_count = f"{len(items)} fotografía{'s' if len(items) != 1 else ''}"
        box = draw.textbbox((0, 0), stage_count, font=f_small)
        draw.text((width - margin - 22 - (box[2] - box[0]), y + 18), stage_count, fill=WHITE, font=f_small)
        y += stage_h

        for index in range(0, len(items), 2):
            pair = items[index:index + 2]
            for col, (row, photo) in enumerate(pair):
                x = margin + col * (cell_w + gap)
                draw.rounded_rectangle((x, y, x + cell_w, y + card_h), radius=20, fill=WHITE, outline=LINE, width=2)
                # La foto deja 11 px internos para que el borde permanezca visible.
                fitted = photo.resize((cell_w - 22, photo_h - 16), Image.Resampling.LANCZOS)
                canvas.paste(fitted, (x + 11, y + 8))
                cap_y = y + photo_h
                draw.rectangle((x + 2, cap_y, x + cell_w - 2, y + card_h - 2), fill=LIGHT)
                desc = _truncate(draw, row.get("Descripcion") or row.get("descripcion") or f"Evidencia {global_index}", f_caption, cell_w - 40)
                draw.text((x + 18, cap_y + 13), desc, fill=INK, font=f_caption)
                name = _truncate(draw, row.get("NombreArchivo") or row.get("nombre") or "Fotografía", f_small, cell_w - 40)
                draw.text((x + 18, cap_y + 51), name, fill=MUTED, font=f_small)
                global_index += 1
            y += card_h + gap
        y += 2

    footer_y = content_h - footer_h
    draw.line((margin, footer_y + 8, width - margin, footer_y + 8), fill=LINE, width=2)
    footer = "Collage generado automáticamente desde el expediente de la OT. Las fotografías originales permanecen en el sistema."
    draw.text((margin, footer_y + 31), _truncate(draw, footer, f_footer, width - margin * 2), fill=MUTED, font=f_footer)
    if omitted:
        note = f"Se muestran {len(photos)} fotografías. {omitted} adicionales no se incluyeron por el límite de COLLAGE_MAX_PHOTOS."
        draw.text((margin, footer_y + 61), _truncate(draw, note, f_footer, width - margin * 2), fill=RED, font=f_footer)

    output = io.BytesIO()
    canvas.save(output, format="JPEG", quality=90, optimize=True, progressive=True, dpi=(150, 150))
    output.seek(0)
    return output
