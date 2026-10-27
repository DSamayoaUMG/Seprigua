"""Suspensión y reprogramación de una OT ya iniciada, sobre el esquema existente."""
import json
from datetime import datetime

from flask import jsonify, request
from werkzeug.exceptions import Conflict, NotFound

try:
    from .notifications import coordinator_users, employee_users, notify_users
except ImportError:
    from notifications import coordinator_users, employee_users, notify_users


PORTAL_TYPE = "REPROGRAMACION_OT"


def _metadata(row):
    try:
        value = json.loads(row.get("accion") or "{}")
    except (TypeError, ValueError):
        return None
    return value if isinstance(value, dict) and value.get("portal_tipo") == PORTAL_TYPE else None


def pending_request(b, cur, order_id):
    return b.exec_proc_row(cur, """SELECT TOP (1) IncidenciaOrdenId AS id
      FROM srv.IncidenciaOrden WITH (UPDLOCK,HOLDLOCK)
      WHERE OrdenTrabajoId=? AND Estado='PENDIENTE'
        AND JSON_VALUE(CASE WHEN ISJSON(AccionTomada)=1 THEN AccionTomada ELSE '{}' END,'$.portal_tipo')=?
      ORDER BY IncidenciaOrdenId DESC""", (order_id, PORTAL_TYPE))


def list_requests(b, order_id, role):
    rows = b.query_all("""SELECT IncidenciaOrdenId AS id,Descripcion AS motivo,
          AccionTomada AS accion,Estado AS estado,ReportadaEn AS solicitada_en,
          ResueltaEn AS decidida_en,ResponsableUsuarioId AS autorizada_por,
          ReportadaPorEmpleadoId AS empleado_id
        FROM srv.IncidenciaOrden WHERE OrdenTrabajoId=?
          AND JSON_VALUE(CASE WHEN ISJSON(AccionTomada)=1 THEN AccionTomada ELSE '{}' END,'$.portal_tipo')=?
        ORDER BY IncidenciaOrdenId DESC""", (order_id, PORTAL_TYPE))
    items = []
    for row in rows:
        meta = _metadata(row)
        if not meta:
            continue
        item = {k: row[k] for k in ("id", "estado", "solicitada_en", "decidida_en")}
        item.update(motivo=row["motivo"], original=meta.get("original"),
                    propuesta=meta.get("propuesta"), confirmada=meta.get("confirmada"))
        if role != "CLIENTE":
            item.update(trabajo_realizado=meta.get("realizado"), pendiente=meta.get("pendiente"),
                        evidencias=meta.get("evidencias") or [], solicitada_por=meta.get("solicitante"),
                        autorizada_por=row["autorizada_por"], decision=meta.get("decision"))
        elif row["estado"] != "RESUELTA":
            # El cliente recibe únicamente cambios confirmados de programación.
            continue
        items.append(item)
    return items


def _iso(value):
    return value.isoformat(timespec="seconds") + "Z" if isinstance(value, datetime) else None


def _stored_utc(value):
    return datetime.fromisoformat(value.rstrip("Z")) if value else None


def _state(b, cur, code):
    row = b.exec_proc_row(cur, "SELECT EstadoOrdenTrabajoId AS id FROM srv.EstadoOrdenTrabajo WHERE Codigo=? AND Activo=1", (code,))
    if not row:
        raise Conflict(f"Falta el estado {code} en el catálogo.")
    return int(row["id"])


def _locked_order(b, cur, order_id):
    row = b.exec_proc_row(cur, """SELECT o.EstadoOrdenTrabajoId AS estado_id,eo.Codigo AS estado,
        o.ProgramadaPara AS programada,o.IniciadaEn AS iniciada,o.NumeroOrden AS numero
        FROM srv.OrdenTrabajo o WITH (UPDLOCK,HOLDLOCK)
        JOIN srv.EstadoOrdenTrabajo eo ON eo.EstadoOrdenTrabajoId=o.EstadoOrdenTrabajoId
        WHERE o.OrdenTrabajoId=?""", (order_id,))
    if not row:
        raise NotFound("Orden no encontrada.")
    return row


def _history(cur, order_id, before, after, user_id, comment):
    cur.execute("""INSERT INTO srv.HistorialEstadoOrden
      (OrdenTrabajoId,EstadoAnteriorId,EstadoNuevoId,CambiadoPorUsuarioId,FechaCambio,Comentario)
      VALUES (?,?,?,?,SYSUTCDATETIME(),?)""", order_id, before, after, user_id, comment[:600])


