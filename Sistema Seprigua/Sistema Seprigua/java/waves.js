(() => {
  "use strict";
  window.__SEPRIGUA_WAVES_VERSION__ = "V12-VERTICAL-BORDES";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const BLUE = "10,107,255"; // #0A6BFF

  const createSvg = (tag, attrs = {}) => {
    const el = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
    return el;
  };

  const createDiv = (className) => {
    const el = document.createElement("div");
    el.className = className;
    return el;
  };

  const addWaveGroup = (svg, defs, options) => {
    const {
      id,
      className,
      d,
      count = 5,
      spacing = 24,
      axis = "x",
      opacity = 0.32,
      edgeOpacity = 0.17,
      width = 1.55,
      edgeWidth = 0.96,
      shadow = true,
      highlight = true
    } = options;

    const base = createSvg("path", { id, d });
    defs.appendChild(base);

    const group = createSvg("g", { class: `premium-wave-group ${className}` });

    if (shadow) {
      const depth = createSvg("use", {
        href: `#${id}`,
        stroke: `rgba(${BLUE},0.040)`,
        "stroke-width": "5.2"
      });
      group.appendChild(depth);
    }

    const center = (count - 1) / 2;

    for (let i = 0; i < count; i++) {
      const distance = Math.abs(i - center) / Math.max(center, 1);
      const offset = (i - center) * spacing;
      const alpha = edgeOpacity + (opacity - edgeOpacity) * Math.pow(1 - distance, 1.18);
      const strokeWidth = edgeWidth + (width - edgeWidth) * Math.pow(1 - distance, 1.08);

      group.appendChild(createSvg("use", {
        href: `#${id}`,
        stroke: `rgba(${BLUE},${alpha.toFixed(3)})`,
        "stroke-width": strokeWidth.toFixed(2),
        transform: axis === "x" ? `translate(${offset} 0)` : `translate(0 ${offset})`
      }));
    }

    if (highlight) {
      group.appendChild(createSvg("use", {
        href: `#${id}`,
        stroke: "rgba(255,255,255,.12)",
        "stroke-width": ".30",
        transform: axis === "x" ? "translate(2 0)" : "translate(0 -2)"
      }));
    }

    svg.appendChild(group);
  };

  const buildDecor = (root) => {
    const layer = createDiv("premium-decor-layer");
    ["gradient-wash-a", "gradient-wash-b", "gradient-wash-c", "gradient-wash-d"]
      .forEach((cls) => layer.appendChild(createDiv(`gradient-wash ${cls}`)));
    ["blob-a", "blob-b", "blob-c"]
      .forEach((cls) => layer.appendChild(createDiv(`ambient-blob ${cls}`)));
    ["matrix-a", "matrix-b", "matrix-c"]
      .forEach((cls) => layer.appendChild(createDiv(`dot-matrix ${cls}`)));
    ["dot-a", "dot-b", "dot-c", "dot-d", "dot-e", "dot-f"]
      .forEach((cls) => layer.appendChild(createDiv(`accent-dot ${cls}`)));
    root.appendChild(layer);
  };

  const initPremiumBackground = () => {
    const host = document.querySelector(".site-background");
    if (!host || host.querySelector(".premium-bg-root")) return;

    const root = createDiv("premium-bg-root");
    buildDecor(root);

    const canvas = createDiv("premium-wave-canvas");
    const svg = createSvg("svg", {
      viewBox: "0 0 1600 9000",
      preserveAspectRatio: "none",
      "aria-hidden": "true"
    });

    const defs = createSvg("defs");
    svg.appendChild(defs);

    /*
      V12 — ONDAS VERTICALES E INDEPENDIENTES

      Regla de diseño:
      - lado izquierdo nunca cruza con lado derecho;
      - ningún path empieza o termina flotando dentro del frame;
      - todo inicio/fin queda fuera de un borde, o fuera de la parte superior/inferior;
      - las curvas entran al lienzo, respiran y vuelven a un borde.
    */

    /* Superior izquierda: entra desde arriba y sale por el borde izquierdo. */
    addWaveGroup(svg, defs, {
      id: "premium-flow-a",
      className: "flow-a",
      d: `
        M 180 -520
        C 260 180, 520 520, 430 1120
        C 355 1620, 120 1680, 70 2050
        C 35 2290, -80 2460, -420 2520
      `,
      count: 6,
      spacing: 27,
      axis: "x",
      opacity: 0.34,
      edgeOpacity: 0.18,
      width: 1.60,
      edgeWidth: 1.00
    });

    /* Superior derecha: entra desde arriba y vuelve a salir por la derecha. */
    addWaveGroup(svg, defs, {
      id: "premium-flow-b",
      className: "flow-b",
      d: `
        M 1450 -520
        C 1340 160, 1070 560, 1120 1120
        C 1160 1570, 1435 1660, 1490 2050
        C 1530 2290, 1645 2450, 2020 2520
      `,
      count: 5,
      spacing: 30,
      axis: "x",
      opacity: 0.32,
      edgeOpacity: 0.17,
      width: 1.52,
      edgeWidth: 0.96
    });

    /* Centro izquierda: aparece desde el borde izquierdo y regresa al borde izquierdo. */
    addWaveGroup(svg, defs, {
      id: "premium-flow-c",
      className: "flow-c",
      d: `
        M -420 2820
        C 40 2870, 310 3150, 365 3570
        C 425 4050, 205 4380, 125 4720
        C 70 4960, -70 5100, -420 5140
      `,
      count: 5,
      spacing: 29,
      axis: "x",
      opacity: 0.31,
      edgeOpacity: 0.16,
      width: 1.48,
      edgeWidth: 0.94
    });

    /* Centro derecha: independiente, sin tocar el grupo izquierdo. */
    addWaveGroup(svg, defs, {
      id: "premium-flow-d",
      className: "flow-d",
      d: `
        M 2020 3180
        C 1570 3220, 1320 3460, 1270 3890
        C 1210 4350, 1410 4690, 1500 5000
        C 1570 5240, 1710 5360, 2020 5400
      `,
      count: 7,
      spacing: 25,
      axis: "x",
      opacity: 0.33,
      edgeOpacity: 0.17,
      width: 1.54,
      edgeWidth: 0.98
    });

    /* Inferior izquierda: entra por izquierda y termina fuera de la esquina inferior. */
    addWaveGroup(svg, defs, {
      id: "premium-flow-e",
      className: "flow-e",
      d: `
        M -420 5900
        C 20 5940, 330 6260, 390 6740
        C 455 7250, 230 7550, 155 7990
        C 95 8330, 90 8720, 40 9460
      `,
      count: 6,
      spacing: 27,
      axis: "x",
      opacity: 0.34,
      edgeOpacity: 0.18,
      width: 1.58,
      edgeWidth: 1.00
    });

    /* Inferior derecha: espejo visual, termina fuera de la esquina inferior derecha. */
    addWaveGroup(svg, defs, {
      id: "premium-flow-f",
      className: "flow-f",
      d: `
        M 2020 6100
        C 1580 6140, 1300 6460, 1250 6910
        C 1190 7390, 1415 7700, 1490 8110
        C 1550 8450, 1555 8780, 1600 9460
      `,
      count: 5,
      spacing: 30,
      axis: "x",
      opacity: 0.31,
      edgeOpacity: 0.16,
      width: 1.48,
      edgeWidth: 0.94
    });

    canvas.appendChild(svg);
    root.appendChild(canvas);
    host.appendChild(root);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initPremiumBackground, { once: true });
  } else {
    initPremiumBackground();
  }
})();
