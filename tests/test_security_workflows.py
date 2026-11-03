"""Reglas críticas y contratos; no sustituye una prueba contra SQL Server real."""
import sys,base64
from pathlib import Path
from datetime import date,datetime
from types import SimpleNamespace
from unittest.mock import Mock
from contextlib import contextmanager
import pytest
from werkzeug.exceptions import Conflict
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from backend import app as b,planning
from backend.production import period,search_pattern
from test_portal import client,session

@pytest.mark.parametrize('path,method',[('/api/vacaciones/1','PATCH'),('/api/produccion','GET'),('/api/cancelaciones/1','PATCH'),('/api/catalogo-maestro','POST'),('/api/equipos/1','PATCH')])
def test_modules_enforced(client,monkeypatch,path,method):
    user=session();user.update(rol_nombre='LIMITADO',modulos=['cuenta']);monkeypatch.setattr(b,'current_session',lambda:user)
    assert client.open(path,method=method,json={} if method!='GET' else None).status_code==403

@pytest.mark.parametrize('role',['OPERARIO','SUPERVISOR','EMPLEADO','DESCONOCIDO'])
def test_employee_never_escalates(role):assert b._portal_role(role,set(),empleado_id=12)=='TECNICO'

def test_cookie_mutation_requires_header(client,monkeypatch):
    monkeypatch.setattr(b,'current_session',lambda:session());client.set_cookie(b.COOKIE_NAME,'test-cookie')
    assert client.post('/api/vacaciones',json={}).status_code==403
    assert client.post('/api/vacaciones',headers={'X-SEPRIGUA-Request':'1'},json={}).status_code==400

def subscription(url):
    enc=lambda x:base64.urlsafe_b64encode(x).decode().rstrip('=')
    return {'endpoint':url,'keys':{'p256dh':enc(b'\x04'+b'x'*64),'auth':enc(b'y'*16)}}
@pytest.mark.parametrize('url',['http://fcm.googleapis.com/a','https://127.0.0.1/a','https://fcm.googleapis.com.attacker.test/a','https://user:pw@fcm.googleapis.com/a','https://fcm.googleapis.com:8080/a'])
def test_push_ssrf(url):
    with pytest.raises(ValueError):b._compact_subscription(subscription(url))
def test_push_valid():assert 'fcm.googleapis.com' in b._compact_subscription(subscription('https://fcm.googleapis.com/fcm/send/test'))
@pytest.mark.parametrize('value',['abc','NaN','Infinity',-1,1000000000])
def test_price(value):
    with pytest.raises(ValueError):b._catalog_validate({'nombre':'Trabajo','precio':value},custom=True)

def fake_planning(vacation=False,busy=False,availability='DISPONIBLE'):
    def row(cur,sql,params=()):
        if 'o.ProgramadaPara AS programada' in sql:return {'programada':datetime(2026,10,1,15),'estado':'PROGRAMADA'}
        if 'p.Activo AS persona_activa' in sql:return {'nombre':'Prueba','estado':'ACTIVO','disponibilidad':availability,'persona_activa':True,'tecnico':True,'puesto_activo':True}
        if 'rh.SolicitudVacacion' in sql:return {'id':4} if vacation else None
        if 'o.NumeroOrden AS numero' in sql:return {'numero':'OT-OTRA'} if busy else None
        raise AssertionError(sql)
    return SimpleNamespace(exec_proc_row=Mock(side_effect=row),exec_proc_rows=Mock(return_value=[{'id':12}]))
def test_vacation_blocks():
    with pytest.raises(Conflict,match='vacaciones'):planning.validate_order(fake_planning(vacation=True),Mock(),1)
def test_same_start_blocks():
    with pytest.raises(Conflict,match='OT-OTRA'):planning.validate_order(fake_planning(busy=True),Mock(),1)
def test_concurrent_execution_blocks():
    with pytest.raises(Conflict):planning.validate_order(fake_planning(busy=True),Mock(),1,starting=True)
def test_unavailable_blocks():
    with pytest.raises(Conflict):planning.validate_order(fake_planning(availability='NO_DISPONIBLE'),Mock(),1)
def test_queue_allowed():planning.validate_order(fake_planning(),Mock(),1)
def test_no_crew_blocks_start():
    f=fake_planning();f.exec_proc_rows.return_value=[]
    with pytest.raises(Conflict):planning.validate_order(f,Mock(),1,starting=True)
def test_guatemala_day():
    assert planning.local_day(datetime(2026,10,2,2))==date(2026,10,1)
    assert planning.date_bounds(date(2026,10,1),date(2026,10,2))==(datetime(2026,10,1,6),datetime(2026,10,3,6))
def test_week():assert period(SimpleNamespace(local_day=lambda:date(2026,9,23)),{})==(date(2026,9,21),date(2026,9,27))
def test_literal_like():assert search_pattern("%_[' OR 1=1 --")[1]=="%~%~_~[' OR 1=1 --%"

