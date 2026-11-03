document.addEventListener("DOMContentLoaded", () => {
  const heroContent =
    document.querySelector(".hero-content");

  const truck =
    document.querySelector(".hero-image-container");

  const truckImage =
    truck?.querySelector(".hero-image");

  const reducedMotion =
    window.matchMedia?.(
      "(prefers-reduced-motion: reduce)"
    ).matches;

  const finePointer =
    window.matchMedia?.(
      "(hover: hover) and (pointer: fine)"
    ).matches;


  /* =======================================================
     EYEBROW + TÍTULO
     ======================================================= */

  if (heroContent) {

    const playHero = () => {
      if (
        heroContent.classList.contains(
          "hero-wow-play"
        )
      ) return;

      heroContent.classList.add(
        "hero-wow-play"
      );
    };


    if (
      heroContent.classList.contains(
        "visible"
      )
    ) {

      window.setTimeout(
        playHero,
        80
      );

    } else {

      const observer =
        new MutationObserver(() => {

          if (
            !heroContent.classList.contains(
              "visible"
            )
          ) return;

          window.setTimeout(
            playHero,
            80
          );

          observer.disconnect();

        });


      observer.observe(
        heroContent,
        {
          attributes: true,
          attributeFilter: ["class"]
        }
      );


      window.setTimeout(
        playHero,
        650
      );

    }

  }


  /* =======================================================
     CAMIÓN — PARALLAX REAL CON INERCIA
     ======================================================= */

  if (
    truck &&
    truckImage &&
    finePointer &&
    !reducedMotion
  ) {

    truck.classList.add(
      "hero-truck-interactive"
    );


    const current = {
      rx: 0,
      ry: 0,
      x: 0,
      y: 0
    };


    const target = {
      rx: 0,
      ry: 0,
      x: 0,
      y: 0
    };


    let hovering = false;
    let rafId = null;


    const applyTruckTransform = () => {

      current.rx +=
        (target.rx - current.rx) * .115;

      current.ry +=
        (target.ry - current.ry) * .115;

      current.x +=
        (target.x - current.x) * .13;

      current.y +=
        (target.y - current.y) * .13;


      truck.style.setProperty(
        "--truck-rx",
        `${current.rx.toFixed(3)}deg`
      );

      truck.style.setProperty(
        "--truck-ry",
        `${current.ry.toFixed(3)}deg`
      );

      truck.style.setProperty(
        "--truck-x",
        `${current.x.toFixed(2)}px`
      );

      truck.style.setProperty(
        "--truck-y",
        `${current.y.toFixed(2)}px`
      );


      const stillMoving =
        Math.abs(target.rx - current.rx) > .01 ||
        Math.abs(target.ry - current.ry) > .01 ||
        Math.abs(target.x - current.x) > .05 ||
        Math.abs(target.y - current.y) > .05;


      if (
        hovering ||
        stillMoving
      ) {

        rafId =
          requestAnimationFrame(
            applyTruckTransform
          );

      } else {

        rafId = null;

      }

    };


    const ensureTruckFrame = () => {

      if (rafId) return;

      rafId =
        requestAnimationFrame(
          applyTruckTransform
        );

    };


    truck.addEventListener(
      "pointerenter",
      () => {

        hovering = true;
        ensureTruckFrame();

      }
    );


    truck.addEventListener(
      "pointermove",
      (event) => {

        const rect =
          truck.getBoundingClientRect();


        const px =
          (event.clientX - rect.left) /
          rect.width;

        const py =
          (event.clientY - rect.top) /
          rect.height;


        const nx =
          Math.max(
            -1,
            Math.min(
              1,
              (px - .5) * 2
            )
          );

        const ny =
          Math.max(
            -1,
            Math.min(
              1,
              (py - .5) * 2
            )
          );


        /*
          Movimiento claramente visible,
          pero todavía dentro del frame.
        */
        target.rx =
          -ny * 3.2;

        target.ry =
          nx * 4.4;

        target.x =
          nx * 18;

        target.y =
          ny * 11;


        truck.style.setProperty(
          "--truck-glow-x",
          `${px * 100}%`
        );

        truck.style.setProperty(
          "--truck-glow-y",
          `${py * 100}%`
        );


        ensureTruckFrame();

      }
    );


    truck.addEventListener(
      "pointerleave",
      () => {

        hovering = false;

        target.rx = 0;
        target.ry = 0;
        target.x = 0;
        target.y = 0;


        truck.style.setProperty(
          "--truck-glow-x",
          "50%"
        );

        truck.style.setProperty(
          "--truck-glow-y",
          "50%"
        );


        ensureTruckFrame();

      }
    );

  }


  /* =======================================================
     CARRUSEL DE LAS 4 FORTALEZAS
     ======================================================= */

  const carousel =
    document.querySelector(
      ".hero-feature-carousel"
    );

  const viewport =
    carousel?.querySelector(
      ".hero-feature-carousel-window"
    );

  const track =
    carousel?.querySelector(
      ".hero-feature-carousel-track"
    );

  const prevButton =
    carousel?.querySelector(
      ".hero-feature-carousel-prev"
    );

  const nextButton =
    carousel?.querySelector(
      ".hero-feature-carousel-next"
    );


  if (
    carousel &&
    viewport &&
    track
  ) {

    const originalCards =
      Array.from(
        track.querySelectorAll(
          "[data-feature-card]"
        )
      );


    const originalCount =
      originalCards.length;


    if (originalCount > 1) {

      /*
        Duplicamos un set antes y otro después.
        Esto permite movimiento infinito sin saltos visibles.
      */
      const before =
        originalCards.map(
          (card) => {

            const clone =
              card.cloneNode(true);

            clone.dataset.carouselClone =
              "before";

            clone.removeAttribute(
              "data-feature-card"
            );

            return clone;

          }
        );


      const after =
        originalCards.map(
          (card) => {

            const clone =
              card.cloneNode(true);

            clone.dataset.carouselClone =
              "after";

            clone.removeAttribute(
              "data-feature-card"
            );

            return clone;

          }
        );


      before
        .reverse()
        .forEach((clone) => {
          track.prepend(clone);
        });


      after
        .forEach((clone) => {
          track.append(clone);
        });


      const cards =
        Array.from(
          track.children
        );


      /*
        Por cómo se insertaron los clones,
        los originales empiezan justo después
        de originalCount tarjetas.
      */
      let currentIndex =
        originalCount;

      let autoplayTimer = null;
      let isPaused = false;
      let resizeTimer = null;


      const AUTOPLAY_MS =
        2700;

      const TRANSITION_MS =
        680;


      const setVisualClasses = () => {

        cards.forEach(
          (card, index) => {

            const diff =
              Math.abs(
                index -
                currentIndex
              );


            card.classList.toggle(
              "is-active",
              diff === 0
            );

            card.classList.toggle(
              "is-near",
              diff === 1
            );

            card.classList.toggle(
              "is-edge",
              diff >= 2
            );

          }
        );

      };


      const centerCurrentCard = (
        animate = true
      ) => {

        const active =
          cards[currentIndex];

        if (!active) return;


        if (!animate) {

          track.style.transition =
            "none";

        } else {

          track.style.transition = "";

        }


        const viewportWidth =
          viewport.clientWidth;

        const activeCenter =
          active.offsetLeft +
          active.offsetWidth / 2;


        const translate =
          viewportWidth / 2 -
          activeCenter;


        track.style.transform =
          `translate3d(${translate}px,0,0)`;


        setVisualClasses();


        if (!animate) {

          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              track.style.transition = "";
            });
          });

        }

      };


      const normalizeInfiniteIndex =
        () => {

          /*
            Originales ocupan:
            originalCount ... originalCount*2-1

            Si entramos al set clonado de la derecha,
            regresamos al original equivalente
            sin animación.
          */
          if (
            currentIndex >=
            originalCount * 2
          ) {

            currentIndex -=
              originalCount;

            centerCurrentCard(false);

          } else if (
            currentIndex <
            originalCount
          ) {

            currentIndex +=
              originalCount;

            centerCurrentCard(false);

          }

      };


      const goTo = (
        index,
        userInitiated = false
      ) => {

        currentIndex = index;

        centerCurrentCard(true);


        window.setTimeout(
          normalizeInfiniteIndex,
          TRANSITION_MS + 35
        );


        if (userInitiated) {
          restartAutoplay();
        }

      };


      const next = (
        userInitiated = false
      ) => {

        goTo(
          currentIndex + 1,
          userInitiated
        );

      };


      const prev = (
        userInitiated = false
      ) => {

        goTo(
          currentIndex - 1,
          userInitiated
        );

      };


      const stopAutoplay = () => {

        if (!autoplayTimer) return;

        window.clearInterval(
          autoplayTimer
        );

        autoplayTimer = null;

      };


      const startAutoplay = () => {

        stopAutoplay();

        if (
          reducedMotion ||
          isPaused
        ) return;


        autoplayTimer =
          window.setInterval(
            () => {
              next(false);
            },
            AUTOPLAY_MS
          );

      };


      const restartAutoplay = () => {

        stopAutoplay();

        window.setTimeout(
          startAutoplay,
          700
        );

      };


      prevButton?.addEventListener(
        "click",
        () => prev(true)
      );


      nextButton?.addEventListener(
        "click",
        () => next(true)
      );


      /*
        Pausa al interactuar.
        El usuario puede leer y ampliar
        cualquier tarjeta sin que se le escape.
      */
      carousel.addEventListener(
        "pointerenter",
        () => {

          if (!finePointer) return;

          isPaused = true;
          stopAutoplay();

        }
      );


      carousel.addEventListener(
        "pointerleave",
        () => {

          if (!finePointer) return;

          isPaused = false;
          startAutoplay();

        }
      );


      carousel.addEventListener(
        "focusin",
        () => {

          isPaused = true;
          stopAutoplay();

        }
      );


      carousel.addEventListener(
        "focusout",
        () => {

          isPaused = false;
          startAutoplay();

        }
      );


      /*
        En touch también se pausa mientras
        el usuario toca/desliza.
      */
      carousel.addEventListener(
        "touchstart",
        () => {

          isPaused = true;
          stopAutoplay();

        },
        { passive: true }
      );


      carousel.addEventListener(
        "touchend",
        () => {

          isPaused = false;
          restartAutoplay();

        },
        { passive: true }
      );


      window.addEventListener(
        "resize",
        () => {

          window.clearTimeout(
            resizeTimer
          );


          resizeTimer =
            window.setTimeout(
              () => {
                centerCurrentCard(false);
              },
              120
            );

        },
        { passive: true }
      );


      /*
        Esperamos a que el navegador termine
        de calcular tamaños e iconos.
      */
      requestAnimationFrame(() => {

        requestAnimationFrame(() => {

          centerCurrentCard(false);
          startAutoplay();

        });

      });

    }

  }




  /* =======================================================
     V33 — POP DE ATENCIÓN PARA LOS CTA
     ======================================================= */

  const setupAttentionPop = (
    element,
    {
      firstDelay = 2000,
      repeatEvery = 9000
    } = {}
  ) => {

    if (!element) return;

    if (!element.querySelector(".cta-attention-ring")) {
      const ring = document.createElement("i");
      ring.className = "cta-attention-ring";
      ring.setAttribute("aria-hidden", "true");
      element.appendChild(ring);
    }

    let hovering = false;

    const isVisible = () => {
      const rect = element.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight;
      return rect.bottom > 0 && rect.top < vh;
    };

    const play = () => {
      if (hovering || document.hidden || !isVisible()) return;

      element.classList.remove("cta-attention-pop");
      void element.offsetWidth;
      element.classList.add("cta-attention-pop");

      window.setTimeout(() => {
        element.classList.remove("cta-attention-pop");
      }, 920);
    };

    element.addEventListener("pointerenter", () => {
      hovering = true;
      element.classList.remove("cta-attention-pop");
    });

    element.addEventListener("pointerleave", () => {
      hovering = false;
    });

    window.setTimeout(play, firstDelay);
    window.setInterval(play, repeatEvery);
  };
setupAttentionPop(
    document.querySelector(".chat-button"),
    { firstDelay: 3200, repeatEvery: 9000 }
  );


  /* =======================================================
     V33 — CAMIÓN EN MOVIMIENTO TIPO ENGRANAJE
     ======================================================= */

  const inicioSection = document.getElementById("inicio");

  if (
    truck &&
    truckImage &&
    !truck.querySelector(".hero-gear-stage")
  ) {
    const stage = document.createElement("div");
    stage.className = "hero-gear-stage";

    truck.insertBefore(stage, truckImage);
    stage.appendChild(truckImage);
}

  const setAmbientActive = (active) => {
    truck?.classList.toggle("hero-ambient-active", active);
  };

  if (
    inicioSection &&
    truck &&
    "IntersectionObserver" in window
  ) {
    const ambientObserver = new IntersectionObserver(
      ([entry]) => {
        setAmbientActive(
          entry.isIntersecting &&
          entry.intersectionRatio > .14
        );
      },
      {
        threshold: [0, .14, .28, .5]
      }
    );

    ambientObserver.observe(inicioSection);
  } else {
    setAmbientActive(true);
  }



  /* Renderiza iconos originales, clones y controles */
  window.lucide?.createIcons();

});
