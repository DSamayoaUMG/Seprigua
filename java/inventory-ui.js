/* Inventario: el resguardo habitual y el estado operativo son datos distintos. */
window.SepriguaInventoryUI = function(c){
  const {api,state,esc,fmt,badge,button,table,showToast,setHeading,content,navigate}=c;
  const $=selector=>document.querySelector(selector);
  const title=x=>String(x||'').replace(/_/g,' ');
  const location=x=>x.ResguardoTipo==='VEHICULO'
    ? `Vehículo · ${x.VehiculoCodigo||''} · ${x.VehiculoNombre||''}`
    : x.ResguardoTipo==='BODEGA' ? `Bodega · ${x.BodegaNombre||''}` : (x.UbicacionGeneral||'Sin resguardo definido');
  const icons=()=>window.lucide?.createIcons();
  const header=(eyebrow,heading,description,actions='')=>`<section class="inventory-page-head"><div><span class="inventory-eyebrow">${esc(eyebrow)}</span><h2>${esc(heading)}</h2><p>${esc(description)}</p></div><div class="inventory-head-actions">${actions}</div></section>`;
  const back=()=>`<button class="btn" type="button" data-action="volver-inventario"><i data-lucide="arrow-left"></i> Volver al inventario</button>`;

  async function vehicles(){
    return (await api('/api/inventario/vehiculos',{seCache:'reload'})).items||[];
  }

  function vehicleOptions(items,selected){
    return `<option value="">Selecciona un vehículo</option>${items.filter(x=>x.activo||String(x.id)===String(selected)).map(x=>`<option value="${esc(x.id)}" ${String(x.id)===String(selected)?'selected':''}>${esc(x.codigo)} · ${esc(x.nombre)}${x.placa?` · ${esc(x.placa)}`:''}</option>`).join('')}`;
  }

  async function form(id='',focusLocation=false){
    const editing=Boolean(id),[fleet,detail]=await Promise.all([vehicles(),editing?api(`/api/equipos/${id}`,{seCache:'reload'}):Promise.resolve(null)]);
    const x=detail?.item||{};
    if(editing&&!x.EquipoId)throw new Error('Equipo no encontrado.');
    setHeading(editing?'Editar equipo':'Registrar equipo','Inventario técnico y resguardo habitual.');
    const selectedType=x.ResguardoTipo||'';
    const selectedVehicle=x.VehiculoId||'';
    const bodega=x.BodegaNombre||'';
    content.innerHTML=`${header(editing?'INVENTARIO · EDICIÓN':'INVENTARIO · NUEVO REGISTRO',editing?'Editar equipo':'Registrar equipo','Registra dónde permanece habitualmente el equipo. Su estado operativo se administra por separado.',back())}
      <form id="inventoryEquipmentForm" class="inventory-form" autocomplete="off">
        <section class="inventory-form-card"><div class="inventory-card-heading"><span><i data-lucide="scan-barcode"></i></span><div><h3>Identificación</h3><p>Datos para encontrar el equipo en el inventario.</p></div></div>
          <div class="inventory-form-grid">
            <label>Código del equipo <em>*</em><input name="codigo" maxlength="30" required value="${esc(x.CodigoEquipo||'')}" placeholder="Ej. EQ-001"></label>
            <label>Nombre del equipo <em>*</em><input name="nombre" maxlength="160" required value="${esc(x.Nombre||'')}" placeholder="Ej. Hidrolavadora industrial"></label>
            <label>Categoría<input name="categoria" maxlength="100" value="${esc(x.Categoria||'')}" placeholder="Herramienta, bomba, cámara..."></label>
            <label>Marca<input name="marca" maxlength="100" value="${esc(x.Marca||'')}"></label>
            <label>Modelo<input name="modelo" maxlength="100" value="${esc(x.Modelo||'')}"></label>
            <label>Número de serie<input name="serie" maxlength="120" value="${esc(x.NumeroSerie||'')}"></label>
            <label>Fecha de adquisición<input type="date" name="fecha_adquisicion" value="${esc(String(x.FechaAdquisicion||'').slice(0,10))}"></label>
            ${editing?`<label>Registro<select name="activo"><option value="true" ${x.Activo?'selected':''}>Activo</option><option value="false" ${!x.Activo?'selected':''}>Inactivo</option></select></label>`:`<label>Estado inicial<select name="estado"><option value="DISPONIBLE">Disponible</option><option value="FUERA_DE_USO">Fuera de uso</option><option value="RETIRADO">Retirado</option></select></label>`}
          </div>
        </section>
        <section class="inventory-form-card" id="inventoryLocationCard"><div class="inventory-card-heading"><span><i data-lucide="map-pin-house"></i></span><div><h3>Resguardo habitual <em>*</em></h3><p>La bodega o el vehículo donde normalmente permanece. Usarlo en una OT no cambia este dato.</p></div></div>
          <div class="inventory-location-choices" role="group" aria-label="Tipo de resguardo">
            <label class="inventory-location-choice"><input type="radio" name="resguardo_tipo" value="BODEGA" ${selectedType==='BODEGA'?'checked':''} required><i data-lucide="warehouse"></i><span><strong>En bodega</strong><small>Equipo guardado en una ubicación fija.</small></span></label>
            <label class="inventory-location-choice"><input type="radio" name="resguardo_tipo" value="VEHICULO" ${selectedType==='VEHICULO'?'checked':''} required><i data-lucide="truck"></i><span><strong>En vehículo</strong><small>Equipo que permanece en una unidad de la flota.</small></span></label>
          </div>
          ${!selectedType&&editing?`<p class="inventory-legacy-note">Ubicación anterior: ${esc(x.UbicacionGeneral||'Sin especificar')}. Selecciona el resguardo habitual para actualizarla.</p>`:''}
          <div class="inventory-location-fields" data-location="BODEGA" hidden><label>Nombre de la bodega <em>*</em><input name="bodega" maxlength="120" value="${esc(bodega)}" placeholder="Ej. Bodega central"></label></div>
          <div class="inventory-location-fields" data-location="VEHICULO" hidden><label>Vehículo asignado <em>*</em><select name="vehiculo_id">${vehicleOptions(fleet,selectedVehicle)}</select></label><button class="btn" type="button" data-action="mostrar-nuevo-vehiculo"><i data-lucide="plus"></i> Registrar vehículo aquí</button></div>
          <div class="inventory-inline-vehicle" id="inventoryInlineVehicle" hidden><h4>Nuevo vehículo</h4><div class="inventory-form-grid"><label>Código <input name="nuevo_vehiculo_codigo" maxlength="30" placeholder="Ej. VEH-01"></label><label>Nombre <input name="nuevo_vehiculo_nombre" maxlength="120" placeholder="Ej. Pickup de servicio"></label><label>Placa <input name="nuevo_vehiculo_placa" maxlength="25" placeholder="Opcional"></label></div><button class="btn" type="button" data-action="guardar-vehiculo-en-equipo">Guardar vehículo y seleccionarlo</button></div>
        </section>
        <section class="inventory-form-card"><div class="inventory-card-heading"><span><i data-lucide="notebook-pen"></i></span><div><h3>Notas internas</h3><p>Características, accesorios o instrucciones para el equipo.</p></div></div><label class="inventory-full-field">Descripción<textarea name="descripcion" maxlength="700" rows="4" placeholder="Opcional">${esc(x.Descripcion||'')}</textarea></label></section>
        <div class="inventory-form-footer">${back()}<button class="btn primary" type="submit"><i data-lucide="save"></i> ${editing?'Guardar cambios':'Registrar equipo'}</button></div>
      </form>`;
    const node=$('#inventoryEquipmentForm');
    const syncLocation=()=>{
      const type=node.querySelector('[name="resguardo_tipo"]:checked')?.value||'';
      node.querySelectorAll('.inventory-location-choice').forEach(choice=>choice.classList.toggle('selected',choice.querySelector('input')?.checked));
      node.querySelectorAll('[data-location]').forEach(block=>{
        const active=block.dataset.location===type;block.hidden=!active;
        block.querySelectorAll('input,select').forEach(field=>{field.disabled=!active;field.required=active&&['bodega','vehiculo_id'].includes(field.name);});
      });
      if(type!=='VEHICULO')$('#inventoryInlineVehicle').hidden=true;
    };
    node.querySelectorAll('[name="resguardo_tipo"]').forEach(radio=>radio.addEventListener('change',syncLocation));syncLocation();
    node.addEventListener('submit',async e=>{
      e.preventDefault();if(node.dataset.saving)return;
      const data=Object.fromEntries(new FormData(node).entries());
      delete data.nuevo_vehiculo_codigo;delete data.nuevo_vehiculo_nombre;delete data.nuevo_vehiculo_placa;
      if(!data.resguardo_tipo)return showToast('Selecciona bodega o vehículo.','error');
      if(editing)data.activo=data.activo==='true';
      node.dataset.saving='1';const submit=node.querySelector('[type="submit"]');submit.disabled=true;
      try{await api(editing?`/api/equipos/${id}`:'/api/equipos',{method:editing?'PATCH':'POST',body:data});showToast(editing?'Equipo actualizado.':'Equipo registrado.');await navigate('equipos',{force:true});}
      catch(error){showToast(error.message,'error');}
      finally{delete node.dataset.saving;if(submit.isConnected)submit.disabled=false;}
    });
    icons();
    if(focusLocation)$('#inventoryLocationCard')?.scrollIntoView({behavior:'smooth',block:'start'});
  }

  async function createVehicleInline(){
    const block=$('#inventoryInlineVehicle'),form=$('#inventoryEquipmentForm');
    if(!block||!form)return;
    const codigo=block.querySelector('[name="nuevo_vehiculo_codigo"]').value.trim();
    const nombre=block.querySelector('[name="nuevo_vehiculo_nombre"]').value.trim();
    const placa=block.querySelector('[name="nuevo_vehiculo_placa"]').value.trim();
    if(!codigo||!nombre)return showToast('Completa código y nombre del vehículo.','error');
    const save=block.querySelector('button');save.disabled=true;
    try{
      const result=await api('/api/inventario/vehiculos',{method:'POST',body:{codigo,nombre,placa}});
      const select=form.querySelector('[name="vehiculo_id"]');select.innerHTML=vehicleOptions(await vehicles(),result.item?.id||'');
      block.hidden=true;showToast('Vehículo registrado y seleccionado.');
    }catch(error){showToast(error.message,'error');}
    finally{save.disabled=false;}
  }

  async function vehicleList(){
    const items=await vehicles();setHeading('Vehículos de inventario','Resguardo habitual de equipos en la flota.');
    const actions=`${back()}${state.role==='COORDINADOR'?`<button class="btn primary" type="button" data-action="nuevo-vehiculo"><i data-lucide="plus"></i> Registrar vehículo</button>`:''}`;
    content.innerHTML=`${header('INVENTARIO · FLOTA','Vehículos de inventario','Registra las unidades donde permanecen equipos. La cantidad indica su resguardo habitual, aunque un equipo esté temporalmente en un trabajo.',actions)}
      <section class="inventory-vehicle-grid">${items.length?items.map(x=>`<article class="inventory-vehicle-card ${x.activo?'':'is-inactive'}"><span class="inventory-vehicle-icon"><i data-lucide="truck"></i></span><div><small>${esc(x.codigo)}</small><h3>${esc(x.nombre)}</h3><p>${x.placa?`Placa ${esc(x.placa)}`:'Sin placa registrada'}</p></div><div class="inventory-vehicle-foot"><span>${x.equipos||0} equipo(s) · ${x.activo?'Activo':'Inactivo'}</span>${state.role==='COORDINADOR'?`<button class="btn" type="button" data-action="editar-vehiculo" data-id="${esc(x.id)}"><i data-lucide="pencil"></i> Editar</button>`:''}</div></article>`).join(''):'<div class="inventory-empty"><i data-lucide="truck"></i><h3>Aún no hay vehículos</h3><p>Registra el primero para asignarle equipos.</p></div>'}</section>`;
    icons();
  }

  async function vehicleForm(id=''){
    const editing=Boolean(id),x=editing?(await vehicles()).find(v=>String(v.id)===String(id)):null;
    if(editing&&!x)throw new Error('Vehículo no encontrado.');
    setHeading(editing?'Editar vehículo':'Registrar vehículo','Flota del inventario técnico.');
    content.innerHTML=`${header('INVENTARIO · FLOTA',editing?'Editar vehículo':'Registrar vehículo','La asignación habitual de equipos se hace desde la ficha de cada equipo.',`<button class="btn" type="button" data-action="ver-vehiculos"><i data-lucide="arrow-left"></i> Volver a vehículos</button>`)}
      <form class="inventory-form inventory-vehicle-form" id="inventoryVehicleForm"><section class="inventory-form-card"><div class="inventory-card-heading"><span><i data-lucide="truck"></i></span><div><h3>Identificación del vehículo</h3><p>Usa un código reconocible por tu equipo.</p></div></div><div class="inventory-form-grid"><label>Código <em>*</em><input name="codigo" maxlength="30" required value="${esc(x?.codigo||'')}" placeholder="Ej. VEH-01"></label><label>Nombre <em>*</em><input name="nombre" maxlength="120" required value="${esc(x?.nombre||'')}" placeholder="Ej. Pickup de servicio"></label><label>Placa<input name="placa" maxlength="25" value="${esc(x?.placa||'')}" placeholder="Opcional"></label>${editing?`<label>Estado<select name="activo"><option value="true" ${x.activo?'selected':''}>Activo</option><option value="false" ${!x.activo?'selected':''}>Inactivo</option></select></label>`:''}</div>${editing&&x.equipos?`<p class="inventory-legacy-note">${x.equipos} equipo(s) tienen este vehículo como resguardo habitual. Trasládalos antes de desactivarlo.</p>`:''}</section><div class="inventory-form-footer"><button class="btn" type="button" data-action="ver-vehiculos">Cancelar</button><button class="btn primary" type="submit"><i data-lucide="save"></i> Guardar vehículo</button></div></form>`;
    const node=$('#inventoryVehicleForm');node.addEventListener('submit',async e=>{
      e.preventDefault();if(node.dataset.saving)return;node.dataset.saving='1';const submit=node.querySelector('[type="submit"]');submit.disabled=true;
      const data=Object.fromEntries(new FormData(node).entries());if(editing)data.activo=data.activo==='true';
      try{await api(editing?`/api/inventario/vehiculos/${id}`:'/api/inventario/vehiculos',{method:editing?'PATCH':'POST',body:data});showToast('Vehículo guardado.');await vehicleList();}
      catch(error){showToast(error.message,'error');}finally{delete node.dataset.saving;if(submit.isConnected)submit.disabled=false;}
    });icons();
  }

  function detail(id,d){
    const x=d.item||{};setHeading(x.Nombre||'Equipo','Ficha del inventario técnico.');
    const current=location(x);
    const uses=d.usos||[],activeUse=uses.find(u=>!u.devuelto);
    const fields=[['Código',x.CodigoEquipo],['Categoría',x.Categoria],['Marca',x.Marca],['Modelo',x.Modelo],['Número de serie',x.NumeroSerie],['Fecha de adquisición',x.FechaAdquisicion?fmt(x.FechaAdquisicion):null]];
    const actions=`${back()}${state.role==='COORDINADOR'?`<button class="btn primary" type="button" data-action="editar-equipo" data-id="${esc(id)}"><i data-lucide="pencil"></i> Editar equipo</button>`:''}`;
    const failureRows=(d.fallas||[]).map(f=>`<tr><td>${fmt(f.ReportadaEn)}</td><td>${badge(f.Severidad)}</td><td>${esc(f.Descripcion)}</td><td>${badge(f.Estado)}</td><td>${state.role==='COORDINADOR'&&['REPORTADA','DIAGNOSTICO','CORREGIDA'].includes(f.Estado)?button('Gestionar','gestionar-falla',id+':'+f.FallaEquipoId):'—'}</td></tr>`);
    const inspectionRows=(d.inspecciones||[]).map(f=>`<tr><td>${fmt(f.FechaInspeccion)}</td><td>${esc(title(f.Momento))}</td><td>${badge(f.Resultado)}</td><td>${esc(f.DetalleRevision)}</td></tr>`);
    const maintenanceRows=(d.mantenimientos||[]).map(m=>`<tr><td>${esc(title(m.tipo))}</td><td>${badge(m.estado)}</td><td>${fmt(m.fecha)}</td><td>${button('Abrir','detalle-mantenimiento',m.id)}</td></tr>`);
    const useRows=uses.map(u=>`<tr><td>${esc(u.numero_orden)}</td><td>${fmt(u.asignado)}</td><td>${u.devuelto?fmt(u.devuelto):badge('EN USO')}</td><td>${esc(title(u.resultado||'—'))}</td><td>${!u.devuelto&&state.role==='COORDINADOR'?`<button class="btn" type="button" data-action="devolver-equipo" data-id="${esc(id)}" data-uso-id="${esc(u.id)}">Registrar devolución</button>`:'—'}</td></tr>`);
    content.innerHTML=`${header('INVENTARIO · FICHA',x.Nombre||'Equipo',`${x.CodigoEquipo||''} · ${x.Categoria||'Sin categoría'}`,actions)}
      <section class="inventory-detail-overview"><div class="inventory-status-card"><small>ESTADO OPERATIVO</small>${badge(x.Estado||'—')}<p>Indica disponibilidad o mantenimiento. Es independiente del vehículo o la bodega.</p>${state.role==='COORDINADOR'?`<button class="btn" type="button" data-action="estado-equipo" data-id="${esc(id)}">Cambiar estado</button>`:''}</div><div class="inventory-status-card"><small>RESGUARDO HABITUAL</small><strong>${esc(current)}</strong><p>Permanece asignado a esta ubicación hasta que cambies su ficha.</p>${state.role==='COORDINADOR'?`<button class="btn" type="button" data-action="editar-resguardo" data-id="${esc(id)}">Cambiar resguardo</button>`:''}</div></section>
      <section class="inventory-form-card inventory-use-card"><div class="inventory-card-heading"><span><i data-lucide="clipboard-list"></i></span><div><h3>Uso temporal en trabajos</h3><p>Al registrar el uso en una OT, el estado pasa a «Asignado». La bodega o el vehículo habitual no cambia. Al devolverlo, registra cómo regresó.</p></div></div>${activeUse?`<div class="inventory-active-use"><strong>En uso en ${esc(activeUse.numero_orden)}</strong><span>Desde ${fmt(activeUse.asignado)}</span>${state.role==='COORDINADOR'?`<button class="btn primary" type="button" data-action="devolver-equipo" data-id="${esc(id)}" data-uso-id="${esc(activeUse.id)}">Registrar devolución</button>`:''}</div>`:state.role==='COORDINADOR'&&String(x.Estado).toUpperCase()==='DISPONIBLE'?`<button class="btn primary" type="button" data-action="registrar-uso-equipo" data-id="${esc(id)}"><i data-lucide="clipboard-plus"></i> Registrar uso en una OT</button>`:'<p class="muted">El equipo debe estar disponible para registrarlo en un nuevo trabajo.</p>'}${table(['OT','Asignado','Devuelto','Resultado','Acción'],useRows,'Todavía no se ha usado en una OT.')}</section>
      <section class="inventory-form-card"><div class="inventory-card-heading"><span><i data-lucide="list-checks"></i></span><div><h3>Datos del equipo</h3><p>${esc(x.Descripcion||'Sin notas internas.')}</p></div></div><div class="inventory-detail-grid">${fields.map(([label,value])=>`<div><small>${esc(label)}</small><strong>${esc(value||'—')}</strong></div>`).join('')}</div><div class="inventory-detail-actions"><button class="btn" type="button" data-action="inspeccion-equipo" data-id="${esc(id)}">Registrar inspección</button><button class="btn" type="button" data-action="falla-equipo" data-id="${esc(id)}">Reportar falla</button></div></section>
      <section class="inventory-history-grid"><div class="inventory-form-card"><h3>Fallas</h3>${table(['Fecha','Severidad','Descripción','Estado','Acción'],failureRows,'Sin fallas registradas.')}</div><div class="inventory-form-card"><h3>Inspecciones</h3>${table(['Fecha','Momento','Resultado','Detalle'],inspectionRows,'Sin inspecciones registradas.')}</div><div class="inventory-form-card"><h3>Mantenimientos</h3>${table(['Tipo','Estado','Fecha','Acción'],maintenanceRows,'Sin mantenimientos registrados.')}</div></section>`;
    icons();
  }

  async function usageForm(id){
    const [d,available]=await Promise.all([api(`/api/equipos/${id}`,{seCache:'reload'}),api('/api/inventario/ordenes-disponibles',{seCache:'reload'})]);
    const x=d.item||{},orders=available.items||[];
    if(String(x.Estado).toUpperCase()!=='DISPONIBLE')throw new Error('El equipo debe estar disponible para registrar uso.');
    setHeading('Registrar uso de equipo','Asignación temporal a un trabajo.');
    content.innerHTML=`${header('INVENTARIO · USO TEMPORAL','Registrar uso en una OT',`${x.CodigoEquipo||''} · ${x.Nombre||''}`,`<button class="btn" type="button" data-action="detalle-equipo" data-id="${esc(id)}"><i data-lucide="arrow-left"></i> Volver a la ficha</button>`)}
      <form class="inventory-form inventory-vehicle-form" id="inventoryUsageForm"><section class="inventory-form-card"><div class="inventory-card-heading"><span><i data-lucide="clipboard-plus"></i></span><div><h3>Trabajo donde se utilizará</h3><p>El estado cambiará a «Asignado». El resguardo habitual seguirá siendo ${esc(location(x))}.</p></div></div><div class="inventory-form-grid"><label>Orden de trabajo <em>*</em><select name="orden_id" required><option value="">Selecciona una OT activa</option>${orders.map(o=>`<option value="${esc(o.id)}">${esc(o.numero)} · ${esc(o.cliente)} · ${esc(o.estado)}</option>`).join('')}</select></label></div><label class="inventory-full-field">Observaciones<textarea name="observaciones" maxlength="600" rows="3" placeholder="Opcional"></textarea></label>${!orders.length?'<p class="inventory-legacy-note">No hay órdenes activas disponibles.</p>':''}</section><div class="inventory-form-footer"><button class="btn" type="button" data-action="detalle-equipo" data-id="${esc(id)}">Cancelar</button><button class="btn primary" type="submit" ${orders.length?'':'disabled'}>Registrar uso</button></div></form>`;
    const node=$('#inventoryUsageForm');node.addEventListener('submit',async e=>{
      e.preventDefault();if(node.dataset.saving)return;node.dataset.saving='1';const submit=node.querySelector('[type="submit"]');submit.disabled=true;
      try{await api(`/api/equipos/${id}/uso`,{method:'POST',body:Object.fromEntries(new FormData(node).entries())});showToast('Uso registrado. El resguardo habitual no cambió.');detail(id,await api(`/api/equipos/${id}`,{seCache:'reload'}));}
      catch(error){showToast(error.message,'error');}finally{delete node.dataset.saving;if(submit.isConnected)submit.disabled=false;}
    });icons();
  }

  async function returnForm(id,usageId){
    const d=await api(`/api/equipos/${id}`,{seCache:'reload'}),x=d.item||{},usage=(d.usos||[]).find(u=>String(u.id)===String(usageId)&&!u.devuelto);
    if(!usage)throw new Error('Esta asignación ya fue devuelta.');
    setHeading('Devolución de equipo','Cierre de uso temporal en OT.');
    content.innerHTML=`${header('INVENTARIO · DEVOLUCIÓN','Registrar devolución',`${x.CodigoEquipo||''} · ${usage.numero_orden}`,`<button class="btn" type="button" data-action="detalle-equipo" data-id="${esc(id)}"><i data-lucide="arrow-left"></i> Volver a la ficha</button>`)}
      <form class="inventory-form inventory-vehicle-form" id="inventoryReturnForm"><section class="inventory-form-card"><div class="inventory-card-heading"><span><i data-lucide="package-check"></i></span><div><h3>Cómo regresó el equipo</h3><p>Si regresa con falla o daño quedará fuera de uso. Su resguardo habitual sigue siendo ${esc(location(x))}.</p></div></div><div class="inventory-form-grid"><label>Resultado <em>*</em><select name="resultado" required><option value="BUEN_ESTADO">Buen estado · disponible</option><option value="NO_UTILIZADO">No utilizado · disponible</option><option value="CON_FALLA">Con falla · fuera de uso</option><option value="DAÑADO">Dañado · fuera de uso</option></select></label></div><label class="inventory-full-field">Observaciones<textarea name="observaciones" maxlength="600" rows="3" placeholder="Opcional"></textarea></label></section><div class="inventory-form-footer"><button class="btn" type="button" data-action="detalle-equipo" data-id="${esc(id)}">Cancelar</button><button class="btn primary" type="submit">Guardar devolución</button></div></form>`;
    const node=$('#inventoryReturnForm');node.addEventListener('submit',async e=>{
      e.preventDefault();if(node.dataset.saving)return;node.dataset.saving='1';const submit=node.querySelector('[type="submit"]');submit.disabled=true;
      try{await api(`/api/equipos/${id}/usos/${usageId}/devolver`,{method:'POST',body:Object.fromEntries(new FormData(node).entries())});showToast('Devolución registrada.');detail(id,await api(`/api/equipos/${id}`,{seCache:'reload'}));}
      catch(error){showToast(error.message,'error');}finally{delete node.dataset.saving;if(submit.isConnected)submit.disabled=false;}
    });icons();
  }

  return {form,detail,vehicleList,vehicleForm,createVehicleInline,usageForm,returnForm};
};
