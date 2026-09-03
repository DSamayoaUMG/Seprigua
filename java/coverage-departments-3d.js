document.addEventListener("DOMContentLoaded", () => {
  const stage =
    document.querySelector(
      ".coverage-departments-stage"
    );

  const scene =
    document.getElementById(
      "coverageReliefScene"
    );

  const object =
    document.getElementById(
      "coverageReliefObject"
    );

  const svg =
    document.getElementById(
      "coverageDepartmentsSvg"
    );

  const root =
    document.getElementById(
      "coverageMapRenderRoot"
    );

  const loading =
    document.getElementById(
      "coverageMapLoading"
    );

  const tooltip =
    document.getElementById(
      "coverageDepartmentTooltip"
    );

  const tooltipName =
    document.getElementById(
      "coverageTooltipName"
    );

  if (
    !stage ||
    !scene ||
    !object ||
    !svg ||
    !root
  ) {
    return;
  }


  /* =======================================================
     FUENTE GEOGRÁFICA
     -------------------------------------------------------
     MINFIN Guatemala:
     TopoJSON de 22 departamentos.
     El primero usa jsDelivr para CORS/cache y el segundo raw GitHub
     como respaldo.
     ======================================================= */

  const DATA_SOURCES = [
    "https://cdn.jsdelivr.net/gh/minfin-bi/Mapas-TopoJSON-Guatemala@main/deptos.json",
    "https://raw.githubusercontent.com/minfin-bi/Mapas-TopoJSON-Guatemala/refs/heads/main/deptos.json"
  ];


  const SVG_NS =
    "http://www.w3.org/2000/svg";


  /* =======================================================
     UTILIDADES
     ======================================================= */

  const normalizeName = (value = "") =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();


  const readDepartmentName = (
    geometry,
    index
  ) => {
    const props =
      geometry.properties || {};

    return (
      props.Departamento ||
      props.departamento ||
      props.DEPARTAMENTO ||
      props.nombre ||
      props.name ||
      `Departamento ${index + 1}`
    );
  };


  const createSvg = (
    tag,
    attrs = {}
  ) => {
    const el =
      document.createElementNS(
        SVG_NS,
        tag
      );

    Object.entries(attrs)
      .forEach(
        ([key, value]) => {
          el.setAttribute(
            key,
            String(value)
          );
        }
      );

    return el;
  };


  /* =======================================================
     CARGAR TOPOJSON
     ======================================================= */

  const loadTopology = async () => {
    let lastError = null;

    for (
      const source of DATA_SOURCES
    ) {
      try {
        const response =
          await fetch(
            source,
            {
              mode: "cors",
              cache: "force-cache"
            }
          );

        if (!response.ok) {
          throw new Error(
            `HTTP ${response.status}`
          );
        }

        const data =
          await response.json();

        return data;
      } catch (error) {
        lastError = error;
      }
    }

    throw (
      lastError ||
      new Error(
        "No se pudo cargar el TopoJSON."
      )
    );
  };


  /* =======================================================
     DECODIFICAR TOPOJSON
     No dependemos de D3 ni topojson-client.
     ======================================================= */

  const decodeTopology = (
    topology
  ) => {
    const transform =
      topology.transform || null;

    const scale =
      transform?.scale || [1, 1];

    const translate =
      transform?.translate || [0, 0];


    const decodedArcs =
      topology.arcs.map(
        (arc) => {
          let x = 0;
          let y = 0;

          return arc.map(
            (point) => {
              if (transform) {
                x += point[0];
                y += point[1];

                return [
                  x * scale[0] +
                    translate[0],

                  y * scale[1] +
                    translate[1]
                ];
              }

              return [
                point[0],
                point[1]
              ];
            }
          );
        }
      );


    const getArc = (
      arcIndex
    ) => {
      const reversed =
        arcIndex < 0;

      const index =
        reversed
          ? ~arcIndex
          : arcIndex;

      const coords =
        decodedArcs[index] || [];

      return reversed
        ? [...coords].reverse()
        : coords;
    };


    const joinArcs = (
      indexes
    ) => {
      const result = [];

      indexes.forEach(
        (arcIndex, i) => {
          const arc =
            getArc(arcIndex);

          if (!arc.length) return;

          if (
            i > 0 &&
            result.length
          ) {
            result.push(
              ...arc.slice(1)
            );
          } else {
            result.push(...arc);
          }
        }
      );

      return result;
    };


    const geometryToPolygons = (
      geometry
    ) => {
      if (
        geometry.type ===
        "Polygon"
      ) {
        return [
          geometry.arcs.map(
            joinArcs
          )
        ];
      }

      if (
        geometry.type ===
        "MultiPolygon"
      ) {
        return geometry.arcs.map(
          (polygon) =>
            polygon.map(joinArcs)
        );
      }

      return [];
    };


    const object =
      Object.values(
        topology.objects || {}
      ).find(
        (candidate) =>
          candidate?.type ===
          "GeometryCollection"
      );


    if (
      !object ||
      !Array.isArray(
        object.geometries
      )
    ) {
      throw new Error(
        "El TopoJSON no contiene una colección de departamentos."
      );
    }


    return object.geometries.map(
      (geometry, index) => ({
        geometry,
        name:
          readDepartmentName(
            geometry,
            index
          ),
        polygons:
          geometryToPolygons(
            geometry
          )
      })
    );
  };


  /* =======================================================
     PROYECCIÓN LOCAL
     Mantiene la forma geográfica real de Guatemala.
     ======================================================= */

  const projectDepartments = (
    departments
  ) => {
    const allPoints = [];

    departments.forEach(
      (department) => {
        department.polygons
          .forEach(
            (polygon) =>
              polygon.forEach(
                (ring) =>
                  allPoints.push(
                    ...ring
                  )
              )
          );
      }
    );


    if (!allPoints.length) {
      throw new Error(
        "No se encontraron coordenadas para el mapa."
      );
    }


    const lats =
      allPoints.map(
        ([, lat]) => lat
      );

    const midLat =
      (
        Math.min(...lats) +
        Math.max(...lats)
      ) / 2;


    const cosLat =
      Math.cos(
        midLat *
        Math.PI /
        180
      );


    const adjusted =
      allPoints.map(
        ([lon, lat]) => [
          lon * cosLat,
          -lat
        ]
      );


    const xs =
      adjusted.map(
        ([x]) => x
      );

    const ys =
      adjusted.map(
        ([, y]) => y
      );


    const minX =
      Math.min(...xs);

    const maxX =
      Math.max(...xs);

    const minY =
      Math.min(...ys);

    const maxY =
      Math.max(...ys);


    const VIEW_W = 1000;
    const VIEW_H = 760;
    const PAD_X = 58;
    const PAD_Y = 50;


    const width =
      maxX - minX;

    const height =
      maxY - minY;


    const scaleFactor =
      Math.min(
        (VIEW_W - PAD_X * 2) /
          width,

        (VIEW_H - PAD_Y * 2) /
          height
      );


    const offsetX =
      (
        VIEW_W -
        width * scaleFactor
      ) / 2;

    const offsetY =
      (
        VIEW_H -
        height * scaleFactor
      ) / 2;


    const projectPoint =
      ([lon, lat]) => {
        const x =
          lon * cosLat;

        const y =
          -lat;

        return [
          offsetX +
            (x - minX) *
            scaleFactor,

          offsetY +
            (y - minY) *
            scaleFactor
        ];
      };


    return departments.map(
      (department) => ({
        ...department,

        polygons:
          department.polygons.map(
            (polygon) =>
              polygon.map(
                (ring) =>
                  ring.map(
                    projectPoint
                  )
              )
          )
      })
    );
  };


  /* =======================================================
     SVG PATH
     ======================================================= */

  const ringToPath = (
    ring
  ) => {
    if (!ring.length) return "";

    return (
      `M${ring[0][0].toFixed(2)},${ring[0][1].toFixed(2)}` +
      ring
        .slice(1)
        .map(
          ([x, y]) =>
            `L${x.toFixed(2)},${y.toFixed(2)}`
        )
        .join("") +
      "Z"
    );
  };


  const polygonToPath = (
    polygons
  ) =>
    polygons
      .flatMap(
        (polygon) =>
          polygon.map(
            ringToPath
          )
      )
      .join("");


  /* =======================================================
     CENTROIDE VISUAL SIMPLE
     Para los marcadores de Guatemala / Quetzaltenango.
     ======================================================= */

  const departmentCenter = (
    department
  ) => {
    const points =
      department.polygons
        .flat(2);

    if (!points.length) {
      return [500, 380];
    }

    const xs =
      points.map(
        ([x]) => x
      );

    const ys =
      points.map(
        ([, y]) => y
      );

    return [
      (
        Math.min(...xs) +
        Math.max(...xs)
      ) / 2,

      (
        Math.min(...ys) +
        Math.max(...ys)
      ) / 2
    ];
  };


  /* =======================================================
     RELIEVE / EXTRUSIÓN
     ======================================================= */

  const DEPTH_LAYERS = 9;

  const depthColor = (
    layer
  ) => {
    const t =
      layer /
      DEPTH_LAYERS;

    const r =
      Math.round(
        73 -
        t * 34
      );

    const g =
      Math.round(
        128 -
        t * 50
      );

    const b =
      Math.round(
        177 -
        t * 60
      );

    return `rgb(${r},${g},${b})`;
  };


  const renderDepartment = (
    department,
    index
  ) => {
    const group =
      createSvg(
        "g",
        {
          class:
            "department-relief-group",
          tabindex: "0",
          role: "button",
          "aria-label":
            `Departamento de ${department.name}`,
          "data-department":
            department.name
        }
      );


    const d =
      polygonToPath(
        department.polygons
      );


    /*
      Capas inferiores. El desplazamiento diagonal da grosor
      sin inventar elevaciones distintas por departamento.
    */
    for (
      let layer = DEPTH_LAYERS;
      layer >= 1;
      layer--
    ) {
      const depth =
        createSvg(
          "path",
          {
            d,
            class:
              "department-depth",
            fill:
              depthColor(layer),
            "fill-rule":
              "evenodd",
            transform:
              `translate(${layer * 1.5} ${layer * 2.05})`
          }
        );

      group.appendChild(depth);
    }


    const top =
      createSvg(
        "path",
        {
          d,
          class:
            "department-top",
          "fill-rule":
            "evenodd"
        }
      );


    const highlight =
      createSvg(
        "path",
        {
          d,
          class:
            "department-highlight",
          "fill-rule":
            "evenodd"
        }
      );


    group.appendChild(top);
    group.appendChild(highlight);


    const showTooltip = () => {
      root
        .querySelectorAll(
          ".department-relief-group.is-selected"
        )
        .forEach(
          (item) => {
            if (item !== group) {
              item.classList.remove(
                "is-selected"
              );
            }
          }
        );

      group.classList.add(
        "is-selected"
      );

      if (tooltipName) {
        tooltipName.textContent =
          department.name;
      }

      tooltip?.classList.add(
        "is-visible"
      );
    };


    const hideTooltip = () => {
      if (
        !group.matches(
          ":focus"
        )
      ) {
        group.classList.remove(
          "is-selected"
        );

        tooltip?.classList.remove(
          "is-visible"
        );
      }
    };


    group.addEventListener(
      "pointerenter",
      showTooltip
    );

    group.addEventListener(
      "pointerleave",
      hideTooltip
    );

    group.addEventListener(
      "focus",
      showTooltip
    );

    group.addEventListener(
      "blur",
      () => {
        group.classList.remove(
          "is-selected"
        );

        tooltip?.classList.remove(
          "is-visible"
        );
      }
    );

    group.addEventListener(
      "click",
      showTooltip
    );


    return group;
  };


  /* =======================================================
     MARCADORES OPERATIVOS CONOCIDOS
     ======================================================= */

  const addOperationalMarker = (
    department,
    label
  ) => {
    const [x, y] =
      departmentCenter(
        department
      );

    const marker =
      createSvg(
        "g",
        {
          class:
            "coverage-operational-marker",
          "aria-label":
            label,
          transform:
            `translate(${x} ${y})`
        }
      );


    const pulse =
      createSvg(
        "circle",
        {
          class:
            "marker-pulse",
          r: 16
        }
      );


    const core =
      createSvg(
        "circle",
        {
          class:
            "marker-core",
          r: 7
        }
      );


    marker.appendChild(pulse);
    marker.appendChild(core);

    root.appendChild(marker);
  };


  /* =======================================================
     RENDER COMPLETO
     ======================================================= */

  const buildMap = async () => {
    try {
      const topology =
        await loadTopology();

      const departments =
        projectDepartments(
          decodeTopology(
            topology
          )
        );


      /*
        Verificación explícita.
        La fuente oficial/repositorio debe tener los 22 departamentos.
      */
      if (
        departments.length !== 22
      ) {
        console.warn(
          `Se esperaban 22 departamentos y se recibieron ${departments.length}.`
        );
      }


      root.replaceChildren();


      departments.forEach(
        (department, index) => {
          root.appendChild(
            renderDepartment(
              department,
              index
            )
          );
        }
      );


      /*
        Marcamos únicamente los dos puntos que el contenido
        actual de SEPRIGUA ya define explícitamente:
        Ciudad de Guatemala y Quetzaltenango.
      */
      const guatemala =
        departments.find(
          (department) =>
            normalizeName(
              department.name
            ) ===
            "guatemala"
        );


      const quetzaltenango =
        departments.find(
          (department) =>
            normalizeName(
              department.name
            ) ===
            "quetzaltenango"
        );


      if (guatemala) {
        addOperationalMarker(
          guatemala,
          "Sede principal — Ciudad de Guatemala"
        );
      }


      if (quetzaltenango) {
        addOperationalMarker(
          quetzaltenango,
          "Presencia operativa — Quetzaltenango"
        );
      }


      loading?.classList.add(
        "is-hidden"
      );


      requestAnimationFrame(
        () =>
          stage.classList.add(
            "is-map-ready"
          )
      );

    } catch (error) {
      console.error(
        "Cobertura 3D:",
        error
      );


      loading?.classList.add(
        "is-hidden"
      );


      const errorBox =
        document.createElement(
          "div"
        );

      errorBox.className =
        "coverage-map-error";

      errorBox.innerHTML =
        "<div><strong>No fue posible cargar el mapa departamental.</strong><br>Verifica tu conexión a Internet y vuelve a cargar la página.</div>";

      object.appendChild(
        errorBox
      );

      stage.classList.add(
        "is-map-ready"
      );
    }
  };


  /* =======================================================
     TILT 3D CON MOUSE
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
    finePointer.matches &&
    !reducedMotion.matches
  ) {
    let raf = 0;

    scene.addEventListener(
      "pointermove",
      (event) => {
        const rect =
          scene.getBoundingClientRect();

        const px =
          (
            event.clientX -
            rect.left
          ) /
          rect.width;

        const py =
          (
            event.clientY -
            rect.top
          ) /
          rect.height;


        const x =
          Math.max(
            -1,
            Math.min(
              1,
              (px - .5) * 2
            )
          );

        const y =
          Math.max(
            -1,
            Math.min(
              1,
              (py - .5) * 2
            )
          );


        if (raf) {
          cancelAnimationFrame(
            raf
          );
        }


        raf =
          requestAnimationFrame(
            () => {
              scene.style.setProperty(
                "--map-rx",
                `${15 - y * 5}deg`
              );

              scene.style.setProperty(
                "--map-ry",
                `${-4 + x * 7}deg`
              );

              scene.style.setProperty(
                "--map-rz",
                `${-1.5 + x * .8}deg`
              );
            }
          );
      }
    );


    scene.addEventListener(
      "pointerleave",
      () => {
        scene.style.setProperty(
          "--map-rx",
          "15deg"
        );

        scene.style.setProperty(
          "--map-ry",
          "-4deg"
        );

        scene.style.setProperty(
          "--map-rz",
          "-1.5deg"
        );
      }
    );
  }


  buildMap();
});
