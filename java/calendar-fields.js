/* Selector visual común para los campos de fecha del portal. Conserva los inputs
   nativos, sus valores ISO y los eventos que usan los formularios existentes. */
(() => {
  "use strict";
  const selector = 'input[type="date"],input[type="datetime-local"]';
  const weekdays = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
  const monthFormatter = new Intl.DateTimeFormat("es-GT", { month: "long", year: "numeric" });
  const dayFormatter = new Intl.DateTimeFormat("es-GT", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const contextFormatter = new Intl.DateTimeFormat("es-GT", { weekday: "long", day: "numeric", month: "long" });
  const shortDayFormatter = new Intl.DateTimeFormat("es-GT", { weekday: "short", day: "numeric" });
  const pad = value => String(value).padStart(2, "0");
  const dateKey = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const parseDate = value => {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || "");
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return dateKey(date) === match[0] ? date : null;
  };
  const timeFrom = value => {
    const match = /T(\d{2}):(\d{2})/.exec(value || "");
    const now = new Date();
    return { hour: match ? Number(match[1]) : now.getHours(), minute: match ? Number(match[2]) : now.getMinutes() };
  };

  let active = null;
  let selected = null;
  let viewYear = 0;
  let viewMonth = 0;
  let selectedTime = { hour: 0, minute: 0 };
  let picker = null;

  function ensurePicker() {
    if (picker) return picker;
    picker = document.createElement("div");
    picker.id = "seDatePicker";
    picker.className = "se-date-picker";
    picker.setAttribute("role", "dialog");
    picker.setAttribute("aria-label", "Seleccionar fecha");
    picker.hidden = true;
    picker.innerHTML = `
      <div class="se-date-picker-head">
        <button type="button" class="se-date-nav" data-cal-nav="-1" aria-label="Mes anterior">&#8249;</button>
        <div class="se-date-month"><strong data-cal-month></strong><small data-cal-context></small></div>
        <button type="button" class="se-date-nav" data-cal-nav="1" aria-label="Mes siguiente">&#8250;</button>
      </div>
      <div class="se-date-weekdays" aria-hidden="true">${weekdays.map(day => `<span>${day}</span>`).join("")}</div>
      <div class="se-date-days" role="grid" aria-label="Días del mes"></div>
      <div class="se-date-time" hidden>
        <span>Hora</span><select data-cal-hour aria-label="Hora"></select>
        <span class="se-date-time-colon">:</span>
        <select data-cal-minute aria-label="Minutos"></select>
        <button type="button" class="se-date-apply" data-cal-apply>Aplicar</button>
      </div>
      <div class="se-date-picker-foot">
        <button type="button" data-cal-today>Ir a hoy</button>
        <button type="button" data-cal-clear>Limpiar</button>
      </div>`;
    picker.querySelector("[data-cal-hour]").innerHTML = Array.from({ length: 24 }, (_, i) => `<option value="${pad(i)}">${pad(i)}</option>`).join("");
    picker.querySelector("[data-cal-minute]").innerHTML = Array.from({ length: 60 }, (_, i) => `<option value="${pad(i)}">${pad(i)}</option>`).join("");
    document.body.append(picker);
    return picker;
  }

  function allowed(date) {
    if (!active) return false;
    const key = dateKey(date);
    return (!active.min || key >= active.min.slice(0, 10)) && (!active.max || key <= active.max.slice(0, 10));
  }

  function render() {
    if (!active) return;
    ensurePicker();
    const month = new Date(viewYear, viewMonth, 1);
    const monthLabel = monthFormatter.format(month);
    picker.querySelector("[data-cal-month]").textContent = monthLabel[0].toUpperCase() + monthLabel.slice(1);
    picker.querySelector("[data-cal-context]").textContent = selected
      ? picker.classList.contains("is-compact") ? shortDayFormatter.format(selected) : contextFormatter.format(selected)
      : "Selecciona un día";
    const start = new Date(viewYear, viewMonth, 1 - ((month.getDay() + 6) % 7));
    const todayDate = new Date();
    const today = dateKey(todayDate);
    const grid = picker.querySelector(".se-date-days");
    grid.replaceChildren();
    for (let index = 0; index < 42; index++) {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
      const key = dateKey(date);
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.calDay = key;
      button.textContent = date.getDate();
      button.className = "se-date-day";
      if (date.getMonth() !== viewMonth) button.classList.add("is-outside");
      if (key === today) button.classList.add("is-today");
      if (key === today) button.setAttribute("aria-current", "date");
      if (selected && key === dateKey(selected)) button.classList.add("is-selected");
      button.disabled = !allowed(date);
      button.setAttribute("aria-label", dayFormatter.format(date));
      button.setAttribute("aria-pressed", selected && key === dateKey(selected) ? "true" : "false");
      grid.append(button);
    }
    const hasTime = active.type === "datetime-local";
    picker.querySelector(".se-date-time").hidden = !hasTime;
    picker.querySelector("[data-cal-clear]").hidden = active.required;
    const todayButton = picker.querySelector("[data-cal-today]");
    todayButton.hidden = !allowed(todayDate) || (
      viewYear === todayDate.getFullYear() &&
      viewMonth === todayDate.getMonth() &&
      (!selected || dateKey(selected) === today)
    );
    picker.querySelector(".se-date-picker-foot").hidden = todayButton.hidden && active.required;
    if (hasTime) {
      picker.querySelector("[data-cal-hour]").value = pad(selectedTime.hour);
      picker.querySelector("[data-cal-minute]").value = pad(selectedTime.minute);
    }
  }

  function sizePicker() {
    if (!active || !picker) return;
    const fieldWidth = active.getBoundingClientRect().width;
    const viewportWidth = document.documentElement.clientWidth;
    const modal = active.closest(".modal-seprigua");
    const availableWidth = Math.min(viewportWidth - 16, modal ? modal.getBoundingClientRect().width - 16 : 340);
    const pickerWidth = Math.min(availableWidth, Math.max(280, Math.min(340, Math.round(fieldWidth * 1.25))));
    picker.style.setProperty("--se-date-picker-width", `${pickerWidth}px`);
    picker.classList.toggle("is-compact", pickerWidth < 280);
  }

  function position() {
    if (!active || !picker || picker.hidden) return;
    sizePicker();
    const rect = active.getBoundingClientRect();
    const modal = active.closest(".modal-seprigua");
    const modalBody = active.closest(".modal-seprigua__body");
    const modalRect = modal?.getBoundingClientRect();
    const bodyRect = modalBody?.getBoundingClientRect();
    if (bodyRect && (rect.bottom <= bodyRect.top || rect.top >= bodyRect.bottom)) return close();
    picker.style.removeProperty("max-height");
    const width = picker.getBoundingClientRect().width;
    const fullHeight = picker.getBoundingClientRect().height;
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const leftEdge = modalRect ? Math.max(8, modalRect.left + 8) : 8;
    const rightEdge = modalRect ? Math.min(viewportWidth - 8, modalRect.right - 8) : viewportWidth - 8;
    const left = Math.max(leftEdge, Math.min(rect.left, rightEdge - width));
    const topEdge = bodyRect ? Math.max(8, bodyRect.top + 6) : 8;
    let bottomEdge = bodyRect ? Math.min(viewportHeight - 8, bodyRect.bottom - 6) : viewportHeight - 8;
    const footer = modalBody?.querySelector(".modal-seprigua__footer");
    const footerRect = footer?.getBoundingClientRect();
    if (footerRect && footerRect.top > topEdge && footerRect.top < bottomEdge) {
      bottomEdge = footerRect.top - 6;
    }
    const gap = 7;
    const below = Math.max(0, bottomEdge - rect.bottom - gap);
    const above = Math.max(0, rect.top - topEdge - gap);
    // Si ninguna dirección admite el calendario completo, se mantiene junto al
    // campo y se limita su altura; nunca se invade la cabecera del modal.
    const openAbove = below < fullHeight && (above >= fullHeight || (below < 160 && above > below));
    const available = openAbove ? above : below;
    picker.style.maxHeight = `${Math.floor(available)}px`;
    const height = picker.getBoundingClientRect().height;
    const preferredTop = openAbove ? rect.top - height - gap : rect.bottom + gap;
    const top = Math.max(topEdge, Math.min(preferredTop, bottomEdge - height));
    picker.style.left = `${left}px`;
    picker.style.top = `${top}px`;
  }

  function close() {
    if (active) active.setAttribute("aria-expanded", "false");
    active = null;
    selected = null;
    if (picker) picker.hidden = true;
  }

  function open(input) {
    if (input.disabled || input.readOnly) return;
    if (active === input && picker && !picker.hidden) return;
    close();
    active = input;
    selected = parseDate(input.value);
    selectedTime = timeFrom(input.value);
    const start = selected || new Date();
    viewYear = start.getFullYear();
    viewMonth = start.getMonth();
    ensurePicker();
    sizePicker();
    input.setAttribute("aria-haspopup", "dialog");
    input.setAttribute("aria-controls", picker.id);
    input.setAttribute("aria-expanded", "true");
    render();
    picker.hidden = false;
    position();
  }

  function commit(value) {
    const input = active;
    if (!input) return;
    const changed = input.value !== value;
    close();
    input.value = value;
    if (changed) {
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  function applyDate(date) {
    if (!active || !allowed(date)) return;
    selected = date;
    if (active.type === "date") return commit(dateKey(date));
    viewYear = date.getFullYear();
    viewMonth = date.getMonth();
    render();
    position();
  }

  document.addEventListener("click", event => {
    const input = event.target.closest?.(selector);
    if (input) {
      event.preventDefault();
      open(input);
      return;
    }
    if (!picker || picker.hidden) return;
    const inPicker = event.target.closest?.("#seDatePicker");
    if (!inPicker) return close();
    const navigation = event.target.closest("[data-cal-nav]");
    if (navigation) {
      const next = new Date(viewYear, viewMonth + Number(navigation.dataset.calNav), 1);
      viewYear = next.getFullYear();
      viewMonth = next.getMonth();
      render();
      position();
      return;
    }
    const day = event.target.closest("[data-cal-day]");
    if (day && !day.disabled) return applyDate(parseDate(day.dataset.calDay));
    if (event.target.closest("[data-cal-today]")) {
      const today = new Date();
      if (allowed(today)) applyDate(today);
      else {
        const limit = parseDate(active.min || active.max);
        if (limit) { viewYear = limit.getFullYear(); viewMonth = limit.getMonth(); render(); position(); }
      }
      return;
    }
    if (event.target.closest("[data-cal-clear]")) return commit("");
    if (event.target.closest("[data-cal-apply]") && selected) {
      let value = `${dateKey(selected)}T${picker.querySelector("[data-cal-hour]").value}:${picker.querySelector("[data-cal-minute]").value}`;
      if (active.min && value < active.min) value = active.min.slice(0, 16);
      if (active.max && value > active.max) value = active.max.slice(0, 16);
      commit(value);
    }
  }, true);

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && active) { close(); return; }
    if (event.altKey && event.key === "ArrowDown" && event.target.matches?.(selector)) {
      event.preventDefault();
      open(event.target);
    }
  });
  document.addEventListener("change", event => {
    if (picker?.contains(event.target) && event.target.matches("[data-cal-hour], [data-cal-minute]")) {
      selectedTime = {
        hour: Number(picker.querySelector("[data-cal-hour]").value),
        minute: Number(picker.querySelector("[data-cal-minute]").value)
      };
    }
  });
  window.addEventListener("resize", position);
  document.addEventListener("scroll", event => {
    if (active && !picker?.contains(event.target)) position();
  }, true);
})();
