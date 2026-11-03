(() => {
  "use strict";

  const body = document.body;
  const sidebar = document.getElementById("sidebar");
  const nav = document.getElementById("systemNav");
  const notch = document.getElementById("sidebarSheetNotch");

  if (!sidebar || !nav || !notch) return;

  const desktopQuery = window.matchMedia("(min-width: 1121px)");

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

/* SEPRIGUA · Señal de desplazamiento del menú (solo interfaz)
   Muestra el indicador cuando el menú realmente tiene opciones más abajo.
   La barra azul nativa se estiliza por CSS y conserva mouse, touch y teclado. */
(() => {
  "use strict";
  const sidebar = document.getElementById("sidebar");
  const nav = document.getElementById("systemNav");
  if (!sidebar || !nav || sidebar.querySelector(".sidebar-scroll-hint")) return;

  const hint = document.createElement("div");
  hint.className = "sidebar-scroll-hint";
  hint.setAttribute("aria-hidden", "true");
  hint.hidden = true;
  hint.innerHTML = '<span class="sidebar-scroll-hint-icon" aria-hidden="true">↓</span><span class="sidebar-scroll-hint-text">Desliza para ver más</span>';
  sidebar.appendChild(hint);
  let pending = 0;

  function update() {
    pending = 0;
    // Un rail minimizado no debe mostrar ni flecha ni scrollbar.
    const compact = document.body.classList.contains("sidebar-collapsed") && !sidebar.classList.contains("open");
    const drawerOculto = window.matchMedia("(max-width: 650px)").matches && !sidebar.classList.contains("open");
    if (compact || drawerOculto) {
      nav.classList.remove("sidebar-scroll-required");
      hint.hidden = true;
      return;
    }

    // La diferencia scrollHeight-clientHeight puede incluir solamente el padding
    // de la lista (y redondeos del zoom). Contar elementos REALES, no píxeles
    // de relleno: el último botón define si existe una opción oculta.
    const buttons = nav.querySelectorAll(".nav-button");
    const last = buttons[buttons.length - 1];
    if (!last) {
      nav.classList.remove("sidebar-scroll-required");
      hint.hidden = true;
      return;
    }
    const navBounds = nav.getBoundingClientRect();
    const lastBounds = last.getBoundingClientRect();
    // Compensar el desplazamiento actual para medir el último botón en top=0.
    // Tolera 3 px de redondeo subpíxel sin confundirlo con un ítem cortado.
    const bottomAtTop = lastBounds.bottom - navBounds.bottom + nav.scrollTop;
    const needsScroll = bottomAtTop > 3;
    nav.classList.toggle("sidebar-scroll-required", needsScroll);
    if (!needsScroll) {
      if (nav.scrollTop) nav.scrollTop = 0;
      hint.hidden = true;
      return;
    }

    // La flecha indica que queda contenido útil por debajo, no solo padding.
    const moreBelow = lastBounds.bottom - navBounds.bottom > 3;
    hint.hidden = !moreBelow;
    if (moreBelow) {
      const sidebarBounds = sidebar.getBoundingClientRect();
      hint.style.top = `${Math.round(navBounds.bottom - sidebarBounds.top - 39)}px`;
    }
  }
  function schedule() {
    if (pending) return;
    pending = requestAnimationFrame(update);
  }
  nav.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule, { passive: true });
  new MutationObserver(schedule).observe(nav, { childList: true, subtree: true });
  new MutationObserver(schedule).observe(sidebar, { attributes: true, attributeFilter: ["class"] });
  new MutationObserver(schedule).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  if ("ResizeObserver" in window) {
    const observer = new ResizeObserver(schedule);
    observer.observe(nav);
    // El texto y la altura de las opciones pueden cambiar al aplicar zoom.
    const attachButtons = () => {
      nav.querySelectorAll(".nav-button").forEach((button) => observer.observe(button));
    };
    attachButtons();
    new MutationObserver(attachButtons).observe(nav, { childList: true });
  }
  schedule();
})();
