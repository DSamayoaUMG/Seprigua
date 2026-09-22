"""Entrada común para Windows y Linux."""
import os
from waitress import serve
from .app import app
def main():
    host=os.getenv('HOST','127.0.0.1').strip() or '127.0.0.1';port=int(os.getenv('PORT','5000'))
    if not 1<=port<=65535:raise ValueError('PORT debe estar entre 1 y 65535.')
    print(f'SEPRIGUA iniciado en http://{host}:{port}',flush=True)
    serve(app,host=host,port=port,threads=max(2,min(32,int(os.getenv('WAITRESS_THREADS','4')))),ident='SEPRIGUA',max_request_body_size=app.config['MAX_CONTENT_LENGTH'],expose_tracebacks=False)
if __name__=='__main__':main()
