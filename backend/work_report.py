"""Expediente cronológico compartido por cotizaciones y órdenes de trabajo."""

from datetime import datetime
from io import BytesIO
import json
from threading import Lock
from zipfile import ZIP_DEFLATED, ZipFile

from flask import jsonify, request, send_file
from werkzeug.exceptions import BadRequest, Conflict, NotFound


_arrival_schema_ready = False
_arrival_schema_lock = Lock()


def _arrival_schema(b):
    """Comprueba que la migración controlada instaló el registro de llegadas."""
    global _arrival_schema_ready
    if _arrival_schema_ready:
        return
    with _arrival_schema_lock:
        if _arrival_schema_ready:
            return
        row = b.query_one("SELECT OBJECT_ID(N'srv.RegistroLlegadaOT',N'U') AS id")
        if not row or row['id'] is None:
            raise RuntimeError('Falta srv.RegistroLlegadaOT. Ejecuta la actualización SQL controlada antes de iniciar el portal.')
        _arrival_schema_ready = True


def _event(kind, title, when, detail='', actor=''):
    return {'tipo': kind, 'titulo': title, 'fecha': when,
            'detalle': str(detail or ''), 'actor': str(actor or '')}


def _meta(value):
    try:
        item = json.loads(value or '{}')
        return item if isinstance(item, dict) else {}
    except (TypeError, ValueError):
        return {}


def _time_key(event):
    value = event.get('fecha')
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value or '')


