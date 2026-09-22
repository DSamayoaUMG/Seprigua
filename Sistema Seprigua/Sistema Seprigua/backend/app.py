from __future__ import annotations

import base64
import hashlib
import io
import hmac
import html
import json
import os
import re
import secrets
import smtplib
import ssl
import time
from email.message import EmailMessage
from email.utils import formataddr
from threading import Lock, Thread
from datetime import datetime, timedelta, date, timezone
from contextlib import contextmanager
from decimal import Decimal
from zoneinfo import ZoneInfo
from urllib.parse import urlencode, urlsplit
from urllib.request import Request as UrlRequest, urlopen
from functools import wraps
from pathlib import Path

import pyodbc
from argon2.low_level import Type, hash_secret_raw
from dotenv import load_dotenv
from flask.json.provider import DefaultJSONProvider
from werkzeug.exceptions import HTTPException, Forbidden, NotFound, Conflict
from flask import g, Flask, jsonify, make_response, request, send_file, send_from_directory
from werkzeug.utils import secure_filename

try:
    from PIL import Image, ImageOps
    PILLOW_AVAILABLE = True
except Exception:
    PILLOW_AVAILABLE = False

try:
    from reportlab.lib import colors as rl_colors
    from reportlab.lib.enums import TA_RIGHT
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table as RLTable, TableStyle
    REPORTLAB_AVAILABLE = True
except Exception:
    REPORTLAB_AVAILABLE = False

try:
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    CRYPTOGRAPHY_AVAILABLE = True
except Exception:
    CRYPTOGRAPHY_AVAILABLE = False

try:
    from pywebpush import webpush, WebPushException
    WEBPUSH_AVAILABLE = True
except Exception:
    WEBPUSH_AVAILABLE = False
    WebPushException = Exception


BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = max(1,min(110,int(os.getenv("MAX_UPLOAD_MB", "60")))) * 1024 * 1024

COOKIE_NAME = "seprigua_session"
ARGON_TIME_COST = 3
ARGON_MEMORY_COST = 65536
ARGON_PARALLELISM = 2
ALLOWED_UPLOADS = {"jpg", "jpeg", "png", "webp", "pdf", "mp4", "mov"}
IMAGE_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}
VIDEO_EXTENSIONS = {"mp4", "mov"}
PDF_EXTENSIONS = {"pdf"}
IMAGE_MAX_DIMENSION = int(os.getenv("IMAGE_MAX_DIMENSION", "1920"))
IMAGE_WEBP_QUALITY = max(60, min(95, int(os.getenv("IMAGE_WEBP_QUALITY", "82"))))
MAX_IMAGE_BYTES = int(os.getenv("MAX_IMAGE_MB", "8")) * 1024 * 1024
MAX_PDF_BYTES = int(os.getenv("MAX_PDF_MB", "15")) * 1024 * 1024
MAX_VIDEO_BYTES = int(os.getenv("MAX_VIDEO_MB", "20")) * 1024 * 1024
# Las evidencias nuevas se almacenan dentro de la base de datos.
# UPLOAD_ROOT queda únicamente como compatibilidad de lectura para archivos antiguos
# que hayan sido guardados por versiones previas del sistema.
_UPLOAD_ROOT_VALUE = (os.getenv("UPLOAD_ROOT") or "").strip()
UPLOAD_ROOT = Path(_UPLOAD_ROOT_VALUE).expanduser().resolve() if _UPLOAD_ROOT_VALUE else None
EVIDENCE_UPLOAD_DIR = (UPLOAD_ROOT / "evidencias").resolve() if UPLOAD_ROOT else None

# Expedientes laborales (CV, DPI, antecedentes, permisos, constancias, etc.).
# rh.DocumentoLaboral ya existe en el esquema y conserva la referencia en RutaArchivo.
# El archivo físico se mantiene fuera del árbol público; en la versión empresarial este
# punto puede sustituirse por Azure Blob sin cambiar la tabla ni el contrato del frontend.
_LABOR_ROOT_VALUE = (os.getenv("LABOR_DOCUMENT_STORAGE_ROOT") or "").strip()
LABOR_DOCUMENT_ROOT = (Path(_LABOR_ROOT_VALUE).expanduser().resolve() if _LABOR_ROOT_VALUE
                       else (BASE_DIR / ".seprigua-private" / "documentos-laborales").resolve())
LABOR_DOCUMENT_PREFIX = "PRIVATE://LABORAL/"
LABOR_DOCUMENT_EXTENSIONS = {"pdf", "doc", "docx", "jpg", "jpeg", "png", "webp"}
LABOR_DOCUMENT_MIME = {
    "pdf": "application/pdf",
    "doc": "application/msword",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp",
}
MAX_LABOR_DOCUMENT_BYTES = max(1, min(50, int(os.getenv("MAX_LABOR_DOCUMENT_MB", "20")))) * 1024 * 1024

# Web Push / PWA. En VM y dispositivos reales requiere HTTPS.
PUSH_DEDUPE_LOCK = Lock()
PUSH_DEDUPE_BUCKETS: dict[str, float] = {}
VAPID_LOCK = Lock()
PASSWORD_RESET_LOCK = Lock()

# Clima del navbar. Cache en memoria: no crea ni modifica tablas.
WEATHER_LOCK = Lock()
WEATHER_CACHE: dict[str, object] = {"payload": None, "fetched_at": 0.0}
WEATHER_CACHE_SECONDS = 10 * 60

ROLE_PATHS = {
    "COORDINADOR": "/sistema/coordinador",
    "TECNICO": "/sistema/tecnico",
    "CLIENTE": "/sistema/cliente",
}

# ---------------------------------------------------------------------------
# Roles dinámicos + acceso por módulos
# ---------------------------------------------------------------------------
# La BD ya contiene seg.Rol, seg.Permiso y seg.RolPermiso. No se agregan tablas.
# PORTAL_* define qué comportamiento base hereda un rol personalizado y MOD_*
# define qué apartados del portal puede abrir. COORDINADOR conserva acceso total.
PORTAL_PERMISSION_CODES = {
    "COORDINADOR": "PORTAL_COORDINADOR",
    "TECNICO": "PORTAL_TECNICO",
    "CLIENTE": "PORTAL_CLIENTE",
}

MODULE_ACCESS_CATALOG = {
    "dashboard": {"codigo": "MOD_DASHBOARD", "nombre": "Centro de control / Panel", "grupo": "OPERACIÓN", "portales": {"COORDINADOR", "TECNICO", "CLIENTE"}},
    "solicitudes": {"codigo": "MOD_SOLICITUDES", "nombre": "Solicitudes", "grupo": "OPERACIÓN", "portales": {"COORDINADOR", "CLIENTE"}},
    "ordenes": {"codigo": "MOD_ORDENES", "nombre": "Órdenes", "grupo": "OPERACIÓN", "portales": {"COORDINADOR", "TECNICO", "CLIENTE"}},
    "agenda": {"codigo": "MOD_AGENDA", "nombre": "Agenda operativa / Mi agenda", "grupo": "OPERACIÓN", "portales": {"COORDINADOR", "TECNICO"}},
    "personas": {"codigo": "MOD_PERSONAS", "nombre": "Clientes y personal", "grupo": "GESTIÓN", "portales": {"COORDINADOR"}},
    "equipo_mantenimiento": {"codigo": "MOD_EQUIPO_MANTENIMIENTO", "nombre": "Equipo y mantenimiento", "grupo": "GESTIÓN", "portales": {"COORDINADOR", "TECNICO"}},
    "cotizaciones_comercial": {"codigo": "MOD_COTIZACIONES", "nombre": "Cotizaciones", "grupo": "OPERACIÓN", "portales": {"COORDINADOR", "CLIENTE"}},
    "documentos": {"codigo": "MOD_DOCUMENTOS", "nombre": "Documentos", "grupo": "GESTIÓN", "portales": {"COORDINADOR", "TECNICO", "CLIENTE"}},
    "garantia": {"codigo": "MOD_GARANTIAS", "nombre": "Garantías", "grupo": "GESTIÓN", "portales": {"COORDINADOR", "CLIENTE"}},
    "sedes": {"codigo": "MOD_SEDES", "nombre": "Mis sedes", "grupo": "GESTIÓN", "portales": {"CLIENTE"}},
    "vacaciones": {"codigo": "MOD_VACACIONES", "nombre": "Vacaciones", "grupo": "GESTIÓN", "portales": {"TECNICO"}},
    "notificaciones": {"codigo": "MOD_NOTIFICACIONES", "nombre": "Notificaciones", "grupo": "SISTEMA", "portales": {"COORDINADOR", "TECNICO", "CLIENTE"}},
    "auditoria": {"codigo": "MOD_AUDITORIA", "nombre": "Auditoría", "grupo": "SISTEMA", "portales": {"COORDINADOR"}},
    "cuenta": {"codigo": "MOD_CUENTA", "nombre": "Mi cuenta", "grupo": "CUENTA", "portales": {"COORDINADOR", "TECNICO", "CLIENTE"}, "obligatorio": True},
}

DEFAULT_MODULES_BY_PORTAL = {
    "COORDINADOR": set(MODULE_ACCESS_CATALOG),
    "TECNICO": {"dashboard", "ordenes", "agenda", "equipo_mantenimiento", "vacaciones", "documentos", "notificaciones", "cuenta"},
    "CLIENTE": {"dashboard", "solicitudes", "sedes", "ordenes", "cotizaciones_comercial", "documentos", "garantia", "notificaciones", "cuenta"},
}

# Rutas API que pertenecen a cada módulo visible. Los endpoints comunes (auth,
# catálogos compartidos, salud, etc.) no aparecen aquí y continúan disponibles.
MODULE_PATH_PREFIXES = (
    ("/api/agenda-operativa", "agenda"),
    ("/api/solicitudes", "solicitudes"),
    ("/api/ordenes", "ordenes"),
    ("/api/archivos/evidencia", "ordenes"),
    ("/api/clientes", "personas"),
    ("/api/personal", "personas"),
    ("/api/usuarios", "personas"),
    ("/api/equipos", "equipo_mantenimiento"),
    ("/api/mantenimientos", "equipo_mantenimiento"),
    ("/api/catalogo-maestro", "cotizaciones_comercial"),
    ("/api/cotizaciones", "cotizaciones_comercial"),
    ("/api/documentos-laborales", "documentos"),
    ("/api/documentos", "documentos"),
    ("/api/garantias", "garantia"),
    ("/api/mis-sedes", "sedes"),
    ("/api/vacaciones", "vacaciones"),
    ("/api/notificaciones", "notificaciones"),
    ("/api/auditoria", "auditoria"),
    ("/api/dashboard", "dashboard"),
    ("/api/cuenta", "cuenta"),
)


def env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "si", "sí", "on"}



CONTACT_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
RATE_LIMIT_LOCK = Lock()
RATE_LIMIT_BUCKETS: dict[tuple[str, str], list[float]] = {}


def rate_limit_allowed(scope: str, key: str, limit: int, window_seconds: int) -> bool:
    """Sliding-window en memoria para frenar automatización y abuso básico.

    La BD mantiene además el bloqueo persistente por cuenta para el login.
    En una futura arquitectura con varias instancias, este contador puede moverse
    a Redis sin cambiar las rutas ni el frontend.
    """
    now = time.monotonic()
    bucket_key = (scope, key or "desconocido")
    with RATE_LIMIT_LOCK:
        recent = [stamp for stamp in RATE_LIMIT_BUCKETS.get(bucket_key, []) if now - stamp < window_seconds]
        if len(recent) >= limit:
            RATE_LIMIT_BUCKETS[bucket_key] = recent
            return False
        recent.append(now)
        RATE_LIMIT_BUCKETS[bucket_key] = recent
        # Limpieza ligera para evitar crecimiento ilimitado del diccionario.
        if len(RATE_LIMIT_BUCKETS) > 5000:
            stale = [k for k, stamps in RATE_LIMIT_BUCKETS.items() if not stamps or now - stamps[-1] > 86400]
            for k in stale[:2500]:
                RATE_LIMIT_BUCKETS.pop(k, None)
        return True


def rate_limit_clear(scope: str, key: str) -> None:
    with RATE_LIMIT_LOCK:
        RATE_LIMIT_BUCKETS.pop((scope, key or "desconocido"), None)


def contact_rate_allowed(ip: str) -> bool:
    return rate_limit_allowed(
        "contact-ip", ip,
        max(1, int(os.getenv("CONTACT_IP_LIMIT", "5"))),
        max(60, int(os.getenv("CONTACT_IP_WINDOW_SECONDS", "600"))),
    )


def contact_email_rate_allowed(email: str) -> bool:
    key = hashlib.sha256(email.strip().lower().encode("utf-8")).hexdigest()
    return rate_limit_allowed(
        "contact-email", key,
        max(1, int(os.getenv("CONTACT_EMAIL_LIMIT", "3"))),
        max(300, int(os.getenv("CONTACT_EMAIL_WINDOW_SECONDS", "3600"))),
    )


def login_rate_keys(identity: str) -> tuple[str, str]:
    ip_key = client_ip() or "desconocida"
    identity_key = hashlib.sha256(identity.strip().casefold().encode("utf-8")).hexdigest()
    return ip_key, identity_key


def login_rate_allowed(identity: str) -> tuple[bool, str, str]:
    ip_key, identity_key = login_rate_keys(identity)
    ip_ok = rate_limit_allowed(
        "login-ip", ip_key,
        max(5, int(os.getenv("LOGIN_IP_LIMIT", "30"))),
        max(60, int(os.getenv("LOGIN_IP_WINDOW_SECONDS", "600"))),
    )
    identity_ok = rate_limit_allowed(
        "login-identity", identity_key,
        max(5, int(os.getenv("LOGIN_IDENTITY_LIMIT", "8"))),
        max(60, int(os.getenv("LOGIN_IDENTITY_WINDOW_SECONDS", "900"))),
    )
    return ip_ok and identity_ok, ip_key, identity_key


