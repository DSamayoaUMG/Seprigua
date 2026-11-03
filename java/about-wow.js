document.addEventListener("DOMContentLoaded", () => {
  const visual = document.getElementById("aboutWowVisual");
  const frame = visual?.querySelector(".about-wow-frame");

  const finePointer = window.matchMedia?.(
    "(hover: hover) and (pointer: fine)"
  ).matches;

  const reduced = window.matchMedia?.(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  if (visual && frame && finePointer && !reduced) {
    visual.addEventListener("pointermove", (event) => {
      const rect = visual.getBoundingClientRect();

      const px = (event.clientX - rect.left) / rect.width;
      const py = (event.clientY - rect.top) / rect.height;

      const nx = Math.max(-1, Math.min(1, (px - .5) * 2));
      const ny = Math.max(-1, Math.min(1, (py - .5) * 2));

      visual.style.setProperty("--about-rx", `${(-ny * 1.8).toFixed(2)}deg`);
      visual.style.setProperty("--about-ry", `${(nx * 2.3).toFixed(2)}deg`);
      visual.style.setProperty("--about-glow-x", `${(px * 100).toFixed(1)}%`);
      visual.style.setProperty("--about-glow-y", `${(py * 100).toFixed(1)}%`);
    });

    visual.addEventListener("pointerleave", () => {
      visual.style.setProperty("--about-rx", "0deg");
      visual.style.setProperty("--about-ry", "0deg");
      visual.style.setProperty("--about-glow-x", "50%");
      visual.style.setProperty("--about-glow-y", "50%");
    });
  }

  /* Reinicia counters si entran por primera vez en vista y el script original
     todavía no los ha actualizado. */
  const proof = document.querySelector(".about-wow-proof");

  if (proof && "IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      ([entry], obs) => {
        if (!entry.isIntersecting) return;

        proof.classList.add("about-proof-active");
        obs.disconnect();
      },
      { threshold: .25 }
    );

    observer.observe(proof);
  }

  window.lucide?.createIcons();
});
