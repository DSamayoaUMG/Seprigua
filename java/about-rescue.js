document.addEventListener("DOMContentLoaded", () => {
  const visual = document.getElementById("aboutRescueVisual");

  const finePointer = window.matchMedia?.(
    "(hover: hover) and (pointer: fine)"
  ).matches;

  const reduced = window.matchMedia?.(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  if (visual && finePointer && !reduced) {
    visual.addEventListener("pointermove", (event) => {
      const rect = visual.getBoundingClientRect();

      const px = (event.clientX - rect.left) / rect.width;
      const py = (event.clientY - rect.top) / rect.height;

      const nx = Math.max(-1, Math.min(1, (px - .5) * 2));
      const ny = Math.max(-1, Math.min(1, (py - .5) * 2));

      visual.style.setProperty(
        "--about-rescue-rx",
        `${(-ny * 1.25).toFixed(2)}deg`
      );

      visual.style.setProperty(
        "--about-rescue-ry",
        `${(nx * 1.65).toFixed(2)}deg`
      );

      visual.style.setProperty(
        "--about-rescue-glow-x",
        `${(px * 100).toFixed(1)}%`
      );

      visual.style.setProperty(
        "--about-rescue-glow-y",
        `${(py * 100).toFixed(1)}%`
      );
    });

    visual.addEventListener("pointerleave", () => {
      visual.style.setProperty("--about-rescue-rx", "0deg");
      visual.style.setProperty("--about-rescue-ry", "0deg");
      visual.style.setProperty("--about-rescue-glow-x", "50%");
      visual.style.setProperty("--about-rescue-glow-y", "50%");
    });
  }

  window.lucide?.createIcons();
});