def _photo_ids(b, cur, order_id, submitted):
    if not isinstance(submitted, list) or not 1 <= len(submitted) <= 6:
        raise ValueError("Adjunta entre 1 y 6 fotografías de la suspensión.")
    try:
        ids = sorted({int(value) for value in submitted})
    except (TypeError, ValueError):
        raise ValueError("Las fotografías no son válidas.")
    if len(ids) != len(submitted) or any(value <= 0 for value in ids):
        raise ValueError("Las fotografías no son válidas o están repetidas.")
    placeholders = ",".join("?" for _ in ids)
    rows = b.exec_proc_rows(cur, f"""SELECT EvidenciaServicioId AS id FROM srv.EvidenciaServicio
      WHERE OrdenTrabajoId=? AND TipoArchivo='FOTO' AND EvidenciaServicioId IN ({placeholders})""", (order_id, *ids))
    if {int(row["id"]) for row in rows} != set(ids):
        raise ValueError("Una fotografía no pertenece a esta orden.")
    return ids


def _recipients(b, cur, order_id, actor_id, *, coordinators=False, staff=False, clients=False):
    result = set()
    if coordinators:
        result.update(coordinator_users(b, cur, "ordenes"))
    if staff:
        crew = b.exec_proc_rows(cur, "SELECT DISTINCT EmpleadoId AS id FROM srv.TecnicoOrden WHERE OrdenTrabajoId=? AND Estado IN ('ASIGNADO','CONFIRMADO')", (order_id,))
        for row in crew:
            result.update(employee_users(b, cur, row["id"]))
    if clients:
        result.update(row["id"] for row in b.exec_proc_rows(cur, """SELECT DISTINCT u.UsuarioId AS id
          FROM srv.OrdenTrabajo o JOIN srv.SolicitudServicio s ON s.SolicitudServicioId=o.SolicitudServicioId
          JOIN crm.UbicacionServicio loc ON loc.UbicacionServicioId=s.UbicacionServicioId
          JOIN crm.ContactoCliente cc ON cc.ClienteId=s.ClienteId AND cc.Activo=1
          JOIN seg.Usuario u ON u.ContactoClienteId=cc.ContactoClienteId AND u.Activo=1
          CROSS APPLY seg.ufn_SucursalesPermitidas(u.UsuarioId) permitted
          WHERE o.OrdenTrabajoId=? AND permitted.SucursalClienteId=loc.SucursalClienteId""", (order_id,)))
    result.discard(actor_id)
    return sorted(result)


def _notify(b, cur, recipients, event, title, message, order_id):
    notify_users(b, cur, recipients, event, title, message, "OrdenTrabajo", order_id)


