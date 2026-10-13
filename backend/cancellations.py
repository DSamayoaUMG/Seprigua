"""Solicitud y resolución de cancelaciones en el historial existente de avisos.

Los eventos CANCELACION_* son registros de negocio: no deben purgarse.
Marcar un aviso leído no resuelve una cancelación.
"""
from flask import request,jsonify
from werkzeug.exceptions import NotFound,Conflict
from .notifications import notify_users,coordinator_users
BASE="""SELECT n.NotificacionId AS id,n.UsuarioId AS solicitante_id,n.Entidad AS entidad,TRY_CONVERT(bigint,n.EntidadId) AS entidad_id,
 n.Mensaje AS motivo,n.CreadaEn AS solicitada,COALESCE(o.NumeroOrden,CONCAT('Solicitud #',s.SolicitudServicioId)) AS numero,
 COALESCE(s.ClienteId,so.ClienteId) AS cliente_id,c.NombreComercial AS cliente,
 CASE WHEN r.Tipo='CANCELACION_APROBADA' THEN 'APROBADA' WHEN r.Tipo='CANCELACION_RECHAZADA' THEN 'RECHAZADA' ELSE 'PENDIENTE' END AS estado,
 r.Mensaje AS resolucion,r.CreadaEn AS resuelta
 FROM com.Notificacion n
 LEFT JOIN srv.SolicitudServicio s ON n.Entidad='SolicitudServicio' AND s.SolicitudServicioId=TRY_CONVERT(bigint,n.EntidadId)
 LEFT JOIN srv.OrdenTrabajo o ON n.Entidad='OrdenTrabajo' AND o.OrdenTrabajoId=TRY_CONVERT(bigint,n.EntidadId)
 LEFT JOIN srv.SolicitudServicio so ON so.SolicitudServicioId=o.SolicitudServicioId
 JOIN crm.Cliente c ON c.ClienteId=COALESCE(s.ClienteId,so.ClienteId)
 OUTER APPLY(SELECT TOP 1 x.Tipo,x.Mensaje,x.CreadaEn FROM com.Notificacion x WHERE x.Entidad='Cancelacion' AND TRY_CONVERT(bigint,x.EntidadId)=n.NotificacionId
   AND x.Tipo IN ('CANCELACION_APROBADA','CANCELACION_RECHAZADA') ORDER BY x.NotificacionId DESC) r
 WHERE n.Tipo='CANCELACION_SOLICITADA'"""

