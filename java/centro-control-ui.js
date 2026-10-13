(() => {
  "use strict";

  const TIME_ZONE = "America/Guatemala";
  const LOCALE = "es-GT";

  let syncState = "updated";
  let lastUpdate = new Date();
  let weather = {
    temperature: null,
    location: "Guatemala",
    code: null,
    isDay: null,
    description: "",
    source: "",
    stale: false,
    loading: false,
    error: false
  };
  let weatherRequestInFlight = false;
  let weatherLastFetch = 0;
  const WEATHER_REFRESH_MS = 10 * 60 * 1000;
  let calendarCursor = null;

  const $ = (selector) => document.querySelector(selector);

  const timeFormatter = new Intl.DateTimeFormat(LOCALE, {
    timeZone: TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });

  const dateFormatter = new Intl.DateTimeFormat(LOCALE, {
    timeZone: TIME_ZONE,
    day: "numeric",
    month: "long",
    year: "numeric"
  });

  const dayFormatter = new Intl.DateTimeFormat(LOCALE, {
    timeZone: TIME_ZONE,
    weekday: "long"
  });

  const hourFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    hourCycle: "h23"
  });

  const guatemalaDatePartsFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  function guatemalaDateParts(date = new Date()) {
    const parts = guatemalaDatePartsFormatter.formatToParts(date);
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return {
      year: Number(map.year),
      month: Number(map.month),
      day: Number(map.day)
    };
  }

  function guatemalaHour(date = new Date()) {
    return Number(hourFormatter.format(date));
  }

  function daypartFor(date = new Date()) {
    const shared = window.SEPRIGUADaypart?.get;
    if (typeof shared === "function") return shared(date);

    const hour = guatemalaHour(date);
    if (hour >= 6 && hour < 14) {
      return {
        key: "dia",
        greeting: "Buenos días",
        label: "JORNADA DE DÍA",
        detail: "Operación en marcha",
        icon: "sun-medium",
        image: "/assets/img/tuky-dia.webp"
      };
    }
    if (hour >= 14 && hour < 18) {
      return {
        key: "tarde",
        greeting: "Buenas tardes",
        label: "JORNADA DE TARDE",
        detail: "Seguimiento operativo",
        icon: "sunset",
        image: "/assets/img/tuky-tarde.webp"
      };
    }
    return {
      key: "noche",
      greeting: "Buenas noches",
      label: "JORNADA NOCTURNA",
      detail: "Cierre y continuidad",
      icon: "moon-star",
      image: "/assets/img/tuky-noche.webp"
    };
  }

  function greetingFor(date = new Date()) {
    return daypartFor(date).greeting;
  }

  function preloadDaypartArt() {
    ["/assets/img/tuky-dia.webp", "/assets/img/tuky-tarde.webp", "/assets/img/tuky-noche.webp"].forEach((src) => {
      const image = new Image();
      image.decoding = "async";
      image.src = src;
    });
  }

  function renderDaypartBanner(date = new Date()) {
    const banner = $("#centerDaypartBanner");
    if (!banner) return;

    const meta = daypartFor(date);
    const art = $("#centerDaypartArt");
    const label = $("#centerDaypartLabel");
    const detail = $("#centerDaypartDetail");
    const icon = $("#centerDaypartIcon");

    banner.dataset.daypart = meta.key;
    if (art && art.getAttribute("src") !== meta.image) art.setAttribute("src", meta.image);
    if (label) label.textContent = meta.label;
    if (detail) detail.textContent = meta.detail;

    if (icon && icon.getAttribute("data-lucide") !== meta.icon) {
      const replacement = document.createElement("i");
      replacement.id = "centerDaypartIcon";
      replacement.setAttribute("data-lucide", meta.icon);
      replacement.setAttribute("aria-hidden", "true");
      icon.replaceWith(replacement);
      window.lucide?.createIcons({ nodes: [replacement] });
    }
  }

  function formatTime(date = new Date()) {
    return timeFormatter.format(date);
  }

  function titleCase(text = "") {
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
  }

  function weatherMeta(code, isDay) {
    const numeric = Number(code);
    const daytime = Number(isDay) !== 0;

    if (numeric === 0) {
      return { description: "Despejado", icon: daytime ? "sun" : "moon" };
    }
    if ([1, 2].includes(numeric)) {
      return { description: "Parcialmente nublado", icon: daytime ? "cloud-sun" : "cloud-moon" };
    }
    if (numeric === 3) {
      return { description: "Nublado", icon: "cloud" };
    }
    if ([45, 48].includes(numeric)) {
      return { description: "Neblina", icon: "cloud-fog" };
    }
    if ([51, 53, 55, 56, 57].includes(numeric)) {
      return { description: "Llovizna", icon: "cloud-drizzle" };
    }
    if ([61, 63, 65, 66, 67, 80, 81, 82].includes(numeric)) {
      return { description: "Lluvia", icon: "cloud-rain" };
    }
    if ([71, 73, 75, 77, 85, 86].includes(numeric)) {
      return { description: "Nieve", icon: "cloud-snow" };
    }
    if ([95, 96, 99].includes(numeric)) {
      return { description: "Tormenta", icon: "cloud-lightning" };
    }

    return { description: "Condiciones actuales", icon: daytime ? "cloud-sun" : "cloud-moon" };
  }

  function replaceWeatherIcon(iconName) {
    const part = document.querySelector(".weather-part");
    if (!part) return;

    const currentIcon = part.querySelector("svg, i");
    if (!currentIcon) return;

    const replacement = document.createElement("i");
    replacement.setAttribute("data-lucide", iconName);
    replacement.setAttribute("aria-hidden", "true");
    currentIcon.replaceWith(replacement);
    window.lucide?.createIcons({ nodes: [replacement] });
  }

  function renderWeather() {
    const target = $("#topWeather");
    const part = target?.closest(".weather-part");
    if (!target || !part) return;

    part.classList.remove("weather-unavailable", "weather-loading", "weather-stale");

    if (weather.loading && weather.temperature === null) {
      target.textContent = `Consultando clima · ${weather.location}`;
      part.classList.add("weather-loading");
      part.setAttribute("title", "Consultando condiciones meteorológicas actuales");
      replaceWeatherIcon("loader-circle");
      return;
    }

    if (
      weather.temperature === null ||
      weather.temperature === undefined ||
      weather.temperature === ""
    ) {
      target.textContent = `Clima no disponible · ${weather.location}`;
      part.classList.add("weather-unavailable");
      part.setAttribute(
        "title",
        "No fue posible consultar la fuente meteorológica en este momento"
      );
      replaceWeatherIcon("cloud-off");
      return;
    }

    const numeric = Number(weather.temperature);
    const display = Number.isFinite(numeric) ? Math.round(numeric) : weather.temperature;
    const meta = weatherMeta(weather.code, weather.isDay);
    const description = weather.description || meta.description;

    target.textContent = `${display}°C · ${weather.location}`;
    replaceWeatherIcon(meta.icon);

    if (weather.stale) {
      part.classList.add("weather-stale");
    }

    const sourceText = weather.source ? ` · Fuente: ${weather.source}` : "";
    const staleText = weather.stale ? " · Último dato disponible" : "";
    part.setAttribute(
      "title",
      `${description}${sourceText}${staleText}`
    );
  }

  async function fetchCurrentWeather({ force = false } = {}) {
    // El clima pertenece al navbar global, no únicamente al Centro de control.
    if (weatherRequestInFlight) return;

    const now = Date.now();
    if (!force && weatherLastFetch && (now - weatherLastFetch) < WEATHER_REFRESH_MS) {
      return;
    }

    weatherRequestInFlight = true;
    weather.loading = true;
    weather.error = false;
    renderWeather();

    try {
      let data = null;
      let backendError = null;
      try {
        const response = await fetch("/api/ui/clima", {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "Accept": "application/json" }
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        data = await response.json();
      } catch (error) {
        backendError = error;
      }

      // Compatibilidad: si una VM todavía no tiene el endpoint nuevo, intentamos
      // Open-Meteo directamente. El backend sigue siendo la ruta preferida.
      if (!data?.ok || !data?.available || data.temperature_c === null || data.temperature_c === undefined) {
        const directUrl = "https://api.open-meteo.com/v1/forecast?latitude=14.6349&longitude=-90.5069&current=temperature_2m,weather_code,is_day&temperature_unit=celsius&timezone=America%2FGuatemala&forecast_days=1";
        const response = await fetch(directUrl, { method: "GET", cache: "no-store" });
        if (!response.ok) throw backendError || new Error(`HTTP ${response.status}`);
        const direct = await response.json();
        const current = direct?.current || {};
        data = {
          ok: true,
          available: current.temperature_2m !== null && current.temperature_2m !== undefined,
          temperature_c: current.temperature_2m,
          weather_code: current.weather_code,
          is_day: current.is_day,
          location: "Guatemala",
          source: "Open-Meteo",
          stale: false
        };
      }

      if (!data?.ok || !data?.available || data.temperature_c === null || data.temperature_c === undefined) {
        throw backendError || new Error("Clima no disponible");
      }

      weather = {
        temperature: data.temperature_c,
        location: data.location || "Guatemala",
        code: data.weather_code ?? null,
        isDay: data.is_day ?? null,
        description: "",
        source: data.source || "Open-Meteo",
        stale: Boolean(data.stale),
        loading: false,
        error: false
      };
      weatherLastFetch = Date.now();
    } catch (error) {
      weather.loading = false;
      weather.error = true;

      // Si ya había un dato válido, lo conservamos.
      if (weather.temperature === null || weather.temperature === undefined) {
        weather.temperature = null;
      }
    } finally {
      weatherRequestInFlight = false;
      renderWeather();
    }
  }

  function maybeRefreshWeather(force = false) {
    fetchCurrentWeather({ force });
  }

  function ensureCalendarCursor() {
    if (calendarCursor) return;
    const today = guatemalaDateParts();
    calendarCursor = { year: today.year, month: today.month };
  }

  function monthLabel(year, month) {
    const value = new Date(Date.UTC(year, month - 1, 1));
    return titleCase(new Intl.DateTimeFormat(LOCALE, {
      month: "long",
      year: "numeric",
      timeZone: "UTC"
    }).format(value));
  }

  function renderCalendar() {
    const grid = $("#calendarDaysGrid");
    const monthTitle = $("#calendarMonthLabel");
    const todayLabel = $("#calendarTodayLabel");
    if (!grid || !monthTitle) return;

    ensureCalendarCursor();

    const { year, month } = calendarCursor;
    const today = guatemalaDateParts();
    const first = new Date(Date.UTC(year, month - 1, 1));
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const jsWeekday = first.getUTCDay();
    const mondayOffset = (jsWeekday + 6) % 7;
    const previousMonthDays = new Date(Date.UTC(year, month - 1, 0)).getUTCDate();

    monthTitle.textContent = monthLabel(year, month);
    if (todayLabel) {
      todayLabel.textContent = `Hoy: ${titleCase(dayFormatter.format(new Date()))}, ${today.day}`;
    }

    const cells = [];
    const totalCells = 42;

    for (let index = 0; index < totalCells; index += 1) {
      const dayNumber = index - mondayOffset + 1;
      let cellYear = year;
      let cellMonth = month;
      let displayDay = dayNumber;
      let outside = false;

      if (dayNumber < 1) {
        outside = true;
        displayDay = previousMonthDays + dayNumber;
        cellMonth -= 1;
        if (cellMonth < 1) {
          cellMonth = 12;
          cellYear -= 1;
        }
      } else if (dayNumber > daysInMonth) {
        outside = true;
        displayDay = dayNumber - daysInMonth;
        cellMonth += 1;
        if (cellMonth > 12) {
          cellMonth = 1;
          cellYear += 1;
        }
      }

      const isToday = cellYear === today.year && cellMonth === today.month && displayDay === today.day;
      cells.push(`<span class="calendar-day${outside ? " is-outside" : ""}${isToday ? " is-today" : ""}" role="gridcell" aria-current="${isToday ? "date" : "false"}">${displayDay}</span>`);
    }

    grid.innerHTML = cells.join("");
  }

  function openCalendar() {
    const popover = $("#calendarPopover");
    const button = $("#calendarButton");
    if (!popover || !button) return;
    ensureCalendarCursor();
    renderCalendar();
    popover.hidden = false;
    button.setAttribute("aria-expanded", "true");
    window.lucide?.createIcons();
  }

  function closeCalendar() {
    const popover = $("#calendarPopover");
    const button = $("#calendarButton");
    if (!popover || !button) return;
    popover.hidden = true;
    button.setAttribute("aria-expanded", "false");
  }

  function toggleCalendar() {
    const popover = $("#calendarPopover");
    if (!popover) return;
    if (popover.hidden) openCalendar();
    else closeCalendar();
  }

  function changeCalendarMonth(delta) {
    ensureCalendarCursor();
    calendarCursor.month += delta;
    if (calendarCursor.month < 1) {
      calendarCursor.month = 12;
      calendarCursor.year -= 1;
    } else if (calendarCursor.month > 12) {
      calendarCursor.month = 1;
      calendarCursor.year += 1;
    }
    renderCalendar();
  }

  function calendarGoToday() {
    const today = guatemalaDateParts();
    calendarCursor = { year: today.year, month: today.month };
    renderCalendar();
  }

  function bindCalendarEvents() {
    $("#calendarButton")?.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleCalendar();
    });

    $("#calendarPrev")?.addEventListener("click", (event) => {
      event.stopPropagation();
      changeCalendarMonth(-1);
    });

    $("#calendarNext")?.addEventListener("click", (event) => {
      event.stopPropagation();
      changeCalendarMonth(1);
    });

    $("#calendarTodayButton")?.addEventListener("click", (event) => {
      event.stopPropagation();
      calendarGoToday();
    });

    document.addEventListener("click", (event) => {
      const wrap = $("#topCalendarWrap");
      if (wrap && !wrap.contains(event.target)) closeCalendar();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeCalendar();
    });
  }

  function renderClockAndGreeting() {
    const now = new Date();
    const topDate = $("#topDate");
    const topDayName = $("#topDayName");
    const topClock = $("#topClock");
    const greeting = $("#centerGreeting");
    const isCenterControl = document.body.classList.contains("center-control-mode");

    // Navbar global: fecha, día, hora y clima deben ser idénticos en todos los módulos.
    if (topDate) topDate.textContent = dateFormatter.format(now);
    if (topDayName) topDayName.textContent = titleCase(dayFormatter.format(now));
    if (topClock) topClock.textContent = formatTime(now);
    renderWeather();

    // Elementos exclusivos del Centro de control.
    if (isCenterControl && greeting) {
      const firstName = greeting.dataset.userFirst || "Usuario";
      greeting.textContent = `${greetingFor(now)}, ${firstName}`;
      renderDaypartBanner(now);
    }
    if (isCenterControl) renderSyncState();
  }

  function renderSyncState() {
    const wrapper = $("#centerSyncState");
    const text = $("#centerSyncText");
    if (!wrapper || !text) return;

    const online = navigator.onLine;
    const effectiveState = online ? syncState : "offline";

    const config = {
      saved: { icon: "circle-check", text: "Guardado" },
      syncing: { icon: "refresh-cw", text: "Sincronizando..." },
      offline: { icon: "wifi-off", text: "Sin conexión" },
      updated: { icon: "clock-3", text: `Última actualización: ${formatTime(lastUpdate)}` }
    };

    const current = config[effectiveState] || config.updated;
    wrapper.dataset.state = effectiveState;
    text.textContent = current.text;

    const icon = wrapper.querySelector("svg, i");
    if (icon) {
      const replacement = document.createElement("i");
      replacement.setAttribute("data-lucide", current.icon);
      replacement.setAttribute("aria-hidden", "true");
      icon.replaceWith(replacement);
      window.lucide?.createIcons({ nodes: [replacement] });
    }
  }

  function setSyncState(nextState) {
    if (!["saved", "syncing", "offline", "updated"].includes(nextState)) return;
    syncState = nextState;
    renderSyncState();
  }

  function setWeather(temperature, location = "Guatemala", meta = {}) {
    weather = {
      temperature,
      location: location || "Guatemala",
      code: meta.code ?? null,
      isDay: meta.isDay ?? null,
      description: meta.description || "",
      source: meta.source || "",
      stale: Boolean(meta.stale),
      loading: false,
      error: false
    };
    weatherLastFetch = Date.now();
    renderWeather();
  }

  document.addEventListener("seprigua:center-data-updated", () => {
    lastUpdate = new Date();
    syncState = "updated";
    renderClockAndGreeting();
  });

  document.addEventListener("seprigua:center-sync-state", (event) => {
    setSyncState(event.detail?.state || "updated");
  });

  window.addEventListener("online", () => {
    syncState = "updated";
    renderSyncState();
    maybeRefreshWeather(true);
  });

  window.addEventListener("offline", renderSyncState);

  window.SEPRIGUA_CENTER_UI = Object.freeze({
    setWeather,
    setSyncState,
    refreshWeather: () => maybeRefreshWeather(true)
  });

  const bodyObserver = new MutationObserver(() => {
    renderClockAndGreeting();
    maybeRefreshWeather();
  });

  bodyObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ["class"]
  });

  preloadDaypartArt();
  bindCalendarEvents();
  renderCalendar();
  setInterval(renderClockAndGreeting, 30000);
  setInterval(() => maybeRefreshWeather(), WEATHER_REFRESH_MS);
  renderClockAndGreeting();
  maybeRefreshWeather(true);
})();
