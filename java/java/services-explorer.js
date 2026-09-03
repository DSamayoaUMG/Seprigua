document.addEventListener("DOMContentLoaded", () => {
  const explorer = document.getElementById("servicesExplorer");
  if (!explorer) return;

  const bg = document.getElementById("serviceExplorerBg");
  const bgWrap = explorer.querySelector(".service-explorer-background");
  const copy = explorer.querySelector(".service-explorer-copy");
  const eyebrow = document.getElementById("serviceExplorerEyebrow");
  const title = document.getElementById("serviceExplorerTitle");
  const description = document.getElementById("serviceExplorerDescription");
  const metaOne = document.getElementById("serviceMetaOne");
  const metaTwo = document.getElementById("serviceMetaTwo");
  const current = document.getElementById("serviceExplorerCurrent");
  const bigIndex = document.getElementById("serviceExplorerBigIndex");
  const progress = document.getElementById("serviceExplorerProgressFill");
  const prev = document.getElementById("serviceExplorerPrev");
  const next = document.getElementById("serviceExplorerNext");
  const railWindow = document.getElementById("serviceExplorerRailWindow");

  const cards = Array.from(
    explorer.querySelectorAll(".service-explorer-card")
  );

  if (!cards.length) return;

  let activeIndex = 0;
  let autoplayTimer = null;
  let paused = false;

  const AUTOPLAY_MS = 4800;

  const formatIndex = (index) =>
    String(index + 1).padStart(2, "0");

  const centerCard = (card, smooth = true) => {
    if (!railWindow || !card) return;

    const target =
      card.offsetLeft -
      (railWindow.clientWidth - card.offsetWidth) / 2;

    railWindow.scrollTo({
      left: Math.max(0, target),
      behavior: smooth ? "smooth" : "auto"
    });
  };

  const applyService = (index, userInitiated = false) => {
    const nextIndex =
      (index + cards.length) % cards.length;

    const card = cards[nextIndex];

    if (!card || nextIndex === activeIndex && !userInitiated) {
      return;
    }

    activeIndex = nextIndex;

    cards.forEach((item, i) => {
      item.classList.toggle("is-active", i === activeIndex);
      item.setAttribute(
        "aria-current",
        i === activeIndex ? "true" : "false"
      );
    });

    copy?.classList.add("is-changing");
    bg?.classList.add("is-changing");

    window.setTimeout(() => {
      const image = card.dataset.image || "";
      const titleHtml = card.dataset.titleHtml || card.dataset.title || "";
      const desc = card.dataset.description || "";
      const metaOneText = card.dataset.metaOne || "Servicio respaldado";
      const metaTwoText = card.dataset.metaTwo || "Equipo especializado";

      if (image && bgWrap) {
        bgWrap.style.setProperty(
          "--service-bg-image",
          `url("${image}")`
        );
      }

      if (bg && image) bg.src = image;
      if (title) title.innerHTML = titleHtml;
      if (description) description.textContent = desc;
      if (metaOne) metaOne.textContent = metaOneText;
      if (metaTwo) metaTwo.textContent = metaTwoText;
      if (eyebrow) {
        eyebrow.textContent =
          `SERVICIO ${formatIndex(activeIndex)} · SEPRIGUA`;
      }

      if (current) current.textContent = formatIndex(activeIndex);
      if (bigIndex) bigIndex.textContent = formatIndex(activeIndex);

      if (progress) {
        progress.style.width =
          `${((activeIndex + 1) / cards.length) * 100}%`;
      }

      centerCard(card, true);

      requestAnimationFrame(() => {
        copy?.classList.remove("is-changing");
        bg?.classList.remove("is-changing");
      });
    }, 220);

    if (userInitiated) restartAutoplay();
  };

  const stopAutoplay = () => {
    if (!autoplayTimer) return;
    clearInterval(autoplayTimer);
    autoplayTimer = null;
  };

  const startAutoplay = () => {
    stopAutoplay();

    if (paused || document.hidden) return;

    autoplayTimer = setInterval(() => {
      applyService(activeIndex + 1, false);
    }, AUTOPLAY_MS);
  };

  const restartAutoplay = () => {
    stopAutoplay();

    window.setTimeout(
      startAutoplay,
      650
    );
  };

  cards.forEach((card, index) => {
    card.addEventListener("click", () => {
      applyService(index, true);
    });
  });

  prev?.addEventListener("click", () => {
    applyService(activeIndex - 1, true);
  });

  next?.addEventListener("click", () => {
    applyService(activeIndex + 1, true);
  });

  explorer.addEventListener("pointerenter", () => {
    paused = true;
    stopAutoplay();
  });

  explorer.addEventListener("pointerleave", () => {
    paused = false;
    startAutoplay();
  });

  explorer.addEventListener(
    "touchstart",
    () => {
      paused = true;
      stopAutoplay();
    },
    { passive: true }
  );

  explorer.addEventListener(
    "touchend",
    () => {
      paused = false;
      restartAutoplay();
    },
    { passive: true }
  );

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopAutoplay();
    } else {
      startAutoplay();
    }
  });

  window.addEventListener(
    "resize",
    () => {
      centerCard(cards[activeIndex], false);
    },
    { passive: true }
  );

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && entry.intersectionRatio > .18) {
          explorer.classList.add("visible");
          startAutoplay();
        } else {
          stopAutoplay();
        }
      },
      {
        threshold: [0, .18, .42]
      }
    );

    observer.observe(explorer);
  } else {
    explorer.classList.add("visible");
    startAutoplay();
  }

  cards[0].setAttribute("aria-current", "true");

  if (bgWrap) {
    const initialImage =
      cards[0].dataset.image ||
      bg?.getAttribute("src") ||
      "";

    if (initialImage) {
      bgWrap.style.setProperty(
        "--service-bg-image",
        `url("${initialImage}")`
      );
    }
  }

  if (progress) progress.style.width = `${100 / cards.length}%`;

  requestAnimationFrame(() => {
    centerCard(cards[0], false);
  });

  window.lucide?.createIcons();
});


