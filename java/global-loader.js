(() => {
  "use strict";

  const LOGO = "/assets/img/logo-seprigua-hd.png";
  const MAX_PENDING = 93;
  let sequence = 0;
  let activeRecord = null;
  let contextualSequence = 0;
  const contextual = new Map();
  const notifyCursor = () => document.dispatchEvent(new Event("seprigua:loader-state-change"));

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

  function liteMode(requested) {
    return Boolean(requested) ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ||
      window.matchMedia?.("(pointer: coarse)")?.matches ||
      (Number(navigator.deviceMemory) > 0 && Number(navigator.deviceMemory) <= 2) ||
      (Number(navigator.hardwareConcurrency) > 0 && Number(navigator.hardwareConcurrency) <= 2);
  }

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

  function loaderMarkup(token, label) {
    const maskId = `se-loader-wave-${token}`;
    return `<div class="se-logo-loader" role="status" aria-live="polite" aria-label="Cargando ${esc(label)}">
      <svg class="se-logo-loader-svg" viewBox="0 0 675 336" width="675" height="336" aria-hidden="true" focusable="false">
        <defs><mask id="${maskId}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="675" height="336"><g class="se-logo-reveal" style="--se-reveal-y:348px"><path class="se-logo-wave" fill="#fff" d="M-24 0 C 88 -10 188 10 288 0 S 488 -10 588 0 S 688 8 708 0 L708 360 H-24 Z" /></g></mask></defs>
        <image class="se-logo-gray" href="${LOGO}" width="675" height="336" />
        <image href="${LOGO}" width="675" height="336" mask="url(#${maskId})" />
      </svg>
      <span class="se-logo-loader-text">Cargando ${esc(label)}…</span>
    </div>`;
  }

  function setVisualProgress(record, value) {
    if (!record || record.cancelled) return;
    record.progress = Math.max(0, Math.min(100, Number(value) || 0));
    const reveal = record.host.querySelector(".se-logo-reveal");
    if (reveal) reveal.style.setProperty("--se-reveal-y", `${348 - 360 * record.progress / 100}px`);
  }

  function clearRecord(record, { reveal = true } = {}) {
    if (!record) return;
    record.cancelled = true;
    window.clearTimeout(record.progressTimer);
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
    notifyCursor();
  }

  function schedulePendingProgress(record) {
    if (record.cancelled || record.finishing || record.progress >= MAX_PENDING) return;
    record.progressTimer = window.setTimeout(() => {
      if (record.cancelled || record.finishing) return;
      const next = Math.min(MAX_PENDING, record.progress + Math.max(2, Math.ceil((MAX_PENDING - record.progress) * .22)));
      setVisualProgress(record, next);
      schedulePendingProgress(record);
    }, 420);
  }

  function start({ container, module = "sistema", text, lite = false, retry = null } = {}) {
    if (!container) return null;
    if (activeRecord) clearRecord(activeRecord);
    const token = `loader-${++sequence}`;
    const host = ensureHost(container);
    const label = text || moduleLabel(module);
    const record = { token, container, host, module, retry, progress:0, cancelled:false, finishing:false, progressTimer:null };
    activeRecord = record;
    host.innerHTML = loaderMarkup(token, label);
    host.hidden = false;
    host.className = `se-global-loader-host is-visible${liteMode(lite) ? " loader-lite" : ""}`;
    host.setAttribute("aria-busy", "true");
    container.classList.add("se-module-refreshing");
    container.setAttribute("aria-busy", "true");
    schedulePendingProgress(record);
    notifyCursor();
    return token;
  }

  function setProgress(token, progress) {
    const record = activeRecord;
    if (!record || record.token !== token || record.finishing) return;
    setVisualProgress(record, Math.min(MAX_PENDING, progress));
  }

  const delay = ms => new Promise(resolve => window.setTimeout(resolve, ms));

  async function finish(token) {
    const record = activeRecord;
    if (!record || record.token !== token || record.cancelled || record.finishing) return;
    record.finishing = true;
    window.clearTimeout(record.progressTimer);
    setVisualProgress(record, 100);
    await delay(record.host.classList.contains("loader-lite") ? 210 : 285);
    if (record.cancelled || activeRecord !== record) return;
    await delay(120);
    if (record.cancelled || activeRecord !== record) return;
    record.host.classList.add("is-finishing");
    await delay(170);
    if (record.cancelled || activeRecord !== record) return;
    clearRecord(record);
  }

  function fail(token, error, { retry = null } = {}) {
    const record = activeRecord;
    if (!record || record.token !== token || record.cancelled) return;
    record.retry = retry || record.retry;
    window.clearTimeout(record.progressTimer);
    record.container.classList.remove("se-module-refreshing");
    record.container.removeAttribute("aria-busy");
    record.host.className = "se-global-loader-host is-visible is-error";
    record.host.hidden = false;
    record.host.removeAttribute("aria-busy");
    notifyCursor();
    record.host.innerHTML = `<div class="se-global-loader-error" role="alert">
      <div class="se-global-loader-error-copy"><strong>No pudimos cargar la información.</strong><span>${esc(error?.message || "Intenta nuevamente.")}</span></div>
      <button class="se-global-loader-retry" type="button" data-global-loader-retry>Reintentar</button>
    </div>`;
    record.host.querySelector("[data-global-loader-retry]")?.addEventListener("click", () => {
      const action = record.retry;
      clearRecord(record);
      if (typeof action === "function") action();
    }, { once:true });
  }

  function cancel(token) {
    if (!activeRecord || (token && activeRecord.token !== token)) return;
    clearRecord(activeRecord);
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

  function startContextual({ label = "Actualizando…", delay: wait = 180 } = {}) {
    const token = `context-${++contextualSequence}`;
    const host = ensureContextualHost();
    const record = { token, host, label, shown:false, finished:false, timer:null };
    contextual.set(token, record);
    record.timer = window.setTimeout(() => {
      if (record.finished) return;
      record.shown = true;
      host.hidden = false;
      host.innerHTML = `<span class="se-contextual-spinner" aria-hidden="true"></span><span>${esc(label)}</span>`;
      requestAnimationFrame(() => {
        if (record.finished) return;
        host.classList.add("is-visible");
        notifyCursor();
      });
    }, Math.max(0, Number(wait) || 0));
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
      notifyCursor();
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
    notifyCursor();
  }

  window.SEPRIGUALoader = Object.freeze({
    start, setProgress, finish, fail, cancel, startContextual, finishContextual, cancelContextual
  });
})();