def collect_order_log(b, order_id, *, include_quote=False):
    order = b.query_one("""
        SELECT o.OrdenTrabajoId AS id, o.NumeroOrden AS numero, o.NumeroOrdenPapel AS numero_papel,
               o.CreadoEn AS creada, o.ProgramadaPara AS programada, o.IniciadaEn AS iniciada,
               o.FinalizadaEn AS finalizada, o.CerradaEn AS cerrada,
               eo.Nombre AS estado, eo.Codigo AS estado_codigo,
               s.SolicitudServicioId AS solicitud_id, s.ClienteId AS cliente_id,
               s.CreadoEn AS solicitud_creada,
               s.DescripcionProblema AS solicitud, c.NombreComercial AS cliente,
               sc.Nombre AS sede, ts.Nombre AS servicio
        FROM srv.OrdenTrabajo o
        JOIN srv.EstadoOrdenTrabajo eo ON eo.EstadoOrdenTrabajoId=o.EstadoOrdenTrabajoId
        JOIN srv.SolicitudServicio s ON s.SolicitudServicioId=o.SolicitudServicioId
        JOIN crm.Cliente c ON c.ClienteId=s.ClienteId
        JOIN srv.TipoServicio ts ON ts.TipoServicioId=s.TipoServicioId
        LEFT JOIN crm.UbicacionServicio u ON u.UbicacionServicioId=s.UbicacionServicioId
        LEFT JOIN crm.SucursalCliente sc ON sc.SucursalClienteId=u.SucursalClienteId
        WHERE o.OrdenTrabajoId=?""", (order_id,))
    if not order:
        raise NotFound('Orden de trabajo no encontrada.')
    _arrival_schema(b)
    events = [
        _event('solicitud', 'Solicitud registrada', order['solicitud_creada'], order['solicitud']),
        _event('orden', 'Orden de trabajo registrada', order['creada'], order['numero']),
    ]
    if order.get('programada'):
        events.append(_event('agenda', 'Atención programada', order['creada'],
                             'Fecha prevista: ' + str(order['programada'])))
    if order.get('iniciada'):
        events.append(_event('inicio', 'Trabajo iniciado', order['iniciada']))
    if order.get('finalizada'):
        events.append(_event('fin', 'Trabajo finalizado', order['finalizada']))
    if order.get('cerrada'):
        events.append(_event('cierre', 'OT cerrada', order['cerrada']))

    arrivals = b.query_all("""
        SELECT r.RegistroLlegadaOTId AS id,r.EmpleadoId AS empleado_id,r.LlegadaEn AS fecha,
               r.Observacion AS observacion,
               LTRIM(RTRIM(CONCAT(p.Nombres,N' ',p.Apellidos))) AS tecnico
        FROM srv.RegistroLlegadaOT r JOIN rh.Empleado e ON e.EmpleadoId=r.EmpleadoId
        JOIN rh.Persona p ON p.PersonaId=e.PersonaId
        WHERE r.OrdenTrabajoId=? ORDER BY r.LlegadaEn""", (order_id,))
    for item in arrivals:
        events.append(_event('llegada', 'Llegada al sitio', item['fecha'],
                             item.get('observacion'), item.get('tecnico')))
    departures = b.query_all("""
        SELECT u.EmpleadoId AS empleado_id,n.CreadaEn AS fecha,
               LTRIM(RTRIM(CONCAT(p.Nombres,N' ',p.Apellidos))) AS tecnico
        FROM com.Notificacion n JOIN seg.Usuario u ON u.UsuarioId=n.UsuarioId
        JOIN rh.Empleado e ON e.EmpleadoId=u.EmpleadoId
        JOIN rh.Persona p ON p.PersonaId=e.PersonaId
        WHERE n.Entidad='OrdenTrabajo' AND TRY_CONVERT(bigint,n.EntidadId)=?
          AND n.Tipo='OT_SALIDA_REGISTRO' ORDER BY n.CreadaEn""", (order_id,))
    for item in departures:
        events.append(_event('trayecto', 'Cuadrilla en camino', item['fecha'],
                             'Técnico en traslado al sitio', item.get('tecnico')))

    history = b.query_all("""
        SELECT h.FechaCambio AS fecha, ea.Nombre AS anterior, en.Nombre AS nuevo,
               h.Comentario AS comentario, u.NombreUsuario AS actor
        FROM srv.HistorialEstadoOrden h
        LEFT JOIN srv.EstadoOrdenTrabajo ea ON ea.EstadoOrdenTrabajoId=h.EstadoAnteriorId
        JOIN srv.EstadoOrdenTrabajo en ON en.EstadoOrdenTrabajoId=h.EstadoNuevoId
        LEFT JOIN seg.Usuario u ON u.UsuarioId=h.CambiadoPorUsuarioId
        WHERE h.OrdenTrabajoId=? ORDER BY h.FechaCambio""", (order_id,))
    for item in history:
        events.append(_event('estado', 'Estado de OT: ' + str(item['nuevo']), item['fecha'],
                             ((str(item['anterior']) + ' → ') if item.get('anterior') else '') +
                             str(item['nuevo']) + ((' · ' + str(item['comentario'])) if item.get('comentario') else ''),
                             item.get('actor')))

    activities = b.query_all("""
        SELECT a.ActividadServicioId AS id,a.Descripcion AS descripcion,a.Resultado AS resultado,
               a.RealizadaEn AS fecha,LTRIM(RTRIM(CONCAT(p.Nombres,N' ',p.Apellidos))) AS tecnico
        FROM srv.ActividadServicio a JOIN rh.Empleado e ON e.EmpleadoId=a.EmpleadoId
        JOIN rh.Persona p ON p.PersonaId=e.PersonaId
        WHERE a.OrdenTrabajoId=? ORDER BY a.RealizadaEn,a.ActividadServicioId""", (order_id,))
    for item in activities:
        events.append(_event('actividad', 'Trabajo registrado', item['fecha'],
                             item.get('descripcion'), item.get('tecnico')))

    evidences = b.query_all("""
        SELECT e.EvidenciaServicioId AS id,e.Categoria AS categoria,e.Etapa AS etapa,
               e.TipoArchivo AS tipo,e.TipoMime AS mime,e.NombreArchivo AS nombre,
               e.Descripcion AS descripcion,e.CreadoEn AS fecha
        FROM srv.EvidenciaServicio e
        WHERE e.OrdenTrabajoId=? OR e.SolicitudServicioId=?
        ORDER BY e.CreadoEn,e.EvidenciaServicioId""", (order_id, order['solicitud_id']))
    safe_categories = {'FOTO_TRABAJO', 'ORDEN_FISICA', 'FIRMA', 'SELLO', 'REFERENCIA_CLIENTE'}
    evidences = [e for e in evidences if str(e.get('categoria') or '').upper() in safe_categories]
    for item in evidences:
        item['ruta'] = f"/api/archivos/evidencia/{int(item['id'])}"
        events.append(_event('evidencia', 'Evidencia: ' + str(item.get('categoria') or 'Archivo'),
                             item['fecha'], item.get('descripcion') or item.get('nombre')))

    warranty = []
    incidents = b.query_all("""
        SELECT IncidenciaOrdenId AS id,Descripcion AS descripcion,AccionTomada AS accion,
               Estado AS estado,ReportadaEn AS reportada,ResueltaEn AS resuelta
        FROM srv.IncidenciaOrden WHERE OrdenTrabajoId=? ORDER BY ReportadaEn,IncidenciaOrdenId""",
        (order_id,))
    for item in incidents:
        meta = _meta(item.get('accion'))
        kind = str(meta.get('portal_tipo') or '')
        if kind == 'garantia_solicitud':
            case = {'id': item['id'], 'estado': meta.get('estado') or item['estado'],
                    'descripcion': item.get('descripcion'), 'reportada': item['reportada'],
                    'resuelta': item.get('resuelta'), 'aplica': meta.get('aplica_garantia'),
                    'sin_cobro': bool(meta.get('sin_cobro')),
                    'revision_orden_id': meta.get('revision_orden_id'),
                    'orden_cobro_id': meta.get('orden_cobro_id')}
            warranty.append(case)
            events.append(_event('garantia', 'Revisión de garantía solicitada', item['reportada'], item.get('descripcion')))
            if item.get('resuelta'):
                events.append(_event('garantia', 'Garantía: ' + str(case['estado']),
                                     item['resuelta'], meta.get('respuesta') or meta.get('resultado_revision')))
        elif kind == 'REPROGRAMACION_OT':
            events.append(_event('agenda', 'Reprogramación solicitada', item['reportada'], item.get('descripcion')))
            if item.get('resuelta'):
                events.append(_event('agenda', 'Reprogramación: ' + str(item['estado']),
                                     item['resuelta'], meta.get('decision')))
    followup_ids = sorted({int(value) for case in warranty
                           for value in (case.get('revision_orden_id'), case.get('orden_cobro_id'))
                           if value})
    followup_orders = []
    if followup_ids:
        placeholders = ','.join('?' for _ in followup_ids)
        followup_orders = b.query_all(f"""
            SELECT o.OrdenTrabajoId AS id,o.NumeroOrden AS numero,o.CreadoEn AS creada,
                   o.IniciadaEn AS iniciada,o.FinalizadaEn AS finalizada,
                   e.Nombre AS estado
            FROM srv.OrdenTrabajo o
            JOIN srv.SolicitudServicio s ON s.SolicitudServicioId=o.SolicitudServicioId
            JOIN srv.EstadoOrdenTrabajo e ON e.EstadoOrdenTrabajoId=o.EstadoOrdenTrabajoId
            WHERE s.ClienteId=? AND o.OrdenTrabajoId IN ({placeholders})
        """, (order['cliente_id'], *followup_ids))
        for item in followup_orders:
            events.append(_event('garantia', 'OT de seguimiento registrada', item['creada'], item['numero']))
            if item.get('iniciada'):
                events.append(_event('garantia', 'Atención de garantía iniciada',
                                     item['iniciada'], item['numero']))
            if item.get('finalizada'):
                events.append(_event('garantia', 'Atención de garantía finalizada',
                                     item['finalizada'], item['numero']))
    events = [e for e in events if e.get('fecha')]
    events.sort(key=_time_key)
    return {'orden': order, 'eventos': events, 'llegadas': arrivals, 'salidas': departures,
            'actividades': activities, 'evidencias': evidences, 'garantias': warranty,
            'ordenes_garantia': followup_orders}