def verify_turnstile(token: str, remote_ip: str | None) -> bool:
    """Valida Cloudflare Turnstile cuando está configurado.

    Si no hay secret y TURNSTILE_REQUIRED=false, el sistema continúa usando
    honeypot + rate limiting para no romper el entorno local/VM.
    """
    secret = (os.getenv("TURNSTILE_SECRET_KEY") or "").strip()
    required = env_bool("TURNSTILE_REQUIRED", False)
    if not secret:
        return not required
    if not token:
        return False

    payload = {"secret": secret, "response": token}
    if remote_ip:
        payload["remoteip"] = remote_ip
    req = UrlRequest(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        data=urlencode(payload).encode("utf-8"),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urlopen(req, timeout=6) as response:
            result = json.loads(response.read().decode("utf-8"))
        return bool(result.get("success"))
    except Exception:
        app.logger.exception("No fue posible validar Turnstile")
        return env_bool("TURNSTILE_FAIL_OPEN", False)


def contact_text(value, *, max_length: int, required: bool = False, field_name: str = "Campo") -> str:
    text = str(value or "").strip()
    if required and not text:
        raise ValueError(f"{field_name} es obligatorio.")
    if len(text) > max_length:
        raise ValueError(f"{field_name} supera el tamaño permitido.")
    return text


def smtp_settings() -> dict:
    user = (os.getenv("SMTP_USER") or "").strip()
    password = os.getenv("SMTP_PASSWORD") or ""
    from_email = (os.getenv("SMTP_FROM_EMAIL") or user).strip()
    recipient = (os.getenv("CONTACT_EMAIL_TO") or "gadministracion@turamgt.com").strip()

    if not user or not password or not from_email:
        raise RuntimeError(
            "El servicio de correo no está configurado. "
            "Define SMTP_USER, SMTP_PASSWORD y SMTP_FROM_EMAIL en .env."
        )

    return {
        "host": (os.getenv("SMTP_HOST") or "smtp.gmail.com").strip(),
        "port": int(os.getenv("SMTP_PORT", "587")),
        "user": user,
        "password": password,
        "from_email": from_email,
        "from_name": (os.getenv("SMTP_FROM_NAME") or "SEPRIGUA").strip(),
        "recipient": recipient,
        "use_tls": env_bool("SMTP_USE_TLS", True),
        "use_ssl": env_bool("SMTP_USE_SSL", False),
        "send_confirmation": env_bool("CONTACT_SEND_CONFIRMATION", True),
    }


def seprigua_email_shell(*, eyebrow: str, title: str, intro: str, body_html: str, footer_note: str) -> str:
    """Plantilla HTML compatible con clientes de correo, usando estilos inline."""
    return f"""<!doctype html>
<html lang="es">
  <body style="margin:0;padding:0;background:#eef4f8;font-family:Arial,Helvetica,sans-serif;color:#193e58;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
           style="width:100%;background:#eef4f8;margin:0;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="640" cellspacing="0" cellpadding="0" border="0"
                 style="width:100%;max-width:640px;background:#ffffff;border-radius:24px;overflow:hidden;
                        box-shadow:0 18px 45px rgba(8,46,78,.12);border:1px solid #dce8f0;">
            <tr>
              <td style="height:7px;background:linear-gradient(90deg,#193e58 0%,#193e58 68%,#f51f4b 68%,#f51f4b 100%);font-size:0;">&nbsp;</td>
            </tr>

            <tr>
              <td align="center" style="padding:30px 28px 18px;">
                <img src="cid:seprigua-logo" width="250" alt="SEPRIGUA Corporación Turam, S.A."
                     style="display:block;width:250px;max-width:82%;height:auto;margin:0 auto 20px;">
                <div style="display:inline-block;padding:7px 12px;border-radius:999px;background:#fff1f4;
                            color:#f51f4b;font-size:11px;font-weight:700;letter-spacing:1.4px;">
                  {html.escape(eyebrow)}
                </div>
                <h1 style="margin:15px 0 8px;color:#0b3764;font-size:30px;line-height:1.12;
                           letter-spacing:-.6px;font-weight:800;">
                  {html.escape(title)}
                </h1>
                <p style="margin:0 auto;max-width:520px;color:#6b8195;font-size:15px;line-height:1.6;">
                  {html.escape(intro)}
                </p>
              </td>
            </tr>

            <tr>
              <td style="padding:6px 28px 26px;">
                {body_html}
              </td>
            </tr>

            <tr>
              <td style="padding:20px 28px;background:#0c355f;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td style="color:#ffffff;font-size:12px;line-height:1.55;">
                      <strong style="display:block;font-size:13px;">SEPRIGUA · Corporación Turam, S.A.</strong>
                      <span style="color:#bdd0df;">{html.escape(footer_note)}</span>
                    </td>
                    <td align="right" style="color:#ffffff;font-size:12px;white-space:nowrap;">
                      <a href="https://wa.me/50254108947"
                         style="display:inline-block;padding:9px 13px;border-radius:999px;background:#f51f4b;
                                color:#ffffff;text-decoration:none;font-weight:700;">
                        WhatsApp
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>

          <p style="margin:14px 0 0;color:#91a4b5;font-size:11px;">
            Mensaje generado automáticamente desde el sitio web oficial de SEPRIGUA.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>"""


def request_summary_html(data: dict) -> str:
    def row(label: str, value: str) -> str:
        if not value:
            return ""
        return f"""
          <tr>
            <td style="width:145px;padding:10px 12px;color:#8194a5;font-size:12px;font-weight:700;
                       text-transform:uppercase;letter-spacing:.7px;border-bottom:1px solid #edf2f6;">
              {html.escape(label)}
            </td>
            <td style="padding:10px 12px;color:#183f63;font-size:14px;font-weight:600;
                       border-bottom:1px solid #edf2f6;word-break:break-word;">
              {html.escape(value)}
            </td>
          </tr>"""

    return f"""
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
             style="width:100%;border:1px solid #e3ebf1;border-radius:17px;overflow:hidden;background:#fbfdff;">
        {row("Nombre", data["nombre"])}
        {row("Correo", data["correo"])}
        {row("Teléfono", data["telefono"])}
        {row("Empresa", data["empresa"])}
        {row("Asunto", data["asunto"])}
      </table>

      <div style="margin-top:16px;padding:17px 18px;border-radius:17px;background:#f3f8fb;
                  border-left:4px solid #f51f4b;">
        <div style="margin-bottom:7px;color:#f51f4b;font-size:11px;font-weight:800;
                    text-transform:uppercase;letter-spacing:1px;">
          Mensaje del cliente
        </div>
        <div style="color:#315674;font-size:14px;line-height:1.65;white-space:pre-wrap;">
          {html.escape(data["mensaje"])}
        </div>
      </div>"""


def build_admin_email(data: dict) -> EmailMessage:
    settings = smtp_settings()
    msg = EmailMessage()
    msg["Subject"] = f"Nueva solicitud web · {data['asunto']}"
    msg["From"] = formataddr((settings["from_name"], settings["from_email"]))
    msg["To"] = settings["recipient"]
    msg["Reply-To"] = data["correo"]

    plain = (
        "NUEVA SOLICITUD DESDE EL SITIO WEB DE SEPRIGUA\n\n"
        f"Nombre: {data['nombre']}\n"
        f"Correo: {data['correo']}\n"
        f"Teléfono: {data['telefono'] or 'No indicado'}\n"
        f"Empresa: {data['empresa'] or 'No indicada'}\n"
        f"Asunto: {data['asunto']}\n\n"
        f"Mensaje:\n{data['mensaje']}\n"
    )
    msg.set_content(plain)

    html_body = seprigua_email_shell(
        eyebrow="NUEVA SOLICITUD WEB",
        title="Un cliente necesita atención",
        intro="Se recibió una nueva solicitud desde el formulario del sitio web de SEPRIGUA.",
        body_html=request_summary_html(data),
        footer_note="Respondé directamente a este correo para contactar al cliente.",
    )
    msg.add_alternative(html_body, subtype="html")
    add_inline_logo(msg)
    return msg


def build_confirmation_email(data: dict) -> EmailMessage:
    settings = smtp_settings()
    msg = EmailMessage()
    msg["Subject"] = "SEPRIGUA · Recibimos tu solicitud"
    msg["From"] = formataddr((settings["from_name"], settings["from_email"]))
    msg["To"] = data["correo"]

    plain = (
        f"Hola {data['nombre']},\n\n"
        "Recibimos tu solicitud en SEPRIGUA. Nuestro equipo revisará la información "
        "y se pondrá en contacto contigo.\n\n"
        f"Asunto: {data['asunto']}\n"
        f"Mensaje: {data['mensaje']}\n\n"
        "SEPRIGUA · Corporación Turam, S.A.\n"
        "WhatsApp: +502 5410 8947"
    )
    msg.set_content(plain)

    summary = f"""
      <div style="padding:18px;border-radius:17px;background:#f3f8fb;border:1px solid #e1ebf2;">
        <div style="color:#8194a5;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:1px;">
          Tu solicitud
        </div>
        <div style="margin-top:8px;color:#143f67;font-size:17px;font-weight:800;">
          {html.escape(data["asunto"])}
        </div>
        <div style="margin-top:9px;color:#5e778d;font-size:14px;line-height:1.65;white-space:pre-wrap;">
          {html.escape(data["mensaje"])}
        </div>
      </div>

      <div style="margin-top:16px;text-align:center;">
        <a href="https://wa.me/50254108947"
           style="display:inline-block;padding:12px 18px;border-radius:12px;background:#f51f4b;
                  color:#ffffff;text-decoration:none;font-size:13px;font-weight:800;">
          Contactar por WhatsApp
        </a>
      </div>"""

    html_body = seprigua_email_shell(
        eyebrow="SOLICITUD RECIBIDA",
        title=f"Gracias, {data['nombre']}",
        intro="Tu solicitud llegó correctamente. Nuestro equipo podrá contactarte con la información que nos compartiste.",
        body_html=summary,
        footer_note="Atención profesional para mantenimiento, drenajes e infraestructura.",
    )
    msg.add_alternative(html_body, subtype="html")
    add_inline_logo(msg)
    return msg


def add_inline_logo(message: EmailMessage) -> None:
    logo = BASE_DIR / "assets" / "img" / "logo-seprigua-hd.png"
    if not logo.exists():
        return

    html_part = message.get_payload()[-1]
    html_part.add_related(
        logo.read_bytes(),
        maintype="image",
        subtype="png",
        cid="<seprigua-logo>",
        filename="seprigua.png",
    )


def open_smtp(settings: dict):
    if settings["use_ssl"]:
        server = smtplib.SMTP_SSL(
            settings["host"],
            settings["port"],
            timeout=15,
            context=ssl.create_default_context(),
        )
    else:
        server = smtplib.SMTP(settings["host"], settings["port"], timeout=15)
        server.ehlo()
        if settings["use_tls"]:
            server.starttls(context=ssl.create_default_context())
            server.ehlo()

    server.login(settings["user"], settings["password"])
    return server


def send_contact_emails(data: dict) -> None:
    settings = smtp_settings()
    admin_message = build_admin_email(data)

    with open_smtp(settings) as smtp:
        smtp.send_message(admin_message)

        if settings["send_confirmation"]:
            try:
                smtp.send_message(build_confirmation_email(data))
            except Exception:
                # La solicitud ya llegó a SEPRIGUA. Un fallo de la confirmación
                # no debe provocar que el cliente vuelva a enviar el formulario.
                app.logger.exception("No se pudo enviar la confirmación al cliente.")


@contextmanager
def get_db_connection():
    def field(value): return '{' + str(value).replace('}', '}}') + '}'
    parts = ["DRIVER="+field(os.getenv("DB_DRIVER","ODBC Driver 18 for SQL Server")),
             "SERVER="+field(os.getenv("DB_SERVER","localhost")),
             "DATABASE="+field(os.getenv("DB_NAME","SEPRIGUA_DB")), "Encrypt=yes",
             "TrustServerCertificate="+("yes" if env_bool("DB_TRUST_CERT",False) else "no")]
    if os.getenv("DB_USER"):
        parts += ["UID="+field(os.environ["DB_USER"]),"PWD="+field(os.getenv("DB_PASSWORD",""))]
    else: parts.append("Trusted_Connection=yes")
    conn=pyodbc.connect(';'.join(parts)+';',timeout=8,autocommit=False)
    conn.timeout=max(5,min(120,int(os.getenv("DB_QUERY_TIMEOUT","30"))))
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def utcnow() -> datetime:
    return datetime.utcnow().replace(microsecond=0)


def parse_datetime_local(value, field_name="fecha"):
    if value is None or value == "": return None
    try:
        parsed=value if isinstance(value,datetime) else datetime.fromisoformat(str(value).replace('Z','+00:00'))
        if parsed.tzinfo is None: parsed=parsed.replace(tzinfo=ZoneInfo(os.getenv('APP_TIMEZONE','America/Guatemala')))
        return parsed.astimezone(timezone.utc).replace(tzinfo=None,microsecond=0)
    except (TypeError,ValueError) as exc:
        raise ValueError(f"{field_name} no tiene un formato válido.") from exc


def token_hash(raw_token: str) -> bytes:
    return hashlib.sha512(raw_token.encode("utf-8")).digest()


def verify_password(password: str, salt: bytes, stored_hash: bytes) -> bool:
    calculated = hash_secret_raw(
        secret=password.encode("utf-8"),
        salt=bytes(salt),
        time_cost=ARGON_TIME_COST,
        memory_cost=ARGON_MEMORY_COST,
        parallelism=ARGON_PARALLELISM,
        hash_len=len(stored_hash),
        type=Type.ID,
    )
    return hmac.compare_digest(calculated, bytes(stored_hash))


def create_password_hash(password: str, hash_len: int = 32) -> tuple[bytes, bytes]:
    """Genera salt y hash Argon2id compatibles con seg.Usuario."""
    salt = os.urandom(16)
    password_hash = hash_secret_raw(
        secret=password.encode("utf-8"),
        salt=salt,
        time_cost=ARGON_TIME_COST,
        memory_cost=ARGON_MEMORY_COST,
        parallelism=ARGON_PARALLELISM,
        hash_len=hash_len,
        type=Type.ID,
    )
    return salt, password_hash


def client_ip():
    return request.remote_addr


def clear_session_cookie(response):
    response.delete_cookie(COOKIE_NAME, path="/")
    return response


def create_session(cursor, usuario_id: int, remember: bool) -> tuple[str, datetime, int]:
    raw_token = secrets.token_urlsafe(48)
    hashed = token_hash(raw_token)
    hours_default = int(os.getenv("SESSION_HOURS", "8"))
    hours_remember = int(os.getenv("REMEMBER_SESSION_HOURS", "168"))
    hours = hours_remember if remember else hours_default
    expires = utcnow() + timedelta(hours=hours)

    cursor.execute(
        """
        INSERT INTO seg.SesionUsuario
            (UsuarioId, TokenHash, ExpiraEn, DireccionIp, AgenteUsuario, Activa)
        VALUES (?, ?, ?, ?, ?, 1)
        """,
        usuario_id,
        pyodbc.Binary(hashed),
        expires,
        client_ip(),
        (request.headers.get("User-Agent") or "")[:500],
    )
    return raw_token, expires, hours


def _role_permission_codes(cursor, rol_id: int | None) -> set[str]:
    if not rol_id:
        return set()
    cursor.execute(
        """
        SELECT UPPER(LTRIM(RTRIM(p.Codigo))) AS Codigo
        FROM seg.RolPermiso rp
        INNER JOIN seg.Permiso p ON p.PermisoId=rp.PermisoId
        WHERE rp.RolId=? AND rp.Concedido=1 AND p.Activo=1
        """,
        int(rol_id),
    )
    return {str(row.Codigo or "").upper() for row in cursor.fetchall() if row.Codigo}


def _portal_role(actual_role: str | None, permission_codes: set[str], empleado_id=None, contacto_cliente_id=None) -> str | None:
    actual = str(actual_role or "").strip().upper()
    if actual in ROLE_PATHS:
        return actual
    for portal, code in PORTAL_PERMISSION_CODES.items():
        if code in permission_codes:
            return portal
    # Compatibilidad defensiva con roles antiguos creados antes del parche.
    if contacto_cliente_id is not None:
        return "CLIENTE"
    if empleado_id is not None:
        return "COORDINADOR"
    return None


def _modules_for_role(actual_role: str | None, portal_role: str | None, permission_codes: set[str]) -> set[str]:
    actual = str(actual_role or "").strip().upper()
    portal = str(portal_role or "").strip().upper()
    if actual == "COORDINADOR":
        return set(MODULE_ACCESS_CATALOG)
    permission_model_present = any(code.startswith("PORTAL_") or code.startswith("MOD_") for code in permission_codes)
    if not permission_model_present:
        return set(DEFAULT_MODULES_BY_PORTAL.get(portal, set()))
    modules = {key for key, meta in MODULE_ACCESS_CATALOG.items() if meta["codigo"] in permission_codes}
    # Mi cuenta es un acceso de seguridad básico y nunca se puede quitar.
    modules.add("cuenta")
    return modules


def _request_module(path: str | None = None) -> str | None:
    value = str(path or request.path or "")
    for prefix, module_key in MODULE_PATH_PREFIXES:
        if value.startswith(prefix):
            return module_key
    return None


def _has_module_access(session: dict, module_key: str | None) -> bool:
    if not module_key:
        return True
    if str(session.get("rol_nombre") or "").upper() == "COORDINADOR":
        return True
    return module_key in set(session.get("modulos") or [])


def _assert_module_access(session: dict) -> None:
    module_key = _request_module()
    if module_key and not _has_module_access(session, module_key):
        raise Forbidden("Tu rol no tiene acceso a este módulo. Solicita a Coordinación que revise tus permisos.")


def current_session():
    raw_token = request.cookies.get(COOKIE_NAME)
    if not raw_token:
        return None
    hashed = token_hash(raw_token)

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT TOP (1)
                s.SesionUsuarioId,
                s.UsuarioId,
                s.ExpiraEn,
                s.Activa,
                u.NombreUsuario,
                u.Correo,
                u.RequiereCambioContrasena,
                u.Activo AS UsuarioActivo,
                r.RolId,
                r.Nombre AS Rol,
                u.EmpleadoId,
                u.ContactoClienteId,
                cc.ClienteId,
                CASE
                    WHEN u.EmpleadoId IS NOT NULL THEN LTRIM(RTRIM(CONCAT(p.Nombres, N' ', p.Apellidos)))
                    WHEN u.ContactoClienteId IS NOT NULL THEN cc.NombreCompleto
                    ELSE u.NombreUsuario
                END AS NombreCompleto,
                c.NombreComercial AS Cliente
            FROM seg.SesionUsuario s
            INNER JOIN seg.Usuario u ON u.UsuarioId = s.UsuarioId
            INNER JOIN seg.Rol r ON r.RolId = u.RolId
            LEFT JOIN rh.Empleado e ON e.EmpleadoId = u.EmpleadoId
            LEFT JOIN rh.Persona p ON p.PersonaId = e.PersonaId
            LEFT JOIN crm.ContactoCliente cc ON cc.ContactoClienteId = u.ContactoClienteId
            LEFT JOIN crm.Cliente c ON c.ClienteId = cc.ClienteId
            WHERE s.TokenHash = ? AND r.Activo=1
              AND (u.EmpleadoId IS NULL OR (e.EstadoLaboral='ACTIVO' AND p.Activo=1))
              AND (u.ContactoClienteId IS NULL OR (cc.Activo=1 AND c.Activo=1))
            ORDER BY s.IniciadaEn DESC
            """,
            pyodbc.Binary(hashed),
        )
        row = cursor.fetchone()
        if not row:
            return None

        if not bool(row.Activa) or not bool(row.UsuarioActivo) or row.ExpiraEn <= utcnow():
            if bool(row.Activa):
                cursor.execute(
                    """
                    UPDATE seg.SesionUsuario
                    SET Activa = 0,
                        CerradaEn = COALESCE(CerradaEn, SYSUTCDATETIME()),
                        MotivoCierre = COALESCE(MotivoCierre, N'SESION_EXPIRADA')
                    WHERE SesionUsuarioId = ?
                    """,
                    row.SesionUsuarioId,
                )
                conn.commit()
            return None

        permission_codes = _role_permission_codes(cursor, int(row.RolId))
        actual_role = str(row.Rol or "").strip().upper()
        portal_role = _portal_role(actual_role, permission_codes, row.EmpleadoId, row.ContactoClienteId)
        if not portal_role:
            return None
        modules = _modules_for_role(actual_role, portal_role, permission_codes)

        return {
            "sesion_id": str(row.SesionUsuarioId),
            "usuario_id": int(row.UsuarioId),
            "usuario": row.NombreUsuario,
            "correo": row.Correo,
            # rol conserva el comportamiento base para no romper la lógica existente.
            "rol": portal_role,
            "rol_nombre": actual_role,
            "rol_id": int(row.RolId),
            "permisos": sorted(permission_codes),
            "modulos": sorted(modules),
            "nombre": row.NombreCompleto or row.NombreUsuario,
            "cliente": row.Cliente,
            "cliente_id": int(row.ClienteId) if row.ClienteId is not None else None,
            "empleado_id": int(row.EmpleadoId) if row.EmpleadoId is not None else None,
            "contacto_cliente_id": int(row.ContactoClienteId) if row.ContactoClienteId is not None else None,
            "requiere_cambio_contrasena": bool(row.RequiereCambioContrasena),
            "expira_en": row.ExpiraEn.isoformat()+"Z",
        }


def require_session(*roles):
    allowed={str(r).upper() for r in roles}
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args,**kwargs):
            try:
                session=getattr(g,'portal_session',None) or current_session()
                if not session:
                    return clear_session_cookie(make_response(jsonify(ok=False,message="Sesión no válida o expirada."),401))
                g.portal_session=session
                if allowed and session['rol'] not in allowed: raise Forbidden("No tienes permiso para realizar esta acción.")
                _assert_module_access(session)
                write=request.method not in {'GET','HEAD','OPTIONS'}
                if write and session.get('requiere_cambio_contrasena') and fn.__name__ not in {'api_cambiar_contrasena','api_cerrar_otras_sesiones'}:
                    raise Forbidden("Primero cambia tu contraseña desde Mi cuenta.")
                if 'orden_id' in kwargs:
                    assert_order_access(session,kwargs['orden_id'],write and fn.__name__ not in {'api_configurar_garantia'})
                if 'solicitud_id' in kwargs and request.path.startswith('/api/solicitudes/'):
                    assert_request_access(session,kwargs['solicitud_id'],write)
                return fn(session,*args,**kwargs)
            except Exception as exc: return app_error(exc)
        return wrapper
    return decorator


def assert_order_access(session,orden_id,write=False):
    row=query_one("""SELECT s.ClienteId AS cliente_id, e.Codigo AS estado,
      CASE WHEN EXISTS(SELECT 1 FROM srv.TecnicoOrden t WHERE t.OrdenTrabajoId=o.OrdenTrabajoId
        AND t.EmpleadoId=? AND t.Estado IN ('ASIGNADO','CONFIRMADO','FINALIZADO')) THEN 1 ELSE 0 END AS asignado
      FROM srv.OrdenTrabajo o JOIN srv.SolicitudServicio s ON s.SolicitudServicioId=o.SolicitudServicioId
      JOIN srv.EstadoOrdenTrabajo e ON e.EstadoOrdenTrabajoId=o.EstadoOrdenTrabajoId WHERE o.OrdenTrabajoId=?""",
      (session.get('empleado_id') or -1,orden_id))
    if not row or (session['rol']=='CLIENTE' and row['cliente_id']!=session.get('cliente_id')) or (session['rol']=='TECNICO' and not row['asignado']):
        raise NotFound("Orden no encontrada o sin acceso.")
    if write and row['estado'] in {'COMPLETADA','CANCELADA'}: raise Conflict("La orden está cerrada; no admite cambios operativos.")
    return row


def assert_request_access(session,solicitud_id,write=False):
    row=query_one('SELECT ClienteId AS cliente_id, Estado AS estado FROM srv.SolicitudServicio WHERE SolicitudServicioId=?',(solicitud_id,))
    if not row or (session['rol']=='CLIENTE' and row['cliente_id']!=session.get('cliente_id')): raise NotFound("Solicitud no encontrada o sin acceso.")
    if write and row['estado']=='CANCELADA': raise Conflict("La solicitud está cancelada.")
    return row


def rows_to_dicts(cursor, rows):
    columns = [d[0] for d in cursor.description] if cursor.description else []
    return [{columns[i]: row[i] for i in range(len(columns))} for row in rows]


def query_all(sql: str, params=()):
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(sql, *params)
        return rows_to_dicts(cursor, cursor.fetchall())


def query_one(sql: str, params=()):
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(sql, *params)
        row = cursor.fetchone()
        if not row:
            return None
        return rows_to_dicts(cursor, [row])[0]


# ---------------------------------------------------------------------------
# Web Push / PWA
# ---------------------------------------------------------------------------
def push_enabled() -> bool:
    return env_bool("PUSH_ENABLED", True)


def _vapid_private_key_path() -> Path:
    configured = (os.getenv("VAPID_PRIVATE_KEY_FILE") or "").strip()
    if configured:
        path = Path(configured).expanduser()
        if not path.is_absolute():
            path = (BASE_DIR / path).resolve()
        return path
    return (BASE_DIR / ".seprigua-private" / "vapid_private.pem").resolve()


def ensure_vapid_private_key() -> Path | None:
    if not push_enabled() or not CRYPTOGRAPHY_AVAILABLE:
        return None
    path = _vapid_private_key_path()
    if path.exists() and path.is_file():
        return path
    if not env_bool("PUSH_AUTO_GENERATE_VAPID", True):
        return None
    with VAPID_LOCK:
        if path.exists() and path.is_file():
            return path
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            private_key = ec.generate_private_key(ec.SECP256R1())
            pem = private_key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.PKCS8,
                encryption_algorithm=serialization.NoEncryption(),
            )
            tmp = path.with_suffix(path.suffix + ".tmp")
            tmp.write_bytes(pem)
            try:
                os.chmod(tmp, 0o600)
            except OSError:
                pass
            os.replace(tmp, path)
            return path
        except Exception:
            app.logger.exception("No fue posible generar la llave VAPID.")
            return None


def vapid_public_key() -> str | None:
    path = ensure_vapid_private_key()
    if not path or not CRYPTOGRAPHY_AVAILABLE:
        return None
    try:
        private_key = serialization.load_pem_private_key(path.read_bytes(), password=None)
        public_bytes = private_key.public_key().public_bytes(
            encoding=serialization.Encoding.X962,
            format=serialization.PublicFormat.UncompressedPoint,
        )
        return base64.urlsafe_b64encode(public_bytes).rstrip(b"=").decode("ascii")
    except Exception:
        app.logger.exception("No fue posible obtener la llave pública VAPID.")
        return None


def push_runtime_ready() -> bool:
    return bool(push_enabled() and WEBPUSH_AVAILABLE and CRYPTOGRAPHY_AVAILABLE and vapid_public_key())


def _compact_subscription(value) -> str:
    if not isinstance(value, dict):
        raise ValueError("Suscripción de notificaciones inválida.")
    endpoint = str(value.get("endpoint") or "").strip()
    keys = value.get("keys") or {}
    p256dh = str(keys.get("p256dh") or "").strip()
    auth = str(keys.get("auth") or "").strip()
    if not endpoint.startswith("https://") or not p256dh or not auth:
        raise ValueError("La suscripción del navegador está incompleta.")
    compact = json.dumps(
        {"endpoint": endpoint, "keys": {"p256dh": p256dh, "auth": auth}},
        ensure_ascii=False,
        separators=(",", ":"),
    )
    if len(compact) > 500:
        raise ValueError("La suscripción del navegador excede el tamaño disponible en la configuración actual.")
    return compact


def _parse_subscription(token: str) -> dict | None:
    try:
        value = json.loads(token)
        _compact_subscription(value)
        return value
    except Exception:
        return None


def _push_role_url(role: str, entity: str | None = None, entity_id=None) -> str:
    base = ROLE_PATHS.get(str(role or "").upper(), "/login")
    params = {}
    if entity:
        params["push_entity"] = entity
    if entity_id is not None:
        params["push_id"] = str(entity_id)
    return f"{base}?{urlencode(params)}" if params else base


def _push_dedupe_allowed(key: str, cooldown: int = 45) -> bool:
    now = time.monotonic()
    with PUSH_DEDUPE_LOCK:
        previous = PUSH_DEDUPE_BUCKETS.get(key)
        if previous is not None and now - previous < cooldown:
            return False
        PUSH_DEDUPE_BUCKETS[key] = now
        if len(PUSH_DEDUPE_BUCKETS) > 3000:
            stale = [k for k, stamp in PUSH_DEDUPE_BUCKETS.items() if now - stamp > 86400]
            for k in stale[:1500]:
                PUSH_DEDUPE_BUCKETS.pop(k, None)
        return True


def _active_push_devices(usuario_id: int) -> list[dict]:
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            return exec_proc_rows(cursor, "EXEC seg.usp_PushDispositivo_ListarActivos ?", (int(usuario_id),))
    except Exception:
        app.logger.exception("No fue posible consultar dispositivos Web Push del usuario %s.", usuario_id)
        return []


def _deactivate_push_token(usuario_id: int, token: str) -> None:
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            exec_proc_rows(cursor, "EXEC seg.usp_PushDispositivo_DesactivarPorToken ?,?", (int(usuario_id), token))
            conn.commit()
    except Exception:
        app.logger.exception("No fue posible desactivar una suscripción Web Push vencida.")


def _dispatch_web_push(user_ids: list[int], payload: dict) -> None:
    if not push_runtime_ready():
        return
    key_path = ensure_vapid_private_key()
    if not key_path:
        return
    serialized = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    subject = (os.getenv("VAPID_SUBJECT") or "mailto:gadministracion@turamgt.com").strip()
    for usuario_id in sorted({int(x) for x in user_ids if x is not None}):
        for device in _active_push_devices(usuario_id):
            token = str(device.get("token_push") or device.get("TokenPush") or "")
            subscription = _parse_subscription(token)
            if not subscription:
                continue
            try:
                webpush(
                    subscription_info=subscription,
                    data=serialized,
                    vapid_private_key=str(key_path),
                    vapid_claims={"sub": subject},
                )
            except WebPushException as exc:
                status = getattr(exc, "status_code", None)
                if status is None and getattr(exc, "response", None) is not None:
                    status = getattr(exc.response, "status_code", None)
                if status in {404, 410}:
                    _deactivate_push_token(usuario_id, token)
                elif status not in {429, 503}:
                    app.logger.warning("Web Push rechazado para usuario %s (HTTP %s).", usuario_id, status)
            except Exception:
                app.logger.exception("Falló el envío Web Push al usuario %s.", usuario_id)


def queue_web_push(user_ids, *, title: str, body: str, role: str, entity: str | None = None,
                   entity_id=None, tag: str | None = None, dedupe_key: str | None = None,
                   force: bool = False) -> None:
    ids = sorted({int(x) for x in (user_ids or []) if x is not None})
    if not ids or not push_enabled():
        return
    key = dedupe_key or f"{tag or title}:{entity or ''}:{entity_id or ''}:{','.join(map(str, ids))}"
    if not _push_dedupe_allowed(key):
        return
    payload = {
        "title": str(title)[:120],
        "body": str(body)[:420],
        "url": _push_role_url(role, entity, entity_id),
        "tag": str(tag or f"seprigua-{entity or 'aviso'}-{entity_id or 'general'}")[:120],
        "icon": "/assets/pwa/seprigua-192.png",
        "badge": "/assets/pwa/seprigua-192.png",
        "force": bool(force),
        "timestamp": int(time.time() * 1000),
    }
    Thread(target=_dispatch_web_push, args=(ids, payload), daemon=True, name="seprigua-webpush").start()


def _coordinator_user_ids(exclude_user_id: int | None = None) -> list[int]:
    rows = query_all("""
        SELECT u.UsuarioId AS usuario_id
        FROM seg.Usuario u INNER JOIN seg.Rol r ON r.RolId=u.RolId
        WHERE u.Activo=1 AND UPPER(LTRIM(RTRIM(r.Nombre)))='COORDINADOR'
          AND (? IS NULL OR u.UsuarioId<>?)
    """, (exclude_user_id, exclude_user_id))
    return [int(x["usuario_id"]) for x in rows]


def _client_user_ids_for_request(solicitud_id: int) -> list[int]:
    rows = query_all("""
        SELECT DISTINCT u.UsuarioId AS usuario_id
        FROM srv.SolicitudServicio s
        INNER JOIN crm.ContactoCliente cc ON cc.ClienteId=s.ClienteId AND cc.Activo=1
        INNER JOIN seg.Usuario u ON u.ContactoClienteId=cc.ContactoClienteId AND u.Activo=1
        WHERE s.SolicitudServicioId=?
    """, (solicitud_id,))
    return [int(x["usuario_id"]) for x in rows]


def _client_user_ids_for_order(orden_id: int) -> list[int]:
    rows = query_all("""
        SELECT DISTINCT u.UsuarioId AS usuario_id
        FROM srv.OrdenTrabajo o
        INNER JOIN srv.SolicitudServicio s ON s.SolicitudServicioId=o.SolicitudServicioId
        INNER JOIN crm.ContactoCliente cc ON cc.ClienteId=s.ClienteId AND cc.Activo=1
        INNER JOIN seg.Usuario u ON u.ContactoClienteId=cc.ContactoClienteId AND u.Activo=1
        WHERE o.OrdenTrabajoId=?
    """, (orden_id,))
    return [int(x["usuario_id"]) for x in rows]


def _request_push_context(solicitud_id: int) -> dict:
    return query_one("""
        SELECT s.SolicitudServicioId AS solicitud_id,c.NombreComercial AS empresa,
               COALESCE(sc.Nombre,ub.NombreReferencia,N'Sede') AS sede,
               ts.Nombre AS tipo_servicio,s.Clasificacion AS clasificacion,s.NivelUrgencia AS urgencia
        FROM srv.SolicitudServicio s
        INNER JOIN crm.Cliente c ON c.ClienteId=s.ClienteId
        INNER JOIN srv.TipoServicio ts ON ts.TipoServicioId=s.TipoServicioId
        LEFT JOIN crm.UbicacionServicio ub ON ub.UbicacionServicioId=s.UbicacionServicioId
        LEFT JOIN crm.SucursalCliente sc ON sc.SucursalClienteId=ub.SucursalClienteId
        WHERE s.SolicitudServicioId=?
    """, (solicitud_id,)) or {}


def _order_push_context(orden_id: int) -> dict:
    return query_one("""
        SELECT o.OrdenTrabajoId AS orden_id,o.NumeroOrden AS numero_orden,o.ProgramadaPara AS programada_para,
               s.SolicitudServicioId AS solicitud_id,c.NombreComercial AS empresa,ts.Nombre AS tipo_servicio,
               COALESCE(sc.Nombre,ub.NombreReferencia,N'Sede') AS sede,
               CONCAT(ub.Direccion,N', ',ub.Municipio,N', ',ub.Departamento) AS direccion,
               eo.Codigo AS estado_codigo,eo.Nombre AS estado_nombre,
               (SELECT TOP 1 q.CotizacionId FROM cot.Cotizacion q WHERE q.OrdenTrabajoId=o.OrdenTrabajoId ORDER BY q.CotizacionId DESC) AS cotizacion_id
        FROM srv.OrdenTrabajo o
        INNER JOIN srv.SolicitudServicio s ON s.SolicitudServicioId=o.SolicitudServicioId
        INNER JOIN crm.Cliente c ON c.ClienteId=s.ClienteId
        INNER JOIN srv.TipoServicio ts ON ts.TipoServicioId=s.TipoServicioId
        INNER JOIN srv.EstadoOrdenTrabajo eo ON eo.EstadoOrdenTrabajoId=o.EstadoOrdenTrabajoId
        LEFT JOIN crm.UbicacionServicio ub ON ub.UbicacionServicioId=s.UbicacionServicioId
        LEFT JOIN crm.SucursalCliente sc ON sc.SucursalClienteId=ub.SucursalClienteId
        WHERE o.OrdenTrabajoId=?
    """, (orden_id,)) or {}


def _crew_push_rows(orden_id: int) -> list[dict]:
    return query_all("""
        SELECT u.UsuarioId AS usuario_id,e.EmpleadoId AS empleado_id,
               LTRIM(RTRIM(CONCAT(p.Nombres,N' ',p.Apellidos))) AS nombre,
               t.FuncionCuadrilla AS funcion
        FROM srv.TecnicoOrden t
        INNER JOIN rh.Empleado e ON e.EmpleadoId=t.EmpleadoId
        INNER JOIN rh.Persona p ON p.PersonaId=e.PersonaId
        LEFT JOIN seg.Usuario u ON u.EmpleadoId=e.EmpleadoId AND u.Activo=1
        WHERE t.OrdenTrabajoId=? AND t.Estado='ASIGNADO'
        ORDER BY CASE WHEN UPPER(COALESCE(t.FuncionCuadrilla,''))='ENCARGADO' THEN 0 ELSE 1 END,p.Nombres,p.Apellidos
    """, (orden_id,))


def push_request_created(solicitud_id: int, actor_session: dict) -> None:
    ctx = _request_push_context(solicitud_id)
    if not ctx:
        return
    company = ctx.get("empresa") or "Cliente"
    site = ctx.get("sede") or "la sede indicada"
    service = ctx.get("tipo_servicio") or "servicio"
    classification = str(ctx.get("clasificacion") or "").replace("_", " ").lower()
    urgency = str(ctx.get("urgencia") or "").replace("_", " ").lower()
    suffix = f" · {classification}" if classification else ""
    if urgency and str(ctx.get("clasificacion") or "").upper() == "EMERGENCIA":
        suffix += f" · {urgency}"
    coords = _coordinator_user_ids(exclude_user_id=actor_session.get("usuario_id"))
    queue_web_push(coords, title=f"Nueva solicitud · {company}",
                   body=f"{company} solicitó {service} en {site}{suffix}.",
                   role="COORDINADOR", entity="SolicitudServicio", entity_id=solicitud_id,
                   tag=f"solicitud-{solicitud_id}-nueva")
    if actor_session.get("rol") == "CLIENTE":
        queue_web_push([actor_session.get("usuario_id")], title="Solicitud creada",
                       body=f"Recibimos tu solicitud #{solicitud_id} para {site}. Te avisaremos cuando Coordinación la atienda.",
                       role="CLIENTE", entity="SolicitudServicio", entity_id=solicitud_id,
                       tag=f"solicitud-{solicitud_id}-creada")
    else:
        clients = _client_user_ids_for_request(solicitud_id)
        queue_web_push(clients, title="Solicitud registrada",
                       body=f"SEPRIGUA registró la solicitud #{solicitud_id} para {site}.",
                       role="CLIENTE", entity="SolicitudServicio", entity_id=solicitud_id,
                       tag=f"solicitud-{solicitud_id}-creada")


def push_order_created(orden_id: int) -> None:
    ctx = _order_push_context(orden_id)
    if not ctx:
        return
    clients = _client_user_ids_for_order(orden_id)
    queue_web_push(clients, title="Tu solicitud fue atendida",
                   body=f"Coordinación atendió tu solicitud #{ctx.get('solicitud_id')} y creó la OT {ctx.get('numero_orden')} para {ctx.get('sede') or 'tu sede'}.",
                   role="CLIENTE", entity="OrdenTrabajo", entity_id=orden_id,
                   tag=f"ot-{orden_id}-creada")


def push_crew_updated(orden_id: int, actor_user_id: int, target_employee_ids=None) -> None:
    ctx = _order_push_context(orden_id)
    crew = _crew_push_rows(orden_id)
    if not ctx or not crew:
        return
    allowed = {int(x) for x in target_employee_ids} if target_employee_ids else None
    names = [str(x.get("nombre") or "Compañero") for x in crew]
    schedule = ctx.get("programada_para")
    schedule_text = schedule.strftime("%d/%m/%Y %H:%M") if isinstance(schedule, datetime) else "horario por confirmar"
    for member in crew:
        if not member.get("usuario_id") or (allowed is not None and int(member.get("empleado_id")) not in allowed):
            continue
        coworkers = [str(x.get("nombre") or "") for x in crew if x.get("empleado_id") != member.get("empleado_id") and x.get("nombre")]
        coworker_text = ", ".join(coworkers) if coworkers else "trabajo individual"
        body = (f"OT {ctx.get('numero_orden')} · {ctx.get('tipo_servicio')}. "
                f"Dirección: {ctx.get('direccion') or ctx.get('sede')}. "
                f"Compañero(s): {coworker_text}. Hora aprox.: {schedule_text}.")
        queue_web_push([member.get("usuario_id")], title="Te han asignado este trabajo",
                       body=body, role="TECNICO", entity="OrdenTrabajo", entity_id=orden_id,
                       tag=f"ot-{orden_id}-asignacion-{member.get('empleado_id')}",
                       dedupe_key=f"crew:{orden_id}:{member.get('empleado_id')}:{'|'.join(names)}")
    other_coords = _coordinator_user_ids(exclude_user_id=actor_user_id)
    if other_coords:
        queue_web_push(other_coords, title=f"Técnicos asignados · OT {ctx.get('numero_orden')}",
                       body=f"Cuadrilla: {', '.join(names)} · {ctx.get('sede') or 'Sede'}.",
                       role="COORDINADOR", entity="OrdenTrabajo", entity_id=orden_id,
                       tag=f"ot-{orden_id}-cuadrilla",
                       dedupe_key=f"coord-crew:{orden_id}:{'|'.join(names)}")


def push_removed_technicians(orden_id: int, employee_ids) -> None:
    ids = [int(x) for x in (employee_ids or [])]
    if not ids:
        return
    placeholders = ",".join("?" for _ in ids)
    rows = query_all(f"SELECT UsuarioId AS usuario_id FROM seg.Usuario WHERE Activo=1 AND EmpleadoId IN ({placeholders})", tuple(ids))
    ctx = _order_push_context(orden_id)
    queue_web_push([x.get("usuario_id") for x in rows], title="Cambio en tu asignación",
                   body=f"Ya no formas parte de la cuadrilla de la OT {ctx.get('numero_orden') or orden_id}.",
                   role="TECNICO", entity="OrdenTrabajo", entity_id=orden_id,
                   tag=f"ot-{orden_id}-desasignacion")


def push_order_state_changed(orden_id: int, target_code: str, actor_session: dict) -> None:
    ctx = _order_push_context(orden_id)
    if not ctx:
        return
    code = str(target_code or "").upper()
    number = ctx.get("numero_orden") or f"#{orden_id}"
    site = ctx.get("sede") or "la sede"
    service = ctx.get("tipo_servicio") or "el servicio"
    actor_id = actor_session.get("usuario_id")
    if code == "EN_PROCESO" and actor_session.get("rol") == "TECNICO":
        queue_web_push(_coordinator_user_ids(), title=f"Trabajo iniciado · {number}",
                       body=f"La cuadrilla inició {service} en {site}.", role="COORDINADOR",
                       entity="OrdenTrabajo", entity_id=orden_id, tag=f"ot-{orden_id}-inicio")
    elif code == "COMPLETADA":
        quote_id = ctx.get("cotizacion_id")
        title = f"OT finalizada · {number}" if quote_id else f"OT lista para cotizar · {number}"
        body = (f"La cuadrilla finalizó {service} en {site}. La cotización ya está asociada."
                if quote_id else f"La cuadrilla finalizó {service} en {site}. Ya puedes crear la cotización.")
        queue_web_push(_coordinator_user_ids(exclude_user_id=actor_id if actor_session.get("rol") == "COORDINADOR" else None),
                       title=title, body=body, role="COORDINADOR", entity="OrdenTrabajo", entity_id=orden_id,
                       tag=f"ot-{orden_id}-finalizada")
        queue_web_push(_client_user_ids_for_order(orden_id), title="Servicio finalizado",
                       body=f"La OT {number} fue finalizada. Ya puedes consultar su seguimiento y documentos.",
                       role="CLIENTE", entity="OrdenTrabajo", entity_id=orden_id,
                       tag=f"ot-{orden_id}-finalizada-cliente")
    elif code == "CANCELADA":
        queue_web_push(_client_user_ids_for_order(orden_id), title=f"Orden cancelada · {number}",
                       body=f"La OT {number} de {site} fue cancelada. Revisa el detalle para más información.",
                       role="CLIENTE", entity="OrdenTrabajo", entity_id=orden_id, tag=f"ot-{orden_id}-cancelada-cliente")
        techs = _crew_push_rows(orden_id)
        queue_web_push([x.get("usuario_id") for x in techs], title=f"Orden cancelada · {number}",
                       body=f"La OT {number} ya no debe ejecutarse. Revisa el detalle antes de movilizarte.",
                       role="TECNICO", entity="OrdenTrabajo", entity_id=orden_id, tag=f"ot-{orden_id}-cancelada-tecnico")


def push_quote_sent(cotizacion_id: int) -> None:
    ctx = query_one("""
        SELECT q.CotizacionId AS cotizacion_id,q.NumeroCotizacion AS numero_cotizacion,o.OrdenTrabajoId AS orden_id,
               o.NumeroOrden AS numero_orden,c.NombreComercial AS empresa,COALESCE(sc.Nombre,ub.NombreReferencia,N'Sede') AS sede,
               vc.Total AS total,vc.Moneda AS moneda
        FROM cot.Cotizacion q
        INNER JOIN srv.OrdenTrabajo o ON o.OrdenTrabajoId=q.OrdenTrabajoId
        INNER JOIN srv.SolicitudServicio s ON s.SolicitudServicioId=o.SolicitudServicioId
        INNER JOIN crm.Cliente c ON c.ClienteId=s.ClienteId
        LEFT JOIN crm.UbicacionServicio ub ON ub.UbicacionServicioId=s.UbicacionServicioId
        LEFT JOIN crm.SucursalCliente sc ON sc.SucursalClienteId=ub.SucursalClienteId
        LEFT JOIN cot.VersionCotizacion vc ON vc.CotizacionId=q.CotizacionId AND vc.EsActual=1
        WHERE q.CotizacionId=?
    """, (cotizacion_id,)) or {}
    if not ctx:
        return
    clients = _client_user_ids_for_order(int(ctx.get("orden_id")))
    amount = ctx.get("total")
    amount_text = f" por Q{float(amount):,.2f}" if amount is not None and str(ctx.get("moneda") or "GTQ").upper() == "GTQ" else ""
    queue_web_push(clients, title="Cotización recibida",
                   body=f"Ya tienes disponible la cotización {ctx.get('numero_cotizacion')}{amount_text} para la OT {ctx.get('numero_orden')}.",
                   role="CLIENTE", entity="Cotizacion", entity_id=cotizacion_id,
                   tag=f"cotizacion-{cotizacion_id}-enviada")


def push_quote_response(cotizacion_id: int, response: str, actor_session: dict) -> None:
    ctx = query_one("""
        SELECT q.NumeroCotizacion AS numero_cotizacion,c.NombreComercial AS empresa,o.OrdenTrabajoId AS orden_id,o.NumeroOrden AS numero_orden
        FROM cot.Cotizacion q INNER JOIN srv.OrdenTrabajo o ON o.OrdenTrabajoId=q.OrdenTrabajoId
        INNER JOIN srv.SolicitudServicio s ON s.SolicitudServicioId=o.SolicitudServicioId
        INNER JOIN crm.Cliente c ON c.ClienteId=s.ClienteId WHERE q.CotizacionId=?
    """, (cotizacion_id,)) or {}
    if not ctx:
        return
    label = str(response or "").replace("_", " ").lower()
    queue_web_push(_coordinator_user_ids(), title=f"Cotización {label}",
                   body=f"{ctx.get('empresa')} respondió {label} a {ctx.get('numero_cotizacion')} · OT {ctx.get('numero_orden')}.",
                   role="COORDINADOR", entity="Cotizacion", entity_id=cotizacion_id,
                   tag=f"cotizacion-{cotizacion_id}-respuesta")


def push_warranty_request(garantia_id: int) -> None:
    link = query_one("SELECT OrdenTrabajoId AS orden_id FROM doc.DocumentoServicio WHERE DocumentoServicioId=?", (garantia_id,)) or {}
    order_id = link.get("orden_id")
    if not order_id:
        return
    ctx = _order_push_context(int(order_id))
    if not ctx:
        return
    queue_web_push(_coordinator_user_ids(), title=f"Revisión de garantía · {ctx.get('empresa')}",
                   body=f"{ctx.get('empresa')} solicitó revisar la OT {ctx.get('numero_orden')} en {ctx.get('sede')}.",
                   role="COORDINADOR", entity="OrdenTrabajo", entity_id=order_id,
                   tag=f"garantia-{garantia_id}-solicitud")


def push_warranty_status(solicitud_garantia_id: int, estado: str) -> None:
    link = query_one("SELECT OrdenTrabajoId AS orden_id FROM srv.IncidenciaOrden WHERE IncidenciaOrdenId=?", (solicitud_garantia_id,)) or {}
    order_id = link.get("orden_id")
    if not order_id:
        return
    ctx = _order_push_context(int(order_id))
    label = str(estado or "").replace("_", " ").lower()
    queue_web_push(_client_user_ids_for_order(int(order_id)), title="Actualización de garantía",
                   body=f"La revisión de garantía de la OT {ctx.get('numero_orden') or order_id} cambió a {label}.",
                   role="CLIENTE", entity="OrdenTrabajo", entity_id=order_id,
                   tag=f"garantia-solicitud-{solicitud_garantia_id}-estado-{str(estado).upper()}")

def set_audit_context(cursor, session, observation: str):
    """Asocia el DML de esta conexión con usuario, sesión e IP para los TR_AUD_* existentes."""
    cursor.execute(
        """
        IF OBJECT_ID(N'seg.EstablecerContextoAuditoria', N'P') IS NOT NULL
        BEGIN
            EXEC seg.EstablecerContextoAuditoria
                @UsuarioId = ?, @SesionUsuarioId = ?, @DireccionIp = ?, @Observacion = ?;
        END
        ELSE
        BEGIN
            EXEC sys.sp_set_session_context @key=N'UsuarioId', @value=?;
            EXEC sys.sp_set_session_context @key=N'SesionUsuarioId', @value=?;
            EXEC sys.sp_set_session_context @key=N'DireccionIp', @value=?;
            EXEC sys.sp_set_session_context @key=N'Observacion', @value=?;
        END
        """,
        session["usuario_id"], session["sesion_id"], client_ip(), observation[:500],
        session["usuario_id"], session["sesion_id"], client_ip(), observation[:500],
    )
    # Consume resultados vacíos de EXEC/IF para que el siguiente statement sea limpio.
    while cursor.nextset():
        pass


def exec_proc_row(cursor, sql: str, params=()):
    cursor.execute(sql, *params)
    while True:
        if cursor.description:
            row = cursor.fetchone()
            if row:
                return rows_to_dicts(cursor, [row])[0]
        if not cursor.nextset():
            return None


def exec_proc_rows(cursor, sql: str, params=()):
    """Ejecuta un Stored Procedure y devuelve el primer result set con filas."""
    cursor.execute(sql, *params)
    result = []
    while True:
        if cursor.description:
            rows = cursor.fetchall()
            result = rows_to_dicts(cursor, rows)
            while cursor.nextset():
                pass
            return result
        if not cursor.nextset():
            return result


def exec_proc_sets(cursor, sql: str, params=()):
    """Ejecuta un Stored Procedure y devuelve todos sus result sets."""
    cursor.execute(sql, *params)
    sets = []
    while True:
        if cursor.description:
            rows = cursor.fetchall()
            sets.append(rows_to_dicts(cursor, rows))
        if not cursor.nextset():
            break
    return sets


def pagination_args(default_size: int = 10, max_size: int = 100) -> tuple[int, int]:
    """Lee pagina/tamano de la URL y mantiene límites razonables."""
    page = request.args.get("pagina", default=1, type=int) or 1
    size = request.args.get("tamano", default=default_size, type=int) or default_size
    page = max(1, page)
    size = max(5, min(max_size, size))
    return page, size


def paged_response(items: list[dict], page: int, size: int, **extra):
    total = int((items[0].get("TotalRegistros") if items else 0) or 0)
    clean = []
    for row in items:
        item = dict(row)
        item.pop("TotalRegistros", None)
        item.pop("totalregistros", None)
        clean.append(item)
    pages = max(1, (total + size - 1) // size) if total else 1
    return jsonify(ok=True, items=clean, pagina=page, tamano=size, total=total, paginas=pages, **extra)


def app_error(exc, public="No fue posible completar la operación."):
    if isinstance(exc,HTTPException): return jsonify(ok=False,message=exc.description),exc.code
    if isinstance(exc,(ValueError,TypeError)): return jsonify(ok=False,message=str(exc)),400
    if isinstance(exc,pyodbc.Error):
        raw=str(exc)
        if any(x in raw for x in ('(2601)','(2627)')): return jsonify(ok=False,message="Ya existe un registro con esos datos."),409
        if '(547)' in raw: return jsonify(ok=False,message="Los datos no cumplen las reglas del registro o tienen relaciones activas."),409
        match=re.search(r'\[SQL Server\]([^\[]+?)\s*\((5\d{4})\)',raw)
        if match and not re.search(r'column|tabla|ODBC|SQL|procedure|constraint',match[1],re.I):
            return jsonify(ok=False,message=match[1].strip()),409
    app.logger.exception(public)
    return jsonify(ok=False,message=public),500


def require_value(data, key, message=None):
    value = data.get(key)
    if value is None or (isinstance(value, str) and not value.strip()):
        raise ValueError(message or f"El campo {key} es obligatorio.")
    return value


def allowed_file(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_UPLOADS


def prepare_upload(file_storage):
    original=secure_filename(file_storage.filename or '') or 'archivo'
    ext=Path(original).suffix.lower().lstrip('.')
    if ext not in ALLOWED_UPLOADS: raise ValueError("Formato no permitido. Usa JPG, PNG, WebP, PDF, MP4 o MOV.")
    limit=MAX_IMAGE_BYTES if ext in IMAGE_EXTENSIONS else MAX_PDF_BYTES if ext=='pdf' else MAX_VIDEO_BYTES
    raw=file_storage.read(limit+1)
    if not raw: raise ValueError("El archivo está vacío.")
    if len(raw)>limit: raise ValueError(f"El archivo supera el límite de {limit//(1024*1024)} MB para este formato.")
    optimized=False;content=raw
    if ext in IMAGE_EXTENSIONS:
        if not PILLOW_AVAILABLE: raise RuntimeError("El procesamiento de imágenes no está disponible.")
        try:
            with Image.open(io.BytesIO(raw)) as source:
                if source.format not in {'JPEG','PNG','WEBP'} or source.width*source.height>40000000:
                    raise ValueError("Imagen demasiado grande o inválida.")
                img=ImageOps.exif_transpose(source);img.load()
                small=len(raw)<=250000 and max(img.size)<=1200
                img.thumbnail((IMAGE_MAX_DIMENSION,IMAGE_MAX_DIMENSION),Image.Resampling.LANCZOS)
                if img.mode not in {'RGB','RGBA'}:img=img.convert('RGBA' if 'A' in img.getbands() else 'RGB')
                out=io.BytesIO();img.save(out,format='WEBP',quality=IMAGE_WEBP_QUALITY,lossless=small,method=4)
                content=out.getvalue()
        except (OSError,ValueError,Image.DecompressionBombError) as exc:
            raise ValueError("La imagen está dañada o supera las dimensiones permitidas.") from exc
        original=Path(original).stem+'.webp';mime='image/webp';kind='FOTO';optimized=True
    elif ext=='pdf':
        if not raw.startswith(b'%PDF-') or b'%%EOF' not in raw[-2048:]:raise ValueError("El PDF no tiene una estructura válida.")
        mime='application/pdf';kind='PDF'
    else:
        # Verifica contenedor ISO BMFF / QuickTime sin transcodificar ni exigir FFmpeg.
        found=False;offset=0
        while offset+8<=min(len(raw),4096):
            size=int.from_bytes(raw[offset:offset+4],'big');atom=raw[offset+4:offset+8]
            if size<8 or size>len(raw)-offset:break
            if atom==b'ftyp' and size>=16:
                brands=raw[offset+8:offset+size]
                found=any(b in brands for b in (b'isom',b'iso2',b'mp41',b'mp42',b'avc1',b'qt  ',b'M4V ',b'MSNV'));break
            if ext=='mov' and atom in (b'moov',b'mdat',b'wide'):found=True;break
            offset+=size
        if not found:raise ValueError("El archivo no es un video MP4/MOV válido.")
        mime='video/quicktime' if ext=='mov' else 'video/mp4';kind='VIDEO'
    return {'nombre':original[:260],'extension':Path(original).suffix.lstrip('.'),'tipo':kind,'mime':mime,
            'contenido':content,'tamano':len(content),'hash_sha256':hashlib.sha256(content).digest(),'optimizado':optimized}


def evidence_url(evidence_id: int) -> str:
    return f"/api/archivos/evidencia/{int(evidence_id)}"


def resolve_evidence_path(value: str | None) -> Path | None:
    """Resuelve únicamente rutas heredadas de versiones anteriores."""
    if not value or EVIDENCE_UPLOAD_DIR is None:
        return None
    raw = str(value).strip().replace("\\", "/")
    if raw.lower().startswith("bd://"):
        return None
    for prefix in ("/uploads/evidencias/", "uploads/evidencias/", "/uploads/", "uploads/"):
        if raw.lower().startswith(prefix.lower()):
            raw = raw[len(prefix):]
            break
    candidate = (EVIDENCE_UPLOAD_DIR / raw).resolve()
    if candidate == EVIDENCE_UPLOAD_DIR or EVIDENCE_UPLOAD_DIR not in candidate.parents:
        return None
    return candidate


# ---------------------------------------------------------------------------
# Archivos y páginas
# ---------------------------------------------------------------------------
@app.get("/")
def landing():
    return send_from_directory(BASE_DIR, "index.html")


@app.get("/index.html")
def landing_alias():
    return send_from_directory(BASE_DIR, "index.html")


@app.get("/manifest.webmanifest")
def pwa_manifest():
    response = send_from_directory(BASE_DIR, "manifest.webmanifest", mimetype="application/manifest+json", max_age=3600)
    response.headers["Cache-Control"] = "public, max-age=3600"
    return response


@app.get("/service-worker.js")
def service_worker():
    response = send_from_directory(BASE_DIR, "service-worker.js", mimetype="application/javascript", max_age=0)
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Service-Worker-Allowed"] = "/"
    return response


@app.get("/login")
@app.get("/login.html")
def login_page():
    return send_from_directory(BASE_DIR, "login.html")


@app.get("/chatbot")
@app.get("/chatbot.html")
def chatbot_page():
    return send_from_directory(BASE_DIR, "chatbot.html")


@app.get("/sistema/<rol>")
def system_page(rol: str):
    if rol.lower() not in {"coordinador", "tecnico", "cliente"}:
        return "Ruta no encontrada", 404
    return send_from_directory(BASE_DIR, "sistema.html")


@app.get("/css/<path:filename>")
def css(filename: str):
    return send_from_directory(BASE_DIR / "css", filename, max_age=86400, conditional=True)


@app.get("/java/<path:filename>")
def js(filename: str):
    return send_from_directory(BASE_DIR / "java", filename, max_age=86400, conditional=True)


@app.get("/assets/<path:filename>")
def assets(filename: str):
    return send_from_directory(BASE_DIR / "assets", filename, max_age=604800, conditional=True)


@app.get("/api/archivos/evidencia/<int:evidencia_id>")
@require_session("COORDINADOR", "TECNICO", "CLIENTE")
def api_archivo_evidencia(session, evidencia_id: int):
    """Sirve una evidencia autorizada usando la metadata registrada en el sistema."""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            set_audit_context(cursor, session, "Consulta de archivo de evidencia")
            row = evidence_storage.load(
                cursor,
                "EXEC srv.usp_EvidenciaServicio_ObtenerPortal ?,?",
                (session["usuario_id"], evidencia_id),
            )
        if not row:
            return jsonify(ok=False, message="Archivo no encontrado o sin acceso."), 404

        filename = secure_filename(str(row.get("NombreArchivo") or "evidencia")) or "evidencia"
        mime = str(row.get("TipoMime") or "application/octet-stream")
        as_attachment = request.args.get("download", "").lower() in {"1", "true", "yes", "si", "sí"}

        contenido = row.get("Contenido")
        if contenido is not None:
            payload = bytes(contenido)
            response = send_file(
                io.BytesIO(payload),
                mimetype=mime,
                as_attachment=as_attachment,
                download_name=filename,
                conditional=True,
                max_age=3600,
            )
            hash_value = row.get("HashSha256")
            if hash_value:
                response.set_etag(bytes(hash_value).hex())
        else:
            # Compatibilidad temporal con evidencias creadas antes del almacenamiento en BD.
            path = resolve_evidence_path(row.get("RutaArchivo"))
            if not path or not path.is_file():
                return jsonify(ok=False, message="La evidencia existe, pero su contenido no está disponible."), 404
            response = send_file(
                path,
                mimetype=mime,
                as_attachment=as_attachment,
                download_name=filename,
                conditional=True,
                max_age=3600,
            )

        response.headers["Cache-Control"] = "private, max-age=3600"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response
    except Exception as exc:
        return app_error(exc, "No fue posible recuperar el archivo.")



# ---------------------------------------------------------------------------
# Recuperación segura de contraseña
# ---------------------------------------------------------------------------
def _password_reset_key_path() -> Path:
    configured = (os.getenv("PASSWORD_RESET_SECRET_FILE") or "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    return (BASE_DIR / ".seprigua-private" / "password_reset.key").resolve()


def _password_reset_secret() -> bytes:
    """Obtiene una llave local privada para firmar enlaces de recuperación.

    No requiere agregar tablas. La llave queda fuera del árbol público, igual que
    las demás credenciales privadas del portal.
    """
    path = _password_reset_key_path()
    with PASSWORD_RESET_LOCK:
        if path.exists():
            secret = path.read_bytes()
            if len(secret) >= 32:
                return secret
        path.parent.mkdir(parents=True, exist_ok=True)
        secret = secrets.token_bytes(48)
        path.write_bytes(secret)
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass
        return secret


def _b64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode((value + padding).encode("ascii"))


def _password_fingerprint(stored_hash: bytes) -> str:
    return hashlib.sha256(bytes(stored_hash)).hexdigest()[:32]


def _create_password_reset_token(usuario_id: int, stored_hash: bytes) -> str:
    payload = {
        "uid": int(usuario_id),
        "iat": int(time.time()),
        "fp": _password_fingerprint(stored_hash),
    }
    body = _b64url_encode(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    signature = hmac.new(_password_reset_secret(), body.encode("ascii"), hashlib.sha256).digest()
    return f"{body}.{_b64url_encode(signature)}"


def _decode_password_reset_token(token: str) -> dict:
    try:
        body, signature_text = str(token or "").split(".", 1)
        signature = _b64url_decode(signature_text)
        expected = hmac.new(_password_reset_secret(), body.encode("ascii"), hashlib.sha256).digest()
        if not hmac.compare_digest(signature, expected):
            raise ValueError("Firma inválida")
        payload = json.loads(_b64url_decode(body).decode("utf-8"))
        uid = int(payload.get("uid"))
        issued_at = int(payload.get("iat"))
        fingerprint = str(payload.get("fp") or "")
    except Exception as exc:
        raise ValueError("El enlace de recuperación no es válido.") from exc

    max_age = max(5, min(120, int(os.getenv("PASSWORD_RESET_MINUTES", "20")))) * 60
    age = int(time.time()) - issued_at
    if age < -60 or age > max_age:
        raise ValueError("El enlace de recuperación venció. Solicita uno nuevo.")
    if uid <= 0 or len(fingerprint) != 32:
        raise ValueError("El enlace de recuperación no es válido.")
    return {"usuario_id": uid, "fingerprint": fingerprint}


def _password_reset_email_available() -> bool:
    user = (os.getenv("SMTP_USER") or "").strip()
    password = os.getenv("SMTP_PASSWORD") or ""
    from_email = (os.getenv("SMTP_FROM_EMAIL") or user).strip()
    return bool(user and password and from_email)


def _password_reset_public_url(token: str) -> str:
    origin = (os.getenv("PASSWORD_RESET_PUBLIC_ORIGIN") or os.getenv("PUBLIC_ORIGIN") or request.host_url).strip()
    origin = origin.rstrip("/")
    return f"{origin}/login.html?reset_token={token}"


def _build_password_reset_email(recipient: str, reset_url: str, minutes: int) -> EmailMessage:
    settings = smtp_settings()
    msg = EmailMessage()
    msg["Subject"] = "Restablece tu contraseña de SEPRIGUA"
    msg["From"] = formataddr((settings["from_name"], settings["from_email"]))
    msg["To"] = recipient
    msg.set_content(
        "Recibimos una solicitud para restablecer tu contraseña de SEPRIGUA. "
        f"Abre este enlace dentro de los próximos {minutes} minutos: {reset_url}\n\n"
        "Si no solicitaste el cambio, ignora este mensaje."
    )
    button = (
        f'<div style="text-align:center;margin:24px 0;">'
        f'<a href="{html.escape(reset_url, quote=True)}" '
        'style="display:inline-block;background:#0c3e73;color:#fff;text-decoration:none;'
        'font-weight:700;padding:13px 22px;border-radius:12px;">Restablecer contraseña</a></div>'
    )
    body_html = (
        '<div style="padding:18px;border:1px solid #dce8f0;border-radius:16px;background:#f8fbfd;'
        'color:#38566e;font-size:14px;line-height:1.65;">'
        'Recibimos una solicitud para cambiar la contraseña de tu cuenta. '
        f'El enlace estará disponible durante <strong>{minutes} minutos</strong>.'
        f'{button}'
        '<div style="font-size:12px;color:#71879a;">'
        'Por seguridad, el enlace deja de funcionar después de cambiar la contraseña. '
        'Si tú no realizaste esta solicitud, puedes ignorar este correo.'
        '</div></div>'
    )
    html_body = seprigua_email_shell(
        eyebrow="SEGURIDAD DE CUENTA",
        title="Restablece tu contraseña",
        intro="Usa el enlace seguro para crear una nueva contraseña de acceso.",
        body_html=body_html,
        footer_note="Este enlace es personal y temporal. No lo compartas.",
    )
    msg.add_alternative(html_body, subtype="html")
    add_inline_logo(msg)
    return msg


def _send_password_reset_email(recipient: str, reset_url: str, minutes: int) -> None:
    try:
        settings = smtp_settings()
        message = _build_password_reset_email(recipient, reset_url, minutes)
        with open_smtp(settings) as smtp:
            smtp.send_message(message)
    except Exception:
        app.logger.exception("No fue posible enviar el correo de recuperación de contraseña.")


def _password_reset_rate_allowed(identity: str) -> bool:
    ip_key = client_ip() or "desconocida"
    identity_key = hashlib.sha256(identity.strip().casefold().encode("utf-8")).hexdigest()
    ip_ok = rate_limit_allowed(
        "password-reset-ip", ip_key,
        max(2, int(os.getenv("PASSWORD_RESET_IP_LIMIT", "6"))),
        max(300, int(os.getenv("PASSWORD_RESET_IP_WINDOW_SECONDS", "1800"))),
    )
    identity_ok = rate_limit_allowed(
        "password-reset-identity", identity_key,
        max(1, int(os.getenv("PASSWORD_RESET_IDENTITY_LIMIT", "3"))),
        max(600, int(os.getenv("PASSWORD_RESET_IDENTITY_WINDOW_SECONDS", "3600"))),
    )
    return ip_ok and identity_ok


@app.post("/api/auth/password-reset/request")
@app.post("/api/password-reset/request")
@app.post("/api/auth/recuperar-contrasena")
def api_password_reset_request():
    data = request.get_json(silent=True) or {}
    identity = str(data.get("identity") or "").strip()
    generic_message = (
        "Si la cuenta existe y tiene un correo registrado, recibirás un enlace para restablecer tu contraseña."
    )
    if not identity or len(identity) > 180:
        return jsonify(ok=True, message=generic_message, email_available=_password_reset_email_available())

    if not _password_reset_rate_allowed(identity):
        return jsonify(
            ok=True,
            message="Si ya solicitaste un enlace, revisa tu correo. Podrás solicitar otro más adelante.",
            email_available=_password_reset_email_available(),
        )

    try:
        user = None
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT TOP (1) UsuarioId, Correo, ContrasenaHash, Activo
                FROM seg.Usuario
                WHERE NombreUsuario=? OR (Correo IS NOT NULL AND Correo=?)
                """,
                identity, identity,
            )
            user = cursor.fetchone()

        email_available = _password_reset_email_available()
        debug_url = None
        if user and bool(user.Activo) and user.Correo and user.ContrasenaHash:
            token = _create_password_reset_token(int(user.UsuarioId), bytes(user.ContrasenaHash))
            reset_url = _password_reset_public_url(token)
            if email_available:
                minutes = max(5, min(120, int(os.getenv("PASSWORD_RESET_MINUTES", "20"))))
                Thread(
                    target=_send_password_reset_email,
                    args=(str(user.Correo).strip(), reset_url, minutes),
                    daemon=True,
                ).start()
            elif request.host.split(":", 1)[0].lower() in {"127.0.0.1", "localhost"}:
                # En LOCAL permitimos abrir el enlace de prueba aun sin SMTP.
                # Esta URL nunca se entrega en una VM/dominio público.
                debug_url = reset_url

        payload = dict(ok=True, message=generic_message, email_available=email_available)
        if debug_url:
            payload["debug_reset_url"] = debug_url
        return jsonify(payload)
    except Exception:
        # La respuesta permanece genérica para evitar enumerar cuentas.
        app.logger.exception("No fue posible procesar una solicitud de recuperación.")
        return jsonify(ok=True, message=generic_message, email_available=_password_reset_email_available())