def register_reprogramming(b):
    app = b.app
    require = b.require_session
    planning = b.planning

    @app.post("/api/ordenes/<int:orden_id>/reprogramaciones")
    @require("COORDINADOR", "TECNICO")
    def solicitar_reprogramacion(session, orden_id):
        data = request.get_json(silent=True) or {}
        try:
            b.assert_order_access(session, orden_id, True)
            motivo = str(data.get("motivo") or "").strip()
            realizado = str(data.get("trabajo_realizado") or "").strip()
            pendiente = str(data.get("pendiente") or "").strip()
            if not 10 <= len(motivo) <= 700 or not 5 <= len(realizado) <= 220 or not 5 <= len(pendiente) <= 220:
                raise ValueError("Describe el motivo (10 a 700 caracteres), el trabajo realizado y lo pendiente (5 a 220 cada uno).")
            proposed = b.parse_datetime_local(data.get("propuesta"), "Fecha propuesta")
            if not proposed or proposed <= b.utcnow():
                raise ValueError("Propón una fecha y hora futuras.")
            direct = session["rol"] == "COORDINADOR" and bool(data.get("confirmada_para"))
            confirmed = b.parse_datetime_local(data.get("confirmada_para"), "Fecha confirmada") if direct else None
            if confirmed and confirmed <= b.utcnow():
                raise ValueError("La fecha confirmada debe ser futura.")
            with b.get_db_connection() as conn:
                cur = conn.cursor()
                planning.lock_planning(b, cur)
                b.set_audit_context(cur, session, "Suspensión y reprogramación de OT")
                order = _locked_order(b, cur, orden_id)
                if order["estado"] != "EN_PROCESO" or not order["iniciada"]:
                    raise Conflict("Solo puede suspenderse una orden iniciada y en proceso.")
                if pending_request(b, cur, orden_id):
                    raise Conflict("Esta OT ya tiene una solicitud de reprogramación pendiente.")
                photos = _photo_ids(b, cur, orden_id, data.get("evidencias"))
                if direct:
                    if not planning.crew_ids(b, cur, orden_id):
                        raise Conflict("Asigna una cuadrilla antes de confirmar la nueva fecha.")
                    planning.validate_order(b, cur, orden_id, scheduled=confirmed)
                meta = {"portal_tipo": PORTAL_TYPE, "original": _iso(order["programada"]),
                        "propuesta": _iso(proposed), "confirmada": _iso(confirmed),
                        "realizado": realizado, "pendiente": pendiente, "evidencias": photos,
                        "solicitante": session["usuario_id"]}
                encoded = json.dumps(meta, ensure_ascii=False, separators=(",", ":"))
                if len(encoded.encode("utf-16-le")) // 2 > 900:
                    raise ValueError("Reduce el texto de la solicitud.")
                status = "RESUELTA" if direct else "PENDIENTE"
                cur.execute("""INSERT INTO srv.IncidenciaOrden
                  (OrdenTrabajoId,ReportadaPorEmpleadoId,TipoIncidencia,Descripcion,AccionTomada,Estado,ResponsableUsuarioId,ReportadaEn,ResueltaEn)
                  OUTPUT INSERTED.IncidenciaOrdenId
                  VALUES (?,?, 'DEMORA', ?, ?, ?, ?, SYSUTCDATETIME(), ?)""",
                  orden_id, session.get("empleado_id"), motivo, encoded, status,
                  session["usuario_id"] if direct else None, b.utcnow() if direct else None)
                request_id = int(cur.fetchone()[0])
                next_code = "PROGRAMADA" if direct else "PENDIENTE"
                next_state = _state(b, cur, next_code)
                cur.execute("""UPDATE srv.OrdenTrabajo SET EstadoOrdenTrabajoId=?,ProgramadaPara=?,
                  ActualizadoEn=SYSUTCDATETIME() WHERE OrdenTrabajoId=?""",
                  next_state, confirmed, orden_id)
                _history(cur, orden_id, order["estado_id"], next_state, session["usuario_id"],
                         f"OT suspendida. Reprogramación #{request_id}: " + ("confirmada por Coordinación" if direct else "pendiente de aprobación"))
                if direct:
                    b.record_reschedule(cur, orden_id, next_state, session["usuario_id"], order["programada"], confirmed)
                    staff_ids = _recipients(b, cur, orden_id, session["usuario_id"], staff=True)
                    client_ids = [uid for uid in _recipients(b, cur, orden_id, session["usuario_id"], clients=True) if uid not in staff_ids]
                    recipients = sorted(set(staff_ids + client_ids))
                    title, message = "Orden reprogramada", f"La OT {order['numero']} tiene una nueva fecha de atención confirmada."
                else:
                    recipients = _recipients(b, cur, orden_id, session["usuario_id"], coordinators=True)
                    title, message = "Reprogramación solicitada", f"Revisa la solicitud para la OT {order['numero']}."
                _notify(b, cur, recipients, PORTAL_TYPE, title, message, orden_id)
                conn.commit()
            try:
                if direct:
                    b.queue_web_push(staff_ids, title=title, body=message, role="TECNICO", entity="OrdenTrabajo",
                                     entity_id=orden_id, tag=f"reprogramacion-{orden_id}-{request_id}-tecnico")
                    b.queue_web_push(client_ids, title=title, body=message, role="CLIENTE", entity="OrdenTrabajo",
                                     entity_id=orden_id, tag=f"reprogramacion-{orden_id}-{request_id}-cliente")
                else:
                    b.queue_web_push(recipients, title=title, body=message, role="COORDINADOR",
                                     entity="OrdenTrabajo", entity_id=orden_id,
                                     tag=f"reprogramacion-{orden_id}-{request_id}")
            except Exception:
                app.logger.exception("La solicitud quedó guardada, pero falló la entrega Web Push.")
            return jsonify(ok=True, message=title, id=request_id), 201
        except ValueError as exc:
            return jsonify(ok=False, message=str(exc)), 400
        except Exception as exc:
            return b.app_error(exc, "No fue posible suspender la orden.")

    @app.post("/api/ordenes/<int:orden_id>/reprogramaciones/<int:request_id>/decision")
    @require("COORDINADOR")
    def decidir_reprogramacion(session, orden_id, request_id):
        data = request.get_json(silent=True) or {}
        try:
            b.assert_order_access(session, orden_id, True)
            approved = str(data.get("decision") or "").upper() == "APROBAR"
            if not approved and str(data.get("decision") or "").upper() != "RECHAZAR":
                raise ValueError("Selecciona aprobar o rechazar.")
            confirmed = b.parse_datetime_local(data.get("confirmada_para"), "Fecha confirmada") if approved else None
            if approved and (not confirmed or confirmed <= b.utcnow()):
                raise ValueError("Indica una fecha confirmada futura.")
            note = str(data.get("observacion") or "").strip()[:120]
            with b.get_db_connection() as conn:
                cur = conn.cursor()
                planning.lock_planning(b, cur)
                b.set_audit_context(cur, session, "Decisión de reprogramación de OT")
                order = _locked_order(b, cur, orden_id)
                row = b.exec_proc_row(cur, """SELECT IncidenciaOrdenId AS id,AccionTomada AS accion,Estado AS estado
                  FROM srv.IncidenciaOrden WITH (UPDLOCK,HOLDLOCK)
                  WHERE IncidenciaOrdenId=? AND OrdenTrabajoId=?""", (request_id, orden_id))
                if not row or not _metadata(row):
                    raise NotFound("Solicitud no encontrada.")
                if row["estado"] != "PENDIENTE" or order["estado"] != "PENDIENTE":
                    raise Conflict("Esta solicitud ya cambió. Actualiza la orden.")
                meta = _metadata(row)
                meta["confirmada"] = _iso(confirmed)
                meta["decision"] = note
                encoded = json.dumps(meta, ensure_ascii=False, separators=(",", ":"))
                if len(encoded.encode("utf-16-le")) // 2 > 900:
                    raise ValueError("La observación es demasiado extensa.")
                if approved:
                    if not planning.crew_ids(b, cur, orden_id):
                        raise Conflict("Asigna una cuadrilla antes de aprobar la nueva fecha.")
                    planning.validate_order(b, cur, orden_id, scheduled=confirmed)
                else:
                    # El rechazo reactiva la OT original solo si la cuadrilla puede trabajar ahora.
                    planning.validate_order(b, cur, orden_id, starting=True)
                next_code = "PROGRAMADA" if approved else "EN_PROCESO"
                next_state = _state(b, cur, next_code)
                cur.execute("""UPDATE srv.IncidenciaOrden SET Estado=?,AccionTomada=?,
                  ResponsableUsuarioId=?,ResueltaEn=SYSUTCDATETIME()
                  WHERE IncidenciaOrdenId=?""", "RESUELTA" if approved else "CERRADA",
                  encoded, session["usuario_id"], request_id)
                cur.execute("""UPDATE srv.OrdenTrabajo SET EstadoOrdenTrabajoId=?,ProgramadaPara=?,
                  ActualizadoEn=SYSUTCDATETIME() WHERE OrdenTrabajoId=?""",
                  next_state, confirmed if approved else _stored_utc(meta.get("original")), orden_id)
                _history(cur, orden_id, order["estado_id"], next_state, session["usuario_id"],
                         f"Reprogramación #{request_id} {'aprobada' if approved else 'rechazada'} por Coordinación. {note}")
                if approved:
                    b.record_reschedule(cur, orden_id, next_state, session["usuario_id"],
                                        _stored_utc(meta.get("original")), confirmed)
                staff_ids = _recipients(b, cur, orden_id, session["usuario_id"], staff=True)
                client_ids = [uid for uid in _recipients(b, cur, orden_id, session["usuario_id"], clients=True) if uid not in staff_ids] if approved else []
                recipients = sorted(set(staff_ids + client_ids))
                title = "Orden reprogramada" if approved else "Reprogramación rechazada"
                message = (f"La OT {order['numero']} tiene una nueva fecha confirmada." if approved
                           else f"Coordinación rechazó la solicitud de la OT {order['numero']}. Revisa el detalle.")
                _notify(b, cur, recipients, PORTAL_TYPE, title, message, orden_id)
                conn.commit()
            try:
                b.queue_web_push(staff_ids, title=title, body=message, role="TECNICO", entity="OrdenTrabajo",
                                 entity_id=orden_id, tag=f"reprogramacion-{orden_id}-{request_id}-decision-tecnico")
                b.queue_web_push(client_ids, title=title, body=message, role="CLIENTE", entity="OrdenTrabajo",
                                 entity_id=orden_id, tag=f"reprogramacion-{orden_id}-{request_id}-decision-cliente")
            except Exception:
                app.logger.exception("La decisión quedó guardada, pero falló la entrega Web Push.")
            return jsonify(ok=True, message=title)
        except ValueError as exc:
            return jsonify(ok=False, message=str(exc)), 400
        except Exception as exc:
            return b.app_error(exc, "No fue posible decidir la reprogramación.")

    return {"list": lambda order_id, role: list_requests(b, order_id, role), "pending": pending_request}