def register_cancellations(b):
    @b.app.get('/api/cancelaciones')
    @b.require_session('COORDINADOR','CLIENTE')
    def cancellations_list(session):
        status=str(request.args.get('estado') or '').upper()
        if status not in {'','PENDIENTE','APROBADA','RECHAZADA'}:raise ValueError('Estado inválido.')
        page,size=b.pagination_args(20,100);params=(session['rol'],session.get('cliente_id'),status,status)
        query='WITH datos AS ('+BASE+") SELECT * FROM datos WHERE (?='COORDINADOR' OR cliente_id=?) AND (?='' OR estado=?)"
        with b.get_db_connection() as conn:
            cur=conn.cursor();total=int(b.exec_proc_row(cur,'SELECT COUNT_BIG(*) AS total FROM ('+BASE+") datos WHERE (?='COORDINADOR' OR cliente_id=?) AND (?='' OR estado=?)",params)['total'])
            pages=max(1,(total+size-1)//size);page=min(page,pages)
            items=b.exec_proc_rows(cur,query+' ORDER BY solicitada DESC,id DESC OFFSET ? ROWS FETCH NEXT ? ROWS ONLY',(*params,(page-1)*size,size))
        return jsonify(ok=True,items=items,total=total,pagina=page,paginas=pages,tamano=size)

    @b.app.post('/api/cancelaciones')
    @b.require_session('CLIENTE')
    def cancellation_create(session):
        d=request.get_json(silent=True) or {};entity=d.get('entidad');entity_id=int(d.get('entidad_id') or 0);motive=str(d.get('motivo') or '').strip()
        if entity not in {'SolicitudServicio','OrdenTrabajo'} or entity_id<=0:raise ValueError('Selecciona una solicitud u orden válida.')
        if not 5<=len(motive)<=900:raise ValueError('Describe el motivo de cancelación (5 a 900 caracteres).')
        with b.get_db_connection() as conn:
            cur=conn.cursor();b.planning.lock_planning(b,cur);b.set_audit_context(cur,session,'Solicitud de cancelación')
            if entity=='OrdenTrabajo':
                b.assert_order_access(session,entity_id)
                item=b.exec_proc_row(cur,'SELECT eo.EsFinal AS final FROM srv.OrdenTrabajo o JOIN srv.EstadoOrdenTrabajo eo ON eo.EstadoOrdenTrabajoId=o.EstadoOrdenTrabajoId WHERE o.OrdenTrabajoId=?',(entity_id,))
                if not item or item['final']:raise Conflict('La orden ya está cerrada.')
            else:
                item=b.exec_proc_row(cur,'SELECT ClienteId AS cliente_id,Estado AS estado FROM srv.SolicitudServicio WHERE SolicitudServicioId=?',(entity_id,))
                if not item or item['cliente_id']!=session['cliente_id']:raise NotFound('Solicitud no encontrada.')
                if item['estado']=='CANCELADA':raise Conflict('La solicitud ya fue cancelada.')
                if b.exec_proc_row(cur,'SELECT TOP 1 OrdenTrabajoId FROM srv.OrdenTrabajo WHERE SolicitudServicioId=?',(entity_id,)):raise Conflict('La solicitud ya tiene OT; solicita la cancelación desde su orden.')
            if b.exec_proc_row(cur,"""SELECT TOP 1 n.NotificacionId FROM com.Notificacion n WHERE n.Tipo='CANCELACION_SOLICITADA' AND n.Entidad=? AND n.EntidadId=?
              AND NOT EXISTS(SELECT 1 FROM com.Notificacion r WHERE r.Entidad='Cancelacion' AND TRY_CONVERT(bigint,r.EntidadId)=n.NotificacionId AND r.Tipo IN ('CANCELACION_APROBADA','CANCELACION_RECHAZADA'))""",(entity,str(entity_id))):raise Conflict('Ya existe una solicitud de cancelación pendiente.')
            cid=b.exec_proc_row(cur,"""DECLARE @ids TABLE(id bigint);INSERT INTO com.Notificacion(UsuarioId,Tipo,Titulo,Mensaje,Entidad,EntidadId,Canal,Estado)
              OUTPUT INSERTED.NotificacionId INTO @ids VALUES(?,'CANCELACION_SOLICITADA','Cancelación solicitada',?,?,?,'SISTEMA','PENDIENTE');SELECT id FROM @ids;""",(session['usuario_id'],motive,entity,str(entity_id)))['id']
            coords=coordinator_users(b,cur,'solicitudes');notify_users(b,cur,coords,'CANCELACION_PENDIENTE','Resolver cancelación',motive,'Cancelacion',cid)
        b.queue_web_push(coords,title='Solicitud de cancelación',body=motive,role='COORDINADOR',entity='Cancelacion',entity_id=cid)
        return jsonify(ok=True,message='Coordinación revisará tu solicitud de cancelación.',id=cid),201

    @b.app.patch('/api/cancelaciones/<int:cancellation_id>')
    @b.require_session('COORDINADOR')
    def cancellation_resolve(session,cancellation_id):
        d=request.get_json(silent=True) or {};target=str(d.get('estado') or '').upper();notes=str(d.get('observaciones') or '').strip()
        if target not in {'APROBADA','RECHAZADA'}:raise ValueError('Selecciona aprobar o rechazar.')
        if not 5<=len(notes)<=900:raise ValueError('Explica la resolución (5 a 900 caracteres).')
        with b.get_db_connection() as conn:
            cur=conn.cursor();b.planning.lock_planning(b,cur);b.set_audit_context(cur,session,'Resolución de cancelación')
            item=b.exec_proc_row(cur,BASE+' AND n.NotificacionId=?',(cancellation_id,))
            if not item:raise NotFound('Cancelación no encontrada.')
            if item['estado']!='PENDIENTE':raise Conflict('La cancelación ya fue resuelta.')
            if target=='APROBADA':
                if item['entidad']=='OrdenTrabajo':
                    order=b.exec_proc_row(cur,'SELECT eo.EsFinal AS final FROM srv.OrdenTrabajo o JOIN srv.EstadoOrdenTrabajo eo ON eo.EstadoOrdenTrabajoId=o.EstadoOrdenTrabajoId WHERE o.OrdenTrabajoId=?',(item['entidad_id'],))
                    if not order or order['final']:raise Conflict('La OT ya finalizó. Resuelve la solicitud como rechazada e indica el motivo.')
                    state=b.exec_proc_row(cur,"SELECT EstadoOrdenTrabajoId AS id FROM srv.EstadoOrdenTrabajo WHERE Codigo='CANCELADA' AND Activo=1")
                    if not state:raise Conflict('El catálogo de estados no contiene CANCELADA activa.')
                    b.exec_proc_row(cur,'EXEC srv.usp_AppCambiarEstadoOrden ?,?,?,?',(item['entidad_id'],state['id'],session['usuario_id'],notes))
                else:
                    if b.exec_proc_row(cur,'SELECT TOP 1 OrdenTrabajoId FROM srv.OrdenTrabajo WHERE SolicitudServicioId=?',(item['entidad_id'],)):raise Conflict('La solicitud se convirtió a OT. Resuelve este pedido y gestiona la cancelación de la OT.')
                    cur.execute("UPDATE srv.SolicitudServicio SET Estado='CANCELADA',ActualizadoEn=SYSUTCDATETIME() WHERE SolicitudServicioId=?",item['entidad_id'])
            notify_users(b,cur,[item['solicitante_id']],'CANCELACION_'+target,'Cancelación '+target.lower(),notes,'Cancelacion',cancellation_id)
        b.queue_web_push([item['solicitante_id']],title='Cancelación '+target.lower(),body=notes,role='CLIENTE',entity='Cancelacion',entity_id=cancellation_id)
        if target=='APROBADA' and item['entidad']=='OrdenTrabajo':b.push_order_state_changed(item['entidad_id'],'CANCELADA',session)
        return jsonify(ok=True,message='Resolución guardada.')
