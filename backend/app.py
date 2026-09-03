from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import uuid
from datetime import datetime, timedelta
from functools import wraps
from pathlib import Path

import pyodbc
from argon2.low_level import Type, hash_secret_raw
from dotenv import load_dotenv
from flask import Flask, jsonify, make_response, request, send_from_directory
from werkzeug.utils import secure_filename

BASE_DIR = Path(__file__).resolve().parent.parent
UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)
load_dotenv(BASE_DIR / ".env")

app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = int(os.getenv("MAX_UPLOAD_MB", "25")) * 1024 * 1024

COOKIE_NAME = "seprigua_session"
ARGON_TIME_COST = 3
ARGON_MEMORY_COST = 65536
ARGON_PARALLELISM = 2
ALLOWED_UPLOADS = {"jpg", "jpeg", "png", "webp", "pdf", "mp4", "mov"}

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
    return send_from_directory(BASE_DIR / "css", filename)


@app.get("/java/<path:filename>")
def js(filename: str):
    return send_from_directory(BASE_DIR / "java", filename)


@app.get("/assets/<path:filename>")
def assets(filename: str):
    return send_from_directory(BASE_DIR / "assets", filename)


@app.get("/uploads/<path:filename>")
@require_session("COORDINADOR", "TECNICO", "CLIENTE")
def uploads(_session, filename: str):
    return send_from_directory(UPLOAD_DIR, filename)


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
        return app_error(exc, "No se pudo conectar con SQL Server.")


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
        if session["rol"] == "CLIENTE":
            cliente_id = session["cliente_id"]
        if not cliente_id:
            return jsonify(ok=True, items=[])
        items = query_all(
            """
            SELECT u.UbicacionServicioId AS id, s.SucursalClienteId AS sucursal_id,
                   s.CodigoSucursal AS codigo, s.Nombre AS sucursal,
                   COALESCE(u.NombreReferencia,s.Nombre) AS referencia, u.Direccion,
                   u.Municipio,u.Departamento,
                   CASE WHEN u.Direccion=N'PENDIENTE DE ACTUALIZAR' THEN 1 ELSE 0 END AS ubicacion_pendiente
            FROM crm.UbicacionServicio u
            INNER JOIN crm.SucursalCliente s ON s.SucursalClienteId=u.SucursalClienteId
            WHERE s.ClienteId=? AND s.Activo=1 AND u.Activo=1
            ORDER BY s.Nombre,u.NombreReferencia
            """,
            (cliente_id,),
        )
        return jsonify(ok=True, items=items)
    except Exception as exc:
        return app_error(exc, "No fue posible cargar las ubicaciones.")


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
        params = []
        where = ""
        if session["rol"] == "CLIENTE":
            where = "WHERE s.ClienteId=?"
            params.append(session["cliente_id"] or -1)
        items = query_all(
            f"""
            SELECT TOP (250) s.SolicitudServicioId AS id,c.NombreComercial AS cliente,
                   COALESCE(sc.Nombre,u.NombreReferencia,N'Sin sede') AS sede,ts.Nombre AS tipo,
                   s.CanalRecepcion AS canal,s.Clasificacion,s.NivelUrgencia AS urgencia,
                   s.DescripcionProblema AS descripcion,s.FechaPreferida AS fecha_preferida,
                   s.Estado,s.Observaciones,s.CreadoEn AS creada,
                   ot.OrdenTrabajoId AS orden_id,ot.NumeroOrden AS orden_numero,
                   ot.EstadoOrden AS orden_estado,ot.CodigoEstadoOrden AS orden_estado_codigo,
                   ot.CreadoEn AS orden_creada,
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
                       o.OrdenTrabajoId,o.NumeroOrden,o.CreadoEn,
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
            {where}
            ORDER BY s.CreadoEn DESC
            """,
            tuple(params),
        )
        return jsonify(ok=True, items=items)
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
        fecha_preferida = parse_datetime_local(data.get("fecha_preferida"), "Fecha preferida")
        canal = "OTRO" if session["rol"] == "CLIENTE" else str(data.get("canal") or "OTRO").upper()

        with get_db_connection() as conn:
            cursor = conn.cursor()
            set_audit_context(cursor, session, "Creación de solicitud desde portal web")
            row = exec_proc_row(
                cursor,
                "EXEC srv.usp_AppCrearSolicitud ?,?,?,?,?,?,?,?,?,?",
                (cliente_id, contacto_id, ubicacion_id, tipo_id, session["usuario_id"], canal,
                 clasificacion, urgencia, descripcion, fecha_preferida),
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
                   NombreArchivo AS nombre,RutaArchivo AS ruta,Descripcion,TomadaEn AS tomada,CreadoEn AS creada
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
    if not allowed_file(file.filename):
        return jsonify(ok=False, message="Formato no permitido."), 400
    target = None
    try:
        params = [solicitud_id]
        permission = ""
        if session["rol"] == "CLIENTE":
            permission = "AND ClienteId=?"
            params.append(session["cliente_id"] or -1)
        access = query_one(
            f"SELECT TOP 1 SolicitudServicioId AS id FROM srv.SolicitudServicio WHERE SolicitudServicioId=? {permission}",
            tuple(params),
        )
        if not access:
            return jsonify(ok=False, message="La solicitud no existe o no pertenece a tu cliente."), 403

        original = secure_filename(file.filename)
        ext = original.rsplit(".", 1)[1].lower()
        stored = f"sol_{solicitud_id}_{uuid.uuid4().hex[:12]}.{ext}"
        target = UPLOAD_DIR / stored
        file.save(target)

        if ext in {"jpg", "jpeg", "png", "webp"}:
            ftype, category = "FOTO", "REFERENCIA_CLIENTE"
        elif ext in {"mp4", "mov"}:
            ftype, category = "VIDEO", "VIDEO_REFERENCIA"
        elif ext == "pdf":
            ftype, category = "PDF", "OTRO"
        else:
            ftype, category = "OTRO", "OTRO"

        origin = "CLIENTE" if session["rol"] == "CLIENTE" else "COORDINADOR"
        description = (request.form.get("descripcion") or "")[:600] or None

        with get_db_connection() as conn:
            cursor = conn.cursor()
            set_audit_context(cursor, session, "Carga de evidencia inicial de solicitud")
            cursor.execute(
                """
                INSERT INTO srv.EvidenciaServicio
                    (SolicitudServicioId,OrdenTrabajoId,SubidaPorUsuarioId,SubidaPorEmpleadoId,Origen,Categoria,Etapa,
                     TipoArchivo,NombreArchivo,RutaArchivo,TipoMime,TamanoBytes,Descripcion,IncluirEnCollage,OrdenCollage,TomadaEn)
                VALUES
                    (?,NULL,?,?,?,?,'INICIAL',?,?,?,?,?,?,0,NULL,SYSUTCDATETIME())
                """,
                solicitud_id, session["usuario_id"], session["empleado_id"], origin, category, ftype,
                original, f"/uploads/{stored}", file.mimetype, target.stat().st_size, description,
            )
            conn.commit()
        return jsonify(ok=True, message="Evidencia agregada a la solicitud.", ruta=f"/uploads/{stored}"), 201
    except Exception as exc:
        if target and target.exists():
            target.unlink(missing_ok=True)
        return app_error(exc, "No fue posible guardar la evidencia de la solicitud.")


# ---------------------------------------------------------------------------
# Órdenes de trabajo y operación
# ---------------------------------------------------------------------------
@app.get("/api/ordenes")
@require_session("COORDINADOR", "TECNICO", "CLIENTE")
def api_ordenes(session):
    try:
        where = []
        params = []
        joins = ""
        if session["rol"] == "TECNICO":
            joins += " INNER JOIN srv.TecnicoOrden tx ON tx.OrdenTrabajoId=o.OrdenTrabajoId AND tx.Estado='ASIGNADO' "
            where.append("tx.EmpleadoId=?")
            params.append(session["empleado_id"] or -1)
        elif session["rol"] == "CLIENTE":
            where.append("ss.ClienteId=?")
            params.append(session["cliente_id"] or -1)
        clause = "WHERE " + " AND ".join(where) if where else ""
        items = query_all(
            f"""
            SELECT DISTINCT TOP (300) o.OrdenTrabajoId AS id,o.NumeroOrden AS numero,
                   o.NumeroTicketCliente AS ticket,o.NumeroOrdenPapel AS orden_papel,
                   c.NombreComercial AS cliente,sc.Nombre AS sede,ts.Nombre AS tipo,
                   eo.EstadoOrdenTrabajoId AS estado_id,eo.Codigo AS estado_codigo,eo.Nombre AS estado,
                   eo.EsFinal AS es_final,o.Prioridad,o.ProgramadaPara AS programada,
                   o.IniciadaEn AS iniciada,o.FinalizadaEn AS finalizada,o.CerradaEn AS cerrada,
                   o.RequiereCorreccion AS requiere_correccion,o.ObservacionesCoordinacion AS observaciones
            FROM srv.OrdenTrabajo o
            INNER JOIN srv.SolicitudServicio ss ON ss.SolicitudServicioId=o.SolicitudServicioId
            INNER JOIN crm.Cliente c ON c.ClienteId=ss.ClienteId
            LEFT JOIN crm.UbicacionServicio ub ON ub.UbicacionServicioId=ss.UbicacionServicioId
            LEFT JOIN crm.SucursalCliente sc ON sc.SucursalClienteId=ub.SucursalClienteId
            INNER JOIN srv.TipoServicio ts ON ts.TipoServicioId=ss.TipoServicioId
            INNER JOIN srv.EstadoOrdenTrabajo eo ON eo.EstadoOrdenTrabajoId=o.EstadoOrdenTrabajoId
            {joins} {clause}
            ORDER BY o.ProgramadaPara DESC,o.OrdenTrabajoId DESC
            """,
            tuple(params),
        )
        return jsonify(ok=True, items=items)
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
                   NombreArchivo AS nombre,RutaArchivo AS ruta,Descripcion,TomadaEn AS tomada,CreadoEn AS creada
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

            for employee_id,function in normalized:
                exec_proc_row(cursor,"EXEC srv.usp_AppAsignarTecnico ?,?,?,?",(orden_id,employee_id,session["usuario_id"],function))

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
                "EN_PROCESO": {"POR_CONFIRMAR"},
            }
            if target_code not in allowed.get(current_code,set()):
                return jsonify(ok=False,message="Ese cambio de estado no corresponde al flujo del técnico."),403

        # Antes de enviar al cliente se valida lo mínimo definido para el cierre técnico.
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
                    raise RuntimeError("No existe el estado COMPLETADA en la base de datos.")
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
    if not allowed_file(file.filename):
        return jsonify(ok=False, message="Formato no permitido."), 400
    try:
        if session["rol"] == "TECNICO":
            access = query_one("SELECT TOP 1 1 AS ok FROM srv.TecnicoOrden WHERE OrdenTrabajoId=? AND EmpleadoId=? AND Estado='ASIGNADO'", (orden_id, session["empleado_id"] or -1))
            if not access:
                return jsonify(ok=False, message="Esta OT no está asignada a tu usuario."), 403
        if not query_one("SELECT TOP 1 OrdenTrabajoId AS id FROM srv.OrdenTrabajo WHERE OrdenTrabajoId=?", (orden_id,)):
            return jsonify(ok=False, message="La orden no existe."), 404

        original = secure_filename(file.filename)
        ext = original.rsplit(".", 1)[1].lower()
        stored = f"ot_{orden_id}_{uuid.uuid4().hex[:12]}.{ext}"
        target = UPLOAD_DIR / stored
        file.save(target)

        if ext in {"jpg", "jpeg", "png", "webp"}:
            ftype = "FOTO"
            default_category = "FOTO_TRABAJO"
        elif ext in {"mp4", "mov"}:
            ftype = "VIDEO"
            default_category = "VIDEO_REFERENCIA"
        elif ext == "pdf":
            ftype = "PDF"
            default_category = "OTRO"
        else:
            ftype = "OTRO"
            default_category = "OTRO"

        allowed_categories = {"REFERENCIA_CLIENTE", "FOTO_TRABAJO", "VIDEO_REFERENCIA", "ORDEN_FISICA", "CONFIRMACION", "OTRO"}
        allowed_stages = {"INICIAL", "ANTES", "DURANTE", "DESPUES", "CONFIRMACION", "DOCUMENTO"}
        category = str(request.form.get("categoria") or default_category).upper()[:30]
        stage = str(request.form.get("etapa") or "DURANTE").upper()[:15]
        if category not in allowed_categories:
            category = default_category
        if stage not in allowed_stages:
            stage = "DURANTE"
        origin = "TECNICO" if session["rol"] == "TECNICO" else "COORDINADOR"
        description = (request.form.get("descripcion") or "")[:600] or None
        include_collage = 1 if (category == "FOTO_TRABAJO" and ftype == "FOTO") else 0

        with get_db_connection() as conn:
            cursor = conn.cursor()
            set_audit_context(cursor, session, "Carga de evidencia de servicio")
            cursor.execute(
                """
                INSERT INTO srv.EvidenciaServicio
                    (SolicitudServicioId,OrdenTrabajoId,SubidaPorUsuarioId,SubidaPorEmpleadoId,Origen,Categoria,Etapa,
                     TipoArchivo,NombreArchivo,RutaArchivo,TipoMime,TamanoBytes,Descripcion,IncluirEnCollage,OrdenCollage,TomadaEn)
                VALUES
                    (NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,SYSUTCDATETIME())
                """,
                orden_id, session["usuario_id"], session["empleado_id"], origin, category, stage, ftype, original,
                f"/uploads/{stored}", file.mimetype, target.stat().st_size, description, include_collage,
            )
            conn.commit()
        return jsonify(ok=True, message="Evidencia guardada.", ruta=f"/uploads/{stored}"), 201
    except Exception as exc:
        if 'target' in locals() and target.exists():
            target.unlink(missing_ok=True)
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
# Clientes y sedes
# ---------------------------------------------------------------------------
@app.get("/api/clientes")
@require_session("COORDINADOR")
def api_clientes(_session):
    try:
        items = query_all(
            """
            SELECT c.ClienteId AS id,c.CodigoCliente AS codigo,c.NombreComercial AS nombre,c.RazonSocial AS razon_social,
                   c.Nit,c.TelefonoPrincipal AS telefono,c.CorreoPrincipal AS correo,c.Activo,
                   COUNT(DISTINCT s.SucursalClienteId) AS sedes,COUNT(DISTINCT cc.ContactoClienteId) AS contactos,
                   COUNT(DISTINCT sol.SolicitudServicioId) AS solicitudes
            FROM crm.Cliente c
            LEFT JOIN crm.SucursalCliente s ON s.ClienteId=c.ClienteId AND s.Activo=1
            LEFT JOIN crm.ContactoCliente cc ON cc.ClienteId=c.ClienteId AND cc.Activo=1
            LEFT JOIN srv.SolicitudServicio sol ON sol.ClienteId=c.ClienteId
            GROUP BY c.ClienteId,c.CodigoCliente,c.NombreComercial,c.RazonSocial,c.Nit,c.TelefonoPrincipal,c.CorreoPrincipal,c.Activo
            ORDER BY c.NombreComercial
            """
        )
        return jsonify(ok=True, items=items)
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
def api_personal(_session):
    try:
        items = query_all(
            """
            SELECT e.EmpleadoId AS id,e.CodigoEmpleado AS codigo,LTRIM(RTRIM(CONCAT(p.Nombres,N' ',p.Apellidos))) AS nombre,
                   pu.Nombre AS puesto,pu.EsTecnico AS es_tecnico,pu.EsCoordinador AS es_coordinador,
                   pu.EsPersonalMantenimiento AS es_mantenimiento,e.FechaIngreso AS ingreso,e.TipoContratacion AS contratacion,
                   e.Disponibilidad AS disponibilidad,e.EstadoLaboral AS estado,p.TelefonoPrincipal AS telefono,p.Correo AS correo
            FROM rh.Empleado e INNER JOIN rh.Persona p ON p.PersonaId=e.PersonaId
            INNER JOIN rh.Puesto pu ON pu.PuestoId=e.PuestoId
            ORDER BY e.EstadoLaboral,p.Nombres,p.Apellidos
            """
        )
        return jsonify(ok=True, items=items)
    except Exception as exc:
        return app_error(exc, "No fue posible cargar el personal.")


