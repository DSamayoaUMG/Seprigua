"""Migración histórica: simula por defecto; --apply escribe. No elimina originales."""
import argparse,hashlib,sys
import pyodbc
from .app import get_db_connection,exec_proc_rows,exec_proc_row,resolve_evidence_path
def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--apply',action='store_true');args=parser.parse_args()
    with get_db_connection() as conn:
        rows=exec_proc_rows(conn.cursor(),"""SELECT e.EvidenciaServicioId AS id,e.RutaArchivo AS ruta FROM srv.EvidenciaServicio e
          LEFT JOIN srv.ArchivoEvidencia a ON a.EvidenciaServicioId=e.EvidenciaServicioId WHERE a.EvidenciaServicioId IS NULL ORDER BY e.EvidenciaServicioId""")
    ok=0;pending=0
    for item in rows:
        path=resolve_evidence_path(item['ruta'])
        if not path or not path.is_file() or not 0<path.stat().st_size<=110*1024*1024:
            pending+=1;print(f"NO DISPONIBLE: evidencia #{item['id']}");continue
        if args.apply:
            content=path.read_bytes();digest=hashlib.sha256(content).digest()
            try:
                with get_db_connection() as conn:
                    cur=conn.cursor();cur.execute("EXEC sys.sp_set_session_context @key=N'Observacion',@value=N'Migración manual de evidencia histórica'")
                    if exec_proc_row(cur,'SELECT EvidenciaServicioId FROM srv.ArchivoEvidencia WITH (UPDLOCK,HOLDLOCK) WHERE EvidenciaServicioId=?',(item['id'],)):continue
                    cur.execute('INSERT INTO srv.ArchivoEvidencia(EvidenciaServicioId,Contenido,HashSha256,CreadoEn) VALUES(?,?,?,SYSUTCDATETIME())',item['id'],pyodbc.Binary(content),pyodbc.Binary(digest))
                    cur.execute('UPDATE srv.EvidenciaServicio SET RutaArchivo=?,TamanoBytes=? WHERE EvidenciaServicioId=?',f"BD://EVIDENCIA/{item['id']}",len(content),item['id'])
            except Exception:pending+=1;print(f"ERROR: evidencia #{item['id']}; se revirtió su transacción.");continue
        ok+=1;print(f"{'MIGRADA' if args.apply else 'MIGRABLE'}: evidencia #{item['id']}")
    print(f"{'Aplicación' if args.apply else 'Simulación'}: {ok} disponibles; {pending} pendientes. No se borraron originales.");return 1 if pending else 0
if __name__=='__main__':sys.exit(main())
