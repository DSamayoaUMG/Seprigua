"""Diagnóstico administrativo de solo lectura, sin mostrar credenciales."""
import os,re,sys
import pyodbc
from .app import BASE_DIR,get_db_connection,exec_proc_rows
def main():
    if os.getenv('DB_DRIVER','ODBC Driver 18 for SQL Server') not in pyodbc.drivers():
        print('ERROR: instala el controlador ODBC indicado en DB_DRIVER.');return 1
    required=set()
    for path in (BASE_DIR/'backend').glob('*.py'):
        if path.name!='diagnostico.py':required.update(re.findall(r"EXEC\s+((?:seg|srv|eqp|cot|crm|rh|com|doc|aud)\.[A-Za-z_][A-Za-z_0-9]*)",path.read_text(encoding='utf-8'),re.I))
    try:
        with get_db_connection() as conn:
            cur=conn.cursor();installed={x['nombre'].lower() for x in exec_proc_rows(cur,"SELECT SCHEMA_NAME(schema_id)+'.'+name AS nombre FROM sys.procedures")}
            missing=sorted(p for p in required if p.lower() not in installed)
            objects=exec_proc_rows(cur,"SELECT CASE WHEN OBJECT_ID('srv.ArchivoEvidencia','U') IS NULL THEN 0 ELSE 1 END AS archivos")
        if missing:print('ERROR: faltan procedimientos: '+', '.join(missing));return 1
        if not objects or not objects[0]['archivos']:print('ERROR: falta la tabla binaria del esquema base.');return 1
        print('OK: conexión y objetos requeridos disponibles. Comprueba también que se aplicó el SQL de cambios.');return 0
    except Exception:
        print('ERROR: revisa configuración, certificado, red y permisos de SQL Server con el administrador.');return 1
if __name__=='__main__':sys.exit(main())
