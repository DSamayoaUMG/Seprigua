"""Operaciones adicionales del portal sobre las tablas existentes."""
import io,json,uuid,os
from .notifications import notify_users,employee_users,coordinator_users
from datetime import date,datetime,timedelta,timezone
from zoneinfo import ZoneInfo
from decimal import Decimal,InvalidOperation,ROUND_HALF_UP
from flask import request,jsonify,send_file
from werkzeug.exceptions import NotFound,Forbidden,Conflict


def text_value(data,key,limit,required=False):
    value=str(data.get(key) or '').strip()
    if required and not value:raise ValueError(f'Completa {key.replace("_"," ")}.')
    if len(value)>limit:raise ValueError(f'{key.replace("_"," ")} admite hasta {limit} caracteres.')
    return value or None


def number(value,label,minimum=0,maximum=999999999,places=2):
    try:n=Decimal(str(value if value not in (None,'') else 0))
    except InvalidOperation:raise ValueError(f'{label} no es válido.')
    if not n.is_finite() or n<minimum or n>maximum:raise ValueError(f'{label} está fuera del rango permitido.')
    return n.quantize(Decimal(10)**-places,rounding=ROUND_HALF_UP)


def quote_lines(data):
    if not isinstance(data,list) or not 1<=len(data)<=100:raise ValueError('Agrega entre 1 y 100 conceptos.')
    lines=[]
    for d in data:
        if not isinstance(d,dict):raise ValueError('Concepto inválido.')
        q=number(d.get('cantidad',1),'Cantidad',Decimal('.001'),999999,3);p=number(d.get('precio',d.get('precio_unitario')),'Precio')
        discount=number(d.get('descuento',0),'Descuento',0,min(q*p,Decimal('999999999')))
        concept=int(d['concepto_id']) if d.get('concepto_id') else None
        lines.append(dict(concepto_id=concept,descripcion=text_value(d,'descripcion',1200,True),cantidad=q,
          unidad=text_value(d,'unidad',40,True),precio=p,precio_sugerido=number(d.get('precio_sugerido',p),'Precio base'),
          descuento=discount,impuesto=number(d.get('impuesto',d.get('porcentaje_impuesto',0)),'Impuesto',0,100,3),
          observaciones=text_value(d,'observaciones',400),motivo=text_value(d,'motivo',500)))
    gross=sum((l['cantidad']*l['precio'] for l in lines),Decimal(0))
    total=sum(((l['cantidad']*l['precio']-l['descuento'])*(1+l['impuesto']/100) for l in lines),Decimal(0))
    if max(gross,total)>Decimal('9999999999999999.99'):raise ValueError('El total supera la capacidad del documento.')
    return lines


