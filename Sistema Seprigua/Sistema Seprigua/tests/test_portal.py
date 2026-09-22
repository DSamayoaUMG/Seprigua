"""Pruebas con conexiones simuladas. No escriben en SQL Server ni envían correo."""
import io,sys,hashlib
from pathlib import Path
from contextlib import contextmanager
from datetime import datetime
from decimal import Decimal
from unittest.mock import Mock
import pytest
from PIL import Image
from werkzeug.datastructures import FileStorage
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from backend import app as b
from backend.portal_extensions import quote_lines

@pytest.fixture
def client(monkeypatch):
    b.app.config.update(TESTING=True)
    monkeypatch.setattr(b,'current_session',lambda:None)
    return b.app.test_client()

def session(role='COORDINADOR'):
    return {'usuario_id':4,'rol':role,'cliente_id':10,'empleado_id':12,'sesion_id':'00000000-0000-0000-0000-000000000004','requiere_cambio_contrasena':False}

PUBLIC={'api_login','api_logout','db_health','api_contacto','contact_api'}
PRIVATE_ROUTES=[(rule.rule,sorted(rule.methods-{'OPTIONS','HEAD'})[0]) for rule in b.app.url_map.iter_rules() if rule.rule.startswith('/api/') and rule.endpoint not in PUBLIC and 'contact' not in rule.rule]
@pytest.mark.parametrize('path,method',PRIVATE_ROUTES)
def test_no_session_is_denied(client,path,method):
    import re
    path=re.sub(r'<(?:int:|path:)?[^>]+>','1',path)
    r=client.open(path,method=method,json={} if method!='GET' else None)
    assert r.status_code==401,(path,r.status_code,r.get_json())

@pytest.mark.parametrize('role,other', [('CLIENTE',{'cliente_id':99,'estado':'EN_PROCESO','asignado':1}),('TECNICO',{'cliente_id':10,'estado':'EN_PROCESO','asignado':0})])
@pytest.mark.parametrize('method,suffix', [('GET',''),('POST','/actividades'),('POST','/evidencias')])
def test_foreign_order_denied(client,monkeypatch,role,other,method,suffix):
    monkeypatch.setattr(b,'current_session',lambda:session(role));monkeypatch.setattr(b,'query_one',lambda *a:other)
    assert client.open('/api/ordenes/19'+suffix,method=method,json={}).status_code in (403,404)

def test_foreign_request_upload(client,monkeypatch):
    monkeypatch.setattr(b,'current_session',lambda:session('CLIENTE'));monkeypatch.setattr(b,'query_one',lambda *a:{'cliente_id':99,'estado':'REGISTRADA'})
    assert client.post('/api/solicitudes/5/evidencias').status_code==404

def test_client_cannot_create_order(client,monkeypatch):
    monkeypatch.setattr(b,'current_session',lambda:session('CLIENTE'))
    assert client.post('/api/ordenes',json={'solicitud_id':1}).status_code==403

def test_password_change_enforced(client,monkeypatch):
    user=session();user['requiere_cambio_contrasena']=True;monkeypatch.setattr(b,'current_session',lambda:user)
    assert client.post('/api/equipos',json={}).status_code==403

def test_cross_origin(client):
    assert client.post('/api/auth/login',headers={'Origin':'https://wrong.invalid'},json={}).status_code==403

def test_json_object(client):
    assert client.post('/api/auth/login',json=[]).status_code==400

def test_local_date_uses_guatemala():
    assert b.parse_datetime_local('2026-09-12T08:30')==datetime(2026,9,12,14,30)
    assert b.parse_datetime_local('2026-09-12T08:30-06:00')==datetime(2026,9,12,14,30)

def test_json_dates(client,monkeypatch):
    with b.app.app_context():assert b.app.json.dumps({'d':datetime(2026,9,12,14,30)}).find('2026-09-12T14:30:00Z')!=-1

def test_quote_preserves_decimal():
    line=quote_lines([{'descripcion':'Servicio','unidad':'Hora','cantidad':'1.125','precio':'120.50','descuento':'10.00','impuesto':'12'}])[0]
    assert line['cantidad']==Decimal('1.125') and line['precio']==Decimal('120.50')

@pytest.mark.parametrize('field,value',[('precio','NaN'),('cantidad','0'),('impuesto','101'),('descuento','1000')])
def test_invalid_quote(field,value):
    d={'descripcion':'Servicio','unidad':'Servicio','cantidad':1,'precio':100,'impuesto':0,'descuento':0};d[field]=value
    with pytest.raises(ValueError):quote_lines([d])

def upload(name,contents):return FileStorage(io.BytesIO(contents),filename=name)

def test_exif_and_webp():
    image=Image.new('RGB',(2500,1000),'white');exif=Image.Exif();exif[274]=6;out=io.BytesIO();image.save(out,'JPEG',exif=exif)
    prepared=b.prepare_upload(upload('camera.jpg',out.getvalue()))
    result=Image.open(io.BytesIO(prepared['contenido']));assert result.format=='WEBP' and result.height==1920 and result.width<result.height
    assert prepared['hash_sha256']==hashlib.sha256(prepared['contenido']).digest()

