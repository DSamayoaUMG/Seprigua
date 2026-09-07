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
  const shell = $("#systemShell");
  const sidebar = $("#sidebar");
  const sidebarScrim = $("#sidebarScrim");
  const sidebarCollapseButton = $("#sidebarCollapseButton");
  const menuButton = $("#menuButton");
  const sidebarUserName = $("#sidebarUserName");
  const sidebarUserRole = $("#sidebarUserRole");
  const notificationPopoverHome = notificationPopover?.parentElement || null;
  const userPopoverHome = userPopover?.parentElement || null;

  function syncPopoverPortal() {
    const mobile = window.matchMedia("(max-width: 820px)").matches;
    [[notificationPopover, notificationPopoverHome], [userPopover, userPopoverHome]].forEach(([popover, home]) => {
      if (!popover || !home) return;
      if (mobile) {
        if (popover.parentElement !== document.body) document.body.appendChild(popover);
      } else if (popover.parentElement !== home) {
        home.appendChild(popover);
      }
    });
  }

  const state = { user: null, role: "", catalogs: {}, current: "dashboard", openOrderId: null, orderDetail: null, orderStep: "resumen", notifications: [], notificationFilter: "TODAS", unreadNotifications: 0, account: null, masterCatalog: [], catalogFilter: { q: "", categoria: "TODAS" }, equipmentFilter: { q: "", estado: "TODOS", categoria: "TODAS" }, userAdmin: { q: "", rol_id: "", estado: "", fecha_desde: "", fecha_hasta: "", pagina: 1, tamano: 10, orden: "FECHA", direccion: "DESC", total: 0, paginas: 1, catalogos: null }, clientSites: [], warranties: [], warrantyRequests: [], warrantyTimer: null };
  const rolePaths = { COORDINADOR: "/sistema/coordinador", TECNICO: "/sistema/tecnico", CLIENTE: "/sistema/cliente" };
  const modules = {
    COORDINADOR: [
      ["dashboard", "layout-dashboard", "Panel"], ["solicitudes", "inbox", "Solicitudes"], ["ordenes", "clipboard-list", "Órdenes"],
      ["clientes", "building-2", "Clientes"], ["personal", "users", "Personal"], ["usuarios", "users-round-cog", "Usuarios"], ["equipos", "wrench", "Equipo"],
      ["mantenimientos", "settings", "Mantenimiento"], ["catalogo", "book-open-check", "Catálogo maestro"], ["cotizaciones", "file-text", "Cotizaciones"], ["documentos", "files", "Documentos"], ["garantia", "shield-check", "Garantías"],
      ["notificaciones", "bell", "Notificaciones"], ["cuenta", "user-cog", "Mi cuenta"], ["auditoria", "shield-check", "Auditoría"]
    ],
    TECNICO: [
      ["dashboard", "layout-dashboard", "Mi panel"], ["ordenes", "clipboard-check", "Mis órdenes"], ["equipos", "wrench", "Equipo"],
      ["mantenimientos", "settings", "Mantenimiento"], ["vacaciones", "calendar-days", "Vacaciones"], ["notificaciones", "bell", "Notificaciones"], ["cuenta", "user-cog", "Mi cuenta"]
    ],
    CLIENTE: [
      ["dashboard", "layout-dashboard", "Mi panel"], ["solicitudes", "circle-plus", "Solicitudes"], ["sedes", "map-pinned", "Mis sedes"], ["ordenes", "clipboard-list", "Mis servicios"],
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
    const label = x === "COMPLETADA" ? "FINALIZADA" : (x === "POR_CONFIRMAR" ? "LISTA PARA FINALIZAR" : x.replaceAll("_", " "));
    return `<span class="badge ${cls}">${esc(label)}</span>`;
  }
  function button(label, action, id = "", cls = "") { return `<button class="btn small ${cls}" type="button" data-action="${esc(action)}" ${id ? `data-id="${esc(id)}"` : ""}>${esc(label)}</button>`; }
  function table(headers, rows, empty = "No hay registros.") {
    if (!rows.length) return `<div class="empty-state">${esc(empty)}</div>`;
    const labelled = rows.map(row => {
      let index = 0;
      return String(row).replace(/<td([^>]*)>/g, (match, attrs) => {
        const label = headers[index++] || "";
        return `<td${attrs} data-label="${esc(label)}">`;
      });
    });
    return `<div class="table-wrap"><table class="data-table"><thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${labelled.join("")}</tbody></table></div>`;
  }
  function optionList(items, valueKey = "id", text = x => x.nombre || x.name || x.codigo || x.id, selected = "") {
    return items.map(x => `<option value="${esc(x[valueKey])}" ${String(x[valueKey]) === String(selected) ? "selected" : ""}>${esc(text(x))}</option>`).join("");
  }
  function showToast(message, type = "success") {
    toast.textContent = message; toast.className = `toast ${type}`; toast.hidden = false;
    clearTimeout(showToast.t); showToast.t = setTimeout(() => { toast.hidden = true; }, 3500);
  }
  let modalProtection = { locked: false, reason: "" };

  function openModal(name, html, options = {}) {
    modalTitle.textContent = name;
    modalBody.innerHTML = html;

    // Los modales con formularios se consideran principales por defecto.
    // No se cierran por clic accidental fuera ni con Escape.
    const containsForm = /<form\b/i.test(String(html || ""));
    modalProtection.locked = options.lockBackdrop ?? containsForm;
    modalProtection.reason = options.reason || (modalProtection.locked ? "formulario" : "");
    modalBackdrop.dataset.protected = modalProtection.locked ? "true" : "false";

    modalBackdrop.hidden = false;
    window.lucide?.createIcons();
  }

  function closeModal() {
    modalBackdrop.hidden = true;
    modalBody.innerHTML = "";
    modalProtection = { locked: false, reason: "" };
    delete modalBackdrop.dataset.protected;
  }

  function warnProtectedModal() {
    const modal = modalBackdrop.querySelector(".modal");
    modal?.classList.remove("modal-attention");
    // Reinicia la animación si el usuario vuelve a tocar el fondo.
    void modal?.offsetWidth;
    modal?.classList.add("modal-attention");
    setTimeout(() => modal?.classList.remove("modal-attention"), 420);
    showToast("Este formulario sigue abierto. Usa Cancelar o × para cerrarlo.", "info");
  }
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
    if (sidebarUserName) sidebarUserName.textContent = state.user?.nombre || state.user?.usuario || "Usuario SEPRIGUA";
    if (sidebarUserRole) sidebarUserRole.textContent = String(state.role || "Portal operativo").replaceAll("_", " ");
    if (moduleHeroIcon) moduleHeroIcon.innerHTML = `<i data-lucide="${esc(currentModuleIcon())}"></i>`;
    window.lucide?.createIcons();
  }
  function setHeading(name, description) { eyebrow.textContent = `SEPRIGUA · ${state.role}`; title.textContent = name; subtitle.textContent = description; syncPrototypeChrome(); }
  function loading() { content.innerHTML = `<div class="loading-card">Cargando...</div>`; }

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
    if (kind === "cotizacion") return (state.role === "CLIENTE" && entityId) ? openClientQuoteFlow(entityId) : navigate("cotizaciones");
    if (kind === "cambioalcance") return navigate("ordenes");
    if (kind === "usuario") return navigate("cuenta");
    return navigate("notificaciones");
  }

  async function performLogout() {
    try { await api("/api/auth/logout", { method: "POST", body: {} }); } catch (_) {}
    location.replace("/login");
  }

  function setSidebarOpen(open){
    const mobile = window.matchMedia("(max-width: 820px)").matches;
    if (!mobile) return;
    sidebar?.classList.toggle("open", !!open);
    if (sidebarScrim) { sidebarScrim.hidden = !open; sidebarScrim.classList.toggle("show", !!open); }
    menuButton?.setAttribute("aria-expanded", String(!!open));
    document.body.classList.toggle("sidebar-mobile-open", !!open);
  }

  function applySidebarPreference(){
    if (window.matchMedia("(max-width: 820px)").matches){
      document.body.classList.remove("sidebar-collapsed");
      setSidebarOpen(false);
      return;
    }
    const collapsed = localStorage.getItem("seprigua_sidebar_collapsed") === "1";
    document.body.classList.toggle("sidebar-collapsed", collapsed);
    if (sidebarCollapseButton){
      sidebarCollapseButton.innerHTML = `<i data-lucide="${collapsed?"panel-left-open":"panel-left-close"}"></i>`;
      sidebarCollapseButton.title = collapsed ? "Mostrar menú" : "Ocultar menú";
      sidebarCollapseButton.setAttribute("aria-label", sidebarCollapseButton.title);
    }
    window.lucide?.createIcons();
  }

  function toggleDesktopSidebar(){
    if (window.matchMedia("(max-width: 820px)").matches) return setSidebarOpen(!sidebar?.classList.contains("open"));
    const collapsed = !document.body.classList.contains("sidebar-collapsed");
    document.body.classList.toggle("sidebar-collapsed", collapsed);
    localStorage.setItem("seprigua_sidebar_collapsed", collapsed ? "1" : "0");
    applySidebarPreference();
  }

  async function init() {
    if (init.started) return;
    init.started = true;
    syncPopoverPortal();
    applySidebarPreference();
    try {
      const me = await api("/api/auth/me"); state.user = me.user; state.role = String(me.user.rol || "").toUpperCase();
      document.body.dataset.role = state.role.toLowerCase();
      const expected = rolePaths[state.role]; if (!expected) return location.replace("/login");
      // Todas las rutas de rol sirven la misma interfaz. Ajustar la URL con History API evita
      // una recarga completa adicional al entrar y elimina el salto visual al panel inicial.
      if (location.pathname !== expected) history.replaceState(null, "", expected);
      roleChip.textContent = state.role;
      syncPrototypeChrome();
      renderNav();
      const [cats, health] = await Promise.all([api("/api/catalogos"), api("/api/db/health")]);
      state.catalogs = cats;
      dbBadgeText.textContent = health.system_migration ? "Sistema conectado" : "Configuración pendiente";
      dbBadge.classList.toggle("error", !health.system_migration);
      refreshNotificationBadge().catch(()=>{});
      clearInterval(init.notificationTimer);
      init.notificationTimer = setInterval(()=>refreshNotificationBadge().catch(()=>{}), 60000);
      const key = `seprigua_modulo_${state.role}`;
      const saved = sessionStorage.getItem(key);
      const valid = new Set((modules[state.role] || []).map(([module]) => module));
      await navigate(saved && valid.has(saved) ? saved : "dashboard");
    } catch (e) {
      dbBadge.classList.add("error"); dbBadgeText.textContent = "Sin conexión";
      content.innerHTML = `<div class="empty-state"><h3>No se pudo iniciar el sistema</h3><p>${esc(e.message)}</p><p>Comprueba el backend y la configuración del sistema.</p></div>`;
    }
  }

  function renderNav() {
    nav.innerHTML = (modules[state.role] || []).map(([key, icon, name]) => {
      const count = key === "notificaciones" && state.unreadNotifications > 0 ? `<b class="nav-notification-count">${state.unreadNotifications > 99 ? "99+" : state.unreadNotifications}</b>` : "";
      return `<button class="nav-button ${key === state.current ? "active" : ""}" type="button" data-module="${key}" title="${esc(name)}"><i data-lucide="${icon}"></i><span>${esc(name)}</span>${count}</button>`;
    }).join("");
    window.lucide?.createIcons();
  }

  async function navigate(module) {
    if (state.warrantyTimer) { clearInterval(state.warrantyTimer); state.warrantyTimer = null; }
    const valid = new Set((modules[state.role] || []).map(([key]) => key));
    if (!valid.has(module)) module = "dashboard";
    state.current = module;
    if (state.role) sessionStorage.setItem(`seprigua_modulo_${state.role}`, module);
    syncPrototypeChrome(); renderNav(); loading();
    try {
      const map = { dashboard: renderDashboard, solicitudes: renderSolicitudes, ordenes: renderOrdenes, clientes: renderClientes, sedes: renderMisSedes, personal: renderPersonal, usuarios: renderUsuarios, equipos: renderEquipos, mantenimientos: renderMantenimientos, catalogo: renderCatalogoMaestro, vacaciones: renderVacaciones, cotizaciones: renderCotizaciones, documentos: renderDocumentos, notificaciones: renderNotificaciones, cuenta: renderCuenta, auditoria: renderAuditoria, garantia: renderGarantia };
      await (map[module] || renderDashboard)();
    } catch (e) { content.innerHTML = `<div class="empty-state"><h3>No se pudo cargar</h3><p>${esc(e.message)}</p></div>`; }
  }

  async function renderDashboard() {
    setHeading(`Hola, ${state.user.nombre || state.user.usuario}`, state.user.cliente ? `${state.user.cliente} · información operativa actualizada` : "Resumen operativo actualizado");
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

  async function requestForm() {
    const isCoord = state.role === "COORDINADOR";
    const clients = state.catalogs.clientes || [];
    const types = state.catalogs.tipos_servicio || [];

    openModal("Nueva solicitud", `<form id="requestForm" class="form-grid" autocomplete="off">
      ${isCoord ? `<div class="field"><label>Cliente</label><select name="cliente_id" id="requestClient" required><option value="">Seleccione...</option>${optionList(clients)}</select></div>` : ""}
      <div class="field"><label>Sede / ubicación</label><select name="ubicacion_id" id="requestLocation" required><option value="">${isCoord ? "Seleccione primero un cliente" : "Cargando..."}</option></select>${!isCoord?`<div class="field-helper-action"><span>¿Necesitas otra tienda o sede?</span><button class="btn small" type="button" data-action="ir-mis-sedes">Administrar sedes</button></div>`:""}</div>
      <div class="field"><label>Tipo de servicio</label><select name="tipo_servicio_id" id="requestType" required><option value="">Seleccione...</option>${optionList(types,"id",x=>x.nombre)}</select></div>
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
    setHeading(state.role === "TECNICO" ? "Mis órdenes" : state.role === "CLIENTE" ? "Mis servicios" : "Órdenes de trabajo", "Flujo real de solicitud → coordinación → ejecución → cierre, usando los estados configurados en el sistema.");
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
    const hasPaperNumber=!!String(x.orden_papel||"").trim(), hasPaperFile=normalizeNumber(p.documentos_ot)>0;
    const physicalPaperUsed=hasPaperNumber||hasPaperFile;
    const step1=!!String(x.ticket||"").trim() && (!physicalPaperUsed || (hasPaperNumber && hasPaperFile));
    const step2=normalizeNumber(p.fotos_trabajo)>=6;
    const step3=normalizeNumber(p.actividades)>=1;
    const step4=code==="COMPLETADA";
    return `<section class="order-stepper" aria-label="Flujo de cierre técnico">
      ${orderStepButton(id,"documento",1,"Ticket y respaldo físico",step1,active)}
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
      const paperStatus = docs && x.orden_papel ? "Respaldo físico validado" : (docs || x.orden_papel ? "Respaldo físico incompleto" : "Sin hoja física · no aplica");
      content.innerHTML=`${shellStart}<section class="panel order-screen"><div class="panel-header"><div><span class="eyebrow">PASO 1 DE 4</span><h2>Ticket y respaldo físico</h2></div><span class="badge ${docs&&x.orden_papel?"green":""}">${esc(paperStatus)}</span></div><div class="panel-body">
        <div class="notice-card"><strong>La hoja física es opcional</strong><p>Registra siempre el ticket. Si el cliente utiliza OT u OC en papel, agrega su número y sube una foto o PDF. La carga realizada por Coordinación o por un Técnico asignado funciona como validación interna y no depende del cliente.${isCoralsa?" Para CORALSA, cuando exista hoja física, procura que la imagen muestre firma y sello.":""}</p></div>
        <form id="orderDocForm" class="form-grid" autocomplete="off">
          <div class="field"><label>Número de ticket</label><input name="ticket" maxlength="60" value="${esc(x.ticket||"")}" required></div>
          <div class="field"><label>Número de OT u OC física <small>(opcional)</small></label><input name="orden_papel" maxlength="60" value="${esc(x.orden_papel||"")}" placeholder="Solo si existe hoja física"></div>
          <div class="field full"><label>Foto o PDF de la OT / OC <small>(opcional)</small></label><input type="file" name="archivos" multiple accept="image/*,application/pdf"><small>Si registras un número de OT/OC física, adjunta también su respaldo. Si no existe hoja física, deja ambos campos vacíos.</small></div>
          <div class="field full"><label>Descripción del documento <small>(opcional)</small></label><textarea name="descripcion" placeholder="Ej. copia física validada por coordinación${isCoralsa?", con firma y sello":""}."></textarea></div>
          <div class="field full"><div class="form-actions"><button class="btn" type="button" data-action="orden-paso" data-id="${esc(id)}" data-step="resumen">Volver al resumen</button><button class="btn primary" type="submit">Guardar y continuar</button></div></div>
        </form>
        <h3 class="section-title">Documentos cargados</h3><div class="evidence-grid">${docEvidence.map(evidenceCard).join("")||`<div class="muted">No se ha cargado hoja física. Esto no bloquea el cierre de la OT.</div>`}</div>
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
      const hasPaperNumber=!!String(x.orden_papel||"").trim(), hasPaperFile=docs>0, physicalPaperUsed=hasPaperNumber||hasPaperFile;
      const paperReady=!physicalPaperUsed||(hasPaperNumber&&hasPaperFile);
      const checks=[
        [!!String(x.ticket||"").trim(),"Ticket registrado"],
        [paperReady,physicalPaperUsed?`Respaldo físico completo${isCoralsa?" (firma y sello cuando aplique)":""}`:"Hoja física no requerida"],
        [photos>=6,`Evidencia fotográfica (${photos}/6)`],
        [acts>=1,"Descripción y observaciones registradas"],
        [pendingScopes===0,"Sin cambios de alcance pendientes"]
      ];
      const ready=checks.every(c=>c[0]);
      let finishAction="";
      if(orderCode==="COMPLETADA") finishAction=`<div class="completion-banner"><strong>✓ OT finalizada</strong><span>La orden ya está cerrada y visible como finalizada. La cotización puede enviarse antes o después y no modifica este estado.</span></div>`;
      else if((coord||tech) && ["PENDIENTE","PROGRAMADA"].includes(orderCode)) finishAction=`<div class="notice-card"><strong>Primero inicia el trabajo</strong><p>La OT debe estar EN PROCESO antes de poder finalizarla.</p><button class="btn primary" type="button" data-action="iniciar-orden" data-id="${esc(id)}">Iniciar trabajo</button></div>`;
      else if((coord||tech) && ["EN_PROCESO","POR_CONFIRMAR"].includes(orderCode)) finishAction=`<div class="final-action"><button class="btn finish-button" type="button" data-action="finalizar-tecnico" data-id="${esc(id)}" ${ready?"":"disabled"}>✓ Marcar OT como finalizada</button><p class="muted">${ready?"Coordinación o el técnico pueden cerrar la OT; no se necesita confirmación del cliente ni una cotización previa.":"Completa los puntos pendientes antes de finalizar."}</p></div>`;
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
    const allowedCoordStates=(state.catalogs.estados_orden||[]).filter(s=>!["COMPLETADA","POR_CONFIRMAR"].includes(String(s.codigo||"").toUpperCase()));
    const stateControl=coord&&orderCode!=="COMPLETADA"?`<select class="inline-select" id="stateSelect"><option value="">Cambiar estado...</option>${optionList(allowedCoordStates)}</select><button class="btn small primary" data-action="cambiar-estado" data-id="${esc(id)}">Aplicar</button>`:"";
    const startButton=tech&&["PENDIENTE","PROGRAMADA"].includes(orderCode)?button("Iniciar trabajo","iniciar-orden",id,"primary"):"";
    const opActions=(coord||tech)?`<section class="panel"><div class="panel-header"><h2>Acciones de la OT</h2></div><div class="panel-body"><div class="actions">${stateControl}${startButton}${coord?button("Editar datos","editar-orden",id):""}${coord?button("Gestionar cuadrilla","asignar-tecnico",id):""}${coord?button("Asignar equipo","asignar-equipo",id):""}${button("Incidencia","incidencia",id)}${button("Cambio de alcance","cambio-alcance",id)}</div>${tech?`<p class="muted">El cierre técnico se realiza en las cuatro pantallas superiores. La cotización no bloquea el cierre.</p>`:""}</div></section>`:"";

    content.innerHTML=`${shellStart}<section class="panel"><div class="panel-header"><h2>Resumen de la orden</h2></div><div class="panel-body"><div class="info-grid"><div class="info-item"><span>Cliente</span><strong>${esc(x.cliente)}</strong></div><div class="info-item"><span>Sede</span><strong>${esc(x.sede)}</strong></div><div class="info-item"><span>Estado</span><strong>${esc(x.estado)}</strong></div><div class="info-item"><span>Prioridad</span><strong>${esc(x.Prioridad||x.prioridad)}</strong></div><div class="info-item"><span>Servicio</span><strong>${esc(x.tipo)}</strong></div><div class="info-item"><span>Atención aproximada</span><strong>${fmt(x.programada)}</strong></div><div class="info-item"><span>Ticket</span><strong>${esc(x.ticket||"—")}</strong></div><div class="info-item"><span>OT / OC</span><strong>${esc(x.orden_papel||"—")}</strong></div><div class="info-item"><span>Ubicación</span><strong>${esc([x.Direccion||x.direccion,x.Municipio||x.municipio].filter(Boolean).join(", ")||x.sede)}</strong></div><div class="info-item"><span>Cuadrilla</span><strong>${techs}</strong></div></div><h3 class="section-title">Solicitud</h3><p>${esc(x.solicitud)}</p></div></section>
      ${correction}${opActions}
      <section class="panel"><div class="panel-header"><h2>Cotización</h2><span class="muted">Independiente del cierre técnico</span></div><div class="panel-body">${quoteSummary}${quoteActions}</div></section>
      <div class="two-col"><section class="panel"><div class="panel-header"><h2>Historial reciente</h2></div><div class="panel-body"><div class="timeline">${recentHistory}</div></div></section><section class="panel"><div class="panel-header"><h2>Incidencias</h2></div><div class="panel-body"><div class="timeline">${incidents}</div></div></section></div>
      <section class="panel"><div class="panel-header"><h2>Cambios de alcance</h2></div><div class="panel-body"><div class="timeline">${scopes}</div></div></section>${shellEnd}`;
    window.lucide?.createIcons();
  }

  function backToOrder(id){return `<button class="btn" type="button" data-action="ver-orden" data-id="${id}">Volver a la OT</button>`;}

  async function quickAction(action,id) {
    if(action==="iniciar-orden"){
      const target=(state.catalogs.estados_orden||[]).find(s=>String(s.codigo||"").toUpperCase()==="EN_PROCESO");
      if(!target)return showToast("No se encontró el estado EN PROCESO configurado.","error");
      try{await api(`/api/ordenes/${id}/estado`,{method:"POST",body:{estado_id:target.id,comentario:"Inicio de trabajo registrado desde el portal operativo"}});showToast("Trabajo iniciado.");await openOrder(id,state.orderStep==="finalizar"?"finalizar":"resumen",true);}catch(err){showToast(err.message,"error");}return;
    }
    if(action==="finalizar-tecnico"){
      const completed=(state.catalogs.estados_orden||[]).find(s=>String(s.codigo||"").toUpperCase()==="COMPLETADA");
      if(!completed)return showToast("No se encontró el estado de finalización configurado.","error");
      try{await api(`/api/ordenes/${id}/estado`,{method:"POST",body:{estado_id:completed.id,comentario:"Cierre de OT completado desde el flujo de 4 pasos"}});showToast("OT finalizada correctamente.");await openOrder(id,"finalizar",true);}catch(err){showToast(err.message,"error");}return;
    }
    if(action==="cambiar-estado"){
      const estado_id=$("#stateSelect")?.value;if(!estado_id)return showToast("Selecciona el siguiente estado.","error");
      try{await api(`/api/ordenes/${id}/estado`,{method:"POST",body:{estado_id,comentario:"Cambio desde el panel SEPRIGUA"}});showToast("Estado actualizado.");await openOrder(id);}catch(e){showToast(e.message,"error");}return;
    }
    if(action==="editar-orden")return editOrderForm(id);
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

  async function renderMisSedes() {
    if (state.role !== "CLIENTE") return navigate("dashboard");
    setHeading("Mis sedes", "Agrega y administra las tiendas o ubicaciones de tu empresa para utilizarlas en nuevas solicitudes.");
    const d = await api("/api/mis-sedes");
    state.clientSites = d.items || [];
    const active = state.clientSites.filter(x => x.activo).length;
    const inactive = state.clientSites.length - active;
    const cards = `
      <section class="mini-stats-grid site-summary-grid">
        <article class="mini-stat"><span>Total de sedes</span><strong>${state.clientSites.length}</strong></article>
        <article class="mini-stat"><span>Activas</span><strong>${active}</strong></article>
        <article class="mini-stat"><span>Inactivas</span><strong>${inactive}</strong></article>
      </section>`;
    const rows = state.clientSites.map(x => `<tr>
      <td><div class="site-name-cell"><span class="site-pin"><i data-lucide="map-pin"></i></span><div><strong>${esc(x.nombre||"Sede")}</strong><small>${esc(x.codigo||"Sin código")}</small></div></div></td>
      <td>${esc(x.telefono||"—")}</td>
      <td>${esc(x.direccion||"—")}</td>
      <td>${esc([x.municipio,x.departamento].filter(Boolean).join(", ")||"—")}</td>
      <td>${badge(x.activo?"ACTIVA":"INACTIVA")}</td>
      <td><div class="inline-actions">${button("Editar","editar-sede",x.id)}${button(x.activo?"Desactivar":"Activar","toggle-sede",x.id,x.activo?"danger":"primary")}</div></td>
    </tr>`);
    content.innerHTML = `${cards}<div class="toolbar"><div class="toolbar-left"><h2>Sedes y tiendas registradas</h2><p class="muted">Solo se muestran dentro de tu empresa. Al crear una solicitud podrás seleccionar cualquiera de las sedes activas.</p></div><div class="toolbar-right">${button("Agregar sede","nueva-sede","","primary")}</div></div><section class="panel">${table(["Sede / tienda","Teléfono","Dirección","Municipio / departamento","Estado","Acciones"],rows,"Todavía no tienes sedes registradas. Agrega la primera para poder seleccionarla en tus solicitudes.")}</section>`;
    window.lucide?.createIcons();
  }

  function sedeForm(id = null) {
    const current = id ? state.clientSites.find(x => String(x.id) === String(id)) : null;
    openModal(current ? "Editar sede / tienda" : "Agregar nueva sede / tienda", `<form id="clientSiteForm" class="form-grid" autocomplete="off">
      <div class="field"><label>Nombre de la sede / tienda</label><input name="nombre" maxlength="180" required placeholder="Ej. Restaurante Zona 10" value="${esc(current?.nombre||"")}"></div>
      <div class="field"><label>Código interno <small>(opcional)</small></label><input name="codigo" maxlength="30" placeholder="Ej. Z10-01" value="${esc(current?.codigo||"")}"></div>
      <div class="field"><label>Teléfono <small>(opcional)</small></label><input name="telefono" maxlength="20" inputmode="tel" value="${esc(current?.telefono||"")}"></div>
      <div class="field"><label>Municipio</label><input name="municipio" maxlength="100" required placeholder="Ej. Guatemala" value="${esc(current?.municipio||"")}"></div>
      <div class="field"><label>Departamento</label><input name="departamento" maxlength="100" required value="${esc(current?.departamento||"Guatemala")}"></div>
      <div class="field full"><label>Dirección</label><textarea name="direccion" maxlength="450" required placeholder="Dirección completa de la sede">${esc(current?.direccion||"")}</textarea></div>
      <div class="field full"><label>Referencia para llegar <small>(opcional)</small></label><textarea name="referencia_llegada" maxlength="400" placeholder="Punto de referencia, entrada, nivel, local...">${esc(current?.referencia_llegada||"")}</textarea></div>
      <div class="field"><label>Latitud <small>(opcional)</small></label><input name="latitud" type="number" step="0.0000001" min="-90" max="90" value="${esc(current?.latitud??"")}"></div>
      <div class="field"><label>Longitud <small>(opcional)</small></label><input name="longitud" type="number" step="0.0000001" min="-180" max="180" value="${esc(current?.longitud??"")}"></div>
      <div class="field full"><label>Observaciones <small>(opcional)</small></label><textarea name="observaciones" maxlength="500">${esc(current?.observaciones||"")}</textarea></div>
      <div class="field full"><div class="form-actions"><button class="btn" type="button" data-close-modal>Cancelar</button><button class="btn primary" type="submit">${current?"Guardar cambios":"Agregar sede"}</button></div></div>
    </form>`);
    const form = $("#clientSiteForm");
    form?.addEventListener("submit", async e => {
      e.preventDefault();
      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      try {
        const body = Object.fromEntries(new FormData(form).entries());
        const result = await api(current ? `/api/mis-sedes/${current.id}` : "/api/mis-sedes", {method: current ? "PATCH" : "POST", body});
        showToast(result.message || (current ? "Sede actualizada." : "Sede agregada."));
        closeModal();
        await renderMisSedes();
      } catch (err) {
        showToast(err.message, "error");
      } finally {
        submit.disabled = false;
      }
    });
  }

  function confirmSedeState(id) {
    const item = state.clientSites.find(x => String(x.id) === String(id));
    if (!item) return;
    const activate = !item.activo;
    openModal(activate ? "Activar sede" : "Desactivar sede", `<div class="confirm-card ${activate?"":"danger"}"><div class="confirm-icon"><i data-lucide="${activate?"circle-check-big":"triangle-alert"}"></i></div><div><h3>${activate?"¿Activar esta sede?":"¿Desactivar esta sede?"}</h3><p>${activate?"Volverá a estar disponible al crear solicitudes.":"Ya no aparecerá como opción para nuevas solicitudes, pero el historial de servicios se conserva."}</p><strong>${esc(item.nombre||"Sede")}</strong></div></div><div class="form-actions"><button class="btn" type="button" data-close-modal>Cancelar</button><button class="btn ${activate?"primary":"danger"}" type="button" data-action="confirmar-toggle-sede" data-id="${esc(id)}" data-active="${activate?1:0}">${activate?"Activar":"Desactivar"}</button></div>`);
    window.lucide?.createIcons();
  }

  async function renderClientes() {
    setHeading("Clientes y sedes", "Consulta clientes, sedes y volumen de solicitudes registrado en el sistema."); const d=await api("/api/clientes");
    const rows=d.items.map(x=>`<tr><td>${esc(x.codigo)}</td><td>${esc(x.nombre)}</td><td>${esc(x.Nit||x.nit||"—")}</td><td>${esc(x.telefono||"—")}</td><td>${normalizeNumber(x.sedes)}</td><td>${normalizeNumber(x.contactos)}</td><td>${normalizeNumber(x.solicitudes)}</td><td>${button("Sedes","ver-sedes",x.id)}</td></tr>`);
    content.innerHTML=`<div class="toolbar"><h2>${d.items.length} clientes</h2></div><section class="panel">${table(["Código","Cliente","NIT","Teléfono","Sedes","Contactos","Solicitudes","Acción"],rows)}</section>`;
  }
  async function openSedes(id){const d=await api(`/api/clientes/${id}/sedes`);openModal("Sedes del cliente",table(["Código","Sede","Teléfono","Dirección","Municipio"],d.items.map(x=>`<tr><td>${esc(x.codigo||"—")}</td><td>${esc(x.Nombre||x.nombre)}</td><td>${esc(x.Telefono||x.telefono||"—")}</td><td>${esc(x.Direccion||x.direccion||"—")}</td><td>${esc(x.Municipio||x.municipio||"—")}</td></tr>`),"Este cliente todavía no tiene sedes."));}

  async function renderPersonal(){setHeading("Personal", "Estado laboral y disponibilidad operativa.");const d=await api("/api/personal");const rows=d.items.map(x=>`<tr><td>${esc(x.codigo)}</td><td>${esc(x.nombre)}</td><td>${esc(x.puesto)}</td><td>${badge(x.estado)}</td><td><select class="inline-select availability" data-id="${x.id}"><option ${x.disponibilidad==="DISPONIBLE"?"selected":""}>DISPONIBLE</option><option ${x.disponibilidad==="ASIGNADO"?"selected":""}>ASIGNADO</option><option ${x.disponibilidad==="VACACIONES"?"selected":""}>VACACIONES</option><option ${x.disponibilidad==="INACTIVO"?"selected":""}>INACTIVO</option></select></td><td>${esc(x.telefono||"—")}</td><td>${button("Guardar","guardar-disponibilidad",x.id)}</td></tr>`);content.innerHTML=`<section class="panel">${table(["Código","Nombre","Puesto","Estado","Disponibilidad","Teléfono","Acción"],rows)}</section>`;}


  function userStatusView(x){
    const status=String(x.estado||"").toUpperCase();
    if(status==="BLOQUEADO") return `<span class="user-status user-status-blocked"><i data-lucide="lock-keyhole"></i> Bloqueado</span>`;
    if(status==="ACTIVO") return `<span class="user-status user-status-active"><i data-lucide="circle-check-big"></i> Activo</span>`;
    return `<span class="user-status user-status-inactive"><i data-lucide="circle-pause"></i> Inactivo</span>`;
  }

  function userSortIcon(key){
    const f=state.userAdmin;
    if(f.orden!==key) return `<i data-lucide="chevrons-up-down"></i>`;
    return `<i data-lucide="${f.direccion==="ASC"?"chevron-up":"chevron-down"}"></i>`;
  }

  function userSortHead(label,key){
    return `<th><button class="user-sort-button" type="button" data-user-sort="${esc(key)}">${esc(label)} ${userSortIcon(key)}</button></th>`;
  }

  function userReportTable(items){
    if(!items.length) return `<div class="empty-state user-empty"><i data-lucide="users-round"></i><h3>No encontramos usuarios</h3><p>Prueba con otros filtros o limpia la búsqueda.</p></div>`;
    return `<div class="table-wrap user-report-wrap"><table class="data-table user-report-table"><thead><tr>
      ${userSortHead("Usuario","USUARIO")}${userSortHead("Nombre","NOMBRE")}${userSortHead("Correo","CORREO")}${userSortHead("Rol","ROL")}${userSortHead("Estado","ESTADO")}${userSortHead("Registro","FECHA")}${userSortHead("Último acceso","ULTIMO_ACCESO")}<th>Acciones</th>
    </tr></thead><tbody>${items.map(x=>`<tr>
      <td data-label="Usuario"><div class="user-cell-user"><span class="mini-user-avatar"><i data-lucide="user-round"></i></span><div><strong>${esc(x.usuario)}</strong><small>#${esc(x.id)}</small></div></div></td>
      <td data-label="Nombre"><strong>${esc(x.nombre||"—")}</strong>${x.cliente?`<small class="cell-subcopy">${esc(x.cliente)}</small>`:""}</td>
      <td data-label="Correo">${esc(x.correo||"—")}</td>
      <td data-label="Rol"><span class="role-mini role-${esc(String(x.rol||"").toLowerCase())}">${esc(x.rol||"—")}</span></td>
      <td data-label="Estado">${userStatusView(x)}</td>
      <td data-label="Registro">${fmt(x.creado_en)}</td>
      <td data-label="Último acceso">${fmt(x.ultimo_acceso)}</td>
      <td data-label="Acciones"><div class="user-row-actions">
        <button class="icon-action" type="button" data-action="ver-usuario" data-id="${esc(x.id)}" title="Ver detalle"><i data-lucide="eye"></i></button>
        <button class="icon-action" type="button" data-action="editar-usuario" data-id="${esc(x.id)}" title="Editar"><i data-lucide="pencil"></i></button>
        <button class="icon-action" type="button" data-action="restablecer-usuario" data-id="${esc(x.id)}" title="Restablecer contraseña"><i data-lucide="key-round"></i></button>
        ${String(x.estado).toUpperCase()==="BLOQUEADO"?`<button class="icon-action warning" type="button" data-action="desbloquear-usuario" data-id="${esc(x.id)}" title="Desbloquear"><i data-lucide="unlock-keyhole"></i></button>`:""}
        <button class="icon-action ${x.activo?"danger":"success"}" type="button" data-action="cambiar-estado-usuario" data-id="${esc(x.id)}" data-active="${x.activo?"0":"1"}" data-name="${esc(x.usuario)}" title="${x.activo?"Desactivar":"Activar"}"><i data-lucide="${x.activo?"user-round-x":"user-round-check"}"></i></button>
      </div></td>
    </tr>`).join("")}</tbody></table></div>`;
  }

  function userPagination(meta){
    const page=Number(meta.pagina||1), pages=Math.max(1,Number(meta.paginas||1)), total=Number(meta.total||0);
    const start=total?((page-1)*Number(meta.tamano||10))+1:0;
    const end=Math.min(total,page*Number(meta.tamano||10));
    const nums=[];
    for(let p=Math.max(1,page-2);p<=Math.min(pages,page+2);p++) nums.push(p);
    return `<div class="user-pagination"><div class="user-pagination-copy">Mostrando <strong>${start}-${end}</strong> de <strong>${total}</strong></div><div class="pager-buttons">
      <button type="button" class="pager-button" data-action="usuario-pagina" data-page="1" ${page<=1?"disabled":""} aria-label="Primera página"><i data-lucide="chevrons-left"></i></button>
      <button type="button" class="pager-button" data-action="usuario-pagina" data-page="${page-1}" ${page<=1?"disabled":""} aria-label="Página anterior"><i data-lucide="chevron-left"></i></button>
      ${nums.map(n=>`<button type="button" class="pager-button ${n===page?"active":""}" data-action="usuario-pagina" data-page="${n}">${n}</button>`).join("")}
      <button type="button" class="pager-button" data-action="usuario-pagina" data-page="${page+1}" ${page>=pages?"disabled":""} aria-label="Página siguiente"><i data-lucide="chevron-right"></i></button>
      <button type="button" class="pager-button" data-action="usuario-pagina" data-page="${pages}" ${page>=pages?"disabled":""} aria-label="Última página"><i data-lucide="chevrons-right"></i></button>
    </div></div>`;
  }

  function userReportParams(){
    const f=state.userAdmin,q=new URLSearchParams();
    if(f.q)q.set("q",f.q);if(f.rol_id)q.set("rol_id",f.rol_id);if(f.estado)q.set("estado",f.estado);if(f.fecha_desde)q.set("fecha_desde",f.fecha_desde);if(f.fecha_hasta)q.set("fecha_hasta",f.fecha_hasta);
    q.set("pagina",String(f.pagina));q.set("tamano",String(f.tamano));q.set("orden",f.orden);q.set("direccion",f.direccion);
    return q.toString();
  }

  async function ensureUserCatalogs(force=false){
    if(!state.userAdmin.catalogos||force) state.userAdmin.catalogos=await api("/api/usuarios/catalogos");
    return state.userAdmin.catalogos;
  }

  async function renderUsuarios(){
    if(state.role!=="COORDINADOR") throw new Error("Solo Coordinación puede administrar usuarios.");
    setHeading("Administración de usuarios", "Registro, CRUD y reporte inteligente del portal privado de SEPRIGUA.");
    const f=state.userAdmin;
    const [d,catalogs]=await Promise.all([api(`/api/usuarios?${userReportParams()}`),ensureUserCatalogs()]);
    f.total=d.pagination?.total||0;f.paginas=d.pagination?.paginas||1;f.pagina=d.pagination?.pagina||1;
    const s=d.summary||{};
    const roles=(catalogs.roles||[]).map(x=>`<option value="${esc(x.id)}" ${String(f.rol_id)===String(x.id)?"selected":""}>${esc(x.nombre)}</option>`).join("");
    content.innerHTML=`
      <section class="private-portal-note"><span class="private-note-icon"><i data-lucide="shield-check"></i></span><div><strong>Portal privado · auto registro deshabilitado</strong><p>Las cuentas solo pueden ser creadas y administradas por Coordinación. Cliente y Técnico únicamente pueden cambiar su propia contraseña.</p></div><span class="private-note-pill">NO APLICA AUTO REGISTRO</span></section>
      <section class="user-summary-grid">
        <button class="user-summary-card total" type="button" data-action="usuario-filtro-estado" data-status=""><span class="summary-icon"><i data-lucide="users-round"></i></span><span>Total usuarios</span><strong>${normalizeNumber(s.total)}</strong><small>Todos los registros</small></button>
        <button class="user-summary-card active" type="button" data-action="usuario-filtro-estado" data-status="ACTIVO"><span class="summary-icon"><i data-lucide="user-round-check"></i></span><span>Activos</span><strong>${normalizeNumber(s.activos)}</strong><small>Acceso habilitado</small></button>
        <button class="user-summary-card inactive" type="button" data-action="usuario-filtro-estado" data-status="INACTIVO"><span class="summary-icon"><i data-lucide="user-round-x"></i></span><span>Inactivos</span><strong>${normalizeNumber(s.inactivos)}</strong><small>Acceso deshabilitado</small></button>
        <button class="user-summary-card blocked" type="button" data-action="usuario-filtro-estado" data-status="BLOQUEADO"><span class="summary-icon"><i data-lucide="shield-alert"></i></span><span>Bloqueados</span><strong>${normalizeNumber(s.bloqueados)}</strong><small>Bloqueo temporal</small></button>
        <div class="user-summary-card recent"><span class="summary-icon"><i data-lucide="activity"></i></span><span>Acceso reciente</span><strong>${normalizeNumber(s.acceso_30_dias)}</strong><small>Últimos 30 días</small></div>
      </section>
      <section class="panel user-report-panel">
        <div class="panel-header user-report-heading"><div><span class="section-kicker">REPORTE INTELIGENTE</span><h2>Usuarios del sistema</h2><p class="muted">Combina búsqueda, rol, estado y rango de fechas. El ordenamiento y la paginación se aplican desde el sistema central.</p></div><button class="btn primary user-create-button" type="button" data-action="nuevo-usuario"><i data-lucide="user-round-plus"></i> Registrar usuario</button></div>
        <div class="panel-body">
          <form id="userReportFilters" class="user-filter-grid">
            <div class="field user-search-field"><label>Buscar</label><div class="input-with-icon"><i data-lucide="search"></i><input type="search" name="q" value="${esc(f.q)}" placeholder="Usuario, nombre, correo o empresa"></div></div>
            <div class="field"><label>Rol</label><select name="rol_id"><option value="">Todos los roles</option>${roles}</select></div>
            <div class="field"><label>Estado</label><select name="estado"><option value="">Todos</option><option value="ACTIVO" ${f.estado==="ACTIVO"?"selected":""}>Activos</option><option value="INACTIVO" ${f.estado==="INACTIVO"?"selected":""}>Inactivos</option><option value="BLOQUEADO" ${f.estado==="BLOQUEADO"?"selected":""}>Bloqueados</option></select></div>
            <div class="field"><label>Desde</label><input type="date" name="fecha_desde" value="${esc(f.fecha_desde)}"></div>
            <div class="field"><label>Hasta</label><input type="date" name="fecha_hasta" value="${esc(f.fecha_hasta)}"></div>
            <div class="field user-page-size"><label>Por página</label><select name="tamano"><option ${f.tamano===5?"selected":""}>5</option><option ${f.tamano===10?"selected":""}>10</option><option ${f.tamano===20?"selected":""}>20</option><option ${f.tamano===50?"selected":""}>50</option></select></div>
            <div class="field user-mobile-sort"><label>Ordenar por</label><select name="orden"><option value="FECHA" ${f.orden==="FECHA"?"selected":""}>Fecha de registro</option><option value="USUARIO" ${f.orden==="USUARIO"?"selected":""}>Usuario</option><option value="NOMBRE" ${f.orden==="NOMBRE"?"selected":""}>Nombre</option><option value="CORREO" ${f.orden==="CORREO"?"selected":""}>Correo</option><option value="ROL" ${f.orden==="ROL"?"selected":""}>Rol</option><option value="ESTADO" ${f.orden==="ESTADO"?"selected":""}>Estado</option><option value="ULTIMO_ACCESO" ${f.orden==="ULTIMO_ACCESO"?"selected":""}>Último acceso</option></select></div>
            <div class="field user-mobile-sort"><label>Dirección</label><select name="direccion"><option value="DESC" ${f.direccion==="DESC"?"selected":""}>Descendente</option><option value="ASC" ${f.direccion==="ASC"?"selected":""}>Ascendente</option></select></div>
            <div class="user-filter-actions"><button class="btn" type="button" data-action="usuarios-limpiar"><i data-lucide="rotate-ccw"></i> Limpiar</button><button class="btn primary" type="submit"><i data-lucide="filter"></i> Aplicar filtros</button></div>
          </form>
        </div>
        <div class="user-report-result-header"><div><strong>${normalizeNumber(d.pagination?.total)} resultado(s)</strong><span>${f.estado?`Filtro: ${esc(f.estado.toLowerCase())}`:"Reporte general"}</span></div><span class="sql-report-chip"><i data-lucide="database-zap"></i> DATOS CENTRALIZADOS</span></div>
        ${userReportTable(d.items||[])}
        ${userPagination(d.pagination||{})}
      </section>`;
    window.lucide?.createIcons();
    const form=$("#userReportFilters");
    form?.addEventListener("submit",e=>{e.preventDefault();const data=Object.fromEntries(new FormData(form).entries());Object.assign(f,{q:String(data.q||"").trim(),rol_id:String(data.rol_id||""),estado:String(data.estado||""),fecha_desde:String(data.fecha_desde||""),fecha_hasta:String(data.fecha_hasta||""),tamano:Number(data.tamano||10),orden:String(data.orden||f.orden||"FECHA"),direccion:String(data.direccion||f.direccion||"DESC"),pagina:1});renderUsuarios().catch(err=>showToast(err.message,"error"));});
  }

  function userRoleNameById(id){return (state.userAdmin.catalogos?.roles||[]).find(x=>String(x.id)===String(id))?.codigo||"";}

  function syncUserOwnerFields(form,currentId=""){
    if(!form)return;
    const role=userRoleNameById(form.rol_id?.value);
    const emp=form.querySelector('[data-owner="empleado"]'),client=form.querySelector('[data-owner="cliente"]');
    if(emp)emp.hidden=!(["COORDINADOR","TECNICO"].includes(role));
    if(client)client.hidden=role!=="CLIENTE";
    if(["COORDINADOR","TECNICO"].includes(role)&&form.contacto_cliente_id)form.contacto_cliente_id.value="";
    if(role==="CLIENTE"&&form.empleado_id)form.empleado_id.value="";
  }

  function userOwnerOptions(items,currentId,selected,type){
    return (items||[]).map(x=>{const used=x.usuario_id&&String(x.usuario_id)!==String(currentId);const label=type==="empleado"?`${x.codigo||""} · ${x.nombre}${x.puesto?` · ${x.puesto}`:""}`:`${x.cliente} · ${x.nombre}${x.cargo?` · ${x.cargo}`:""}`;return `<option value="${esc(x.id)}" ${String(x.id)===String(selected)?"selected":""} ${used?"disabled":""}>${esc(label)}${used?` · ya vinculado a ${esc(x.usuario||"otro usuario")}`:""}</option>`;}).join("");
  }

  async function userForm(usuarioId=null){
    const catalogs=await ensureUserCatalogs(true);
    let current=null;
    if(usuarioId){const d=await api(`/api/usuarios/${usuarioId}`);current=d.item;}
    const roleId=current?.rol_id||(catalogs.roles||[])[0]?.id||"";
    const roles=(catalogs.roles||[]).map(x=>`<option value="${esc(x.id)}" ${String(x.id)===String(roleId)?"selected":""}>${esc(x.nombre)}</option>`).join("");
    openModal(current?"Editar usuario":"Registrar usuario",`<form id="userAdminForm" class="form-grid user-admin-form" autocomplete="off">
      <div class="user-form-intro full"><span><i data-lucide="${current?"user-round-cog":"user-round-plus"}"></i></span><div><strong>${current?`Editar ${esc(current.usuario)}`:"Nueva cuenta del portal privado"}</strong><p>${current?"Actualiza el rol, vínculo y datos de acceso. La contraseña se administra por separado.":"La cuenta será creada por Coordinación y quedará obligada a cambiar la contraseña temporal al ingresar."}</p></div></div>
      <div class="field"><label>Rol</label><select name="rol_id" required>${roles}</select></div>
      <div class="field"><label>Nombre de usuario</label><input name="usuario" maxlength="60" value="${esc(current?.usuario||"")}" placeholder="ej. jperez" required><small>Letras, números, punto, guion o guion bajo.</small></div>
      <div class="field full"><label>Correo de acceso</label><input type="email" name="correo" maxlength="160" value="${esc(current?.correo||"")}" placeholder="usuario@empresa.com"><small>Opcional, pero debe ser único si se registra.</small></div>
      <div class="field full" data-owner="empleado"><label>Empleado vinculado</label><select name="empleado_id"><option value="">Seleccionar empleado</option>${userOwnerOptions(catalogs.empleados,current?.id,current?.empleado_id,"empleado")}</select><small>Obligatorio para Coordinador y Técnico.</small></div>
      <div class="field full" data-owner="cliente"><label>Contacto de cliente vinculado</label><select name="contacto_cliente_id"><option value="">Seleccionar contacto</option>${userOwnerOptions(catalogs.contactos,current?.id,current?.contacto_cliente_id,"cliente")}</select><small>Obligatorio para cuentas con rol Cliente.</small></div>
      ${current?`<div class="field full"><label class="switch-row"><input type="checkbox" name="activo" ${current.activo?"checked":""}><span>Cuenta activa</span></label><small>Desactivar una cuenta cierra sus sesiones activas.</small></div>`:`<div class="field"><label>Contraseña temporal</label><div class="password-control"><input type="password" name="contrasena" minlength="8" autocomplete="new-password" required><button type="button" class="password-toggle" data-toggle-password aria-label="Mostrar contraseña"><i data-lucide="eye"></i></button></div><small>Mayúscula, minúscula y número.</small></div><div class="field"><label>Confirmar contraseña</label><div class="password-control"><input type="password" name="confirmacion" minlength="8" autocomplete="new-password" required><button type="button" class="password-toggle" data-toggle-password aria-label="Mostrar contraseña"><i data-lucide="eye"></i></button></div></div>`}
      <div class="field full"><div class="form-actions"><button class="btn" type="button" data-close-modal>Cancelar</button><button class="btn primary" type="submit"><i data-lucide="save"></i> ${current?"Guardar cambios":"Crear usuario"}</button></div></div>
    </form>`);
    const form=$("#userAdminForm");syncUserOwnerFields(form,current?.id||"");
    form?.rol_id?.addEventListener("change",()=>syncUserOwnerFields(form,current?.id||""));
    form?.addEventListener("submit",async e=>{e.preventDefault();const submit=form.querySelector('button[type="submit"]');submit.disabled=true;try{const raw=Object.fromEntries(new FormData(form).entries());raw.activo=current?!!form.activo?.checked:true;const result=await api(current?`/api/usuarios/${current.id}`:"/api/usuarios",{method:current?"PATCH":"POST",body:raw});showToast(result.message||"Usuario guardado.");closeModal();state.userAdmin.catalogos=null;state.userAdmin.pagina=1;await renderUsuarios();}catch(err){showToast(err.message,"error");}finally{submit.disabled=false;}});
    window.lucide?.createIcons();
  }

  async function openUserDetail(id){
    const d=await api(`/api/usuarios/${id}`),u=d.item||{};
    const sessions=(d.sesiones||[]).map(x=>`<article class="admin-session ${x.activa?"live":""}"><span><i data-lucide="${x.activa?"monitor-check":"monitor-x"}"></i></span><div><strong>${esc(describeAgent(x.agente))}${x.activa?` <em>Activa</em>`:""}</strong><p>${esc(x.ip||"IP no disponible")} · ${fmt(x.iniciada)}</p><small>${x.activa?`Expira ${fmt(x.expira)}`:`Cerrada ${fmt(x.cerrada)}${x.motivo_cierre?` · ${esc(x.motivo_cierre)}`:""}`}</small></div></article>`).join("")||`<div class="empty-state compact">Sin historial de sesiones.</div>`;
    const events=(d.actividad||[]).map(x=>`<li><span>${badge(x.operacion)}</span><div><strong>${esc(x.objeto||"Evento")}</strong><small>${fmt(x.fecha)}${x.observacion?` · ${esc(x.observacion)}`:""}</small></div></li>`).join("")||`<li class="muted">Sin actividad reciente registrada.</li>`;
    openModal(`Usuario · ${u.usuario}`,`<div class="user-detail-hero"><span class="user-detail-avatar"><i data-lucide="user-round"></i></span><div><span>${esc(u.rol||"USUARIO")}</span><h3>${esc(u.nombre||u.usuario)}</h3><p>@${esc(u.usuario)}${u.correo?` · ${esc(u.correo)}`:""}</p></div>${userStatusView({estado:u.bloqueado?"BLOQUEADO":(u.activo?"ACTIVO":"INACTIVO")})}</div>
      <div class="info-grid user-detail-grid">
        <div class="info-item"><span>Tipo de cuenta</span><strong>${esc(u.tipo_cuenta||"—")}</strong></div><div class="info-item"><span>Vínculo</span><strong>${esc(u.codigo_empleado?`${u.codigo_empleado} · ${u.puesto||"Empleado"}`:(u.cliente||"—"))}</strong></div>
        <div class="info-item"><span>Fecha de registro</span><strong>${fmt(u.creado_en)}</strong></div><div class="info-item"><span>Último acceso</span><strong>${fmt(u.ultimo_acceso)}</strong></div>
        <div class="info-item"><span>Intentos fallidos</span><strong>${normalizeNumber(u.intentos_fallidos)}</strong></div><div class="info-item"><span>Cambio de contraseña</span><strong>${u.requiere_cambio_contrasena?"Pendiente":"Al día"}</strong></div>
      </div>
      <div class="user-detail-actions"><button class="btn" data-action="editar-usuario" data-id="${esc(u.id)}"><i data-lucide="pencil"></i> Editar</button><button class="btn" data-action="restablecer-usuario" data-id="${esc(u.id)}"><i data-lucide="key-round"></i> Restablecer contraseña</button>${u.bloqueado?`<button class="btn" data-action="desbloquear-usuario" data-id="${esc(u.id)}"><i data-lucide="unlock-keyhole"></i> Desbloquear</button>`:""}<button class="btn ${u.activo?"danger":"primary"}" data-action="cambiar-estado-usuario" data-id="${esc(u.id)}" data-active="${u.activo?"0":"1"}" data-name="${esc(u.usuario)}"><i data-lucide="${u.activo?"user-round-x":"user-round-check"}"></i> ${u.activo?"Desactivar":"Activar"}</button></div>
      <div class="user-detail-columns"><section><h3 class="section-title">Sesiones recientes</h3><div class="admin-session-list">${sessions}</div></section><section><h3 class="section-title">Actividad de auditoría</h3><ul class="admin-audit-list">${events}</ul></section></div>`);
    window.lucide?.createIcons();
  }

  async function resetUserPassword(id){
    const d=await api(`/api/usuarios/${id}`),u=d.item||{};
    openModal("Restablecer contraseña",`<form id="adminResetPassword" class="form-grid"><div class="security-warning full"><i data-lucide="key-round"></i><div><strong>${esc(u.nombre||u.usuario)}</strong><p>Se cerrarán sus otras sesiones y deberá cambiar la contraseña temporal al volver a ingresar.</p></div></div><div class="field"><label>Contraseña temporal</label><div class="password-control"><input type="password" name="contrasena" minlength="8" autocomplete="new-password" required><button type="button" class="password-toggle" data-toggle-password><i data-lucide="eye"></i></button></div></div><div class="field"><label>Confirmar contraseña</label><div class="password-control"><input type="password" name="confirmacion" minlength="8" autocomplete="new-password" required><button type="button" class="password-toggle" data-toggle-password><i data-lucide="eye"></i></button></div></div><div class="field full"><small>Debe incluir mayúscula, minúscula y número.</small><div class="form-actions"><button class="btn" type="button" data-close-modal>Cancelar</button><button class="btn primary" type="submit">Restablecer contraseña</button></div></div></form>`);
    const form=$("#adminResetPassword");form?.addEventListener("submit",async e=>{e.preventDefault();const body=Object.fromEntries(new FormData(form).entries());if(body.contrasena!==body.confirmacion)return showToast("Las contraseñas no coinciden.","error");const submit=form.querySelector('button[type="submit"]');submit.disabled=true;try{const r=await api(`/api/usuarios/${id}/restablecer-contrasena`,{method:"POST",body});showToast(r.message);closeModal();await renderUsuarios();}catch(err){showToast(err.message,"error");}finally{submit.disabled=false;}});window.lucide?.createIcons();
  }

  function confirmUserState(id,activate,name){
    openModal(activate?"Activar usuario":"Desactivar usuario",`<div class="confirm-state-card ${activate?"activate":"deactivate"}"><span><i data-lucide="${activate?"user-round-check":"user-round-x"}"></i></span><div><h3>${activate?"Habilitar acceso":"Deshabilitar acceso"}</h3><p>${activate?`¿Deseas activar la cuenta <strong>${esc(name||`#${id}`)}</strong>?`:`¿Deseas desactivar la cuenta <strong>${esc(name||`#${id}`)}</strong>? Sus sesiones activas se cerrarán.`}</p></div></div><div class="form-actions"><button class="btn" type="button" data-close-modal>Cancelar</button><button class="btn ${activate?"primary":"danger"}" type="button" data-action="confirmar-estado-usuario" data-id="${esc(id)}" data-active="${activate?"1":"0"}">${activate?"Activar usuario":"Desactivar usuario"}</button></div>`);
    window.lucide?.createIcons();
  }

  function equipmentForm(){
    openModal("Registrar equipo",`<form id="equipmentForm" class="form-grid" autocomplete="off">
      <div class="field"><label>Código del equipo</label><input name="codigo" maxlength="50" placeholder="Ej. EQ-001" required></div>
      <div class="field"><label>Estado inicial</label><select name="estado"><option value="DISPONIBLE">DISPONIBLE</option><option value="EN_MANTENIMIENTO">EN MANTENIMIENTO</option><option value="FUERA_DE_USO">FUERA DE USO</option><option value="RETIRADO">RETIRADO</option></select></div>
      <div class="field full"><label>Nombre del equipo</label><input name="nombre" maxlength="160" placeholder="Ej. Hidrolavadora industrial" required></div>
      <div class="field"><label>Categoría</label><input name="categoria" maxlength="100" placeholder="Herramienta, bomba, cámara..."></div>
      <div class="field"><label>Marca</label><input name="marca" maxlength="100"></div>
      <div class="field"><label>Modelo</label><input name="modelo" maxlength="100"></div>
      <div class="field"><label>Número de serie</label><input name="serie" maxlength="120"></div>
      <div class="field"><label>Fecha de adquisición</label><input type="date" name="fecha_adquisicion"></div>
      <div class="field full"><label>Ubicación / resguardo</label><input name="ubicacion" maxlength="220" placeholder="Bodega, vehículo o sede"></div>
      <div class="field full"><label>Descripción <small>(opcional)</small></label><textarea name="descripcion" placeholder="Características, accesorios o notas internas"></textarea></div>
      <div class="field full"><div class="form-actions"><button class="btn" type="button" data-close-modal>Cancelar</button><button class="btn primary" type="submit"><i data-lucide="plus"></i> Registrar equipo</button></div></div>
    </form>`);
    const form=$("#equipmentForm");
    form?.addEventListener("submit",async e=>{e.preventDefault();const submit=form.querySelector('button[type="submit"]');submit.disabled=true;try{const result=await api("/api/equipos",{method:"POST",body:Object.fromEntries(new FormData(form).entries())});showToast(result.message||"Equipo registrado.");closeModal();await renderEquipos();state.catalogs=await api("/api/catalogos");}catch(err){showToast(err.message,"error");}finally{submit.disabled=false;}});
    window.lucide?.createIcons();
  }

  async function renderEquipos(){
    setHeading("Equipo", "Inventario técnico, disponibilidad y fallas abiertas.");
    const d=await api("/api/equipos?tamano=100");
    const all=d.items||[],f=state.equipmentFilter;
    const categories=[...new Set(all.map(x=>x.Categoria||x.categoria).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),"es"));
    const states=[...new Set(all.map(x=>String(x.Estado||x.estado||"").toUpperCase()).filter(Boolean))].sort();
    const q=String(f.q||"").trim().toLowerCase();
    const items=all.filter(x=>{
      const st=String(x.Estado||x.estado||"").toUpperCase(),cat=String(x.Categoria||x.categoria||"");
      if(f.estado!=="TODOS"&&st!==f.estado)return false;
      if(f.categoria!=="TODAS"&&cat!==f.categoria)return false;
      if(!q)return true;
      return [x.codigo,x.CodigoEquipo,x.Nombre,x.nombre,cat,x.Marca,x.marca,x.Modelo,x.modelo,x.Serie,x.serie].some(v=>String(v||"").toLowerCase().includes(q));
    });
    const rows=items.map(x=>{const current=String(x.Estado||x.estado||"DISPONIBLE").toUpperCase();return `<tr><td>${esc(x.codigo||x.CodigoEquipo||"—")}</td><td><strong>${esc(x.Nombre||x.nombre||"—")}</strong>${x.Modelo||x.modelo?`<small class="table-subline">${esc(x.Modelo||x.modelo)}</small>`:""}</td><td>${esc(x.Categoria||x.categoria||"—")}</td><td>${esc(x.Marca||x.marca||"—")}</td><td>${badge(current)}</td><td>${normalizeNumber(x.fallas_abiertas)}</td><td>${state.role==="COORDINADOR"?`<div class="equipment-row-action"><select class="inline-select equipment-state" data-id="${esc(x.id)}">${["DISPONIBLE","ASIGNADO","EN_MANTENIMIENTO","FUERA_DE_USO","RETIRADO"].map(st=>`<option ${st===current?"selected":""}>${st}</option>`).join("")}</select>${button("Guardar","guardar-equipo",x.id)}</div>`:"—"}</td></tr>`;});
    content.innerHTML=`<section class="panel equipment-panel"><div class="panel-header equipment-heading"><div><h2>Inventario de equipo</h2><p class="muted"><span id="equipmentCount">${items.length}</span> de ${all.length} equipos visibles</p></div>${state.role==="COORDINADOR"?`<button class="btn primary" type="button" data-action="nuevo-equipo"><i data-lucide="circle-plus"></i> Registrar equipo</button>`:""}</div><div class="panel-body"><div class="equipment-filter-grid"><label class="catalog-search"><i data-lucide="search"></i><input id="equipmentSearch" type="search" placeholder="Buscar código, equipo, marca, modelo..." value="${esc(f.q)}"></label><select id="equipmentStatus"><option value="TODOS">Todos los estados</option>${states.map(st=>`<option value="${esc(st)}" ${f.estado===st?"selected":""}>${esc(st.replaceAll("_"," "))}</option>`).join("")}</select><select id="equipmentCategory"><option value="TODAS">Todas las categorías</option>${categories.map(cat=>`<option value="${esc(cat)}" ${f.categoria===cat?"selected":""}>${esc(cat)}</option>`).join("")}</select><button class="btn" type="button" data-action="equipos-limpiar"><i data-lucide="rotate-ccw"></i> Limpiar</button></div></div>${table(["Código","Equipo","Categoría","Marca","Estado","Fallas","Acción"],rows,"No hay equipos que coincidan con los filtros.")}</section>`;
    const rerender=()=>renderEquipos().catch(err=>showToast(err.message,"error"));
    $("#equipmentSearch")?.addEventListener("change",e=>{f.q=e.currentTarget.value;rerender();});
    $("#equipmentSearch")?.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();f.q=e.currentTarget.value;rerender();}});
    $("#equipmentStatus")?.addEventListener("change",e=>{f.estado=e.currentTarget.value;rerender();});
    $("#equipmentCategory")?.addEventListener("change",e=>{f.categoria=e.currentTarget.value;rerender();});
    window.lucide?.createIcons();
  }

  async function renderMantenimientos(){setHeading("Mantenimiento interno", "Programación y seguimiento del mantenimiento de equipo.");const d=await api("/api/mantenimientos");const rows=d.items.map(x=>`<tr><td class="mono">#${x.id}</td><td>${esc(x.codigo_equipo)} · ${esc(x.equipo)}</td><td>${badge(x.tipo)}</td><td>${badge(x.Estado||x.estado)}</td><td>${fmt(x.programada)}</td><td>${esc(x.Diagnostico||x.diagnostico||"—")}</td><td>${esc(x.Resultado||x.resultado||"—")}</td></tr>`);content.innerHTML=`<div class="toolbar"><h2>${d.items.length} registros</h2>${state.role==="COORDINADOR"?button("Programar mantenimiento","nuevo-mantenimiento","","primary"):""}</div><section class="panel">${table(["ID","Equipo","Tipo","Estado","Programada","Diagnóstico","Resultado"],rows)}</section>`;}
  function maintenanceForm(){openModal("Programar mantenimiento",`<form id="maintenanceForm" class="form-grid"><div class="field"><label>Equipo</label><select name="equipo_id" required>${optionList(state.catalogs.equipos||[],"id",x=>`${x.codigo} · ${x.nombre}`)}</select></div><div class="field"><label>Tipo</label><select name="tipo"><option>PREVENTIVO</option><option>CORRECTIVO</option></select></div><div class="field"><label>Fecha programada</label><input type="datetime-local" name="fecha_programada"></div><div class="field full"><label>Diagnóstico inicial</label><textarea name="diagnostico"></textarea></div><div class="field full"><label>Trabajo requerido</label><textarea name="trabajo_requerido"></textarea></div><div class="field full"><div class="form-actions"><button class="btn primary">Guardar</button></div></div></form>`);$("#maintenanceForm").addEventListener("submit",async e=>{e.preventDefault();try{await api("/api/mantenimientos",{method:"POST",body:Object.fromEntries(new FormData(e.currentTarget).entries())});showToast("Mantenimiento registrado.");closeModal();navigate("mantenimientos");}catch(err){showToast(err.message,"error");}});}

  async function renderVacaciones(){setHeading("Vacaciones", "Consulta de solicitudes de vacaciones.");const d=await api("/api/vacaciones");const rows=d.items.map(x=>`<tr><td>${esc(x.empleado)}</td><td>${fmt(x.solicitada)}</td><td>${fmt(x.inicio)}</td><td>${fmt(x.fin)}</td><td>${esc(x.dias)}</td><td>${badge(x.Estado||x.estado)}</td><td>${esc(x.Motivo||x.motivo||"—")}</td></tr>`);content.innerHTML=`<section class="panel">${table(["Empleado","Solicitada","Inicio","Fin","Días","Estado","Motivo"],rows)}</section>`;}

  function catalogPriceView(value) {
    const n = normalizeNumber(value);
    return n > 0 ? money(n, "GTQ") : `<span class="catalog-price-empty">Por definir</span>`;
  }

  function catalogFilteredItems() {
    const q = String(state.catalogFilter.q || "").trim().toLowerCase();
    const cat = state.catalogFilter.categoria || "TODAS";
    return (state.masterCatalog || []).filter(x => {
      if (cat !== "TODAS" && x.categoria !== cat) return false;
      if (!q) return true;
      return [x.codigo,x.nombre,x.categoria,x.descripcion,x.unidad].some(v => String(v || "").toLowerCase().includes(q));
    });
  }

  function paintCatalogRows() {
    const host = $("#catalogTableHost");
    if (!host) return;
    const items = catalogFilteredItems();
    const rows = items.map(x => `<tr>
      <td class="mono">${esc(x.codigo)}</td>
      <td><strong>${esc(x.nombre)}</strong>${x.descripcion ? `<small class="table-subline">${esc(x.descripcion)}</small>` : ""}</td>
      <td>${esc(x.categoria || "General")}</td>
      <td class="catalog-price-cell">${catalogPriceView(x.precio)}</td>
      <td>${esc(x.unidad || "servicio")}</td>
      <td>${badge(x.activo ? "ACTIVO" : "INACTIVO")}</td>
      <td><span class="catalog-origin ${x.origen === "SISTEMA" ? "db" : "custom"}">${x.origen === "SISTEMA" ? "Servicio base" : "Personalizado"}</span></td>
      <td><div class="actions">${button("Editar", "editar-catalogo", x.id)}${button(x.activo ? "Desactivar" : "Activar", "toggle-catalogo", x.id, x.activo ? "danger" : "")}</div></td>
    </tr>`);
    host.innerHTML = table(["Código","Trabajo / servicio","Categoría","Precio base","Unidad","Estado","Origen","Acciones"], rows, "No hay trabajos que coincidan con los filtros.");
    const count = $("#catalogVisibleCount"); if (count) count.textContent = String(items.length);
    window.lucide?.createIcons();
  }

  async function renderCatalogoMaestro(){
    setHeading("Catálogo maestro", "Centraliza los trabajos y precios de referencia que coordinación utiliza al preparar cotizaciones.");
    const d = await api("/api/catalogo-maestro?tamano=100");
    state.masterCatalog = d.items || [];
    const categories = d.categorias || [];
    content.innerHTML = `
      <section class="catalog-summary-grid">
        <article class="catalog-summary-card"><span><i data-lucide="book-open-check"></i></span><div><small>Trabajos registrados</small><strong>${normalizeNumber(d.total)}</strong></div></article>
        <article class="catalog-summary-card"><span><i data-lucide="circle-check-big"></i></span><div><small>Activos</small><strong>${normalizeNumber(d.activos)}</strong></div></article>
        <article class="catalog-summary-card accent"><span><i data-lucide="badge-dollar-sign"></i></span><div><small>Con precio definido</small><strong>${normalizeNumber(d.con_precio)}</strong></div></article>
      </section>
      <section class="panel catalog-master-panel">
        <div class="panel-header catalog-master-header"><div><h2>Listado maestro</h2><p class="muted"><span id="catalogVisibleCount">${state.masterCatalog.length}</span> trabajos visibles · los servicios y precios se administran de forma centralizada desde el sistema.</p></div><button class="btn primary" type="button" data-action="nuevo-catalogo"><i data-lucide="plus"></i> Nuevo trabajo</button></div>
        <div class="catalog-toolbar">
          <label class="catalog-search"><i data-lucide="search"></i><input id="catalogSearch" type="search" placeholder="Buscar por código, trabajo o descripción" value="${esc(state.catalogFilter.q)}"></label>
          <select id="catalogCategory"><option value="TODAS">Todas las categorías</option>${categories.map(x=>`<option value="${esc(x)}" ${state.catalogFilter.categoria===x?"selected":""}>${esc(x)}</option>`).join("")}</select>
        </div>
        <div id="catalogTableHost"></div>
      </section>`;
    paintCatalogRows();
    $("#catalogSearch")?.addEventListener("input", e=>{state.catalogFilter.q=e.currentTarget.value;paintCatalogRows();});
    $("#catalogCategory")?.addEventListener("change", e=>{state.catalogFilter.categoria=e.currentTarget.value;paintCatalogRows();});
    window.lucide?.createIcons();
  }

  function catalogForm(itemId=""){
    const current = (state.masterCatalog || []).find(x=>x.id===itemId);
    const isDb = current?.origen === "SISTEMA";
    const categories = [...new Set((state.masterCatalog || []).map(x=>x.categoria).filter(Boolean))].sort();
    openModal(current ? "Editar trabajo del catálogo" : "Nuevo trabajo del catálogo", `<form id="catalogForm" class="form-grid">
      <div class="field"><label>Código</label><input name="codigo" maxlength="40" value="${esc(current?.codigo||"")}" ${isDb?"readonly":""} placeholder="Ej. DRN-001"></div>
      <div class="field"><label>Estado</label><select name="activo"><option value="true" ${current?.activo!==false?"selected":""}>Activo</option><option value="false" ${current?.activo===false?"selected":""}>Inactivo</option></select></div>
      <div class="field full"><label>Trabajo / servicio</label><input name="nombre" maxlength="160" required value="${esc(current?.nombre||"")}" ${isDb?"readonly":""} placeholder="Nombre comercial del trabajo"></div>
      <div class="field"><label>Categoría</label><input name="categoria" list="catalogCategories" value="${esc(current?.categoria||"General")}" required><datalist id="catalogCategories">${categories.map(x=>`<option value="${esc(x)}"></option>`).join("")}</datalist></div>
      <div class="field"><label>Unidad</label><input name="unidad" value="${esc(current?.unidad||"servicio")}" placeholder="servicio, unidad, hora..."></div>
      <div class="field"><label>Precio base (Q)</label><input name="precio" type="number" min="0" step="0.01" value="${normalizeNumber(current?.precio)}" required></div>
      <div class="field full"><label>Descripción / alcance de referencia</label><textarea name="descripcion" placeholder="Detalle que puede reutilizarse al cotizar">${esc(current?.descripcion||"")}</textarea></div>
      ${isDb?`<div class="field full"><div class="catalog-db-note"><i data-lucide="database"></i><span>Este trabajo pertenece al catálogo base del sistema. Código y nombre se conservan sincronizados; aquí administras precio, categoría y descripción sin alterar la estructura principal.</span></div></div>`:""}
      <div class="field full"><div class="form-actions"><button class="btn" type="button" data-close-modal>Cancelar</button><button class="btn primary" type="submit">${current?"Guardar cambios":"Agregar trabajo"}</button></div></div>
    </form>`);
    $("#catalogForm")?.addEventListener("submit",async e=>{e.preventDefault();const form=e.currentTarget;const body=Object.fromEntries(new FormData(form).entries());body.activo=body.activo==="true";try{await api(current?`/api/catalogo-maestro/${encodeURIComponent(current.id)}`:"/api/catalogo-maestro",{method:current?"PATCH":"POST",body});showToast(current?"Catálogo actualizado.":"Trabajo agregado al catálogo.");closeModal();await renderCatalogoMaestro();}catch(err){showToast(err.message,"error");}});
  }

  async function renderCotizaciones(){
    setHeading("Cotizaciones", state.role === "CLIENTE" ? "Consulta el expediente completo: solicitud → orden con evidencias → cotización descargable." : "Cotizaciones versionadas y respuesta del cliente; no existe flujo de pagos en el sistema.");
    const d=await api("/api/cotizaciones");
    const rows=d.items.map(x=>{
      const st=String(x.Estado||x.estado||"").toUpperCase();
      const actions=[];
      if(state.role==="CLIENTE"){
        actions.push(button("Ver expediente","ver-expediente-cotizacion",x.id,"primary"));
      }else{
        if(x.orden_id)actions.push(button("Ver OT","ver-orden",x.orden_id));
        if(["BORRADOR","OBSERVADA","CONFIRMADA"].includes(st))actions.push(button("Enviar al cliente","enviar-cotizacion",x.id,"primary"));
      }
      return `<tr><td>${esc(x.numero)}</td><td>${esc(x.cliente)}</td><td>${esc(x.orden)}</td><td>${badge(st)}</td><td>${esc(x.version||"—")}</td><td>${money(x.Total||x.total,x.Moneda||x.moneda)}</td><td>${fmt(x.emision||x.creada)}</td><td><div class="actions">${actions.join("")||"—"}</div></td></tr>`;
    });
    const intro=state.role==="CLIENTE"?`<section class="quote-client-intro"><div><span class="quote-client-intro-icon"><i data-lucide="folder-open"></i></span><div><small>EXPEDIENTE DEL SERVICIO</small><h2>Todo el proceso en un solo lugar</h2><p>Abre una cotización para consultar la solicitud original, la orden de trabajo con su collage de evidencias y finalmente descargar la cotización.</p></div></div></section>`:"";
    content.innerHTML=`${intro}<div class="toolbar"><div class="toolbar-left"><h2>${d.items.length} cotizaciones</h2>${state.role==="CLIENTE"?`<p class="muted">Solo aparecen cotizaciones que ya fueron puestas a disposición de tu empresa.</p>`:""}</div>${state.role==="COORDINADOR"?button("Nueva cotización","nueva-cotizacion","","primary"):""}</div><section class="panel">${table(["No.","Cliente","Orden","Estado","Versión","Total","Fecha","Acción"],rows,"No hay cotizaciones disponibles todavía.")}</section>`;
    window.lucide?.createIcons();
  }

  function quoteFlowPhoto(item){
    const src=String(item.ruta||"");
    if(!src)return "";
    return `<a class="quote-collage-item" href="${esc(src)}" target="_blank" rel="noopener"><img src="${esc(src)}" alt="Evidencia de servicio" loading="lazy"><span><i data-lucide="maximize-2"></i> Ver imagen</span>${item.etapa?`<small>${esc(item.etapa)}</small>`:""}</a>`;
  }

  async function openClientQuoteFlow(id){
    if(state.role!=="CLIENTE") return navigate("cotizaciones");
    setHeading("Expediente de cotización", "Solicitud, ejecución del servicio y propuesta comercial en orden cronológico.");
    content.innerHTML=`<section class="panel"><div class="quote-flow-loading"><span class="spinner"></span><h3>Cargando expediente...</h3><p>Estamos reuniendo la solicitud, la orden, las evidencias y la cotización.</p></div></section>`;
    try{
      const d=await api(`/api/cotizaciones/${id}/expediente`);
      const x=d.item||{}, evidence=d.evidencias||[], lines=d.detalles||[];
      const quoteState=String(x.cotizacion_estado||"").toUpperCase();
      const photos=evidence.length?evidence.map(quoteFlowPhoto).join(""):`<div class="quote-collage-empty"><i data-lucide="images"></i><strong>Collage pendiente</strong><span>Las fotografías del trabajo aparecerán aquí cuando hayan sido cargadas a la orden.</span></div>`;
      const lineRows=lines.map(l=>`<tr><td>${esc(l.numero_linea||"—")}</td><td>${esc(l.descripcion||"—")}</td><td>${esc(l.cantidad??"—")}</td><td>${esc(l.unidad||"—")}</td><td>${money(l.precio_unitario,x.moneda)}</td><td>${money(l.total_linea,x.moneda)}</td></tr>`);
      const canRespond=quoteState==="ENVIADA";
      content.innerHTML=`
        <div class="quote-flow-backbar"><button class="btn" type="button" data-action="volver-cotizaciones"><i data-lucide="arrow-left"></i> Volver a cotizaciones</button><span>${badge(quoteState)}</span></div>
        <section class="quote-flow-hero">
          <div><small>EXPEDIENTE DEL SERVICIO</small><h2>${esc(x.numero_cotizacion||`Cotización #${id}`)}</h2><p>${esc(x.cliente||"")} · ${esc(x.sede||"")}</p></div>
          <div class="quote-flow-hero-total"><small>Total cotizado</small><strong>${money(x.total,x.moneda)}</strong><span>Versión ${esc(x.numero_version||"—")}</span></div>
        </section>
        <section class="quote-flow-steps" aria-label="Flujo de la cotización">
          <article class="quote-flow-step is-done"><span>1</span><div><small>ORIGEN</small><strong>Solicitud</strong><p>Lo que el cliente reportó inicialmente.</p></div></article>
          <div class="quote-flow-line"></div>
          <article class="quote-flow-step is-done"><span>2</span><div><small>EJECUCIÓN</small><strong>Orden de trabajo</strong><p>Atención realizada y evidencias del servicio.</p></div></article>
          <div class="quote-flow-line"></div>
          <article class="quote-flow-step is-done"><span>3</span><div><small>PROPUESTA</small><strong>Cotización</strong><p>Detalle económico y documento descargable.</p></div></article>
        </section>

        <section class="quote-stage-card quote-stage-request">
          <div class="quote-stage-number">01</div>
          <div class="quote-stage-heading"><span><i data-lucide="file-plus-2"></i></span><div><small>SOLICITUD DE SERVICIO</small><h2>${esc(x.tipo_servicio||"Servicio solicitado")}</h2><p>Registrada ${fmt(x.solicitud_creada)}</p></div></div>
          <div class="quote-stage-grid">
            <div class="quote-stage-main"><h3>Problema reportado</h3><p>${esc(x.solicitud_descripcion||"Sin descripción registrada.")}</p></div>
            <div class="quote-stage-facts">
              <div><small>Solicitud</small><strong>#${esc(x.solicitud_id||"—")}</strong></div>
              <div><small>Clasificación</small><strong>${esc(x.clasificacion||"—")}</strong></div>
              <div><small>Urgencia</small><strong>${esc(x.nivel_urgencia||"—")}</strong></div>
              <div><small>Sede</small><strong>${esc(x.sede||"—")}</strong></div>
              <div class="wide"><small>Dirección</small><strong>${esc([x.direccion,x.municipio,x.departamento].filter(Boolean).join(", ")||"—")}</strong></div>
            </div>
          </div>
        </section>

        <section class="quote-stage-card quote-stage-order">
          <div class="quote-stage-number">02</div>
          <div class="quote-stage-heading"><span><i data-lucide="clipboard-check"></i></span><div><small>ORDEN DE TRABAJO</small><h2>${esc(x.numero_orden||`OT #${x.orden_id||"—"}`)}</h2><p>${badge(x.orden_estado||"EN PROCESO")}</p></div></div>
          <div class="quote-order-summary">
            <div><small>Prioridad</small><strong>${esc(x.prioridad||"—")}</strong></div>
            <div><small>Programada</small><strong>${fmt(x.programada_para)}</strong></div>
            <div><small>Inicio</small><strong>${fmt(x.iniciada_en)}</strong></div>
            <div><small>Finalización</small><strong>${fmt(x.finalizada_en)}</strong></div>
          </div>
          ${x.observaciones_coordinacion?`<div class="quote-order-note"><i data-lucide="message-square-text"></i><div><small>Observación de coordinación</small><p>${esc(x.observaciones_coordinacion)}</p></div></div>`:""}
          <div class="quote-collage-head"><div><small>EVIDENCIA DEL SERVICIO</small><h3>Collage de imágenes</h3></div><span>${evidence.length} foto${evidence.length===1?"":"s"}</span></div>
          <div class="quote-collage-grid">${photos}</div>
        </section>

        <section class="quote-stage-card quote-stage-quote">
          <div class="quote-stage-number">03</div>
          <div class="quote-stage-heading"><span><i data-lucide="receipt-text"></i></span><div><small>COTIZACIÓN</small><h2>${esc(x.numero_cotizacion||`Cotización #${id}`)}</h2><p>Emitida ${fmt(x.fecha_emision)} · vence ${fmt(x.fecha_expiracion)}</p></div></div>
          <div class="quote-commercial-grid">
            <div><small>Estado</small><strong>${esc(quoteState||"—")}</strong></div>
            <div><small>Moneda</small><strong>${esc(x.moneda||"GTQ")}</strong></div>
            <div><small>Condición</small><strong>${esc(x.condicion_pago||"—")}</strong></div>
            <div><small>Versión</small><strong>${esc(x.numero_version||"—")}</strong></div>
          </div>
          <div class="quote-lines-panel">${table(["#","Descripción","Cantidad","Unidad","Precio unitario","Total"],lineRows,"No hay líneas registradas en la cotización.")}</div>
          <div class="quote-totals">
            <div><span>Subtotal</span><strong>${money(x.subtotal,x.moneda)}</strong></div>
            <div><span>Descuento</span><strong>${money(x.descuento_total,x.moneda)}</strong></div>
            <div><span>Impuesto</span><strong>${money(x.impuesto_total,x.moneda)}</strong></div>
            <div class="grand"><span>Total</span><strong>${money(x.total,x.moneda)}</strong></div>
          </div>
          ${x.observaciones_cliente?`<div class="quote-client-observation"><small>Tu respuesta / observación</small><p>${esc(x.observaciones_cliente)}</p></div>`:""}
          <div class="quote-download-bar"><div><i data-lucide="file-down"></i><div><strong>Cotización en PDF</strong><span>Descarga una copia del documento con los datos vigentes de esta versión.</span></div></div><div class="actions"><a class="btn primary" href="/api/cotizaciones/${id}/pdf" download><i data-lucide="download"></i> Descargar cotización</a>${canRespond?button("Responder cotización","responder-cotizacion",id):""}</div></div>
        </section>`;
      window.lucide?.createIcons();
    }catch(err){
      content.innerHTML=`<section class="panel"><div class="empty-state"><h3>No se pudo abrir el expediente</h3><p>${esc(err.message)}</p><button class="btn primary" type="button" data-action="volver-cotizaciones">Volver</button></div></section>`;
      window.lucide?.createIcons();
    }
  }

  async function quoteForm(preselectedOrderId=""){
    const od=await api("/api/ordenes?tamano=100");
    let catalogItems=[];
    try{const cd=await api("/api/catalogo-maestro?solo_activos=1&tamano=100");catalogItems=cd.items||[];state.masterCatalog=cd.items||[];}catch(_){catalogItems=[];}
    const selected=od.items.find(x=>String(x.id)===String(preselectedOrderId));
    const matchingCatalog=selected?catalogItems.find(x=>String(x.nombre||"").toLowerCase()===String(selected.tipo||"").toLowerCase()):null;
    const catalogOptions=()=>catalogItems.map(x=>`<option value="${esc(x.id)}" ${matchingCatalog?.id===x.id?"selected":""}>${esc(x.codigo||"CAT")} · ${esc(x.nombre)} · ${normalizeNumber(x.precio)>0?money(x.precio,"GTQ"):"Precio por definir"}</option>`).join("");
    openModal(preselectedOrderId?"Crear cotización desde la OT":"Nueva cotización",`<form id="quoteForm" class="form-grid quote-form-organized">
      <div class="quote-form-step full"><span>1</span><div><strong>Selecciona la orden</strong><small>La propuesta queda vinculada a esta OT.</small></div></div>
      <div class="field full"><label>Orden de trabajo</label><select name="orden_id" id="quoteOrder" required><option value="">Seleccione...</option>${optionList(od.items,"id",x=>`${x.numero} · ${x.cliente} · ${x.tipo}`,preselectedOrderId)}</select></div>
      <div class="quote-form-step full"><span>2</span><div><strong>Reutiliza o agrega un trabajo</strong><small>El catálogo funciona como base; el precio y alcance se pueden ajustar en esta cotización.</small></div></div>
      <div class="field full"><label>Trabajo del catálogo maestro <span class="optional-label">opcional</span></label><select id="quoteCatalog"><option value="">Seleccionar trabajo...</option>${catalogOptions()}</select></div>
      <details class="quote-new-catalog full"><summary><i data-lucide="circle-plus"></i> Agregar un trabajo nuevo al catálogo sin salir de la cotización</summary><div class="quote-new-catalog-grid">
        <div class="field"><label>Nombre</label><input id="quoteNewCatalogName" maxlength="160" placeholder="Ej. Limpieza especial"></div>
        <div class="field"><label>Precio base (Q)</label><input id="quoteNewCatalogPrice" type="number" min="0" step="0.01" placeholder="0.00"></div>
        <div class="field"><label>Categoría</label><input id="quoteNewCatalogCategory" maxlength="80" placeholder="General"></div>
        <div class="field"><label>Unidad</label><input id="quoteNewCatalogUnit" maxlength="40" value="servicio"></div>
        <div class="field full"><label>Descripción / alcance</label><textarea id="quoteNewCatalogDescription" placeholder="Descripción reutilizable para futuras cotizaciones"></textarea></div>
        <div class="field full"><div class="form-actions"><button class="btn" id="quoteCatalogCreate" type="button"><i data-lucide="save"></i> Guardar en catálogo y usar</button></div></div>
      </div></details>
      <div class="quote-form-step full"><span>3</span><div><strong>Define la propuesta</strong><small>Estos son los datos específicos de esta cotización.</small></div></div>
      <div class="field full"><label>Descripción / alcance cotizado</label><textarea name="descripcion" id="quoteDescription" required>${matchingCatalog?esc(matchingCatalog.descripcion||matchingCatalog.nombre):(selected?esc(`${selected.tipo} - ${selected.cliente}`):"")}</textarea></div>
      <div class="field"><label>Precio (Q)</label><input name="precio" id="quotePrice" type="number" step="0.01" min="0" value="${matchingCatalog?normalizeNumber(matchingCatalog.precio):""}" required></div>
      <div class="field"><label>Vigencia (días)</label><input name="dias_vigencia" type="number" value="15" min="1"></div>
      <div class="field full"><label>Condición comercial</label><input name="condicion_pago" value="POR DEFINIR"><small>El sistema registra la propuesta y autorización; no procesa pagos.</small></div>
      <div class="field full"><div class="form-actions">${preselectedOrderId?backToOrder(preselectedOrderId):`<button class="btn" type="button" data-close-modal>Cancelar</button>`}<button class="btn primary">Crear borrador</button></div></div>
    </form>`);
    const useCatalogItem=item=>{if(!item)return;const desc=$("#quoteDescription"),price=$("#quotePrice");if(desc)desc.value=item.descripcion||item.nombre;if(price)price.value=normalizeNumber(item.precio)||"";};
    $("#quoteCatalog")?.addEventListener("change",e=>useCatalogItem(catalogItems.find(x=>x.id===e.currentTarget.value)));
    $("#quoteCatalogCreate")?.addEventListener("click",async()=>{
      const name=String($("#quoteNewCatalogName")?.value||"").trim();
      const price=String($("#quoteNewCatalogPrice")?.value||"").trim();
      if(!name)return showToast("Escribe el nombre del nuevo trabajo.","error");
      if(price===""||Number(price)<0)return showToast("Indica un precio base válido.","error");
      const btn=$("#quoteCatalogCreate");btn.disabled=true;
      try{
        const result=await api("/api/catalogo-maestro",{method:"POST",body:{nombre:name,precio:Number(price),categoria:String($("#quoteNewCatalogCategory")?.value||"General").trim()||"General",unidad:String($("#quoteNewCatalogUnit")?.value||"servicio").trim()||"servicio",descripcion:String($("#quoteNewCatalogDescription")?.value||"").trim(),activo:true}});
        const item=result.item;if(item){catalogItems.push(item);state.masterCatalog.push(item);const select=$("#quoteCatalog");select.insertAdjacentHTML("beforeend",`<option value="${esc(item.id)}">${esc(item.codigo||"CAT")} · ${esc(item.nombre)} · ${money(item.precio,"GTQ")}</option>`);select.value=item.id;useCatalogItem(item);}
        showToast("Trabajo agregado al catálogo y cargado en la cotización.");
        $(".quote-new-catalog")?.removeAttribute("open");
      }catch(err){showToast(err.message,"error");}finally{btn.disabled=false;}
    });
    $("#quoteForm").addEventListener("submit",async e=>{e.preventDefault();try{
      await api("/api/cotizaciones",{method:"POST",body:Object.fromEntries(new FormData(e.currentTarget).entries())});
      showToast("Cotización creada y vinculada a la OT.");
      if(preselectedOrderId) await openOrder(preselectedOrderId); else {closeModal();navigate("cotizaciones");}
    }catch(err){showToast(err.message,"error");}});
    window.lucide?.createIcons();
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
        <section class="panel account-panel"><div class="panel-header"><div><h2>Acceso al portal</h2><p class="muted">Los datos de la cuenta son administrados únicamente por Coordinación.</p></div></div><div class="panel-body"><div class="account-data-grid">${accountValue("Correo de acceso",p.correo_acceso,"mail")}${accountValue("Usuario",p.usuario,"at-sign")}</div><div class="private-account-note"><i data-lucide="shield-check"></i><span>Desde Mi cuenta puedes cambiar tu contraseña. Usuario, correo, rol y estado se administran desde el módulo Usuarios.</span></div></div></section>
        <section class="panel account-panel password-panel"><div class="panel-header"><div><h2>Seguridad y contraseña</h2><p class="muted">Para cambiarla debes confirmar primero tu contraseña actual.</p></div></div><div class="panel-body"><form id="passwordForm" class="account-form"><div class="field"><label>Contraseña actual</label><div class="password-control"><input type="password" name="actual" autocomplete="current-password" required><button type="button" class="password-toggle" data-toggle-password aria-label="Mostrar contraseña"><i data-lucide="eye"></i></button></div></div><div class="field"><label>Nueva contraseña</label><div class="password-control"><input type="password" name="nueva" autocomplete="new-password" minlength="8" required><button type="button" class="password-toggle" data-toggle-password aria-label="Mostrar contraseña"><i data-lucide="eye"></i></button></div><small>Mínimo 8 caracteres, con mayúscula, minúscula y número.</small></div><div class="field"><label>Confirmar nueva contraseña</label><div class="password-control"><input type="password" name="confirmacion" autocomplete="new-password" minlength="8" required><button type="button" class="password-toggle" data-toggle-password aria-label="Mostrar contraseña"><i data-lucide="eye"></i></button></div></div><div class="form-actions"><button class="btn primary" type="submit">Cambiar contraseña</button></div></form></div></section>
        <section class="panel account-panel sessions-panel"><div class="panel-header"><div><h2>Sesiones activas</h2><p class="muted">Revisa desde dónde está abierta tu cuenta.</p></div><button class="btn small danger" type="button" data-action="cerrar-otras-sesiones" ${(sessionsData.items||[]).filter(x=>!x.actual).length?"":"disabled"}>Cerrar otras sesiones</button></div><div class="panel-body"><div class="session-list">${sessions}</div></div></section>
      </div>`;
    window.lucide?.createIcons();

    $("#passwordForm")?.addEventListener("submit",async e=>{e.preventDefault();const form=e.currentTarget;const data=Object.fromEntries(new FormData(form).entries());if(data.nueva!==data.confirmacion)return showToast("La confirmación de la nueva contraseña no coincide.","error");const submit=form.querySelector('button[type="submit"]');submit.disabled=true;try{await api("/api/cuenta/contrasena",{method:"POST",body:data});form.reset();showToast("Contraseña actualizada correctamente.");refreshNotificationBadge().catch(()=>{});}catch(err){showToast(err.message,"error");}finally{submit.disabled=false;}});
  }


  async function renderAuditoria(){setHeading("Auditoría", "Registro de altas, cambios y bajas realizados dentro del sistema.");const d=await api("/api/auditoria");const rows=d.items.map(x=>`<tr><td class="mono">#${x.id}</td><td>${fmt(x.fecha)}</td><td>${esc(x.Esquema||x.esquema)}.${esc(x.Tabla||x.tabla)}</td><td>${badge(x.Operacion||x.operacion)}</td><td>${esc(x.usuario)}</td><td>${esc(x.ip||"—")}</td><td>${esc(x.Observacion||x.observacion||"—")}</td></tr>`);content.innerHTML=`<div class="toolbar"><h2>Últimos ${d.items.length} eventos</h2>${button("Probar auditoría","probar-auditoria","","primary")}</div><section class="panel">${table(["ID","Fecha","Tabla","Operación","Usuario","IP","Observación"],rows)}</section>`;}

  function warrantyCountdownMarkup(seconds) {
    const total=Math.max(0,Number(seconds||0));
    const days=Math.floor(total/86400);
    const hours=Math.floor((total%86400)/3600);
    const minutes=Math.floor((total%3600)/60);
    const secs=Math.floor(total%60);
    const z=n=>String(n).padStart(2,"0");
    return `<span><strong>${days}</strong><small>días</small></span><span><strong>${z(hours)}</strong><small>horas</small></span><span><strong>${z(minutes)}</strong><small>min</small></span><span><strong>${z(secs)}</strong><small>seg</small></span>`;
  }

  function startWarrantyCountdowns(){
    if(state.warrantyTimer)clearInterval(state.warrantyTimer);
    const tick=()=>{
      $$('[data-warranty-seconds]').forEach(el=>{
        let seconds=Math.max(0,Number(el.dataset.warrantySeconds||0));
        el.innerHTML=warrantyCountdownMarkup(seconds);
        if(seconds>0)el.dataset.warrantySeconds=String(seconds-1);
        else{
          const card=el.closest('.warranty-card');
          card?.classList.add('expired');
          const status=card?.querySelector('.warranty-state');
          if(status&&status.dataset.dynamic==='1')status.textContent='VENCIDA';
        }
      });
    };
    tick();
    state.warrantyTimer=setInterval(tick,1000);
  }

  function warrantyStateBadge(x){
    const status=String(x.estado_garantia||'PENDIENTE_CONFIGURACION').toUpperCase();
    const cls=status==='ACTIVA'?'active':status==='VENCIDA'?'expired':status==='ANULADA'?'cancelled':'pending';
    return `<span class="warranty-state ${cls}" data-dynamic="${status==='ACTIVA'?'1':'0'}">${esc(status.replaceAll('_',' '))}</span>`;
  }

  function warrantyCard(x){
    const status=String(x.estado_garantia||'PENDIENTE_CONFIGURACION').toUpperCase();
    const active=status==='ACTIVA';
    const expired=status==='VENCIDA';
    const pending=status==='PENDIENTE_CONFIGURACION';
    const req=String(x.estado_solicitud||'').toUpperCase();
    const reqBadge=req?`<span class="warranty-request-pill">Revisión: ${esc(req.replaceAll('_',' '))}</span>`:'';
    const coord=state.role==='COORDINADOR';
    const countdown=active
      ? `<div class="warranty-countdown-label">Tiempo restante de garantía</div><div class="warranty-countdown" data-warranty-seconds="${esc(x.segundos_restantes||0)}">${warrantyCountdownMarkup(x.segundos_restantes)}</div>`
      : expired
        ? `<div class="warranty-ended"><i data-lucide="clock-alert"></i><div><strong>Garantía finalizada</strong><span>Venció el ${esc(fmt(x.fin_garantia))}.</span></div></div>`
        : pending
          ? `<div class="warranty-ended pending"><i data-lucide="hourglass"></i><div><strong>Plazo pendiente de configurar</strong><span>La OT ya terminó; Coordinación todavía debe definir el período de garantía.</span></div></div>`
          : `<div class="warranty-ended"><i data-lucide="shield-x"></i><div><strong>Garantía anulada</strong><span>Consulta con Coordinación para más información.</span></div></div>`;
    const progress=active?Math.max(0,Math.min(100,Number(x.porcentaje_restante||0))):0;
    const actions=[`<button class="btn small" data-action="ver-orden" data-id="${esc(x.orden_id)}"><i data-lucide="clipboard-list"></i> Ver OT</button>`];
    if(coord)actions.push(`<button class="btn small primary" data-action="configurar-garantia" data-id="${esc(x.orden_id)}"><i data-lucide="calendar-clock"></i> ${x.garantia_id?'Editar plazo':'Configurar garantía'}</button>`);
    if(!coord&&active&&!['PENDIENTE','EN_REVISION'].includes(req))actions.push(`<button class="btn small primary" data-action="solicitar-revision-garantia" data-id="${esc(x.garantia_id)}"><i data-lucide="shield-question"></i> Solicitar revisión</button>`);
    return `<article class="warranty-card ${expired?'expired':''} ${pending?'pending':''}">
      <div class="warranty-card-top"><div class="warranty-order-icon"><i data-lucide="shield-check"></i></div><div class="warranty-card-title"><span>${esc(x.numero_orden||`OT #${x.orden_id}`)}</span><h3>${esc(x.tipo_servicio||'Servicio')}</h3><p>${esc(x.cliente||'')} ${x.sede?`· ${esc(x.sede)}`:''}</p></div>${warrantyStateBadge(x)}</div>
      <div class="warranty-meta"><div><small>Finalizada</small><strong>${fmt(x.finalizada_en)}</strong></div><div><small>Inicio garantía</small><strong>${x.inicio_garantia?fmt(x.inicio_garantia):'—'}</strong></div><div><small>Vencimiento</small><strong>${x.fin_garantia?fmt(x.fin_garantia):'—'}</strong></div><div><small>Plazo</small><strong>${x.dias_garantia?`${esc(x.dias_garantia)} días`:'—'}</strong></div></div>
      ${countdown}
      ${active?`<div class="warranty-progress"><span style="width:${progress}%"></span></div>`:''}
      ${reqBadge}
      <div class="warranty-actions">${actions.join('')}</div>
    </article>`;
  }

  async function warrantyConfigForm(orderId){
    const x=state.warranties.find(item=>Number(item.orden_id)===Number(orderId));
    if(!x)return showToast('No se encontró la OT finalizada.','error');
    openModal(`${x.garantia_id?'Editar':'Configurar'} garantía · ${x.numero_orden}`,`<form id="warrantyConfigForm" class="form-grid">
      <div class="field full"><div class="warranty-rule-note"><i data-lucide="timer-reset"></i><div><strong>La garantía siempre cuenta desde la finalización original de la OT.</strong><span>Cambiar el plazo no reinicia el contador desde hoy.</span></div></div></div>
      <div class="field"><label>Días de garantía</label><input type="number" name="dias" min="1" max="3650" value="${esc(x.dias_garantia||'')}" required placeholder="Ej. 30"></div>
      <div class="field"><label>OT finalizada</label><input value="${esc(fmt(x.finalizada_en))}" disabled></div>
      <div class="field full"><label>Observaciones <small>(opcional)</small></label><textarea name="observaciones" maxlength="600" placeholder="Condiciones o alcance de la garantía...">${esc(x.observaciones_garantia||'')}</textarea></div>
      <div class="field full"><div class="form-actions"><button class="btn" type="button" data-close-modal>Cancelar</button><button class="btn primary" type="submit">Guardar garantía</button></div></div>
    </form>`);
    $('#warrantyConfigForm').addEventListener('submit',async e=>{e.preventDefault();const submit=e.currentTarget.querySelector('button[type="submit"]');submit.disabled=true;try{const r=await api(`/api/garantias/${orderId}/configurar`,{method:'POST',body:Object.fromEntries(new FormData(e.currentTarget).entries())});showToast(r.message||'Garantía configurada.');closeModal();await renderGarantia();}catch(err){showToast(err.message,'error');submit.disabled=false;}});
  }

  async function warrantyRequestForm(guaranteeId){
    const x=state.warranties.find(item=>Number(item.garantia_id)===Number(guaranteeId));
    if(!x)return showToast('No se encontró la garantía.','error');
    openModal(`Solicitar revisión · ${x.numero_orden}`,`<form id="warrantyRequestForm" class="form-grid">
      <div class="field full"><div class="warranty-rule-note client"><i data-lucide="link-2"></i><div><strong>Esta revisión queda vinculada al mismo trabajo.</strong><span>No se crea una garantía desde cero: SEPRIGUA recibe la OT original, sede, servicio y plazo vigente.</span></div></div></div>
      <div class="field"><label>Orden</label><input value="${esc(x.numero_orden)}" disabled></div><div class="field"><label>Servicio</label><input value="${esc(x.tipo_servicio)}" disabled></div>
      <div class="field full"><label>¿Qué necesitas que revisemos?</label><textarea name="descripcion" maxlength="1200" required placeholder="Describe qué volvió a ocurrir o qué comportamiento observas..."></textarea></div>
      <div class="field full"><div class="form-actions"><button class="btn" type="button" data-close-modal>Cancelar</button><button class="btn primary" type="submit">Enviar revisión de garantía</button></div></div>
    </form>`);
    $('#warrantyRequestForm').addEventListener('submit',async e=>{e.preventDefault();const submit=e.currentTarget.querySelector('button[type="submit"]');submit.disabled=true;try{const r=await api(`/api/garantias/${guaranteeId}/solicitar`,{method:'POST',body:Object.fromEntries(new FormData(e.currentTarget).entries())});showToast(r.message||'Solicitud enviada.');closeModal();await renderGarantia();}catch(err){showToast(err.message,'error');submit.disabled=false;}});
  }

  async function warrantyRequestStatusForm(requestId){
    const x=state.warrantyRequests.find(item=>Number(item.solicitud_garantia_id)===Number(requestId));
    if(!x)return showToast('No se encontró la solicitud de revisión.','error');
    openModal(`Revisión de garantía · ${x.numero_orden}`,`<form id="warrantyStatusForm" class="form-grid">
      <div class="field full"><div class="warranty-request-detail"><strong>${esc(x.cliente)} · ${esc(x.sede||'Sede')}</strong><p>${esc(x.descripcion||'')}</p></div></div>
      <div class="field"><label>Estado</label><select name="estado" required>${['PENDIENTE','EN_REVISION','ATENDIDA','RECHAZADA','CERRADA'].map(v=>`<option value="${v}" ${String(x.estado).toUpperCase()===v?'selected':''}>${v.replaceAll('_',' ')}</option>`).join('')}</select></div>
      <div class="field full"><label>Respuesta / observaciones</label><textarea name="observaciones" maxlength="900">${esc(x.observaciones_respuesta||'')}</textarea></div>
      <div class="field full"><div class="form-actions"><button class="btn" type="button" data-close-modal>Cancelar</button><button class="btn primary">Actualizar revisión</button></div></div>
    </form>`);
    $('#warrantyStatusForm').addEventListener('submit',async e=>{e.preventDefault();const submit=e.currentTarget.querySelector('button[type="submit"]');submit.disabled=true;try{const r=await api(`/api/garantias/solicitudes/${requestId}/estado`,{method:'POST',body:Object.fromEntries(new FormData(e.currentTarget).entries())});showToast(r.message||'Revisión actualizada.');closeModal();await renderGarantia();}catch(err){showToast(err.message,'error');submit.disabled=false;}});
  }

  async function renderGarantia(){
    const coord=state.role==='COORDINADOR';
    setHeading(coord?'Garantías':'Mi garantía',coord?'Configura el plazo sobre OTs ya finalizadas y da seguimiento a las revisiones del mismo trabajo.':'Consulta tus trabajos finalizados, el tiempo restante y solicita una revisión sobre la OT original.');
    const d=await api('/api/garantias');
    state.warranties=d.items||[];state.warrantyRequests=d.solicitudes||[];
    const s=d.resumen||{};
    const stats=`<section class="stats-grid warranty-stats"><article class="stat-card stat-blue"><div class="stat-icon"><i data-lucide="clipboard-check"></i></div><div class="stat-copy"><span>OT finalizadas</span><strong>${normalizeNumber(s.finalizadas)}</strong></div></article><article class="stat-card stat-green"><div class="stat-icon"><i data-lucide="shield-check"></i></div><div class="stat-copy"><span>Garantías activas</span><strong>${normalizeNumber(s.activas)}</strong></div></article><article class="stat-card stat-amber"><div class="stat-icon"><i data-lucide="hourglass"></i></div><div class="stat-copy"><span>${coord?'Por configurar':'Pendientes'}</span><strong>${normalizeNumber(s.pendientes_configurar)}</strong></div></article><article class="stat-card stat-red"><div class="stat-icon"><i data-lucide="clock-alert"></i></div><div class="stat-copy"><span>Vencidas</span><strong>${normalizeNumber(s.vencidas)}</strong></div></article></section>`;
    const cards=state.warranties.map(warrantyCard).join('')||`<div class="empty-state"><h3>No hay OTs finalizadas todavía</h3><p>Cuando una orden quede COMPLETADA aparecerá aquí automáticamente.</p></div>`;
    const requestRows=coord?state.warrantyRequests.map(x=>`<tr><td>${esc(x.numero_orden)}</td><td>${esc(x.cliente)}</td><td>${esc(x.sede||'—')}</td><td>${esc(x.tipo_servicio)}</td><td>${badge(x.estado)}</td><td>${fmt(x.creado_en)}</td><td><button class="btn small" data-action="estado-solicitud-garantia" data-id="${esc(x.solicitud_garantia_id)}">Gestionar</button></td></tr>`):[];
    content.innerHTML=`${stats}<section class="panel warranty-explainer"><div class="panel-body"><div class="warranty-explainer-icon"><i data-lucide="refresh-ccw"></i></div><div><h2>La garantía continúa desde la OT original</h2><p>${coord?'No se crea un registro desde cero. Selecciona una OT COMPLETADA, define su plazo y el sistema calcula el vencimiento usando la fecha real de finalización.':'Cada tarjeta corresponde a un trabajo ya finalizado. Si la garantía está activa, el contador muestra exactamente cuánto tiempo queda para solicitar revisión de ese mismo trabajo.'}</p></div><button class="btn small" data-action="refrescar-garantias"><i data-lucide="refresh-cw"></i> Actualizar</button></div></section><div class="warranty-grid">${cards}</div>${coord?`<section class="panel warranty-requests-panel"><div class="panel-header"><div><h2>Solicitudes de revisión</h2><p class="muted">Reclamos vinculados a una garantía y a su OT original.</p></div></div>${table(['OT','Cliente','Sede','Servicio','Estado','Solicitada','Acción'],requestRows,'No hay solicitudes de revisión de garantía.')}</section>`:''}`;
    window.lucide?.createIcons();
    startWarrantyCountdowns();
  }

  document.addEventListener("click", async e => {
    const moduleBtn=e.target.closest("[data-module]");
    if(moduleBtn){closeTopPopovers();navigate(moduleBtn.dataset.module);setSidebarOpen(false);return;}
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

    const userSort=e.target.closest("[data-user-sort]");
    if(userSort&&state.current==="usuarios") {
      const key=userSort.dataset.userSort||"FECHA";
      if(state.userAdmin.orden===key) state.userAdmin.direccion=state.userAdmin.direccion==="ASC"?"DESC":"ASC";
      else {state.userAdmin.orden=key;state.userAdmin.direccion=key==="USUARIO"||key==="NOMBRE"||key==="CORREO"||key==="ROL"||key==="ESTADO"?"ASC":"DESC";}
      state.userAdmin.pagina=1;
      return renderUsuarios().catch(err=>showToast(err.message,"error"));
    }

    const b=e.target.closest("[data-action]"); if(!b)return; const a=b.dataset.action,id=b.dataset.id;
    try {
      if(a==="nueva-sede") return sedeForm();
      if(a==="editar-sede") return sedeForm(id);
      if(a==="toggle-sede") return confirmSedeState(id);
      if(a==="confirmar-toggle-sede") {
        const activate=b.dataset.active==="1";
        const result=await api(`/api/mis-sedes/${id}/estado`,{method:"POST",body:{activo:activate}});
        showToast(result.message||"Estado de sede actualizado.");closeModal();return renderMisSedes();
      }
      if(a==="ir-mis-sedes") {closeModal();return navigate("sedes");}
      if(a==="nuevo-usuario") return userForm();
      if(a==="ver-usuario") return openUserDetail(id);
      if(a==="editar-usuario") return userForm(id);
      if(a==="restablecer-usuario") return resetUserPassword(id);
      if(a==="cambiar-estado-usuario") return confirmUserState(id,b.dataset.active==="1",b.dataset.name||"");
      if(a==="confirmar-estado-usuario") {
        const activate=b.dataset.active==="1";
        const result=await api(`/api/usuarios/${id}/estado`,{method:"POST",body:{activo:activate}});
        showToast(result.message||"Estado actualizado.");closeModal();state.userAdmin.catalogos=null;state.userAdmin.pagina=1;return renderUsuarios();
      }
      if(a==="desbloquear-usuario") {
        const result=await api(`/api/usuarios/${id}/desbloquear`,{method:"POST",body:{}});
        showToast(result.message||"Usuario desbloqueado.");closeModal();state.userAdmin.pagina=1;return renderUsuarios();
      }
      if(a==="usuario-pagina") {state.userAdmin.pagina=Math.max(1,Number(b.dataset.page||1));return renderUsuarios();}
      if(a==="usuarios-limpiar") {Object.assign(state.userAdmin,{q:"",rol_id:"",estado:"",fecha_desde:"",fecha_hasta:"",pagina:1,tamano:10,orden:"FECHA",direccion:"DESC"});return renderUsuarios();}
      if(a==="usuario-filtro-estado") {state.userAdmin.estado=b.dataset.status||"";state.userAdmin.pagina=1;return renderUsuarios();}
      if(a==="nuevo-equipo") return equipmentForm();
      if(a==="equipos-limpiar") {Object.assign(state.equipmentFilter,{q:"",estado:"TODOS",categoria:"TODAS"});return renderEquipos();}
      if(a==="nuevo-catalogo") return catalogForm();
      if(a==="editar-catalogo") return catalogForm(id);
      if(a==="toggle-catalogo"){
        const item=(state.masterCatalog||[]).find(x=>x.id===id);if(!item)return;
        await api(`/api/catalogo-maestro/${encodeURIComponent(id)}`,{method:"PATCH",body:{activo:!item.activo}});
        showToast(item.activo?"Trabajo desactivado.":"Trabajo activado.");return renderCatalogoMaestro();
      }
      if(a==="nueva-solicitud") return requestForm(); if(a==="configurar-garantia") return warrantyConfigForm(id); if(a==="solicitar-revision-garantia") return warrantyRequestForm(id); if(a==="estado-solicitud-garantia") return warrantyRequestStatusForm(id); if(a==="refrescar-garantias") return renderGarantia(); if(a==="ver-solicitud") return openRequest(id); if(a==="crear-ot-solicitud"){closeModal();return orderForm(id);} if(a==="nueva-orden") return orderForm(); if(a==="ver-orden") return openOrder(id,"resumen",true);
      if(a==="volver-ordenes") return navigate("ordenes");
      if(a==="orden-paso") return openOrder(id,b.dataset.step||"resumen",false);
      if(["cambiar-estado","iniciar-orden","finalizar-tecnico","asignar-tecnico","asignar-equipo","actividad","incidencia","resolver-incidencia","cambio-alcance","enviar-cambio","responder-cambio","editar-orden","evidencia","evidencia-solicitud"].includes(a)) return quickAction(a,id);
      if(a==="cotizar-orden") return quoteForm(id);
      if(a==="ir-cotizaciones"){closeModal();return navigate("cotizaciones");}
      if(a==="ver-sedes") return openSedes(id); if(a==="nuevo-mantenimiento") return maintenanceForm(); if(a==="nueva-cotizacion") return quoteForm(); if(a==="ver-expediente-cotizacion") return openClientQuoteFlow(id); if(a==="volver-cotizaciones") return navigate("cotizaciones"); if(["enviar-cotizacion","responder-cotizacion"].includes(a)) return quoteAction(a,id);
      if(a==="guardar-disponibilidad"){const sel=$(`.availability[data-id="${CSS.escape(id)}"]`);await api(`/api/personal/${id}/disponibilidad`,{method:"PATCH",body:{disponibilidad:sel.value}});return showToast("Disponibilidad actualizada.");}
      if(a==="guardar-equipo"){const sel=$(`.equipment-state[data-id="${CSS.escape(id)}"]`);await api(`/api/equipos/${id}/estado`,{method:"PATCH",body:{estado:sel.value}});showToast("Estado actualizado.");return renderEquipos();}
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
    syncPopoverPortal();
    const opening=notificationPopover.hidden;
    closeTopPopovers(opening?notificationPopover:null);
    notificationPopover.hidden=!opening;
    notificationButton.setAttribute("aria-expanded",String(opening));
    if(opening){notificationPreview.innerHTML=`<div class="popover-loading">Cargando avisos...</div>`;try{await refreshNotificationBadge(true);}catch(err){notificationPreview.innerHTML=`<div class="popover-empty"><strong>No se pudieron cargar</strong><span>${esc(err.message)}</span></div>`;}window.lucide?.createIcons();}
  });

  userMenuButton?.addEventListener("click",e=>{
    e.stopPropagation();
    syncPopoverPortal();
    const opening=userPopover.hidden;
    closeTopPopovers(opening?userPopover:null);
    userPopover.hidden=!opening;
    userMenuButton.setAttribute("aria-expanded",String(opening));
    syncPrototypeChrome();
  });

  document.addEventListener("click",e=>{
    if(!e.target.closest(".top-action-wrap") && !e.target.closest(".top-popover")) closeTopPopovers();
  });

  $("#modalClose").addEventListener("click", closeModal);
  modalBackdrop.addEventListener("click", e => {
    if (e.target !== modalBackdrop) return;
    if (modalProtection.locked) {
      warnProtectedModal();
      return;
    }
    closeModal();
  });
  menuButton?.addEventListener("click",()=>setSidebarOpen(!sidebar?.classList.contains("open")));
  sidebarScrim?.addEventListener("click",()=>setSidebarOpen(false));
  sidebarCollapseButton?.addEventListener("click",toggleDesktopSidebar);
  window.addEventListener("resize",()=>{syncPopoverPortal();applySidebarPreference();closeTopPopovers();});
  $("#logoutButton").addEventListener("click",performLogout);
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if (!modalBackdrop.hidden) {
      if (modalProtection.locked) warnProtectedModal();
      else closeModal();
    }
    closeTopPopovers();
  });
  window.lucide?.createIcons(); init();
})();
