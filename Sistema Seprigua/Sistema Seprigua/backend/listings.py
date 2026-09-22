"""Consultas parametrizadas sobre el esquema vigente, con filtros y paginación."""
from datetime import date,timedelta
from flask import request,jsonify
SPECS = {'solicitudes': {'sql': 'SELECT s.SolicitudServicioId AS id,c.NombreComercial AS cliente,\n'
                        "           COALESCE(sc.Nombre,u.NombreReferencia,N'Sin sede') AS sede,ts.Nombre AS "
                        'tipo,\n'
                        '           s.CanalRecepcion AS canal,s.Clasificacion,s.NivelUrgencia AS urgencia,\n'
                        '           s.DescripcionProblema AS descripcion,s.FechaPreferida AS '
                        'fecha_preferida,\n'
                        '           s.Estado,s.Observaciones,s.CreadoEn AS creada,\n'
                        '           ot.OrdenTrabajoId AS orden_id,ot.NumeroOrden AS orden_numero,\n'
                        '           ot.EstadoOrden AS orden_estado,ot.CodigoEstadoOrden AS '
                        'orden_estado_codigo,\n'
                        '           ot.CreadoEn AS orden_creada,q.CotizacionId AS cotizacion_id,\n'
                        '           q.NumeroCotizacion AS cotizacion_numero,q.EstadoCotizacion AS '
                        'cotizacion_estado,\n'
                        '           q.TotalCotizacion AS cotizacion_total,q.MonedaCotizacion AS '
                        'cotizacion_moneda\n'
                        '    FROM srv.SolicitudServicio s\n'
                        '    INNER JOIN crm.Cliente c ON c.ClienteId=s.ClienteId\n'
                        '    LEFT JOIN crm.UbicacionServicio u ON '
                        'u.UbicacionServicioId=s.UbicacionServicioId\n'
                        '    LEFT JOIN crm.SucursalCliente sc ON sc.SucursalClienteId=u.SucursalClienteId\n'
                        '    INNER JOIN srv.TipoServicio ts ON ts.TipoServicioId=s.TipoServicioId\n'
                        '    OUTER APPLY (SELECT TOP(1) o.OrdenTrabajoId,o.NumeroOrden,o.CreadoEn,eo.Nombre '
                        'EstadoOrden,eo.Codigo CodigoEstadoOrden\n'
                        '                 FROM srv.OrdenTrabajo o INNER JOIN srv.EstadoOrdenTrabajo eo ON '
                        'eo.EstadoOrdenTrabajoId=o.EstadoOrdenTrabajoId\n'
                        '                 WHERE o.SolicitudServicioId=s.SolicitudServicioId ORDER BY '
                        'o.OrdenTrabajoId DESC) ot\n'
                        '    OUTER APPLY (SELECT TOP(1) cq.CotizacionId,cq.NumeroCotizacion,cq.Estado '
                        'EstadoCotizacion,vc.Total TotalCotizacion,vc.Moneda MonedaCotizacion\n'
                        '                 FROM cot.Cotizacion cq LEFT JOIN cot.VersionCotizacion vc ON '
                        'vc.CotizacionId=cq.CotizacionId AND vc.EsActual=1\n'
                        "                 WHERE cq.OrdenTrabajoId=ot.OrdenTrabajoId AND (@Rol=N'COORDINADOR' "
                        "OR cq.Estado NOT IN ('BORRADOR','ANULADA')) ORDER BY cq.CotizacionId DESC) q\n"
                        "    WHERE @Rol=N'COORDINADOR' OR s.ClienteId=@ClienteId",
                 'columns': ['id',
                             'cliente',
                             'sede',
                             'tipo',
                             'descripcion',
                             'estado',
                             'urgencia',
                             'clasificacion'],
                 'date': 'creada',
                 'status': 'estado'},
 'ordenes': {'sql': 'SELECT o.OrdenTrabajoId AS id,o.NumeroOrden AS numero,c.NombreComercial AS cliente,\n'
                    "           COALESCE(sc.Nombre,ub.NombreReferencia,N'Sin sede') AS sede,ts.Nombre AS "
                    'tipo,\n'
                    '           eo.Codigo AS estado_codigo,eo.Nombre AS estado,o.Prioridad,s.Clasificacion AS clasificacion,o.ProgramadaPara '
                    'AS programada,\n'
                    '           o.IniciadaEn AS iniciada,o.FinalizadaEn AS finalizada,o.CreadoEn AS creada,\n'
                    "           (SELECT TOP(1) tx.AsignadoEn FROM srv.TecnicoOrden tx WHERE tx.OrdenTrabajoId=o.OrdenTrabajoId AND tx.EmpleadoId=@EmpleadoId AND tx.Estado IN ('ASIGNADO','CONFIRMADO','FINALIZADO') ORDER BY tx.AsignadoEn) AS asignado_en\n"
                    '    FROM srv.OrdenTrabajo o\n'
                    '    INNER JOIN srv.EstadoOrdenTrabajo eo ON '
                    'eo.EstadoOrdenTrabajoId=o.EstadoOrdenTrabajoId\n'
                    '    INNER JOIN srv.SolicitudServicio s ON s.SolicitudServicioId=o.SolicitudServicioId\n'
                    '    INNER JOIN crm.Cliente c ON c.ClienteId=s.ClienteId\n'
                    '    LEFT JOIN crm.UbicacionServicio ub ON ub.UbicacionServicioId=s.UbicacionServicioId\n'
                    '    LEFT JOIN crm.SucursalCliente sc ON sc.SucursalClienteId=ub.SucursalClienteId\n'
                    '    INNER JOIN srv.TipoServicio ts ON ts.TipoServicioId=s.TipoServicioId\n'
                    "    WHERE @Rol=N'COORDINADOR'\n"
                    "       OR (@Rol=N'CLIENTE' AND s.ClienteId=@ClienteId)\n"
                    "       OR (@Rol=N'TECNICO' AND EXISTS(SELECT 1 FROM srv.TecnicoOrden t WHERE "
                    't.OrdenTrabajoId=o.OrdenTrabajoId AND t.EmpleadoId=@EmpleadoId AND t.Estado '
                    "IN('ASIGNADO','CONFIRMADO','FINALIZADO')))",
             'columns': ['id', 'numero', 'cliente', 'sede', 'tipo', 'estado', 'prioridad', 'clasificacion'],
             'date': 'creada',
             'status': 'estado_codigo'},
 'clientes': {'sql': 'SELECT c.ClienteId AS id,c.CodigoCliente AS codigo,c.NombreComercial AS nombre,c.Nit '
                     'AS nit,\n'
                     '           c.TelefonoPrincipal AS telefono,c.CorreoPrincipal AS correo,c.Activo AS '
                     'activo,\n'
                     '           (SELECT COUNT_BIG(*) FROM crm.SucursalCliente s WHERE '
                     's.ClienteId=c.ClienteId) AS sedes,\n'
                     '           (SELECT COUNT_BIG(*) FROM crm.ContactoCliente cc WHERE '
                     'cc.ClienteId=c.ClienteId) AS contactos,\n'
                     '           (SELECT COUNT_BIG(*) FROM srv.SolicitudServicio ss WHERE '
                     'ss.ClienteId=c.ClienteId) AS solicitudes\n'
                     '    FROM crm.Cliente c',
              'columns': ['id', 'codigo', 'nombre', 'nit', 'telefono', 'correo'],
              'date': '',
              'status': ''},
 'personal': {'sql': "SELECT e.EmpleadoId AS id,e.CodigoEmpleado AS codigo,LTRIM(RTRIM(CONCAT(p.Nombres,N' "
                     "',p.Apellidos))) AS nombre,\n"
                     '           pu.Nombre AS puesto,e.EstadoLaboral AS estado,e.Disponibilidad AS '
                     'disponibilidad,p.TelefonoPrincipal AS telefono,\n'
                     '           p.Correo AS correo\n'
                     '    FROM rh.Empleado e INNER JOIN rh.Persona p ON p.PersonaId=e.PersonaId INNER JOIN '
                     'rh.Puesto pu ON pu.PuestoId=e.PuestoId',
              'columns': ['id',
                          'codigo',
                          'nombre',
                          'puesto',
                          'estado',
                          'disponibilidad',
                          'telefono',
                          'correo'],
              'date': '',
              'status': 'estado'},
 'equipos': {'sql': 'SELECT e.EquipoId AS id,e.CodigoEquipo AS codigo,e.Nombre AS nombre,e.Categoria AS '
                    'categoria,e.Marca AS marca,e.Modelo AS modelo,\n'
                    '           e.NumeroSerie AS serie,e.FechaAdquisicion AS fecha_adquisicion,e.Estado AS '
                    'estado,e.UbicacionGeneral AS ubicacion,\n'
                    '           e.Descripcion AS descripcion,e.Activo AS activo,\n'
                    '           (SELECT COUNT_BIG(*) FROM eqp.FallaEquipo f WHERE f.EquipoId=e.EquipoId AND '
                    "f.Estado NOT IN ('CERRADA','CORREGIDA','DESCARTADA')) AS fallas_abiertas\n"
                    '    FROM eqp.Equipo e',
             'columns': ['id', 'codigo', 'nombre', 'categoria', 'marca', 'modelo', 'serie', 'estado'],
             'date': '',
             'status': 'estado'},
 'mantenimientos': {'sql': 'SELECT m.MantenimientoEquipoId AS id,e.EquipoId AS equipo_id,e.CodigoEquipo AS '
                           'codigo_equipo,e.Nombre AS equipo,\n'
                           '           m.TipoMantenimiento AS tipo,m.Estado AS estado,m.FechaProgramada AS '
                           'programada,m.Diagnostico AS diagnostico,\n'
                           '           m.TrabajoRequerido AS trabajo_requerido,m.IniciadoEn AS '
                           'iniciado,m.FinalizadoEn AS finalizado,\n'
                           '           m.ResultadoPrueba AS resultado,m.FechaProximaRevision AS '
                           'proxima_revision,m.Observaciones AS observaciones\n'
                           '    FROM eqp.MantenimientoEquipo m INNER JOIN eqp.Equipo e ON '
                           'e.EquipoId=m.EquipoId',
                    'columns': ['id', 'equipo', 'codigo_equipo', 'tipo', 'estado', 'diagnostico'],
                    'date': 'programada',
                    'status': 'estado'},
 'vacaciones': {'sql': "SELECT v.SolicitudVacacionId AS id,LTRIM(RTRIM(CONCAT(p.Nombres,N' ',p.Apellidos))) "
                       'AS empleado,\n'
                       '           v.FechaSolicitud AS solicitada,v.FechaInicio AS inicio,v.FechaFin AS '
                       'fin,v.DiasSolicitados AS dias,\n'
                       '           v.Estado,v.Motivo,v.Observaciones\n'
                       '    FROM rh.SolicitudVacacion v INNER JOIN rh.Empleado e ON '
                       'e.EmpleadoId=v.EmpleadoId INNER JOIN rh.Persona p ON p.PersonaId=e.PersonaId\n'
                       "    WHERE @Rol=N'COORDINADOR' OR (@Rol=N'TECNICO' AND v.EmpleadoId=@EmpleadoId)",
                'columns': ['id', 'empleado', 'estado', 'motivo'],
                'date': 'solicitada',
                'status': 'estado'},
 'cotizaciones': {'sql': 'SELECT\n'
                         '        c.CotizacionId AS id,\n'
                         '        c.NumeroCotizacion AS numero,\n'
                         '        c.NombreCotizacion AS nombre,\n'
                         '        cli.NombreComercial AS cliente,\n'
                         '        o.OrdenTrabajoId AS orden_id,\n'
                         '        o.NumeroOrden AS orden,\n'
                         '        c.Estado,\n'
                         '        c.CreadoEn AS creada,\n'
                         '        v.NumeroVersion AS version,\n'
                         '        v.FechaEmision AS emision,\n'
                         '        v.FechaExpiracion AS expiracion,\n'
                         '        v.Moneda,\n'
                         '        v.Total,\n'
                         '        v.Estado AS estado_version\n'
                         '    FROM cot.Cotizacion c\n'
                         '    INNER JOIN srv.OrdenTrabajo o ON o.OrdenTrabajoId = c.OrdenTrabajoId\n'
                         '    INNER JOIN srv.SolicitudServicio ss ON ss.SolicitudServicioId = '
                         'o.SolicitudServicioId\n'
                         '    INNER JOIN crm.Cliente cli ON cli.ClienteId = ss.ClienteId\n'
                         '    LEFT JOIN cot.VersionCotizacion v\n'
                         '        ON v.CotizacionId = c.CotizacionId\n'
                         '       AND v.EsActual = 1\n'
                         '    WHERE\n'
                         "        @Rol = N'COORDINADOR'\n"
                         '        OR (\n'
                         "            @Rol = N'CLIENTE'\n"
                         '            AND ss.ClienteId = @ClienteId\n'
                         "            AND c.Estado IN (N'ENVIADA', N'OBSERVADA', N'ACEPTADA', N'RECHAZADA', "
                         "N'ANULADA')\n"
                         '        )',
                  'columns': ['id', 'numero', 'nombre', 'cliente', 'orden', 'estado'],
                  'date': 'creada',
                  'status': 'estado'},
 'documentos': {'sql': 'SELECT d.DocumentoServicioId AS id,d.NumeroDocumento AS numero,d.NumeroVersion AS '
                       'version,f.Nombre AS formato,f.Categoria AS categoria,\n'
                       '           o.NumeroOrden AS orden,c.NombreComercial AS '
                       "cliente,d.Estado,CONCAT('/api/documentos/',d.DocumentoServicioId,'/archivo') AS "
                       'ruta,d.GeneradoEn AS generado,d.EntregadoEn AS entregado\n'
                       '    FROM doc.DocumentoServicio d INNER JOIN doc.FormatoDocumento f ON '
                       'f.FormatoDocumentoId=d.FormatoDocumentoId\n'
                       '    INNER JOIN srv.OrdenTrabajo o ON o.OrdenTrabajoId=d.OrdenTrabajoId INNER JOIN '
                       'srv.SolicitudServicio ss ON ss.SolicitudServicioId=o.SolicitudServicioId\n'
                       '    INNER JOIN crm.Cliente c ON c.ClienteId=ss.ClienteId\n'
                       "    WHERE @Rol=N'COORDINADOR' OR (@Rol=N'CLIENTE' AND ss.ClienteId=@ClienteId AND "
                       "d.EsSeguimientoInterno=0 AND d.Estado IN ('GENERADO','ENTREGADO','ACEPTADO','OBSERVADO'))",
                'columns': ['id', 'numero', 'formato', 'categoria', 'orden', 'cliente', 'estado'],
                'date': 'generado',
                'status': 'estado'},
 'auditoria': {'sql': 'SELECT a.EventoAuditoriaId AS id,a.FechaEvento AS '
                      'fecha,a.Esquema,a.Tabla,a.Operacion,\n'
                      "           COALESCE(u.NombreUsuario,N'SISTEMA') AS "
                      'usuario,a.Aplicacion,a.Host,a.DireccionIp AS ip,a.Observacion,\n'
                      '           d.ClavesRegistros AS claves,CAST(NULL AS nvarchar(1)) AS antes,CAST(NULL '
                      'AS nvarchar(1)) AS despues\n'
                      '    FROM aud.EventoAuditoria a LEFT JOIN seg.Usuario u ON u.UsuarioId=a.UsuarioId '
                      'LEFT JOIN aud.DetalleAuditoria d ON d.EventoAuditoriaId=a.EventoAuditoriaId',
               'columns': ['id', 'esquema', 'tabla', 'operacion', 'usuario', 'observacion', 'ip'],
               'date': 'fecha',
               'status': 'operacion'}}

