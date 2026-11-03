/* Comparte el PDF como archivo cuando el navegador lo permite. */
window.SepriguaShareQuote = (() => {
  let inProgress = false;
  return async function (id, button, showToast) {
    if (inProgress) {
      showToast('Termina el intento anterior de compartir antes de volver a pulsar el botón.', 'error');
      return;
    }
    inProgress = true;
    if (button) button.disabled = true;
    let objectUrl = null;
    try {
      const response = await fetch('/api/cotizaciones/' + encodeURIComponent(id) + '/pdf', {credentials:'same-origin', cache:'no-store'});
      if (!response.ok) throw new Error('No se pudo preparar el PDF de la cotización.');
      const blob = await response.blob();
      const filename = 'Cotizacion-SEPRIGUA-' + id + '.pdf';
      const download = () => {
        objectUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
      };
      if (typeof File !== 'undefined' && typeof navigator.share === 'function' && typeof navigator.canShare === 'function') {
        const file = new File([blob], filename, {type:'application/pdf'});
        let canShareFile = false;
        try { canShareFile = navigator.canShare({files:[file]}); } catch (_) {}
        if (canShareFile) {
          try {
            await navigator.share({files:[file], title:'Cotización SEPRIGUA'});
            return;
          } catch (error) {
            if (error && error.name === 'AbortError') return;
            download();
            showToast(error && error.name === 'InvalidStateError'
              ? 'Ya había un cuadro para compartir abierto. Se descargó el PDF para que puedas enviarlo como archivo.'
              : 'El navegador no pudo compartir directamente. Se descargó el PDF para adjuntarlo por WhatsApp o correo.');
            return;
          }
        }
      }
      download();
      showToast('Se descargó el PDF. Puedes adjuntarlo por WhatsApp o correo.');
    } catch (error) {
      showToast(error && error.message ? error.message : 'No se pudo preparar el PDF para compartir.', 'error');
    } finally {
      inProgress = false;
      if (button) button.disabled = false;
      if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    }
  };
})();

