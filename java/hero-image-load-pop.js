(() => {
  "use strict";

  const container =
    document.querySelector(
      "#inicio .hero-image-container"
    );

  const image =
    container?.querySelector(
      ".hero-image"
    );

  if (!container || !image) return;

  let hasPlayed = false;

  const playOnce = () => {
    if (hasPlayed) return;
    hasPlayed = true;

    /*
      Doble RAF:
      garantiza que el navegador haya pintado el estado inicial
      antes de comenzar la animación.
    */
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        container.classList.add(
          "hero-image-first-pop"
        );
      });
    });

    image.addEventListener(
      "animationend",
      (event) => {
        if (
          event.animationName !==
          "sepriguaHeroImageFirstPop"
        ) {
          return;
        }

        container.classList.add(
          "hero-image-pop-finished"
        );
      },
      { once: true }
    );
  };

  /*
    Si la imagen ya está en caché, ejecuta enseguida.
    Si no, espera su carga real.
  */
  if (
    image.complete &&
    image.naturalWidth > 0
  ) {
    playOnce();
  } else {
    image.addEventListener(
      "load",
      playOnce,
      { once: true }
    );
  }

  /*
    Fallback por si el navegador tarda en disparar load.
  */
  window.setTimeout(
    playOnce,
    1200
  );
})();