def register_extensions(b):
    app=b.app;auth=b.require_session
    def data():return request.get_json(silent=True) or {}
    def row(cur,sql,params=()):return b.exec_proc_row(cur,sql,params)
    def clean(item):return {k:v for k,v in item.items() if not isinstance(v,(bytes,bytearray,memoryview))}

    @app.get('/api/ordenes/<int:orden_id>/reporte.pdf')
    @auth('COORDINADOR','TECNICO','CLIENTE')
    def order_report(session,orden_id):
        if __package__:from .reports import build_order_report
        else:from reports import build_order_report
        response=app.make_response(b.api_orden_detalle(orden_id=orden_id))
        if response.status_code!=200:return response
        return send_file(build_order_report(response.get_json()),mimetype='application/pdf',as_attachment=True,download_name=f'OT-{orden_id}.pdf')

    @app.get('/api/ordenes/<int:orden_id>/collage.jpg')
    @auth('COORDINADOR','TECNICO','CLIENTE')
    def order_collage(session,orden_id):
        if __package__:from .collages import build_order_collage
        else:from collages import build_order_collage
        # Reutiliza el detalle autorizado para obtener los datos de encabezado de la OT.
        response=app.make_response(b.api_orden_detalle(orden_id=orden_id))
        if response.status_code!=200:return response
        detail=response.get_json(silent=True) or {}
        order=detail.get('item') or {}
        with b.get_db_connection() as conn:
            cur=conn.cursor();b.set_audit_context(cur,session,'Generación de collage de evidencias')
            cur.execute("""
                ;WITH E AS (
                  SELECT e.EvidenciaServicioId,e.NombreArchivo,e.RutaArchivo,e.Etapa,e.Descripcion,
                         e.IncluirEnCollage,e.OrdenCollage,e.TomadaEn,e.CreadoEn,a.Contenido,
                         ROW_NUMBER() OVER(PARTITION BY COALESCE(e.Etapa,''),
                           COALESCE(CONVERT(varchar(64),a.HashSha256,2),CONCAT('ID:',e.EvidenciaServicioId)) ORDER BY e.EvidenciaServicioId) AS rn
                  FROM srv.EvidenciaServicio e
                  LEFT JOIN srv.ArchivoEvidencia a ON a.EvidenciaServicioId=e.EvidenciaServicioId
                  WHERE e.OrdenTrabajoId=? AND e.Categoria='FOTO_TRABAJO' AND e.TipoArchivo='FOTO'
                )
                SELECT EvidenciaServicioId,NombreArchivo,RutaArchivo,Etapa,Descripcion,IncluirEnCollage,OrdenCollage,TomadaEn,CreadoEn,Contenido
                FROM E WHERE rn=1
                ORDER BY CASE UPPER(COALESCE(Etapa,'')) WHEN 'ANTES' THEN 0 WHEN 'DURANTE' THEN 1 WHEN 'DESPUES' THEN 2 ELSE 3 END,
                         COALESCE(OrdenCollage,32767),EvidenciaServicioId
            """,orden_id)
            rows=b.rows_to_dicts(cur,cur.fetchall())
        try:
            image=build_order_collage(rows,order,legacy_resolver=b.resolve_evidence_path)
        except ValueError as exc:
            return jsonify(ok=False,message=str(exc)),404
        number=str(order.get('numero') or f'OT-{orden_id}')
        safe=''.join(ch if ch.isalnum() or ch in '-_.' else '_' for ch in number)[:90] or f'OT-{orden_id}'
        download=str(request.args.get('download') or '').strip().lower() in {'1','true','si','sí','yes'}
        return send_file(image,mimetype='image/jpeg',as_attachment=download,download_name=f'Collage-{safe}.jpg',max_age=0)

    @app.patch('/api/equipos/<int:equipo_id>/fallas/<int:falla_id>')
    @auth('COORDINADOR')
    def failure_update(session,equipo_id,falla_id):
        d=data();target=d.get('estado');note=text_value(d,'observaciones',600,True)
        with b.get_db_connection() as conn:
            cur=conn.cursor();b.set_audit_context(cur,session,'Seguimiento de falla')
            f=row(cur,'SELECT Estado FROM eqp.FallaEquipo WITH (UPDLOCK,HOLDLOCK) WHERE FallaEquipoId=? AND EquipoId=?',(falla_id,equipo_id))
            if not f:raise NotFound('Falla no encontrada.')
            allowed={'REPORTADA':{'DIAGNOSTICO','DESCARTADA'},'DIAGNOSTICO':{'DESCARTADA'},'CORREGIDA':{'CERRADA'}}
            if target not in allowed.get(f['Estado'],set()):raise Conflict('El mantenimiento debe corregir la falla antes de cerrarla.')
            if row(cur,"SELECT TOP 1 MantenimientoEquipoId FROM eqp.MantenimientoEquipo WHERE FallaEquipoId=? AND Estado NOT IN ('FINALIZADO','CANCELADO')",(falla_id,)):raise Conflict('Resuelve primero el mantenimiento vinculado.')
            cur.execute('UPDATE eqp.FallaEquipo SET Estado=?,Observaciones=?,CerradaEn=? WHERE FallaEquipoId=?',target,note,b.utcnow() if target in {'DESCARTADA','CERRADA'} else None,falla_id)
        return jsonify(ok=True,message='Falla actualizada.')
    def active_employee(cur,employee):
        if not employee or not row(cur,"SELECT EmpleadoId FROM rh.Empleado WHERE EmpleadoId=? AND EstadoLaboral='ACTIVO'",(employee,)):
            raise ValueError('Selecciona un empleado activo.')
        return int(employee)
    def equipment_notice(cur,equipment_id,event,title,note,employee=None,maintenance_id=None):
        coords=coordinator_users(b,cur,'equipo_mantenimiento');workers=employee_users(b,cur,employee) if employee else []
        notify_users(b,cur,coords+workers,event,title,note,'MantenimientoEquipo' if maintenance_id else 'Equipo',maintenance_id or equipment_id)
        return coords,workers
    def equipment_push(recipients,title,note,equipment_id,maintenance_id=None):
        for ids,role in zip(recipients,('COORDINADOR','TECNICO')):b.queue_web_push(ids,title=title,body=note,role=role,entity='MantenimientoEquipo' if maintenance_id else 'Equipo',entity_id=maintenance_id or equipment_id)

    def notify(cur,order_id,title,message,coordinators=False):
        if coordinators:
            ids=coordinator_users(b,cur,'garantia')
        else:
            ids=[x['id'] for x in b.exec_proc_rows(cur,"SELECT DISTINCT u.UsuarioId AS id FROM seg.Usuario u JOIN crm.ContactoCliente cc ON cc.ContactoClienteId=u.ContactoClienteId JOIN srv.SolicitudServicio ss ON ss.ClienteId=cc.ClienteId JOIN srv.OrdenTrabajo o ON o.SolicitudServicioId=ss.SolicitudServicioId JOIN crm.UbicacionServicio ux ON ux.UbicacionServicioId=ss.UbicacionServicioId CROSS APPLY seg.ufn_SucursalesPermitidas(u.UsuarioId) ax WHERE o.OrdenTrabajoId=? AND u.Activo=1 AND cc.Activo=1 AND ax.SucursalClienteId=ux.SucursalClienteId",(order_id,))]
        notify_users(b,cur,ids,'GARANTIA',title,message,'OrdenTrabajo',order_id)

    def save_quote(session,quote_id=None):
        d=data();lines=quote_lines(d.get('lineas') or [{'descripcion':d.get('descripcion'),'precio':d.get('precio'),'cantidad':1,'unidad':'Servicio'}])
        today=b.utcnow().replace(tzinfo=timezone.utc).astimezone(ZoneInfo(os.getenv('APP_TIMEZONE','America/Guatemala'))).date()
        validity=int(d.get('dias_vigencia') or 15)
        if not 1<=validity<=365:raise ValueError('La vigencia debe estar entre 1 y 365 días.')
        condition=text_value(d,'condicion_pago',80) or 'POR DEFINIR';reason=text_value(d,'motivo',700)
        meta={'Moneda':'GTQ','EsExportacion':False,'EsDocumentoTributario':False}
        with b.get_db_connection() as conn:
            cur=conn.cursor();b.set_audit_context(cur,session,'Registro de versión de cotización')
            if quote_id:
                q=row(cur,'SELECT * FROM cot.Cotizacion WITH (UPDLOCK,HOLDLOCK) WHERE CotizacionId=?',(quote_id,))
                if not q:raise NotFound('Cotización no encontrada.')
                meta=row(cur,'SELECT TOP 1 Moneda,EsExportacion,EsDocumentoTributario FROM cot.VersionCotizacion WHERE CotizacionId=? AND EsActual=1',(quote_id,)) or meta
                if q['Estado'] in {'ACEPTADA','ANULADA'}:raise Conflict('La cotización ya está cerrada.')
                check=row(cur,"""SELECT eo.Codigo AS estado FROM srv.OrdenTrabajo o
                  JOIN srv.EstadoOrdenTrabajo eo ON eo.EstadoOrdenTrabajoId=o.EstadoOrdenTrabajoId
                  WHERE o.OrdenTrabajoId=?""",(q['OrdenTrabajoId'],))
                if not check or check['estado'] in {'CANCELADA','COMPLETADA'}:
                    raise Conflict('No se pueden modificar cotizaciones de órdenes cerradas.')
                if not reason:raise ValueError('Indica el motivo de la nueva versión.')
                version=int(row(cur,'SELECT MAX(NumeroVersion) AS n FROM cot.VersionCotizacion WHERE CotizacionId=?',(quote_id,))['n'] or 0)+1
                if version>32767:raise Conflict('Se alcanzó el límite de versiones.')
                cur.execute('UPDATE cot.VersionCotizacion SET EsActual=0,ActualizadoEn=SYSUTCDATETIME() WHERE CotizacionId=? AND EsActual=1',quote_id)
                cur.execute("UPDATE cot.Cotizacion SET Estado='BORRADOR',ActualizadoEn=SYSUTCDATETIME() WHERE CotizacionId=?",quote_id)
            else:
                order_id=int(d.get('orden_id') or 0);b.assert_order_access(session,order_id)
                locked=row(cur,"""SELECT o.OrdenTrabajoId AS id,eo.Codigo AS estado
                 FROM srv.OrdenTrabajo o WITH (UPDLOCK,HOLDLOCK)
                 JOIN srv.EstadoOrdenTrabajo eo ON eo.EstadoOrdenTrabajoId=o.EstadoOrdenTrabajoId
                 WHERE o.OrdenTrabajoId=?""",(order_id,))
                if not locked:raise NotFound('Orden de trabajo no encontrada.')
                if locked['estado'] in {'CANCELADA','COMPLETADA'}:
                    raise Conflict('No se puede crear una cotización para una OT cancelada o finalizada.')
                if row(cur,'SELECT CotizacionId FROM cot.Cotizacion WHERE OrdenTrabajoId=?',(order_id,)):raise Conflict('La OT ya tiene cotización. Abre su detalle para registrar otra versión.')
                number_code='COT-'+today.strftime('%Y%m%d')+'-'+uuid.uuid4().hex[:8].upper()
                q=row(cur,"""DECLARE @n TABLE(id bigint); INSERT INTO cot.Cotizacion(OrdenTrabajoId,NumeroCotizacion,NombreCotizacion,CreadaPorUsuarioId,Estado)
                   OUTPUT INSERTED.CotizacionId INTO @n VALUES(?,?,?,?,'BORRADOR'); SELECT id FROM @n;""",
                  (order_id,number_code,text_value(d,'nombre',250) or 'Cotización de servicio',session['usuario_id']))
                quote_id=q['id'];version=1
            vid=row(cur,"""DECLARE @n TABLE(id bigint); INSERT INTO cot.VersionCotizacion
              (CotizacionId,CreadaPorUsuarioId,NumeroVersion,Folio,FechaEmision,FechaExpiracion,CondicionPago,EsExportacion,Moneda,
               Subtotal,DescuentoTotal,ImpuestoTotal,Total,EsDocumentoTributario,Estado,EsActual,MotivoCambio)
              OUTPUT INSERTED.VersionCotizacionId INTO @n VALUES(?,?,?,1,?,?,?,?,?,0,0,0,0,?,'BORRADOR',1,?); SELECT id FROM @n;""",
              (quote_id,session['usuario_id'],version,today,today+timedelta(days=validity),condition,meta['EsExportacion'],meta['Moneda'],meta['EsDocumentoTributario'],reason))['id']
            for index,line in enumerate(lines,1):
                if line['concepto_id'] and not row(cur,'SELECT ConceptoCotizacionId FROM cot.ConceptoCotizacion WHERE ConceptoCotizacionId=? AND Activo=1',(line['concepto_id'],)):raise ValueError('Un concepto del catálogo ya no está disponible.')
                cur.execute("""INSERT INTO cot.DetalleCotizacion(VersionCotizacionId,ConceptoCotizacionId,NumeroLinea,TipoArticulo,
                  Descripcion,Cantidad,UnidadMedida,PrecioSugerido,PrecioUnitario,Descuento,PorcentajeImpuesto,MotivoCambioPrecio,Observaciones)
                  VALUES(?,?,?,'SERVICIO',?,?,?,?,?,?,?,?,?)""",vid,line['concepto_id'],index,line['descripcion'],line['cantidad'],line['unidad'],
                  line['precio_sugerido'],line['precio'],line['descuento'],line['impuesto'],line['motivo'],line['observaciones'])
            cur.execute('''UPDATE v SET Subtotal=t.subtotal,DescuentoTotal=t.descuento,ImpuestoTotal=t.impuesto,Total=t.total
              FROM cot.VersionCotizacion v CROSS APPLY (SELECT SUM(SubtotalLinea) subtotal,SUM(Descuento) descuento,SUM(MontoImpuesto) impuesto,
              SUM(TotalLinea) total FROM cot.DetalleCotizacion WHERE VersionCotizacionId=v.VersionCotizacionId) t WHERE v.VersionCotizacionId=?''',vid)
        return jsonify(ok=True,message='Cotización guardada.',item={'id':quote_id,'version_id':vid,'version':version}),201

    @app.post('/api/cotizaciones/<int:quote_id>/versiones')
    @auth('COORDINADOR')
    def quote_version(session,quote_id):return save_quote(session,quote_id)

    @app.get('/api/cotizaciones/<int:quote_id>/detalle')
    @auth('COORDINADOR')
    def quote_detail(session,quote_id):
        header,evidence,details=b._cotizacion_expediente_sets(session,quote_id)
        if not header:raise NotFound('Cotización no encontrada.')
        details=b.query_all('''SELECT DetalleCotizacionId AS id,ConceptoCotizacionId AS concepto_id,
          NumeroLinea AS numero_linea,Descripcion AS descripcion,Cantidad AS cantidad,UnidadMedida AS unidad,
          PrecioSugerido AS precio_sugerido,PrecioUnitario AS precio_unitario,Descuento AS descuento,
          PorcentajeImpuesto AS porcentaje_impuesto,TotalLinea AS total_linea,
          MotivoCambioPrecio AS motivo,Observaciones AS observaciones
          FROM cot.DetalleCotizacion WHERE VersionCotizacionId=? ORDER BY NumeroLinea''',(header[0]['version_id'],))
        versions=b.query_all('SELECT VersionCotizacionId AS id,NumeroVersion AS version,Estado AS estado,FechaEmision AS fecha,Total AS total,MotivoCambio AS motivo FROM cot.VersionCotizacion WHERE CotizacionId=? ORDER BY NumeroVersion DESC',(quote_id,))
        return jsonify(ok=True,item=header[0],lineas=details,versiones=versions)

    @app.get('/api/equipos/<int:equipo_id>')
    @auth('COORDINADOR','TECNICO')
    def equipment_detail(session,equipo_id):
        item=b.query_one('SELECT * FROM eqp.Equipo WHERE EquipoId=?',(equipo_id,))
        if not item:raise NotFound('Equipo no encontrado.')
        return jsonify(ok=True,item=clean(item),fallas=b.query_all('SELECT * FROM eqp.FallaEquipo WHERE EquipoId=? ORDER BY ReportadaEn DESC',(equipo_id,)),
          inspecciones=b.query_all('SELECT * FROM eqp.InspeccionEquipo WHERE EquipoId=? ORDER BY FechaInspeccion DESC',(equipo_id,)),
          mantenimientos=b.query_all('SELECT MantenimientoEquipoId AS id,TipoMantenimiento AS tipo,Estado AS estado,FechaProgramada AS fecha,TrabajoRealizado AS trabajo FROM eqp.MantenimientoEquipo WHERE EquipoId=? ORDER BY CreadoEn DESC',(equipo_id,)))

    @app.patch('/api/equipos/<int:equipo_id>')
    @auth('COORDINADOR')
    def equipment_edit(session,equipo_id):
        d=data();fields={'codigo':('CodigoEquipo',30),'nombre':('Nombre',160),'categoria':('Categoria',100),'marca':('Marca',100),'modelo':('Modelo',100),'serie':('NumeroSerie',120),'ubicacion':('UbicacionGeneral',250),'descripcion':('Descripcion',700)}
        values={column:text_value(d,key,limit,key in {'codigo','nombre'}) for key,(column,limit) in fields.items() if key in d}
        if 'fecha_adquisicion' in d:values['FechaAdquisicion']=date.fromisoformat(d['fecha_adquisicion']) if d['fecha_adquisicion'] else None
        if 'activo' in d:
            if type(d['activo']) is not bool:raise ValueError('Estado inválido.')
            values['Activo']=d['activo']
        if not values:raise ValueError('No hay cambios para guardar.')
        with b.get_db_connection() as conn:
            cur=conn.cursor();b.set_audit_context(cur,session,'Edición de equipo')
            if not row(cur,'SELECT EquipoId FROM eqp.Equipo WITH (UPDLOCK,HOLDLOCK) WHERE EquipoId=?',(equipo_id,)):raise NotFound('Equipo no encontrado.')
            if values.get('Activo') is False and (row(cur,'SELECT TOP 1 EquipoOrdenId FROM eqp.EquipoOrden WHERE EquipoId=? AND LiberadoEn IS NULL',(equipo_id,)) or row(cur,"SELECT TOP 1 MantenimientoEquipoId FROM eqp.MantenimientoEquipo WHERE EquipoId=? AND Estado NOT IN ('FINALIZADO','CANCELADO')",(equipo_id,))):raise Conflict('Libera las asignaciones y mantenimientos antes de desactivar el equipo.')
            cur.execute('UPDATE eqp.Equipo SET '+','.join(k+'=?' for k in values)+',ActualizadoEn=SYSUTCDATETIME() WHERE EquipoId=?',*values.values(),equipo_id)
        return jsonify(ok=True,message='Equipo actualizado.')

    @app.post('/api/equipos/<int:equipo_id>/inspecciones')
    @auth('COORDINADOR','TECNICO')
    def equipment_inspection(session,equipo_id):
        d=data();moment=d.get('momento','PREVENTIVA');result=d.get('resultado')
        if moment not in {'PREVENTIVA','POST_MANTENIMIENTO','PREVIA_SERVICIO','POSTERIOR_SERVICIO'} or result not in {'APTO','CON_OBSERVACIONES','NO_APTO'}:raise ValueError('Momento o resultado inválido.')
        with b.get_db_connection() as conn:
            cur=conn.cursor();b.set_audit_context(cur,session,'Inspección de equipo')
            employee=active_employee(cur,session.get('empleado_id') if session['rol']=='TECNICO' else d.get('empleado_id') or session.get('empleado_id'))
            cur.execute('''INSERT INTO eqp.InspeccionEquipo(EquipoId,RealizadaPorEmpleadoId,Momento,Resultado,DetalleRevision,Observaciones) VALUES(?,?,?,?,?,?)''',equipo_id,employee,moment,result,text_value(d,'detalle',1200,True),text_value(d,'observaciones',600))
            if result=='NO_APTO':cur.execute("UPDATE eqp.Equipo SET Estado='FUERA_DE_USO',ActualizadoEn=SYSUTCDATETIME() WHERE EquipoId=?",equipo_id)
            recipients=equipment_notice(cur,equipo_id,'INSPECCION_EQUIPO','Inspección de equipo','Resultado: '+result,employee)
        equipment_push(recipients,'Inspección de equipo','Resultado: '+result,equipo_id)
        return jsonify(ok=True,message='Inspección registrada.'),201

    @app.post('/api/equipos/<int:equipo_id>/fallas')
    @auth('COORDINADOR','TECNICO')
    def equipment_failure(session,equipo_id):
        d=data();severity=d.get('severidad','MEDIA')
        if severity not in {'BAJA','MEDIA','ALTA','CRITICA'}:raise ValueError('Severidad inválida.')
        with b.get_db_connection() as conn:
            cur=conn.cursor();b.set_audit_context(cur,session,'Reporte de falla de equipo')
            cur.execute("""INSERT INTO eqp.FallaEquipo(EquipoId,ReportadaPorEmpleadoId,RegistradaPorUsuarioId,Descripcion,Severidad,RetiradoDeUso,Estado) VALUES(?,?,?,?,?,?,'REPORTADA')""",equipo_id,session.get('empleado_id'),session['usuario_id'],text_value(d,'descripcion',1200,True),severity,severity=='CRITICA')
            if severity=='CRITICA':cur.execute("UPDATE eqp.Equipo SET Estado='FUERA_DE_USO',ActualizadoEn=SYSUTCDATETIME() WHERE EquipoId=?",equipo_id)
            recipients=equipment_notice(cur,equipo_id,'FALLA_EQUIPO','Falla de equipo','Severidad: '+severity,session.get('empleado_id'))
        equipment_push(recipients,'Falla de equipo','Severidad: '+severity,equipo_id)
        return jsonify(ok=True,message='Falla registrada.'),201

    @app.get('/api/mantenimientos/<int:maintenance_id>')
    @auth('COORDINADOR','TECNICO')
    def maintenance_detail(session,maintenance_id):
        item=b.query_one('SELECT m.*,e.Nombre AS Equipo FROM eqp.MantenimientoEquipo m JOIN eqp.Equipo e ON e.EquipoId=m.EquipoId WHERE m.MantenimientoEquipoId=?',(maintenance_id,))
        if not item:raise NotFound('Mantenimiento no encontrado.')
        return jsonify(ok=True,item=clean(item),repuestos=b.query_all('SELECT * FROM eqp.RepuestoMantenimiento WHERE MantenimientoEquipoId=? ORDER BY RepuestoMantenimientoId',(maintenance_id,)))

    @app.patch('/api/mantenimientos/<int:maintenance_id>')
    @auth('COORDINADOR','TECNICO')
    def maintenance_update(session,maintenance_id):
        d=data();target=d.get('estado');transitions={'PROGRAMADO':{'DIAGNOSTICO','CANCELADO'},'DIAGNOSTICO':{'PENDIENTE_AUTORIZACION','CANCELADO'},'PENDIENTE_AUTORIZACION':{'AUTORIZADO','CANCELADO'},'AUTORIZADO':{'EN_PROCESO','CANCELADO'},'EN_PROCESO':{'EN_VERIFICACION'},'EN_VERIFICACION':{'FINALIZADO','CORRECCION'},'CORRECCION':{'EN_PROCESO'}}
        with b.get_db_connection() as conn:
            cur=conn.cursor();b.set_audit_context(cur,session,'Gestión de mantenimiento')
            m=row(cur,'SELECT * FROM eqp.MantenimientoEquipo WITH (UPDLOCK,HOLDLOCK) WHERE MantenimientoEquipoId=?',(maintenance_id,))
            if not m:raise NotFound('Mantenimiento no encontrado.')
            if target not in transitions.get(m['Estado'],set()):raise Conflict('Ese cambio no corresponde al estado actual.')
            if session['rol']=='TECNICO' and (m['EjecutadoPorEmpleadoId']!=session.get('empleado_id') or target not in {'EN_PROCESO','EN_VERIFICACION'}):raise Forbidden('Solo el ejecutor asignado puede avanzar su trabajo; coordinación autoriza y verifica.')
            changes={'Estado':target}
            fields={'diagnostico':('Diagnostico',1500),'trabajo_requerido':('TrabajoRequerido',1200),'trabajo_realizado':('TrabajoRealizado',1500),'observaciones':('Observaciones',900)}
            for key,(col,limit) in fields.items():
                if key in d:changes[col]=text_value(d,key,limit)
            if target=='PENDIENTE_AUTORIZACION' and not (changes.get('Diagnostico') or m['Diagnostico']):raise ValueError('Registra el diagnóstico.')
            if target=='AUTORIZADO':
                changes['EjecutadoPorEmpleadoId']=active_employee(cur,int(d.get('empleado_id') or 0));changes['AutorizadoPorUsuarioId']=session['usuario_id'];changes['AutorizadoEn']=b.utcnow()
                changes['CostoAutorizado']=number(d.get('costo_autorizado'),'Costo autorizado')
            if target=='EN_PROCESO':
                if not m['EjecutadoPorEmpleadoId']:raise ValueError('Asigna al ejecutor antes de iniciar.')
                if row(cur,'SELECT TOP 1 EquipoOrdenId FROM eqp.EquipoOrden WHERE EquipoId=? AND LiberadoEn IS NULL',(m['EquipoId'],)):raise Conflict('El equipo sigue asignado a una OT.')
                row(cur,'SELECT EquipoId FROM eqp.Equipo WITH (UPDLOCK,HOLDLOCK) WHERE EquipoId=?',(m['EquipoId'],))
                if row(cur,"SELECT TOP 1 MantenimientoEquipoId FROM eqp.MantenimientoEquipo WHERE EquipoId=? AND MantenimientoEquipoId<>? AND Estado IN ('EN_PROCESO','EN_VERIFICACION','CORRECCION')",(m['EquipoId'],maintenance_id)):raise Conflict('El equipo ya tiene otro mantenimiento en ejecución.')
                changes['IniciadoEn']=m['IniciadoEn'] or b.utcnow()
                cur.execute("UPDATE eqp.Equipo SET Estado='EN_MANTENIMIENTO',ActualizadoEn=SYSUTCDATETIME() WHERE EquipoId=?",m['EquipoId'])
                if m['FallaEquipoId']:cur.execute("UPDATE eqp.FallaEquipo SET Estado='EN_REPARACION' WHERE FallaEquipoId=?",m['FallaEquipoId'])
            if target in {'EN_VERIFICACION','FINALIZADO','CORRECCION'}:
                if not (changes.get('TrabajoRealizado') or m['TrabajoRealizado']):raise ValueError('Describe el trabajo realizado.')
            if target in {'FINALIZADO','CORRECCION'}:
                result=d.get('resultado')
                if result not in {'FUNCIONA','CON_OBSERVACIONES','FALLA_CONTINUA'} or (target=='FINALIZADO' and result=='FALLA_CONTINUA'):raise ValueError('Selecciona un resultado coherente con el cierre.')
                changes['ResultadoPrueba']=result;changes['VerificadoPorEmpleadoId']=active_employee(cur,session.get('empleado_id') or int(d.get('verificador_id') or 0))
            if d.get('proxima_revision'):changes['FechaProximaRevision']=date.fromisoformat(d['proxima_revision'])
            if target=='FINALIZADO':changes['FinalizadoEn']=b.utcnow()
            if target=='CANCELADO' and not changes.get('Observaciones'):raise ValueError('Indica el motivo de cancelación.')
            cur.execute('UPDATE eqp.MantenimientoEquipo SET '+','.join(k+'=?' for k in changes)+',ActualizadoEn=SYSUTCDATETIME() WHERE MantenimientoEquipoId=?',*changes.values(),maintenance_id)
            if target=='FINALIZADO':
                if m['FallaEquipoId']:cur.execute("UPDATE eqp.FallaEquipo SET Estado='CORREGIDA',CerradaEn=SYSUTCDATETIME() WHERE FallaEquipoId=?",m['FallaEquipoId'])
                cur.execute("""UPDATE e SET Estado='DISPONIBLE',ActualizadoEn=SYSUTCDATETIME() FROM eqp.Equipo e WHERE EquipoId=? AND Activo=1 AND Estado='EN_MANTENIMIENTO'
                 AND NOT EXISTS(SELECT 1 FROM eqp.MantenimientoEquipo m WHERE m.EquipoId=e.EquipoId AND m.Estado NOT IN ('FINALIZADO','CANCELADO','PROGRAMADO'))
                 AND NOT EXISTS(SELECT 1 FROM eqp.FallaEquipo f WHERE f.EquipoId=e.EquipoId AND f.RetiradoDeUso=1 AND f.Estado NOT IN ('CERRADA','CORREGIDA','DESCARTADA'))""",m['EquipoId'])
            if target=='CANCELADO' and m['FallaEquipoId']:
                cur.execute("UPDATE eqp.FallaEquipo SET Estado='REPORTADA' WHERE FallaEquipoId=? AND Estado='DIAGNOSTICO'",m['FallaEquipoId'])
            recipients=equipment_notice(cur,m['EquipoId'],'MANTENIMIENTO_ACTUALIZADO','Mantenimiento actualizado','Estado: '+target,changes.get('EjecutadoPorEmpleadoId') or m['EjecutadoPorEmpleadoId'],maintenance_id)
        equipment_push(recipients,'Mantenimiento actualizado','Estado: '+target,m['EquipoId'],maintenance_id)
        return jsonify(ok=True,message='Mantenimiento actualizado.')

    @app.post('/api/mantenimientos/<int:maintenance_id>/repuestos')
    @auth('COORDINADOR')
    def maintenance_part(session,maintenance_id):
        d=data()
        if d.get('utilizado') is True and d.get('autorizado') is not True:raise ValueError('Autoriza el repuesto antes de registrar su utilización.')
        with b.get_db_connection() as conn:
            cur=conn.cursor();b.set_audit_context(cur,session,'Registro de repuesto')
            m=row(cur,'SELECT Estado FROM eqp.MantenimientoEquipo WITH (UPDLOCK,HOLDLOCK) WHERE MantenimientoEquipoId=?',(maintenance_id,))
            if not m or m['Estado'] in {'FINALIZADO','CANCELADO'}:raise Conflict('El mantenimiento no admite más repuestos.')
            cur.execute('''INSERT INTO eqp.RepuestoMantenimiento(MantenimientoEquipoId,Descripcion,Cantidad,UnidadMedida,CostoUnitarioEstimado,CostoUnitarioReal,Autorizado,Utilizado)
              VALUES(?,?,?,?,?,?,?,?)''',maintenance_id,text_value(d,'descripcion',300,True),number(d.get('cantidad'),'Cantidad',Decimal('.001'),999999,3),text_value(d,'unidad',40,True),number(d.get('costo'),'Costo'),number(d.get('costo_real'),'Costo real'),d.get('autorizado') is True,d.get('utilizado') is True)
        return jsonify(ok=True,message='Repuesto registrado.'),201

    @app.get('/api/personal/<int:employee_id>')
    @auth('COORDINADOR')
    def personnel_detail(session,employee_id):
        item=b.query_one('''SELECT e.EmpleadoId AS id,e.CodigoEmpleado AS codigo,e.EstadoLaboral AS estado,e.Disponibilidad AS disponibilidad,
          e.FechaIngreso AS ingreso,e.TipoContratacion AS contratacion,p.Nombres AS nombres,p.Apellidos AS apellidos,p.TelefonoPrincipal AS telefono,p.Correo AS correo,pu.Nombre AS puesto
          FROM rh.Empleado e JOIN rh.Persona p ON p.PersonaId=e.PersonaId JOIN rh.Puesto pu ON pu.PuestoId=e.PuestoId WHERE e.EmpleadoId=?''',(employee_id,))
        if not item:raise NotFound('Empleado no encontrado.')
        return jsonify(ok=True,item=item)

    def vacation_dates(d):
        start=date.fromisoformat(d.get('inicio') or '');end=date.fromisoformat(d.get('fin') or '')
        if end<start:raise ValueError('La fecha final debe ser igual o posterior al inicio.')
        if (end-start).days>366:raise ValueError('La solicitud debe abarcar como máximo 367 días.')
        return start,end

    @app.get('/api/vacaciones/personal')
    @auth('COORDINADOR')
    def vacation_staff(session):
        return jsonify(ok=True,items=b.query_all("SELECT e.EmpleadoId AS id,CONCAT(p.Nombres,N' ',p.Apellidos) AS nombre FROM rh.Empleado e JOIN rh.Persona p ON p.PersonaId=e.PersonaId WHERE e.EstadoLaboral='ACTIVO' ORDER BY p.Nombres,p.Apellidos"))

    @app.get('/api/vacaciones/<int:vacation_id>')
    @auth('COORDINADOR','TECNICO')
    def vacation_detail(session,vacation_id):
        v=b.query_one('''SELECT v.SolicitudVacacionId AS id,v.EmpleadoId AS empleado_id,CONCAT(p.Nombres,N' ',p.Apellidos) AS empleado,
          v.FechaSolicitud AS solicitada,v.FechaInicio AS inicio,v.FechaFin AS fin,v.DiasSolicitados AS dias,v.Motivo AS motivo,v.Estado AS estado,
          v.Observaciones AS observaciones,v.NuevasFechasPropuestas AS propuestas,v.ResueltoEn AS resuelta
          FROM rh.SolicitudVacacion v JOIN rh.Empleado e ON e.EmpleadoId=v.EmpleadoId JOIN rh.Persona p ON p.PersonaId=e.PersonaId WHERE v.SolicitudVacacionId=?''',(vacation_id,))
        if not v or (session['rol']=='TECNICO' and v['empleado_id']!=session.get('empleado_id')):raise NotFound('Solicitud no encontrada.')
        return jsonify(ok=True,item=v)

    @app.post('/api/vacaciones')
    @auth('COORDINADOR','TECNICO')
    def vacation_create(session):
        d=data();start,end=vacation_dates(d);motive=text_value(d,'motivo',500,True)
        with b.get_db_connection() as conn:
            cur=conn.cursor();b.planning.lock_planning(b,cur);b.set_audit_context(cur,session,'Solicitud de vacaciones')
            employee=active_employee(cur,session.get('empleado_id') if session['rol']=='TECNICO' else d.get('empleado_id'))
            b.planning.validate_vacation(b,cur,employee,start,end)
            vid=row(cur,"""DECLARE @ids TABLE(id bigint); INSERT INTO rh.SolicitudVacacion(EmpleadoId,FechaInicio,FechaFin,Motivo,Estado)
              OUTPUT INSERTED.SolicitudVacacionId INTO @ids VALUES(?,?,?,?,'PENDIENTE'); SELECT id FROM @ids;""",(employee,start,end,motive))['id']
            coords=coordinator_users(b,cur,'vacaciones');staff=employee_users(b,cur,employee)
            notify_users(b,cur,coords+staff,'VACACIONES_SOLICITADAS','Solicitud de vacaciones',f'Solicitud del {start} al {end}.','Vacaciones',vid)
        b.queue_web_push(coords,title='Solicitud de vacaciones',body='Hay una solicitud pendiente de resolución.',role='COORDINADOR',entity='Vacaciones',entity_id=vid)
        return jsonify(ok=True,message='Solicitud registrada.',id=vid),201

    @app.patch('/api/vacaciones/<int:vacation_id>')
    @auth('COORDINADOR','TECNICO')
    def vacation_update(session,vacation_id):
        d=data();target=str(d.get('estado') or '').upper();notes=text_value(d,'observaciones',600)
        if target not in {'APROBADA','RECHAZADA','REPROGRAMAR','CANCELADA','PENDIENTE'}:raise ValueError('Estado inválido.')
        with b.get_db_connection() as conn:
            cur=conn.cursor();b.planning.lock_planning(b,cur);b.set_audit_context(cur,session,'Resolución de vacaciones')
            v=row(cur,'SELECT * FROM rh.SolicitudVacacion WITH (UPDLOCK,HOLDLOCK) WHERE SolicitudVacacionId=?',(vacation_id,))
            if not v or (session['rol']=='TECNICO' and v['EmpleadoId']!=session.get('empleado_id')):raise NotFound('Solicitud no encontrada.')
            allowed={'PENDIENTE':{'APROBADA','RECHAZADA','REPROGRAMAR','CANCELADA'},'REPROGRAMAR':{'APROBADA','RECHAZADA','CANCELADA','PENDIENTE'},'APROBADA':{'CANCELADA'}}
            if target not in allowed.get(v['Estado'],set()):raise Conflict('La solicitud ya fue resuelta o no admite esa transición.')
            if session['rol']=='TECNICO' and (target not in {'CANCELADA','PENDIENTE'} or v['Estado']=='APROBADA'):raise Forbidden('Coordinación resuelve la solicitud.')
            if target in {'RECHAZADA','REPROGRAMAR','CANCELADA'} and not notes:raise ValueError('Explica el motivo de la decisión.')
            start,end=v['FechaInicio'],v['FechaFin'];proposal=None
            if target=='PENDIENTE':
                start,end=vacation_dates(d);motive=text_value(d,'motivo',500,True)
                b.planning.validate_vacation(b,cur,v['EmpleadoId'],start,end,vacation_id)
                cur.execute("UPDATE rh.SolicitudVacacion SET FechaInicio=?,FechaFin=?,Motivo=?,Estado='PENDIENTE',Observaciones=?,NuevasFechasPropuestas=NULL,ResueltoEn=NULL,ResueltoPorUsuarioId=NULL,ActualizadoEn=SYSUTCDATETIME() WHERE SolicitudVacacionId=?",start,end,motive,notes,vacation_id)
            else:
                if target=='APROBADA':b.planning.validate_vacation(b,cur,v['EmpleadoId'],start,end,vacation_id,True)
                if target=='REPROGRAMAR':
                    proposed_start,proposed_end=vacation_dates(d);proposal=f'{proposed_start} / {proposed_end}'
                cur.execute('UPDATE rh.SolicitudVacacion SET Estado=?,Observaciones=?,NuevasFechasPropuestas=?,ResueltoPorUsuarioId=?,ResueltoEn=SYSUTCDATETIME(),ActualizadoEn=SYSUTCDATETIME() WHERE SolicitudVacacionId=?',target,notes,proposal,session['usuario_id'],vacation_id)
            staff=employee_users(b,cur,v['EmpleadoId']);coords=coordinator_users(b,cur,'vacaciones') if target in {'PENDIENTE','CANCELADA'} else []
            msg=f'Vacaciones {target.lower()}: {start} a {end}. '+(notes or '')
            notify_users(b,cur,staff+coords,'VACACIONES_'+target,'Vacaciones: '+target.lower(),msg,'Vacaciones',vacation_id)
        for ids,role in ((staff,'TECNICO'),(coords,'COORDINADOR')):b.queue_web_push(ids,title='Vacaciones: '+target.lower(),body=msg,role=role,entity='Vacaciones',entity_id=vacation_id)
        return jsonify(ok=True,message='Solicitud actualizada.')

    @app.get('/api/documentos/<int:document_id>/archivo')
    @auth('COORDINADOR','CLIENTE')
    def document_download(session,document_id):
        item=b.query_one('SELECT d.OrdenTrabajoId AS orden_id,d.RutaArchivo AS ruta,d.Estado AS estado,d.EsSeguimientoInterno AS interno,f.Categoria AS categoria FROM doc.DocumentoServicio d JOIN doc.FormatoDocumento f ON f.FormatoDocumentoId=d.FormatoDocumentoId WHERE d.DocumentoServicioId=?',(document_id,))
        if not item:raise NotFound('Documento no encontrado.')
        b.assert_order_access(session,item['orden_id'])
        if session['rol']=='CLIENTE' and (item.get('interno') or item['estado'] not in {'GENERADO','ENTREGADO','ACEPTADO','OBSERVADO'}):raise NotFound('Documento no disponible.')
        path=str(item['ruta'] or '')
        if path.upper().startswith('BD://EVIDENCIA/'):
            evidence_id=int(path.rsplit('/',1)[1]);return b.api_archivo_evidencia(evidencia_id=evidence_id)
        legacy=b.resolve_evidence_path(path)
        if not legacy or not legacy.is_file():raise NotFound('El archivo no está disponible. Solicita una copia a coordinación.')
        return send_file(legacy,as_attachment=True,download_name=legacy.name)

    def metadata(value):
        try:return json.loads(value or '{}')
        except (ValueError,TypeError):return {}

    def warranty_crew(payload):
        raw=payload.get('integrantes') or []
        if not isinstance(raw,list) or not raw:raise ValueError('Selecciona la cuadrilla que realizará la visita.')
        members=[];seen=set()
        for item in raw:
            if not isinstance(item,dict):raise ValueError('La cuadrilla contiene un registro inválido.')
            employee=int(item.get('empleado_id') or 0);function=str(item.get('funcion') or 'TECNICO').upper()
            if not employee or employee in seen:raise ValueError('La cuadrilla contiene empleados inválidos o repetidos.')
            if function not in {'ENCARGADO','TECNICO','APOYO'}:raise ValueError('Función de cuadrilla inválida.')
            seen.add(employee);members.append((employee,function))
        if sum(1 for _,function in members if function=='ENCARGADO')!=1:raise ValueError('La cuadrilla debe tener exactamente un ENCARGADO.')
        return members

    def warranty_followup_order(cur,session,source_order_id,scheduled,members,kind,claim,result_note=None):
        source=row(cur,"""SELECT o.OrdenTrabajoId,o.NumeroOrden,o.Prioridad,o.CoordinadorUsuarioId,
              ss.ClienteId,ss.ContactoClienteId,ss.UbicacionServicioId,ss.TipoServicioId,ss.NivelUrgencia,
              c.NombreComercial AS Cliente,ts.Nombre AS Servicio
          FROM srv.OrdenTrabajo o JOIN srv.SolicitudServicio ss ON ss.SolicitudServicioId=o.SolicitudServicioId
          JOIN crm.Cliente c ON c.ClienteId=ss.ClienteId JOIN srv.TipoServicio ts ON ts.TipoServicioId=ss.TipoServicioId
          WHERE o.OrdenTrabajoId=?""",(source_order_id,))
        if not source:raise NotFound('No se encontró la OT original de la garantía.')
        label='REVISIÓN DE GARANTÍA' if kind=='REVISION_GARANTIA' else 'SERVICIO AUTORIZADO FUERA DE GARANTÍA'
        description=(f'{label} · {source["NumeroOrden"]}. Reporte del cliente: {claim or "Sin detalle"}')[:1500]
        if result_note and kind!='REVISION_GARANTIA':description=(description+f' Resultado de revisión: {result_note}')[:1500]
        urgency=str(source.get('NivelUrgencia') or source.get('Prioridad') or 'MEDIA').upper()
        if urgency not in {'BAJA','MEDIA','ALTA','CRITICA'}:urgency='MEDIA'
        request_row=row(cur,'EXEC srv.usp_AppCrearSolicitud ?,?,?,?,?,?,?,?,?,?',(
            source['ClienteId'],source.get('ContactoClienteId'),source['UbicacionServicioId'],source['TipoServicioId'],
            session['usuario_id'],'OTRO','PROGRAMADA',urgency,description,scheduled))
        request_id=(request_row or {}).get('SolicitudServicioId') or (request_row or {}).get('solicitudServicioId') or (request_row or {}).get('id')
        if not request_id:
            found=row(cur,'SELECT TOP 1 SolicitudServicioId AS id FROM srv.SolicitudServicio WHERE ClienteId=? AND RegistradaPorUsuarioId=? ORDER BY SolicitudServicioId DESC',(source['ClienteId'],session['usuario_id']))
            request_id=(found or {}).get('id')
        if not request_id:raise RuntimeError('No fue posible crear la solicitud de seguimiento de garantía.')
        observation=(f'{label} vinculada a {source["NumeroOrden"]}. '+('SIN COBRO si la garantía aplica.' if kind=='REVISION_GARANTIA' else 'Trabajo sujeto a cobro autorizado por el cliente.'))[:900]
        order_row=row(cur,'EXEC srv.usp_AppCrearOrden ?,?,?,?,?,?,?',(
            request_id,session['usuario_id'],source.get('Prioridad') or urgency,scheduled,None,None,observation))
        order_id=(order_row or {}).get('OrdenTrabajoId') or (order_row or {}).get('ordenTrabajoId') or (order_row or {}).get('id')
        if not order_id:
            found=row(cur,'SELECT TOP 1 OrdenTrabajoId AS id FROM srv.OrdenTrabajo WHERE SolicitudServicioId=? ORDER BY OrdenTrabajoId DESC',(request_id,))
            order_id=(found or {}).get('id')
        if not order_id:raise RuntimeError('No fue posible crear la OT de seguimiento de garantía.')
        employee_ids=[employee for employee,_ in members]
        b.planning.validate_order(b,cur,int(order_id),employee_ids=employee_ids)
        for employee,function in members:
            row(cur,'EXEC srv.usp_AppAsignarTecnico ?,?,?,?',(order_id,employee,session['usuario_id'],function))
        return int(request_id),int(order_id)

    def warranty_request_save(cur,item,meta,db_state,resolved=False):
        encoded=json.dumps(meta,ensure_ascii=False,separators=(',',':'))
        if len(encoded)>900:raise ValueError('Reduce las observaciones de la revisión para poder guardarlas.')
        cur.execute('UPDATE srv.IncidenciaOrden SET Estado=?,AccionTomada=?,ResponsableUsuarioId=?,ResueltaEn=? WHERE IncidenciaOrdenId=?',
          db_state,encoded,item.get('ResponsableUsuarioId'),b.utcnow() if resolved else None,item['IncidenciaOrdenId'])

    def guarantee_list(session):
        orders=b.query_all("""SELECT o.OrdenTrabajoId AS orden_id,o.NumeroOrden AS numero_orden,o.FinalizadaEn AS finalizada_en,
          c.NombreComercial AS cliente,sc.Nombre AS sede,ts.Nombre AS tipo_servicio
          FROM srv.OrdenTrabajo o JOIN srv.EstadoOrdenTrabajo e ON e.EstadoOrdenTrabajoId=o.EstadoOrdenTrabajoId
          JOIN srv.SolicitudServicio ss ON ss.SolicitudServicioId=o.SolicitudServicioId JOIN crm.Cliente c ON c.ClienteId=ss.ClienteId
          LEFT JOIN crm.UbicacionServicio ub ON ub.UbicacionServicioId=ss.UbicacionServicioId LEFT JOIN crm.SucursalCliente sc ON sc.SucursalClienteId=ub.SucursalClienteId
          JOIN srv.TipoServicio ts ON ts.TipoServicioId=ss.TipoServicioId WHERE e.Codigo='COMPLETADA' AND (?='COORDINADOR' OR (ss.ClienteId=? AND EXISTS (SELECT 1 FROM crm.UbicacionServicio ux JOIN seg.ufn_SucursalesPermitidas(?) ax ON ax.SucursalClienteId=ux.SucursalClienteId WHERE ux.UbicacionServicioId=ss.UbicacionServicioId))) ORDER BY o.FinalizadaEn DESC""",(session['rol'],session.get('cliente_id'),session['usuario_id']))
        raw=b.query_all("""SELECT i.* FROM srv.IncidenciaOrden i JOIN srv.OrdenTrabajo o ON o.OrdenTrabajoId=i.OrdenTrabajoId
          JOIN srv.SolicitudServicio ss ON ss.SolicitudServicioId=o.SolicitudServicioId
          WHERE ISJSON(i.AccionTomada)=1 AND (?='COORDINADOR' OR (ss.ClienteId=? AND EXISTS (SELECT 1 FROM crm.UbicacionServicio ux JOIN seg.ufn_SucursalesPermitidas(?) ax ON ax.SucursalClienteId=ux.SucursalClienteId WHERE ux.UbicacionServicioId=ss.UbicacionServicioId))) ORDER BY i.IncidenciaOrdenId""",(session['rol'],session.get('cliente_id'),session['usuario_id']))
        configs={};requests=[];mapped={x['orden_id']:x for x in orders}
        linked_ids=set()
        for i in raw:
            meta=metadata(i['AccionTomada']);oid=i['OrdenTrabajoId']
            if meta.get('portal_tipo')=='garantia_config':configs[oid]=(i,meta)
            if meta.get('portal_tipo')=='garantia_solicitud' and oid in mapped:
                request_item=dict(mapped[oid],solicitud_garantia_id=i['IncidenciaOrdenId'],descripcion=i['Descripcion'],
                  estado=meta.get('estado','PENDIENTE'),creado_en=i['ReportadaEn'],observaciones_respuesta=meta.get('respuesta') or meta.get('resultado_revision'),
                  resultado_revision=meta.get('resultado_revision'),aplica_garantia=meta.get('aplica_garantia'),sin_cobro=bool(meta.get('sin_cobro')),
                  revision_solicitud_id=meta.get('revision_solicitud_id'),revision_orden_id=meta.get('revision_orden_id'),
                  orden_cobro_id=meta.get('orden_cobro_id'),solicitud_cobro_id=meta.get('solicitud_cobro_id'),
                  programada_para=meta.get('programada_para'),cliente_autorizo=meta.get('cliente_autorizo'),respuesta_cliente=meta.get('respuesta_cliente'))
                requests.append(request_item)
                for key in ('revision_orden_id','orden_cobro_id'):
                    if meta.get(key):linked_ids.add(int(meta[key]))
        linked={}
        if linked_ids:
            placeholders=','.join('?' for _ in linked_ids)
            linked_rows=b.query_all(f"SELECT o.OrdenTrabajoId AS id,o.NumeroOrden AS numero,e.Codigo AS estado_codigo,e.Nombre AS estado FROM srv.OrdenTrabajo o JOIN srv.EstadoOrdenTrabajo e ON e.EstadoOrdenTrabajoId=o.EstadoOrdenTrabajoId WHERE o.OrdenTrabajoId IN ({placeholders})",tuple(linked_ids))
            linked={int(x['id']):x for x in linked_rows}
        for r in requests:
            rid=int(r['revision_orden_id']) if r.get('revision_orden_id') else None;cid=int(r['orden_cobro_id']) if r.get('orden_cobro_id') else None
            r['revision_orden_numero']=(linked.get(rid) or {}).get('numero') if rid else None;r['revision_orden_estado']=(linked.get(rid) or {}).get('estado_codigo') if rid else None
            r['orden_cobro_numero']=(linked.get(cid) or {}).get('numero') if cid else None;r['orden_cobro_estado']=(linked.get(cid) or {}).get('estado_codigo') if cid else None
        now=b.utcnow()
        for o in orders:
            conf,meta=configs.get(o['orden_id'],({},{}));days=int(meta.get('dias') or 0);start=o['finalizada_en'];end=start+timedelta(days=days) if start and days else None
            seconds=max(0,int((end-now).total_seconds())) if end else 0;recent=next((r for r in reversed(requests) if r['orden_id']==o['orden_id']),{})
            o.update(garantia_id=conf.get('IncidenciaOrdenId'),dias_garantia=days,inicio_garantia=start,fin_garantia=end,segundos_restantes=seconds,
              estado_garantia='PENDIENTE_CONFIGURACION' if not end else 'ACTIVA' if seconds>0 else 'VENCIDA',observaciones_garantia=conf.get('Descripcion'),
              estado_solicitud=recent.get('estado'),solicitud_garantia_id=recent.get('solicitud_garantia_id'),sin_cobro=recent.get('sin_cobro',False),
              revision_orden_id=recent.get('revision_orden_id'),revision_orden_numero=recent.get('revision_orden_numero'),orden_cobro_id=recent.get('orden_cobro_id'),
              cliente_autorizo=recent.get('cliente_autorizo'))
        return orders,requests

    def guarantees(session):
        items,requests=guarantee_list(session)
        active_states={'PENDIENTE','EN_REVISION','PENDIENTE_AUTORIZACION','AUTORIZADA_CLIENTE','GARANTIA_APROBADA'}
        return jsonify(ok=True,items=items,solicitudes=requests,resumen={'finalizadas':len(items),'activas':sum(x['estado_garantia']=='ACTIVA' for x in items),'pendientes_configurar':sum(x['estado_garantia']=='PENDIENTE_CONFIGURACION' for x in items),'vencidas':sum(x['estado_garantia']=='VENCIDA' for x in items),'solicitudes_pendientes':sum(str(x.get('estado') or '').upper() in active_states for x in requests)})

    def guarantee_config(session,orden_id):
        d=data();days=int(d.get('dias') or 0)
        if not 1<=days<=3650:raise ValueError('Indica un plazo entre 1 y 3650 días.')
        if b.assert_order_access(session,orden_id)['estado']!='COMPLETADA':raise Conflict('Primero finaliza la OT.')
        meta=json.dumps({'portal_tipo':'garantia_config','dias':days},ensure_ascii=False);note=text_value(d,'observaciones',600) or 'Garantía del servicio'
        with b.get_db_connection() as conn:
            cur=conn.cursor();b.set_audit_context(cur,session,'Configuración de garantía')
            row(cur,'SELECT OrdenTrabajoId FROM srv.OrdenTrabajo WITH (UPDLOCK,HOLDLOCK) WHERE OrdenTrabajoId=?',(orden_id,))
            old=row(cur,"SELECT TOP 1 IncidenciaOrdenId AS id FROM srv.IncidenciaOrden WHERE OrdenTrabajoId=? AND JSON_VALUE(CASE WHEN ISJSON(AccionTomada)=1 THEN AccionTomada ELSE '{}' END,'$.portal_tipo')='garantia_config'",(orden_id,))
            if old:cur.execute('UPDATE srv.IncidenciaOrden SET Descripcion=?,AccionTomada=?,ResponsableUsuarioId=? WHERE IncidenciaOrdenId=?',note,meta,session['usuario_id'],old['id'])
            else:cur.execute("INSERT INTO srv.IncidenciaOrden(OrdenTrabajoId,TipoIncidencia,Descripcion,AccionTomada,Estado,ResponsableUsuarioId,ResueltaEn) VALUES(?,'OTRA',?,?,'CERRADA',?,SYSUTCDATETIME())",orden_id,note,meta,session['usuario_id'])
            notify(cur,orden_id,'Garantía configurada',f'El plazo es de {days} días desde la finalización original de la OT.')
        b.queue_web_push(b._client_user_ids_for_order(orden_id),title='Garantía configurada',body=f'El servicio tiene {days} días de garantía desde su finalización.',role='CLIENTE',entity='OrdenTrabajo',entity_id=orden_id)
        return jsonify(ok=True,message='Garantía configurada desde la finalización original.')

    def guarantee_request(session,garantia_id):
        description=text_value(data(),'descripcion',1200,True)
        with b.get_db_connection() as conn:
            cur=conn.cursor();b.set_audit_context(cur,session,'Solicitud de revisión de garantía')
            conf=row(cur,'SELECT * FROM srv.IncidenciaOrden WITH (UPDLOCK,HOLDLOCK) WHERE IncidenciaOrdenId=?',(garantia_id,))
            if not conf or metadata(conf['AccionTomada']).get('portal_tipo')!='garantia_config':raise NotFound('Garantía no encontrada.')
            oid=conf['OrdenTrabajoId'];b.assert_order_access(session,oid)
            order=row(cur,'SELECT FinalizadaEn FROM srv.OrdenTrabajo WHERE OrdenTrabajoId=?',(oid,))
            if not order['FinalizadaEn'] or order['FinalizadaEn']+timedelta(days=int(metadata(conf['AccionTomada'])['dias']))<=b.utcnow():raise Conflict('La garantía ya venció.')
            if row(cur,"""SELECT TOP 1 IncidenciaOrdenId FROM srv.IncidenciaOrden WHERE OrdenTrabajoId=? AND ISJSON(AccionTomada)=1
              AND JSON_VALUE(AccionTomada,'$.portal_tipo')='garantia_solicitud'
              AND JSON_VALUE(AccionTomada,'$.estado') IN ('PENDIENTE','EN_REVISION','PENDIENTE_AUTORIZACION','AUTORIZADA_CLIENTE','GARANTIA_APROBADA')""",(oid,)):
                raise Conflict('Ya existe una revisión de garantía activa para esta OT.')
            meta={'portal_tipo':'garantia_solicitud','estado':'PENDIENTE'}
            cur.execute("INSERT INTO srv.IncidenciaOrden(OrdenTrabajoId,TipoIncidencia,Descripcion,AccionTomada,Estado,ResponsableUsuarioId) VALUES(?,'CLIENTE',?,?,'PENDIENTE',?)",oid,description,json.dumps(meta,separators=(',',':')),session['usuario_id'])
            notify(cur,oid,'Revisión de garantía solicitada',description,True)
        return jsonify(ok=True,message='Revisión solicitada; Coordinación debe programar la visita y asignar la cuadrilla.'),201

    def guarantee_status(session,solicitud_id):
        d=data();action=str(d.get('accion') or '').upper()
        if not action:raise ValueError('Selecciona la acción que corresponde a la revisión de garantía.')
        with b.get_db_connection() as conn:
            cur=conn.cursor();b.planning.lock_planning(b,cur);b.set_audit_context(cur,session,'Gestión de revisión de garantía')
            item=row(cur,'SELECT * FROM srv.IncidenciaOrden WITH (UPDLOCK,HOLDLOCK) WHERE IncidenciaOrdenId=?',(solicitud_id,))
            if not item:raise NotFound('Revisión no encontrada.')
            meta=metadata(item['AccionTomada'])
            if meta.get('portal_tipo')!='garantia_solicitud':raise NotFound('Revisión no encontrada.')
            current=str(meta.get('estado') or 'PENDIENTE').upper();notes=text_value(d,'observaciones',360)
            item['ResponsableUsuarioId']=session['usuario_id']
            if action=='PROGRAMAR_REVISION':
                if current!='PENDIENTE':raise Conflict('La visita de revisión ya fue programada o la solicitud cambió de estado.')
                scheduled=b.parse_datetime_local(d.get('programada_para'),'Fecha aproximada de revisión')
                if scheduled is None:raise ValueError('Indica la fecha y hora aproximada de la revisión.')
                members=warranty_crew(d)
                request_id,order_id=warranty_followup_order(cur,session,item['OrdenTrabajoId'],scheduled,members,'REVISION_GARANTIA',item['Descripcion'])
                meta.update(estado='EN_REVISION',respuesta=notes,revision_solicitud_id=request_id,revision_orden_id=order_id,programada_para=scheduled.isoformat(),sin_cobro=None)
                warranty_request_save(cur,item,meta,'EN_ATENCION',False)
                notify(cur,item['OrdenTrabajoId'],'Revisión de garantía programada',f'Se creó una OT de revisión y se asignó la cuadrilla. Atención aproximada: {scheduled}.')
                message='Revisión programada y cuadrilla asignada.'
            elif action=='RECHAZAR':
                if current!='PENDIENTE':raise Conflict('Solo una solicitud pendiente puede rechazarse directamente.')
                if not notes:raise ValueError('Explica por qué se rechaza la solicitud de garantía.')
                meta.update(estado='RECHAZADA',respuesta=notes,sin_cobro=False)
                warranty_request_save(cur,item,meta,'CERRADA',True);notify(cur,item['OrdenTrabajoId'],'Revisión de garantía rechazada',notes)
                message='Solicitud de garantía rechazada.'
            elif action=='RESULTADO_REVISION':
                if current!='EN_REVISION':raise Conflict('Primero programa y realiza la revisión de garantía.')
                if not notes:raise ValueError('Describe el resultado de la revisión.')
                applies=str(d.get('aplica_garantia') or '').lower() in {'1','true','si','sí','yes','aplica'}
                meta.update(resultado_revision=notes,aplica_garantia=applies);meta.pop('respuesta',None)
                if applies:
                    meta.update(estado='GARANTIA_APROBADA',sin_cobro=True,cliente_autorizo=None)
                    review_id=int(meta.get('revision_orden_id') or 0)
                    if review_id:
                        cur.execute("""UPDATE srv.OrdenTrabajo SET ObservacionesCoordinacion=LEFT(CONCAT(COALESCE(ObservacionesCoordinacion,N''),CASE WHEN COALESCE(ObservacionesCoordinacion,N'')=N'' THEN N'' ELSE N' · ' END,N'GARANTÍA APROBADA · SIN COBRO'),900),ActualizadoEn=SYSUTCDATETIME() WHERE OrdenTrabajoId=?""",review_id)
                    warranty_request_save(cur,item,meta,'EN_ATENCION',False)
                    notify(cur,item['OrdenTrabajoId'],'Garantía aprobada','La revisión determinó que aplica garantía. La atención vinculada queda marcada SIN COBRO.')
                    message='Garantía aprobada y marcada SIN COBRO.'
                else:
                    meta.update(estado='PENDIENTE_AUTORIZACION',sin_cobro=False,cliente_autorizo=None)
                    warranty_request_save(cur,item,meta,'EN_ATENCION',False)
                    notify(cur,item['OrdenTrabajoId'],'Garantía no aplicable','La revisión no cumple las condiciones de garantía. Indica si autorizas un nuevo trabajo con cobro.')
                    message='Resultado registrado. Se espera autorización del cliente para continuar con un trabajo con cobro.'
            elif action=='CREAR_OT_COBRO':
                if current!='AUTORIZADA_CLIENTE':raise Conflict('El cliente todavía no ha autorizado el trabajo con cobro.')
                scheduled=b.parse_datetime_local(d.get('programada_para'),'Fecha aproximada del nuevo trabajo')
                if scheduled is None:raise ValueError('Indica la fecha y hora aproximada del nuevo trabajo.')
                members=warranty_crew(d)
                request_id,order_id=warranty_followup_order(cur,session,item['OrdenTrabajoId'],scheduled,members,'SERVICIO_COBRO',item['Descripcion'],meta.get('resultado_revision'))
                meta.update(estado='SERVICIO_AUTORIZADO',solicitud_cobro_id=request_id,orden_cobro_id=order_id,programada_cobro=scheduled.isoformat(),sin_cobro=False)
                warranty_request_save(cur,item,meta,'RESUELTA',True)
                notify(cur,item['OrdenTrabajoId'],'Trabajo con cobro programado','Se creó una nueva OT porque el cliente autorizó continuar fuera de garantía.')
                message='Nueva OT con cobro creada y cuadrilla asignada.'
            elif action=='CERRAR_GARANTIA':
                if current!='GARANTIA_APROBADA':raise Conflict('La revisión no está pendiente de cierre bajo garantía.')
                review_id=int(meta.get('revision_orden_id') or 0)
                status=row(cur,"SELECT e.EsFinal AS final FROM srv.OrdenTrabajo o JOIN srv.EstadoOrdenTrabajo e ON e.EstadoOrdenTrabajoId=o.EstadoOrdenTrabajoId WHERE o.OrdenTrabajoId=?",(review_id,)) if review_id else None
                if not status or not status.get('final'):raise Conflict('Finaliza primero la OT de revisión/garantía.')
                meta.update(estado='ATENDIDA',respuesta=notes or meta.get('respuesta'))
                warranty_request_save(cur,item,meta,'RESUELTA',True);notify(cur,item['OrdenTrabajoId'],'Garantía atendida','La revisión y atención bajo garantía quedaron finalizadas.')
                message='Garantía atendida y cerrada.'
            else:raise ValueError('Acción de garantía inválida.')
        return jsonify(ok=True,message=message)

    def guarantee_client_decision(session,solicitud_id):
        d=data();decision=str(d.get('decision') or '').upper();note=text_value(d,'observaciones',260)
        if decision not in {'AUTORIZAR','NO_AUTORIZAR'}:raise ValueError('Selecciona si autorizas o no el trabajo con cobro.')
        with b.get_db_connection() as conn:
            cur=conn.cursor();b.set_audit_context(cur,session,'Decisión del cliente sobre garantía no aplicable')
            item=row(cur,'SELECT * FROM srv.IncidenciaOrden WITH (UPDLOCK,HOLDLOCK) WHERE IncidenciaOrdenId=?',(solicitud_id,))
            if not item:raise NotFound('Revisión no encontrada.')
            b.assert_order_access(session,item['OrdenTrabajoId'])
            meta=metadata(item['AccionTomada'])
            if meta.get('portal_tipo')!='garantia_solicitud' or str(meta.get('estado') or '').upper()!='PENDIENTE_AUTORIZACION':raise Conflict('Esta revisión ya no está esperando tu autorización.')
            item['ResponsableUsuarioId']=session['usuario_id']
            if decision=='AUTORIZAR':
                meta.update(estado='AUTORIZADA_CLIENTE',cliente_autorizo=True,respuesta_cliente=note,sin_cobro=False)
                warranty_request_save(cur,item,meta,'EN_ATENCION',False)
                notify(cur,item['OrdenTrabajoId'],'Cliente autorizó trabajo con cobro',note or 'El cliente autorizó crear una nueva OT fuera de garantía.',True)
                message='Autorización registrada. Coordinación programará una nueva OT con cobro.'
            else:
                meta.update(estado='NO_AUTORIZADA',cliente_autorizo=False,respuesta_cliente=note,sin_cobro=False)
                warranty_request_save(cur,item,meta,'CERRADA',True)
                notify(cur,item['OrdenTrabajoId'],'Cliente no autorizó trabajo adicional',note or 'El cliente decidió no continuar con un nuevo trabajo con cobro.',True)
                message='Decisión registrada. No se abrirá una nueva OT.'
        return jsonify(ok=True,message=message)
    return {'save_quote':save_quote,'guarantees':guarantees,'guarantee_config':guarantee_config,'guarantee_request':guarantee_request,'guarantee_status':guarantee_status,'guarantee_client_decision':guarantee_client_decision}
