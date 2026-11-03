document.addEventListener("DOMContentLoaded", () => {
  const reduced =
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  document.body.classList.add("motion-enhanced");

  /* =======================================================
     CORTINA INICIAL
     ======================================================= */
  if (!reduced) {
    const curtain = document.createElement("div");
    curtain.className = "page-intro-curtain";
    curtain.setAttribute("aria-hidden", "true");
    document.body.appendChild(curtain);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.body.classList.add("motion-page-ready");
      });
    });

    window.setTimeout(() => {
      curtain.remove();
    }, 1100);
  } else {
    document.body.classList.add("motion-page-ready");
  }

  /* =======================================================
     DIRECCIÓN DE CADA REVEAL EXISTENTE
     ======================================================= */

  const addMotion = (selector, className) => {
    document.querySelectorAll(selector).forEach((el) => {
      el.classList.add(className);
    });
  };

  addMotion(".hero-content", "motion-left");
  addMotion(".hero-image-container", "motion-right");

  addMotion(".about-text", "motion-left");
  addMotion(".about-collage", "motion-right");
  addMotion(".stats-panel", "motion-left");
  addMotion(".locations-panel", "motion-right");

  addMotion(".services-heading", "motion-soft");
  addMotion(".services-carousel", "motion-zoom");

  addMotion(".coverage-content", "motion-left");
  addMotion(".coverage-map-wrapper", "motion-right");

  addMotion(".work-copy", "motion-left");
  addMotion(".work-gallery", "motion-right");

  addMotion(".contact-copy", "motion-left");
  addMotion(".contact-form-wrapper", "motion-right");

  /* =======================================================
     STAGGER AUTOMÁTICO
     ======================================================= */

  const staggerGroups = [
    ".hero-features .reveal",
    ".about-bottom .reveal",
    ".coverage-cards .reveal",
    ".work-features .reveal"
  ];

  staggerGroups.forEach((selector) => {
    document.querySelectorAll(selector).forEach((el, i) => {
      el.style.setProperty(
        "--motion-delay",
        `${Math.min(i * 85, 340)}ms`
      );
    });
  });

  /* delays puntuales */
  document
    .querySelectorAll(".about-middle .reveal")
    .forEach((el, i) => {
      el.style.setProperty(
        "--motion-delay",
        `${i * 110}ms`
      );
    });

  /* =======================================================
     SECCIONES — BARRIDO AMBIENTAL
     ======================================================= */

  const sections =
    Array.from(
      document.querySelectorAll("main section")
    );

  sections.forEach((section) => {
    section.classList.add("motion-section");
  });

  if (!reduced && "IntersectionObserver" in window) {
    const sectionObserver =
      new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.remove(
                "motion-section-visible"
              );

              /* reinicia el barrido cuando una sección entra */
              void entry.target.offsetWidth;

              entry.target.classList.add(
                "motion-section-visible"
              );
            }
          });
        },
        {
          threshold: .18,
          rootMargin: "-8% 0px -22% 0px"
        }
      );

    sections.forEach((section) => {
      sectionObserver.observe(section);
    });
  }

  /* =======================================================
     FOOTER Y ELEMENTOS QUE NO TENÍAN .reveal
     ======================================================= */

  const footerTargets = [
    ".footer-floating-brand",
    ".footer-content > *",
    ".footer-values > div",
    ".footer-bottom"
  ];

  const extras = [];

  footerTargets.forEach((selector) => {
    document.querySelectorAll(selector).forEach(
      (el, i) => {
        if (extras.includes(el)) return;

        extras.push(el);
        el.classList.add("motion-extra");

        el.style.setProperty(
          "--motion-delay",
          `${Math.min(i * 80, 300)}ms`
        );
      }
    );
  });

  if (reduced || !("IntersectionObserver" in window)) {
    extras.forEach((el) => {
      el.classList.add("motion-extra-visible");
    });
  } else {
    const extraObserver =
      new IntersectionObserver(
        (entries, observer) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;

            entry.target.classList.add(
              "motion-extra-visible"
            );

            observer.unobserve(entry.target);
          });
        },
        {
          threshold: .08,
          rootMargin: "0px 0px -45px"
        }
      );

    extras.forEach((el) => {
      extraObserver.observe(el);
    });
  }

  /* =======================================================
     NAV: al seleccionar sección, pequeña confirmación visual
     ======================================================= */

  document
    .querySelectorAll('.nav-link[href^="#"]')
    .forEach((link) => {
      link.addEventListener("click", () => {
        const id =
          link.getAttribute("href")?.slice(1);

        const target =
          id && document.getElementById(id);

        if (!target || reduced) return;

        window.setTimeout(() => {
          target.classList.remove(
            "motion-section-visible"
          );

          void target.offsetWidth;

          target.classList.add(
            "motion-section-visible"
          );
        }, 360);
      });
    });
});