def collect_quote_report(b, session, quote_id):
    # El vínculo y el estado se comprueban antes de consultar precios o evidencias.
    quote = b.query_one("""
        SELECT q.CotizacionId AS id,q.NumeroCotizacion AS numero,q.NombreCotizacion AS nombre,
               q.ClienteId AS cliente_id,q.ProspectoNombre AS prospecto,
               q.Estado AS estado,q.CreadoEn AS creada,q.ActualizadoEn AS actualizada,
               q.OrdenTrabajoId AS orden_id,q.SucursalClienteId AS sede_id,
               q.OrdenFisicaNumero AS orden_fisica_numero,sc.Nombre AS sede,
               COALESCE(c.NombreComercial,q.ProspectoNombre) AS cliente
        FROM cot.Cotizacion q LEFT JOIN crm.Cliente c ON c.ClienteId=q.ClienteId
        LEFT JOIN crm.SucursalCliente sc ON sc.SucursalClienteId=q.SucursalClienteId
        WHERE q.CotizacionId=?""", (quote_id,))
    if not quote:
        raise NotFound('Cotización no encontrada.')
    if session['rol'] == 'CLIENTE':
        if int(quote.get('cliente_id') or 0) != int(session.get('cliente_id') or 0) or quote['estado'] not in {
                'ENVIADA', 'OBSERVADA', 'ACEPTADA', 'RECHAZADA', 'ANULADA'}:
            raise NotFound('Cotización no encontrada.')
        if quote.get('orden_id'):
            b.assert_order_access(session, int(quote['orden_id']))
        elif quote.get('sede_id') and not b.query_one(
                'SELECT SucursalClienteId FROM seg.ufn_SucursalesPermitidas(?) WHERE SucursalClienteId=?',
                (session['usuario_id'], quote['sede_id'])):
            raise NotFound('Cotización no encontrada.')
    versions = b.query_all("""
        SELECT v.VersionCotizacionId AS id,v.NumeroVersion AS numero,v.Estado AS estado,
               v.CreadoEn AS creada,v.FechaEmision AS emision,v.FechaExpiracion AS expiracion,
               v.EnviadaEn AS enviada,v.RespondidaEn AS respondida,
               v.MotivoCambio AS motivo,v.ObservacionesCliente AS respuesta,
               v.CondicionPago AS condicion_pago,v.Subtotal AS subtotal,
               v.DescuentoTotal AS descuento,v.ImpuestoTotal AS impuesto,
               v.Total AS total,v.Moneda AS moneda,v.EsActual AS actual
        FROM cot.VersionCotizacion v WHERE v.CotizacionId=? ORDER BY v.NumeroVersion""", (quote_id,))
    current = next((v for v in versions if v['actual']), versions[-1] if versions else None)
    lines = b.query_all("""
        SELECT d.NumeroLinea AS numero,d.TipoArticulo AS tipo,d.Descripcion AS descripcion,
               d.Cantidad AS cantidad,d.UnidadMedida AS unidad,d.PrecioUnitario AS precio,
               d.Descuento AS descuento,d.PorcentajeImpuesto AS impuesto,
               d.TotalLinea AS total
        FROM cot.DetalleCotizacion d WHERE d.VersionCotizacionId=? ORDER BY d.NumeroLinea""",
        (current['id'],)) if current else []
    events = [_event('cotizacion', 'Cotización registrada', quote['creada'], quote['numero'])]
    for version in versions:
        events.append(_event('cotizacion', 'Versión ' + str(version['numero']) + ' registrada',
                             version['creada'], version.get('motivo')))
        if version.get('enviada'):
            events.append(_event('cotizacion', 'Versión ' + str(version['numero']) + ' enviada', version['enviada']))
        if version.get('respondida'):
            events.append(_event('cotizacion', 'Versión ' + str(version['numero']) + ': ' + str(version['estado']),
                                 version['respondida'], version.get('respuesta')))
    if quote.get('actualizada') and quote['estado'] in {'ANULADA','RECHAZADA'}:
        events.append(_event('cotizacion', 'Cotización: ' + str(quote['estado']), quote['actualizada']))
    work = collect_order_log(b, int(quote['orden_id']), include_quote=True) if quote.get('orden_id') else None
    if work:
        events += work['eventos']
    events = [e for e in events if e.get('fecha')]
    events.sort(key=_time_key)
    documents = [{'titulo': 'Cotización actual', 'tipo': 'pdf',
                  'ruta': f'/api/cotizaciones/{quote_id}/pdf'}]
    if work:
        documents.append({'titulo': 'Reporte de la OT', 'tipo': 'pdf',
                          'ruta': f"/api/ordenes/{work['orden']['id']}/reporte.pdf"})
        for e in work['evidencias']:
            if str(e.get('categoria') or '').upper() in {'ORDEN_FISICA', 'FIRMA', 'SELLO'}:
                documents.append({'titulo': e.get('nombre') or 'Documento firmado',
                                  'tipo': e.get('tipo') or 'archivo', 'ruta': e['ruta'],
                                  'categoria': e.get('categoria')})
        for followup in work['ordenes_garantia']:
            documents.append({'titulo': 'Reporte de seguimiento ' + str(followup['numero']),
                              'tipo': 'pdf',
                              'ruta': f"/api/ordenes/{int(followup['id'])}/reporte.pdf"})
    return {'cotizacion': quote, 'version': current, 'versiones': versions,
            'lineas': lines, 'orden': work['orden'] if work else None,
            'llegadas': work['llegadas'] if work else [],
            'salidas': work['salidas'] if work else [],
            'actividades': work['actividades'] if work else [],
            'evidencias': work['evidencias'] if work else [],
            'garantias': work['garantias'] if work else [],
            'ordenes_garantia': work['ordenes_garantia'] if work else [],
            'documentos': documents, 'eventos': events}


