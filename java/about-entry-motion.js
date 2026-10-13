document.addEventListener("DOMContentLoaded", () => {
  const aboutSection = document.getElementById("nosotros");
  const aboutText = aboutSection?.querySelector(".about-text");

  if (!aboutSection) return;

  const reducedMotion = window.matchMedia?.(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  /* =======================================================
     CONTADORES — CONTROLADOS POR V44
     ======================================================= */

  const counters = Array.from(
    aboutSection.querySelectorAll(
      "[data-about-counter]"
    )
  );

  let counterFrame = null;

  const resetCounters = () => {
    if (counterFrame) {
      cancelAnimationFrame(counterFrame);
      counterFrame = null;
    }

    counters.forEach((counter) => {
      counter.textContent = "0";

      counter
        .closest(".stat-number")
        ?.classList.remove(
          "about-counter-finished"
        );
    });
  };

  const runCounters = () => {
    if (reducedMotion) {
      counters.forEach((counter) => {
        const target =
          Number(counter.dataset.aboutCounter) || 0;

        counter.textContent =
          target.toLocaleString("es-GT");
      });

      return;
    }

    resetCounters();

    const start = performance.now();
    const duration = 1450;

    const tick = (now) => {
      const progress =
        Math.min(
          (now - start) / duration,
          1
        );

      /* easeOutCubic */
      const eased =
        1 -
        Math.pow(
          1 - progress,
          3
        );

      counters.forEach((counter) => {
        const target =
          Number(counter.dataset.aboutCounter) || 0;

        const value =
          Math.floor(
            target * eased
          );

        counter.textContent =
          value.toLocaleString("es-GT");
      });

      if (progress < 1) {
        counterFrame =
          requestAnimationFrame(tick);
      } else {
        counterFrame = null;

        counters.forEach((counter) => {
          const target =
            Number(counter.dataset.aboutCounter) || 0;

          counter.textContent =
            target.toLocaleString("es-GT");

          const number =
            counter.closest(".stat-number");

          number?.classList.remove(
            "about-counter-finished"
          );

          void number?.offsetWidth;

          number?.classList.add(
            "about-counter-finished"
          );
        });
      }
    };

    counterFrame =
      requestAnimationFrame(tick);
  };


  /* =======================================================
     SECUENCIA COMPLETA DE NOSOTROS
     ======================================================= */

  let sequenceTimer = null;
  let counterTimer = null;
  let aboutEntrancePlayed = false;

  const clearSequenceTimers = () => {
    if (sequenceTimer) {
      clearTimeout(sequenceTimer);
      sequenceTimer = null;
    }

    if (counterTimer) {
      clearTimeout(counterTimer);
      counterTimer = null;
    }
  };

  const playAboutSequenceOnce = () => {
    if (aboutEntrancePlayed) return;
    aboutEntrancePlayed = true;

    clearSequenceTimers();

    aboutSection.classList.remove(
      "about-full-play",
      "about-sequence-done"
    );

    aboutSection.classList.add(
      "about-sequence-ready"
    );

    if (aboutText) {
      aboutText.classList.remove(
        "about-protagonist-play"
      );
    }

    resetCounters();

    /* Reflow para poder repetir TODO */
    void aboutSection.offsetWidth;

    if (aboutText) {
      aboutText.classList.add(
        "about-protagonist-play"
      );
    }

    aboutSection.classList.add(
      "about-full-play"
    );

    /*
      El recuento empieza cuando las tarjetas
      de estadísticas ya están entrando.
    */
    counterTimer =
      window.setTimeout(
        runCounters,
        1030
      );

    /*
      Después de la entrada dejamos los elementos
      libres para sus hovers/transiciones normales.
    */
    sequenceTimer =
      window.setTimeout(
        () => {
          aboutSection.classList.remove(
            "about-sequence-ready",
            "about-full-play"
          );

          aboutSection.classList.add(
            "about-sequence-done"
          );
        },
        2550
      );
  };


  /* =======================================================
     NAVEGACIÓN
     ======================================================= */

  /*
    La navegación de anclas vive únicamente en
    navbar-gear-indicator.js. Este archivo dispara la entrada de
    Nosotros únicamente si todavía no se reprodujo en esta carga.
    Así evitamos repetir transiciones al volver a la sección.
  */
  window.addEventListener("seprigua:section-navigate", (event) => {
    if (event.detail?.id !== "nosotros") return;

    window.setTimeout(
      playAboutSequenceOnce,
      reducedMotion ? 0 : 260
    );
  });


  /* =======================================================
     ENTRADA ÚNICA DE NOSOTROS MEDIANTE SCROLL
     ======================================================= */

  if (
    "IntersectionObserver" in window
  ) {
    const observer =
      new IntersectionObserver(
        ([entry]) => {
          if (
            entry.isIntersecting &&
            entry.intersectionRatio > .22
          ) {
            playAboutSequenceOnce();
            observer.unobserve(entry.target);
          }
        },
        {
          threshold: [
            0,
            .22,
            .40
          ]
        }
      );

    observer.observe(
      aboutSection
    );
  } else {
    playAboutSequenceOnce();
  }
});
