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
  let calendarActivityMonth = "";
  let calendarActivities = [];
  // La fecha elegida se comparte entre vistas, sin alterar el servidor.
  const DATE_STORE_KEY = "seprigua_fecha_consulta";
  function currentSelectedDate() {
    try { return sessionStorage.getItem(DATE_STORE_KEY) || ""; } catch (_) { return ""; }
  }
  function selectCalendarDate(key) {
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(key) && !Number.isNaN(Date.parse(key + "T12:00:00Z"));
    const normalized = valid ? key : "";
    const event = new CustomEvent("seprigua:calendar-date", {detail:{date:normalized}, cancelable:true});
    if (!document.dispatchEvent(event)) return;
    try { if (normalized) sessionStorage.setItem(DATE_STORE_KEY, normalized); else sessionStorage.removeItem(DATE_STORE_KEY); } catch (_) {}
    window.SEPRIGUASelectedDate = normalized;
    renderClockAndGreeting();
    renderCalendar();
    scheduleCalendarPosition();
  }
  window.SEPRIGUASelectedDate = currentSelectedDate();

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
      const key = `${cellYear}-${String(cellMonth).padStart(2,"0")}-${String(displayDay).padStart(2,"0")}`;
      const chosen = currentSelectedDate() === key;
      const dayActivities = calendarActivities.filter(item => item.fecha === key);
      const activityCount = dayActivities.length;
      const tones = [...new Set(dayActivities.map(item => calendarTone(item.estado)))].slice(0, 3);
      const activityLabel = activityCount ? `, ${activityCount} orden${activityCount === 1 ? "" : "es"} programada${activityCount === 1 ? "" : "s"}` : "";
      cells.push(`<button type="button" class="calendar-day${outside ? " is-outside" : ""}${isToday ? " is-today" : ""}${chosen ? " is-selected" : ""}${activityCount ? " has-activity" : ""}" role="gridcell" data-calendar-date="${key}" aria-selected="${chosen ? "true" : "false"}" aria-label="Consultar el ${displayDay} de ${monthLabel(cellYear,cellMonth)}${activityLabel}" ${isToday ? 'aria-current="date"' : ''}><span class="se-cal-day-number">${displayDay}</span><span class="se-cal-day-dots" aria-hidden="true">${tones.map(tone => `<i class="se-cal-dot ${tone}"></i>`).join("")}</span></button>`);
    }

    grid.innerHTML = cells.join("");
    const todayKey = dateKeyFromParts(guatemalaDateParts());
    const todayButton = $("#calendarTodayButton");
    if (todayButton) {
      todayButton.hidden = year === today.year && month === today.month && (!currentSelectedDate() || currentSelectedDate() === todayKey);
      const footer = todayButton.closest(".calendar-popover-foot");
      if (footer) footer.hidden = todayButton.hidden;
    }
    renderCalendarActivityPreview();
    scheduleCalendarPosition();
  }

  function dateKeyFromParts(parts) { return `${parts.year}-${String(parts.month).padStart(2,"0")}-${String(parts.day).padStart(2,"0")}`; }

  function calendarTone(status) {
    const value = String(status || "").toUpperCase();
    if (/FINALIZ|COMPLET|CERRAD|ATENDID/.test(value)) return "green";
    if (/CANCEL/.test(value)) return "neutral";
    if (/EMERGEN|CRITIC/.test(value)) return "red";
    if (/PENDIENT|ESPERA|REVISI/.test(value)) return "amber";
    return "blue";
  }

  function renderCalendarActivityPreview() {
    const host = $("#calendarActivityPreview");
    if (!host) return;
    const selected = currentSelectedDate() || (calendarCursor?.year === guatemalaDateParts().year && calendarCursor?.month === guatemalaDateParts().month ? dateKeyFromParts(guatemalaDateParts()) : "");
    host.replaceChildren();
    const heading = document.createElement("strong");
    heading.textContent = selected ? `Órdenes del ${selected}` : "Actividad del mes";
    host.append(heading);
    const items = selected ? calendarActivities.filter(item => item.fecha === selected) : [];
    if (!selected) {
      const note = document.createElement("p"); note.textContent = "Selecciona un día con indicador para consultar sus órdenes."; host.append(note); return;
    }
    if (!items.length) {
      const note = document.createElement("p"); note.textContent = "No hay órdenes programadas para esta fecha."; host.append(note); return;
    }
    const list = document.createElement("ul");
    items.slice(0, 4).forEach(item => {
      const row = document.createElement("li");
      row.className = `se-cal-preview-row ${calendarTone(item.estado)}`;
      const title = document.createElement("span"); title.textContent = item.titulo || "Orden de trabajo";
      const detail = document.createElement("small"); detail.textContent = [item.cliente, item.estado].filter(Boolean).join(" · ");
      row.append(title, detail); list.append(row);
    });
    if (items.length > 4) { const more = document.createElement("li"); more.className="calendar-activity-more"; more.textContent=`y ${items.length - 4} más`; list.append(more); }
    host.append(list);
  }

  async function loadCalendarActivities() {
    const {year,month} = calendarCursor || guatemalaDateParts();
    const key = `${year}-${String(month).padStart(2,"0")}`;
    if (calendarActivityMonth === key) return;
    calendarActivityMonth = key;
    calendarActivities = [];
    renderCalendar();
    const from = `${key}-01`;
    const next = new Date(Date.UTC(year, month, 1));
    const until = `${next.getUTCFullYear()}-${String(next.getUTCMonth()+1).padStart(2,"0")}-01`;
    try {
      const response = await fetch(`/api/calendario/actividades?desde=${from}&hasta=${until}`, {credentials:"same-origin",cache:"no-store"});
      if (!response.ok) { if (calendarActivityMonth === key) calendarActivityMonth = ""; return; }
      const data = await response.json();
      if (calendarActivityMonth === key && data.ok) { calendarActivities = Array.isArray(data.items) ? data.items : []; renderCalendar(); scheduleCalendarPosition(); }
    } catch (_) { if (calendarActivityMonth === key) calendarActivityMonth = ""; /* El calendario sigue disponible si no se puede consultar la actividad. */ }
  }

  function positionCalendar() {
    const popover = $("#calendarPopover");
    const button = $("#calendarButton");
    if (!popover || popover.hidden || !button) return;
    const viewport = window.visualViewport;
    const minX = viewport?.offsetLeft ?? 0;
    const minY = viewport?.offsetTop ?? 0;
    const viewW = viewport?.width ?? window.innerWidth;
    const viewH = viewport?.height ?? window.innerHeight;
    const maxX = minX + viewW;
    const maxY = minY + viewH;
    const rect = button.getBoundingClientRect();
    const margin = 10;
    const gap = 8;
    const width = Math.min(390, Math.max(0, viewW - 2 * margin));
    let left = rect.left;
    if (left + width > maxX - margin) left = rect.right - width;
    left = Math.max(minX + margin, Math.min(left, maxX - width - margin));
    const naturalHeight = Math.min(popover.scrollHeight || 550, 670);
    const below = Math.max(0, maxY - margin - (rect.bottom + gap));
    const above = Math.max(0, rect.top - gap - (minY + margin));
    const openAbove = below < Math.min(naturalHeight, 320) && above > below;
    const maxHeight = Math.min(670, openAbove ? above : below);
    const top = openAbove ? Math.max(minY + margin, rect.top - gap - Math.min(naturalHeight, maxHeight)) : rect.bottom + gap;
    for (const [name, value] of Object.entries({position:"fixed",left:`${Math.round(left)}px`,right:"auto",top:`${Math.round(top)}px`,bottom:"auto",width:`${Math.round(width)}px`,maxHeight:`${Math.round(maxHeight)}px`})) {
      popover.style.setProperty(name, value, "important");
    }
    popover.dataset.placement = openAbove ? "top" : "bottom";
  }

  let calendarPositionFrame = 0;
  function scheduleCalendarPosition() {
    if (calendarPositionFrame || $("#calendarPopover")?.hidden) return;
    calendarPositionFrame = requestAnimationFrame(() => {
      calendarPositionFrame = 0;
      positionCalendar();
    });
  }

  function openCalendar() {
    const popover = $("#calendarPopover");
    const button = $("#calendarButton");
    if (!popover || !button) return;
    ensureCalendarCursor();
    renderCalendar();
    loadCalendarActivities();
    popover.hidden = false;
    positionCalendar();
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
    calendarActivityMonth = "";
    calendarActivities = [];
    renderCalendar();
    loadCalendarActivities();
  }

  function calendarGoToday() {
    const today = guatemalaDateParts();
    calendarCursor = { year: today.year, month: today.month };
    calendarActivityMonth = "";
    calendarActivities = [];
    renderCalendar();
    loadCalendarActivities();
  }

  function bindCalendarEvents() {
    const popover = $("#calendarPopover");
    if (popover && popover.parentElement !== document.body) document.body.appendChild(popover);
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
      selectCalendarDate(""); // Regresa a la vista actual (sin filtro histórico).
    });
    $("#calendarDaysGrid")?.addEventListener("click", (event) => {
      const day = event.target.closest("[data-calendar-date]");
      if (!day) return;
      event.stopPropagation();
      selectCalendarDate(day.dataset.calendarDate);
    });

    document.addEventListener("click", (event) => {
      const wrap = $("#topCalendarWrap");
      if (!wrap?.contains(event.target) && !popover?.contains(event.target)) closeCalendar();
    });

    window.addEventListener("resize", scheduleCalendarPosition, {passive:true});
    window.addEventListener("orientationchange", scheduleCalendarPosition, {passive:true});
    window.visualViewport?.addEventListener("resize", scheduleCalendarPosition, {passive:true});
    window.visualViewport?.addEventListener("scroll", scheduleCalendarPosition, {passive:true});

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
    const chosen = currentSelectedDate();
    const displayDate = chosen ? new Date(`${chosen}T12:00:00Z`) : now;
    if (topDate) topDate.textContent = dateFormatter.format(displayDate);
    if (topDayName) topDayName.textContent = titleCase(dayFormatter.format(displayDate));
    const calendarButton = $("#calendarButton");
    calendarButton?.classList.toggle("is-date-selected",Boolean(chosen));
    if (calendarButton) calendarButton.title = chosen ? `Consultando registros del ${chosen}. Usa «Ir a hoy» para volver a la vista actual.` : "Seleccionar fecha de consulta";
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

  document.addEventListener("seprigua:calendar-date", () => {
    requestAnimationFrame(() => { renderClockAndGreeting(); renderCalendar(); });
  });

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
  setInterval(() => { if (!document.hidden) renderClockAndGreeting(); }, 30000);
  setInterval(() => { if (!document.hidden) maybeRefreshWeather(); }, WEATHER_REFRESH_MS);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) { renderClockAndGreeting(); maybeRefreshWeather(); }
  });
  renderClockAndGreeting();
  maybeRefreshWeather(true);
})();
