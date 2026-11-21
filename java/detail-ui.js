/* Presentación compartida para vistas de detalle. Los valores llegan escapados por cada módulo. */
window.SepriguaDetail = (() => {
  const icons = [
    [/ticket/i, 'ticket'],
    [/teléfono/i, 'phone'], [/correo/i, 'mail'],
    [/estado/i, 'circle-dot'],
    [/urgencia|prioridad|severidad/i, 'flag'],
    [/cliente|titular|empleado|contacto|personal/i, 'user-round'],
    [/sede|empresa|razón social/i, 'building-2'],
    [/ubicación|dirección|resguardo/i, 'map-pin'],
    [/clasificación|categoría|tipo/i, 'layers-3'],
    [/fecha|atención|inicio|fin|vencimiento|ingreso|cread|actualiz|revisión/i, 'calendar-days'],
    [/cuadrilla|técnic/i, 'users-round'],
    [/documento|archivo|ot \/ oc|número|versión|referencia/i, 'file-text'],
    [/marca|modelo|serie|código|equipo/i, 'wrench'],
    [/nit/i, 'hash'],
  ];
  const iconFor = label => icons.find(([pattern]) => pattern.test(label))?.[1] || 'info';
  const row = (label, value, icon = iconFor(label)) => `<div class="se-detail-row"><div class="se-detail-label"><i data-lucide="${icon}" aria-hidden="true"></i><span>${label}</span></div><div class="se-detail-value">${value ?? '—'}</div></div>`;
  const rows = items => `<div class="se-detail-rows">${items.map(item => row(...item)).join('')}</div>`;
  const section = (title, items, icon = 'info') => `<section class="se-detail-section"><h3 class="se-detail-section-title"><i data-lucide="${icon}" aria-hidden="true"></i>${title}</h3>${rows(items)}</section>`;
  const prose = (title, body, icon = 'file-text') => `<section class="se-detail-section se-detail-prose"><h3 class="se-detail-section-title"><i data-lucide="${icon}" aria-hidden="true"></i>${title}</h3><div class="se-detail-prose-body">${body || '—'}</div></section>`;
  const block = (title, body, icon = 'info', extraClass = '') => `<section class="se-detail-section ${extraClass}"><h3 class="se-detail-section-title"><i data-lucide="${icon}" aria-hidden="true"></i>${title}</h3>${body}</section>`;
  const notice = (title, body, icon = 'info') => `<aside class="se-detail-notice" role="note"><i data-lucide="${icon}" aria-hidden="true"></i><div><strong>${title}</strong><p>${body}</p></div></aside>`;
  const empty = (title, body, icon = 'paperclip') => `<div class="se-detail-empty"><i data-lucide="${icon}" aria-hidden="true"></i><div><strong>${title}</strong><p>${body}</p></div></div>`;
  const actions = body => `<div class="se-detail-actions">${body}</div>`;
  const hero = (kicker, title, meta, status = '', icon = 'file-text') => `<header class="se-detail-hero"><span class="se-detail-hero-icon" aria-hidden="true"><i data-lucide="${icon}"></i></span><div class="se-detail-hero-copy"><span class="se-detail-kicker">${kicker}</span><h2>${title}</h2><p>${meta || ''}</p></div>${status ? `<div class="se-detail-hero-status">${status}</div>` : ''}</header>`;
  return { row, rows, section, prose, block, notice, empty, actions, hero, iconFor };
})();