@app.post("/api/auth/password-reset/confirm")
@app.post("/api/password-reset/confirm")
@app.post("/api/auth/recuperar-contrasena/confirmar")
def api_password_reset_confirm():
    if not rate_limit_allowed(
        "password-reset-confirm", client_ip() or "desconocida",
        max(3, int(os.getenv("PASSWORD_RESET_CONFIRM_LIMIT", "10"))),
        max(300, int(os.getenv("PASSWORD_RESET_CONFIRM_WINDOW_SECONDS", "1800"))),
    ):
        return jsonify(ok=False, message="Demasiados intentos. Espera unos minutos e inténtalo nuevamente."), 429

    data = request.get_json(silent=True) or {}
    token = str(data.get("token") or "").strip()
    password = str(data.get("password") or "")
    if not token or not password:
        return jsonify(ok=False, message="Completa los datos para restablecer la contraseña."), 400

    try:
        _validar_password_portal(password)
        token_data = _decode_password_reset_token(token)
        usuario_id = int(token_data["usuario_id"])

        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT TOP (1) ContrasenaHash, Activo FROM seg.Usuario WHERE UsuarioId=?",
                usuario_id,
            )
            user = cursor.fetchone()
            if not user or not bool(user.Activo) or not user.ContrasenaHash:
                raise ValueError("El enlace de recuperación no es válido.")
            if not hmac.compare_digest(
                _password_fingerprint(bytes(user.ContrasenaHash)),
                token_data["fingerprint"],
            ):
                raise ValueError("El enlace ya fue utilizado o dejó de ser válido.")

            salt, password_hash = create_password_hash(password, len(bytes(user.ContrasenaHash)))
            cursor.execute(
                """
                UPDATE seg.Usuario
                   SET ContrasenaHash=?, ContrasenaSalt=?, RequiereCambioContrasena=0,
                       IntentosFallidos=0, BloqueadoHasta=NULL, ActualizadoEn=SYSUTCDATETIME()
                 WHERE UsuarioId=? AND Activo=1
                """,
                pyodbc.Binary(password_hash), pyodbc.Binary(salt), usuario_id,
            )
            if cursor.rowcount <= 0:
                raise ValueError("No fue posible actualizar la contraseña.")
            cursor.execute(
                """
                UPDATE seg.SesionUsuario
                   SET Activa=0, CerradaEn=COALESCE(CerradaEn,SYSUTCDATETIME()),
                       MotivoCierre=COALESCE(MotivoCierre,N'Restablecimiento de contraseña')
                 WHERE UsuarioId=? AND Activa=1
                """,
                usuario_id,
            )
            conn.commit()
        return jsonify(ok=True, message="Contraseña actualizada. Ya puedes iniciar sesión con tu nueva contraseña.")
    except ValueError as exc:
        return jsonify(ok=False, message=str(exc)), 400
    except Exception as exc:
        return app_error(exc, "No fue posible restablecer la contraseña.")


# ---------------------------------------------------------------------------
# Salud, autenticación y sesión
# ---------------------------------------------------------------------------
@app.get("/api/db/health")
def db_health():
    try:
        row=query_one("SELECT CASE WHEN OBJECT_ID(N'srv.usp_EvidenciaServicio_CrearConArchivo',N'P') IS NULL THEN 0 ELSE 1 END AS listo")
        return jsonify(ok=True,system_migration=bool(row['listo']),message='Servicio disponible')
    except Exception:return jsonify(ok=False,system_migration=False,message='Servicio no disponible'),503

@app.get("/api/ui/clima")
@require_session("COORDINADOR", "TECNICO", "CLIENTE")
def api_ui_clima(session):
    """Clima actual para el navbar global, sin tocar la base de datos.

    Usa Open-Meteo para Ciudad de Guatemala y conserva el último dato válido
    durante fallos temporales de red.
    """
    del session  # La sesión solo se valida; el clima es común a todos los portales.
    now = time.time()
    with WEATHER_LOCK:
        cached = WEATHER_CACHE.get("payload")
        fetched_at = float(WEATHER_CACHE.get("fetched_at") or 0.0)
        if cached and (now - fetched_at) < WEATHER_CACHE_SECONDS:
            return jsonify(**cached)

    params = urlencode({
        "latitude": "14.6349",
        "longitude": "-90.5069",
        "current": "temperature_2m,weather_code,is_day",
        "temperature_unit": "celsius",
        "timezone": "America/Guatemala",
        "forecast_days": "1",
    })
    req = UrlRequest(
        f"https://api.open-meteo.com/v1/forecast?{params}",
        headers={
            "Accept": "application/json",
            "User-Agent": "SEPRIGUA/1.0 weather-navbar",
        },
        method="GET",
    )

    try:
        with urlopen(req, timeout=4) as response:
            remote = json.loads(response.read().decode("utf-8"))
        current = remote.get("current") or {}
        temperature = current.get("temperature_2m")
        if temperature is None:
            raise ValueError("Open-Meteo no devolvió temperatura actual")
        payload = {
            "ok": True,
            "available": True,
            "temperature_c": temperature,
            "weather_code": current.get("weather_code"),
            "is_day": current.get("is_day"),
            "location": "Guatemala",
            "source": "Open-Meteo",
            "stale": False,
        }
        with WEATHER_LOCK:
            WEATHER_CACHE["payload"] = payload
            WEATHER_CACHE["fetched_at"] = time.time()
        return jsonify(**payload)
    except Exception as exc:
        app.logger.warning("No fue posible actualizar el clima del navbar: %s", exc)
        with WEATHER_LOCK:
            cached = WEATHER_CACHE.get("payload")
        if cached:
            stale_payload = dict(cached)
            stale_payload["stale"] = True
            return jsonify(**stale_payload)
        return jsonify(
            ok=False, available=False, temperature_c=None, weather_code=None,
            is_day=None, location="Guatemala", source="Open-Meteo", stale=False
        ), 503