def _image_data(b, order_id, ids):
    if not order_id or not ids:
        return []
    wanted = [int(value) for value in ids[:4]]
    placeholders = ','.join('?' for _ in wanted)
    rows = b.query_all(f"""
        SELECT e.EvidenciaServicioId AS id,e.NombreArchivo AS nombre,e.TipoMime AS mime,
               e.RutaArchivo AS ruta,a.Contenido AS contenido
        FROM srv.EvidenciaServicio e LEFT JOIN srv.ArchivoEvidencia a ON a.EvidenciaServicioId=e.EvidenciaServicioId
        WHERE e.OrdenTrabajoId=? AND e.EvidenciaServicioId IN ({placeholders})
          AND e.Categoria IN ('ORDEN_FISICA','FIRMA','SELLO')
    """, (order_id, *wanted))
    images = []
    for row in rows:
        if str(row.get('mime') or '').lower() not in {'image/jpeg','image/png','image/webp'}:
            continue
        content = bytes(row['contenido']) if row.get('contenido') is not None else None
        if content is None:
            path = b.resolve_evidence_path(row.get('ruta'))
            if path and path.is_file():
                content = path.read_bytes()
        if content and len(content) <= 10 * 1024 * 1024:
            images.append({'nombre': row['nombre'], 'contenido': content})
    return images


