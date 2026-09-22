document.addEventListener("DOMContentLoaded", () => {
  /* La fotografía que antes era la tercera ahora es la primera */
  const items = [
    {
      src: "assets/img/nosotros-2.webp",
      alt: "Servicio técnico especializado de SEPRIGUA",
      caption: "Servicio técnico especializado"
    },
    {
      src: "assets/img/nosotros-principal-wide.webp",
      alt: "Operación técnica de SEPRIGUA",
      caption: "Operación técnica en campo"
    },
    {
      src: "assets/img/nosotros-1.webp",
      alt: "Personal técnico especializado de SEPRIGUA",
      caption: "Personal técnico especializado"
    }
  ];

  const gallery = document.getElementById("aboutGallery");
  const stage = document.getElementById("aboutGalleryStage");
  const openButton = document.getElementById("aboutGalleryOpen");
  const mainImage = document.getElementById("aboutGalleryMainImage");
  const mainCaption = document.getElementById("aboutGalleryCaption");
  const mainCount = document.getElementById("aboutGalleryCount");
  const thumbs = Array.from(
    document.querySelectorAll(".about-gallery-thumb")
  );

  const lightbox = document.getElementById("aboutLightbox");
  const lightboxImage = document.getElementById("aboutLightboxImage");
  const lightboxCaption = document.getElementById("aboutLightboxCaption");
  const lightboxCount = document.getElementById("aboutLightboxCount");
  const zoomValue = document.getElementById("aboutZoomValue");
  const zoomIn = document.getElementById("aboutZoomIn");
  const zoomOut = document.getElementById("aboutZoomOut");
  const zoomReset = document.getElementById("aboutZoomReset");
  const panToggle = document.getElementById("aboutPanToggle");
  const prevButton = document.getElementById("aboutGalleryPrev");
  const nextButton = document.getElementById("aboutGalleryNext");
  const canvas = lightboxImage?.closest(".about-lightbox-canvas");

  const closeButtons = Array.from(
    document.querySelectorAll("[data-gallery-close]")
  );

  if (!gallery || !stage || !lightbox || !canvas || !lightboxImage) return;

  let currentIndex = 0;
  let zoom = 1;

  let panX = 0;
  let panY = 0;
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragOriginX = 0;
  let dragOriginY = 0;

  let autoplayTimer = null;
  let autoplayPaused = false;

  /* Para pinch / multitouch */
  const activePointers = new Map();
  let pinchStartDistance = 0;
  let pinchStartZoom = 1;
  let pinchStartCenter = null;
  let pinchStartPanX = 0;
  let pinchStartPanY = 0;

  const AUTOPLAY_MS = 3000;

  const formatCount = (index) =>
    `${String(index + 1).padStart(2, "0")} / ${String(items.length).padStart(2, "0")}`;

  const animateMainImage = () => {
    mainImage.classList.remove("gallery-changing");
    void mainImage.offsetWidth;
    mainImage.classList.add("gallery-changing");

    window.setTimeout(() => {
      mainImage.classList.remove("gallery-changing");
    }, 560);
  };

  const setSelected = (index, animate = true) => {
    currentIndex = (index + items.length) % items.length;

    const item = items[currentIndex];

    if (animate) animateMainImage();

    mainImage.src = item.src;
    mainImage.alt = item.alt;
    mainCaption.textContent = item.caption;
    mainCount.textContent = formatCount(currentIndex);

    thumbs.forEach((thumb, i) => {
      thumb.classList.toggle("is-active", i === currentIndex);
      thumb.setAttribute("aria-current", i === currentIndex ? "true" : "false");
    });
  };

  const applyTransform = () => {
    lightboxImage.style.setProperty("--gallery-pan-x", `${panX}px`);
    lightboxImage.style.setProperty("--gallery-pan-y", `${panY}px`);
    lightboxImage.style.setProperty("--gallery-zoom", zoom.toFixed(3));
    zoomValue.textContent = `${Math.round(zoom * 100)}%`;
  };

  const getPanLimits = () => {
    const imageWidth = lightboxImage.clientWidth * zoom;
    const imageHeight = lightboxImage.clientHeight * zoom;

    /*
      Permitimos un pequeño movimiento incluso cerca de 100%,
      pero sin dejar la imagen completamente fuera del visor.
    */
    return {
      x: Math.max(16, (imageWidth - canvas.clientWidth) / 2),
      y: Math.max(16, (imageHeight - canvas.clientHeight) / 2)
    };
  };

  const clampPan = () => {
    const limits = getPanLimits();

    panX = Math.max(-limits.x, Math.min(limits.x, panX));
    panY = Math.max(-limits.y, Math.min(limits.y, panY));

    applyTransform();
  };

  const resetPan = () => {
    panX = 0;
    panY = 0;
    applyTransform();
  };

  const applyZoom = (nextZoom) => {
    zoom = Math.max(0.75, Math.min(3, nextZoom));
    clampPan();
  };

  const syncLightbox = () => {
    const item = items[currentIndex];

    lightboxImage.src = item.src;
    lightboxImage.alt = item.alt;
    lightboxCaption.textContent = item.caption;
    lightboxCount.textContent = formatCount(currentIndex);

    zoom = 1;
    panX = 0;
    panY = 0;

    applyTransform();

    panToggle?.classList.add("is-active");
    panToggle?.setAttribute("aria-pressed", "true");
  };

  const stopAutoplay = () => {
    if (!autoplayTimer) return;
    window.clearInterval(autoplayTimer);
    autoplayTimer = null;
  };

  const startAutoplay = () => {
    stopAutoplay();

    if (autoplayPaused || lightbox.classList.contains("is-open")) return;

    autoplayTimer = window.setInterval(() => {
      setSelected(currentIndex + 1, true);
    }, AUTOPLAY_MS);
  };

  const restartAutoplay = () => {
    stopAutoplay();
    window.setTimeout(startAutoplay, 450);
  };

  const openLightbox = () => {
    stopAutoplay();
    syncLightbox();

    lightbox.classList.add("is-open");
    lightbox.setAttribute("aria-hidden", "false");
    document.body.classList.add("about-gallery-opened");

    requestAnimationFrame(() => {
      lightbox.querySelector(".about-lightbox-close")?.focus();
    });
  };

  const closeLightbox = () => {
    lightbox.classList.remove("is-open");
    lightbox.setAttribute("aria-hidden", "true");
    document.body.classList.remove("about-gallery-opened");

    zoom = 1;
    panX = 0;
    panY = 0;
    applyTransform();

    activePointers.clear();
    isDragging = false;

    stage.focus({ preventScroll: true });
    restartAutoplay();
  };

  const move = (direction) => {
    setSelected(currentIndex + direction, false);
    syncLightbox();
  };

  thumbs.forEach((thumb) => {
    thumb.addEventListener("click", () => {
      const index = Number(thumb.dataset.galleryIndex);
      if (!Number.isFinite(index)) return;

      setSelected(index, true);
      restartAutoplay();
    });

    thumb.addEventListener("dblclick", () => {
      const index = Number(thumb.dataset.galleryIndex);
      if (!Number.isFinite(index)) return;

      setSelected(index, false);
      openLightbox();
    });
  });

  stage.addEventListener("click", openLightbox);
  openButton?.addEventListener("click", openLightbox);

  gallery.addEventListener("pointerenter", () => {
    autoplayPaused = true;
    stopAutoplay();
  });

  gallery.addEventListener("pointerleave", () => {
    autoplayPaused = false;
    startAutoplay();
  });

  gallery.addEventListener(
    "touchstart",
    () => {
      autoplayPaused = true;
      stopAutoplay();
    },
    { passive: true }
  );

  gallery.addEventListener(
    "touchend",
    () => {
      autoplayPaused = false;
      restartAutoplay();
    },
    { passive: true }
  );

  closeButtons.forEach((button) => {
    button.addEventListener("click", closeLightbox);
  });

  prevButton?.addEventListener("click", () => move(-1));
  nextButton?.addEventListener("click", () => move(1));

  zoomIn?.addEventListener("click", () => applyZoom(zoom + 0.25));
  zoomOut?.addEventListener("click", () => applyZoom(zoom - 0.25));

  zoomReset?.addEventListener("click", () => {
    zoom = 1;
    panX = 0;
    panY = 0;
    applyTransform();
  });

  /*
    La mano ya no se apaga: siempre significa que puedes mover.
    Si el usuario la toca en 100%, da un zoom útil para explorar.
  */
  panToggle?.addEventListener("click", () => {
    if (zoom <= 1.001) {
      applyZoom(1.35);
    }

    panToggle.classList.add("is-active");
    panToggle.setAttribute("aria-pressed", "true");
  });

  canvas.addEventListener("dblclick", () => {
    if (zoom > 1.001) {
      zoom = 1;
      panX = 0;
      panY = 0;
      applyTransform();
    } else {
      applyZoom(1.6);
    }
  });

  const pointerDistance = (a, b) =>
    Math.hypot(
      b.clientX - a.clientX,
      b.clientY - a.clientY
    );

  const pointerCenter = (a, b) => ({
    x: (a.clientX + b.clientX) / 2,
    y: (a.clientY + b.clientY) / 2
  });

  canvas.addEventListener("pointerdown", (event) => {
    activePointers.set(event.pointerId, {
      clientX: event.clientX,
      clientY: event.clientY
    });

    canvas.setPointerCapture?.(event.pointerId);

    /* Dos dedos/pointers = pinch */
    if (activePointers.size === 2) {
      const [a, b] = Array.from(activePointers.values());

      pinchStartDistance = pointerDistance(a, b);
      pinchStartZoom = zoom;
      pinchStartCenter = pointerCenter(a, b);
      pinchStartPanX = panX;
      pinchStartPanY = panY;

      isDragging = false;
      canvas.classList.add("is-panning");

      event.preventDefault();
      return;
    }

    /* Un solo puntero = pan siempre disponible.
       Si está en 100%, hacemos un pequeño autozoom para que el movimiento sea útil. */
    if (activePointers.size === 1) {
      if (zoom <= 1.001) {
        applyZoom(1.28);
      }

      isDragging = true;
      dragStartX = event.clientX;
      dragStartY = event.clientY;
      dragOriginX = panX;
      dragOriginY = panY;

      canvas.classList.add("is-panning");
      event.preventDefault();
    }
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!activePointers.has(event.pointerId)) return;

    activePointers.set(event.pointerId, {
      clientX: event.clientX,
      clientY: event.clientY
    });

    /* PINCH ZOOM + movimiento del centro */
    if (activePointers.size === 2) {
      const [a, b] = Array.from(activePointers.values());

      const distance = pointerDistance(a, b);
      const center = pointerCenter(a, b);

      if (pinchStartDistance > 0) {
        zoom = Math.max(
          0.75,
          Math.min(
            3,
            pinchStartZoom * (distance / pinchStartDistance)
          )
        );

        panX =
          pinchStartPanX +
          (center.x - pinchStartCenter.x);

        panY =
          pinchStartPanY +
          (center.y - pinchStartCenter.y);

        clampPan();
      }

      event.preventDefault();
      return;
    }

    /* PAN normal */
    if (isDragging && activePointers.size === 1) {
      panX = dragOriginX + (event.clientX - dragStartX);
      panY = dragOriginY + (event.clientY - dragStartY);

      clampPan();
      event.preventDefault();
    }
  });

  const endPointer = (event) => {
    activePointers.delete(event.pointerId);

    try {
      canvas.releasePointerCapture?.(event.pointerId);
    } catch (_) {}

    if (activePointers.size === 0) {
      isDragging = false;
      canvas.classList.remove("is-panning");
      return;
    }

    /*
      Si termina un pinch y queda un dedo/puntero,
      continuamos automáticamente con pan desde esa posición.
    */
    if (activePointers.size === 1) {
      const [remaining] = Array.from(activePointers.values());

      isDragging = true;
      dragStartX = remaining.clientX;
      dragStartY = remaining.clientY;
      dragOriginX = panX;
      dragOriginY = panY;

      canvas.classList.add("is-panning");
    }
  };

  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);

  canvas.addEventListener(
    "wheel",
    (event) => {
      if (!lightbox.classList.contains("is-open")) return;

      event.preventDefault();

      applyZoom(
        zoom + (event.deltaY < 0 ? 0.15 : -0.15)
      );
    },
    { passive: false }
  );

  document.addEventListener("keydown", (event) => {
    if (!lightbox.classList.contains("is-open")) return;

    if (event.key === "Escape") {
      closeLightbox();
    } else if (event.key === "ArrowLeft") {
      move(-1);
    } else if (event.key === "ArrowRight") {
      move(1);
    } else if (event.key === "+" || event.key === "=") {
      applyZoom(zoom + 0.25);
    } else if (event.key === "-") {
      applyZoom(zoom - 0.25);
    } else if (event.key === "0") {
      zoom = 1;
      panX = 0;
      panY = 0;
      applyTransform();
    }
  });

  setSelected(0, false);
  panToggle?.classList.add("is-active");
  panToggle?.setAttribute("aria-pressed", "true");
  startAutoplay();

  window.lucide?.createIcons();
});