@app.post("/api/auth/login")
def api_login():
    data = request.get_json(silent=True) or {}
    identity = str(data.get("identity") or "").strip()
    password = str(data.get("password") or "")
    remember = bool(data.get("remember"))

    if not identity or not password:
        return jsonify(ok=False, message="Ingresa tu usuario y contraseña."), 400
    if len(identity) > 180 or len(password) > 128:
        return jsonify(ok=False, message="Credenciales no válidas."), 400

    allowed, _ip_key, identity_key = login_rate_allowed(identity)
    if not allowed:
        return jsonify(
            ok=False,
            message="Se detectaron varios intentos de acceso. Espera unos minutos antes de volver a intentar.",
        ), 429

    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT TOP (1) u.UsuarioId, u.NombreUsuario, u.Correo, u.ContrasenaHash,
                       u.ContrasenaSalt, u.RequiereCambioContrasena, u.IntentosFallidos,
                       u.BloqueadoHasta, u.Activo, r.RolId, r.Nombre AS Rol,
                       u.EmpleadoId, u.ContactoClienteId
                FROM seg.Usuario u
                INNER JOIN seg.Rol r ON r.RolId = u.RolId
                WHERE u.NombreUsuario = ? OR (u.Correo IS NOT NULL AND u.Correo = ?)
                """,
                identity, identity,
            )
            user = cursor.fetchone()

            if not user:
                # Ejecuta Argon2 también para usuarios inexistentes y reduce diferencias
                # de tiempo que puedan facilitar enumeración de cuentas.
                hash_secret_raw(
                    secret=password.encode("utf-8"),
                    salt=b"SEPRIGUA-DUMMY!!",
                    time_cost=ARGON_TIME_COST,
                    memory_cost=ARGON_MEMORY_COST,
                    parallelism=ARGON_PARALLELISM,
                    hash_len=32,
                    type=Type.ID,
                )
                return jsonify(ok=False, message="Usuario o contraseña incorrectos."), 401

            # No revelamos si la cuenta existe pero está deshabilitada.
            if not bool(user.Activo):
                verify_password(password, user.ContrasenaSalt, user.ContrasenaHash)
                return jsonify(ok=False, message="Usuario o contraseña incorrectos."), 401

            now = utcnow()
            if user.BloqueadoHasta and user.BloqueadoHasta > now:
                return jsonify(
                    ok=False,
                    message="La cuenta está temporalmente bloqueada por seguridad. Intenta más tarde.",
                ), 423
            if user.BloqueadoHasta and user.BloqueadoHasta <= now:
                cursor.execute(
                    "UPDATE seg.Usuario SET IntentosFallidos=0, BloqueadoHasta=NULL, ActualizadoEn=SYSUTCDATETIME() WHERE UsuarioId=?",
                    user.UsuarioId,
                )
                conn.commit()

            if not verify_password(password, user.ContrasenaSalt, user.ContrasenaHash):
                max_attempts = max(3, int(os.getenv("LOGIN_ACCOUNT_MAX_ATTEMPTS", "5")))
                lock_minutes = max(1, int(os.getenv("LOGIN_ACCOUNT_LOCK_MINUTES", "15")))
                cursor.execute(
                    """
                    UPDATE seg.Usuario
                    SET IntentosFallidos=IntentosFallidos+1,
                        BloqueadoHasta=CASE WHEN IntentosFallidos+1>=? THEN DATEADD(MINUTE,?,SYSUTCDATETIME()) ELSE NULL END,
                        ActualizadoEn=SYSUTCDATETIME()
                    WHERE UsuarioId=?
                    """,
                    max_attempts, lock_minutes, user.UsuarioId,
                )
                conn.commit()
                return jsonify(ok=False, message="Usuario o contraseña incorrectos."), 401

            actual_role = str(user.Rol or "").strip().upper()
            permission_codes = _role_permission_codes(cursor, int(user.RolId))
            role = _portal_role(actual_role, permission_codes, user.EmpleadoId, user.ContactoClienteId)
            redirect_to = ROLE_PATHS.get(role or "")
            if not redirect_to:
                return jsonify(ok=False, message="La cuenta no está habilitada para este portal."), 403

            cursor.execute(
                "UPDATE seg.Usuario SET IntentosFallidos=0, BloqueadoHasta=NULL, UltimoAccesoEn=SYSUTCDATETIME(), ActualizadoEn=SYSUTCDATETIME() WHERE UsuarioId=?",
                user.UsuarioId,
            )
            raw_token, expires, hours = create_session(cursor, int(user.UsuarioId), remember)
            conn.commit()
            rate_limit_clear("login-identity", identity_key)

            response = make_response(jsonify(
                ok=True,
                message="Inicio de sesión correcto.",
                usuario=user.NombreUsuario,
                rol=actual_role,
                portal_rol=role,
                requiere_cambio_contrasena=bool(user.RequiereCambioContrasena),
                redirect=redirect_to,
            ))
            same_site = (os.getenv("COOKIE_SAMESITE") or "Lax").strip().capitalize()
            if same_site not in {"Lax", "Strict", "None"}:
                same_site = "Lax"
            secure_cookie = env_bool("COOKIE_SECURE", False)
            if same_site == "None":
                secure_cookie = True
            response.set_cookie(
                COOKIE_NAME, raw_token, max_age=hours * 3600, expires=expires,
                httponly=True, secure=secure_cookie, samesite=same_site, path="/",
            )
            return response
    except pyodbc.Error as exc:
        return app_error(exc, "No fue posible comunicarse con el sistema.")
    except Exception as exc:
        return app_error(exc, "Ocurrió un error al iniciar sesión.")


@app.get("/api/auth/me")
@require_session("COORDINADOR", "TECNICO", "CLIENTE")
def api_me(session):
    return jsonify(ok=True, user=session)




# ---------------------------------------------------------------------------
# Mi cuenta / seguridad (disponible para los tres tipos de usuario)
# ---------------------------------------------------------------------------
@app.get("/api/cuenta")
@require_session("COORDINADOR", "TECNICO", "CLIENTE")
def api_cuenta(session):
    try:
        item = query_one(
            """
            SELECT
                u.NombreUsuario AS usuario,
                u.Correo AS correo_acceso,
                u.UltimoAccesoEn AS ultimo_acceso,
                u.RequiereCambioContrasena AS requiere_cambio_contrasena,
                u.Activo AS activo,
                e.CodigoEmpleado AS empleado_codigo,
                e.FechaIngreso AS empleado_ingreso,
                e.TipoContratacion AS contratacion,
                e.Disponibilidad AS disponibilidad,
                e.EstadoLaboral AS estado_laboral,
                pu.Nombre AS puesto,
                p.TelefonoPrincipal AS telefono,
                p.Correo AS correo_personal,
                c.CodigoCliente AS cliente_codigo,
                c.NombreComercial AS cliente,
                c.RazonSocial AS razon_social,
                c.Nit AS cliente_nit,
                c.TelefonoPrincipal AS cliente_telefono,
                c.CorreoPrincipal AS cliente_correo
            FROM seg.Usuario u
            LEFT JOIN rh.Empleado e ON e.EmpleadoId=u.EmpleadoId
            LEFT JOIN rh.Persona p ON p.PersonaId=e.PersonaId
            LEFT JOIN rh.Puesto pu ON pu.PuestoId=e.PuestoId
            LEFT JOIN crm.ContactoCliente cc ON cc.ContactoClienteId=u.ContactoClienteId
            LEFT JOIN crm.Cliente c ON c.ClienteId=cc.ClienteId
            WHERE u.UsuarioId=?
            """,
            (session["usuario_id"],),
        ) or {}
        item.update({
            "nombre": session.get("nombre"),
            "rol": session.get("rol"),
            "sesion_expira": session.get("expira_en"),
        })
        return jsonify(ok=True, item=item)
    except Exception as exc:
        return app_error(exc, "No fue posible cargar la información de la cuenta.")


@app.patch("/api/cuenta")
@require_session("COORDINADOR", "TECNICO", "CLIENTE")
def api_actualizar_cuenta(session):
    # Portal privado: los datos de acceso son administrados por Coordinación.
    # Cada usuario únicamente puede cambiar su propia contraseña.
    return jsonify(
        ok=False,
        message="Los datos de la cuenta son administrados por Coordinación. Desde Mi cuenta solo puedes cambiar tu contraseña."
    ), 403


@app.post("/api/cuenta/contrasena")
@require_session("COORDINADOR", "TECNICO", "CLIENTE")
def api_cambiar_contrasena(session):
    data = request.get_json(silent=True) or {}
    try:
        actual = str(require_value(data, "actual", "Ingresa tu contraseña actual."))
        nueva = str(require_value(data, "nueva", "Ingresa la nueva contraseña."))
        confirmacion = str(require_value(data, "confirmacion", "Confirma la nueva contraseña."))
        if nueva != confirmacion:
            raise ValueError("La confirmación de la nueva contraseña no coincide.")
        _validar_password_portal(nueva)
        if actual == nueva:
            raise ValueError("La nueva contraseña debe ser diferente de la actual.")

        with get_db_connection() as conn:
            cursor = conn.cursor()
            set_audit_context(cursor, session, "Cambio de contraseña del propio usuario")
            row = exec_proc_row(cursor, "EXEC seg.usp_Usuario_CredencialPropia ?", (session["usuario_id"],))
            if not row:
                return jsonify(ok=False, message="La cuenta no está disponible."), 404
            if not verify_password(actual, row["ContrasenaSalt"], row["ContrasenaHash"]):
                return jsonify(ok=False, message="La contraseña actual no es correcta."), 403

            old_hash = bytes(row["ContrasenaHash"])
            salt, password_hash = create_password_hash(nueva, len(old_hash))
            exec_proc_rows(
                cursor,
                "EXEC seg.usp_Usuario_CambiarPropiaContrasena ?,?,?",
                (session["usuario_id"], pyodbc.Binary(password_hash), pyodbc.Binary(salt)),
            )
            conn.commit()
        return jsonify(ok=True, message="Contraseña actualizada correctamente.")
    except ValueError as exc:
        return jsonify(ok=False, message=str(exc)), 400
    except Exception as exc:
        return _respuesta_error_usuario(exc, "No fue posible cambiar la contraseña.")


@app.get("/api/cuenta/sesiones")
@require_session("COORDINADOR", "TECNICO", "CLIENTE")
def api_sesiones_cuenta(session):
    try:
        items = query_all(
            """
            SELECT CONVERT(nvarchar(80),SesionUsuarioId) AS id,
                   IniciadaEn AS iniciada,ExpiraEn AS expira,DireccionIp AS ip,
                   AgenteUsuario AS agente,Activa AS activa
            FROM seg.SesionUsuario
            WHERE UsuarioId=? AND Activa=1 AND ExpiraEn>SYSUTCDATETIME()
            ORDER BY IniciadaEn DESC
            """,
            (session["usuario_id"],),
        )
        current_id = str(session["sesion_id"]).lower()
        for item in items:
            item["actual"] = str(item.get("id") or "").lower() == current_id
        return jsonify(ok=True, items=items)
    except Exception as exc:
        return app_error(exc, "No fue posible cargar las sesiones activas.")


@app.post("/api/cuenta/sesiones/cerrar-otras")
@require_session("COORDINADOR", "TECNICO", "CLIENTE")
def api_cerrar_otras_sesiones(session):
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            set_audit_context(cursor, session, "Cierre de otras sesiones del usuario")
            cursor.execute(
                """
                UPDATE seg.SesionUsuario
                SET Activa=0,CerradaEn=COALESCE(CerradaEn,SYSUTCDATETIME()),
                    MotivoCierre=COALESCE(MotivoCierre,N'CIERRE_DESDE_MI_CUENTA')
                WHERE UsuarioId=? AND Activa=1 AND CONVERT(nvarchar(80),SesionUsuarioId)<>?
                """,
                session["usuario_id"], str(session["sesion_id"]),
            )
            closed = max(cursor.rowcount, 0)
            conn.commit()
        return jsonify(ok=True, message=f"Se cerraron {closed} sesión(es) adicional(es).", cerradas=closed)
    except Exception as exc:
        return app_error(exc, "No fue posible cerrar las otras sesiones.")


@app.post("/api/auth/logout")
def api_logout():
    raw_token = request.cookies.get(COOKIE_NAME)
    if raw_token:
        try:
            hashed = token_hash(raw_token)
            with get_db_connection() as conn:
                cursor = conn.cursor()
                cursor.execute(
                    """
                    UPDATE seg.SesionUsuario SET Activa=0,
                        CerradaEn=COALESCE(CerradaEn,SYSUTCDATETIME()),
                        MotivoCierre=COALESCE(MotivoCierre,N'LOGOUT_USUARIO')
                    WHERE TokenHash=? AND Activa=1
                    """,
                    pyodbc.Binary(hashed),
                )
                conn.commit()
        except Exception:
            app.logger.exception("No se pudo cerrar la sesión en la BD")
    return clear_session_cookie(make_response(jsonify(ok=True, message="Sesión cerrada.")))





# ---------------------------------------------------------------------------
# Administración de usuarios / reporte inteligente
# Portal privado: SOLO COORDINADOR administra cuentas.
# Toda persistencia y consulta de este módulo se realiza mediante SP de SQL.
# ---------------------------------------------------------------------------
def _validar_password_portal(password: str) -> None:
    if len(password) < 8:
        raise ValueError("La contraseña debe tener al menos 8 caracteres.")
    if len(password) > 128:
        raise ValueError("La contraseña es demasiado larga.")
    if not re.search(r"[A-ZÁÉÍÓÚÑ]", password):
        raise ValueError("La contraseña debe incluir al menos una mayúscula.")
    if not re.search(r"[a-záéíóúñ]", password):
        raise ValueError("La contraseña debe incluir al menos una minúscula.")
    if not re.search(r"\d", password):
        raise ValueError("La contraseña debe incluir al menos un número.")


def _fecha_reporte(value: str | None):
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        return datetime.strptime(raw, "%Y-%m-%d").date()
    except ValueError as exc:
        raise ValueError("La fecha del reporte no tiene un formato válido.") from exc


def _usuario_reporte_item(row: dict) -> dict:
    return {
        "id": int(row.get("UsuarioId")),
        "usuario": row.get("NombreUsuario"),
        "nombre": row.get("NombreCompleto"),
        "correo": row.get("Correo"),
        "rol_id": int(row["RolId"]) if row.get("RolId") is not None else None,
        "rol": row.get("Rol"),
        "estado": row.get("EstadoUsuario"),
        "activo": str(row.get("EstadoUsuario") or "").upper() != "INACTIVO",
        "empleado_id": int(row["EmpleadoId"]) if row.get("EmpleadoId") is not None else None,
        "contacto_cliente_id": int(row["ContactoClienteId"]) if row.get("ContactoClienteId") is not None else None,
        "cliente": row.get("Cliente"),
        "intentos_fallidos": int(row.get("IntentosFallidos") or 0),
        "bloqueado_hasta": row.get("BloqueadoHasta"),
        "ultimo_acceso": row.get("UltimoAccesoEn"),
        "requiere_cambio_contrasena": bool(row.get("RequiereCambioContrasena")),
        "creado_en": row.get("CreadoEn"),
        "actualizado_en": row.get("ActualizadoEn"),
    }


def _normalizar_detalle_usuario(row: dict | None) -> dict | None:
    """Normaliza filas de usuario para respuestas JSON seguras.

    Los SP administrativos detallados ya devuelven alias amigables, mientras que
    ``usp_Usuario_Crear``/``usp_Usuario_Actualizar`` devuelven los nombres físicos
    de ``seg.Usuario`` e incluyen ``FilaVersion`` (timestamp/varbinary). Flask no
    puede serializar ese valor ``bytes`` directamente y la operación ya podía haber
    quedado confirmada en SQL antes de fallar al construir la respuesta.

    Esta función unifica ambos formatos y nunca expone valores binarios/sensibles.
    """
    if not row:
        return None

    raw = dict(row)
    result = dict(raw)

    # Compatibilidad con filas devueltas directamente por los SP CRUD de seg.Usuario.
    aliases = {
        "UsuarioId": "id",
        "NombreUsuario": "usuario",
        "Correo": "correo",
        "RolId": "rol_id",
        "EmpleadoId": "empleado_id",
        "ContactoClienteId": "contacto_cliente_id",
        "Activo": "activo",
        "IntentosFallidos": "intentos_fallidos",
        "BloqueadoHasta": "bloqueado_hasta",
        "UltimoAccesoEn": "ultimo_acceso",
        "RequiereCambioContrasena": "requiere_cambio_contrasena",
        "CreadoEn": "creado_en",
        "ActualizadoEn": "actualizado_en",
    }
    for source, target in aliases.items():
        if target not in result and source in raw:
            result[target] = raw[source]

    # Nunca enviar binarios del modelo de seguridad/rowversion al navegador.
    # FilaVersion no es utilizada actualmente por el formulario de usuarios.
    for key in (
        "FilaVersion",
        "fila_version",
        "ContrasenaHash",
        "ContrasenaSalt",
        "TokenHash",
    ):
        result.pop(key, None)

    # Retirar las claves físicas que ya fueron convertidas a la API pública.
    for source in aliases:
        result.pop(source, None)

    # Cinturón de seguridad: no permitir que un valor binario inesperado vuelva a
    # provocar "Object of type bytes is not JSON serializable" en este endpoint.
    for key in list(result):
        if isinstance(result[key], (bytes, bytearray, memoryview)):
            result.pop(key, None)

    for key in ("id", "rol_id", "empleado_id", "contacto_cliente_id", "cliente_id", "intentos_fallidos"):
        if result.get(key) is not None:
            try:
                result[key] = int(result[key])
            except (TypeError, ValueError):
                pass
    for key in ("activo", "bloqueado", "requiere_cambio_contrasena"):
        if key in result:
            result[key] = bool(result.get(key))
    return result


def _respuesta_error_usuario(exc, public):
    return app_error(exc, public)


@app.get("/api/usuarios")
@require_session("COORDINADOR")
def api_usuarios_reporte(session):
    try:
        pagina = max(1, request.args.get("pagina", default=1, type=int) or 1)
        tamano = request.args.get("tamano", default=10, type=int) or 10
        tamano = tamano if tamano in {5, 10, 20, 50} else 10
        busqueda = (request.args.get("q") or "").strip() or None
        rol_id = request.args.get("rol_id", type=int)
        estado = (request.args.get("estado") or "").strip().upper() or None
        if estado not in {None, "ACTIVO", "INACTIVO", "BLOQUEADO"}:
            estado = None
        fecha_desde = _fecha_reporte(request.args.get("fecha_desde"))
        fecha_hasta = _fecha_reporte(request.args.get("fecha_hasta"))
        orden = (request.args.get("orden") or "FECHA").strip().upper()
        if orden not in {"USUARIO", "NOMBRE", "CORREO", "ROL", "ESTADO", "FECHA", "ULTIMO_ACCESO"}:
            orden = "FECHA"
        direccion = (request.args.get("direccion") or "DESC").strip().upper()
        direccion = "ASC" if direccion == "ASC" else "DESC"

        with get_db_connection() as conn:
            cursor = conn.cursor()
            set_audit_context(cursor, session, "Consulta del reporte inteligente de usuarios")
            rows = exec_proc_rows(
                cursor,
                "EXEC seg.usp_UsuarioReporte ?,?,?,?,?,?,?,?,?",
                (busqueda, rol_id, estado, fecha_desde, fecha_hasta, pagina, tamano, orden, direccion),
            )
            summary = exec_proc_row(cursor, "EXEC seg.usp_UsuarioResumen") or {}

        total = int(rows[0].get("TotalRegistros") or 0) if rows else 0
        pages = max(1, (total + tamano - 1) // tamano)
        if total and pagina > pages:
            pagina = pages

        return jsonify(
            ok=True,
            items=[_usuario_reporte_item(x) for x in rows],
            pagination={"pagina": pagina, "tamano": tamano, "total": total, "paginas": pages},
            summary={
                "total": int(summary.get("TotalUsuarios") or 0),
                "activos": int(summary.get("Activos") or 0),
                "inactivos": int(summary.get("Inactivos") or 0),
                "bloqueados": int(summary.get("Bloqueados") or 0),
                "acceso_30_dias": int(summary.get("ConAccesoUltimos30Dias") or 0),
            },
            autoregistro=False,
        )
    except ValueError as exc:
        return jsonify(ok=False, message=str(exc)), 400
    except Exception as exc:
        return _respuesta_error_usuario(exc, "No fue posible cargar el reporte de usuarios.")


@app.get("/api/usuarios/catalogos")
@require_session("COORDINADOR")
def api_usuarios_catalogos(session):
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            set_audit_context(cursor, session, "Consulta de catálogos para administración de usuarios")
            sets = exec_proc_sets(cursor, "EXEC seg.usp_UsuarioCatalogosAdministracion")
            roles = sets[0] if len(sets) > 0 else []
            for role in roles:
                codes = _role_permission_codes(cursor, int(role.get("id") or 0))
                role["portal"] = _portal_role(role.get("codigo") or role.get("nombre"), codes) or "COORDINADOR"
        return jsonify(
            ok=True,
            roles=roles,
            empleados=sets[1] if len(sets) > 1 else [],
            contactos=sets[2] if len(sets) > 2 else [],
        )
    except Exception as exc:
        return _respuesta_error_usuario(exc, "No fue posible cargar los catálogos de usuarios.")


@app.get("/api/usuarios/<int:usuario_id>")
@require_session("COORDINADOR")
def api_usuario_detalle(session, usuario_id: int):
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            set_audit_context(cursor, session, f"Consulta de detalle del usuario {usuario_id}")
            sets = exec_proc_sets(cursor, "EXEC seg.usp_UsuarioDetalleAdministracion ?", (usuario_id,))
        item = _normalizar_detalle_usuario((sets[0][0] if sets and sets[0] else None))
        if not item:
            return jsonify(ok=False, message="El usuario indicado no existe."), 404
        sessions = sets[1] if len(sets) > 1 else []
        events = sets[2] if len(sets) > 2 else []
        for x in sessions:
            x["activa"] = bool(x.get("activa"))
        return jsonify(ok=True, item=item, sesiones=sessions, actividad=events)
    except Exception as exc:
        return _respuesta_error_usuario(exc, "No fue posible cargar el detalle del usuario.")


def _validate_user_role_link(cursor, rol_id: int, empleado_id, contacto_id) -> str:
    cursor.execute("SELECT RolId,Nombre,Activo FROM seg.Rol WHERE RolId=?", int(rol_id))
    role = cursor.fetchone()
    if not role or not bool(role.Activo):
        raise ValueError("Selecciona un rol activo del sistema.")
    codes = _role_permission_codes(cursor, int(rol_id))
    portal = _portal_role(role.Nombre, codes, empleado_id, contacto_id)
    if not portal:
        raise ValueError("El rol todavía no tiene un tipo de portal configurado. Revísalo en Roles y accesos.")
    if portal == "CLIENTE" and not contacto_id:
        raise ValueError("Las cuentas con portal Cliente deben vincularse a un contacto de cliente.")
    if portal == "TECNICO" and not empleado_id:
        raise ValueError("Las cuentas con portal Técnico deben vincularse a un empleado.")
    if portal != "CLIENTE" and contacto_id:
        raise ValueError("Solo los roles con portal Cliente pueden vincularse a un contacto de cliente.")
    return portal


@app.post("/api/usuarios")
@require_session("COORDINADOR")
def api_usuario_crear(session):
    data = request.get_json(silent=True) or {}
    try:
        rol_id = int(require_value(data, "rol_id", "Selecciona el rol del usuario."))
        usuario = str(require_value(data, "usuario", "Ingresa el nombre de usuario.")).strip()
        if len(usuario) < 3 or len(usuario) > 60:
            raise ValueError("El nombre de usuario debe tener entre 3 y 60 caracteres.")
        if not re.fullmatch(r"[A-Za-z0-9._-]+", usuario):
            raise ValueError("El usuario solo puede contener letras, números, punto, guion y guion bajo.")

        correo = str(data.get("correo") or "").strip().lower() or None
        if correo and (len(correo) > 160 or not CONTACT_EMAIL_RE.fullmatch(correo)):
            raise ValueError("Ingresa un correo electrónico válido.")

        password = str(require_value(data, "contrasena", "Ingresa una contraseña temporal."))
        confirmacion = str(require_value(data, "confirmacion", "Confirma la contraseña temporal."))
        if password != confirmacion:
            raise ValueError("La confirmación de la contraseña temporal no coincide.")
        _validar_password_portal(password)

        empleado_id = int(data["empleado_id"]) if str(data.get("empleado_id") or "").strip() else None
        contacto_id = int(data["contacto_cliente_id"]) if str(data.get("contacto_cliente_id") or "").strip() else None
        salt, password_hash = create_password_hash(password)

        with get_db_connection() as conn:
            cursor = conn.cursor()
            _validate_user_role_link(cursor, rol_id, empleado_id, contacto_id)
            set_audit_context(cursor, session, f"Registro administrativo del usuario {usuario}")
            sets = exec_proc_sets(
                cursor,
                "EXEC seg.usp_Usuario_Crear ?,?,?,?,?,?,?,?",
                (rol_id, usuario, pyodbc.Binary(password_hash), pyodbc.Binary(salt), empleado_id, correo, contacto_id, 1),
            )
            conn.commit()
        item = _normalizar_detalle_usuario(sets[0][0] if sets and sets[0] else None)
        return jsonify(ok=True, message="Usuario registrado correctamente.", item=item), 201
    except ValueError as exc:
        return jsonify(ok=False, message=str(exc)), 400
    except Exception as exc:
        return _respuesta_error_usuario(exc, "No fue posible registrar el usuario.")


@app.patch("/api/usuarios/<int:usuario_id>")
@require_session("COORDINADOR")
def api_usuario_actualizar(session, usuario_id: int):
    data = request.get_json(silent=True) or {}
    try:
        rol_id = int(require_value(data, "rol_id", "Selecciona el rol del usuario."))
        usuario = str(require_value(data, "usuario", "Ingresa el nombre de usuario.")).strip()
        if len(usuario) < 3 or len(usuario) > 60:
            raise ValueError("El nombre de usuario debe tener entre 3 y 60 caracteres.")
        if not re.fullmatch(r"[A-Za-z0-9._-]+", usuario):
            raise ValueError("El usuario solo puede contener letras, números, punto, guion y guion bajo.")

        correo = str(data.get("correo") or "").strip().lower() or None
        if correo and (len(correo) > 160 or not CONTACT_EMAIL_RE.fullmatch(correo)):
            raise ValueError("Ingresa un correo electrónico válido.")
        empleado_id = int(data["empleado_id"]) if str(data.get("empleado_id") or "").strip() else None
        contacto_id = int(data["contacto_cliente_id"]) if str(data.get("contacto_cliente_id") or "").strip() else None
        activo = bool(data.get("activo", True))

        with get_db_connection() as conn:
            cursor = conn.cursor()
            _validate_user_role_link(cursor, rol_id, empleado_id, contacto_id)
            set_audit_context(cursor, session, f"Actualización administrativa del usuario {usuario_id}")
            sets = exec_proc_sets(
                cursor,
                "EXEC seg.usp_Usuario_Actualizar ?,?,?,?,?,?,?,?",
                (usuario_id, rol_id, usuario, empleado_id, correo, contacto_id, int(activo), None),
            )
            conn.commit()
        item = _normalizar_detalle_usuario(sets[0][0] if sets and sets[0] else None)
        return jsonify(ok=True, message="Usuario actualizado correctamente.", item=item)
    except ValueError as exc:
        return jsonify(ok=False, message=str(exc)), 400
    except Exception as exc:
        return _respuesta_error_usuario(exc, "No fue posible actualizar el usuario.")


@app.post("/api/usuarios/<int:usuario_id>/estado")
@require_session("COORDINADOR")
def api_usuario_estado(session, usuario_id: int):
    data = request.get_json(silent=True) or {}
    try:
        if type(data.get('activo')) is not bool:raise ValueError('Estado inválido.')
        activo = data['activo']
        with get_db_connection() as conn:
            cursor = conn.cursor()
            set_audit_context(cursor, session, ("Activación" if activo else "Desactivación") + f" del usuario {usuario_id}")
            exec_proc_rows(cursor, "EXEC seg.usp_Usuario_CambiarEstado ?,?", (usuario_id, int(activo)))
            conn.commit()
        return jsonify(ok=True, message="Usuario activado." if activo else "Usuario desactivado.")
    except Exception as exc:
        return _respuesta_error_usuario(exc, "No fue posible cambiar el estado del usuario.")


@app.post("/api/usuarios/<int:usuario_id>/desbloquear")
@require_session("COORDINADOR")
def api_usuario_desbloquear(session, usuario_id: int):
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            set_audit_context(cursor, session, f"Desbloqueo administrativo del usuario {usuario_id}")
            exec_proc_rows(cursor, "EXEC seg.usp_Usuario_Desbloquear ?", (usuario_id,))
            conn.commit()
        return jsonify(ok=True, message="Usuario desbloqueado correctamente.")
    except Exception as exc:
        return _respuesta_error_usuario(exc, "No fue posible desbloquear el usuario.")


@app.post("/api/usuarios/<int:usuario_id>/restablecer-contrasena")
@require_session("COORDINADOR")
def api_usuario_restablecer_password(session, usuario_id: int):
    data = request.get_json(silent=True) or {}
    try:
        password = str(require_value(data, "contrasena", "Ingresa la nueva contraseña temporal."))
        confirmacion = str(require_value(data, "confirmacion", "Confirma la contraseña temporal."))
        if password != confirmacion:
            raise ValueError("La confirmación de la contraseña temporal no coincide.")
        _validar_password_portal(password)
        salt, password_hash = create_password_hash(password)
        with get_db_connection() as conn:
            cursor = conn.cursor()
            set_audit_context(cursor, session, f"Restablecimiento administrativo de contraseña del usuario {usuario_id}")
            exec_proc_rows(
                cursor,
                "EXEC seg.usp_Usuario_RestablecerContrasena ?,?,?",
                (usuario_id, pyodbc.Binary(password_hash), pyodbc.Binary(salt)),
            )
            conn.commit()
        return jsonify(ok=True, message="Contraseña temporal restablecida. El usuario deberá cambiarla al ingresar.")
    except ValueError as exc:
        return jsonify(ok=False, message=str(exc)), 400
    except Exception as exc:
        return _respuesta_error_usuario(exc, "No fue posible restablecer la contraseña.")


# ---------------------------------------------------------------------------
# Roles y accesos por módulo
# ---------------------------------------------------------------------------
def _assert_roles_owner(session: dict) -> None:
    # El diseño solicitado reserva la creación/configuración de roles al
    # Coordinador principal, aunque existan otros roles con portal operativo.
    if str(session.get("rol_nombre") or "").upper() != "COORDINADOR":
        raise Forbidden("Solo Coordinación puede administrar roles y módulos.")


def _module_catalog_payload() -> list[dict]:
    return [
        {
            "key": key,
            "codigo": meta["codigo"],
            "nombre": meta["nombre"],
            "grupo": meta["grupo"],
            "portales": sorted(meta["portales"]),
            "obligatorio": bool(meta.get("obligatorio")),
        }
        for key, meta in MODULE_ACCESS_CATALOG.items()
    ]


def _role_access_rows(cursor) -> list[dict]:
    cursor.execute(
        """
        SELECT r.RolId,r.Nombre,r.Descripcion,r.Activo,r.CreadoEn,r.ActualizadoEn,
               COUNT(DISTINCT u.UsuarioId) AS UsuariosAsignados
        FROM seg.Rol r
        LEFT JOIN seg.Usuario u ON u.RolId=r.RolId AND u.Activo=1
        GROUP BY r.RolId,r.Nombre,r.Descripcion,r.Activo,r.CreadoEn,r.ActualizadoEn
        ORDER BY CASE UPPER(r.Nombre) WHEN 'COORDINADOR' THEN 0 WHEN 'TECNICO' THEN 1 WHEN 'CLIENTE' THEN 2 ELSE 3 END,r.Nombre
        """
    )
    rows = rows_to_dicts(cursor, cursor.fetchall())
    result = []
    for row in rows:
        role_name = str(row.get("Nombre") or "").strip()
        role_upper = role_name.upper()
        codes = _role_permission_codes(cursor, int(row["RolId"]))
        portal = _portal_role(role_upper, codes)
        if role_upper in ROLE_PATHS:
            portal = role_upper
        modules = _modules_for_role(role_upper, portal, codes) if portal else set()
        result.append({
            "id": int(row["RolId"]),
            "nombre": role_name,
            "descripcion": row.get("Descripcion") or "",
            "activo": bool(row.get("Activo")),
            "portal": portal,
            "modulos": sorted(modules),
            "usuarios": int(row.get("UsuariosAsignados") or 0),
            "sistema": role_upper in ROLE_PATHS,
            "protegido": role_upper == "COORDINADOR",
            "creado_en": row.get("CreadoEn"),
            "actualizado_en": row.get("ActualizadoEn"),
        })
    return result


def _validated_role_access_payload(data: dict, *, current_name: str | None = None) -> tuple[str, str | None, bool, str, set[str]]:
    name = str(data.get("nombre") or current_name or "").strip()
    if len(name) < 3 or len(name) > 60:
        raise ValueError("El nombre del rol debe tener entre 3 y 60 caracteres.")
    if not re.fullmatch(r"[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 ._-]+", name):
        raise ValueError("El nombre del rol contiene caracteres no permitidos.")
    description = str(data.get("descripcion") or "").strip()[:300] or None
    active = bool(data.get("activo", True))
    portal = str(data.get("portal") or "").strip().upper()
    if portal not in PORTAL_PERMISSION_CODES:
        raise ValueError("Selecciona el tipo de portal del rol.")
    raw_modules = data.get("modulos") or []
    if not isinstance(raw_modules, list):
        raise ValueError("La selección de módulos no es válida.")
    modules = {str(x).strip() for x in raw_modules if str(x).strip() in MODULE_ACCESS_CATALOG}
    incompatible = {key for key in modules if portal not in MODULE_ACCESS_CATALOG[key]["portales"]}
    if incompatible:
        raise ValueError("Uno o más módulos no corresponden al tipo de portal seleccionado.")
    modules.add("cuenta")
    return name, description, active, portal, modules


def _save_role_access_permissions(cursor, role_id: int, portal: str, modules: set[str]) -> None:
    known_codes = set(PORTAL_PERMISSION_CODES.values()) | {meta["codigo"] for meta in MODULE_ACCESS_CATALOG.values()}
    desired = {PORTAL_PERMISSION_CODES[portal]}
    desired.update(MODULE_ACCESS_CATALOG[key]["codigo"] for key in modules if key in MODULE_ACCESS_CATALOG)
    placeholders = ",".join("?" for _ in known_codes)
    cursor.execute(
        f"""
        DELETE rp
        FROM seg.RolPermiso rp
        INNER JOIN seg.Permiso p ON p.PermisoId=rp.PermisoId
        WHERE rp.RolId=? AND UPPER(p.Codigo) IN ({placeholders})
        """,
        int(role_id), *sorted(known_codes),
    )
    if desired:
        placeholders2 = ",".join("?" for _ in desired)
        cursor.execute(
            f"""
            INSERT INTO seg.RolPermiso(RolId,PermisoId,Concedido,CreadoEn)
            SELECT ?,p.PermisoId,1,SYSUTCDATETIME()
            FROM seg.Permiso p
            WHERE p.Activo=1 AND UPPER(p.Codigo) IN ({placeholders2})
              AND NOT EXISTS(SELECT 1 FROM seg.RolPermiso rp WHERE rp.RolId=? AND rp.PermisoId=p.PermisoId)
            """,
            int(role_id), *sorted(desired), int(role_id),
        )
        cursor.execute(
            f"SELECT COUNT(*) FROM seg.Permiso WHERE Activo=1 AND UPPER(Codigo) IN ({placeholders2})",
            *sorted(desired),
        )
        configured = int(cursor.fetchone()[0] or 0)
        if configured != len(desired):
            raise RuntimeError("Falta aplicar el SQL de Roles y módulos en la base de datos.")


@app.get("/api/roles-accesos")
@require_session("COORDINADOR")
def api_roles_accesos(session):
    try:
        _assert_roles_owner(session)
        with get_db_connection() as conn:
            cursor = conn.cursor()
            set_audit_context(cursor, session, "Consulta de roles y accesos por módulo")
            roles = _role_access_rows(cursor)
        return jsonify(ok=True, roles=roles, modulos=_module_catalog_payload(), portales=[
            {"codigo": "COORDINADOR", "nombre": "Portal de coordinación"},
            {"codigo": "TECNICO", "nombre": "Portal técnico"},
            {"codigo": "CLIENTE", "nombre": "Portal cliente"},
        ])
    except Exception as exc:
        return app_error(exc, "No fue posible cargar los roles y accesos.")


@app.post("/api/roles-accesos")
@require_session("COORDINADOR")
def api_rol_acceso_crear(session):
    data = request.get_json(silent=True) or {}
    try:
        _assert_roles_owner(session)
        name, description, active, portal, modules = _validated_role_access_payload(data)
        if name.upper() in ROLE_PATHS:
            raise ValueError("Ese nombre corresponde a un rol base del sistema.")
        with get_db_connection() as conn:
            cursor = conn.cursor()
            set_audit_context(cursor, session, f"Creación del rol {name}")
            cursor.execute("SELECT 1 FROM seg.Rol WHERE UPPER(LTRIM(RTRIM(Nombre)))=UPPER(?)", name)
            if cursor.fetchone():
                raise Conflict("Ya existe un rol con ese nombre.")
            created = exec_proc_row(cursor, "EXEC seg.usp_Rol_Crear ?,?,?", (name, description, int(active)))
            if not created:
                raise RuntimeError("No fue posible obtener el rol creado.")
            role_id = int(created.get("RolId"))
            _save_role_access_permissions(cursor, role_id, portal, modules)
            conn.commit()
        return jsonify(ok=True, message="Rol creado y módulos asignados correctamente.", id=role_id), 201
    except ValueError as exc:
        return jsonify(ok=False, message=str(exc)), 400
    except Exception as exc:
        return app_error(exc, "No fue posible crear el rol.")


@app.patch("/api/roles-accesos/<int:rol_id>")
@require_session("COORDINADOR")
def api_rol_acceso_actualizar(session, rol_id: int):
    data = request.get_json(silent=True) or {}
    try:
        _assert_roles_owner(session)
        with get_db_connection() as conn:
            cursor = conn.cursor()
            set_audit_context(cursor, session, f"Actualización del rol {rol_id}")
            cursor.execute("SELECT RolId,Nombre,Descripcion,Activo FROM seg.Rol WHERE RolId=?", rol_id)
            row = cursor.fetchone()
            if not row:
                raise NotFound("El rol indicado no existe.")
            current_name = str(row.Nombre or "").strip()
            current_upper = current_name.upper()
            codes = _role_permission_codes(cursor, rol_id)
            current_portal = _portal_role(current_upper, codes) or (current_upper if current_upper in ROLE_PATHS else "COORDINADOR")
            name, description, active, portal, modules = _validated_role_access_payload(data, current_name=current_name)
            if current_upper == "COORDINADOR":
                # Evita que el administrador principal se bloquee a sí mismo.
                name, active, portal, modules = current_name, True, "COORDINADOR", set(MODULE_ACCESS_CATALOG)
            elif current_upper in {"TECNICO", "CLIENTE"}:
                name, active, portal = current_name, True, current_upper
                modules = {key for key in modules if portal in MODULE_ACCESS_CATALOG[key]["portales"]}
                modules.add("cuenta")
            if name.upper() != current_upper:
                cursor.execute("SELECT 1 FROM seg.Rol WHERE RolId<>? AND UPPER(LTRIM(RTRIM(Nombre)))=UPPER(?)", rol_id, name)
                if cursor.fetchone():
                    raise Conflict("Ya existe un rol con ese nombre.")
            exec_proc_row(cursor, "EXEC seg.usp_Rol_Actualizar ?,?,?,?", (rol_id, name, description, int(active)))
            _save_role_access_permissions(cursor, rol_id, portal or current_portal, modules)
            conn.commit()
        return jsonify(ok=True, message="Rol y accesos actualizados. La seguridad aplica de inmediato y el menú se refresca al recargar el portal.")
    except ValueError as exc:
        return jsonify(ok=False, message=str(exc)), 400
    except Exception as exc:
        return app_error(exc, "No fue posible actualizar el rol.")


# ---------------------------------------------------------------------------
# Catálogo maestro de trabajos y precios
# Persistencia centralizada en SQL Server. No se usan JSON ni archivos locales.
# ---------------------------------------------------------------------------
def _catalog_number(value, default=0.0) -> float:
    try:
        return round(float(value), 2)
    except (TypeError, ValueError):
        return float(default)


def _catalog_bool(value, default=True) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "si", "sí", "on", "activo"}


def _catalog_category(name: str) -> str:
    text = str(name or "").lower()
    if "dren" in text or "alcantar" in text: return "Drenajes"
    if "cistern" in text: return "Cisternas"
    if "grasa" in text: return "Trampas de grasa"
    if "lodo" in text or "resid" in text or "succi" in text: return "Succión y residuos"
    if "planta" in text or "biodigest" in text or "tratamiento" in text: return "Tratamiento"
    if "bomba" in text: return "Bombas de agua"
    if "plomer" in text or "tuber" in text: return "Plomería"
    return "General"


def _catalog_validate(data: dict, *, custom: bool) -> dict:
    precio = _catalog_number(data.get("precio"), 0)
    if not __import__('math').isfinite(precio) or not 0<=precio<=999999999:
        raise ValueError("El precio debe ser un número entre 0 y 999999999.")
    nombre = str(data.get("nombre") or "").strip()
    codigo = str(data.get("codigo") or "").strip().upper()
    if custom and not nombre:
        raise ValueError("Indica el nombre del trabajo.")
    if custom and not codigo:
        codigo = f"CAT-{secrets.token_hex(3).upper()}"
    return {
        "codigo": codigo[:40],
        "nombre": nombre[:220],
        "categoria": str(data.get("categoria") or _catalog_category(nombre)).strip()[:80],
        "precio": precio,
        "unidad": str(data.get("unidad") or "servicio").strip()[:40],
        "descripcion": str(data.get("descripcion") or "").strip()[:1000],
        "activo": _catalog_bool(data.get("activo"), True),
    }


def _catalog_payload(*, solo_activos: bool = False, pagina: int = 1, tamano: int = 100) -> tuple[list[dict], int]:
    """Carga el catálogo sin asumir una versión concreta del SP.

    La estructura de tablas se mantiene intacta. Algunas instalaciones tienen el
    procedimiento con solo @SoloActivos y otras con paginación; detectamos la
    firma existente y nos adaptamos a ella.
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT COUNT(*) AS Cantidad
            FROM sys.parameters
            WHERE object_id = OBJECT_ID(N'cot.usp_CatalogoMaestro_Listar', N'P')
            """
        )
        meta = cursor.fetchone()
        param_count = int(meta[0] or 0) if meta else 0
        if param_count >= 3:
            rows = exec_proc_rows(
                cursor,
                "EXEC cot.usp_CatalogoMaestro_Listar ?,?,?",
                (1 if solo_activos else 0, pagina, tamano),
            )
            total = int((rows[0].get("TotalRegistros") if rows else 0) or len(rows))
        else:
            all_rows = exec_proc_rows(
                cursor,
                "EXEC cot.usp_CatalogoMaestro_Listar ?",
                (1 if solo_activos else 0,),
            )
            total = len(all_rows)
            start = max(0, (pagina - 1) * tamano)
            rows = all_rows[start:start + tamano]

    items: list[dict] = []
    for row in rows:
        tipo_id = row.get("tipo_servicio_id")
        concepto_id = row.get("concepto_id")
        is_db = tipo_id is not None
        item_id = f"db:{int(tipo_id)}" if is_db else f"custom:{int(concepto_id)}"
        nombre = row.get("nombre") or "Servicio"
        items.append({
            "id": item_id,
            "tipo_servicio_id": int(tipo_id) if tipo_id is not None else None,
            "concepto_id": int(concepto_id) if concepto_id is not None else None,
            "codigo": row.get("codigo") or "",
            "nombre": nombre,
            "categoria": row.get("categoria") or _catalog_category(nombre),
            "precio": _catalog_number(row.get("precio"), 0),
            "unidad": row.get("unidad") or "servicio",
            "descripcion": row.get("descripcion") or "",
            "activo": bool(row.get("activo")),
            "origen": "SISTEMA" if is_db else "PERSONALIZADO",
            "actualizado": row.get("actualizado"),
        })
    return items, total


@app.get("/api/catalogo-maestro")
@require_session("COORDINADOR")
def api_catalogo_maestro(session):
    try:
        solo_activos = request.args.get("solo_activos") in {"1", "true", "yes"}
        page, size = pagination_args(default_size=100, max_size=100)
        items, total = _catalog_payload(solo_activos=solo_activos, pagina=page, tamano=size)
        # Las categorías se derivan en SQL; estas son las visibles en la página actual.
        categorias = sorted({x["categoria"] for x in items if x.get("categoria")})
        return jsonify(
            ok=True, items=items, categorias=categorias, total=total, pagina=page, tamano=size,
            paginas=max(1,(total+size-1)//size) if total else 1,
            activos=sum(1 for x in items if x["activo"]),
            con_precio=sum(1 for x in items if x["precio"] > 0),
        )
    except Exception as exc:
        return app_error(exc, "No fue posible cargar el catálogo maestro.")

@app.post("/api/catalogo-maestro")
@require_session("COORDINADOR")
def api_catalogo_maestro_crear(session):
    data = request.get_json(silent=True) or {}
    try:
        item = _catalog_validate(data, custom=True)
        with get_db_connection() as conn:
            cursor = conn.cursor()
            set_audit_context(cursor, session, "Alta de trabajo personalizado en catálogo maestro")
            row = exec_proc_row(
                cursor,
                "EXEC cot.usp_CatalogoMaestro_Crear ?,?,?,?,?,?,?,?",
                (
                    session["usuario_id"],
                    item["codigo"],
                    item["nombre"],
                    item["categoria"],
                    item["precio"],
                    item["unidad"],
                    item["descripcion"] or None,
                    1 if item["activo"] else 0,
                ),
            )
            conn.commit()
        return jsonify(
            ok=True,
            message="Trabajo agregado al catálogo maestro.",
            item={
                "id": f"custom:{int(row['ConceptoCotizacionId'])}", "concepto_id": int(row["ConceptoCotizacionId"]),
                **item,
                "origen": "PERSONALIZADO",
            },
        ), 201
    except ValueError as exc:
        return jsonify(ok=False, message=str(exc)), 400
    except Exception as exc:
        return app_error(exc, "No fue posible agregar el trabajo al catálogo.")


@app.patch("/api/catalogo-maestro/<path:item_id>")
@require_session("COORDINADOR")
def api_catalogo_maestro_actualizar(session, item_id: str):
    data = request.get_json(silent=True) or {}
    try:
        current = None
        page=1
        while current is None:
            batch,total=_catalog_payload(pagina=page,tamano=100)
            current=next((x for x in batch if x['id']==item_id),None)
            if current or page*100>=total: break
            page+=1
        if not current:
            raise ValueError("El trabajo indicado no existe en el catálogo.")

        is_custom = item_id.startswith("custom:")
        cleaned = _catalog_validate({**current, **data}, custom=is_custom)
        if not is_custom:
            cleaned["codigo"] = current["codigo"]
            cleaned["nombre"] = current["nombre"]

        tipo_id = current.get("tipo_servicio_id")
        concepto_id = current.get("concepto_id")

        with get_db_connection() as conn:
            cursor = conn.cursor()
            set_audit_context(cursor, session, f"Actualización de catálogo maestro {item_id}")
            row = exec_proc_row(
                cursor,
                "EXEC cot.usp_CatalogoMaestro_Actualizar ?,?,?,?,?,?,?,?,?,?",
                (
                    session["usuario_id"],
                    tipo_id,
                    concepto_id,
                    cleaned["codigo"],
                    cleaned["nombre"],
                    cleaned["categoria"],
                    cleaned["precio"],
                    cleaned["unidad"],
                    cleaned["descripcion"] or None,
                    1 if cleaned["activo"] else 0,
                ),
            )
            conn.commit()

        return jsonify(
            ok=True,
            message="Catálogo actualizado.",
            item={
                "id": item_id,
                **cleaned,
                "concepto_id": int(row["ConceptoCotizacionId"]),
                "origen": current["origen"],
            },
        )
    except ValueError as exc:
        return jsonify(ok=False, message=str(exc)), 400
    except Exception as exc:
        return app_error(exc, "No fue posible actualizar el catálogo.")


# ---------------------------------------------------------------------------
# Catálogos compartidos
# ---------------------------------------------------------------------------
@app.get("/api/catalogos")
@require_session("COORDINADOR", "TECNICO", "CLIENTE")
def api_catalogos(session):
    try:
        payload = {
            "tipos_servicio": query_all("SELECT TipoServicioId AS id, Codigo AS codigo, Nombre AS nombre FROM srv.TipoServicio WHERE Activo=1 ORDER BY Nombre"),
            "estados_orden": query_all("SELECT EstadoOrdenTrabajoId AS id, Codigo AS codigo, Nombre AS nombre, EsFinal AS es_final FROM srv.EstadoOrdenTrabajo WHERE Activo=1 ORDER BY OrdenVisual, Nombre"),
        }
        if session["rol"] == "COORDINADOR":
            allowed_modules = set(session.get("modulos") or [])
            if session.get("rol_nombre") == "COORDINADOR":
                allowed_modules = set(MODULE_ACCESS_CATALOG)
            if allowed_modules & {"solicitudes", "ordenes", "agenda", "personas", "cotizaciones_comercial"}:
                payload["clientes"] = query_all("SELECT ClienteId AS id, CodigoCliente AS codigo, NombreComercial AS nombre FROM crm.Cliente WHERE Activo=1 ORDER BY NombreComercial")
            if allowed_modules & {"ordenes", "agenda", "personas"}:
                payload["tecnicos"] = query_all(
                """
                SELECT e.EmpleadoId AS id, e.CodigoEmpleado AS codigo,
                       LTRIM(RTRIM(CONCAT(p.Nombres,N' ',p.Apellidos))) AS nombre,
                       pu.Nombre AS puesto,
                       e.Disponibilidad AS disponibilidad,
                       activo.OrdenTrabajoId AS orden_activa_id,
                       activo.NumeroOrden AS orden_activa_numero,
                       COALESCE(cola.Cantidad,0) AS cola_cantidad,
                       siguiente.OrdenTrabajoId AS siguiente_orden_id,
                       siguiente.NumeroOrden AS siguiente_orden_numero,
                       siguiente.Clasificacion AS siguiente_clasificacion,
                       siguiente.Prioridad AS siguiente_prioridad,
                       CASE
                           WHEN e.Disponibilidad IN ('VACACIONES','INACTIVO','NO_DISPONIBLE') THEN e.Disponibilidad
                           WHEN activo.OrdenTrabajoId IS NOT NULL THEN 'EN_SERVICIO'
                           WHEN COALESCE(cola.Cantidad,0)>0 THEN 'EN_COLA'
                           ELSE 'DISPONIBLE'
                       END AS estado_operativo
                FROM rh.Empleado e
                INNER JOIN rh.Persona p ON p.PersonaId=e.PersonaId
                INNER JOIN rh.Puesto pu ON pu.PuestoId=e.PuestoId
                OUTER APPLY (
                    SELECT TOP (1) o2.OrdenTrabajoId,o2.NumeroOrden
                    FROM srv.TecnicoOrden t2
                    INNER JOIN srv.OrdenTrabajo o2 ON o2.OrdenTrabajoId=t2.OrdenTrabajoId
                    INNER JOIN srv.EstadoOrdenTrabajo eo2 ON eo2.EstadoOrdenTrabajoId=o2.EstadoOrdenTrabajoId
                    WHERE t2.EmpleadoId=e.EmpleadoId
                      AND t2.Estado IN ('ASIGNADO','CONFIRMADO')
                      AND eo2.Codigo='EN_PROCESO'
                    ORDER BY COALESCE(o2.IniciadaEn,t2.AsignadoEn),o2.OrdenTrabajoId
                ) activo
                OUTER APPLY (
                    SELECT COUNT_BIG(*) AS Cantidad
                    FROM srv.TecnicoOrden tq
                    INNER JOIN srv.OrdenTrabajo oq ON oq.OrdenTrabajoId=tq.OrdenTrabajoId
                    INNER JOIN srv.EstadoOrdenTrabajo eq ON eq.EstadoOrdenTrabajoId=oq.EstadoOrdenTrabajoId
                    WHERE tq.EmpleadoId=e.EmpleadoId
                      AND tq.Estado IN ('ASIGNADO','CONFIRMADO')
                      AND eq.EsFinal=0
                      AND eq.Codigo<>'EN_PROCESO'
                ) cola
                OUTER APPLY (
                    SELECT TOP (1) oq.OrdenTrabajoId,oq.NumeroOrden,sq.Clasificacion,oq.Prioridad
                    FROM srv.TecnicoOrden tq
                    INNER JOIN srv.OrdenTrabajo oq ON oq.OrdenTrabajoId=tq.OrdenTrabajoId
                    INNER JOIN srv.EstadoOrdenTrabajo eq ON eq.EstadoOrdenTrabajoId=oq.EstadoOrdenTrabajoId
                    INNER JOIN srv.SolicitudServicio sq ON sq.SolicitudServicioId=oq.SolicitudServicioId
                    WHERE tq.EmpleadoId=e.EmpleadoId
                      AND tq.Estado IN ('ASIGNADO','CONFIRMADO')
                      AND eq.EsFinal=0
                      AND eq.Codigo<>'EN_PROCESO'
                    ORDER BY
                      CASE WHEN sq.Clasificacion='EMERGENCIA' THEN 0 ELSE 1 END,
                      CASE oq.Prioridad WHEN 'CRITICA' THEN 0 WHEN 'ALTA' THEN 1 WHEN 'MEDIA' THEN 2 WHEN 'BAJA' THEN 3 ELSE 4 END,
                      CASE WHEN oq.ProgramadaPara IS NULL THEN 1 ELSE 0 END,
                      oq.ProgramadaPara,
                      tq.AsignadoEn,
                      oq.OrdenTrabajoId
                ) siguiente
                WHERE e.EstadoLaboral='ACTIVO' AND pu.EsTecnico=1 AND pu.Activo=1
                ORDER BY p.Nombres,p.Apellidos
                """
            )
            if allowed_modules & {"ordenes", "equipo_mantenimiento"}:
                payload["equipos"] = query_all("SELECT EquipoId AS id, CodigoEquipo AS codigo, Nombre AS nombre, Estado AS estado FROM eqp.Equipo WHERE Activo=1 ORDER BY Nombre")
        return jsonify(ok=True, **payload)
    except Exception as exc:
        return app_error(exc, "No fue posible cargar los catálogos.")


@app.get("/api/ubicaciones")
@require_session("COORDINADOR", "CLIENTE")
def api_ubicaciones(session):
    try:
        cliente_id = request.args.get("cliente_id", type=int)
        with get_db_connection() as conn:
            cursor = conn.cursor()
            set_audit_context(cursor, session, "Consulta de ubicaciones disponibles para solicitud")
            items = exec_proc_rows(
                cursor,
                "EXEC crm.usp_ClienteUbicacionesPortal_Listar ?,?",
                (session["usuario_id"], cliente_id),
            )
        return jsonify(ok=True, items=items)
    except Exception as exc:
        return app_error(exc, "No fue posible cargar las ubicaciones.")


@app.get("/api/geografia/departamentos")
@require_session("COORDINADOR", "CLIENTE")
def api_departamentos(_session):
    try:
        with get_db_connection() as conn:
            rows = exec_proc_rows(conn.cursor(), "EXEC crm.usp_GeografiaGuatemala_Listar NULL")
        return jsonify(ok=True, items=rows)
    except Exception as exc:
        return app_error(exc, "No fue posible cargar los departamentos.")


@app.get("/api/geografia/municipios")
@require_session("COORDINADOR", "CLIENTE")
def api_municipios(_session):
    departamento = (request.args.get("departamento") or "").strip()
    if not departamento:
        return jsonify(ok=True, items=[])
    try:
        with get_db_connection() as conn:
            rows = exec_proc_rows(conn.cursor(), "EXEC crm.usp_GeografiaGuatemala_Listar ?", (departamento,))
        return jsonify(ok=True, items=rows)
    except Exception as exc:
        return app_error(exc, "No fue posible cargar los municipios.")


# ---------------------------------------------------------------------------
# Dashboards / estadísticas reales de la BD
# ---------------------------------------------------------------------------
@app.get("/api/dashboard")
@require_session("COORDINADOR", "TECNICO", "CLIENTE")
def api_dashboard(session):
    try:
        if session["rol"] == "COORDINADOR":
            cards = query_one(
                """
                SELECT
                  (SELECT COUNT(*) FROM srv.SolicitudServicio WHERE Estado NOT IN ('CANCELADA','CONVERTIDA')) AS solicitudes_pendientes,
                  (SELECT COUNT(*) FROM srv.OrdenTrabajo o INNER JOIN srv.EstadoOrdenTrabajo e ON e.EstadoOrdenTrabajoId=o.EstadoOrdenTrabajoId WHERE e.EsFinal=0) AS ordenes_activas,
                  (SELECT COUNT(*) FROM srv.SolicitudServicio WHERE Clasificacion='EMERGENCIA' AND Estado<>'CANCELADA') AS emergencias,
                  (SELECT COUNT(*) FROM rh.Empleado em INNER JOIN rh.Puesto p ON p.PuestoId=em.PuestoId WHERE em.EstadoLaboral='ACTIVO' AND em.Disponibilidad='DISPONIBLE' AND p.EsTecnico=1) AS tecnicos_disponibles,
                  (SELECT COUNT(*) FROM eqp.Equipo WHERE Activo=1 AND Estado='DISPONIBLE') AS equipos_disponibles,
                  (SELECT COUNT(*) FROM crm.Cliente WHERE Activo=1) AS clientes_activos,
                  (SELECT COUNT(*) FROM cot.Cotizacion WHERE Estado NOT IN ('ACEPTADA','ANULADA')) AS cotizaciones_pendientes,
                  (SELECT COUNT(*) FROM eqp.MantenimientoEquipo WHERE Estado NOT IN ('FINALIZADO','CANCELADO')) AS mantenimientos_pendientes
                """
            )
            recent = query_all(
                """
                SELECT TOP (8) o.OrdenTrabajoId AS id,o.NumeroOrden AS numero,c.NombreComercial AS cliente,
                       s.Clasificacion AS clasificacion,e.Nombre AS estado,o.Prioridad,o.ProgramadaPara AS programada
                FROM srv.OrdenTrabajo o
                INNER JOIN srv.SolicitudServicio s ON s.SolicitudServicioId=o.SolicitudServicioId
                INNER JOIN crm.Cliente c ON c.ClienteId=s.ClienteId
                INNER JOIN srv.EstadoOrdenTrabajo e ON e.EstadoOrdenTrabajoId=o.EstadoOrdenTrabajoId
                ORDER BY o.CreadoEn DESC
                """
            )
            chart = query_all(
                """
                ;WITH Meses AS (
                  SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5
                ), B AS (
                  SELECT DATEFROMPARTS(YEAR(DATEADD(MONTH,-n,GETDATE())),MONTH(DATEADD(MONTH,-n,GETDATE())),1) mes FROM Meses
                )
                SELECT FORMAT(B.mes,'yyyy-MM') AS mes,
                       COUNT(o.OrdenTrabajoId) AS ordenes,
                       SUM(CASE WHEN eo.EsFinal=1 THEN 1 ELSE 0 END) AS finalizadas
                FROM B
                LEFT JOIN srv.OrdenTrabajo o ON o.CreadoEn>=B.mes AND o.CreadoEn<DATEADD(MONTH,1,B.mes)
                LEFT JOIN srv.EstadoOrdenTrabajo eo ON eo.EstadoOrdenTrabajoId=o.EstadoOrdenTrabajoId
                GROUP BY B.mes ORDER BY B.mes
                """
            )
        elif session["rol"] == "TECNICO":
            emp = session["empleado_id"] or -1
            cards = query_one(
                """
                SELECT
                  SUM(CASE WHEN eo.EsFinal=0 AND t.Estado='ASIGNADO' THEN 1 ELSE 0 END) AS ordenes_activas,
                  SUM(CASE WHEN CONVERT(date,o.ProgramadaPara)=CONVERT(date,GETDATE()) AND t.Estado='ASIGNADO' THEN 1 ELSE 0 END) AS hoy,
                  SUM(CASE WHEN eo.EsFinal=1 THEN 1 ELSE 0 END) AS finalizadas,
                  (SELECT COUNT(*) FROM srv.IncidenciaOrden i WHERE i.ReportadaPorEmpleadoId=? AND i.Estado<>'RESUELTA') AS incidencias
                FROM srv.TecnicoOrden t
                INNER JOIN srv.OrdenTrabajo o ON o.OrdenTrabajoId=t.OrdenTrabajoId
                INNER JOIN srv.EstadoOrdenTrabajo eo ON eo.EstadoOrdenTrabajoId=o.EstadoOrdenTrabajoId
                WHERE t.EmpleadoId=?
                """,
                (emp, emp),
            ) or {}
            recent = query_all(
                """
                SELECT TOP (8) o.OrdenTrabajoId AS id,o.NumeroOrden AS numero,c.NombreComercial AS cliente,
                       su.Nombre AS sede,eo.Nombre AS estado,o.Prioridad,o.ProgramadaPara AS programada
                FROM srv.TecnicoOrden t
                INNER JOIN srv.OrdenTrabajo o ON o.OrdenTrabajoId=t.OrdenTrabajoId
                INNER JOIN srv.SolicitudServicio ss ON ss.SolicitudServicioId=o.SolicitudServicioId
                INNER JOIN crm.Cliente c ON c.ClienteId=ss.ClienteId
                INNER JOIN crm.UbicacionServicio ub ON ub.UbicacionServicioId=ss.UbicacionServicioId
                INNER JOIN crm.SucursalCliente su ON su.SucursalClienteId=ub.SucursalClienteId
                INNER JOIN srv.EstadoOrdenTrabajo eo ON eo.EstadoOrdenTrabajoId=o.EstadoOrdenTrabajoId
                WHERE t.EmpleadoId=? AND t.Estado='ASIGNADO'
                ORDER BY COALESCE(o.ProgramadaPara,o.CreadoEn) DESC
                """,
                (emp,),
            )
            chart = []
        else:
            cid = session["cliente_id"] or -1
            cards = query_one(
                """
                SELECT
                  (SELECT COUNT(*) FROM srv.SolicitudServicio WHERE ClienteId=?) AS solicitudes,
                  (SELECT COUNT(*) FROM srv.OrdenTrabajo o INNER JOIN srv.SolicitudServicio s ON s.SolicitudServicioId=o.SolicitudServicioId INNER JOIN srv.EstadoOrdenTrabajo e ON e.EstadoOrdenTrabajoId=o.EstadoOrdenTrabajoId WHERE s.ClienteId=? AND e.EsFinal=0) AS servicios_activos,
                  (SELECT COUNT(*) FROM srv.OrdenTrabajo o INNER JOIN srv.SolicitudServicio s ON s.SolicitudServicioId=o.SolicitudServicioId INNER JOIN srv.EstadoOrdenTrabajo e ON e.EstadoOrdenTrabajoId=o.EstadoOrdenTrabajoId WHERE s.ClienteId=? AND e.EsFinal=1) AS completados,
                  (SELECT COUNT(*) FROM doc.DocumentoServicio d INNER JOIN srv.OrdenTrabajo o ON o.OrdenTrabajoId=d.OrdenTrabajoId INNER JOIN srv.SolicitudServicio s ON s.SolicitudServicioId=o.SolicitudServicioId WHERE s.ClienteId=?) AS documentos
                """,
                (cid,cid,cid,cid),
            )
            recent = query_all(
                """
                SELECT TOP (8) s.SolicitudServicioId AS id,s.DescripcionProblema AS descripcion,
                       ts.Nombre AS tipo,s.Clasificacion,s.Estado,s.FechaPreferida AS fecha
                FROM srv.SolicitudServicio s
                INNER JOIN srv.TipoServicio ts ON ts.TipoServicioId=s.TipoServicioId
                WHERE s.ClienteId=? ORDER BY s.CreadoEn DESC
                """,
                (cid,),
            )
            chart = []
        return jsonify(ok=True, cards=cards or {}, recent=recent, chart=chart)
    except Exception as exc:
        return app_error(exc, "No fue posible cargar el panel.")


# ---------------------------------------------------------------------------
# Solicitudes
# ---------------------------------------------------------------------------
@app.get("/api/solicitudes")
@require_session("COORDINADOR", "CLIENTE")
def api_solicitudes(session):
    return portal_listing(__import__(__name__,fromlist=["app"]),session,"solicitudes")

@app.post("/api/solicitudes")
@require_session("COORDINADOR", "CLIENTE")
def api_crear_solicitud(session):
    data = request.get_json(silent=True) or {}
    try:
        cliente_id = int(data.get("cliente_id") or 0)
        contacto_id = data.get("contacto_cliente_id")
        if session["rol"] == "CLIENTE":
            cliente_id = session["cliente_id"] or 0
            contacto_id = session["contacto_cliente_id"]
        if not cliente_id:
            raise ValueError("No se pudo determinar el cliente de la solicitud.")
        ubicacion_id = int(require_value(data, "ubicacion_id", "Selecciona una sede/ubicación."))
        tipo_id = int(require_value(data, "tipo_servicio_id", "Selecciona un tipo de servicio."))
        clasificacion = str(data.get("clasificacion") or "PROGRAMADA").upper()
        if clasificacion not in {"PROGRAMADA", "EMERGENCIA"}:
            raise ValueError("Clasificación inválida.")
        urgencia = str(data.get("urgencia") or ("MEDIA" if clasificacion == "PROGRAMADA" else "ALTA")).upper()
        if urgencia not in {"BAJA","MEDIA","ALTA","CRITICA"}: raise ValueError("Selecciona una prioridad válida.")
        descripcion = str(require_value(data, "descripcion", "Describe el problema.")).strip()
        fecha_preferida = parse_datetime_local(data.get("fecha_preferida"), "Fecha de atención solicitada") if clasificacion == "PROGRAMADA" else None
        if clasificacion == "PROGRAMADA" and fecha_preferida is None:
            raise ValueError("Indica cuándo te gustaría que atendamos el servicio programado.")
        canal = "OTRO" if session["rol"] == "CLIENTE" else str(data.get("canal") or "OTRO").upper()
        if canal == "MENSAJE":
            canal = "WHATSAPP"

        with get_db_connection() as conn:
            cursor = conn.cursor()
            set_audit_context(cursor, session, "Creación de solicitud desde portal web")
            row = exec_proc_row(
                cursor,
                "EXEC srv.usp_AppCrearSolicitud ?,?,?,?,?,?,?,?,?,?",
                (cliente_id, contacto_id, ubicacion_id, tipo_id, session["usuario_id"], canal,
                 clasificacion, urgencia, descripcion, fecha_preferida),
            )
            solicitud_id = None
            if row:
                solicitud_id = row.get("SolicitudServicioId") or row.get("solicitudServicioId") or row.get("id")
            if session["rol"] == "CLIENTE":
                cursor.execute(
                    """
                    INSERT INTO com.Notificacion(UsuarioId,Tipo,Titulo,Mensaje,Entidad,EntidadId,Canal,Estado)
                    SELECT u.UsuarioId,N'NUEVA_SOLICITUD',N'Nueva solicitud de servicio',
                           CONCAT(N'Un cliente registró una solicitud ',?,N'. Revisa el panel para coordinar la atención.'),
                           N'SolicitudServicio',?,N'SISTEMA',N'PENDIENTE'
                    FROM seg.Usuario u INNER JOIN seg.Rol r ON r.RolId=u.RolId
                    WHERE u.Activo=1 AND UPPER(r.Nombre)=N'COORDINADOR' AND u.UsuarioId<>?
                    """,
                    clasificacion, str(solicitud_id) if solicitud_id is not None else None, session["usuario_id"],
                )
            else:
                cursor.execute(
                    """
                    INSERT INTO com.Notificacion(UsuarioId,Tipo,Titulo,Mensaje,Entidad,EntidadId,Canal,Estado)
                    SELECT DISTINCT u.UsuarioId,N'NUEVA_SOLICITUD',N'Solicitud registrada por SEPRIGUA',
                           CONCAT(N'SEPRIGUA registró una solicitud ',?,N' para tu empresa.'),
                           N'SolicitudServicio',?,N'SISTEMA',N'PENDIENTE'
                    FROM crm.ContactoCliente cc
                    INNER JOIN seg.Usuario u ON u.ContactoClienteId=cc.ContactoClienteId AND u.Activo=1
                    WHERE cc.ClienteId=? AND cc.Activo=1 AND u.UsuarioId<>?
                    """,
                    clasificacion, str(solicitud_id) if solicitud_id is not None else None, cliente_id, session["usuario_id"],
                )
            conn.commit()
        if solicitud_id:
            push_request_created(int(solicitud_id), session)
        return jsonify(ok=True, message="Solicitud registrada.", item=row), 201
    except ValueError as exc:
        return jsonify(ok=False, message=str(exc)), 400
    except Exception as exc:
        return app_error(exc, "No fue posible registrar la solicitud.")



@app.get("/api/solicitudes/<int:solicitud_id>")
@require_session("COORDINADOR", "CLIENTE")
def api_solicitud_detalle(session, solicitud_id: int):
    try:
        permission = ""
        params = [solicitud_id]
        if session["rol"] == "CLIENTE":
            permission = "AND s.ClienteId=?"
            params.append(session["cliente_id"] or -1)
        item = query_one(
            f"""
            SELECT s.SolicitudServicioId AS id,s.ClienteId AS cliente_id,c.NombreComercial AS cliente,
                   s.ContactoClienteId,s.UbicacionServicioId,COALESCE(sc.Nombre,u.NombreReferencia,N'Sin sede') AS sede,
                   u.Direccion,u.Municipio,u.Departamento,ts.Nombre AS tipo,ts.Codigo AS tipo_codigo,
                   s.CanalRecepcion AS canal,s.Clasificacion,s.NivelUrgencia AS urgencia,
                   s.DescripcionProblema AS descripcion,s.FechaPreferida AS fecha_preferida,
                   s.Estado,s.Observaciones,s.CreadoEn AS creada,
                   ot.OrdenTrabajoId AS orden_id,ot.NumeroOrden AS orden_numero,
                   ot.EstadoOrden AS orden_estado,ot.CodigoEstadoOrden AS orden_estado_codigo,
                   ot.CreadoEn AS orden_creada,ot.ProgramadaPara AS orden_programada,
                   q.CotizacionId AS cotizacion_id,q.NumeroCotizacion AS cotizacion_numero,
                   q.EstadoCotizacion AS cotizacion_estado,q.TotalCotizacion AS cotizacion_total,
                   q.MonedaCotizacion AS cotizacion_moneda
            FROM srv.SolicitudServicio s
            INNER JOIN crm.Cliente c ON c.ClienteId=s.ClienteId
            LEFT JOIN crm.UbicacionServicio u ON u.UbicacionServicioId=s.UbicacionServicioId
            LEFT JOIN crm.SucursalCliente sc ON sc.SucursalClienteId=u.SucursalClienteId
            INNER JOIN srv.TipoServicio ts ON ts.TipoServicioId=s.TipoServicioId
            OUTER APPLY (
                SELECT TOP (1)
                       o.OrdenTrabajoId,o.NumeroOrden,o.CreadoEn,o.ProgramadaPara,
                       eo.Nombre AS EstadoOrden,eo.Codigo AS CodigoEstadoOrden
                FROM srv.OrdenTrabajo o
                INNER JOIN srv.EstadoOrdenTrabajo eo
                        ON eo.EstadoOrdenTrabajoId=o.EstadoOrdenTrabajoId
                WHERE o.SolicitudServicioId=s.SolicitudServicioId
                ORDER BY o.OrdenTrabajoId DESC
            ) ot
            OUTER APPLY (
                SELECT TOP (1)
                       cq.CotizacionId,cq.NumeroCotizacion,cq.Estado AS EstadoCotizacion,
                       vc.Total AS TotalCotizacion,vc.Moneda AS MonedaCotizacion
                FROM cot.Cotizacion cq
                LEFT JOIN cot.VersionCotizacion vc
                       ON vc.CotizacionId=cq.CotizacionId
                      AND vc.EsActual=1
                WHERE cq.OrdenTrabajoId=ot.OrdenTrabajoId
                ORDER BY cq.CotizacionId DESC
            ) q
            WHERE s.SolicitudServicioId=? {permission}
            """,
            tuple(params),
        )
        if not item:
            return jsonify(ok=False, message="Solicitud no encontrada o sin acceso."), 404
        if session['rol']=='CLIENTE' and item.get('cotizacion_estado') in {'BORRADOR','ANULADA'}:
            for key in ('cotizacion_id','cotizacion_numero','cotizacion_estado','cotizacion_total','cotizacion_moneda'):item[key]=None
        evidencias = query_all(
            """
            SELECT EvidenciaServicioId AS id,Categoria AS categoria,Etapa AS etapa,TipoArchivo AS tipo,
                   NombreArchivo AS nombre,CONCAT('/api/archivos/evidencia/',EvidenciaServicioId) AS ruta,Descripcion,TomadaEn AS tomada,CreadoEn AS creada
            FROM srv.EvidenciaServicio
            WHERE SolicitudServicioId=? OR (OrdenTrabajoId=? AND Etapa='INICIAL')
            ORDER BY CreadoEn DESC
            """,
            (solicitud_id,item.get('orden_id')),
        )
        return jsonify(ok=True, item=item, evidencias=evidencias)
    except Exception as exc:
        return app_error(exc, "No fue posible cargar el detalle de la solicitud.")


@app.post("/api/solicitudes/<int:solicitud_id>/evidencias")
@require_session("COORDINADOR", "CLIENTE")
def api_subir_evidencia_solicitud(session, solicitud_id: int):
    file = request.files.get("archivo")
    if not file or not file.filename:
        return jsonify(ok=False, message="Selecciona una imagen, video o PDF."), 400
    try:
        prepared = prepare_upload(file)
        category = "REFERENCIA_CLIENTE" if prepared["tipo"] == "FOTO" else ("VIDEO_REFERENCIA" if prepared["tipo"] == "VIDEO" else "OTRO")
        description = (request.form.get("descripcion") or "").strip()[:600] or None
        with get_db_connection() as conn:
            cursor = conn.cursor()
            set_audit_context(cursor, session, "Carga de evidencia inicial de solicitud")
            row = evidence_storage.save(cursor,(
                    "CLIENTE" if session["rol"] == "CLIENTE" else "COORDINADOR",
                    category, prepared["tipo"], prepared["nombre"], pyodbc.Binary(prepared["contenido"]),
                    solicitud_id, None, session["usuario_id"], session.get("empleado_id"),
                    "INICIAL", prepared["mime"], prepared["tamano"], description, 0, None, None,
                ))
            conn.commit()
        evidencia_id = int(row["EvidenciaServicioId"])
        return jsonify(ok=True, message="Evidencia guardada.", ruta=evidence_url(evidencia_id), id=evidencia_id, optimizado=bool(prepared["optimizado"]), tamano=prepared["tamano"]), 201
    except ValueError as exc:
        return jsonify(ok=False, message=str(exc)), 400
    except Exception as exc:
        return app_error(exc, "No fue posible guardar la evidencia de la solicitud.")


# ---------------------------------------------------------------------------
# Órdenes de trabajo y operación
# ---------------------------------------------------------------------------
@app.get("/api/ordenes")
@require_session("COORDINADOR", "TECNICO", "CLIENTE")
def api_ordenes(session):
    return portal_listing(__import__(__name__,fromlist=["app"]),session,"ordenes")

@app.get("/api/ordenes/<int:orden_id>")
@require_session("COORDINADOR", "TECNICO", "CLIENTE")
def api_orden_detalle(session, orden_id: int):
    try:
        permission = ""
        params = [orden_id]
        if session["rol"] == "TECNICO":
            permission = "AND EXISTS(SELECT 1 FROM srv.TecnicoOrden tx WHERE tx.OrdenTrabajoId=o.OrdenTrabajoId AND tx.EmpleadoId=? AND tx.Estado IN ('ASIGNADO','CONFIRMADO','FINALIZADO'))"
            params.append(session["empleado_id"] or -1)
        elif session["rol"] == "CLIENTE":
            permission = "AND ss.ClienteId=?"
            params.append(session["cliente_id"] or -1)
        item = query_one(
            f"""
            SELECT o.OrdenTrabajoId AS id,o.SolicitudServicioId AS solicitud_id,o.NumeroOrden AS numero,o.NumeroTicketCliente AS ticket,
                   o.NumeroOrdenPapel AS orden_papel,c.NombreComercial AS cliente,sc.Nombre AS sede,
                   ub.Direccion,ub.Municipio,ub.Departamento,ts.Nombre AS tipo,ss.DescripcionProblema AS solicitud,
                   ss.NivelUrgencia AS urgencia_solicitud,ss.FechaPreferida AS fecha_preferida,
                   eo.EstadoOrdenTrabajoId AS estado_id,eo.Codigo AS estado_codigo,eo.Nombre AS estado,eo.EsFinal AS es_final,
                   o.Prioridad,o.ProgramadaPara AS programada,o.IniciadaEn,o.FinalizadaEn,o.CerradaEn,
                   o.RequiereCorreccion AS requiere_correccion,o.MotivoCorreccion AS motivo_correccion,
                   o.ObservacionesCoordinacion AS observaciones
            FROM srv.OrdenTrabajo o
            INNER JOIN srv.SolicitudServicio ss ON ss.SolicitudServicioId=o.SolicitudServicioId
            INNER JOIN crm.Cliente c ON c.ClienteId=ss.ClienteId
            LEFT JOIN crm.UbicacionServicio ub ON ub.UbicacionServicioId=ss.UbicacionServicioId
            LEFT JOIN crm.SucursalCliente sc ON sc.SucursalClienteId=ub.SucursalClienteId
            INNER JOIN srv.TipoServicio ts ON ts.TipoServicioId=ss.TipoServicioId
            INNER JOIN srv.EstadoOrdenTrabajo eo ON eo.EstadoOrdenTrabajoId=o.EstadoOrdenTrabajoId
            WHERE o.OrdenTrabajoId=? {permission}
            """,
            tuple(params),
        )
        if not item:
            return jsonify(ok=False, message="Orden no encontrada o sin acceso."), 404

        tecnicos = query_all(
            """
            SELECT t.TecnicoOrdenId AS id,e.EmpleadoId AS empleado_id,
                   LTRIM(RTRIM(CONCAT(p.Nombres,N' ',p.Apellidos))) AS nombre,
                   t.FuncionCuadrilla AS funcion,t.Estado AS estado,t.AsignadoEn AS asignado_en,t.DesasignadoEn AS desasignado_en,
                   e.Disponibilidad AS disponibilidad
            FROM srv.TecnicoOrden t
            INNER JOIN rh.Empleado e ON e.EmpleadoId=t.EmpleadoId
            INNER JOIN rh.Persona p ON p.PersonaId=e.PersonaId
            WHERE t.OrdenTrabajoId=?
            ORDER BY CASE WHEN t.Estado='ASIGNADO' THEN 0 ELSE 1 END,t.AsignadoEn
            """, (orden_id,))
        actividades = query_all(
            """
            SELECT TOP (100) a.ActividadServicioId AS id,a.NumeroSecuencia AS secuencia,a.Descripcion,a.Resultado,
                   a.RealizadaEn AS realizada,LTRIM(RTRIM(CONCAT(p.Nombres,N' ',p.Apellidos))) AS empleado
            FROM srv.ActividadServicio a
            INNER JOIN rh.Empleado e ON e.EmpleadoId=a.EmpleadoId
            INNER JOIN rh.Persona p ON p.PersonaId=e.PersonaId
            WHERE a.OrdenTrabajoId=? ORDER BY a.NumeroSecuencia,a.RealizadaEn
            """, (orden_id,))
        incidencias = query_all(
            """
            SELECT TOP (100) IncidenciaOrdenId AS id,TipoIncidencia AS tipo,Descripcion,AccionTomada AS accion,
                   Estado,ResponsableUsuarioId AS responsable_usuario_id,ReportadaEn AS fecha,ResueltaEn AS resuelta
            FROM srv.IncidenciaOrden WHERE OrdenTrabajoId=? AND JSON_VALUE(CASE WHEN ISJSON(AccionTomada)=1 THEN AccionTomada ELSE '{}' END,'$.portal_tipo') IS NULL ORDER BY ReportadaEn DESC
            """, (orden_id,))
        historial = query_all(
            """
            SELECT TOP (100) h.HistorialEstadoOrdenId AS id,ea.Nombre AS anterior,en.Nombre AS nuevo,
                   h.FechaCambio AS fecha,h.Comentario
            FROM srv.HistorialEstadoOrden h
            LEFT JOIN srv.EstadoOrdenTrabajo ea ON ea.EstadoOrdenTrabajoId=h.EstadoAnteriorId
            INNER JOIN srv.EstadoOrdenTrabajo en ON en.EstadoOrdenTrabajoId=h.EstadoNuevoId
            WHERE h.OrdenTrabajoId=? ORDER BY h.FechaCambio DESC
            """, (orden_id,))
        evidencias = query_all(
            """
            SELECT TOP (150) EvidenciaServicioId AS id,Categoria AS categoria,Etapa AS etapa,TipoArchivo AS tipo,
                   NombreArchivo AS nombre,CONCAT('/api/archivos/evidencia/',EvidenciaServicioId) AS ruta,Descripcion,TomadaEn AS tomada,CreadoEn AS creada
            FROM srv.EvidenciaServicio
            WHERE OrdenTrabajoId=?
               OR SolicitudServicioId=(SELECT SolicitudServicioId FROM srv.OrdenTrabajo WHERE OrdenTrabajoId=?)
            ORDER BY CreadoEn DESC
            """, (orden_id, orden_id))

        cambio_filter = ""
        cambio_params = [orden_id]
        if session["rol"] == "CLIENTE":
            cambio_filter = "AND (ca.InformadoPorUsuarioId IS NOT NULL OR ca.EstadoAutorizacion<>'PENDIENTE')"
        cambios_alcance = query_all(
            f"""
            SELECT TOP (100) ca.CambioAlcanceId AS id,ca.DescripcionOriginal AS original,ca.CambioDetectado AS detectado,
                   ca.Motivo AS motivo,ca.TrabajoAdicionalPropuesto AS propuesta,ca.InformadoPorUsuarioId AS informado_por,
                   ca.ContactoAutorizadorId AS contacto_autorizador_id,ca.EstadoAutorizacion AS estado,
                   ca.ObservacionesRespuesta AS respuesta,ca.RespondidoEn AS respondido,ca.CreadoEn AS creado,
                   LTRIM(RTRIM(CONCAT(p.Nombres,N' ',p.Apellidos))) AS reportado_por
            FROM srv.CambioAlcance ca
            INNER JOIN rh.Empleado e ON e.EmpleadoId=ca.ReportadoPorEmpleadoId
            INNER JOIN rh.Persona p ON p.PersonaId=e.PersonaId
            WHERE ca.OrdenTrabajoId=? {cambio_filter}
            ORDER BY ca.CreadoEn DESC
            """, tuple(cambio_params))

        equipos = query_all(
            """
            SELECT eo.EquipoOrdenId AS id,e.EquipoId AS equipo_id,e.CodigoEquipo AS codigo,e.Nombre AS nombre,
                   eo.EmpleadoResponsableId AS empleado_responsable_id,eo.AsignadoEn AS asignado_en,eo.LiberadoEn AS liberado_en,
                   eo.EstadoAlFinal AS estado_al_final,eo.Observaciones AS observaciones
            FROM eqp.EquipoOrden eo INNER JOIN eqp.Equipo e ON e.EquipoId=eo.EquipoId
            WHERE eo.OrdenTrabajoId=? ORDER BY eo.AsignadoEn
            """, (orden_id,))

        cotizaciones = query_all(
            """
            SELECT TOP (25)
                   c.CotizacionId AS id,c.NumeroCotizacion AS numero,c.NombreCotizacion AS nombre,
                   c.Estado AS estado,c.CreadoEn AS creada,
                   v.VersionCotizacionId AS version_id,v.NumeroVersion AS version,
                   v.Total AS total,v.Moneda AS moneda,v.FechaEmision AS emision,
                   v.FechaExpiracion AS expiracion,v.EnviadaEn AS enviada,
                   v.RespondidaEn AS respondida,v.ObservacionesCliente AS observaciones_cliente
            FROM cot.Cotizacion c
            LEFT JOIN cot.VersionCotizacion v
                   ON v.CotizacionId=c.CotizacionId
                  AND v.EsActual=1
            WHERE c.OrdenTrabajoId=?
            ORDER BY c.CotizacionId DESC
            """, (orden_id,))

        progress = query_one(
            """
            SELECT
              (SELECT COUNT(*) FROM srv.EvidenciaServicio ev WHERE ev.OrdenTrabajoId=? AND ev.TipoArchivo='FOTO' AND ev.Categoria='FOTO_TRABAJO') AS fotos_trabajo,
              (SELECT COUNT(*) FROM srv.EvidenciaServicio ev WHERE ev.OrdenTrabajoId=? AND (ev.Etapa='DOCUMENTO' OR ev.Categoria='ORDEN_FISICA')) AS documentos_ot,
              (SELECT COUNT(*) FROM srv.ActividadServicio ac WHERE ac.OrdenTrabajoId=?) AS actividades,
              (SELECT COUNT(*) FROM srv.IncidenciaOrden inc WHERE inc.OrdenTrabajoId=? AND inc.ResueltaEn IS NULL) AS incidencias_abiertas,
              (SELECT COUNT(*) FROM srv.CambioAlcance ca WHERE ca.OrdenTrabajoId=? AND ca.EstadoAutorizacion='PENDIENTE') AS cambios_pendientes
            """, (orden_id, orden_id, orden_id, orden_id, orden_id)) or {}

        return jsonify(
            ok=True,item=item,tecnicos=tecnicos,actividades=actividades,incidencias=incidencias,
            historial=historial,evidencias=evidencias,cambios_alcance=cambios_alcance,equipos=equipos,
            cotizaciones=([c for c in cotizaciones if c['estado'] not in {'BORRADOR','ANULADA'}] if session['rol']=='CLIENTE' else [] if session['rol']=='TECNICO' else cotizaciones),progress=progress,
            reglas_cierre={'min_fotos':min_work_photos(),'ticket_obligatorio':env_bool('OT_REQUIRE_TICKET',False)}
        )
    except Exception as exc:
        return app_error(exc, "No fue posible cargar el detalle de la orden.")


@app.post("/api/ordenes")
@require_session("COORDINADOR")
def api_crear_orden(session):
    data = request.get_json(silent=True) or {}
    try:
        solicitud_id = int(require_value(data, "solicitud_id", "Selecciona una solicitud."))
        prioridad = str(data["prioridad"]).upper() if data.get("prioridad") else None
        programada = parse_datetime_local(data.get("programada_para"), "Fecha programada de la OT")
        ticket = data.get("ticket") or None
        orden_papel = data.get("orden_papel") or None
        observaciones = data.get("observaciones") or None
        with get_db_connection() as conn:
            cursor = conn.cursor()
            set_audit_context(cursor, session, "Creación de orden de trabajo")
            row = exec_proc_row(cursor, "EXEC srv.usp_AppCrearOrden ?,?,?,?,?,?,?",
                                (solicitud_id, session["usuario_id"], prioridad, programada, ticket, orden_papel, observaciones))
            orden_id = None
            if row:
                orden_id = row.get("OrdenTrabajoId") or row.get("ordenTrabajoId") or row.get("id")
            if not orden_id:
                cursor.execute(
                    "SELECT TOP (1) OrdenTrabajoId FROM srv.OrdenTrabajo WHERE SolicitudServicioId=? ORDER BY OrdenTrabajoId DESC",
                    solicitud_id,
                )
                found = cursor.fetchone()
                orden_id = int(found[0]) if found else None

            if orden_id:
                cursor.execute(
                    """
                    INSERT INTO com.Notificacion(UsuarioId,Tipo,Titulo,Mensaje,Entidad,EntidadId,Canal,Estado)
                    SELECT DISTINCT u.UsuarioId,'SOLICITUD_A_OT',N'Solicitud convertida a orden de trabajo',
                           CONCAT(N'Tu solicitud #',s.SolicitudServicioId,N' fue convertida en la OT ',o.NumeroOrden,
                                  N'. Estado actual: ',eo.Nombre,N'.'),
                           'OrdenTrabajo',CONVERT(nvarchar(80),o.OrdenTrabajoId),'SISTEMA','PENDIENTE'
                    FROM srv.OrdenTrabajo o
                    INNER JOIN srv.SolicitudServicio s ON s.SolicitudServicioId=o.SolicitudServicioId
                    INNER JOIN srv.EstadoOrdenTrabajo eo ON eo.EstadoOrdenTrabajoId=o.EstadoOrdenTrabajoId
                    INNER JOIN crm.ContactoCliente cc ON cc.ClienteId=s.ClienteId AND cc.Activo=1
                    INNER JOIN seg.Usuario u ON u.ContactoClienteId=cc.ContactoClienteId AND u.Activo=1
                    WHERE o.OrdenTrabajoId=?
                    """,
                    orden_id,
                )
            conn.commit()
        if orden_id:
            push_order_created(int(orden_id))
        return jsonify(ok=True, message="Orden de trabajo creada y seguimiento actualizado.", item=row), 201
    except ValueError as exc:
        return jsonify(ok=False, message=str(exc)), 400
    except Exception as exc:
        return app_error(exc, "No fue posible crear la orden de trabajo.")


@app.post("/api/ordenes/<int:orden_id>/tecnicos")
@require_session("COORDINADOR")
def api_asignar_tecnico(session, orden_id: int):
    data = request.get_json(silent=True) or {}
    try:
        empleado_id = int(require_value(data, "empleado_id", "Selecciona un técnico."))
        funcion = str(data.get("funcion") or "TECNICO")[:100]
        with get_db_connection() as conn:
            cursor = conn.cursor()
            set_audit_context(cursor, session, "Asignación de técnico a OT")
            row = exec_proc_row(cursor, "EXEC srv.usp_AppAsignarTecnico ?,?,?,?",
                                (orden_id, empleado_id, session["usuario_id"], funcion))
            cursor.execute(
                """
                INSERT INTO com.Notificacion(UsuarioId,Tipo,Titulo,Mensaje,Entidad,EntidadId,Canal,Estado)
                SELECT u.UsuarioId,N'ASIGNACION_OT',N'Nueva orden asignada',
                       CONCAT(N'Fuiste asignado a la OT ',o.NumeroOrden,N' como ',?,N'.'),
                       N'OrdenTrabajo',CONVERT(nvarchar(80),o.OrdenTrabajoId),N'SISTEMA',N'PENDIENTE'
                FROM seg.Usuario u CROSS JOIN srv.OrdenTrabajo o
                WHERE u.EmpleadoId=? AND u.Activo=1 AND o.OrdenTrabajoId=?
                  AND NOT EXISTS(
                    SELECT 1 FROM com.Notificacion n
                    WHERE n.UsuarioId=u.UsuarioId AND n.Tipo=N'ASIGNACION_OT'
                      AND n.Entidad=N'OrdenTrabajo' AND n.EntidadId=CONVERT(nvarchar(80),o.OrdenTrabajoId)
                      AND n.LeidaEn IS NULL
                  )
                """,
                funcion, empleado_id, orden_id,
            )
            conn.commit()
        push_crew_updated(orden_id, session["usuario_id"], target_employee_ids=[empleado_id])
        return jsonify(ok=True, message="Técnico asignado.", item=row)
    except ValueError as exc:
        return jsonify(ok=False, message=str(exc)), 400
    except Exception as exc:
        return app_error(exc, "No fue posible asignar el técnico.")


@app.patch("/api/ordenes/<int:orden_id>")
@require_session("COORDINADOR", "TECNICO")
def api_editar_orden(session, orden_id: int):
    data = request.get_json(silent=True) or {}
    try:
        if session["rol"] == "TECNICO":
            access = query_one(
                "SELECT TOP 1 1 AS ok FROM srv.TecnicoOrden WHERE OrdenTrabajoId=? AND EmpleadoId=? AND Estado='ASIGNADO'",
                (orden_id, session["empleado_id"] or -1),
            )
            if not access:
                return jsonify(ok=False, message="Esta OT no está asignada a tu usuario."), 403
            allowed = {"ticket", "orden_papel"}
        else:
            allowed = {"prioridad", "programada_para", "ticket", "orden_papel", "observaciones"}

        provided = {k: data.get(k) for k in allowed if k in data}
        if not provided:
            return jsonify(ok=False, message="No se recibieron cambios permitidos."), 400

        assignments = []
        values = []
        if "prioridad" in provided:
            priority = str(provided["prioridad"] or "").upper()
            if priority not in {"BAJA","MEDIA","ALTA","CRITICA"}:
                raise ValueError("Prioridad inválida.")
            assignments.append("Prioridad=?"); values.append(priority)
        if "programada_para" in provided:
            scheduled = parse_datetime_local(provided["programada_para"], "Fecha aproximada de atención")
            assignments.append("ProgramadaPara=?"); values.append(scheduled)
        if "ticket" in provided:
            assignments.append("NumeroTicketCliente=?"); values.append((str(provided["ticket"]).strip()[:60] or None) if provided["ticket"] is not None else None)
        if "orden_papel" in provided:
            assignments.append("NumeroOrdenPapel=?"); values.append((str(provided["orden_papel"]).strip()[:60] or None) if provided["orden_papel"] is not None else None)
        if "observaciones" in provided:
            assignments.append("ObservacionesCoordinacion=?"); values.append((str(provided["observaciones"]).strip()[:900] or None) if provided["observaciones"] is not None else None)
        assignments.append("ActualizadoEn=SYSUTCDATETIME()")

        with get_db_connection() as conn:
            cursor = conn.cursor()
            set_audit_context(cursor, session, "Edición de datos operativos de OT")
            cursor.execute(f"UPDATE srv.OrdenTrabajo SET {','.join(assignments)} WHERE OrdenTrabajoId=?", *(values+[orden_id]))
            if cursor.rowcount == 0:
                conn.rollback(); return jsonify(ok=False, message="Orden no encontrada."), 404

            # La fecha determina PENDIENTE/PROGRAMADA solo antes de iniciar la ejecución.
            if session["rol"] == "COORDINADOR" and "programada_para" in provided:
                cursor.execute(
                    """
                    SELECT eo.Codigo,o.ProgramadaPara FROM srv.OrdenTrabajo o
                    INNER JOIN srv.EstadoOrdenTrabajo eo ON eo.EstadoOrdenTrabajoId=o.EstadoOrdenTrabajoId
                    WHERE o.OrdenTrabajoId=?
                    """, orden_id)
                current = cursor.fetchone()
                if current and str(current.Codigo).upper() in {"PENDIENTE","PROGRAMADA"}:
                    wanted = "PROGRAMADA" if current.ProgramadaPara is not None else "PENDIENTE"
                    if str(current.Codigo).upper() != wanted:
                        cursor.execute("SELECT TOP 1 EstadoOrdenTrabajoId FROM srv.EstadoOrdenTrabajo WHERE Codigo=? AND Activo=1", wanted)
                        target = cursor.fetchone()
                        if target:
                            exec_proc_row(cursor,"EXEC srv.usp_AppCambiarEstadoOrden ?,?,?,?",(orden_id,int(target[0]),session["usuario_id"],"Reprogramación desde portal web"))
            conn.commit()
        return jsonify(ok=True, message="Datos de la orden actualizados.")
    except ValueError as exc:
        return jsonify(ok=False, message=str(exc)), 400
    except Exception as exc:
        return app_error(exc, "No fue posible actualizar la orden.")


@app.put("/api/ordenes/<int:orden_id>/cuadrilla")
@require_session("COORDINADOR")
def api_actualizar_cuadrilla(session, orden_id: int):
    data = request.get_json(silent=True) or {}
    members = data.get("integrantes")
    try:
        if not isinstance(members, list) or not members:
            raise ValueError("Selecciona al menos un integrante de la cuadrilla.")
        normalized = []
        seen = set()
        for raw in members:
            employee_id = int(raw.get("empleado_id"))
            function = str(raw.get("funcion") or "TECNICO").upper()
            if function not in {"ENCARGADO","TECNICO","APOYO"}:
                raise ValueError("La función de cuadrilla no es válida.")
            if employee_id in seen:
                raise ValueError("Un técnico no puede repetirse en la cuadrilla.")
            seen.add(employee_id)
            normalized.append((employee_id,function))
        if sum(1 for _,f in normalized if f=="ENCARGADO") != 1:
            raise ValueError("La cuadrilla debe tener exactamente un ENCARGADO.")

        with get_db_connection() as conn:
            cursor = conn.cursor()
            set_audit_context(cursor, session, "Actualización completa de cuadrilla de OT")
            cursor.execute("SELECT 1 FROM srv.OrdenTrabajo WHERE OrdenTrabajoId=?", orden_id)
            if not cursor.fetchone():
                conn.rollback(); return jsonify(ok=False,message="Orden no encontrada."),404

            ids = [m[0] for m in normalized]
            placeholders = ",".join("?" for _ in ids)
            cursor.execute(
                f"""
                SELECT e.EmpleadoId FROM rh.Empleado e INNER JOIN rh.Puesto p ON p.PuestoId=e.PuestoId
                WHERE e.EmpleadoId IN ({placeholders}) AND e.EstadoLaboral='ACTIVO' AND p.EsTecnico=1 AND p.Activo=1
                  AND e.Disponibilidad IN ('DISPONIBLE','ASIGNADO')
                """, *ids)
            valid = {int(r[0]) for r in cursor.fetchall()}
            invalid = [i for i in ids if i not in valid]
            if invalid:
                raise ValueError("Uno o más integrantes no pueden asignarse: deben estar activos, habilitados para trabajo técnico y no estar de vacaciones/inactivos.")

            cursor.execute("SELECT EmpleadoId FROM srv.TecnicoOrden WHERE OrdenTrabajoId=? AND Estado='ASIGNADO'", orden_id)
            current_ids = {int(r[0]) for r in cursor.fetchall()}
            removed = current_ids.difference(ids)
            if removed:
                rem_ph = ",".join("?" for _ in removed)
                cursor.execute(
                    f"""
                    UPDATE srv.TecnicoOrden SET Estado='CANCELADO',DesasignadoEn=SYSUTCDATETIME()
                    WHERE OrdenTrabajoId=? AND EmpleadoId IN ({rem_ph}) AND Estado='ASIGNADO'
                    """, orden_id, *removed)
                cursor.execute(
                    f"""
                    INSERT INTO com.Notificacion(UsuarioId,Tipo,Titulo,Mensaje,Entidad,EntidadId,Canal,Estado)
                    SELECT DISTINCT u.UsuarioId,N'DESASIGNACION_OT',N'Cambio en tu asignación',
                           CONCAT(N'Fuiste retirado de la cuadrilla de la OT ',o.NumeroOrden,N'.'),
                           N'OrdenTrabajo',CONVERT(nvarchar(80),o.OrdenTrabajoId),N'SISTEMA',N'PENDIENTE'
                    FROM seg.Usuario u CROSS JOIN srv.OrdenTrabajo o
                    WHERE u.Activo=1 AND u.EmpleadoId IN ({rem_ph}) AND o.OrdenTrabajoId=?
                    """, *removed, orden_id)

            for employee_id,function in normalized:
                exec_proc_row(cursor,"EXEC srv.usp_AppAsignarTecnico ?,?,?,?",(orden_id,employee_id,session["usuario_id"],function))

            cursor.execute(
                """
                INSERT INTO com.Notificacion(UsuarioId,Tipo,Titulo,Mensaje,Entidad,EntidadId,Canal,Estado)
                SELECT DISTINCT u.UsuarioId,N'ASIGNACION_OT',N'Orden de trabajo asignada',
                       CONCAT(N'Formas parte de la cuadrilla de la OT ',o.NumeroOrden,N' como ',t.FuncionCuadrilla,N'.'),
                       N'OrdenTrabajo',CONVERT(nvarchar(80),o.OrdenTrabajoId),N'SISTEMA',N'PENDIENTE'
                FROM srv.TecnicoOrden t
                INNER JOIN seg.Usuario u ON u.EmpleadoId=t.EmpleadoId AND u.Activo=1
                INNER JOIN srv.OrdenTrabajo o ON o.OrdenTrabajoId=t.OrdenTrabajoId
                WHERE t.OrdenTrabajoId=? AND t.Estado='ASIGNADO'
                  AND NOT EXISTS(
                    SELECT 1 FROM com.Notificacion n
                    WHERE n.UsuarioId=u.UsuarioId AND n.Tipo=N'ASIGNACION_OT'
                      AND n.Entidad=N'OrdenTrabajo' AND n.EntidadId=CONVERT(nvarchar(80),o.OrdenTrabajoId)
                      AND n.LeidaEn IS NULL
                  )
                """,
                orden_id,
            )

            # Liberar a los retirados únicamente si no siguen asignados a otra OT abierta.
            for employee_id in removed:
                cursor.execute(
                    """
                    IF NOT EXISTS(
                        SELECT 1 FROM srv.TecnicoOrden t
                        INNER JOIN srv.OrdenTrabajo o ON o.OrdenTrabajoId=t.OrdenTrabajoId
                        INNER JOIN srv.EstadoOrdenTrabajo eo ON eo.EstadoOrdenTrabajoId=o.EstadoOrdenTrabajoId
                        WHERE t.EmpleadoId=? AND t.Estado='ASIGNADO' AND eo.EsFinal=0
                    )
                    UPDATE rh.Empleado SET Disponibilidad='DISPONIBLE',ActualizadoEn=SYSUTCDATETIME()
                    WHERE EmpleadoId=? AND EstadoLaboral='ACTIVO' AND Disponibilidad='ASIGNADO'
                    """, employee_id, employee_id)
            conn.commit()
        if removed:
            push_removed_technicians(orden_id, removed)
        push_crew_updated(orden_id, session["usuario_id"])
        return jsonify(ok=True,message="Cuadrilla actualizada correctamente.",integrantes=len(normalized))
    except ValueError as exc:
        return jsonify(ok=False,message=str(exc)),400
    except Exception as exc:
        return app_error(exc,"No fue posible actualizar la cuadrilla.")


@app.post("/api/ordenes/<int:orden_id>/estado")
@require_session("COORDINADOR", "TECNICO")
def api_cambiar_estado(session, orden_id: int):
    data = request.get_json(silent=True) or {}
    try:
        estado_id = int(require_value(data, "estado_id", "Selecciona el nuevo estado."))
        comentario = str(data.get("comentario") or "Cambio desde portal web")[:600]
        target_state = query_one("SELECT Codigo AS codigo FROM srv.EstadoOrdenTrabajo WHERE EstadoOrdenTrabajoId=? AND Activo=1", (estado_id,))
        if not target_state:
            return jsonify(ok=False,message="El estado seleccionado no existe."),400
        target_code = str(target_state.get("codigo") or "").upper()
        current = query_one(
            """
            SELECT eo.Codigo AS codigo FROM srv.OrdenTrabajo o
            INNER JOIN srv.EstadoOrdenTrabajo eo ON eo.EstadoOrdenTrabajoId=o.EstadoOrdenTrabajoId
            WHERE o.OrdenTrabajoId=?
            """, (orden_id,))
        if not current:
            return jsonify(ok=False,message="Orden no encontrada."),404
        current_code = str(current.get("codigo") or "").upper()
        allowed_states={'PENDIENTE':{'PROGRAMADA','EN_PROCESO','CANCELADA'},'PROGRAMADA':{'EN_PROCESO','CANCELADA'},'EN_PROCESO':{'POR_CONFIRMAR','COMPLETADA','CANCELADA'},'POR_CONFIRMAR':{'COMPLETADA','CANCELADA'}}
        if target_code not in allowed_states.get(current_code,set()): raise Conflict("Ese cambio no corresponde al estado actual de la orden.")
        if target_code=='CANCELADA' and len(str(data.get('comentario') or '').strip())<5: raise ValueError("Indica el motivo de cancelación.")

        if session["rol"] == "TECNICO":
            access = query_one("SELECT TOP 1 1 AS ok FROM srv.TecnicoOrden WHERE OrdenTrabajoId=? AND EmpleadoId=? AND Estado='ASIGNADO'", (orden_id, session["empleado_id"] or -1))
            if not access:
                return jsonify(ok=False, message="Esta orden no está asignada a tu usuario."), 403
            allowed = {
                "PENDIENTE": {"EN_PROCESO"},
                "PROGRAMADA": {"EN_PROCESO"},
                "EN_PROCESO": {"COMPLETADA"},
                "POR_CONFIRMAR": {"COMPLETADA"},
            }
            if target_code not in allowed.get(current_code,set()):
                return jsonify(ok=False,message="Ese cambio de estado no corresponde al flujo del técnico."),403

        # Cola operativa: una persona puede quedar asignada a varias OTs, pero no ejecutar dos a la vez.
        # La asignación adicional permanece pendiente/programada y se considera trabajo en cola.
        if target_code == "EN_PROCESO":
            busy = query_all(
                """
                SELECT DISTINCT
                       e.EmpleadoId AS empleado_id,
                       LTRIM(RTRIM(CONCAT(p.Nombres,N' ',p.Apellidos))) AS empleado,
                       otra.NumeroOrden AS orden_activa
                FROM srv.TecnicoOrden actual
                INNER JOIN rh.Empleado e ON e.EmpleadoId=actual.EmpleadoId
                INNER JOIN rh.Persona p ON p.PersonaId=e.PersonaId
                CROSS APPLY (
                    SELECT TOP (1) o2.NumeroOrden,o2.OrdenTrabajoId
                    FROM srv.TecnicoOrden t2
                    INNER JOIN srv.OrdenTrabajo o2 ON o2.OrdenTrabajoId=t2.OrdenTrabajoId
                    INNER JOIN srv.EstadoOrdenTrabajo eo2 ON eo2.EstadoOrdenTrabajoId=o2.EstadoOrdenTrabajoId
                    WHERE t2.EmpleadoId=actual.EmpleadoId
                      AND t2.OrdenTrabajoId<>?
                      AND t2.Estado IN ('ASIGNADO','CONFIRMADO')
                      AND eo2.Codigo='EN_PROCESO'
                    ORDER BY COALESCE(o2.IniciadaEn,t2.AsignadoEn),o2.OrdenTrabajoId
                ) otra
                WHERE actual.OrdenTrabajoId=?
                  AND actual.Estado IN ('ASIGNADO','CONFIRMADO')
                """,
                (orden_id, orden_id),
            )
            if busy:
                detail = "; ".join(
                    f"{row.get('empleado') or 'Técnico'} está atendiendo {row.get('orden_activa') or 'otra OT'}"
                    for row in busy[:4]
                )
                return jsonify(
                    ok=False,
                    message=f"Esta OT está en cola y todavía no puede iniciarse. {detail}. Finaliza el trabajo actual o ajusta la cuadrilla.",
                    codigo="TECNICO_CON_OT_EN_PROCESO",
                    ocupados=busy,
                ), 409

        # Flujo actual: el técnico finaliza la OT en 4 pasos.
        # La cotización es independiente y puede existir antes o después del cierre.
        if target_code == "COMPLETADA" and session["rol"] in {"COORDINADOR", "TECNICO"}:
            closure = query_one(
                """
                SELECT
                  o.NumeroTicketCliente AS ticket,
                  o.NumeroOrdenPapel AS orden_papel,
                  (SELECT COUNT(*) FROM srv.EvidenciaServicio WHERE OrdenTrabajoId=? AND TipoArchivo='FOTO' AND Categoria='FOTO_TRABAJO') AS fotos,
                  (SELECT COUNT(*) FROM srv.ActividadServicio WHERE OrdenTrabajoId=?) AS actividades,
                  (SELECT COUNT(*) FROM srv.EvidenciaServicio WHERE OrdenTrabajoId=? AND (Etapa='DOCUMENTO' OR Categoria='ORDEN_FISICA')) AS documentos,
                  (SELECT COUNT(*) FROM srv.CambioAlcance WHERE OrdenTrabajoId=? AND EstadoAutorizacion='PENDIENTE') AS cambios_pendientes
                FROM srv.OrdenTrabajo o
                WHERE o.OrdenTrabajoId=?
                """, (orden_id,orden_id,orden_id,orden_id,orden_id)) or {}
            if env_bool("OT_REQUIRE_TICKET",False) and not str(closure.get("ticket") or "").strip():
                return jsonify(ok=False,message="Paso 1 pendiente: registra el número de ticket antes de finalizar la OT."),409
            has_paper_number = bool(str(closure.get("orden_papel") or "").strip())
            has_paper_file = int(closure.get("documentos") or 0) > 0
            # La hoja física es opcional. Si se usa, número y respaldo deben existir juntos.
            if has_paper_number and not has_paper_file:
                return jsonify(ok=False,message="La OT/OC física tiene número registrado; adjunta también su foto o PDF para validarla."),409
            if has_paper_file and not has_paper_number:
                return jsonify(ok=False,message="Se adjuntó una OT/OC física; registra también su número para completar el respaldo."),409
            if int(closure.get("fotos") or 0) < min_work_photos():
                return jsonify(ok=False,message=f"Paso 2 pendiente: se requieren al menos {min_work_photos()} fotos del trabajo. Actualmente hay {int(closure.get('fotos') or 0)}."),409
            if int(closure.get("actividades") or 0) < 1:
                return jsonify(ok=False,message="Paso 3 pendiente: registra la descripción y observaciones del servicio."),409
            if int(closure.get("cambios_pendientes") or 0) > 0:
                return jsonify(ok=False,message="Hay cambios de alcance pendientes de respuesta. Resuélvelos antes de finalizar la OT."),409

        # Compatibilidad con órdenes antiguas que todavía utilicen POR_CONFIRMAR.
        if target_code == "POR_CONFIRMAR":
            progress = query_one(
                """
                SELECT
                  (SELECT COUNT(*) FROM srv.EvidenciaServicio WHERE OrdenTrabajoId=? AND TipoArchivo='FOTO' AND Categoria='FOTO_TRABAJO') AS fotos,
                  (SELECT COUNT(*) FROM srv.ActividadServicio WHERE OrdenTrabajoId=?) AS actividades,
                  (SELECT COUNT(*) FROM srv.EvidenciaServicio WHERE OrdenTrabajoId=? AND (Etapa='DOCUMENTO' OR Categoria='ORDEN_FISICA')) AS documentos,
                  (SELECT COUNT(*) FROM srv.CambioAlcance WHERE OrdenTrabajoId=? AND EstadoAutorizacion='PENDIENTE') AS cambios_pendientes
                """, (orden_id,orden_id,orden_id,orden_id)) or {}
            photos=int(progress.get("fotos") or 0); activities=int(progress.get("actividades") or 0); documents=int(progress.get("documentos") or 0)
            if photos < min_work_photos():
                return jsonify(ok=False,message=f"Faltan evidencias: se requieren al menos {min_work_photos()} fotos del trabajo. Actualmente hay {photos}."),409
            if activities < 1 and documents < 1:
                return jsonify(ok=False,message="Registra al menos una actividad realizada o adjunta la OT/documento físico antes de enviar a confirmación."),409
            if int(progress.get("cambios_pendientes") or 0) > 0:
                return jsonify(ok=False,message="Hay cambios de alcance pendientes de respuesta. Resuélvelos antes de enviar el servicio a confirmación."),409

        with get_db_connection() as conn:
            cursor = conn.cursor()
            set_audit_context(cursor, session, "Cambio de estado de OT")
            cursor.execute("EXEC sys.sp_set_session_context @key=N'OT_MIN_WORK_PHOTOS',@value=?; EXEC sys.sp_set_session_context @key=N'OT_REQUIRE_TICKET',@value=?",min_work_photos(),int(env_bool('OT_REQUIRE_TICKET',False)))
            while cursor.nextset():pass
            row = exec_proc_row(cursor, "EXEC srv.usp_AppCambiarEstadoOrden ?,?,?,?", (orden_id, estado_id, session["usuario_id"], comentario))
            cursor.execute(
                """
                ;WITH Destinatarios AS (
                    SELECT DISTINCT u.UsuarioId
                    FROM seg.Usuario u
                    WHERE u.Activo=1 AND (
                        u.UsuarioId=(SELECT CoordinadorUsuarioId FROM srv.OrdenTrabajo WHERE OrdenTrabajoId=?)
                        OR u.EmpleadoId IN (SELECT EmpleadoId FROM srv.TecnicoOrden WHERE OrdenTrabajoId=? AND Estado='ASIGNADO')
                        OR u.ContactoClienteId IN (
                            SELECT cc.ContactoClienteId
                            FROM srv.OrdenTrabajo o
                            INNER JOIN srv.SolicitudServicio ss ON ss.SolicitudServicioId=o.SolicitudServicioId
                            INNER JOIN crm.ContactoCliente cc ON cc.ClienteId=ss.ClienteId AND cc.Activo=1
                            WHERE o.OrdenTrabajoId=?
                        )
                    )
                )
                INSERT INTO com.Notificacion(UsuarioId,Tipo,Titulo,Mensaje,Entidad,EntidadId,Canal,Estado)
                SELECT d.UsuarioId,N'ESTADO_OT',N'Actualización de orden de trabajo',
                       CONCAT(N'La OT ',o.NumeroOrden,N' cambió a ',eo.Nombre,N'.'),
                       N'OrdenTrabajo',CONVERT(nvarchar(80),o.OrdenTrabajoId),N'SISTEMA',N'PENDIENTE'
                FROM Destinatarios d
                INNER JOIN srv.OrdenTrabajo o ON o.OrdenTrabajoId=?
                INNER JOIN srv.EstadoOrdenTrabajo eo ON eo.EstadoOrdenTrabajoId=o.EstadoOrdenTrabajoId
                WHERE d.UsuarioId<>?
                """,
                orden_id,orden_id,orden_id,orden_id,session["usuario_id"],
            )
            if target_code == "COMPLETADA":
                cursor.execute(
                    """
                    ;WITH Integrantes AS (
                        SELECT DISTINCT EmpleadoId
                        FROM srv.TecnicoOrden
                        WHERE OrdenTrabajoId=? AND Estado IN ('ASIGNADO','CONFIRMADO','FINALIZADO')
                    ), Candidatas AS (
                        SELECT i.EmpleadoId,o2.OrdenTrabajoId,o2.NumeroOrden,s2.Clasificacion,o2.Prioridad,o2.ProgramadaPara,t2.AsignadoEn,
                               ROW_NUMBER() OVER (
                                   PARTITION BY i.EmpleadoId
                                   ORDER BY CASE WHEN s2.Clasificacion='EMERGENCIA' THEN 0 ELSE 1 END,
                                            CASE o2.Prioridad WHEN 'CRITICA' THEN 0 WHEN 'ALTA' THEN 1 WHEN 'MEDIA' THEN 2 WHEN 'BAJA' THEN 3 ELSE 4 END,
                                            CASE WHEN o2.ProgramadaPara IS NULL THEN 1 ELSE 0 END,
                                            o2.ProgramadaPara,t2.AsignadoEn,o2.OrdenTrabajoId
                               ) AS rn
                        FROM Integrantes i
                        INNER JOIN srv.TecnicoOrden t2 ON t2.EmpleadoId=i.EmpleadoId AND t2.Estado IN ('ASIGNADO','CONFIRMADO')
                        INNER JOIN srv.OrdenTrabajo o2 ON o2.OrdenTrabajoId=t2.OrdenTrabajoId
                        INNER JOIN srv.EstadoOrdenTrabajo e2 ON e2.EstadoOrdenTrabajoId=o2.EstadoOrdenTrabajoId
                        INNER JOIN srv.SolicitudServicio s2 ON s2.SolicitudServicioId=o2.SolicitudServicioId
                        WHERE o2.OrdenTrabajoId<>? AND e2.EsFinal=0 AND e2.Codigo<>'EN_PROCESO'
                    )
                    INSERT INTO com.Notificacion(UsuarioId,Tipo,Titulo,Mensaje,Entidad,EntidadId,Canal,Estado)
                    SELECT u.UsuarioId,N'SIGUIENTE_OT',N'Siguiente servicio en cola',
                           CONCAT(N'Tu siguiente servicio es la OT ',c.NumeroOrden,
                                  CASE WHEN c.Clasificacion='EMERGENCIA' THEN N' · EMERGENCIA' ELSE N'' END,
                                  N' · prioridad ',c.Prioridad,N'.'),
                           N'OrdenTrabajo',CONVERT(nvarchar(80),c.OrdenTrabajoId),N'SISTEMA',N'PENDIENTE'
                    FROM Candidatas c
                    INNER JOIN seg.Usuario u ON u.EmpleadoId=c.EmpleadoId AND u.Activo=1
                    WHERE c.rn=1
                      AND NOT EXISTS(
                          SELECT 1 FROM com.Notificacion n
                          WHERE n.UsuarioId=u.UsuarioId AND n.Tipo=N'SIGUIENTE_OT'
                            AND n.Entidad=N'OrdenTrabajo' AND n.EntidadId=CONVERT(nvarchar(80),c.OrdenTrabajoId)
                            AND n.Estado IN (N'PENDIENTE',N'ENVIADA') AND n.LeidaEn IS NULL
                      )
                    """,
                    orden_id, orden_id,
                )
            conn.commit()
        push_order_state_changed(orden_id, target_code, session)
        return jsonify(ok=True, message="Estado actualizado.", item=row)
    except ValueError as exc:
        return jsonify(ok=False, message=str(exc)), 400
    except Exception as exc:
        return app_error(exc, "No fue posible cambiar el estado.")


@app.post("/api/ordenes/<int:orden_id>/confirmar")
@require_session("CLIENTE")
def api_confirmar_orden_cliente(session, orden_id):
    return jsonify(ok=False,message="La finalización corresponde al técnico o coordinador autorizado."),403


@app.post("/api/ordenes/<int:orden_id>/actividades")
@require_session("COORDINADOR", "TECNICO")
def api_registrar_actividad(session, orden_id: int):
    data = request.get_json(silent=True) or {}
    try:
        empleado_id = session["empleado_id"] if session["rol"] == "TECNICO" else int(require_value(data, "empleado_id", "Selecciona el empleado que realizó la actividad."))
        descripcion = str(require_value(data, "descripcion", "Describe la actividad realizada.")).strip()
        resultado = data.get("resultado") or None
        with get_db_connection() as conn:
            cursor = conn.cursor()
            set_audit_context(cursor, session, "Registro de actividad de servicio")
            row = exec_proc_row(cursor, "EXEC srv.usp_AppRegistrarActividad ?,?,?,?",
                                (orden_id, empleado_id, descripcion, resultado))
            conn.commit()
        return jsonify(ok=True, message="Actividad registrada.", item=row), 201
    except ValueError as exc:
        return jsonify(ok=False, message=str(exc)), 400
    except Exception as exc:
        return app_error(exc, "No fue posible registrar la actividad.")


@app.post("/api/ordenes/<int:orden_id>/incidencias")
@require_session("COORDINADOR", "TECNICO")
def api_registrar_incidencia(session, orden_id: int):
    data = request.get_json(silent=True) or {}
    try:
        empleado_id = session["empleado_id"] if session["rol"] == "TECNICO" else data.get("empleado_id")
        tipo = str(data.get("tipo") or "OTRA").upper()[:30]
        descripcion = str(require_value(data, "descripcion", "Describe la incidencia.")).strip()
        with get_db_connection() as conn:
            cursor = conn.cursor()
            set_audit_context(cursor, session, "Registro de incidencia de OT")
            row = exec_proc_row(cursor, "EXEC srv.usp_AppRegistrarIncidencia ?,?,?,?,?,?",
                                (orden_id, empleado_id, tipo, descripcion, session["usuario_id"], data.get("accion") or None))
            conn.commit()
        return jsonify(ok=True, message="Incidencia registrada.", item=row), 201
    except ValueError as exc:
        return jsonify(ok=False, message=str(exc)), 400
    except Exception as exc:
        return app_error(exc, "No fue posible registrar la incidencia.")


@app.patch("/api/ordenes/<int:orden_id>/incidencias/<int:incidencia_id>/resolver")
@require_session("COORDINADOR")
def api_resolver_incidencia(session, orden_id: int, incidencia_id: int):
    data = request.get_json(silent=True) or {}
    try:
        accion = str(require_value(data,"accion","Describe la acción tomada para resolver la incidencia.")).strip()[:900]
        with get_db_connection() as conn:
            cursor=conn.cursor(); set_audit_context(cursor,session,"Resolución de incidencia de OT")
            cursor.execute(
                """
                UPDATE srv.IncidenciaOrden
                SET AccionTomada=?,Estado='RESUELTA',ResponsableUsuarioId=?,ResueltaEn=SYSUTCDATETIME()
                WHERE IncidenciaOrdenId=? AND OrdenTrabajoId=?
                """, accion,session["usuario_id"],incidencia_id,orden_id)
            if cursor.rowcount==0:
                conn.rollback(); return jsonify(ok=False,message="Incidencia no encontrada."),404
            conn.commit()
        return jsonify(ok=True,message="Incidencia resuelta.")
    except ValueError as exc:
        return jsonify(ok=False,message=str(exc)),400
    except Exception as exc:
        return app_error(exc,"No fue posible resolver la incidencia.")


@app.post("/api/ordenes/<int:orden_id>/cambios-alcance")
@require_session("COORDINADOR", "TECNICO")
def api_crear_cambio_alcance(session, orden_id: int):
    data=request.get_json(silent=True) or {}
    try:
        if session["rol"]=="TECNICO":
            empleado_id=session["empleado_id"] or -1
            access=query_one("SELECT TOP 1 1 AS ok FROM srv.TecnicoOrden WHERE OrdenTrabajoId=? AND EmpleadoId=? AND Estado='ASIGNADO'",(orden_id,empleado_id))
            if not access: return jsonify(ok=False,message="Esta OT no está asignada a tu usuario."),403
        else:
            empleado_id=data.get("empleado_id")
            if empleado_id:
                empleado_id=int(empleado_id)
            else:
                first=query_one("SELECT TOP 1 EmpleadoId AS id FROM srv.TecnicoOrden WHERE OrdenTrabajoId=? AND Estado='ASIGNADO' ORDER BY CASE WHEN FuncionCuadrilla='ENCARGADO' THEN 0 ELSE 1 END,AsignadoEn",(orden_id,))
                if not first: raise ValueError("Asigna una cuadrilla antes de registrar un cambio de alcance.")
                empleado_id=int(first["id"])
        original=str(data.get("original") or "").strip()[:900] or None
        detected=str(require_value(data,"detectado","Describe el cambio detectado.")).strip()[:1200]
        reason=str(require_value(data,"motivo","Indica el motivo del cambio.")).strip()[:800]
        proposal=str(data.get("propuesta") or "").strip()[:1200] or None
        with get_db_connection() as conn:
            cursor=conn.cursor();set_audit_context(cursor,session,"Registro de cambio de alcance")
            cursor.execute(
                """
                DECLARE @NuevoCambio TABLE(id bigint);
                INSERT INTO srv.CambioAlcance
                  (OrdenTrabajoId,ReportadoPorEmpleadoId,DescripcionOriginal,CambioDetectado,Motivo,TrabajoAdicionalPropuesto,
                   InformadoPorUsuarioId,ContactoAutorizadorId,EstadoAutorizacion,ObservacionesRespuesta,RespondidoEn)
                OUTPUT INSERTED.CambioAlcanceId INTO @NuevoCambio VALUES(?,?,?,?,?,?,NULL,NULL,'PENDIENTE',NULL,NULL); SELECT id FROM @NuevoCambio;
                """,orden_id,empleado_id,original,detected,reason,proposal)
            while cursor.description is None and cursor.nextset():pass
            change_id=int(cursor.fetchone()[0])
            while cursor.nextset():pass
            if session["rol"]=="TECNICO":
                cursor.execute(
                    """
                    INSERT INTO com.Notificacion(UsuarioId,Tipo,Titulo,Mensaje,Entidad,EntidadId,Canal,Estado)
                    SELECT o.CoordinadorUsuarioId,'CAMBIO_ALCANCE',N'Cambio de alcance reportado',
                           CONCAT(N'La OT ',o.NumeroOrden,N' tiene un cambio de alcance pendiente de revisión.'),
                           'CambioAlcance',CONVERT(nvarchar(80),?),'SISTEMA','PENDIENTE'
                    FROM srv.OrdenTrabajo o WHERE o.OrdenTrabajoId=?
                    """,change_id,orden_id)
            conn.commit()
        return jsonify(ok=True,message="Cambio de alcance registrado.",id=change_id),201
    except ValueError as exc:
        return jsonify(ok=False,message=str(exc)),400
    except Exception as exc:
        return app_error(exc,"No fue posible registrar el cambio de alcance.")


@app.post("/api/ordenes/<int:orden_id>/cambios-alcance/<int:cambio_id>/enviar")
@require_session("COORDINADOR")
def api_enviar_cambio_alcance(session, orden_id: int, cambio_id: int):
    try:
        with get_db_connection() as conn:
            cursor=conn.cursor();set_audit_context(cursor,session,"Cambio de alcance informado al cliente")
            cursor.execute(
                """
                UPDATE srv.CambioAlcance SET InformadoPorUsuarioId=COALESCE(InformadoPorUsuarioId,?)
                WHERE CambioAlcanceId=? AND OrdenTrabajoId=? AND EstadoAutorizacion='PENDIENTE'
                """,session["usuario_id"],cambio_id,orden_id)
            if cursor.rowcount==0:
                conn.rollback(); return jsonify(ok=False,message="El cambio no existe o ya fue respondido."),409
            cursor.execute(
                """
                INSERT INTO com.Notificacion(UsuarioId,Tipo,Titulo,Mensaje,Entidad,EntidadId,Canal,Estado)
                SELECT DISTINCT u.UsuarioId,'CAMBIO_ALCANCE',N'Autorización requerida',
                       CONCAT(N'La OT ',o.NumeroOrden,N' tiene un cambio de alcance que requiere tu respuesta.'),
                       'CambioAlcance',CONVERT(nvarchar(80),?),'SISTEMA','PENDIENTE'
                FROM srv.OrdenTrabajo o INNER JOIN srv.SolicitudServicio ss ON ss.SolicitudServicioId=o.SolicitudServicioId
                INNER JOIN crm.ContactoCliente cc ON cc.ClienteId=ss.ClienteId AND cc.Activo=1
                INNER JOIN seg.Usuario u ON u.ContactoClienteId=cc.ContactoClienteId AND u.Activo=1
                WHERE o.OrdenTrabajoId=?
                """,cambio_id,orden_id)
            conn.commit()
        return jsonify(ok=True,message="Cambio enviado al cliente para autorización.")
    except Exception as exc:
        return app_error(exc,"No fue posible enviar el cambio de alcance.")


@app.post("/api/ordenes/<int:orden_id>/cambios-alcance/<int:cambio_id>/responder")
@require_session("COORDINADOR", "CLIENTE")
def api_responder_cambio_alcance(session, orden_id: int, cambio_id: int):
    data=request.get_json(silent=True) or {}
    try:
        status=str(require_value(data,"estado","Selecciona una respuesta.")).upper()
        if status not in {"AUTORIZADO","RECHAZADO","ALTERNATIVA"}:
            raise ValueError("Respuesta de cambio de alcance inválida.")
        response=str(data.get("respuesta") or "").strip()[:700] or None
        contact_id=session.get("contacto_cliente_id") if session["rol"]=="CLIENTE" else (int(data["contacto_id"]) if data.get("contacto_id") else None)
        if session["rol"]=="CLIENTE":
            access=query_one(
                """
                SELECT TOP 1 1 AS ok FROM srv.CambioAlcance ca INNER JOIN srv.OrdenTrabajo o ON o.OrdenTrabajoId=ca.OrdenTrabajoId
                INNER JOIN srv.SolicitudServicio ss ON ss.SolicitudServicioId=o.SolicitudServicioId
                WHERE ca.CambioAlcanceId=? AND ca.OrdenTrabajoId=? AND ss.ClienteId=? AND ca.InformadoPorUsuarioId IS NOT NULL
                """,(cambio_id,orden_id,session["cliente_id"] or -1))
            if not access: return jsonify(ok=False,message="Cambio no disponible para tu cliente."),403
        with get_db_connection() as conn:
            cursor=conn.cursor();set_audit_context(cursor,session,"Respuesta a cambio de alcance")
            cursor.execute(
                """
                UPDATE srv.CambioAlcance
                SET ContactoAutorizadorId=COALESCE(?,ContactoAutorizadorId),EstadoAutorizacion=?,ObservacionesRespuesta=?,RespondidoEn=SYSUTCDATETIME()
                WHERE CambioAlcanceId=? AND OrdenTrabajoId=? AND EstadoAutorizacion='PENDIENTE'
                """,contact_id,status,response,cambio_id,orden_id)
            if cursor.rowcount==0:
                conn.rollback(); return jsonify(ok=False,message="El cambio ya fue respondido o no existe."),409
            cursor.execute(
                """
                INSERT INTO com.Notificacion(UsuarioId,Tipo,Titulo,Mensaje,Entidad,EntidadId,Canal,Estado)
                SELECT DISTINCT x.UsuarioId,'RESPUESTA_ALCANCE',N'Respuesta de cambio de alcance',
                       CONCAT(N'La OT ',o.NumeroOrden,N' recibió respuesta: ',?),
                       'CambioAlcance',CONVERT(nvarchar(80),?),'SISTEMA','PENDIENTE'
                FROM srv.OrdenTrabajo o
                CROSS APPLY(
                  SELECT o.CoordinadorUsuarioId AS UsuarioId
                  UNION
                  SELECT u.UsuarioId FROM srv.TecnicoOrden t INNER JOIN seg.Usuario u ON u.EmpleadoId=t.EmpleadoId AND u.Activo=1
                  WHERE t.OrdenTrabajoId=o.OrdenTrabajoId AND t.Estado='ASIGNADO'
                ) x
                WHERE o.OrdenTrabajoId=?
                """,status,cambio_id,orden_id)
            conn.commit()
        return jsonify(ok=True,message="Respuesta registrada.")
    except ValueError as exc:
        return jsonify(ok=False,message=str(exc)),400
    except Exception as exc:
        return app_error(exc,"No fue posible responder el cambio de alcance.")


@app.post("/api/ordenes/<int:orden_id>/equipos")
@require_session("COORDINADOR")
def api_asignar_equipo(session, orden_id: int):
    data = request.get_json(silent=True) or {}
    try:
        equipo_id = int(require_value(data, "equipo_id", "Selecciona un equipo."))
        empleado_id = data.get("empleado_id") or None
        with get_db_connection() as conn:
            cursor = conn.cursor()
            set_audit_context(cursor, session, "Asignación de equipo a OT")
            row = exec_proc_row(cursor, "EXEC eqp.usp_AppAsignarEquipoOrden ?,?,?,?,?",
                                (orden_id, equipo_id, empleado_id, session["usuario_id"], data.get("observaciones") or None))
            conn.commit()
        return jsonify(ok=True, message="Equipo asignado.", item=row)
    except ValueError as exc:
        return jsonify(ok=False, message=str(exc)), 400
    except Exception as exc:
        return app_error(exc, "No fue posible asignar el equipo.")


@app.post("/api/ordenes/<int:orden_id>/evidencias")
@require_session("COORDINADOR", "TECNICO")
def api_subir_evidencia(session, orden_id: int):
    file = request.files.get("archivo")
    if not file or not file.filename:
        return jsonify(ok=False, message="Selecciona un archivo."), 400
    try:
        prepared = prepare_upload(file)
        default_category = "FOTO_TRABAJO" if prepared["tipo"] == "FOTO" else ("VIDEO_REFERENCIA" if prepared["tipo"] == "VIDEO" else "OTRO")
        allowed_categories = {"REFERENCIA_CLIENTE","FOTO_TRABAJO","VIDEO_REFERENCIA","ORDEN_FISICA","DOCUMENTO_CLIENTE","OTRO"}
        allowed_stages = {"INICIAL","ANTES","DURANTE","DESPUES","CONFIRMACION","DOCUMENTO"}
        category = str(request.form.get("categoria") or default_category).upper()[:30]
        stage = str(request.form.get("etapa") or "DURANTE").upper()[:15]
        if category not in allowed_categories: category = default_category
        if stage not in allowed_stages: stage = "DURANTE"
        description = (request.form.get("descripcion") or "").strip()[:600] or None
        include_collage = 1 if (category == "FOTO_TRABAJO" and prepared["tipo"] == "FOTO") else 0
        with get_db_connection() as conn:
            cursor = conn.cursor()
            set_audit_context(cursor, session, "Carga de evidencia de OT")
            row = evidence_storage.save(cursor,(
                    session["rol"], category, prepared["tipo"], prepared["nombre"], pyodbc.Binary(prepared["contenido"]),
                    None, orden_id, session["usuario_id"], session.get("empleado_id"), stage,
                    prepared["mime"], prepared["tamano"], description, include_collage, None, None,
                ))
            conn.commit()
        evidencia_id = int(row["EvidenciaServicioId"])
        return jsonify(ok=True, message="Evidencia guardada.", ruta=evidence_url(evidencia_id), id=evidencia_id, optimizado=bool(prepared["optimizado"]), tamano=prepared["tamano"]), 201
    except ValueError as exc:
        return jsonify(ok=False, message=str(exc)), 400
    except Exception as exc:
        return app_error(exc, "No fue posible guardar la evidencia.")


@app.get("/api/diagnostico/flujo")
@require_session("COORDINADOR")
def api_diagnostico_flujo(session):
    try:
        checks = {
            "sp_crear_solicitud": bool(query_one("SELECT 1 AS ok WHERE OBJECT_ID(N'srv.usp_AppCrearSolicitud',N'P') IS NOT NULL")),
            "sp_crear_orden": bool(query_one("SELECT 1 AS ok WHERE OBJECT_ID(N'srv.usp_AppCrearOrden',N'P') IS NOT NULL")),
            "sp_asignar_tecnico": bool(query_one("SELECT 1 AS ok WHERE OBJECT_ID(N'srv.usp_AppAsignarTecnico',N'P') IS NOT NULL")),
            "sp_cambiar_estado": bool(query_one("SELECT 1 AS ok WHERE OBJECT_ID(N'srv.usp_AppCambiarEstadoOrden',N'P') IS NOT NULL")),
            "auditoria": bool(query_one("SELECT TOP 1 1 AS ok FROM sys.triggers WHERE name LIKE 'TR[_]AUD[_]%' AND is_disabled=0")),
        }
        estados = query_all(
            "SELECT Codigo AS codigo,Nombre AS nombre,EsFinal AS es_final,Activo AS activo FROM srv.EstadoOrdenTrabajo ORDER BY OrdenVisual"
        )
        test = query_one(
            """
            SELECT
              (SELECT COUNT(*) FROM seg.Usuario u INNER JOIN seg.Rol r ON r.RolId=u.RolId WHERE u.Activo=1 AND UPPER(r.Nombre)='COORDINADOR') AS coordinadores,
              (SELECT COUNT(*) FROM rh.Empleado e INNER JOIN rh.Puesto p ON p.PuestoId=e.PuestoId WHERE e.EstadoLaboral='ACTIVO' AND p.EsTecnico=1) AS tecnicos,
              (SELECT COUNT(*) FROM crm.UbicacionServicio u INNER JOIN crm.SucursalCliente s ON s.SucursalClienteId=u.SucursalClienteId INNER JOIN crm.Cliente c ON c.ClienteId=s.ClienteId WHERE c.CodigoCliente='CLI-PRUEBA' AND u.Activo=1) AS ubicaciones_prueba,
              (SELECT COUNT(*) FROM crm.SucursalCliente s WHERE s.Activo=1) AS sedes_activas,
              (SELECT COUNT(*) FROM crm.SucursalCliente s WHERE s.Activo=1 AND NOT EXISTS(SELECT 1 FROM crm.UbicacionServicio u WHERE u.SucursalClienteId=s.SucursalClienteId AND u.Activo=1)) AS sedes_sin_ubicacion
            """
        ) or {}
        required = {"PENDIENTE", "PROGRAMADA", "EN_PROCESO", "POR_CONFIRMAR", "COMPLETADA", "CANCELADA"}
        present = {str(x.get("codigo") or "").upper() for x in estados}
        checks["estados_requeridos"] = required.issubset(present)
        checks["ubicacion_cliente_prueba"] = int(test.get("ubicaciones_prueba") or 0) > 0
        checks["todas_sedes_seleccionables"] = int(test.get("sedes_sin_ubicacion") or 0) == 0
        return jsonify(ok=True, checks=checks, estados=estados, resumen=test)
    except Exception as exc:
        return app_error(exc, "No fue posible ejecutar el diagnóstico del flujo.")


# ---------------------------------------------------------------------------
# Mis sedes / tiendas - portal privado del cliente
# Toda escritura se ejecuta mediante Stored Procedures con validación de
# pertenencia en SQL Server. El ClienteId nunca se acepta desde el navegador.
# ---------------------------------------------------------------------------
@app.get("/api/mis-sedes")
@require_session("CLIENTE")
def api_mis_sedes(session):
    try:
        page,size=pagination_args()
        with get_db_connection() as conn:
            cursor=conn.cursor(); set_audit_context(cursor,session,"Consulta paginada de sedes propias del cliente")
            items=exec_proc_rows(cursor,"EXEC crm.usp_ClienteSedes_Listar ?,?,?",(session["usuario_id"],page,size))
        for item in items:
            item["activo"] = bool(item.get("activo"))
        return paged_response(items,page,size)
    except Exception as exc:
        return app_error(exc, "No fue posible cargar tus sedes.")


def _sede_payload(data: dict) -> tuple:
    nombre = str(require_value(data, "nombre", "Ingresa el nombre de la sede o tienda.")).strip()
    direccion = str(require_value(data, "direccion", "Ingresa la dirección de la sede.")).strip()
    municipio = str(require_value(data, "municipio", "Ingresa el municipio de la sede.")).strip()
    departamento = str(data.get("departamento") or "Guatemala").strip() or "Guatemala"
    codigo = str(data.get("codigo") or "").strip() or None
    telefono = str(data.get("telefono") or "").strip() or None
    referencia = str(data.get("referencia_llegada") or "").strip() or None
    observaciones = str(data.get("observaciones") or "").strip() or None

    if len(nombre) > 180:
        raise ValueError("El nombre de la sede no puede exceder 180 caracteres.")
    if len(direccion) > 450:
        raise ValueError("La dirección no puede exceder 450 caracteres.")
    if len(municipio) > 100 or len(departamento) > 100:
        raise ValueError("Municipio o departamento demasiado largo.")
    if codigo and len(codigo) > 30:
        raise ValueError("El código de sede no puede exceder 30 caracteres.")
    if telefono and len(telefono) > 20:
        raise ValueError("El teléfono no puede exceder 20 caracteres.")

    # Latitud/longitud permanecen como columnas históricas en la BD, pero el portal ya no las solicita.
    latitud = None
    longitud = None
    return nombre, codigo, telefono, direccion, municipio, departamento, referencia, observaciones, latitud, longitud


@app.post("/api/mis-sedes")
@require_session("CLIENTE")
def api_mis_sedes_crear(session):
    data = request.get_json(silent=True) or {}
    try:
        values = _sede_payload(data)
        with get_db_connection() as conn:
            cursor = conn.cursor()
            set_audit_context(cursor, session, f"Registro de nueva sede por cliente: {values[0]}")
            items = exec_proc_rows(
                cursor,
                "EXEC crm.usp_ClienteSede_Crear ?,?,?,?,?,?,?,?,?,?,?",
                (session["usuario_id"],) + values,
            )
            conn.commit()
        return jsonify(ok=True, message="Sede agregada correctamente.", items=items), 201
    except ValueError as exc:
        return jsonify(ok=False, message=str(exc)), 400
    except Exception as exc:
        return app_error(exc, "No fue posible agregar la sede.")


@app.patch("/api/mis-sedes/<int:sede_id>")
@require_session("CLIENTE")
def api_mis_sedes_actualizar(session, sede_id: int):
    data = request.get_json(silent=True) or {}
    try:
        values = _sede_payload(data)
        with get_db_connection() as conn:
            cursor = conn.cursor()
            set_audit_context(cursor, session, f"Actualización de sede propia {sede_id}")
            items = exec_proc_rows(
                cursor,
                "EXEC crm.usp_ClienteSede_Actualizar ?,?,?,?,?,?,?,?,?,?,?,?",
                (session["usuario_id"], sede_id) + values,
            )
            conn.commit()
        return jsonify(ok=True, message="Sede actualizada correctamente.", items=items)
    except ValueError as exc:
        return jsonify(ok=False, message=str(exc)), 400
    except Exception as exc:
        return app_error(exc, "No fue posible actualizar la sede.")


@app.post("/api/mis-sedes/<int:sede_id>/estado")
@require_session("CLIENTE")
def api_mis_sedes_estado(session, sede_id: int):
    data = request.get_json(silent=True) or {}
    if type(data.get('activo')) is not bool:raise ValueError('Estado inválido.')
    activo = data['activo']
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            set_audit_context(cursor, session, ("Reactivación" if activo else "Desactivación") + f" de sede propia {sede_id}")
            items = exec_proc_rows(
                cursor,
                "EXEC crm.usp_ClienteSede_CambiarEstado ?,?,?",
                (session["usuario_id"], sede_id, int(activo)),
            )
            conn.commit()
        return jsonify(ok=True, message="Sede activada." if activo else "Sede desactivada.", items=items)
    except Exception as exc:
        return app_error(exc, "No fue posible cambiar el estado de la sede.")


# ---------------------------------------------------------------------------
# Clientes y sedes
# ---------------------------------------------------------------------------
@app.get("/api/clientes-crud/build")
@require_session("COORDINADOR")
def api_clientes_crud_build(_session):
    return jsonify(ok=True, build=CLIENT_CRUD_BUILD, rutas=[
        "/api/clientes/<id>/detalle",
        "/api/clientes/<id>",
        "/api/clientes/<id>/estado",
    ])

@app.post("/api/clientes")
@require_session("COORDINADOR")
def api_cliente_crear(session):
    data = request.get_json(silent=True) or {}
    try:
        codigo = str(require_value(data, "codigo", "Ingresa el código del cliente.")).strip().upper()
        nombre = str(require_value(data, "nombre_comercial", "Ingresa el nombre comercial del cliente.")).strip()
        if len(codigo) > 20:
            raise ValueError("El código del cliente no puede superar 20 caracteres.")
        if len(nombre) > 180:
            raise ValueError("El nombre comercial no puede superar 180 caracteres.")

        correo = str(data.get("correo") or "").strip().lower() or None
        contacto_correo = str(data.get("contacto_correo") or "").strip().lower() or None
        for value in (correo, contacto_correo):
            if value and (len(value) > 160 or not CONTACT_EMAIL_RE.fullmatch(value)):
                raise ValueError("Ingresa un correo electrónico válido.")

        contacto_nombre = str(data.get("contacto_nombre") or "").strip() or None
        contacto_cargo = str(data.get("contacto_cargo") or "").strip() or None
        contacto_telefono = str(data.get("contacto_telefono") or "").strip() or None

        with get_db_connection() as conn:
            cursor = conn.cursor()
            set_audit_context(cursor, session, f"Registro de cliente {codigo}")
            row = exec_proc_row(
                cursor,
                "EXEC crm.usp_AppCliente_Crear ?,?,?,?,?,?,?,?,?,?,?,?",
                (
                    codigo, nombre, str(data.get("razon_social") or "").strip() or None,
                    str(data.get("nit") or "").strip() or None,
                    str(data.get("telefono") or "").strip() or None, correo,
                    str(data.get("direccion_fiscal") or "").strip() or None,
                    str(data.get("observaciones") or "").strip() or None,
                    contacto_nombre, contacto_cargo, contacto_telefono, contacto_correo,
                ),
            )
            conn.commit()
        return jsonify(ok=True, message="Cliente registrado correctamente.", item=row), 201
    except ValueError as exc:
        return jsonify(ok=False, message=str(exc)), 400
    except Exception as exc:
        return app_error(exc, "No fue posible registrar el cliente.")

@app.get("/api/clientes/<int:cliente_id>/detalle")
@require_session("COORDINADOR")
def api_cliente_detalle(session, cliente_id: int):
    """Detalle para el CRUD de clientes.

    Se usa una consulta parametrizada deliberadamente simple para que Ver/Editar
    no dependan de la forma del result set de un SP genérico. La autorización
    continúa en Flask y la auditoría se establece en la misma conexión.
    """
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            set_audit_context(cursor, session, f"Consulta de cliente {cliente_id}")
            cursor.execute(
                """
                SELECT
                    c.ClienteId AS id,
                    c.CodigoCliente AS codigo,
                    c.NombreComercial AS nombre_comercial,
                    c.RazonSocial AS razon_social,
                    c.Nit AS nit,
                    c.TelefonoPrincipal AS telefono,
                    c.CorreoPrincipal AS correo,
                    c.DireccionFiscal AS direccion_fiscal,
                    c.Observaciones AS observaciones,
                    c.Activo AS activo,
                    c.CreadoEn AS creado_en,
                    c.ActualizadoEn AS actualizado_en,
                    (SELECT COUNT_BIG(*) FROM crm.SucursalCliente s WHERE s.ClienteId=c.ClienteId) AS sedes,
                    (SELECT COUNT_BIG(*) FROM crm.ContactoCliente cc WHERE cc.ClienteId=c.ClienteId) AS contactos,
                    (SELECT COUNT_BIG(*) FROM srv.SolicitudServicio ss WHERE ss.ClienteId=c.ClienteId) AS solicitudes
                FROM crm.Cliente c
                WHERE c.ClienteId=?
                """,
                cliente_id,
            )
            db_row = cursor.fetchone()
            if not db_row:
                return jsonify(ok=False, message="Cliente no encontrado."), 404
            row = rows_to_dicts(cursor, [db_row])[0]

        item = {
            "id": row.get("id"),
            "codigo": row.get("codigo"),
            "nombre_comercial": row.get("nombre_comercial"),
            "razon_social": row.get("razon_social"),
            "nit": row.get("nit"),
            "telefono": row.get("telefono"),
            "correo": row.get("correo"),
            "direccion_fiscal": row.get("direccion_fiscal"),
            "observaciones": row.get("observaciones"),
            "activo": bool(row.get("activo")),
            "creado_en": row.get("creado_en"),
            "actualizado_en": row.get("actualizado_en"),
            "sedes": int(row.get("sedes") or 0),
            "contactos": int(row.get("contactos") or 0),
            "solicitudes": int(row.get("solicitudes") or 0),
        }
        return jsonify(ok=True, item=item)
    except Exception as exc:
        return app_error(exc, "No fue posible cargar el cliente.")


# Compatibilidad con enlaces/versiones anteriores que ya llamaban /api/clientes/<id>.
@app.get("/api/clientes/<int:cliente_id>")
@require_session("COORDINADOR")
def api_cliente_detalle_compat(session, cliente_id: int):
    return api_cliente_detalle.__wrapped__(session, cliente_id) if hasattr(api_cliente_detalle, "__wrapped__") else api_cliente_detalle(session, cliente_id)


@app.patch("/api/clientes/<int:cliente_id>")
@require_session("COORDINADOR")
def api_cliente_actualizar(session, cliente_id: int):
    data = request.get_json(silent=True) or {}
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            set_audit_context(cursor, session, f"Actualización de cliente {cliente_id}")
            current = exec_proc_row(cursor, "EXEC crm.usp_Cliente_Obtener ?", (cliente_id,))
            if not current:
                return jsonify(ok=False, message="Cliente no encontrado."), 404

            codigo = str(data.get("codigo", current.get("CodigoCliente")) or "").strip().upper()
            nombre = str(data.get("nombre_comercial", current.get("NombreComercial")) or "").strip()
            if not codigo:
                raise ValueError("Ingresa el código del cliente.")
            if not nombre:
                raise ValueError("Ingresa el nombre comercial del cliente.")
            if len(codigo) > 20:
                raise ValueError("El código del cliente no puede superar 20 caracteres.")
            if len(nombre) > 180:
                raise ValueError("El nombre comercial no puede superar 180 caracteres.")

            correo = str(data.get("correo", current.get("CorreoPrincipal")) or "").strip().lower() or None
            if correo and (len(correo) > 160 or not CONTACT_EMAIL_RE.fullmatch(correo)):
                raise ValueError("Ingresa un correo electrónico válido.")

            exec_proc_row(
                cursor,
                "EXEC crm.usp_Cliente_Actualizar ?,?,?,?,?,?,?,?,?,?,?",
                (
                    cliente_id, codigo, nombre,
                    str(data.get("razon_social", current.get("RazonSocial")) or "").strip() or None,
                    str(data.get("nit", current.get("Nit")) or "").strip() or None,
                    str(data.get("telefono", current.get("TelefonoPrincipal")) or "").strip() or None,
                    correo,
                    str(data.get("direccion_fiscal", current.get("DireccionFiscal")) or "").strip() or None,
                    str(data.get("observaciones", current.get("Observaciones")) or "").strip() or None,
                    int(bool(current.get("Activo"))),
                    current.get("FilaVersion"),
                ),
            )
            conn.commit()
        return jsonify(ok=True, message="Cliente actualizado correctamente.")
    except ValueError as exc:
        return jsonify(ok=False, message=str(exc)), 400
    except Exception as exc:
        return app_error(exc, "No fue posible actualizar el cliente.")


@app.post("/api/clientes/<int:cliente_id>/estado")
@require_session("COORDINADOR")
def api_cliente_estado(session, cliente_id: int):
    data = request.get_json(silent=True) or {}
    activo = bool(data.get("activo"))
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            set_audit_context(cursor, session, ("Reactivación" if activo else "Desactivación") + f" de cliente {cliente_id}")
            current = exec_proc_row(cursor, "EXEC crm.usp_Cliente_Obtener ?", (cliente_id,))
            if not current:
                return jsonify(ok=False, message="Cliente no encontrado."), 404

            exec_proc_row(
                cursor,
                "EXEC crm.usp_Cliente_Actualizar ?,?,?,?,?,?,?,?,?,?,?",
                (
                    cliente_id, current.get("CodigoCliente"), current.get("NombreComercial"),
                    current.get("RazonSocial"), current.get("Nit"), current.get("TelefonoPrincipal"),
                    current.get("CorreoPrincipal"), current.get("DireccionFiscal"), current.get("Observaciones"),
                    int(activo), current.get("FilaVersion"),
                ),
            )
            conn.commit()
        return jsonify(ok=True, message="Cliente activado." if activo else "Cliente desactivado. Su historial se conserva.")
    except Exception as exc:
        return app_error(exc, "No fue posible cambiar el estado del cliente.")

@app.get("/api/clientes")
@require_session("COORDINADOR")
def api_clientes(session):
    return portal_listing(__import__(__name__,fromlist=["app"]),session,"clientes")

@app.get("/api/clientes/<int:cliente_id>/sedes")
@require_session("COORDINADOR")
def api_sedes_cliente(_session, cliente_id: int):
    try:
        return jsonify(ok=True, items=query_all(
            """
            SELECT s.SucursalClienteId AS id,s.CodigoSucursal AS codigo,s.Nombre,s.Telefono,s.Activo,
                   u.UbicacionServicioId AS ubicacion_id,u.Direccion,u.Municipio,u.Departamento
            FROM crm.SucursalCliente s
            LEFT JOIN crm.UbicacionServicio u ON u.SucursalClienteId=s.SucursalClienteId AND u.Activo=1
            WHERE s.ClienteId=? ORDER BY s.Nombre
            """, (cliente_id,)))
    except Exception as exc:
        return app_error(exc, "No fue posible cargar las sedes.")


# ---------------------------------------------------------------------------
# Personal / RRHH básico
# ---------------------------------------------------------------------------
@app.get("/api/personal/catalogos")
@require_session("COORDINADOR")
def api_personal_catalogos(session):
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            set_audit_context(cursor, session, "Consulta de catálogos para registro de personal")
            puestos = exec_proc_rows(cursor, "EXEC rh.usp_AppPersonalCatalogos")
        return jsonify(ok=True, puestos=puestos)
    except Exception as exc:
        return app_error(exc, "No fue posible cargar los catálogos de personal.")

@app.post("/api/personal")
@require_session("COORDINADOR")
def api_personal_crear(session):
    data = request.get_json(silent=True) or {}
    try:
        codigo = str(require_value(data, "codigo_empleado", "Ingresa el código del empleado.")).strip().upper()
        nombres = str(require_value(data, "nombres", "Ingresa los nombres del empleado.")).strip()
        apellidos = str(require_value(data, "apellidos", "Ingresa los apellidos del empleado.")).strip()
        telefono = str(require_value(data, "telefono_principal", "Ingresa el teléfono principal.")).strip()
        direccion = str(require_value(data, "direccion_residencia", "Ingresa la dirección de residencia.")).strip()
        puesto_id = int(require_value(data, "puesto_id", "Selecciona el puesto del empleado."))
        fecha_ingreso_raw = str(require_value(data, "fecha_ingreso", "Ingresa la fecha de ingreso.")).strip()
        try:
            fecha_ingreso = datetime.strptime(fecha_ingreso_raw, "%Y-%m-%d").date()
        except ValueError:
            raise ValueError("La fecha de ingreso no es válida.")

        fecha_nacimiento = None
        if str(data.get("fecha_nacimiento") or "").strip():
            try:
                fecha_nacimiento = datetime.strptime(str(data["fecha_nacimiento"]), "%Y-%m-%d").date()
            except ValueError:
                raise ValueError("La fecha de nacimiento no es válida.")

        tipo = str(data.get("tipo_contratacion") or "FIJO").strip().upper()
        if tipo not in {"FIJO", "TEMPORAL", "POR_SERVICIO", "OTRO"}:
            raise ValueError("El tipo de contratación seleccionado no es válido.")
        disponibilidad = str(data.get("disponibilidad") or "DISPONIBLE").strip().upper()
        if disponibilidad not in {"DISPONIBLE", "NO_DISPONIBLE", "VACACIONES"}:
            raise ValueError("La disponibilidad inicial no es válida.")

        dpi = str(data.get("dpi") or "").strip() or None
        if dpi and (len(dpi) != 13 or not dpi.isdigit()):
            raise ValueError("El DPI debe contener exactamente 13 dígitos.")
        correo = str(data.get("correo") or "").strip().lower() or None
        if correo and (len(correo) > 160 or not CONTACT_EMAIL_RE.fullmatch(correo)):
            raise ValueError("Ingresa un correo electrónico válido.")

        with get_db_connection() as conn:
            cursor = conn.cursor()
            set_audit_context(cursor, session, f"Registro de empleado {codigo}")
            row = exec_proc_row(
                cursor,
                "EXEC rh.usp_AppPersonal_Crear ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?",
                (
                    nombres, apellidos, dpi, str(data.get("nit") or "").strip() or None, fecha_nacimiento,
                    telefono, str(data.get("telefono_alterno") or "").strip() or None, correo, direccion,
                    str(data.get("contacto_emergencia_nombre") or "").strip() or None,
                    str(data.get("contacto_emergencia_telefono") or "").strip() or None,
                    puesto_id, codigo, fecha_ingreso, tipo,
                    str(data.get("forma_pago") or "").strip() or None, disponibilidad,
                    str(data.get("observaciones") or "").strip() or None,
                    "ACTIVO", 1,
                ),
            )
            conn.commit()
        return jsonify(ok=True, message="Empleado registrado correctamente.", item=row), 201
    except (ValueError, TypeError) as exc:
        return jsonify(ok=False, message=str(exc)), 400
    except Exception as exc:
        return app_error(exc, "No fue posible registrar el empleado.")

@app.get("/api/personal")
@require_session("COORDINADOR")
def api_personal(session):
    return portal_listing(__import__(__name__,fromlist=["app"]),session,"personal")

@app.patch("/api/personal/<int:empleado_id>/disponibilidad")
@require_session("COORDINADOR")
def api_personal_disponibilidad(session, empleado_id: int):
    data = request.get_json(silent=True) or {}
    disponibilidad = str(data.get("disponibilidad") or "").upper()
    try:
        with get_db_connection() as conn:
            cursor=conn.cursor(); set_audit_context(cursor,session,"Cambio de disponibilidad de empleado")
            exec_proc_rows(cursor,"EXEC rh.usp_AppPersonalCambiarDisponibilidad ?,?,?",(session["usuario_id"],empleado_id,disponibilidad))
            conn.commit()
        return jsonify(ok=True, message="Disponibilidad actualizada.")
    except Exception as exc:
        return app_error(exc, "No fue posible actualizar la disponibilidad.")


@app.get("/api/vacaciones")
@require_session("COORDINADOR", "TECNICO")
def api_vacaciones(session):
    return portal_listing(__import__(__name__,fromlist=["app"]),session,"vacaciones")


@app.get("/api/equipos")
@require_session("COORDINADOR", "TECNICO")
def api_equipos(session):
    return portal_listing(__import__(__name__,fromlist=["app"]),session,"equipos")

@app.post("/api/equipos")
@require_session("COORDINADOR")
def api_equipo_crear(session):
    data=request.get_json(silent=True) or {}
    try:
        codigo=str(require_value(data,"codigo","Ingresa el código del equipo.")).strip()
        nombre=str(require_value(data,"nombre","Ingresa el nombre del equipo.")).strip()
        if str(data.get('estado') or 'DISPONIBLE').upper() not in {'DISPONIBLE','FUERA_DE_USO','RETIRADO'}:raise ValueError('El estado operativo se asigna mediante una OT o un mantenimiento.')
        fecha = data.get("fecha_adquisicion") or None
        with get_db_connection() as conn:
            cursor=conn.cursor(); set_audit_context(cursor,session,"Registro de equipo")
            row=exec_proc_row(cursor,"EXEC eqp.usp_AppEquipoCrear ?,?,?,?,?,?,?,?,?,?,?",(
                session["usuario_id"],codigo,nombre,data.get("categoria") or None,data.get("marca") or None,data.get("modelo") or None,
                data.get("serie") or None,fecha,str(data.get("estado") or "DISPONIBLE").upper(),data.get("ubicacion") or None,data.get("descripcion") or None
            ))
            conn.commit()
        return jsonify(ok=True,message="Equipo registrado.",item=row),201
    except ValueError as exc:
        return jsonify(ok=False,message=str(exc)),400
    except Exception as exc:
        return app_error(exc,"No fue posible registrar el equipo.")


@app.patch("/api/equipos/<int:equipo_id>/estado")
@require_session("COORDINADOR")
def api_equipo_estado(session, equipo_id: int):
    data=request.get_json(silent=True) or {}; estado=str(data.get("estado") or "").upper()
    try:
        with get_db_connection() as conn:
            cursor=conn.cursor(); set_audit_context(cursor,session,"Cambio de estado de equipo")
            exec_proc_rows(cursor,"EXEC eqp.usp_AppEquipoCambiarEstado ?,?,?",(session["usuario_id"],equipo_id,estado))
            conn.commit()
        return jsonify(ok=True,message="Estado del equipo actualizado.")
    except Exception as exc:
        return app_error(exc,"No fue posible actualizar el equipo.")


@app.get("/api/mantenimientos")
@require_session("COORDINADOR", "TECNICO")
def api_mantenimientos(session):
    return portal_listing(__import__(__name__,fromlist=["app"]),session,"mantenimientos")

@app.post("/api/mantenimientos")
@require_session("COORDINADOR")
def api_crear_mantenimiento(session):
    data=request.get_json(silent=True) or {}
    try:
        equipo_id=int(require_value(data,"equipo_id","Selecciona un equipo.")); tipo=str(data.get("tipo") or "PREVENTIVO").upper()
        with get_db_connection() as conn:
            cursor=conn.cursor(); set_audit_context(cursor,session,"Programación de mantenimiento interno")
            falla_id=int(data.get('falla_id') or 0)
            if falla_id:
                falla=exec_proc_row(cursor,"SELECT FallaEquipoId FROM eqp.FallaEquipo WITH (UPDLOCK,HOLDLOCK) WHERE FallaEquipoId=? AND EquipoId=? AND Estado IN ('REPORTADA','DIAGNOSTICO')",(falla_id,equipo_id))
                if not falla:raise ValueError('La falla seleccionada no está disponible para este equipo.')
                if exec_proc_row(cursor,"SELECT TOP 1 MantenimientoEquipoId FROM eqp.MantenimientoEquipo WHERE FallaEquipoId=? AND Estado NOT IN ('FINALIZADO','CANCELADO')",(falla_id,)):raise ValueError('La falla ya tiene un mantenimiento pendiente.')
                if tipo!='CORRECTIVO':raise ValueError('Una falla requiere mantenimiento correctivo.')
            fecha_programada=parse_datetime_local(data.get("fecha_programada"),"Fecha programada del mantenimiento")
            row=exec_proc_row(cursor,"EXEC eqp.usp_AppCrearMantenimiento ?,?,?,?,?,?",(equipo_id,tipo,fecha_programada,data.get("diagnostico") or None,data.get("trabajo_requerido") or None,session["usuario_id"]))
            if falla_id:
                cursor.execute('UPDATE eqp.MantenimientoEquipo SET FallaEquipoId=? WHERE MantenimientoEquipoId=?',falla_id,row['id'])
                cursor.execute("UPDATE eqp.FallaEquipo SET Estado='DIAGNOSTICO' WHERE FallaEquipoId=?",falla_id)
            conn.commit()
        return jsonify(ok=True,message="Mantenimiento registrado.",item=row),201
    except ValueError as exc:
        return jsonify(ok=False,message=str(exc)),400
    except Exception as exc:
        return app_error(exc,"No fue posible registrar el mantenimiento.")


# ---------------------------------------------------------------------------
# Cotizaciones (sin pagos)
# ---------------------------------------------------------------------------
def _cotizacion_expediente_sets(session, cotizacion_id: int):
    """Obtiene desde SQL Server los 3 bloques del expediente autorizado."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        set_audit_context(cursor, session, "Consulta de expediente de cotización")
        sets = exec_proc_sets(
            cursor,
            "EXEC cot.usp_CotizacionExpedientePortal ?,?",
            (session["usuario_id"], cotizacion_id),
        )
    while len(sets) < 3:
        sets.append([])
    for header in sets[0]:header['ruta_documento']=f'/api/cotizaciones/{cotizacion_id}/pdf'
    for evidence in sets[1]:
        evidence_id = evidence.get("evidencia_id") or evidence.get("id")
        if evidence_id is not None:
            evidence["ruta"] = evidence_url(int(evidence_id))
    return sets[0], sets[1], sets[2]