@app.patch("/api/personal/<int:empleado_id>/disponibilidad")
@require_session("COORDINADOR")
def api_personal_disponibilidad(session, empleado_id: int):
    data = request.get_json(silent=True) or {}
    disponibilidad = str(data.get("disponibilidad") or "").upper()
    if disponibilidad not in {"DISPONIBLE", "ASIGNADO", "VACACIONES", "INACTIVO"}:
        return jsonify(ok=False, message="Disponibilidad inválida."), 400
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor(); set_audit_context(cursor, session, "Cambio de disponibilidad de empleado")
            cursor.execute("UPDATE rh.Empleado SET Disponibilidad=?,ActualizadoEn=SYSUTCDATETIME() WHERE EmpleadoId=?", disponibilidad, empleado_id)
            if cursor.rowcount == 0:
                conn.rollback(); return jsonify(ok=False, message="Empleado no encontrado."), 404
            conn.commit()
        return jsonify(ok=True, message="Disponibilidad actualizada.")
    except Exception as exc:
        return app_error(exc, "No fue posible actualizar la disponibilidad.")


@app.get("/api/vacaciones")
@require_session("COORDINADOR", "TECNICO")
def api_vacaciones(session):
    try:
        params=[]; where=""
        if session["rol"] == "TECNICO":
            where="WHERE v.EmpleadoId=?"; params=[session["empleado_id"] or -1]
        items=query_all(f"""
            SELECT TOP (200) v.SolicitudVacacionId AS id,LTRIM(RTRIM(CONCAT(p.Nombres,N' ',p.Apellidos))) AS empleado,
                   v.FechaSolicitud AS solicitada,v.FechaInicio AS inicio,v.FechaFin AS fin,v.DiasSolicitados AS dias,
                   v.Motivo,v.Estado,v.Observaciones
            FROM rh.SolicitudVacacion v INNER JOIN rh.Empleado e ON e.EmpleadoId=v.EmpleadoId
            INNER JOIN rh.Persona p ON p.PersonaId=e.PersonaId {where}
            ORDER BY v.FechaSolicitud DESC
        """,tuple(params))
        return jsonify(ok=True,items=items)
    except Exception as exc:
        return app_error(exc,"No fue posible cargar vacaciones.")


