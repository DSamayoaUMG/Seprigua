"""Notificaciones transaccionales; com.Notificacion conserva el historial."""
def notify_users(b,cur,user_ids,event,title,message,entity,entity_id):
    for uid in sorted({int(x) for x in user_ids if x is not None}):
        cur.execute("""INSERT INTO com.Notificacion(UsuarioId,Tipo,Titulo,Mensaje,Entidad,EntidadId,Canal,Estado)
          SELECT ?,?,?,?,?,?,'SISTEMA','PENDIENTE' WHERE NOT EXISTS(SELECT 1 FROM com.Notificacion WITH (UPDLOCK,HOLDLOCK)
          WHERE UsuarioId=? AND Tipo=? AND Entidad=? AND EntidadId=? AND Mensaje=? AND CreadaEn>=DATEADD(SECOND,-30,SYSUTCDATETIME()))""",
          uid,event,title,message[:1000],entity,str(entity_id),uid,event,entity,str(entity_id),message[:1000])


def resolve_order_notifications(cur, order_id, entity="OrdenTrabajo"):
    """Cierra avisos operativos pendientes al resolver una OT o solicitud.

    El historial del aviso se conserva y la notificación del cambio final se crea
    después de esta actualización para que el usuario también vea el resultado.
    """
    if entity not in {"OrdenTrabajo", "SolicitudServicio"}:
        raise ValueError("Entidad de notificación no admitida.")
    cur.execute("""UPDATE com.Notificacion
       SET Estado='LEIDA', LeidaEn=COALESCE(LeidaEn,SYSUTCDATETIME())
       WHERE Entidad=? AND TRY_CONVERT(bigint,EntidadId)=?
         AND Estado IN ('PENDIENTE','ENVIADA') AND LeidaEn IS NULL""", entity, int(order_id))

def employee_users(b,cur,employee_id):
    return [r['id'] for r in b.exec_proc_rows(cur,'SELECT UsuarioId AS id FROM seg.Usuario WHERE EmpleadoId=? AND Activo=1',(employee_id,))]

def coordinator_users(b,cur,module='ordenes'):
    code=b.MODULE_ACCESS_CATALOG[module]['codigo'];alternate='MOD_PERSONAS' if module=='vacaciones' else code
    return [r['id'] for r in b.exec_proc_rows(cur,"""SELECT DISTINCT u.UsuarioId AS id FROM seg.Usuario u JOIN seg.Rol r ON r.RolId=u.RolId
      WHERE u.Activo=1 AND r.Activo=1 AND (UPPER(LTRIM(RTRIM(r.Nombre)))='COORDINADOR' OR (
       EXISTS(SELECT 1 FROM seg.RolPermiso rp JOIN seg.Permiso p ON p.PermisoId=rp.PermisoId WHERE rp.RolId=r.RolId AND rp.Concedido=1 AND p.Activo=1 AND p.Codigo='PORTAL_COORDINADOR')
       AND EXISTS(SELECT 1 FROM seg.RolPermiso rp JOIN seg.Permiso p ON p.PermisoId=rp.PermisoId WHERE rp.RolId=r.RolId AND rp.Concedido=1 AND p.Activo=1 AND p.Codigo IN (?,?))))""",(code,alternate))]