def _pdf_text(value) -> str:
    return html.escape(str(value if value not in (None, "") else "—"))


def _pdf_date(value) -> str:
    if not value:
        return "—"
    if isinstance(value, datetime):
        return value.strftime("%d/%m/%Y")
    try:
        return value.strftime("%d/%m/%Y")
    except Exception:
        return str(value)


def _pdf_money(value, currency="GTQ") -> str:
    try:
        amount = Decimal(str(value or 0))
    except Exception:
        amount = 0.0
    prefix = "Q" if str(currency or "GTQ").upper() == "GTQ" else str(currency or "")
    return f"{prefix} {amount:,.2f}".strip()


def _build_quote_pdf(item: dict, details: list[dict]):
    if not REPORTLAB_AVAILABLE:
        raise RuntimeError("Falta instalar ReportLab en el entorno de Python.")

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=16 * mm,
        leftMargin=16 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
        title=str(item.get("numero_cotizacion") or "Cotización SEPRIGUA"),
        author="SEPRIGUA - Corporación Turam, S.A.",
    )
    if __package__:from .pdf_styles import portal_styles
    else:from pdf_styles import portal_styles
    styles = portal_styles()
    navy = rl_colors.HexColor("#0B3C78")
    blue = rl_colors.HexColor("#1769C2")
    red = rl_colors.HexColor("#EF2347")
    light = rl_colors.HexColor("#F3F7FC")
    muted = rl_colors.HexColor("#5D728E")
    title_style = ParagraphStyle("SepriguaTitle", parent=styles["Title"], fontName="PortalSans-Bold", fontSize=21, leading=24, textColor=navy, spaceAfter=4)
    label_style = ParagraphStyle("SepriguaLabel", parent=styles["Normal"], fontName="PortalSans-Bold", fontSize=8, leading=10, textColor=muted)
    body_style = ParagraphStyle("SepriguaBody", parent=styles["BodyText"], fontName="PortalSans", fontSize=9, leading=13, textColor=rl_colors.HexColor("#1B365D"))
    right_style = ParagraphStyle("SepriguaRight", parent=body_style, alignment=TA_RIGHT)

    story = []
    header = RLTable([
        [Paragraph("<b>SEPRIGUA</b><br/><font size='8'>CORPORACIÓN TURAM, S.A.</font>", title_style),
         Paragraph(f"<b>COTIZACIÓN</b><br/><font size='12'>{_pdf_text(item.get('numero_cotizacion'))}</font>", right_style)]
    ], colWidths=[115*mm, 55*mm])
    header.setStyle(TableStyle([
        ("VALIGN", (0,0), (-1,-1), "TOP"),
        ("LINEBELOW", (0,0), (-1,-1), 2, red),
        ("BOTTOMPADDING", (0,0), (-1,-1), 8),
    ]))
    story += [header, Spacer(1, 6*mm)]

    meta_data = [
        [Paragraph("CLIENTE", label_style), Paragraph("SEDE / UBICACIÓN", label_style), Paragraph("ORDEN", label_style)],
        [Paragraph(_pdf_text(item.get("cliente")), body_style), Paragraph(_pdf_text(item.get("sede")), body_style), Paragraph(_pdf_text(item.get("numero_orden")), body_style)],
        [Paragraph("EMISIÓN", label_style), Paragraph("VENCIMIENTO", label_style), Paragraph("ESTADO", label_style)],
        [Paragraph(_pdf_date(item.get("fecha_emision")), body_style), Paragraph(_pdf_date(item.get("fecha_expiracion")), body_style), Paragraph(_pdf_text(item.get("cotizacion_estado")), body_style)],
    ]
    meta = RLTable(meta_data, colWidths=[56*mm, 66*mm, 48*mm])
    meta.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,-1), light),
        ("BOX", (0,0), (-1,-1), 0.5, rl_colors.HexColor("#D7E2F0")),
        ("INNERGRID", (0,0), (-1,-1), 0.4, rl_colors.HexColor("#D7E2F0")),
        ("VALIGN", (0,0), (-1,-1), "TOP"),
        ("LEFTPADDING", (0,0), (-1,-1), 7),
        ("RIGHTPADDING", (0,0), (-1,-1), 7),
        ("TOPPADDING", (0,0), (-1,-1), 5),
        ("BOTTOMPADDING", (0,0), (-1,-1), 5),
    ]))
    story += [meta, Spacer(1, 6*mm)]

    story.append(Paragraph("Detalle de la cotización", ParagraphStyle("Section", parent=styles["Heading2"], textColor=navy, fontSize=13, leading=16, spaceAfter=6)))
    head_style=ParagraphStyle('TableHead',parent=label_style,textColor=rl_colors.white)
    rows=[[Paragraph(title,head_style) for title in ('#','Descripción','Cantidad','Unidad','Precio','Total')]]
    for line in details:
        rows.append([
            Paragraph(_pdf_text(line.get("numero_linea")), body_style),
            Paragraph(_pdf_text(line.get("descripcion"))+f"<br/><font size='7'>Descuento: {_pdf_money(line.get('descuento'),item.get('moneda'))} · Impuesto: {_pdf_text(line.get('porcentaje_impuesto') or 0)}%</font>"+(f"<br/>{_pdf_text(line.get('observaciones'))}" if line.get('observaciones') else ''),body_style),
            Paragraph(_pdf_text(line.get("cantidad")), body_style),
            Paragraph(_pdf_text(line.get("unidad")), body_style),
            Paragraph(_pdf_money(line.get("precio_unitario"), item.get("moneda")), right_style),
            Paragraph(_pdf_money(line.get("total_linea"), item.get("moneda")), right_style),
        ])
    if len(rows) == 1:
        rows.append(["—", Paragraph("Sin líneas registradas.", body_style), "—", "—", "—", "—"])
    detail_table = RLTable(rows, colWidths=[9*mm, 76*mm, 20*mm, 23*mm, 22*mm, 25*mm], repeatRows=1)
    detail_table.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,0), navy),
        ("TEXTCOLOR", (0,0), (-1,0), rl_colors.white),
        ("GRID", (0,0), (-1,-1), 0.35, rl_colors.HexColor("#D7E2F0")),
        ("VALIGN", (0,0), (-1,-1), "TOP"),
        ("LEFTPADDING", (0,0), (-1,-1), 5),
        ("RIGHTPADDING", (0,0), (-1,-1), 5),
        ("TOPPADDING", (0,0), (-1,-1), 5),
        ("BOTTOMPADDING", (0,0), (-1,-1), 5),
        ("BACKGROUND", (0,1), (-1,-1), rl_colors.white),
    ]))
    story += [detail_table, Spacer(1, 5*mm)]

    totals = RLTable([
        [Paragraph("Subtotal", body_style), Paragraph(_pdf_money(item.get("subtotal"), item.get("moneda")), right_style)],
        [Paragraph("Descuento", body_style), Paragraph(_pdf_money(item.get("descuento_total"), item.get("moneda")), right_style)],
        [Paragraph("Impuesto", body_style), Paragraph(_pdf_money(item.get("impuesto_total"), item.get("moneda")), right_style)],
        [Paragraph("<b>TOTAL</b>", body_style), Paragraph(f"<b>{_pdf_money(item.get('total'), item.get('moneda'))}</b>", right_style)],
    ], colWidths=[45*mm, 40*mm], hAlign="RIGHT")
    totals.setStyle(TableStyle([
        ("LINEABOVE", (0,3), (-1,3), 1.2, blue),
        ("BACKGROUND", (0,3), (-1,3), light),
        ("LEFTPADDING", (0,0), (-1,-1), 7),
        ("RIGHTPADDING", (0,0), (-1,-1), 7),
        ("TOPPADDING", (0,0), (-1,-1), 5),
        ("BOTTOMPADDING", (0,0), (-1,-1), 5),
    ]))
    story += [totals, Spacer(1, 6*mm)]

    commercial = RLTable([
        [Paragraph("CONDICIÓN COMERCIAL", label_style), Paragraph("VIGENCIA", label_style)],
        [Paragraph(_pdf_text(item.get("condicion_pago")), body_style), Paragraph(f"Hasta {_pdf_date(item.get('fecha_expiracion'))}", body_style)],
    ], colWidths=[115*mm, 55*mm])
    commercial.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,-1), light),
        ("BOX", (0,0), (-1,-1), 0.5, rl_colors.HexColor("#D7E2F0")),
        ("INNERGRID", (0,0), (-1,-1), 0.4, rl_colors.HexColor("#D7E2F0")),
        ("LEFTPADDING", (0,0), (-1,-1), 7),
        ("RIGHTPADDING", (0,0), (-1,-1), 7),
        ("TOPPADDING", (0,0), (-1,-1), 5),
        ("BOTTOMPADDING", (0,0), (-1,-1), 5),
    ]))
    story += [commercial, Spacer(1, 8*mm), Paragraph("Documento generado desde el portal privado de SEPRIGUA. No constituye un comprobante de pago.", ParagraphStyle("Foot", parent=styles["Normal"], fontSize=7.5, textColor=muted))]

    def page_number(canvas,document):
        canvas.saveState();canvas.setFont('PortalSans',8);canvas.setFillColor(muted)
        canvas.drawRightString(A4[0]-16*mm,9*mm,f'Página {document.page}');canvas.restoreState()
    doc.build(story,onFirstPage=page_number,onLaterPages=page_number)
    buffer.seek(0)
    return buffer