for _module,_extra in {'solicitudes':['creada'],'ordenes':['programada'],'clientes':['activo','sedes'],
    'equipos':['fallas_abiertas','activo'],'mantenimientos':['programada'],'vacaciones':['inicio','fin','dias'],
    'cotizaciones':['version','total']}.items():SPECS[_module]['columns'].extend(_extra)

def listing(b,session,module):
    spec=SPECS[module];page,size=b.pagination_args();where=[];params=[]
    term=str(request.args.get('q') or '').strip()[:150]
    if term:
        term=term.replace('~','~~').replace('%','~%').replace('_','~_').replace('[','~[')
        where.append('('+' OR '.join(f"CONVERT(nvarchar(2000),[{c}]) LIKE ? ESCAPE '~'" for c in spec['columns'])+')')
        params.extend(['%'+term+'%']*len(spec['columns']))
    state=request.args.get('estado')
    if state and spec['status']:
        where.append('['+spec['status']+']=?');params.append(state)
    for key,operator in [('fecha_desde','>='),('fecha_hasta','<')]:
        value=request.args.get(key)
        if value and spec['date']:
            parsed=date.fromisoformat(value)
            if key=='fecha_hasta':parsed+=timedelta(days=1)
            if module!='vacaciones':parsed=b.parse_datetime_local(parsed.isoformat()+'T00:00')
            where.append('['+spec['date']+']'+operator+'?');params.append(parsed)
    sort=request.args.get('orden','id').lower()
    if sort not in set(spec['columns']+[spec['date'],'id']):sort='id'
    direction='ASC' if request.args.get('direccion')=='ASC' else 'DESC'
    conditions=' WHERE '+' AND '.join(where) if where else ''
    prefix='DECLARE @Rol nvarchar(60)=?,@ClienteId bigint=?,@EmpleadoId bigint=?;'
    base=prefix+' WITH datos AS ('+spec['sql']+') '
    context=[session['rol'],session.get('cliente_id'),session.get('empleado_id')]
    with b.get_db_connection() as conn:
        cur=conn.cursor();cur.execute(base+'SELECT COUNT_BIG(*) FROM datos'+conditions,*(context+params))
        total=int(cur.fetchone()[0]);pages=max(1,(total+size-1)//size);page=min(page,pages)
        cur.execute(base+'SELECT * FROM datos'+conditions+f' ORDER BY [{sort}] {direction}'+(' ,id DESC' if sort!='id' else '')+' OFFSET ? ROWS FETCH NEXT ? ROWS ONLY',*(context+params+[(page-1)*size,size]))
        items=b.rows_to_dicts(cur,cur.fetchall())
    return jsonify(ok=True,items=items,total=total,pagina=page,tamano=size,paginas=pages)
