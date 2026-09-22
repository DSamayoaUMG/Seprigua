document.addEventListener("DOMContentLoaded", () => {
  const finePointer = window.matchMedia?.(
    "(hover: hover) and (pointer: fine)"
  ).matches;

  const reduced = window.matchMedia?.(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  if (!finePointer || reduced) return;

  const bindSpotlight = (
    selector,
    xVar,
    yVar
  ) => {
    document.querySelectorAll(selector).forEach((element) => {
      element.addEventListener("pointermove", (event) => {
        const rect = element.getBoundingClientRect();

        const x = (
          (event.clientX - rect.left) /
          rect.width
        ) * 100;

        const y = (
          (event.clientY - rect.top) /
          rect.height
        ) * 100;

        element.style.setProperty(xVar, `${x.toFixed(1)}%`);
        element.style.setProperty(yVar, `${y.toFixed(1)}%`);
      });

      element.addEventListener("pointerleave", () => {
        element.style.setProperty(xVar, "50%");
        element.style.setProperty(yVar, "50%");
      });
    });
  };

  bindSpotlight(
    "#nosotros .stats-panel",
    "--spot-x",
    "--spot-y"
  );

  bindSpotlight(
    "#nosotros .locations-panel",
    "--loc-x",
    "--loc-y"
  );

  bindSpotlight(
    "#nosotros .about-card",
    "--card-x",
    "--card-y"
  );
});
