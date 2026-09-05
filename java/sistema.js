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
  const topDate = $("#topDate");
  const topUser = $("#topUser");
  const topRole = $("#topRole");
  const moduleHeroIcon = $("#moduleHeroIcon");
  const notificationButton = $("#notificationButton");
  const notificationDot = $("#notificationDot");
  const notificationCount = $("#notificationCount");
  const notificationPopover = $("#notificationPopover");
  const notificationPreview = $("#notificationPreview");
  const userMenuButton = $("#userMenuButton");
  const userPopover = $("#userPopover");
  const userPopoverName = $("#userPopoverName");
  const userPopoverEmail = $("#userPopoverEmail");
  const userPopoverRole = $("#userPopoverRole");
  const modalBackdrop = $("#modalBackdrop");
  const modalBody = $("#modalBody");
  const modalTitle = $("#modalTitle");
  const toast = $("#toast");

  const state = { user: null, role: "", catalogs: {}, current: "dashboard", openOrderId: null, orderDetail: null, orderStep: "resumen", notifications: [], notificationFilter: "TODAS", unreadNotifications: 0, account: null };
  const rolePaths = { COORDINADOR: "/sistema/coordinador", TECNICO: "/sistema/tecnico", CLIENTE: "/sistema/cliente" };
  const modules = {
    COORDINADOR: [
      ["dashboard", "layout-dashboard", "Panel"], ["solicitudes", "inbox", "Solicitudes"], ["ordenes", "clipboard-list", "Órdenes"],
      ["clientes", "building-2", "Clientes"], ["personal", "users", "Personal"], ["equipos", "wrench", "Equipo"],
      ["mantenimientos", "settings", "Mantenimiento"], ["cotizaciones", "file-text", "Cotizaciones"], ["documentos", "files", "Documentos"],
      ["notificaciones", "bell", "Notificaciones"], ["cuenta", "user-cog", "Mi cuenta"], ["auditoria", "shield-check", "Auditoría"]
    ],
    TECNICO: [
      ["dashboard", "layout-dashboard", "Mi panel"], ["ordenes", "clipboard-check", "Mis órdenes"], ["equipos", "wrench", "Equipo"],
      ["mantenimientos", "settings", "Mantenimiento"], ["vacaciones", "calendar-days", "Vacaciones"], ["notificaciones", "bell", "Notificaciones"], ["cuenta", "user-cog", "Mi cuenta"]
    ],
    CLIENTE: [
      ["dashboard", "layout-dashboard", "Mi panel"], ["solicitudes", "circle-plus", "Solicitudes"], ["ordenes", "clipboard-list", "Mis servicios"],
      ["cotizaciones", "file-text", "Cotizaciones"], ["documentos", "files", "Documentos"], ["garantia", "shield-check", "Garantía"],
      ["notificaciones", "bell", "Notificaciones"], ["cuenta", "user-cog", "Mi cuenta"]
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
  function currentModuleIcon(module = state.current) {
    const item = (modules[state.role] || []).find(([key]) => key === module);
    return item?.[1] || "layout-dashboard";
  }
  function syncPrototypeChrome() {
    if (topDate) {
      const now = new Date();
      const weekday = now.toLocaleDateString("es-GT", { weekday: "long" });
      const date = now.toLocaleDateString("es-GT", { day: "2-digit", month: "long", year: "numeric" });
      topDate.innerHTML = `${esc(date)}<small>${esc(weekday.charAt(0).toUpperCase() + weekday.slice(1))}</small>`;
    }
    if (topUser) topUser.textContent = state.user?.nombre || state.user?.usuario || "Usuario SEPRIGUA";
    if (topRole) topRole.textContent = String(state.role || "Portal operativo").replaceAll("_", " ");
    if (userPopoverName) userPopoverName.textContent = state.user?.nombre || state.user?.usuario || "Usuario SEPRIGUA";
    if (userPopoverEmail) userPopoverEmail.textContent = state.user?.correo || "Cuenta del sistema";
    if (userPopoverRole) userPopoverRole.textContent = String(state.role || "Portal operativo").replaceAll("_", " ");
    if (moduleHeroIcon) moduleHeroIcon.innerHTML = `<i data-lucide="${esc(currentModuleIcon())}"></i>`;
    window.lucide?.createIcons();
  }
  function setHeading(name, description) { eyebrow.textContent = `SEPRIGUA · ${state.role}`; title.textContent = name; subtitle.textContent = description; syncPrototypeChrome(); }
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


  function closeTopPopovers(except = null) {
    [[notificationPopover, notificationButton], [userPopover, userMenuButton]].forEach(([popover, trigger]) => {
      if (!popover || popover === except) return;
      popover.hidden = true;
      trigger?.setAttribute("aria-expanded", "false");
    });
  }

  function notificationIcon(type) {
    const value = String(type || "").toUpperCase();
    if (/SEGURIDAD/.test(value)) return "shield-check";
    if (/COTIZ/.test(value)) return "receipt-text";
    if (/CAMBIO|ALCANCE/.test(value)) return "route";
    if (/ASIGN/.test(value)) return "hard-hat";
    if (/SOLICIT/.test(value)) return "inbox";
    if (/ESTADO|ORDEN|CONFIRM/.test(value)) return "clipboard-check";
    return "bell-ring";
  }

  function notificationTargetLabel(entity) {
    const value = String(entity || "").toLowerCase();
    if (value === "ordentrabajo") return "Abrir OT";
    if (value === "solicitudservicio") return "Abrir solicitud";
    if (value === "cotizacion") return "Ir a cotización";
    if (value === "cambioalcance") return "Ir a órdenes";
    return "Ver detalle";
  }

  function notificationTargetButton(item, compact = false) {
    if (!item?.entidad_id && !item?.entidad) return "";
    return `<button class="btn small ${compact ? "ghost" : ""}" type="button" data-action="abrir-notificacion" data-id="${esc(item.id)}" data-entity="${esc(item.entidad || "")}" data-entity-id="${esc(item.entidad_id || "")}">${esc(notificationTargetLabel(item.entidad))}</button>`;
  }

  function renderNotificationPreview(items = []) {
    if (!notificationPreview) return;
    if (!items.length) {
      notificationPreview.innerHTML = `<div class="popover-empty"><i data-lucide="bell-off"></i><strong>Sin notificaciones</strong><span>No tienes avisos pendientes.</span></div>`;
      window.lucide?.createIcons(); return;
    }
    notificationPreview.innerHTML = items.map(x => `
      <article class="preview-notification ${x.leida ? "read" : "unread"}">
        <span class="notification-symbol"><i data-lucide="${notificationIcon(x.tipo)}"></i></span>
        <div class="preview-notification-copy"><strong>${esc(x.titulo)}</strong><p>${esc(x.mensaje)}</p><small>${fmt(x.creada)}</small></div>
        <div class="preview-notification-actions">${x.entidad ? `<button class="mini-open" type="button" data-action="abrir-notificacion" data-id="${esc(x.id)}" data-entity="${esc(x.entidad||"")}" data-entity-id="${esc(x.entidad_id||"")}" aria-label="Abrir notificación"><i data-lucide="arrow-up-right"></i></button>` : ""}${!x.leida ? `<button class="mini-read" type="button" data-action="leer-notificacion" data-id="${esc(x.id)}" aria-label="Marcar como leída"><i data-lucide="check"></i></button>` : ""}</div>
      </article>`).join("");
    window.lucide?.createIcons();
  }

  async function refreshNotificationBadge(loadPreview = false) {
    const d = await api("/api/notificaciones/resumen");
    const unread = normalizeNumber(d.no_leidas);
    state.unreadNotifications = unread;
    if (notificationDot) notificationDot.hidden = unread < 1;
    if (notificationCount) {
      notificationCount.hidden = unread < 1;
      notificationCount.textContent = unread > 99 ? "99+" : String(unread);
    }
    if (state.role) renderNav();
    if (loadPreview || (notificationPopover && !notificationPopover.hidden)) renderNotificationPreview(d.items || []);
    return d;
  }

  async function openNotificationTarget(entity, entityId, notificationId = null) {
    if (notificationId) {
      try { await api(`/api/notificaciones/${notificationId}/leer`, { method: "POST", body: {} }); } catch (_) {}
      refreshNotificationBadge().catch(()=>{});
    }
    closeTopPopovers();
    const kind = String(entity || "").toLowerCase();
    if (kind === "ordentrabajo" && entityId) return openOrder(entityId, "resumen", true);
    if (kind === "solicitudservicio" && entityId && state.role !== "TECNICO") return openRequest(entityId);
    if (kind === "cotizacion") return navigate("cotizaciones");
    if (kind === "cambioalcance") return navigate("ordenes");
    if (kind === "usuario") return navigate("cuenta");
    return navigate("notificaciones");
  }

  async function performLogout() {
    try { await api("/api/auth/logout", { method: "POST", body: {} }); } catch (_) {}
    location.replace("/login");
  }

  async function init() {
    try {
      const me = await api("/api/auth/me"); state.user = me.user; state.role = String(me.user.rol || "").toUpperCase();
      const expected = rolePaths[state.role]; if (!expected) return location.replace("/login");
      if (location.pathname !== expected) return location.replace(expected);
      roleChip.textContent = state.role;
      syncPrototypeChrome();
      renderNav();
      const [cats, health] = await Promise.all([api("/api/catalogos"), api("/api/db/health")]);
      state.catalogs = cats;
      dbBadgeText.textContent = health.system_migration ? `${health.database} · lista` : `${health.database} · falta SQL 003`;
      if (!health.system_migration) dbBadge.classList.add("error");
      refreshNotificationBadge().catch(()=>{});
      clearInterval(init.notificationTimer);
      init.notificationTimer = setInterval(()=>refreshNotificationBadge().catch(()=>{}), 60000);
      await navigate("dashboard");
    } catch (e) {
      dbBadge.classList.add("error"); dbBadgeText.textContent = "Sin conexión";
      content.innerHTML = `<div class="empty-state"><h3>No se pudo iniciar el sistema</h3><p>${esc(e.message)}</p><p>Comprueba el backend y las migraciones SQL.</p></div>`;
    }
  }

  function renderNav() {
    nav.innerHTML = (modules[state.role] || []).map(([key, icon, name]) => {
      const count = key === "notificaciones" && state.unreadNotifications > 0 ? `<b class="nav-notification-count">${state.unreadNotifications > 99 ? "99+" : state.unreadNotifications}</b>` : "";
      return `<button class="nav-button ${key === state.current ? "active" : ""}" type="button" data-module="${key}"><i data-lucide="${icon}"></i><span>${esc(name)}</span>${count}</button>`;
    }).join("");
    window.lucide?.createIcons();
  }

  async function navigate(module) {
    state.current = module; syncPrototypeChrome(); renderNav(); loading();
    try {
      const map = { dashboard: renderDashboard, solicitudes: renderSolicitudes, ordenes: renderOrdenes, clientes: renderClientes, personal: renderPersonal, equipos: renderEquipos, mantenimientos: renderMantenimientos, vacaciones: renderVacaciones, cotizaciones: renderCotizaciones, documentos: renderDocumentos, notificaciones: renderNotificaciones, cuenta: renderCuenta, auditoria: renderAuditoria, garantia: renderGarantia };
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
    const statIcons = {
      solicitudes_pendientes:"inbox", ordenes_activas:"clipboard-check", emergencias:"siren", tecnicos_disponibles:"hard-hat",
      equipos_disponibles:"wrench", clientes_activos:"building-2", cotizaciones_pendientes:"receipt-text", mantenimientos_pendientes:"settings",
      hoy:"calendar-check-2", finalizadas:"circle-check-big", incidencias:"triangle-alert", solicitudes:"file-plus-2",
      servicios_activos:"activity", completados:"badge-check", documentos:"folder-open"
    };
    const statTones = ["blue","red","violet","cyan","green","amber"];
    const cards = Object.entries(d.cards || {}).map(([k,v], index) => `<article class="stat-card stat-${statTones[index % statTones.length]}"><div class="stat-icon" aria-hidden="true"><i data-lucide="${esc(statIcons[k] || "chart-no-axes-column-increasing")}"></i></div><div class="stat-copy"><span>${esc(labels[k] || k.replaceAll("_"," "))}</span><strong>${normalizeNumber(v)}</strong></div><span class="stat-spark" aria-hidden="true"></span></article>`).join("");
    const recentRows = (d.recent || []).map(x => `<tr><td>${esc(x.numero || x.tipo || `#${x.id}`)}</td><td>${esc(x.cliente || x.descripcion || "—")}</td><td>${esc(x.sede || x.clasificacion || "—")}</td><td>${badge(x.estado || x.prioridad || "")}</td><td>${fmt(x.programada || x.fecha)}</td>${x.numero ? `<td>${button("Ver","ver-orden",x.id)}</td>` : ""}</tr>`);
    let chart = "";
    if ((d.chart || []).length) {
      const max = Math.max(1, ...d.chart.map(x => normalizeNumber(x.ordenes)));
      chart = `<section class="panel"><div class="panel-header"><h2>Órdenes de los últimos 6 meses</h2></div><div class="panel-body chart">${d.chart.map(x => `<div class="bar-row"><span>${esc(x.mes)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.round(normalizeNumber(x.ordenes)/max*100)}%"></div></div><strong>${normalizeNumber(x.ordenes)}</strong></div>`).join("")}</div></section>`;
    }
    content.innerHTML = `<section class="stats-grid">${cards}</section><section class="panel"><div class="panel-header"><h2>Actividad reciente</h2></div>${table(["Registro","Cliente / detalle","Sede / tipo","Estado","Fecha", ...(state.role !== "CLIENTE" || (d.recent || []).some(x=>x.numero) ? ["Acción"] : [])], recentRows, "Todavía no hay actividad para mostrar.")}</section>${chart}`;
    window.lucide?.createIcons();
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
    const allowed=(code==="PENDIENTE"||code==="PROGRAMADA")?["EN_PROCESO"]:(code==="EN_PROCESO"||code==="POR_CONFIRMAR")?["COMPLETADA"]:[];
    return states.filter(s=>allowed.includes(String(s.codigo).toUpperCase()));
  }

  function orderStepButton(id,key,number,label,done,active){
    return `<button class="order-step ${done?"done":""} ${active===key?"active":""}" type="button" data-action="orden-paso" data-id="${esc(id)}" data-step="${esc(key)}"><span class="order-step-number">${done?"✓":number}</span><span><strong>${esc(label)}</strong><small>${done?"Listo":"Pendiente"}</small></span></button>`;
  }

  function orderStepper(id,active,d,x){
    const p=d.progress||{},code=String(x.estado_codigo||"").toUpperCase();
    const step1=!!String(x.ticket||"").trim() && !!String(x.orden_papel||"").trim() && normalizeNumber(p.documentos_ot)>0;
    const step2=normalizeNumber(p.fotos_trabajo)>=6;
    const step3=normalizeNumber(p.actividades)>=1;
    const step4=code==="COMPLETADA";
    return `<section class="order-stepper" aria-label="Flujo de cierre técnico">
      ${orderStepButton(id,"documento",1,"OT / OC y ticket",step1,active)}
      ${orderStepButton(id,"evidencia",2,"Evidencia",step2,active)}
      ${orderStepButton(id,"descripcion",3,"Descripción",step3,active)}
      ${orderStepButton(id,"finalizar",4,"Finalizar OT",step4,active)}
    </section>`;
  }

  function orderEvidenceBy(d,predicate){return (d.evidencias||[]).filter(predicate);}

  async function uploadOrderFiles(id,files,{etapa="DURANTE",categoria="FOTO_TRABAJO",descripcion=""}={}){
    for(const file of [...files]){
      const fd=new FormData();
      fd.append("archivo",file); fd.append("etapa",etapa); fd.append("categoria",categoria);
      if(descripcion)fd.append("descripcion",descripcion);
      await api(`/api/ordenes/${id}/evidencias`,{method:"POST",body:fd});
    }
  }

  function orderHeader(id,x){
    return `<div class="toolbar order-workspace-toolbar"><div class="toolbar-left"><button class="btn" type="button" data-action="volver-ordenes">← Volver a órdenes</button><span class="badge">${esc(x.numero)}</span>${badge(x.estado)}</div><div class="toolbar-right">${button("Resumen","orden-paso",id,"primary")}</div></div>`;
  }

  async function openOrder(id, step="resumen", refresh=true) {
    closeModal();
    state.openOrderId=Number(id); state.orderStep=step||"resumen";
    if(refresh || !state.orderDetail || Number(state.orderDetail?.item?.id)!==Number(id)) state.orderDetail=await api(`/api/ordenes/${id}`);
    const d=state.orderDetail,x=d.item;
    const tech=state.role==="TECNICO",coord=state.role==="COORDINADOR",client=state.role==="CLIENTE";
    if(client && state.orderStep!=="resumen")state.orderStep="resumen";
    setHeading(`Orden ${x.numero}`, `${x.cliente} · ${x.tipo} · ${x.sede||"Sede sin nombre"}`);

    const activeTechs=(d.tecnicos||[]).filter(t=>String(t.estado||t.Estado).toUpperCase()==="ASIGNADO");
    const techs=activeTechs.map(t=>`${esc(t.nombre)} (${esc(t.funcion||"TECNICO")})`).join(", ")||"Sin técnicos asignados";
    const quoteList=d.cotizaciones||[],currentQuote=quoteList[0]||null;
    const orderCode=String(x.estado_codigo||"").toUpperCase();
    const p=d.progress||{},photos=normalizeNumber(p.fotos_trabajo),acts=normalizeNumber(p.actividades),docs=normalizeNumber(p.documentos_ot),pendingScopes=normalizeNumber(p.cambios_pendientes);
    const isCoralsa=/CORALSA/i.test(String(x.cliente||""));
    const shellStart=`<div class="order-workspace">${orderHeader(id,x)}${(coord||tech)?orderStepper(id,state.orderStep,d,x):""}`;
    const shellEnd=`</div>`;

    if(state.orderStep==="documento" && (coord||tech)){
      const docEvidence=orderEvidenceBy(d,e=>String(e.etapa||"").toUpperCase()==="DOCUMENTO"||String(e.categoria||"").toUpperCase()==="ORDEN_FISICA");
      content.innerHTML=`${shellStart}<section class="panel order-screen"><div class="panel-header"><div><span class="eyebrow">PASO 1 DE 4</span><h2>Registrar ticket y OT / OC física</h2></div></div><div class="panel-body">
        <div class="notice-card"><strong>Documento de respaldo</strong><p>${isCoralsa?"Para CORALSA, la fotografía de la OT u OC debe mostrar firma y sello.":"Sube la fotografía o PDF de la OT u OC firmada cuando corresponda."}</p></div>
        <form id="orderDocForm" class="form-grid" autocomplete="off">
          <div class="field"><label>Número de ticket</label><input name="ticket" maxlength="60" value="${esc(x.ticket||"")}" required></div>
          <div class="field"><label>Número de OT u OC</label><input name="orden_papel" maxlength="60" value="${esc(x.orden_papel||"")}" required></div>
          <div class="field full"><label>Foto o PDF de la OT / OC <small>${docs?"Ya existe un documento; puedes agregar otro si hace falta.":"Necesario para completar este paso."}</small></label><input type="file" name="archivos" multiple accept="image/*,application/pdf"></div>
          <div class="field full"><label>Descripción del documento <small>(opcional)</small></label><textarea name="descripcion" placeholder="Ej. OT firmada por encargado de sede${isCoralsa?" y sellada":""}."></textarea></div>
          <div class="field full"><div class="form-actions"><button class="btn" type="button" data-action="orden-paso" data-id="${esc(id)}" data-step="resumen">Volver al resumen</button><button class="btn primary" type="submit">Guardar y continuar</button></div></div>
        </form>
        <h3 class="section-title">Documentos cargados</h3><div class="evidence-grid">${docEvidence.map(evidenceCard).join("")||`<div class="muted">Todavía no hay OT / OC física adjunta.</div>`}</div>
      </div></section>${shellEnd}`;
      $("#orderDocForm")?.addEventListener("submit",async e=>{e.preventDefault();const form=e.currentTarget,fd=new FormData(form),files=form.querySelector('[name="archivos"]').files;try{await api(`/api/ordenes/${id}`,{method:"PATCH",body:{ticket:fd.get("ticket"),orden_papel:fd.get("orden_papel")}});if(files.length)await uploadOrderFiles(id,files,{etapa:"DOCUMENTO",categoria:"ORDEN_FISICA",descripcion:fd.get("descripcion")||""});showToast("Paso 1 guardado.");await openOrder(id,"evidencia",true);}catch(err){showToast(err.message,"error");}});
      window.lucide?.createIcons(); return;
    }

    if(state.orderStep==="evidencia" && (coord||tech)){
      const workEvidence=orderEvidenceBy(d,e=>String(e.categoria||"").toUpperCase()==="FOTO_TRABAJO");
      content.innerHTML=`${shellStart}<section class="panel order-screen"><div class="panel-header"><div><span class="eyebrow">PASO 2 DE 4</span><h2>Subir evidencia del servicio</h2></div><span class="badge ${photos>=6?"green":"orange"}">${photos}/6 fotos</span></div><div class="panel-body">
        <p class="muted">Carga las fotografías que demuestran el trabajo realizado. El cierre técnico requiere al menos 6 fotos.</p>
        <form id="orderEvidenceForm" class="form-grid">
          <div class="field full"><label>Fotografías</label><input type="file" name="archivos" multiple accept="image/*" required></div>
          <div class="field"><label>Etapa</label><select name="etapa"><option>DURANTE</option><option selected>DESPUES</option></select></div>
          <div class="field full"><label>Descripción <small>(opcional)</small></label><textarea name="descripcion" placeholder="Describe lo que muestran las fotografías."></textarea></div>
          <div class="field full"><div class="form-actions"><button class="btn" type="button" data-action="orden-paso" data-id="${esc(id)}" data-step="documento">Anterior</button><button class="btn primary" type="submit">Subir y continuar</button></div></div>
        </form>
        <h3 class="section-title">Evidencia cargada</h3><div class="evidence-grid">${workEvidence.map(evidenceCard).join("")||`<div class="muted">Todavía no hay fotografías del trabajo.</div>`}</div>
      </div></section>${shellEnd}`;
      $("#orderEvidenceForm")?.addEventListener("submit",async e=>{e.preventDefault();const form=e.currentTarget,fd=new FormData(form),files=form.querySelector('[name="archivos"]').files;try{await uploadOrderFiles(id,files,{etapa:fd.get("etapa")||"DESPUES",categoria:"FOTO_TRABAJO",descripcion:fd.get("descripcion")||""});showToast(`${files.length} fotografía(s) guardada(s).`);await openOrder(id,"descripcion",true);}catch(err){showToast(err.message,"error");}});
      window.lucide?.createIcons(); return;
    }

    if(state.orderStep==="descripcion" && (coord||tech)){
      const activities=(d.actividades||[]).map(a=>`<div class="timeline-item"><strong>${esc(a.empleado)}</strong> · ${fmt(a.realizada||a.RealizadaEn)}<br>${esc(a.Descripcion||a.descripcion)}${a.Resultado||a.resultado?`<br><span class="muted">Observación: ${esc(a.Resultado||a.resultado)}</span>`:""}</div>`).join("")||`<div class="muted">Todavía no hay descripción final registrada.</div>`;
      const employeeField=coord?`<div class="field"><label>Técnico responsable</label><select name="empleado_id" required><option value="">Seleccione...</option>${optionList(activeTechs,"empleado_id",t=>t.nombre)}</select></div>`:"";
      content.innerHTML=`${shellStart}<section class="panel order-screen"><div class="panel-header"><div><span class="eyebrow">PASO 3 DE 4</span><h2>Descripción y observaciones del trabajo</h2></div><span class="badge ${acts?"green":"orange"}">${acts?"Registrado":"Pendiente"}</span></div><div class="panel-body">
        <form id="orderDescriptionForm" class="form-grid">${employeeField}<div class="field full"><label>Descripción del servicio realizado</label><textarea name="descripcion" required placeholder="Detalla qué se realizó en la OT."></textarea></div><div class="field full"><label>Observaciones</label><textarea name="resultado" placeholder="Resultado, hallazgos, recomendaciones o notas para el cliente."></textarea></div><div class="field full"><div class="form-actions"><button class="btn" type="button" data-action="orden-paso" data-id="${esc(id)}" data-step="evidencia">Anterior</button><button class="btn primary" type="submit">Guardar y continuar</button></div></div></form>
        <h3 class="section-title">Registros del servicio</h3><div class="timeline">${activities}</div>
      </div></section>${shellEnd}`;
      $("#orderDescriptionForm")?.addEventListener("submit",async e=>{e.preventDefault();try{await api(`/api/ordenes/${id}/actividades`,{method:"POST",body:Object.fromEntries(new FormData(e.currentTarget).entries())});showToast("Descripción y observaciones guardadas.");await openOrder(id,"finalizar",true);}catch(err){showToast(err.message,"error");}});
      window.lucide?.createIcons(); return;
    }

    if(state.orderStep==="finalizar" && (coord||tech)){
      const checks=[
        [!!String(x.ticket||"").trim(),"Ticket registrado"],
        [!!String(x.orden_papel||"").trim(),"Número de OT u OC registrado"],
        [docs>0,`OT / OC física adjunta${isCoralsa?" con firma y sello":""}`],
        [photos>=6,`Evidencia fotográfica (${photos}/6)`],
        [acts>=1,"Descripción y observaciones registradas"],
        [pendingScopes===0,"Sin cambios de alcance pendientes"]
      ];
      const ready=checks.every(c=>c[0]);
      let finishAction="";
      if(orderCode==="COMPLETADA") finishAction=`<div class="completion-banner"><strong>✓ OT finalizada</strong><span>El cierre técnico ya quedó registrado. La cotización puede enviarse antes o después y no modifica este estado.</span></div>`;
      else if(tech && ["PENDIENTE","PROGRAMADA"].includes(orderCode)) finishAction=`<div class="notice-card"><strong>Primero inicia el trabajo</strong><p>La OT debe estar EN PROCESO antes de poder finalizarla.</p><button class="btn primary" type="button" data-action="iniciar-orden" data-id="${esc(id)}">Iniciar trabajo</button></div>`;
      else if(tech && ["EN_PROCESO","POR_CONFIRMAR"].includes(orderCode)) finishAction=`<div class="final-action"><button class="btn finish-button" type="button" data-action="finalizar-tecnico" data-id="${esc(id)}" ${ready?"":"disabled"}>✓ Marcar OT como finalizada</button><p class="muted">${ready?"Este cierre es independiente de la cotización.":"Completa los puntos pendientes antes de finalizar."}</p></div>`;
      else if(coord) finishAction=`<div class="notice-card"><strong>Cierre por técnico</strong><p>La OT la marca como finalizada un técnico asignado. Coordinación puede crear o enviar la cotización antes o después desde el resumen de esta OT o desde Cotizaciones.</p></div>`;
      content.innerHTML=`${shellStart}<section class="panel order-screen"><div class="panel-header"><div><span class="eyebrow">PASO 4 DE 4</span><h2>Finalizar orden de trabajo</h2></div></div><div class="panel-body"><div class="check-list">${checks.map(([ok,label])=>`<div class="check-item ${ok?"ok":"pending"}"><span>${ok?"✓":"○"}</span><strong>${esc(label)}</strong></div>`).join("")}</div>${finishAction}<div class="form-actions"><button class="btn" type="button" data-action="orden-paso" data-id="${esc(id)}" data-step="descripcion">Anterior</button><button class="btn" type="button" data-action="orden-paso" data-id="${esc(id)}" data-step="resumen">Ir al resumen</button></div></div></section>${shellEnd}`;
      window.lucide?.createIcons(); return;
    }

    const quoteSummary=currentQuote
      ? `<div class="timeline-item"><strong>${esc(currentQuote.numero||`Cotización #${currentQuote.id}`)}</strong> ${badge(currentQuote.estado||"BORRADOR")}<br><span class="muted">Versión ${esc(currentQuote.version||"—")} · ${money(currentQuote.total,currentQuote.moneda)}</span></div>`
      : `<div class="muted">Todavía no hay cotización vinculada. Puede crearse antes o después de finalizar la OT.</div>`;
    const quoteActions=coord
      ? `<div class="actions" style="margin-top:10px">${currentQuote?button("Ir a cotizaciones","ir-cotizaciones",currentQuote.id):button("Crear cotización","cotizar-orden",id,"primary")}</div>`
      : currentQuote?`<div class="actions" style="margin-top:10px">${button("Ver cotización","ir-cotizaciones",currentQuote.id,"primary")}</div>`:"";
    const correction=Number(x.requiere_correccion||0)?`<section class="panel"><div class="panel-body"><strong>Corrección solicitada por cliente</strong><p>${esc(x.motivo_correccion||"Pendiente de corrección")}</p></div></section>`:"";
    const recentHistory=(d.historial||[]).slice(0,8).map(h=>`<div class="timeline-item">${esc(h.anterior||"Inicio")} → <strong>${esc(h.nuevo)}</strong><br><span class="muted">${fmt(h.fecha)} · ${esc(h.Comentario||h.comentario||"")}</span></div>`).join("")||`<div class="muted">Sin historial.</div>`;
    const incidents=(d.incidencias||[]).slice(0,6).map(i=>`<div class="timeline-item"><strong>${esc(i.tipo)}</strong> ${badge(i.Estado||i.estado)}<br>${esc(i.Descripcion||i.descripcion)}${i.accion?`<br><span class="muted">Acción: ${esc(i.accion)}</span>`:""}${coord&&!i.resuelta?`<div class="actions">${button("Resolver","resolver-incidencia",i.id)}</div>`:""}</div>`).join("")||`<div class="muted">Sin incidencias.</div>`;
    const scopes=(d.cambios_alcance||[]).slice(0,6).map(c=>`<div class="timeline-item"><strong>${badge(c.estado)} Cambio de alcance</strong><br>${esc(c.detectado)}<br><span class="muted">${esc(c.motivo||"")}</span><div class="actions">${coord&&String(c.estado).toUpperCase()==="PENDIENTE"&&!c.informado_por?button("Enviar al cliente","enviar-cambio",c.id):""}${client&&String(c.estado).toUpperCase()==="PENDIENTE"&&c.informado_por?button("Responder","responder-cambio",c.id,"primary"):""}</div></div>`).join("")||`<div class="muted">Sin cambios de alcance.</div>`;
    const allowedCoordStates=(state.catalogs.estados_orden||[]).filter(s=>String(s.codigo||"").toUpperCase()!=="COMPLETADA");
    const stateControl=coord&&orderCode!=="COMPLETADA"?`<select class="inline-select" id="stateSelect"><option value="">Cambiar estado...</option>${optionList(allowedCoordStates)}</select><button class="btn small primary" data-action="cambiar-estado" data-id="${esc(id)}">Aplicar</button>`:"";
    const startButton=tech&&["PENDIENTE","PROGRAMADA"].includes(orderCode)?button("Iniciar trabajo","iniciar-orden",id,"primary"):"";
    const opActions=(coord||tech)?`<section class="panel"><div class="panel-header"><h2>Acciones de la OT</h2></div><div class="panel-body"><div class="actions">${stateControl}${startButton}${coord?button("Editar datos","editar-orden",id):""}${coord?button("Gestionar cuadrilla","asignar-tecnico",id):""}${coord?button("Asignar equipo","asignar-equipo",id):""}${button("Incidencia","incidencia",id)}${button("Cambio de alcance","cambio-alcance",id)}</div>${tech?`<p class="muted">El cierre técnico se realiza en las cuatro pantallas superiores. La cotización no bloquea el cierre.</p>`:""}</div></section>`:"";
    const legacyConfirm=client&&orderCode==="POR_CONFIRMAR"?`<section class="panel"><div class="panel-body"><button class="btn primary" data-action="confirmar-orden" data-id="${esc(id)}">Confirmar / reportar observación</button></div></section>`:"";

    content.innerHTML=`${shellStart}<section class="panel"><div class="panel-header"><h2>Resumen de la orden</h2></div><div class="panel-body"><div class="info-grid"><div class="info-item"><span>Cliente</span><strong>${esc(x.cliente)}</strong></div><div class="info-item"><span>Sede</span><strong>${esc(x.sede)}</strong></div><div class="info-item"><span>Estado</span><strong>${esc(x.estado)}</strong></div><div class="info-item"><span>Prioridad</span><strong>${esc(x.Prioridad||x.prioridad)}</strong></div><div class="info-item"><span>Servicio</span><strong>${esc(x.tipo)}</strong></div><div class="info-item"><span>Atención aproximada</span><strong>${fmt(x.programada)}</strong></div><div class="info-item"><span>Ticket</span><strong>${esc(x.ticket||"—")}</strong></div><div class="info-item"><span>OT / OC</span><strong>${esc(x.orden_papel||"—")}</strong></div><div class="info-item"><span>Ubicación</span><strong>${esc([x.Direccion||x.direccion,x.Municipio||x.municipio].filter(Boolean).join(", ")||x.sede)}</strong></div><div class="info-item"><span>Cuadrilla</span><strong>${techs}</strong></div></div><h3 class="section-title">Solicitud</h3><p>${esc(x.solicitud)}</p></div></section>
      ${correction}${opActions}${legacyConfirm}
      <section class="panel"><div class="panel-header"><h2>Cotización</h2><span class="muted">Independiente del cierre técnico</span></div><div class="panel-body">${quoteSummary}${quoteActions}</div></section>
      <div class="two-col"><section class="panel"><div class="panel-header"><h2>Historial reciente</h2></div><div class="panel-body"><div class="timeline">${recentHistory}</div></div></section><section class="panel"><div class="panel-header"><h2>Incidencias</h2></div><div class="panel-body"><div class="timeline">${incidents}</div></div></section></div>
      <section class="panel"><div class="panel-header"><h2>Cambios de alcance</h2></div><div class="panel-body"><div class="timeline">${scopes}</div></div></section>${shellEnd}`;
    window.lucide?.createIcons();
  }

  function backToOrder(id){return `<button class="btn" type="button" data-action="ver-orden" data-id="${id}">Volver a la OT</button>`;}

  async function quickAction(action,id) {
    if(action==="iniciar-orden"){
      const target=(state.catalogs.estados_orden||[]).find(s=>String(s.codigo||"").toUpperCase()==="EN_PROCESO");
      if(!target)return showToast("No se encontró el estado EN_PROCESO en la BD.","error");
      try{await api(`/api/ordenes/${id}/estado`,{method:"POST",body:{estado_id:target.id,comentario:"Inicio de trabajo registrado por el técnico"}});showToast("Trabajo iniciado.");await openOrder(id,state.orderStep==="finalizar"?"finalizar":"resumen",true);}catch(err){showToast(err.message,"error");}return;
    }
    if(action==="finalizar-tecnico"){
      const completed=(state.catalogs.estados_orden||[]).find(s=>String(s.codigo||"").toUpperCase()==="COMPLETADA");
      if(!completed)return showToast("No se encontró el estado COMPLETADA en la BD.","error");
      try{await api(`/api/ordenes/${id}/estado`,{method:"POST",body:{estado_id:completed.id,comentario:"Cierre técnico completado desde el flujo de 4 pasos"}});showToast("OT finalizada correctamente.");await openOrder(id,"finalizar",true);}catch(err){showToast(err.message,"error");}return;
    }
    if(action==="cambiar-estado"){
      const estado_id=$("#stateSelect")?.value;if(!estado_id)return showToast("Selecciona el siguiente estado.","error");
      try{await api(`/api/ordenes/${id}/estado`,{method:"POST",body:{estado_id,comentario:"Cambio desde el panel SEPRIGUA"}});showToast("Estado actualizado.");await openOrder(id);}catch(e){showToast(e.message,"error");}return;
    }
    if(action==="editar-orden")return editOrderForm(id);
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

  function paintNotificationList() {
    const host = $("#notificationList");
    if (!host) return;
    const filter = state.notificationFilter;
    const source = state.notifications || [];
    const items = source.filter(x => filter === "TODAS" || (filter === "NO_LEIDAS" ? !x.leida : !!x.leida));
    $$("[data-notification-filter]").forEach(btn => btn.classList.toggle("active", btn.dataset.notificationFilter === filter));
    if (!items.length) {
      host.innerHTML = `<div class="notification-empty"><span><i data-lucide="bell-off"></i></span><h3>${filter === "NO_LEIDAS" ? "Todo está al día" : "No hay notificaciones"}</h3><p>${filter === "NO_LEIDAS" ? "No tienes avisos pendientes de lectura." : "Cuando ocurra un cambio importante aparecerá aquí."}</p></div>`;
      window.lucide?.createIcons(); return;
    }
    host.innerHTML = items.map(x => `
      <article class="notification-card ${x.leida ? "is-read" : "is-unread"}">
        <div class="notification-card-icon"><i data-lucide="${notificationIcon(x.tipo)}"></i></div>
        <div class="notification-card-copy">
          <div class="notification-card-title"><strong>${esc(x.titulo)}</strong>${x.leida ? `<span class="read-label">Leída</span>` : `<span class="unread-label">Nueva</span>`}</div>
          <p>${esc(x.mensaje)}</p>
          <div class="notification-card-meta"><span>${esc(String(x.tipo || "AVISO").replaceAll("_", " "))}</span><span>•</span><time>${fmt(x.creada)}</time>${x.canal ? `<span>•</span><span>${esc(x.canal)}</span>` : ""}</div>
        </div>
        <div class="notification-card-actions">${notificationTargetButton(x)}${!x.leida ? button("Marcar leída", "leer-notificacion", x.id) : ""}</div>
      </article>`).join("");
    window.lucide?.createIcons();
  }

  async function renderNotificaciones(){
    setHeading("Notificaciones", "Avisos en tiempo real de solicitudes, asignaciones, órdenes, cambios de alcance y cotizaciones.");
    const d=await api("/api/notificaciones");
    state.notifications=d.items||[];
    state.unreadNotifications=normalizeNumber(d.no_leidas ?? state.notifications.filter(x=>!x.leida).length);
    const total=state.notifications.length, unread=state.unreadNotifications, read=Math.max(0,total-unread);
    content.innerHTML=`
      <section class="notification-summary-grid">
        <article class="notification-summary-card"><span class="summary-icon"><i data-lucide="bell-ring"></i></span><div><small>Total de avisos</small><strong>${total}</strong></div></article>
        <article class="notification-summary-card accent"><span class="summary-icon"><i data-lucide="circle-alert"></i></span><div><small>Pendientes de leer</small><strong>${unread}</strong></div></article>
        <article class="notification-summary-card"><span class="summary-icon"><i data-lucide="circle-check-big"></i></span><div><small>Revisadas</small><strong>${read}</strong></div></article>
      </section>
      <section class="panel notification-center">
        <div class="panel-header notification-center-header"><div><h2>Centro de notificaciones</h2><p class="muted">Cada usuario ve únicamente los avisos asociados a su propia cuenta.</p></div><div class="actions"><button class="btn small" type="button" data-action="refrescar-notificaciones"><i data-lucide="refresh-cw"></i> Actualizar</button><button class="btn small primary" type="button" data-action="leer-todas-notificaciones" ${unread?"":"disabled"}>Marcar todas leídas</button></div></div>
        <div class="notification-filterbar"><button type="button" class="notification-filter ${state.notificationFilter==="TODAS"?"active":""}" data-notification-filter="TODAS">Todas <b>${total}</b></button><button type="button" class="notification-filter ${state.notificationFilter==="NO_LEIDAS"?"active":""}" data-notification-filter="NO_LEIDAS">No leídas <b>${unread}</b></button><button type="button" class="notification-filter ${state.notificationFilter==="LEIDAS"?"active":""}" data-notification-filter="LEIDAS">Leídas <b>${read}</b></button></div>
        <div class="notification-list" id="notificationList"></div>
      </section>`;
    paintNotificationList();
    refreshNotificationBadge().catch(()=>{});
  }

  function accountValue(label, value, icon="info") {
    return `<div class="account-data-item"><span class="account-data-icon"><i data-lucide="${icon}"></i></span><div><small>${esc(label)}</small><strong>${esc(value || "—")}</strong></div></div>`;
  }

  function describeAgent(agent) {
    const a=String(agent||"");
    const os=/Windows/i.test(a)?"Windows":/Android/i.test(a)?"Android":/iPhone|iPad/i.test(a)?"iPhone / iPad":/Macintosh/i.test(a)?"macOS":"Dispositivo";
    const browser=/Edg\//.test(a)?"Edge":/Chrome\//.test(a)?"Chrome":/Firefox\//.test(a)?"Firefox":/Safari\//.test(a)?"Safari":"Navegador";
    return `${os} · ${browser}`;
  }

  async function renderCuenta(){
    setHeading("Mi cuenta", "Consulta tus datos, protege tu contraseña y administra las sesiones activas de tu usuario.");
    const [profileData, sessionsData]=await Promise.all([api("/api/cuenta"),api("/api/cuenta/sesiones")]);
    const p=profileData.item||{}; state.account=p;
    const isClient=state.role==="CLIENTE";
    const roleDetails=isClient
      ? `${accountValue("Empresa",p.cliente,"building-2")}${accountValue("Código de cliente",p.cliente_codigo,"badge-check")}${accountValue("NIT",p.cliente_nit,"hash")}${accountValue("Teléfono de empresa",p.cliente_telefono,"phone")}${accountValue("Correo de empresa",p.cliente_correo,"mail")}`
      : `${accountValue("Código de empleado",p.empleado_codigo,"badge-check")}${accountValue("Puesto",p.puesto,"briefcase-business")}${accountValue("Disponibilidad",p.disponibilidad,"activity")}${accountValue("Teléfono",p.telefono,"phone")}${accountValue("Correo laboral",p.correo_personal,"mail")}`;
    const sessions=(sessionsData.items||[]).map(x=>`<article class="session-card ${x.actual?"current":""}"><span class="session-device"><i data-lucide="monitor-smartphone"></i></span><div class="session-copy"><div><strong>${esc(describeAgent(x.agente))}</strong>${x.actual?`<span class="session-current">Sesión actual</span>`:""}</div><p>${esc(x.ip||"IP no disponible")} · inició ${fmt(x.iniciada)}</p><small>Expira ${fmt(x.expira)}</small></div></article>`).join("")||`<div class="empty-state">No hay sesiones activas para mostrar.</div>`;
    content.innerHTML=`
      <section class="account-hero-card"><div class="account-avatar"><i data-lucide="user-round"></i></div><div class="account-hero-copy"><span>${esc(state.role.replaceAll("_"," "))}</span><h2>${esc(p.nombre||state.user.nombre||state.user.usuario)}</h2><p>${esc(p.usuario||state.user.usuario)}${p.cliente?` · ${esc(p.cliente)}`:""}</p></div><div class="account-status"><span></span> Cuenta activa</div></section>
      <div class="account-grid">
        <section class="panel account-panel"><div class="panel-header"><div><h2>Información del perfil</h2><p class="muted">Datos vinculados a tu rol en SEPRIGUA.</p></div></div><div class="panel-body"><div class="account-data-grid">${accountValue("Nombre",p.nombre,"user-round")}${accountValue("Usuario",p.usuario,"at-sign")}${accountValue("Rol",state.role.replaceAll("_"," "),"shield-check")}${accountValue("Último acceso",fmt(p.ultimo_acceso),"clock-3")}${roleDetails}</div></div></section>
        <section class="panel account-panel"><div class="panel-header"><div><h2>Correo de acceso</h2><p class="muted">Se utiliza para identificar tu cuenta junto con tu nombre de usuario.</p></div></div><div class="panel-body"><form id="accountEmailForm" class="account-form"><div class="field"><label>Correo de la cuenta</label><input type="email" name="correo" value="${esc(p.correo_acceso||"")}" placeholder="usuario@empresa.com" required></div><div class="form-actions"><button class="btn primary" type="submit">Guardar correo</button></div></form></div></section>
        <section class="panel account-panel password-panel"><div class="panel-header"><div><h2>Seguridad y contraseña</h2><p class="muted">Para cambiarla debes confirmar primero tu contraseña actual.</p></div></div><div class="panel-body"><form id="passwordForm" class="account-form"><div class="field"><label>Contraseña actual</label><div class="password-control"><input type="password" name="actual" autocomplete="current-password" required><button type="button" class="password-toggle" data-toggle-password aria-label="Mostrar contraseña"><i data-lucide="eye"></i></button></div></div><div class="field"><label>Nueva contraseña</label><div class="password-control"><input type="password" name="nueva" autocomplete="new-password" minlength="8" required><button type="button" class="password-toggle" data-toggle-password aria-label="Mostrar contraseña"><i data-lucide="eye"></i></button></div><small>Mínimo 8 caracteres, con mayúscula, minúscula y número.</small></div><div class="field"><label>Confirmar nueva contraseña</label><div class="password-control"><input type="password" name="confirmacion" autocomplete="new-password" minlength="8" required><button type="button" class="password-toggle" data-toggle-password aria-label="Mostrar contraseña"><i data-lucide="eye"></i></button></div></div><div class="form-actions"><button class="btn primary" type="submit">Cambiar contraseña</button></div></form></div></section>
        <section class="panel account-panel sessions-panel"><div class="panel-header"><div><h2>Sesiones activas</h2><p class="muted">Revisa desde dónde está abierta tu cuenta.</p></div><button class="btn small danger" type="button" data-action="cerrar-otras-sesiones" ${(sessionsData.items||[]).filter(x=>!x.actual).length?"":"disabled"}>Cerrar otras sesiones</button></div><div class="panel-body"><div class="session-list">${sessions}</div></div></section>
      </div>`;
    window.lucide?.createIcons();

    $("#accountEmailForm")?.addEventListener("submit",async e=>{e.preventDefault();const form=e.currentTarget;const submit=form.querySelector('button[type="submit"]');submit.disabled=true;try{const result=await api("/api/cuenta",{method:"PATCH",body:Object.fromEntries(new FormData(form).entries())});state.user.correo=result.item?.correo_acceso||form.correo.value;showToast("Correo de acceso actualizado.");syncPrototypeChrome();refreshNotificationBadge().catch(()=>{});}catch(err){showToast(err.message,"error");}finally{submit.disabled=false;}});
    $("#passwordForm")?.addEventListener("submit",async e=>{e.preventDefault();const form=e.currentTarget;const data=Object.fromEntries(new FormData(form).entries());if(data.nueva!==data.confirmacion)return showToast("La confirmación de la nueva contraseña no coincide.","error");const submit=form.querySelector('button[type="submit"]');submit.disabled=true;try{await api("/api/cuenta/contrasena",{method:"POST",body:data});form.reset();showToast("Contraseña actualizada correctamente.");refreshNotificationBadge().catch(()=>{});}catch(err){showToast(err.message,"error");}finally{submit.disabled=false;}});
  }


  async function renderAuditoria(){setHeading("Auditoría", "Eventos INSERT, UPDATE y DELETE capturados por los TR_AUD_* de SQL Server.");const d=await api("/api/auditoria");const rows=d.items.map(x=>`<tr><td class="mono">#${x.id}</td><td>${fmt(x.fecha)}</td><td>${esc(x.Esquema||x.esquema)}.${esc(x.Tabla||x.tabla)}</td><td>${badge(x.Operacion||x.operacion)}</td><td>${esc(x.usuario)}</td><td>${esc(x.ip||"—")}</td><td>${esc(x.Observacion||x.observacion||"—")}</td></tr>`);content.innerHTML=`<div class="toolbar"><h2>Últimos ${d.items.length} eventos</h2>${button("Probar auditoría","probar-auditoria","","primary")}</div><section class="panel">${table(["ID","Fecha","Tabla","Operación","Usuario","IP","Observación"],rows)}</section>`;}

  async function renderGarantia(){setHeading("Garantías", "Una garantía se registra como solicitud de seguimiento y queda auditada igual que cualquier servicio.");content.innerHTML=`<section class="panel"><div class="panel-body"><h2>Solicitar seguimiento de garantía</h2><p class="muted">Selecciona la sede y describe el servicio anterior o el motivo de revisión.</p><button class="btn primary" data-action="solicitar-garantia">Nueva solicitud de garantía</button></div></section>`;}

  document.addEventListener("click", async e => {
    const moduleBtn=e.target.closest("[data-module]");
    if(moduleBtn){closeTopPopovers();navigate(moduleBtn.dataset.module);$("#sidebar").classList.remove("open");return;}
    if(e.target.closest("[data-close-modal]")){closeModal();return;}
    if(e.target.closest("[data-close-popover]")){closeTopPopovers();return;}

    const passwordToggle=e.target.closest("[data-toggle-password]");
    if(passwordToggle){
      const input=passwordToggle.closest(".password-control")?.querySelector("input");
      if(input){const show=input.type==="password";input.type=show?"text":"password";passwordToggle.innerHTML=`<i data-lucide="${show?"eye-off":"eye"}"></i>`;window.lucide?.createIcons();}
      return;
    }

    const filterBtn=e.target.closest("[data-notification-filter]");
    if(filterBtn){state.notificationFilter=filterBtn.dataset.notificationFilter||"TODAS";paintNotificationList();return;}

    const b=e.target.closest("[data-action]"); if(!b)return; const a=b.dataset.action,id=b.dataset.id;
    try {
      if(a==="nueva-solicitud") return requestForm(false); if(a==="solicitar-garantia") return requestForm(true); if(a==="ver-solicitud") return openRequest(id); if(a==="crear-ot-solicitud"){closeModal();return orderForm(id);} if(a==="nueva-orden") return orderForm(); if(a==="ver-orden") return openOrder(id,"resumen",true);
      if(a==="volver-ordenes") return navigate("ordenes");
      if(a==="orden-paso") return openOrder(id,b.dataset.step||"resumen",false);
      if(["cambiar-estado","iniciar-orden","finalizar-tecnico","confirmar-orden","asignar-tecnico","asignar-equipo","actividad","incidencia","resolver-incidencia","cambio-alcance","enviar-cambio","responder-cambio","editar-orden","evidencia","evidencia-solicitud"].includes(a)) return quickAction(a,id);
      if(a==="cotizar-orden") return quoteForm(id);
      if(a==="ir-cotizaciones"){closeModal();return navigate("cotizaciones");}
      if(a==="ver-sedes") return openSedes(id); if(a==="nuevo-mantenimiento") return maintenanceForm(); if(a==="nueva-cotizacion") return quoteForm(); if(["enviar-cotizacion","responder-cotizacion"].includes(a)) return quoteAction(a,id);
      if(a==="guardar-disponibilidad"){const sel=$(`.availability[data-id="${CSS.escape(id)}"]`);await api(`/api/personal/${id}/disponibilidad`,{method:"PATCH",body:{disponibilidad:sel.value}});return showToast("Disponibilidad actualizada.");}
      if(a==="guardar-equipo"){const sel=$(`.equipment-state[data-id="${CSS.escape(id)}"]`);await api(`/api/equipos/${id}/estado`,{method:"PATCH",body:{estado:sel.value}});showToast("Estado actualizado.");return navigate("equipos");}
      if(a==="leer-notificacion"){
        await api(`/api/notificaciones/${id}/leer`,{method:"POST",body:{}});showToast("Notificación leída.");
        if(state.current==="notificaciones") return renderNotificaciones();
        return refreshNotificationBadge(true);
      }
      if(a==="leer-todas-notificaciones"){
        const result=await api("/api/notificaciones/leer-todas",{method:"POST",body:{}});showToast(result.message||"Notificaciones actualizadas.");
        if(state.current==="notificaciones") return renderNotificaciones();
        return refreshNotificationBadge(true);
      }
      if(a==="refrescar-notificaciones") return renderNotificaciones();
      if(a==="ver-todas-notificaciones"){closeTopPopovers();return navigate("notificaciones");}
      if(a==="abrir-notificacion") return openNotificationTarget(b.dataset.entity,b.dataset.entityId,id);
      if(a==="abrir-cuenta"){closeTopPopovers();return navigate("cuenta");}
      if(a==="cerrar-otras-sesiones"){
        const result=await api("/api/cuenta/sesiones/cerrar-otras",{method:"POST",body:{}});showToast(result.message||"Otras sesiones cerradas.");return renderCuenta();
      }
      if(a==="cerrar-sesion") return performLogout();
      if(a==="probar-auditoria"){const d=await api("/api/auditoria/prueba",{method:"POST",body:{}});showToast(d.message);return navigate("auditoria");}
    } catch(err){showToast(err.message,"error");}
  });

  notificationButton?.addEventListener("click",async e=>{
    e.stopPropagation();
    const opening=notificationPopover.hidden;
    closeTopPopovers(opening?notificationPopover:null);
    notificationPopover.hidden=!opening;
    notificationButton.setAttribute("aria-expanded",String(opening));
    if(opening){notificationPreview.innerHTML=`<div class="popover-loading">Cargando avisos...</div>`;try{await refreshNotificationBadge(true);}catch(err){notificationPreview.innerHTML=`<div class="popover-empty"><strong>No se pudieron cargar</strong><span>${esc(err.message)}</span></div>`;}window.lucide?.createIcons();}
  });

  userMenuButton?.addEventListener("click",e=>{
    e.stopPropagation();
    const opening=userPopover.hidden;
    closeTopPopovers(opening?userPopover:null);
    userPopover.hidden=!opening;
    userMenuButton.setAttribute("aria-expanded",String(opening));
    syncPrototypeChrome();
  });

  document.addEventListener("click",e=>{
    if(!e.target.closest(".top-action-wrap")) closeTopPopovers();
  });

  $("#modalClose").addEventListener("click",closeModal); modalBackdrop.addEventListener("click",e=>{if(e.target===modalBackdrop)closeModal();});
  $("#menuButton").addEventListener("click",()=>$("#sidebar").classList.toggle("open"));
  $("#logoutButton").addEventListener("click",performLogout);
  document.addEventListener("keydown",e=>{if(e.key==="Escape"){closeModal();closeTopPopovers();}});
  window.lucide?.createIcons(); init();
})();
