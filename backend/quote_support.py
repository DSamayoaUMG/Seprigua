"""Cotizaciones que pueden preceder a una orden de trabajo."""

from flask import jsonify


_schema_ready = False


def ensure_schema(b):
    """Comprueba el esquema instalado; las migraciones se ejecutan fuera de Flask."""
    global _schema_ready
    if _schema_ready:
        return
    row = b.query_one("""SELECT CASE WHEN COL_LENGTH('cot.Cotizacion','ClienteId') IS NOT NULL
        AND COL_LENGTH('cot.Cotizacion','ProspectoNombre') IS NOT NULL
        AND COL_LENGTH('cot.Cotizacion','ProspectoCorreo') IS NOT NULL
        AND COL_LENGTH('cot.Cotizacion','ProspectoTelefono') IS NOT NULL
        AND COL_LENGTH('cot.Cotizacion','SucursalClienteId') IS NOT NULL
        AND COL_LENGTH('cot.Cotizacion','OrdenFisicaNumero') IS NOT NULL
        AND EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('cot.Cotizacion')
                    AND name='OrdenTrabajoId' AND is_nullable=1)
        THEN 1 ELSE 0 END AS lista""")
    if not row or not row['lista']:
        raise RuntimeError('Esquema de cotizaciones pendiente. Ejecuta la migración 20261101_cotizacion_sede_orden_fisica.sql.')
    _schema_ready = True


def standalone_sets(b, session, quote_id):
    """Mantiene el formato del expediente cuando aún no existe una OT."""
    header = b.query_one("""
        SELECT q.CotizacionId AS cotizacion_id,
               q.NumeroCotizacion AS numero_cotizacion,
               q.NombreCotizacion AS nombre_cotizacion,
               q.Estado AS cotizacion_estado,
               q.ClienteId AS cliente_id,
               COALESCE(cli.NombreComercial,q.ProspectoNombre) AS cliente,
               q.ProspectoNombre AS prospecto_nombre,
               q.ProspectoCorreo AS prospecto_correo,
               q.ProspectoTelefono AS prospecto_telefono,
               CAST(NULL AS bigint) AS orden_id,
               CAST(NULL AS nvarchar(40)) AS numero_orden,
               q.OrdenFisicaNumero AS numero_orden_papel,
               CAST(NULL AS bigint) AS solicitud_id,
               q.SucursalClienteId AS sede_id,
               sc.Nombre AS sede,
               v.VersionCotizacionId AS version_id,
               v.NumeroVersion AS numero_version,
               v.FechaEmision AS fecha_emision,
               v.FechaExpiracion AS fecha_expiracion,
               v.CondicionPago AS condicion_pago,
               v.Moneda AS moneda,v.Subtotal AS subtotal,
               v.DescuentoTotal AS descuento_total,
               v.ImpuestoTotal AS impuesto_total,v.Total AS total,
               v.Estado AS estado_version,v.EnviadaEn AS enviada_en,
               v.RespondidaEn AS respondida_en,
               v.ObservacionesCliente AS observaciones_cliente
        FROM cot.Cotizacion q
        LEFT JOIN crm.Cliente cli ON cli.ClienteId=q.ClienteId
        LEFT JOIN crm.SucursalCliente sc ON sc.SucursalClienteId=q.SucursalClienteId
        LEFT JOIN cot.VersionCotizacion v ON v.CotizacionId=q.CotizacionId AND v.EsActual=1
        WHERE q.CotizacionId=? AND q.OrdenTrabajoId IS NULL
    """, (quote_id,))
    if not header:
        return [], [], []
    if session['rol']=='CLIENTE' and (
        int(header['cliente_id'] or 0)!=int(session.get('cliente_id') or 0)
        or header['cotizacion_estado'] not in {'ENVIADA','OBSERVADA','ACEPTADA','RECHAZADA','ANULADA'}
        or (header['sede_id'] and not b.query_one(
            'SELECT SucursalClienteId FROM seg.ufn_SucursalesPermitidas(?) WHERE SucursalClienteId=?',
            (session['usuario_id'],header['sede_id'])))
    ):
        return [], [], []
    details=b.query_all("""
        SELECT d.DetalleCotizacionId AS detalle_id,d.NumeroLinea AS numero_linea,
               d.TipoArticulo AS tipo_articulo,d.Descripcion AS descripcion,
               d.Cantidad AS cantidad,d.UnidadMedida AS unidad,
               d.PrecioUnitario AS precio_unitario,d.Descuento AS descuento,
               d.PorcentajeImpuesto AS porcentaje_impuesto,
               d.SubtotalLinea AS subtotal_linea,d.MontoImpuesto AS monto_impuesto,
               d.TotalLinea AS total_linea,d.Observaciones AS observaciones
        FROM cot.DetalleCotizacion d
        WHERE d.VersionCotizacionId=? ORDER BY d.NumeroLinea
    """, (header['version_id'],))
    return [header], [], details