# ---------------------------------------------------------------------------
# Equipos y mantenimiento
# ---------------------------------------------------------------------------
@app.get("/api/equipos")
@require_session("COORDINADOR", "TECNICO")
def api_equipos(_session):
    try:
        return jsonify(ok=True, items=query_all(
            """
            SELECT e.EquipoId AS id,e.CodigoEquipo AS codigo,e.Nombre,e.Categoria,e.Marca,e.Modelo,e.NumeroSerie AS serie,
                   e.Estado,e.UbicacionGeneral AS ubicacion,e.Activo,
                   (SELECT COUNT(*) FROM eqp.FallaEquipo f WHERE f.EquipoId=e.EquipoId AND f.Estado NOT IN ('RESUELTA','DESCARTADA')) AS fallas_abiertas
            FROM eqp.Equipo e ORDER BY e.Activo DESC,e.Nombre
            """))
    except Exception as exc:
        return app_error(exc, "No fue posible cargar los equipos.")


@app.patch("/api/equipos/<int:equipo_id>/estado")
@require_session("COORDINADOR")
def api_equipo_estado(session, equipo_id: int):
    data=request.get_json(silent=True) or {}; estado=str(data.get("estado") or "").upper()
    if not estado: return jsonify(ok=False,message="Indica el estado."),400
    try:
        with get_db_connection() as conn:
            cursor=conn.cursor(); set_audit_context(cursor,session,"Cambio de estado de equipo")
            cursor.execute("UPDATE eqp.Equipo SET Estado=?,ActualizadoEn=SYSUTCDATETIME() WHERE EquipoId=?",estado,equipo_id)
            if cursor.rowcount==0: conn.rollback(); return jsonify(ok=False,message="Equipo no encontrado."),404
            conn.commit()
        return jsonify(ok=True,message="Estado del equipo actualizado.")
    except Exception as exc:
        return app_error(exc,"No fue posible actualizar el equipo.")


