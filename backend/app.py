from __future__ import annotations

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
from threading import Lock
from datetime import datetime, timedelta
from functools import wraps
from pathlib import Path

import pyodbc
from argon2.low_level import Type, hash_secret_raw
from dotenv import load_dotenv
from flask import Flask, jsonify, make_response, request, send_file, send_from_directory
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


BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = int(os.getenv("MAX_UPLOAD_MB", "25")) * 1024 * 1024

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

ROLE_PATHS = {
    "COORDINADOR": "/sistema/coordinador",
    "TECNICO": "/sistema/tecnico",
    "CLIENTE": "/sistema/cliente",
}


def env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "si", "sí", "on"}



CONTACT_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
CONTACT_RATE_LOCK = Lock()
CONTACT_RATE_BUCKETS: dict[str, list[float]] = {}


def contact_rate_allowed(ip: str, limit: int = 5, window_seconds: int = 600) -> bool:
    """Límite simple por IP para evitar spam masivo desde el formulario público."""
    now = time.monotonic()
    with CONTACT_RATE_LOCK:
        recent = [
            stamp
            for stamp in CONTACT_RATE_BUCKETS.get(ip, [])
            if now - stamp < window_seconds
        ]
        if len(recent) >= limit:
            CONTACT_RATE_BUCKETS[ip] = recent
            return False
        recent.append(now)
        CONTACT_RATE_BUCKETS[ip] = recent
        return True


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


def get_db_connection() -> pyodbc.Connection:
    driver = os.getenv("DB_DRIVER", "ODBC Driver 18 for SQL Server")
    server = os.getenv("DB_SERVER", "localhost")
    database = os.getenv("DB_NAME", "SEPRIGUA_DB")
    trust_cert = "yes" if env_bool("DB_TRUST_CERT", True) else "no"
    user = (os.getenv("DB_USER") or "").strip()
    password = os.getenv("DB_PASSWORD") or ""

    parts = [
        f"DRIVER={{{driver}}}",
        f"SERVER={server}",
        f"DATABASE={database}",
        "Encrypt=yes",
        f"TrustServerCertificate={trust_cert}",
    ]
    if user:
        parts.extend([f"UID={user}", f"PWD={password}"])
    else:
        parts.append("Trusted_Connection=yes")
    return pyodbc.connect(";".join(parts) + ";", timeout=8, autocommit=False)


def utcnow() -> datetime:
    return datetime.utcnow().replace(microsecond=0)


def parse_datetime_local(value, field_name: str = "fecha") -> datetime | None:
    """Convierte el valor de <input type="datetime-local"> a datetime para pyodbc.

    Enviar la cadena ISO directamente a un EXEC parametrizado puede hacer que
    SQL Server la trate como NVARCHAR y falle su conversión a DATETIME2 según
    el formato/configuración de la sesión. Con un objeto datetime, pyodbc envía
    el parámetro con el tipo temporal correcto.
    """
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=None, microsecond=0)
    raw = str(value).strip()
    if not raw:
        return None
    try:
        normalized = raw[:-1] + "+00:00" if raw.endswith("Z") else raw
        parsed = datetime.fromisoformat(normalized)
        if parsed.tzinfo is not None:
            parsed = parsed.replace(tzinfo=None)
        return parsed.replace(microsecond=0)
    except ValueError as exc:
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


def client_ip() -> str | None:
    forwarded = (request.headers.get("X-Forwarded-For") or "").split(",")[0].strip()
    return forwarded or request.remote_addr


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
            WHERE s.TokenHash = ?
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

        return {
            "sesion_id": str(row.SesionUsuarioId),
            "usuario_id": int(row.UsuarioId),
            "usuario": row.NombreUsuario,
            "correo": row.Correo,
            "rol": (row.Rol or "").upper(),
            "nombre": row.NombreCompleto or row.NombreUsuario,
            "cliente": row.Cliente,
            "cliente_id": int(row.ClienteId) if row.ClienteId is not None else None,
            "empleado_id": int(row.EmpleadoId) if row.EmpleadoId is not None else None,
            "contacto_cliente_id": int(row.ContactoClienteId) if row.ContactoClienteId is not None else None,
            "requiere_cambio_contrasena": bool(row.RequiereCambioContrasena),
            "expira_en": row.ExpiraEn.isoformat(),
        }


def require_session(*roles):
    allowed = {str(r).upper() for r in roles}

    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            try:
                session = current_session()
            except pyodbc.Error:
                app.logger.exception("Error consultando sesión")
                return jsonify(ok=False, message="No fue posible consultar la sesión."), 503
            if not session:
                response = make_response(jsonify(ok=False, message="Sesión no válida o expirada."), 401)
                return clear_session_cookie(response)
            if allowed and session["rol"] not in allowed:
                return jsonify(ok=False, message="No tienes permiso para realizar esta acción."), 403
            return fn(session, *args, **kwargs)

        return wrapper

    return decorator


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


def app_error(exc: Exception, public="No fue posible completar la operación."):
    app.logger.exception(public)
    detail = None
    if env_bool("FLASK_DEBUG", True):
        raw = str(exc).replace("\n", " ").strip()
        detail = raw[-1400:] if raw else exc.__class__.__name__
    return jsonify(ok=False, message=public, detail=detail), 500


