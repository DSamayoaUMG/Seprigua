from __future__ import annotations

import os
import socket
from pathlib import Path

import pyodbc
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
ENV_FILE = BASE_DIR / ".env"
load_dotenv(ENV_FILE, override=True)


def env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    return default if value is None else value.strip().lower() in {"1", "true", "yes", "si", "sí", "on"}


def split_server(value: str) -> tuple[str, int]:
    raw = value.strip()
    if raw.lower().startswith("tcp:"):
        raw = raw[4:]
    if "," in raw:
        host, port = raw.rsplit(",", 1)
        try:
            return host.strip(), int(port.strip())
        except ValueError:
            pass
    return raw, 1433


def choose_driver() -> str:
    configured = (os.getenv("DB_DRIVER") or "").strip()
    installed = pyodbc.drivers()

    if configured and configured in installed:
        return configured

    for candidate in ("ODBC Driver 18 for SQL Server", "ODBC Driver 17 for SQL Server"):
        if candidate in installed:
            return candidate

    raise RuntimeError(
        "No se encontro un driver ODBC de SQL Server. "
        "Instala Microsoft ODBC Driver 18 for SQL Server."
    )


def connection_string(driver: str) -> str:
    server = (os.getenv("DB_SERVER") or "localhost").strip()
    database = (os.getenv("DB_NAME") or "SEPRIGUA_DB").strip()
    user = (os.getenv("DB_USER") or "").strip()
    password = os.getenv("DB_PASSWORD") or ""
    trust = "yes" if env_bool("DB_TRUST_CERT", True) else "no"

    parts = [
        f"DRIVER={{{driver}}}",
        f"SERVER={server}",
        f"DATABASE={database}",
        "Encrypt=yes",
        f"TrustServerCertificate={trust}",
    ]
    if user:
        parts.extend([f"UID={user}", f"PWD={password}"])
    else:
        parts.append("Trusted_Connection=yes")
    return ";".join(parts) + ";"


print("==============================================")
print("       SEPRIGUA - DIAGNOSTICO DE BD")
print("==============================================")
print("Archivo .env:", ENV_FILE)
print("Existe .env:", "SI" if ENV_FILE.exists() else "NO")

server_value = (os.getenv("DB_SERVER") or "").strip()
database = (os.getenv("DB_NAME") or "").strip()
user = (os.getenv("DB_USER") or "").strip()

print("DB_SERVER:", server_value or "(vacio)")
print("DB_NAME:", database or "(vacio)")
print("DB_USER:", user or "(vacio)")
print("Drivers ODBC:", ", ".join(pyodbc.drivers()) or "(ninguno)")

if not ENV_FILE.exists():
    print("\nERROR: Falta .env en la carpeta principal.")
    raise SystemExit(1)

try:
    driver = choose_driver()
    print("Driver seleccionado:", driver)
except Exception as exc:
    print("\nERROR:", exc)
    raise SystemExit(1)

host, port = split_server(server_value)
print(f"Probando TCP: {host}:{port}")

try:
    with socket.create_connection((host, port), timeout=5):
        print("TCP: OK")
except Exception as exc:
    print("TCP: ERROR")
    print(f"No se puede abrir {host}:{port}.")
    print("Detalle:", exc)
    print("\nEsto ocurre ANTES del login de SQL Server.")
    print("Revisa que SQL Server este iniciado, TCP/IP habilitado,")
    print("que escuche en el puerto 1433 y que firewall/NSG permita ese puerto.")
    raise SystemExit(1)

try:
    with pyodbc.connect(connection_string(driver), timeout=8) as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT DB_NAME(), @@SERVERNAME,
                   (SELECT COUNT(*) FROM seg.Usuario WHERE Activo = 1)
            """
        )
        db_name, sql_server, active_users = cur.fetchone()

        print("\nCONEXION SQL: OK")
        print("Base de datos:", db_name)
        print("Servidor SQL:", sql_server)
        print("Usuarios activos:", active_users)
        print("\nESTADO: LISTO PARA INICIAR EL PORTAL")
except pyodbc.Error as exc:
    print("\nCONEXION SQL: ERROR")
    print(exc)
    print("\nEl puerto responde, pero SQL Server rechazo o no pudo completar la conexion.")
    print("Revisa usuario, contrasena, nombre de BD y autenticacion SQL Server.")
    raise SystemExit(1)