@app.get("/api/mantenimientos")
@require_session("COORDINADOR", "TECNICO")
def api_mantenimientos(_session):
    try:
        items=query_all("""
            SELECT TOP (250) m.MantenimientoEquipoId AS id,e.CodigoEquipo AS codigo_equipo,e.Nombre AS equipo,
                   m.TipoMantenimiento AS tipo,m.Estado,m.FechaProgramada AS programada,m.Diagnostico,
                   m.TrabajoRequerido AS trabajo_requerido,m.IniciadoEn AS iniciado,m.FinalizadoEn AS finalizado,
                   m.ResultadoPrueba AS resultado,m.FechaProximaRevision AS proxima_revision,m.Observaciones
            FROM eqp.MantenimientoEquipo m INNER JOIN eqp.Equipo e ON e.EquipoId=m.EquipoId
            ORDER BY COALESCE(m.FechaProgramada,m.CreadoEn) DESC
        """)
        return jsonify(ok=True,items=items)
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
            fecha_programada = parse_datetime_local(data.get("fecha_programada"), "Fecha programada del mantenimiento")
            row=exec_proc_row(cursor,"EXEC eqp.usp_AppCrearMantenimiento ?,?,?,?,?,?",(equipo_id,tipo,fecha_programada,data.get("diagnostico") or None,data.get("trabajo_requerido") or None,session["usuario_id"]))
            conn.commit()
        return jsonify(ok=True,message="Mantenimiento registrado.",item=row),201
    except ValueError as exc: return jsonify(ok=False,message=str(exc)),400
    except Exception as exc: return app_error(exc,"No fue posible registrar el mantenimiento.")


