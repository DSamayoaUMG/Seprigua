document.addEventListener("DOMContentLoaded", () => {
  const navbar = document.querySelector(".header .navbar");
  const header = document.getElementById("header");
  const navMenu = document.getElementById("navMenu");
  const menuButton = document.getElementById("mobileMenuButton");
  const navLinks = [...document.querySelectorAll('.header .nav-link[href^="#"]')];

  if (!navbar || !navLinks.length) return;

  const items = navLinks
    .map((link, index) => {
      const id = link.getAttribute("href")?.slice(1) || "";
      return { link, id, section: document.getElementById(id), index };
    })
    .filter(item => item.section);

  if (!items.length) return;

  const knownIds = new Set(items.map(item => item.id));

  const visualTargets = {
    inicio: document.getElementById("inicio"),
    nosotros:
      document.querySelector("#nosotros .about-top") ||
      document.getElementById("nosotros"),
    servicios:
      document.querySelector("#servicios .services-heading") ||
      document.getElementById("servicios"),
    cobertura:
      document.querySelector("#cobertura .coverage-grid") ||
      document.getElementById("cobertura"),
    trabajos:
      document.querySelector("#trabajos .swg-section-heading") ||
      document.getElementById("trabajos"),
    contacto:
      document.querySelector("#contacto .contact-premium-heading") ||
      document.getElementById("contacto")
  };

  navbar
    .querySelectorAll(".nav-shared-gear,.nav-gear-indicator")
    .forEach(el => el.remove());

  const gear = document.createElement("span");
  gear.className = "nav-shared-gear";
  gear.setAttribute("aria-hidden", "true");
  gear.innerHTML = `
    <svg viewBox="0 0 64 64" role="presentation" focusable="false">
      <defs>
        <linearGradient id="sepriguaGearRed" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#a20d2c"/>
          <stop offset=".22" stop-color="#ff496b"/>
          <stop offset=".52" stop-color="#f51f4b"/>
          <stop offset=".78" stop-color="#ff6a87"/>
          <stop offset="1" stop-color="#a90f30"/>
        </linearGradient>
      </defs>
      <path fill="url(#sepriguaGearRed)" d="M27.3 2h9.4l1.4 7.2a23.4 23.4 0 0 1 5.3 2.2l6.1-4.1 6.7 6.7-4.1 6.1a23.4 23.4 0 0 1 2.2 5.3l7.2 1.4v9.4l-7.2 1.4a23.4 23.4 0 0 1-2.2 5.3l4.1 6.1-6.7 6.7-6.1-4.1a23.4 23.4 0 0 1-5.3 2.2L36.7 61h-9.4l-1.4-7.2a23.4 23.4 0 0 1-5.3-2.2l-6.1 4.1-6.7-6.7 4.1-6.1a23.4 23.4 0 0 1-2.2-5.3L2.5 36.2v-9.4l7.2-1.4a23.4 23.4 0 0 1 2.2-5.3L7.8 14l6.7-6.7 6.1 4.1a23.4 23.4 0 0 1 5.3-2.2L27.3 2Zm4.7 17.2A12.8 12.8 0 1 0 32 44.8a12.8 12.8 0 0 0 0-25.6Z"/>
      <circle cx="32" cy="32" r="7.2" fill="#fff" fill-opacity=".22"/>
    </svg>`;
  navbar.appendChild(gear);

  let activeId = "";
  let activeIndex = -1;
  let rotation = 0;
  let scrollFrame = 0;
  let lockUntil = 0;
  let historyTimer = 0;
  let routeSyncTimer = 0;

  const reducedMotion = window.matchMedia?.(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  const isDesktop = () => window.innerWidth > 820;
  const navigationOffset = () => (window.innerWidth <= 820 ? 84 : 112);

  function closeMobileMenu() {
    navMenu?.classList.remove("open");
    menuButton?.classList.remove("active");
    menuButton?.setAttribute("aria-expanded", "false");
    document.body.classList.remove("menu-open");
  }

  function positionGear(item, animate = true) {
    if (!isDesktop() || !item) return;

    const navRect = navbar.getBoundingClientRect();
    const linkRect = item.link.getBoundingClientRect();
    const center = linkRect.left - navRect.left + linkRect.width / 2;

    if (activeIndex >= 0 && activeIndex !== item.index) {
      const direction = item.index > activeIndex ? 1 : -1;
      rotation += direction * (150 + Math.abs(item.index - activeIndex) * 28);
    }

    if (!animate) gear.style.transition = "none";

    gear.style.setProperty("--gear-x", `${center}px`);
    gear.style.setProperty("--gear-rotation", `${rotation}deg`);
    gear.classList.add("is-ready");

    if (!animate) {
      requestAnimationFrame(() => {
        gear.style.transition = "";
      });
    }

    activeIndex = item.index;
  }

  function activate(item, animate = true) {
    if (!item) return;

    items.forEach(entry => {
      const selected = entry.id === item.id;
      entry.link.classList.toggle("active", selected);
      if (selected) entry.link.setAttribute("aria-current", "page");
      else entry.link.removeAttribute("aria-current");
    });

    activeId = item.id;
    positionGear(item, animate);
  }

  function currentItem() {
    const marker = (header?.getBoundingClientRect().bottom || 80) + 34;
    let current = items[0];

    for (const item of items) {
      if (item.section.getBoundingClientRect().top <= marker) current = item;
      else break;
    }

    if (
      window.innerHeight + window.scrollY >=
      document.documentElement.scrollHeight - 6
    ) {
      current = items[items.length - 1];
    }

    return current;
  }

  function scrollToSection(id, behavior = "smooth") {
    const target = visualTargets[id] || document.getElementById(id);
    if (!target) return false;

    if (id === "inicio") {
      window.scrollTo({ top: 0, behavior });
      return true;
    }

    const absoluteTop =
      window.scrollY + target.getBoundingClientRect().top;

    window.scrollTo({
      top: Math.max(0, absoluteTop - navigationOffset()),
      behavior
    });

    return true;
  }

  function notifySectionNavigation(id) {
    window.dispatchEvent(
      new CustomEvent("seprigua:section-navigate", {
        detail: { id }
      })
    );
  }

  function navigateTo(id, options = {}) {
    if (!knownIds.has(id)) return;

    const item = items.find(entry => entry.id === id);
    if (!item) return;

    const behavior =
      options.behavior || (reducedMotion ? "auto" : "smooth");

    lockUntil = performance.now() + (behavior === "smooth" ? 900 : 80);
    activate(item, options.animate !== false);
    closeMobileMenu();

    if (options.updateHistory !== false) {
      const nextHash = `#${id}`;
      if (window.location.hash !== nextHash) {
        history.pushState({ section: id }, "", nextHash);
      }
    }

    scrollToSection(id, behavior);
    notifySectionNavigation(id);
  }

  // Una sola capa controla TODAS las anclas de las secciones conocidas:
  // navbar, logo, CTA del hero y enlaces del footer.
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    const href = anchor.getAttribute("href") || "";
    const id = href.slice(1);
    if (!knownIds.has(id)) return;

    anchor.addEventListener("click", event => {
      // Ctrl/Cmd/Shift y clic medio conservan el comportamiento estándar.
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      event.preventDefault();
      navigateTo(id);
    });
  });

  function syncActiveFromScroll() {
    scrollFrame = 0;
    if (performance.now() < lockUntil) return;

    const item = currentItem();
    if (item.id !== activeId) activate(item, true);
  }

  window.addEventListener(
    "scroll",
    () => {
      if (scrollFrame) return;
      scrollFrame = requestAnimationFrame(syncActiveFromScroll);
    },
    { passive: true }
  );

  window.addEventListener(
    "resize",
    () => {
      window.clearTimeout(historyTimer);
      historyTimer = window.setTimeout(() => {
        const item = items.find(entry => entry.id === activeId) || currentItem();
        positionGear(item, false);
      }, 80);
    },
    { passive: true }
  );

  const alignFromHash = (behavior = "auto") => {
    const id = window.location.hash.slice(1);
    if (!knownIds.has(id)) return;

    const item = items.find(entry => entry.id === id);
    if (!item) return;

    lockUntil = performance.now() + (behavior === "smooth" ? 900 : 80);
    activate(item, false);
    scrollToSection(id, behavior);
    notifySectionNavigation(id);
  };

  const scheduleHashAlignment = () => {
    window.clearTimeout(routeSyncTimer);
    routeSyncTimer = window.setTimeout(() => {
      alignFromHash(reducedMotion ? "auto" : "smooth");
    }, 24);
  };

  // Algunos navegadores disparan popstate y hashchange juntos al volver
  // atrás. El debounce evita ejecutar dos desplazamientos para la misma ruta.
  window.addEventListener("popstate", scheduleHashAlignment);
  window.addEventListener("hashchange", scheduleHashAlignment);

  window.addEventListener(
    "load",
    () => {
      window.setTimeout(() => {
        const hashId = window.location.hash.slice(1);
        if (knownIds.has(hashId)) alignFromHash("auto");
        else activate(currentItem(), false);
      }, 80);
    },
    { once: true }
  );

  const initialId = window.location.hash.slice(1);
  if (knownIds.has(initialId)) {
    const initial = items.find(entry => entry.id === initialId);
    activate(initial, false);
  } else {
    activate(currentItem(), false);
  }
});