def require_value(data, key, message=None):
    value = data.get(key)
    if value is None or (isinstance(value, str) and not value.strip()):
        raise ValueError(message or f"El campo {key} es obligatorio.")
    return value


def allowed_file(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_UPLOADS


def prepare_upload(file_storage) -> dict:
    """Lee, valida y normaliza un archivo antes de guardarlo en la base de datos.

    Las imágenes se redimensionan y convierten a WebP para reducir el tamaño
    almacenado. PDF y video conservan su formato original dentro de los límites
    configurados.
    """
    original = secure_filename(file_storage.filename or "") or "archivo"
    if "." not in original:
        raise ValueError("El archivo no tiene una extensión válida.")

    ext = original.rsplit(".", 1)[1].lower()
    if ext not in ALLOWED_UPLOADS:
        raise ValueError("Formato no permitido.")

    raw = file_storage.read()
    if not raw:
        raise ValueError("El archivo está vacío.")

    if ext in IMAGE_EXTENSIONS:
        if not PILLOW_AVAILABLE:
            raise RuntimeError("Falta Pillow para procesar imágenes de evidencia.")
        try:
            with Image.open(io.BytesIO(raw)) as img:
                img = ImageOps.exif_transpose(img)
                img.load()
                if img.width < 1 or img.height < 1:
                    raise ValueError("La imagen no es válida.")
                img.thumbnail(
                    (IMAGE_MAX_DIMENSION, IMAGE_MAX_DIMENSION),
                    Image.Resampling.LANCZOS,
                )
                if img.mode not in {"RGB", "RGBA"}:
                    img = img.convert("RGBA" if "A" in img.getbands() else "RGB")
                out = io.BytesIO()
                img.save(out, format="WEBP", quality=IMAGE_WEBP_QUALITY, method=6)
                content = out.getvalue()
        except (OSError, ValueError) as exc:
            raise ValueError("La imagen está dañada o no es un formato válido.") from exc
        if len(content) > MAX_IMAGE_BYTES:
            raise ValueError(
                f"La imagen optimizada supera el límite de {MAX_IMAGE_BYTES // (1024 * 1024)} MB."
            )
        original = f"{Path(original).stem}.webp"
        mime = "image/webp"
        file_type = "FOTO"
        optimized = True

    elif ext in PDF_EXTENSIONS:
        if not raw.startswith(b"%PDF-"):
            raise ValueError("El PDF no tiene una estructura válida.")
        if len(raw) > MAX_PDF_BYTES:
            raise ValueError(
                f"El PDF supera el límite de {MAX_PDF_BYTES // (1024 * 1024)} MB."
            )
        content = raw
        mime = "application/pdf"
        file_type = "PDF"
        optimized = False

    elif ext in VIDEO_EXTENSIONS:
        if len(raw) > MAX_VIDEO_BYTES:
            raise ValueError(
                f"El video supera el límite de {MAX_VIDEO_BYTES // (1024 * 1024)} MB."
            )
        content = raw
        mime = "video/quicktime" if ext == "mov" else "video/mp4"
        file_type = "VIDEO"
        optimized = False

    else:
        raise ValueError("Formato no permitido.")

    return {
        "nombre": original[:260],
        "extension": Path(original).suffix.lstrip(".").lower() or ext,
        "tipo": file_type,
        "mime": mime[:120],
        "contenido": content,
        "tamano": len(content),
        "hash_sha256": hashlib.sha256(content).digest(),
        "optimizado": optimized,
    }


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
            row = exec_proc_row(
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
# Salud, autenticación y sesión
# ---------------------------------------------------------------------------
@app.get("/api/db/health")
def db_health():
    try:
        row = query_one(
            """
            SELECT DB_NAME() AS BaseDatos, @@SERVERNAME AS Servidor,
                   (SELECT COUNT(*) FROM seg.Usuario WHERE Activo = 1) AS UsuariosActivos,
                   CASE WHEN OBJECT_ID(N'srv.usp_AppCrearSolicitud', N'P') IS NOT NULL THEN 1 ELSE 0 END AS MigracionSistema
            """
        )
        return jsonify(ok=True, database=row["BaseDatos"], server=row["Servidor"],
                       active_users=int(row["UsuariosActivos"]), system_migration=bool(row["MigracionSistema"]))
    except Exception as exc:
        return app_error(exc, "No se pudo conectar con la base de datos.")


@app.post("/api/auth/login")
def api_login():
    data = request.get_json(silent=True) or {}
    identity = str(data.get("identity") or "").strip()
    password = str(data.get("password") or "")
    remember = bool(data.get("remember"))
    if not identity or not password:
        return jsonify(ok=False, message="Ingresa tu usuario y contraseña."), 400

    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT TOP (1) u.UsuarioId, u.NombreUsuario, u.Correo, u.ContrasenaHash,
                       u.ContrasenaSalt, u.RequiereCambioContrasena, u.IntentosFallidos,
                       u.BloqueadoHasta, u.Activo, r.Nombre AS Rol
                FROM seg.Usuario u
                INNER JOIN seg.Rol r ON r.RolId = u.RolId
                WHERE u.NombreUsuario = ? OR (u.Correo IS NOT NULL AND u.Correo = ?)
                """,
                identity, identity,
            )
            user = cursor.fetchone()
            if not user:
                return jsonify(ok=False, message="Usuario o contraseña incorrectos."), 401
            if not bool(user.Activo):
                return jsonify(ok=False, message="El usuario se encuentra deshabilitado."), 403

            now = utcnow()
            if user.BloqueadoHasta and user.BloqueadoHasta > now:
                return jsonify(ok=False, message="La cuenta está temporalmente bloqueada. Intenta más tarde."), 423
            if user.BloqueadoHasta and user.BloqueadoHasta <= now:
                cursor.execute("UPDATE seg.Usuario SET IntentosFallidos=0, BloqueadoHasta=NULL, ActualizadoEn=SYSUTCDATETIME() WHERE UsuarioId=?", user.UsuarioId)
                conn.commit()

            if not verify_password(password, user.ContrasenaSalt, user.ContrasenaHash):
                cursor.execute(
                    """
                    UPDATE seg.Usuario
                    SET IntentosFallidos=IntentosFallidos+1,
                        BloqueadoHasta=CASE WHEN IntentosFallidos+1>=5 THEN DATEADD(MINUTE,15,SYSUTCDATETIME()) ELSE NULL END,
                        ActualizadoEn=SYSUTCDATETIME()
                    WHERE UsuarioId=?
                    """,
                    user.UsuarioId,
                )
                conn.commit()
                return jsonify(ok=False, message="Usuario o contraseña incorrectos."), 401

            role = (user.Rol or "").upper()
            redirect_to = ROLE_PATHS.get(role)
            if not redirect_to:
                return jsonify(ok=False, message="El usuario no tiene un rol válido para ingresar."), 403

            cursor.execute(
                "UPDATE seg.Usuario SET IntentosFallidos=0, BloqueadoHasta=NULL, UltimoAccesoEn=SYSUTCDATETIME(), ActualizadoEn=SYSUTCDATETIME() WHERE UsuarioId=?",
                user.UsuarioId,
            )
            raw_token, expires, hours = create_session(cursor, int(user.UsuarioId), remember)
            conn.commit()

            response = make_response(jsonify(ok=True, message="Inicio de sesión correcto.", usuario=user.NombreUsuario,
                                             rol=role, requiere_cambio_contrasena=bool(user.RequiereCambioContrasena),
                                             redirect=redirect_to))
            response.set_cookie(COOKIE_NAME, raw_token, max_age=hours * 3600, expires=expires, httponly=True,
                                secure=env_bool("COOKIE_SECURE", False), samesite="Lax", path="/")
            return response
    except pyodbc.Error as exc:
        return app_error(exc, "No fue posible comunicarse con la base de datos.")
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
    if not row:
        return None
    result = dict(row)
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


def _respuesta_error_usuario(exc: Exception, public: str):
    raw = str(exc).replace("\n", " ").strip()
    upper = raw.upper()
    if "DUPLICATE KEY" in upper or "UNIQUE" in upper or "2601" in upper or "2627" in upper:
        if "CORREO" in upper:
            msg = "Ese correo ya está asociado a otra cuenta."
        elif "NOMBREUSUARIO" in upper or "UQ_SEG_USUARIO_1" in upper:
            msg = "Ese nombre de usuario ya existe."
        else:
            msg = "Ya existe una cuenta con los datos indicados."
        return jsonify(ok=False, message=msg), 409
    # Mensajes THROW de la capa SQL (reglas de negocio) sí son seguros para mostrar.
    match = re.search(r"\[Microsoft\]\[ODBC Driver[^\]]*\]\[SQL Server\](.*?)(?:\(|$)", raw)
    if match:
        sql_msg = match.group(1).strip(" .")
        if sql_msg:
            return jsonify(ok=False, message=sql_msg), 400
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
        return jsonify(
            ok=True,
            roles=sets[0] if len(sets) > 0 else [],
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
        activo = bool(data.get("activo"))
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
    if precio < 0:
        raise ValueError("El precio no puede ser negativo.")
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


def _catalog_payload(*, solo_activos: bool = False, pagina: int = 1, tamano: int = 200) -> tuple[list[dict], int]:
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
                "id": f"custom:{int(row['ConceptoCotizacionId'])}",
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
        current = next((x for x in _catalog_payload(pagina=1, tamano=200)[0] if x["id"] == item_id), None)
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
            payload["clientes"] = query_all("SELECT ClienteId AS id, CodigoCliente AS codigo, NombreComercial AS nombre FROM crm.Cliente WHERE Activo=1 ORDER BY NombreComercial")
            payload["tecnicos"] = query_all(
                """
                SELECT e.EmpleadoId AS id, e.CodigoEmpleado AS codigo,
                       LTRIM(RTRIM(CONCAT(p.Nombres,N' ',p.Apellidos))) AS nombre,
                       e.Disponibilidad AS disponibilidad
                FROM rh.Empleado e
                INNER JOIN rh.Persona p ON p.PersonaId=e.PersonaId
                INNER JOIN rh.Puesto pu ON pu.PuestoId=e.PuestoId
                WHERE e.EstadoLaboral='ACTIVO' AND pu.EsTecnico=1
                ORDER BY p.Nombres,p.Apellidos
                """
            )
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
    try:
        page, size = pagination_args()
        with get_db_connection() as conn:
            cursor=conn.cursor(); set_audit_context(cursor,session,"Listado paginado de solicitudes")
            items=exec_proc_rows(cursor,"EXEC srv.usp_AppSolicitudesPortal_Listar ?,?,?",(session["usuario_id"],page,size))
        return paged_response(items,page,size)
    except Exception as exc:
        return app_error(exc, "No fue posible cargar las solicitudes.")

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
        if clasificacion == "PROGRAMADA":
            urgencia = None
        else:
            urgencia = str(data.get("urgencia") or "ALTA").upper()
            if urgencia not in {"BAJA", "MEDIA", "ALTA", "CRITICA"}:
                raise ValueError("Selecciona un nivel de urgencia válido.")
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
        evidencias = query_all(
            """
            SELECT EvidenciaServicioId AS id,Categoria AS categoria,Etapa AS etapa,TipoArchivo AS tipo,
                   NombreArchivo AS nombre,CONCAT('/api/archivos/evidencia/',EvidenciaServicioId) AS ruta,Descripcion,TomadaEn AS tomada,CreadoEn AS creada
            FROM srv.EvidenciaServicio
            WHERE SolicitudServicioId=?
            ORDER BY CreadoEn DESC
            """,
            (solicitud_id,),
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
            row = exec_proc_row(
                cursor,
                "EXEC srv.usp_EvidenciaServicio_CrearConArchivo ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?",
                (
                    "CLIENTE" if session["rol"] == "CLIENTE" else "COORDINADOR",
                    category, prepared["tipo"], prepared["nombre"], pyodbc.Binary(prepared["contenido"]),
                    solicitud_id, None, session["usuario_id"], session.get("empleado_id"),
                    "INICIAL", prepared["mime"], prepared["tamano"], description, 0, None, None,
                ),
            )
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
    try:
        page,size=pagination_args()
        with get_db_connection() as conn:
            cursor=conn.cursor(); set_audit_context(cursor,session,"Listado paginado de órdenes")
            items=exec_proc_rows(cursor,"EXEC srv.usp_AppOrdenesPortal_Listar ?,?,?",(session["usuario_id"],page,size))
        return paged_response(items,page,size)
    except Exception as exc:
        return app_error(exc, "No fue posible cargar las órdenes.")

@app.get("/api/ordenes/<int:orden_id>")
@require_session("COORDINADOR", "TECNICO", "CLIENTE")
def api_orden_detalle(session, orden_id: int):
    try:
        permission = ""
        params = [orden_id]
        if session["rol"] == "TECNICO":
            permission = "AND EXISTS(SELECT 1 FROM srv.TecnicoOrden tx WHERE tx.OrdenTrabajoId=o.OrdenTrabajoId AND tx.EmpleadoId=? AND tx.Estado='ASIGNADO')"
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
            FROM srv.IncidenciaOrden WHERE OrdenTrabajoId=? ORDER BY ReportadaEn DESC
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
            cotizaciones=cotizaciones,progress=progress
        )
    except Exception as exc:
        return app_error(exc, "No fue posible cargar el detalle de la orden.")


@app.post("/api/ordenes")
@require_session("COORDINADOR")
def api_crear_orden(session):
    data = request.get_json(silent=True) or {}
    try:
        solicitud_id = int(require_value(data, "solicitud_id", "Selecciona una solicitud."))
        prioridad = str(data.get("prioridad") or "MEDIA").upper()
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
                WHERE e.EmpleadoId IN ({placeholders}) AND e.EstadoLaboral='ACTIVO' AND p.EsTecnico=1
                  AND e.Disponibilidad NOT IN ('VACACIONES','INACTIVO')
                """, *ids)
            valid = {int(r[0]) for r in cursor.fetchall()}
            invalid = [i for i in ids if i not in valid]
            if invalid:
                raise ValueError("Uno o más integrantes no están disponibles como personal técnico activo.")

            cursor.execute("SELECT EmpleadoId FROM srv.TecnicoOrden WHERE OrdenTrabajoId=? AND Estado='ASIGNADO'", orden_id)
            current_ids = {int(r[0]) for r in cursor.fetchall()}
            removed = current_ids.difference(ids)
            if removed:
                rem_ph = ",".join("?" for _ in removed)
                cursor.execute(
                    f"""
                    UPDATE srv.TecnicoOrden SET Estado='DESASIGNADO',DesasignadoEn=SYSUTCDATETIME()
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
                    WHERE EmpleadoId=? AND EstadoLaboral='ACTIVO' AND Disponibilidad NOT IN ('VACACIONES','INACTIVO')
                    """, employee_id, employee_id)
            conn.commit()
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
            if not str(closure.get("ticket") or "").strip():
                return jsonify(ok=False,message="Paso 1 pendiente: registra el número de ticket antes de finalizar la OT."),409
            has_paper_number = bool(str(closure.get("orden_papel") or "").strip())
            has_paper_file = int(closure.get("documentos") or 0) > 0
            # La hoja física es opcional. Si se usa, número y respaldo deben existir juntos.
            if has_paper_number and not has_paper_file:
                return jsonify(ok=False,message="La OT/OC física tiene número registrado; adjunta también su foto o PDF para validarla."),409
            if has_paper_file and not has_paper_number:
                return jsonify(ok=False,message="Se adjuntó una OT/OC física; registra también su número para completar el respaldo."),409
            if int(closure.get("fotos") or 0) < 6:
                return jsonify(ok=False,message=f"Paso 2 pendiente: se requieren al menos 6 fotos del trabajo. Actualmente hay {int(closure.get('fotos') or 0)}."),409
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
            if photos < 6:
                return jsonify(ok=False,message=f"Faltan evidencias: se requieren al menos 6 fotos del trabajo. Actualmente hay {photos}."),409
            if activities < 1 and documents < 1:
                return jsonify(ok=False,message="Registra al menos una actividad realizada o adjunta la OT/documento físico antes de enviar a confirmación."),409
            if int(progress.get("cambios_pendientes") or 0) > 0:
                return jsonify(ok=False,message="Hay cambios de alcance pendientes de respuesta. Resuélvelos antes de enviar el servicio a confirmación."),409

        with get_db_connection() as conn:
            cursor = conn.cursor()
            set_audit_context(cursor, session, "Cambio de estado de OT")
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
            conn.commit()
        return jsonify(ok=True, message="Estado actualizado.", item=row)
    except ValueError as exc:
        return jsonify(ok=False, message=str(exc)), 400
    except Exception as exc:
        return app_error(exc, "No fue posible cambiar el estado.")


@app.post("/api/ordenes/<int:orden_id>/confirmar")
@require_session("CLIENTE")
def api_confirmar_orden_cliente(session, orden_id: int):
    data = request.get_json(silent=True) or {}
    try:
        resultado = str(data.get("resultado") or "CONFORME").upper()
        if resultado not in {"CONFORME","CON_OBSERVACIONES","NO_CONFORME"}:
            raise ValueError("Resultado de confirmación inválido.")
        observaciones = str(data.get("observaciones") or "").strip()[:900] or None
        if resultado != "CONFORME" and not observaciones:
            raise ValueError("Indica la observación o corrección requerida.")
        row = query_one(
            """
            SELECT o.OrdenTrabajoId AS id,o.NumeroOrden AS numero,e.Codigo AS estado
            FROM srv.OrdenTrabajo o
            INNER JOIN srv.SolicitudServicio s ON s.SolicitudServicioId=o.SolicitudServicioId
            INNER JOIN srv.EstadoOrdenTrabajo e ON e.EstadoOrdenTrabajoId=o.EstadoOrdenTrabajoId
            WHERE o.OrdenTrabajoId=? AND s.ClienteId=?
            """, (orden_id, session.get("cliente_id") or -1))
        if not row:
            return jsonify(ok=False, message="La orden no pertenece a tu cliente."), 404
        if str(row.get("estado") or "").upper() != "POR_CONFIRMAR":
            return jsonify(ok=False, message="La orden todavía no está disponible para confirmación."), 400

        with get_db_connection() as conn:
            cursor = conn.cursor()
            set_audit_context(cursor, session, "Respuesta final del cliente al servicio")
            if resultado == "CONFORME":
                cursor.execute("UPDATE srv.OrdenTrabajo SET RequiereCorreccion=0,MotivoCorreccion=NULL,ActualizadoEn=SYSUTCDATETIME() WHERE OrdenTrabajoId=?", orden_id)
                cursor.execute("SELECT TOP 1 EstadoOrdenTrabajoId FROM srv.EstadoOrdenTrabajo WHERE Codigo='COMPLETADA' AND Activo=1")
                state_row = cursor.fetchone()
                if not state_row:
                    raise RuntimeError("No se encontró el estado FINALIZADA configurado en el sistema.")
                item = exec_proc_row(cursor,"EXEC srv.usp_AppCambiarEstadoOrden ?,?,?,?",(orden_id,int(state_row[0]),session["usuario_id"],"Servicio confirmado conforme por el cliente"))
                message = "Servicio confirmado correctamente."
            else:
                cursor.execute(
                    "UPDATE srv.OrdenTrabajo SET RequiereCorreccion=1,MotivoCorreccion=?,ActualizadoEn=SYSUTCDATETIME() WHERE OrdenTrabajoId=?",
                    observaciones,orden_id)
                item = {"OrdenTrabajoId": orden_id, "CodigoEstado": "POR_CONFIRMAR", "RequiereCorreccion": True}
                message = "Observación enviada a SEPRIGUA para corrección."

            # Avisar al coordinador; los técnicos ven también la corrección cuando aplique.
            cursor.execute(
                """
                INSERT INTO com.Notificacion(UsuarioId,Tipo,Titulo,Mensaje,Entidad,EntidadId,Canal,Estado)
                SELECT CoordinadorUsuarioId,'CONFIRMACION_CLIENTE',N'Respuesta del cliente',
                       CONCAT(N'La OT ',NumeroOrden,N' recibió respuesta: ',?,CASE WHEN ? IS NULL THEN N'' ELSE CONCAT(N' - ',?) END),
                       'OrdenTrabajo',CONVERT(nvarchar(80),OrdenTrabajoId),'SISTEMA','PENDIENTE'
                FROM srv.OrdenTrabajo WHERE OrdenTrabajoId=?
                """, resultado,observaciones,observaciones,orden_id)
            if resultado != "CONFORME":
                cursor.execute(
                    """
                    INSERT INTO com.Notificacion(UsuarioId,Tipo,Titulo,Mensaje,Entidad,EntidadId,Canal,Estado)
                    SELECT DISTINCT u.UsuarioId,'CORRECCION_OT',N'Corrección solicitada por cliente',
                           CONCAT(N'La OT ',o.NumeroOrden,N' requiere corrección: ',?),
                           'OrdenTrabajo',CONVERT(nvarchar(80),o.OrdenTrabajoId),'SISTEMA','PENDIENTE'
                    FROM srv.TecnicoOrden t INNER JOIN seg.Usuario u ON u.EmpleadoId=t.EmpleadoId AND u.Activo=1
                    INNER JOIN srv.OrdenTrabajo o ON o.OrdenTrabajoId=t.OrdenTrabajoId
                    WHERE t.OrdenTrabajoId=? AND t.Estado='ASIGNADO'
                    """, observaciones,orden_id)
            conn.commit()
        return jsonify(ok=True,message=message,item=item,resultado=resultado)
    except ValueError as exc:
        return jsonify(ok=False,message=str(exc)),400
    except Exception as exc:
        return app_error(exc,"No fue posible registrar la confirmación del servicio.")


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
                INSERT INTO srv.CambioAlcance
                  (OrdenTrabajoId,ReportadoPorEmpleadoId,DescripcionOriginal,CambioDetectado,Motivo,TrabajoAdicionalPropuesto,
                   InformadoPorUsuarioId,ContactoAutorizadorId,EstadoAutorizacion,ObservacionesRespuesta,RespondidoEn)
                VALUES(?,?,?,?,?,?,NULL,NULL,'PENDIENTE',NULL,NULL)
                """,orden_id,empleado_id,original,detected,reason,proposal)
            change_id=int(cursor.execute("SELECT SCOPE_IDENTITY()").fetchone()[0])
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
            row = exec_proc_row(
                cursor,
                "EXEC srv.usp_EvidenciaServicio_CrearConArchivo ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?",
                (
                    session["rol"], category, prepared["tipo"], prepared["nombre"], pyodbc.Binary(prepared["contenido"]),
                    None, orden_id, session["usuario_id"], session.get("empleado_id"), stage,
                    prepared["mime"], prepared["tamano"], description, include_collage, None, None,
                ),
            )
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
    activo = bool(data.get("activo"))
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
@app.get("/api/clientes")
@require_session("COORDINADOR")
def api_clientes(session):
    try:
        page,size=pagination_args()
        with get_db_connection() as conn:
            cursor=conn.cursor(); set_audit_context(cursor,session,"Listado paginado de clientes")
            items=exec_proc_rows(cursor,"EXEC crm.usp_AppClientesPortal_Listar ?,?",(page,size))
        return paged_response(items,page,size)
    except Exception as exc:
        return app_error(exc, "No fue posible cargar los clientes.")

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
@app.get("/api/personal")
@require_session("COORDINADOR")
def api_personal(session):
    try:
        page,size=pagination_args()
        with get_db_connection() as conn:
            cursor=conn.cursor(); set_audit_context(cursor,session,"Listado paginado de personal")
            items=exec_proc_rows(cursor,"EXEC rh.usp_AppPersonalPortal_Listar ?,?",(page,size))
        return paged_response(items,page,size)
    except Exception as exc:
        return app_error(exc, "No fue posible cargar el personal.")

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
    try:
        page,size=pagination_args()
        with get_db_connection() as conn:
            cursor=conn.cursor(); set_audit_context(cursor,session,"Listado paginado de vacaciones")
            items=exec_proc_rows(cursor,"EXEC rh.usp_AppVacacionesPortal_Listar ?,?,?",(session["usuario_id"],page,size))
        return paged_response(items,page,size)
    except Exception as exc:
        return app_error(exc, "No fue posible cargar vacaciones.")


@app.get("/api/equipos")
@require_session("COORDINADOR", "TECNICO")
def api_equipos(session):
    try:
        page,size=pagination_args()
        with get_db_connection() as conn:
            cursor=conn.cursor(); set_audit_context(cursor,session,"Listado paginado de equipos")
            items=exec_proc_rows(cursor,"EXEC eqp.usp_AppEquiposPortal_Listar ?,?",(page,size))
        return paged_response(items,page,size)
    except Exception as exc:
        return app_error(exc,"No fue posible cargar equipos.")

@app.post("/api/equipos")
@require_session("COORDINADOR")
def api_equipo_crear(session):
    data=request.get_json(silent=True) or {}
    try:
        codigo=str(require_value(data,"codigo","Ingresa el código del equipo.")).strip()
        nombre=str(require_value(data,"nombre","Ingresa el nombre del equipo.")).strip()
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
    try:
        page,size=pagination_args()
        with get_db_connection() as conn:
            cursor=conn.cursor(); set_audit_context(cursor,session,"Listado paginado de mantenimientos")
            items=exec_proc_rows(cursor,"EXEC eqp.usp_AppMantenimientosPortal_Listar ?,?",(page,size))
        return paged_response(items,page,size)
    except Exception as exc:
        return app_error(exc,"No fue posible cargar mantenimientos.")

@app.post("/api/mantenimientos")
@require_session("COORDINADOR")
def api_crear_mantenimiento(session):
    data=request.get_json(silent=True) or {}
    try:
        equipo_id=int(require_value(data,"equipo_id","Selecciona un equipo.")); tipo=str(data.get("tipo") or "PREVENTIVO").upper()
        with get_db_connection() as conn:
            cursor=conn.cursor(); set_audit_context(cursor,session,"Programación de mantenimiento interno")
            fecha_programada=parse_datetime_local(data.get("fecha_programada"),"Fecha programada del mantenimiento")
            row=exec_proc_row(cursor,"EXEC eqp.usp_AppCrearMantenimiento ?,?,?,?,?,?",(equipo_id,tipo,fecha_programada,data.get("diagnostico") or None,data.get("trabajo_requerido") or None,session["usuario_id"]))
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
        amount = float(value or 0)
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
    styles = getSampleStyleSheet()
    navy = rl_colors.HexColor("#0B3C78")
    blue = rl_colors.HexColor("#1769C2")
    red = rl_colors.HexColor("#EF2347")
    light = rl_colors.HexColor("#F3F7FC")
    muted = rl_colors.HexColor("#5D728E")
    title_style = ParagraphStyle("SepriguaTitle", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=21, leading=24, textColor=navy, spaceAfter=4)
    label_style = ParagraphStyle("SepriguaLabel", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=8, leading=10, textColor=muted)
    body_style = ParagraphStyle("SepriguaBody", parent=styles["BodyText"], fontName="Helvetica", fontSize=9, leading=13, textColor=rl_colors.HexColor("#1B365D"))
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
    rows = [[Paragraph("#", label_style), Paragraph("Descripción", label_style), Paragraph("Cantidad", label_style), Paragraph("Unidad", label_style), Paragraph("Precio", label_style), Paragraph("Total", label_style)]]
    for line in details:
        rows.append([
            Paragraph(_pdf_text(line.get("numero_linea")), body_style),
            Paragraph(_pdf_text(line.get("descripcion")), body_style),
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

    doc.build(story)
    buffer.seek(0)
    return buffer


@app.get("/api/cotizaciones")
@require_session("COORDINADOR", "CLIENTE")
def api_cotizaciones(session):
    try:
        page,size=pagination_args()
        with get_db_connection() as conn:
            cursor=conn.cursor(); set_audit_context(cursor,session,"Listado paginado de cotizaciones del portal")
            items=exec_proc_rows(cursor,"EXEC cot.usp_CotizacionesPortal_Paginar ?,?,?",(session["usuario_id"],page,size))
        return paged_response(items,page,size)
    except Exception as exc:
        return app_error(exc, "No fue posible cargar cotizaciones.")

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
    data=request.get_json(silent=True) or {}
    try:
        orden_id=int(require_value(data,"orden_id","Selecciona una orden."))
        descripcion=str(require_value(data,"descripcion","Describe el servicio cotizado."))
        precio=float(require_value(data,"precio","Indica el precio."))
        if precio<0:
            raise ValueError("El precio no puede ser negativo.")
        with get_db_connection() as conn:
            cursor=conn.cursor()
            set_audit_context(cursor,session,"Creación de cotización simple")
            row=exec_proc_row(cursor,"EXEC cot.usp_AppCrearCotizacionSimple ?,?,?,?,?,?",(orden_id,session["usuario_id"],descripcion,precio,data.get("condicion_pago") or "POR DEFINIR",data.get("dias_vigencia") or 15))
            conn.commit()
        return jsonify(ok=True,message="Cotización creada.",item=row),201
    except ValueError as exc:
        return jsonify(ok=False,message=str(exc)),400
    except Exception as exc:
        return app_error(exc,"No fue posible crear la cotización.")


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
        return jsonify(ok=True,message=row.get("message") or "Respuesta de cotización registrada.",estado=row.get("estado"))
    except ValueError as exc:
        return jsonify(ok=False,message=str(exc)),400
    except Exception as exc:
        return app_error(exc,"No fue posible responder la cotización.")


# ---------------------------------------------------------------------------
# Contacto público del sitio web
# ---------------------------------------------------------------------------
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
            detail=str(exc) if env_bool("FLASK_DEBUG", True) else None,
        ), 503
    except (smtplib.SMTPException, OSError) as exc:
        app.logger.exception("No fue posible enviar la solicitud por correo.")
        return jsonify(
            ok=False,
            message="No pudimos enviar la solicitud en este momento. Intenta nuevamente en unos minutos.",
            detail=str(exc) if env_bool("FLASK_DEBUG", True) else None,
        ), 502
    except Exception as exc:
        return app_error(exc, "No fue posible enviar la solicitud.")


# ---------------------------------------------------------------------------
# Garantías vinculadas a OTs finalizadas
# ---------------------------------------------------------------------------
@app.get("/api/garantias")
@require_session("COORDINADOR", "CLIENTE")
def api_garantias(session):
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            items = exec_proc_rows(
                cursor,
                "EXEC srv.usp_GarantiaPortal_Listar @UsuarioActorId=?",
                (session["usuario_id"],),
            )
            resumen = exec_proc_row(
                cursor,
                "EXEC srv.usp_GarantiaPortal_Resumen @UsuarioActorId=?",
                (session["usuario_id"],),
            ) or {}
            solicitudes = exec_proc_rows(
                cursor,
                "EXEC srv.usp_Garantia_SolicitudesPortal_Listar @UsuarioActorId=?",
                (session["usuario_id"],),
            )
        return jsonify(ok=True, items=items, resumen=resumen, solicitudes=solicitudes)
    except Exception as exc:
        return app_error(exc, "No fue posible cargar las garantías.")


@app.post("/api/garantias/<int:orden_id>/configurar")
@require_session("COORDINADOR")
def api_configurar_garantia(session, orden_id: int):
    try:
        data = request.get_json(silent=True) or {}
        dias = int(require_value(data, "dias", "Indica los días de garantía."))
        observaciones = str(data.get("observaciones") or "").strip()[:600] or None

        with get_db_connection() as conn:
            cursor = conn.cursor()
            set_audit_context(cursor, session, f"Garantía configurada para OT {orden_id}")
            result = exec_proc_row(
                cursor,
                """
                EXEC srv.usp_Garantia_Configurar
                    @UsuarioActorId=?, @OrdenTrabajoId=?, @DiasGarantia=?, @Observaciones=?
                """,
                (session["usuario_id"], orden_id, dias, observaciones),
            )
            conn.commit()
        return jsonify(ok=True, message="Garantía configurada sobre la OT original.", item=result)
    except (TypeError, ValueError) as exc:
        return jsonify(ok=False, message=str(exc)), 400
    except Exception as exc:
        return app_error(exc, "No fue posible configurar la garantía.")


@app.post("/api/garantias/<int:garantia_id>/solicitar")
@require_session("CLIENTE")
def api_solicitar_revision_garantia(session, garantia_id: int):
    try:
        data = request.get_json(silent=True) or {}
        descripcion = str(require_value(
            data,
            "descripcion",
            "Describe qué necesitas que SEPRIGUA revise.",
        )).strip()[:1200]

        with get_db_connection() as conn:
            cursor = conn.cursor()
            set_audit_context(cursor, session, f"Solicitud de revisión de garantía {garantia_id}")
            result = exec_proc_row(
                cursor,
                """
                EXEC srv.usp_Garantia_SolicitarRevision
                    @UsuarioActorId=?, @GarantiaOrdenId=?, @Descripcion=?
                """,
                (session["usuario_id"], garantia_id, descripcion),
            )
            conn.commit()
        return jsonify(
            ok=True,
            message="Revisión solicitada sobre el mismo trabajo. El plazo original de garantía no se reinició.",
            item=result,
        )
    except ValueError as exc:
        return jsonify(ok=False, message=str(exc)), 400
    except Exception as exc:
        return app_error(exc, "No fue posible solicitar la revisión de garantía.")


@app.post("/api/garantias/solicitudes/<int:solicitud_id>/estado")
@require_session("COORDINADOR")
def api_estado_solicitud_garantia(session, solicitud_id: int):
    try:
        data = request.get_json(silent=True) or {}
        estado = str(require_value(data, "estado", "Selecciona un estado.")).strip().upper()
        observaciones = str(data.get("observaciones") or "").strip()[:900] or None

        with get_db_connection() as conn:
            cursor = conn.cursor()
            set_audit_context(cursor, session, f"Gestión de revisión de garantía {solicitud_id}")
            result = exec_proc_row(
                cursor,
                """
                EXEC srv.usp_Garantia_Solicitud_CambiarEstado
                    @UsuarioActorId=?, @SolicitudGarantiaId=?, @Estado=?, @Observaciones=?
                """,
                (session["usuario_id"], solicitud_id, estado, observaciones),
            )
            conn.commit()
        return jsonify(ok=True, message="Revisión de garantía actualizada.", item=result)
    except ValueError as exc:
        return jsonify(ok=False, message=str(exc)), 400
    except Exception as exc:
        return app_error(exc, "No fue posible actualizar la revisión de garantía.")


# ---------------------------------------------------------------------------
# Documentos del servicio
# ---------------------------------------------------------------------------
@app.get("/api/documentos")
@require_session("COORDINADOR", "CLIENTE")
def api_documentos(session):
    try:
        page,size=pagination_args()
        with get_db_connection() as conn:
            cursor=conn.cursor(); set_audit_context(cursor,session,"Listado paginado de documentos")
            items=exec_proc_rows(cursor,"EXEC doc.usp_DocumentosPortal_Listar ?,?,?",(session["usuario_id"],page,size))
        return paged_response(items,page,size)
    except Exception as exc:
        return app_error(exc,"No fue posible cargar documentos.")


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
# Auditoría

# ---------------------------------------------------------------------------
# Auditoría: solo coordinadores
# ---------------------------------------------------------------------------
@app.get("/api/auditoria")
@require_session("COORDINADOR")
def api_auditoria(session):
    try:
        page,size=pagination_args()
        with get_db_connection() as conn:
            cursor=conn.cursor(); set_audit_context(cursor,session,"Listado paginado de auditoría")
            items=exec_proc_rows(cursor,"EXEC aud.usp_AuditoriaPortal_Listar ?,?",(page,size))
        return paged_response(items,page,size)
    except Exception as exc:
        return app_error(exc,"No fue posible cargar la auditoría.")

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


if __name__ == "__main__":
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "5000"))
    debug = env_bool("FLASK_DEBUG", True)
    print("\nSEPRIGUA LOCAL - SISTEMA FUNCIONAL")
    print(f"Sitio: http://{host}:{port}")
    print(f"Login: http://{host}:{port}/login")
    print(f"Prueba BD: http://{host}:{port}/api/db/health\n")
    app.run(host=host, port=port, debug=debug)