@pytest.mark.parametrize('enabled,debug,host,remote,exposed',[(False,False,'localhost','127.0.0.1',False),(False,True,'localhost','127.0.0.1',False),(True,True,'localhost','192.0.2.10',False),(True,True,'attacker.invalid','127.0.0.1',False),(True,True,'localhost','127.0.0.1',True)])
def test_reset_debug_guard(client,monkeypatch,enabled,debug,host,remote,exposed):
    cursor=Mock();cursor.fetchone.return_value=SimpleNamespace(Activo=True,Correo='fixture@example.com',ContrasenaHash=b'hash',UsuarioId=1)
    @contextmanager
    def conn():
        connection=Mock();connection.cursor.return_value=cursor;yield connection
    monkeypatch.setattr(b,'get_db_connection',conn);monkeypatch.setattr(b,'_password_reset_rate_allowed',lambda x:True);monkeypatch.setattr(b,'_password_reset_email_available',lambda:False);monkeypatch.setattr(b,'_create_password_reset_token',lambda *a:'fixture-token')
    monkeypatch.setenv('PASSWORD_RESET_LOCAL_DEBUG',str(enabled));monkeypatch.setenv('FLASK_DEBUG',str(debug))
    r=client.post('/api/auth/password-reset/request',json={'identity':"test' OR 1=1 --"},headers={'Host':host},environ_overrides={'REMOTE_ADDR':remote})
    assert ('debug_reset_url' in r.get_json()) is exposed
    assert "test' OR 1=1 --" not in cursor.execute.call_args.args[0]
    assert cursor.execute.call_args.args[1:]==("test' OR 1=1 --","test' OR 1=1 --")
def test_reset_origin(monkeypatch):
    monkeypatch.delenv('PASSWORD_RESET_PUBLIC_ORIGIN',raising=False);monkeypatch.delenv('PUBLIC_ORIGIN',raising=False);monkeypatch.setenv('PORT','5000')
    with b.app.test_request_context('/',headers={'Host':'attacker.invalid'}):assert b._password_reset_public_url('test')=='http://127.0.0.1:5000/login.html?reset_token=test'

@pytest.mark.parametrize('path',['/api/cancelaciones','/api/vacaciones/12'])
def test_employee_scope(client,monkeypatch,path):
    monkeypatch.setattr(b,'current_session',lambda:session('TECNICO'))
    if path.endswith('/12'):monkeypatch.setattr(b,'query_one',lambda *a:{'empleado_id':999})
    assert client.get(path).status_code in {403,404}

@pytest.mark.parametrize('module,codes',[('vacaciones',('MOD_VACACIONES','MOD_PERSONAS')),('solicitudes',('MOD_SOLICITUDES','MOD_SOLICITUDES'))])
def test_notices_module_scope(module,codes):
    from backend.notifications import coordinator_users
    backend=SimpleNamespace(MODULE_ACCESS_CATALOG=b.MODULE_ACCESS_CATALOG,exec_proc_rows=Mock(return_value=[{'id':4}]))
    assert coordinator_users(backend,Mock(),module)==[4]
    assert backend.exec_proc_rows.call_args.args[-1]==codes

@pytest.mark.parametrize('role,previous,target,notes,expected',[
 ('COORDINADOR','PENDIENTE','APROBADA','Aceptada',200),
 ('TECNICO','PENDIENTE','APROBADA','Intento no autorizado',403),
 ('TECNICO','APROBADA','CANCELADA','Cancelar',403),
 ('COORDINADOR','RECHAZADA','APROBADA','Reabrir',409),
 ('TECNICO','REPROGRAMAR','PENDIENTE','Nuevas fechas',200),
 ('COORDINADOR','PENDIENTE','RECHAZADA','',400),
 ('COORDINADOR','APROBADA','CANCELADA','Cambio autorizado',200)])
def test_vacation_transitions(client,monkeypatch,role,previous,target,notes,expected):
    user=session(role);monkeypatch.setattr(b,'current_session',lambda:user)
    cursor=Mock()
    @contextmanager
    def connection():
        conn=Mock();conn.cursor.return_value=cursor;yield conn
    monkeypatch.setattr(b,'get_db_connection',connection)
    monkeypatch.setattr(b,'set_audit_context',lambda *a:None)
    monkeypatch.setattr(b.planning,'lock_planning',lambda *a:None)
    validation=Mock();monkeypatch.setattr(b.planning,'validate_vacation',validation)
    monkeypatch.setattr(b,'exec_proc_row',lambda *a:{'EmpleadoId':user['empleado_id'],'Estado':previous,'FechaInicio':date(2027,2,1),'FechaFin':date(2027,2,2)})
    monkeypatch.setattr(b,'exec_proc_rows',lambda *a:[])
    monkeypatch.setattr(b,'queue_web_push',lambda *a,**kw:None)
    response=client.patch('/api/vacaciones/1',json={'estado':target,'observaciones':notes,'inicio':'2027-02-03','fin':'2027-02-04','motivo':'Fechas corregidas'})
    assert response.status_code==expected
    if expected!=200:cursor.execute.assert_not_called()
    if expected==200 and target in {'APROBADA','PENDIENTE'}:validation.assert_called_once()

@pytest.mark.parametrize('files,valid',[
 ({'file.txt':b'not Word'},False),
 ({'[Content_Types].xml':b'<Types/>','word/document.xml':b'<document/>'},True),
 ({'[Content_Types].xml':b'<Types/>','word/document.xml':b'<document/>','word/vbaProject.bin':b'bad'},False),
 ({'[Content_Types].xml':b'<Types/>','word/document.xml':b'<document/>','../file':b'bad'},False)])
def test_docx_container(files,valid):
    import io,zipfile
    buf=io.BytesIO()
    with zipfile.ZipFile(buf,'w') as z:
        for path,data in files.items():z.writestr(path,data)
    assert b._labor_document_signature_ok('docx',buf.getvalue()) is valid

def test_labor_image_requires_decoding():
    import io
    from werkzeug.datastructures import FileStorage
    with pytest.raises(ValueError):b._prepare_labor_document_upload(FileStorage(stream=io.BytesIO(b'\x89PNG\r\n\x1a\nmalformed'),filename='image.png'))