# ---------------------------------------------------------------------------
# Cotizaciones (sin pagos)
# ---------------------------------------------------------------------------
@app.get("/api/cotizaciones")
@require_session("COORDINADOR", "CLIENTE")
def api_cotizaciones(session):
    try:
        where=""; params=[]
        if session["rol"]=="CLIENTE":
            where="WHERE ss.ClienteId=?"; params=[session["cliente_id"] or -1]
        items=query_all(f"""
            SELECT TOP (250) c.CotizacionId AS id,c.NumeroCotizacion AS numero,c.NombreCotizacion AS nombre,
                   cli.NombreComercial AS cliente,o.OrdenTrabajoId AS orden_id,o.NumeroOrden AS orden,c.Estado,c.CreadoEn AS creada,
                   v.NumeroVersion AS version,v.FechaEmision AS emision,v.FechaExpiracion AS expiracion,
                   v.Moneda,v.Total,v.Estado AS estado_version
            FROM cot.Cotizacion c INNER JOIN srv.OrdenTrabajo o ON o.OrdenTrabajoId=c.OrdenTrabajoId
            INNER JOIN srv.SolicitudServicio ss ON ss.SolicitudServicioId=o.SolicitudServicioId
            INNER JOIN crm.Cliente cli ON cli.ClienteId=ss.ClienteId
            LEFT JOIN cot.VersionCotizacion v ON v.CotizacionId=c.CotizacionId AND v.EsActual=1
            {where} ORDER BY c.CreadoEn DESC
        """,tuple(params))
        return jsonify(ok=True,items=items)
    except Exception as exc: return app_error(exc,"No fue posible cargar cotizaciones.")


