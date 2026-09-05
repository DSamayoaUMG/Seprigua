document.addEventListener("DOMContentLoaded", () => {
  const navbar =
    document.querySelector(".header .navbar");

  const links = Array.from(
    document.querySelectorAll(
      '.header .nav-link[href^="#"]'
    )
  );

  if (!navbar || !links.length) return;


  /* =======================================================
     CONFIGURACIÓN AUTO-COMPACT
     ======================================================= */

  const AUTO_COMPACT_MS = 2000;
  const desktopQuery =
    window.matchMedia("(min-width: 821px)");

  let compactTimer = null;
  let pointerInside = false;
  let keyboardInside = false;
  let isCompact = false;
  let lastKnownSection = null;
  let restoreTimer = null;


  const clearCompactTimer = () => {
    if (!compactTimer) return;

    window.clearTimeout(compactTimer);
    compactTimer = null;
  };


  const compactNavbar = () => {
    if (!desktopQuery.matches) return;
    if (pointerInside || keyboardInside) return;

    navbar.classList.remove(
      "navbar-restoring"
    );

    navbar.classList.add(
      "navbar-compact"
    );

    isCompact = true;
  };


  const expandNavbar = () => {
    clearCompactTimer();

    if (!isCompact) return;

    navbar.classList.remove(
      "navbar-compact"
    );

    navbar.classList.remove(
      "navbar-restoring"
    );

    void navbar.offsetWidth;

    navbar.classList.add(
      "navbar-restoring"
    );

    clearTimeout(restoreTimer);

    restoreTimer =
      window.setTimeout(() => {
        navbar.classList.remove(
          "navbar-restoring"
        );
      }, 620);

    isCompact = false;

    /*
      Al recuperar el tamaño normal recalculamos la posición
      del engranaje porque los botones vuelven a crecer.
    */
    window.setTimeout(
      repositionActiveGear,
      50
    );

    window.setTimeout(
      repositionActiveGear,
      560
    );
  };


  const scheduleCompact = () => {
    clearCompactTimer();

    if (!desktopQuery.matches) return;
    if (pointerInside || keyboardInside) return;

    compactTimer =
      window.setTimeout(
        compactNavbar,
        AUTO_COMPACT_MS
      );
  };


  /*
    Hover sobre cualquier parte de la caja original:
    vuelve a su tamaño normal inmediatamente.
  */
  navbar.addEventListener(
    "pointerenter",
    () => {
      pointerInside = true;
      expandNavbar();
    }
  );


  navbar.addEventListener(
    "pointerleave",
    () => {
      pointerInside = false;
      scheduleCompact();
    }
  );


  navbar.addEventListener(
    "focusin",
    () => {
      keyboardInside = true;
      expandNavbar();
    }
  );


  navbar.addEventListener(
    "focusout",
    (event) => {
      if (
        navbar.contains(
          event.relatedTarget
        )
      ) {
        return;
      }

      keyboardInside = false;
      scheduleCompact();
    }
  );


  /* =======================================================
     LIMPIAR ENGRANAJES VIEJOS
     ======================================================= */

  navbar
    .querySelectorAll(".nav-shared-gear")
    .forEach((el) => el.remove());

  links.forEach((link) => {
    link
      .querySelectorAll(".nav-gear-indicator")
      .forEach((el) => el.remove());
  });


  /* =======================================================
     CREAR TUKY CAMINANDO COMO INDICADOR COMPARTIDO
     ======================================================= */

  const holder =
    document.createElement("span");

  /*
    Conservamos la clase histórica para no romper el sistema
    de posicionamiento del navbar. Visualmente ya no es un
    engranaje: ahora el indicador es Tuky caminando.
  */
  holder.className =
    "nav-shared-gear nav-shared-tuky";

  holder.setAttribute(
    "aria-hidden",
    "true"
  );

  const tukyVideo =
    document.createElement("video");

  tukyVideo.className =
    "nav-tuky-walk";

  tukyVideo.src =
    "assets/video/tuky-caminando.mp4";

  tukyVideo.autoplay = true;
  tukyVideo.loop = true;
  tukyVideo.muted = true;
  tukyVideo.playsInline = true;
  tukyVideo.preload = "metadata";
  tukyVideo.setAttribute("muted", "");
  tukyVideo.setAttribute("playsinline", "");
  tukyVideo.setAttribute("aria-hidden", "true");

  holder.appendChild(tukyVideo);
  navbar.appendChild(holder);

  const tryPlayTuky = () => {
    const playPromise = tukyVideo.play?.();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {});
    }
  };

  tryPlayTuky();

  document.addEventListener(
    "visibilitychange",
    () => {
      if (!document.hidden) {
        tryPlayTuky();
      }
    }
  );


  /* =======================================================
     MAPA DE SECCIONES
     ======================================================= */

  const entries =
    links
      .map((link, index) => {
        const id =
          link
            .getAttribute("href")
            ?.slice(1);

        const section =
          id
            ? document.getElementById(id)
            : null;

        return section
          ? {
              id,
              index,
              link,
              section
            }
          : null;
      })
      .filter(Boolean);


  if (!entries.length) return;


  const header =
    document.getElementById(
      "header"
    );


  let currentIndex = -1;
  let rotation = 0;
  let raf = 0;
  let clickedId = null;
  let clickLockUntil = 0;
  let movingTimer = null;


  /* =======================================================
     POSICIONAR ENGRANAJE
     ======================================================= */

  const positionGear = (
    entry,
    animate = true
  ) => {
    if (!entry) return;

    const navRect =
      navbar.getBoundingClientRect();

    const linkRect =
      entry.link.getBoundingClientRect();

    const center =
      linkRect.left -
      navRect.left +
      linkRect.width / 2;


    if (
      currentIndex !== -1 &&
      currentIndex !== entry.index
    ) {
      const direction =
        entry.index >
        currentIndex
          ? 1
          : -1;

      const steps =
        Math.max(
          1,
          Math.abs(
            entry.index -
            currentIndex
          )
        );

      rotation +=
        direction *
        (125 + steps * 38);
    }


    if (!animate) {
      holder.style.transition =
        "none";
    }


    holder.style.setProperty(
      "--gear-x",
      `${center}px`
    );

    holder.style.setProperty(
      "--gear-rotation",
      `${rotation}deg`
    );


    if (!animate) {
      requestAnimationFrame(() => {
        holder.style.transition = "";
      });
    }


    holder.classList.add(
      "is-ready"
    );


    if (
      animate &&
      currentIndex !== entry.index
    ) {
      holder.classList.add(
        "is-moving"
      );

      clearTimeout(movingTimer);

      movingTimer =
        window.setTimeout(
          () => {
            holder.classList.remove(
              "is-moving"
            );
          },
          680
        );
    }


    currentIndex =
      entry.index;
  };


  const repositionActiveGear = () => {
    const active =
      entries.find(
        ({ link }) =>
          link.classList.contains(
            "active"
          )
      );

    if (active) {
      positionGear(
        active,
        false
      );
    }
  };


  /* =======================================================
     ACTIVAR LINK
     ======================================================= */

  const activate = (
    id,
    animateGear = true
  ) => {
    const entry =
      entries.find(
        (item) =>
          item.id === id
      );

    if (!entry) return;


    const changedSection =
      lastKnownSection !== id;


    entries.forEach(
      ({ id: itemId, link }) => {
        const active =
          itemId === id;

        link.classList.toggle(
          "active",
          active
        );

        if (active) {
          link.setAttribute(
            "aria-current",
            "page"
          );
        } else {
          link.removeAttribute(
            "aria-current"
          );
        }
      }
    );


    positionGear(
      entry,
      animateGear
    );


    if (changedSection) {
      /*
        Cuando el usuario entra a otra sección:
        navbar completo primero; después de detenerse 2 s,
        se compacta.
      */
      lastKnownSection = id;
      expandNavbar();
      scheduleCompact();
    }
  };


  /* =======================================================
     DETECTAR SECCIÓN ACTUAL
     ======================================================= */

  const getProbeY = () => {
    if (!header) return 110;

    const rect =
      header.getBoundingClientRect();

    return Math.max(
      88,
      rect.bottom + 28
    );
  };


  /*
    V78 — sección activa estable.
    En vez de depender de cuánto "intersecta" cada sección,
    usamos una línea virtual justo debajo del navbar.
    La sección activa es la última cuyo inicio ya pasó esa línea.

    Esto evita:
    - Cobertura marcada al estar en Trabajos.
    - Trabajos marcado al estar en Contacto.
    - cambios erráticos por secciones altas/sticky.
  */
  const getCurrentSection = () => {
    const probeDocumentY =
      window.scrollY +
      getProbeY();

    let current =
      entries[0];


    entries.forEach((entry) => {
      const sectionDocumentY =
        window.scrollY +
        entry.section
          .getBoundingClientRect()
          .top;


      if (
        sectionDocumentY <=
        probeDocumentY + 2
      ) {
        current = entry;
      }
    });


    /*
      Al final de la página siempre debe quedar activo Contacto.
    */
    const nearBottom =
      window.innerHeight +
      window.scrollY >=
      document.documentElement.scrollHeight - 8;


    if (nearBottom) {
      return entries[
        entries.length - 1
      ];
    }


    return current;
  };


  /*
    Posición exacta al navegar desde el navbar.
    No usamos el salto nativo del hash porque colocaba títulos
    debajo del navbar o demasiado arriba.
  */
  const getScrollTarget = (
    entry
  ) => {
    if (!entry) return 0;

    const navbarBottom =
      navbar
        .getBoundingClientRect()
        .bottom;


    /*
      V79 — NOSOTROS:
      La sección tiene bastante padding superior.
      Si navegábamos al inicio de #nosotros, el contenido
      quedaba demasiado abajo.

      Ahora usamos .about-top como referencia real:
      la galería queda apenas debajo del navbar y el bloque
      de texto queda centrado exactamente como en el diseño.
    */
    if (
      entry.id === "nosotros"
    ) {
      const aboutTop =
        entry.section.querySelector(
          ".about-top"
        );

      if (aboutTop) {
        const aboutTopDocumentY =
          window.scrollY +
          aboutTop
            .getBoundingClientRect()
            .top;

        const aboutGap = 8;

        return Math.max(
          0,
          aboutTopDocumentY -
          navbarBottom -
          aboutGap
        );
      }
    }


    /*
      V80 — SERVICIOS:
      Al pulsar "Servicios" queremos que aparezca primero el
      encabezado completo y, debajo, el carrusel; no que el
      navegador aterrice ya metido dentro de la imagen.

      Usamos .services-heading como punto visual real.
    */
    if (
      entry.id === "servicios"
    ) {
      const servicesHeading =
        entry.section.querySelector(
          ".services-heading"
        );

      if (servicesHeading) {
        const headingDocumentY =
          window.scrollY +
          servicesHeading
            .getBoundingClientRect()
            .top;

        const servicesGap = 16;

        return Math.max(
          0,
          headingDocumentY -
          navbarBottom -
          servicesGap
        );
      }
    }


    /*
      V81 — COBERTURA:
      Al pulsar "Cobertura" la composición debe quedar como
      en el diseño aprobado: navbar arriba y, debajo, el bloque
      completo de Cobertura alineado en una sola vista.

      Tomamos .coverage-grid como referencia visual real en vez
      del borde superior de toda la sección.
    */
    if (
      entry.id === "cobertura"
    ) {
      const coverageGrid =
        entry.section.querySelector(
          ".coverage-grid"
        );

      if (coverageGrid) {
        const coverageDocumentY =
          window.scrollY +
          coverageGrid
            .getBoundingClientRect()
            .top;

        /*
          Aproximadamente 38px de respiración entre navbar
          y contenido, como en la captura indicada.
        */
        const coverageGap = 38;

        return Math.max(
          0,
          coverageDocumentY -
          navbarBottom -
          coverageGap
        );
      }
    }


    /*
      V82 — CONTACTO:
      Queremos que al pulsar "Contacto" la composición quede
      exactamente como el diseño aprobado:
      navbar arriba y el encabezado premium inmediatamente debajo,
      seguido por las tarjetas de ubicación y Google Maps.

      Usamos .contact-premium-heading como referencia real en vez
      del borde superior completo de #contacto.
    */
    if (
      entry.id === "contacto"
    ) {
      const contactHeading =
        entry.section.querySelector(
          ".contact-premium-heading"
        );

      if (contactHeading) {
        const contactDocumentY =
          window.scrollY +
          contactHeading
            .getBoundingClientRect()
            .top;

        const contactGap = 28;

        return Math.max(
          0,
          contactDocumentY -
          navbarBottom -
          contactGap
        );
      }
    }


    /*
      V83 — TRABAJOS:
      Al pulsar "Trabajos" queremos exactamente la composición
      aprobada en pantalla:
      navbar arriba y el encabezado
      "EVIDENCIA EN CAMPO · SEPRIGUA"
      inmediatamente debajo, seguido por
      "Trabajos reales. Resultados que se ven."
      y la galería.

      Usamos .swg-section-heading como referencia visual real.
    */
    if (
      entry.id === "trabajos"
    ) {
      const workHeading =
        entry.section.querySelector(
          ".swg-section-heading"
        );

      if (workHeading) {
        const workDocumentY =
          window.scrollY +
          workHeading
            .getBoundingClientRect()
            .top;

        /*
          Separación pequeña para que el engranaje del navbar
          no toque el kicker del encabezado.
        */
        const workGap = 10;

        return Math.max(
          0,
          workDocumentY -
          navbarBottom -
          workGap
        );
      }
    }


    const sectionDocumentY =
      window.scrollY +
      entry.section
        .getBoundingClientRect()
        .top;

    const safeGap =
      entry.id === "inicio"
        ? 0
        : 18;

    return Math.max(
      0,
      sectionDocumentY -
      navbarBottom -
      safeGap
    );
  };


  const updateHashWithoutJump = (
    id
  ) => {
    const nextHash =
      `#${id}`;

    if (
      window.location.hash ===
      nextHash
    ) {
      return;
    }

    try {
      window.history.pushState(
        null,
        "",
        nextHash
      );
    } catch {
      /*
        Fallback para navegadores/restricciones poco comunes.
        No hacemos location.hash aquí porque provocaría
        un segundo salto nativo.
      */
    }
  };


  const scrollToEntry = (
    entry,
    behavior = "smooth",
    updateHash = true
  ) => {
    if (!entry) return;

    expandNavbar();

    /*
      Dejamos que el navbar vuelva a su altura normal antes
      de calcular el offset.
    */
    window.requestAnimationFrame(
      () => {
        window.requestAnimationFrame(
          () => {
            const top =
              getScrollTarget(entry);

            window.scrollTo({
              top,
              behavior
            });

            if (updateHash) {
              updateHashWithoutJump(
                entry.id
              );
            }
          }
        );
      }
    );
  };


  const syncFromScroll = () => {
    raf = 0;


    /*
      Mientras se mueve por la landing, la navbar permanece completa.
      El temporizador se reinicia en cada movimiento.
    */
    expandNavbar();
    scheduleCompact();


    if (
      clickedId &&
      performance.now() <
        clickLockUntil
    ) {
      activate(
        clickedId,
        true
      );

      return;
    }


    clickedId = null;


    const current =
      getCurrentSection();


    if (current) {
      activate(
        current.id,
        true
      );
    }
  };


  const requestSync = () => {
    clearCompactTimer();

    expandNavbar();

    if (raf) return;

    raf =
      requestAnimationFrame(
        syncFromScroll
      );
  };


  /* =======================================================
     CLICK NAV
     ======================================================= */

  links.forEach((link) => {
    link.addEventListener(
      "click",
      (event) => {
        const id =
          link
            .getAttribute("href")
            ?.slice(1);

        if (!id) return;

        const entry =
          entries.find(
            (item) =>
              item.id === id
          );

        if (!entry) return;

        /*
          Evitamos el salto nativo del navegador.
          Nosotros colocamos la sección exactamente debajo
          del navbar.
        */
        event.preventDefault();


        expandNavbar();

        clickedId = id;

        /*
          El bloqueo dura lo suficiente para un smooth scroll
          largo, así otra sección no roba el estado activo.
        */
        clickLockUntil =
          performance.now() + 1800;


        activate(
          id,
          true
        );


        scrollToEntry(
          entry,
          "smooth",
          true
        );


        scheduleCompact();
      }
    );
  });


  /* =======================================================
     SCROLL / RESIZE / HASH
     ======================================================= */

  window.addEventListener(
    "scroll",
    requestSync,
    { passive: true }
  );


  window.addEventListener(
    "resize",
    () => {
      if (!desktopQuery.matches) {
        clearCompactTimer();

        navbar.classList.remove(
          "navbar-compact"
        );

        isCompact = false;
      }

      repositionActiveGear();

      scheduleCompact();
    },
    { passive: true }
  );


  window.addEventListener(
    "hashchange",
    () => {
      const id =
        window.location.hash
          .slice(1);

      const entry =
        entries.find(
          (item) =>
            item.id === id
        );

      if (!entry) return;


      expandNavbar();

      clickedId = id;

      clickLockUntil =
        performance.now() + 1400;

      activate(
        id,
        true
      );


      /*
        Corrige hashes cambiados por historial/otros enlaces.
      */
      window.setTimeout(
        () => {
          scrollToEntry(
            entry,
            "smooth",
            false
          );
        },
        25
      );


      window.setTimeout(
        requestSync,
        900
      );
    }
  );


  /* =======================================================
     INICIO
     ======================================================= */

  const initialHash =
    window.location.hash
      .slice(1);


  const initialEntry =
    entries.find(
      (entry) =>
        entry.id === initialHash
    ) ||
    getCurrentSection() ||
    entries[0];


  activate(
    initialEntry.id,
    false
  );


  /*
    Al cargar, damos 2 segundos para que el usuario vea
    el navbar completo y después puede compactarse.
  */
  scheduleCompact();


  window.addEventListener(
    "load",
    () => {
      window.setTimeout(
        () => {
          /*
            Si la URL abrió con #trabajos/#contacto/etc.,
            corregimos la posición que el navegador hizo
            antes de cargar nuestros scripts.
          */
          const hashId =
            window.location.hash
              .slice(1);

          const hashEntry =
            entries.find(
              (entry) =>
                entry.id === hashId
            );

          if (hashEntry) {
            clickedId =
              hashEntry.id;

            clickLockUntil =
              performance.now() + 1000;

            activate(
              hashEntry.id,
              false
            );

            scrollToEntry(
              hashEntry,
              "auto",
              false
            );
          }

          repositionActiveGear();

          window.setTimeout(
            requestSync,
            80
          );
        },
        90
      );
    },
    { once: true }
  );
});
