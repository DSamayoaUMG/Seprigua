/* SEPRIGUA · Elementos visuales de filtros y estados.
 * Conserva los <select> originales y sus eventos; no realiza consultas ni cambia reglas.
 */
(() => {
  'use strict';
  const FILTER_ROOTS = '.solicitudes-filter-panel, .orders-filters, .people-filter-section, .quotes-filters, .smart-list-tools, .clients-filter-modern, .user-filter-grid, .catalog-toolbar, .warranty-filter-panel';
  let opened = null;
  let updateScheduled = false;
  let menu = null;
  const isSmall = () => window.matchMedia('(max-width: 820px)').matches;
  function hideMenu() {
    if (!menu) return;
    menu.remove();
    menu = null;
    if (opened) { opened.button.setAttribute('aria-expanded','false'); opened = null; }
  }
  function onOptionPress(select, option) {
    select.value = option.value;
    select.dispatchEvent(new Event('change', {bubbles:true}));
    hideMenu();
  }
  function showMenu(instance) {
    if (isSmall()) { instance.select.focus(); instance.select.click(); return; }
    if (opened?.select === instance.select) { hideMenu(); return; }
    hideMenu();
    const {select,button} = instance;
    const rect = button.getBoundingClientRect();
    const width = Math.max(184,rect.width);
    const maxHeight = Math.min(300,Math.max(140,window.innerHeight * .42));
    const left = Math.max(8,Math.min(rect.left,window.innerWidth - width - 8));
    const bottomRoom = window.innerHeight - rect.bottom - 12;
    const top = bottomRoom < Math.min(240,maxHeight) && rect.top > bottomRoom ? Math.max(8,rect.top - maxHeight - 5) : rect.bottom + 6;
    const list = document.createElement('div');
    list.className='se-enterprise-options';
    list.setAttribute('role','listbox');
    list.setAttribute('aria-label',select.getAttribute('aria-label') || select.closest('.field')?.querySelector('label')?.textContent.trim() || 'Opciones');
    Object.assign(list.style,{position:'fixed',zIndex:'20000',top:`${top}px`,left:`${left}px`,width:`${width}px`,maxHeight:`${maxHeight}px`});
    [...select.options].forEach(opt => {
      if (opt.hidden) return;
      const row=document.createElement('button');
      row.type='button';
      row.className='se-enterprise-option';
      row.setAttribute('role','option');
      row.setAttribute('aria-selected',String(opt.selected));
      row.textContent=opt.textContent.trim();
      row.disabled=opt.disabled;
      row.addEventListener('click',() => onOptionPress(select,opt));
      list.appendChild(row);
    });
    document.body.appendChild(list);
    menu=list;
    opened=instance;
    button.setAttribute('aria-expanded','true');
    (list.querySelector('[aria-selected="true"]') || list.querySelector('button:not([disabled])'))?.scrollIntoView({block:'nearest'});
  }
  function enhanceOne(select) {
    if (select.dataset.seEnterprise === '1') return;
    select.dataset.seEnterprise='1';
    const wrapper=document.createElement('span');
    wrapper.className='se-enterprise-select';
    select.parentNode.insertBefore(wrapper,select);
    wrapper.appendChild(select);
    const button=document.createElement('button');
    button.type='button';
    button.className='se-enterprise-select-button';
    button.setAttribute('aria-haspopup','listbox');
    button.setAttribute('aria-expanded','false');
    const label=document.createElement('span');
    label.className='se-enterprise-select-label';
    const arrow=document.createElement('span');
    arrow.className='se-enterprise-select-arrow';
    arrow.textContent='⌄';
    button.append(label,arrow);
    wrapper.appendChild(button);
    const sync=() => {
      label.textContent=select.selectedOptions[0]?.textContent.trim() || 'Seleccionar';
      const fieldName=select.closest('.field, .solicitudes-filter-field, .orders-filter-field, .people-field')?.querySelector('label')?.textContent.trim() || 'Filtro';
      button.setAttribute('aria-label',`${fieldName}: ${label.textContent}`);
      button.disabled=select.disabled;
    };
    sync();
    button.addEventListener('click',() => showMenu({select,button}));
    button.addEventListener('keydown',ev => {
      if(['ArrowDown','ArrowUp','Enter',' '].includes(ev.key)) {ev.preventDefault();showMenu({select,button});}
    });
    select.addEventListener('change',sync);
  }
  function harmonizeStateBadges(root) {
    root.querySelectorAll('table').forEach(table=>{
      const heads=[...table.querySelectorAll('thead th')];
      const canvas=document.createElement('canvas');
      const ctx=canvas.getContext('2d');
      if (!ctx) return;
      heads.forEach((head,index)=>{
        if (!/^(estado|prioridad|urgencia|clase|seguimiento|disponibilidad)$/i.test(head.textContent.trim())) return;
        const elems=[...table.querySelectorAll('tbody tr')].map(row=>row.children[index]).filter(Boolean)
          .map(cell=>cell.querySelector('.badge, .request-state-pill, .request-priority-pill, .request-class-pill, .order-status-pill, .order-priority-pill, .request-followup-badge, .people-status, .warranty-state, .quote-state-badge, .quote-status, .user-status, .agenda-status, .people-availability, .availability'))
          .filter(Boolean);
        if (!elems.length) return;
        let widest=98;
        elems.forEach(el=>{
          const style=getComputedStyle(el);
          ctx.font=`${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
          const label=(el.textContent||'').replace(/\s+/g,' ').trim();
          widest=Math.max(widest,Math.ceil(ctx.measureText(label).width)+42);
        });
        widest=Math.min(260,widest);
        elems.forEach(el=>{
          el.style.setProperty('min-width',`${widest}px`);
          el.style.setProperty('box-sizing','border-box');
          el.style.setProperty('justify-content','center');
          el.style.setProperty('white-space','nowrap');
          el.style.setProperty('text-align','center');
        });
      });
    });
  }
  function apply() {
    updateScheduled=false;
    const host=document.getElementById('appContent');
    if (!host) return;
    host.querySelectorAll(`${FILTER_ROOTS.split(', ').map(parent=>`${parent} select`).join(', ')}`).forEach(enhanceOne);
    harmonizeStateBadges(host);
  }
  function requestUpdate() {
    if (updateScheduled) return;
    updateScheduled=true;
    requestAnimationFrame(apply);
  }
  document.addEventListener('click', ev=>{
    if (menu && !ev.target.closest('.se-enterprise-options, .se-enterprise-select-button')) hideMenu();
  },true);
  document.addEventListener('keydown',ev=>{
    if (!menu) return;
    if (ev.key==='Escape') {hideMenu();opened?.button?.focus();}
    const options=[...menu.querySelectorAll('button:not([disabled])')];
    if (!options.length) return;
    if (['ArrowDown','ArrowUp'].includes(ev.key)) {
      ev.preventDefault();
      const idx=options.indexOf(document.activeElement);
      const next=ev.key==='ArrowDown' ? (idx+1)%options.length : (idx-1+options.length)%options.length;
      options[next].focus();
    }
  });
  document.addEventListener('scroll',ev=>{
    if (menu && !menu.contains(ev.target)) hideMenu();
  },true);
  window.addEventListener('resize',hideMenu);
  const start=()=>{
    const host=document.getElementById('appContent');
    if (!host) return;
    new MutationObserver(requestUpdate).observe(host,{childList:true,subtree:true});
    requestUpdate();
  };
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',start,{once:true}); else start();
})();
