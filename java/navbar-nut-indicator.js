document.addEventListener("DOMContentLoaded", () => {
  const links = Array.from(
    document.querySelectorAll('.header .nav-link[href^="#"]')
  );

  if (!links.length) return;

  const entries = links
    .map((link) => {
      const id = link.getAttribute("href")?.slice(1);
      const section = id ? document.getElementById(id) : null;

      return section
        ? { id, link, section }
        : null;
    })
    .filter(Boolean);

  if (!entries.length) return;

  const header = document.getElementById("header");

  let raf = 0;
  let clickedId = null;
  let clickLockUntil = 0;

  const activate = (id) => {
    entries.forEach(({ id: itemId, link }) => {
      const active = itemId === id;
      link.classList.toggle("active", active);

      if (active) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  };

  const getProbeY = () => {
    if (!header) return 110;

    const rect = header.getBoundingClientRect();
    return Math.max(88, rect.bottom + 28);
  };

  const getCurrentSection = () => {
    const probeY = getProbeY();

    /*
      1) Preferimos la sección que realmente cruza la línea justo
         debajo del navbar.
      2) Si ninguna la cruza, elegimos la más cercana a esa línea.
    */
    let containing = null;
    let nearest = null;
    let nearestDistance = Infinity;

    entries.forEach((entry) => {
      const rect = entry.section.getBoundingClientRect();

      if (rect.top <= probeY && rect.bottom > probeY) {
        containing = entry;
      }

      const distance = Math.abs(rect.top - probeY);

      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = entry;
      }
    });

    return containing || nearest || entries[0];
  };

  const syncFromScroll = () => {
    raf = 0;

    /*
      Al hacer clic damos un pequeño margen al smooth-scroll para que
      el indicador no salte a otra sección mientras la pantalla viaja.
    */
    if (
      clickedId &&
      performance.now() < clickLockUntil
    ) {
      activate(clickedId);
      return;
    }

    clickedId = null;

    const current = getCurrentSection();
    if (current) activate(current.id);
  };

  const requestSync = () => {
    if (raf) return;
    raf = requestAnimationFrame(syncFromScroll);
  };

  links.forEach((link) => {
    link.addEventListener("click", () => {
      const id = link.getAttribute("href")?.slice(1);
      if (!id) return;

      clickedId = id;
      clickLockUntil = performance.now() + 850;
      activate(id);
    });
  });

  window.addEventListener("scroll", requestSync, { passive: true });
  window.addEventListener("resize", requestSync, { passive: true });

  window.addEventListener("hashchange", () => {
    const id = window.location.hash.slice(1);

    if (entries.some((entry) => entry.id === id)) {
      clickedId = id;
      clickLockUntil = performance.now() + 600;
      activate(id);
    }

    window.setTimeout(requestSync, 650);
  });

  /* Al abrir directamente #servicios, #nosotros, etc. */
  const initialHash = window.location.hash.slice(1);

  if (entries.some((entry) => entry.id === initialHash)) {
    activate(initialHash);
  } else {
    requestSync();
  }

  window.addEventListener(
    "load",
    () => window.setTimeout(requestSync, 80),
    { once: true }
  );
});