/* =========================================================
   SEPRIGUA V46 — ACTIVADOR DE MODO FULLSCREEN
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  const explorer =
    document.getElementById("servicesExplorer");

  const stage =
    explorer?.querySelector(
      ".service-explorer-stage"
    );

  const header =
    document.getElementById("header");

  if (!explorer || !stage) return;


  /* calcula el final real del navbar para que el stage llene
     exactamente el espacio restante del viewport */
  const syncStickyTop = () => {
    let top = 84;

    if (header) {
      const rect =
        header.getBoundingClientRect();

      /*
        En layouts con header fixed/sticky, rect.bottom es la
        referencia correcta. Dejamos un margen mínimo.
      */
      if (
        Number.isFinite(rect.bottom) &&
        rect.bottom > 30 &&
        rect.bottom < window.innerHeight * .35
      ) {
        top =
          Math.round(
            rect.bottom + 8
          );
      }
    }

    explorer.style.setProperty(
      "--services-sticky-top",
      `${top}px`
    );

    document
      .getElementById("servicios")
      ?.style.setProperty(
        "--services-sticky-top",
        `${top}px`
      );
  };


  syncStickyTop();

  window.addEventListener(
    "resize",
    syncStickyTop,
    { passive: true }
  );


  /*
    Fullscreen solo en desktop/tablet grande.
    En móvil la sección ya tiene su layout vertical propio.
  */
  const desktop =
    window.matchMedia(
      "(min-width: 821px)"
    );


  let focusObserver = null;


  const setFocusMode = (
    enabled
  ) => {
    explorer.classList.toggle(
      "is-focus-mode",
      enabled
    );
  };


  const buildObserver = () => {
    focusObserver?.disconnect();
    focusObserver = null;

    if (!desktop.matches) {
      setFocusMode(false);
      return;
    }

    focusObserver =
      new IntersectionObserver(
        ([entry]) => {

          /*
            Se expande cuando una buena parte del explorer
            ya llegó a pantalla, no apenas asoma.
          */
          if (
            entry.isIntersecting &&
            entry.intersectionRatio >= .36
          ) {
            setFocusMode(true);
          } else if (
            !entry.isIntersecting ||
            entry.intersectionRatio <= .16
          ) {
            setFocusMode(false);
          }

        },
        {
          threshold: [
            0,
            .16,
            .36,
            .60,
            .85
          ]
        }
      );

    focusObserver.observe(stage);
  };


  buildObserver();


  const handleMediaChange = () => {
    syncStickyTop();
    buildObserver();
  };


  if (desktop.addEventListener) {
    desktop.addEventListener(
      "change",
      handleMediaChange
    );
  } else {
    desktop.addListener(
      handleMediaChange
    );
  }


  /*
    Cuando el usuario pulsa Servicios en el navbar:
    primero ve el encabezado, y al seguir bajando llega
    naturalmente a la transición fullscreen.
    No forzamos ni bloqueamos el scroll.
  */
});
