(() => {
  "use strict";

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const content = $("#appContent");
  const nav = $("#systemNav");
  const roleChip = $("#roleChip");
  const title = $("#pageTitle");
  const subtitle = $("#pageSubtitle");
  const eyebrow = $("#pageEyebrow");
  const dbBadge = $("#dbBadge");
  const dbBadgeText = $("#dbBadgeText");
  const modalBackdrop = $("#modalBackdrop");
  const modalBody = $("#modalBody");
  const modalTitle = $("#modalTitle");
  const toast = $("#toast");

  const state = { user: null, role: "", catalogs: {}, current: "dashboard" };
  const rolePaths = { COORDINADOR: "/sistema/coordinador", TECNICO: "/sistema/tecnico", CLIENTE: "/sistema/cliente" };
  const modules = {
    COORDINADOR: [
      ["dashboard", "layout-dashboard", "Panel"], ["solicitudes", "inbox", "Solicitudes"], ["ordenes", "clipboard-list", "Órdenes"],
      ["clientes", "building-2", "Clientes"], ["personal", "users", "Personal"], ["equipos", "wrench", "Equipo"],
      ["mantenimientos", "settings", "Mantenimiento"], ["cotizaciones", "file-text", "Cotizaciones"], ["documentos", "files", "Documentos"],
      ["notificaciones", "bell", "Notificaciones"], ["auditoria", "shield-check", "Auditoría"]
    ],
    TECNICO: [
      ["dashboard", "layout-dashboard", "Mi panel"], ["ordenes", "clipboard-check", "Mis órdenes"], ["equipos", "wrench", "Equipo"],
      ["mantenimientos", "settings", "Mantenimiento"], ["vacaciones", "calendar-days", "Vacaciones"], ["notificaciones", "bell", "Notificaciones"]
    ],
    CLIENTE: [
      ["dashboard", "layout-dashboard", "Mi panel"], ["solicitudes", "circle-plus", "Solicitudes"], ["ordenes", "clipboard-list", "Mis servicios"],
      ["cotizaciones", "file-text", "Cotizaciones"], ["documentos", "files", "Documentos"], ["garantia", "shield-check", "Garantía"],
      ["notificaciones", "bell", "Notificaciones"]
    ]
  };

  function esc(v) { return String(v ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c])); }
  function fmt(v) { if (!v) return "—"; const d = new Date(v); return Number.isNaN(d.getTime()) ? esc(v) : d.toLocaleString("es-GT", { dateStyle: "medium", timeStyle: "short" }); }
  function toLocalInput(v) { if (!v) return ""; const d=new Date(v); if(Number.isNaN(d.getTime())) return ""; const z=n=>String(n).padStart(2,"0"); return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`; }
  function money(v, cur = "GTQ") { const n = Number(v || 0); return new Intl.NumberFormat("es-GT", { style: "currency", currency: cur || "GTQ" }).format(n); }
  function normalizeNumber(v) { return v === null || v === undefined || Number.isNaN(Number(v)) ? 0 : Number(v); }
  function badge(v) {
    const x = String(v ?? "—").toUpperCase();
    const cls = /COMPLET|FINAL|ACEPT|DISPONIBLE|CONFORME|ACTIVO|LEID/.test(x) ? "green" : /CANCEL|RECHAZ|FALLA|NO_CONFORME|CRITICA/.test(x) ? "red" : /PEND|PROCESO|MANTEN|ALTA|EMERGEN/.test(x) ? "orange" : "";
    return `<span class="badge ${cls}">${esc(x.replaceAll("_", " "))}</span>`;
  }
  function button(label, action, id = "", cls = "") { return `<button class="btn small ${cls}" type="button" data-action="${esc(action)}" ${id ? `data-id="${esc(id)}"` : ""}>${esc(label)}</button>`; }
  function table(headers, rows, empty = "No hay registros.") {
    if (!rows.length) return `<div class="empty-state">${esc(empty)}</div>`;
    return `<div class="table-wrap"><table class="data-table"><thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
  }
  function optionList(items, valueKey = "id", text = x => x.nombre || x.name || x.codigo || x.id, selected = "") {
    return items.map(x => `<option value="${esc(x[valueKey])}" ${String(x[valueKey]) === String(selected) ? "selected" : ""}>${esc(text(x))}</option>`).join("");
  }
  function showToast(message, type = "success") {
    toast.textContent = message; toast.className = `toast ${type}`; toast.hidden = false;
    clearTimeout(showToast.t); showToast.t = setTimeout(() => { toast.hidden = true; }, 3500);
  }
  function openModal(name, html) { modalTitle.textContent = name; modalBody.innerHTML = html; modalBackdrop.hidden = false; window.lucide?.createIcons(); }
  function closeModal() { modalBackdrop.hidden = true; modalBody.innerHTML = ""; }
  function setHeading(name, description) { eyebrow.textContent = `SEPRIGUA · ${state.role}`; title.textContent = name; subtitle.textContent = description; }
  function loading() { content.innerHTML = `<div class="loading-card">Consultando SQL Server...</div>`; }

  async function api(url, opts = {}) {
    const options = { credentials: "same-origin", ...opts };
    if (options.body && !(options.body instanceof FormData) && typeof options.body !== "string") {
      options.headers = { "Content-Type": "application/json", ...(options.headers || {}) };
      options.body = JSON.stringify(options.body);
    }
    const r = await fetch(url, options);
    let data = {};
    try { data = await r.json(); } catch (_) { data = { ok: false, message: "Respuesta inválida del servidor." }; }
    if (r.status === 401) { location.replace("/login"); throw new Error("Sesión vencida"); }
    if (!r.ok || data.ok === false) {
      const base = data.message || `Error HTTP ${r.status}`;
      const detail = data.detail ? `\n${String(data.detail).slice(0,900)}` : "";
      throw new Error(base + detail);
    }
    return data;
  }

  async function init() {
    try {
      const me = await api("/api/auth/me"); state.user = me.user; state.role = String(me.user.rol || "").toUpperCase();
      const expected = rolePaths[state.role]; if (!expected) return location.replace("/login");
      if (location.pathname !== expected) return location.replace(expected);
      roleChip.textContent = state.role;
      renderNav();
      const [cats, health] = await Promise.all([api("/api/catalogos"), api("/api/db/health")]);
      state.catalogs = cats;
      dbBadgeText.textContent = health.system_migration ? `${health.database} · lista` : `${health.database} · falta SQL 003`;
      if (!health.system_migration) dbBadge.classList.add("error");
      await navigate("dashboard");
    } catch (e) {
      dbBadge.classList.add("error"); dbBadgeText.textContent = "Sin conexión";
      content.innerHTML = `<div class="empty-state"><h3>No se pudo iniciar el sistema</h3><p>${esc(e.message)}</p><p>Comprueba el backend y las migraciones SQL.</p></div>`;
    }
  }

  function renderNav() {
    nav.innerHTML = (modules[state.role] || []).map(([key, icon, name]) => `<button class="nav-button ${key === state.current ? "active" : ""}" type="button" data-module="${key}"><i data-lucide="${icon}"></i><span>${esc(name)}</span></button>`).join("");
    window.lucide?.createIcons();
  }

  async function navigate(module) {
    state.current = module; renderNav(); loading();
    try {
      const map = { dashboard: renderDashboard, solicitudes: renderSolicitudes, ordenes: renderOrdenes, clientes: renderClientes, personal: renderPersonal, equipos: renderEquipos, mantenimientos: renderMantenimientos, vacaciones: renderVacaciones, cotizaciones: renderCotizaciones, documentos: renderDocumentos, notificaciones: renderNotificaciones, auditoria: renderAuditoria, garantia: renderGarantia };
      await (map[module] || renderDashboard)();
    } catch (e) { content.innerHTML = `<div class="empty-state"><h3>No se pudo cargar</h3><p>${esc(e.message)}</p></div>`; }
  }

  async function renderDashboard() {
    setHeading(`Hola, ${state.user.nombre || state.user.usuario}`, state.user.cliente ? `${state.user.cliente} · datos en tiempo real desde la BD` : "Resumen operativo en tiempo real desde la BD");
    const d = await api("/api/dashboard");
    const labels = {
      solicitudes_pendientes:"Solicitudes pendientes", ordenes_activas:"Órdenes activas", emergencias:"Emergencias", tecnicos_disponibles:"Técnicos disponibles", equipos_disponibles:"Equipos disponibles", clientes_activos:"Clientes activos", cotizaciones_pendientes:"Cotizaciones pendientes", mantenimientos_pendientes:"Mantenimientos",
      hoy:"Órdenes de hoy", finalizadas:"Finalizadas", incidencias:"Incidencias", solicitudes:"Solicitudes", servicios_activos:"Servicios activos", completados:"Completados", documentos:"Documentos"
    };
    const cards = Object.entries(d.cards || {}).map(([k,v]) => `<article class="stat-card"><span>${esc(labels[k] || k.replaceAll("_"," "))}</span><strong>${normalizeNumber(v)}</strong></article>`).join("");
    const recentRows = (d.recent || []).map(x => `<tr><td>${esc(x.numero || x.tipo || `#${x.id}`)}</td><td>${esc(x.cliente || x.descripcion || "—")}</td><td>${esc(x.sede || x.clasificacion || "—")}</td><td>${badge(x.estado || x.prioridad || "")}</td><td>${fmt(x.programada || x.fecha)}</td>${x.numero ? `<td>${button("Ver","ver-orden",x.id)}</td>` : ""}</tr>`);
    let chart = "";
    if ((d.chart || []).length) {
      const max = Math.max(1, ...d.chart.map(x => normalizeNumber(x.ordenes)));
      chart = `<section class="panel"><div class="panel-header"><h2>Órdenes de los últimos 6 meses</h2></div><div class="panel-body chart">${d.chart.map(x => `<div class="bar-row"><span>${esc(x.mes)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.round(normalizeNumber(x.ordenes)/max*100)}%"></div></div><strong>${normalizeNumber(x.ordenes)}</strong></div>`).join("")}</div></section>`;
    }
    content.innerHTML = `<section class="stats-grid">${cards}</section><section class="panel"><div class="panel-header"><h2>Actividad reciente</h2></div>${table(["Registro","Cliente / detalle","Sede / tipo","Estado","Fecha", ...(state.role !== "CLIENTE" || (d.recent || []).some(x=>x.numero) ? ["Acción"] : [])], recentRows, "Todavía no hay actividad para mostrar.")}</section>${chart}`;
  }

  async function renderSolicitudes() {
    setHeading("Solicitudes de servicio", state.role === "CLIENTE" ? "Crea una solicitud, adjunta imágenes y consulta su estado." : "Recepción de solicitudes programadas y emergencias.");
    const d = await api("/api/solicitudes");
    const rows = d.items.map(x => `<tr><td class="mono">#${x.id}</td><td>${esc(x.cliente)}</td><td>${esc(x.sede)}</td><td>${esc(x.tipo)}</td><td>${badge(x.Clasificacion||x.clasificacion)}</td><td>${x.urgencia?badge(x.urgencia):"—"}</td><td>${esc(x.descripcion)}</td><td>${requestStatusView(x)}</td><td>${fmt(x.creada)}</td><td>${button("Ver seguimiento","ver-solicitud",x.id,"primary")}</td></tr>`);
    content.innerHTML = `<div class="toolbar"><div class="toolbar-left"><h2>${d.items.length} solicitudes</h2></div><div class="toolbar-right">${button("Nueva solicitud","nueva-solicitud","","primary")}</div></div><section class="panel">${table(["ID","Cliente","Sede","Tipo","Clase","Urgencia","Descripción","Seguimiento","Creada","Acción"], rows)}</section>`;
  }

  function requestStatusView(x) {
    if(x.orden_id){
      const orderState=String(x.orden_estado||x.orden_estado_codigo||"").trim();
      return `<div>${badge("OT CREADA")}<br><span class="muted mono">${esc(x.orden_numero||`OT #${x.orden_id}`)}</span>${orderState?`<br><span class="muted">${esc(orderState)}</span>`:""}</div>`;
    }
    return badge(String(x.Estado||x.estado||"REGISTRADA").toUpperCase());
  }

  function requestFollowupView(x) {
    const steps=[
      {label:"Solicitud registrada",done:true,detail:fmt(x.creada)},
      {label:"Orden de trabajo creada",done:!!x.orden_id,detail:x.orden_id?`${x.orden_numero||`OT #${x.orden_id}`} · ${x.orden_estado||"En seguimiento"}`:"Pendiente de coordinación"},
      {label:"Cotización vinculada",done:!!x.cotizacion_id,detail:x.cotizacion_id?`${x.cotizacion_numero||`Cotización #${x.cotizacion_id}`} · ${x.cotizacion_estado||""}`:"Se genera cuando corresponda, antes o después del servicio"}
    ];
    return `<div class="timeline">${steps.map(s=>`<div class="timeline-item"><strong>${s.done?"✓":"○"} ${esc(s.label)}</strong><br><span class="muted">${esc(s.detail||"")}</span></div>`).join("")}</div>`;
  }

  function evidenceCard(e) {
    const isImage = String(e.tipo || "").toUpperCase() === "FOTO";
    return `<div class="evidence-card">${isImage?`<a href="${esc(e.ruta)}" target="_blank"><img class="evidence-thumb" src="${esc(e.ruta)}" alt="${esc(e.nombre)}" loading="lazy"></a>`:""}<div class="evidence-meta"><strong>${esc(e.nombre)}</strong><span>${esc(e.categoria || "")} · ${esc(e.etapa || "")}</span>${e.Descripcion||e.descripcion?`<span>${esc(e.Descripcion||e.descripcion)}</span>`:""}<a class="btn small" target="_blank" href="${esc(e.ruta)}">Abrir archivo</a></div></div>`;
  }

  async function openRequest(id) {
    const d = await api(`/api/solicitudes/${id}`), x=d.item;
    const evidence=(d.evidencias||[]).map(evidenceCard).join("")||`<div class="muted">Sin imágenes o archivos adjuntos.</div>`;
    const canCreate = state.role==="COORDINADOR" && !x.orden_id && !["CANCELADA","CONVERTIDA"].includes(String(x.Estado||x.estado).toUpperCase());
    openModal(`Solicitud #${x.id}`, `<div class="info-grid">
      <div class="info-item"><span>Cliente</span><strong>${esc(x.cliente)}</strong></div>
      <div class="info-item"><span>Sede</span><strong>${esc(x.sede)}</strong></div>
      <div class="info-item"><span>Servicio</span><strong>${esc(x.tipo)}</strong></div>
      <div class="info-item"><span>Clasificación</span><strong>${esc(x.Clasificacion||x.clasificacion)}</strong></div>
      <div class="info-item"><span>Urgencia</span><strong>${esc(x.urgencia||"No aplica")}</strong></div>
      <div class="info-item"><span>Estado</span><strong>${esc(x.orden_id?"CONVERTIDA A OT":(x.Estado||x.estado))}</strong></div>
      <div class="info-item"><span>Fecha preferida</span><strong>${fmt(x.fecha_preferida)}</strong></div>
      <div class="info-item"><span>Ubicación</span><strong>${esc([x.Direccion||x.direccion,x.Municipio||x.municipio].filter(Boolean).join(", ")||x.sede)}</strong></div>
    </div>
    <h3 class="section-title">Descripción</h3><p>${esc(x.descripcion)}</p>
    ${x.orden_id?`<div class="panel"><div class="panel-body"><strong>La solicitud ya continúa como ${esc(x.orden_numero||`OT #${x.orden_id}`)}.</strong><br><span class="muted">La solicitud se conserva como origen; el avance operativo continúa en la orden de trabajo.</span></div></div>`:""}
    <div class="actions">${button("Agregar imagen / archivo","evidencia-solicitud",id)}${canCreate?button("Crear OT","crear-ot-solicitud",id,"primary"):""}${x.orden_id?button("Abrir OT","ver-orden",x.orden_id,"primary"):""}${x.cotizacion_id?button("Ver cotizaciones","ir-cotizaciones",x.cotizacion_id):""}</div>
    <h3 class="section-title">Seguimiento</h3>${requestFollowupView(x)}
    <h3 class="section-title">Evidencias iniciales</h3><div class="evidence-grid">${evidence}</div>`);
  }

  async function uploadRequestFiles(solicitudId, files, description="") {
    for (const file of [...files]) {
      const fd=new FormData();
      fd.append("archivo",file);
      if(description) fd.append("descripcion",description);
      await api(`/api/solicitudes/${solicitudId}/evidencias`,{method:"POST",body:fd});
    }
  }

  async function requestForm(preselectGuarantee = false) {
    const isCoord = state.role === "COORDINADOR";
    const clients = state.catalogs.clientes || [];
    const types = state.catalogs.tipos_servicio || [];
    const guarantee = types.find(x => String(x.codigo || "").toUpperCase() === "GARANTIA");
    const selectedType = preselectGuarantee ? (guarantee?.id || "") : "";

    openModal(preselectGuarantee ? "Solicitar garantía" : "Nueva solicitud", `<form id="requestForm" class="form-grid" autocomplete="off">
      ${isCoord ? `<div class="field"><label>Cliente</label><select name="cliente_id" id="requestClient" required><option value="">Seleccione...</option>${optionList(clients)}</select></div>` : ""}
      <div class="field"><label>Sede / ubicación</label><select name="ubicacion_id" id="requestLocation" required><option value="">${isCoord ? "Seleccione primero un cliente" : "Cargando..."}</option></select></div>
      <div class="field"><label>Tipo de servicio</label><select name="tipo_servicio_id" id="requestType" required><option value="">Seleccione...</option>${optionList(types,"id",x=>x.nombre,selectedType)}</select></div>
      <div class="field"><label>Clasificación</label><select name="clasificacion" id="requestClass" required><option value="">Seleccione...</option><option value="PROGRAMADA">PROGRAMADA</option><option value="EMERGENCIA">EMERGENCIA</option></select></div>
      <div class="field field-disabled" id="urgencyField"><label>Urgencia <small>(solo emergencia)</small></label><select name="urgencia" id="requestUrgency" disabled><option value="">Seleccione...</option><option>BAJA</option><option>MEDIA</option><option>ALTA</option><option>CRITICA</option></select></div>
      ${isCoord ? `<div class="field"><label>Canal</label><select name="canal"><option value="">Seleccione...</option><option>LLAMADA</option><option>MENSAJE</option><option>CORREO</option><option>OTRO</option></select></div>` : ""}
      <div class="field"><label>Fecha preferida</label><input type="datetime-local" name="fecha_preferida" autocomplete="off"></div>
      <div class="field full"><label>Descripción del problema</label><textarea name="descripcion" required placeholder="Describe el trabajo o problema..." autocomplete="off"></textarea></div>
      <div class="field full"><label>Imágenes / archivos de referencia <small>(opcional, varios)</small></label><input type="file" id="requestFiles" multiple accept="image/*,video/mp4,video/quicktime,application/pdf"><div class="inline-actions"><button class="btn small" type="button" id="clearRequestFiles">Quitar archivos</button></div><small>Fotos, videos o PDF. Se guardan como evidencia de la solicitud.</small></div>
      <div class="field full"><div class="form-actions"><button class="btn" type="reset" id="resetRequestForm">Limpiar formulario</button><button class="btn" type="button" data-close-modal>Cancelar</button><button class="btn primary" type="submit">Guardar solicitud</button></div></div>
    </form>`);

    async function locations(cid = "") {
      const select = $("#requestLocation");
      select.innerHTML = `<option value="">Cargando...</option>`;
      if (isCoord && !cid) {
        select.innerHTML = `<option value="">Seleccione primero un cliente</option>`;
        return;
      }
      const q = isCoord ? `?cliente_id=${encodeURIComponent(cid)}` : "";
      const d = await api(`/api/ubicaciones${q}`);
      if (!(d.items || []).length) {
        select.innerHTML = `<option value="">Sin ubicaciones disponibles</option>`;
        return;
      }
      select.innerHTML = `<option value="">Seleccione...</option>${optionList(d.items,"id",x=>{
        const name = x.sucursal || x.referencia || "Sede";
        const place = [x.municipio, x.departamento].filter(v=>v && String(v).toUpperCase()!=="PENDIENTE").join(", ");
        const pending = Number(x.ubicacion_pendiente || 0) ? " · dirección pendiente" : "";
        return `${name}${place ? ` · ${place}` : ""}${pending}`;
      })}`;
    }

    const syncUrgency=()=>{
      const emergency=$("#requestClass").value==="EMERGENCIA";
      const urgency=$("#requestUrgency");
      urgency.disabled=!emergency;
      urgency.required=emergency;
      if(!emergency) urgency.value="";
      $("#urgencyField").classList.toggle("field-disabled",!emergency);
    };

    $("#requestClass").addEventListener("change",syncUrgency);
    $("#clearRequestFiles").addEventListener("click",()=>{$("#requestFiles").value="";});

    if (isCoord) {
      $("#requestClient").addEventListener("change", e => locations(e.target.value).catch(err => showToast(err.message,"error")));
    } else {
      await locations();
    }

    $("#requestForm").addEventListener("reset",()=>{
      setTimeout(()=>{
        if (preselectGuarantee && guarantee) $("#requestType").value=String(guarantee.id);
        $("#requestClass").value="";
        $("#requestUrgency").value="";
        $("#requestFiles").value="";
        syncUrgency();
        if(isCoord) locations("");
      },0);
    });

    syncUrgency();

    $("#requestForm").addEventListener("submit", async e => {
      e.preventDefault();
      const form=e.currentTarget, f=new FormData(form), files=$("#requestFiles").files;
      const body=Object.fromEntries([...f.entries()].filter(([k])=>k!=="urgencia" || !$("#requestUrgency").disabled));
      const submit=form.querySelector('button[type="submit"]'); submit.disabled=true; submit.textContent="Guardando...";
      try {
        const result=await api("/api/solicitudes", { method:"POST", body });
        const solicitudId=result.item?.SolicitudServicioId || result.item?.solicitudServicioId || result.item?.id;
        if (solicitudId && files.length) await uploadRequestFiles(solicitudId,files,body.descripcion||"");
        showToast(files.length ? "Solicitud e imágenes registradas." : "Solicitud registrada.");
        closeModal(); navigate("solicitudes");
      } catch(err) { showToast(err.message,"error"); submit.disabled=false; submit.textContent="Guardar solicitud"; }
    });
  }

  async function renderOrdenes() {
    setHeading(state.role === "TECNICO" ? "Mis órdenes" : state.role === "CLIENTE" ? "Mis servicios" : "Órdenes de trabajo", "Flujo real de solicitud → coordinación → ejecución → confirmación, usando los estados establecidos en la BD.");
    const d = await api("/api/ordenes");
    const rows = d.items.map(x => `<tr><td class="mono">${esc(x.numero)}</td><td>${esc(x.cliente)}</td><td>${esc(x.sede)}</td><td>${esc(x.tipo)}</td><td>${badge(x.estado)}</td><td>${badge(x.Prioridad||x.prioridad)}</td><td>${fmt(x.programada)}</td><td>${button("Ver","ver-orden",x.id,"primary")}</td></tr>`);
    content.innerHTML = `<div class="toolbar"><div class="toolbar-left"><h2>${d.items.length} órdenes</h2></div><div class="toolbar-right">${state.role === "COORDINADOR" ? button("Crear OT","nueva-orden","","primary") : ""}</div></div><section class="panel">${table(["Orden","Cliente","Sede","Servicio","Estado","Prioridad","Atención aproximada","Acción"],rows)}</section>`;
  }

  async function orderForm(preselectedSolicitud = "") {
    const req = await api("/api/solicitudes");
    const open = req.items.filter(x => !["CANCELADA","CONVERTIDA"].includes(String(x.Estado||x.estado||"").toUpperCase()));
    if(!open.length){showToast("No hay solicitudes pendientes para convertir en OT.","error");return;}
    openModal("Crear orden de trabajo", `<form id="orderForm" class="form-grid">
      <div class="field full"><label>Solicitud</label><select name="solicitud_id" id="orderRequest" required><option value="">Seleccione...</option>${optionList(open,"id",x=>`#${x.id} · ${x.cliente} · ${x.sede} · ${String(x.descripcion||"").slice(0,70)}`,preselectedSolicitud)}</select></div>
      <div class="field"><label>Prioridad</label><select name="prioridad" id="orderPriority"><option>BAJA</option><option selected>MEDIA</option><option>ALTA</option><option>CRITICA</option></select><small>Se propone desde la urgencia de la solicitud, pero coordinación puede modificarla.</small></div>
      <div class="field"><label>Fecha y hora aproximada de atención</label><input type="datetime-local" name="programada_para" id="orderSchedule"><small>Es una referencia operativa; tráfico, bloqueos, lluvia u otras condiciones pueden modificar la llegada.</small></div>
      <div class="field"><label>Ticket del cliente</label><input name="ticket" maxlength="60"></div><div class="field"><label>No. OT papel</label><input name="orden_papel" maxlength="60"></div>
      <div class="field full"><label>Observaciones</label><textarea name="observaciones"></textarea></div>
      <div class="field full"><div class="form-actions"><button class="btn" type="button" data-close-modal>Cancelar</button><button class="btn primary" type="submit">Crear OT y asignar cuadrilla</button></div></div>
    </form>`);
    const syncFromRequest=()=>{
      const selected=open.find(x=>String(x.id)===String($("#orderRequest").value)); if(!selected)return;
      const urgency=String(selected.urgencia||"").toUpperCase();
      $("#orderPriority").value=["BAJA","MEDIA","ALTA","CRITICA"].includes(urgency)?urgency:"MEDIA";
      if(selected.fecha_preferida) $("#orderSchedule").value=toLocalInput(selected.fecha_preferida);
    };
    $("#orderRequest").addEventListener("change",syncFromRequest); syncFromRequest();
    $("#orderForm").addEventListener("submit", async e => {
      e.preventDefault(); const submit=e.currentTarget.querySelector('button[type="submit"]'); submit.disabled=true;
      try {
        const result=await api("/api/ordenes",{method:"POST",body:Object.fromEntries(new FormData(e.currentTarget).entries())});
        const orderId=result.item?.OrdenTrabajoId||result.item?.ordenTrabajoId||result.item?.id;
        showToast("Orden creada. Ahora define la cuadrilla.");
        if(orderId) return crewForm(orderId,true);
        closeModal(); navigate("ordenes");
      } catch(err){showToast(err.message,"error");submit.disabled=false;}
    });
  }

  async function crewForm(id, created=false) {
    const d=await api(`/api/ordenes/${id}`);
    const assigned=new Map((d.tecnicos||[]).filter(t=>String(t.estado||t.Estado).toUpperCase()==="ASIGNADO").map(t=>[String(t.empleado_id),String(t.funcion||"TECNICO").toUpperCase()]));
    const technicians=state.catalogs.tecnicos||[];
    openModal(created?"Asignar cuadrilla de la nueva OT":"Gestionar cuadrilla",`<form id="crewForm" class="form-grid">
      <div class="field full"><p class="muted">Puedes asignar varios técnicos. Debe existir exactamente un ENCARGADO; los demás pueden quedar como TÉCNICO o APOYO. La asignación no crea un estado nuevo en la OT.</p></div>
      <div class="field full"><div class="timeline">${technicians.map(t=>{const fn=assigned.get(String(t.id))||"TECNICO";const checked=assigned.has(String(t.id));return `<div class="timeline-item"><label style="display:flex;gap:.7rem;align-items:center"><input type="checkbox" class="crew-check" value="${esc(t.id)}" ${checked?"checked":""}><strong style="flex:1">${esc(t.nombre)}</strong>${badge(t.disponibilidad)}</label><select class="inline-select crew-function" data-id="${esc(t.id)}" ${checked?"":"disabled"}><option ${fn==="ENCARGADO"?"selected":""}>ENCARGADO</option><option ${fn==="TECNICO"?"selected":""}>TECNICO</option><option ${fn==="APOYO"?"selected":""}>APOYO</option></select></div>`}).join("")}</div></div>
      <div class="field full"><div class="form-actions"><button class="btn" type="button" data-action="ver-orden" data-id="${id}">Volver a la OT</button><button class="btn primary" type="submit">Guardar cuadrilla</button></div></div>
    </form>`);
    $$(".crew-check").forEach(ch=>ch.addEventListener("change",()=>{const sel=$(`.crew-function[data-id="${CSS.escape(ch.value)}"]`);sel.disabled=!ch.checked;}));
    $("#crewForm").addEventListener("submit",async e=>{
      e.preventDefault();
      const integrantes=$$(".crew-check:checked").map(ch=>({empleado_id:Number(ch.value),funcion:$(`.crew-function[data-id="${CSS.escape(ch.value)}"]`).value}));
      if(!integrantes.length)return showToast("Selecciona al menos un integrante.","error");
      if(integrantes.filter(x=>x.funcion==="ENCARGADO").length!==1)return showToast("Debes dejar exactamente un ENCARGADO.","error");
      try{await api(`/api/ordenes/${id}/cuadrilla`,{method:"PUT",body:{integrantes}});showToast("Cuadrilla actualizada.");await openOrder(id);}catch(err){showToast(err.message,"error");}
    });
  }

  async function editOrderForm(id) {
    const d=await api(`/api/ordenes/${id}`),x=d.item,coord=state.role==="COORDINADOR";
    openModal(`Editar ${x.numero}`,`<form id="editOrderForm" class="form-grid">
      ${coord?`<div class="field"><label>Prioridad</label><select name="prioridad"><option ${String(x.Prioridad).toUpperCase()==="BAJA"?"selected":""}>BAJA</option><option ${String(x.Prioridad).toUpperCase()==="MEDIA"?"selected":""}>MEDIA</option><option ${String(x.Prioridad).toUpperCase()==="ALTA"?"selected":""}>ALTA</option><option ${String(x.Prioridad).toUpperCase()==="CRITICA"?"selected":""}>CRITICA</option></select></div><div class="field"><label>Fecha y hora aproximada de atención</label><input type="datetime-local" name="programada_para" value="${esc(toLocalInput(x.programada))}"><small>Referencia aproximada, no hora exacta garantizada.</small></div>`:""}
      <div class="field"><label>Ticket del cliente</label><input name="ticket" maxlength="60" value="${esc(x.ticket||"")}"></div><div class="field"><label>No. OT papel</label><input name="orden_papel" maxlength="60" value="${esc(x.orden_papel||"")}"></div>
      ${coord?`<div class="field full"><label>Observaciones de coordinación</label><textarea name="observaciones">${esc(x.observaciones||"")}</textarea></div>`:""}
      <div class="field full"><div class="form-actions"><button class="btn" type="button" data-action="ver-orden" data-id="${id}">Volver a la OT</button><button class="btn primary">Guardar cambios</button></div></div>
    </form>`);
    $("#editOrderForm").addEventListener("submit",async e=>{e.preventDefault();try{await api(`/api/ordenes/${id}`,{method:"PATCH",body:Object.fromEntries(new FormData(e.currentTarget).entries())});showToast("Datos actualizados.");await openOrder(id);}catch(err){showToast(err.message,"error");}});
  }

  function techStateChoices(x){
    const code=String(x.estado_codigo||"").toUpperCase(),states=state.catalogs.estados_orden||[];
    const allowed=code==="PENDIENTE"||code==="PROGRAMADA"?["EN_PROCESO"]:code==="EN_PROCESO"?["POR_CONFIRMAR"]:[];
    return states.filter(s=>allowed.includes(String(s.codigo).toUpperCase()));
  }

  async function openOrder(id) {
    state.openOrderId=Number(id);
    const d=await api(`/api/ordenes/${id}`),x=d.item;
    const tech=state.role==="TECNICO",coord=state.role==="COORDINADOR",client=state.role==="CLIENTE";
    const allowedStates=tech
      ? techStateChoices(x)
      : (state.catalogs.estados_orden||[]).filter(s=>String(s.codigo||"").toUpperCase()!=="COMPLETADA");
    const activeTechs=(d.tecnicos||[]).filter(t=>String(t.estado||t.Estado).toUpperCase()==="ASIGNADO");
    const techs=activeTechs.map(t=>`${esc(t.nombre)} (${esc(t.funcion||"TECNICO")})`).join(", ")||"Sin técnicos asignados";
    const quoteList=d.cotizaciones||[];
    const currentQuote=quoteList[0]||null;
    const quoteSummary=currentQuote
      ? `<div class="timeline-item"><strong>${esc(currentQuote.numero||`Cotización #${currentQuote.id}`)}</strong> ${badge(currentQuote.estado||"BORRADOR")}<br><span class="muted">Versión ${esc(currentQuote.version||"—")} · ${money(currentQuote.total,currentQuote.moneda)}</span></div>`
      : `<div class="muted">Todavía no hay cotización vinculada a esta OT.</div>`;
    const evidence=(d.evidencias||[]).map(evidenceCard).join("")||`<div class="muted">Sin evidencias.</div>`;
    const activities=(d.actividades||[]).map(a=>`<div class="timeline-item"><strong>${esc(a.empleado)}</strong> · ${fmt(a.realizada||a.RealizadaEn)}<br>${esc(a.Descripcion||a.descripcion)}${a.Resultado||a.resultado?`<br><span class="muted">${esc(a.Resultado||a.resultado)}</span>`:""}</div>`).join("")||`<div class="muted">Sin actividades.</div>`;
    const incidents=(d.incidencias||[]).map(i=>`<div class="timeline-item"><strong>${esc(i.tipo)}</strong> ${badge(i.Estado||i.estado)}<br>${esc(i.Descripcion||i.descripcion)}${i.accion?`<br><span class="muted">Acción: ${esc(i.accion)}</span>`:""}<br><span class="muted">${fmt(i.fecha)}</span>${coord&&!i.resuelta?`<div class="actions">${button("Resolver","resolver-incidencia",i.id)}</div>`:""}</div>`).join("")||`<div class="muted">Sin incidencias.</div>`;
    const scopes=(d.cambios_alcance||[]).map(c=>`<div class="timeline-item"><strong>${badge(c.estado)} Cambio de alcance</strong><br>${esc(c.detectado)}<br><span class="muted">Motivo: ${esc(c.motivo||"—")}${c.propuesta?` · Propuesta: ${esc(c.propuesta)}`:""}</span>${c.respuesta?`<br><span class="muted">Respuesta: ${esc(c.respuesta)}</span>`:""}<div class="actions">${coord&&String(c.estado).toUpperCase()==="PENDIENTE"&&!c.informado_por?button("Enviar al cliente","enviar-cambio",c.id):""}${client&&String(c.estado).toUpperCase()==="PENDIENTE"&&c.informado_por?button("Responder","responder-cambio",c.id,"primary"):""}</div></div>`).join("")||`<div class="muted">Sin cambios de alcance.</div>`;
    const history=(d.historial||[]).map(h=>`<div class="timeline-item">${esc(h.anterior||"Inicio")} → <strong>${esc(h.nuevo)}</strong><br><span class="muted">${fmt(h.fecha)} · ${esc(h.Comentario||h.comentario||"")}</span></div>`).join("")||`<div class="muted">Sin historial.</div>`;
    const p=d.progress||{},photos=normalizeNumber(p.fotos_trabajo),acts=normalizeNumber(p.actividades),docs=normalizeNumber(p.documentos_ot);
    const progress=`<section class="panel"><div class="panel-header"><h2>Avance para cierre técnico</h2></div><div class="panel-body"><div class="info-grid"><div class="info-item"><span>Fotos de trabajo</span><strong>${photos}/6 ${photos>=6?"✓":""}</strong></div><div class="info-item"><span>Actividades</span><strong>${acts}</strong></div><div class="info-item"><span>OT / documento físico</span><strong>${docs?"Adjunto ✓":"Opcional si hay actividad"}</strong></div><div class="info-item"><span>Cambios pendientes</span><strong>${normalizeNumber(p.cambios_pendientes)}</strong></div></div></div></section>`;
    let actions="";
    const orderCode=String(x.estado_codigo||"").toUpperCase();
    if(coord||tech){
      const stateControl=allowedStates.length?`<select class="inline-select" id="stateSelect"><option value="">Siguiente estado...</option>${optionList(allowedStates)}</select><button class="btn small primary" data-action="cambiar-estado" data-id="${id}">Aplicar</button>`:"";
      const normalQuoteButton=coord && !["POR_CONFIRMAR","COMPLETADA"].includes(orderCode)
        ? button(currentQuote?"Ver cotizaciones":"Crear cotización",currentQuote?"ir-cotizaciones":"cotizar-orden",id,currentQuote?"":"")
        : "";
      const closurePanel=coord && ["POR_CONFIRMAR","COMPLETADA"].includes(orderCode)
        ? `<section class="panel"><div class="panel-header"><h2>Cierre de la orden</h2></div><div class="panel-body"><p class="muted">La cotización puede realizarse al finalizar el servicio y la OT se marca completada por separado para que ninguna acción se pierda.</p><div class="actions">
            ${button(currentQuote?"Ver cotización":"Realizar cotización",currentQuote?"ir-cotizaciones":"cotizar-orden",id,currentQuote?"":"primary")}
            ${orderCode==="POR_CONFIRMAR"?`<button class="btn small" style="background:#16843d;color:#fff;border-color:#16843d;font-weight:700" type="button" data-action="completar-orden" data-id="${esc(id)}">✓ Completada</button>`:`<span class="badge green">COMPLETADA</span>`}
          </div></div></section>`
        : "";
      actions=`<section class="panel"><div class="panel-header"><h2>Acciones operativas</h2></div><div class="panel-body"><div class="actions">${stateControl}${button("Editar datos","editar-orden",id)}${coord?button("Gestionar cuadrilla","asignar-tecnico",id):""}${coord?button("Asignar equipo","asignar-equipo",id):""}${normalQuoteButton}${button("Registrar actividad","actividad",id)}${button("Incidencia","incidencia",id)}${button("Cambio de alcance","cambio-alcance",id)}${button("Subir evidencia","evidencia",id)}</div>${tech&&orderCode==="EN_PROCESO"?`<p class="muted">Para enviar a confirmación: mínimo 6 fotos del trabajo, una actividad u OT/documento físico y ningún cambio de alcance pendiente.</p>`:""}</div></section>${closurePanel}`;
    } else if(client&&orderCode==="POR_CONFIRMAR"){
      actions=`<section class="panel"><div class="panel-body"><button class="btn primary" data-action="confirmar-orden" data-id="${id}">Confirmar / reportar observación</button></div></section>`;
    }
    const correction=Number(x.requiere_correccion||0)?`<section class="panel"><div class="panel-body"><strong>Corrección solicitada por cliente</strong><p>${esc(x.motivo_correccion||"Pendiente de corrección")}</p></div></section>`:"";
    openModal(`Orden ${x.numero}`,`<div class="info-grid"><div class="info-item"><span>Cliente</span><strong>${esc(x.cliente)}</strong></div><div class="info-item"><span>Sede</span><strong>${esc(x.sede)}</strong></div><div class="info-item"><span>Estado</span><strong>${esc(x.estado)}</strong></div><div class="info-item"><span>Prioridad</span><strong>${esc(x.Prioridad||x.prioridad)}</strong></div><div class="info-item"><span>Servicio</span><strong>${esc(x.tipo)}</strong></div><div class="info-item"><span>Atención aproximada</span><strong>${fmt(x.programada)}</strong></div><div class="info-item"><span>Ticket cliente</span><strong>${esc(x.ticket||"—")}</strong></div><div class="info-item"><span>OT papel</span><strong>${esc(x.orden_papel||"—")}</strong></div><div class="info-item"><span>Ubicación</span><strong>${esc([x.Direccion||x.direccion,x.Municipio||x.municipio].filter(Boolean).join(", ")||x.sede)}</strong></div><div class="info-item"><span>Cuadrilla</span><strong>${techs}</strong></div></div><h3 class="section-title">Solicitud</h3><p>${esc(x.solicitud)}</p>${correction}${progress}${actions}<section class="panel"><div class="panel-header"><h2>Cotización vinculada</h2></div><div class="panel-body">${quoteSummary}${coord&&!currentQuote?`<div class="actions" style="margin-top:10px">${button("Crear cotización desde esta OT","cotizar-orden",id,"primary")}</div>`:""}${currentQuote?`<div class="actions" style="margin-top:10px">${button("Ir al módulo de cotizaciones","ir-cotizaciones",currentQuote.id)}</div>`:""}</div></section><div class="two-col"><div><h3 class="section-title">Actividades</h3><div class="timeline">${activities}</div><h3 class="section-title">Evidencias</h3><div class="evidence-grid">${evidence}</div><h3 class="section-title">Cambios de alcance</h3><div class="timeline">${scopes}</div></div><div><h3 class="section-title">Historial</h3><div class="timeline">${history}</div><h3 class="section-title">Incidencias</h3><div class="timeline">${incidents}</div></div></div>`);
  }

  function backToOrder(id){return `<button class="btn" type="button" data-action="ver-orden" data-id="${id}">Volver a la OT</button>`;}

  async function quickAction(action,id) {
    if(action==="cambiar-estado"){
      const estado_id=$("#stateSelect")?.value;if(!estado_id)return showToast("Selecciona el siguiente estado.","error");
      try{await api(`/api/ordenes/${id}/estado`,{method:"POST",body:{estado_id,comentario:"Cambio desde el panel SEPRIGUA"}});showToast("Estado actualizado.");await openOrder(id);}catch(e){showToast(e.message,"error");}return;
    }
    if(action==="editar-orden")return editOrderForm(id);
    if(action==="completar-orden"){
      const completed=(state.catalogs.estados_orden||[]).find(s=>String(s.codigo||"").toUpperCase()==="COMPLETADA");
      if(!completed)return showToast("No se encontró el estado COMPLETADA en la BD.","error");
      openModal("Marcar orden como completada",`<form id="completeOrderForm" class="form-grid">
        <div class="field full"><p>Esta acción cierra la OT como <strong>COMPLETADA</strong>.</p><p class="muted">Úsala cuando la conformidad del cliente haya sido recibida fuera del portal o ya esté documentada.</p></div>
        <div class="field"><label>Medio de confirmación</label><select name="medio"><option>FIRMA EN OT</option><option>LLAMADA</option><option>WHATSAPP / MENSAJE</option><option>CORREO</option><option>OTRO</option></select></div>
        <div class="field full"><label>Observación de cierre</label><textarea name="observacion" placeholder="Ej. Gerente del cliente confirmó el servicio sin observaciones."></textarea></div>
        <div class="field full"><div class="form-actions">${backToOrder(id)}<button class="btn" style="background:#16843d;color:#fff;border-color:#16843d;font-weight:700">✓ Marcar completada</button></div></div>
      </form>`);
      $("#completeOrderForm").addEventListener("submit",async e=>{
        e.preventDefault();
        const f=Object.fromEntries(new FormData(e.currentTarget).entries());
        const comentario=`Cierre confirmado por ${f.medio||"OTRO"}${f.observacion?`: ${f.observacion}`:""}`;
        try{
          await api(`/api/ordenes/${id}/estado`,{method:"POST",body:{estado_id:completed.id,comentario}});
          showToast("Orden marcada como completada.");
          await openOrder(id);
        }catch(err){showToast(err.message,"error");}
      });
      return;
    }
    if(action==="confirmar-orden"){
      openModal("Confirmación del servicio",`<form id="confirmForm" class="form-grid"><div class="field full"><label>Resultado</label><select name="resultado"><option>CONFORME</option><option>CON_OBSERVACIONES</option><option>NO_CONFORME</option></select></div><div class="field full"><label>Observaciones / corrección requerida</label><textarea name="observaciones" placeholder="Obligatorio si no está conforme"></textarea></div><div class="field full"><div class="form-actions">${backToOrder(id)}<button class="btn primary">Enviar respuesta</button></div></div></form>`);
      $("#confirmForm").addEventListener("submit",async e=>{e.preventDefault();try{const r=await api(`/api/ordenes/${id}/confirmar`,{method:"POST",body:Object.fromEntries(new FormData(e.currentTarget).entries())});showToast(r.message);await openOrder(id);}catch(err){showToast(err.message,"error");}});return;
    }
    if(action==="asignar-tecnico")return crewForm(id);
    if(action==="asignar-equipo"){
      const available=(state.catalogs.equipos||[]).filter(x=>String(x.estado).toUpperCase()==="DISPONIBLE");
      openModal("Asignar equipo",`<form id="miniForm"><div class="field"><label>Equipo</label><select name="equipo_id" required>${optionList(available,"id",x=>`${x.codigo} · ${x.nombre}`)}</select></div><div class="field"><label>Responsable (opcional)</label><select name="empleado_id"><option value="">Sin especificar</option>${optionList(state.catalogs.tecnicos||[],"id",x=>x.nombre)}</select></div><div class="form-actions">${backToOrder(id)}<button class="btn primary">Asignar</button></div></form>`);
      $("#miniForm").addEventListener("submit",async e=>{e.preventDefault();try{await api(`/api/ordenes/${id}/equipos`,{method:"POST",body:Object.fromEntries(new FormData(e.currentTarget).entries())});showToast("Equipo asignado.");await openOrder(id);}catch(err){showToast(err.message,"error");}});return;
    }
    if(action==="actividad"){
      const detail=await api(`/api/ordenes/${id}`),assigned=(detail.tecnicos||[]).filter(t=>String(t.estado).toUpperCase()==="ASIGNADO");
      const employ=state.role==="COORDINADOR"?`<div class="field"><label>Empleado</label><select name="empleado_id" required>${optionList(assigned,"empleado_id",x=>x.nombre)}</select></div>`:"";
      openModal("Registrar actividad",`<form id="miniForm">${employ}<div class="field"><label>Actividad realizada</label><textarea name="descripcion" required></textarea></div><div class="field"><label>Resultado</label><textarea name="resultado"></textarea></div><div class="form-actions">${backToOrder(id)}<button class="btn primary">Guardar</button></div></form>`);
      $("#miniForm").addEventListener("submit",async e=>{e.preventDefault();try{await api(`/api/ordenes/${id}/actividades`,{method:"POST",body:Object.fromEntries(new FormData(e.currentTarget).entries())});showToast("Actividad registrada.");await openOrder(id);}catch(err){showToast(err.message,"error");}});return;
    }
    if(action==="incidencia"){
      openModal("Registrar incidencia",`<form id="miniForm"><div class="field"><label>Tipo</label><select name="tipo"><option>ACCESO</option><option>RETRASO</option><option>SEGURIDAD</option><option>EQUIPO</option><option>PERSONAL</option><option>CLIENTE</option><option>SERVICIO</option><option selected>OTRA</option></select></div><div class="field"><label>Descripción</label><textarea name="descripcion" required></textarea></div><div class="field"><label>Acción tomada</label><textarea name="accion"></textarea></div><div class="form-actions">${backToOrder(id)}<button class="btn primary">Guardar</button></div></form>`);
      $("#miniForm").addEventListener("submit",async e=>{e.preventDefault();try{await api(`/api/ordenes/${id}/incidencias`,{method:"POST",body:Object.fromEntries(new FormData(e.currentTarget).entries())});showToast("Incidencia registrada.");await openOrder(id);}catch(err){showToast(err.message,"error");}});return;
    }
    if(action==="resolver-incidencia"){
      const orderId=window.__currentOrderId||null;
      // El botón de incidencia usa id de incidencia; obtenemos la OT visible desde el título/datos mediante state temporal.
      const oid=state.openOrderId;if(!oid)return showToast("Vuelve a abrir la OT.","error");
      openModal("Resolver incidencia",`<form id="resolveIncident"><div class="field"><label>Acción tomada / solución</label><textarea name="accion" required></textarea></div><div class="form-actions">${backToOrder(oid)}<button class="btn primary">Marcar resuelta</button></div></form>`);
      $("#resolveIncident").addEventListener("submit",async e=>{e.preventDefault();try{await api(`/api/ordenes/${oid}/incidencias/${id}/resolver`,{method:"PATCH",body:Object.fromEntries(new FormData(e.currentTarget).entries())});showToast("Incidencia resuelta.");await openOrder(oid);}catch(err){showToast(err.message,"error");}});return;
    }
    if(action==="cambio-alcance"){
      openModal("Reportar cambio de alcance",`<form id="scopeForm" class="form-grid"><div class="field full"><label>Alcance previsto</label><textarea name="original"></textarea></div><div class="field full"><label>Cambio detectado</label><textarea name="detectado" required></textarea></div><div class="field full"><label>Motivo</label><textarea name="motivo" required></textarea></div><div class="field full"><label>Trabajo adicional / alternativa propuesta</label><textarea name="propuesta"></textarea></div><div class="field full"><div class="form-actions">${backToOrder(id)}<button class="btn primary">Registrar cambio</button></div></div></form>`);
      $("#scopeForm").addEventListener("submit",async e=>{e.preventDefault();try{await api(`/api/ordenes/${id}/cambios-alcance`,{method:"POST",body:Object.fromEntries(new FormData(e.currentTarget).entries())});showToast(state.role==="TECNICO"?"Cambio reportado a coordinación.":"Cambio de alcance registrado.");await openOrder(id);}catch(err){showToast(err.message,"error");}});return;
    }
    if(action==="enviar-cambio"){
      const oid=state.openOrderId;if(!oid)return;
      try{await api(`/api/ordenes/${oid}/cambios-alcance/${id}/enviar`,{method:"POST",body:{}});showToast("Cambio enviado al cliente.");await openOrder(oid);}catch(err){showToast(err.message,"error");}return;
    }
    if(action==="responder-cambio"){
      const oid=state.openOrderId;if(!oid)return;
      openModal("Responder cambio de alcance",`<form id="scopeResponse"><div class="field"><label>Respuesta</label><select name="estado"><option>AUTORIZADO</option><option>RECHAZADO</option><option>ALTERNATIVA</option></select></div><div class="field"><label>Observaciones</label><textarea name="respuesta"></textarea></div><div class="form-actions">${backToOrder(oid)}<button class="btn primary">Responder</button></div></form>`);
      $("#scopeResponse").addEventListener("submit",async e=>{e.preventDefault();try{await api(`/api/ordenes/${oid}/cambios-alcance/${id}/responder`,{method:"POST",body:Object.fromEntries(new FormData(e.currentTarget).entries())});showToast("Respuesta registrada.");await openOrder(oid);}catch(err){showToast(err.message,"error");}});return;
    }
    if(action==="evidencia-solicitud"){
      openModal("Agregar evidencia a solicitud",`<form id="requestEvidenceForm"><div class="field"><label>Imágenes / archivos</label><input type="file" name="archivos" multiple accept="image/*,video/mp4,video/quicktime,application/pdf" required></div><div class="field"><label>Descripción</label><textarea name="descripcion"></textarea></div><div class="form-actions"><button class="btn" type="button" data-action="ver-solicitud" data-id="${id}">Volver</button><button class="btn primary">Subir</button></div></form>`);
      $("#requestEvidenceForm").addEventListener("submit",async e=>{e.preventDefault();const form=e.currentTarget,files=form.querySelector('[name="archivos"]').files,desc=form.querySelector('[name="descripcion"]').value;try{await uploadRequestFiles(id,files,desc);showToast(`${files.length} archivo(s) agregado(s).`);await openRequest(id);}catch(err){showToast(err.message,"error");}});return;
    }
    if(action==="evidencia"){
      openModal("Subir evidencias",`<form id="evidenceForm"><div class="field"><label>Archivos</label><input type="file" name="archivos" multiple accept="image/*,video/mp4,video/quicktime,application/pdf" required></div><div class="field"><label>Etapa</label><select name="etapa"><option>ANTES</option><option selected>DURANTE</option><option>DESPUES</option><option>DOCUMENTO</option></select><small>Para la OT física o PDF usa DOCUMENTO.</small></div><div class="field"><label>Descripción</label><textarea name="descripcion"></textarea></div><div class="form-actions">${backToOrder(id)}<button class="btn primary">Subir</button></div></form>`);
      $("#evidenceForm").addEventListener("submit",async e=>{e.preventDefault();const form=e.currentTarget,files=form.querySelector('[name="archivos"]').files,etapa=form.querySelector('[name="etapa"]').value,descripcion=form.querySelector('[name="descripcion"]').value;try{for(const file of files){const fd=new FormData();fd.append("archivo",file);fd.append("etapa",etapa);fd.append("descripcion",descripcion);if(etapa==="DOCUMENTO")fd.append("categoria","ORDEN_FISICA");await api(`/api/ordenes/${id}/evidencias`,{method:"POST",body:fd});}showToast(`${files.length} evidencia(s) subida(s).`);await openOrder(id);}catch(err){showToast(err.message,"error");}});return;
    }
  }

  async function renderClientes() {
    setHeading("Clientes y sedes", "Consulta clientes, sedes y volumen de solicitudes registrado en la BD."); const d=await api("/api/clientes");
    const rows=d.items.map(x=>`<tr><td>${esc(x.codigo)}</td><td>${esc(x.nombre)}</td><td>${esc(x.Nit||x.nit||"—")}</td><td>${esc(x.telefono||"—")}</td><td>${normalizeNumber(x.sedes)}</td><td>${normalizeNumber(x.contactos)}</td><td>${normalizeNumber(x.solicitudes)}</td><td>${button("Sedes","ver-sedes",x.id)}</td></tr>`);
    content.innerHTML=`<div class="toolbar"><h2>${d.items.length} clientes</h2></div><section class="panel">${table(["Código","Cliente","NIT","Teléfono","Sedes","Contactos","Solicitudes","Acción"],rows)}</section>`;
  }
  async function openSedes(id){const d=await api(`/api/clientes/${id}/sedes`);openModal("Sedes del cliente",table(["Código","Sede","Teléfono","Dirección","Municipio"],d.items.map(x=>`<tr><td>${esc(x.codigo||"—")}</td><td>${esc(x.Nombre||x.nombre)}</td><td>${esc(x.Telefono||x.telefono||"—")}</td><td>${esc(x.Direccion||x.direccion||"—")}</td><td>${esc(x.Municipio||x.municipio||"—")}</td></tr>`),"Este cliente todavía no tiene sedes."));}

  async function renderPersonal(){setHeading("Personal", "Estado laboral y disponibilidad operativa.");const d=await api("/api/personal");const rows=d.items.map(x=>`<tr><td>${esc(x.codigo)}</td><td>${esc(x.nombre)}</td><td>${esc(x.puesto)}</td><td>${badge(x.estado)}</td><td><select class="inline-select availability" data-id="${x.id}"><option ${x.disponibilidad==="DISPONIBLE"?"selected":""}>DISPONIBLE</option><option ${x.disponibilidad==="ASIGNADO"?"selected":""}>ASIGNADO</option><option ${x.disponibilidad==="VACACIONES"?"selected":""}>VACACIONES</option><option ${x.disponibilidad==="INACTIVO"?"selected":""}>INACTIVO</option></select></td><td>${esc(x.telefono||"—")}</td><td>${button("Guardar","guardar-disponibilidad",x.id)}</td></tr>`);content.innerHTML=`<section class="panel">${table(["Código","Nombre","Puesto","Estado","Disponibilidad","Teléfono","Acción"],rows)}</section>`;}

  async function renderEquipos(){setHeading("Equipo", "Inventario técnico, disponibilidad y fallas abiertas.");const d=await api("/api/equipos");const rows=d.items.map(x=>`<tr><td>${esc(x.codigo)}</td><td>${esc(x.Nombre||x.nombre)}</td><td>${esc(x.Categoria||x.categoria||"—")}</td><td>${esc(x.Marca||x.marca||"—")}</td><td>${badge(x.Estado||x.estado)}</td><td>${normalizeNumber(x.fallas_abiertas)}</td><td>${state.role==="COORDINADOR"?`<select class="inline-select equipment-state" data-id="${x.id}"><option>DISPONIBLE</option><option>ASIGNADO</option><option>MANTENIMIENTO</option><option>BAJA</option></select> ${button("Guardar","guardar-equipo",x.id)}`:"—"}</td></tr>`);content.innerHTML=`<section class="panel">${table(["Código","Equipo","Categoría","Marca","Estado","Fallas","Acción"],rows)}</section>`;}

  async function renderMantenimientos(){setHeading("Mantenimiento interno", "Programación y seguimiento del mantenimiento de equipo.");const d=await api("/api/mantenimientos");const rows=d.items.map(x=>`<tr><td class="mono">#${x.id}</td><td>${esc(x.codigo_equipo)} · ${esc(x.equipo)}</td><td>${badge(x.tipo)}</td><td>${badge(x.Estado||x.estado)}</td><td>${fmt(x.programada)}</td><td>${esc(x.Diagnostico||x.diagnostico||"—")}</td><td>${esc(x.Resultado||x.resultado||"—")}</td></tr>`);content.innerHTML=`<div class="toolbar"><h2>${d.items.length} registros</h2>${state.role==="COORDINADOR"?button("Programar mantenimiento","nuevo-mantenimiento","","primary"):""}</div><section class="panel">${table(["ID","Equipo","Tipo","Estado","Programada","Diagnóstico","Resultado"],rows)}</section>`;}
  function maintenanceForm(){openModal("Programar mantenimiento",`<form id="maintenanceForm" class="form-grid"><div class="field"><label>Equipo</label><select name="equipo_id" required>${optionList(state.catalogs.equipos||[],"id",x=>`${x.codigo} · ${x.nombre}`)}</select></div><div class="field"><label>Tipo</label><select name="tipo"><option>PREVENTIVO</option><option>CORRECTIVO</option></select></div><div class="field"><label>Fecha programada</label><input type="datetime-local" name="fecha_programada"></div><div class="field full"><label>Diagnóstico inicial</label><textarea name="diagnostico"></textarea></div><div class="field full"><label>Trabajo requerido</label><textarea name="trabajo_requerido"></textarea></div><div class="field full"><div class="form-actions"><button class="btn primary">Guardar</button></div></div></form>`);$("#maintenanceForm").addEventListener("submit",async e=>{e.preventDefault();try{await api("/api/mantenimientos",{method:"POST",body:Object.fromEntries(new FormData(e.currentTarget).entries())});showToast("Mantenimiento registrado.");closeModal();navigate("mantenimientos");}catch(err){showToast(err.message,"error");}});}

  async function renderVacaciones(){setHeading("Vacaciones", "Consulta de solicitudes de vacaciones.");const d=await api("/api/vacaciones");const rows=d.items.map(x=>`<tr><td>${esc(x.empleado)}</td><td>${fmt(x.solicitada)}</td><td>${fmt(x.inicio)}</td><td>${fmt(x.fin)}</td><td>${esc(x.dias)}</td><td>${badge(x.Estado||x.estado)}</td><td>${esc(x.Motivo||x.motivo||"—")}</td></tr>`);content.innerHTML=`<section class="panel">${table(["Empleado","Solicitada","Inicio","Fin","Días","Estado","Motivo"],rows)}</section>`;}

  async function renderCotizaciones(){
    setHeading("Cotizaciones", "Cotizaciones versionadas y respuesta del cliente; no existe flujo de pagos en el sistema.");
    const d=await api("/api/cotizaciones");
    const rows=d.items.map(x=>{const st=String(x.Estado||x.estado||"").toUpperCase();const actions=[];if(x.orden_id)actions.push(button("Ver OT","ver-orden",x.orden_id));if(state.role==="COORDINADOR"&&["BORRADOR","EN_REVISION","CONFIRMADA"].includes(st))actions.push(button("Enviar al cliente","enviar-cotizacion",x.id,"primary"));if(state.role==="CLIENTE"&&st==="ENVIADA")actions.push(button("Responder","responder-cotizacion",x.id,"primary"));return `<tr><td>${esc(x.numero)}</td><td>${esc(x.cliente)}</td><td>${esc(x.orden)}</td><td>${badge(st)}</td><td>${esc(x.version||"—")}</td><td>${money(x.Total||x.total,x.Moneda||x.moneda)}</td><td>${fmt(x.emision||x.creada)}</td><td><div class="actions">${actions.join("")||"—"}</div></td></tr>`;});
    content.innerHTML=`<div class="toolbar"><h2>${d.items.length} cotizaciones</h2>${state.role==="COORDINADOR"?button("Nueva cotización","nueva-cotizacion","","primary"):""}</div><section class="panel">${table(["No.","Cliente","Orden","Estado","Versión","Total","Fecha","Acción"],rows)}</section>`;
  }
  async function quoteForm(preselectedOrderId=""){
    const od=await api("/api/ordenes");
    const selected=od.items.find(x=>String(x.id)===String(preselectedOrderId));
    openModal(preselectedOrderId?"Crear cotización desde la OT":"Nueva cotización simple",`<form id="quoteForm" class="form-grid">
      <div class="field full"><label>Orden de trabajo</label><select name="orden_id" id="quoteOrder" required><option value="">Seleccione...</option>${optionList(od.items,"id",x=>`${x.numero} · ${x.cliente} · ${x.tipo}`,preselectedOrderId)}</select><small>La cotización queda vinculada directamente a la OT seleccionada.</small></div>
      <div class="field full"><label>Descripción / alcance cotizado</label><textarea name="descripcion" required>${selected?esc(`${selected.tipo} - ${selected.cliente}`):""}</textarea></div>
      <div class="field"><label>Precio</label><input name="precio" type="number" step="0.01" min="0" required></div>
      <div class="field"><label>Vigencia (días)</label><input name="dias_vigencia" type="number" value="15" min="1"></div>
      <div class="field full"><label>Condición comercial</label><input name="condicion_pago" value="POR DEFINIR"><small>El sistema registra la propuesta y autorización; no procesa pagos.</small></div>
      <div class="field full"><div class="form-actions">${preselectedOrderId?backToOrder(preselectedOrderId):`<button class="btn" type="button" data-close-modal>Cancelar</button>`}<button class="btn primary">Crear borrador</button></div></div>
    </form>`);
    $("#quoteForm").addEventListener("submit",async e=>{e.preventDefault();try{
      const result=await api("/api/cotizaciones",{method:"POST",body:Object.fromEntries(new FormData(e.currentTarget).entries())});
      showToast("Cotización creada y vinculada a la OT.");
      if(preselectedOrderId) await openOrder(preselectedOrderId); else {closeModal();navigate("cotizaciones");}
    }catch(err){showToast(err.message,"error");}});
  }

  async function quoteAction(action,id){
    if(action==="enviar-cotizacion"){try{await api(`/api/cotizaciones/${id}/enviar`,{method:"POST",body:{}});showToast("Cotización enviada.");navigate("cotizaciones");}catch(err){showToast(err.message,"error");}return;}
    if(action==="responder-cotizacion"){
      openModal("Responder cotización",`<form id="quoteResponse" class="form-grid"><div class="field"><label>Respuesta</label><select name="respuesta"><option>ACEPTADA</option><option>CAMBIOS</option><option>RECHAZADA</option></select></div><div class="field full"><label>Observaciones</label><textarea name="observaciones" placeholder="Describe cambios o motivo de rechazo cuando aplique"></textarea></div><div class="field full"><div class="form-actions"><button class="btn" type="button" data-close-modal>Cancelar</button><button class="btn primary">Enviar respuesta</button></div></div></form>`);
      $("#quoteResponse").addEventListener("submit",async e=>{e.preventDefault();try{await api(`/api/cotizaciones/${id}/responder`,{method:"POST",body:Object.fromEntries(new FormData(e.currentTarget).entries())});showToast("Respuesta registrada.");closeModal();navigate("cotizaciones");}catch(err){showToast(err.message,"error");}});return;
    }
  }

  async function renderDocumentos(){setHeading("Documentos", "OT, reportes y formatos generados por servicio.");const d=await api("/api/documentos");const rows=d.items.map(x=>`<tr><td>${esc(x.numero||`#${x.id}`)}</td><td>${esc(x.formato)}</td><td>${esc(x.orden)}</td><td>${esc(x.cliente)}</td><td>${badge(x.Estado||x.estado)}</td><td>${fmt(x.generado)}</td><td>${x.ruta?`<a class="btn small" href="${esc(x.ruta)}" target="_blank">Abrir</a>`:"—"}</td></tr>`);content.innerHTML=`<section class="panel">${table(["Documento","Formato","Orden","Cliente","Estado","Generado","Archivo"],rows)}</section>`;}

  async function renderNotificaciones(){setHeading("Notificaciones", "Avisos creados por asignaciones, solicitudes y cambios de estado.");const d=await api("/api/notificaciones");const rows=d.items.map(x=>`<tr><td>${badge(x.tipo)}</td><td><strong>${esc(x.titulo)}</strong><br><span class="muted">${esc(x.mensaje)}</span></td><td>${fmt(x.creada)}</td><td>${x.leida?badge("LEIDA"):button("Marcar leída","leer-notificacion",x.id)}</td></tr>`);content.innerHTML=`<section class="panel">${table(["Tipo","Notificación","Fecha","Estado"],rows)}</section>`;}

  async function renderAuditoria(){setHeading("Auditoría", "Eventos INSERT, UPDATE y DELETE capturados por los TR_AUD_* de SQL Server.");const d=await api("/api/auditoria");const rows=d.items.map(x=>`<tr><td class="mono">#${x.id}</td><td>${fmt(x.fecha)}</td><td>${esc(x.Esquema||x.esquema)}.${esc(x.Tabla||x.tabla)}</td><td>${badge(x.Operacion||x.operacion)}</td><td>${esc(x.usuario)}</td><td>${esc(x.ip||"—")}</td><td>${esc(x.Observacion||x.observacion||"—")}</td></tr>`);content.innerHTML=`<div class="toolbar"><h2>Últimos ${d.items.length} eventos</h2>${button("Probar auditoría","probar-auditoria","","primary")}</div><section class="panel">${table(["ID","Fecha","Tabla","Operación","Usuario","IP","Observación"],rows)}</section>`;}

  async function renderGarantia(){setHeading("Garantías", "Una garantía se registra como solicitud de seguimiento y queda auditada igual que cualquier servicio.");content.innerHTML=`<section class="panel"><div class="panel-body"><h2>Solicitar seguimiento de garantía</h2><p class="muted">Selecciona la sede y describe el servicio anterior o el motivo de revisión.</p><button class="btn primary" data-action="solicitar-garantia">Nueva solicitud de garantía</button></div></section>`;}

  document.addEventListener("click", async e => {
    const moduleBtn=e.target.closest("[data-module]"); if(moduleBtn){navigate(moduleBtn.dataset.module);$("#sidebar").classList.remove("open");return;}
    if(e.target.closest("[data-close-modal]")){closeModal();return;}
    const b=e.target.closest("[data-action]"); if(!b)return; const a=b.dataset.action,id=b.dataset.id;
    try {
      if(a==="nueva-solicitud") return requestForm(false); if(a==="solicitar-garantia") return requestForm(true); if(a==="ver-solicitud") return openRequest(id); if(a==="crear-ot-solicitud"){closeModal();return orderForm(id);} if(a==="nueva-orden") return orderForm(); if(a==="ver-orden") return openOrder(id); if(["cambiar-estado","completar-orden","confirmar-orden","asignar-tecnico","asignar-equipo","actividad","incidencia","resolver-incidencia","cambio-alcance","enviar-cambio","responder-cambio","editar-orden","evidencia","evidencia-solicitud"].includes(a)) return quickAction(a,id);
      if(a==="cotizar-orden") return quoteForm(id);
      if(a==="ir-cotizaciones"){closeModal();return navigate("cotizaciones");}
      if(a==="ver-sedes") return openSedes(id); if(a==="nuevo-mantenimiento") return maintenanceForm(); if(a==="nueva-cotizacion") return quoteForm(); if(["enviar-cotizacion","responder-cotizacion"].includes(a)) return quoteAction(a,id);
      if(a==="guardar-disponibilidad"){const sel=$(`.availability[data-id="${CSS.escape(id)}"]`);await api(`/api/personal/${id}/disponibilidad`,{method:"PATCH",body:{disponibilidad:sel.value}});return showToast("Disponibilidad actualizada.");}
      if(a==="guardar-equipo"){const sel=$(`.equipment-state[data-id="${CSS.escape(id)}"]`);await api(`/api/equipos/${id}/estado`,{method:"PATCH",body:{estado:sel.value}});showToast("Estado actualizado.");return navigate("equipos");}
      if(a==="leer-notificacion"){await api(`/api/notificaciones/${id}/leer`,{method:"POST",body:{}});showToast("Notificación leída.");return navigate("notificaciones");}
      if(a==="probar-auditoria"){const d=await api("/api/auditoria/prueba",{method:"POST",body:{}});showToast(d.message);return navigate("auditoria");}
    } catch(err){showToast(err.message,"error");}
  });

  $("#modalClose").addEventListener("click",closeModal); modalBackdrop.addEventListener("click",e=>{if(e.target===modalBackdrop)closeModal();});
  $("#menuButton").addEventListener("click",()=>$("#sidebar").classList.toggle("open"));
  $("#logoutButton").addEventListener("click",async()=>{try{await api("/api/auth/logout",{method:"POST",body:{}});}catch(_){}location.replace("/login");});
  document.addEventListener("keydown",e=>{if(e.key==="Escape")closeModal();});
  window.lucide?.createIcons(); init();
})();