@app.get("/api/cotizaciones")
@require_session("COORDINADOR", "CLIENTE")
def api_cotizaciones(session):
    return portal_listing(__import__(__name__,fromlist=["app"]),session,"cotizaciones")

@app.get("/api/cotizaciones/<int:cotizacion_id>/expediente")
@require_session("CLIENTE")
def api_cotizacion_expediente(session, cotizacion_id: int):
    try:
        summary, evidences, details = _cotizacion_expediente_sets(session, cotizacion_id)
        if not summary:
            return jsonify(ok=False, message="Cotización no encontrada o todavía no disponible para tu empresa."), 404
        return jsonify(ok=True, item=summary[0], evidencias=evidences, detalles=details)
    except Exception as exc:
        return app_error(exc, "No fue posible cargar el expediente de la cotización.")


@app.get("/api/cotizaciones/<int:cotizacion_id>/pdf")
@require_session("CLIENTE", "COORDINADOR")
def api_cotizacion_pdf(session, cotizacion_id: int):
    try:
        summary, _evidences, details = _cotizacion_expediente_sets(session, cotizacion_id)
        if not summary:
            return jsonify(ok=False, message="Cotización no encontrada o sin acceso."), 404
        item = summary[0]
        pdf = _build_quote_pdf(item, details)
        filename = re.sub(r"[^A-Za-z0-9._-]+", "_", str(item.get("numero_cotizacion") or f"cotizacion_{cotizacion_id}")) + ".pdf"
        return send_file(pdf, mimetype="application/pdf", as_attachment=True, download_name=filename, max_age=0)
    except RuntimeError as exc:
        return jsonify(ok=False, message=str(exc)), 503
    except Exception as exc:
        return app_error(exc, "No fue posible generar la cotización en PDF.")


