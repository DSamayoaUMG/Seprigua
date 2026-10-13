"""Consultas parametrizadas sobre el esquema vigente, con filtros y paginación."""
from datetime import date,timedelta
import json
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
 'documentos': {'sql': """
    SELECT
        d.DocumentoServicioId AS id,
        COALESCE(d.NumeroDocumento, CONCAT(N'DOC-', d.DocumentoServicioId)) AS numero,
        d.NumeroVersion AS version,
        f.Nombre AS formato,
        f.Categoria AS categoria,
        o.NumeroOrden AS orden,
        c.NombreComercial AS cliente,
        d.Estado AS estado,
        CONCAT('/api/documentos/', d.DocumentoServicioId, '/archivo') AS ruta,
        COALESCE(d.GeneradoEn, d.CreadoEn) AS generado,
        d.EntregadoEn AS entregado,
        CAST(N'SEPRIGUA' AS nvarchar(20)) AS origen,
        CAST(N'DOCUMENTO_SERVICIO' AS nvarchar(30)) AS tipo_registro
    FROM doc.DocumentoServicio d
    INNER JOIN doc.FormatoDocumento f ON f.FormatoDocumentoId=d.FormatoDocumentoId
    INNER JOIN srv.OrdenTrabajo o ON o.OrdenTrabajoId=d.OrdenTrabajoId
    INNER JOIN srv.SolicitudServicio ss ON ss.SolicitudServicioId=o.SolicitudServicioId
    INNER JOIN crm.Cliente c ON c.ClienteId=ss.ClienteId
    WHERE @Rol=N'COORDINADOR'
       OR (@Rol=N'CLIENTE' AND ss.ClienteId=@ClienteId
           AND d.EsSeguimientoInterno=0
           AND d.Estado IN ('GENERADO','ENTREGADO','ACEPTADO','OBSERVADO'))

    UNION ALL

    SELECT
        e.EvidenciaServicioId AS id,
        e.NombreArchivo AS numero,
        CAST(1 AS smallint) AS version,
        CAST(N'Documento enviado por cliente' AS nvarchar(180)) AS formato,
        e.Categoria AS categoria,
        o.NumeroOrden AS orden,
        c.NombreComercial AS cliente,
        CAST(N'RECIBIDO' AS varchar(20)) AS estado,
        CONCAT('/api/archivos/evidencia/', e.EvidenciaServicioId) AS ruta,
        e.CreadoEn AS generado,
        e.CreadoEn AS entregado,
        CAST(N'CLIENTE' AS nvarchar(20)) AS origen,
        CAST(N'DOCUMENTO_CLIENTE' AS nvarchar(30)) AS tipo_registro
    FROM srv.EvidenciaServicio e
    INNER JOIN srv.OrdenTrabajo o ON o.OrdenTrabajoId=e.OrdenTrabajoId
    INNER JOIN srv.SolicitudServicio ss ON ss.SolicitudServicioId=o.SolicitudServicioId
    INNER JOIN crm.Cliente c ON c.ClienteId=ss.ClienteId
    WHERE e.Categoria='DOCUMENTO_CLIENTE'
      AND e.Origen='CLIENTE'
      AND (@Rol=N'COORDINADOR' OR (@Rol=N'CLIENTE' AND ss.ClienteId=@ClienteId))
    """,
                'columns': ['id', 'numero', 'formato', 'categoria', 'orden', 'cliente', 'estado', 'origen', 'tipo_registro'],
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

SPECS['personal']['sql']=SPECS['personal']['sql'].replace('e.Disponibilidad AS disponibilidad',"CASE WHEN EXISTS(SELECT 1 FROM rh.SolicitudVacacion v WHERE v.EmpleadoId=e.EmpleadoId AND v.Estado='APROBADA' AND v.FechaInicio<=@Hoy AND v.FechaFin>=@Hoy) THEN 'VACACIONES' ELSE e.Disponibilidad END AS disponibilidad")
FACETS={'personal':['puesto','estado','disponibilidad'],'equipos':['categoria','estado'],'mantenimientos':['tipo','estado'],'vacaciones':['estado']}
SUMMARY={
 'personal':"COUNT_BIG(*) AS total,SUM(CASE WHEN estado='ACTIVO' THEN 1 ELSE 0 END) AS activos,SUM(CASE WHEN disponibilidad='DISPONIBLE' THEN 1 ELSE 0 END) AS disponibles,SUM(CASE WHEN disponibilidad='ASIGNADO' THEN 1 ELSE 0 END) AS asignados,SUM(CASE WHEN disponibilidad='VACACIONES' THEN 1 ELSE 0 END) AS vacaciones",
 'equipos':"COUNT_BIG(*) AS total,SUM(CASE WHEN estado='DISPONIBLE' THEN 1 ELSE 0 END) AS disponibles,SUM(CASE WHEN estado='EN_MANTENIMIENTO' THEN 1 ELSE 0 END) AS mantenimiento,SUM(CASE WHEN fallas_abiertas>0 THEN 1 ELSE 0 END) AS fallas",
 'mantenimientos':"COUNT_BIG(*) AS total,SUM(CASE WHEN estado='PROGRAMADO' THEN 1 ELSE 0 END) AS programados,SUM(CASE WHEN estado='EN_PROCESO' THEN 1 ELSE 0 END) AS proceso,SUM(CASE WHEN estado='FINALIZADO' THEN 1 ELSE 0 END) AS finalizados,SUM(CASE WHEN estado='PENDIENTE_AUTORIZACION' THEN 1 ELSE 0 END) AS pendientes"
}

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
    raw=request.args.get('filtros','{}')
    if len(raw)>4000:raise ValueError('Demasiados filtros.')
    try:filters=json.loads(raw)
    except ValueError:raise ValueError('Filtros inválidos.')
    if not isinstance(filters,dict):raise ValueError('Filtros inválidos.')
    for key,selected in filters.items():
        if key=='peopleQuick' and module=='personal':
            picks=selected if isinstance(selected,list) else [selected]
            clauses={'DISPONIBLES':"disponibilidad='DISPONIBLE'",'ASIGNADOS':"disponibilidad='ASIGNADO'",'VACACIONES':"disponibilidad='VACACIONES'",'INACTIVOS':"(estado<>'ACTIVO' OR disponibilidad='INACTIVO')"}
            chosen=[clauses[v] for v in picks if v in clauses]
            if chosen:where.append('('+' OR '.join(chosen)+')')
            continue
        if key not in spec['columns']:continue
        values=selected if isinstance(selected,list) else [selected]
        values=[str(v) for v in values if v not in (None,'','TODOS','TODAS')]
        if len(values)>20 or any(len(v)>200 for v in values):raise ValueError('Filtro fuera de rango.')
        if values:where.append('['+key+'] IN ('+','.join('?' for _ in values)+')');params.extend(values)
    sort=request.args.get('orden','id').lower()
    if sort not in set(spec['columns']+[spec['date'],'id']):sort='id'
    direction='ASC' if request.args.get('direccion')=='ASC' else 'DESC'
    conditions=' WHERE '+' AND '.join(where) if where else ''
    prefix='DECLARE @Rol nvarchar(60)=?,@ClienteId bigint=?,@EmpleadoId bigint=?,@Hoy date=?;'
    base=prefix+' WITH datos AS ('+spec['sql']+') '
    context=[session['rol'],session.get('cliente_id'),session.get('empleado_id'),b.planning.local_day()]
    with b.get_db_connection() as conn:
        cur=conn.cursor();cur.execute(base+'SELECT COUNT_BIG(*) FROM datos'+conditions,*(context+params))
        total=int(cur.fetchone()[0]);pages=max(1,(total+size-1)//size);page=min(page,pages)
        cur.execute(base+'SELECT * FROM datos'+conditions+f' ORDER BY [{sort}] {direction}'+(' ,id DESC' if sort!='id' else '')+' OFFSET ? ROWS FETCH NEXT ? ROWS ONLY',*(context+params+[(page-1)*size,size]))
        items=b.rows_to_dicts(cur,cur.fetchall())
        facets={};summary={}
        if request.args.get('resumen')=='1':
            for field in FACETS.get(module,[]):
                facets[field]=[r['value'] for r in b.exec_proc_rows(cur,base+'SELECT DISTINCT ['+field+'] AS value FROM datos WHERE ['+field+'] IS NOT NULL ORDER BY ['+field+']',context)]
            if module in SUMMARY:summary=b.exec_proc_row(cur,base+'SELECT '+SUMMARY[module]+' FROM datos',context) or {}

    return jsonify(ok=True,items=items,total=total,pagina=page,tamano=size,paginas=pages,facetas=facets,resumen=summary)
