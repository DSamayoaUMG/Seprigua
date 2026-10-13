"""HTTP real, sin credenciales ni operaciones de negocio."""
import sys,threading,http.client
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from waitress import create_server
from backend.app import app
server=create_server(app,host='127.0.0.1',port=0,threads=2,expose_tracebacks=False)
thread=threading.Thread(target=server.run,daemon=True);thread.start()
try:
    for path,expected in [('/',200),('/login',200),('/sistema/coordinador',200),('/manifest.webmanifest',200),('/service-worker.js',200),('/java/sistema.js',200),('/css/sistema.css',200),('/api/auth/me',401),('/api/ordenes',401),('/.env',404),('/backend/app.py',404)]:
        conn=http.client.HTTPConnection('127.0.0.1',int(server.effective_port),timeout=10);conn.request('GET',path);response=conn.getresponse();response.read()
        assert response.status==expected,(path,response.status)
        assert response.getheader('X-Content-Type-Options')=='nosniff';assert response.getheader('Content-Security-Policy');conn.close()
    print('Waitress: 11 comprobaciones HTTP aprobadas.')
finally:server.close();server.task_dispatcher.shutdown()
