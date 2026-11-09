(() => {
  'use strict';
  let storageKey = 'seprigua_cursor_personalizado';
  let enabled = true;
  const root = document.documentElement;

  // cursor:url() no permite animar solo el engranaje. Se conserva la flecha
  // existente y se rota una pequeña pieza superpuesta solo durante la carga.
  const arrowAsset = new Image();
  arrowAsset.src = '/assets/cursors/red-macos/cursor_normal.png?v=20261030-red-macos-v1';
  const gearAsset = new Image();
  gearAsset.src = '/assets/cursors/cursor_carga_engranaje.svg?v=20261030-v1';
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  let visual = null;
  let visualImage = null;
  let gearImage = null;
  let loadingMode = '';
  let pointerSeen = false;
  let pointerInside = true;
  let pointerX = 0;
  let pointerY = 0;
  let syncQueued = false;

  function ensureLoadingVisual() {
    if (visual) return;
    visual = document.createElement('span');
    visual.id = 'seCursorLoadingVisual';
    visual.className = 'se-cursor-loading-visual';
    visual.setAttribute('aria-hidden', 'true');
    visual.hidden = true;
    visualImage = document.createElement('img');
    visualImage.alt = '';
    visualImage.width = 28;
    visualImage.height = 28;
    visualImage.className = 'se-cursor-loading-arrow';
    visualImage.src = arrowAsset.src;
    visual.appendChild(visualImage);
    gearImage = document.createElement('img');
    gearImage.alt = '';
    gearImage.width = 16;
    gearImage.height = 16;
    gearImage.className = 'se-cursor-loading-gear';
    gearImage.src = gearAsset.src;
    visual.appendChild(gearImage);
    document.body.appendChild(visual);
  }

  function loadingStateAtPointer() {
    if (document.querySelector('#appContent[aria-busy="true"], #seGlobalModuleLoaderHost[aria-busy="true"], #appContent .quote-flow-loading')) return 'wait';
    const contextual = document.getElementById('seContextualLoaderHost');
    if (contextual && !contextual.hidden && contextual.classList.contains('is-visible') && !contextual.classList.contains('is-complete')) return 'progress';
    if (!pointerSeen) return '';
    const target = document.elementFromPoint(pointerX, pointerY);
    if (!(target instanceof Element)) return '';
    if (target.closest('[data-cursor="cargando"], .loading-card, .popover-loading')) return 'wait';
    const modal = target.closest('.modal');
    if (modal?.querySelector('.loading-card')) return 'wait';
    if (target.closest('[data-cursor="ocupado-fondo"], [aria-busy="true"]')) return 'progress';
    return '';
  }

  function placeLoadingVisual() {
    if (!visual) return;
    // El PNG de la flecha usa hotspot 4,4. La pieza flotante respeta ese punto.
    visual.style.transform = `translate3d(${pointerX - 4}px, ${pointerY - 4}px, 0)`;
  }

  function syncLoadingVisual() {
    syncQueued = false;
    const mode = enabled && finePointer.matches && pointerSeen && pointerInside && document.visibilityState === 'visible'
      ? loadingStateAtPointer() : '';
    if (mode !== 'wait' || !arrowAsset.complete || !arrowAsset.naturalWidth || !gearAsset.complete || !gearAsset.naturalWidth) {
      loadingMode = mode === 'progress' ? mode : '';
      root.classList.remove('se-loading-cursor-active');
      if (visual) visual.hidden = true;
      return;
    }
    ensureLoadingVisual();
    loadingMode = mode;
    placeLoadingVisual();
    visual.hidden = false;
    root.classList.add('se-loading-cursor-active');
  }

  function queueLoadingSync() {
    if (syncQueued) return;
    syncQueued = true;
    queueMicrotask(syncLoadingVisual);
  }

  arrowAsset.addEventListener('load', queueLoadingSync);
  gearAsset.addEventListener('load', queueLoadingSync);
  finePointer.addEventListener?.('change', queueLoadingSync);
  document.addEventListener('seprigua:loader-state-change', queueLoadingSync);
  document.addEventListener('visibilitychange', queueLoadingSync);
  window.addEventListener('focus', () => { pointerInside = false; queueLoadingSync(); });
  window.addEventListener('blur', () => { pointerInside = false; queueLoadingSync(); });
  document.addEventListener('pointerleave', () => { pointerInside = false; queueLoadingSync(); }, {passive:true});
  document.addEventListener('pointermove', event => {
    if (event.pointerType && event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
    pointerSeen = true;
    pointerInside = true;
    pointerX = event.clientX;
    pointerY = event.clientY;
    const nextMode = enabled && finePointer.matches ? loadingStateAtPointer() : '';
    if (nextMode !== loadingMode) queueLoadingSync();
    else if (loadingMode === 'wait') placeLoadingVisual();
  }, {passive:true});
  const busyObserver = new MutationObserver(queueLoadingSync);
  const appContent = document.getElementById('appContent');
  if (appContent) busyObserver.observe(appContent, {attributes:true, attributeFilter:['aria-busy'], childList:true, subtree:true});
  const modalBackdrop = document.getElementById('modalBackdrop');
  if (modalBackdrop) busyObserver.observe(modalBackdrop, {childList:true, subtree:true});
  queueLoadingSync();

  function apply() { root.classList.toggle('se-cursors-enabled', enabled); queueLoadingSync(); }
  function setUser(user) {
    const identity = user?.id ?? user?.usuario_id ?? user?.usuario ?? user?.nombre ?? 'local';
    storageKey = `seprigua_cursor_personalizado_${String(identity)}`;
    try { enabled = localStorage.getItem(storageKey) !== 'off'; } catch (_) { enabled = true; }
    apply();
    return enabled;
  }
  function setEnabled(value) {
    enabled = Boolean(value);
    try { localStorage.setItem(storageKey, enabled ? 'on' : 'off'); } catch (_) {}
    if (!enabled) delete root.dataset.seFileDrag;
    apply();
    document.dispatchEvent(new CustomEvent('seprigua:cursor-preference', {detail:{enabled}}));
  }

  // Solo indica visualmente los estados de arrastre; no intercepta ni modifica la subida.
  const fileDrag = event => {
    if (!enabled || !Array.from(event.dataTransfer?.types || []).includes('Files')) return;
    const overInput = event.target instanceof Element && Boolean(event.target.closest('input[type="file"]'));
    root.dataset.seFileDrag = overInput ? 'valid' : 'invalid';
  };
  const clearFileDrag = () => { delete root.dataset.seFileDrag; };
  document.addEventListener('dragenter', fileDrag);
  document.addEventListener('dragover', fileDrag);
  document.addEventListener('drop', clearFileDrag);
  document.addEventListener('dragend', clearFileDrag);
  window.addEventListener('blur', clearFileDrag);
  document.addEventListener('dragleave', event => {
    if (!event.relatedTarget) clearFileDrag();
  });

  // El control nativo de redimensionar un textarea está en su esquina inferior derecha.
  document.addEventListener('pointermove', event => {
    const target = event.target;
    if (!(target instanceof HTMLTextAreaElement)) return;
    if (!enabled || getComputedStyle(target).resize === 'none') {
      target.classList.remove('se-cursor-resize-grip');
      return;
    }
    const rect = target.getBoundingClientRect();
    target.classList.toggle('se-cursor-resize-grip', event.clientX >= rect.right - 17 && event.clientY >= rect.bottom - 17);
  }, {passive:true});
  document.addEventListener('pointerout', event => {
    if (event.target instanceof HTMLTextAreaElement) event.target.classList.remove('se-cursor-resize-grip');
  }, {passive:true});

  window.SEPRIGUACursors = Object.freeze({setUser, isEnabled:() => enabled, setEnabled});
})();