def _collage_data(b, order):
    """Genera el mismo collage de la OT para incluirlo en el expediente PDF."""
    if not order:
        return None
    if __package__:
        from .collages import build_order_collage
    else:
        from collages import build_order_collage
    rows = b.query_all("""
        ;WITH E AS (
          SELECT e.EvidenciaServicioId,e.NombreArchivo,e.RutaArchivo,e.Etapa,e.Descripcion,
                 e.IncluirEnCollage,e.OrdenCollage,e.TomadaEn,e.CreadoEn,a.Contenido,
                 ROW_NUMBER() OVER(PARTITION BY COALESCE(e.Etapa,''),
                   COALESCE(CONVERT(varchar(64),a.HashSha256,2),CONCAT('ID:',e.EvidenciaServicioId))
                   ORDER BY e.EvidenciaServicioId) AS rn
          FROM srv.EvidenciaServicio e
          LEFT JOIN srv.ArchivoEvidencia a ON a.EvidenciaServicioId=e.EvidenciaServicioId
          WHERE e.OrdenTrabajoId=? AND e.Categoria='FOTO_TRABAJO' AND e.TipoArchivo='FOTO'
        )
        SELECT EvidenciaServicioId,NombreArchivo,RutaArchivo,Etapa,Descripcion,
               IncluirEnCollage,OrdenCollage,TomadaEn,CreadoEn,Contenido
        FROM E WHERE rn=1
        ORDER BY CASE UPPER(COALESCE(Etapa,'')) WHEN 'ANTES' THEN 0 WHEN 'DURANTE' THEN 1
                      WHEN 'DESPUES' THEN 2 ELSE 3 END,
                 COALESCE(OrdenCollage,32767),EvidenciaServicioId
    """, (int(order['id']),))
    if not rows:
        return None
    collage_order = {'numero': order.get('numero'), 'cliente': order.get('cliente'),
                     'tipo': order.get('servicio'), 'sede': order.get('sede')}
    try:
        return build_order_collage(rows, collage_order, legacy_resolver=b.resolve_evidence_path)
    except ValueError:
        return None