@app.post("/api/cotizaciones")
@require_session("COORDINADOR")
def api_crear_cotizacion(session):
    return portal_actions["save_quote"](session)


@app.post("/api/cotizaciones/<int:cotizacion_id>/enviar")
@require_session("COORDINADOR")
def api_enviar_cotizacion(session, cotizacion_id: int):
    try:
        with get_db_connection() as conn:
            cursor=conn.cursor()
            set_audit_context(cursor,session,"Envío de cotización al cliente")
            row=exec_proc_row(cursor,"EXEC cot.usp_CotizacionEnviarPortal ?,?",(session["usuario_id"],cotizacion_id)) or {}
            if not row.get("ok"):
                conn.rollback()
                return jsonify(ok=False,message=row.get("message") or "La cotización no está disponible para envío."),409
            conn.commit()
        push_quote_sent(cotizacion_id)
        return jsonify(ok=True,message=row.get("message") or "Cotización enviada al cliente.")
    except Exception as exc:
        return app_error(exc,"No fue posible enviar la cotización.")


@app.post("/api/cotizaciones/<int:cotizacion_id>/responder")
@require_session("CLIENTE")
def api_responder_cotizacion(session, cotizacion_id: int):
    data=request.get_json(silent=True) or {}
    try:
        response=str(require_value(data,"respuesta","Selecciona una respuesta.")).upper()
        observation=str(data.get("observaciones") or "").strip()[:1200] or None
        with get_db_connection() as conn:
            cursor=conn.cursor()
            set_audit_context(cursor,session,"Respuesta de cliente a cotización")
            row=exec_proc_row(cursor,"EXEC cot.usp_CotizacionResponderPortal ?,?,?,?",(session["usuario_id"],cotizacion_id,response,observation)) or {}
            if not row.get("ok"):
                conn.rollback()
                return jsonify(ok=False,message=row.get("message") or "Cotización no disponible para respuesta."),409
            conn.commit()
        push_quote_response(cotizacion_id, response, session)
        return jsonify(ok=True,message=row.get("message") or "Respuesta de cotización registrada.",estado=row.get("estado"))
    except ValueError as exc:
        return jsonify(ok=False,message=str(exc)),400
    except Exception as exc:
        return app_error(exc,"No fue posible responder la cotización.")