/* Editor de cotizaciones de página completa. */
window.SepriguaQuoteEditor = async function (c, orderId, quoteId) {
  const {api,esc,money,showToast,setHeading,content,navigate,closeModal}=c;
  const $=selector=>content.querySelector(selector);
  async function pages(url) {
    const items=[];let page=1;
    for (;;) {
      const result=await api(url+(url.indexOf('?')<0?'?':'&')+'pagina='+page+'&tamano=100');
      items.push(...(result.items||[]));
      if(page>=(result.paginas||1))return items;
      page++;
    }
  }
  const [orders,clients,initialCatalog,old]=await Promise.all([
    pages('/api/ordenes'),pages('/api/clientes'),pages('/api/catalogo-maestro?solo_activos=1'),
    quoteId?api('/api/cotizaciones/'+quoteId+'/detalle'):Promise.resolve(null)
  ]);
  if(old&&['ACEPTADA','ANULADA'].indexOf(String(old.item.cotizacion_estado||'').toUpperCase())>=0){
    showToast('La cotización ya está cerrada.','error');return;
  }
  if(old)orderId=old.item.orden_id||'';
  closeModal();
  let catalog=initialCatalog,sites=[],siteRequest=0,lines=old?(old.lineas||[]).map(x=>({
    catalog_id:x.concepto_id?(catalog.find(y=>String(y.concepto_id)===String(x.concepto_id))?.id||''):(catalog.find(y=>normBasic(y.nombre)===normBasic(x.descripcion))?.id||''),
    concepto_id:x.concepto_id||null,descripcion:x.descripcion||'',cantidad:x.cantidad||1,
    tipo_articulo:x.tipo_articulo||(/^(unidad|pieza)$/i.test(String(x.unidad||'').trim())?'BIEN':'SERVICIO'),precio:x.precio_unitario||0,
    precio_sugerido:x.precio_sugerido||0,descuento:x.descuento||0,
    impuesto:x.porcentaje_impuesto||0,observaciones:x.observaciones||'',motivo:x.motivo||''
  })):[{descripcion:'',cantidad:1,tipo_articulo:'SERVICIO',precio:0,descuento:0,impuesto:0}];
  const availableOrders=orders.filter(o=>String(o.estado_codigo||o.codigo_estado||o.estado||'').toUpperCase()!=='CANCELADA'&&(!o.tiene_cotizacion||String(o.id)===String(orderId)));
  const activeClients=clients.filter(x=>x.activo!==false&&x.activo!==0);
  function normBasic(s){return String(s||'').trim().toLocaleLowerCase();}
  const norm=s=>String(s||'').trim().toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ');
  const format=n=>money(Number(n||0));
  const dayOffset=n=>{const d=new Date();d.setHours(12,0,0,0);d.setDate(d.getDate()+n);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');};
  const minExpiry=dayOffset(1),maxExpiry=dayOffset(365);
  const priorExpiry=String(old?.item?.fecha_expiracion||'').slice(0,10);
  const initialExpiry=priorExpiry>=minExpiry&&priorExpiry<=maxExpiry?priorExpiry:dayOffset(15);
  const paymentOptions=['Efectivo','Crédito','Cheque','Transferencia'];
  const previousPayment=String(old?.item?.condicion_pago||'Efectivo').trim();
  const selectedPayment=paymentOptions.find(x=>norm(x)===norm(previousPayment))||'__otra__';
  setHeading(quoteId?'Nueva versión de cotización':'Nueva cotización','Prepara una propuesta para un cliente, con o sin orden de trabajo.');
  content.innerHTML=`<section class="qe-page"><form id="qeForm">
    <header class="qe-header"><button type="button" class="qe-back" id="qeBack" aria-label="Regresar a cotizaciones"><i data-lucide="arrow-left"></i></button><div class="qe-heading-icon"><i data-lucide="file-text"></i></div><div class="qe-title"><small>PROPUESTA COMERCIAL</small><h2>${quoteId?'Nueva versión':'Nueva cotización'}</h2><p>Selecciona servicios del catálogo o agrega uno nuevo sin salir de esta página.</p></div><button type="submit" data-save-mode="send" class="btn primary qe-save"><i data-lucide="send"></i> <span class="qe-send-label">Guardar y enviar</span></button></header>
    <div class="qe-layout"><div class="qe-main">
      <section class="qe-card qe-proposal-card"><div class="qe-section-title"><span><i data-lucide="contact-round"></i></span><div><h3>Datos de la propuesta</h3><p>La orden de trabajo es opcional. Puedes cotizar antes o después del servicio.</p></div></div>
        <div class="qe-fields"><label class="qe-field"><span>Cliente <b>*</b></span><select name="cliente_id" id="qeClient" ${quoteId?'disabled':''}><option value="">Selecciona un cliente</option><option value="__nuevo__" ${old?.item?.prospecto_nombre?'selected':''}>Nuevo cliente</option>${activeClients.map(x=>`<option value="${esc(x.id)}" ${String(old?.item?.cliente_id)===String(x.id)?'selected':''}>${esc(x.nombre||x.cliente||'Cliente')}</option>`).join('')}</select></label>
          <label class="qe-field"><span>Orden de trabajo <em>opcional</em></span><select name="orden_id" id="qeOrder" ${quoteId?'disabled':''}><option value="">Sin orden de trabajo</option>${availableOrders.map(o=>`<option value="${esc(o.id)}" ${String(orderId)===String(o.id)?'selected':''}>${esc(o.numero||'OT #'+o.id)} · ${esc(o.cliente||'Cliente')}</option>`).join('')}</select></label>
          <div class="qe-guest-fields qe-wide" id="qeGuestFields" hidden><div class="qe-guest-heading"><strong>Datos del nuevo cliente</strong><small>Se guardarán únicamente con esta cotización. No se creará una cuenta ni un registro permanente de cliente.</small></div><label class="qe-field qe-wide"><span>Nombre del cliente o empresa <b>*</b></span><input name="prospecto_nombre" id="qeGuestName" maxlength="200" value="${esc(old?.item?.prospecto_nombre||'')}" placeholder="Ej. María López o Empresa ABC"></label><label class="qe-field"><span>Correo de contacto <em>opcional</em></span><input name="prospecto_correo" type="email" maxlength="254" value="${esc(old?.item?.prospecto_correo||'')}" placeholder="correo@ejemplo.com"></label><label class="qe-field"><span>Teléfono <em>opcional</em></span><input name="prospecto_telefono" type="tel" maxlength="40" value="${esc(old?.item?.prospecto_telefono||'')}" placeholder="+502 5555 5555"></label></div>
          <label class="qe-field qe-wide"><span>Nombre de la cotización</span><input name="nombre" maxlength="250" value="${esc(old?.item?.nombre_cotizacion||'')}" placeholder="Ej. Mantenimiento de drenajes"></label>
          <div class="qe-order-details qe-wide" id="qeOrderDetails"><div class="qe-order-details-head"><i data-lucide="map-pin"></i><div><strong>Ubicación y orden física</strong><small>Completa la sede cuando no hay una OT del sistema. La orden física solo se escribe si existe en papel.</small></div></div><div class="qe-order-details-grid"><div class="qe-field"><label class="qe-site-label" for="qeSiteSearch">Sede existente <b id="qeSiteRequired">*</b></label><div class="qe-site-picker" id="qeSitePicker"><div class="qe-site-control"><input id="qeSiteSearch" type="search" role="combobox" aria-autocomplete="list" aria-controls="qeSiteOptions" aria-expanded="false" autocomplete="off" placeholder="Busca por nombre o código de sede"><button type="button" id="qeSiteToggle" aria-label="Mostrar sedes" disabled><i data-lucide="chevron-down"></i></button></div><div id="qeSiteOptions" class="qe-site-options" role="listbox" hidden></div></div><input id="qeSiteId" type="hidden" name="sede_id" value="${esc(old?.item?.sede_id||'')}"><small id="qeSiteHint">Selecciona primero un cliente.</small></div><label class="qe-field"><span>Número de OT física <em>si existe</em></span><input name="orden_fisica_numero" id="qePhysicalOrder" maxlength="60" value="${esc(old?.item?.numero_orden_papel||'')}" placeholder="Ej. OC 12542"><small>El número aparecerá en la cotización y su PDF.</small></label></div></div>
          <div class="qe-field"><label for="qeExpiry">Válida hasta <b>*</b></label><div class="qe-date-control"><input name="fecha_vencimiento" id="qeExpiry" type="date" min="${minExpiry}" max="${maxExpiry}" value="${initialExpiry}" required><button type="button" id="qeOpenCalendar" aria-label="Abrir calendario de vencimiento"><i data-lucide="calendar-days"></i></button></div><div class="qe-date-presets" aria-label="Vigencia rápida"><button type="button" data-expiry-days="7">7 días</button><button type="button" data-expiry-days="15">15 días</button><button type="button" data-expiry-days="30">30 días</button></div><small id="qeExpiryHint"></small></div>
          <div class="qe-field"><label for="qePayment">Forma de pago</label><select name="condicion_pago_opcion" id="qePayment">${paymentOptions.map(x=>`<option value="${esc(x)}" ${selectedPayment===x?'selected':''}>${esc(x)}</option>`).join('')}<option value="__otra__" ${selectedPayment==='__otra__'?'selected':''}>Otro</option></select><input name="condicion_pago_personalizada" id="qePaymentOther" maxlength="80" value="${esc(selectedPayment==='__otra__'?previousPayment:'')}" placeholder="Especifica la forma de pago" ${selectedPayment==='__otra__'?'':'hidden'} ${selectedPayment==='__otra__'?'required':''}><small>Selecciona cómo pagará el cliente.</small></div>
          ${quoteId?`<label class="qe-field qe-wide"><span>Motivo de la nueva versión <b>*</b></span><textarea name="motivo" maxlength="700" required placeholder="Explica qué cambió"></textarea></label>`:''}
        </div>
      </section>
      <section class="qe-card"><div class="qe-section-title qe-line-title"><span><i data-lucide="list-plus"></i></span><div><h3>Servicios de la cotización <small id="qeCount"></small></h3><p>Haz clic en “Agregar” en el catálogo o escribe un servicio propio.</p></div></div><div id="qeLines" class="qe-lines"></div><div class="qe-add-row"><button class="btn" type="button" id="qeAddBlank"><i data-lucide="plus"></i> Agregar otro renglón</button></div></section>
      <div class="qe-bottom"><p id="qeSendHint">Guarda como borrador para revisarla o envíala al cliente y luego descarga el PDF.</p><div class="qe-bottom-actions"><button type="submit" data-save-mode="draft" class="btn"><i data-lucide="save"></i> Guardar borrador</button><button type="submit" data-save-mode="send" class="btn primary"><i data-lucide="send"></i> <span class="qe-send-label">Guardar y enviar</span></button></div></div>
    </div><aside class="qe-side"><section class="qe-total-card"><small>TOTAL ESTIMADO</small><strong id="qeTotal">Q 0.00</strong><div><span>Subtotal</span><b id="qeSubtotal">Q 0.00</b></div><div><span>Descuentos</span><b id="qeDiscount">Q 0.00</b></div><div><span>Impuestos</span><b id="qeTax">Q 0.00</b></div></section>
      <section class="qe-catalog-card"><div class="qe-catalog-heading"><span><i data-lucide="book-open-check"></i></span><div><h3>Catálogo maestro</h3><p>Trabajos y precios de referencia</p></div></div><label class="qe-search"><i data-lucide="search"></i><input id="qeSearch" type="search" placeholder="Buscar servicio o código..." autocomplete="off"></label><div id="qeCatalog" class="qe-catalog-list"></div><div class="qe-new-service"><h4>Crear servicio mientras cotizas</h4><div class="qe-new-fields"><input id="qeNewName" maxlength="220" placeholder="Nombre del servicio" aria-label="Nombre del servicio"><input id="qeNewPrice" type="number" min="0" step="0.01" placeholder="Precio Q" aria-label="Precio del servicio"></div><button type="button" class="btn" id="qeAddNew"><i data-lucide="plus"></i> Agregar servicio</button><small>Si el nombre ya existe, se seleccionará el trabajo del catálogo.</small></div></section>
    </aside></div></form></section>`;
  const form=$('#qeForm');
  const icon=()=>window.lucide?.createIcons();
  const fresh=()=>({descripcion:'',cantidad:1,tipo_articulo:'SERVICIO',precio:0,descuento:0,impuesto:0});
  function totals(){let subtotal=0,discount=0,tax=0;lines.forEach(l=>{const base=Number(l.cantidad||0)*Number(l.precio||0),d=Number(l.descuento||0);subtotal+=base;discount+=d;tax+=Math.max(0,base-d)*Number(l.impuesto||0)/100;});$('#qeSubtotal').textContent=format(subtotal);$('#qeDiscount').textContent=format(discount);$('#qeTax').textContent=format(tax);$('#qeTotal').textContent=format(subtotal-discount+tax);$('#qeCount').textContent='('+lines.length+')';}
  function articleTypeControl(line,index){
    const type=String(line.tipo_articulo||'SERVICIO').toUpperCase();
    return `<label><span>Descripción</span><select data-field="tipo_articulo" aria-label="Bien o servicio del renglón ${index+1}"><option value="SERVICIO" ${type==='SERVICIO'?'selected':''}>Servicio</option><option value="BIEN" ${type==='BIEN'?'selected':''}>Bien</option></select></label>`;
  }
  function paintLines(){
    $('#qeLines').innerHTML=lines.map((l,i)=>`<div class="qe-line" data-line="${i}"><div class="qe-line-top"><span class="qe-line-num">${i+1}</span><div><strong>${esc(l.catalog_name||'Concepto personalizado')}</strong><small>${l.catalog_id?'Desde el catálogo maestro':'Se agregará al catálogo al guardar'}</small></div><button type="button" data-remove="${i}" aria-label="Quitar concepto" ${lines.length===1?'disabled':''}><i data-lucide="trash-2"></i></button></div><div class="qe-line-fields"><label class="qe-desc"><span>Detalle del bien o servicio <b>*</b></span><textarea data-field="descripcion" maxlength="1200" required>${esc(l.descripcion||'')}</textarea></label><label><span>Cantidad</span><input data-field="cantidad" type="number" min="0.001" step="0.001" value="${esc(l.cantidad)}" required></label>${articleTypeControl(l,i)}<label><span>Precio unitario Q</span><input data-field="precio" type="number" min="0" step="0.01" value="${esc(l.precio)}" required></label><label><span>Descuento Q</span><input data-field="descuento" type="number" min="0" step="0.01" value="${esc(l.descuento)}"></label><label><span>Impuesto %</span><input data-field="impuesto" type="number" min="0" max="100" step="0.001" value="${esc(l.impuesto)}"></label></div><div class="qe-line-foot"><span>Referencia: ${format(l.precio_sugerido||l.precio)}</span><strong data-line-total>${format((Number(l.cantidad||0)*Number(l.precio||0)-Number(l.descuento||0))*(1+Number(l.impuesto||0)/100))}</strong></div></div>`).join('');totals();icon();
  }
  function paintCatalog(){
    const q=norm($('#qeSearch').value);
    const filtered=catalog.filter(x=>norm(x.nombre+' '+x.codigo+' '+x.categoria).indexOf(q)>=0);
    $('#qeCatalog').innerHTML=filtered.length?filtered.slice(0,150).map(x=>`<div class="qe-catalog-item"><div><strong>${esc(x.nombre)}</strong><small>${esc(x.codigo||x.categoria||'Servicio')}</small><b>${Number(x.precio)>0?format(x.precio):'Sin precio base'}</b></div><button type="button" data-catalog-id="${esc(x.id)}" aria-label="Agregar ${esc(x.nombre)}"><i data-lucide="plus"></i></button></div>`).join(''):'<p class="qe-catalog-empty">No hay trabajos con ese nombre. Puedes crearlo abajo.</p>';
    icon();
  }
  function addCatalog(item){
    const line={catalog_id:item.id,concepto_id:item.concepto_id||null,catalog_name:item.nombre,
      descripcion:item.descripcion||item.nombre,cantidad:1,tipo_articulo:item.tipo_articulo||(/^(unidad|pieza)$/i.test(String(item.unidad||'').trim())?'BIEN':'SERVICIO'),
      precio:Number(item.precio||0),precio_sugerido:Number(item.precio||0),descuento:0,impuesto:0};
    if(lines.length===1&&!String(lines[0].descripcion||'').trim())lines[0]=line;else lines.push(line);
    paintLines();showToast('Servicio agregado a la cotización.');
  }
  $('#qeBack').onclick=()=>navigate('cotizaciones',{force:true});
  $('#qeAddBlank').onclick=()=>{if(lines.length>=100)return showToast('Máximo 100 servicios.','error');lines.push(fresh());paintLines();};
  $('#qeSearch').oninput=paintCatalog;
  $('#qeCatalog').onclick=e=>{const btn=e.target.closest('[data-catalog-id]');if(!btn)return;const item=catalog.find(x=>String(x.id)===btn.dataset.catalogId);if(item)addCatalog(item);};
  $('#qeAddNew').onclick=()=>{const name=$('#qeNewName').value.trim(),price=Number($('#qeNewPrice').value||0);if(!name)return showToast('Escribe el nombre del servicio.','error');const existing=catalog.find(x=>norm(x.nombre)===norm(name));if(existing){addCatalog(existing);showToast('Este servicio ya estaba en el catálogo; lo seleccioné.');}else{const line={...fresh(),descripcion:name,nombre_nuevo:name,precio:price,precio_sugerido:price};if(lines.length===1&&!lines[0].descripcion.trim())lines[0]=line;else lines.push(line);paintLines();showToast('Servicio preparado. Se creará en el catálogo al guardar.');}$('#qeNewName').value='';$('#qeNewPrice').value='';};
  const showExpiry=()=>{const value=$('#qeExpiry').value;const parts=value.split('-').map(Number),today=dayOffset(0).split('-').map(Number);const days=parts.length===3&&parts.every(Boolean)?Math.round((Date.UTC(...[parts[0],parts[1]-1,parts[2]])-Date.UTC(...[today[0],today[1]-1,today[2]]))/86400000):0;$('#qeExpiryHint').textContent=days>0?`La propuesta vencerá en ${days} día${days===1?'':'s'}.`:'Selecciona una fecha posterior a hoy.';content.querySelectorAll('[data-expiry-days]').forEach(button=>{const active=dayOffset(Number(button.dataset.expiryDays))===value;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});};
  $('#qeExpiry').oninput=showExpiry;
  $('#qeExpiry').onchange=showExpiry;
  $('#qeOpenCalendar').onclick=()=>{const field=$('#qeExpiry');try{if(field.showPicker)field.showPicker();else field.focus();}catch(_){field.focus();}};
  content.querySelector('.qe-date-presets').onclick=e=>{const button=e.target.closest('[data-expiry-days]');if(!button)return;$('#qeExpiry').value=dayOffset(Number(button.dataset.expiryDays));showExpiry();};
  const syncPayment=()=>{const custom=$('#qePayment').value==='__otra__';$('#qePaymentOther').hidden=!custom;$('#qePaymentOther').required=custom;};
  $('#qePayment').onchange=syncPayment;
  $('#qeLines').oninput=e=>{const row=e.target.closest('[data-line]'),key=e.target.dataset.field;if(!row||!key)return;const i=Number(row.dataset.line);lines[i][key]=e.target.value;totals();const l=lines[i],value=(Number(l.cantidad||0)*Number(l.precio||0)-Number(l.descuento||0))*(1+Number(l.impuesto||0)/100);row.querySelector('[data-line-total]').textContent=format(value);};
  $('#qeLines').onchange=e=>{if(e.target.dataset.field!=='tipo_articulo')return;const row=e.target.closest('[data-line]');if(row)lines[Number(row.dataset.line)].tipo_articulo=e.target.value;};
  $('#qeLines').onclick=e=>{const btn=e.target.closest('[data-remove]');if(!btn)return;lines.splice(Number(btn.dataset.remove),1);paintLines();};
  const siteLabel=s=>`${s.nombre||'Sede'}${s.codigo?' · '+s.codigo:''} (#${s.id})`;
  const siteSearch=$('#qeSiteSearch'),siteToggle=$('#qeSiteToggle'),siteOptions=$('#qeSiteOptions');
  let visibleSites=[],activeSiteIndex=-1;
  function closeSiteOptions(){siteOptions.hidden=true;siteSearch.setAttribute('aria-expanded','false');siteSearch.removeAttribute('aria-activedescendant');activeSiteIndex=-1;}
  function paintSiteOptions(showAll=false){
    const term=showAll?'':norm(siteSearch.value);
    visibleSites=sites.filter(s=>norm([s.nombre,s.codigo,s.direccion,s.id].join(' ')).includes(term)).slice(0,60);
    siteOptions.innerHTML=visibleSites.length?visibleSites.map((s,i)=>`<button type="button" class="qe-site-option" role="option" id="qeSiteOption${i}" data-site-id="${esc(s.id)}" aria-selected="${String($('#qeSiteId').value)===String(s.id)}"><strong>${esc(s.nombre||'Sede')}</strong><small>${esc([s.codigo,s.direccion].filter(Boolean).join(' · ')||'Sede #'+s.id)}</small></button>`).join(''):'<div class="qe-site-empty">No hay sedes con esa búsqueda.</div>';
    activeSiteIndex=-1;siteSearch.removeAttribute('aria-activedescendant');
  }
  function openSiteOptions(showAll=false){if(siteSearch.disabled)return;paintSiteOptions(showAll);siteOptions.hidden=false;siteSearch.setAttribute('aria-expanded','true');}
  function selectSite(site){if(!site)return;siteSearch.value=siteLabel(site);$('#qeSiteId').value=String(site.id);closeSiteOptions();siteSearch.focus();}
  function moveSiteSelection(step){
    const buttons=[...siteOptions.querySelectorAll('[data-site-id]')];if(!buttons.length)return;
    activeSiteIndex=(activeSiteIndex+step+buttons.length)%buttons.length;
    buttons.forEach((button,index)=>button.classList.toggle('is-active',index===activeSiteIndex));
    siteSearch.setAttribute('aria-activedescendant',buttons[activeSiteIndex].id);
    buttons[activeSiteIndex].scrollIntoView({block:'nearest'});
  }
  async function refreshSites(){
    const seq=++siteRequest,clientId=$('#qeClient').value,order=$('#qeOrder').value;
    const hint=$('#qeSiteHint');
    closeSiteOptions();sites=[];visibleSites=[];$('#qeSiteId').value='';siteSearch.value='';siteSearch.disabled=true;siteToggle.disabled=true;
    if(order){siteSearch.value=old?.item?.sede||'Asignada por la OT del sistema';hint.textContent='La sede se toma automáticamente de la OT seleccionada.';return;}
    if(!clientId||clientId==='__nuevo__'){hint.textContent='Selecciona un cliente registrado para buscar sus sedes.';return;}
    hint.textContent='Cargando sedes…';
    try{
      const result=await api('/api/clientes/'+encodeURIComponent(clientId)+'/sedes',{seCache:'reload'});
      if(seq!==siteRequest)return;
      sites=(result.items||[]).filter(s=>s.activo!==false&&s.activo!==0);
      siteSearch.disabled=false;siteToggle.disabled=false;
      hint.textContent=sites.length?'Busca por nombre o código y elige una sede del menú.':'Este cliente aún no tiene sedes registradas.';
      const previous=sites.find(s=>String(s.id)===String(old?.item?.sede_id||''));
      if(previous){siteSearch.value=siteLabel(previous);$('#qeSiteId').value=String(previous.id);}
    }catch(err){if(seq===siteRequest)hint.textContent='No se pudieron cargar las sedes: '+err.message;}
  }
  siteSearch.onfocus=()=>openSiteOptions(true);
  siteSearch.oninput=()=>{$('#qeSiteId').value='';openSiteOptions();};
  siteSearch.onkeydown=e=>{
    if(e.key==='Escape'){closeSiteOptions();return;}
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();if(siteOptions.hidden)openSiteOptions(true);moveSiteSelection(e.key==='ArrowDown'?1:-1);return;}
    if(e.key==='Enter'&&!siteOptions.hidden&&visibleSites.length){e.preventDefault();selectSite(visibleSites[activeSiteIndex>=0?activeSiteIndex:0]);}
  };
  siteToggle.onclick=()=>{if(siteOptions.hidden){openSiteOptions(true);siteSearch.focus();}else closeSiteOptions();};
  siteOptions.onclick=e=>{const option=e.target.closest('[data-site-id]');if(option)selectSite(sites.find(s=>String(s.id)===option.dataset.siteId));};
  form.addEventListener('pointerdown',e=>{if(!$('#qeSitePicker').contains(e.target))closeSiteOptions();});
  const syncGuest=()=>{const guest=$('#qeClient').value==='__nuevo__'&&!$('#qeOrder').value;$('#qeGuestFields').hidden=!guest;$('#qeGuestName').required=guest;content.querySelectorAll('.qe-send-label').forEach(label=>label.textContent=guest?'Guardar y preparar PDF':'Guardar y enviar');$('#qeSendHint').textContent=guest?'Este cliente no tiene portal. Al guardar, podrás descargar o compartir el PDF.':'Guarda como borrador para revisarla o envíala al cliente y luego descarga el PDF.';};
  const syncOrderDetails=()=>{const noSystemOrder=!$('#qeOrder').value;$('#qeOrderDetails').hidden=!noSystemOrder;$('#qePhysicalOrder').disabled=!noSystemOrder;$('#qeSiteRequired').hidden=!noSystemOrder||$('#qeClient').value==='__nuevo__';};
  $('#qeClient').onchange=()=>{syncGuest();syncOrderDetails();refreshSites();};
  $('#qeOrder').onchange=()=>{const order=orders.find(x=>String(x.id)===$('#qeOrder').value);if(order){const client=activeClients.find(x=>String(x.id)===String(order.cliente_id))||activeClients.find(x=>norm(x.nombre)===norm(order.cliente));if(client)$('#qeClient').value=String(client.id);$('#qeClient').required=false;$('#qeClient').disabled=true;}else{$('#qeClient').disabled=!!quoteId;$('#qeClient').required=!quoteId;}syncGuest();syncOrderDetails();refreshSites();};
  $('#qeOrder').dispatchEvent(new Event('change'));
  showExpiry();syncPayment();
  form.addEventListener('click',e=>{const button=e.target.closest('[data-save-mode]');if(button)form.dataset.intent=button.dataset.saveMode;});
  form.addEventListener('submit',async e=>{
    e.preventDefault();if(form.dataset.saving)return;
    const data=Object.fromEntries(new FormData(form).entries());
    if(!quoteId&&!data.orden_id&&!data.cliente_id)return showToast('Selecciona un cliente o crea uno nuevo para esta cotización.','error');
    if(!quoteId&&!data.orden_id&&data.cliente_id==='__nuevo__'&&!String(data.prospecto_nombre||'').trim())return showToast('Escribe el nombre del nuevo cliente.','error');
    if(!data.orden_id&&!quoteId&&data.cliente_id!=='__nuevo__'&&!data.sede_id)return showToast('Selecciona una sede existente para esta cotización.','error');
    if(!$('#qeOrder').value&&$('#qeClient').value!=='__nuevo__'&&!$('#qeSiteId').value)return showToast('Busca y selecciona una sede existente. No puede quedar vacía.','error');
    if($('#qeSiteSearch').value.trim()&&!$('#qeSiteSearch').disabled&&!$('#qeSiteId').value)return showToast('Selecciona una sede de la lista.','error');
    if(data.condicion_pago_opcion==='__otra__'&&!String(data.condicion_pago_personalizada||'').trim())return showToast('Especifica la forma de pago.','error');
    if(!lines.length||lines.some(l=>!String(l.descripcion||'').trim()))return showToast('Completa la descripción de cada servicio.','error');
    if(lines.some(l=>!['BIEN','SERVICIO'].includes(String(l.tipo_articulo||'').toUpperCase())))return showToast('Selecciona Bien o Servicio en cada renglón.','error');
    const sendNow=(e.submitter?.dataset.saveMode||form.dataset.intent||'send')==='send';
    form.dataset.saving='1';form.querySelectorAll('[type="submit"]').forEach(b=>b.disabled=true);
    try{
      for(const line of lines){
        if(line.catalog_id)continue;
        const name=String(line.nombre_nuevo||line.descripcion||'').trim().split('\n')[0].trim();
        let item=catalog.find(x=>norm(x.nombre)===norm(name));
        if(!item){
          try{item=(await api('/api/catalogo-maestro',{method:'POST',body:{nombre:name,precio:line.precio,categoria:'General',tipo_articulo:line.tipo_articulo,unidad:line.tipo_articulo==='BIEN'?'unidad':'servicio',descripcion:line.descripcion||name,activo:true}})).item;catalog.push(item);}
          catch(err){catalog=await pages('/api/catalogo-maestro?solo_activos=1');item=catalog.find(x=>norm(x.nombre)===norm(name));if(!item)throw err;}
        }
        line.catalog_id=item.id;line.concepto_id=item.concepto_id||null;line.precio_sugerido=Number(item.precio||0);
      }
      const body={orden_id:quoteId?orderId:(data.orden_id||null),cliente_id:data.cliente_id==='__nuevo__'?null:(data.cliente_id||old?.item?.cliente_id||null),
        prospecto_nombre:data.cliente_id==='__nuevo__'?data.prospecto_nombre.trim():null,
        prospecto_correo:data.cliente_id==='__nuevo__'?(data.prospecto_correo||null):null,
        prospecto_telefono:data.cliente_id==='__nuevo__'?(data.prospecto_telefono||null):null,
        nombre:data.nombre||'Cotización de servicio',sede_id:data.sede_id||null,
        orden_fisica_numero:data.orden_fisica_numero||null,fecha_vencimiento:data.fecha_vencimiento,
        condicion_pago:data.condicion_pago_opcion==='__otra__'?data.condicion_pago_personalizada.trim():(data.condicion_pago_opcion||'Efectivo'),motivo:data.motivo||'',
        lineas:lines.map(l=>({concepto_id:l.concepto_id||null,descripcion:l.descripcion,cantidad:l.cantidad,
          tipo_articulo:l.tipo_articulo,unidad:l.tipo_articulo==='BIEN'?'unidad':'servicio',precio:l.precio,precio_sugerido:l.precio_sugerido||l.precio,
          descuento:l.descuento,impuesto:l.impuesto,observaciones:l.observaciones||'',motivo:l.motivo||''}))};
      const saved=await api(quoteId?'/api/cotizaciones/'+quoteId+'/versiones':'/api/cotizaciones',{method:'POST',body});
      const id=quoteId||saved.item?.id;
      let sent=false;
      if(sendNow&&data.cliente_id!=='__nuevo__') {
        try{await api('/api/cotizaciones/'+id+'/enviar',{method:'POST',body:{}});sent=true;}
        catch(err){showToast('Se guardó como borrador, pero no se pudo enviar: '+err.message,'error');}
      }
      const readyToShare=sendNow&&(sent||data.cliente_id==='__nuevo__');
      setHeading('Cotización '+(sent?'enviada':'guardada'),'La propuesta quedó registrada en el sistema.');
      content.innerHTML=`<section class="qe-success"><span class="qe-success-icon"><i data-lucide="circle-check-big"></i></span><h2>${sent?'Cotización enviada':readyToShare?'Cotización lista para compartir':'Cotización guardada'}</h2><p>${sent?'El cliente ya puede consultar la propuesta en su portal.':readyToShare?'Descarga o comparte el PDF con este cliente.':'Quedó como borrador; podrás enviarla desde el módulo.'}</p><div class="qe-success-actions">${readyToShare?`<a class="btn primary" href="/api/cotizaciones/${id}/pdf" download><i data-lucide="download"></i> Descargar PDF</a><button class="btn" type="button" id="qeShare"><i data-lucide="share-2"></i> Compartir</button>`:''}<button class="btn" type="button" id="qeReturn"><i data-lucide="arrow-left"></i> Volver a cotizaciones</button></div></section>`;
      $('#qeReturn').onclick=()=>navigate('cotizaciones',{force:true});
      if($('#qeShare'))$('#qeShare').onclick=()=>window.SepriguaShareQuote(id,$('#qeShare'),showToast);
      icon();
    }catch(err){showToast(err.message||'No se pudo guardar la cotización.','error');}
    finally{delete form.dataset.saving;form.querySelectorAll('[type="submit"]').forEach(b=>b.disabled=false);}
  });
  paintLines();paintCatalog();
};
