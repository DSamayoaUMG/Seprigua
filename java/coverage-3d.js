document.addEventListener("DOMContentLoaded", () => {
  const stage =
    document.querySelector(
      ".coverage-map-3d-stage"
    );

  const map =
    document.getElementById(
      "coverageMap3D"
    );

  const object =
    stage?.querySelector(
      ".coverage-map-object"
    );

  if (!stage || !map || !object) return;


  /* =======================================================
     ENTRADA 3D
     ======================================================= */

  const reveal3D = () => {
    stage.classList.add(
      "is-3d-ready"
    );
  };


  if ("IntersectionObserver" in window) {
    const observer =
      new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;

            reveal3D();

            observer.unobserve(
              entry.target
            );
          });
        },
        {
          threshold: .28
        }
      );

    observer.observe(stage);
  } else {
    reveal3D();
  }


  /* =======================================================
     TILT CON MOUSE
     Solo desktop con puntero preciso.
     ======================================================= */

  const finePointer =
    window.matchMedia(
      "(hover: hover) and (pointer: fine)"
    );

  const reducedMotion =
    window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    );


  if (
    !finePointer.matches ||
    reducedMotion.matches
  ) {
    return;
  }


  let raf = 0;
  let targetX = 0;
  let targetY = 0;


  const renderTilt = () => {
    raf = 0;

    /*
      Base:
      X = 8deg
      Y = -5deg

      El mouse solo modifica unos pocos grados para que
      siga sintiéndose corporativo y no como una tarjeta 3D de juego.
    */
    const tiltX =
      8 + targetY * -4.5;

    const tiltY =
      -5 + targetX * 7;

    const shiftX =
      targetX * 5;

    const shiftY =
      targetY * 3;


    object.style.setProperty(
      "--map-tilt-x",
      `${tiltX.toFixed(2)}deg`
    );

    object.style.setProperty(
      "--map-tilt-y",
      `${tiltY.toFixed(2)}deg`
    );

    object.style.setProperty(
      "--map-shift-x",
      `${shiftX.toFixed(2)}px`
    );

    object.style.setProperty(
      "--map-shift-y",
      `${shiftY.toFixed(2)}px`
    );
  };


  stage.addEventListener(
    "pointermove",
    (event) => {
      const rect =
        stage.getBoundingClientRect();

      const px =
        (event.clientX - rect.left) /
        rect.width;

      const py =
        (event.clientY - rect.top) /
        rect.height;


      targetX =
        Math.max(
          -1,
          Math.min(
            1,
            (px - .5) * 2
          )
        );

      targetY =
        Math.max(
          -1,
          Math.min(
            1,
            (py - .5) * 2
          )
        );


      if (!raf) {
        raf =
          requestAnimationFrame(
            renderTilt
          );
      }
    }
  );


  stage.addEventListener(
    "pointerleave",
    () => {
      targetX = 0;
      targetY = 0;

      object.style.setProperty(
        "--map-tilt-x",
        "8deg"
      );

      object.style.setProperty(
        "--map-tilt-y",
        "-5deg"
      );

      object.style.setProperty(
        "--map-shift-x",
        "0px"
      );

      object.style.setProperty(
        "--map-shift-y",
        "0px"
      );
    }
  );
});
