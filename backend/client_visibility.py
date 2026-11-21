"""Alcance de las solicitudes y OT dentro del portal de clientes."""

MODES = frozenset({"ENCARGADO", "SUPERVISOR"})


def owns_request_sql(source, actor):
    return f"""EXISTS (
        SELECT 1 FROM seg.Usuario owner_account
        WHERE owner_account.UsuarioId={actor}
          AND (({source}.ContactoClienteId IS NOT NULL
                AND {source}.ContactoClienteId=owner_account.ContactoClienteId)
            OR ({source}.ContactoClienteId IS NULL
                AND {source}.RegistradaPorUsuarioId=owner_account.UsuarioId))
    )"""


def client_mode_sql(actor):
    return f"""COALESCE((SELECT access.Modo
        FROM seg.VisibilidadCliente access
        JOIN seg.Usuario account ON account.UsuarioId=access.UsuarioId
         AND account.ContactoClienteId=access.ContactoClienteId
        WHERE access.UsuarioId={actor} AND access.Modo='SUPERVISOR'), 'ENCARGADO')"""


def request_visibility_sql(source, actor, *, write=False):
    own = owns_request_sql(source, actor)
    if write:
        return own
    return f"({client_mode_sql(actor)}='SUPERVISOR' OR {own})"


def request_read_only_sql(source, actor):
    return (f"CASE WHEN {client_mode_sql(actor)}='SUPERVISOR' "
            f"AND NOT {owns_request_sql(source, actor)} THEN 1 ELSE 0 END")


def notice_visibility_sql():
    """Las notificaciones históricas también respetan el alcance actual."""
    return f"""(
        n.Entidad IS NULL OR n.Entidad NOT IN (N'SolicitudServicio',N'OrdenTrabajo',N'Cotizacion',N'CambioAlcance',N'Cancelacion')
        OR EXISTS (
            SELECT 1 FROM seg.Usuario actor
            CROSS APPLY seg.ufn_SucursalesPermitidas(actor.UsuarioId) branch
            JOIN crm.UbicacionServicio loc ON loc.SucursalClienteId=branch.SucursalClienteId
            JOIN srv.SolicitudServicio s ON s.UbicacionServicioId=loc.UbicacionServicioId AND s.ClienteId=branch.ClienteId
            WHERE actor.UsuarioId=n.UsuarioId AND {request_visibility_sql('s', 'n.UsuarioId')}
              AND (s.SolicitudServicioId=TRY_CONVERT(bigint, CASE WHEN n.Entidad=N'SolicitudServicio' THEN n.EntidadId END)
                OR EXISTS (
                    SELECT 1 FROM srv.OrdenTrabajo o WHERE o.SolicitudServicioId=s.SolicitudServicioId
                      AND (o.OrdenTrabajoId=TRY_CONVERT(bigint, CASE WHEN n.Entidad=N'OrdenTrabajo' THEN n.EntidadId END)
                        OR EXISTS (SELECT 1 FROM cot.Cotizacion q WHERE n.Entidad=N'Cotizacion'
                           AND q.OrdenTrabajoId=o.OrdenTrabajoId AND q.CotizacionId=TRY_CONVERT(bigint,n.EntidadId))
                        OR EXISTS (SELECT 1 FROM srv.CambioAlcance ca WHERE n.Entidad=N'CambioAlcance'
                           AND ca.OrdenTrabajoId=o.OrdenTrabajoId AND ca.CambioAlcanceId=TRY_CONVERT(bigint,n.EntidadId))
                        OR EXISTS (SELECT 1 FROM com.Notificacion parent WHERE n.Entidad=N'Cancelacion'
                           AND parent.NotificacionId=TRY_CONVERT(bigint,n.EntidadId) AND parent.Entidad=N'OrdenTrabajo'
                           AND TRY_CONVERT(bigint,parent.EntidadId)=o.OrdenTrabajoId)
                      )
                ) OR EXISTS (SELECT 1 FROM com.Notificacion parent WHERE n.Entidad=N'Cancelacion'
                    AND parent.NotificacionId=TRY_CONVERT(bigint,n.EntidadId) AND parent.Entidad=N'SolicitudServicio'
                    AND TRY_CONVERT(bigint,parent.EntidadId)=s.SolicitudServicioId)
              )
        ) OR EXISTS (
            SELECT 1 FROM cot.Cotizacion q
            JOIN seg.Usuario account ON account.UsuarioId=n.UsuarioId
            JOIN crm.ContactoCliente cc ON cc.ContactoClienteId=account.ContactoClienteId
            WHERE n.Entidad=N'Cotizacion' AND q.CotizacionId=TRY_CONVERT(bigint,n.EntidadId)
              AND q.OrdenTrabajoId IS NULL AND q.ClienteId=cc.ClienteId
              AND (q.SucursalClienteId IS NULL OR EXISTS (SELECT 1 FROM seg.ufn_SucursalesPermitidas(account.UsuarioId) branch
                    WHERE branch.SucursalClienteId=q.SucursalClienteId))
        )
    )"""
