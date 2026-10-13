"""Diagnóstico de solo lectura: conexión, metadatos y permisos. No ejecuta SP de negocio."""
import argparse,json,os,re,sys
from pathlib import Path
from .app import BASE_DIR,get_db_connection,exec_proc_rows
import pyodbc

CRITICAL={
 'rh.SolicitudVacacion':['EmpleadoId','FechaInicio','FechaFin','DiasSolicitados','Estado','NuevasFechasPropuestas','Observaciones','ResueltoPorUsuarioId','ResueltoEn','ActualizadoEn'],
 'com.Notificacion':['UsuarioId','Tipo','Titulo','Mensaje','Entidad','EntidadId','Canal','Estado','CreadaEn'],
 'srv.OrdenTrabajo':['ProgramadaPara','IniciadaEn','FinalizadaEn','Prioridad'],
 'srv.ArchivoEvidencia':['Contenido'],
 'srv.TecnicoOrden':['EmpleadoId','Estado','FuncionCuadrilla'],
 'rh.DocumentoLaboral':['RutaArchivo','TipoMime'],
 'srv.IncidenciaOrden':['AccionTomada','Descripcion','OrdenTrabajoId','Estado']}

def contract():
    code='\n'.join(p.read_text(encoding='utf-8') for p in (BASE_DIR/'backend').glob('*.py') if p.name!='diagnostico.py')
    procedures=sorted(set(re.findall(r'EXEC\s+((?:seg|srv|eqp|cot|crm|rh|com|doc|aud)\.[A-Za-z_]\w*)',code,re.I)),key=str.lower)
    tables=sorted(set(re.findall(r'(?:FROM|JOIN|INTO|UPDATE)\s+((?:seg|srv|eqp|cot|crm|rh|com|doc|aud)\.[A-Za-z_]\w*)',code,re.I)),key=str.lower)
    return {'procedimientos':procedures,'objetos':tables,'columnas_criticas':CRITICAL}

def run():
    spec=contract();report={'solo_lectura':True,'odbc_configurado':os.getenv('DB_DRIVER','ODBC Driver 18 for SQL Server'),'drivers':pyodbc.drivers(),'conexion':False,'contrato':spec,'errores':[]}
    if report['odbc_configurado'] not in report['drivers']:
        report['errores'].append('Controlador ODBC de SQL Server no instalado.');return report
    try:
        with get_db_connection() as conn:
            cur=conn.cursor();report['conexion']=True
            installed={r['nombre'].lower() for r in exec_proc_rows(cur,"SELECT SCHEMA_NAME(schema_id)+'.'+name AS nombre FROM sys.objects WHERE type IN ('P','U','V')")}
            report['objetos_faltantes']=[n for n in spec['procedimientos']+spec['objetos'] if n.lower() not in installed]
            report['columnas_faltantes']=[]
            for obj,names in CRITICAL.items():
                cols={r['nombre'].lower() for r in exec_proc_rows(cur,'SELECT name AS nombre FROM sys.columns WHERE object_id=OBJECT_ID(?)',(obj,))}
                report['columnas_faltantes'].extend(obj+'.'+n for n in names if n.lower() not in cols)
            report['parametros_sp']=exec_proc_rows(cur,"SELECT SCHEMA_NAME(o.schema_id)+'.'+o.name AS procedimiento,p.parameter_id,p.name AS parametro,TYPE_NAME(p.user_type_id) AS tipo,p.max_length,p.is_output FROM sys.procedures o JOIN sys.parameters p ON p.object_id=o.object_id WHERE SCHEMA_NAME(o.schema_id) IN ('srv','seg','eqp','cot','crm','rh','com','doc','aud') ORDER BY procedimiento,p.parameter_id")
            report['restricciones']=exec_proc_rows(cur,"SELECT SCHEMA_NAME(o.schema_id)+'.'+o.name AS tabla,c.name,c.definition FROM sys.check_constraints c JOIN sys.objects o ON o.object_id=c.parent_object_id WHERE SCHEMA_NAME(o.schema_id) IN ('srv','rh','com','cot','eqp') ORDER BY tabla,c.name")
            report['permisos_sp']=[{'procedimiento':proc,'ejecutar':exec_proc_rows(cur,"SELECT HAS_PERMS_BY_NAME(?,'OBJECT','EXECUTE') AS permitido",(proc,))[0]['permitido']} for proc in spec['procedimientos']]
            report['triggers']=exec_proc_rows(cur,"SELECT OBJECT_SCHEMA_NAME(parent_id)+'.'+OBJECT_NAME(parent_id) AS tabla,name,is_disabled FROM sys.triggers WHERE parent_class=1 ORDER BY tabla,name")
            if report['objetos_faltantes']:report['errores'].append('Faltan objetos del contrato base o permisos para consultar sus metadatos.')
            if report['columnas_faltantes']:report['errores'].append('El esquema accesible difiere del contrato del código. No se modificó ninguna estructura.')
            if any(not p['ejecutar'] for p in report['permisos_sp']):report['errores'].append('Faltan permisos de ejecución para uno o más SP.')
    except pyodbc.Error as exc:
        report['errores'].append('SQL Server no accesible o permisos insuficientes. SQLSTATE: '+str(exc.args[0])[:5])
    except Exception:
        report['errores'].append('No fue posible consultar los metadatos de SQL Server.')
    return report

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--json',action='store_true');parser.add_argument('--contrato',action='store_true',help='Inventario local sin conexión');args=parser.parse_args()
    result={'contrato':contract()} if args.contrato else run()
    print(json.dumps(result,ensure_ascii=False,indent=2,default=str) if args.json or args.contrato else ('OK: conexión y metadatos revisados; faltan pruebas de flujos con datos de ensayo.' if not result.get('errores') else '\n'.join(result['errores'])))
    return int(bool(result.get('errores')))
if __name__=='__main__':sys.exit(main())