def register_work_report(b):
    app = b.app
    auth = b.require_session

    @app.get('/api/ordenes/<int:orden_id>/seguimiento')
    @auth('COORDINADOR','TECNICO','CLIENTE')
    def order_timeline(session, orden_id):
        try:
            b.assert_order_access(session, orden_id)
            result = collect_order_log(b, orden_id)
            result.pop('actividades', None)
            result.pop('evidencias', None)
            return jsonify(ok=True, **result)
        except Exception as exc:
            return b.app_error(exc, 'No fue posible cargar el seguimiento de la OT.')

    def assigned_active_technician(session, order_id):
        b.assert_order_access(session, order_id)
        state = b.query_one("""SELECT e.Codigo AS codigo FROM srv.OrdenTrabajo o
            JOIN srv.EstadoOrdenTrabajo e ON e.EstadoOrdenTrabajoId=o.EstadoOrdenTrabajoId
            WHERE o.OrdenTrabajoId=?""", (order_id,))
        if not state or state['codigo'] not in {'PENDIENTE','PROGRAMADA','EN_PROCESO'}:
            raise Conflict('La OT no está activa.')
        assigned = b.query_one("""SELECT TOP 1 1 AS ok FROM srv.TecnicoOrden
            WHERE OrdenTrabajoId=? AND EmpleadoId=? AND Estado IN ('ASIGNADO','CONFIRMADO')""",
            (order_id, session.get('empleado_id') or -1))
        if not assigned:
            raise NotFound('La orden no está asignada a este técnico.')

    def client_notice(session, order_id, event, title, message, tag):
        if __package__:
            from .notifications import notify_users
        else:
            from notifications import notify_users
        recipients = b._client_user_ids_for_order(order_id)
        if not recipients:
            return
        with b.get_db_connection() as conn:
            notify_users(b, conn.cursor(), recipients, event, title, message,
                         'OrdenTrabajo', order_id)
            conn.commit()
        b.queue_web_push(recipients, title=title, body=message, role='CLIENTE',
                         entity='OrdenTrabajo', entity_id=order_id, tag=tag)

    @app.post('/api/ordenes/<int:orden_id>/en-camino')
    @auth('TECNICO')
    def register_departure(session, orden_id):
        try:
            _arrival_schema(b)
            assigned_active_technician(session, orden_id)
            with b.get_db_connection() as conn:
                cur = conn.cursor()
                b.set_audit_context(cur, session, 'Salida hacia la OT')
                cur.execute("""INSERT INTO com.Notificacion
                    (UsuarioId,Tipo,Titulo,Mensaje,Entidad,EntidadId,Canal,Estado)
                    SELECT ?,N'OT_SALIDA_REGISTRO',N'Salida hacia la OT',
                           N'Salida registrada por el técnico.',N'OrdenTrabajo',CONVERT(nvarchar(80),?),
                           N'SISTEMA',N'LEIDA'
                    WHERE NOT EXISTS (SELECT 1 FROM com.Notificacion WITH (UPDLOCK,HOLDLOCK)
                        WHERE UsuarioId=? AND Tipo=N'OT_SALIDA_REGISTRO'
                          AND Entidad=N'OrdenTrabajo' AND TRY_CONVERT(bigint,EntidadId)=?)""",
                            session['usuario_id'], orden_id, session['usuario_id'], orden_id)
                cur.execute('SELECT @@ROWCOUNT AS creadas')
                created = bool(cur.fetchone()[0])
                conn.commit()
            if created:
                client_notice(session, orden_id, 'OT_EN_CAMINO', 'Cuadrilla en camino',
                              'La cuadrilla salió hacia tu sede.', f'ot-{orden_id}-en-camino')
            return jsonify(ok=True, message='Salida registrada.', creada=created)
        except Exception as exc:
            return b.app_error(exc, 'No fue posible registrar la salida.')

    @app.post('/api/ordenes/<int:orden_id>/llegada')
    @auth('TECNICO')
    def register_arrival(session, orden_id):
        try:
            _arrival_schema(b)
            assigned_active_technician(session, orden_id)
            note = str((request.get_json(silent=True) or {}).get('observacion') or '').strip()[:400] or None
            with b.get_db_connection() as conn:
                cur = conn.cursor()
                b.set_audit_context(cur, session, 'Registro de llegada al sitio')
                cur.execute("""
                    IF NOT EXISTS (SELECT 1 FROM srv.RegistroLlegadaOT WITH (UPDLOCK,HOLDLOCK)
                                   WHERE OrdenTrabajoId=? AND EmpleadoId=?)
                    INSERT INTO srv.RegistroLlegadaOT(OrdenTrabajoId,EmpleadoId,UsuarioId,Observacion)
                    VALUES(?,?,?,?)
                """, orden_id, session['empleado_id'], orden_id, session['empleado_id'],
                    session['usuario_id'], note)
                cur.execute('SELECT @@ROWCOUNT AS creadas')
                created = bool(cur.fetchone()[0])
                conn.commit()
            if created:
                client_notice(session, orden_id, 'OT_LLEGADA', 'Cuadrilla en el sitio',
                              'La cuadrilla llegó a tu sede y espera confirmación para iniciar.',
                              f'ot-{orden_id}-llegada')
            item = b.query_one("""SELECT LlegadaEn AS fecha FROM srv.RegistroLlegadaOT
                WHERE OrdenTrabajoId=? AND EmpleadoId=?""", (orden_id, session['empleado_id']))
            return jsonify(ok=True, message='Llegada registrada.', item=item, creada=created)
        except Exception as exc:
            return b.app_error(exc, 'No fue posible registrar la llegada.')

    @app.get('/api/cotizaciones/<int:cotizacion_id>/reporte-trabajo')
    @auth('COORDINADOR','CLIENTE')
    def quote_work_report(session, cotizacion_id):
        try:
            return jsonify(ok=True, **collect_quote_report(b, session, cotizacion_id))
        except Exception as exc:
            return b.app_error(exc, 'No fue posible cargar el reporte de trabajo.')

    @app.get('/api/cotizaciones/<int:cotizacion_id>/reporte-trabajo.pdf')
    @auth('COORDINADOR','CLIENTE')
    def quote_work_report_pdf(session, cotizacion_id):
        try:
            if __package__:
                from .work_report_pdf import build_work_report_pdf
            else:
                from work_report_pdf import build_work_report_pdf
            data = collect_quote_report(b, session, cotizacion_id)
            evidence_ids = [e['id'] for e in data['evidencias']
                            if str(e.get('categoria') or '').upper() in {'ORDEN_FISICA','FIRMA','SELLO'}]
            images = _image_data(b, data['orden']['id'] if data['orden'] else None, evidence_ids)
            collage = _collage_data(b, data['orden'])
            result = build_work_report_pdf(data, images, collage)
            safe = ''.join(c if c.isalnum() or c in '-_.' else '_' for c in str(data['cotizacion']['numero']))[:90]
            return send_file(result, mimetype='application/pdf', as_attachment=True,
                             download_name=f'Reporte-trabajo-{safe}.pdf', max_age=0)
        except Exception as exc:
            return b.app_error(exc, 'No fue posible generar el reporte de trabajo.')

    @app.get('/api/cotizaciones/<int:cotizacion_id>/entrega.zip')
    @auth('COORDINADOR','CLIENTE')
    def quote_delivery_package(session, cotizacion_id):
        """Arma únicamente los entregables elegidos; la OT física es una tarea en papel."""
        try:
            data = collect_quote_report(b, session, cotizacion_id)
            selected = set(request.args.getlist('incluir'))
            allowed = {'cotizacion','ot_digital','fotos','reporte_mensual','ot_fisica'}
            if not selected or not selected <= allowed:
                raise BadRequest('Selecciona al menos un entregable válido.')
            if 'reporte_mensual' in selected and session['rol'] != 'COORDINADOR':
                raise NotFound('Este reporte mensual solo está disponible para Coordinación.')
            if {'ot_digital','fotos'} & selected and not data.get('orden'):
                raise BadRequest('La cotización aún no tiene una OT vinculada.')
            if __package__:
                from .work_report_pdf import build_work_report_pdf
                from .coralsa_report import build_monthly_coralsa_report
            else:
                from work_report_pdf import build_work_report_pdf
                from coralsa_report import build_monthly_coralsa_report
            safe = ''.join(c if c.isalnum() or c in '-_.' else '_' for c in
                           str(data['cotizacion']['numero']))[:80]
            generated = []
            notes = [f'Entrega SEPRIGUA · {data["cotizacion"]["numero"]}',
                     f'Cliente: {data["cotizacion"].get("cliente") or "Sin nombre"}', '']
            if 'cotizacion' in selected:
                summary, _evidence, details = b._cotizacion_expediente_sets(session, cotizacion_id)
                if not summary:
                    raise NotFound('Cotización no disponible para descarga.')
                generated.append((b.quote_pdf_filename(summary[0], cotizacion_id), b._build_quote_pdf(summary[0], details).getvalue()))
            if 'ot_digital' in selected:
                order = data['orden']
                ids = [e['id'] for e in data['evidencias'] if
                       str(e.get('categoria') or '').upper() in {'ORDEN_FISICA','FIRMA','SELLO'}]
                pdf = build_work_report_pdf(data, _image_data(b, order['id'], ids),
                                            _collage_data(b, order))
                generated.append((f'OT-digital-completa-{safe}.pdf', pdf.getvalue()))
                if not ids:
                    notes.append('La OT digital no tiene firma u OT firmada cargada; revisar antes de entregar.')
            if 'fotos' in selected:
                collage = _collage_data(b, data['orden'])
                if collage:
                    generated.append((f'Fotografias-{safe}.jpg', collage.getvalue()))
                else:
                    notes.append('No hay fotografías de trabajo para la OT; no se incluyó collage.')
            if 'reporte_mensual' in selected:
                value = str(request.args.get('mes') or '').strip()
                try:
                    year, month = (int(x) for x in value.split('-'))
                    if not (2020 <= year <= 2100 and 1 <= month <= 12):
                        raise ValueError()
                except (TypeError, ValueError):
                    raise BadRequest('Selecciona un mes válido para el reporte Coralsa.')
                workbook, count = build_monthly_coralsa_report(b, year, month)
                generated.append((f'Coralsa-reporte-mensual-{year}-{month:02d}.xlsx', workbook.getvalue()))
                notes.append(f'Reporte Coralsa: {count} OT registradas en {month:02d}/{year}.')
            if 'ot_fisica' in selected:
                notes.append('OT FÍSICA ORIGINAL: entregar el documento en papel. No está en este ZIP.')
            if not generated and 'ot_fisica' not in selected:
                raise BadRequest('No hay archivos disponibles para esta selección.')
            out = BytesIO()
            with ZipFile(out, 'w', compression=ZIP_DEFLATED, compresslevel=6) as archive:
                for name, content in generated:
                    archive.writestr(name, content)
                archive.writestr('LEER-ENTREGA.txt', '\n'.join(notes) + '\n')
            out.seek(0)
            return send_file(out, mimetype='application/zip', as_attachment=True,
                             download_name=f'Entrega-{safe}.zip', max_age=0)
        except Exception as exc:
            return b.app_error(exc, 'No fue posible generar el paquete de entrega.')