@app.post("/api/cotizaciones")
@require_session("COORDINADOR")
def api_crear_cotizacion(session):
    data=request.get_json(silent=True) or {}
    try:
        orden_id=int(require_value(data,"orden_id","Selecciona una orden.")); descripcion=str(require_value(data,"descripcion","Describe el servicio cotizado.")); precio=float(require_value(data,"precio","Indica el precio."));
        if precio<0: raise ValueError("El precio no puede ser negativo.")
        order = query_one(
            """
            SELECT o.OrdenTrabajoId AS id,o.NumeroOrden AS numero,c.NombreComercial AS cliente,ts.Nombre AS servicio
            FROM srv.OrdenTrabajo o
            INNER JOIN srv.SolicitudServicio s ON s.SolicitudServicioId=o.SolicitudServicioId
            INNER JOIN crm.Cliente c ON c.ClienteId=s.ClienteId
            INNER JOIN srv.TipoServicio ts ON ts.TipoServicioId=s.TipoServicioId
            WHERE o.OrdenTrabajoId=?
            """, (orden_id,))
        if not order:
            raise ValueError("La orden seleccionada no existe.")
        with get_db_connection() as conn:
            cursor=conn.cursor(); set_audit_context(cursor,session,"Creación de cotización simple")
            row=exec_proc_row(cursor,"EXEC cot.usp_AppCrearCotizacionSimple ?,?,?,?,?,?",(orden_id,session["usuario_id"],descripcion,precio,data.get("condicion_pago") or "POR DEFINIR",data.get("dias_vigencia") or 15))
            conn.commit()
        return jsonify(ok=True,message="Cotización creada.",item=row),201
    except ValueError as exc: return jsonify(ok=False,message=str(exc)),400
    except Exception as exc: return app_error(exc,"No fue posible crear la cotización.")


