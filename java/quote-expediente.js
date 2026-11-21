/* Expediente de cotización del cliente. Solo consume rutas ya autorizadas por el servidor. */
window.SepriguaQuoteExpediente = async function (c, rawId) {
  const {api, state, esc, fmt, money, badge, setHeading, content} = c;
  const id = Number(rawId);
  if (state.role !== 'CLIENTE' || !Number.isInteger(id) || id < 1) return;

  const path = value => {
    const url = String(value || '');
    return /^\/api\/[a-zA-Z0-9/_?=&.%-]+$/.test(url) ? url : '';
  };
  const field = (label, value) => `<div class="qe-field"><span>${esc(label)}</span><strong>${esc(value ?? '—')}</strong></div>`;
  const empty = (icon, title, detail) => `<div class="qe-empty"><i data-lucide="${icon}"></i><strong>${esc(title)}</strong><p>${esc(detail)}</p></div>`;
  const date = value => value ? fmt(value) : 'Sin registro';
  const buttonLink = (href, icon, label, className = '') => href
    ? `<a class="btn ${className}" href="${esc(href)}" ${className.includes('download') ? 'download' : 'target="_blank" rel="noopener"'}><i data-lucide="${icon}"></i>${esc(label)}</a>` : '';

  setHeading('Expediente de cotización', 'Solicitud, orden, propuesta y entregables del servicio.');
  content.innerHTML = '<section class="panel"><div class="quote-flow-loading"><span class="spinner"></span><h3>Cargando expediente...</h3></div></section>';
  try {
    const data = await api(`/api/cotizaciones/${id}/expediente`, {seCache: 'reload'});
    const quote = data.item || {};
    const orderId = Number(quote.orden_id) || 0;
    const [reportResult, orderResult] = await Promise.allSettled([
      api(`/api/cotizaciones/${id}/reporte-trabajo`, {seCache: 'reload'}),
      orderId ? api(`/api/ordenes/${orderId}`, {seCache: 'reload'}) : Promise.resolve(null)
    ]);
    const report = reportResult.status === 'fulfilled' ? reportResult.value : null;
    const order = orderResult.status === 'fulfilled' ? orderResult.value : null;
    const info = order?.item || {};
    const status = String(quote.cotizacion_estado || '').toUpperCase();
    const canRespond = status === 'ENVIADA' && !quote.solo_lectura;
    const pdf = `/api/cotizaciones/${id}/pdf`;
    const orderNumber = quote.numero_orden || quote.numero_orden_papel || info.numero || '';
    const details = data.detalles || [];
    const photoMap = new Map();
    for (const item of [...(data.evidencias || []), ...(order?.evidencias || []), ...(report?.evidencias || [])]) {
      const url = path(item.ruta);
      const image = String(item.mime || item.tipo_mime || '').startsWith('image/') ||
        /^(FOTO|IMAGEN)$/i.test(String(item.tipo || '')) || /\.(jpe?g|png|webp)(\?|$)/i.test(url);
      if (url && image) photoMap.set(url, item);
    }
    const photos = [...photoMap.values()];
    const crew = (order?.tecnicos || []).filter(person => !['CANCELADO', 'DESASIGNADO'].includes(String(person.estado || '').toUpperCase()));
    const activities = order?.actividades || report?.actividades || [];
    const quoteName = quote.nombre_cotizacion || quote.numero_cotizacion || `Cotización #${id}`;

    const requestPanel = orderId ? `<div class="qe-panel-head"><span class="qe-icon"><i data-lucide="clipboard-list"></i></span><div><small>01 · ORIGEN</small><h2>Solicitud de servicio</h2></div></div>
      <div class="qe-feature"><span>Descripción original</span><p>${esc(quote.solicitud_descripcion || 'Sin descripción registrada.')}</p></div>
      <div class="qe-fields">${field('Solicitud', quote.solicitud_id ? `#${quote.solicitud_id}` : '—')}${field('Servicio', quote.tipo_servicio || '—')}${field('Cliente', quote.cliente || '—')}${field('Sede', quote.sede || '—')}${field('Clasificación', quote.clasificacion || '—')}${field('Urgencia', quote.nivel_urgencia || '—')}${field('Registrada', date(quote.solicitud_creada))}${field('Dirección', [quote.direccion, quote.municipio, quote.departamento].filter(Boolean).join(', ') || '—')}</div>`
      : `<div class="qe-panel-head"><span class="qe-icon"><i data-lucide="clipboard-list"></i></span><div><small>01 · ORIGEN</small><h2>Solicitud de servicio</h2></div></div>${empty('file-search', 'Sin solicitud digital vinculada', 'Esta cotización se creó directamente para el cliente.')}
      <div class="qe-fields">${field('Cliente', quote.cliente || '—')}${field('Sede', quote.sede || '—')}</div>`;

    const crewMarkup = crew.length ? `<div class="qe-people">${crew.map(person => `<div><span class="qe-person-icon"><i data-lucide="user-round"></i></span><strong>${esc(person.nombre || 'Personal asignado')}</strong><small>${esc(person.funcion || person.puesto || 'Cuadrilla')}</small></div>`).join('')}</div>`
      : '<p class="qe-muted">No hay integrantes de cuadrilla visibles para esta orden.</p>';
    const activityMarkup = activities.length ? `<ol class="qe-activity-list">${activities.map(item => `<li><strong>${esc(item.Descripcion || item.descripcion || 'Actividad registrada')}</strong><span>${esc(item.empleado || item.tecnico || '')}${item.realizada || item.fecha ? ` · ${esc(date(item.realizada || item.fecha))}` : ''}</span>${item.Resultado || item.resultado ? `<p>${esc(item.Resultado || item.resultado)}</p>` : ''}</li>`).join('')}</ol>`
      : '<p class="qe-muted">Todavía no hay actividades registradas.</p>';
    const photoMarkup = photos.length ? `<div class="qe-photos">${photos.map(item => `<a href="${esc(path(item.ruta))}" target="_blank" rel="noopener" aria-label="Ampliar fotografía del servicio"><img src="${esc(path(item.ruta))}" alt="${esc(item.descripcion || item.nombre || 'Evidencia del servicio')}" loading="lazy"><span><i data-lucide="expand"></i> Ampliar</span></a>`).join('')}</div>`
      : '<p class="qe-muted">Aún no hay fotografías disponibles.</p>';
    const orderPanel = `<div class="qe-panel-head"><span class="qe-icon"><i data-lucide="wrench"></i></span><div><small>02 · EJECUCIÓN</small><h2>Orden de trabajo</h2></div></div>${orderId ? `
      <div class="qe-fields">${field('Número de OT', orderNumber || `OT #${orderId}`)}${field('Estado', quote.orden_estado || info.estado || '—')}${field('Programada', date(quote.programada_para || info.programada))}${field('Inicio', date(quote.iniciada_en || info.IniciadaEn))}${field('Finalización', date(quote.finalizada_en || info.FinalizadaEn))}${field('Prioridad', quote.prioridad || info.Prioridad || '—')}</div>
      <h3>Cuadrilla asignada</h3>${order ? crewMarkup : '<p class="qe-muted">No se pudo cargar el personal asignado en este momento.</p>'}
      <h3>Actividades realizadas</h3>${activityMarkup}
      <div class="qe-section-title"><h3>Fotografías del servicio</h3><span>${photos.length} disponible${photos.length === 1 ? '' : 's'}</span></div>${photoMarkup}`
      : `${empty('clipboard-x', quote.numero_orden_papel ? 'Orden física' : 'Sin orden vinculada', quote.numero_orden_papel ? `Número registrado: ${quote.numero_orden_papel}. El original se entrega en papel.` : 'La propuesta puede existir antes de crear una orden de trabajo.')}`}`;

    const lineMarkup = details.length ? `<div class="qe-line-list">${details.map((line, index) => `<div class="qe-line"><span class="qe-line-index">${esc(line.numero_linea || index + 1)}</span><div class="qe-line-description"><strong>${esc(line.descripcion || 'Concepto')}</strong><small>${String(line.tipo_articulo || '').toUpperCase() === 'BIEN' ? 'Bien' : 'Servicio'} · ${esc(line.cantidad ?? '—')} ${esc(line.unidad_medida || '')}</small></div><div class="qe-line-price"><small>${money(line.precio_unitario, quote.moneda)} c/u</small><strong>${money(line.total_linea, quote.moneda)}</strong></div></div>`).join('')}</div>`
      : empty('list-x', 'Sin conceptos registrados', 'No hay líneas disponibles para esta versión.');
    const versions = report?.versiones || [];
    const versionsMarkup = versions.length ? `<div class="qe-versions">${versions.map(version => `<div><strong>Versión ${esc(version.numero || '—')}${version.actual ? ' · Actual' : ''}</strong><span>${esc(version.estado || '—')} · ${esc(date(version.emision || version.creada))}</span></div>`).join('')}</div>`
      : '<p class="qe-muted">El historial de versiones no está disponible en este momento.</p>';
    const quotePanel = `<div class="qe-panel-head"><span class="qe-icon"><i data-lucide="receipt-text"></i></span><div><small>03 · PROPUESTA</small><h2>${esc(quoteName)}</h2><p>${esc(quote.numero_cotizacion || `Cotización #${id}`)}</p></div></div>
      <div class="qe-fields">${field('Estado', status || '—')}${field('Versión', quote.numero_version || '—')}${field('Forma de pago', quote.condicion_pago || '—')}${field('Emisión', date(quote.fecha_emision))}${field('Vencimiento', date(quote.fecha_expiracion))}${field('Moneda', quote.moneda || 'GTQ')}</div>
      <h3>Conceptos cotizados</h3>${lineMarkup}
      <div class="qe-totals"><div><span>Subtotal</span><strong>${money(quote.subtotal, quote.moneda)}</strong></div><div><span>Descuento</span><strong>${money(quote.descuento_total, quote.moneda)}</strong></div><div><span>Impuesto</span><strong>${money(quote.impuesto_total, quote.moneda)}</strong></div><div class="qe-total-main"><span>Total cotizado</span><strong>${money(quote.total, quote.moneda)}</strong></div></div>
      ${quote.observaciones_cliente ? `<div class="qe-feature"><span>Respuesta del cliente</span><p>${esc(quote.observaciones_cliente)}</p></div>` : ''}
      <h3>Historial de versiones</h3>${versionsMarkup}
      ${status === 'ACEPTADA' ? '<div class="qe-result qe-accepted"><i data-lucide="badge-check"></i> Cotización aceptada</div>' : canRespond ? `<div class="qe-result"><span>Esta propuesta espera tu respuesta.</span><button class="btn primary" type="button" data-action="responder-cotizacion" data-id="${id}">Responder cotización</button></div>` : ''}`;

    const documents = [{title: 'Cotización PDF', description: 'Documento vigente de esta versión', url: pdf, icon: 'receipt-text', date: quote.fecha_emision, action: 'Ver PDF'}];
    const seen = new Set([pdf]);
    if (report) {
      documents.push({title: 'Reporte de trabajo', description: 'Seguimiento del servicio', url: `/api/cotizaciones/${id}/reporte-trabajo.pdf`, icon: 'file-clock', action: 'Ver PDF'});
      seen.add(`/api/cotizaciones/${id}/reporte-trabajo.pdf`);
      for (const doc of report.documentos || []) {
        const url = path(doc.ruta);
        if (!url || seen.has(url)) continue;
        seen.add(url);
        documents.push({title: doc.titulo || 'Archivo autorizado', description: doc.categoria || doc.tipo || 'Entregable', url, icon: 'file-check-2', date: doc.fecha, action: 'Ver archivo'});
      }
    }
    if (orderId && photos.length) {
      documents.push({title: 'Collage fotográfico', description: `${photos.length} fotografía${photos.length === 1 ? '' : 's'} disponible${photos.length === 1 ? '' : 's'}`, url: `/api/ordenes/${orderId}/collage.jpg`, icon: 'images', action: 'Ver collage'});
    }
    const deliverables = `<div class="qe-panel-head"><span class="qe-icon"><i data-lucide="files"></i></span><div><small>04 · ARCHIVOS</small><h2>Entregables</h2><p>Solo archivos disponibles para tu cuenta.</p></div></div>
      <div class="qe-deliverables">${documents.map(doc => `<div class="qe-deliverable"><span class="qe-file-icon"><i data-lucide="${doc.icon}"></i></span><div><strong>${esc(doc.title)}</strong><small>${esc(doc.description)}${doc.date ? ` · ${esc(date(doc.date))}` : ''}</small></div><span class="qe-available">Disponible</span>${buttonLink(doc.url, 'external-link', doc.action)}</div>`).join('')}</div>
      ${orderId && !photos.length ? '<p class="qe-pending">Las evidencias y el collage aparecerán cuando se carguen fotografías a la OT.</p>' : ''}
      ${report ? `<div class="qe-delivery-actions"><button class="btn" type="button" data-action="reporte-trabajo-cotizacion" data-id="${id}"><i data-lucide="package-check"></i> Seguimiento y entrega</button></div>` : '<p class="qe-pending">El seguimiento detallado no está disponible en este momento.</p>'}`;

    const steps = [['solicitud', '01', 'Solicitud', 'clipboard-list'], ['orden', '02', 'Orden de trabajo', 'wrench'], ['cotizacion', '03', 'Cotización', 'receipt-text'], ['entregables', '04', 'Entregables', 'files']];
    content.innerHTML = `<div class="quote-expediente-compact qe-expediente" data-quote-id="${id}">
      <header class="qe-header"><div class="qe-heading"><button class="qe-back" type="button" data-action="volver-cotizaciones"><i data-lucide="arrow-left"></i><span>Volver a cotizaciones</span></button><div class="qe-heading-main"><div><small>EXPEDIENTE DEL SERVICIO</small><h1>${esc(quote.numero_cotizacion || `Cotización #${id}`)}</h1><p>${esc(quoteName)}${orderNumber ? ` · OT ${esc(orderNumber)}` : ' · Sin OT vinculada'}</p></div>${badge(status || '—')}</div></div>
      <div class="qe-header-actions"><div class="qe-header-total"><small>Total cotizado</small><strong>${money(quote.total, quote.moneda)}</strong></div>${status === 'ACEPTADA' ? '<span class="qe-status-accepted"><i data-lucide="badge-check"></i> Aceptada</span>' : ''}<a class="btn primary qe-download" href="${pdf}" download><i data-lucide="download"></i> Descargar cotización</a>${canRespond ? `<button class="btn qe-respond" type="button" data-action="responder-cotizacion" data-id="${id}"><i data-lucide="send"></i> Responder cotización</button>` : ''}</div></header>
      <nav class="qe-steps" role="tablist" aria-label="Apartados del expediente">${steps.map(([key, number, label, icon]) => `<button class="qe-step" type="button" role="tab" id="qe-tab-${key}" aria-controls="qe-panel-${key}" aria-selected="${key === 'cotizacion'}" tabindex="${key === 'cotizacion' ? '0' : '-1'}" data-quote-step="${key}"><span>${number}</span><i data-lucide="${icon}"></i><strong>${label}</strong></button>`).join('')}</nav>
      <section class="qe-panel" id="qe-panel-solicitud" role="tabpanel" aria-labelledby="qe-tab-solicitud" data-quote-panel="solicitud" hidden>${requestPanel}</section>
      <section class="qe-panel" id="qe-panel-orden" role="tabpanel" aria-labelledby="qe-tab-orden" data-quote-panel="orden" hidden>${orderPanel}</section>
      <section class="qe-panel" id="qe-panel-cotizacion" role="tabpanel" aria-labelledby="qe-tab-cotizacion" data-quote-panel="cotizacion">${quotePanel}</section>
      <section class="qe-panel" id="qe-panel-entregables" role="tabpanel" aria-labelledby="qe-tab-entregables" data-quote-panel="entregables" hidden>${deliverables}</section>
    </div>`;
    content.scrollTop = 0;
    window.lucide?.createIcons();
    const root = content.querySelector('.qe-expediente');
    root.querySelector('.qe-steps').addEventListener('click', event => {
      const selected = event.target.closest('[data-quote-step]');
      if (!selected) return;
      const key = selected.dataset.quoteStep;
      root.querySelectorAll('[data-quote-step]').forEach(tab => {
        const active = tab === selected;
        tab.setAttribute('aria-selected', String(active));
        tab.tabIndex = active ? 0 : -1;
      });
      root.querySelectorAll('[data-quote-panel]').forEach(panel => { panel.hidden = panel.dataset.quotePanel !== key; });
    });
    root.querySelector('.qe-steps').addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const tabs = [...root.querySelectorAll('[data-quote-step]')];
      const current = tabs.indexOf(document.activeElement);
      if (current < 0) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[next].click();
      tabs[next].focus();
    });
  } catch (error) {
    content.innerHTML = `<section class="panel"><div class="empty-state"><h3>No se pudo abrir el expediente</h3><p>${esc(error.message || 'Error de conexión')}</p><button class="btn primary" type="button" data-action="volver-cotizaciones">Volver a cotizaciones</button></div></section>`;
  }
};
