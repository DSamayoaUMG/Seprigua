document.addEventListener("DOMContentLoaded", () => {
  const stage =
    document.querySelector(
      ".coverage-atlas-stage"
    );

  const canvas =
    document.getElementById(
      "coverageAtlasCanvas"
    );

  const root =
    document.getElementById(
      "coverageAtlasMapRoot"
    );

  const markerRoot =
    document.getElementById(
      "coverageAtlasMarkerRoot"
    );

  const loading =
    document.getElementById(
      "coverageAtlasLoading"
    );

  const card =
    document.getElementById(
      "coverageAtlasDepartmentCard"
    );

  const cardName =
    document.getElementById(
      "coverageAtlasDepartmentName"
    );

  const cardCopy =
    document.getElementById(
      "coverageAtlasDepartmentCopy"
    );

  const cardType =
    document.getElementById(
      "coverageAtlasDepartmentType"
    );

  const counter =
    document.getElementById(
      "coverageAtlasCounter"
    );

  if (
    !stage ||
    !canvas ||
    !root ||
    !markerRoot
  ) {
    return;
  }


  const DATA_SOURCES = [
    "https://cdn.jsdelivr.net/gh/minfin-bi/Mapas-TopoJSON-Guatemala@main/deptos.json",
    "https://raw.githubusercontent.com/minfin-bi/Mapas-TopoJSON-Guatemala/refs/heads/main/deptos.json"
  ];


  const SVG_NS =
    "http://www.w3.org/2000/svg";


  let departments = [];
  let coveredDepartments = [];
  let activeIndex = 0;
  let activeGroup = null;
  let autoplayTimer = null;
  let isPointerInside = false;


  /* =======================================================
     UTILIDADES
     ======================================================= */

  const normalizeName = (value = "") =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();


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


  const loadTopology = async () => {
    let lastError = null;

    for (const source of DATA_SOURCES) {
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

        return await response.json();
      } catch (error) {
        lastError = error;
      }
    }

    throw (
      lastError ||
      new Error(
        "No fue posible cargar el mapa."
      )
    );
  };


  /* =======================================================
     TOPOJSON -> POLÍGONOS
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
        "Formato geográfico no reconocido."
      );
    }


    return object.geometries.map(
      (geometry, index) => ({
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
     PROYECCIÓN
     ======================================================= */

  const projectDepartments = (
    sourceDepartments
  ) => {
    const allPoints = [];

    sourceDepartments.forEach(
      (department) => {
        department.polygons.forEach(
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


    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);


    const VIEW_W = 1000;
    const VIEW_H = 760;
    const PAD_X = 56;
    const PAD_Y = 44;


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


    return sourceDepartments.map(
      (department, index) => ({
        ...department,
        index,

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
     PATH / CENTRO
     ======================================================= */

  const ringToPath = (ring) => {
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


  const departmentToPath = (
    department
  ) =>
    department.polygons
      .flatMap(
        (polygon) =>
          polygon.map(
            ringToPath
          )
      )
      .join("");


  const departmentCenter = (
    department
  ) => {
    const points =
      department.polygons
        .flat(2);

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
     CONTENIDO DEL CARD
     ======================================================= */

  const getDepartmentDetails = (
    name
  ) => {
    const normalized =
      normalizeName(name);

    if (
      normalized === "guatemala"
    ) {
      return {
        type:
          "Sede principal",
        copy:
          "Centro de operaciones y administración de SEPRIGUA."
      };
    }


    if (
      normalized ===
      "quetzaltenango"
    ) {
      return {
        type:
          "Presencia operativa",
        copy:
          "Punto estratégico para la atención y cobertura del occidente."
      };
    }


    return {
      type:
        "Cobertura operativa",
      copy:
        "Departamento incluido dentro del alcance operativo y programación de servicios de SEPRIGUA."
    };
  };


  /* =======================================================
     MARCADOR ACTIVO
     ======================================================= */

  const drawActiveMarker = (
    department
  ) => {
    markerRoot.replaceChildren();

    const [x, y] =
      departmentCenter(
        department
      );


    const marker =
      createSvg(
        "g",
        {
          class:
            "atlas-active-marker",
          transform:
            `translate(${x} ${y})`
        }
      );


    marker.appendChild(
      createSvg(
        "circle",
        {
          class:
            "marker-pulse",
          r: 19
        }
      )
    );


    marker.appendChild(
      createSvg(
        "circle",
        {
          class:
            "marker-ring",
          r: 12
        }
      )
    );


    marker.appendChild(
      createSvg(
        "circle",
        {
          class:
            "marker-dot",
          r: 6
        }
      )
    );


    markerRoot.appendChild(
      marker
    );
  };


  /* =======================================================
     ACTIVAR DEPARTAMENTO
     ======================================================= */

  const activateDepartment = (
    index,
    { restart = false } = {}
  ) => {
    if (!coveredDepartments.length) return;

    const safeIndex =
      (
        index +
        coveredDepartments.length
      ) %
      coveredDepartments.length;


    activeIndex =
      safeIndex;


    if (activeGroup) {
      activeGroup.classList.remove(
        "is-active"
      );
    }


    const department =
      coveredDepartments[safeIndex];

    const group =
      root.querySelector(
        `[data-name="${department.name}"]`
      );


    if (group) {
      group.classList.add(
        "is-active"
      );

      activeGroup = group;
    }


    root.classList.add(
      "has-active"
    );


    drawActiveMarker(
      department
    );


    const details =
      getDepartmentDetails(
        department.name
      );


    if (card) {
      card.classList.add(
        "is-changing"
      );
    }


    window.setTimeout(
      () => {
        if (cardName) {
          cardName.textContent =
            department.name;
        }

        if (cardCopy) {
          cardCopy.textContent =
            details.copy;
        }

        if (cardType) {
          cardType.textContent =
            details.type;
        }

        if (counter) {
          counter.textContent =
            `${String(safeIndex + 1).padStart(2, "0")} / ${coveredDepartments.length}`;
        }

        card?.classList.remove(
          "is-changing"
        );
      },
      130
    );


    if (restart) {
      restartAutoplay();
    }
  };


  /* =======================================================
     AUTOPLAY
     Cada departamento va tomando protagonismo.
     ======================================================= */

  const stopAutoplay = () => {
    if (!autoplayTimer) return;

    window.clearInterval(
      autoplayTimer
    );

    autoplayTimer = null;
  };


  const startAutoplay = () => {
    stopAutoplay();

    autoplayTimer =
      window.setInterval(
        () => {
          if (isPointerInside) return;

          activateDepartment(
            activeIndex + 1
          );
        },
        2700
      );
  };


  const restartAutoplay = () => {
    stopAutoplay();

    window.setTimeout(
      startAutoplay,
      1000
    );
  };


  /* =======================================================
     RENDER
     ======================================================= */

  const renderMap = () => {
    root.replaceChildren();


    departments.forEach(
      (department, index) => {
        const group =
          createSvg(
            "g",
            {
              class: "atlas-department",
              tabindex: "0",
              role: "button",
              "aria-label": `Departamento de ${department.name}`,
              "data-index": index,
              "data-name": department.name,
              style: `--atlas-i:${index}`
            }
          );


        const path =
          createSvg(
            "path",
            {
              class: "atlas-department-path",
              d: departmentToPath(department),
              "fill-rule": "evenodd"
            }
          );


        group.appendChild(path);


        const coveredIndex =
          coveredDepartments.findIndex(
            (item) =>
              normalizeName(item.name) ===
              normalizeName(department.name)
          );


        const select = () => {
          activateDepartment(
            coveredIndex,
            { restart: true }
          );
        };


        group.addEventListener("pointerenter", select);
        group.addEventListener("focus", select);
        group.addEventListener("click", select);


        root.appendChild(group);
      }
    );
  };


  /* =======================================================
     INICIO
     ======================================================= */

  const buildAtlas = async () => {
    try {
      const topology =
        await loadTopology();

      departments =
        projectDepartments(
          decodeTopology(
            topology
          )
        );

      coveredDepartments =
        departments.slice();


      renderMap();


      /*
        Primer foco: Guatemala.
        Si el dataset cambia, cae al índice 0.
      */
      const firstIndex =
        Math.max(
          0,
          coveredDepartments.findIndex(
            (department) =>
              normalizeName(
                department.name
              ) ===
              "guatemala"
          )
        );


      activateDepartment(
        firstIndex
      );


      loading?.classList.add(
        "is-hidden"
      );


      requestAnimationFrame(
        () =>
          stage.classList.add(
            "is-atlas-ready"
          )
      );


      startAutoplay();

    } catch (error) {
      console.error(
        "Mapa cobertura SEPRIGUA:",
        error
      );


      loading?.classList.add(
        "is-hidden"
      );


      const message =
        document.createElement(
          "div"
        );

      message.style.cssText =
        "position:absolute;inset:30% 18%;display:grid;place-items:center;text-align:center;padding:24px;border-radius:22px;background:rgba(255,255,255,.82);border:1px solid rgba(25,62,88,.08);color:rgba(25,62,88,.68);font-size:12px;line-height:1.5;z-index:20;";

      message.innerHTML =
        "<div><strong>No fue posible cargar el mapa departamental.</strong><br>Verifica tu conexión a Internet y vuelve a cargar la página.</div>";

      canvas.appendChild(
        message
      );


      stage.classList.add(
        "is-atlas-ready"
      );
    }
  };


  canvas.addEventListener(
    "pointerenter",
    () => {
      isPointerInside = true;
      stopAutoplay();
    }
  );


  canvas.addEventListener(
    "pointerleave",
    () => {
      isPointerInside = false;
      restartAutoplay();
    }
  );


  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.hidden) {
        stopAutoplay();
      } else {
        startAutoplay();
      }
    }
  );



  /* =======================================================
     ANIMACIÓN GENERAL DE LA SECCIÓN COBERTURA
     ======================================================= */

  const coverageSection =
    document.querySelector(
      ".coverage-motion-section"
    );


  if (coverageSection) {
    let coverageAnimationBusy = false;


    const replayCoverage =
      () => {
        if (coverageAnimationBusy) {
          return;
        }

        coverageAnimationBusy = true;

        coverageSection.classList.remove(
          "is-coverage-visible"
        );

        requestAnimationFrame(
          () => {
            requestAnimationFrame(
              () => {
                coverageSection.classList.add(
                  "is-coverage-visible"
                );

                window.setTimeout(
                  () => {
                    coverageAnimationBusy = false;
                  },
                  1550
                );
              }
            );
          }
        );
      };


    if (
      "IntersectionObserver" in window
    ) {
      const coverageObserver =
        new IntersectionObserver(
          (entries) => {
            entries.forEach(
              (entry) => {
                if (
                  entry.isIntersecting
                ) {
                  replayCoverage();
                } else if (
                  entry.intersectionRatio === 0
                ) {
                  coverageSection.classList.remove(
                    "is-coverage-visible"
                  );
                }
              }
            );
          },
          {
            threshold: [.05, .22]
          }
        );

      coverageObserver.observe(
        coverageSection
      );
    } else {
      replayCoverage();
    }


    window.addEventListener(
      "hashchange",
      () => {
        if (
          window.location.hash ===
          "#cobertura"
        ) {
          window.setTimeout(
            replayCoverage,
            180
          );
        }
      }
    );
  }


  buildAtlas();
});