def test_small_image_keeps_pixels():
    source=Image.new('RGB',(50,40),(20,41,82));out=io.BytesIO();source.save(out,'PNG')
    prepared=b.prepare_upload(upload('small.png',out.getvalue()));result=Image.open(io.BytesIO(prepared['contenido']))
    assert result.convert('RGB').tobytes()==source.tobytes()

@pytest.mark.parametrize('name,content',[('bad.jpg',b'fake'),('bad.mp4',b'not a video'),('bad.pdf',b'%PDF-1.7\ninvalid'),('bad.exe',b'exe')])
def test_invalid_upload(name,content):
    with pytest.raises(ValueError):b.prepare_upload(upload(name,content))

def test_bounded_read(monkeypatch):
    monkeypatch.setattr(b,'MAX_VIDEO_BYTES',12)
    with pytest.raises(ValueError):b.prepare_upload(upload('big.mp4',b'x'*100))

def test_mp4_container():
    raw=(24).to_bytes(4,'big')+b'ftyp'+b'isom'+b'\x00\x00\x00\x01'+b'isommp42'
    assert b.prepare_upload(upload('clip.mp4',raw))['tipo']=='VIDEO'

def test_connection_closes_commit_and_rollback(monkeypatch):
    conn=Mock();monkeypatch.setattr(b.pyodbc,'connect',lambda *a,**k:conn)
    with b.get_db_connection():pass
    conn.commit.assert_called_once();conn.close.assert_called_once()
    conn.reset_mock()
    with pytest.raises(ValueError):
        with b.get_db_connection():raise ValueError('test')
    conn.rollback.assert_called_once();conn.close.assert_called_once()

def test_pdf_generation():
    pdf=b._build_quote_pdf({'numero_cotizacion':'COT-TEST','cliente':'Cliente ficticio','total':500,'moneda':'GTQ'},[{'descripcion':'Trabajo de prueba','cantidad':1,'unidad':'Servicio','precio_unitario':500,'total_linea':500}])
    content=pdf.getvalue() if hasattr(pdf,'getvalue') else pdf
    assert content.startswith(b'%PDF') and len(content)>1000

def test_video_range_authorized(client,monkeypatch):
    monkeypatch.setattr(b,'current_session',lambda:session())
    @contextmanager
    def conn():yield Mock()
    monkeypatch.setattr(b,'get_db_connection',conn);monkeypatch.setattr(b,'set_audit_context',lambda *a:None)
    monkeypatch.setattr(b,'exec_proc_row',lambda *a:{'NombreArchivo':'clip.mp4','TipoMime':'video/mp4','Contenido':b'0123456789'})
    r=client.get('/api/archivos/evidencia/1',headers={'Range':'bytes=2-5'})
    assert r.status_code==206 and r.data==b'2345' and r.headers['Content-Range']=='bytes 2-5/10'

@pytest.mark.parametrize('name',['/.env','/backend/app.py','/uploads/secret.jpg','/java/../../.env'])
def test_private_source_not_served(client,name):assert client.get(name).status_code in (401,404)

def test_error_does_not_leak(client):
    with b.app.test_request_context('/'):
        response,status=b.app_error(RuntimeError('Password=secret DB_SERVER=private'))
        assert status==500 and 'secret' not in response.get_data(as_text=True)

@pytest.mark.parametrize('role',['COORDINADOR','TECNICO'])
@pytest.mark.parametrize('required,minimum,photos,status',[(False,1,1,200),(True,1,1,409),(False,2,1,409),(False,0,0,200)])
def test_technical_close_rules(client,monkeypatch,role,required,minimum,photos,status):
    monkeypatch.setattr(b,'current_session',lambda:session(role));monkeypatch.setattr(b,'assert_order_access',lambda *a:{'estado':'EN_PROCESO'})
    monkeypatch.setenv('OT_REQUIRE_TICKET',str(required));monkeypatch.setenv('OT_MIN_WORK_PHOTOS',str(minimum));queries=[]
    def query(sql,params=()):
        queries.append(sql)
        if 'EstadoOrdenTrabajo WHERE EstadoOrdenTrabajoId' in sql:return {'codigo':'COMPLETADA'}
        if 'Codigo AS codigo' in sql:return {'codigo':'EN_PROCESO'}
        if 'AS ticket' in sql:return {'ticket':None,'orden_papel':None,'documentos':0,'fotos':photos,'actividades':1,'cambios_pendientes':0}
        if 'TecnicoOrden' in sql:return {'ok':1}
        raise AssertionError(sql)
    monkeypatch.setattr(b,'query_one',query);cursor=Mock();cursor.nextset.return_value=False
    @contextmanager
    def connection():
        conn=Mock();conn.cursor.return_value=cursor;yield conn
    monkeypatch.setattr(b,'get_db_connection',connection);monkeypatch.setattr(b,'set_audit_context',lambda *a:None)
    execute=Mock(return_value={'id':19,'estado':'COMPLETADA'});monkeypatch.setattr(b,'exec_proc_row',execute)
    result=client.post('/api/ordenes/19/estado',json={'estado_id':5})
    assert result.status_code==status,result.get_json()
    assert not any('cot.' in q or 'ConfirmacionCliente' in q for q in queries)
    assert execute.call_count==(1 if status==200 else 0)

