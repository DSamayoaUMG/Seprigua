(() => {
  "use strict";

  const body = document.body;
  const sidebar = document.getElementById("sidebar");
  const nav = document.getElementById("systemNav");
  const notch = document.getElementById("sidebarSheetNotch");

  if (!sidebar || !nav || !notch) return;

  const desktopQuery = window.matchMedia("(min-width: 821px)");

  let rafId = 0;
  let initialized = false;

  function scheduleSync({ instant = false } = {}) {
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      requestAnimationFrame(() => syncGlider({ instant }));
    });
  }

  function syncGlider({ instant = false } = {}) {
    const active = nav.querySelector(".nav-button.active");

    if (!desktopQuery.matches || !active) {
      notch.classList.remove("is-visible");
      initialized = false;
      return;
    }

    const sidebarRect = sidebar.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    const collapsed = body.classList.contains("sidebar-collapsed");

    const notchHeight = collapsed ? 48 : Math.max(42, Math.min(48, activeRect.height));
    const y = activeRect.top - sidebarRect.top + ((activeRect.height - notchHeight) / 2);

    notch.style.height = `${Math.round(notchHeight)}px`;

    if (!initialized || instant) {
      const previousTransition = notch.style.transition;
      notch.style.transition = "none";
      notch.style.setProperty("--sheet-notch-y", `${Math.round(y)}px`);
      notch.classList.add("is-visible");

      requestAnimationFrame(() => {
        notch.style.transition = previousTransition;
      });

      initialized = true;
      return;
    }

    notch.style.setProperty("--sheet-notch-y", `${Math.round(y)}px`);
    notch.classList.add("is-visible");
  }

  /* V16+ mantiene los botones del menú estables y solo cambia la clase
     .active. Por eso observamos también cambios de clase dentro del nav.
     Este observer NO toca Lucide ni modifica los botones, así que no crea
     ciclos de DOM. */
  const navObserver = new MutationObserver((records) => {
    const relevant = records.some((record) =>
      record.type === "childList" ||
      (record.type === "attributes" &&
       record.attributeName === "class" &&
       record.target?.classList?.contains("nav-button"))
    );

    if (relevant) scheduleSync();
  });

  navObserver.observe(nav, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class"]
  });

  /* Cuando se abre/cierra el sidebar, dejamos que la MISMA pieza cambie
     de forma y continúe en la posición del módulo actual. */
  const bodyObserver = new MutationObserver((records) => {
    if (!records.some((record) => record.attributeName === "class")) return;
    scheduleSync();
  });

  bodyObserver.observe(body, {
    attributes: true,
    attributeFilter: ["class"]
  });

  /* Sensación inmediata al cambiar módulo.
     Escuchamos cualquier navegación data-module, incluido el logo SEPRIGUA,
     para que la pieza activa siempre acompañe al contenido. */
  document.addEventListener("click", (event) => {
    const moduleTarget = event.target.closest?.(".nav-button[data-module], .system-brand-home[data-module]");
    if (!moduleTarget) return;

    requestAnimationFrame(() => scheduleSync());
    setTimeout(() => scheduleSync(), 0);
  });

  window.addEventListener("resize", () => scheduleSync({ instant: true }), {
    passive: true
  });

  desktopQuery.addEventListener?.("change", () => scheduleSync({ instant: true }));

  if ("ResizeObserver" in window) {
    const resizeObserver = new ResizeObserver(() => scheduleSync({ instant: true }));
    resizeObserver.observe(nav);
  }

  scheduleSync({ instant: true });
})();