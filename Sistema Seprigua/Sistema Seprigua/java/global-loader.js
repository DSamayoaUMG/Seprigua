(() => {
  "use strict";

  let sequence = 0;
  let activeRecord = null;
  let contextualSequence = 0;
  const contextual = new Map();

  const esc = value => String(value ?? "").replace(/[&<>'"]/g, char => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"
  }[char]));

  const moduleLabel = module => ({
    dashboard:"centro de control", solicitudes:"solicitudes", ordenes:"órdenes de trabajo",
    agenda:"agenda operativa", cotizaciones:"cotizaciones", catalogo:"catálogo y precios",
    clientes:"clientes y sedes", personal:"personal", usuarios:"usuarios", equipos:"equipo",
    mantenimientos:"mantenimientos", documentos:"documentos", garantia:"garantías",
    notificaciones:"notificaciones", auditoria:"auditoría", roles:"roles y accesos",
    cuenta:"tu cuenta", vacaciones:"vacaciones", sedes:"sedes"
  }[String(module || "").toLowerCase()] || "información");

  function ensureHost(container) {
    const region = document.getElementById("systemScrollRegion") || container.parentElement || document.body;
    let host = document.getElementById("seGlobalModuleLoaderHost");
    if (!host) {
      host = document.createElement("div");
      host.id = "seGlobalModuleLoaderHost";
      host.className = "se-global-loader-host";
      host.hidden = true;
      region.appendChild(host);
    } else if (host.parentElement !== region) {
      region.appendChild(host);
    }
    return host;
  }

  function clearRecord(record, { reveal = true } = {}) {
    if (!record) return;
    record.cancelled = true;
    if (record.host) {
      record.host.hidden = true;
      record.host.className = "se-global-loader-host";
      record.host.innerHTML = "";
      record.host.removeAttribute("aria-busy");
    }
    if (reveal && record.container) {
      record.container.classList.remove("se-module-refreshing");
      record.container.removeAttribute("aria-busy");
    }
    if (activeRecord === record) activeRecord = null;
  }

  function start({ container, module = "sistema", retry = null } = {}) {
    if (!container) return null;
    if (activeRecord) clearRecord(activeRecord, { reveal:true });

    const token = `loader-${++sequence}`;
    const host = ensureHost(container);
    const record = { token, container, host, module, retry, cancelled:false };
    activeRecord = record;

    host.innerHTML = `<div class="se-global-loader-chip" role="status" aria-live="polite"><span class="se-global-loader-spinner" aria-hidden="true"></span><span>Cargando ${esc(moduleLabel(module))}…</span></div>`;
    host.hidden = false;
    host.classList.add("is-visible");
    host.setAttribute("aria-busy", "true");
    container.classList.add("se-module-refreshing");
    container.setAttribute("aria-busy", "true");
    return token;
  }

  async function finish(token) {
    const record = activeRecord;
    if (!record || record.token !== token || record.cancelled) return;
    record.container.classList.remove("se-module-refreshing");
    record.container.classList.remove("se-module-ready");
    // Fuerza un límite de estilo corto para que el contenido nuevo aparezca limpio.
    void record.container.offsetWidth;
    record.container.classList.add("se-module-ready");
    record.container.removeAttribute("aria-busy");
    record.host.classList.remove("is-visible");
    record.host.hidden = true;
    record.host.innerHTML = "";
    record.host.removeAttribute("aria-busy");
    activeRecord = null;
    window.setTimeout(() => record.container.classList.remove("se-module-ready"), 180);
  }

  function fail(token, error, { retry = null } = {}) {
    const record = activeRecord;
    if (!record || record.token !== token || record.cancelled) return;
    record.retry = retry || record.retry;
    record.container.classList.remove("se-module-refreshing");
    record.container.removeAttribute("aria-busy");
    record.host.classList.add("is-visible", "is-error");
    record.host.hidden = false;
    record.host.innerHTML = `<div class="se-global-loader-error" role="alert">
      <div class="se-global-loader-error-copy"><strong>No pudimos cargar la información.</strong><span>${esc(error?.message || "Intenta nuevamente.")}</span></div>
      <button class="se-global-loader-retry" type="button" data-global-loader-retry>Reintentar</button>
    </div>`;
    record.host.querySelector("[data-global-loader-retry]")?.addEventListener("click", () => {
      const action = record.retry;
      clearRecord(record, { reveal:true });
      if (typeof action === "function") action();
    }, { once:true });
  }

  function cancel(token) {
    if (!activeRecord || (token && activeRecord.token !== token)) return;
    clearRecord(activeRecord, { reveal:true });
  }

  function ensureContextualHost() {
    let host = document.getElementById("seContextualLoaderHost");
    if (!host) {
      host = document.createElement("div");
      host.id = "seContextualLoaderHost";
      host.className = "se-contextual-loader";
      host.hidden = true;
      (document.querySelector(".system-main") || document.body).appendChild(host);
    }
    return host;
  }

  function startContextual({ label = "Actualizando…", delay = 180 } = {}) {
    const token = `context-${++contextualSequence}`;
    const host = ensureContextualHost();
    const record = { token, host, label, shown:false, finished:false, timer:null };
    contextual.set(token, record);
    record.timer = window.setTimeout(() => {
      if (record.finished) return;
      record.shown = true;
      host.hidden = false;
      host.innerHTML = `<span class="se-contextual-spinner" aria-hidden="true"></span><span>${esc(label)}</span>`;
      requestAnimationFrame(() => host.classList.add("is-visible"));
    }, Math.max(0, Number(delay) || 0));
    return token;
  }

  async function finishContextual(token, { successText = "Actualizado" } = {}) {
    const record = contextual.get(token);
    if (!record) return;
    record.finished = true;
    if (record.timer) window.clearTimeout(record.timer);
    if (record.shown) {
      record.host.innerHTML = `<span>✓</span><span>${esc(successText)}</span>`;
      record.host.classList.add("is-complete");
      window.setTimeout(() => {
        record.host.classList.remove("is-visible", "is-complete");
        record.host.hidden = true;
      }, 260);
    }
    contextual.delete(token);
  }

  function cancelContextual(token) {
    const record = contextual.get(token);
    if (!record) return;
    record.finished = true;
    if (record.timer) window.clearTimeout(record.timer);
    record.host.classList.remove("is-visible", "is-complete");
    record.host.hidden = true;
    contextual.delete(token);
  }

  window.SEPRIGUALoader = Object.freeze({
    start, finish, fail, cancel, startContextual, finishContextual, cancelContextual
  });
})();