@pytest.mark.parametrize('paper,files',[('OC-14',0),(None,1)])
def test_paper_pair(client,monkeypatch,paper,files):
    monkeypatch.setattr(b,'current_session',lambda:session());monkeypatch.setattr(b,'assert_order_access',lambda *a:{'estado':'EN_PROCESO'});monkeypatch.setenv('OT_REQUIRE_TICKET','false')
    def query(sql,params=()):
        if 'EstadoOrdenTrabajo WHERE EstadoOrdenTrabajoId' in sql:return {'codigo':'COMPLETADA'}
        if 'Codigo AS codigo' in sql:return {'codigo':'EN_PROCESO'}
        return {'ticket':None,'orden_papel':paper,'documentos':files,'fotos':5,'actividades':1,'cambios_pendientes':0}
    monkeypatch.setattr(b,'query_one',query)
    assert client.post('/api/ordenes/19/estado',json={'estado_id':5}).status_code==409

def test_internal_document(client,monkeypatch):
    monkeypatch.setattr(b,'current_session',lambda:session('CLIENTE'));monkeypatch.setattr(b,'assert_order_access',lambda *a:{'estado':'COMPLETADA'})
    monkeypatch.setattr(b,'query_one',lambda *a:{'orden_id':19,'estado':'GENERADO','interno':True,'ruta':'BD://EVIDENCIA/8'})
    assert client.get('/api/documentos/9/archivo').status_code==404

def test_document_download_argument(client,monkeypatch):
    monkeypatch.setattr(b,'current_session',lambda:session());monkeypatch.setattr(b,'assert_order_access',lambda *a:{'estado':'COMPLETADA'})
    monkeypatch.setattr(b,'query_one',lambda *a:{'orden_id':19,'estado':'GENERADO','interno':False,'ruta':'BD://EVIDENCIA/8'})
    download=Mock(return_value=b'app-file');monkeypatch.setattr(b,'api_archivo_evidencia',download)
    assert client.get('/api/documentos/9/archivo').data==b'app-file';download.assert_called_once_with(evidencia_id=8)

def test_draft_price_hidden(client,monkeypatch):
    monkeypatch.setattr(b,'current_session',lambda:session('CLIENTE'));monkeypatch.setattr(b,'assert_request_access',lambda *a:{'cliente_id':10})
    monkeypatch.setattr(b,'query_one',lambda *a:{'id':1,'orden_id':19,'cotizacion_estado':'BORRADOR','cotizacion_total':800,'cotizacion_id':3});queries=[]
    monkeypatch.setattr(b,'query_all',lambda sql,params:(queries.append((sql,params)) or []))
    result=client.get('/api/solicitudes/1');assert result.status_code==200 and result.json['item']['cotizacion_total'] is None;assert queries[0][1]==(1,19)

def test_catalog_nonfinite():
    with pytest.raises(ValueError):b._catalog_validate({'nombre':'Prueba','precio':'NaN'},custom=True)

def test_parts_authorization(client,monkeypatch):
    monkeypatch.setattr(b,'current_session',lambda:session())
    assert client.post('/api/mantenimientos/1/repuestos',json={'utilizado':True,'autorizado':False}).status_code==400

def test_guarantee_original_deadline(client,monkeypatch):
    import json
    monkeypatch.setattr(b,'current_session',lambda:session('CLIENTE'));monkeypatch.setattr(b,'utcnow',lambda:datetime(2026,9,10))
    orders=[{'orden_id':19,'numero_orden':'OT-19','finalizada_en':datetime(2026,9,1)}]
    incidents=[{'IncidenciaOrdenId':1,'OrdenTrabajoId':19,'AccionTomada':json.dumps({'portal_tipo':'garantia_config','dias':30}),'Descripcion':'30 días'},
     {'IncidenciaOrdenId':2,'OrdenTrabajoId':19,'AccionTomada':json.dumps({'portal_tipo':'garantia_solicitud','estado':'EN_REVISION'}),'Descripcion':'Revisión','ReportadaEn':datetime(2026,9,9)}]
    monkeypatch.setattr(b,'query_all',lambda sql,params:incidents if 'SELECT i.*' in sql else orders)
    item=client.get('/api/garantias').json['items'][0];assert item['fin_garantia']=='2026-10-01T00:00:00Z' and item['estado_solicitud']=='EN_REVISION'

def test_order_pdf(client,monkeypatch):
    monkeypatch.setattr(b,'current_session',lambda:session());monkeypatch.setattr(b,'assert_order_access',lambda *a:{'estado':'COMPLETADA'})
    monkeypatch.setattr(b,'api_orden_detalle',lambda **kw:b.jsonify(ok=True,item={'numero':'OT-TEST'},tecnicos=[],actividades=[],evidencias=[]))
    result=client.get('/api/ordenes/19/reporte.pdf');assert result.status_code==200 and result.data.startswith(b'%PDF')
