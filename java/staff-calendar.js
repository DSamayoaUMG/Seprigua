window.SepriguaStaffCalendar = function ({api, state, esc, openModal, closeModal, showToast}) {
  const daysOfWeek = [
    ["Lunes", "Lun"], ["Martes", "Mar"], ["Miércoles", "Mié"], ["Jueves", "Jue"],
    ["Viernes", "Vie"], ["Sábado", "Sáb"], ["Domingo", "Dom"]
  ];
  const vacationLabels = {APROBADA:"Vacaciones", PENDIENTE:"Solicitud pendiente", REPROGRAMAR:"Por reprogramar"};
  const vacationOrder = ["APROBADA", "PENDIENTE", "REPROGRAMAR"];
  let selectedWeek = "", search = "";
  let selectionKey, selectedPeople = null;

  function offset(day, days) {
    const date = new Date(day + "T12:00:00Z");
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function shortDate(day) {
    return day.slice(8, 10) + "/" + day.slice(5, 7);
  }

  function searchText(text) {
    return String(text).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  }

  function loadSelection() {
    const userId = state.user?.usuario_id || state.user?.usuario;
    const key = userId ? "seprigua:personal-calendario:" + userId : "";
    if (key === selectionKey) return;
    selectionKey = key;
    selectedPeople = null;
    if (!key) return;
    try {
      const saved = JSON.parse(localStorage.getItem(key));
      if (Array.isArray(saved)) selectedPeople = new Set(saved.map(String));
    } catch { /* La selección sigue disponible durante esta sesión. */ }
  }

  function selectPeople(ids, total) {
    selectedPeople = ids.length === total ? null : new Set(ids);
    if (!selectionKey) return;
    try {
      if (selectedPeople) localStorage.setItem(selectionKey, JSON.stringify(ids));
      else localStorage.removeItem(selectionKey);
    } catch { /* La selección sigue disponible durante esta sesión. */ }
  }

  function showPerson(id) {
    return !selectedPeople || selectedPeople.has(String(id));
  }

  function choosePeople(people, refresh) {
    openModal("Mostrar personal", `<section class="se-week-picker" data-week-picker>
      <div class="se-week-picker-tools">
        <p data-week-picker-count aria-live="polite"></p>
        <div class="actions">
          <button type="button" class="btn small" data-week-pick-all>Marcar todos</button>
          <button type="button" class="btn small" data-week-pick-none>Desmarcar todos</button>
        </div>
      </div>
      <fieldset class="se-week-picker-list"><legend class="sr-only">Personal visible en la cuadrícula</legend>
        ${people.map(({person}) => `<label class="se-week-picker-person">
          <input type="checkbox" value="${esc(person.id)}" ${showPerson(person.id) ? "checked" : ""}>
          <span><strong>${esc(person.nombre)}</strong><small>${esc(person.puesto)}</small></span>
        </label>`).join("")}
      </fieldset>
      <div class="form-actions"><button type="button" class="btn primary" data-close-modal>Listo</button></div>
    </section>`);
    const picker = document.querySelector("[data-week-picker]");
    const boxes = [...picker.querySelectorAll('input[type="checkbox"]')];
    const markAll = picker.querySelector("[data-week-pick-all]");
    const markNone = picker.querySelector("[data-week-pick-none]");
    const count = picker.querySelector("[data-week-picker-count]");
    function update(persist) {
      const ids = boxes.filter(box => box.checked).map(box => box.value);
      if (persist) selectPeople(ids, boxes.length);
      count.textContent = `${ids.length} de ${boxes.length} seleccionados`;
      markAll.disabled = ids.length === boxes.length;
      markNone.disabled = !ids.length;
      if (persist) refresh();
    }
    picker.addEventListener("change", () => update(true));
    function mark(checked) {
      boxes.forEach(box => { box.checked = checked; });
      update(true);
    }
    markAll.addEventListener("click", () => mark(true));
    markNone.addEventListener("click", () => mark(false));
    update(false);
  }

  function weeklyDays(data, employeeId, team) {
    const belongsToPerson = item => !team || item.empleado_id === employeeId;
    const shifts = new Map(data.horarios.filter(belongsToPerson).map(item => [item.fecha, item]));
    const vacations = data.vacaciones.filter(belongsToPerson);
    return daysOfWeek.map(([label, shortLabel], index) => {
      const date = offset(data.lunes, index);
      const vacation = vacationOrder.map(status => vacations.find(item =>
        item.estado === status && item.inicio <= date && item.fin >= date)).find(Boolean);
      return {label, shortLabel, date, shift: shifts.get(date), vacation};
    });
  }

  function shiftSummary({shift, vacation}) {
    const hours = shift ? esc(shift.inicio + " – " + shift.fin) : "";
    const leave = vacation ? vacationLabels[vacation.estado] : "";
    return `${hours ? `<span class="se-week-hours">${hours}</span>` : ""}
      ${leave ? `<span class="se-week-leave ${vacation.estado === "APROBADA" ? "approved" : ""}">${esc(leave)}</span>` : ""}
      ${!hours && !leave ? '<span class="se-week-no-shift">Sin horario</span>' : ""}`;
  }

  function teamGrid(data, people) {
    if (!people.length) return '<p class="se-week-empty">No hay personal operativo para esta vista.</p>';
    const heading = weeklyDays(data, null, true);
    const rows = people.map(({person, days}) => {
      const initials = person.nombre.split(/\s+/).slice(0, 2).map(word => word[0]).join("").toUpperCase();
      return `<tr data-week-row="${esc(person.id)}" data-search="${esc(searchText(person.nombre + " " + person.puesto))}">
        <th scope="row" class="se-week-name">
          <button class="se-week-employee" type="button" data-week-edit="${esc(person.id)}" aria-label="Editar semana de ${esc(person.nombre)}">
            <span class="se-week-initials" aria-hidden="true">${esc(initials)}</span>
            <span><strong>${esc(person.nombre)}</strong><small>${esc(person.puesto)}</small></span>
            <i data-lucide="pencil" aria-hidden="true"></i>
          </button>
        </th>
        ${days.map(day => {
          const today = day.date === data.hoy;
          const tone = day.vacation?.estado === "APROBADA" ? "vacation" : day.vacation ? "pending" : day.shift ? "scheduled" : "empty";
          const action = day.shift ? "Editar horario" : "Agregar horario";
          return `<td class="${today ? "is-today" : ""}">
            <button class="se-week-cell is-${tone}" type="button" data-week-edit="${esc(person.id)}" data-week-day="${esc(day.date)}"
                    aria-label="${action} de ${esc(person.nombre)}, ${day.label} ${shortDate(day.date)}: ${esc(day.shift ? day.shift.inicio + " a " + day.shift.fin : "sin horario")}${day.vacation ? ", " + esc(vacationLabels[day.vacation.estado]) : ""}">
              ${shiftSummary(day)}
              ${tone === "empty" ? '<span class="se-week-cell-add" aria-hidden="true">+</span>' : ""}
            </button>
          </td>`;
        }).join("")}
      </tr>`;
    }).join("");
    return `<div class="se-week-scroll" tabindex="0" role="region" aria-label="Cuadrícula semanal del personal">
      <table class="se-week-grid">
        <thead><tr><th scope="col" class="se-week-name">Personal</th>
          ${heading.map(day => `<th scope="col" class="${day.date === data.hoy ? "is-today" : ""}">
            <abbr title="${day.label}">${day.shortLabel}</abbr> <time datetime="${esc(day.date)}">${shortDate(day.date)}</time>
          </th>`).join("")}
        </tr></thead><tbody>${rows}</tbody>
      </table>
    </div><p class="se-week-empty" data-week-no-match hidden role="status"></p>
    <p class="se-week-swipe">Desliza para ver los demás días.</p>`;
  }

  function personalGrid(data, days) {
    if (!data.empleado_id) return '<p class="se-week-empty">No hay un horario vinculado a tu cuenta.</p>';
    return `<div class="se-week-days">${days.map(day => `<article class="se-week-day ${day.date === data.hoy ? "is-today" : ""}">
      <div><strong>${day.label}</strong><time datetime="${esc(day.date)}">${shortDate(day.date)}</time></div>
      ${shiftSummary(day)}
    </article>`).join("")}</div>`;
  }

  async function mount(root) {
    const coord = state.role === "COORDINADOR";
    if (coord) loadSelection();
    let revision = 0;

    function report(error) {
      if (root.isConnected) showToast(error.message, "error");
    }

    async function render(week = selectedWeek) {
      const version = ++revision;
      const params = new URLSearchParams({semana: week});
      if (coord) params.set("vista", "equipo");
      const scrollLeft = root.querySelector(".se-week-scroll")?.scrollLeft || 0;
      root.setAttribute("aria-busy", "true");
      let data;
      try {
        data = await api("/api/vacaciones/calendario?" + params, {seCache:"no-store"});
      } finally {
        if (version === revision) root.removeAttribute("aria-busy");
      }
      if (version !== revision || !root.isConnected) return;
      selectedWeek = data.lunes;
      const people = data.personal.map(person => ({person, days: weeklyDays(data, person.id, coord)}));
      const withShifts = coord ? people.filter(entry => entry.days.some(day => day.shift)) : [];

      root.innerHTML = `<header class="se-week-head">
        <div><h2>Horarios y vacaciones</h2><p>Semana del ${shortDate(data.lunes)} al ${shortDate(data.domingo)} de ${esc(data.domingo.slice(0, 4))}</p></div>
        ${coord ? `<div class="actions">
          <button class="btn" type="button" data-week-copy ${withShifts.length ? "" : 'disabled title="Agrega un horario en esta semana para poder copiarlo"'}><i data-lucide="copy" aria-hidden="true"></i> Copiar horarios</button>
          <button class="btn" type="button" data-action="nueva-vacacion"><i data-lucide="calendar-plus" aria-hidden="true"></i> Asignar vacaciones</button>
        </div>` : ""}
      </header><div class="se-week-tools">
        <div class="actions" aria-label="Cambiar semana">
          <button class="btn" type="button" data-week-nav="-7" aria-label="Semana anterior">‹</button>
          <button class="btn" type="button" data-week-nav="0">Esta semana</button>
          <button class="btn" type="button" data-week-nav="7" aria-label="Semana siguiente">›</button>
        </div>
        ${coord && people.length ? `<div class="se-week-filters">
          <button class="btn" type="button" data-week-choose aria-haspopup="dialog">
            <i data-lucide="list-checks" aria-hidden="true"></i> Mostrar personal <span data-week-selection-count></span>
          </button>
          <label class="se-week-search"><i data-lucide="search" aria-hidden="true"></i>
            <input data-week-search type="search" value="${esc(search)}" placeholder="Buscar personal" aria-label="Buscar personal por nombre o cargo">
          </label>
        </div>` : ""}
      </div>
      ${coord ? teamGrid(data, people) : personalGrid(data, people[0]?.days || [])}`;

      if (week === data.lunes && scrollLeft) {
        const scroll = root.querySelector(".se-week-scroll");
        if (scroll) scroll.scrollLeft = scrollLeft;
      }
      root.querySelectorAll("[data-week-nav]").forEach(button => button.addEventListener("click", async () => {
        const direction = Number(button.dataset.weekNav);
        try {
          await render(direction ? offset(data.lunes, direction) : "");
          if (!button.isConnected) root.querySelector(`[data-week-nav="${direction}"]`)?.focus({preventScroll:true});
        } catch (error) {
          report(error);
        }
      }));
      const input = root.querySelector("[data-week-search]");
      if (input) {
        const rows = [...root.querySelectorAll("[data-week-row]")];
        const selector = root.querySelector("[data-week-choose]");
        const label = root.querySelector("[data-week-selection-count]");
        const empty = root.querySelector("[data-week-no-match]");
        const swipe = root.querySelector(".se-week-swipe");
        function filter() {
          search = input.value;
          const term = searchText(search);
          let selected = 0;
          for (const row of rows) {
            const included = showPerson(row.dataset.weekRow);
            if (included) selected++;
            row.hidden = !included || !row.dataset.search.includes(term);
          }
          const hasResults = rows.some(row => !row.hidden);
          label.textContent = selected + "/" + rows.length;
          empty.hidden = hasResults;
          empty.textContent = selected ? "No hay personal visible que coincida con la búsqueda." : "Selecciona a quién quieres ver en Mostrar personal.";
          swipe.hidden = !hasResults;
        }
        input.addEventListener("input", filter);
        selector.addEventListener("click", () => choosePeople(people, filter));
        filter();
      }
      root.querySelectorAll("[data-week-edit]").forEach(button => button.addEventListener("click", () => {
        const entry = people.find(({person}) => String(person.id) === button.dataset.weekEdit);
        const date = button.dataset.weekDay;
        edit(data, entry.person, date ? entry.days.filter(day => day.date === date) : entry.days, button, date);
      }));
      root.querySelector("[data-week-copy]")?.addEventListener("click", () => copyWeek(data, withShifts));
      window.lucide?.createIcons();
    }

    function copyWeek(data, people) {
      openModal("Copiar horarios a otra semana", `<form class="se-week-picker se-week-copy" data-week-copy-form>
        <div class="se-shift-intro"><strong>Semana de origen</strong><span>${shortDate(data.lunes)} al ${shortDate(data.domingo)} de ${esc(data.domingo.slice(0, 4))}</span></div>
        <label class="se-week-copy-date">Fecha de la semana destino
          <input type="date" name="semana_destino" min="2000-01-01" max="2100-12-31" value="${esc(offset(data.lunes, 7))}" required>
        </label>
        <fieldset class="se-week-picker-list"><legend>Personal con horario en la semana de origen</legend>
          ${people.map(({person, days}) => `<label class="se-week-picker-person">
            <input type="checkbox" name="empleado" value="${esc(person.id)}" ${showPerson(person.id) ? "checked" : ""}>
            <span><strong>${esc(person.nombre)}</strong><small>${days.filter(day => day.shift).length} días programados</small></span>
          </label>`).join("")}
        </fieldset>
        <label class="se-week-picker-person se-week-copy-replace">
          <input type="checkbox" name="reemplazar">
          <span>Reemplazar turnos que ya existen en los días copiados</span>
        </label>
        <p class="se-shift-help">Se copian los turnos registrados al mismo día de la semana destino.</p>
        <div class="form-actions"><button type="button" class="btn" data-close-modal>Cancelar</button><button type="submit" class="btn primary">Copiar horarios</button></div>
      </form>`);
      document.querySelector("[data-week-copy-form]").addEventListener("submit", async event => {
        event.preventDefault();
        const form = event.currentTarget;
        const button = form.querySelector('button[type="submit"]');
        if (button.disabled) return;
        const fields = new FormData(form);
        const employees = fields.getAll("empleado").map(Number);
        if (!employees.length) {
          showToast("Selecciona de quiénes quieres copiar el horario.", "error");
          return;
        }
        button.disabled = true;
        try {
          const result = await api("/api/vacaciones/calendario/copiar", {method:"POST", body:{
            semana_origen:data.lunes, semana_destino:fields.get("semana_destino"),
            empleados:employees, reemplazar:fields.has("reemplazar")
          }});
          closeModal();
          showToast(`Horarios de destino: ${result.creados} agregados, ${result.reemplazados} reemplazados y ${result.conservados} conservados.`);
          if (root.isConnected) await render(fields.get("semana_destino"));
        } catch (error) {
          report(error);
        } finally {
          button.disabled = false;
        }
      });
    }

    function edit(data, person, days, trigger, date) {
      const original = days.map(({date, shift}) => ({fecha:date, inicio:shift?.inicio || "", fin:shift?.fin || ""}));
      const periodLabel = date ? `${days[0].label} ${shortDate(date)}` : `Semana del ${shortDate(data.lunes)} al ${shortDate(data.domingo)}`;
      openModal(date ? "Editar horario del día" : "Editar horario semanal", `<form class="se-shift-form" data-shift-form>
        <div class="se-shift-intro"><strong>${esc(person.nombre)}</strong><span>${periodLabel}</span></div>
        ${days.map(({label, date, shift, vacation}, i) => `<div class="se-shift-row">
          <strong>${label} <small>${shortDate(date)}</small>${vacation ? `<span class="se-week-leave ${vacation.estado === "APROBADA" ? "approved" : ""}">${esc(vacationLabels[vacation.estado])}</span>` : ""}</strong>
          <label>Entrada<input type="time" name="inicio${i}" value="${esc(shift?.inicio || "")}"></label>
          <label>Salida<input type="time" name="fin${i}" value="${esc(shift?.fin || "")}"></label>
        </div>`).join("")}
        <p class="se-shift-help">Deja ambas horas vacías para quitar el horario.</p>
        <div class="form-actions"><button type="button" class="btn" data-close-modal>Cancelar</button><button type="submit" class="btn primary">Guardar horario</button></div>
      </form>`);
      document.querySelector("[data-shift-form]").addEventListener("submit", async event => {
        event.preventDefault();
        const form = event.currentTarget;
        const button = form.querySelector('button[type="submit"]');
        if (button.disabled) return;
        const horarios = days.map(({date}, i) => ({fecha:date, inicio:form.elements["inicio" + i].value, fin:form.elements["fin" + i].value}));
        button.disabled = true;
        try {
          await api("/api/vacaciones/calendario", {method:"PUT", body:{semana:data.lunes, fecha:date, empleado_id:person.id, original, horarios}});
          closeModal();
          showToast("Horario guardado.");
          if (!root.isConnected) return;
          await render();
          const selector = `[data-week-edit="${CSS.escape(trigger.dataset.weekEdit)}"]`;
          root.querySelector(selector + (date ? `[data-week-day="${date}"]` : ":not([data-week-day])"))?.focus({preventScroll:true});
        } catch (error) {
          report(error);
        } finally {
          button.disabled = false;
        }
      });
    }

    try {
      await render();
    } catch (error) {
      if (!root.isConnected) return;
      root.innerHTML = `<div class="se-week-empty"><strong>Horarios y vacaciones</strong><p>${esc(error.message)}</p><button type="button" class="btn">Reintentar</button></div>`;
      root.querySelector("button").addEventListener("click", () => mount(root));
    }
  }
  return mount;
};
