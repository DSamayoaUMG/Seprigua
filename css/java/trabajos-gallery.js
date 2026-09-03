(() => {
  "use strict";

  const CONFIG = {
    basePath: "assets/img/trabajos/",
    prefix: "",
    extension: ".webp",
    maxFilesToProbe: 60,
    autoplayMs: 4500,
    pauseAfterInteractionMs: 7000
  };

  const WORK_META = [
    {
      title: "Destape profesional de drenajes",
      situation:
        "Sistema de drenaje con obstrucción y flujo limitado en la instalación.",
      intervention:
        "Evaluación del punto afectado y destape técnico con el procedimiento adecuado según las condiciones encontradas.",
      result:
        "Flujo restablecido y sistema nuevamente operativo, con revisión del área intervenida antes de finalizar."
    },
    {
      title: "Limpieza y mantenimiento de drenajes",
      situation:
        "Acumulación de residuos en drenajes y tuberías que reducía el paso normal del agua.",
      intervention:
        "Limpieza especializada del sistema para retirar sedimentos, residuos y material acumulado en los conductos.",
      result:
        "Mayor capacidad de flujo y drenajes preparados para continuar operando en mejores condiciones."
    },
    {
      title: "Mantenimiento de planta de tratamiento",
      situation:
        "Sistema de tratamiento que requería limpieza y revisión de componentes para mantener su operación.",
      intervention:
        "Trabajo técnico de limpieza, inspección y mantenimiento en los puntos necesarios del sistema.",
      result:
        "Planta atendida y condiciones operativas mejoradas para disminuir riesgo de acumulaciones, obstrucciones o fallas."
    },
    {
      title: "Mantenimiento de instalaciones hidráulicas",
      situation:
        "Tuberías y conexiones con necesidad de revisión preventiva y ajustes de mantenimiento.",
      intervention:
        "Inspección del sistema hidráulico, ajuste de conexiones y mantenimiento de los componentes identificados.",
      result:
        "Instalación revisada y preparada para continuar operando, reduciendo el riesgo de filtraciones y daños posteriores."
    },
    {
      title: "Reparación de tuberías",
      situation:
        "Tubería con fuga, conexión dañada o condición que afectaba el funcionamiento normal de la instalación.",
      intervention:
        "Localización del punto afectado y reparación o ajuste de la tubería y sus conexiones según el problema encontrado.",
      result:
        "Conexión corregida y funcionamiento recuperado en el área intervenida."
    }
  ];

  const section = document.querySelector(".seprigua-work-gallery");
  const root = document.getElementById("sepriguaWorkGallery");
  const deck = document.getElementById("swgDeck");
  const loading = document.getElementById("swgLoading");
  const ambient = document.getElementById("swgAmbientImage");
  const progress = document.getElementById("swgProgressFill");

  if (!section || !root || !deck) return;

  let images = [];
  let activeIndex = 0;
  let autoplayTimer = null;
  let resumeTimer = null;
  let pointerStartX = null;
  let pointerDeltaX = 0;

  const srcFor = (number) =>
    `${CONFIG.basePath}${CONFIG.prefix}${String(number).padStart(2, "0")}${CONFIG.extension}`;

  const imageExists = (src) =>
    new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(src);
      img.onerror = () => resolve(null);
      img.src = src;
    });

  async function discoverImages() {
    const checks = [];

    for (let i = 1; i <= CONFIG.maxFilesToProbe; i += 1) {
      checks.push(imageExists(srcFor(i)));
    }

    const found = (await Promise.all(checks)).filter(Boolean);

    if (found.length) return found;

    const legacyImages = [
      "assets/img/trabajo-1.webp",
      "assets/img/trabajo-2.webp",
      "assets/img/trabajo-3-focus.webp",
      "assets/img/trabajo-4-focus.webp",
      "assets/img/trabajo-5-focus.webp"
    ];

    return (await Promise.all(legacyImages.map(imageExists))).filter(Boolean);
  }

  function metaFor(index) {
    return WORK_META[index] || {
      title: "Trabajo realizado por SEPRIGUA",
      situation:
        "Condición identificada durante una intervención técnica en campo.",
      intervention:
        "Atención ejecutada por personal de SEPRIGUA con el procedimiento correspondiente al trabajo.",
      result:
        "Área atendida y trabajo finalizado de acuerdo con las condiciones encontradas."
    };
  }

  function circularDistance(index, active, total) {
    let d = index - active;

    if (d > total / 2) d -= total;
    if (d < -total / 2) d += total;

    return d;
  }

  function getVisualPosition(index) {
    const d = circularDistance(index, activeIndex, images.length);

    if (d === 0) return "0";
    if (d === -1) return "-1";
    if (d === 1) return "1";
    if (d === -2) return "-2";
    if (d === 2) return "2";

    return "hidden";
  }

  function render() {
    if (!images.length) return;

    [...deck.children].forEach((card, index) => {
      card.dataset.pos = getVisualPosition(index);

      card.setAttribute(
        "aria-hidden",
        card.dataset.pos === "hidden" ? "true" : "false"
      );
    });

    ambient.style.backgroundImage =
      `url("${images[activeIndex]}")`;

    const pct =
      ((activeIndex + 1) / images.length) * 100;

    progress.style.width =
      `${pct}%`;

    syncLightbox();
  }

  function buildCards() {
    deck.innerHTML = "";

    images.forEach((src, index) => {
      const meta = metaFor(index);

      const card = document.createElement("article");
      card.className = "swg-card";
      card.dataset.index = String(index);

      const media = document.createElement("div");
      media.className = "swg-card-media";

      const img = document.createElement("img");
      img.src = src;
      img.alt = meta.title;
      img.loading = index < 5 ? "eager" : "lazy";
      img.decoding = "async";

      media.appendChild(img);

      const info = document.createElement("div");
      info.className = "swg-card-info";

      const titleWrap = document.createElement("div");
      titleWrap.className = "swg-card-title-wrap";

      const title = document.createElement("h3");
      title.textContent = meta.title;

      titleWrap.appendChild(title);

      const more = document.createElement("button");
      more.type = "button";
      more.className = "swg-card-more";
      more.innerHTML =
        `<span>Ver más</span><i data-lucide="arrow-up-right"></i>`;

      more.addEventListener("click", (event) => {
        event.stopPropagation();

        if (index !== activeIndex) {
          activeIndex = index;
          render();
        }

        openLightbox();
      });

      info.append(titleWrap, more);
      card.append(media, info);

      card.addEventListener("click", () => {
        if (index === activeIndex) {
          return;
        }

        activeIndex = index;
        render();
        pauseAutoplay();
      });

      deck.appendChild(card);
    });

    render();

    if (window.lucide?.createIcons) {
      window.lucide.createIcons();
    }
  }

  function go(step, userInitiated = true) {
    if (!images.length) return;

    activeIndex =
      (activeIndex + step + images.length) %
      images.length;

    render();

    if (userInitiated) {
      pauseAutoplay();
    }
  }

  const next = (userInitiated = true) =>
    go(1, userInitiated);

  const prev = (userInitiated = true) =>
    go(-1, userInitiated);

  function startAutoplay() {
    clearInterval(autoplayTimer);

    autoplayTimer =
      window.setInterval(
        () => next(false),
        CONFIG.autoplayMs
      );
  }

  function pauseAutoplay() {
    clearInterval(autoplayTimer);
    clearTimeout(resumeTimer);

    resumeTimer =
      window.setTimeout(
        startAutoplay,
        CONFIG.pauseAfterInteractionMs
      );
  }

  document.getElementById("swgPrev")
    ?.addEventListener(
      "click",
      () => prev(true)
    );

  document.getElementById("swgNext")
    ?.addEventListener(
      "click",
      () => next(true)
    );

  root.addEventListener(
    "pointerdown",
    (event) => {
      if (
        event.target.closest(
          ".swg-card-more"
        )
      ) {
        return;
      }

      pointerStartX = event.clientX;
      pointerDeltaX = 0;
    }
  );

  root.addEventListener(
    "pointermove",
    (event) => {
      if (pointerStartX === null) return;

      pointerDeltaX =
        event.clientX - pointerStartX;
    }
  );

  root.addEventListener(
    "pointerup",
    () => {
      if (pointerStartX === null) return;

      if (
        Math.abs(pointerDeltaX) > 55
      ) {
        pointerDeltaX < 0
          ? next(true)
          : prev(true);
      }

      pointerStartX = null;
      pointerDeltaX = 0;
    }
  );

  root.addEventListener(
    "pointercancel",
    () => {
      pointerStartX = null;
      pointerDeltaX = 0;
    }
  );

  /* =======================================================
     VISOR — INFORMACIÓN + ZOOM + PAN + PINCH
     ======================================================= */

  const lightbox =
    document.getElementById("swgLightbox");

  /*
    PORTAL DEL VISOR:
    El modal vive originalmente dentro de la sección Trabajos. Algunas
    animaciones del sitio usan transform/filter en ancestros y eso puede
    convertir position:fixed en relativo a la sección, haciendo que el
    navbar quede encima en pantallas intermedias. Lo movemos al body sin
    alterar su contenido ni sus eventos.
  */
  if (
    lightbox &&
    lightbox.parentElement !== document.body
  ) {
    document.body.appendChild(lightbox);
  }

  const lightboxImage =
    document.getElementById("swgLightboxImage");

  const lightboxWrap =
    document.getElementById("swgLightboxImageWrap");

  const zoomLevel =
    document.getElementById("swgZoomLevel");

  const detailToolbarTitle =
    document.getElementById(
      "swgDetailToolbarTitle"
    );

  const detailNumber =
    document.getElementById(
      "swgDetailNumber"
    );

  const detailTitle =
    document.getElementById(
      "swgDetailTitle"
    );

  const detailSituation =
    document.getElementById(
      "swgDetailSituation"
    );

  const detailIntervention =
    document.getElementById(
      "swgDetailIntervention"
    );

  const detailResult =
    document.getElementById(
      "swgDetailResult"
    );

  let lbScale = 1;
  let lbX = 0;
  let lbY = 0;

  const activePointers =
    new Map();

  let dragOrigin = null;
  let pinchStartDistance = null;
  let pinchStartScale = 1;

  /*
    50% = se puede alejar hasta la mitad.
    200% = se puede acercar hasta el doble.
    Es decir, -50% / +100% respecto al tamaño inicial.
  */
  function clampScale(value) {
    return Math.min(
      2,
      Math.max(.5, value)
    );
  }

  function applyLightboxTransform() {
    if (!lightboxImage) return;

    if (lbScale <= 1) {
      lbX = 0;
      lbY = 0;
    }

    lightboxImage.style.transform =
      `translate3d(${lbX}px, ${lbY}px, 0) scale(${lbScale})`;

    if (zoomLevel) {
      zoomLevel.textContent =
        `${Math.round(lbScale * 100)}%`;
    }
  }

  function resetLightboxView() {
    lbScale = 1;
    lbX = 0;
    lbY = 0;

    activePointers.clear();
    dragOrigin = null;
    pinchStartDistance = null;

    applyLightboxTransform();
  }

  function adjustZoom(delta) {
    lbScale =
      clampScale(
        lbScale + delta
      );

    applyLightboxTransform();
  }

  function syncLightbox() {
    if (
      !lightboxImage ||
      !images.length
    ) {
      return;
    }

    const src =
      images[activeIndex];

    const meta =
      metaFor(activeIndex);

    lightboxImage.src = src;
    lightboxImage.alt = meta.title;

    lightboxWrap?.style.setProperty(
      "--swg-lightbox-bg",
      `url("${src}")`
    );

    if (detailToolbarTitle) {
      detailToolbarTitle.textContent =
        meta.title;
    }

    if (detailNumber) {
      detailNumber.textContent =
        `TRABAJO ${String(activeIndex + 1).padStart(2, "0")} · EVIDENCIA EN CAMPO`;
    }

    if (detailTitle) {
      detailTitle.textContent =
        meta.title;
    }

    if (detailSituation) {
      detailSituation.textContent =
        meta.situation;
    }

    if (detailIntervention) {
      detailIntervention.textContent =
        meta.intervention;
    }

    if (detailResult) {
      detailResult.textContent =
        meta.result;
    }

    resetLightboxView();
  }

  function openLightbox() {
    if (!lightbox) return;

    syncLightbox();

    lightbox.classList.add(
      "is-open"
    );

    lightbox.setAttribute(
      "aria-hidden",
      "false"
    );

    document.documentElement.style.overflow =
      "hidden";

    document.body.style.overflow =
      "hidden";

    document.body.classList.add(
      "swg-modal-open"
    );

    pauseAutoplay();

    window.requestAnimationFrame(() => {
      lightbox
        .querySelector("[data-close-lightbox]")
        ?.focus({ preventScroll: true });
    });

    if (window.lucide?.createIcons) {
      window.lucide.createIcons();
    }
  }

  function closeLightbox() {
    if (!lightbox) return;

    lightbox.classList.remove(
      "is-open"
    );

    lightbox.setAttribute(
      "aria-hidden",
      "true"
    );

    document.documentElement.style.overflow =
      "";

    document.body.style.overflow =
      "";

    document.body.classList.remove(
      "swg-modal-open"
    );

    resetLightboxView();
  }

  /*
    Los botones visualmente indican -100 / +100,
    pero el movimiento es progresivo para que sea usable.
  */
  document.getElementById("swgZoomIn")
    ?.addEventListener(
      "click",
      () => adjustZoom(.25)
    );

  document.getElementById("swgZoomOut")
    ?.addEventListener(
      "click",
      () => adjustZoom(-.25)
    );

  document.getElementById("swgZoomReset")
    ?.addEventListener(
      "click",
      resetLightboxView
    );

  document.querySelectorAll(
    "[data-close-lightbox]"
  ).forEach((el) => {
    el.addEventListener(
      "click",
      closeLightbox
    );
  });

  lightboxWrap?.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();

      adjustZoom(
        event.deltaY < 0
          ? .15
          : -.15
      );
    },
    { passive: false }
  );

  function pointerDistance() {
    const pts =
      [...activePointers.values()];

    if (pts.length < 2) {
      return null;
    }

    const dx =
      pts[0].x - pts[1].x;

    const dy =
      pts[0].y - pts[1].y;

    return Math.hypot(dx, dy);
  }

  lightboxWrap?.addEventListener(
    "pointerdown",
    (event) => {
      event.preventDefault();

      lightboxWrap.setPointerCapture?.(
        event.pointerId
      );

      activePointers.set(
        event.pointerId,
        {
          x: event.clientX,
          y: event.clientY
        }
      );

      if (
        activePointers.size === 1
      ) {
        dragOrigin = {
          pointerX: event.clientX,
          pointerY: event.clientY,
          imageX: lbX,
          imageY: lbY
        };
      }

      if (
        activePointers.size === 2
      ) {
        pinchStartDistance =
          pointerDistance();

        pinchStartScale =
          lbScale;

        dragOrigin = null;
      }

      lightboxWrap.classList.add(
        "is-dragging"
      );
    }
  );

  lightboxWrap?.addEventListener(
    "pointermove",
    (event) => {
      if (
        !activePointers.has(
          event.pointerId
        )
      ) {
        return;
      }

      activePointers.set(
        event.pointerId,
        {
          x: event.clientX,
          y: event.clientY
        }
      );

      if (
        activePointers.size >= 2
      ) {
        const distance =
          pointerDistance();

        if (
          pinchStartDistance &&
          distance
        ) {
          lbScale =
            clampScale(
              pinchStartScale *
              (
                distance /
                pinchStartDistance
              )
            );

          applyLightboxTransform();
        }

        return;
      }

      if (
        activePointers.size === 1 &&
        dragOrigin &&
        lbScale > 1
      ) {
        lbX =
          dragOrigin.imageX +
          (
            event.clientX -
            dragOrigin.pointerX
          );

        lbY =
          dragOrigin.imageY +
          (
            event.clientY -
            dragOrigin.pointerY
          );

        applyLightboxTransform();
      }
    }
  );

  function releasePointer(event) {
    activePointers.delete(
      event.pointerId
    );

    if (
      activePointers.size === 0
    ) {
      dragOrigin = null;
      pinchStartDistance = null;

      lightboxWrap?.classList.remove(
        "is-dragging"
      );

      return;
    }

    if (
      activePointers.size === 1
    ) {
      const remaining =
        [...activePointers.values()][0];

      dragOrigin = {
        pointerX: remaining.x,
        pointerY: remaining.y,
        imageX: lbX,
        imageY: lbY
      };

      pinchStartDistance = null;
    }
  }

  lightboxWrap?.addEventListener(
    "pointerup",
    releasePointer
  );

  lightboxWrap?.addEventListener(
    "pointercancel",
    releasePointer
  );

  document.addEventListener(
    "keydown",
    (event) => {
      if (
        lightbox?.classList.contains(
          "is-open"
        )
      ) {
        if (
          event.key === "Escape"
        ) {
          closeLightbox();
        }

        if (
          event.key === "+" ||
          event.key === "="
        ) {
          adjustZoom(.25);
        }

        if (
          event.key === "-"
        ) {
          adjustZoom(-.25);
        }

        return;
      }

      if (
        event.key === "ArrowLeft"
      ) {
        prev(true);
      }

      if (
        event.key === "ArrowRight"
      ) {
        next(true);
      }
    }
  );

  /* =======================================================
     ENTRADA
     ======================================================= */

  if (
    "IntersectionObserver" in window
  ) {
    const observer =
      new IntersectionObserver(
        (entries) => {
          entries.forEach(
            (entry) => {
              if (
                !entry.isIntersecting
              ) {
                return;
              }

              section.classList.add(
                "is-visible"
              );

              observer.unobserve(
                entry.target
              );
            }
          );
        },
        {
          threshold: .12
        }
      );

    observer.observe(section);
  } else {
    section.classList.add(
      "is-visible"
    );
  }

  /* =======================================================
     INIT
     ======================================================= */

  discoverImages().then(
    (found) => {
      images = found;

      if (!images.length) {
        deck.innerHTML = `
          <div style="
            position:absolute;
            inset:0;
            display:grid;
            place-items:center;
            color:rgba(255,255,255,.82);
            font:600 14px/1.5 Inter,system-ui,sans-serif;
            text-align:center;
            padding:30px;">
            Agrega imágenes en assets/img/trabajos/ con nombres
            01.webp, 02.webp, 03.webp...
          </div>`;

        loading?.classList.add(
          "is-hidden"
        );

        return;
      }

      buildCards();

      loading?.classList.add(
        "is-hidden"
      );

      startAutoplay();

      if (
        window.lucide?.createIcons
      ) {
        window.lucide.createIcons();
      }
    }
  );
})();