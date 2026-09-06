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
  let armed = true;

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

  const replayAboutSequence = () => {
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
    navbar-gear-indicator.js. Este archivo se limita a reproducir
    la animación de Nosotros cuando el navegador le avisa que esa
    sección fue seleccionada. Así evitamos dos scripts intentando
    mover la página al mismo tiempo.
  */
  window.addEventListener("seprigua:section-navigate", (event) => {
    if (event.detail?.id !== "nosotros") return;

    armed = false;
    window.setTimeout(
      replayAboutSequence,
      reducedMotion ? 0 : 260
    );
  });


  /* =======================================================
     AL ENTRAR A NOSOTROS MEDIANTE SCROLL
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
            if (armed) {
              armed = false;
              replayAboutSequence();
            }
          } else if (
            !entry.isIntersecting ||
            entry.intersectionRatio < .06
          ) {
            armed = true;

            aboutSection.classList.remove(
              "about-full-play"
            );
          }
        },
        {
          threshold: [
            0,
            .06,
            .22,
            .40
          ]
        }
      );

    observer.observe(
      aboutSection
    );
  } else {
    replayAboutSequence();
  }
});