# ---------------------------------------------------------------------------
# Contacto público del sitio web
# ---------------------------------------------------------------------------

@app.get("/api/public/security-config")
def api_public_security_config():
    # La site key es pública por diseño. El secret nunca sale del servidor.
    return jsonify(
        ok=True,
        turnstile_site_key=(os.getenv("TURNSTILE_SITE_KEY") or "").strip() or None,
        turnstile_required=env_bool("TURNSTILE_REQUIRED", False),
    )


@app.post("/api/contacto")
def api_contacto():
    ip = client_ip() or "desconocida"

    if not contact_rate_allowed(ip):
        return jsonify(
            ok=False,
            message="Recibimos varios envíos seguidos. Espera unos minutos antes de intentar nuevamente.",
        ), 429

    try:
        payload = request.get_json(silent=True) or request.form.to_dict()

        # Honeypot: los visitantes reales nunca ven ni completan este campo.
        # A un bot se le responde éxito sin generar ningún correo.
        if str(payload.get("website") or "").strip():
            app.logger.warning("Formulario de contacto bloqueado por honeypot desde %s", ip)
            return jsonify(ok=True, message="Solicitud enviada correctamente. Nuestro equipo se pondrá en contacto contigo.")

        if not verify_turnstile(str(payload.get("turnstile_token") or "").strip(), ip):
            return jsonify(
                ok=False,
                message="No fue posible validar que la solicitud sea legítima. Actualiza la página e inténtalo nuevamente.",
            ), 403

        data = {
            "nombre": contact_text(
                payload.get("nombre"),
                max_length=120,
                required=True,
                field_name="Nombre completo",
            ),
            "correo": contact_text(
                payload.get("correo"),
                max_length=180,
                required=True,
                field_name="Correo electrónico",
            ),
            "telefono": contact_text(
                payload.get("telefono"),
                max_length=40,
                field_name="Teléfono",
            ),
            "empresa": contact_text(
                payload.get("empresa"),
                max_length=160,
                field_name="Empresa",
            ),
            "asunto": contact_text(
                payload.get("asunto"),
                max_length=180,
                required=True,
                field_name="Asunto",
            ),
            "mensaje": contact_text(
                payload.get("mensaje"),
                max_length=3000,
                required=True,
                field_name="Mensaje",
            ),
        }

        if not CONTACT_EMAIL_RE.fullmatch(data["correo"]):
            raise ValueError("Ingresa un correo electrónico válido.")
        if "\r" in data["asunto"] or "\n" in data["asunto"]:
            raise ValueError("El asunto contiene caracteres no permitidos.")
        if not contact_email_rate_allowed(data["correo"]):
            return jsonify(
                ok=False,
                message="Ya recibimos varias solicitudes para este correo. Espera un momento antes de enviar otra.",
            ), 429

        send_contact_emails(data)

        return jsonify(
            ok=True,
            message="Solicitud enviada correctamente. Nuestro equipo se pondrá en contacto contigo.",
        )

    except ValueError as exc:
        return jsonify(ok=False, message=str(exc)), 400
    except RuntimeError as exc:
        app.logger.exception("Configuración de correo incompleta.")
        return jsonify(
            ok=False,
            message="El envío de correo todavía no está configurado en el servidor.",
            detail=str(exc) if env_bool("FLASK_DEBUG", False) else None,
        ), 503
    except (smtplib.SMTPException, OSError) as exc:
        app.logger.exception("No fue posible enviar la solicitud por correo.")
        return jsonify(
            ok=False,
            message="No pudimos enviar la solicitud en este momento. Intenta nuevamente en unos minutos.",
            detail=str(exc) if env_bool("FLASK_DEBUG", False) else None,
        ), 502
    except Exception as exc:
        return app_error(exc, "No fue posible enviar la solicitud.")


# ---------------------------------------------------------------------------
# Garantías vinculadas a OTs finalizadas
# ---------------------------------------------------------------------------
@app.get("/api/garantias")
@require_session("COORDINADOR", "CLIENTE")
def api_garantias(session):
    return portal_actions["guarantees"](session)


@app.post("/api/garantias/<int:orden_id>/configurar")
@require_session("COORDINADOR")
def api_configurar_garantia(session, orden_id):
    return portal_actions["guarantee_config"](session, orden_id)


@app.post("/api/garantias/<int:garantia_id>/solicitar")
@require_session("CLIENTE")
def api_solicitar_revision_garantia(session, garantia_id):
    result = portal_actions["guarantee_request"](session, garantia_id)
    status = result[1] if isinstance(result, tuple) and len(result) > 1 else getattr(result, "status_code", 200)
    if int(status or 200) < 400:
        try:
            push_warranty_request(garantia_id)
        except Exception:
            app.logger.exception("No fue posible emitir el push de garantía.")
    return result


@app.post("/api/garantias/solicitudes/<int:solicitud_id>/estado")
@require_session("COORDINADOR")
def api_estado_solicitud_garantia(session, solicitud_id):
    data = request.get_json(silent=True) or {}
    result = portal_actions["guarantee_status"](session, solicitud_id)
    status = result[1] if isinstance(result, tuple) and len(result) > 1 else getattr(result, "status_code", 200)
    if int(status or 200) < 400:
        try:
            push_warranty_status(solicitud_id, str(data.get("estado") or "ACTUALIZADA"))
        except Exception:
            app.logger.exception("No fue posible emitir el push de estado de garantía.")
    return result


# ---------------------------------------------------------------------------
# Expedientes laborales / documentos de personal
# ---------------------------------------------------------------------------
def _labor_document_path(reference: str | None) -> Path | None:
    """Resuelve únicamente referencias privadas creadas por este módulo."""
    value = str(reference or "").strip()
    if not value.startswith(LABOR_DOCUMENT_PREFIX):
        return None
    name = value[len(LABOR_DOCUMENT_PREFIX):]
    if not name or Path(name).name != name:
        return None
    path = (LABOR_DOCUMENT_ROOT / name).resolve()
    try:
        path.relative_to(LABOR_DOCUMENT_ROOT)
    except ValueError:
        return None
    return path


def _labor_document_signature_ok(ext: str, payload: bytes) -> bool:
    if not payload:
        return False
    if ext == "pdf":
        return payload.startswith(b"%PDF-")
    if ext in {"jpg", "jpeg"}:
        return payload[:3] == b"\xff\xd8\xff"
    if ext == "png":
        return payload.startswith(b"\x89PNG\r\n\x1a\n")
    if ext == "webp":
        return len(payload) >= 12 and payload[:4] == b"RIFF" and payload[8:12] == b"WEBP"
    if ext == "docx":
        return payload.startswith(b"PK\x03\x04")
    if ext == "doc":
        return payload.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1")
    return False


def _prepare_labor_document_upload(storage):
    original = secure_filename(str(getattr(storage, "filename", "") or ""))
    if not original or "." not in original:
        raise ValueError("Selecciona un archivo válido.")
    ext = original.rsplit(".", 1)[1].lower()
    if ext not in LABOR_DOCUMENT_EXTENSIONS:
        raise ValueError("Formato no permitido. Usa PDF, Word, JPG, PNG o WEBP.")
    payload = storage.read(MAX_LABOR_DOCUMENT_BYTES + 1)
    if len(payload) > MAX_LABOR_DOCUMENT_BYTES:
        raise ValueError(f"El documento supera el límite de {MAX_LABOR_DOCUMENT_BYTES // (1024*1024)} MB.")
    if not _labor_document_signature_ok(ext, payload):
        raise ValueError("El contenido del archivo no coincide con su extensión.")
    return original, ext, LABOR_DOCUMENT_MIME[ext], payload


def _labor_employee_for_session(session, requested_employee_id=None):
    if session["rol"] == "TECNICO":
        employee_id = session.get("empleado_id")
        if not employee_id:
            raise Forbidden("Tu cuenta no está vinculada a un empleado.")
    else:
        try:
            employee_id = int(requested_employee_id)
        except (TypeError, ValueError):
            raise ValueError("Selecciona el empleado al que pertenece el documento.")
    row = query_one(
        """SELECT e.EmpleadoId AS empleado_id,e.PersonaId AS persona_id,e.CodigoEmpleado AS codigo,
                  LTRIM(RTRIM(CONCAT(p.Nombres,N' ',p.Apellidos))) AS empleado,pu.Nombre AS puesto,
                  e.EstadoLaboral AS estado_laboral,p.Activo AS persona_activa
             FROM rh.Empleado e
             INNER JOIN rh.Persona p ON p.PersonaId=e.PersonaId
             INNER JOIN rh.Puesto pu ON pu.PuestoId=e.PuestoId
            WHERE e.EmpleadoId=?""",
        (employee_id,),
    )
    if not row or not bool(row.get("persona_activa")):
        raise NotFound("Empleado no encontrado.")
    return row


def _labor_document_access(session, documento_id: int, include_inactive=True):
    row = query_one(
        """SELECT d.DocumentoLaboralId AS id,d.PersonaId AS persona_id,d.TipoDocumento AS tipo_documento,
                  d.NumeroDocumento AS numero_documento,d.FechaEmision AS fecha_emision,d.FechaVencimiento AS fecha_vencimiento,
                  d.RutaArchivo AS ruta_archivo,d.TipoMime AS tipo_mime,d.Verificado AS verificado,
                  d.VerificadoPorUsuarioId AS verificado_por,d.VerificadoEn AS verificado_en,d.Observaciones AS observaciones,
                  d.Activo AS activo,d.CreadoEn AS creado,d.ActualizadoEn AS actualizado,
                  e.EmpleadoId AS empleado_id,e.CodigoEmpleado AS codigo_empleado,
                  LTRIM(RTRIM(CONCAT(p.Nombres,N' ',p.Apellidos))) AS empleado,pu.Nombre AS puesto
             FROM rh.DocumentoLaboral d
             INNER JOIN rh.Persona p ON p.PersonaId=d.PersonaId
             LEFT JOIN rh.Empleado e ON e.PersonaId=d.PersonaId
             LEFT JOIN rh.Puesto pu ON pu.PuestoId=e.PuestoId
            WHERE d.DocumentoLaboralId=?""",
        (documento_id,),
    )
    if not row:
        raise NotFound("Documento no encontrado.")
    if session["rol"] == "TECNICO" and int(row.get("empleado_id") or -1) != int(session.get("empleado_id") or -2):
        raise NotFound("Documento no encontrado o sin acceso.")
    if session["rol"] == "TECNICO" and not bool(row.get("activo")):
        raise NotFound("Documento no encontrado o sin acceso.")
    if not include_inactive and not bool(row.get("activo")):
        raise NotFound("Documento no disponible.")
    return row


@app.get("/api/documentos-laborales/catalogos")
@require_session("COORDINADOR", "TECNICO")
def api_documentos_laborales_catalogos(session):
    try:
        if session["rol"] == "COORDINADOR":
            employees = query_all(
                """SELECT e.EmpleadoId AS id,e.PersonaId AS persona_id,e.CodigoEmpleado AS codigo,
                          LTRIM(RTRIM(CONCAT(p.Nombres,N' ',p.Apellidos))) AS nombre,pu.Nombre AS puesto,
                          e.EstadoLaboral AS estado
                     FROM rh.Empleado e
                     INNER JOIN rh.Persona p ON p.PersonaId=e.PersonaId
                     INNER JOIN rh.Puesto pu ON pu.PuestoId=e.PuestoId
                    WHERE p.Activo=1
                    ORDER BY CASE WHEN e.EstadoLaboral='ACTIVO' THEN 0 ELSE 1 END,p.Nombres,p.Apellidos"""
            )
        else:
            employees = query_all(
                """SELECT e.EmpleadoId AS id,e.PersonaId AS persona_id,e.CodigoEmpleado AS codigo,
                          LTRIM(RTRIM(CONCAT(p.Nombres,N' ',p.Apellidos))) AS nombre,pu.Nombre AS puesto,
                          e.EstadoLaboral AS estado
                     FROM rh.Empleado e
                     INNER JOIN rh.Persona p ON p.PersonaId=e.PersonaId
                     INNER JOIN rh.Puesto pu ON pu.PuestoId=e.PuestoId
                    WHERE e.EmpleadoId=? AND p.Activo=1""",
                (session.get("empleado_id") or -1,),
            )
        return jsonify(ok=True, empleados=employees, tipos=[
            "CURRICULUM / HOJA DE VIDA", "DPI", "ANTECEDENTES PENALES", "ANTECEDENTES POLICIACOS",
            "REFERENCIA LABORAL", "PERMISO DE INGRESO", "CONSTANCIA", "FORMULARIO", "REPORTE", "OTRO"
        ])
    except Exception as exc:
        return app_error(exc, "No fue posible cargar los datos del expediente laboral.")


@app.get("/api/documentos-laborales")
@require_session("COORDINADOR", "TECNICO")
def api_documentos_laborales(session):
    try:
        params = []
        access = "1=1"
        if session["rol"] == "TECNICO":
            access = "e.EmpleadoId=? AND d.Activo=1"
            params.append(session.get("empleado_id") or -1)
        employee_filter = request.args.get("empleado_id")
        if session["rol"] == "COORDINADOR" and employee_filter:
            try:
                params.append(int(employee_filter))
            except ValueError:
                raise ValueError("Filtro de empleado inválido.")
            access += " AND e.EmpleadoId=?"
        items = query_all(
            f"""SELECT d.DocumentoLaboralId AS id,d.PersonaId AS persona_id,e.EmpleadoId AS empleado_id,
                       e.CodigoEmpleado AS codigo_empleado,LTRIM(RTRIM(CONCAT(p.Nombres,N' ',p.Apellidos))) AS empleado,
                       pu.Nombre AS puesto,d.TipoDocumento AS tipo_documento,d.NumeroDocumento AS numero_documento,
                       d.FechaEmision AS fecha_emision,d.FechaVencimiento AS fecha_vencimiento,d.TipoMime AS tipo_mime,
                       d.Verificado AS verificado,d.VerificadoEn AS verificado_en,d.Observaciones AS observaciones,
                       d.Activo AS activo,d.CreadoEn AS creado,d.ActualizadoEn AS actualizado,
                       CONCAT('/api/documentos-laborales/',d.DocumentoLaboralId,'/archivo') AS archivo_url
                  FROM rh.DocumentoLaboral d
                  INNER JOIN rh.Persona p ON p.PersonaId=d.PersonaId
                  LEFT JOIN rh.Empleado e ON e.PersonaId=d.PersonaId
                  LEFT JOIN rh.Puesto pu ON pu.PuestoId=e.PuestoId
                 WHERE {access}
                 ORDER BY d.CreadoEn DESC,d.DocumentoLaboralId DESC""",
            tuple(params),
        )
        return jsonify(ok=True, items=items, total=len(items))
    except Exception as exc:
        return app_error(exc, "No fue posible consultar los expedientes laborales.")


@app.post("/api/documentos-laborales")
@require_session("COORDINADOR", "TECNICO")
def api_documentos_laborales_subir(session):
    saved_path = None
    try:
        employee = _labor_employee_for_session(session, request.form.get("empleado_id"))
        tipo = re.sub(r"\s+", " ", str(request.form.get("tipo_documento") or "").strip()).upper()[:100]
        if not tipo:
            raise ValueError("Selecciona el tipo de documento.")
        storage = request.files.get("archivo")
        if storage is None:
            raise ValueError("Selecciona el archivo que deseas subir.")
        _, ext, mime, payload = _prepare_labor_document_upload(storage)
        numero = str(request.form.get("numero_documento") or "").strip()[:80] or None
        observaciones = str(request.form.get("observaciones") or "").strip()[:500] or None
        emision_raw = str(request.form.get("fecha_emision") or "").strip()
        vence_raw = str(request.form.get("fecha_vencimiento") or "").strip()
        fecha_emision = date.fromisoformat(emision_raw) if emision_raw else None
        fecha_vencimiento = date.fromisoformat(vence_raw) if vence_raw else None
        if fecha_emision and fecha_vencimiento and fecha_vencimiento < fecha_emision:
            raise ValueError("La fecha de vencimiento no puede ser anterior a la fecha de emisión.")
        verified = session["rol"] == "COORDINADOR" and str(request.form.get("verificado") or "").lower() in {"1","true","on","si","sí"}

        LABOR_DOCUMENT_ROOT.mkdir(parents=True, exist_ok=True)
        stored_name = f"{secrets.token_hex(20)}.{ext}"
        saved_path = (LABOR_DOCUMENT_ROOT / stored_name).resolve()
        saved_path.write_bytes(payload)
        reference = LABOR_DOCUMENT_PREFIX + stored_name

        with get_db_connection() as conn:
            cursor = conn.cursor()
            set_audit_context(cursor, session, f"Carga de documento laboral: {tipo}")
            item = exec_proc_row(
                cursor,
                "EXEC rh.usp_DocumentoLaboral_Crear ?,?,?,?,?,?,?,?,?,?,?,?",
                (employee["persona_id"], tipo, reference, numero, fecha_emision, fecha_vencimiento, mime,
                 1 if verified else 0, session["usuario_id"] if verified else None,
                 utcnow() if verified else None, observaciones, 1),
            )
        return jsonify(ok=True, message="Documento agregado al expediente.", item=item), 201
    except Exception as exc:
        if saved_path and saved_path.is_file():
            try:
                saved_path.unlink()
            except OSError:
                app.logger.warning("No se pudo limpiar un documento laboral tras un fallo de registro.")
        return app_error(exc, "No fue posible guardar el documento laboral.")


@app.get("/api/documentos-laborales/<int:documento_id>/archivo")
@require_session("COORDINADOR", "TECNICO")
def api_documentos_laborales_archivo(session, documento_id: int):
    try:
        item = _labor_document_access(session, documento_id, include_inactive=session["rol"] == "COORDINADOR")
        path = _labor_document_path(item.get("ruta_archivo"))
        if not path or not path.is_file():
            return jsonify(ok=False, message="El registro existe, pero el archivo no está disponible en este almacenamiento."), 404
        ext = path.suffix.lower()
        base = secure_filename(f"{item.get('empleado') or 'empleado'}-{item.get('tipo_documento') or 'documento'}") or "documento"
        filename = f"{base}{ext}"
        as_attachment = request.args.get("download", "").lower() in {"1", "true", "yes", "si", "sí"}
        response = send_file(path, mimetype=item.get("tipo_mime") or "application/octet-stream",
                             as_attachment=as_attachment, download_name=filename, conditional=True, max_age=0)
        response.headers["Cache-Control"] = "private, no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response
    except Exception as exc:
        return app_error(exc, "No fue posible abrir el documento laboral.")


@app.post("/api/documentos-laborales/<int:documento_id>/verificar")
@require_session("COORDINADOR")
def api_documentos_laborales_verificar(session, documento_id: int):
    try:
        _labor_document_access(session, documento_id)
        with get_db_connection() as conn:
            cursor = conn.cursor()
            set_audit_context(cursor, session, "Verificación de documento laboral")
            cursor.execute("""UPDATE rh.DocumentoLaboral SET Verificado=1,VerificadoPorUsuarioId=?,VerificadoEn=SYSUTCDATETIME(),ActualizadoEn=SYSUTCDATETIME()
                              WHERE DocumentoLaboralId=?""", session["usuario_id"], documento_id)
            if cursor.rowcount == 0:
                raise NotFound("Documento no encontrado.")
        return jsonify(ok=True, message="Documento marcado como verificado.")
    except Exception as exc:
        return app_error(exc, "No fue posible verificar el documento.")


@app.post("/api/documentos-laborales/<int:documento_id>/estado")
@require_session("COORDINADOR")
def api_documentos_laborales_estado(session, documento_id: int):
    try:
        _labor_document_access(session, documento_id)
        data = request.get_json(silent=True) or {}
        active = bool(data.get("activo"))
        with get_db_connection() as conn:
            cursor = conn.cursor()
            set_audit_context(cursor, session, "Cambio de vigencia de documento laboral")
            cursor.execute("UPDATE rh.DocumentoLaboral SET Activo=?,ActualizadoEn=SYSUTCDATETIME() WHERE DocumentoLaboralId=?", 1 if active else 0, documento_id)
            if cursor.rowcount == 0:
                raise NotFound("Documento no encontrado.")
        return jsonify(ok=True, message="Documento reactivado." if active else "Documento archivado sin eliminar su historial.")
    except Exception as exc:
        return app_error(exc, "No fue posible actualizar el documento.")


# ---------------------------------------------------------------------------
# Documentos del servicio
# ---------------------------------------------------------------------------
@app.get("/api/documentos")
@require_session("COORDINADOR", "CLIENTE")
def api_documentos(session):
    return portal_listing(__import__(__name__,fromlist=["app"]),session,"documentos")


# ---------------------------------------------------------------------------
# Notificaciones

# ---------------------------------------------------------------------------
# Notificaciones
# ---------------------------------------------------------------------------
@app.get("/api/notificaciones")
@require_session("COORDINADOR", "TECNICO", "CLIENTE")
def api_notificaciones(session):
    try:
        page,size=pagination_args()
        filtro=str(request.args.get("filtro") or "TODAS").upper()
        with get_db_connection() as conn:
            cursor=conn.cursor(); set_audit_context(cursor,session,"Listado paginado de notificaciones")
            items=exec_proc_rows(cursor,"EXEC com.usp_NotificacionesPortal_Listar ?,?,?,?",(session["usuario_id"],filtro,page,size))
            sets=exec_proc_sets(cursor,"EXEC com.usp_NotificacionesResumenPortal ?",(session["usuario_id"],))
        summary=(sets[0][0] if sets and sets[0] else {})
        return paged_response(items,page,size,no_leidas=int(summary.get("no_leidas") or 0),total_todas=int(summary.get("total") or 0))
    except Exception as exc:
        return app_error(exc,"No fue posible cargar notificaciones.")

@app.get("/api/notificaciones/resumen")
@require_session("COORDINADOR", "TECNICO", "CLIENTE")
def api_notificaciones_resumen(session):
    try:
        with get_db_connection() as conn:
            cursor=conn.cursor(); sets=exec_proc_sets(cursor,"EXEC com.usp_NotificacionesResumenPortal ?",(session["usuario_id"],))
        summary=(sets[0][0] if sets and sets[0] else {}); items=sets[1] if len(sets)>1 else []
        return jsonify(ok=True,total=int(summary.get("total") or 0),no_leidas=int(summary.get("no_leidas") or 0),items=items)
    except Exception as exc:
        return app_error(exc,"No fue posible cargar el resumen de notificaciones.")

@app.post("/api/notificaciones/leer-todas")
@require_session("COORDINADOR", "TECNICO", "CLIENTE")
def api_leer_todas_notificaciones(session):
    try:
        with get_db_connection() as conn:
            cursor=conn.cursor(); set_audit_context(cursor,session,"Todas las notificaciones marcadas como leídas")
            row=exec_proc_row(cursor,"EXEC com.usp_MarcarTodasNotificacionesLeidasPortal ?",(session["usuario_id"],)) or {}
            conn.commit()
        updated=int(row.get("Actualizadas") or row.get("actualizadas") or 0)
        return jsonify(ok=True,message=f"{updated} notificación(es) marcada(s) como leída(s).",actualizadas=updated)
    except Exception as exc:
        return app_error(exc,"No fue posible actualizar las notificaciones.")

@app.post("/api/notificaciones/<int:notificacion_id>/leer")
@require_session("COORDINADOR", "TECNICO", "CLIENTE")
def api_leer_notificacion(session,notificacion_id:int):
    try:
        with get_db_connection() as conn:
            cursor=conn.cursor(); set_audit_context(cursor,session,"Notificación marcada como leída")
            exec_proc_rows(cursor,"EXEC com.usp_MarcarNotificacionLeidaPortal ?,?",(session["usuario_id"],notificacion_id))
            conn.commit()
        return jsonify(ok=True,message="Notificación leída.")
    except Exception as exc:
        return app_error(exc,"No fue posible actualizar la notificación.")


# ---------------------------------------------------------------------------
# Dispositivos y Web Push
# ---------------------------------------------------------------------------
@app.get("/api/push/config")
@require_session("COORDINADOR", "TECNICO", "CLIENTE")
def api_push_config(session):
    public_key = vapid_public_key() if push_enabled() else None
    return jsonify(
        ok=True,
        enabled=bool(push_enabled() and WEBPUSH_AVAILABLE and CRYPTOGRAPHY_AVAILABLE and public_key),
        public_key=public_key,
        library_available=bool(WEBPUSH_AVAILABLE),
        secure_context_required=True,
    )


@app.get("/api/push/dispositivos")
@require_session("COORDINADOR", "TECNICO", "CLIENTE")
def api_push_devices(session):
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            items = exec_proc_rows(cursor, "EXEC seg.usp_PushDispositivo_ListarActivos ?", (session["usuario_id"],))
        # Nunca devolver el endpoint/llaves de la suscripción al navegador.
        safe = [{
            "id": x.get("id") or x.get("DispositivoNotificacionId"),
            "nombre": x.get("nombre") or x.get("NombreDispositivo") or "Dispositivo",
            "plataforma": x.get("plataforma") or x.get("Plataforma") or "WEB",
            "ultimo_uso": x.get("ultimo_uso") or x.get("UltimoUsoEn"),
        } for x in items]
        return jsonify(ok=True, items=safe)
    except Exception as exc:
        return app_error(exc, "No fue posible consultar los dispositivos de notificación.")


@app.post("/api/push/suscribir")
@require_session("COORDINADOR", "TECNICO", "CLIENTE")
def api_push_subscribe(session):
    try:
        if not rate_limit_allowed("push-subscribe", str(session["usuario_id"]), 12, 600):
            return jsonify(ok=False, message="Demasiados intentos de registro de dispositivo. Espera unos minutos."), 429
        if not push_runtime_ready():
            return jsonify(ok=False, message="Las notificaciones push todavía no están configuradas en el servidor."), 503
        data = request.get_json(silent=True) or {}
        token = _compact_subscription(data.get("subscription"))
        name = str(data.get("nombre_dispositivo") or "Navegador").strip()[:120] or "Navegador"
        with get_db_connection() as conn:
            cursor = conn.cursor()
            set_audit_context(cursor, session, "Registro de dispositivo Web Push")
            row = exec_proc_row(cursor, "EXEC seg.usp_PushDispositivo_Registrar ?,?,?,?",
                                (session["usuario_id"], "WEB", token, name)) or {}
            conn.commit()
        return jsonify(ok=True, message="Notificaciones activadas en este dispositivo.", id=row.get("id") or row.get("DispositivoNotificacionId"))
    except ValueError as exc:
        return jsonify(ok=False, message=str(exc)), 400
    except Exception as exc:
        return app_error(exc, "No fue posible activar las notificaciones en este dispositivo.")


@app.post("/api/push/desuscribir")
@require_session("COORDINADOR", "TECNICO", "CLIENTE")
def api_push_unsubscribe(session):
    try:
        data = request.get_json(silent=True) or {}
        token = _compact_subscription(data.get("subscription"))
        with get_db_connection() as conn:
            cursor = conn.cursor()
            set_audit_context(cursor, session, "Desactivación de dispositivo Web Push")
            exec_proc_rows(cursor, "EXEC seg.usp_PushDispositivo_DesactivarPorToken ?,?", (session["usuario_id"], token))
            conn.commit()
        return jsonify(ok=True, message="Notificaciones desactivadas en este dispositivo.")
    except ValueError as exc:
        return jsonify(ok=False, message=str(exc)), 400
    except Exception as exc:
        return app_error(exc, "No fue posible desactivar las notificaciones.")


@app.delete("/api/push/dispositivos/<int:device_id>")
@require_session("COORDINADOR", "TECNICO", "CLIENTE")
def api_push_disable_device(session, device_id: int):
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            set_audit_context(cursor, session, "Desactivación remota de dispositivo Web Push")
            row = exec_proc_row(cursor, "EXEC seg.usp_PushDispositivo_Desactivar ?,?", (session["usuario_id"], device_id)) or {}
            conn.commit()
        if not row.get("ok", True):
            return jsonify(ok=False, message=row.get("message") or "Dispositivo no encontrado."), 404
        return jsonify(ok=True, message="Dispositivo desactivado.")
    except Exception as exc:
        return app_error(exc, "No fue posible desactivar el dispositivo.")


@app.post("/api/push/probar")
@require_session("COORDINADOR", "TECNICO", "CLIENTE")
def api_push_test(session):
    if not rate_limit_allowed("push-test", str(session["usuario_id"]), 3, 300):
        return jsonify(ok=False, message="Espera unos minutos antes de enviar otra prueba."), 429
    if not push_runtime_ready():
        return jsonify(ok=False, message="Web Push no está disponible en el servidor."), 503
    queue_web_push([session["usuario_id"]], title="Notificaciones de SEPRIGUA activas",
                   body="Este dispositivo ya puede recibir avisos importantes aunque el portal no esté al frente.",
                   role=session["rol"], tag=f"push-test-{session['usuario_id']}",
                   dedupe_key=f"push-test:{session['usuario_id']}:{int(time.time()//60)}", force=True)
    return jsonify(ok=True, message="Notificación de prueba enviada.")

# ---------------------------------------------------------------------------
# Auditoría

# ---------------------------------------------------------------------------
# Auditoría: solo coordinadores
# ---------------------------------------------------------------------------
@app.get("/api/auditoria")
@require_session("COORDINADOR")
def api_auditoria(session):
    return portal_listing(__import__(__name__,fromlist=["app"]),session,"auditoria")

@app.post("/api/auditoria/prueba")
@require_session("COORDINADOR")
def api_auditoria_prueba(session):
    """DML inocuo para verificar que TR_AUD_seg_Usuario recibe SESSION_CONTEXT."""
    try:
        before=query_one("SELECT ISNULL(MAX(EventoAuditoriaId),0) AS id FROM aud.EventoAuditoria")
        with get_db_connection() as conn:
            cursor=conn.cursor();set_audit_context(cursor,session,"PRUEBA_AUDITORIA_DESDE_WEB")
            cursor.execute("UPDATE seg.Usuario SET ActualizadoEn=SYSUTCDATETIME() WHERE UsuarioId=?",session["usuario_id"])
            conn.commit()
        event=query_one("""
            SELECT TOP 1 a.EventoAuditoriaId AS id,a.FechaEvento AS fecha,a.Esquema,a.Tabla,a.Operacion,
                   u.NombreUsuario AS usuario,a.Observacion
            FROM aud.EventoAuditoria a LEFT JOIN seg.Usuario u ON u.UsuarioId=a.UsuarioId
            WHERE a.EventoAuditoriaId>? ORDER BY a.EventoAuditoriaId DESC
        """,(before["id"],))
        if not event:
            return jsonify(ok=False,message="El UPDATE se ejecutó, pero no apareció un evento nuevo. Revisa los TR_AUD_* de la BD."),409
        return jsonify(ok=True,message="Auditoría funcionando: el cambio quedó registrado.",event=event)
    except Exception as exc: return app_error(exc,"No fue posible ejecutar la prueba de auditoría.")


@app.errorhandler(404)
def not_found(_error):
    return jsonify(ok=False, message="Recurso no encontrado."), 404


@app.errorhandler(413)
def too_large(_error):
    return jsonify(ok=False, message="El archivo supera el tamaño máximo permitido."), 413



def min_work_photos(): return max(0,min(20,int(os.getenv('OT_MIN_WORK_PHOTOS','1'))))

class PortalJSONProvider(DefaultJSONProvider):
    @staticmethod
    def default(value):
        if isinstance(value,datetime): return value.replace(tzinfo=timezone.utc).isoformat().replace('+00:00','Z') if value.tzinfo is None else value.astimezone(timezone.utc).isoformat().replace('+00:00','Z')
        if isinstance(value,date):return value.isoformat()
        if isinstance(value,Decimal):return str(value)
        return DefaultJSONProvider.default(value)
app.json=PortalJSONProvider(app)

@app.before_request
def validate_request():
    if request.path.startswith('/api/') and request.method not in {'GET','HEAD','OPTIONS'}:
        origin=request.headers.get('Origin')
        expected=urlsplit(os.getenv('PUBLIC_ORIGIN') or request.host_url)
        if origin:
            actual=urlsplit(origin)
            if actual.scheme!=expected.scheme or actual.netloc!=expected.netloc:raise Forbidden('Origen de solicitud no permitido.')
        if request.headers.get('Sec-Fetch-Site')=='cross-site':raise Forbidden('Origen de solicitud no permitido.')
        if request.is_json and not isinstance(request.get_json(silent=True),dict):raise ValueError('El formulario no tiene un formato válido.')

@app.after_request
def security_headers(response):
    response.headers['X-Content-Type-Options']='nosniff'
    response.headers['X-Frame-Options']='SAMEORIGIN'
    response.headers['Referrer-Policy']='strict-origin-when-cross-origin'
    response.headers['Permissions-Policy']='geolocation=(), microphone=(), camera=(self), payment=(), usb=()'
    response.headers['Content-Security-Policy']=(
        "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; "
        "script-src 'self' 'unsafe-inline' https://unpkg.com https://challenges.cloudflare.com; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; "
        "media-src 'self' blob: data:; connect-src 'self' https://challenges.cloudflare.com https://cdn.jsdelivr.net https://raw.githubusercontent.com; "
        "frame-src 'self' https://maps.google.com https://www.google.com https://challenges.cloudflare.com; form-action 'self'"
    )
    if request.path.startswith('/api/'):
        response.headers['Cache-Control']='private, no-store'
    if env_bool('ENABLE_HSTS',False) and request.is_secure:
        response.headers['Strict-Transport-Security']='max-age=31536000; includeSubDomains'
    return response

@app.errorhandler(HTTPException)
def http_error(error):return app_error(error)
@app.errorhandler(Exception)
def unexpected_error(error):return app_error(error)


if __package__:
    from .portal_extensions import register_extensions
    from .agenda_operativa import register_agenda_operativa
    from .evidence_storage import DatabaseEvidenceStorage
    from .listings import listing as portal_listing
else:
    from portal_extensions import register_extensions
    from agenda_operativa import register_agenda_operativa
    from evidence_storage import DatabaseEvidenceStorage
    from listings import listing as portal_listing
evidence_storage=DatabaseEvidenceStorage(lambda cursor,sql,arguments: exec_proc_row(cursor,sql,arguments))
portal_actions=register_extensions(__import__(__name__, fromlist=['app']))
agenda_actions=register_agenda_operativa(__import__(__name__, fromlist=['app']))

if __name__ == "__main__":
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "5000"))
    debug = env_bool("FLASK_DEBUG", False)
    print("\nSEPRIGUA LOCAL - SISTEMA FUNCIONAL")
    print(f"Sitio: http://{host}:{port}")
    print(f"Login: http://{host}:{port}/login")
    print(f"Prueba BD: http://{host}:{port}/api/db/health\n")
    app.run(host=host, port=port, debug=debug)
