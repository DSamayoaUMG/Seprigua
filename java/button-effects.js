(() => {
  "use strict";

  const initServiceButton = () => {
    const button = document.querySelector(".hero-content .primary-button");
    if (!button || button.dataset.aiButtonReady === "true") return;

    button.dataset.aiButtonReady = "true";

    const arrowCircle = button.querySelector(".button-circle");

    if (arrowCircle && !arrowCircle.querySelector(".arrow-gears")) {
      const gears = document.createElement("span");
      gears.className = "arrow-gears";
      gears.setAttribute("aria-hidden", "true");

      for (let i = 1; i <= 3; i++) {
        const gear = document.createElement("i");
        gear.className = `arrow-gear arrow-gear-${i}`;
        gear.setAttribute("data-lucide", "cog");
        gears.appendChild(gear);
      }

      arrowCircle.appendChild(gears);

      // Convierte los <i data-lucide="cog"> a SVG reales.
      window.lucide?.createIcons();
    }



    const shine = document.createElement("span");
    shine.className = "ai-button-shine";
    shine.setAttribute("aria-hidden", "true");
    button.appendChild(shine);

    const particles = document.createElement("span");
    particles.className = "ai-button-particles";
    particles.setAttribute("aria-hidden", "true");

    const colors = [
      "rgba(255,255,255,.95)",
      "rgba(180,220,255,.95)",
      "rgba(99,177,255,.92)",
      "rgba(215,237,255,.94)"
    ];

    // Pocas partículas: se conserva el efecto del video sin saturar.
    for (let i = 0; i < 16; i++) {
      const particle = document.createElement("i");
      const side = Math.random() > .5 ? 1 : -1;

      particle.style.setProperty("--particle-x", `${8 + Math.random() * 84}%`);
      particle.style.setProperty("--particle-y", `${28 + Math.random() * 44}%`);
      particle.style.setProperty("--particle-size", `${1.4 + Math.random() * 2.2}px`);
      particle.style.setProperty("--particle-delay", `${Math.random() * 1.6}s`);
      particle.style.setProperty("--particle-duration", `${1.45 + Math.random() * 1.15}s`);
      particle.style.setProperty("--particle-drift-x", `${side * (10 + Math.random() * 23)}px`);
      particle.style.setProperty("--particle-drift-y", `${-20 - Math.random() * 28}px`);
      particle.style.setProperty("--particle-color", colors[Math.floor(Math.random() * colors.length)]);

      particles.appendChild(particle);
    }

    button.appendChild(particles);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initServiceButton, { once: true });
  } else {
    initServiceButton();
  }
})();
