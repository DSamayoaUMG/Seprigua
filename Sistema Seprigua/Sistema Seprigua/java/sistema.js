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

  const state = { user: null, role: "", roleName: "", allowedModules: new Set(), isMasterCoordinator: false, catalogs: {}, current: "dashboard", openOrderId: null, orderDetail: null, orderStep: "resumen", notifications: [], notificationFilter: "TODAS", unreadNotifications: 0, account: null, masterCatalog: [], catalogFilter: { q: "", categoria: "TODAS" }, equipmentFilter: { q: "", estado: "TODOS", categoria: "TODAS" }, userAdmin: { q: "", rol_id: "", estado: "", fecha_desde: "", fecha_hasta: "", pagina: 1, tamano: 10, orden: "FECHA", direccion: "DESC", total: 0, paginas: 1, catalogos: null }, clientAdmin: { pagina: 1, tamano: 10, total: 0, paginas: 1 }, clientSites: [], warranties: [], warrantyRequests: [], warrantyTimer: null, rolesAccess: { data: null } };
  state.documentos = { tab: "servicio", empleadoId: "" };
  state.smartLists = {};
  state.smartListDefaults = {};
  state.listCache = {};
  state.apiCache = new Map();
  state.apiInflight = new Map();
  state.listInflight = new Map();
  state.viewCache = new Map();
  state.dirtyModules = new Set();
  state.prefetchStarted = false;
  // Estado requerido por los renderizadores visuales de Gabi. Se mantiene separado
  // de la lógica funcional original para no alterar los contratos del backend.
  state.peopleCounts = { clientes: null, personal: null, usuarios: null };
  state.orderListDetailCache = new Map();
  state.agenda = { fecha: "", data: null, draft: new Map(), dirty: false, selectedOrderId: null, technicianFilter: "TODOS", onlyEmergencies: false };
  window.addEventListener("beforeunload", event => { if(state.agenda?.dirty){ event.preventDefault(); event.returnValue=""; } });
  let smartSearchTimer = null;

  const rolePaths = { COORDINADOR: "/sistema/coordinador", TECNICO: "/sistema/tecnico", CLIENTE: "/sistema/cliente" };
  const modules = {
    COORDINADOR: [
      ["dashboard", "layout-dashboard", "Panel"], ["solicitudes", "inbox", "Solicitudes"], ["ordenes", "clipboard-list", "Órdenes"], ["agenda", "calendar-range", "Agenda operativa"],
      ["clientes", "building-2", "Clientes"], ["personal", "users", "Personal"], ["usuarios", "users-round-cog", "Usuarios"], ["equipos", "wrench", "Equipo"],
      ["mantenimientos", "settings", "Mantenimiento"], ["catalogo", "book-open-check", "Catálogo maestro"], ["cotizaciones", "file-text", "Cotizaciones"], ["documentos", "files", "Documentos"], ["garantia", "shield-check", "Garantías"],
      ["notificaciones", "bell", "Notificaciones"], ["roles", "shield-user", "Roles y accesos"], ["cuenta", "user-cog", "Mi cuenta"], ["auditoria", "shield-check", "Auditoría"]
    ],
    TECNICO: [
      ["dashboard", "layout-dashboard", "Mi panel"], ["ordenes", "clipboard-check", "Mis órdenes"], ["agenda", "route", "Mi agenda"], ["equipos", "wrench", "Equipo"],
      ["mantenimientos", "settings", "Mantenimiento"], ["vacaciones", "calendar-days", "Vacaciones"], ["documentos", "files", "Mis documentos"], ["notificaciones", "bell", "Notificaciones"], ["cuenta", "user-cog", "Mi cuenta"]
    ],
    CLIENTE: [
      ["dashboard", "layout-dashboard", "Mi panel"], ["solicitudes", "circle-plus", "Solicitudes"], ["sedes", "map-pinned", "Mis sedes"], ["ordenes", "clipboard-list", "Mis servicios"],
      ["cotizaciones", "file-text", "Cotizaciones"], ["documentos", "files", "Documentos"], ["garantia", "shield-check", "Garantía"],
      ["notificaciones", "bell", "Notificaciones"], ["cuenta", "user-cog", "Mi cuenta"]
    ]
  };

  // Navegación simplificada: los módulos siguen existiendo internamente, pero se
  // agrupan en el sidebar para que la interfaz sea más fácil de entender.
  const moduleGroups = {
    COORDINADOR: {
      personas: {
        icon: "contact-round", label: "Clientes y personal",
        members: [
          ["clientes", "building-2", "Clientes"],
          ["personal", "users", "Empleados"],
          ["usuarios", "key-round", "Usuarios del sistema"]
        ]
      },
      equipo_mantenimiento: {
        icon: "wrench", label: "Equipo y mantenimiento",
        members: [
          ["equipos", "package-search", "Equipo"],
          ["mantenimientos", "settings", "Mantenimiento"]
        ]
      },
      cotizaciones_comercial: {
        icon: "file-text", label: "Cotizaciones",
        members: [
          ["cotizaciones", "file-text", "Cotizaciones"],
          ["catalogo", "book-open-check", "Catálogo y precios"]
        ]
      }
    },
    TECNICO: {
      equipo_mantenimiento: {
        icon: "wrench", label: "Equipo y mantenimiento",
        members: [
          ["equipos", "package-search", "Equipo"],
          ["mantenimientos", "settings", "Mantenimiento"]
        ]
      }
    },
    CLIENTE: {}
  };

  const navigationModules = {
    COORDINADOR: [
      ["dashboard", "layout-dashboard", "Panel"],
      ["solicitudes", "inbox", "Solicitudes"],
      ["ordenes", "clipboard-list", "Órdenes"],
      ["agenda", "calendar-range", "Agenda operativa"],
      ["cotizaciones_comercial", "file-text", "Cotizaciones"],
      ["personas", "contact-round", "Clientes y personal"],
      ["equipo_mantenimiento", "wrench", "Equipo y mantenimiento"],
      ["documentos", "files", "Documentos"],
      ["garantia", "shield-check", "Garantías"],
      ["notificaciones", "bell", "Notificaciones"],
      ["roles", "shield-user", "Roles y accesos"],
      ["auditoria", "shield-check", "Auditoría"],
      ["cuenta", "user-cog", "Mi cuenta"]
    ],
    TECNICO: [
      ["dashboard", "layout-dashboard", "Mi panel"],
      ["ordenes", "clipboard-check", "Mis órdenes"],
      ["agenda", "route", "Mi agenda"],
      ["equipo_mantenimiento", "wrench", "Equipo y mantenimiento"],
      ["vacaciones", "calendar-days", "Vacaciones"],
      ["documentos", "files", "Mis documentos"],
      ["notificaciones", "bell", "Notificaciones"],
      ["cuenta", "user-cog", "Mi cuenta"]
    ],
    CLIENTE: modules.CLIENTE
  };

  const modulePermissionParent = {
    clientes:"personas", personal:"personas", usuarios:"personas",
    equipos:"equipo_mantenimiento", mantenimientos:"equipo_mantenimiento",
    cotizaciones:"cotizaciones_comercial", catalogo:"cotizaciones_comercial"
  };

  function permissionKeyForModule(module){ return modulePermissionParent[module] || module; }
  function moduleAllowed(module){
    const key=permissionKeyForModule(module);
    if(key==="roles") return state.isMasterCoordinator;
    if(key==="cuenta") return true;
    if(state.isMasterCoordinator) return true;
    return state.allowedModules.has(key);
  }
  function navigationEntries(){
    return (navigationModules[state.role] || modules[state.role] || []).filter(([key])=>moduleAllowed(key));
  }
  function firstAllowedModule(){
    const first=navigationEntries()[0]?.[0] || "cuenta";
    return resolveGroupedModule(first);
  }

  function groupForModule(module, role = state.role) {
    const groups = moduleGroups[role] || {};
    return Object.entries(groups).find(([, group]) => group.members.some(([key]) => key === module)) || null;
  }

  function groupByKey(key, role = state.role) {
    const group = (moduleGroups[role] || {})[key];
    return group ? [key, group] : null;
  }

  function resolveGroupedModule(module) {
    const found = groupByKey(module);
    if (!found) return module;
    const [groupKey, group] = found;

    // El acceso principal "Cotizaciones" del sidebar siempre abre la bandeja
    // de cotizaciones. El catálogo sigue disponible desde el enlace discreto
    // "Catálogo y precios" dentro de esa misma vista. Esto evita que una
    // selección recordada del catálogo haga parecer que el rediseño no cargó.
    if (state.role === "COORDINADOR" && groupKey === "cotizaciones_comercial") {
      return "cotizaciones";
    }

    const storageKey = `seprigua_grupo_${state.role}_${groupKey}`;
    const remembered = sessionStorage.getItem(storageKey);
    return group.members.some(([key]) => key === remembered) ? remembered : group.members[0][0];
  }

  const contextDescriptions = {
    clientes: "Empresas, sedes y contactos",
    personal: "Empleados y disponibilidad",
    usuarios: "Accesos, estados y permisos",
    equipos: "Inventario y asignación",
    mantenimientos: "Preventivo y correctivo",
    cotizaciones: "Crear y dar seguimiento",
    catalogo: "Servicios, conceptos y precios"
  };

  function renderContextTabs() {
    if (state.role === "COORDINADOR" && (state.current === "cotizaciones" || ["clientes","personal","usuarios"].includes(state.current))) return;
    const found = groupForModule(state.current);
    if (!found) return;
    const [groupKey, group] = found;
    if (groupKey === "equipo_mantenimiento") return;
    const tabs = group.members.map(([key, icon, label]) => `
      <button class="context-tab ${key === state.current ? "active" : ""}" type="button" data-context-module="${esc(key)}" aria-current="${key === state.current ? "page" : "false"}">
        <span class="context-tab-icon"><i data-lucide="${esc(icon)}"></i></span>
        <span class="context-tab-copy"><strong>${esc(label)}</strong><small>${esc(contextDescriptions[key] || "Abrir módulo")}</small></span>
        <span class="context-tab-chevron" aria-hidden="true"><i data-lucide="chevron-right"></i></span>
      </button>`).join("");
    content.insertAdjacentHTML("afterbegin", `
      <section class="module-context-switcher" data-group="${esc(groupKey)}" aria-label="${esc(group.label)}">
        <div class="module-context-copy">
          <span class="module-context-kicker">ACCESO RÁPIDO</span>
          <strong>${esc(group.label)}</strong>
          <small>Elegí lo que querés administrar.</small>
        </div>
        <div class="module-context-tabs" style="--context-columns:${group.members.length}">${tabs}</div>
      </section>`);
    window.lucide?.createIcons();
  }

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
  function iconButton(icon, action, id = "", label = "", cls = "") { return `<button class="${cls}" type="button" data-action="${esc(action)}" ${id ? `data-id="${esc(id)}"` : ""} ${label ? `aria-label="${esc(label)}" title="${esc(label)}"` : ""}><i data-lucide="${esc(icon)}"></i><span class="sr-only">${esc(label || action)}</span></button>`; }
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
    const grouped = groupForModule(module);
    if (grouped) return grouped[1].icon || "layout-dashboard";
    const item = navigationEntries().find(([key]) => key === module);
    return item?.[1] || "layout-dashboard";
  }
  function syncPrototypeChrome() {
    if (topDate || document.getElementById("topDayName")) {
      const now = new Date();
      const dateFormatter = new Intl.DateTimeFormat("es-GT", {
        timeZone: "America/Guatemala",
        day: "numeric",
        month: "long",
        year: "numeric"
      });
      const weekdayFormatter = new Intl.DateTimeFormat("es-GT", {
        timeZone: "America/Guatemala",
        weekday: "long"
      });
      const dayName = document.getElementById("topDayName");
      const weekday = weekdayFormatter.format(now);
      if (topDate) topDate.textContent = dateFormatter.format(now);
      if (dayName) dayName.textContent = weekday.charAt(0).toUpperCase() + weekday.slice(1);
    }
    if (topUser) topUser.textContent = state.user?.nombre || state.user?.usuario || "Usuario SEPRIGUA";
    if (topRole) topRole.textContent = String(state.roleName || state.role || "Portal operativo").replaceAll("_", " ");
    if (userPopoverName) userPopoverName.textContent = state.user?.nombre || state.user?.usuario || "Usuario SEPRIGUA";
    if (userPopoverEmail) userPopoverEmail.textContent = state.user?.correo || "Cuenta del sistema";
    if (userPopoverRole) userPopoverRole.textContent = String(state.roleName || state.role || "Portal operativo").replaceAll("_", " ");
    if (sidebarUserName) sidebarUserName.textContent = state.user?.nombre || state.user?.usuario || "Usuario SEPRIGUA";
    if (sidebarUserRole) sidebarUserRole.textContent = String(state.roleName || state.role || "Portal operativo").replaceAll("_", " ");
    if (moduleHeroIcon) moduleHeroIcon.innerHTML = `<i data-lucide="${esc(currentModuleIcon())}"></i>`;
    window.lucide?.createIcons();
  }
  function setHeading(name, description) { eyebrow.textContent = `SEPRIGUA · ${state.role}`; title.textContent = name; subtitle.textContent = description; syncPrototypeChrome(); }

  function portalDaypart(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Guatemala",
      hour: "2-digit",
      hourCycle: "h23"
    }).formatToParts(date);
    const hour = Number(parts.find(part => part.type === "hour")?.value || 0);

    if (hour >= 6 && hour < 14) {
      return {
        key: "dia",
        greeting: "Buenos días",
        label: "JORNADA DE DÍA",
        detail: "Operación en marcha",
        icon: "sun-medium",
        image: "/assets/img/tuky-dia.webp?v=2"
      };
    }
    if (hour >= 14 && hour < 18) {
      return {
        key: "tarde",
        greeting: "Buenas tardes",
        label: "JORNADA DE TARDE",
        detail: "Seguimiento operativo",
        icon: "sunset",
        image: "/assets/img/tuky-tarde.webp?v=2"
      };
    }
    return {
      key: "noche",
      greeting: "Buenas noches",
      label: "JORNADA NOCTURNA",
      detail: "Cierre y continuidad",
      icon: "moon-star",
      image: "/assets/img/tuky-noche.webp?v=2"
    };
  }

  window.SEPRIGUADaypart = { get: portalDaypart };

  function portalGreeting() {
    return portalDaypart().greeting;
  }

  function portalRoleLabel() {
    return state.role === "CLIENTE" ? "PORTAL DE CLIENTE" : state.role === "TECNICO" ? "PORTAL TÉCNICO" : "PORTAL SEPRIGUA";
  }

  function portalRoleIcon() {
    return state.role === "CLIENTE" ? "building-2" : state.role === "TECNICO" ? "hard-hat" : currentModuleIcon();
  }

  function renderRoleModuleHero() {
    if (state.role === "COORDINADOR" || state.current === "dashboard") return;
    if (!["solicitudes","ordenes","sedes","equipos","mantenimientos","vacaciones","cotizaciones","garantia"].includes(state.current)) return;
    if (content.querySelector(":scope > .role-module-hero")) return;
    const roleName = state.role === "CLIENTE" ? (state.user?.cliente || state.user?.nombre || "Cliente SEPRIGUA") : (state.user?.nombre || "Técnico SEPRIGUA");
    const eyebrowText = `${portalRoleLabel()} · ${String(title?.textContent || "MÓDULO").toUpperCase()}`;
    content.insertAdjacentHTML("afterbegin", `<header class="role-module-hero role-module-hero-${state.role.toLowerCase()}">
      <div class="role-module-hero-icon"><i data-lucide="${esc(currentModuleIcon())}"></i></div>
      <div class="role-module-hero-copy"><span>${esc(eyebrowText)}</span><h2>${esc(title?.textContent || "SEPRIGUA")}</h2><p>${esc(subtitle?.textContent || "Información actualizada del portal.")}</p></div>
      <div class="role-module-hero-status"><i data-lucide="circle-check-big"></i><span>${esc(roleName)}</span></div>
    </header>`);
    window.lucide?.createIcons();
  }
  function moduleSectionLabel(module = state.current) {
    if (["solicitudes","ordenes","agenda"].includes(module)) return "OPERACIÓN";
    if (["cotizaciones"].includes(module)) return "FINANZAS";
    if (["clientes","personal","usuarios","sedes","equipos","mantenimientos","vacaciones","documentos","garantia"].includes(module)) return "GESTIÓN";
    if (["notificaciones","roles","auditoria"].includes(module)) return "SISTEMA";
    if (module === "cuenta") return "CUENTA";
    return String(state.role || "PORTAL").replaceAll("_", " ");
  }

  function moduleHeaderTarget(module = state.current) {
    if (module === "dashboard") {
      return state.role === "COORDINADOR" ? null : content.querySelector(".role-dashboard-hero");
    }
    if (state.role !== "COORDINADOR") {
      const roleHero = content.querySelector(":scope > .role-module-hero");
      if (roleHero) return roleHero;
    }
    const selectors = {
      solicitudes: ".solicitudes-hero",
      ordenes: ".orders-page-header",
      agenda: ".agenda-command",
      cotizaciones: ".quotes-page-header",
      clientes: ".people-page-title-row",
      personal: ".people-page-title-row",
      usuarios: ".people-page-title-row",
      documentos: ".document-hub",
      roles: ".roles-access-hero",
      cuenta: ".account-hero-card"
    };
    const selector = selectors[module];
    return selector ? content.querySelector(selector) : null;
  }

  function moduleHeaderCopyTarget(host) {
    if (!host) return null;
    return host.querySelector([
      ".solicitudes-hero-copy",
      ".orders-page-copy",
      ".quotes-page-copy",
      ".people-page-copy",
      ".agenda-command-copy > div",
      ".document-hub-copy > div",
      ".roles-access-hero-main > div",
      ".role-module-hero-copy",
      ".role-dashboard-hero-copy",
      ".account-hero-copy"
    ].join(",")) || host;
  }

  function moduleTimeHeroArt(meta) {
    return `<span class="se-module-time-overlay" aria-hidden="true"></span><img class="se-module-time-art" src="${esc(meta.image)}" alt="" aria-hidden="true" loading="eager" decoding="async">`;
  }

  function updateModuleTimeHero(host, meta) {
    if (!host) return;
    host.classList.add("se-module-time-hero");
    host.dataset.daypart = meta.key;
    host.dataset.module = state.current;
    host.dataset.role = String(state.role || "").toLowerCase();

    let art = host.querySelector(":scope > .se-module-time-art");
    if (!art) {
      host.insertAdjacentHTML("afterbegin", moduleTimeHeroArt(meta));
      art = host.querySelector(":scope > .se-module-time-art");
    } else if (art.getAttribute("src") !== meta.image) {
      art.setAttribute("src", meta.image);
    }

    let overlay = host.querySelector(":scope > .se-module-time-overlay");
    if (!overlay) host.insertAdjacentHTML("afterbegin", `<span class="se-module-time-overlay" aria-hidden="true"></span>`);

    const copy = moduleHeaderCopyTarget(host);
    if (copy && !copy.querySelector(":scope > .se-module-time-shift")) {
      copy.insertAdjacentHTML("afterbegin", `<span class="se-module-time-shift"><i data-lucide="${esc(meta.icon)}"></i>${esc(meta.label)}</span>`);
    } else if (copy) {
      const shift = copy.querySelector(":scope > .se-module-time-shift");
      if (shift) shift.innerHTML = `<i data-lucide="${esc(meta.icon)}"></i>${esc(meta.label)}`;
    }
  }

  function clearModuleTimeDecoration(host) {
    if (!host) return;
    host.classList.remove("se-module-time-hero");
    host.removeAttribute("data-daypart");
    host.querySelectorAll(":scope > .se-module-time-art, :scope > .se-module-time-overlay").forEach(el => el.remove());
    host.querySelectorAll(".se-module-time-shift").forEach(el => el.remove());
  }

  function decorateStaticModuleHeader(host) {
    if (!host) return;
    clearModuleTimeDecoration(host);
    host.classList.add("se-module-static-hero");
    host.dataset.module = state.current;
    host.dataset.role = String(state.role || "").toLowerCase();
  }

  function decorateModuleHeader() {
    // Tuky y el cambio por horario viven EXCLUSIVAMENTE en los tres Centros de control.
    if (state.current === "dashboard") {
      if (state.role === "COORDINADOR") return; // El Coordinador ya renderiza su banner horario propio.
      const dashboardHero = moduleHeaderTarget("dashboard");
      if (dashboardHero) {
        dashboardHero.classList.remove("se-module-static-hero");
        updateModuleTimeHero(dashboardHero, portalDaypart());
        window.lucide?.createIcons();
      }
      return;
    }

    // Cualquier encabezado horario genérico de una versión anterior se elimina al renderizar.
    content.querySelectorAll(":scope > .se-module-time-generic").forEach(el => el.remove());

    const host = moduleHeaderTarget(state.current);
    if (host) {
      decorateStaticModuleHeader(host);
      window.lucide?.createIcons();
      return;
    }

    // Los módulos sin encabezado propio reciben una cabecera SEPRIGUA estática, sin horario ni Tuky.
    let generic = content.querySelector(":scope > .se-module-static-generic");
    if (!generic) {
      const section = moduleSectionLabel(state.current);
      const moduleName = String(title?.textContent || "SEPRIGUA");
      const description = String(subtitle?.textContent || "Información actualizada del portal.");
      content.insertAdjacentHTML("afterbegin", `<header class="se-module-static-hero se-module-static-generic" data-module="${esc(state.current)}" data-role="${esc(String(state.role || "").toLowerCase())}">
        <div class="se-module-static-icon"><i data-lucide="${esc(currentModuleIcon())}"></i></div>
        <div class="se-module-static-copy">
          <span class="se-module-static-eyebrow">SEPRIGUA · ${esc(section)}</span>
          <h2>${esc(moduleName)}</h2>
          <p>${esc(description)}</p>
        </div>
      </header>`);
      generic = content.querySelector(":scope > .se-module-static-generic");
    }
    decorateStaticModuleHeader(generic);
    window.lucide?.createIcons();
  }

  function loading(module = state.current) {
    if (window.SEPRIGUALoader?.start) {
      return window.SEPRIGUALoader.start({
        container: content,
        module,
        user: state.user,
        role: state.role,
        retry: () => navigate(module)
      });
    }
    content.innerHTML = `<div class="loading-card">Cargando ${esc(module || "módulo")}...</div>`;
    return null;
  }
  function renderAvatarIdentity(name, options = {}) {
    if (window.SEPRIGUAAvatar?.render) return window.SEPRIGUAAvatar.render(name, options);
    return `<strong>${esc(name || options.fallbackName || "Sin nombre")}</strong>`;
  }

  function formatGTTime(value = new Date()) {
    const d = value instanceof Date ? value : new Date(value);
    return new Intl.DateTimeFormat("es-GT", { timeZone: "America/Guatemala", hour: "numeric", minute: "2-digit" }).format(d);
  }


  function gtDateKey(value) {
    if (!value) return "";
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone:"America/Guatemala", year:"numeric", month:"2-digit", day:"2-digit" }).formatToParts(d);
    const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${map.year}-${map.month}-${map.day}`;
  }


  function dashboardFirstName() {
    const full = String(state.user?.nombre || state.user?.usuario || "Usuario").trim();
    return full.split(/\s+/)[0] || "Usuario";
  }


  function dashboardMonthLabel(value) {
    const raw = String(value ?? "").trim();
    const match = raw.match(/(?:^|[-\/])(\d{1,2})$/);
    const monthIndex = match ? Number(match[1]) - 1 : -1;
    const months = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
    if (monthIndex >= 0 && monthIndex < 12) return months[monthIndex];
    return raw ? raw.slice(0, 3) : "—";
  }


  function dashboardOptionalNumber(...values) {
    for (const value of values) {
      if (value === null || value === undefined || value === "") continue;
      const numeric = Number(String(value).replace("%", "").trim());
      if (Number.isFinite(numeric)) return numeric;
    }
    return null;
  }


  function dashboardTrendMarkup(value) {
    const numeric = dashboardOptionalNumber(value);
    if (numeric === null) return "";

    const rounded = Math.round(numeric * 10) / 10;
    if (rounded > 0) {
      return `<small class="cc-trend cc-trend-up"><span aria-hidden="true">↑</span> +${esc(rounded)}% vs mes anterior</small>`;
    }
    if (rounded < 0) {
      return `<small class="cc-trend cc-trend-down"><span aria-hidden="true">↓</span> ${esc(rounded)}% vs mes anterior</small>`;
    }
    return `<small class="cc-trend cc-trend-flat"><span aria-hidden="true">→</span> 0% vs mes anterior</small>`;
  }


  function dashboardStaffCapacity() {
    const people = Array.isArray(state.catalogs?.tecnicos) ? state.catalogs.tecnicos : [];
    const normalized = people.map(person => {
      const roleText = [person?.puesto, person?.rol, person?.tipo].filter(Boolean).join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
      const availability = String(person?.disponibilidad || person?.estado_operativo || "").toUpperCase();
      const status = String(person?.estado || "ACTIVO").toUpperCase();
      const active = !/INACTIVO|BAJA|DESHABILIT/.test(status);
      const available = active && availability === "DISPONIBLE";
      const supervisor = /SUPERVISOR/.test(roleText);
      const operator = !supervisor && /OPERARIO|TECNIC/.test(roleText);
      return { supervisor, operator, available };
    });
    const summarize = predicate => {
      const rows = normalized.filter(predicate);
      return { total: rows.length, available: rows.filter(row => row.available).length };
    };
    return {
      operarios: summarize(row => row.operator),
      supervisores: summarize(row => row.supervisor)
    };
  }


  function dashboardStatusBadge(value) {
    const raw = String(value ?? "—").trim();
    const stateName = raw.toUpperCase().replaceAll("_", " ");
    const normalized = stateName.replace(/\s+/g, " ");

    const config = {
      "PROGRAMADA": ["programada", "●"],
      "FINALIZADA": ["finalizada", "✓"],
      "COMPLETADA": ["finalizada", "✓"],
      "EN PROCESO": ["proceso", "↻"],
      "EN CURSO": ["proceso", "↻"],
      "CANCELADA": ["cancelada", "×"]
    };

    const [tone, icon] = config[normalized] || ["neutral", ""];
    const label = normalized === "COMPLETADA" ? "FINALIZADA" : normalized;

    return `<span class="cc-status cc-status-${tone}">${icon ? `<span aria-hidden="true">${icon}</span>` : ""}${esc(label)}</span>`;
  }


  function dashboardCapacityProgress(value, total, tone = "blue") {
    const numericValue = Math.max(0, normalizeNumber(value));
    const numericTotal = dashboardOptionalNumber(total);

    if (numericTotal !== null && numericTotal > 0) {
      const percent = Math.max(0, Math.min(100, (numericValue / numericTotal) * 100));
      const percentCss = `${percent.toFixed(4)}%`;

      return `<div class="cc-capacity-progress cc-capacity-progress-${esc(tone)}" aria-label="${numericValue} de ${numericTotal} disponibles">
        <div class="cc-progress-track"
             role="progressbar"
             aria-valuemin="0"
             aria-valuemax="${numericTotal}"
             aria-valuenow="${numericValue}"
             style="--cc-progress-target:${percentCss}">
          <span class="cc-progress-fill" aria-hidden="true"></span>
        </div>
        <small>${numericValue} de ${numericTotal} disponibles</small>
      </div>`;
    }

    if (numericValue === 0) {
      return `<div class="cc-capacity-progress cc-capacity-progress-red cc-capacity-progress-zero" aria-label="0 disponibles">
        <div class="cc-progress-track"
             role="progressbar"
             aria-valuemin="0"
             aria-valuemax="0"
             aria-valuenow="0"
             style="--cc-progress-target:0%">
          <span class="cc-progress-fill" aria-hidden="true"></span>
        </div>
        <small>0 disponibles</small>
      </div>`;
    }

    return `<div class="cc-capacity-progress cc-capacity-progress-${esc(tone)} cc-capacity-progress-no-total" aria-label="${numericValue} disponibles">
      <div class="cc-progress-track" style="--cc-progress-target:0%">
        <span class="cc-progress-fill" aria-hidden="true"></span>
      </div>
      <small>${numericValue} disponibles</small>
    </div>`;
  }


  function animateDashboardCapacityBars() {
    // Consolidado final: la barra se anima mediante CSS con --cc-progress-target.
  }


  function normalizeQuickFilters(value) {
    if (Array.isArray(value)) {
      const items = value.map(v => String(v || "").toUpperCase()).filter(Boolean);
      const clean = [...new Set(items.filter(v => v !== "TODAS"))];
      return clean.length ? clean : ["TODAS"];
    }
    const single = String(value || "TODAS").toUpperCase();
    return single && single !== "TODAS" ? [single] : ["TODAS"];
  }



  function requestDisplayText(value, fallback = "—") {
    const raw = String(value ?? "").trim();
    return raw ? raw.replaceAll("_", " ") : fallback;
  }


  function requestStateValue(item) {
    return String(item?.Estado || item?.estado || "").trim().toUpperCase();
  }


  function requestUrgencyValue(item) {
    return String(item?.urgencia || "").trim().toUpperCase();
  }


  function requestOrderStateValue(item) {
    return String(item?.orden_estado_codigo || item?.orden_estado || "").trim().toUpperCase().replaceAll("_", " ");
  }


  function requestIsEmergency(item) {
    return requestClassValue(item) === "EMERGENCIA";
  }


  function requestIsCritical(item) {
    return /CRIT/.test(requestUrgencyValue(item));
  }


  function requestIsFinalized(item) {
    const orderState = requestOrderStateValue(item);
    const baseState = requestStateValue(item);
    return /(FINAL|COMPLET)/.test(orderState) || /(FINAL|COMPLET)/.test(baseState);
  }


  function requestIsInProcess(item) {
    if (requestIsFinalized(item)) return false;
    const orderState = requestOrderStateValue(item);
    const baseState = requestStateValue(item);
    if (item?.orden_id) return !/(CANCEL)/.test(orderState);
    return /(PROCESO|PROGRAM|REVISION|EVALUADA)/.test(orderState) || /(PROCESO|PROGRAM|EVALUADA)/.test(baseState);
  }


  function requestIsPending(item) {
    if (requestIsFinalized(item)) return false;
    if (item?.orden_id) return false;
    const baseState = requestStateValue(item);
    return !/(CANCEL|CONVERT)/.test(baseState);
  }


  function requestClassValue(item) {
    return String(item?.Clasificacion || item?.clasificacion || "").trim().toUpperCase();
  }


  function requestClassBadge(value) {
    const normalized = String(value || "").trim().toUpperCase();
    const label = requestDisplayText(normalized, "Sin clase");
    const emergency = normalized === "EMERGENCIA";
    return `<span class="request-class-pill ${emergency ? "emergency" : "scheduled"}">${emergency ? `<i data-lucide="zap"></i>` : `<i data-lucide="calendar-range"></i>`}<span>${esc(label)}</span></span>`;
  }


  function requestUrgencyBadge(value) {
    const normalized = String(value || "").trim().toUpperCase();
    const key = /CRIT/.test(normalized) ? "critical" : /ALTA/.test(normalized) ? "high" : /MEDIA/.test(normalized) ? "medium" : /BAJA/.test(normalized) ? "low" : "neutral";
    const label = requestDisplayText(normalized, "No aplica");
    return `<span class="request-priority-pill ${key}">${esc(label)}</span>`;
  }


  function requestStateBadge(item) {
    const baseState = requestStateValue(item);
    const orderState = requestOrderStateValue(item);
    let tone = "pending";
    let label = "Pendiente";
    if (requestIsFinalized(item)) {
      tone = "finalized";
      label = "Finalizada";
    } else if (/(CANCEL)/.test(baseState) || /(CANCEL)/.test(orderState)) {
      tone = "cancelled";
      label = "Cancelada";
    } else if (item?.orden_id && /(PROGRAM)/.test(orderState)) {
      tone = "scheduled";
      label = "Programada";
    } else if (item?.orden_id || /(PROCESO|PROGRAM|EVALUADA|REVISION)/.test(baseState) || /(PROCESO|REVISION)/.test(orderState)) {
      tone = "progress";
      label = item?.orden_id && /(PROGRAM)/.test(orderState) ? "Programada" : "En proceso";
    } else if (/(PROGRAM)/.test(baseState)) {
      tone = "scheduled";
      label = "Programada";
    }
    return `<span class="request-state-pill ${tone}"><span class="request-state-dot" aria-hidden="true"></span><span>${esc(label)}</span></span>`;
  }


  function requestFollowupLabel(item) {
    const orderState = requestOrderStateValue(item);
    const baseState = requestStateValue(item);
    if (requestIsFinalized(item)) return "FINALIZADA";
    if (/REVISION/.test(orderState)) return "EN REVISIÓN";
    if (/PROCESO|CURSO|ASIGN|INICIAD/.test(orderState)) return "EN PROCESO";
    if (/PROGRAM/.test(orderState)) return "PROGRAMADA";
    if (item?.orden_id) return "OT CREADA";
    if (/PROGRAM/.test(baseState)) return "PROGRAMADA";
    return requestDisplayText(baseState || "REGISTRADA", "REGISTRADA").toUpperCase();
  }


  function requestFollowupTone(label) {
    const value = String(label || "").toUpperCase();
    if (/FINAL/.test(value)) return "finalized";
    if (/PROCESO/.test(value)) return "progress";
    if (/REVISION/.test(value)) return "review";
    if (/PROGRAM/.test(value)) return "scheduled";
    if (/OT CREADA/.test(value)) return "created";
    return "neutral";
  }


  function requestFollowupMarkup(item) {
    const label = requestFollowupLabel(item);
    const tone = requestFollowupTone(label);
    const primary = item?.orden_id ? (item.orden_numero || `OT #${item.orden_id}`) : "Pendiente de coordinación";
    const secondarySource = item?.orden_id
      ? requestDisplayText(item.orden_estado || item.orden_estado_codigo || "Orden generada correctamente", "Orden generada correctamente")
      : requestDisplayText(item.Estado || item.estado || "Solicitud registrada", "Solicitud registrada");
    return `<div class="request-followup"><span class="request-followup-badge ${tone}">${esc(label)}</span><strong class="mono">${esc(primary)}</strong><span>${esc(secondarySource)}</span></div>`;
  }


  function requestDateMarkup(value) {
    if (!value) return `<div class="request-date-cell"><strong>—</strong><span>Sin fecha</span></div>`;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return `<div class="request-date-cell"><strong>${esc(value)}</strong></div>`;
    return `<div class="request-date-cell"><strong class="mono">${esc(date.toLocaleDateString("es-GT", { day:"2-digit", month:"2-digit", year:"numeric" }))}</strong><span>${esc(date.toLocaleTimeString("es-GT", { hour:"numeric", minute:"2-digit" }))}</span></div>`;
  }


  function requestDescriptionPreview(text) {
    const raw = String(text ?? "").replace(/\s+/g, " ").trim();
    return raw || "Sin descripción registrada.";
  }


  function requestQuickLabel(key) {
    return ({
      TODAS: "Todas",
      PENDIENTES: "Pendientes",
      EMERGENCIAS: "Emergencias",
      CRITICAS: "Críticas",
      EN_PROCESO: "En proceso",
      FINALIZADAS: "Finalizadas"
    })[String(key || "").toUpperCase()] || requestDisplayText(key, "Filtro rápido");
  }


  function requestQuickDefinitions(items = []) {
    const defs = [
      ["TODAS", "Todas", "all"],
      ["PENDIENTES", "Pendientes", "pending"],
      ["EMERGENCIAS", "Emergencias", "emergency"],
      ["CRITICAS", "Críticas", "critical"],
      ["EN_PROCESO", "En proceso", "process"],
      ["FINALIZADAS", "Finalizadas", "finalized"]
    ].map(([key, label, tone]) => ({
      key,
      label,
      tone,
      count: (items || []).filter(item => requestQuickMatches(item, key)).length
    }));
    return defs.filter(def => def.key === "TODAS" || def.count > 0);
  }


  function requestQuickMatches(item, key) {
    switch (String(key || "TODAS").toUpperCase()) {
      case "PENDIENTES": return requestIsPending(item);
      case "EMERGENCIAS": return requestIsEmergency(item);
      case "CRITICAS": return requestIsCritical(item);
      case "EN_PROCESO": return requestIsInProcess(item);
      case "FINALIZADAS": return requestIsFinalized(item);
      default: return true;
    }
  }


  function requestActiveFilterChips(prefs) {
    const chips = [];
    const filters = prefs?.filtros || {};
    const labels = { estado: "Estado", clase: "Clase", urgencia: "Urgencia", sede: "Sede", rapido: "Filtro" };
    Object.entries(filters).forEach(([key, value]) => {
      if (key === "rapidos") {
        normalizeQuickFilters(value).filter(v => v !== "TODAS").forEach(filterKey => {
          const label = `Filtro: ${requestQuickLabel(filterKey)}`;
          chips.push(`<button class="request-active-chip" type="button" data-action="request-remove-quick-filter" data-list-key="solicitudes" data-quick-key="${esc(filterKey)}" aria-label="Quitar filtro ${esc(label)}"><span>${esc(label)}</span><i data-lucide="x"></i></button>`);
        });
        return;
      }
      if (key === "rapido") return;
      if (!value || value === "TODOS" || value === "TODAS") return;
      const label = `${labels[key] || key}: ${requestDisplayText(value)}`;
      chips.push(`<button class="request-active-chip" type="button" data-action="request-remove-filter" data-list-key="solicitudes" data-filter-name="${esc(key)}" aria-label="Quitar filtro ${esc(label)}"><span>${esc(label)}</span><i data-lucide="x"></i></button>`);
    });
    if (!chips.length) return "";
    return `<div class="request-active-filters"><span class="request-active-count">${chips.length} filtro${chips.length === 1 ? "" : "s"} activo${chips.length === 1 ? "" : "s"}</span><div class="request-active-chip-row">${chips.join("")}</div></div>`;
  }


  function requestPager(key, meta) {
    const page = Number(meta?.pagina || 1);
    const pages = Math.max(1, Number(meta?.paginas || 1));
    const total = Number(meta?.total || 0);
    const size = Number(meta?.tamano || 10);
    const start = total ? (page - 1) * size + 1 : 0;
    const end = Math.min(total, page * size);
    const nums = [];
    for (let n = Math.max(1, page - 2); n <= Math.min(pages, page + 2); n++) nums.push(n);
    return `<div class="smart-pagination request-pagination"><div class="smart-pagination-copy">Mostrando <strong>${start}</strong> a <strong>${end}</strong> de <strong>${total}</strong> resultados</div><div class="pager-buttons"><button type="button" class="pager-button" data-action="smart-page" data-list-key="${esc(key)}" data-page="${Math.max(1, page - 1)}" ${page <= 1 ? "disabled" : ""} aria-label="Página anterior"><i data-lucide="chevron-left"></i></button>${nums.map(n => `<button type="button" class="pager-button ${n === page ? "active" : ""}" data-action="smart-page" data-list-key="${esc(key)}" data-page="${n}">${n}</button>`).join("")}<button type="button" class="pager-button" data-action="smart-page" data-list-key="${esc(key)}" data-page="${Math.min(pages, page + 1)}" ${page >= pages ? "disabled" : ""} aria-label="Página siguiente"><i data-lucide="chevron-right"></i></button></div></div>`;
  }

  function dashboardRecentPager(meta) {
    const page = Number(meta?.pagina || 1);
    const pages = Math.max(1, Number(meta?.paginas || 1));
    const total = Number(meta?.total || 0);
    const size = Number(meta?.tamano || 4);
    const start = total ? (page - 1) * size + 1 : 0;
    const end = Math.min(total, page * size);
    const nums = [];
    for (let n = Math.max(1, page - 1); n <= Math.min(pages, page + 1); n++) nums.push(n);
    if (total <= size && pages <= 1) return `<div class="cc-recent-pagination"><div class="smart-pagination-copy">Mostrando <strong>${start}</strong> a <strong>${end}</strong> de <strong>${total}</strong> registros</div></div>`;
    return `<div class="cc-recent-pagination"><div class="smart-pagination-copy">Mostrando <strong>${start}</strong>–<strong>${end}</strong> de <strong>${total}</strong> registros</div><div class="pager-buttons"><button type="button" class="pager-button" data-action="dashboard-recent-page" data-page="${Math.max(1, page - 1)}" ${page <= 1 ? "disabled" : ""} aria-label="Página anterior"><i data-lucide="chevron-left"></i></button>${nums.map(n => `<button type="button" class="pager-button ${n === page ? "active" : ""}" data-action="dashboard-recent-page" data-page="${n}">${n}</button>`).join("")}<button type="button" class="pager-button" data-action="dashboard-recent-page" data-page="${Math.min(pages, page + 1)}" ${page >= pages ? "disabled" : ""} aria-label="Página siguiente"><i data-lucide="chevron-right"></i></button></div></div>`;
  }


  function normalizeOrderQuickFilters(value) {
    if (Array.isArray(value)) {
      const clean = [...new Set(value.map(v => String(v || "").toUpperCase()).filter(v => v && v !== "TODAS"))];
      return clean.length ? clean : ["TODAS"];
    }
    const single = String(value || "TODAS").toUpperCase();
    return single && single !== "TODAS" ? [single] : ["TODAS"];
  }


  function orderStateKey(value) {
    const raw = String(value || "").trim().toUpperCase().replace(/\s+/g, "_");
    if (/CANCEL/.test(raw)) return "CANCELADA";
    if (/FINAL|COMPLET|CERRAD/.test(raw)) return "FINALIZADA";
    if (/PROCESO|SERVICIO|EJECUC/.test(raw)) return "EN_PROCESO";
    if (/PROGRAM/.test(raw)) return "PROGRAMADA";
    return raw || "SIN_ESTADO";
  }


  function orderPriorityKey(value) {
    const raw = String(value || "").trim().toUpperCase();
    if (/CRIT/.test(raw)) return "CRITICA";
    if (/ALTA/.test(raw)) return "ALTA";
    if (/MEDIA/.test(raw)) return "MEDIA";
    if (/BAJA/.test(raw)) return "BAJA";
    return raw || "SIN_PRIORIDAD";
  }


  function orderDateForList(item) { return item?.creada || item?.programada || item?.iniciada || item?.finalizada || null; }


  function orderGtDateKey(value) {
    if (!value) return "";
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Guatemala", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(date).reduce((acc, part) => { acc[part.type] = part.value; return acc; }, {});
    return `${parts.year}-${parts.month}-${parts.day}`;
  }


  function orderIsToday(item) { return orderGtDateKey(orderDateForList(item)) === orderGtDateKey(new Date()); }


  function orderDateFilterMatches(item, filter, prefs) {
    const selected = String(filter || "TODAS").toUpperCase();
    if (!selected || selected === "TODAS") return true;
    const key = orderGtDateKey(orderDateForList(item));
    if (!key) return false;
    const today = orderGtDateKey(new Date());
    if (selected === "HOY") return key === today;
    if (selected === "MES") return key.slice(0,7) === today.slice(0,7);
    if (selected === "SEMANA") {
      const d = new Date(`${today}T12:00:00Z`);
      const day = d.getUTCDay();
      const offset = (day + 6) % 7;
      const monday = new Date(d); monday.setUTCDate(d.getUTCDate() - offset);
      const sunday = new Date(monday); sunday.setUTCDate(monday.getUTCDate() + 6);
      const iso = value => value.toISOString().slice(0,10);
      return key >= iso(monday) && key <= iso(sunday);
    }
    if (selected === "PERSONALIZADO") {
      const from = String(prefs?.fechaDesde || "");
      const to = String(prefs?.fechaHasta || "");
      if (from && key < from) return false;
      if (to && key > to) return false;
      return true;
    }
    return true;
  }


  function orderQuickMatches(item, detail, key) {
    const quick = String(key || "TODAS").toUpperCase();
    if (quick === "EN_PROCESO") return orderStateKey(item.estado) === "EN_PROCESO";
    if (quick === "SIN_ASIGNAR") return !detail?._loadError && orderCrewRows(detail).length === 0;
    if (quick === "CRITICAS") return orderPriorityKey(item.Prioridad || item.prioridad) === "CRITICA";
    if (quick === "FINALIZADAS") return orderStateKey(item.estado) === "FINALIZADA";
    if (quick === "HOY") return orderIsToday(item);
    return true;
  }


  function orderStatePill(value) {
    const key = orderStateKey(value);
    const config = {
      PROGRAMADA: ["circle", "Programada", "info"],
      EN_PROCESO: ["refresh-cw", "En proceso", "warning"],
      FINALIZADA: ["check", "Finalizada", "success"],
      CANCELADA: ["x", "Cancelada", "danger"]
    }[key] || ["circle", requestDisplayText(value, "Sin estado"), "neutral"];
    return `<span class="order-status-pill ${config[2]}"><i data-lucide="${config[0]}"></i><span>${esc(config[1])}</span></span>`;
  }


  function orderPriorityPill(value) {
    const key = orderPriorityKey(value);
    const config = {
      CRITICA: ["triangle-alert", "Crítica", "critical"],
      ALTA: ["chevron-up", "Alta", "high"],
      MEDIA: ["circle", "Media", "medium"],
      BAJA: ["circle", "Baja", "low"]
    }[key] || ["circle", requestDisplayText(value, "Sin prioridad"), "neutral"];
    return `<span class="order-priority-pill ${config[2]}"><i data-lucide="${config[0]}"></i><span>${esc(config[1])}</span></span>`;
  }


  function orderDateMarkup(value) {
    if (!value) return `<div class="order-date-cell"><strong>—</strong><span>Sin fecha</span></div>`;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return `<div class="order-date-cell"><strong>${esc(value)}</strong></div>`;
    const date = new Intl.DateTimeFormat("es-GT", { timeZone:"America/Guatemala", day:"2-digit", month:"2-digit", year:"numeric" }).format(d);
    const time = new Intl.DateTimeFormat("es-GT", { timeZone:"America/Guatemala", hour:"numeric", minute:"2-digit" }).format(d);
    return `<div class="order-date-cell"><strong class="mono">${esc(date)}</strong><span>${esc(time)}</span></div>`;
  }


  async function loadOrderListDetails(items = []) {
    const pending = (items || []).filter(item => item?.id && !state.orderListDetailCache.has(String(item.id))).slice();
    const concurrency = Math.min(6, pending.length || 1);
    const workers = Array.from({ length: concurrency }, async () => {
      while (pending.length) {
        const item = pending.shift();
        const key = String(item.id);
        try {
          const detail = await api(`/api/ordenes/${encodeURIComponent(item.id)}`);
          state.orderListDetailCache.set(key, detail || { tecnicos:[], cotizaciones:[] });
        } catch (error) {
          state.orderListDetailCache.set(key, { tecnicos:[], cotizaciones:[], _loadError:true });
        }
      }
    });
    await Promise.all(workers);
    return new Map((items || []).map(item => [String(item.id), state.orderListDetailCache.get(String(item.id)) || { tecnicos:[], cotizaciones:[] }]));
  }


  function orderCrewRows(detail) {
    return (detail?.tecnicos || []).filter(t => ["ASIGNADO","CONFIRMADO","FINALIZADO"].includes(String(t.estado || t.Estado || "").toUpperCase()));
  }


  function orderCrewCell(detail) {
    if (detail?._loadError) return `<span class="order-tech-unavailable"><i data-lucide="circle-help"></i> No disponible</span>`;
    const crew = orderCrewRows(detail);
    if (!crew.length) return `<span class="order-unassigned-pill"><i data-lucide="triangle-alert"></i><span>Sin asignar</span></span>`;
    const first = crew[0];
    const subtitle = crew.length > 1 ? `+${crew.length - 1} técnico${crew.length - 1 === 1 ? "" : "s"}` : requestDisplayText(first.funcion, "Técnico");
    return renderAvatarIdentity(first.nombre || "Técnico asignado", { entity:first, subtitle, className:"order-tech-identity" });
  }


  function orderSupervisorCell(detail) {
    const supervisor = orderCrewRows(detail).find(t => String(t.funcion || "").toUpperCase().includes("SUPERV"));
    return supervisor ? `<span class="order-secondary-value">${esc(supervisor.nombre)}</span>` : `<span class="order-secondary-value muted">—</span>`;
  }


  function orderQuoteCell(detail) {
    const quote = (detail?.cotizaciones || [])[0];
    return quote ? `<span class="order-secondary-value mono">${esc(quote.numero || `Cotización #${quote.id}`)}</span>` : `<span class="order-secondary-value muted">—</span>`;
  }


  function orderPager(meta) {
    const page = Number(meta.pagina || 1), pages = Math.max(1, Number(meta.paginas || 1)), total = Number(meta.total || 0), size = Number(meta.tamano || 20);
    const start = total ? (page - 1) * size + 1 : 0, end = Math.min(total, page * size);
    const nums=[]; for(let n=Math.max(1,page-2); n<=Math.min(pages,page+2); n++) nums.push(n);
    return `<div class="order-pagination">
      <div class="order-pagination-copy">Mostrando <strong>${start}–${end}</strong> de <strong>${total}</strong> órdenes</div>
      <div class="order-pagination-actions">
        <label class="order-page-size"><span>Mostrar</span><select data-smart-size data-smart-key="ordenes">${[10,20,50].map(n=>`<option value="${n}" ${size===n?"selected":""}>${n} por página</option>`).join("")}</select></label>
        <button type="button" class="order-page-button wide" data-action="smart-page" data-list-key="ordenes" data-page="${page-1}" ${page<=1?"disabled":""}><i data-lucide="chevron-left"></i><span>Anterior</span></button>
        ${nums.map(n=>`<button type="button" class="order-page-button ${n===page?"active":""}" data-action="smart-page" data-list-key="ordenes" data-page="${n}">${n}</button>`).join("")}
        <button type="button" class="order-page-button wide" data-action="smart-page" data-list-key="ordenes" data-page="${page+1}" ${page>=pages?"disabled":""}><span>Siguiente</span><i data-lucide="chevron-right"></i></button>
      </div>
    </div>`;
  }



  function peopleCountBadge(key){
    const raw=state.peopleCounts?.[key];
    return Number.isFinite(Number(raw)) ? `<span class="people-tab-count">${normalizeNumber(raw)}</span>` : "";
  }


  function peopleMetric(label,value,detail=""){
    return `<div class="people-metric"><strong>${normalizeNumber(value)}</strong><div><span>${esc(label)}</span>${detail?`<small>${esc(detail)}</small>`:""}</div></div>`;
  }


  function peopleStatusBadge(value){
    const raw=String(value||"INACTIVO").toUpperCase().replaceAll("_"," ");
    const key=/BLOQUE/.test(raw)?"blocked":/ACTIVO/.test(raw)&&!/INACTIVO/.test(raw)?"active":/DISPONIBLE/.test(raw)?"available":/ASIGNADO/.test(raw)?"assigned":/VACACION/.test(raw)?"vacation":"inactive";
    const icon={active:"circle-check",inactive:"circle-minus",blocked:"lock-keyhole",available:"circle-check",assigned:"briefcase-business",vacation:"palmtree"}[key];
    return `<span class="people-status people-status-${key}"><i data-lucide="${icon}"></i>${esc(raw.charAt(0)+raw.slice(1).toLowerCase())}</span>`;
  }


  function peopleQuickButton(key,value,label,count,active){
    return `<button class="people-quick ${active?"active":""}" type="button" data-action="people-quick-filter" data-list-key="${esc(key)}" data-value="${esc(value)}"><span>${esc(label)}</span>${Number.isFinite(Number(count))?`<b>${normalizeNumber(count)}</b>`:""}</button>`;
  }


  function peopleActionMenu(items){
    const html=(items||[]).filter(Boolean).map(item=>item.separator?`<span class="people-action-separator" aria-hidden="true"></span>`:`<button type="button" class="people-action-item ${item.danger?"danger":""}" ${item.action?`data-action="${esc(item.action)}"`:""} ${item.module?`data-context-module="${esc(item.module)}"`:""} ${item.id?`data-id="${esc(item.id)}"`:""} ${item.attrs||""}><i data-lucide="${esc(item.icon||"circle")}"></i><span>${esc(item.label)}</span></button>`).join("");
    return `<details class="people-action-menu"><summary aria-label="Más acciones"><i data-lucide="ellipsis"></i></summary><div class="people-action-popover">${html}</div></details>`;
  }


  function peopleWorkspaceHeader(active){
    const actionMap={
      clientes:{label:"Nuevo cliente",action:"nuevo-cliente",icon:"building-2"},
      personal:{label:"Nuevo empleado",action:"nuevo-empleado",icon:"user-round-plus"},
      usuarios:{label:"Nuevo usuario",action:"nuevo-usuario",icon:"user-round-plus"}
    };
    const action=actionMap[active]||actionMap.clientes;
    const tabs=[
      ["clientes","Clientes y sedes"],
      ["personal","Personal"],
      ["usuarios","Usuarios del sistema"]
    ].map(([key,label])=>`<button class="people-tab ${active===key?"active":""}" type="button" data-context-module="${key}" aria-current="${active===key?"page":"false"}"><span>${label}</span>${peopleCountBadge(key)}</button>`).join("");
    return `<header class="people-page-header">
      <div class="people-page-title-row">
        <div class="people-page-copy"><span class="people-eyebrow">SEPRIGUA · GESTIÓN</span><h1>Clientes y personal</h1><p>Administra clientes, sedes, colaboradores y accesos del sistema.</p></div>
        <button class="people-primary-action" type="button" data-action="${action.action}"><i data-lucide="${action.icon}"></i><span>${action.label}</span></button>
      </div>
      <nav class="people-tabs" aria-label="Secciones de Clientes y personal">${tabs}</nav>
    </header>`;
  }


  function peopleTableShell(title,result,headers,rows,pager,key){
    const body=rows.length?`<div class="people-table-scroll"><table class="people-table"><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`:`<div class="people-empty"><i data-lucide="search-x"></i><h3>No encontramos registros con estos filtros.</h3><p>Prueba cambiando los filtros o limpia la búsqueda.</p><button class="btn small" type="button" data-action="smart-reset" data-list-key="${esc(key)}"><i data-lucide="rotate-ccw"></i><span>Limpiar filtros</span></button></div>`;
    return `<section class="people-table-section"><div class="people-table-toolbar"><div><h3>${esc(title)}</h3><span>${normalizeNumber(result.total)} resultados</span></div></div>${body}${pager}</section>`;
  }


  function equipmentMaintenanceTabs(active) {
    return `<section class="module-context-switcher coord-equipment-tabs" aria-label="Equipo y mantenimiento"><div class="module-context-tabs"><button class="context-tab ${active==="equipos"?"active":""}" type="button" data-context-module="equipos" aria-current="${active==="equipos"?"page":"false"}"><span class="context-tab-icon"><i data-lucide="package-search"></i></span><span class="context-tab-copy"><strong>Equipo</strong></span></button><button class="context-tab ${active==="mantenimientos"?"active":""}" type="button" data-context-module="mantenimientos" aria-current="${active==="mantenimientos"?"page":"false"}"><span class="context-tab-icon"><i data-lucide="settings"></i></span><span class="context-tab-copy"><strong>Mantenimiento</strong></span></button></div></section>`;
  }


  function coordinatorCompactMetrics(items = [], extraClass = "") {
    return `<section class="coord-compact-metrics ${esc(extraClass)}">${items.map(item => `<article class="coord-compact-metric ${esc(item.tone || "blue")}"><span class="coord-compact-icon"><i data-lucide="${esc(item.icon || "activity")}"></i></span><div><strong>${normalizeNumber(item.value)}</strong><small>${esc(item.label || "Dato")}</small>${item.note ? `<span>${esc(item.note)}</span>` : ""}</div></article>`).join("")}</section>`;
  }


  function quoteStateKey(value) {
    return String(value || "BORRADOR").trim().toUpperCase().replaceAll(" ", "_");
  }


  function quoteStateTone(value) {
    const key = quoteStateKey(value);
    if (["ACEPTADA","APROBADA"].includes(key)) return "success";
    if (["RECHAZADA","ANULADA"].includes(key)) return "danger";
    if (key === "ENVIADA") return "info";
    if (["OBSERVADA","CONFIRMADA","PENDIENTE"].includes(key)) return "warning";
    return "neutral";
  }


  function quoteStateLabel(value) {
    const key = quoteStateKey(value);
    const labels = {
      BORRADOR: "Borrador",
      PENDIENTE: "Pendiente",
      OBSERVADA: "Observada",
      CONFIRMADA: "Confirmada",
      ENVIADA: "Enviada",
      ACEPTADA: "Aprobada",
      APROBADA: "Aprobada",
      RECHAZADA: "Rechazada",
      ANULADA: "Anulada"
    };
    return labels[key] || key.replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase());
  }


  function quoteStateIcon(value) {
    const key = quoteStateKey(value);
    if (["ACEPTADA","APROBADA"].includes(key)) return "check";
    if (["RECHAZADA","ANULADA"].includes(key)) return "x";
    if (key === "ENVIADA") return "send";
    if (["OBSERVADA","CONFIRMADA","PENDIENTE"].includes(key)) return "clock-3";
    return "circle";
  }


  function quoteStatusBadge(value) {
    return `<span class="quote-status quote-status-${quoteStateTone(value)}"><i data-lucide="${quoteStateIcon(value)}"></i><span>${esc(quoteStateLabel(value))}</span></span>`;
  }


  function quoteGTDateKey(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Guatemala", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(date).reduce((acc, part) => { acc[part.type] = part.value; return acc; }, {});
    return `${parts.year}-${parts.month}-${parts.day}`;
  }


  function quoteDateFilterMatches(item, filter) {
    const selected = String(filter || "TODAS").toUpperCase();
    if (selected === "TODAS") return true;
    const itemKey = quoteGTDateKey(item.emision || item.creada);
    const todayKey = quoteGTDateKey(new Date());
    if (!itemKey || !todayKey) return true;
    if (selected === "HOY") return itemKey === todayKey;
    if (selected === "MES") return itemKey.slice(0, 7) === todayKey.slice(0, 7);
    if (selected === "SEMANA") {
      const current = new Date(`${todayKey}T12:00:00-06:00`);
      const currentDay = current.getUTCDay() || 7;
      const monday = new Date(current);
      monday.setUTCDate(current.getUTCDate() - currentDay + 1);
      const sunday = new Date(monday);
      sunday.setUTCDate(monday.getUTCDate() + 6);
      const target = new Date(`${itemKey}T12:00:00-06:00`);
      return target >= monday && target <= sunday;
    }
    return true;
  }


  function quoteDateShort(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return esc(value);
    return new Intl.DateTimeFormat("es-GT", {
      timeZone: "America/Guatemala", day: "2-digit", month: "2-digit", year: "numeric"
    }).format(date);
  }


  function quoteTabGroup(value) {
    const key = quoteStateKey(value);
    if (key === "BORRADOR") return "BORRADORES";
    if (["OBSERVADA","CONFIRMADA","PENDIENTE"].includes(key)) return "PENDIENTES";
    if (key === "ENVIADA") return "ENVIADAS";
    if (["ACEPTADA","APROBADA"].includes(key)) return "APROBADAS";
    if (["RECHAZADA","ANULADA"].includes(key)) return "RECHAZADAS";
    return "OTRAS";
  }


  function quotePager(meta) {
    const page = Number(meta.pagina || 1), pages = Math.max(1, Number(meta.paginas || 1)), total = Number(meta.total || 0), size = Number(meta.tamano || 15);
    const start = total ? (page - 1) * size + 1 : 0;
    const end = Math.min(total, page * size);
    const nums = [];
    for (let n = Math.max(1, page - 2); n <= Math.min(pages, page + 2); n++) nums.push(n);
    return `<footer class="quote-pagination"><span>Mostrando <strong>${start}–${end}</strong> de <strong>${total}</strong></span><div class="quote-page-buttons"><button type="button" data-action="smart-page" data-list-key="cotizaciones" data-page="${page-1}" ${page<=1?"disabled":""} aria-label="Página anterior"><i data-lucide="chevron-left"></i></button>${nums.map(n=>`<button type="button" class="${n===page?"active":""}" data-action="smart-page" data-list-key="cotizaciones" data-page="${n}">${n}</button>`).join("")}<button type="button" data-action="smart-page" data-list-key="cotizaciones" data-page="${page+1}" ${page>=pages?"disabled":""} aria-label="Página siguiente"><i data-lucide="chevron-right"></i></button></div></footer>`;
  }


  async function withContextualLoader(task, label = "Actualizando...", successText = "Actualizado") {
    const token = window.SEPRIGUALoader?.startContextual?.({ label, delay: 80 });
    try {
      return await task();
    } finally {
      if (token) await window.SEPRIGUALoader?.finishContextual?.(token, { successText });
    }
  }


  function confirmLogout() {
    closeTopPopovers();
    openModal("Cerrar sesión", `
      <div class="logout-confirmation">
        <span class="logout-confirm-icon" aria-hidden="true"><i data-lucide="log-out"></i></span>
        <div class="logout-confirm-copy">
          <strong>¿Deseas cerrar sesión?</strong>
          <p>Tu sesión actual se cerrará y volverás a la pantalla de acceso.</p>
        </div>
        <div class="logout-confirm-actions">
          <button class="btn logout-confirm-no" type="button" data-action="cancelar-logout">No</button>
          <button class="btn logout-confirm-yes" type="button" data-action="confirmar-logout">Sí</button>
        </div>
      </div>
    `, { lockBackdrop: false });
  }


  async function api(url, opts = {}) {
    const { seCache = "default", ...fetchOptions } = opts || {};
    const options = { credentials: "same-origin", ...fetchOptions };
    const method = String(options.method || "GET").toUpperCase();
    const cacheable = method === "GET";
    const cacheKey = String(url);

    if (cacheable && seCache !== "reload" && seCache !== "no-store") {
      const cached = getApiCache(url);
      if (cached !== null) return cached;
      const inflight = state.apiInflight.get(cacheKey);
      if (inflight) return cloneApiValue(await inflight);
    }

    const execute = async () => {
      if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
        options.headers = { ...(options.headers || {}), "X-SEPRIGUA-Request": "1" };
      }
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
      if (cacheable && seCache !== "no-store") setApiCache(url, data);
      if (!["GET", "HEAD", "OPTIONS"].includes(method)) invalidateListsForMutation(url);
      return cloneApiValue(data);
    };

    if (!cacheable || seCache === "reload") return execute();

    const promise = execute();
    state.apiInflight.set(cacheKey, promise);
    try { return cloneApiValue(await promise); }
    finally {
      if (state.apiInflight.get(cacheKey) === promise) state.apiInflight.delete(cacheKey);
    }
  }

  const pushClient = { registration: null, config: null, busy: false };

  function pushBrowserSupported() {
    return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  }

  function isIosDevice() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  function isStandalonePwa() {
    return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  }

  function urlBase64ToUint8Array(value) {
    const padding = "=".repeat((4 - value.length % 4) % 4);
    const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    return Uint8Array.from([...raw].map(ch => ch.charCodeAt(0)));
  }

  function currentPushDeviceName() {
    const ua = navigator.userAgent || "";
    const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad|iPod/i.test(ua) ? "iPhone / iPad" : /Windows/i.test(ua) ? "Windows" : /Macintosh/i.test(ua) ? "macOS" : "Dispositivo";
    const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Navegador";
    return `${os} · ${browser}`;
  }

  async function getPushConfig() {
    if (pushClient.config) return pushClient.config;
    try { pushClient.config = await api("/api/push/config"); }
    catch (_) { pushClient.config = { enabled:false, public_key:null }; }
    return pushClient.config;
  }

  async function getPushRegistration() {
    if (!pushBrowserSupported()) return null;
    if (pushClient.registration) return pushClient.registration;
    pushClient.registration = await navigator.serviceWorker.register("/service-worker.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    return pushClient.registration;
  }

  async function savePushSubscription(subscription) {
    return api("/api/push/suscribir", { method:"POST", body:{ subscription: subscription.toJSON(), nombre_dispositivo: currentPushDeviceName() } });
  }

  async function syncPushSubscription({ prompt=false } = {}) {
    if (pushClient.busy) return null;
    pushClient.busy = true;
    try {
      if (!pushBrowserSupported()) throw new Error("Este navegador no admite notificaciones Web Push.");
      if (!window.isSecureContext) throw new Error("Las notificaciones requieren HTTPS. En la PC local también funcionan usando localhost.");
      if (isIosDevice() && !isStandalonePwa()) throw new Error("En iPhone/iPad, primero agrega SEPRIGUA a la pantalla de inicio y ábrela desde su icono.");
      const config = await getPushConfig();
      if (!config.enabled || !config.public_key) throw new Error("Las notificaciones todavía no están configuradas en el servidor.");
      let permission = Notification.permission;
      if (permission === "default" && prompt) permission = await Notification.requestPermission();
      if (permission === "denied") throw new Error("Las notificaciones están bloqueadas para SEPRIGUA en este navegador.");
      if (permission !== "granted") return null;
      const registration = await getPushRegistration();
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:urlBase64ToUint8Array(config.public_key) });
      }
      await savePushSubscription(subscription);
      return subscription;
    } finally { pushClient.busy = false; }
  }

  async function disablePushOnThisDevice() {
    const registration = await getPushRegistration();
    const subscription = registration ? await registration.pushManager.getSubscription() : null;
    if (!subscription) return;
    try { await api("/api/push/desuscribir", { method:"POST", body:{ subscription:subscription.toJSON() } }); }
    finally { await subscription.unsubscribe().catch(()=>{}); }
  }

  async function initializePushSilently() {
    if (!pushBrowserSupported() || !window.isSecureContext || Notification.permission !== "granted") return;
    if (isIosDevice() && !isStandalonePwa()) return;
    try { await syncPushSubscription({prompt:false}); } catch (_) {}
  }

  function pushStatusMarkup(devices = [], serverConfig = {}) {
    const supported = pushBrowserSupported();
    const secure = window.isSecureContext;
    const iosNeedsInstall = isIosDevice() && !isStandalonePwa();
    const permission = supported ? Notification.permission : "unsupported";
    const activeHere = permission === "granted" && secure && !iosNeedsInstall;
    let statusTitle = "Listas para activar";
    let statusText = "Activa los avisos importantes en este dispositivo.";
    let statusClass = "pending";
    if (!supported) { statusTitle="No disponible"; statusText="Este navegador no admite Web Push."; statusClass="off"; }
    else if (!secure) { statusTitle="Requiere HTTPS"; statusText="Para celular/VM debes abrir SEPRIGUA mediante HTTPS."; statusClass="off"; }
    else if (iosNeedsInstall) { statusTitle="Instala SEPRIGUA en inicio"; statusText="En iPhone/iPad usa Compartir → Agregar a pantalla de inicio y abre SEPRIGUA desde el icono."; statusClass="pending"; }
    else if (permission === "denied") { statusTitle="Bloqueadas en el navegador"; statusText="Debes volver a permitir notificaciones desde la configuración del navegador."; statusClass="off"; }
    else if (!serverConfig.enabled) { statusTitle="Configuración pendiente"; statusText="El servidor todavía no tiene Web Push disponible."; statusClass="off"; }
    else if (activeHere) { statusTitle="Activadas en este dispositivo"; statusText="Recibirás únicamente avisos importantes cuando SEPRIGUA no esté al frente."; statusClass="on"; }
    const actions = supported && secure && !iosNeedsInstall && serverConfig.enabled
      ? (activeHere
          ? `<button class="btn small" type="button" data-action="probar-push"><i data-lucide="bell-ring"></i> Probar</button><button class="btn small danger" type="button" data-action="desactivar-push"><i data-lucide="bell-off"></i> Desactivar aquí</button>`
          : `<button class="btn primary" type="button" data-action="activar-push"><i data-lucide="bell-ring"></i> Activar notificaciones</button>`)
      : "";
    const deviceCards = devices.length ? devices.map(x=>`<article class="push-device-row"><span class="push-device-icon"><i data-lucide="smartphone"></i></span><div><strong>${esc(x.nombre||"Dispositivo")}</strong><small>${x.ultimo_uso?`Registrado ${fmt(x.ultimo_uso)}`:"Registrado para avisos"}</small></div><button class="icon-button" type="button" data-action="eliminar-dispositivo-push" data-id="${esc(x.id)}" aria-label="Desactivar dispositivo" title="Desactivar"><i data-lucide="x"></i></button></article>`).join("") : `<div class="push-empty">Aún no hay dispositivos registrados.</div>`;
    const headerStatus = activeHere ? "Activo" : statusClass === "off" ? "No disponible" : "Pendiente";
    const explainerTitle = activeHere ? "Notificaciones activas en este dispositivo" : "Activa notificaciones en este dispositivo";
    return `<section class="panel account-panel push-panel"><div class="panel-header push-panel-header"><div><h2>Notificaciones en celular y PC</h2><p class="muted">Recibe avisos importantes aunque el portal esté cerrado o en segundo plano.</p></div><span class="push-state ${statusClass}"><i data-lucide="${activeHere?'bell-ring':'bell'}"></i><span>${esc(headerStatus)}</span></span></div><div class="panel-body push-panel-body"><div class="push-explainer"><span class="push-hero-icon"><i data-lucide="smartphone-nfc"></i></span><div class="push-explainer-copy"><strong>${esc(explainerTitle)}</strong><p>${esc(statusText)}</p><small>Solo enviamos avisos importantes: solicitudes, asignaciones, inicio o finalización, cotizaciones y cambios relevantes.</small></div></div><div class="push-actions">${actions}</div><div class="push-device-list"><div class="push-device-heading"><div><strong>Dispositivos registrados</strong><small>Administra dónde quieres recibir los avisos.</small></div><span>Celular y computadora</span></div>${deviceCards}</div></div></section>`;
  }

  async function handlePushDeepLink() {
    const params = new URLSearchParams(location.search);
    const entity = params.get("push_entity");
    const id = params.get("push_id");
    if (!entity) return;
    try { await openNotificationTarget(entity, id); }
    catch (err) { showToast(err.message || "No fue posible abrir el aviso.", "error"); }
    const clean = rolePaths[state.role] || location.pathname;
    history.replaceState(null, "", clean);
  }

  function cloneApiValue(value) {
    try { return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value)); }
    catch (_) { return value; }
  }

  function apiCacheTtl(url) {
    const path = String(url || "").split("?")[0];
    if (/\/api\/notificaciones/.test(path)) return 8000;
    if (/\/api\/auditoria/.test(path)) return 12000;
    if (/\/api\/dashboard/.test(path)) return 18000;
    if (/\/api\/agenda-operativa/.test(path)) return 15000;
    if (/\/api\/cuenta|\/api\/sesiones/.test(path)) return 15000;
    return 45000;
  }

  function getApiCache(url) {
    const hit = state.apiCache.get(String(url));
    if (!hit) return null;
    if (Date.now() - hit.time > hit.ttl) { state.apiCache.delete(String(url)); return null; }
    return cloneApiValue(hit.data);
  }

  function setApiCache(url, data) {
    state.apiCache.set(String(url), { time:Date.now(), ttl:apiCacheTtl(url), data:cloneApiValue(data) });
  }

  const viewCacheEligible = new Set([
    "dashboard", "solicitudes", "ordenes", "clientes", "personal", "usuarios",
    "equipos", "mantenimientos", "catalogo", "cotizaciones", "documentos",
    "garantia", "notificaciones", "auditoria", "sedes", "vacaciones"
  ]);

  function normalizeViewCacheKey(key) {
    const value = String(key || "");
    if (value === "documentos-laborales") return "documentos";
    if (value === "garantiaSolicitudes") return "garantia";
    return value;
  }

  function viewCacheTtl(module) {
    if (module === "notificaciones") return 15000;
    if (module === "dashboard") return 30000;
    if (module === "auditoria") return 30000;
    return 120000;
  }

  function invalidateViewCache(...keys) {
    keys.flat().filter(Boolean).forEach(key => {
      const module = normalizeViewCacheKey(key);
      state.viewCache.delete(module);
    });
  }

  function markModulesDirty(...keys) {
    keys.flat().filter(Boolean).forEach(key => state.dirtyModules.add(normalizeViewCacheKey(key)));
    invalidateViewCache(...keys);
  }

  function saveViewSnapshot(module) {
    if (!viewCacheEligible.has(module)) return;
    state.viewCache.set(module, {
      time: Date.now(),
      html: content.innerHTML,
      title: title?.textContent || "",
      subtitle: subtitle?.textContent || "",
      eyebrow: eyebrow?.textContent || ""
    });
    state.dirtyModules.delete(module);
  }

  function getViewSnapshot(module) {
    const snap = state.viewCache.get(module);
    if (!snap) return null;
    if (state.dirtyModules.has(module) || Date.now() - snap.time > viewCacheTtl(module)) {
      state.viewCache.delete(module);
      return null;
    }
    return snap;
  }

  function restoreViewSnapshot(module, snap) {
    if (!snap) return false;
    applyModuleVisualMode(module);
    if (title) title.textContent = snap.title || "";
    if (subtitle) subtitle.textContent = snap.subtitle || "";
    if (eyebrow) eyebrow.textContent = snap.eyebrow || "";
    content.innerHTML = snap.html;
    content.dataset.renderedModule = module;
    syncPrototypeChrome();
    enhanceRenderedContent();
    return true;
  }

  function invalidateApiCache(matchers = []) {
    const list = Array.isArray(matchers) ? matchers : [matchers];
    if (!list.length) return;
    for (const key of [...state.apiCache.keys()]) {
      if (list.some(m => typeof m === "string" ? key.includes(m) : m?.test?.(key))) state.apiCache.delete(key);
    }
  }

  function invalidateApiCacheForModule(module) {
    const map = {
      dashboard:["/api/dashboard"], solicitudes:["/api/solicitudes"], ordenes:["/api/ordenes"], agenda:["/api/agenda-operativa"],
      clientes:["/api/clientes"], personal:["/api/personal"], usuarios:["/api/usuarios"], equipos:["/api/equipos"],
      mantenimientos:["/api/mantenimientos"], catalogo:["/api/catalogo-maestro"], cotizaciones:["/api/cotizaciones"],
      documentos:["/api/documentos"], garantia:["/api/garantias"], notificaciones:["/api/notificaciones"],
      roles:["/api/roles-accesos"], cuenta:["/api/cuenta","/api/sesiones"], auditoria:["/api/auditoria"], sedes:["/api/mis-sedes","/api/ubicaciones"]
    };
    invalidateApiCache(map[module] || []);
  }

  function invalidateApiCacheForMutation(url) {
    const path=String(url||"").split("?")[0];
    const groups=[
      [/\/api\/solicitudes/, ["/api/solicitudes","/api/ordenes","/api/dashboard"]],
      [/\/api\/ordenes/, ["/api/ordenes","/api/solicitudes","/api/agenda-operativa","/api/cotizaciones","/api/documentos","/api/garantias","/api/dashboard"]],
      [/\/api\/clientes/, ["/api/clientes","/api/solicitudes","/api/dashboard"]],
      [/\/api\/personal/, ["/api/personal","/api/ordenes","/api/agenda-operativa","/api/dashboard"]],
      [/\/api\/equipos|\/api\/mantenimientos/, ["/api/equipos","/api/mantenimientos","/api/dashboard"]],
      [/\/api\/cotizaciones|\/api\/catalogo-maestro/, ["/api/cotizaciones","/api/catalogo-maestro","/api/dashboard"]],
      [/\/api\/garantias/, ["/api/garantias","/api/dashboard"]],
      [/\/api\/notificaciones/, ["/api/notificaciones"]],
      [/\/api\/auditoria/, ["/api/auditoria"]],
      [/\/api\/roles|\/api\/usuarios/, ["/api/roles-accesos","/api/usuarios"]],
      [/\/api\/mis-sedes|\/api\/ubicaciones/, ["/api/mis-sedes","/api/ubicaciones","/api/solicitudes"]]
    ];
    groups.forEach(([re,keys])=>{ if(re.test(path)) invalidateApiCache(keys); });
  }

  function invalidateListCache(...keys) {
    keys.flat().filter(Boolean).forEach(key => { delete state.listCache[key]; });
  }

  function invalidateListsForMutation(url) {
    const path = String(url || "").split("?")[0];
    if (/\/api\/ordenes/.test(path)) state.orderListDetailCache?.clear?.();
    const rules = [
      [/\/api\/solicitudes/, ["solicitudes", "ordenes", "cotizaciones", "garantia", "dashboard"]],
      [/\/api\/ordenes/, ["ordenes", "solicitudes", "cotizaciones", "documentos", "garantia", "equipos", "dashboard"]],
      [/\/api\/mis-sedes/, ["sedes", "solicitudes"]],
      [/\/api\/clientes/, ["clientes", "solicitudes", "dashboard"]],
      [/\/api\/personal/, ["personal", "vacaciones", "ordenes", "documentos-laborales", "dashboard"]],
      [/\/api\/documentos-laborales/, ["documentos-laborales", "documentos"]],
      [/\/api\/equipos/, ["equipos", "mantenimientos", "ordenes", "dashboard"]],
      [/\/api\/mantenimientos/, ["mantenimientos", "equipos", "dashboard"]],
      [/\/api\/catalogo-maestro/, ["catalogo", "cotizaciones"]],
      [/\/api\/cotizaciones/, ["cotizaciones", "solicitudes", "documentos", "dashboard"]],
      [/\/api\/garantias/, ["garantia"]],
      [/\/api\/notificaciones/, ["notificaciones"]],
      [/\/api\/auditoria/, ["auditoria"]],
      [/\/api\/roles|\/api\/usuarios/, ["roles", "usuarios"]],
    ];
    rules.forEach(([re, keys]) => {
      if (!re.test(path)) return;
      invalidateListCache(keys);
      markModulesDirty(keys);
    });
    invalidateApiCacheForMutation(path);
  }

  function smartClone(value) { return JSON.parse(JSON.stringify(value)); }
  function smartPrefs(key, defaults = {}) {
    if (!state.smartListDefaults[key]) {
      state.smartListDefaults[key] = {
        q: "", pagina: 1, tamano: 10, filtros: {}, orden: "", direccion: "DESC",
        ...smartClone(defaults),
        filtros: { ...(defaults.filtros || {}) },
      };
    }
    if (!state.smartLists[key]) state.smartLists[key] = smartClone(state.smartListDefaults[key]);
    return state.smartLists[key];
  }

  function resetSmartPrefs(key) {
    state.smartLists[key] = smartClone(state.smartListDefaults[key] || { q:"", pagina:1, tamano:10, filtros:{}, orden:"", direccion:"DESC" });
  }

  function smartText(value) {
    return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  }

  function smartDateValue(value) {
    if (!value) return 0;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? 0 : d.getTime();
  }

  function smartUnique(items, resolver) {
    return [...new Set(items.map(resolver).filter(v => v !== null && v !== undefined && String(v).trim() !== "").map(v => String(v)))]
      .sort((a,b) => a.localeCompare(b, "es", { sensitivity:"base", numeric:true }));
  }

  function smartWithParams(endpoint, params = {}) {
    const url = new URL(endpoint, location.origin);
    Object.entries(params).forEach(([k,v]) => {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    });
    return `${url.pathname}${url.search}`;
  }

  async function loadAllPaged(key, endpoint, force = false) {
    if (!force && state.listCache[key]) return state.listCache[key];
    if (!force && state.listInflight.has(key)) return state.listInflight.get(key);

    const task = (async () => {
      const all = [];
      let page = 1, pages = 1, first = null;
      do {
        const data = await api(smartWithParams(endpoint, { pagina: page, tamano: 100 }), force ? { seCache:"reload" } : {});
        if (!first) first = data;
        all.push(...(data.items || []));
        pages = Math.max(1, Number(data.paginas || 1));
        page += 1;
      } while (page <= pages && page <= 100);
      const result = { items: all, meta: first || {}, paginasOrigen: pages, truncado: pages > 100 };
      state.listCache[key] = result;
      return result;
    })();

    state.listInflight.set(key, task);
    try { return await task; }
    finally { if (state.listInflight.get(key) === task) state.listInflight.delete(key); }
  }

  const prefetchSources = {
    solicitudes:["solicitudes","/api/solicitudes"],
    ordenes:["ordenes","/api/ordenes"],
    sedes:["sedes","/api/mis-sedes"],
    clientes:["clientes","/api/clientes"],
    personal:["personal","/api/personal"],
    equipos:["equipos","/api/equipos"],
    mantenimientos:["mantenimientos","/api/mantenimientos"],
    vacaciones:["vacaciones","/api/vacaciones"],
    catalogo:["catalogo","/api/catalogo-maestro"],
    cotizaciones:["cotizaciones","/api/cotizaciones"],
    documentos:["documentos","/api/documentos"],
    notificaciones:["notificaciones","/api/notificaciones?filtro=TODAS"]
  };

  async function prefetchModuleData(module) {
    if (!moduleAllowed(module) || module === state.current) return;
    if (module === "dashboard") { await api("/api/dashboard"); return; }
    const source = prefetchSources[module];
    if (!source) return;
    const [key, endpoint] = source;
    const result = await loadAllPaged(key, endpoint);
    // Órdenes necesita detalles de cuadrilla/estado para pintar la tabla. Calentamos
    // solo las primeras filas para no saturar el backend si el historial crece.
    if (module === "ordenes" && Array.isArray(result?.items) && result.items.length) {
      await loadOrderListDetails(result.items.slice(0, 20));
    }
  }

  function scheduleIdlePrefetch() {
    if (state.prefetchStarted) return;
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (connection?.saveData || /(^|-)2g$/.test(String(connection?.effectiveType || ""))) return;
    state.prefetchStarted = true;

    const plans = {
      COORDINADOR:["dashboard","solicitudes","ordenes","clientes","cotizaciones","equipos","personal","mantenimientos","documentos"],
      TECNICO:["dashboard","ordenes","equipos","mantenimientos","vacaciones","documentos"],
      CLIENTE:["dashboard","solicitudes","ordenes","cotizaciones","sedes","documentos"]
    };
    const queue = (plans[state.role] || []).filter((module, index, list) => module !== state.current && list.indexOf(module) === index && moduleAllowed(module));

    const next = () => {
      if (!queue.length || document.hidden) return;
      const run = async () => {
        const module = queue.shift();
        try { await prefetchModuleData(module); } catch (_) {}
        if (queue.length) window.setTimeout(next, 180);
      };
      if ("requestIdleCallback" in window) requestIdleCallback(() => run(), { timeout: 1800 });
      else window.setTimeout(run, 650);
    };
    window.setTimeout(next, 350);
  }

  function smartListData(key, source, config = {}) {
    const p = smartPrefs(key, config.defaults || {});
    let items = [...(source || [])];
    const q = smartText(p.q);
    if (q && config.search) {
      items = items.filter(item => {
        const values = config.search(item) || [];
        return values.some(value => smartText(value).includes(q));
      });
    }
    Object.entries(p.filtros || {}).forEach(([name, selected]) => {
      if (!selected || selected === "TODOS" || selected === "TODAS") return;
      const resolver = config.filters?.[name];
      if (!resolver) return;
      const selectedValues = Array.isArray(selected)
        ? selected.map(value => String(value || "").toUpperCase()).filter(value => value && value !== "TODOS" && value !== "TODAS")
        : [String(selected).toUpperCase()];
      if (!selectedValues.length) return;
      items = items.filter(item => selectedValues.includes(String(resolver(item) ?? "").toUpperCase()));
    });
    const sorter = config.sort?.[p.orden];
    if (sorter) {
      const factor = String(p.direccion || "ASC").toUpperCase() === "DESC" ? -1 : 1;
      items.sort((a,b) => {
        const av = sorter(a), bv = sorter(b);
        if (typeof av === "number" && typeof bv === "number") return (av - bv) * factor;
        return String(av ?? "").localeCompare(String(bv ?? ""), "es", { sensitivity:"base", numeric:true }) * factor;
      });
    }
    const total = items.length;
    const size = Math.max(5, Number(p.tamano || 10));
    const pages = Math.max(1, Math.ceil(total / size));
    p.pagina = Math.min(Math.max(1, Number(p.pagina || 1)), pages);
    const start = (p.pagina - 1) * size;
    return { items: items.slice(start, start + size), filtered: items, total, pagina: p.pagina, tamano: size, paginas: pages };
  }

  function smartOptions(values, selected, allLabel = "Todos") {
    const rows = [["TODOS", allLabel], ...(values || []).map(v => Array.isArray(v) ? v : [String(v), String(v).replaceAll("_", " ")])];
    const normalizedSelected = Array.isArray(selected)
      ? (selected.length === 1 ? String(selected[0]) : "TODOS")
      : String(selected || "TODOS");
    return rows.map(([value,label]) => `<option value="${esc(value)}" ${normalizedSelected===String(value)?"selected":""}>${esc(label)}</option>`).join("");
  }

  function normalizeSmartQuickValues(value) {
    if (Array.isArray(value)) return [...new Set(value.map(v => String(v || "").toUpperCase()).filter(v => v && v !== "TODOS" && v !== "TODAS"))];
    const single = String(value || "").toUpperCase();
    return single && single !== "TODOS" && single !== "TODAS" ? [single] : [];
  }

  function smartControls(key, config = {}) {
    const p = smartPrefs(key, config.defaults || {});
    const filterDefs = config.filters || [];
    const filters = filterDefs.map(f => `<div class="field"><label>${esc(f.label)}</label><select data-smart-filter="${esc(f.name)}" data-smart-key="${esc(key)}">${smartOptions(f.options || [], p.filtros?.[f.name], f.allLabel || "Todos")}</select></div>`).join("");
    const sorts = (config.sorts || []).length ? `<div class="field"><label>Ordenar por</label><select data-smart-sort data-smart-key="${esc(key)}">${config.sorts.map(([value,label])=>`<option value="${esc(value)}" ${String(p.orden)===String(value)?"selected":""}>${esc(label)}</option>`).join("")}</select></div><div class="field"><label>Dirección</label><select data-smart-direction data-smart-key="${esc(key)}"><option value="DESC" ${p.direccion==="DESC"?"selected":""}>Descendente</option><option value="ASC" ${p.direccion==="ASC"?"selected":""}>Ascendente</option></select></div>` : "";

    const quickDef = config.quick === false ? null : filterDefs.find(f => Array.isArray(f.options) && f.options.length > 0 && f.options.length <= 6);
    let quickMarkup = "";
    if (quickDef) {
      const quickOptions = (quickDef.options || []).map(v => Array.isArray(v) ? v : [String(v), String(v).replaceAll("_", " ")]);
      const selected = normalizeSmartQuickValues(p.filtros?.[quickDef.name]);
      const selectedSet = new Set(selected);
      const allActive = selected.length === 0;
      const pills = [["TODOS","Todos"], ...quickOptions].map(([value,label], index) => {
        const active = value === "TODOS" ? allActive : selectedSet.has(String(value).toUpperCase());
        const tone = index === 0 ? "all" : (index % 4 === 1 ? "blue" : index % 4 === 2 ? "red" : index % 4 === 3 ? "cyan" : "green");
        return `<button class="smart-quick-pill ${tone} ${active?"active":""}" type="button" data-action="smart-quick-filter" data-list-key="${esc(key)}" data-filter-name="${esc(quickDef.name)}" data-value="${esc(value)}"><span>${esc(label)}</span></button>`;
      }).join("");
      const chips = selected.map(value => {
        const row = quickOptions.find(([optionValue]) => String(optionValue).toUpperCase() === value);
        const label = row ? row[1] : value.replaceAll("_", " ");
        return `<button class="smart-quick-active" type="button" data-action="smart-quick-filter" data-list-key="${esc(key)}" data-filter-name="${esc(quickDef.name)}" data-value="${esc(value)}" aria-label="Quitar filtro ${esc(label)}"><span>${esc(label)}</span><i data-lucide="x"></i></button>`;
      }).join("");
      quickMarkup = `<div class="smart-quick-area"><div class="smart-quick-row"><span class="smart-quick-label">Filtros rápidos:</span><div class="smart-quick-pills">${pills}</div><span class="smart-quick-hint">Puedes combinar varios.</span></div>${chips?`<div class="smart-quick-active-row"><span>${selected.length} filtro${selected.length===1?"":"s"} activo${selected.length===1?"":"s"}</span><div>${chips}</div></div>`:""}</div>`;
    }

    return `<div class="smart-filter-shell"><div class="smart-list-tools">
      <div class="field smart-list-search"><label>Buscar</label><div class="input-with-icon"><i data-lucide="search"></i><input type="search" data-smart-q="${esc(key)}" value="${esc(p.q)}" placeholder="${esc(config.placeholder || "Buscar registros...")}" autocomplete="off"></div></div>
      ${filters}${sorts}
      <div class="field smart-list-size"><label>Por página</label><select data-smart-size data-smart-key="${esc(key)}">${[5,10,20,50].map(n=>`<option value="${n}" ${Number(p.tamano)===n?"selected":""}>${n}</option>`).join("")}</select></div>
      <div class="smart-list-clear"><button class="btn" type="button" data-action="smart-reset" data-list-key="${esc(key)}"><i data-lucide="rotate-ccw"></i> Limpiar</button></div>
    </div>${quickMarkup}</div>`;
  }

  function smartPager(key, meta) {
    const page = Number(meta.pagina || 1), pages = Math.max(1, Number(meta.paginas || 1)), total = Number(meta.total || 0), size = Number(meta.tamano || 10);
    const start = total ? (page - 1) * size + 1 : 0, end = Math.min(total, page * size);
    const nums = [];
    for (let n = Math.max(1, page - 2); n <= Math.min(pages, page + 2); n++) nums.push(n);
    return `<div class="smart-pagination"><div class="smart-pagination-copy">Mostrando <strong>${start}-${end}</strong> de <strong>${total}</strong></div><div class="pager-buttons">
      <button type="button" class="pager-button" data-action="smart-page" data-list-key="${esc(key)}" data-page="1" ${page<=1?"disabled":""} aria-label="Primera página"><i data-lucide="chevrons-left"></i></button>
      <button type="button" class="pager-button" data-action="smart-page" data-list-key="${esc(key)}" data-page="${page-1}" ${page<=1?"disabled":""} aria-label="Página anterior"><i data-lucide="chevron-left"></i></button>
      ${nums.map(n=>`<button type="button" class="pager-button ${n===page?"active":""}" data-action="smart-page" data-list-key="${esc(key)}" data-page="${n}">${n}</button>`).join("")}
      <button type="button" class="pager-button" data-action="smart-page" data-list-key="${esc(key)}" data-page="${page+1}" ${page>=pages?"disabled":""} aria-label="Página siguiente"><i data-lucide="chevron-right"></i></button>
      <button type="button" class="pager-button" data-action="smart-page" data-list-key="${esc(key)}" data-page="${pages}" ${page>=pages?"disabled":""} aria-label="Última página"><i data-lucide="chevrons-right"></i></button>
    </div></div>`;
  }

  function smartResultsMeta(result, label = "registros") {
    return `<div class="smart-results-meta"><span><strong>${normalizeNumber(result.total)}</strong> ${esc(label)}</span><span>Página <strong>${normalizeNumber(result.pagina)}</strong> de <strong>${normalizeNumber(result.paginas)}</strong></span></div>`;
  }

  async function rerenderSmartList(key, keepSearchFocus = false) {
    const map = {
      solicitudes: renderSolicitudes, ordenes: renderOrdenes, sedes: renderMisSedes, clientes: renderClientes,
      personal: renderPersonal, equipos: renderEquipos, mantenimientos: renderMantenimientos, vacaciones: renderVacaciones,
      catalogo: renderCatalogoMaestro, cotizaciones: renderCotizaciones, documentos: renderDocumentos,
      notificaciones: renderNotificaciones, auditoria: renderAuditoria, garantia: renderGarantia, garantiaSolicitudes: renderGarantia,
    };
    const fn = map[key]; if (!fn) return;
    const active = keepSearchFocus ? document.querySelector(`[data-smart-q="${key}"]`) : null;
    const caret = active?.selectionStart ?? null;
    const reopenMobileFilters = window.innerWidth <= 820 && document.body.classList.contains("mobile-filters-open");
    closeMobileFilters();
    await fn();
    enhanceRenderedContent();
    if (state.current === normalizeViewCacheKey(key)) saveViewSnapshot(state.current);
    if (reopenMobileFilters) openMobileFilters(content.querySelector(".mobile-filter-panel"));
    if (keepSearchFocus) {
      const next = document.querySelector(`[data-smart-q="${key}"]`);
      if (next) { next.focus(); if (caret !== null && next.setSelectionRange) next.setSelectionRange(caret, caret); }
    }
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
      const me = await api("/api/auth/me");
      state.user = me.user;
      state.role = String(me.user.rol || "").toUpperCase();
      state.roleName = String(me.user.rol_nombre || me.user.rol || "").toUpperCase();
      state.isMasterCoordinator = state.roleName === "COORDINADOR";
      state.allowedModules = new Set(Array.isArray(me.user.modulos) ? me.user.modulos : []);
      document.body.dataset.role = state.role.toLowerCase();
      document.body.dataset.roleName = state.roleName.toLowerCase().replaceAll(" ","-");
      const expected = rolePaths[state.role]; if (!expected) return location.replace("/login");
      // Todas las rutas de rol sirven la misma interfaz. Ajustar la URL con History API evita
      // una recarga completa adicional al entrar y elimina el salto visual al panel inicial.
      if (location.pathname !== expected) history.replaceState(null, "", expected + location.search);
      roleChip.textContent = state.roleName || state.role;
      syncPrototypeChrome();
      renderNav();
      const [cats, health] = await Promise.all([api("/api/catalogos"), api("/api/db/health")]);
      state.catalogs = cats;
      dbBadgeText.textContent = health.system_migration ? "Sistema conectado" : "Configuración pendiente";
      dbBadge.classList.toggle("error", !health.system_migration);
      refreshNotificationBadge().catch(()=>{});
      clearInterval(init.notificationTimer);
      init.notificationTimer = setInterval(()=>refreshNotificationBadge().catch(()=>{}), 60000);
      const key = `seprigua_modulo_${state.roleName || state.role}`;
      const saved = sessionStorage.getItem(key);
      const valid = new Set((modules[state.role] || []).filter(([module])=>moduleAllowed(module)).map(([module]) => module));
      await navigate(saved && valid.has(saved) ? saved : firstAllowedModule());
      document.body.classList.remove("ui-booting");
      scheduleIdlePrefetch();
      initializePushSilently();
      await handlePushDeepLink();
    } catch (e) {
      document.body.classList.remove("ui-booting");
      dbBadge.classList.add("error"); dbBadgeText.textContent = "Sin conexión";
      content.innerHTML = `<div class="empty-state"><h3>No se pudo iniciar el sistema</h3><p>${esc(e.message)}</p><p>Comprueba el backend y la configuración del sistema.</p></div>`;
    }
  }
  const sidebarNavigationGroups = {
    COORDINADOR: {
      dashboard: "OPERACIÓN",
      solicitudes: "OPERACIÓN",
      ordenes: "OPERACIÓN",
      agenda: "OPERACIÓN",
      cotizaciones_comercial: "OPERACIÓN",
      personas: "GESTIÓN",
      equipo_mantenimiento: "GESTIÓN",
      documentos: "GESTIÓN",
      garantia: "GESTIÓN",
      notificaciones: "SISTEMA",
      roles: "SISTEMA",
      auditoria: "SISTEMA",
      cuenta: "CUENTA"
    },
    TECNICO: {
      dashboard: "OPERACIÓN",
      ordenes: "OPERACIÓN",
      agenda: "OPERACIÓN",
      equipo_mantenimiento: "GESTIÓN",
      vacaciones: "GESTIÓN",
      documentos: "GESTIÓN",
      notificaciones: "SISTEMA",
      cuenta: "CUENTA"
    },
    CLIENTE: {
      dashboard: "OPERACIÓN",
      solicitudes: "OPERACIÓN",
      sedes: "GESTIÓN",
      ordenes: "OPERACIÓN",
      cotizaciones: "OPERACIÓN",
      documentos: "GESTIÓN",
      garantia: "GESTIÓN",
      notificaciones: "SISTEMA",
      cuenta: "CUENTA"
    }
  };

  function sidebarGroupForModule(module) {
    return sidebarNavigationGroups[state.role]?.[module] || "";
  }

  function renderNav() {
    const items = navigationEntries();
    const buttons = [...nav.querySelectorAll(":scope > .nav-button")];

    // Mantener nodos estables evita el parpadeo de Lucide y la sensación
    // de que el sidebar "recarga" en cada módulo.
    const structureMatches =
      buttons.length === items.length &&
      buttons.every((button, index) => button.dataset.module === items[index]?.[0]);

    if (!structureMatches) {
      let lastGroup = "";

      nav.innerHTML = items.map(([key, icon, name]) => {
        const group = groupByKey(key);
        const active = key === state.current || Boolean(group?.[1].members.some(([member]) => member === state.current));
        const displayName = key === "dashboard" ? "Centro de control" : name;
        const count = key === "notificaciones" && state.unreadNotifications > 0
          ? `<b class="nav-notification-count">${state.unreadNotifications > 99 ? "99+" : state.unreadNotifications}</b>`
          : "";

        const sidebarGroup = sidebarGroupForModule(key);
        const groupTitle = sidebarGroup && sidebarGroup !== lastGroup
          ? `<span class="nav-group-title" data-nav-group="${esc(sidebarGroup)}">${esc(sidebarGroup)}</span>`
          : "";

        if (sidebarGroup) lastGroup = sidebarGroup;

        return `${groupTitle}<button class="nav-button ${active ? "active" : ""}" type="button" data-module="${key}" title="${esc(displayName)}" aria-label="${esc(displayName)}"><i data-lucide="${icon}"></i><span>${esc(displayName)}</span>${count}</button>`;
      }).join("");

      // Lucide se ejecuta únicamente cuando la estructura se crea de verdad.
      window.lucide?.createIcons();
      return;
    }

    items.forEach(([key, _icon, name], index) => {
      const button = buttons[index];
      if (!button) return;

      const group = groupByKey(key);
      const active = key === state.current || Boolean(group?.[1].members.some(([member]) => member === state.current));
      const displayName = key === "dashboard" ? "Centro de control" : name;

      button.classList.toggle("active", active);

      if (button.title !== displayName) button.title = displayName;
      if (button.getAttribute("aria-label") !== displayName) button.setAttribute("aria-label", displayName);

      const label = button.querySelector("span");
      if (label && label.textContent !== displayName) label.textContent = displayName;

      const shouldShowCount = key === "notificaciones" && state.unreadNotifications > 0;
      let count = button.querySelector(".nav-notification-count");

      if (shouldShowCount) {
        const value = state.unreadNotifications > 99 ? "99+" : String(state.unreadNotifications);
        if (!count) {
          count = document.createElement("b");
          count.className = "nav-notification-count";
          button.appendChild(count);
        }
        if (count.textContent !== value) count.textContent = value;
      } else if (count) {
        count.remove();
      }
    });

    // El ZIP de Gabi tenía menos módulos. Con los módulos nuevos, el menú puede
    // necesitar scroll; mantenemos siempre visible el activo sin mover la hoja.
    requestAnimationFrame(() => {
      nav.querySelector(".nav-button.active")?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    });
  }
  function ensureMobileFilterScrim() {
    let scrim=document.getElementById("mobileFilterScrim");
    if(!scrim){
      scrim=document.createElement("button");
      scrim.type="button";
      scrim.id="mobileFilterScrim";
      scrim.className="mobile-filter-scrim";
      scrim.setAttribute("aria-label","Cerrar filtros");
      scrim.addEventListener("click", closeMobileFilters);
      document.body.appendChild(scrim);
    }
    return scrim;
  }

  function closeMobileFilters() {
    document.querySelectorAll(".mobile-filter-panel.is-open").forEach(panel=>panel.classList.remove("is-open"));
    document.getElementById("mobileFilterScrim")?.classList.remove("is-open");
    document.body.classList.remove("mobile-filters-open");
  }

  function openMobileFilters(panel) {
    if(!panel) return;
    closeMobileFilters();
    panel.classList.add("is-open");
    ensureMobileFilterScrim().classList.add("is-open");
    document.body.classList.add("mobile-filters-open");
    panel.querySelector("input,select,button:not(.mobile-filter-close)")?.focus?.({preventScroll:true});
  }

  function enhanceResponsiveTables(root=content) {
    const selector="table.request-table,table.orders-table,table.order-table,table.quote-table,table.people-table,table.data-table,table.user-report-table,table.cc-recent-table";
    root.querySelectorAll(selector).forEach(table=>{
      table.classList.add("se-responsive-table");
      const headers=[...table.querySelectorAll("thead th")].map(th=>th.textContent.trim());
      table.querySelectorAll("tbody tr").forEach(row=>{
        [...row.children].forEach((cell,index)=>{
          if(cell.tagName==="TD" && !cell.dataset.label) cell.dataset.label=headers[index]||"Dato";
        });
      });
    });
  }

  function enhanceMobileFilters(root=content) {
    const panels=[...root.querySelectorAll(".solicitudes-filter-panel,.orders-filters,.quotes-filters,.people-filter-section,.warranty-filter-panel,.smart-list-tools,.user-filter-grid,.catalog-toolbar")];
    panels.forEach((panel,index)=>{
      if(panel.classList.contains("mobile-filter-panel")) return;
      const id=`mobileFilters-${state.current}-${index}`;
      panel.classList.add("mobile-filter-panel");
      panel.dataset.mobileFilterId=id;
      const trigger=document.createElement("button");
      trigger.type="button";
      trigger.className="mobile-filter-trigger";
      trigger.innerHTML='<i data-lucide="sliders-horizontal"></i><span>Filtros y orden</span>';
      trigger.setAttribute("aria-controls",id);
      trigger.addEventListener("click",()=>openMobileFilters(panel));
      panel.id=id;
      panel.parentNode?.insertBefore(trigger,panel);
      const head=document.createElement("div");
      head.className="mobile-filter-head";
      head.innerHTML='<strong>Filtros y orden</strong><button type="button" class="mobile-filter-close" aria-label="Cerrar filtros"><i data-lucide="x"></i></button>';
      head.querySelector("button")?.addEventListener("click",closeMobileFilters);
      panel.insertBefore(head,panel.firstChild);
    });
  }

  function enhanceRenderedContent(root=content) {
    enhanceResponsiveTables(root);
    enhanceMobileFilters(root);
    window.lucide?.createIcons();
  }

  function applyModuleVisualMode(module) {
    document.body.dataset.module = module;
    const coordinatorVisualMode = state.role === "COORDINADOR";
    document.body.classList.toggle("center-control-mode", coordinatorVisualMode && module === "dashboard");
    document.body.classList.toggle("solicitudes-mode", coordinatorVisualMode && module === "solicitudes");
    document.body.classList.toggle("ordenes-list-mode", coordinatorVisualMode && module === "ordenes");
    document.body.classList.toggle("cotizaciones-list-mode", coordinatorVisualMode && module === "cotizaciones");
    document.body.classList.toggle("personas-list-mode", coordinatorVisualMode && ["clientes", "personal", "usuarios"].includes(module));
    document.body.classList.toggle("equipment-maintenance-ui-mode", coordinatorVisualMode && ["equipos", "mantenimientos"].includes(module));
    document.body.classList.toggle("documents-ui-mode", module === "documentos");
    document.body.classList.toggle("warranty-ui-mode", coordinatorVisualMode && module === "garantia");
    document.body.classList.toggle("notifications-ui-mode", coordinatorVisualMode && module === "notificaciones");
    document.body.classList.toggle("audit-ui-mode", coordinatorVisualMode && module === "auditoria");
    document.body.classList.toggle("account-ui-mode", coordinatorVisualMode && module === "cuenta");
    document.body.classList.toggle("agenda-ui-mode", module === "agenda");
    document.body.classList.toggle("roles-ui-mode", coordinatorVisualMode && module === "roles");
  }

  function beginModuleTransition() {
    // El contenido dinámico se oculta ANTES de cambiar cualquier estado o clase
    // de módulo. Así nunca puede pintarse un frame de HTML con los selectores
    // del módulo equivocado mientras una petición asíncrona está pendiente.
    content.classList.remove("se-module-ready");
    content.classList.add("se-module-switching");
    content.setAttribute("aria-busy", "true");
    try { content.inert = true; } catch (_) {}
  }

  function revealModuleContent() {
    return new Promise(resolve => {
      // Dos frames: 1) el navegador aplica las clases del módulo y recalcula estilo;
      // 2) recién entonces hacemos visible el contenido ya completamente estilizado.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        content.classList.remove("se-module-switching");
        content.classList.remove("se-module-ready");
        content.removeAttribute("aria-busy");
        try { content.inert = false; } catch (_) {}
        void content.offsetWidth;
        content.classList.add("se-module-ready");
        window.setTimeout(() => content.classList.remove("se-module-ready"), 180);
        resolve();
      }));
    });
  }

  async function navigate(module, options = {}) {
    const force = Boolean(options?.force);
    const loaderDelay = Number.isFinite(Number(options?.loaderDelay)) ? Math.max(0, Number(options.loaderDelay)) : 650;
    closeMobileFilters();

    if (state.current === "agenda" && module !== "agenda" && state.agenda?.dirty) {
      if (!window.confirm("Hay cambios de planificación sin guardar. ¿Deseas salir y descartarlos?")) return;
      state.agenda.draft.clear(); state.agenda.dirty = false;
    }
    if (state.warrantyTimer) { clearInterval(state.warrantyTimer); state.warrantyTimer = null; }

    module = resolveGroupedModule(module);
    const valid = new Set((modules[state.role] || []).filter(([key])=>moduleAllowed(key)).map(([key]) => key));
    if (!valid.has(module)) module = firstAllowedModule();

    // No volvemos a cargar un módulo que ya está pintado únicamente por volver
    // a presionar su botón. Esto elimina el loader al hacer clic repetido o fuera
    // de la zona de contenido sobre el mismo acceso activo.
    if (!force && state.current === module && content.dataset.renderedModule === module && !state.dirtyModules.has(module)) {
      renderNav();
      return;
    }

    if (force) {
      invalidateListCache(module);
      invalidateApiCacheForModule(module);
      invalidateViewCache(module);
    }

    const previousModule = state.current;
    const hasRenderedModule = Boolean(content.dataset.renderedModule && content.childElementCount);
    const cachedView = !force ? getViewSnapshot(module) : null;

    // Si ya visitamos el módulo y nada lo invalidó, restauramos su vista completa
    // directamente desde memoria. No hay petición, loader ni reconstrucción del HTML.
    if (cachedView) {
      beginModuleTransition();
      state.current = module;
      if (state.role) {
        sessionStorage.setItem(`seprigua_modulo_${state.roleName || state.role}`, module);
        const grouped = groupForModule(module);
        if (grouped) sessionStorage.setItem(`seprigua_grupo_${state.role}_${grouped[0]}`, module);
      }
      renderNav();
      const systemScrollRegion = document.getElementById("systemScrollRegion");
      if (systemScrollRegion) systemScrollRegion.scrollTop = 0;
      restoreViewSnapshot(module, cachedView);
      decorateModuleHeader();
      await revealModuleContent();
      return;
    }

    // Blindaje anti-FOUC: ocultar la superficie dinámica antes de cambiar
    // state.current, títulos, clases o iniciar cualquier render asíncrono.
    beginModuleTransition();

    // No invalidamos el cache solamente por cambiar de pantalla. Las mutaciones
    // ya invalidan de forma selectiva sus listas relacionadas. Así, al volver a
    // un módulo previamente cargado, los datos disponibles se pintan al instante
    // y el loader global solo aparece cuando realmente hay que esperar al backend.
    state.current = module;

    // CRÍTICO: mientras esperamos la API mantenemos las clases visuales del módulo
    // anterior. Muchos estilos son específicos por módulo (body.*-mode). Cambiarlas
    // antes de que el nuevo HTML esté listo hacía que la vista anterior perdiera su
    // CSS y apareciera por unos segundos como HTML nativo. En el primer arranque no
    // existe contenido anterior, por lo que sí podemos aplicar el modo de inmediato.
    if (!hasRenderedModule) applyModuleVisualMode(module);

    if (state.role) {
      sessionStorage.setItem(`seprigua_modulo_${state.roleName || state.role}`, module);
      const grouped = groupForModule(module);
      if (grouped) sessionStorage.setItem(`seprigua_grupo_${state.role}_${grouped[0]}`, module);
    }

    syncPrototypeChrome();
    renderNav();
    const systemScrollRegion = document.getElementById("systemScrollRegion");
    if (systemScrollRegion) systemScrollRegion.scrollTop = 0;

    const map = { dashboard: renderDashboard, solicitudes: renderSolicitudes, ordenes: renderOrdenes, agenda: renderAgendaOperativa, clientes: renderClientes, sedes: renderMisSedes, personal: renderPersonal, usuarios: renderUsuarios, equipos: renderEquipos, mantenimientos: renderMantenimientos, catalogo: renderCatalogoMaestro, vacaciones: renderVacaciones, cotizaciones: renderCotizaciones, documentos: renderDocumentos, notificaciones: renderNotificaciones, roles: renderRolesAccess, cuenta: renderCuenta, auditoria: renderAuditoria, garantia: renderGarantia };

    let settled = false;
    let globalLoaderToken = null;
    let loaderTimer = null;
    const startLoader = () => {
      if (settled || globalLoaderToken) return;
      globalLoaderToken = loading(module);
    };
    loaderTimer = window.setTimeout(startLoader, loaderDelay);

    try {
      await (map[module] || renderDashboard)();
      settled = true;
      if (loaderTimer) window.clearTimeout(loaderTimer);
      // El HTML nuevo y su clase de módulo se activan en el mismo ciclo de pintura.
      // Así nunca existe un frame con contenido de Solicitudes usando estilos de
      // Órdenes (o viceversa).
      applyModuleVisualMode(module);
      renderContextTabs();
      renderRoleModuleHero();
      decorateModuleHeader();
      enhanceRenderedContent();
      content.dataset.renderedModule = module;
      state.dirtyModules.delete(module);
      saveViewSnapshot(module);
      if (globalLoaderToken) await window.SEPRIGUALoader?.finish(globalLoaderToken);
      await revealModuleContent();
    } catch (e) {
      settled = true;
      if (loaderTimer) window.clearTimeout(loaderTimer);
      content.removeAttribute("data-rendered-module");
      // En error también aplicamos primero el modo visual correcto y revelamos
      // una superficie ya estilizada; nunca dejamos visible el HTML intermedio.
      applyModuleVisualMode(module);
      if (globalLoaderToken && window.SEPRIGUALoader?.fail) {
        window.SEPRIGUALoader.fail(globalLoaderToken, e, { retry: () => navigate(module, { force: true }) });
        content.innerHTML = `<div class="empty-state"><h3>No se pudo cargar</h3><p>${esc(e.message)}</p><button class="btn" type="button" data-action="reintentar-modulo" data-module="${esc(module)}"><i data-lucide="refresh-cw"></i> Reintentar</button></div>`;
        window.lucide?.createIcons();
      } else {
        if (globalLoaderToken) window.SEPRIGUALoader?.cancel(globalLoaderToken);
        content.innerHTML = `<div class="empty-state"><h3>No se pudo cargar</h3><p>${esc(e.message)}</p><button class="btn" type="button" data-action="reintentar-modulo" data-module="${esc(module)}"><i data-lucide="refresh-cw"></i> Reintentar</button></div>`;
        window.lucide?.createIcons();
      }
      content.dataset.renderedModule = module;
      await revealModuleContent();
    }
  }

  async function renderDashboard() {
    // Los portales de Cliente y Técnico comparten la misma calidad visual del Centro de Control,
    // pero conservan únicamente la información y acciones permitidas para cada rol.
    if (state.role !== "COORDINADOR") {
      const isClient = state.role === "CLIENTE";
      const firstName = dashboardFirstName();
      setHeading("Centro de control", isClient ? "Resumen de solicitudes, servicios y documentos de tu cuenta." : "Resumen de órdenes, agenda y actividad asignada.");
      const d = await api("/api/dashboard");
      const cards = d.cards || {};
      const labels = {
        solicitudes_pendientes:"Solicitudes pendientes", ordenes_activas:"Órdenes activas", emergencias:"Emergencias", tecnicos_disponibles:"Técnicos disponibles", equipos_disponibles:"Equipos disponibles", clientes_activos:"Clientes activos", cotizaciones_pendientes:"Cotizaciones pendientes", mantenimientos_pendientes:"Mantenimientos",
        hoy:"Órdenes de hoy", finalizadas:"Finalizadas", incidencias:"Incidencias", solicitudes:"Solicitudes", servicios_activos:"Servicios activos", completados:"Completados", documentos:"Documentos"
      };
      const icons = {
        solicitudes_pendientes:"inbox", ordenes_activas:"clipboard-check", emergencias:"siren", equipos_disponibles:"wrench", cotizaciones_pendientes:"receipt-text",
        hoy:"calendar-check-2", finalizadas:"circle-check-big", incidencias:"triangle-alert", solicitudes:"file-plus-2", servicios_activos:"activity", completados:"badge-check", documentos:"folder-open"
      };
      const preferredKeys = isClient
        ? ["solicitudes","solicitudes_pendientes","servicios_activos","ordenes_activas","completados","cotizaciones_pendientes","documentos"]
        : ["ordenes_activas","hoy","finalizadas","incidencias","equipos_disponibles","mantenimientos_pendientes"];
      const selected = [];
      preferredKeys.forEach(key => { if (Object.prototype.hasOwnProperty.call(cards,key) && selected.length < 4) selected.push([key,cards[key]]); });
      if (selected.length < 4) Object.entries(cards).forEach(entry => { if (selected.length < 4 && !selected.some(([key]) => key === entry[0])) selected.push(entry); });
      const tones = isClient ? ["blue","cyan","green","amber"] : ["blue","cyan","green","red"];
      const kpis = selected.map(([key,value],index) => `<article class="role-kpi-card role-kpi-${tones[index % tones.length]}">
        <span class="role-kpi-icon"><i data-lucide="${esc(icons[key] || "chart-no-axes-column-increasing")}"></i></span>
        <div class="role-kpi-copy"><small>${esc(labels[key] || key.replaceAll("_"," "))}</small><strong>${normalizeNumber(value)}</strong><span>${isClient ? esc(({solicitudes:"Registradas",ordenes_activas:"En seguimiento",ordenes_completadas:"Trabajos finalizados",documentos:"Disponibles"})[key] || "Resumen de tu cuenta") : "Actividad operativa"}</span></div>
      </article>`).join("");

      const quicks = (isClient
        ? [["solicitudes","circle-plus","Nueva solicitud","Solicita un servicio"],["ordenes","clipboard-list","Mis servicios","Revisa tus trabajos"],["garantia","shield-check","Garantía","Consulta cobertura"],["cotizaciones","file-text","Cotizaciones","Revisa propuestas"]]
        : [["ordenes","clipboard-check","Mis órdenes","Trabajos asignados"],["agenda","route","Mi agenda","Ruta y programación"],["equipos","wrench","Equipo","Inventario técnico"],["vacaciones","calendar-days","Vacaciones","Consulta solicitudes"]]
      ).filter(([module]) => moduleAllowed(module));
      const quickMarkup = quicks.map(([module,icon,label,description]) => `<button class="role-quick-action" type="button" data-role-nav="${esc(module)}"><span><i data-lucide="${esc(icon)}"></i></span><div><strong>${esc(label)}</strong><small>${esc(description)}</small></div><i data-lucide="chevron-right"></i></button>`).join("");

      const recent = (d.recent || []).slice(0,6);
      const recentMarkup = recent.length ? recent.map(x => `<article class="role-activity-item">
        <span class="role-activity-icon"><i data-lucide="${x.numero ? "clipboard-list" : "activity"}"></i></span>
        <div class="role-activity-copy"><strong>${esc(x.numero || x.tipo || `#${x.id || "—"}`)}</strong><span>${esc(x.cliente || x.descripcion || (isClient ? "Servicio SEPRIGUA" : "Actividad operativa"))}</span><small>${esc(x.sede || x.clasificacion || "Sin sede")} · ${fmt(x.programada || x.fecha)}</small></div>
        <div class="role-activity-status">${badge(x.estado || x.prioridad || "")}${x.numero ? `<button class="btn small" type="button" data-action="ver-orden" data-id="${esc(x.id)}"><i data-lucide="eye"></i><span>Ver</span></button>` : ""}</div>
      </article>`).join("") : `<div class="role-empty-state"><i data-lucide="sparkles"></i><strong>Todo al día</strong><span>No hay actividad reciente para mostrar.</span></div>`;

      const accountLabel = isClient ? (state.user?.cliente || state.user?.nombre || "Cliente SEPRIGUA") : (state.user?.nombre || "Técnico SEPRIGUA");
      const daypart = portalDaypart();
      const dashboardSummary = isClient
        ? "Consulta y gestiona tus servicios desde un solo lugar."
        : "Consulta tus trabajos, prioridades y accesos operativos desde un solo lugar.";
      const dashboardHero = `
        <header class="cc-workspace-heading cc-time-banner" id="centerDaypartBanner" data-daypart="${daypart.key}">
          <img class="cc-time-banner-art" id="centerDaypartArt" src="${daypart.image}" alt="" aria-hidden="true" decoding="async" fetchpriority="high">
          <div class="cc-time-banner-overlay" aria-hidden="true"></div>
          <div class="cc-time-banner-copy">
            <div class="cc-time-banner-topline">
              <span class="cc-eyebrow">SEPRIGUA · CENTRO DE CONTROL</span>
              <span class="cc-daypart-badge"><i id="centerDaypartIcon" data-lucide="${daypart.icon}" aria-hidden="true"></i><span id="centerDaypartLabel">${daypart.label}</span></span>
            </div>
            <h1 id="centerGreeting" data-user-first="${esc(firstName)}">${daypart.greeting}, ${esc(firstName)}</h1>
            <p>${dashboardSummary}</p>
            <div class="cc-time-banner-footer">
              <div class="cc-sync-state" id="centerSyncState" data-state="updated" role="status" aria-live="polite">
                <i data-lucide="clock-3" aria-hidden="true"></i>
                <span id="centerSyncText">Última actualización</span>
              </div>
              <span class="cc-daypart-detail" id="centerDaypartDetail">${daypart.detail}</span>
            </div>
          </div>
        </header>`;
      content.innerHTML = `<div class="role-dashboard role-dashboard-${isClient ? "client" : "tech"}">
        ${dashboardHero}
        <section class="role-kpi-grid">${kpis || `<div class="role-empty-state"><span>Sin indicadores disponibles.</span></div>`}</section>
        <div class="role-dashboard-layout">
          <section class="panel role-activity-panel"><div class="panel-header"><div><span class="role-section-kicker">MOVIMIENTO RECIENTE</span><h2>Actividad reciente</h2></div></div><div class="role-activity-list">${recentMarkup}</div></section>
          <aside class="panel role-quick-panel"><div class="panel-header"><div><span class="role-section-kicker">ACCESOS RÁPIDOS</span><h2>${isClient ? "Gestiona tu cuenta" : "Herramientas de trabajo"}</h2></div></div><div class="role-quick-list">${quickMarkup}</div></aside>
        </div>
      </div>`;
      window.lucide?.createIcons();
      return;
    }

    // Centro de control del Coordinador.
    setHeading("Centro de control", "Resumen operativo del centro de control");
    document.dispatchEvent(new CustomEvent("seprigua:center-sync-state", { detail: { state: "syncing" } }));

    const d = await api("/api/dashboard");
    const cards = d.cards || {};

    const emergencyCount = normalizeNumber(cards.emergencias);
    const pendingRequests = normalizeNumber(cards.solicitudes_pendientes);
    const activeOrders = normalizeNumber(cards.ordenes_activas);
    const pendingQuotes = normalizeNumber(cards.cotizaciones_pendientes);
    const availableTechs = normalizeNumber(cards.tecnicos_disponibles);
    const staffCapacity = dashboardStaffCapacity();
    const availableEquipment = normalizeNumber(cards.equipos_disponibles);
    const activeClients = normalizeNumber(cards.clientes_activos);
    const maintenances = normalizeNumber(cards.mantenimientos_pendientes);

    // Totales y tendencias son opcionales. Si el backend no los entrega,
    // la UI no inventa porcentajes: muestra un estado neutral/indeterminado.
    const totalEquipment = dashboardOptionalNumber(
      cards.equipos_totales,
      cards.total_equipos,
      d.totals?.equipos,
      d.totales?.equipos,
      Array.isArray(state.catalogs?.equipos) ? state.catalogs.equipos.length : null
    );
    const clientsTrend = dashboardOptionalNumber(
      d.trends?.clientes_activos,
      d.tendencias?.clientes_activos,
      cards.clientes_activos_variacion,
      cards.clientes_activos_tendencia
    );
    const maintenanceTrend = dashboardOptionalNumber(
      d.trends?.mantenimientos,
      d.trends?.mantenimientos_pendientes,
      d.tendencias?.mantenimientos,
      cards.mantenimientos_variacion,
      cards.mantenimientos_tendencia
    );

    const recent = d.recent || [];
    const hasActionColumn = recent.some(x => x.numero);
    const recentPageSize = 4;
    const recentPages = Math.max(1, Math.ceil(recent.length / recentPageSize));
    state.dashboardRecentPage = Math.min(Math.max(1, Number(state.dashboardRecentPage || 1)), recentPages);
    const recentStartIndex = (state.dashboardRecentPage - 1) * recentPageSize;
    const recentVisible = recent.slice(recentStartIndex, recentStartIndex + recentPageSize);
    const recentRows = recentVisible.map(x => `
      <tr>
        <td class="cc-order-id">${esc(x.numero || x.tipo || `#${x.id}`)}</td>
        <td>${x.cliente ? esc(x.cliente) : esc(x.descripcion || "—")}</td>
        <td>${esc(x.sede || x.clasificacion || "—")}</td>
        <td>${dashboardStatusBadge(x.estado || x.prioridad || "")}</td>
        <td>${fmt(x.programada || x.fecha)}</td>
        ${hasActionColumn ? `<td>${x.numero ? iconButton("eye", "ver-orden", x.id, "Abrir " + (x.numero || ("OT " + x.id)), "cc-eye-button") : "—"}</td>` : ""}
      </tr>
    `);

    const chartItems = d.chart || [];
    const chartMax = Math.max(1, ...chartItems.map(x => normalizeNumber(x.ordenes)));
    const chartMarkup = chartItems.length
      ? `<div class="cc-column-chart" role="img" aria-label="Órdenes de los últimos seis meses">
          ${chartItems.map(x => {
            const value = normalizeNumber(x.ordenes);
            const percentage = value <= 0 ? 0 : Math.max(4, Math.round(value / chartMax * 100));
            return `<div class="cc-chart-column">
              <span class="cc-chart-value">${value}</span>
              <div class="cc-chart-track"><span class="cc-chart-bar" style="height:${percentage}%"></span></div>
              <span class="cc-chart-label">${esc(dashboardMonthLabel(x.mes))}</span>
            </div>`;
          }).join("")}
        </div>`
      : `<div class="cc-chart-empty">No hay datos de órdenes para graficar.</div>`;

    const firstName = dashboardFirstName();
    const daypart = portalDaypart();

    content.innerHTML = `
      <div class="cc-dashboard-shell">
        <header class="cc-workspace-heading cc-time-banner" id="centerDaypartBanner" data-daypart="${daypart.key}">
          <img class="cc-time-banner-art" id="centerDaypartArt" src="${daypart.image}" alt="" aria-hidden="true" decoding="async" fetchpriority="high">
          <div class="cc-time-banner-overlay" aria-hidden="true"></div>
          <div class="cc-time-banner-copy">
            <div class="cc-time-banner-topline">
              <span class="cc-eyebrow">SEPRIGUA · CENTRO DE CONTROL</span>
              <span class="cc-daypart-badge"><i id="centerDaypartIcon" data-lucide="${daypart.icon}" aria-hidden="true"></i><span id="centerDaypartLabel">${daypart.label}</span></span>
            </div>
            <h1 id="centerGreeting" data-user-first="${esc(firstName)}">${daypart.greeting}, ${esc(firstName)}</h1>
            <p>Resumen operativo del centro de control</p>
            <div class="cc-time-banner-footer">
              <div class="cc-sync-state" id="centerSyncState" data-state="updated" role="status" aria-live="polite">
                <i data-lucide="clock-3" aria-hidden="true"></i>
                <span id="centerSyncText">Última actualización</span>
              </div>
              <span class="cc-daypart-detail" id="centerDaypartDetail">${daypart.detail}</span>
            </div>
          </div>
        </header>

        <section class="cc-kpi-grid" aria-label="Indicadores operativos principales">
          <article class="cc-kpi cc-kpi-emergency ${emergencyCount > 0 ? "cc-kpi-alert" : "cc-kpi-idle"}">
            <button class="cc-kpi-more" type="button" data-action="dashboard-ver-emergencias" aria-label="Ver más emergencias">
              <span>Ver más</span><i data-lucide="arrow-right"></i>
            </button>
            <div class="cc-kpi-icon"><i data-lucide="triangle-alert"></i></div>
            <div class="cc-kpi-copy">
              <span>Emergencias</span>
              <strong>${emergencyCount}</strong>
              <small>Requieren atención</small>
            </div>
          </article>

          <article class="cc-kpi cc-kpi-info cc-kpi-requests">
            <button class="cc-kpi-more" type="button" data-action="dashboard-ver-solicitudes" aria-label="Ver más solicitudes pendientes">
              <span>Ver más</span><i data-lucide="arrow-right"></i>
            </button>
            <div class="cc-kpi-icon"><i data-lucide="inbox"></i></div>
            <div class="cc-kpi-copy">
              <span>Solicitudes pendientes</span>
              <strong>${pendingRequests}</strong>
              <small>Por gestionar</small>
            </div>
          </article>

          <article class="cc-kpi cc-kpi-orders">
            <button class="cc-kpi-more" type="button" data-action="dashboard-ver-ordenes" aria-label="Ver más órdenes activas">
              <span>Ver más</span><i data-lucide="arrow-right"></i>
            </button>
            <div class="cc-kpi-icon"><i data-lucide="clipboard-check"></i></div>
            <div class="cc-kpi-copy">
              <span>Órdenes activas</span>
              <strong>${activeOrders}</strong>
              <small>Operación en curso</small>
            </div>
          </article>

          <article class="cc-kpi cc-kpi-quote">
            <button class="cc-kpi-more" type="button" data-action="dashboard-ver-cotizaciones" aria-label="Ver más cotizaciones pendientes">
              <span>Ver más</span><i data-lucide="arrow-right"></i>
            </button>
            <div class="cc-kpi-icon"><i data-lucide="receipt-text"></i></div>
            <div class="cc-kpi-copy">
              <span>Cotizaciones pendientes</span>
              <strong>${pendingQuotes}</strong>
              <small>Pendientes de gestión</small>
            </div>
          </article>
        </section>

        <section class="cc-secondary-grid">
          <article class="cc-bento-panel cc-capacity-panel">
            <div class="cc-panel-heading cc-panel-heading-row">
              <div>
                <span class="cc-panel-kicker">OPERACIÓN</span>
                <h2>Capacidad operativa</h2>
              </div>
              <button class="cc-link-action" type="button" data-action="dashboard-ver-capacidad">
                Ver más <i data-lucide="arrow-right"></i>
              </button>
            </div>

            <div class="cc-capacity-grid cc-capacity-grid-staff">
              <div class="cc-capacity-item">
                <span class="cc-capacity-icon cc-capacity-blue"><i data-lucide="hard-hat"></i></span>
                <div class="cc-capacity-copy">
                  <span>Operarios disponibles</span>
                  <strong>${staffCapacity.operarios.available}</strong>
                  ${dashboardCapacityProgress(staffCapacity.operarios.available, staffCapacity.operarios.total, "blue")}
                </div>
              </div>

              <div class="cc-capacity-item">
                <span class="cc-capacity-icon cc-capacity-supervisor"><i data-lucide="shield-user"></i></span>
                <div class="cc-capacity-copy">
                  <span>Supervisores disponibles</span>
                  <strong>${staffCapacity.supervisores.available}</strong>
                  ${dashboardCapacityProgress(staffCapacity.supervisores.available, staffCapacity.supervisores.total, "blue")}
                </div>
              </div>

              <div class="cc-capacity-item">
                <span class="cc-capacity-icon ${availableEquipment === 0 ? "cc-capacity-red" : "cc-capacity-blue"}"><i data-lucide="wrench"></i></span>
                <div class="cc-capacity-copy">
                  <span>Equipos disponibles</span>
                  <strong>${availableEquipment}</strong>
                  ${dashboardCapacityProgress(availableEquipment, totalEquipment, availableEquipment === 0 ? "red" : "blue")}
                  ${availableEquipment === 0
                    ? `<small class="cc-inline-alert"><i data-lucide="triangle-alert"></i> Sin equipos disponibles</small>`
                    : ``}
                </div>
              </div>
            </div>
          </article>

          <article class="cc-bento-panel cc-summary-panel">
            <div class="cc-panel-heading cc-panel-heading-row">
              <div>
                <span class="cc-panel-kicker">RESUMEN</span>
                <h2>Resumen operativo</h2>
              </div>
              <button class="cc-link-action" type="button" data-action="dashboard-ver-resumen">
                Ver más <i data-lucide="arrow-right"></i>
              </button>
            </div>

            <div class="cc-summary-grid">
              <div class="cc-summary-item">
                <span class="cc-summary-icon"><i data-lucide="building-2"></i></span>
                <div>
                  <span>Clientes activos</span>
                  <strong>${activeClients}</strong>
                  ${dashboardTrendMarkup(clientsTrend)}
                </div>
              </div>
              <div class="cc-summary-item">
                <span class="cc-summary-icon"><i data-lucide="settings"></i></span>
                <div>
                  <span>Mantenimientos</span>
                  <strong>${maintenances}</strong>
                  ${dashboardTrendMarkup(maintenanceTrend)}
                </div>
              </div>
            </div>
          </article>
        </section>

        <section class="cc-detail-grid">
          <article class="cc-bento-panel cc-recent-panel">
            <div class="cc-panel-heading cc-panel-heading-row">
              <div>
                <span class="cc-panel-kicker">MOVIMIENTO RECIENTE</span>
                <h2>Actividad reciente</h2>
              </div>
              <button class="cc-link-action" type="button" data-action="dashboard-ver-ordenes">
                Ver más <i data-lucide="arrow-right"></i>
              </button>
            </div>
            <div class="cc-recent-table">
              ${table(
                ["Registro","Cliente / detalle","Sede / tipo","Estado","Fecha", ...(hasActionColumn ? ["Acción"] : [])],
                recentRows,
                "Todavía no hay actividad para mostrar."
              )}
              ${dashboardRecentPager({ pagina: state.dashboardRecentPage, paginas: recentPages, total: recent.length, tamano: recentPageSize })}
            </div>
          </article>

          <article class="cc-bento-panel cc-chart-panel">
            <div class="cc-panel-heading">
              <div>
                <span class="cc-panel-kicker">TENDENCIA</span>
                <h2>Órdenes · últimos 6 meses</h2>
              </div>
              <i data-lucide="chart-column"></i>
            </div>
            ${chartMarkup}
          </article>
        </section>
      </div>
    `;

    window.lucide?.createIcons();
    animateDashboardCapacityBars();

    document.dispatchEvent(new CustomEvent("seprigua:center-data-updated"));
    document.dispatchEvent(new CustomEvent("seprigua:center-sync-state", { detail: { state: "updated" } }));
  }

  /* ========================================================================
     Agenda operativa
     - Coordinación: planificador visual con arrastre horizontal y guardado en lote.
     - Técnico: lectura de su ruta; en móvil se transforma en una lista rápida.
     ======================================================================== */
  function agendaEmergency(order) {
    const classification=String(order?.clasificacion||"").toUpperCase();
    const priority=String(order?.prioridad||"").toUpperCase();
    return classification==="EMERGENCIA" || priority==="CRITICA";
  }

  function agendaPriorityHigh(order) {
    return !agendaEmergency(order) && String(order?.prioridad||"").toUpperCase()==="ALTA";
  }

  function agendaMinuteText(value) {
    if(value===null || value===undefined || !Number.isFinite(Number(value))) return "Sin hora";
    let minute=Math.max(0,Math.min(1439,Math.round(Number(value))));
    const hour=Math.floor(minute/60), mins=minute%60;
    const d=new Date(2000,0,1,hour,mins);
    return d.toLocaleTimeString("es-GT",{hour:"numeric",minute:"2-digit"});
  }

  function agendaDateLabel(value) {
    if(!value) return "—";
    const [y,m,d]=String(value).split("-").map(Number);
    const date=new Date(y,m-1,d);
    return date.toLocaleDateString("es-GT",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
  }

  function agendaDateShift(value,days) {
    const [y,m,d]=String(value).split("-").map(Number);
    const date=new Date(y,m-1,d);date.setDate(date.getDate()+days);
    const z=n=>String(n).padStart(2,"0");
    return `${date.getFullYear()}-${z(date.getMonth()+1)}-${z(date.getDate())}`;
  }

  function agendaDateTimePayload(day,minute) {
    const m=Math.max(0,Math.min(1439,Math.round(Number(minute))));
    const hh=String(Math.floor(m/60)).padStart(2,"0"),mm=String(m%60).padStart(2,"0");
    return `${day}T${hh}:${mm}:00`;
  }

  function agendaAllOrders(data=state.agenda.data) {
    const map=new Map();
    (data?.tecnicos||[]).forEach(t=>(t.ordenes||[]).forEach(o=>map.set(Number(o.id),o)));
    return map;
  }

  function agendaOrder(orderId) {
    return agendaAllOrders().get(Number(orderId)) || null;
  }

  function agendaCurrentMinute(order) {
    if(!order) return null;
    const id=Number(order.id);
    if(state.agenda.draft.has(id)) return Number(state.agenda.draft.get(id));
    return order.minuto===null || order.minuto===undefined ? null : Number(order.minuto);
  }

  function agendaDisplayMinute(order) {
    const minute=agendaCurrentMinute(order);
    return minute===null ? 18*60 : minute;
  }

  function agendaSetDirtyMinute(orderId,minute) {
    const order=agendaOrder(orderId);if(!order)return;
    const snapped=Math.max(0,Math.min(1439,Math.round(Number(minute)/15)*15));
    const original=order.minuto===null || order.minuto===undefined ? null : Number(order.minuto);
    if(original!==null && original===snapped) state.agenda.draft.delete(Number(orderId));
    else state.agenda.draft.set(Number(orderId),snapped);
    state.agenda.dirty=state.agenda.draft.size>0;
    agendaRefreshDraftDom(orderId);
  }

  function agendaRefreshDraftDom(orderId) {
    const order=agendaOrder(orderId);if(!order)return;
    const minute=agendaDisplayMinute(order),start=Number(content.querySelector(".agenda-grid")?.dataset.startMinute||360);
    const hourWidth=Number(content.querySelector(".agenda-grid")?.dataset.hourWidth||112);
    const left=Math.max(0,(minute-start)/60*hourWidth);
    content.querySelectorAll(`[data-agenda-order="${CSS.escape(String(orderId))}"]`).forEach(card=>{
      card.style.left=`${left}px`;
      card.classList.toggle("unscheduled",agendaCurrentMinute(order)===null);
      const time=card.querySelector("[data-agenda-time]");if(time)time.textContent=agendaMinuteText(agendaCurrentMinute(order));
    });
    const save=content.querySelector("#agendaSaveButton");if(save)save.disabled=!state.agenda.dirty;
    const dirty=content.querySelector("#agendaDirtyBar");if(dirty)dirty.hidden=!state.agenda.dirty;
    const count=content.querySelector("#agendaDirtyCount");if(count)count.textContent=String(state.agenda.draft.size);
    if(Number(state.agenda.selectedOrderId)===Number(orderId)) agendaRenderDetail(orderId);
  }

  function agendaWindow(data) {
    const orders=[...agendaAllOrders(data).values()];
    const mins=orders.map(o=>agendaCurrentMinute(o)).filter(v=>v!==null&&Number.isFinite(Number(v))).map(Number);
    let start=6*60;
    if(mins.length) start=Math.min(start,Math.floor(Math.min(...mins)/60)*60);
    start=Math.max(0,start);
    return {start,end:24*60,hourWidth:112};
  }

  function agendaOrderClass(order) {
    const stateCode=String(order?.estado_codigo||"").toUpperCase();
    if(stateCode==="EN_PROCESO") return "live";
    if(agendaEmergency(order)) return "emergency";
    if(agendaPriorityHigh(order)) return "high";
    return "normal";
  }

  function agendaStatusLabel(tech) {
    const status=String(tech.estado_operativo||"DISPONIBLE").toUpperCase();
    const cls=status==="EN_SERVICIO"?"live":status==="EN_COLA"?"queue":status==="DISPONIBLE"?"available":"away";
    const text=status==="EN_COLA"&&Number(tech.cola_cantidad||0)>0?`${tech.cola_cantidad} EN COLA`:status.replaceAll("_"," ");
    return `<span class="agenda-status ${cls}">${esc(text)}</span>`;
  }

  function agendaTechnicianCell(tech) {
    return `<div class="agenda-tech-main">
      <span class="agenda-avatar">${esc(tech.iniciales||"--")}</span>
      <span class="agenda-tech-name"><strong>${esc(tech.nombre||"Técnico")}</strong><small>${esc(tech.puesto||"Personal técnico")}</small></span>
    </div>
    <div class="agenda-tech-meta">${agendaStatusLabel(tech)}<span class="agenda-tech-mode"><i data-lucide="${tech.en_equipo?"users":"user-round"}"></i>${tech.en_equipo?"Trabajo en cuadrilla":"Ruta individual"}</span></div>`;
  }

  function agendaJobCard(order,windowInfo) {
    const id=Number(order.id),minute=agendaDisplayMinute(order),left=Math.max(0,(minute-windowInfo.start)/60*windowInfo.hourWidth);
    const code=String(order.estado_codigo||"").toUpperCase();
    const draggable=state.role==="COORDINADOR" && ["PENDIENTE","PROGRAMADA"].includes(code);
    const visual=order.estado_visual==="SIGUIENTE"?"SIGUIENTE":order.estado_visual==="EN_COLA"?`COLA ${order.cola_posicion||""}`:code==="EN_PROCESO"?"EN SERVICIO":String(order.prioridad||"");
    const location=order.sede||order.municipio||"Sede";
    const unscheduled=agendaCurrentMinute(order)===null;
    return `<button class="agenda-job ${agendaOrderClass(order)} ${unscheduled?"unscheduled":""} ${draggable?"":"locked"} ${Number(state.agenda.selectedOrderId)===id?"selected":""}" type="button"
      data-agenda-order="${id}" data-agenda-draggable="${draggable?1:0}" style="left:${left}px" aria-label="Abrir ${esc(order.numero||`OT ${id}`)}">
      <span class="agenda-job-bar"></span><span class="agenda-job-body">
        <span class="agenda-job-top"><strong>${esc(order.numero||`OT-${id}`)}</strong><span class="agenda-job-chip">${esc(unscheduled?"SIN HORA":visual)}</span></span>
        <span class="agenda-job-title">${esc(order.servicio||"Servicio")}</span>
        <span class="agenda-job-foot"><span><i data-lucide="clock-3"></i><b data-agenda-time>${esc(agendaMinuteText(agendaCurrentMinute(order)))}</b></span><span title="${esc(location)}"><i data-lucide="map-pin"></i>${esc(location)}</span></span>
      </span></button>`;
  }

  function agendaNowLine(windowInfo) {
    const data=state.agenda.data;if(!data||data.fecha!==data.hoy)return "";
    const now=new Date(data.ahora);const minute=now.getHours()*60+now.getMinutes();
    if(minute<windowInfo.start||minute>windowInfo.end)return "";
    const left=(minute-windowInfo.start)/60*windowInfo.hourWidth;
    return `<span class="agenda-now-line" style="left:${left}px" title="Hora actual"></span>`;
  }

  function agendaDetailHtml(order) {
    if(!order)return `<div class="agenda-detail-empty"><span><i data-lucide="mouse-pointer-2"></i></span><strong>Selecciona una orden</strong><p>Presiona un bloque para ver cliente, ubicación, horario y acciones rápidas.</p></div>`;
    const emergency=agendaEmergency(order),minute=agendaCurrentMinute(order);
    const location=[order.direccion,order.municipio,order.departamento].filter(Boolean).join(", ") || order.sede || "—";
    const movable=state.role==="COORDINADOR" && ["PENDIENTE","PROGRAMADA"].includes(String(order.estado_codigo||"").toUpperCase());
    return `<div class="agenda-detail-head">
      <span class="agenda-detail-kicker"><i data-lucide="${emergency?"siren":"clipboard-list"}"></i>${emergency?"EMERGENCIA":"DETALLE DE LA ACTIVIDAD"}</span>
      <h3>${esc(order.numero||`OT-${order.id}`)}</h3><p>${esc(order.servicio||"Servicio programado")}</p>
    </div><div class="agenda-detail-body">
      <div class="agenda-detail-state"><span class="agenda-priority ${emergency?"emergency":""}"><i data-lucide="flag"></i>${esc(order.prioridad||"MEDIA")}</span>${badge(order.estado||order.estado_codigo||"")}</div>
      <div class="agenda-detail-grid">
        <div class="agenda-detail-line"><span><i data-lucide="building-2"></i></span><small>Cliente</small><strong>${esc(order.cliente||"—")}</strong></div>
        <div class="agenda-detail-line"><span><i data-lucide="map-pin"></i></span><small>Sede / dirección</small><strong>${esc(location)}</strong></div>
        <div class="agenda-detail-line"><span><i data-lucide="wrench"></i></span><small>Servicio</small><strong>${esc(order.servicio||"—")}</strong></div>
        <div class="agenda-detail-line"><span><i data-lucide="clock-3"></i></span><small>Atención</small><strong>${esc(agendaMinuteText(minute))}${state.agenda.draft.has(Number(order.id))?" · Cambio sin guardar":""}</strong></div>
        <div class="agenda-detail-line"><span><i data-lucide="users"></i></span><small>Cuadrilla</small><strong>${Number(order.integrantes||1)} integrante${Number(order.integrantes||1)===1?"":"s"}${order.encargado?` · ${esc(order.encargado)}`:""}</strong></div>
      </div>
      ${movable?`<div class="agenda-shift"><button class="btn small" type="button" data-agenda-shift="-15" data-id="${order.id}"><i data-lucide="chevron-left"></i>15 min</button><strong>Ajuste rápido</strong><button class="btn small" type="button" data-agenda-shift="15" data-id="${order.id}">15 min<i data-lucide="chevron-right"></i></button></div>`:""}
      <div class="agenda-detail-actions">
        <button class="btn primary" type="button" data-action="ver-orden" data-id="${order.id}"><i data-lucide="external-link"></i> Ver OT</button>
        <button class="btn" type="button" data-action="ver-orden" data-id="${order.id}"><i data-lucide="activity"></i> Seguimiento</button>
        ${state.role==="COORDINADOR"?`<button class="btn" type="button" data-action="asignar-tecnico" data-id="${order.id}"><i data-lucide="users-round"></i> Cuadrilla</button><button class="btn" type="button" data-action="cotizar-orden" data-id="${order.id}"><i data-lucide="file-text"></i> Cotización</button>`:""}
      </div>
    </div>`;
  }

  function agendaRenderDetail(orderId) {
    state.agenda.selectedOrderId=Number(orderId)||null;
    content.querySelectorAll(".agenda-job.selected").forEach(x=>x.classList.remove("selected"));
    if(state.agenda.selectedOrderId)content.querySelectorAll(`[data-agenda-order="${CSS.escape(String(state.agenda.selectedOrderId))}"]`).forEach(x=>x.classList.add("selected"));
    const detail=content.querySelector("#agendaDetail");if(detail)detail.innerHTML=agendaDetailHtml(agendaOrder(state.agenda.selectedOrderId));
    window.lucide?.createIcons();
    agendaBindDetailControls();
  }

  function agendaMobileRoute(data) {
    const isCoordinator = state.role === "COORDINADOR";
    const source = isCoordinator
      ? (data.tecnicos || []).flatMap(tech => (tech.ordenes || []).map(order => ({ ...order, _tecnico: tech.nombre || "Sin técnico" })))
      : (((data.tecnicos || [])[0]?.ordenes || []).map(order => ({ ...order, _tecnico: "" })));
    const orders = source.slice().sort((a,b)=>{
      const av=String(a.estado_codigo||"")==="EN_PROCESO"?-1:(agendaCurrentMinute(a)??9999);
      const bv=String(b.estado_codigo||"")==="EN_PROCESO"?-1:(agendaCurrentMinute(b)??9999);
      return av-bv;
    });
    const title = isCoordinator ? "Agenda del día" : "Mi ruta de trabajo";
    const description = isCoordinator
      ? `${esc(agendaDateLabel(data.fecha))}. Vista móvil de las órdenes visibles por horario.`
      : `${esc(agendaDateLabel(data.fecha))}. Presiona una orden para abrir su detalle.`;
    return `<section class="agenda-route-mobile"><h3>${title}</h3><p>${description}</p><div class="agenda-route-list">${orders.length?orders.map((o,i)=>`<article class="agenda-route-card ${agendaOrderClass(o)}"><span class="agenda-route-number">${String(o.estado_codigo||"").toUpperCase()==="EN_PROCESO"?"AH":String(i+1).padStart(2,"0")}</span><div class="agenda-route-copy"><strong>${esc(o.numero||`OT-${o.id}`)} · ${esc(o.servicio||"Servicio")}</strong><span>${esc(o.cliente||"—")} · ${esc(o.sede||o.municipio||"—")}${o._tecnico?` · ${esc(o._tecnico)}`:""}</span></div><div class="agenda-route-time"><strong>${esc(agendaMinuteText(agendaCurrentMinute(o)))}</strong><small>${esc(o.estado_visual||o.estado||"")}</small></div><button class="btn small" type="button" data-action="ver-orden" data-id="${o.id}"><i data-lucide="external-link"></i> Abrir OT</button></article>`).join(""):`<div class="agenda-no-data"><span><i data-lucide="calendar-check"></i></span><h3>Ruta libre</h3><p>No hay órdenes visibles para este día.</p></div>`}</div></section>`;
  }

  function agendaPaint() {
    const data=state.agenda.data;if(!data)return;
    const win=agendaWindow(data),hourCount=Math.ceil((win.end-win.start)/60),trackWidth=hourCount*win.hourWidth;
    let technicians=(data.tecnicos||[]).filter(t=>state.agenda.technicianFilter==="TODOS"||String(t.id)===String(state.agenda.technicianFilter));
    if(state.agenda.onlyEmergencies)technicians=technicians.filter(t=>(t.ordenes||[]).some(agendaEmergency));
    const visibleOrders=technicians.flatMap(t=>(t.ordenes||[]).filter(o=>!state.agenda.onlyEmergencies||agendaEmergency(o)));
    const visibleIds=new Set(visibleOrders.map(o=>Number(o.id)));
    if(state.agenda.selectedOrderId&&!visibleIds.has(Number(state.agenda.selectedOrderId)))state.agenda.selectedOrderId=visibleOrders[0]?Number(visibleOrders[0].id):null;
    const techOptions=(data.tecnicos||[]).map(t=>`<option value="${t.id}" ${String(state.agenda.technicianFilter)===String(t.id)?"selected":""}>${esc(t.nombre)}</option>`).join("");
    const hours=Array.from({length:hourCount},(_,i)=>win.start/60+i);
    const rows=technicians.map(tech=>{
      const orders=(tech.ordenes||[]).filter(o=>!state.agenda.onlyEmergencies||agendaEmergency(o));
      return `<div class="agenda-tech">${agendaTechnicianCell(tech)}</div><div class="agenda-track">${agendaNowLine(win)}${orders.length?orders.map(o=>agendaJobCard(o,win)).join(""):`<span class="agenda-empty-track">Sin trabajos programados en esta vista.</span>`}</div>`;
    }).join("");
    const summary=data.resumen||{};
    const selected=agendaOrder(state.agenda.selectedOrderId);
    content.innerHTML=`<div class="agenda-shell agenda-role-${String(state.role||"").toLowerCase()}">
      <section class="agenda-command"><div class="agenda-command-copy"><span class="agenda-command-icon"><i data-lucide="${state.role==="TECNICO"?"route":"calendar-range"}"></i></span><div><h2>${state.role==="TECNICO"?"Mi agenda de trabajo":"Agenda operativa"}</h2><p>${state.role==="TECNICO"?"Tu trabajo actual, la siguiente orden y lo que queda en cola, todo en una sola vista.":"Planifica la secuencia de atención. Los bloques se mueven primero en pantalla y la base de datos cambia únicamente al guardar."}</p></div></div><div class="agenda-command-actions">
        <button class="btn" id="agendaTodayButton" type="button"><i data-lucide="locate-fixed"></i> Hoy</button>
        ${state.role==="COORDINADOR"?`<button class="btn" id="agendaResetButton" type="button" ${state.agenda.dirty?"":"disabled"}><i data-lucide="rotate-ccw"></i> Restablecer</button><button class="btn primary agenda-save" id="agendaSaveButton" type="button" ${state.agenda.dirty?"":"disabled"}><i data-lucide="save"></i> Guardar planificación</button>`:""}
      </div></section>
      <section class="agenda-summary">
        ${state.role==="TECNICO"?(()=>{const tech=(data.tecnicos||[])[0]||{};return `<article class="agenda-summary-card"><small>Órdenes del día</small><strong>${Number(summary.ordenes||0)}</strong><span>${esc(agendaDateLabel(data.fecha))}</span></article><article class="agenda-summary-card live"><small>Ahora</small><strong>${Number(summary.en_servicio||0)}</strong><span>${summary.en_servicio?"Servicio en ejecución":"Sin servicio iniciado"}</span></article><article class="agenda-summary-card"><small>En cola</small><strong>${Number(tech.cola_cantidad||0)}</strong><span>Trabajos pendientes de atención</span></article><article class="agenda-summary-card alert"><small>Emergencias</small><strong>${Number(summary.emergencias||0)}</strong><span>Prioridad de tu ruta</span></article><article class="agenda-summary-card pending"><small>Sin hora</small><strong>${Number(summary.sin_hora||0)}</strong><span>Pendientes de programación</span></article>`})():`<article class="agenda-summary-card"><small>Personal técnico</small><strong>${Number(summary.tecnicos||0)}</strong><span>Supervisor y operarios habilitados</span></article><article class="agenda-summary-card"><small>Órdenes visibles</small><strong>${Number(summary.ordenes||0)}</strong><span>${esc(agendaDateLabel(data.fecha))}</span></article><article class="agenda-summary-card live"><small>En servicio</small><strong>${Number(summary.en_servicio||0)}</strong><span>Trabajos actualmente iniciados</span></article><article class="agenda-summary-card alert"><small>Emergencias</small><strong>${Number(summary.emergencias||0)}</strong><span>Prioridad operativa inmediata</span></article><article class="agenda-summary-card pending"><small>Sin hora</small><strong>${Number(summary.sin_hora||0)}</strong><span>Asignadas pendientes de programación</span></article>`}
      </section>
      <section class="agenda-tools">
        <div class="agenda-date-nav"><button class="btn" id="agendaPrevDay" type="button" title="Día anterior"><i data-lucide="chevron-left"></i></button><button class="btn" id="agendaNextDay" type="button" title="Día siguiente"><i data-lucide="chevron-right"></i></button></div>
        <div class="agenda-tool-field"><label>Fecha</label><input id="agendaDateInput" type="date" value="${esc(data.fecha)}"></div>
        ${state.role==="COORDINADOR"?`<div class="agenda-tool-field"><label>Técnico / supervisor</label><select id="agendaTechnicianFilter"><option value="TODOS">Todos</option>${techOptions}</select></div>`:`<div class="agenda-tool-field"><label>Vista</label><select disabled><option>Mi ruta asignada</option></select></div>`}
        <label class="agenda-switch"><input id="agendaEmergencyOnly" type="checkbox" ${state.agenda.onlyEmergencies?"checked":""}><span>Solo emergencias</span></label>
        <div class="agenda-live-legend"><span class="agenda-legend-item"><i class="agenda-legend-dot live"></i>En servicio</span><span class="agenda-legend-item"><i class="agenda-legend-dot"></i>Programado</span><span class="agenda-legend-item"><i class="agenda-legend-dot emergency"></i>Emergencia</span><span class="agenda-legend-item"><i class="agenda-legend-dot queue"></i>En cola</span></div>
      </section>
      <div class="agenda-dirty-bar" id="agendaDirtyBar" ${state.agenda.dirty?"":"hidden"}><i data-lucide="circle-alert"></i><span><strong><span id="agendaDirtyCount">${state.agenda.draft.size}</span> cambio(s) sin guardar.</strong> Podés seguir moviendo bloques; nada se escribe en la base hasta pulsar Guardar planificación.</span></div>
      ${agendaMobileRoute(data)}
      <div class="agenda-planner-layout">
        <section class="agenda-board-card"><div class="agenda-board-head"><div><strong>Orden de atención por técnico</strong><small>Arrastra horizontalmente los trabajos pendientes/programados. Las órdenes ya iniciadas quedan bloqueadas.</small></div><span class="agenda-board-hint"><i data-lucide="move-horizontal"></i>${state.role==="COORDINADOR"?"Arrastra · revisa · guarda":"Vista de solo lectura"}</span></div>
          <div class="agenda-board-scroll" id="agendaBoardScroll"><div class="agenda-grid" data-start-minute="${win.start}" data-hour-width="${win.hourWidth}" style="--agenda-track-width:${trackWidth}px;--agenda-hour-width:${win.hourWidth}px;--agenda-hour-count:${hourCount}">
            <div class="agenda-corner">Técnico / cuadrilla</div><div class="agenda-hours">${hours.map(h=>`<span class="agenda-hour">${String(h).padStart(2,"0")}:00</span>`).join("")}</div>
            ${rows||`<div class="agenda-tech"></div><div class="agenda-no-data"><span><i data-lucide="calendar-x"></i></span><h3>Sin resultados</h3><p>No hay personal con órdenes para los filtros seleccionados.</p></div>`}
          </div></div>
        </section>
        <aside class="agenda-detail" id="agendaDetail">${agendaDetailHtml(selected)}</aside>
      </div>
    </div>`;
    window.lucide?.createIcons();
    agendaBindControls();agendaBindDrag();agendaBindDetailControls();
    requestAnimationFrame(()=>{
      const scroller=content.querySelector("#agendaBoardScroll");if(!scroller)return;
      const target=selected?agendaDisplayMinute(selected):(data.fecha===data.hoy?(()=>{const n=new Date(data.ahora);return n.getHours()*60+n.getMinutes();})():18*60);
      scroller.scrollLeft=Math.max(0,(target-win.start)/60*win.hourWidth-250);
    });
  }

  function agendaBindDetailControls() {
    content.querySelectorAll("[data-agenda-shift]").forEach(btn=>btn.addEventListener("click",()=>{
      const order=agendaOrder(btn.dataset.id);if(!order)return;
      const base=agendaDisplayMinute(order),delta=Number(btn.dataset.agendaShift||0);
      agendaSetDirtyMinute(order.id,base+delta);
    }));
  }

  function agendaConfirmDiscard() {
    return !state.agenda.dirty || window.confirm("Hay cambios de planificación sin guardar. ¿Deseas descartarlos?");
  }

  function agendaBindControls() {
    const dateInput=content.querySelector("#agendaDateInput");
    const changeDay=async next=>{if(!agendaConfirmDiscard())return;state.agenda.fecha=next;state.agenda.draft.clear();state.agenda.dirty=false;state.agenda.selectedOrderId=null;await renderAgendaOperativa();};
    content.querySelector("#agendaPrevDay")?.addEventListener("click",()=>changeDay(agendaDateShift(state.agenda.fecha,-1)));
    content.querySelector("#agendaNextDay")?.addEventListener("click",()=>changeDay(agendaDateShift(state.agenda.fecha,1)));
    content.querySelector("#agendaTodayButton")?.addEventListener("click",()=>changeDay(state.agenda.data?.hoy||new Date().toISOString().slice(0,10)));
    dateInput?.addEventListener("change",()=>changeDay(dateInput.value));
    content.querySelector("#agendaTechnicianFilter")?.addEventListener("change",e=>{state.agenda.technicianFilter=e.currentTarget.value||"TODOS";agendaPaint();});
    content.querySelector("#agendaEmergencyOnly")?.addEventListener("change",e=>{state.agenda.onlyEmergencies=Boolean(e.currentTarget.checked);agendaPaint();});
    content.querySelector("#agendaResetButton")?.addEventListener("click",()=>{if(!state.agenda.dirty)return;state.agenda.draft.clear();state.agenda.dirty=false;agendaPaint();showToast("Cambios visuales descartados.","info");});
    content.querySelector("#agendaSaveButton")?.addEventListener("click",async()=>{
      if(!state.agenda.dirty||!state.agenda.draft.size)return;
      const button=content.querySelector("#agendaSaveButton");button.disabled=true;
      try{
        const cambios=[...state.agenda.draft.entries()].map(([orden_id,minute])=>({orden_id,programada_para:agendaDateTimePayload(state.agenda.fecha,minute)}));
        const result=await api("/api/agenda-operativa/guardar",{method:"POST",body:{fecha:state.agenda.fecha,cambios}});
        showToast(result.message||"Planificación actualizada.");
        state.agenda.draft.clear();state.agenda.dirty=false;await renderAgendaOperativa();
      }catch(err){showToast(err.message,"error");button.disabled=false;}
    });
  }

  function agendaBindDrag() {
    if(state.role!=="COORDINADOR")return;
    const grid=content.querySelector(".agenda-grid");if(!grid)return;
    const start=Number(grid.dataset.startMinute||360),hourWidth=Number(grid.dataset.hourWidth||112);
    content.querySelectorAll('.agenda-job[data-agenda-draggable="1"]').forEach(card=>{
      card.addEventListener("pointerdown",event=>{
        if(event.button!==0)return;
        const order=agendaOrder(card.dataset.agendaOrder);if(!order)return;
        const base=agendaDisplayMinute(order),originX=event.clientX;let moved=false;
        card.setPointerCapture?.(event.pointerId);card.dataset.agendaDragging="1";
        const onMove=ev=>{
          const dx=ev.clientX-originX;if(Math.abs(dx)>3)moved=true;
          if(!moved)return;
          ev.preventDefault();
          const minute=Math.max(start,Math.min(23*60+45,base+dx/hourWidth*60));
          agendaSetDirtyMinute(order.id,minute);
        };
        const onUp=ev=>{
          card.releasePointerCapture?.(event.pointerId);card.removeAttribute("data-agenda-dragging");
          card.removeEventListener("pointermove",onMove);card.removeEventListener("pointerup",onUp);card.removeEventListener("pointercancel",onUp);
          if(moved){card.dataset.agendaWasDragged="1";setTimeout(()=>delete card.dataset.agendaWasDragged,80);}else agendaRenderDetail(order.id);
        };
        card.addEventListener("pointermove",onMove);card.addEventListener("pointerup",onUp);card.addEventListener("pointercancel",onUp);
      });
      card.addEventListener("click",()=>{if(card.dataset.agendaWasDragged)return;agendaRenderDetail(card.dataset.agendaOrder);});
    });
  }

  async function renderAgendaOperativa() {
    if(!["COORDINADOR","TECNICO"].includes(state.role))return navigate("dashboard");
    setHeading(state.role==="COORDINADOR"?"Agenda operativa":"Mi agenda","Orden visual de atención, trabajos en curso y cola operativa por horario.");
    if(!state.agenda.fecha){
      const now=new Date(),z=n=>String(n).padStart(2,"0");
      state.agenda.fecha=`${now.getFullYear()}-${z(now.getMonth()+1)}-${z(now.getDate())}`;
    }
    const data=await api(`/api/agenda-operativa?fecha=${encodeURIComponent(state.agenda.fecha)}`);
    state.agenda.data=data;state.agenda.fecha=data.fecha;
    state.agenda.draft.clear();state.agenda.dirty=false;
    const all=agendaAllOrders(data);
    if(!state.agenda.selectedOrderId||!all.has(Number(state.agenda.selectedOrderId))){
      const first=[...all.values()].sort((a,b)=>{
        const ar=String(a.estado_codigo||"").toUpperCase()==="EN_PROCESO"?0:1,br=String(b.estado_codigo||"").toUpperCase()==="EN_PROCESO"?0:1;
        if(ar!==br)return ar-br;
        return agendaDisplayMinute(a)-agendaDisplayMinute(b);
      })[0];
      state.agenda.selectedOrderId=first?Number(first.id):null;
    }
    agendaPaint();
  }

  async function renderSolicitudes() {
    const all=(await loadAllPaged("solicitudes","/api/solicitudes")).items;
    if (state.role !== "COORDINADOR") {
      setHeading("Solicitudes de servicio", state.role === "CLIENTE" ? "Crea una solicitud, adjunta imágenes y consulta su estado." : "Recepción de solicitudes programadas y emergencias.");
      const states=smartUnique(all,x=>String(x.Estado||x.estado||"").toUpperCase());
      const classes=smartUnique(all,x=>String(x.Clasificacion||x.clasificacion||"").toUpperCase());
      const urgencies=smartUnique(all,x=>String(x.urgencia||"").toUpperCase());
      const result=smartListData("solicitudes",all,{
        defaults:{orden:"creada",direccion:"DESC"},
        search:x=>[x.id,x.cliente,x.sede,x.tipo,x.descripcion,x.Estado,x.estado,x.orden_numero],
        filters:{estado:x=>String(x.Estado||x.estado||"").toUpperCase(),clase:x=>String(x.Clasificacion||x.clasificacion||"").toUpperCase(),urgencia:x=>String(x.urgencia||"").toUpperCase()},
        sort:{creada:x=>smartDateValue(x.creada),cliente:x=>x.cliente||"",estado:x=>String(x.Estado||x.estado||""),tipo:x=>x.tipo||""}
      });
      const rows=result.items.map(x => `<tr><td class="mono">#${x.id}</td><td>${esc(x.cliente)}</td><td>${esc(x.sede)}</td><td>${esc(x.tipo)}</td><td>${badge(x.Clasificacion||x.clasificacion)}</td><td>${x.urgencia?badge(x.urgencia):"—"}</td><td>${esc(x.descripcion)}</td><td>${requestStatusView(x)}</td><td>${fmt(x.creada)}</td><td>${button("Ver seguimiento","ver-solicitud",x.id,"primary")}</td></tr>`);
      content.innerHTML = `<div class="toolbar"><div class="toolbar-left"><h2>Solicitudes</h2><p class="muted">Búsqueda y filtros disponibles para ${state.role==="CLIENTE"?"tus solicitudes":"todas las solicitudes visibles"}.</p></div><div class="toolbar-right">${button("Nueva solicitud","nueva-solicitud","","primary")}</div></div><section class="panel smart-list-panel"><div class="panel-body">${smartControls("solicitudes",{placeholder:"ID, cliente, sede, servicio o descripción",filters:[{name:"estado",label:"Estado",options:states},{name:"clase",label:"Clase",options:classes},{name:"urgencia",label:"Urgencia",options:urgencies}],sorts:[["creada","Fecha"],["cliente","Cliente"],["tipo","Servicio"],["estado","Estado"]]})}${smartResultsMeta(result,"solicitudes")}</div>${table(["ID","Cliente","Sede","Tipo","Clase","Urgencia","Descripción","Seguimiento","Creada","Acción"], rows,"No hay solicitudes que coincidan con los filtros.")}${smartPager("solicitudes",result)}</section>`;
      window.lucide?.createIcons();
      return;
    }

    eyebrow.textContent = "SEPRIGUA · OPERACIÓN";
    title.textContent = "Solicitudes de servicio";
    subtitle.textContent = "Gestiona, filtra y da seguimiento a las solicitudes recibidas.";
    syncPrototypeChrome();

    const states=smartUnique(all,x=>String(x.Estado||x.estado||"").toUpperCase());
    const classes=smartUnique(all,x=>String(x.Clasificacion||x.clasificacion||"").toUpperCase());
    const urgencies=smartUnique(all,x=>String(x.urgencia||"").toUpperCase());
    const sites=smartUnique(all,x=>String(x.sede||"").trim());
    const defaults={orden:"creada",direccion:"DESC",tamano:10,filtros:{rapidos:["TODAS"]}};
    const prefs=smartPrefs("solicitudes",defaults);
    if(!prefs.filtros) prefs.filtros={};
    const selectedQuickKeys = normalizeQuickFilters(prefs.filtros.rapidos || prefs.filtros.rapido || "TODAS");
    prefs.filtros.rapidos = selectedQuickKeys;
    prefs.filtros.rapido = selectedQuickKeys[0] || "TODAS";
    const originalQuick = [...selectedQuickKeys];
    prefs.filtros.rapidos = ["TODAS"];
    prefs.filtros.rapido = "TODAS";
    const baseResult=smartListData("solicitudes",all,{
      defaults,
      search:x=>[x.id,x.cliente,x.sede,x.tipo,x.descripcion,x.Estado,x.estado,x.orden_numero],
      filters:{
        estado:x=>String(x.Estado||x.estado||"").toUpperCase(),
        clase:x=>String(x.Clasificacion||x.clasificacion||"").toUpperCase(),
        urgencia:x=>String(x.urgencia||"").toUpperCase(),
        sede:x=>String(x.sede||"")
      },
      sort:{creada:x=>smartDateValue(x.creada),cliente:x=>x.cliente||"",tipo:x=>x.tipo||"",estado:x=>requestStateValue(x),urgencia:x=>requestUrgencyValue(x),sede:x=>x.sede||""}
    });
    prefs.filtros.rapidos = originalQuick;
    prefs.filtros.rapido = originalQuick[0] || "TODAS";
    let filtered = [...baseResult.filtered];
    const quickFiltersToApply = originalQuick.filter(key => key && key !== "TODAS");
    if (quickFiltersToApply.length) filtered = filtered.filter(item => quickFiltersToApply.some(key => requestQuickMatches(item, key)));
    const size = Math.max(5, Number(prefs.tamano || 10));
    const total = filtered.length;
    const pages = Math.max(1, Math.ceil(total / size));
    prefs.pagina = Math.min(Math.max(1, Number(prefs.pagina || 1)), pages);
    const start = (prefs.pagina - 1) * size;
    const result = { items: filtered.slice(start, start + size), filtered, total, pagina: prefs.pagina, tamano: size, paginas: pages };

    const quicks=requestQuickDefinitions(all);
    const activeQuickSet = new Set(normalizeQuickFilters(prefs.filtros.rapidos || prefs.filtros.rapido || "TODAS"));
    const quickMarkup=quicks.length>1?`<div class="request-quick-row"><span class="request-quick-label">Filtros rápidos:</span><div class="request-quick-filters">${quicks.map(item=>`<button class="request-quick-pill ${activeQuickSet.has(item.key)?"active":""} ${item.tone}" type="button" data-action="request-quick-filter" data-list-key="solicitudes" data-value="${esc(item.key)}"><span>${esc(item.label)}</span>${item.count?`<strong>${item.count}</strong>`:""}</button>`).join("")}</div><span class="request-quick-hint">Puedes elegir uno o varios.</span></div>`:"";
    const activeFiltersMarkup=requestActiveFilterChips(prefs);

    const rows=result.items.map(x => `
      <tr>
        <td class="mono request-id-cell">#${esc(x.id)}</td>
        <td>${requestDateMarkup(x.creada)}</td>
        <td><div class="request-client-cell">${renderAvatarIdentity(x.cliente || "Sin cliente",{entity:x,subtitle:x.sede || "Sin sede"})}</div></td>
        <td><div class="request-description-cell" title="${esc(requestDescriptionPreview(x.descripcion))}">${esc(requestDescriptionPreview(x.descripcion))}</div></td>
        <td><div class="request-service-cell">${esc(x.tipo || "—")}</div></td>
        <td>${requestClassBadge(x.Clasificacion || x.clasificacion)}</td>
        <td>${x.urgencia ? requestUrgencyBadge(x.urgencia) : `<span class="request-empty-pill">No aplica</span>`}</td>
        <td>${requestStateBadge(x)}</td>
        <td>${requestFollowupMarkup(x)}</td>
        <td><button class="request-follow-button" type="button" data-action="ver-solicitud" data-id="${esc(x.id)}"><i data-lucide="eye"></i><span>Ver seguimiento</span></button></td>
      </tr>`);

    const filtersPanel = `
      <section class="solicitudes-filter-panel">
        <div class="solicitudes-filter-grid">
          <div class="solicitudes-filter-field solicitudes-search-field">
            <label>Buscar</label>
            <div class="input-with-icon solicitudes-search-input">
              <i data-lucide="search"></i>
              <input type="search" data-smart-q="solicitudes" value="${esc(prefs.q || "")}" placeholder="Buscar por solicitud, cliente, sede o responsable..." autocomplete="off">
            </div>
          </div>
          <div class="solicitudes-filter-field"><label>Estado</label><select data-smart-filter="estado" data-smart-key="solicitudes">${smartOptions(states, prefs.filtros?.estado, "Todos")}</select></div>
          <div class="solicitudes-filter-field"><label>Clase</label><select data-smart-filter="clase" data-smart-key="solicitudes">${smartOptions(classes, prefs.filtros?.clase, "Todos")}</select></div>
          <div class="solicitudes-filter-field"><label>Urgencia</label><select data-smart-filter="urgencia" data-smart-key="solicitudes">${smartOptions(urgencies, prefs.filtros?.urgencia, "Todos")}</select></div>
          <div class="solicitudes-filter-field"><label>Sede</label><select data-smart-filter="sede" data-smart-key="solicitudes">${smartOptions(sites, prefs.filtros?.sede, "Todas")}</select></div>
          <div class="solicitudes-filter-field solicitudes-filter-clear"><label>&nbsp;</label><button class="request-clear-button" type="button" data-action="smart-reset" data-list-key="solicitudes"><i data-lucide="rotate-ccw"></i><span>Limpiar</span></button></div>
        </div>
        ${(quickMarkup || activeFiltersMarkup) ? `<div class="solicitudes-filter-extras">${quickMarkup}${activeFiltersMarkup}</div>` : ""}
      </section>`;

    const tableToolbar = `
      <div class="solicitudes-table-toolbar">
        <div class="solicitudes-table-title"><strong>Solicitudes</strong><span>${normalizeNumber(result.total)} resultado${Number(result.total)===1?"":"s"}</span></div>
        <div class="solicitudes-table-controls">
          <div class="solicitudes-filter-field toolbar-field"><label>Ordenar por</label><select data-smart-sort data-smart-key="solicitudes"><option value="creada" ${String(prefs.orden)==="creada"?"selected":""}>Más recientes</option><option value="cliente" ${String(prefs.orden)==="cliente"?"selected":""}>Cliente</option><option value="tipo" ${String(prefs.orden)==="tipo"?"selected":""}>Servicio</option><option value="estado" ${String(prefs.orden)==="estado"?"selected":""}>Estado</option><option value="urgencia" ${String(prefs.orden)==="urgencia"?"selected":""}>Urgencia</option></select></div>
          <div class="solicitudes-filter-field toolbar-field"><label>Dirección</label><select data-smart-direction data-smart-key="solicitudes"><option value="DESC" ${String(prefs.direccion||"DESC")==="DESC"?"selected":""}>Descendente</option><option value="ASC" ${String(prefs.direccion||"DESC")==="ASC"?"selected":""}>Ascendente</option></select></div>
          <div class="solicitudes-filter-field toolbar-field solicitudes-size-field"><label>Mostrar</label><select data-smart-size data-smart-key="solicitudes">${[10,20,50].map(n=>`<option value="${n}" ${Number(prefs.tamano||10)===n?"selected":""}>${n} por página</option>`).join("")}</select></div>
        </div>
      </div>`;

    const empty = "No hay solicitudes que coincidan con los filtros seleccionados.";
    const tableHtml = table(["No. solicitud","Fecha y hora","Cliente / Sede","Descripción","Tipo de servicio","Clase","Urgencia","Estado","Seguimiento","Acciones"], rows, empty);

    content.innerHTML = `
      <section class="solicitudes-workspace">
        <section class="solicitudes-sheet">
          <div class="solicitudes-hero">
            <div class="solicitudes-hero-copy">
              <span class="solicitudes-eyebrow">SEPRIGUA · OPERACIÓN</span>
              <h2>Solicitudes de servicio</h2>
              <p>Gestiona, filtra y da seguimiento a las solicitudes recibidas.</p>
              <div class="solicitudes-update-line"><span class="solicitudes-update-dot"></span><span>Última actualización: ${esc(formatGTTime(new Date()))}</span></div>
            </div>
            <div class="solicitudes-hero-actions">
              <button class="request-primary-button" type="button" data-action="nueva-solicitud"><i data-lucide="plus"></i><span>Nueva solicitud</span></button>
            </div>
          </div>
          ${filtersPanel}
          <section class="solicitudes-table-panel">
            ${tableToolbar}
            ${tableHtml}
            ${requestPager("solicitudes", result)}
          </section>
        </section>
      </section>`;
    window.lucide?.createIcons();
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

  function techQueueRank(x) {
    const code=String(x.estado_codigo||x.estado||"").toUpperCase();
    if(code==="EN_PROCESO") return 0;
    if(["COMPLETADA","CANCELADA"].includes(code)) return 9e15 + smartDateValue(x.finalizada||x.creada);
    const emergency=String(x.clasificacion||"").toUpperCase()==="EMERGENCIA" ? 0 : 1;
    const p={CRITICA:0,ALTA:1,MEDIA:2,BAJA:3}[String(x.Prioridad||x.prioridad||"").toUpperCase()] ?? 4;
    const when=smartDateValue(x.programada||x.asignado_en||x.creada)||Date.now();
    return 1e12 + emergency*1e11 + p*1e10 + Math.min(Math.floor(when/1000),9e9);
  }

  function technicianQueuePositions(items) {
    const open=(items||[]).filter(x=>!["COMPLETADA","CANCELADA"].includes(String(x.estado_codigo||"").toUpperCase()));
    open.sort((a,b)=>techQueueRank(a)-techQueueRank(b));
    const positions=new Map(); let pending=0;
    open.forEach(x=>{
      const code=String(x.estado_codigo||"").toUpperCase();
      if(code==="EN_PROCESO") positions.set(String(x.id),{label:"EN SERVICIO",position:0});
      else { pending+=1; positions.set(String(x.id),{label:pending===1?"SIGUIENTE":`EN COLA #${pending}`,position:pending}); }
    });
    return positions;
  }

  async function renderOrdenes() {
    setHeading(state.role === "TECNICO" ? "Mis órdenes" : state.role === "CLIENTE" ? "Mis servicios" : "Órdenes de trabajo", "Flujo real de solicitud → coordinación → ejecución → cierre, usando los estados configurados en el sistema.");
    const all=(await loadAllPaged("ordenes","/api/ordenes")).items;

    if (state.role !== "COORDINADOR") {
      const states=smartUnique(all,x=>String(x.estado||"").toUpperCase());
      const priorities=smartUnique(all,x=>String(x.Prioridad||x.prioridad||"").toUpperCase());
      const services=smartUnique(all,x=>x.tipo||"");
      const queuePositions=state.role==="TECNICO"?technicianQueuePositions(all):new Map();
      const result=smartListData("ordenes",all,{
        defaults:{orden:state.role==="TECNICO"?"cola":"programada",direccion:state.role==="TECNICO"?"ASC":"DESC"},
        search:x=>[x.numero,x.cliente,x.sede,x.tipo,x.estado,x.Prioridad,x.prioridad,x.clasificacion],
        filters:{estado:x=>String(x.estado||"").toUpperCase(),prioridad:x=>String(x.Prioridad||x.prioridad||"").toUpperCase(),servicio:x=>String(x.tipo||"")},
        sort:{cola:x=>techQueueRank(x),programada:x=>smartDateValue(x.programada||x.creada),numero:x=>x.numero||"",cliente:x=>x.cliente||"",estado:x=>x.estado||"",prioridad:x=>x.Prioridad||x.prioridad||""}
      });
      const rows=result.items.map(x => {const q=queuePositions.get(String(x.id));const qlabel=state.role==="TECNICO"&&q?`<div class="muted" style="margin-top:.25rem;font-size:.72rem;font-weight:800">${esc(q.label)}${String(x.clasificacion||"").toUpperCase()==="EMERGENCIA"?" · EMERGENCIA":""}</div>`:"";return `<tr><td class="mono">${esc(x.numero)}</td><td>${esc(x.cliente)}</td><td>${esc(x.sede)}</td><td>${esc(x.tipo)}</td><td>${badge(x.estado)}${qlabel}</td><td>${badge(x.Prioridad||x.prioridad)}</td><td>${fmt(x.programada)}</td><td>${button("Ver","ver-orden",x.id,"primary")}</td></tr>`;});
      content.innerHTML = `<div class="toolbar"><div class="toolbar-left"><h2>${state.role==="TECNICO"?"Mis órdenes":"Mis servicios"}</h2><p class="muted">Filtra por estado, prioridad o servicio sin recargar la página.</p></div></div><section class="panel smart-list-panel"><div class="panel-body">${smartControls("ordenes",{placeholder:"Orden, cliente, sede o servicio",filters:[{name:"estado",label:"Estado",options:states},{name:"prioridad",label:"Prioridad",options:priorities},{name:"servicio",label:"Servicio",options:services}],sorts:[...(state.role==="TECNICO"?[["cola","Cola operativa"]]:[]),["programada","Fecha / programación"],["numero","Número de OT"],["cliente","Cliente"],["estado","Estado"],["prioridad","Prioridad"]]})}${smartResultsMeta(result,"órdenes")}</div>${table(["Orden","Cliente","Sede","Servicio","Estado","Prioridad","Atención aproximada","Acción"],rows,"No hay órdenes que coincidan con los filtros.")}${smartPager("ordenes",result)}</section>`;
      window.lucide?.createIcons();
      return;
    }

    const details = await loadOrderListDetails(all);
    const defaults = {
      orden:"fecha", direccion:"DESC", tamano:20,
      filtros:{ estado:"TODOS", prioridad:"TODOS", tecnico:"TODOS", fecha:"TODAS", rapidos:["TODAS"] },
      densidad:"COMODA", fechaDesde:"", fechaHasta:"",
      columnas:{ supervisor:false, programada:false, cotizacion:false }
    };
    const prefs = smartPrefs("ordenes", defaults);
    prefs.filtros = Object.assign({}, defaults.filtros, prefs.filtros || {});
    prefs.filtros.rapidos = normalizeOrderQuickFilters(prefs.filtros.rapidos || "TODAS");
    prefs.densidad = prefs.densidad || "COMODA";
    prefs.columnas = Object.assign({}, defaults.columnas, prefs.columnas || {});

    const states = smartUnique(all, x => orderStateKey(x.estado)).map(v => [v, requestDisplayText(v)]);
    const priorities = [["CRITICA","Crítica"],["ALTA","Alta"],["MEDIA","Media"],["BAJA","Baja"]].filter(([value]) => all.some(x => orderPriorityKey(x.Prioridad||x.prioridad)===value));
    const technicianNames = smartUnique(all.flatMap(item => orderCrewRows(details.get(String(item.id))).map(t => t.nombre)).filter(Boolean), x => x);

    let prepared = all.filter(item => {
      const detail = details.get(String(item.id));
      const techFilter = String(prefs.filtros.tecnico || "TODOS");
      if (techFilter && techFilter !== "TODOS") {
        const crew = orderCrewRows(detail);
        if (techFilter === "SIN_ASIGNAR") {
          if (detail?._loadError || crew.length) return false;
        } else if (!crew.some(t => String(t.nombre || "").toUpperCase() === techFilter.toUpperCase())) return false;
      }
      if (!orderDateFilterMatches(item, prefs.filtros.fecha, prefs)) return false;
      const quicks = normalizeOrderQuickFilters(prefs.filtros.rapidos).filter(v => v !== "TODAS");
      if (quicks.length && !quicks.some(key => orderQuickMatches(item, detail, key))) return false;
      return true;
    });

    const priorityRank = {CRITICA:4,ALTA:3,MEDIA:2,BAJA:1,SIN_PRIORIDAD:0};
    const stateRank = {EN_PROCESO:4,PROGRAMADA:3,SIN_ESTADO:2,FINALIZADA:1,CANCELADA:0};
    const result = smartListData("ordenes", prepared, {
      defaults,
      search:item => {
        const detail = details.get(String(item.id));
        return [item.numero,item.cliente,item.sede,item.tipo,item.estado,item.Prioridad,item.prioridad,...orderCrewRows(detail).map(t=>t.nombre)];
      },
      filters:{
        estado:item=>orderStateKey(item.estado),
        prioridad:item=>orderPriorityKey(item.Prioridad||item.prioridad)
      },
      sort:{
        fecha:item=>smartDateValue(orderDateForList(item)),
        prioridad:item=>priorityRank[orderPriorityKey(item.Prioridad||item.prioridad)]||0,
        estado:item=>stateRank[orderStateKey(item.estado)]||0,
        numero:item=>item.numero||"",
        cliente:item=>item.cliente||""
      }
    });

    const quickDefs = [
      ["TODAS","Todas","all"],
      ["EN_PROCESO","En proceso","process"],
      ["SIN_ASIGNAR","Sin asignar","unassigned"],
      ["CRITICAS","Críticas","critical"],
      ["FINALIZADAS","Finalizadas","finalized"],
      ["HOY","Hoy","today"]
    ].map(([key,label,tone]) => ({key,label,tone,count:key==="TODAS"?all.length:all.filter(item=>orderQuickMatches(item,details.get(String(item.id)),key)).length}))
      .filter(def => def.key === "TODAS" || def.count > 0);
    const selectedQuick = new Set(normalizeOrderQuickFilters(prefs.filtros.rapidos));
    const quickMarkup = quickDefs.map(def => `<button class="order-quick-pill ${def.tone} ${selectedQuick.has(def.key)?"active":""}" type="button" data-action="order-quick-filter" data-value="${esc(def.key)}"><span>${esc(def.label)}</span><strong>${def.count}</strong></button>`).join("");

    const criticalUnassigned = all.filter(item => {
      const detail = details.get(String(item.id));
      return orderPriorityKey(item.Prioridad||item.prioridad)==="CRITICA" && !detail?._loadError && orderCrewRows(detail).length===0 && !["FINALIZADA","CANCELADA"].includes(orderStateKey(item.estado));
    });

    const optionalHeaders = [];
    if (prefs.columnas.supervisor) optionalHeaders.push(["Supervisor","supervisor"]);
    if (prefs.columnas.programada) optionalHeaders.push(["Atención programada","programada"]);
    if (prefs.columnas.cotizacion) optionalHeaders.push(["Cotización relacionada","cotizacion"]);

    const rows = result.items.map(item => {
      const detail = details.get(String(item.id));
      const clientName = String(item.cliente || "Sin cliente").trim() || "Sin cliente";
      const clientIdentity = renderAvatarIdentity(clientName, { entity:item, className:"order-client-identity" });
      const extraCells = optionalHeaders.map(([,key]) => {
        if (key === "supervisor") return `<td>${orderSupervisorCell(detail)}</td>`;
        if (key === "programada") return `<td>${orderDateMarkup(item.programada)}</td>`;
        if (key === "cotizacion") return `<td>${orderQuoteCell(detail)}</td>`;
        return `<td>—</td>`;
      }).join("");
      return `<tr>
        <td class="order-number-cell mono">${esc(item.numero || `OT-${item.id}`)}</td>
        <td>${orderDateMarkup(orderDateForList(item))}</td>
        <td class="order-client-cell">${clientIdentity}</td>
        <td class="order-site-cell">${esc(item.sede || "Sin sede")}</td>
        <td class="order-service-cell"><span>${esc(item.tipo || "Sin servicio")}</span></td>
        <td>${orderCrewCell(detail)}</td>
        <td>${orderStatePill(item.estado)}</td>
        <td>${orderPriorityPill(item.Prioridad || item.prioridad)}</td>
        ${extraCells}
        <td class="order-action-cell"><button class="order-view-button" type="button" data-action="ver-orden" data-id="${esc(item.id)}"><i data-lucide="eye"></i><span>Ver detalle</span></button></td>
      </tr>`;
    }).join("");

    const tableHeaders = ["Orden","Fecha","Cliente","Sede","Servicio","Técnico asignado","Estado","Prioridad",...optionalHeaders.map(([label])=>label),"Acción"];
    const tableMarkup = result.total ? `<div class="order-table-scroll"><table class="order-table ${prefs.densidad === "COMPACTA" ? "is-compact" : "is-comfortable"}"><thead><tr>${tableHeaders.map((label,index)=>`<th class="${index===0?"order-sticky-first":""}">${esc(label)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="order-empty-state"><span class="order-empty-icon"><i data-lucide="clipboard-list"></i></span><h3>No encontramos órdenes con estos filtros.</h3><p>Prueba cambiando Estado, Técnico, Prioridad o Fecha.</p><button class="order-clear-button" type="button" data-action="smart-reset" data-list-key="ordenes"><i data-lucide="rotate-ccw"></i><span>Limpiar filtros</span></button></div>`;

    const customDateMarkup = String(prefs.filtros.fecha||"").toUpperCase()==="PERSONALIZADO" ? `<div class="order-custom-date-row"><label><span>Desde</span><input type="date" data-order-date-from value="${esc(prefs.fechaDesde||"")}"></label><label><span>Hasta</span><input type="date" data-order-date-to value="${esc(prefs.fechaHasta||"")}"></label></div>` : "";
    const technicianOptions = [["TODOS","Todos"],["SIN_ASIGNAR","Sin asignar"],...technicianNames.map(name=>[name,name])];
    const dateOptions = [["TODAS","Todas las fechas"],["HOY","Hoy"],["SEMANA","Esta semana"],["MES","Este mes"],["PERSONALIZADO","Personalizado"]];

    content.innerHTML = `<section class="orders-workspace">
      <header class="orders-page-header">
        <div class="orders-page-copy"><span class="orders-eyebrow">SEPRIGUA · OPERACIÓN</span><h2>Órdenes de trabajo</h2><p>Consulta, asigna y supervisa las órdenes activas de la operación.</p></div>
        <button class="orders-create-button" type="button" data-action="nueva-orden"><i data-lucide="plus"></i><span>Crear OT</span></button>
      </header>

      <section class="orders-filters" aria-label="Filtros de órdenes">
        <div class="orders-filter-grid">
          <label class="orders-filter-field orders-search-field"><span>Buscar</span><div class="orders-search-control"><i data-lucide="search"></i><input type="search" data-smart-q="ordenes" value="${esc(prefs.q||"")}" placeholder="Buscar por orden, cliente, sede o servicio..." autocomplete="off"></div></label>
          <label class="orders-filter-field"><span>Estado</span><select data-smart-filter="estado" data-smart-key="ordenes">${smartOptions(states,prefs.filtros.estado,"Todos")}</select></label>
          <label class="orders-filter-field"><span>Prioridad</span><select data-smart-filter="prioridad" data-smart-key="ordenes">${smartOptions(priorities,prefs.filtros.prioridad,"Todas")}</select></label>
          <label class="orders-filter-field"><span>Técnico</span><select data-smart-filter="tecnico" data-smart-key="ordenes">${technicianOptions.map(([value,label])=>`<option value="${esc(value)}" ${String(prefs.filtros.tecnico||"TODOS")===String(value)?"selected":""}>${esc(label)}</option>`).join("")}</select></label>
          <label class="orders-filter-field"><span>Fecha</span><select data-smart-filter="fecha" data-smart-key="ordenes">${dateOptions.map(([value,label])=>`<option value="${value}" ${String(prefs.filtros.fecha||"TODAS")===value?"selected":""}>${label}</option>`).join("")}</select></label>
          <div class="orders-filter-clear-wrap"><span>&nbsp;</span><button class="order-clear-button" type="button" data-action="smart-reset" data-list-key="ordenes"><i data-lucide="rotate-ccw"></i><span>Limpiar filtros</span></button></div>
        </div>
        ${customDateMarkup}
        <div class="orders-quick-row"><span class="orders-quick-label">Filtros rápidos:</span><div class="orders-quick-list">${quickMarkup}</div><span class="orders-quick-hint">Puedes combinar varios.</span></div>
        ${[...selectedQuick].filter(value=>value!=="TODAS").length?`<div class="orders-active-quick"><span>${[...selectedQuick].filter(value=>value!=="TODAS").length} filtro${[...selectedQuick].filter(value=>value!=="TODAS").length===1?"":"s"} activo${[...selectedQuick].filter(value=>value!=="TODAS").length===1?"":"s"}</span><div>${[...selectedQuick].filter(value=>value!=="TODAS").map(value=>{const def=quickDefs.find(item=>item.key===value);return `<button type="button" class="smart-quick-active" data-action="order-quick-filter" data-value="${esc(value)}"><span>${esc(def?.label||value)}</span><i data-lucide="x"></i></button>`}).join("")}</div></div>`:""}
      </section>

      ${criticalUnassigned.length ? `<div class="orders-alert" role="status"><span class="orders-alert-icon"><i data-lucide="triangle-alert"></i></span><strong>${criticalUnassigned.length} orden${criticalUnassigned.length===1?" crítica está":"es críticas están"} sin técnico asignado.</strong><button type="button" data-action="order-critical-unassigned">Ver órdenes <i data-lucide="arrow-right"></i></button></div>` : ""}

      <section class="orders-list-section">
        <div class="orders-list-toolbar">
          <div class="orders-list-title"><i data-lucide="clipboard-list"></i><div><strong>Órdenes</strong><span>${result.total} resultado${result.total===1?"":"s"}</span></div></div>
          <div class="orders-list-options">
            <label><span>Ordenar por</span><select data-smart-sort data-smart-key="ordenes"><option value="fecha" ${prefs.orden==="fecha"?"selected":""}>Fecha</option><option value="prioridad" ${prefs.orden==="prioridad"?"selected":""}>Prioridad</option><option value="estado" ${prefs.orden==="estado"?"selected":""}>Estado</option><option value="numero" ${prefs.orden==="numero"?"selected":""}>Orden</option><option value="cliente" ${prefs.orden==="cliente"?"selected":""}>Cliente</option></select></label>
            <label><span>Dirección</span><select data-smart-direction data-smart-key="ordenes"><option value="DESC" ${prefs.direccion==="DESC"?"selected":""}>Descendente</option><option value="ASC" ${prefs.direccion==="ASC"?"selected":""}>Ascendente</option></select></label>
            <label><span>Vista</span><select data-order-density><option value="COMODA" ${prefs.densidad==="COMODA"?"selected":""}>Cómoda</option><option value="COMPACTA" ${prefs.densidad==="COMPACTA"?"selected":""}>Compacta</option></select></label>
            <details class="order-columns-menu"><summary class="order-columns-trigger"><span class="order-columns-trigger-icon"><i data-lucide="columns-3"></i></span><span>Columnas</span><i class="order-columns-chevron" data-lucide="chevron-down"></i></summary><div class="order-columns-popover"><div class="order-columns-popover-head"><span class="order-columns-popover-icon"><i data-lucide="layout-panel-top"></i></span><div><strong>Personalizar tabla</strong><small>Elige la información adicional que quieres ver.</small></div></div><div class="order-columns-options"><label class="order-column-option"><span class="order-column-copy"><span class="order-column-icon"><i data-lucide="user-round-check"></i></span><span><strong>Supervisor</strong><small>Responsable que coordina la OT.</small></span></span><span class="se-switch"><input type="checkbox" data-order-column="supervisor" ${prefs.columnas.supervisor?"checked":""}><span class="se-switch-ui" aria-hidden="true"></span></span></label><label class="order-column-option"><span class="order-column-copy"><span class="order-column-icon"><i data-lucide="calendar-clock"></i></span><span><strong>Atención programada</strong><small>Fecha y hora estimada de atención.</small></span></span><span class="se-switch"><input type="checkbox" data-order-column="programada" ${prefs.columnas.programada?"checked":""}><span class="se-switch-ui" aria-hidden="true"></span></span></label><label class="order-column-option"><span class="order-column-copy"><span class="order-column-icon"><i data-lucide="file-text"></i></span><span><strong>Cotización relacionada</strong><small>Documento vinculado a la orden.</small></span></span><span class="se-switch"><input type="checkbox" data-order-column="cotizacion" ${prefs.columnas.cotizacion?"checked":""}><span class="se-switch-ui" aria-hidden="true"></span></span></label></div><div class="order-columns-note"><i data-lucide="lock-keyhole"></i><span>Las columnas esenciales permanecen siempre visibles.</span></div></div></details>
          </div>
        </div>
        ${tableMarkup}
        ${orderPager(result)}
      </section>
    </section>`;
    window.lucide?.createIcons();
  }


  async function orderForm(preselectedSolicitud = "") {
    const req = await loadAllPaged("solicitudes","/api/solicitudes");
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
    const freshCatalogs=await api("/api/catalogos");
    state.catalogs={...state.catalogs,...freshCatalogs};
    const technicians=state.catalogs.tecnicos||[];
    const techMeta=(t,checked=false)=>{const activeHere=Number(t.orden_activa_id||0)===Number(id);const busy=String(t.estado_operativo||"").toUpperCase()==="EN_SERVICIO"&&!activeHere;let queued=Number(t.cola_cantidad||0);if(checked&&!activeHere)queued=Math.max(0,queued-1);const parts=[];if(activeHere)parts.push("EN ESTA OT");else if(busy&&t.orden_activa_numero)parts.push(`EN SERVICIO · ${t.orden_activa_numero}`);else if(queued>0)parts.push("CON TRABAJOS ASIGNADOS");else parts.push(String(t.disponibilidad||"DISPONIBLE").replaceAll("_"," "));if(queued>0)parts.push(`${queued} en cola`);if(t.siguiente_orden_numero&&Number(t.siguiente_orden_id||0)!==Number(id))parts.push(`siguiente: ${t.siguiente_orden_numero}${String(t.siguiente_clasificacion||"").toUpperCase()==="EMERGENCIA"?" (EMERGENCIA)":""}`);return parts.join(" · ");};
    openModal(created?"Asignar cuadrilla de la nueva OT":"Gestionar cuadrilla",`<form id="crewForm" class="form-grid">
      <div class="field full"><p class="muted">Puedes asignar varios integrantes de campo. Debe existir exactamente un ENCARGADO. Si una persona ya está atendiendo otra OT, esta nueva asignación queda en su cola; no podrá iniciar dos servicios al mismo tiempo. Las emergencias se priorizan como siguiente trabajo.</p></div>
      <div class="field full"><div class="timeline">${technicians.map(t=>{const fn=assigned.get(String(t.id))||"TECNICO";const checked=assigned.has(String(t.id));const unavailable=["VACACIONES","INACTIVO","NO_DISPONIBLE"].includes(String(t.disponibilidad||"").toUpperCase());return `<div class="timeline-item"><label style="display:flex;gap:.7rem;align-items:center"><input type="checkbox" class="crew-check" value="${esc(t.id)}" ${checked?"checked":""} ${unavailable&&!checked?"disabled":""}><span style="flex:1"><strong>${esc(t.nombre)}</strong><small class="muted" style="display:block;margin-top:.2rem">${esc(t.puesto||"Personal de campo")} · ${esc(techMeta(t,checked))}</small></span>${badge(t.estado_operativo||t.disponibilidad)}</label><select class="inline-select crew-function" data-id="${esc(t.id)}" ${checked?"":"disabled"}><option ${fn==="ENCARGADO"?"selected":""}>ENCARGADO</option><option ${fn==="TECNICO"?"selected":""}>TECNICO</option><option ${fn==="APOYO"?"selected":""}>APOYO</option></select></div>`}).join("")}</div></div>
      <div class="field full"><div class="form-actions"><button class="btn" type="button" data-action="ver-orden" data-id="${id}">Volver a la OT</button><button class="btn primary" type="submit">Guardar cuadrilla</button></div></div>
    </form>`);
    $$(".crew-check").forEach(ch=>ch.addEventListener("change",()=>{const sel=$(`.crew-function[data-id="${CSS.escape(ch.value)}"]`);sel.disabled=!ch.checked;}));
    $("#crewForm").addEventListener("submit",async e=>{
      e.preventDefault();
      const integrantes=$$(".crew-check:checked").map(ch=>({empleado_id:Number(ch.value),funcion:$(`.crew-function[data-id="${CSS.escape(ch.value)}"]`).value}));
      if(!integrantes.length)return showToast("Selecciona al menos un integrante.","error");
      if(integrantes.filter(x=>x.funcion==="ENCARGADO").length!==1)return showToast("Debes dejar exactamente un ENCARGADO.","error");
      try{const result=await api(`/api/ordenes/${id}/cuadrilla`,{method:"PUT",body:{integrantes}});const queued=integrantes.filter(x=>{const t=technicians.find(v=>Number(v.id)===Number(x.empleado_id));if(!t)return false;const wasAlready=assigned.has(String(x.empleado_id));const busyElsewhere=String(t.estado_operativo||"").toUpperCase()==="EN_SERVICIO"&&Number(t.orden_activa_id||0)!==Number(id);const otherQueue=Math.max(0,Number(t.cola_cantidad||0)-(wasAlready?1:0));return busyElsewhere||otherQueue>0;}).length;showToast(queued?`Cuadrilla actualizada. ${queued} integrante(s) tienen trabajo en cola.`:(result.message||"Cuadrilla actualizada."));state.listCache.ordenes=null;await openOrder(id);}catch(err){showToast(err.message,"error");}
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


  function orderStepButton(id,key,number,label,done,active){
    return `<button class="order-step ${done?"done":""} ${active===key?"active":""}" type="button" data-action="orden-paso" data-id="${esc(id)}" data-step="${esc(key)}"><span class="order-step-number">${done?"✓":number}</span><span><strong>${esc(label)}</strong><small>${done?"Listo":"Pendiente"}</small></span></button>`;
  }

  function orderStepper(id,active,d,x){
    const p=d.progress||{},code=String(x.estado_codigo||"").toUpperCase();
    const hasPaperNumber=!!String(x.orden_papel||"").trim(), hasPaperFile=normalizeNumber(p.documentos_ot)>0;
    const physicalPaperUsed=hasPaperNumber||hasPaperFile;
    const step1=!!String(x.ticket||"").trim() && (!physicalPaperUsed || (hasPaperNumber && hasPaperFile));
    const minPhotos=Math.max(0,normalizeNumber(d.reglas_cierre?.min_fotos ?? 1));
    const step2=normalizeNumber(p.fotos_trabajo)>=minPhotos;
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
    const fromAgenda=state.current==="agenda";
    return `<div class="toolbar order-workspace-toolbar"><div class="toolbar-left"><button class="btn" type="button" data-action="${fromAgenda?"volver-agenda":"volver-ordenes"}">← ${fromAgenda?"Volver a agenda":"Volver a órdenes"}</button><span class="badge">${esc(x.numero)}</span>${badge(x.estado)}</div><div class="toolbar-right">${button("Resumen","orden-paso",id,"primary")}</div></div>`;
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
      const minPhotos=Math.max(0,normalizeNumber(d.reglas_cierre?.min_fotos ?? 1));
      content.innerHTML=`${shellStart}<section class="panel order-screen"><div class="panel-header"><div><span class="eyebrow">PASO 2 DE 4</span><h2>Subir evidencia del servicio</h2></div><span class="badge ${photos>=minPhotos?"green":"orange"}">${photos}/${minPhotos} foto${minPhotos===1?"":"s"}</span></div><div class="panel-body">
        <p class="muted">Carga las fotografías que demuestran el trabajo realizado.${minPhotos>0?` El cierre técnico requiere al menos ${minPhotos} foto${minPhotos===1?"":"s"}.`:""}</p>
        <form id="orderEvidenceForm" class="form-grid">
          <div class="field full"><label>Fotografías</label><input type="file" name="archivos" multiple accept="image/*" required></div>
          <div class="field"><label>Etapa</label><select name="etapa"><option selected>DURANTE</option><option>DESPUES</option></select></div>
          <div class="field full"><label>Descripción <small>(opcional)</small></label><textarea name="descripcion" placeholder="Describe lo que muestran las fotografías."></textarea></div>
          <div class="field full"><div class="form-actions"><button class="btn" type="button" data-action="orden-paso" data-id="${esc(id)}" data-step="documento">Anterior</button><button class="btn primary" type="submit">Subir y continuar</button></div></div>
        </form>
        <h3 class="section-title">Evidencia cargada</h3><div class="evidence-grid">${workEvidence.map(evidenceCard).join("")||`<div class="muted">Todavía no hay fotografías del trabajo.</div>`}</div>
        ${workEvidence.length?`<div class="notice-card" style="margin-top:18px"><strong>Collage automático disponible</strong><p>SEPRIGUA organiza las fotografías incluidas en la OT por etapa (Antes, Durante y Después) y genera una sola imagen lista para entregar.</p><div class="actions"><a class="btn" href="/api/ordenes/${esc(id)}/collage.jpg" target="_blank" rel="noopener"><i data-lucide="images"></i> Ver collage</a><a class="btn primary" href="/api/ordenes/${esc(id)}/collage.jpg?download=1" download><i data-lucide="download"></i> Descargar collage</a></div></div>`:""}
      </div></section>${shellEnd}`;
      $("#orderEvidenceForm")?.addEventListener("submit",async e=>{e.preventDefault();const form=e.currentTarget,fd=new FormData(form),files=form.querySelector('[name="archivos"]').files;try{await uploadOrderFiles(id,files,{etapa:fd.get("etapa")||"DURANTE",categoria:"FOTO_TRABAJO",descripcion:fd.get("descripcion")||""});showToast(`${files.length} fotografía(s) guardada(s).`);await openOrder(id,"descripcion",true);}catch(err){showToast(err.message,"error");}});
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
      const minPhotos=Math.max(0,normalizeNumber(d.reglas_cierre?.min_fotos ?? 1));
      const checks=[
        [!!String(x.ticket||"").trim(),"Ticket registrado"],
        [paperReady,physicalPaperUsed?`Respaldo físico completo${isCoralsa?" (firma y sello cuando aplique)":""}`:"Hoja física no requerida"],
        [photos>=minPhotos,`Evidencia fotográfica (${photos}/${minPhotos})`],
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
    const opActions=(coord||tech)?`<section class="panel"><div class="panel-header"><h2>Acciones de la OT</h2></div><div class="panel-body"><div class="actions">${stateControl}${startButton}${coord?button("Editar datos","editar-orden",id):""}${coord?button("Gestionar cuadrilla","asignar-tecnico",id):""}${coord?button("Asignar equipo","asignar-equipo",id):""}${button("Incidencia","incidencia",id)}${button("Cambio de alcance","cambio-alcance",id)}</div>${tech?`<p class="muted">El cierre técnico se realiza en las cuatro pantallas superiores.</p>`:""}</div></section>`:"";

    content.innerHTML=`${shellStart}<section class="panel"><div class="panel-header"><h2>Resumen de la orden</h2></div><div class="panel-body"><div class="info-grid"><div class="info-item"><span>Cliente</span><strong>${esc(x.cliente)}</strong></div><div class="info-item"><span>Sede</span><strong>${esc(x.sede)}</strong></div><div class="info-item"><span>Estado</span><strong>${esc(x.estado)}</strong></div><div class="info-item"><span>Prioridad</span><strong>${esc(x.Prioridad||x.prioridad)}</strong></div><div class="info-item"><span>Servicio</span><strong>${esc(x.tipo)}</strong></div><div class="info-item"><span>Atención aproximada</span><strong>${fmt(x.programada)}</strong></div><div class="info-item"><span>Ticket</span><strong>${esc(x.ticket||"—")}</strong></div><div class="info-item"><span>OT / OC</span><strong>${esc(x.orden_papel||"—")}</strong></div><div class="info-item"><span>Ubicación</span><strong>${esc([x.Direccion||x.direccion,x.Municipio||x.municipio].filter(Boolean).join(", ")||x.sede)}</strong></div><div class="info-item"><span>Cuadrilla</span><strong>${techs}</strong></div></div><h3 class="section-title">Solicitud</h3><p>${esc(x.solicitud)}</p></div></section>
      ${correction}${opActions}
      ${tech?"":`<section class="panel"><div class="panel-header"><h2>Cotización</h2><span class="muted">Independiente del cierre técnico</span></div><div class="panel-body">${quoteSummary}${quoteActions}</div></section>`}
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
    const all=(await loadAllPaged("sedes","/api/mis-sedes")).items;
    state.clientSites=all;
    const active=all.filter(x=>x.activo).length,inactive=all.length-active;
    const result=smartListData("sedes",all,{
      defaults:{orden:"nombre",direccion:"ASC"},
      search:x=>[x.nombre,x.codigo,x.telefono,x.direccion,x.municipio,x.departamento],
      filters:{estado:x=>x.activo?"ACTIVA":"INACTIVA"},
      sort:{nombre:x=>x.nombre||"",municipio:x=>x.municipio||"",estado:x=>x.activo?1:0}
    });
    const cards=`<section class="mini-stats-grid site-summary-grid"><article class="mini-stat"><span>Total de sedes</span><strong>${all.length}</strong></article><article class="mini-stat"><span>Activas</span><strong>${active}</strong></article><article class="mini-stat"><span>Inactivas</span><strong>${inactive}</strong></article></section>`;
    const rows=result.items.map(x=>`<tr><td><div class="site-name-cell"><span class="site-pin"><i data-lucide="map-pin"></i></span><div><strong>${esc(x.nombre||"Sede")}</strong><small>${esc(x.codigo||"Sin código")}</small></div></div></td><td>${esc(x.telefono||"—")}</td><td>${esc(x.direccion||"—")}</td><td>${esc([x.municipio,x.departamento].filter(Boolean).join(", ")||"—")}</td><td>${badge(x.activo?"ACTIVA":"INACTIVA")}</td><td><div class="inline-actions">${button("Editar","editar-sede",x.id)}${button(x.activo?"Desactivar":"Activar","toggle-sede",x.id,x.activo?"danger":"primary")}</div></td></tr>`);
    content.innerHTML=`${cards}<div class="toolbar"><div class="toolbar-left"><h2>Sedes y tiendas registradas</h2><p class="muted">Busca y filtra tus propias ubicaciones.</p></div><div class="toolbar-right">${button("Agregar sede","nueva-sede","","primary")}</div></div><section class="panel smart-list-panel"><div class="panel-body">${smartControls("sedes",{placeholder:"Sede, código, dirección o municipio",filters:[{name:"estado",label:"Estado",options:[["ACTIVA","Activas"],["INACTIVA","Inactivas"]]}],sorts:[["nombre","Nombre"],["municipio","Municipio"],["estado","Estado"]]})}${smartResultsMeta(result,"sedes")}</div>${table(["Sede / tienda","Teléfono","Dirección","Municipio / departamento","Estado","Acciones"],rows,"No hay sedes que coincidan con los filtros.")}${smartPager("sedes",result)}</section>`;
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
    setHeading("Clientes y personal", "Administra clientes, sedes, colaboradores y accesos del sistema.");
    const all=(await loadAllPaged("clientes","/api/clientes")).items;
    state.peopleCounts.clientes=all.length;
    const activeCount=all.filter(x=>!!x.activo).length;
    const inactiveCount=all.length-activeCount;
    const siteCount=all.reduce((sum,x)=>sum+normalizeNumber(x.sedes),0);
    const multiSiteCount=all.filter(x=>normalizeNumber(x.sedes)>1).length;
    const prefs=smartPrefs("clientes",{orden:"nombre",direccion:"ASC",filtros:{peopleQuick:["TODOS"]}});
    const quickValues=normalizeSmartQuickValues(prefs.filtros?.peopleQuick);
    const quickSet=new Set(quickValues);
    let source=[...all];
    if(quickValues.length) source=source.filter(x=>quickValues.some(quick=>quick==="ACTIVOS"?!!x.activo:quick==="INACTIVOS"?!x.activo:quick==="VARIAS_SEDES"?normalizeNumber(x.sedes)>1:true));
    const result=smartListData("clientes",source,{
      defaults:{orden:"nombre",direccion:"ASC",filtros:{peopleQuick:"TODOS"}},
      search:x=>[x.codigo,x.nombre,x.nit,x.telefono,x.correo],
      filters:{estado:x=>x.activo?"ACTIVO":"INACTIVO"},
      sort:{nombre:x=>x.nombre||"",codigo:x=>x.codigo||"",solicitudes:x=>Number(x.solicitudes||0),sedes:x=>Number(x.sedes||0),estado:x=>x.activo?1:0}
    });
    const rows=result.items.map(x=>{
      const active=!!x.activo;
      const contact=[x.correo,x.telefono].filter(Boolean);
      const menu=peopleActionMenu([
        {label:"Editar cliente",icon:"pencil",action:"editar-cliente",id:x.id},
        {label:"Gestionar sedes",icon:"map-pinned",action:"ver-sedes",id:x.id},
        {separator:true},
        {label:active?"Desactivar":"Reactivar",icon:active?"user-round-x":"user-round-check",action:"toggle-cliente",id:x.id,danger:active,attrs:`data-active="${active?0:1}" data-name="${esc(x.nombre||"")}"`}
      ]);
      return `<tr>
        <td><div class="people-primary-cell"><strong>${esc(x.nombre||"Cliente")}</strong><span>${esc(x.codigo||"Sin código")}${x.nit?` · NIT ${esc(x.nit)}`:""}</span></div></td>
        <td><div class="people-number-cell"><strong>${normalizeNumber(x.sedes)}</strong><span>${normalizeNumber(x.sedes)===1?"sede":"sedes"}</span></div></td>
        <td><div class="people-contact-cell">${contact.length?`${x.correo?`<strong>${esc(x.correo)}</strong>`:""}${x.telefono?`<span>${esc(x.telefono)}</span>`:""}`:`<span class="people-muted">Sin contacto principal</span>`}</div></td>
        <td>${peopleStatusBadge(active?"ACTIVO":"INACTIVO")}</td>
        <td><div class="people-row-actions"><button class="people-outline-action" type="button" data-action="ver-cliente" data-id="${esc(x.id)}"><i data-lucide="eye"></i><span>Ver perfil</span></button>${menu}</div></td>
      </tr>`;
    });
    const quicks=`<div class="people-quick-row"><span>Filtros rápidos:</span><div class="people-quick-list">${peopleQuickButton("clientes","TODOS","Todos",all.length,quickValues.length===0)}${peopleQuickButton("clientes","ACTIVOS","Activos",activeCount,quickSet.has("ACTIVOS"))}${peopleQuickButton("clientes","INACTIVOS","Inactivos",inactiveCount,quickSet.has("INACTIVOS"))}${peopleQuickButton("clientes","VARIAS_SEDES","Con varias sedes",multiSiteCount,quickSet.has("VARIAS_SEDES"))}</div><span class="people-quick-hint">Puedes combinar varios.</span></div>${quickValues.length?`<div class="people-active-quick"><span>${quickValues.length} filtro${quickValues.length===1?"":"s"} activo${quickValues.length===1?"":"s"}</span><div>${quickValues.map(value=>`<button class="smart-quick-active" type="button" data-action="people-quick-filter" data-list-key="clientes" data-value="${esc(value)}"><span>${esc(value==="VARIAS_SEDES"?"Con varias sedes":value.charAt(0)+value.slice(1).toLowerCase())}</span><i data-lucide="x"></i></button>`).join("")}</div></div>`:""}`;
    const p=smartPrefs("clientes");
    const filters=`<section class="people-filter-section clients-filter-modern">
      <div class="clients-filter-main">
        <label class="people-field people-search clients-search-control">
          <span class="clients-filter-kicker">Buscar</span>
          <div class="clients-search-box"><i data-lucide="search"></i><input type="search" data-smart-q="clientes" value="${esc(p.q)}" placeholder="Cliente, sede, NIT, correo o teléfono..." autocomplete="off"></div>
        </label>
        <div class="clients-filter-controls">
          <label class="clients-filter-select state-filter">
            <span class="clients-filter-icon"><i data-lucide="circle-dot"></i></span>
            <span class="clients-filter-copy"><small>Estado</small><select data-smart-filter="estado" data-smart-key="clientes">${smartOptions([["ACTIVO","Activos"],["INACTIVO","Inactivos"]],p.filtros?.estado,"Todos")}</select></span>
          </label>
          <label class="clients-filter-select sort-filter">
            <span class="clients-filter-icon"><i data-lucide="arrow-up-down"></i></span>
            <span class="clients-filter-copy"><small>Ordenar</small><select data-smart-sort data-smart-key="clientes"><option value="nombre" ${p.orden==="nombre"?"selected":""}>Nombre</option><option value="sedes" ${p.orden==="sedes"?"selected":""}>Sedes</option><option value="solicitudes" ${p.orden==="solicitudes"?"selected":""}>Solicitudes</option><option value="estado" ${p.orden==="estado"?"selected":""}>Estado</option></select></span>
          </label>
          <label class="clients-filter-select direction-filter">
            <span class="clients-filter-icon"><i data-lucide="move-vertical"></i></span>
            <span class="clients-filter-copy"><small>Dirección</small><select data-smart-direction data-smart-key="clientes"><option value="ASC" ${p.direccion==="ASC"?"selected":""}>Ascendente</option><option value="DESC" ${p.direccion==="DESC"?"selected":""}>Descendente</option></select></span>
          </label>
          <label class="clients-filter-select size-filter">
            <span class="clients-filter-icon"><i data-lucide="rows-3"></i></span>
            <span class="clients-filter-copy"><small>Mostrar</small><select data-smart-size data-smart-key="clientes">${[5,10,20,50].map(n=>`<option value="${n}" ${Number(p.tamano)===n?"selected":""}>${n} por página</option>`).join("")}</select></span>
          </label>
          <button class="people-clear clients-clear-button" type="button" data-action="smart-reset" data-list-key="clientes" title="Restablecer filtros"><i data-lucide="rotate-ccw"></i><span>Limpiar</span></button>
        </div>
      </div>
      ${quicks}
    </section>`;
    content.innerHTML=`<div class="people-workspace">${peopleWorkspaceHeader("clientes")}
      <section class="people-metrics">${peopleMetric("Clientes activos",activeCount,"Con servicio habilitado")}${peopleMetric("Sedes registradas",siteCount,"Ubicaciones vinculadas")}${peopleMetric("Clientes inactivos",inactiveCount,"Historial conservado")}</section>
      <section class="people-context"><div><h2>Clientes y sedes</h2><p>Consulta empresas, contactos y ubicaciones registradas.</p></div></section>
      ${filters}
      ${peopleTableShell("Clientes",result,["Cliente","Sedes","Contacto principal","Estado","Acciones"],rows,smartPager("clientes",result),"clientes")}
    </div>`;
    window.lucide?.createIcons();
  }


  async function fetchClientDetail(id){
    if(!id) throw new Error("No se recibió el identificador del cliente.");
    const d=await api(`/api/clientes/${encodeURIComponent(id)}/detalle`);
    if(!d?.item) throw new Error("No fue posible obtener los datos del cliente.");
    return d.item;
  }

  async function openClientDetail(id){
    openModal("Detalle del cliente", `<div class="loading-card">Cargando información del cliente...</div>`, {lockBackdrop:false});
    const x=await fetchClientDetail(id);
    openModal("Detalle del cliente",`<div class="info-grid">
      <div class="info-item"><span>Código</span><strong>${esc(x.codigo||"—")}</strong></div>
      <div class="info-item"><span>Estado</span><strong>${x.activo?`<span class="badge green">ACTIVO</span>`:`<span class="badge red">INACTIVO</span>`}</strong></div>
      <div class="info-item"><span>Nombre comercial</span><strong>${esc(x.nombre_comercial||"—")}</strong></div>
      <div class="info-item"><span>Razón social</span><strong>${esc(x.razon_social||"—")}</strong></div>
      <div class="info-item"><span>NIT</span><strong>${esc(x.nit||"—")}</strong></div>
      <div class="info-item"><span>Teléfono</span><strong>${esc(x.telefono||"—")}</strong></div>
      <div class="info-item"><span>Correo</span><strong>${esc(x.correo||"—")}</strong></div>
      <div class="info-item"><span>Dirección fiscal</span><strong>${esc(x.direccion_fiscal||"—")}</strong></div>
      <div class="info-item"><span>Sedes</span><strong>${normalizeNumber(x.sedes)}</strong></div>
      <div class="info-item"><span>Contactos</span><strong>${normalizeNumber(x.contactos)}</strong></div>
      <div class="info-item"><span>Solicitudes</span><strong>${normalizeNumber(x.solicitudes)}</strong></div>
      <div class="info-item"><span>Última actualización</span><strong>${fmt(x.actualizado_en)}</strong></div>
    </div>${x.observaciones?`<div class="notice-card"><strong>Observaciones</strong><p>${esc(x.observaciones)}</p></div>`:""}
    <div class="form-actions"><button class="btn" type="button" data-action="ver-sedes" data-id="${esc(id)}">Ver sedes</button><button class="btn" type="button" data-action="editar-cliente" data-id="${esc(id)}">Editar</button><button class="btn ${x.activo?"danger":"primary"}" type="button" data-action="toggle-cliente" data-id="${esc(id)}" data-active="${x.activo?0:1}" data-name="${esc(x.nombre_comercial||"")}">${x.activo?"Desactivar":"Reactivar"}</button></div>`);
    window.lucide?.createIcons();
  }

  async function clientForm(id=""){
    const editing=!!id;
    if(editing) openModal("Editar cliente", `<div class="loading-card">Cargando datos para editar...</div>`, {lockBackdrop:false});
    const current=editing?await fetchClientDetail(id):null;
    openModal(editing?"Editar cliente":"Crear cliente",`<form id="clientCreateForm" class="form-grid" autocomplete="off">
      <div class="field"><label>Código de cliente</label><input name="codigo" maxlength="20" placeholder="Ej. CLI-001" required value="${esc(current?.codigo||"")}"></div>
      <div class="field"><label>NIT</label><input name="nit" maxlength="20" placeholder="NIT del cliente" value="${esc(current?.nit||"")}"></div>
      <div class="field full"><label>Nombre comercial</label><input name="nombre_comercial" maxlength="180" required placeholder="Nombre con el que identificamos al cliente" value="${esc(current?.nombre_comercial||"")}"></div>
      <div class="field full"><label>Razón social</label><input name="razon_social" maxlength="220" placeholder="Opcional" value="${esc(current?.razon_social||"")}"></div>
      <div class="field"><label>Teléfono principal</label><input name="telefono" maxlength="20" placeholder="+502 ..." value="${esc(current?.telefono||"")}"></div>
      <div class="field"><label>Correo principal</label><input type="email" name="correo" maxlength="160" placeholder="contacto@empresa.com" value="${esc(current?.correo||"")}"></div>
      <div class="field full"><label>Dirección fiscal</label><textarea name="direccion_fiscal" maxlength="400" placeholder="Opcional">${esc(current?.direccion_fiscal||"")}</textarea></div>
      <div class="field full"><label>Observaciones</label><textarea name="observaciones" maxlength="700" placeholder="Información interna del cliente">${esc(current?.observaciones||"")}</textarea></div>
      ${editing?`<div class="field full"><div class="notice-card"><strong>Baja lógica</strong><p>Para desactivar o reactivar al cliente utiliza la acción de estado. No se elimina su historial.</p></div></div>`:`<div class="field full"><div class="user-form-intro"><span><i data-lucide="contact-round"></i></span><div><strong>Contacto principal</strong><p>Opcional. Si este cliente tendrá usuario del portal, conviene registrar aquí a la persona que luego se vinculará desde Usuarios.</p></div></div></div>
      <div class="field full"><label>Nombre del contacto</label><input name="contacto_nombre" maxlength="180" placeholder="Ej. Ana Pérez"></div>
      <div class="field"><label>Cargo</label><input name="contacto_cargo" maxlength="120" placeholder="Gerencia, mantenimiento..."></div>
      <div class="field"><label>Teléfono del contacto</label><input name="contacto_telefono" maxlength="20"></div>
      <div class="field full"><label>Correo del contacto</label><input type="email" name="contacto_correo" maxlength="160"></div>`}
      <div class="field full"><div class="form-actions"><button class="btn" type="button" data-close-modal>Cancelar</button><button class="btn primary" type="submit"><i data-lucide="${editing?"save":"building-2"}"></i> ${editing?"Guardar cambios":"Crear cliente"}</button></div></div>
    </form>`);
    const form=$("#clientCreateForm");
    form?.addEventListener("submit",async e=>{e.preventDefault();const submit=form.querySelector('button[type="submit"]');submit.disabled=true;try{const body=Object.fromEntries(new FormData(form).entries());const result=await api(editing?`/api/clientes/${id}`:"/api/clientes",{method:editing?"PATCH":"POST",body});showToast(result.message||(editing?"Cliente actualizado.":"Cliente registrado correctamente."));closeModal();state.userAdmin.catalogos=null;state.catalogs={};await renderClientes();}catch(err){showToast(err.message,"error");}finally{submit.disabled=false;}});
    window.lucide?.createIcons();
  }

  function confirmClientState(id, activate, name){
    openModal(activate?"Reactivar cliente":"Desactivar cliente",`<div class="confirm-card ${activate?"":"danger"}"><div class="confirm-icon"><i data-lucide="${activate?"circle-check-big":"triangle-alert"}"></i></div><div><h3>${activate?"¿Reactivar este cliente?":"¿Desactivar este cliente?"}</h3><p>${activate?"Volverá a estar disponible para nuevos procesos.":"Se conserva todo su historial y dejará de estar disponible para registrar nuevas solicitudes."}</p><strong>${esc(name||"Cliente")}</strong></div></div><div class="form-actions"><button class="btn" type="button" data-close-modal>Cancelar</button><button class="btn ${activate?"primary":"danger"}" type="button" data-action="confirmar-toggle-cliente" data-id="${esc(id)}" data-active="${activate?1:0}">${activate?"Reactivar":"Desactivar"}</button></div>`);
    window.lucide?.createIcons();
  }

  async function openSedes(id){
    const d=await api(`/api/clientes/${id}/sedes`);
    const all=d.items||[];
    let q="",status="TODOS",page=1,size=10;
    openModal("Sedes del cliente",`<div class="modal-list-shell"><div class="modal-list-tools"><div class="field modal-list-search"><label>Buscar</label><div class="input-with-icon"><i data-lucide="search"></i><input id="clientSitesModalSearch" type="search" placeholder="Código, sede, dirección o municipio"></div></div><div class="field"><label>Estado</label><select id="clientSitesModalStatus"><option value="TODOS">Todos</option><option value="ACTIVO">Activas</option><option value="INACTIVO">Inactivas</option></select></div><div class="field"><label>Por página</label><select id="clientSitesModalSize"><option>5</option><option selected>10</option><option>20</option><option>50</option></select></div></div><div id="clientSitesModalHost"></div></div>`);
    const paint=()=>{
      const host=$("#clientSitesModalHost");if(!host)return;
      let items=all.filter(x=>{
        const active=!!(x.Activo??x.activo);
        if(status!=="TODOS"&&(status==="ACTIVO")!==active)return false;
        if(!smartText(q))return true;
        return [x.codigo,x.CodigoSucursal,x.Nombre,x.nombre,x.Telefono,x.telefono,x.Direccion,x.direccion,x.Municipio,x.municipio,x.Departamento,x.departamento].some(v=>smartText(v).includes(smartText(q)));
      });
      items.sort((a,b)=>String(a.Nombre||a.nombre||"").localeCompare(String(b.Nombre||b.nombre||""),"es",{sensitivity:"base",numeric:true}));
      const total=items.length,pages=Math.max(1,Math.ceil(total/size));page=Math.min(page,pages);const shown=items.slice((page-1)*size,page*size);
      const rows=shown.map(x=>`<tr><td>${esc(x.codigo||x.CodigoSucursal||"—")}</td><td>${esc(x.Nombre||x.nombre||"—")}</td><td>${esc(x.Telefono||x.telefono||"—")}</td><td>${esc(x.Direccion||x.direccion||"—")}</td><td>${esc(x.Municipio||x.municipio||"—")}</td><td>${badge((x.Activo??x.activo)?"ACTIVA":"INACTIVA")}</td></tr>`);
      host.innerHTML=`${table(["Código","Sede","Teléfono","Dirección","Municipio","Estado"],rows,"Este cliente no tiene sedes que coincidan con los filtros.")}${smartPager("modal-sedes",{pagina:page,paginas:pages,total,tamano:size})}`;
      $$("[data-list-key='modal-sedes']",host).forEach(btn=>{btn.removeAttribute("data-action");btn.addEventListener("click",()=>{if(btn.disabled)return;page=Math.max(1,Number(btn.dataset.page||1));paint();});});
      window.lucide?.createIcons();
    };
    $("#clientSitesModalSearch")?.addEventListener("input",e=>{q=e.currentTarget.value;page=1;paint();});
    $("#clientSitesModalStatus")?.addEventListener("change",e=>{status=e.currentTarget.value;page=1;paint();});
    $("#clientSitesModalSize")?.addEventListener("change",e=>{size=Number(e.currentTarget.value||10);page=1;paint();});
    paint();window.lucide?.createIcons();
  }


  async function renderPersonal(){
    setHeading("Clientes y personal", "Administra clientes, sedes, colaboradores y accesos del sistema.");
    const all=(await loadAllPaged("personal","/api/personal")).items;
    state.peopleCounts.personal=all.length;
    const jobs=smartUnique(all,x=>x.puesto||"");
    const states=smartUnique(all,x=>String(x.estado||"").toUpperCase());
    const availability=smartUnique(all,x=>String(x.disponibilidad||"").toUpperCase());
    const activeCount=all.filter(x=>/ACTIVO/.test(String(x.estado||"").toUpperCase())&&!/INACTIVO/.test(String(x.estado||"").toUpperCase())).length;
    const availableCount=all.filter(x=>String(x.disponibilidad||"").toUpperCase()==="DISPONIBLE").length;
    const assignedCount=all.filter(x=>String(x.disponibilidad||"").toUpperCase()==="ASIGNADO").length;
    const vacationCount=all.filter(x=>String(x.disponibilidad||"").toUpperCase()==="VACACIONES").length;
    const missingAvailability=all.filter(x=>!String(x.disponibilidad||"").trim()).length;
    const prefs=smartPrefs("personal",{orden:"nombre",direccion:"ASC",filtros:{peopleQuick:["TODOS"]}});
    const quickValues=normalizeSmartQuickValues(prefs.filtros?.peopleQuick);
    const quickSet=new Set(quickValues);
    let source=[...all];
    if(quickValues.length) source=source.filter(x=>quickValues.some(quick=>quick==="DISPONIBLES"?String(x.disponibilidad||"").toUpperCase()==="DISPONIBLE":quick==="ASIGNADOS"?String(x.disponibilidad||"").toUpperCase()==="ASIGNADO":quick==="VACACIONES"?String(x.disponibilidad||"").toUpperCase()==="VACACIONES":quick==="INACTIVOS"?(/INACTIVO/.test(String(x.estado||"").toUpperCase())||String(x.disponibilidad||"").toUpperCase()==="INACTIVO"):true));
    const result=smartListData("personal",source,{
      defaults:{orden:"nombre",direccion:"ASC",filtros:{peopleQuick:"TODOS"}},
      search:x=>[x.codigo,x.nombre,x.puesto,x.estado,x.disponibilidad,x.telefono,x.correo],
      filters:{estado:x=>String(x.estado||"").toUpperCase(),disponibilidad:x=>String(x.disponibilidad||"").toUpperCase(),puesto:x=>x.puesto||""},
      sort:{nombre:x=>x.nombre||"",codigo:x=>x.codigo||"",puesto:x=>x.puesto||"",estado:x=>x.estado||"",disponibilidad:x=>x.disponibilidad||""}
    });
    const rows=result.items.map(x=>{
      const menu=peopleActionMenu([
        {label:"Guardar disponibilidad",icon:"save",action:"guardar-disponibilidad",id:x.id}
      ]);
      return `<tr>
        <td>${renderAvatarIdentity(x.nombre||"Empleado",{entity:x,subtitle:x.codigo||"Empleado",className:"people-employee-identity"})}</td>
        <td><div class="people-primary-cell"><strong>${esc(x.puesto||"Sin cargo registrado")}</strong></div></td>
        <td><div class="people-contact-cell">${x.telefono?`<strong>${esc(x.telefono)}</strong>`:""}${x.correo?`<span>${esc(x.correo)}</span>`:""}${!x.telefono&&!x.correo?`<span class="people-muted">Sin contacto registrado</span>`:""}</div></td>
        <td><select class="people-availability availability" data-id="${esc(x.id)}" aria-label="Disponibilidad de ${esc(x.nombre||"empleado")}">${["DISPONIBLE","ASIGNADO","VACACIONES","INACTIVO"].map(v=>`<option ${String(x.disponibilidad||"").toUpperCase()===v?"selected":""}>${v.replaceAll("_"," ")}</option>`).join("")}</select></td>
        <td>${peopleStatusBadge(x.estado||"INACTIVO")}</td>
        <td><div class="people-row-actions">${menu}</div></td>
      </tr>`;
    });
    const quicks=`<div class="people-quick-row"><span>Filtros rápidos:</span><div class="people-quick-list">${peopleQuickButton("personal","TODOS","Todos",all.length,quickValues.length===0)}${peopleQuickButton("personal","DISPONIBLES","Disponibles",availableCount,quickSet.has("DISPONIBLES"))}${peopleQuickButton("personal","ASIGNADOS","Asignados",assignedCount,quickSet.has("ASIGNADOS"))}${peopleQuickButton("personal","VACACIONES","Vacaciones",vacationCount,quickSet.has("VACACIONES"))}${peopleQuickButton("personal","INACTIVOS","Inactivos",all.length-activeCount,quickSet.has("INACTIVOS"))}</div><span class="people-quick-hint">Puedes combinar varios.</span></div>${quickValues.length?`<div class="people-active-quick"><span>${quickValues.length} filtro${quickValues.length===1?"":"s"} activo${quickValues.length===1?"":"s"}</span><div>${quickValues.map(value=>`<button class="smart-quick-active" type="button" data-action="people-quick-filter" data-list-key="personal" data-value="${esc(value)}"><span>${esc(value.charAt(0)+value.slice(1).toLowerCase())}</span><i data-lucide="x"></i></button>`).join("")}</div></div>`:""}`;
    const p=smartPrefs("personal");
    const filters=`<section class="people-filter-section"><div class="people-filter-grid people-filter-grid-personal">
      <label class="people-field people-search"><span>Buscar</span><div><i data-lucide="search"></i><input type="search" data-smart-q="personal" value="${esc(p.q)}" placeholder="Buscar empleado, cargo o teléfono..." autocomplete="off"></div></label>
      <label class="people-field"><span>Estado</span><select data-smart-filter="estado" data-smart-key="personal">${smartOptions(states,p.filtros?.estado,"Todos")}</select></label>
      <label class="people-field"><span>Cargo</span><select data-smart-filter="puesto" data-smart-key="personal">${smartOptions(jobs,p.filtros?.puesto,"Todos")}</select></label>
      <label class="people-field"><span>Disponibilidad</span><select data-smart-filter="disponibilidad" data-smart-key="personal">${smartOptions(availability,p.filtros?.disponibilidad,"Todos")}</select></label>
      <label class="people-field"><span>Ordenar por</span><select data-smart-sort data-smart-key="personal"><option value="nombre" ${p.orden==="nombre"?"selected":""}>Nombre</option><option value="puesto" ${p.orden==="puesto"?"selected":""}>Cargo</option><option value="estado" ${p.orden==="estado"?"selected":""}>Estado</option><option value="disponibilidad" ${p.orden==="disponibilidad"?"selected":""}>Disponibilidad</option></select></label>
      <label class="people-field"><span>Dirección</span><select data-smart-direction data-smart-key="personal"><option value="ASC" ${p.direccion==="ASC"?"selected":""}>Ascendente</option><option value="DESC" ${p.direccion==="DESC"?"selected":""}>Descendente</option></select></label>
      <label class="people-field people-size"><span>Por página</span><select data-smart-size data-smart-key="personal">${[5,10,20,50].map(n=>`<option value="${n}" ${Number(p.tamano)===n?"selected":""}>${n}</option>`).join("")}</select></label>
      <div class="people-clear-wrap"><span>&nbsp;</span><button class="people-clear" type="button" data-action="smart-reset" data-list-key="personal"><i data-lucide="rotate-ccw"></i><span>Limpiar filtros</span></button></div>
    </div>${quicks}</section>`;
    const alert=missingAvailability?`<div class="people-inline-alert"><i data-lucide="triangle-alert"></i><span><strong>${missingAvailability}</strong> empleado${missingAvailability===1?"":"s"} no ${missingAvailability===1?"tiene":"tienen"} disponibilidad registrada.</span></div>`:"";
    content.innerHTML=`<div class="people-workspace">${peopleWorkspaceHeader("personal")}
      <section class="people-metrics">${peopleMetric("Personal activo",activeCount,"Colaboradores habilitados")}${peopleMetric("Disponibles",availableCount,"Disponibilidad actual")}${peopleMetric("Asignados",assignedCount,"Con trabajo asignado")}</section>
      <section class="people-context"><div><h2>Personal</h2><p>Administra colaboradores, cargos y disponibilidad.</p></div></section>
      ${filters}${alert}
      ${peopleTableShell("Personal",result,["Empleado","Cargo","Contacto","Disponibilidad","Estado","Acciones"],rows,smartPager("personal",result),"personal")}
    </div>`;
    window.lucide?.createIcons();
  }


  async function employeeForm(){
    const catalogs=await api("/api/personal/catalogos");
    const puestos=(catalogs.puestos||[]).map(x=>`<option value="${esc(x.id)}">${esc(x.nombre)}</option>`).join("");
    const today=new Date().toISOString().slice(0,10);
    openModal("Crear empleado",`<form id="employeeCreateForm" class="form-grid" autocomplete="off">
      <div class="field"><label>Código de empleado</label><input name="codigo_empleado" maxlength="20" placeholder="Ej. EMP-001" required></div>
      <div class="field"><label>Puesto</label><select name="puesto_id" required><option value="">Seleccionar puesto</option>${puestos}</select></div>
      <div class="field"><label>Nombres</label><input name="nombres" maxlength="100" required></div>
      <div class="field"><label>Apellidos</label><input name="apellidos" maxlength="100" required></div>
      <div class="field"><label>DPI</label><input name="dpi" maxlength="13" inputmode="numeric" placeholder="13 dígitos"></div>
      <div class="field"><label>NIT</label><input name="nit" maxlength="20"></div>
      <div class="field"><label>Fecha de nacimiento</label><input type="date" name="fecha_nacimiento"></div>
      <div class="field"><label>Fecha de ingreso</label><input type="date" name="fecha_ingreso" value="${today}" required></div>
      <div class="field"><label>Teléfono principal</label><input name="telefono_principal" maxlength="20" required></div>
      <div class="field"><label>Teléfono alterno</label><input name="telefono_alterno" maxlength="20"></div>
      <div class="field full"><label>Correo</label><input type="email" name="correo" maxlength="160"></div>
      <div class="field full"><label>Dirección de residencia</label><textarea name="direccion_residencia" maxlength="350" required></textarea></div>
      <div class="field"><label>Tipo de contratación</label><select name="tipo_contratacion" required><option value="FIJO">Fijo</option><option value="TEMPORAL">Temporal</option><option value="POR_SERVICIO">Por servicio</option><option value="OTRO">Otro</option></select></div>
      <div class="field"><label>Disponibilidad inicial</label><select name="disponibilidad"><option value="DISPONIBLE">Disponible</option><option value="NO_DISPONIBLE">No disponible</option><option value="VACACIONES">Vacaciones</option></select></div>
      <div class="field full"><label>Forma de pago</label><input name="forma_pago" maxlength="120" placeholder="Opcional"></div>
      <div class="field"><label>Contacto de emergencia</label><input name="contacto_emergencia_nombre" maxlength="160"></div>
      <div class="field"><label>Teléfono de emergencia</label><input name="contacto_emergencia_telefono" maxlength="20"></div>
      <div class="field full"><label>Observaciones</label><textarea name="observaciones" maxlength="700"></textarea></div>
      <div class="field full"><div class="form-actions"><button class="btn" type="button" data-close-modal>Cancelar</button><button class="btn primary" type="submit"><i data-lucide="user-round-plus"></i> Crear empleado</button></div></div>
    </form>`);
    const form=$("#employeeCreateForm");
    form?.addEventListener("submit",async e=>{e.preventDefault();const submit=form.querySelector('button[type="submit"]');submit.disabled=true;try{const body=Object.fromEntries(new FormData(form).entries());const result=await api("/api/personal",{method:"POST",body});showToast(result.message||"Empleado registrado correctamente.");closeModal();state.userAdmin.catalogos=null;await renderPersonal();}catch(err){showToast(err.message,"error");}finally{submit.disabled=false;}});
    window.lucide?.createIcons();
  }


  function userStatusView(x){
    const status=String(x.estado||"").toUpperCase();
    if(status==="BLOQUEADO") return `<span class="user-status user-status-blocked"><i data-lucide="lock-keyhole"></i> Bloqueado</span>`;
    if(status==="ACTIVO") return `<span class="user-status user-status-active"><i data-lucide="circle-check-big"></i> Activo</span>`;
    return `<span class="user-status user-status-inactive"><i data-lucide="circle-pause"></i> Inactivo</span>`;
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
    setHeading("Clientes y personal", "Administra clientes, sedes, colaboradores y accesos del sistema.");
    const f=state.userAdmin;
    const [d,catalogs]=await Promise.all([api(`/api/usuarios?${userReportParams()}`),ensureUserCatalogs()]);
    f.total=d.pagination?.total||0;f.paginas=d.pagination?.paginas||1;f.pagina=d.pagination?.pagina||1;
    const s=d.summary||{};
    state.peopleCounts.usuarios=normalizeNumber(s.total||d.pagination?.total);
    const roles=(catalogs.roles||[]).map(x=>`<option value="${esc(x.id)}" ${String(f.rol_id)===String(x.id)?"selected":""}>${esc(x.nombre)}</option>`).join("");
    const rows=(d.items||[]).map(x=>{
      const blocked=String(x.estado||"").toUpperCase()==="BLOQUEADO";
      const menu=peopleActionMenu([
        {label:"Editar usuario",icon:"pencil",action:"editar-usuario",id:x.id},
        {label:"Restablecer contraseña",icon:"key-round",action:"restablecer-usuario",id:x.id},
        blocked?{label:"Desbloquear acceso",icon:"unlock-keyhole",action:"desbloquear-usuario",id:x.id}:null,
        {separator:true},
        {label:x.activo?"Desactivar acceso":"Activar acceso",icon:x.activo?"user-round-x":"user-round-check",action:"cambiar-estado-usuario",id:x.id,danger:!!x.activo,attrs:`data-active="${x.activo?"0":"1"}" data-name="${esc(x.usuario||"")}"`}
      ]);
      return `<tr>
        <td>${renderAvatarIdentity(x.nombre||x.usuario||"Usuario",{entity:x,subtitle:x.usuario?`@${x.usuario}`:"Usuario del sistema",className:"people-user-identity"})}</td>
        <td><span class="people-role-badge">${esc(x.rol||"—")}</span></td>
        <td><div class="people-contact-cell"><strong>${esc(x.correo||"Sin correo registrado")}</strong></div></td>
        <td><div class="people-date-cell">${x.ultimo_acceso?fmt(x.ultimo_acceso):`<span class="people-muted">Sin acceso reciente</span>`}</div></td>
        <td>${userStatusView(x)}</td>
        <td><div class="people-row-actions"><button class="people-outline-action" type="button" data-action="ver-usuario" data-id="${esc(x.id)}"><i data-lucide="settings-2"></i><span>Gestionar</span></button>${menu}</div></td>
      </tr>`;
    });
    const quicks=`<div class="people-quick-row"><span>Filtros rápidos:</span><button class="people-quick ${!f.estado?"active":""}" type="button" data-action="usuario-filtro-estado" data-status=""><span>Todos</span><b>${normalizeNumber(s.total)}</b></button><button class="people-quick ${f.estado==="ACTIVO"?"active":""}" type="button" data-action="usuario-filtro-estado" data-status="ACTIVO"><span>Activos</span><b>${normalizeNumber(s.activos)}</b></button><button class="people-quick ${f.estado==="INACTIVO"?"active":""}" type="button" data-action="usuario-filtro-estado" data-status="INACTIVO"><span>Inactivos</span><b>${normalizeNumber(s.inactivos)}</b></button><button class="people-quick ${f.estado==="BLOQUEADO"?"active":""}" type="button" data-action="usuario-filtro-estado" data-status="BLOQUEADO"><span>Bloqueados</span><b>${normalizeNumber(s.bloqueados)}</b></button></div>`;
    const filters=`<section class="people-filter-section"><form id="userReportFilters" class="people-filter-grid people-filter-grid-users">
      <label class="people-field people-search"><span>Buscar</span><div><i data-lucide="search"></i><input type="search" name="q" value="${esc(f.q)}" placeholder="Buscar usuario, correo o rol..." autocomplete="off"></div></label>
      <label class="people-field"><span>Estado</span><select name="estado"><option value="">Todos</option><option value="ACTIVO" ${f.estado==="ACTIVO"?"selected":""}>Activos</option><option value="INACTIVO" ${f.estado==="INACTIVO"?"selected":""}>Inactivos</option><option value="BLOQUEADO" ${f.estado==="BLOQUEADO"?"selected":""}>Bloqueados</option></select></label>
      <label class="people-field"><span>Rol</span><select name="rol_id"><option value="">Todos los roles</option>${roles}</select></label>
      <label class="people-field"><span>Desde</span><input type="date" name="fecha_desde" value="${esc(f.fecha_desde)}"></label>
      <label class="people-field"><span>Hasta</span><input type="date" name="fecha_hasta" value="${esc(f.fecha_hasta)}"></label>
      <label class="people-field"><span>Ordenar por</span><select name="orden"><option value="FECHA" ${f.orden==="FECHA"?"selected":""}>Registro</option><option value="NOMBRE" ${f.orden==="NOMBRE"?"selected":""}>Nombre</option><option value="ROL" ${f.orden==="ROL"?"selected":""}>Rol</option><option value="ESTADO" ${f.orden==="ESTADO"?"selected":""}>Estado</option><option value="ULTIMO_ACCESO" ${f.orden==="ULTIMO_ACCESO"?"selected":""}>Último acceso</option></select></label>
      <label class="people-field"><span>Dirección</span><select name="direccion"><option value="DESC" ${f.direccion==="DESC"?"selected":""}>Descendente</option><option value="ASC" ${f.direccion==="ASC"?"selected":""}>Ascendente</option></select></label>
      <label class="people-field people-size"><span>Por página</span><select name="tamano">${[5,10,20,50].map(n=>`<option value="${n}" ${Number(f.tamano)===n?"selected":""}>${n}</option>`).join("")}</select></label>
      <div class="people-user-filter-actions"><button class="people-clear" type="button" data-action="usuarios-limpiar"><i data-lucide="rotate-ccw"></i><span>Limpiar</span></button><button class="people-apply" type="submit"><i data-lucide="filter"></i><span>Aplicar filtros</span></button></div>
    </form>${quicks}</section>`;
    const alert=normalizeNumber(s.bloqueados)>0?`<div class="people-inline-alert warning"><i data-lucide="lock-keyhole"></i><span><strong>${normalizeNumber(s.bloqueados)}</strong> usuario${normalizeNumber(s.bloqueados)===1?" está":"s están"} bloqueado${normalizeNumber(s.bloqueados)===1?"":"s"}.</span><button type="button" data-action="usuario-filtro-estado" data-status="BLOQUEADO">Ver usuarios</button></div>`:"";
    const portalNote=`<div class="people-portal-note"><i data-lucide="shield-check"></i><div><strong>Portal privado</strong><span>Las cuentas son creadas y administradas por Coordinación.</span></div></div>`;
    const tableResult={total:normalizeNumber(d.pagination?.total),items:d.items||[]};
    content.innerHTML=`<div class="people-workspace">${peopleWorkspaceHeader("usuarios")}
      <section class="people-metrics">${peopleMetric("Usuarios activos",s.activos,"Acceso habilitado")}${peopleMetric("Bloqueados",s.bloqueados,"Requieren revisión")}${peopleMetric("Acceso reciente",s.acceso_30_dias,"Últimos 30 días")}</section>
      <section class="people-context"><div><h2>Usuarios del sistema</h2><p>Gestiona credenciales, roles y acceso al portal.</p></div></section>
      ${portalNote}${filters}${alert}
      <section class="people-table-section"><div class="people-table-toolbar"><div><h3>Usuarios</h3><span>${normalizeNumber(d.pagination?.total)} resultados</span></div></div>${rows.length?`<div class="people-table-scroll"><table class="people-table"><thead><tr><th>Usuario</th><th>Rol</th><th>Correo electrónico</th><th>Último acceso</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>`:`<div class="people-empty"><i data-lucide="users-round"></i><h3>No encontramos usuarios con estos filtros.</h3><p>Prueba cambiando Estado, Rol o el rango de fechas.</p><button class="btn small" type="button" data-action="usuarios-limpiar"><i data-lucide="rotate-ccw"></i><span>Limpiar filtros</span></button></div>`}${userPagination(d.pagination||{})}</section>
    </div>`;
    window.lucide?.createIcons();
    const form=$("#userReportFilters");
    form?.addEventListener("submit",e=>{e.preventDefault();const data=Object.fromEntries(new FormData(form).entries());Object.assign(f,{q:String(data.q||"").trim(),rol_id:String(data.rol_id||""),estado:String(data.estado||""),fecha_desde:String(data.fecha_desde||""),fecha_hasta:String(data.fecha_hasta||""),tamano:Number(data.tamano||10),orden:String(data.orden||f.orden||"FECHA"),direccion:String(data.direccion||f.direccion||"DESC"),pagina:1});withContextualLoader(()=>renderUsuarios(),"Actualizando usuarios...","Usuarios actualizados").catch(err=>showToast(err.message,"error"));});
  }

  function userRolePortalById(id){
    const role=(state.userAdmin.catalogos?.roles||[]).find(x=>String(x.id)===String(id));
    return String(role?.portal||role?.codigo||"").toUpperCase();
  }

  function syncUserOwnerFields(form,currentId=""){
    if(!form)return;
    const role=userRolePortalById(form.rol_id?.value);
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
    setHeading("Equipo y mantenimiento", "Inventario técnico, disponibilidad y mantenimiento interno.");
    const all=(await loadAllPaged("equipos","/api/equipos")).items;
    const categories=smartUnique(all,x=>x.Categoria||x.categoria||"");
    const states=smartUnique(all,x=>String(x.Estado||x.estado||"").toUpperCase());
    const result=smartListData("equipos",all,{
      defaults:{orden:"nombre",direccion:"ASC"},
      search:x=>[x.codigo,x.CodigoEquipo,x.Nombre,x.nombre,x.Categoria,x.categoria,x.Marca,x.marca,x.Modelo,x.modelo,x.Serie,x.serie,x.ubicacion],
      filters:{estado:x=>String(x.Estado||x.estado||"").toUpperCase(),categoria:x=>String(x.Categoria||x.categoria||"")},
      sort:{nombre:x=>x.Nombre||x.nombre||"",codigo:x=>x.codigo||x.CodigoEquipo||"",estado:x=>x.Estado||x.estado||"",fallas:x=>Number(x.fallas_abiertas||0)}
    });
    const equipmentState=x=>String(x.Estado||x.estado||"").toUpperCase();
    const summary=coordinatorCompactMetrics([
      {label:"Total de equipos",value:all.length,icon:"package-search",tone:"blue"},
      {label:"Disponibles",value:all.filter(x=>equipmentState(x)==="DISPONIBLE").length,icon:"circle-check-big",tone:"green"},
      {label:"En mantenimiento",value:all.filter(x=>equipmentState(x)==="EN_MANTENIMIENTO").length,icon:"settings",tone:"amber"},
      {label:"Con fallas",value:all.filter(x=>Number(x.fallas_abiertas||0)>0).length,icon:"triangle-alert",tone:"red"}
    ],"equipment-summary");
    const canManageEquipment=state.role==="COORDINADOR";
    const rows=result.items.map(x=>{const current=String(x.Estado||x.estado||"DISPONIBLE").toUpperCase();return `<tr><td class="mono">${esc(x.codigo||x.CodigoEquipo||"—")}</td><td><strong>${esc(x.Nombre||x.nombre||"—")}</strong>${x.Modelo||x.modelo?`<small class="table-subline">${esc(x.Modelo||x.modelo)}</small>`:""}</td><td>${esc(x.Categoria||x.categoria||"—")}</td><td>${esc(x.Marca||x.marca||"—")}</td><td>${badge(current)}</td><td>${normalizeNumber(x.fallas_abiertas)}</td>${canManageEquipment?`<td><div class="equipment-row-action"><select class="inline-select equipment-state" data-id="${esc(x.id)}">${["DISPONIBLE","ASIGNADO","EN_MANTENIMIENTO","FUERA_DE_USO","RETIRADO"].map(st=>`<option ${st===current?"selected":""}>${st}</option>`).join("")}</select>${button("Guardar","guardar-equipo",x.id)}</div></td>`:""}</tr>`;});
    const equipmentHeaders=canManageEquipment?["Código","Equipo","Categoría","Marca","Estado","Fallas","Acción"]:["Código","Equipo","Categoría","Marca","Estado","Fallas"];
    content.innerHTML=`${equipmentMaintenanceTabs("equipos")}${summary}<section class="panel smart-list-panel equipment-panel coord-data-surface"><div class="panel-header equipment-heading"><div><span class="coord-section-kicker">INVENTARIO</span><h2>Equipo</h2><p class="muted">${canManageEquipment?"Gestiona inventario técnico, disponibilidad y fallas abiertas.":"Consulta disponibilidad, categoría y estado del equipo técnico."}</p></div>${canManageEquipment?`<button class="btn primary" type="button" data-action="nuevo-equipo"><i data-lucide="circle-plus"></i> Registrar equipo</button>`:""}</div><div class="panel-body">${smartControls("equipos",{placeholder:"Código, equipo, marca, modelo o serie",filters:[{name:"estado",label:"Estado",options:states},{name:"categoria",label:"Categoría",options:categories}],sorts:[["nombre","Equipo"],["codigo","Código"],["estado","Estado"],["fallas","Fallas abiertas"]]})}${smartResultsMeta(result,"equipos")}</div>${table(equipmentHeaders,rows,"No hay equipos que coincidan con los filtros.")}${smartPager("equipos",result)}</section>`;
    window.lucide?.createIcons();
  }

  async function renderMantenimientos(){
    setHeading("Equipo y mantenimiento", "Inventario técnico, disponibilidad y mantenimiento interno.");
    const all=(await loadAllPaged("mantenimientos","/api/mantenimientos")).items;
    const types=smartUnique(all,x=>String(x.tipo||"").toUpperCase());
    const states=smartUnique(all,x=>String(x.Estado||x.estado||"").toUpperCase());
    const result=smartListData("mantenimientos",all,{
      defaults:{orden:"programada",direccion:"DESC"},
      search:x=>[x.id,x.codigo_equipo,x.equipo,x.tipo,x.Estado,x.estado,x.Diagnostico,x.diagnostico,x.TrabajoRequerido,x.trabajo_requerido,x.Resultado,x.resultado],
      filters:{tipo:x=>String(x.tipo||"").toUpperCase(),estado:x=>String(x.Estado||x.estado||"").toUpperCase()},
      sort:{programada:x=>smartDateValue(x.programada),equipo:x=>x.equipo||"",estado:x=>x.Estado||x.estado||"",tipo:x=>x.tipo||""}
    });
    const maintenanceState=x=>String(x.Estado||x.estado||"").toUpperCase().replaceAll("_"," ");
    const summary=coordinatorCompactMetrics([
      {label:"Programados",value:all.filter(x=>/PROGRAM/.test(maintenanceState(x))).length,icon:"calendar-clock",tone:"blue"},
      {label:"En proceso",value:all.filter(x=>/PROCES|CURSO/.test(maintenanceState(x))).length,icon:"refresh-cw",tone:"amber"},
      {label:"Finalizados",value:all.filter(x=>/FINAL|COMPLET/.test(maintenanceState(x))).length,icon:"circle-check-big",tone:"green"},
      {label:"Pendientes / vencidos",value:all.filter(x=>/PEND|VENC/.test(maintenanceState(x))).length,icon:"triangle-alert",tone:"red"}
    ],"maintenance-summary");
    const rows=result.items.map(x=>`<tr><td class="mono">#${x.id}</td><td><strong>${esc(x.equipo||"Equipo")}</strong><small class="table-subline">${esc(x.codigo_equipo||"—")}</small></td><td>${badge(x.tipo)}</td><td>${badge(x.Estado||x.estado)}</td><td>${fmt(x.programada)}</td><td>${esc(x.Diagnostico||x.diagnostico||"—")}</td><td>${esc(x.Resultado||x.resultado||"—")}</td></tr>`);
    content.innerHTML=`${equipmentMaintenanceTabs("mantenimientos")}${summary}<section class="panel smart-list-panel maintenance-panel coord-data-surface"><div class="panel-header"><div><span class="coord-section-kicker">MANTENIMIENTO</span><h2>Mantenimiento</h2><p class="muted">Programa y da seguimiento al mantenimiento preventivo y correctivo.</p></div>${state.role==="COORDINADOR"?`<button class="btn primary" type="button" data-action="nuevo-mantenimiento"><i data-lucide="calendar-plus"></i> Programar mantenimiento</button>`:""}</div><div class="panel-body">${smartControls("mantenimientos",{placeholder:"Registro, equipo, diagnóstico o trabajo requerido",filters:[{name:"tipo",label:"Tipo",options:types},{name:"estado",label:"Estado",options:states}],sorts:[["programada","Fecha programada"],["equipo","Equipo"],["tipo","Tipo"],["estado","Estado"]]})}${smartResultsMeta(result,"mantenimientos")}</div>${table(["Registro","Equipo","Tipo","Estado","Fecha programada","Diagnóstico","Resultado"],rows,"No hay mantenimientos que coincidan con los filtros.")}${smartPager("mantenimientos",result)}</section>`;
    window.lucide?.createIcons();
  }


  function maintenanceForm(){openModal("Programar mantenimiento",`<form id="maintenanceForm" class="form-grid"><div class="field"><label>Equipo</label><select name="equipo_id" required>${optionList(state.catalogs.equipos||[],"id",x=>`${x.codigo} · ${x.nombre}`)}</select></div><div class="field"><label>Tipo</label><select name="tipo"><option>PREVENTIVO</option><option>CORRECTIVO</option></select></div><div class="field"><label>Fecha programada</label><input type="datetime-local" name="fecha_programada"></div><div class="field full"><label>Diagnóstico inicial</label><textarea name="diagnostico"></textarea></div><div class="field full"><label>Trabajo requerido</label><textarea name="trabajo_requerido"></textarea></div><div class="field full"><div class="form-actions"><button class="btn primary">Guardar</button></div></div></form>`);$("#maintenanceForm").addEventListener("submit",async e=>{e.preventDefault();try{await api("/api/mantenimientos",{method:"POST",body:Object.fromEntries(new FormData(e.currentTarget).entries())});showToast("Mantenimiento registrado.");closeModal();navigate("mantenimientos");}catch(err){showToast(err.message,"error");}});}

  async function renderVacaciones(){
    setHeading("Vacaciones", "Consulta de solicitudes de vacaciones.");
    const all=(await loadAllPaged("vacaciones","/api/vacaciones")).items;
    const states=smartUnique(all,x=>String(x.Estado||x.estado||"").toUpperCase());
    const result=smartListData("vacaciones",all,{
      defaults:{orden:"solicitada",direccion:"DESC"},
      search:x=>[x.empleado,x.Estado,x.estado,x.Motivo,x.motivo,x.Observaciones,x.observaciones],
      filters:{estado:x=>String(x.Estado||x.estado||"").toUpperCase()},
      sort:{solicitada:x=>smartDateValue(x.solicitada),inicio:x=>smartDateValue(x.inicio),empleado:x=>x.empleado||"",estado:x=>x.Estado||x.estado||""}
    });
    const rows=result.items.map(x=>`<tr><td>${esc(x.empleado)}</td><td>${fmt(x.solicitada)}</td><td>${fmt(x.inicio)}</td><td>${fmt(x.fin)}</td><td>${esc(x.dias)}</td><td>${badge(x.Estado||x.estado)}</td><td>${esc(x.Motivo||x.motivo||"—")}</td></tr>`);
    content.innerHTML=`<section class="panel smart-list-panel"><div class="panel-header"><div><h2>${state.role==="TECNICO"?"Mis solicitudes de vacaciones":"Solicitudes de vacaciones"}</h2><p class="muted">Busca por empleado o motivo y filtra por estado.</p></div></div><div class="panel-body">${smartControls("vacaciones",{placeholder:"Empleado, motivo u observaciones",filters:[{name:"estado",label:"Estado",options:states}],sorts:[["solicitada","Fecha de solicitud"],["inicio","Inicio"],["empleado","Empleado"],["estado","Estado"]]})}${smartResultsMeta(result,"solicitudes")}</div>${table(["Empleado","Solicitada","Inicio","Fin","Días","Estado","Motivo"],rows,"No hay vacaciones que coincidan con los filtros.")}${smartPager("vacaciones",result)}</section>`;
    window.lucide?.createIcons();
  }


  function catalogPriceView(value) {
    const n = normalizeNumber(value);
    return n > 0 ? money(n, "GTQ") : `<span class="catalog-price-empty">Por definir</span>`;
  }

  function catalogFilteredItems() {
    const result=smartListData("catalogo",state.masterCatalog||[],{
      defaults:{orden:"nombre",direccion:"ASC"},
      search:x=>[x.codigo,x.nombre,x.categoria,x.descripcion,x.unidad,x.origen],
      filters:{categoria:x=>String(x.categoria||""),estado:x=>x.activo?"ACTIVO":"INACTIVO"},
      sort:{nombre:x=>x.nombre||"",codigo:x=>x.codigo||"",categoria:x=>x.categoria||"",precio:x=>Number(x.precio||0),estado:x=>x.activo?1:0}
    });
    return result;
  }


  function paintCatalogRows() {
    const host = $("#catalogTableHost");
    if (!host) return;
    const result = catalogFilteredItems();
    const rows = result.items.map(x => `<tr>
      <td class="mono">${esc(x.codigo)}</td>
      <td><strong>${esc(x.nombre)}</strong>${x.descripcion ? `<small class="table-subline">${esc(x.descripcion)}</small>` : ""}</td>
      <td>${esc(x.categoria || "General")}</td>
      <td class="catalog-price-cell">${catalogPriceView(x.precio)}</td>
      <td>${esc(x.unidad || "servicio")}</td>
      <td>${badge(x.activo ? "ACTIVO" : "INACTIVO")}</td>
      <td><span class="catalog-origin ${x.origen === "SISTEMA" ? "db" : "custom"}">${x.origen === "SISTEMA" ? "Servicio base" : "Personalizado"}</span></td>
      <td><div class="actions">${button("Editar", "editar-catalogo", x.id)}${button(x.activo ? "Desactivar" : "Activar", "toggle-catalogo", x.id, x.activo ? "danger" : "")}</div></td>
    </tr>`);
    host.innerHTML = `${table(["Código","Trabajo / servicio","Categoría","Precio base","Unidad","Estado","Origen","Acciones"], rows, "No hay trabajos que coincidan con los filtros.")}${smartPager("catalogo",result)}`;
    const count = $("#catalogVisibleCount"); if (count) count.textContent = String(result.total);
    window.lucide?.createIcons();
  }


  async function renderCatalogoMaestro(){
    setHeading("Catálogo maestro", "Centraliza los trabajos y precios de referencia que coordinación utiliza al preparar cotizaciones.");
    const all=(await loadAllPaged("catalogo","/api/catalogo-maestro")).items;
    state.masterCatalog=all;
    const categories=smartUnique(all,x=>x.categoria||"");
    const active=all.filter(x=>x.activo).length,withPrice=all.filter(x=>Number(x.precio||0)>0).length;
    const prefs=smartPrefs("catalogo",{orden:"nombre",direccion:"ASC"});
    content.innerHTML = `<section class="catalog-summary-grid"><article class="catalog-summary-card"><span><i data-lucide="book-open-check"></i></span><div><small>Trabajos registrados</small><strong>${all.length}</strong></div></article><article class="catalog-summary-card"><span><i data-lucide="circle-check-big"></i></span><div><small>Activos</small><strong>${active}</strong></div></article><article class="catalog-summary-card accent"><span><i data-lucide="badge-dollar-sign"></i></span><div><small>Con precio definido</small><strong>${withPrice}</strong></div></article></section>
      <section class="panel catalog-master-panel smart-list-panel"><div class="panel-header catalog-master-header"><div><h2>Listado maestro</h2><p class="muted"><span id="catalogVisibleCount">0</span> resultados según filtros.</p></div><button class="btn primary" type="button" data-action="nuevo-catalogo"><i data-lucide="plus"></i> Nuevo trabajo</button></div><div class="panel-body">${smartControls("catalogo",{placeholder:"Código, trabajo, descripción o unidad",filters:[{name:"categoria",label:"Categoría",options:categories},{name:"estado",label:"Estado",options:[["ACTIVO","Activos"],["INACTIVO","Inactivos"]]}],sorts:[["nombre","Trabajo"],["codigo","Código"],["categoria","Categoría"],["precio","Precio"],["estado","Estado"]]})}</div><div id="catalogTableHost"></div></section>`;
    paintCatalogRows();
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
    setHeading("Cotizaciones", state.role === "CLIENTE" ? "Consulta el expediente completo: solicitud → orden con evidencias → cotización descargable." : "Gestiona propuestas, versiones y aprobaciones de clientes.");
    const all=(await loadAllPaged("cotizaciones","/api/cotizaciones")).items;

    if (state.role !== "COORDINADOR") {
      const states=smartUnique(all,x=>String(x.Estado||x.estado||"").toUpperCase());
      const result=smartListData("cotizaciones",all,{
        defaults:{orden:"fecha",direccion:"DESC"},
        search:x=>[x.numero,x.cliente,x.orden,x.Estado,x.estado,x.version,x.Total,x.total],
        filters:{estado:x=>String(x.Estado||x.estado||"").toUpperCase()},
        sort:{fecha:x=>smartDateValue(x.emision||x.creada),numero:x=>x.numero||"",cliente:x=>x.cliente||"",total:x=>Number(x.Total||x.total||0),estado:x=>x.Estado||x.estado||""}
      });
      const rows=result.items.map(x=>{const st=String(x.Estado||x.estado||"").toUpperCase();const actions=[button("Ver expediente","ver-expediente-cotizacion",x.id,"primary")];return `<tr><td>${esc(x.numero)}</td><td>${renderAvatarIdentity(x.cliente || "Cliente",{entity:x,className:"client-table-identity"})}</td><td>${esc(x.orden)}</td><td>${badge(st)}</td><td>${esc(x.version||"—")}</td><td>${money(x.Total||x.total,x.Moneda||x.moneda)}</td><td>${fmt(x.emision||x.creada)}</td><td><div class="actions">${actions.join("")}</div></td></tr>`;});
      const intro=`<section class="quote-client-intro"><div><span class="quote-client-intro-icon"><i data-lucide="folder-open"></i></span><div><small>EXPEDIENTE DEL SERVICIO</small><h2>Todo el proceso en un solo lugar</h2><p>Abre una cotización para consultar la solicitud original, la orden de trabajo con su collage de evidencias y finalmente descargar la cotización.</p></div></div></section>`;
      content.innerHTML=`${intro}<div class="toolbar"><div class="toolbar-left"><h2>Cotizaciones</h2><p class="muted">Solo aparecen cotizaciones disponibles para tu empresa.</p></div></div><section class="panel smart-list-panel"><div class="panel-body">${smartControls("cotizaciones",{placeholder:"Número, cliente u orden",filters:[{name:"estado",label:"Estado",options:states}],sorts:[["fecha","Fecha"],["numero","Número"],["cliente","Cliente"],["total","Total"],["estado","Estado"]]})}${smartResultsMeta(result,"cotizaciones")}</div>${table(["No.","Cliente","Orden","Estado","Versión","Total","Fecha","Acción"],rows,"No hay cotizaciones que coincidan con los filtros.")}${smartPager("cotizaciones",result)}</section>`;
      window.lucide?.createIcons();
      return;
    }

    const defaults={orden:"fecha",direccion:"DESC",tamano:15,filtros:{estado:"TODOS",fecha:"TODAS",tab:"TODAS"}};
    const prefs=smartPrefs("cotizaciones",defaults);
    prefs.filtros=Object.assign({},defaults.filtros,prefs.filtros||{});
    if (!["fecha","total"].includes(prefs.orden)) prefs.orden="fecha";

    const actualStates=smartUnique(all,x=>quoteStateKey(x.Estado||x.estado)).map(value=>[value,quoteStateLabel(value)]);
    const selectedTab=String(prefs.filtros.tab||"TODAS").toUpperCase();
    const tabCounts={
      TODAS:all.length,
      PENDIENTES:all.filter(x=>quoteTabGroup(x.Estado||x.estado)==="PENDIENTES").length,
      ENVIADAS:all.filter(x=>quoteTabGroup(x.Estado||x.estado)==="ENVIADAS").length,
      APROBADAS:all.filter(x=>quoteTabGroup(x.Estado||x.estado)==="APROBADAS").length,
      RECHAZADAS:all.filter(x=>quoteTabGroup(x.Estado||x.estado)==="RECHAZADAS").length,
      BORRADORES:all.filter(x=>quoteTabGroup(x.Estado||x.estado)==="BORRADORES").length
    };
    const tabs=[
      ["TODAS","Todas"],["PENDIENTES","Pendientes"],["ENVIADAS","Enviadas"],["APROBADAS","Aprobadas"],["RECHAZADAS","Rechazadas"],
      ...(tabCounts.BORRADORES ? [["BORRADORES","Borradores"]] : [])
    ];

    let prepared=all.filter(item=>{
      const group=quoteTabGroup(item.Estado||item.estado);
      if(selectedTab!=="TODAS" && group!==selectedTab) return false;
      if(!quoteDateFilterMatches(item,prefs.filtros.fecha)) return false;
      return true;
    });

    const result=smartListData("cotizaciones",prepared,{
      defaults,
      search:x=>[x.numero,x.cliente,x.orden,x.Estado,x.estado,x.version,x.Total,x.total],
      filters:{estado:x=>quoteStateKey(x.Estado||x.estado)},
      sort:{fecha:x=>smartDateValue(x.emision||x.creada),total:x=>Number(x.Total||x.total||0)}
    });

    const rows=result.items.map(x=>{
      const st=quoteStateKey(x.Estado||x.estado);
      const sendable=["BORRADOR","OBSERVADA","CONFIRMADA"].includes(st);
      const primary=sendable
        ? `<button class="quote-action-button" type="button" data-action="enviar-cotizacion" data-id="${esc(x.id)}"><i data-lucide="send"></i><span>Enviar</span></button>`
        : x.orden_id
          ? `<button class="quote-action-button" type="button" data-action="ver-orden" data-id="${esc(x.orden_id)}"><i data-lucide="eye"></i><span>Ver OT</span></button>`
          : `<a class="quote-action-button" href="/api/cotizaciones/${esc(x.id)}/pdf" download><i data-lucide="file-down"></i><span>PDF</span></a>`;
      const menuItems=[`<a href="/api/cotizaciones/${esc(x.id)}/pdf" download><i data-lucide="file-down"></i><span>Descargar PDF</span></a>`];
      if(x.orden_id && sendable) {
        menuItems.push(`<button type="button" data-action="ver-orden" data-id="${esc(x.orden_id)}"><i data-lucide="clipboard-list"></i><span>Ver OT</span></button>`);
      }
      const client=renderAvatarIdentity(x.cliente||"Cliente",{entity:x,className:"quote-client-identity",subtitle:x.orden?`Orden: ${x.orden}`:"Sin OT vinculada"});
      return `<tr>
        <td data-label="Documento"><div class="quote-document"><strong>${esc(x.numero||`Cotización #${x.id}`)}</strong><div><span>${quoteDateShort(x.emision||x.creada)} • Versión ${esc(x.version||"—")}</span><em>ACTUAL</em></div></div></td>
        <td data-label="Cliente">${client}</td>
        <td data-label="Finanzas y estado"><div class="quote-finance"><strong>${money(x.Total||x.total,x.Moneda||x.moneda)}</strong>${quoteStatusBadge(st)}</div></td>
        <td data-label="Acciones"><div class="quote-row-actions">${primary}<details class="quote-row-menu"><summary aria-label="Más acciones"><i data-lucide="ellipsis"></i></summary><div class="quote-row-menu-popover">${menuItems.join("")}</div></details></div></td>
      </tr>`;
    }).join("");

    const tableMarkup=result.total?`<div class="quote-table-scroll"><table class="quote-table"><thead><tr><th>Documento</th><th>Cliente</th><th>Finanzas y estado</th><th>Acciones</th></tr></thead><tbody>${rows}</tbody></table></div>${quotePager(result)}`:`<div class="quote-empty"><span><i data-lucide="receipt-text"></i></span><h3>${(prefs.q||prefs.filtros.estado!=="TODOS"||prefs.filtros.fecha!=="TODAS"||selectedTab!=="TODAS")?"No encontramos cotizaciones con estos filtros.":"No encontramos cotizaciones."}</h3><p>${(prefs.q||prefs.filtros.estado!=="TODOS"||prefs.filtros.fecha!=="TODAS"||selectedTab!=="TODAS")?"Prueba cambiando el estado, la fecha o la búsqueda.":"Puedes crear una nueva cotización para comenzar."}</p>${(prefs.q||prefs.filtros.estado!=="TODOS"||prefs.filtros.fecha!=="TODAS"||selectedTab!=="TODAS")?`<button class="btn small" type="button" data-action="smart-reset" data-list-key="cotizaciones"><i data-lucide="rotate-ccw"></i><span>Limpiar filtros</span></button>`:`<button class="btn small primary" type="button" data-action="nueva-cotizacion"><i data-lucide="plus"></i><span>Nueva cotización</span></button>`}</div>`;

    const quoteSortValue=prefs.orden==="total"?(prefs.direccion==="ASC"?"TOTAL_ASC":"TOTAL_DESC"):(prefs.direccion==="ASC"?"FECHA_ASC":"FECHA_DESC");
    content.innerHTML=`<section class="quotes-workspace">
      <header class="quotes-page-header">
        <div class="quotes-page-copy"><span class="quotes-eyebrow">SEPRIGUA · FINANZAS</span><h2>Cotizaciones</h2><p>Gestiona propuestas, versiones y aprobaciones de clientes.</p></div>
        <button class="quotes-create-button" type="button" data-action="nueva-cotizacion"><i data-lucide="plus"></i><span>Nueva cotización</span></button>
      </header>

      <div class="quotes-tabs-row">
        <nav class="quotes-tabs" aria-label="Estado de cotizaciones">${tabs.map(([value,label])=>`<button type="button" class="quote-tab ${selectedTab===value?"active":""}" data-action="quote-tab" data-value="${value}"><span>${esc(label)}</span><strong>${tabCounts[value]}</strong></button>`).join("")}</nav>
        <button class="quotes-catalog-link" type="button" data-context-module="catalogo"><i data-lucide="book-open-check"></i><span>Catálogo y precios</span></button>
      </div>

      <section class="quotes-filters" aria-label="Filtros de cotizaciones">
        <label class="quotes-filter quotes-search"><span>Buscar</span><div><i data-lucide="search"></i><input type="search" data-smart-q="cotizaciones" value="${esc(prefs.q||"")}" placeholder="Buscar cotización, cliente u orden..." autocomplete="off"></div></label>
        <label class="quotes-filter"><span>Estado</span><select data-smart-filter="estado" data-smart-key="cotizaciones">${smartOptions(actualStates,prefs.filtros.estado,"Todos")}</select></label>
        <label class="quotes-filter"><span>Fecha</span><select data-smart-filter="fecha" data-smart-key="cotizaciones"><option value="TODAS" ${prefs.filtros.fecha==="TODAS"?"selected":""}>Todas las fechas</option><option value="HOY" ${prefs.filtros.fecha==="HOY"?"selected":""}>Hoy</option><option value="SEMANA" ${prefs.filtros.fecha==="SEMANA"?"selected":""}>Esta semana</option><option value="MES" ${prefs.filtros.fecha==="MES"?"selected":""}>Este mes</option></select></label>
        <button class="quotes-clear" type="button" data-action="smart-reset" data-list-key="cotizaciones"><i data-lucide="rotate-ccw"></i><span>Limpiar</span></button>
      </section>

      <section class="quotes-list-section">
        <div class="quotes-list-toolbar"><div><strong>Cotizaciones</strong><span>${result.total} resultado${result.total===1?"":"s"}</span></div><label><span>Ordenar por</span><select data-quote-sort><option value="FECHA_DESC" ${quoteSortValue==="FECHA_DESC"?"selected":""}>Más recientes</option><option value="FECHA_ASC" ${quoteSortValue==="FECHA_ASC"?"selected":""}>Más antiguas</option><option value="TOTAL_DESC" ${quoteSortValue==="TOTAL_DESC"?"selected":""}>Mayor total</option><option value="TOTAL_ASC" ${quoteSortValue==="TOTAL_ASC"?"selected":""}>Menor total</option></select></label></div>
        ${tableMarkup}
      </section>
    </section>`;
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
          <div class="quote-collage-head"><div><small>EVIDENCIA DEL SERVICIO</small><h3>Collage de imágenes</h3></div><div class="actions"><span>${evidence.length} foto${evidence.length===1?"":"s"}</span>${x.orden_id&&evidence.length?`<a class="btn small" href="/api/ordenes/${esc(x.orden_id)}/collage.jpg" target="_blank" rel="noopener"><i data-lucide="images"></i> Ver collage automático</a><a class="btn small primary" href="/api/ordenes/${esc(x.orden_id)}/collage.jpg?download=1" download><i data-lucide="download"></i> Descargar</a>`:""}</div></div>
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

  function documentHubHeader(tab) {
    if (state.role === "CLIENTE") return "";
    const serviceTab = state.role === "COORDINADOR" ? `<button class="document-hub-tab ${tab==="servicio"?"active":""}" type="button" data-action="documentos-tab" data-tab="servicio"><i data-lucide="file-check-2"></i><span><strong>Documentos del servicio</strong><small>OT, reportes y entregables</small></span></button>` : "";
    const laborTab = `<button class="document-hub-tab ${tab==="laboral"?"active":""}" type="button" data-action="documentos-tab" data-tab="laboral"><i data-lucide="folder-user"></i><span><strong>${state.role==="TECNICO"?"Mi expediente":"Expedientes de personal"}</strong><small>${state.role==="TECNICO"?"Mis documentos laborales":"CV, DPI, permisos y constancias"}</small></span></button>`;
    return `<section class="document-hub"><div class="document-hub-copy"><span class="document-hub-icon"><i data-lucide="folders"></i></span><div><span class="document-hub-kicker">ARCHIVO DIGITAL</span><h2>Centro de documentos</h2><p>${state.role==="COORDINADOR"?"Consulta los documentos de los servicios y mantén organizado el expediente de cada empleado.":"Consulta y agrega documentos de tu expediente laboral."}</p></div></div><div class="document-hub-tabs">${serviceTab}${laborTab}</div></section>`;
  }

  async function documentLaborUploadForm(employeeId="") {
    const data=await api("/api/documentos-laborales/catalogos");
    const employees=data.empleados||[];
    const selected=employeeId||state.documentos.empleadoId||employees[0]?.id||"";
    const employeeField=state.role==="COORDINADOR"?`<div class="field full"><label>Empleado</label><select name="empleado_id" required><option value="">Selecciona...</option>${optionList(employees,"id",x=>`${x.codigo||""} · ${x.nombre}${x.puesto?` · ${x.puesto}`:""}`,selected)}</select><small>El documento quedará relacionado con el expediente de esta persona.</small></div>`:"";
    const types=(data.tipos||[]).map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join("");
    openModal("Subir documento al expediente",`<form id="laborDocumentForm" class="form-grid" enctype="multipart/form-data">
      ${employeeField}
      <div class="field"><label>Tipo de documento</label><select name="tipo_documento" required>${types}</select></div>
      <div class="field"><label>Número / referencia (opcional)</label><input name="numero_documento" maxlength="80" placeholder="Ej. número de DPI o referencia"></div>
      <div class="field"><label>Fecha de emisión (opcional)</label><input type="date" name="fecha_emision"></div>
      <div class="field"><label>Fecha de vencimiento (opcional)</label><input type="date" name="fecha_vencimiento"></div>
      <div class="field full"><label>Archivo</label><input type="file" name="archivo" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp" required><small>PDF, Word o imagen. Máximo 20 MB.</small></div>
      <div class="field full"><label>Observaciones (opcional)</label><textarea name="observaciones" maxlength="500" placeholder="Notas para el expediente"></textarea></div>
      ${state.role==="COORDINADOR"?`<label class="document-check"><input type="checkbox" name="verificado" value="1"><span>Marcar como revisado y verificado</span></label>`:""}
      <div class="field full"><div class="form-actions"><button class="btn" type="button" data-close-modal>Cancelar</button><button class="btn primary" type="submit"><i data-lucide="upload-cloud"></i> Guardar documento</button></div></div>
    </form>`);
    const form=$("#laborDocumentForm");
    form?.addEventListener("submit",async e=>{
      e.preventDefault();const submit=form.querySelector('button[type="submit"]');submit.disabled=true;
      try{const fd=new FormData(form);const result=await api("/api/documentos-laborales",{method:"POST",body:fd});showToast(result.message||"Documento guardado.");closeModal();invalidateListCache("documentos-laborales");await renderDocumentos();}
      catch(err){showToast(err.message,"error");}finally{submit.disabled=false;}
    });
    window.lucide?.createIcons();
  }

  async function renderLaborDocuments() {
    const suffix=state.role==="COORDINADOR"&&state.documentos.empleadoId?`?empleado_id=${encodeURIComponent(state.documentos.empleadoId)}`:"";
    const payload=await api(`/api/documentos-laborales${suffix}`);
    const all=payload.items||[];
    const types=smartUnique(all,x=>String(x.tipo_documento||"").toUpperCase());
    const employees=smartUnique(all,x=>x.empleado||"");
    const result=smartListData("documentos-laborales",all,{
      defaults:{orden:"creado",direccion:"DESC"},
      search:x=>[x.codigo_empleado,x.empleado,x.puesto,x.tipo_documento,x.numero_documento,x.observaciones],
      filters:{tipo:x=>String(x.tipo_documento||"").toUpperCase(),empleado:x=>x.empleado||"",vigencia:x=>x.activo?"ACTIVO":"ARCHIVADO",verificado:x=>x.verificado?"VERIFICADO":"PENDIENTE"},
      sort:{creado:x=>smartDateValue(x.creado),empleado:x=>x.empleado||"",tipo:x=>x.tipo_documento||"",vencimiento:x=>smartDateValue(x.fecha_vencimiento)}
    });
    const filters=[{name:"tipo",label:"Tipo",options:types},{name:"vigencia",label:"Vigencia",options:[["ACTIVO","Activo"],["ARCHIVADO","Archivado"]]},{name:"verificado",label:"Revisión",options:[["VERIFICADO","Verificado"],["PENDIENTE","Pendiente"]]}];
    if(state.role==="COORDINADOR"&&!state.documentos.empleadoId)filters.unshift({name:"empleado",label:"Empleado",options:employees});
    const rows=result.items.map(x=>{
      const verify=state.role==="COORDINADOR"&&!x.verificado?button("Verificar","verificar-documento-laboral",x.id):"";
      const active=state.role==="COORDINADOR"?button(x.activo?"Archivar":"Reactivar","estado-documento-laboral",x.id,x.activo?"":"primary"):"";
      return `<tr><td><strong>${esc(x.empleado||"—")}</strong><br><small class="muted">${esc(x.codigo_empleado||"")} · ${esc(x.puesto||"—")}</small></td><td>${esc(x.tipo_documento||"—")}</td><td>${esc(x.numero_documento||"—")}</td><td>${x.fecha_vencimiento?fmt(x.fecha_vencimiento):"—"}</td><td>${x.verificado?`<span class="badge green">VERIFICADO</span>`:`<span class="badge orange">PENDIENTE</span>`}</td><td>${x.activo?`<span class="badge green">ACTIVO</span>`:`<span class="badge">ARCHIVADO</span>`}</td><td><div class="actions compact"><a class="btn small" href="${esc(x.archivo_url)}" target="_blank" rel="noopener">Abrir</a><a class="btn small" href="${esc(x.archivo_url)}?download=1">Descargar</a>${verify}${active}</div></td></tr>`;
    });
    const selectedNote=state.role==="COORDINADOR"&&state.documentos.empleadoId?`<button class="btn small" type="button" data-action="limpiar-expediente-personal"><i data-lucide="users"></i> Ver todos los empleados</button>`:"";
    return `<section class="panel smart-list-panel labor-documents-panel"><div class="panel-header"><div><h2>${state.role==="TECNICO"?"Mis documentos laborales":"Expedientes de personal"}</h2><p class="muted">Currículum, DPI, antecedentes, permisos, constancias y otros documentos del expediente.</p></div><div class="actions">${selectedNote}<button class="btn primary" type="button" data-action="subir-documento-laboral"><i data-lucide="file-up"></i> Subir documento</button></div></div><div class="panel-body">${smartControls("documentos-laborales",{placeholder:"Empleado, documento, puesto o referencia",filters,sorts:[["creado","Fecha de carga"],["empleado","Empleado"],["tipo","Tipo"],["vencimiento","Vencimiento"]]})}${smartResultsMeta(result,"documentos")}</div>${table(["Empleado","Documento","Número / referencia","Vencimiento","Revisión","Vigencia","Acciones"],rows,"No hay documentos laborales que coincidan con los filtros.")}${smartPager("documentos-laborales",result)}</section>`;
  }

  async function renderServiceDocuments() {
    const all=(await loadAllPaged("documentos","/api/documentos")).items;
    const states=smartUnique(all,x=>String(x.Estado||x.estado||"").toUpperCase());
    const categories=smartUnique(all,x=>String(x.categoria||"").toUpperCase());
    const result=smartListData("documentos",all,{
      defaults:{orden:"generado",direccion:"DESC"},
      search:x=>[x.numero,x.formato,x.categoria,x.orden,x.cliente,x.Estado,x.estado],
      filters:{estado:x=>String(x.Estado||x.estado||"").toUpperCase(),categoria:x=>String(x.categoria||"").toUpperCase()},
      sort:{generado:x=>smartDateValue(x.generado||x.entregado),documento:x=>x.numero||"",cliente:x=>x.cliente||"",formato:x=>x.formato||"",estado:x=>x.Estado||x.estado||""}
    });
    const rows=result.items.map(x=>`<tr><td>${esc(x.numero||`#${x.id}`)}</td><td>${esc(x.formato)}</td><td>${esc(x.orden)}</td><td>${esc(x.cliente)}</td><td>${badge(x.Estado||x.estado)}</td><td>${fmt(x.generado)}</td><td>${x.ruta?`<a class="btn small" href="${esc(x.ruta)}" target="_blank" rel="noopener">Abrir</a>`:"—"}</td></tr>`);
    return `<section class="panel smart-list-panel"><div class="panel-header"><div><h2>Documentos del servicio</h2><p class="muted">Busca por documento, formato, OT o cliente.</p></div></div><div class="panel-body">${smartControls("documentos",{placeholder:"Documento, formato, orden o cliente",filters:[{name:"estado",label:"Estado",options:states},{name:"categoria",label:"Categoría",options:categories}],sorts:[["generado","Fecha"],["documento","Documento"],["cliente","Cliente"],["formato","Formato"],["estado","Estado"]]})}${smartResultsMeta(result,"documentos")}</div>${table(["Documento","Formato","Orden","Cliente","Estado","Generado","Archivo"],rows,"No hay documentos que coincidan con los filtros.")}${smartPager("documentos",result)}</section>`;
  }

  async function renderDocumentos(){
    const defaultTab=state.role==="TECNICO"?"laboral":"servicio";
    if(state.role==="CLIENTE")state.documentos.tab="servicio";
    else if(state.role==="TECNICO")state.documentos.tab="laboral";
    else if(!["servicio","laboral"].includes(state.documentos.tab))state.documentos.tab=defaultTab;
    setHeading(state.role==="TECNICO"?"Mis documentos":"Documentos",state.role==="TECNICO"?"Expediente laboral y archivos personales autorizados.":"Archivo digital de servicios y expedientes de personal.");
    const hub=documentHubHeader(state.documentos.tab);
    const body=state.documentos.tab==="laboral"?await renderLaborDocuments():await renderServiceDocuments();
    content.innerHTML=hub+body;
    window.lucide?.createIcons();
  }


  function paintNotificationList() {
    const host = $("#notificationList");
    if (!host) return;
    const source = state.notifications || [];
    const result=smartListData("notificaciones",source,{
      defaults:{orden:"fecha",direccion:"DESC"},
      search:x=>[x.titulo,x.mensaje,x.tipo,x.canal,x.entidad],
      filters:{lectura:x=>x.leida?"LEIDAS":"NO_LEIDAS",tipo:x=>String(x.tipo||"").toUpperCase()},
      sort:{fecha:x=>smartDateValue(x.creada),titulo:x=>x.titulo||"",tipo:x=>x.tipo||"",lectura:x=>x.leida?1:0}
    });
    if (!result.items.length) {
      host.innerHTML = `<div class="notification-empty"><span><i data-lucide="bell-off"></i></span><h3>No hay notificaciones</h3><p>No hay avisos que coincidan con los filtros actuales.</p></div>${smartPager("notificaciones",result)}`;
      window.lucide?.createIcons(); return;
    }
    host.innerHTML = result.items.map(x => `<article class="notification-card ${x.leida ? "is-read" : "is-unread"}"><div class="notification-card-icon"><i data-lucide="${notificationIcon(x.tipo)}"></i></div><div class="notification-card-copy"><div class="notification-card-title"><strong>${esc(x.titulo)}</strong>${x.leida ? `<span class="read-label">Leída</span>` : `<span class="unread-label">Nueva</span>`}</div><p>${esc(x.mensaje)}</p><div class="notification-card-meta"><span>${esc(String(x.tipo || "AVISO").replaceAll("_", " "))}</span><span>•</span><time>${fmt(x.creada)}</time>${x.canal ? `<span>•</span><span>${esc(x.canal)}</span>` : ""}</div></div><div class="notification-card-actions">${notificationTargetButton(x)}${!x.leida ? button("Marcar leída", "leer-notificacion", x.id) : ""}</div></article>`).join("") + smartPager("notificaciones",result);
    window.lucide?.createIcons();
  }


  async function renderNotificaciones(){
    setHeading("Notificaciones", "Avisos de solicitudes, asignaciones, órdenes, cambios de alcance y cotizaciones.");
    const loaded=await loadAllPaged("notificaciones","/api/notificaciones?filtro=TODAS");
    state.notifications=loaded.items||[];
    const unread=state.notifications.filter(x=>!x.leida).length,total=state.notifications.length,read=total-unread;
    state.unreadNotifications=unread;
    const types=smartUnique(state.notifications,x=>String(x.tipo||"").toUpperCase());
    const result=smartListData("notificaciones",state.notifications,{defaults:{orden:"fecha",direccion:"DESC"},search:x=>[x.titulo,x.mensaje,x.tipo,x.canal],filters:{lectura:x=>x.leida?"LEIDAS":"NO_LEIDAS",tipo:x=>String(x.tipo||"").toUpperCase()},sort:{fecha:x=>smartDateValue(x.creada),titulo:x=>x.titulo||"",tipo:x=>x.tipo||"",lectura:x=>x.leida?1:0}});
    content.innerHTML=`<section class="notification-summary-grid"><article class="notification-summary-card"><span class="summary-icon"><i data-lucide="bell-ring"></i></span><div><small>Total de avisos</small><strong>${total}</strong></div></article><article class="notification-summary-card accent"><span class="summary-icon"><i data-lucide="circle-alert"></i></span><div><small>Pendientes de leer</small><strong>${unread}</strong></div></article><article class="notification-summary-card"><span class="summary-icon"><i data-lucide="circle-check-big"></i></span><div><small>Revisadas</small><strong>${read}</strong></div></article></section><section class="panel notification-center smart-list-panel"><div class="panel-header notification-center-header"><div><h2>Centro de notificaciones</h2><p class="muted">Cada usuario ve únicamente los avisos asociados a su cuenta.</p></div><div class="actions"><button class="btn small" type="button" data-action="refrescar-notificaciones"><i data-lucide="refresh-cw"></i> Actualizar</button><button class="btn small primary" type="button" data-action="leer-todas-notificaciones" ${unread?"":"disabled"}>Marcar todas leídas</button></div></div><div class="panel-body">${smartControls("notificaciones",{placeholder:"Título, mensaje o tipo",filters:[{name:"lectura",label:"Lectura",options:[["NO_LEIDAS","No leídas"],["LEIDAS","Leídas"]]},{name:"tipo",label:"Tipo",options:types}],sorts:[["fecha","Fecha"],["titulo","Título"],["tipo","Tipo"],["lectura","Lectura"]]})}${smartResultsMeta(result,"avisos")}</div><div class="notification-list" id="notificationList"></div></section>`;
    paintNotificationList();refreshNotificationBadge().catch(()=>{});window.lucide?.createIcons();
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

  function rolePortalLabel(portal){
    return ({COORDINADOR:"Coordinación",TECNICO:"Técnico",CLIENTE:"Cliente"})[String(portal||"").toUpperCase()]||"Sin definir";
  }

  function roleAccessForm(role=null){
    const data=state.rolesAccess.data||{};
    const modules=data.modulos||[];
    const currentPortal=String(role?.portal||"COORDINADOR").toUpperCase();
    const selected=new Set(role?.modulos||["dashboard","cuenta"]);
    const groups=[...new Set(modules.map(m=>m.grupo))];
    const portalOptions=(data.portales||[]).map(p=>`<option value="${esc(p.codigo)}" ${String(p.codigo)===currentPortal?"selected":""}>${esc(p.nombre)}</option>`).join("");
    const checks=groups.map(group=>`<fieldset class="role-module-group"><legend>${esc(group)}</legend><div class="role-module-grid">${modules.filter(m=>m.grupo===group).map(m=>`<label class="role-module-option" data-portals="${esc((m.portales||[]).join(','))}"><input type="checkbox" name="modulos" value="${esc(m.key)}" ${selected.has(m.key)||m.obligatorio?"checked":""} ${m.obligatorio||role?.protegido?"disabled":""}><span class="role-module-check"><i data-lucide="check"></i></span><span><strong>${esc(m.nombre)}</strong><small>${m.obligatorio?"Acceso básico obligatorio":`Disponible para ${esc((m.portales||[]).map(rolePortalLabel).join(', '))}`}</small></span></label>`).join("")}</div></fieldset>`).join("");
    openModal(role?`Editar rol · ${role.nombre}`:"Crear nuevo rol",`<form id="roleAccessForm" class="form-grid role-access-form">
      <div class="role-form-intro full"><span><i data-lucide="shield-user"></i></span><div><strong>${role?"Configura el acceso del rol":"Nuevo perfil de acceso"}</strong><p>El tipo de portal define la experiencia base y los módulos determinan qué apartados podrá abrir.</p></div></div>
      <div class="field"><label>Nombre del rol</label><input name="nombre" maxlength="60" value="${esc(role?.nombre||"")}" ${role?.sistema?"readonly":""} required placeholder="Ej. Supervisor, RRHH, Ventas"></div>
      <div class="field"><label>Tipo de portal</label><select name="portal" ${role?.sistema?"disabled":""} required>${portalOptions}</select>${role?.sistema?`<input type="hidden" name="portal" value="${esc(currentPortal)}">`:""}<small>Define la lógica base que heredará el rol.</small></div>
      <div class="field full"><label>Descripción</label><textarea name="descripcion" maxlength="300" placeholder="Responsabilidad principal de este rol...">${esc(role?.descripcion||"")}</textarea></div>
      <div class="field full"><label class="switch-row"><input type="checkbox" name="activo" ${role?.activo!==false?"checked":""} ${role?.sistema?"disabled":""}><span>Rol activo</span></label>${role?.sistema?`<small>Los roles base permanecen activos; puedes ajustar sus módulos sin desactivarlos.</small>`:""}</div>
      <div class="field full role-modules-field"><div class="role-modules-heading"><div><label>Módulos permitidos</label><small>Selecciona únicamente los apartados que este rol podrá abrir.</small></div><button class="btn small" type="button" data-role-select-compatible>Seleccionar compatibles</button></div>${checks}</div>
      <div class="field full"><div class="form-actions"><button class="btn" type="button" data-close-modal>Cancelar</button><button class="btn primary" type="submit"><i data-lucide="save"></i> ${role?"Guardar accesos":"Crear rol"}</button></div></div>
    </form>`,{locked:false});
    const form=$("#roleAccessForm");
    const portalSelect=form.querySelector('select[name="portal"]');
    const portalValue=()=>String(portalSelect?.value||form.querySelector('input[name="portal"]')?.value||currentPortal).toUpperCase();
    const sync=()=>{
      const portal=portalValue();
      form.querySelectorAll(".role-module-option").forEach(label=>{
        const allowed=String(label.dataset.portals||"").split(",").includes(portal);
        const input=label.querySelector('input[name="modulos"]');
        label.classList.toggle("disabled",!allowed);
        if(!allowed){ input.checked=false; input.disabled=true; }
        else if(!input.dataset.coreLocked && !role?.protegido){
          const mod=(data.modulos||[]).find(m=>m.key===input.value);
          input.disabled=Boolean(mod?.obligatorio);
          if(mod?.obligatorio) input.checked=true;
        }
      });
    };
    form.querySelectorAll('input[name="modulos"]').forEach(input=>{if(input.disabled)input.dataset.coreLocked="1";});
    portalSelect?.addEventListener("change",sync);
    form.querySelector("[data-role-select-compatible]")?.addEventListener("click",()=>{
      const portal=portalValue();
      form.querySelectorAll(".role-module-option").forEach(label=>{
        const input=label.querySelector('input[name="modulos"]');
        const allowed=String(label.dataset.portals||"").split(",").includes(portal);
        if(allowed)input.checked=true;
      });
    });
    sync();
    form.addEventListener("submit",async e=>{
      e.preventDefault();
      const payload={
        nombre:form.nombre.value.trim(),
        portal:portalValue(),
        descripcion:form.descripcion.value.trim(),
        activo:role?.sistema?true:Boolean(form.activo?.checked),
        modulos:[...form.querySelectorAll('input[name="modulos"]:checked')].map(x=>x.value)
      };
      const submit=form.querySelector('button[type="submit"]');submit.disabled=true;
      try{
        const r=await api(role?`/api/roles-accesos/${role.id}`:"/api/roles-accesos",{method:role?"PATCH":"POST",body:payload});
        showToast(r.message||"Rol actualizado.");closeModal();state.rolesAccess.data=null;state.userAdmin.catalogos=null;await renderRolesAccess();
      }catch(err){showToast(err.message,"error");submit.disabled=false;}
    });
    window.lucide?.createIcons();
  }

  async function renderRolesAccess(){
    if(!state.isMasterCoordinator) throw new Error("Solo el Coordinador principal puede administrar roles y módulos.");
    setHeading("Roles y accesos", "Crea perfiles y decide exactamente qué módulos puede abrir cada rol del sistema.");
    const data=await api("/api/roles-accesos");state.rolesAccess.data=data;
    const roles=data.roles||[];
    const custom=roles.filter(r=>!r.sistema).length;
    const assigned=roles.reduce((sum,r)=>sum+Number(r.usuarios||0),0);
    const rows=roles.map(r=>{
      const portal=rolePortalLabel(r.portal);
      const tone=String(r.portal||r.nombre||"").toLowerCase().includes("coord")?"coordinator":String(r.portal||r.nombre||"").toLowerCase().includes("tec")?"technician":String(r.portal||r.nombre||"").toLowerCase().includes("client")?"client":"custom";
      const modules=(r.modulos||[]).map(key=>{const m=(data.modulos||[]).find(x=>x.key===key);return m?`<span>${esc(m.nombre)}</span>`:"";}).join("")||'<span class="empty">Sin módulos asignados</span>';
      return `<article class="role-access-card role-tone-${tone} ${r.activo?"":"inactive"}">
        <div class="role-access-card-top"><div class="role-access-main"><span class="role-access-icon"><i data-lucide="${r.protegido?"shield-check":"shield-user"}"></i></span><div class="role-access-heading"><div class="role-access-title"><h3>${esc(r.nombre)}</h3>${r.sistema?'<span class="role-system-pill">ROL BASE</span>':''}${!r.activo?'<span class="role-inactive-pill">INACTIVO</span>':''}</div><p>${esc(r.descripcion||"Sin descripción")}</p></div></div><span class="role-status-dot ${r.activo?"is-active":"is-inactive"}"><i data-lucide="${r.activo?"circle-check":"circle-pause"}"></i>${r.activo?"Activo":"Inactivo"}</span></div>
        <div class="role-access-stats"><div><span class="role-stat-icon"><i data-lucide="panels-top-left"></i></span><span><small>Portal</small><strong>${esc(portal)}</strong></span></div><div><span class="role-stat-icon"><i data-lucide="users"></i></span><span><small>Usuarios</small><strong>${normalizeNumber(r.usuarios)}</strong></span></div><div><span class="role-stat-icon"><i data-lucide="blocks"></i></span><span><small>Módulos</small><strong>${normalizeNumber((r.modulos||[]).length)}</strong></span></div></div>
        <div class="role-access-modules"><div class="role-access-modules-head"><span>Módulos habilitados</span><strong>${normalizeNumber((r.modulos||[]).length)}</strong></div><div class="role-module-chips">${modules}</div></div>
        <div class="role-access-actions">${r.protegido?'<span class="protected-role-note"><i data-lucide="lock-keyhole"></i><span><strong>Acceso total protegido</strong><small>Este rol conserva acceso completo al sistema.</small></span></span>':`<button class="btn small role-edit-button" type="button" data-role-edit="${esc(r.id)}"><i data-lucide="pencil"></i><span>Editar rol y módulos</span><i data-lucide="arrow-right"></i></button>`}</div>
      </article>`;
    }).join("");
    content.innerHTML=`<section class="roles-access-hero"><div class="roles-access-hero-main"><span class="roles-access-hero-icon"><i data-lucide="shield-check"></i></span><div><span class="section-kicker">CONTROL DE ACCESO</span><h2>Permisos por rol y por módulo</h2><p>Administra quién puede entrar a cada área del portal sin alterar la operación del sistema.</p></div></div><button class="btn primary roles-create-button" type="button" id="newRoleAccess"><i data-lucide="shield-plus"></i><span>Crear rol</span></button></section>
      <section class="roles-access-summary"><article class="role-summary-card role-summary-blue"><span><i data-lucide="shield-user"></i></span><div><small>Roles registrados</small><strong>${roles.length}</strong><p>Perfiles disponibles en el portal</p></div></article><article class="role-summary-card role-summary-cyan"><span><i data-lucide="sparkles"></i></span><div><small>Personalizados</small><strong>${custom}</strong><p>Roles creados por Coordinación</p></div></article><article class="role-summary-card role-summary-green"><span><i data-lucide="users-round"></i></span><div><small>Cuentas vinculadas</small><strong>${assigned}</strong><p>Usuarios asignados a roles</p></div></article></section>
      <section class="panel roles-access-panel"><div class="panel-header roles-access-panel-head"><div><span class="section-kicker">ROLES DEL SISTEMA</span><h2>Perfiles y permisos</h2><p class="muted">Coordinador mantiene acceso total; Técnico y Cliente pueden ajustarse por módulos.</p></div><span class="roles-security-pill"><i data-lucide="lock-keyhole"></i> Acceso protegido</span></div><div class="panel-body roles-access-list">${rows||'<div class="empty-state">No hay roles registrados.</div>'}</div></section>`;
    $("#newRoleAccess")?.addEventListener("click",()=>roleAccessForm());
    content.querySelectorAll("[data-role-edit]").forEach(btn=>btn.addEventListener("click",()=>{const role=roles.find(r=>String(r.id)===String(btn.dataset.roleEdit));if(role)roleAccessForm(role);}));
    window.lucide?.createIcons();
  }

  async function renderCuenta(){
    setHeading("Mi cuenta", "Consulta tus datos, protege tu contraseña y administra las sesiones activas de tu usuario.");
    const [profileData, sessionsData, pushConfig, pushDevices]=await Promise.all([
      api("/api/cuenta"),
      api("/api/cuenta/sesiones"),
      getPushConfig(),
      api("/api/push/dispositivos").catch(()=>({items:[]}))
    ]);
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
        ${pushStatusMarkup(pushDevices.items||[], pushConfig||{})}
        <section class="panel account-panel sessions-panel"><div class="panel-header"><div><h2>Sesiones activas</h2><p class="muted">Revisa desde dónde está abierta tu cuenta.</p></div><button class="btn small danger" type="button" data-action="cerrar-otras-sesiones" ${(sessionsData.items||[]).filter(x=>!x.actual).length?"":"disabled"}>Cerrar otras sesiones</button></div><div class="panel-body"><div class="session-list">${sessions}</div></div></section>
      </div>`;
    window.lucide?.createIcons();

    $("#passwordForm")?.addEventListener("submit",async e=>{e.preventDefault();const form=e.currentTarget;const data=Object.fromEntries(new FormData(form).entries());if(data.nueva!==data.confirmacion)return showToast("La confirmación de la nueva contraseña no coincide.","error");const submit=form.querySelector('button[type="submit"]');submit.disabled=true;try{await api("/api/cuenta/contrasena",{method:"POST",body:data});form.reset();showToast("Contraseña actualizada correctamente.");refreshNotificationBadge().catch(()=>{});}catch(err){showToast(err.message,"error");}finally{submit.disabled=false;}});
  }


  async function renderAuditoria(){
    setHeading("Auditoría", "Registro de altas, cambios y bajas realizados dentro del sistema.");
    const all=(await loadAllPaged("auditoria","/api/auditoria")).items;
    const operations=smartUnique(all,x=>String(x.Operacion||x.operacion||"").toUpperCase());
    const tables=smartUnique(all,x=>`${x.Esquema||x.esquema||""}.${x.Tabla||x.tabla||""}`);
    const result=smartListData("auditoria",all,{
      defaults:{orden:"fecha",direccion:"DESC"},
      search:x=>[x.id,x.Esquema,x.esquema,x.Tabla,x.tabla,x.Operacion,x.operacion,x.usuario,x.ip,x.Observacion,x.observacion],
      filters:{operacion:x=>String(x.Operacion||x.operacion||"").toUpperCase(),tabla:x=>`${x.Esquema||x.esquema||""}.${x.Tabla||x.tabla||""}`},
      sort:{fecha:x=>smartDateValue(x.fecha),tabla:x=>`${x.Esquema||x.esquema||""}.${x.Tabla||x.tabla||""}`,operacion:x=>x.Operacion||x.operacion||"",usuario:x=>x.usuario||""}
    });
    const todayKey=gtDateKey(new Date());
    const opOf=x=>String(x.Operacion||x.operacion||"").toUpperCase();
    const summary=coordinatorCompactMetrics([
      {label:"Total eventos",value:all.length,icon:"list-checks",tone:"blue"},
      {label:"Eventos de hoy",value:all.filter(x=>gtDateKey(x.fecha)===todayKey).length,icon:"calendar-days",tone:"green"},
      {label:"Cambios",value:all.filter(x=>/UPDATE|CAMBIO|MODIFIC/.test(opOf(x))).length,icon:"pencil-line",tone:"amber"},
      {label:"Bajas",value:all.filter(x=>/DELETE|BAJA|ELIMIN/.test(opOf(x))).length,icon:"shield-alert",tone:"red"}
    ],"audit-summary");
    const rows=result.items.map(x=>`<tr><td class="mono">#${x.id}</td><td>${fmt(x.fecha)}</td><td>${esc(x.Esquema||x.esquema)}.${esc(x.Tabla||x.tabla)}</td><td>${badge(x.Operacion||x.operacion)}</td><td>${esc(x.usuario || "Usuario")}</td><td class="mono">${esc(x.ip||"—")}</td><td>${esc(x.Observacion||x.observacion||"—")}</td></tr>`);
    content.innerHTML=`${summary}<section class="panel smart-list-panel audit-panel coord-data-surface"><div class="panel-header"><div><span class="coord-section-kicker">TRAZABILIDAD</span><h2>Eventos del sistema</h2><p class="muted">Busca por usuario, tabla, IP u observación.</p></div><button class="btn primary" type="button" data-action="probar-auditoria"><i data-lucide="shield-check"></i> Probar auditoría</button></div><div class="panel-body">${smartControls("auditoria",{placeholder:"Usuario, tabla, IP u observación",filters:[{name:"operacion",label:"Operación",options:operations},{name:"tabla",label:"Tabla",options:tables}],sorts:[["fecha","Fecha"],["tabla","Tabla"],["operacion","Operación"],["usuario","Usuario"]]})}${smartResultsMeta(result,"eventos")}</div>${table(["Registro","Fecha","Tabla","Operación","Usuario","IP","Observación"],rows,"No hay eventos que coincidan con los filtros.")}${smartPager("auditoria",result)}</section>`;
    window.lucide?.createIcons();
  }


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
    let d=state.listCache.garantia?.meta;
    if(!d){d=await api('/api/garantias');state.listCache.garantia={items:d.items||[],meta:d};}
    state.warranties=d.items||[];state.warrantyRequests=d.solicitudes||[];
    const s=d.resumen||{};
    const warrantyStates=smartUnique(state.warranties,x=>String(x.estado_garantia||'PENDIENTE_CONFIGURACION').toUpperCase());
    const warrantyResult=smartListData("garantia",state.warranties,{defaults:{orden:"finalizada",direccion:"DESC"},search:x=>[x.numero_orden,x.tipo_servicio,x.cliente,x.sede,x.estado_garantia,x.estado_solicitud],filters:{estado:x=>String(x.estado_garantia||'PENDIENTE_CONFIGURACION').toUpperCase()},sort:{finalizada:x=>smartDateValue(x.finalizada_en),orden:x=>x.numero_orden||"",cliente:x=>x.cliente||"",estado:x=>x.estado_garantia||""}});
    const stats=`<section class="stats-grid warranty-stats"><article class="stat-card stat-blue"><div class="stat-icon"><i data-lucide="clipboard-check"></i></div><div class="stat-copy"><span>OT finalizadas</span><strong>${normalizeNumber(s.finalizadas)}</strong></div></article><article class="stat-card stat-green"><div class="stat-icon"><i data-lucide="shield-check"></i></div><div class="stat-copy"><span>Garantías activas</span><strong>${normalizeNumber(s.activas)}</strong></div></article><article class="stat-card stat-amber"><div class="stat-icon"><i data-lucide="hourglass"></i></div><div class="stat-copy"><span>${coord?'Por configurar':'Pendientes'}</span><strong>${normalizeNumber(s.pendientes_configurar)}</strong></div></article><article class="stat-card stat-red"><div class="stat-icon"><i data-lucide="clock-alert"></i></div><div class="stat-copy"><span>Vencidas</span><strong>${normalizeNumber(s.vencidas)}</strong></div></article></section>`;
    const cards=warrantyResult.items.map(warrantyCard).join('')||`<div class="empty-state"><h3>No hay garantías que coincidan</h3><p>Cambia los filtros para consultar otros trabajos finalizados.</p></div>`;
    let requests="";
    if(coord){
      const reqKey="garantiaSolicitudes";const reqStates=smartUnique(state.warrantyRequests,x=>String(x.estado||"").toUpperCase());
      const reqResult=smartListData(reqKey,state.warrantyRequests,{defaults:{orden:"fecha",direccion:"DESC"},search:x=>[x.numero_orden,x.cliente,x.sede,x.tipo_servicio,x.estado,x.descripcion],filters:{estado:x=>String(x.estado||"").toUpperCase()},sort:{fecha:x=>smartDateValue(x.creado_en),orden:x=>x.numero_orden||"",cliente:x=>x.cliente||"",estado:x=>x.estado||""}});
      const requestRows=reqResult.items.map(x=>`<tr><td>${esc(x.numero_orden)}</td><td>${esc(x.cliente)}</td><td>${esc(x.sede||'—')}</td><td>${esc(x.tipo_servicio)}</td><td>${badge(x.estado)}</td><td>${fmt(x.creado_en)}</td><td><button class="btn small" data-action="estado-solicitud-garantia" data-id="${esc(x.solicitud_garantia_id)}">Gestionar</button></td></tr>`);
      requests=`<section class="panel warranty-requests-panel smart-list-panel"><div class="panel-header"><div><h2>Solicitudes de revisión</h2><p class="muted">Reclamos vinculados a una garantía y a su OT original.</p></div></div><div class="panel-body">${smartControls(reqKey,{placeholder:"OT, cliente, sede o servicio",filters:[{name:"estado",label:"Estado",options:reqStates}],sorts:[["fecha","Fecha"],["orden","OT"],["cliente","Cliente"],["estado","Estado"]]})}${smartResultsMeta(reqResult,"solicitudes")}</div>${table(['OT','Cliente','Sede','Servicio','Estado','Solicitada','Acción'],requestRows,'No hay solicitudes de revisión que coincidan con los filtros.')}${smartPager(reqKey,reqResult)}</section>`;
    }
    content.innerHTML=`<div class="warranty-workspace ${coord?"warranty-workspace-coord":"warranty-workspace-client"}">${stats}<section class="panel warranty-explainer"><div class="panel-body"><div class="warranty-explainer-icon"><i data-lucide="refresh-ccw"></i></div><div><h2>La garantía continúa desde la OT original</h2><p>${coord?'No se crea un registro desde cero. Selecciona una OT COMPLETADA, define su plazo y el sistema calcula el vencimiento usando la fecha real de finalización.':'Cada tarjeta corresponde a un trabajo ya finalizado. Si la garantía está activa, el contador muestra exactamente cuánto tiempo queda para solicitar revisión de ese mismo trabajo.'}</p></div><button class="btn small" data-action="refrescar-garantias"><i data-lucide="refresh-cw"></i> Actualizar</button></div></section><section class="panel smart-list-panel warranty-filter-panel"><div class="panel-body">${smartControls("garantia",{placeholder:"OT, cliente, sede o servicio",filters:[{name:"estado",label:"Estado garantía",options:warrantyStates}],sorts:[["finalizada","Fecha finalización"],["orden","OT"],["cliente","Cliente"],["estado","Estado"]]})}${smartResultsMeta(warrantyResult,"garantías")}</div></section><div class="warranty-grid">${cards}</div>${smartPager("garantia",warrantyResult)}${requests}</div>`;
    window.lucide?.createIcons();startWarrantyCountdowns();
  }

  window.addEventListener("resize",()=>{ if(window.innerWidth>820) closeMobileFilters(); },{passive:true});

  navigator.serviceWorker?.addEventListener?.("message", event => {
    if (event.data?.type === "SEPRIGUA_PUSH") {
      refreshNotificationBadge().catch(()=>{});
      if (state.current === "notificaciones") { invalidateListCache("notificaciones"); renderNotificaciones().catch(()=>{}); }
    }
  });

  document.addEventListener("input", e => {
    const input=e.target.closest("[data-smart-q]");
    if(!input)return;
    const key=input.dataset.smartQ;const prefs=smartPrefs(key);prefs.q=input.value;prefs.pagina=1;
    clearTimeout(smartSearchTimer);
    smartSearchTimer=setTimeout(()=>rerenderSmartList(key,true).catch(err=>showToast(err.message,"error")),220);
  });

  document.addEventListener("change", e => {
    const quoteSort=e.target.closest("[data-quote-sort]");
    if(quoteSort){
      const prefs=smartPrefs("cotizaciones");
      const value=String(quoteSort.value||"FECHA_DESC").toUpperCase();
      prefs.orden=value.startsWith("TOTAL")?"total":"fecha";
      prefs.direccion=value.endsWith("ASC")?"ASC":"DESC";
      prefs.pagina=1;
      rerenderSmartList("cotizaciones").catch(err=>showToast(err.message,"error"));
      return;
    }
    const density=e.target.closest("[data-order-density]");
    if(density){
      const prefs=smartPrefs("ordenes");
      prefs.densidad=String(density.value||"COMODA").toUpperCase();
      rerenderSmartList("ordenes").catch(err=>showToast(err.message,"error"));
      return;
    }
    const orderColumn=e.target.closest("[data-order-column]");
    if(orderColumn){
      const prefs=smartPrefs("ordenes");
      prefs.columnas=Object.assign({supervisor:true,programada:true,cotizacion:true},prefs.columnas||{}, {[orderColumn.dataset.orderColumn]:Boolean(orderColumn.checked)});
      rerenderSmartList("ordenes").catch(err=>showToast(err.message,"error"));
      return;
    }
    const customFrom=e.target.closest("[data-order-date-from]");
    const customTo=e.target.closest("[data-order-date-to]");
    if(customFrom||customTo){
      const prefs=smartPrefs("ordenes");
      if(customFrom) prefs.fechaDesde=customFrom.value||"";
      if(customTo) prefs.fechaHasta=customTo.value||"";
      prefs.pagina=1;
      rerenderSmartList("ordenes").catch(err=>showToast(err.message,"error"));
      return;
    }
    const filter=e.target.closest("[data-smart-filter]");
    if(filter){const key=filter.dataset.smartKey;const prefs=smartPrefs(key);prefs.filtros=Object.assign({},prefs.filtros,{[filter.dataset.smartFilter]:filter.value});prefs.pagina=1;rerenderSmartList(key).catch(err=>showToast(err.message,"error"));return;}
    const size=e.target.closest("[data-smart-size]");
    if(size){const key=size.dataset.smartKey;const prefs=smartPrefs(key);prefs.tamano=Number(size.value||10);prefs.pagina=1;rerenderSmartList(key).catch(err=>showToast(err.message,"error"));return;}
    const sort=e.target.closest("[data-smart-sort]");
    if(sort){const key=sort.dataset.smartKey;const prefs=smartPrefs(key);prefs.orden=sort.value;prefs.pagina=1;rerenderSmartList(key).catch(err=>showToast(err.message,"error"));return;}
    const direction=e.target.closest("[data-smart-direction]");
    if(direction){const key=direction.dataset.smartKey;const prefs=smartPrefs(key);prefs.direccion=direction.value;prefs.pagina=1;rerenderSmartList(key).catch(err=>showToast(err.message,"error"));}
  });

  document.addEventListener("click", async e => {
    const roleNav=e.target.closest("[data-role-nav]");
    if(roleNav){navigate(roleNav.dataset.roleNav);return;}
    const contextTab=e.target.closest("[data-context-module]");
    if(contextTab){navigate(contextTab.dataset.contextModule);return;}
    // IMPORTANTE: body usa data-module para estilos de los módulos nuevos.
    // Por eso la navegación se limita a controles reales; usar closest([data-module])
    // hacía que cualquier clic de la página encontrara el BODY y recargara el módulo,
    // bloqueando filtros, botones y acciones internas.
    const moduleBtn=e.target.closest(".nav-button[data-module], .system-brand-home[data-module]");
    if(moduleBtn){closeTopPopovers();navigate(moduleBtn.dataset.module);setSidebarOpen(false);return;}
    if(e.target.closest("[data-close-modal]")){closeModal();return;}
    if(e.target.closest("[data-close-popover]")){closeTopPopovers();return;}

    const passwordToggle=e.target.closest("[data-toggle-password]");
    if(passwordToggle){
      const input=passwordToggle.closest(".password-control")?.querySelector("input");
      if(input){const show=input.type==="password";input.type=show?"text":"password";passwordToggle.innerHTML=`<i data-lucide="${show?"eye-off":"eye"}"></i>`;window.lucide?.createIcons();}
      return;
    }


    const b=e.target.closest("[data-action]"); if(!b)return; const a=b.dataset.action,id=b.dataset.id;
    try {
      if(a==="cancelar-logout"){ closeModal(); return; }
      if(a==="confirmar-logout"){ closeModal(); return performLogout(); }
      if(a==="people-quick-filter") {
        const key=b.dataset.listKey; const prefs=smartPrefs(key); prefs.filtros=Object.assign({},prefs.filtros||{});
        const value=String(b.dataset.value||"TODOS").toUpperCase();
        let selected=normalizeSmartQuickValues(prefs.filtros.peopleQuick);
        if(value==="TODOS") selected=[];
        else selected=selected.includes(value)?selected.filter(item=>item!==value):[...selected,value];
        prefs.filtros.peopleQuick=selected.length?selected:["TODOS"]; prefs.pagina=1; return rerenderSmartList(key);
      }
      if(a==="smart-quick-filter") {
        const key=b.dataset.listKey; const name=b.dataset.filterName; if(!key||!name) return;
        const prefs=smartPrefs(key); prefs.filtros=Object.assign({},prefs.filtros||{});
        const value=String(b.dataset.value||"TODOS").toUpperCase();
        let selected=normalizeSmartQuickValues(prefs.filtros[name]);
        if(value==="TODOS") selected=[];
        else selected=selected.includes(value)?selected.filter(item=>item!==value):[...selected,value];
        prefs.filtros[name]=selected.length?selected:["TODOS"]; prefs.pagina=1; return rerenderSmartList(key);
      }
      if(a==="quote-tab") { const prefs=smartPrefs("cotizaciones"); prefs.filtros=Object.assign({},prefs.filtros||{},{tab:String(b.dataset.value||"TODAS").toUpperCase()}); prefs.pagina=1; return rerenderSmartList("cotizaciones"); }
      if(a==="order-quick-filter") {
        const prefs=smartPrefs("ordenes"); prefs.filtros=Object.assign({},prefs.filtros||{});
        const value=String(b.dataset.value||"TODAS").toUpperCase();
        let selected=normalizeOrderQuickFilters(prefs.filtros.rapidos||"TODAS");
        if(value==="TODAS") selected=["TODAS"];
        else { selected=selected.filter(v=>v!=="TODAS"); selected=selected.includes(value)?selected.filter(v=>v!==value):[...selected,value]; if(!selected.length) selected=["TODAS"]; }
        prefs.filtros.rapidos=selected; prefs.pagina=1; return rerenderSmartList("ordenes");
      }
      if(a==="order-critical-unassigned") {
        const prefs=smartPrefs("ordenes"); prefs.filtros=Object.assign({},prefs.filtros||{},{prioridad:"CRITICA",tecnico:"SIN_ASIGNAR",rapidos:["TODAS"]}); prefs.pagina=1; return rerenderSmartList("ordenes");
      }
      if(a==="request-quick-filter") {
        const key=b.dataset.listKey||"solicitudes"; const prefs=smartPrefs(key); const value=String(b.dataset.value||"TODAS").toUpperCase();
        prefs.filtros=Object.assign({},prefs.filtros||{});
        let selected=normalizeQuickFilters(prefs.filtros.rapidos||prefs.filtros.rapido||"TODAS");
        if(value==="TODAS") selected=["TODAS"];
        else { selected=selected.filter(v=>v!=="TODAS"); if(selected.includes(value)) selected=selected.filter(v=>v!==value); else selected.push(value); if(!selected.length) selected=["TODAS"]; }
        prefs.filtros.rapidos=selected; prefs.filtros.rapido=selected[0]||"TODAS"; prefs.pagina=1; return rerenderSmartList(key);
      }
      if(a==="request-remove-filter") { const key=b.dataset.listKey||"solicitudes"; const prefs=smartPrefs(key); const name=b.dataset.filterName; prefs.filtros=Object.assign({},prefs.filtros||{}); if(name){ if(name==="rapido"||name==="rapidos"){ prefs.filtros.rapidos=["TODAS"]; prefs.filtros.rapido="TODAS"; } else { prefs.filtros[name]="TODOS"; } } prefs.pagina=1; return rerenderSmartList(key); }
      if(a==="request-remove-quick-filter") { const key=b.dataset.listKey||"solicitudes"; const prefs=smartPrefs(key); const quickKey=String(b.dataset.quickKey||"").toUpperCase(); prefs.filtros=Object.assign({},prefs.filtros||{}); let selected=normalizeQuickFilters(prefs.filtros.rapidos||prefs.filtros.rapido||"TODAS").filter(v=>v!==quickKey&&v!=="TODAS"); if(!selected.length) selected=["TODAS"]; prefs.filtros.rapidos=selected; prefs.filtros.rapido=selected[0]||"TODAS"; prefs.pagina=1; return rerenderSmartList(key); }
      if(a==="reintentar-modulo") return navigate(b.dataset.module || state.current, { force: true });
      if(a==="dashboard-ver-emergencias"||a==="dashboard-ver-solicitudes") return navigate("solicitudes");
      if(a==="dashboard-ver-cotizaciones") return navigate("cotizaciones");
      if(a==="dashboard-ver-capacidad") return navigate("equipo_mantenimiento");
      if(a==="dashboard-ver-resumen") return navigate("personas");
      if(a==="dashboard-ver-ordenes"||a==="volver-ordenes") return navigate("ordenes");
      if(a==="dashboard-recent-page") { state.dashboardRecentPage=Math.max(1, Number(b.dataset.page||1)); return renderDashboard(); }
      if(a==="smart-page") { const key=b.dataset.listKey; const prefs=smartPrefs(key); prefs.pagina=Math.max(1,Number(b.dataset.page||1)); return rerenderSmartList(key); }
      if(a==="smart-reset") { const key=b.dataset.listKey; resetSmartPrefs(key); return rerenderSmartList(key); }
      if(a==="nueva-sede") return sedeForm();
      if(a==="editar-sede") return sedeForm(id);
      if(a==="toggle-sede") return confirmSedeState(id);
      if(a==="confirmar-toggle-sede") {
        const activate=b.dataset.active==="1";
        const result=await api(`/api/mis-sedes/${id}/estado`,{method:"POST",body:{activo:activate}});
        showToast(result.message||"Estado de sede actualizado.");closeModal();return renderMisSedes();
      }
      if(a==="ir-mis-sedes") {closeModal();return navigate("sedes");}
      if(a==="nuevo-cliente") return clientForm();
      if(a==="ver-cliente") return openClientDetail(id);
      if(a==="editar-cliente") return clientForm(id);
      if(a==="toggle-cliente") return confirmClientState(id,b.dataset.active==="1",b.dataset.name||"");
      if(a==="confirmar-toggle-cliente") {
        const activate=b.dataset.active==="1";
        const result=await api(`/api/clientes/${id}/estado`,{method:"POST",body:{activo:activate}});
        showToast(result.message||"Estado del cliente actualizado.");closeModal();state.userAdmin.catalogos=null;state.catalogs={};return renderClientes();
      }
      if(a==="documentos-tab") { state.documentos.tab=b.dataset.tab||"servicio"; if(state.documentos.tab!=="laboral")state.documentos.empleadoId=""; return renderDocumentos(); }
      if(a==="subir-documento-laboral") return documentLaborUploadForm(state.documentos.empleadoId||"");
      if(a==="ver-expediente-personal") { state.documentos.tab="laboral";state.documentos.empleadoId=String(id||"");return navigate("documentos"); }
      if(a==="limpiar-expediente-personal") { state.documentos.empleadoId="";return renderDocumentos(); }
      if(a==="verificar-documento-laboral") { const r=await api(`/api/documentos-laborales/${id}/verificar`,{method:"POST",body:{}});showToast(r.message||"Documento verificado.");return renderDocumentos(); }
      if(a==="estado-documento-laboral") {
        const row=(await api(`/api/documentos-laborales${state.documentos.empleadoId?`?empleado_id=${encodeURIComponent(state.documentos.empleadoId)}`:""}`)).items?.find(x=>String(x.id)===String(id));
        if(!row)return showToast("No se encontró el documento.","error");
        const r=await api(`/api/documentos-laborales/${id}/estado`,{method:"POST",body:{activo:!row.activo}});showToast(r.message||"Documento actualizado.");return renderDocumentos();
      }
      if(a==="nuevo-empleado") return employeeForm();
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
      if(a==="nuevo-catalogo") return catalogForm();
      if(a==="editar-catalogo") return catalogForm(id);
      if(a==="toggle-catalogo"){
        const item=(state.masterCatalog||[]).find(x=>x.id===id);if(!item)return;
        await api(`/api/catalogo-maestro/${encodeURIComponent(id)}`,{method:"PATCH",body:{activo:!item.activo}});
        showToast(item.activo?"Trabajo desactivado.":"Trabajo activado.");return renderCatalogoMaestro();
      }
      if(a==="nueva-solicitud") return requestForm(); if(a==="configurar-garantia") return warrantyConfigForm(id); if(a==="solicitar-revision-garantia") return warrantyRequestForm(id); if(a==="estado-solicitud-garantia") return warrantyRequestStatusForm(id); if(a==="refrescar-garantias"){invalidateListCache("garantia");return renderGarantia();} if(a==="ver-solicitud") return openRequest(id); if(a==="crear-ot-solicitud"){closeModal();return orderForm(id);} if(a==="nueva-orden") return orderForm();
      if(state.current==="agenda"&&state.agenda?.dirty&&["ver-orden","asignar-tecnico","cotizar-orden"].includes(a)){showToast("Guardá o restablecé la planificación antes de abrir otra acción.","error");return;}
      if(a==="ver-orden") return openOrder(id,"resumen",true);
      if(a==="volver-agenda") return renderAgendaOperativa();
      if(a==="volver-ordenes") return navigate("ordenes");
      if(a==="orden-paso") return openOrder(id,b.dataset.step||"resumen",false);
      if(["cambiar-estado","iniciar-orden","finalizar-tecnico","asignar-tecnico","asignar-equipo","actividad","incidencia","resolver-incidencia","cambio-alcance","enviar-cambio","responder-cambio","editar-orden","evidencia","evidencia-solicitud"].includes(a)) return quickAction(a,id);
      if(a==="cotizar-orden") return quoteForm(id);
      if(a==="ir-cotizaciones"){closeModal();return navigate("cotizaciones");}
      if(a==="ver-sedes") return openSedes(id); if(a==="nuevo-mantenimiento") return maintenanceForm(); if(a==="nueva-cotizacion") return quoteForm(); if(a==="ver-expediente-cotizacion") return openClientQuoteFlow(id); if(a==="volver-cotizaciones") return navigate("cotizaciones"); if(["enviar-cotizacion","responder-cotizacion"].includes(a)) return quoteAction(a,id);
      if(a==="guardar-disponibilidad"){const sel=$(`.availability[data-id="${CSS.escape(id)}"]`);await api(`/api/personal/${id}/disponibilidad`,{method:"PATCH",body:{disponibilidad:sel.value}});showToast("Disponibilidad actualizada.");return renderPersonal();}
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
      if(a==="refrescar-notificaciones"){invalidateListCache("notificaciones");return renderNotificaciones();}
      if(a==="ver-todas-notificaciones"){closeTopPopovers();return navigate("notificaciones");}
      if(a==="abrir-notificacion") return openNotificationTarget(b.dataset.entity,b.dataset.entityId,id);
      if(a==="abrir-cuenta"){closeTopPopovers();return navigate("cuenta");}
      if(a==="activar-push"){try{await syncPushSubscription({prompt:true});showToast("Notificaciones activadas en este dispositivo.");pushClient.config=null;return renderCuenta();}catch(err){showToast(err.message,"error");}return;}
      if(a==="desactivar-push"){try{await disablePushOnThisDevice();showToast("Notificaciones desactivadas en este dispositivo.");return renderCuenta();}catch(err){showToast(err.message,"error");}return;}
      if(a==="probar-push"){try{const d=await api("/api/push/probar",{method:"POST",body:{}});showToast(d.message||"Prueba enviada.");}catch(err){showToast(err.message,"error");}return;}
      if(a==="eliminar-dispositivo-push"){try{await api(`/api/push/dispositivos/${id}`,{method:"DELETE",body:{}});showToast("Dispositivo desactivado.");return renderCuenta();}catch(err){showToast(err.message,"error");}return;}
      if(a==="cerrar-otras-sesiones"){
        const result=await api("/api/cuenta/sesiones/cerrar-otras",{method:"POST",body:{}});showToast(result.message||"Otras sesiones cerradas.");return renderCuenta();
      }
      if(a==="cerrar-sesion") return confirmLogout();
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
  $("#logoutButton").addEventListener("click",confirmLogout);
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