def send_standalone(b, session, quote_id):
    with b.get_db_connection() as conn:
        cur=conn.cursor()
        b.set_audit_context(cur,session,'Envío de cotización sin OT')
        cur.execute('SELECT ClienteId FROM cot.Cotizacion WHERE CotizacionId=?',quote_id)
        recipient=cur.fetchone()
        if recipient and recipient[0] is None:
            return jsonify(ok=False,message='Este cliente no tiene portal. Descarga el PDF para compartir la cotización.'),409
        cur.execute("""UPDATE cot.Cotizacion SET Estado='ENVIADA',ActualizadoEn=SYSUTCDATETIME()
            WHERE CotizacionId=? AND OrdenTrabajoId IS NULL
              AND Estado IN ('BORRADOR','CONFIRMADA','OBSERVADA')""",quote_id)
        if cur.rowcount!=1:
            return jsonify(ok=False,message='La cotización no está disponible para envío.'),409
        cur.execute("""UPDATE cot.VersionCotizacion SET Estado='ENVIADA',
            EnviadaEn=COALESCE(EnviadaEn,SYSUTCDATETIME()),ActualizadoEn=SYSUTCDATETIME()
            WHERE CotizacionId=? AND EsActual=1""",quote_id)
        cur.execute("""INSERT INTO com.Notificacion
            (UsuarioId,Tipo,Titulo,Mensaje,Entidad,EntidadId,Canal,Estado)
            SELECT DISTINCT u.UsuarioId,N'COTIZACION',N'Cotización disponible',
                   CONCAT(N'La cotización ',q.NumeroCotizacion,
                       CASE WHEN sc.Nombre IS NOT NULL THEN CONCAT(N' para ',sc.Nombre) ELSE N'' END,
                       CASE WHEN q.OrdenFisicaNumero IS NOT NULL THEN CONCAT(N' · OT física ',q.OrdenFisicaNumero) ELSE N'' END,
                       N' ya está disponible para revisión.'),
                   N'Cotizacion',CONVERT(nvarchar(80),q.CotizacionId),N'SISTEMA',N'PENDIENTE'
            FROM cot.Cotizacion q
            LEFT JOIN crm.SucursalCliente sc ON sc.SucursalClienteId=q.SucursalClienteId
            JOIN crm.ContactoCliente cc ON cc.ClienteId=q.ClienteId AND cc.Activo=1
            JOIN seg.Usuario u ON u.ContactoClienteId=cc.ContactoClienteId AND u.Activo=1
            WHERE q.CotizacionId=? AND (q.SucursalClienteId IS NULL OR EXISTS(
                SELECT 1 FROM seg.ufn_SucursalesPermitidas(u.UsuarioId) p
                WHERE p.SucursalClienteId=q.SucursalClienteId))""",quote_id)
        conn.commit()
    return jsonify(ok=True,message='Cotización enviada al cliente.')


def respond_standalone(b, session, quote_id, response, observation):
    target={'ACEPTADA':'ACEPTADA','CAMBIOS':'OBSERVADA','RECHAZADA':'RECHAZADA'}[response]
    with b.get_db_connection() as conn:
        cur=conn.cursor()
        b.set_audit_context(cur,session,'Respuesta de cotización sin OT')
        cur.execute("""UPDATE cot.Cotizacion SET Estado=?,ActualizadoEn=SYSUTCDATETIME()
            WHERE CotizacionId=? AND OrdenTrabajoId IS NULL AND ClienteId=? AND Estado='ENVIADA'""",
            target,quote_id,session['cliente_id'])
        if cur.rowcount!=1:
            return jsonify(ok=False,message='Cotización no disponible para respuesta.'),409
        cur.execute("""UPDATE cot.VersionCotizacion SET Estado=?,RespondidaEn=SYSUTCDATETIME(),
            ObservacionesCliente=?,ActualizadoEn=SYSUTCDATETIME()
            WHERE CotizacionId=? AND EsActual=1""",target,observation or response,quote_id)
        cur.execute("""INSERT INTO com.Notificacion
            (UsuarioId,Tipo,Titulo,Mensaje,Entidad,EntidadId,Canal,Estado)
            SELECT u.UsuarioId,N'RESPUESTA_COTIZACION',N'Respuesta de cotización',
                   CONCAT(N'La cotización ',q.NumeroCotizacion,N' recibió respuesta: ',?),
                   N'Cotizacion',CONVERT(nvarchar(80),q.CotizacionId),N'SISTEMA',N'PENDIENTE'
            FROM cot.Cotizacion q CROSS JOIN seg.Usuario u
            JOIN seg.Rol r ON r.RolId=u.RolId AND UPPER(r.Nombre)=N'COORDINADOR'
              AND u.Activo=1
            WHERE q.CotizacionId=?""",response,quote_id)
        conn.commit()
    return jsonify(ok=True,message='Respuesta de cotización registrada.',estado=target)
