document.addEventListener("DOMContentLoaded", () => {
  /*
    Este archivo NO crea otro observer para los .reveal.
    El script.js original ya los controla.
    Aquí únicamente añadimos dirección y delays.
  */

  const applyClass = (selector, className) => {
    document.querySelectorAll(selector).forEach((el) => {
      el.classList.add(className);
    });
  };

  applyClass(".hero-content", "safe-left");
  applyClass(".hero-image-container", "safe-right");

  applyClass(".about-text", "safe-left");
  applyClass(".about-collage", "safe-right");

  applyClass(".stats-panel", "safe-left");
  applyClass(".locations-panel", "safe-right");

  applyClass(".coverage-content", "safe-left");
  applyClass(".coverage-map-wrapper", "safe-right");

  applyClass(".work-copy", "safe-left");
  applyClass(".work-gallery", "safe-right");

  applyClass(".contact-copy", "safe-left");
  applyClass(".contact-form-wrapper", "safe-right");

  /* stagger muy ligero */
  [
    ".hero-features .reveal",
    ".about-bottom .reveal",
    ".work-features .reveal"
  ].forEach((selector) => {
    document.querySelectorAll(selector).forEach((el, i) => {
      el.style.setProperty("--safe-delay", `${Math.min(i * 70, 280)}ms`);
    });
  });

  /* Footer: sí necesita su propio observer porque no todos tenían .reveal */
  const footerEls = [
    ...document.querySelectorAll(".footer-content > *"),
    ...document.querySelectorAll(".footer-values > div"),
    ...document.querySelectorAll(".footer-bottom")
  ];

  footerEls.forEach((el, i) => {
    el.classList.add("safe-extra");
    el.style.setProperty("--safe-delay", `${Math.min(i * 65, 260)}ms`);
  });

  if (!("IntersectionObserver" in window)) {
    footerEls.forEach((el) => el.classList.add("safe-visible"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries, obs) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("safe-visible");
        obs.unobserve(entry.target);
      });
    },
    {
      threshold: 0.08,
      rootMargin: "0px 0px -35px"
    }
  );

  footerEls.forEach((el) => observer.observe(el));
});
