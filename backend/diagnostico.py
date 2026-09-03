from __future__ import annotations

import os
from pathlib import Path
import pyodbc
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    return default if value is None else value.strip().lower() in {"1", "true", "yes", "si", "sí", "on"}


def connection_string() -> str:
    driver = os.getenv("DB_DRIVER", "ODBC Driver 18 for SQL Server")
    server = os.getenv("DB_SERVER", "localhost")
    database = os.getenv("DB_NAME", "SEPRIGUA_DB")
    user = (os.getenv("DB_USER") or "").strip()
    password = os.getenv("DB_PASSWORD") or ""
    parts = [f"DRIVER={{{driver}}}", f"SERVER={server}", f"DATABASE={database}", "Encrypt=yes", f"TrustServerCertificate={'yes' if env_bool('DB_TRUST_CERT', True) else 'no'}"]
    parts += [f"UID={user}", f"PWD={password}"] if user else ["Trusted_Connection=yes"]
    return ";".join(parts) + ";"


print("SEPRIGUA - DIAGNOSTICO LOCAL")
print("Drivers ODBC detectados:")
for driver in pyodbc.drivers():
    print(" -", driver)

try:
    with pyodbc.connect(connection_string(), timeout=8) as conn:
        cur = conn.cursor()
        cur.execute("SELECT DB_NAME(),@@SERVERNAME,(SELECT COUNT(*) FROM seg.Usuario WHERE Activo=1),CASE WHEN OBJECT_ID(N'cot.PagoServicio',N'U') IS NULL THEN 1 ELSE 0 END")
        database, server, users, no_payments = cur.fetchone()
        print("\nOK - conexion correcta")
        print(" Base de datos:", database)
        print(" Servidor:", server)
        print(" Usuarios activos:", users)
        print(" Pagos fuera del alcance:", "OK" if no_payments else "ERROR: cot.PagoServicio existe")

        cur.execute("SELECT COUNT(*) FROM sys.procedures WHERE name LIKE 'usp[_]App%'")
        app_sp = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM sys.triggers WHERE name LIKE 'TR[_]APP[_]%' AND is_disabled=0")
        app_triggers = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM sys.triggers WHERE name LIKE 'TR[_]AUD[_]%' AND is_disabled=0")
        audit_triggers = cur.fetchone()[0]
        print(" Stored Procedures usp_App*:", app_sp)
        print(" Triggers TR_APP* habilitados:", app_triggers)
        print(" Triggers TR_AUD_* habilitados:", audit_triggers)
        print("\nESTADO:", "LISTO PARA PROBAR EL PORTAL" if no_payments and app_sp >= 9 and app_triggers >= 3 and audit_triggers > 0 else "REVISAR MIGRACIONES SQL")
except Exception as exc:
    print("\nERROR - no se pudo conectar")
    print(exc)
    raise SystemExit(1)