@app.post("/api/cotizaciones/<int:cotizacion_id>/enviar")
@require_session("COORDINADOR")
def api_enviar_cotizacion(session, cotizacion_id: int):
    try:
        with get_db_connection() as conn:
            cursor=conn.cursor();set_audit_context(cursor,session,"Envío de cotización al cliente")
            cursor.execute("UPDATE cot.Cotizacion SET Estado='ENVIADA',ActualizadoEn=SYSUTCDATETIME() WHERE CotizacionId=? AND Estado IN ('BORRADOR','EN_REVISION','CONFIRMADA')",cotizacion_id)
            if cursor.rowcount==0:
                conn.rollback(); return jsonify(ok=False,message="La cotización no está disponible para envío."),409
            cursor.execute("UPDATE cot.VersionCotizacion SET EnviadaEn=COALESCE(EnviadaEn,SYSUTCDATETIME()) WHERE CotizacionId=? AND EsActual=1",cotizacion_id)
            cursor.execute(
                """
                INSERT INTO com.Notificacion(UsuarioId,Tipo,Titulo,Mensaje,Entidad,EntidadId,Canal,Estado)
                SELECT DISTINCT u.UsuarioId,'COTIZACION',N'Cotización disponible',
                       CONCAT(N'La cotización ',c.NumeroCotizacion,N' ya está disponible para revisión.'),
                       'Cotizacion',CONVERT(nvarchar(80),c.CotizacionId),'SISTEMA','PENDIENTE'
                FROM cot.Cotizacion c INNER JOIN srv.OrdenTrabajo o ON o.OrdenTrabajoId=c.OrdenTrabajoId
                INNER JOIN srv.SolicitudServicio ss ON ss.SolicitudServicioId=o.SolicitudServicioId
                INNER JOIN crm.ContactoCliente cc ON cc.ClienteId=ss.ClienteId AND cc.Activo=1
                INNER JOIN seg.Usuario u ON u.ContactoClienteId=cc.ContactoClienteId AND u.Activo=1
                WHERE c.CotizacionId=?
                """,cotizacion_id)
            conn.commit()
        return jsonify(ok=True,message="Cotización enviada al cliente.")
    except Exception as exc:
        return app_error(exc,"No fue posible enviar la cotización.")


@app.post("/api/cotizaciones/<int:cotizacion_id>/responder")
@require_session("CLIENTE")
def api_responder_cotizacion(session, cotizacion_id: int):
    data=request.get_json(silent=True) or {}
    try:
        response=str(require_value(data,"respuesta","Selecciona una respuesta.")).upper()
        if response not in {"ACEPTADA","CAMBIOS","RECHAZADA"}:
            raise ValueError("Respuesta de cotización inválida.")
        observation=str(data.get("observaciones") or "").strip()[:1200] or None
        if response in {"CAMBIOS","RECHAZADA"} and not observation:
            raise ValueError("Indica la observación de la respuesta.")
        target={"ACEPTADA":"ACEPTADA","CAMBIOS":"EN_REVISION","RECHAZADA":"ANULADA"}[response]
        access=query_one(
            """
            SELECT c.CotizacionId AS id FROM cot.Cotizacion c INNER JOIN srv.OrdenTrabajo o ON o.OrdenTrabajoId=c.OrdenTrabajoId
            INNER JOIN srv.SolicitudServicio ss ON ss.SolicitudServicioId=o.SolicitudServicioId
            WHERE c.CotizacionId=? AND ss.ClienteId=? AND c.Estado='ENVIADA'
            """,(cotizacion_id,session["cliente_id"] or -1))
        if not access: return jsonify(ok=False,message="Cotización no disponible para respuesta."),403
        with get_db_connection() as conn:
            cursor=conn.cursor();set_audit_context(cursor,session,"Respuesta de cliente a cotización")
            cursor.execute("UPDATE cot.Cotizacion SET Estado=?,ActualizadoEn=SYSUTCDATETIME() WHERE CotizacionId=?",target,cotizacion_id)
            cursor.execute("UPDATE cot.VersionCotizacion SET RespondidaEn=SYSUTCDATETIME(),ObservacionesCliente=? WHERE CotizacionId=? AND EsActual=1",observation or response,cotizacion_id)
            cursor.execute(
                """
                INSERT INTO com.Notificacion(UsuarioId,Tipo,Titulo,Mensaje,Entidad,EntidadId,Canal,Estado)
                SELECT o.CoordinadorUsuarioId,'RESPUESTA_COTIZACION',N'Respuesta de cotización',
                       CONCAT(N'La cotización ',c.NumeroCotizacion,N' recibió respuesta: ',?),
                       'Cotizacion',CONVERT(nvarchar(80),c.CotizacionId),'SISTEMA','PENDIENTE'
                FROM cot.Cotizacion c INNER JOIN srv.OrdenTrabajo o ON o.OrdenTrabajoId=c.OrdenTrabajoId
                WHERE c.CotizacionId=?
                """,response,cotizacion_id)
            conn.commit()
        return jsonify(ok=True,message="Respuesta de cotización registrada.",estado=target)
    except ValueError as exc:
        return jsonify(ok=False,message=str(exc)),400
    except Exception as exc:
        return app_error(exc,"No fue posible responder la cotización.")


# ---------------------------------------------------------------------------
# Documentos del servicio
# ---------------------------------------------------------------------------
@app.get("/api/documentos")
@require_session("COORDINADOR", "CLIENTE")
def api_documentos(session):
    try:
        where="";params=[]
        if session["rol"]=="CLIENTE": where="WHERE ss.ClienteId=?";params=[session["cliente_id"] or -1]
        items=query_all(f"""
            SELECT TOP (250) d.DocumentoServicioId AS id,d.NumeroDocumento AS numero,d.NumeroVersion AS version,
                   f.Nombre AS formato,f.Categoria AS categoria,o.NumeroOrden AS orden,c.NombreComercial AS cliente,
                   d.Estado,d.RutaArchivo AS ruta,d.GeneradoEn AS generado,d.EntregadoEn AS entregado
            FROM doc.DocumentoServicio d INNER JOIN doc.FormatoDocumento f ON f.FormatoDocumentoId=d.FormatoDocumentoId
            INNER JOIN srv.OrdenTrabajo o ON o.OrdenTrabajoId=d.OrdenTrabajoId
            INNER JOIN srv.SolicitudServicio ss ON ss.SolicitudServicioId=o.SolicitudServicioId
            INNER JOIN crm.Cliente c ON c.ClienteId=ss.ClienteId {where}
            ORDER BY d.CreadoEn DESC
        """,tuple(params))
        return jsonify(ok=True,items=items)
    except Exception as exc: return app_error(exc,"No fue posible cargar documentos.")


# ---------------------------------------------------------------------------
# Notificaciones
# ---------------------------------------------------------------------------
@app.get("/api/notificaciones")
@require_session("COORDINADOR", "TECNICO", "CLIENTE")
def api_notificaciones(session):
    try:
        items=query_all("""
            SELECT TOP (100) NotificacionId AS id,Tipo AS tipo,Titulo AS titulo,Mensaje AS mensaje,Entidad AS entidad,
                   EntidadId AS entidad_id,Canal AS canal,Estado AS estado,CreadaEn AS creada,EnviadaEn AS enviada,LeidaEn AS leida
            FROM com.Notificacion WHERE UsuarioId=? ORDER BY CreadaEn DESC
        """,(session["usuario_id"],))
        return jsonify(ok=True,items=items)
    except Exception as exc: return app_error(exc,"No fue posible cargar notificaciones.")


@app.post("/api/notificaciones/<int:notificacion_id>/leer")
@require_session("COORDINADOR", "TECNICO", "CLIENTE")
def api_leer_notificacion(session,notificacion_id:int):
    try:
        with get_db_connection() as conn:
            cursor=conn.cursor();set_audit_context(cursor,session,"Notificación marcada como leída")
            cursor.execute("UPDATE com.Notificacion SET LeidaEn=COALESCE(LeidaEn,SYSUTCDATETIME()) WHERE NotificacionId=? AND UsuarioId=?",notificacion_id,session["usuario_id"])
            conn.commit()
        return jsonify(ok=True,message="Notificación leída.")
    except Exception as exc: return app_error(exc,"No fue posible actualizar la notificación.")


# ---------------------------------------------------------------------------
# Auditoría: solo coordinadores
# ---------------------------------------------------------------------------
@app.get("/api/auditoria")
@require_session("COORDINADOR")
def api_auditoria(_session):
    try:
        items=query_all("""
            SELECT TOP (250) a.EventoAuditoriaId AS id,a.FechaEvento AS fecha,a.Esquema,a.Tabla,a.Operacion,
                   COALESCE(u.NombreUsuario,N'SISTEMA') AS usuario,a.Aplicacion,a.Host,a.DireccionIp AS ip,a.Observacion,
                   d.ClavesRegistros AS claves,d.ValoresAnteriores AS antes,d.ValoresNuevos AS despues
            FROM aud.EventoAuditoria a
            LEFT JOIN seg.Usuario u ON u.UsuarioId=a.UsuarioId
            LEFT JOIN aud.DetalleAuditoria d ON d.EventoAuditoriaId=a.EventoAuditoriaId
            ORDER BY a.EventoAuditoriaId DESC
        """)
        return jsonify(ok=True,items=items)
    except Exception as exc: return app_error(exc,"No fue posible cargar la auditoría.")


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
