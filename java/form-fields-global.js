/* Presentación compartida de archivos y errores. Los controles originales conservan sus nombres y eventos. */
(() => {
  'use strict';
  const roots = () => [document.getElementById('appContent'), document.getElementById('modalBody')].filter(Boolean);
  let nextId = 0;

  function enhanceFile(input) {
    if (input.dataset.seUpload === '1' || input.closest('.se-upload-zone')) return;
    input.dataset.seUpload = '1';
    const field = input.closest('.field, .profile-photo-form, .form-field, .upload-field') || input.parentElement;
    const zone = document.createElement('div');
    zone.className = 'se-upload-zone';
    zone.innerHTML = '<span class="se-upload-art" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V8m-3 3 3-3 3 3"/><path d="M20 17.5a4 4 0 0 0-2.4-7.2A6 6 0 0 0 6.2 9a4.5 4.5 0 0 0-.2 9h3"/><path d="M15 18h3"/></svg></span><span class="se-upload-copy"><strong></strong><small>Selecciona un archivo para este formulario.</small></span><span class="se-upload-pick" aria-hidden="true">Elegir archivos</span>';
    input.parentNode.insertBefore(zone, input);
    zone.appendChild(input);
    if (!input.getAttribute('aria-label')) {
      const name = field?.querySelector('label')?.textContent.trim();
      input.setAttribute('aria-label', name || 'Elegir archivos');
    }
    const clear = field?.querySelector('#clearRequestFiles, [data-clear-files], .se-upload-clear, .clear-files');
    const clearButton = clear || document.createElement('button');
    const clearRow = clear?.parentElement?.classList.contains('inline-actions') && clear.parentElement.children.length === 1 ? clear.parentElement : null;
    if (!clear) {
      clearButton.type = 'button';
      clearButton.textContent = 'Quitar archivos';
      zone.insertAdjacentElement('afterend', clearButton);
    }
    clearButton.classList.add('se-upload-clear');
    const title = zone.querySelector('strong');
    const detail = zone.querySelector('small');
    const picker = zone.querySelector('.se-upload-pick');
    picker.textContent = input.multiple ? 'Elegir archivos' : 'Elegir archivo';
    const sync = () => {
      const files = Array.from(input.files || []);
      const count = files.length;
      title.textContent = count ? (count === 1 ? files[0].name : `${count} archivos seleccionados`) : (input.multiple ? 'Haz clic para seleccionar archivos' : 'Haz clic para seleccionar un archivo');
      detail.textContent = count > 1 ? files.map(file => file.name).join(' · ') : (count ? 'Listo para adjuntar' : 'Puedes elegir los archivos permitidos para este formulario.');
      clearButton.hidden = count === 0;
      if (clearRow) clearRow.hidden = count === 0;
      zone.classList.toggle('se-upload-zone--filled', count > 0);
      zone.classList.toggle('se-upload-zone--disabled', input.disabled);
    };
    clearButton.addEventListener('click', () => {
      input.value = '';
      input.dispatchEvent(new Event('change', {bubbles: true}));
    });
    input.addEventListener('change', sync);
    input.form?.addEventListener('reset', () => setTimeout(sync, 0));
    new MutationObserver(sync).observe(input, {attributes: true, attributeFilter: ['disabled']});
    sync();
  }

  function errorMessage(control) {
    const validity = control.validity;
    if (validity.valueMissing) return control.type === 'file' ? 'Selecciona un archivo para continuar.' : control.tagName === 'SELECT' ? 'Selecciona una opción para continuar.' : 'Completa este campo para continuar.';
    if (validity.typeMismatch) return control.type === 'email' ? 'Escribe un correo electrónico válido.' : 'Revisa el formato de este dato.';
    if (validity.patternMismatch) return 'Revisa el formato solicitado para este campo.';
    if (validity.tooShort) return `Escribe al menos ${control.minLength} caracteres.`;
    if (validity.tooLong) return `Usa como máximo ${control.maxLength} caracteres.`;
    if (validity.rangeUnderflow || validity.rangeOverflow || validity.stepMismatch) return 'Revisa el valor permitido para este campo.';
    if (validity.badInput) return 'Escribe un valor válido.';
    return control.validationMessage || 'Revisa este campo antes de continuar.';
  }
  function visualControl(control) {
    if (control.tagName === 'SELECT') return control.closest('.se-enterprise-select')?.querySelector('.se-enterprise-select-button') || control;
    if (control.type === 'file') return control.closest('.se-upload-zone') || control;
    return control;
  }
  function clearError(control) {
    const id = control.dataset.seErrorId;
    if (!id) return;
    document.getElementById(id)?.remove();
    const visual = visualControl(control);
    visual.classList.remove('se-field-invalid');
    if (visual !== control) { visual.removeAttribute('aria-invalid'); visual.removeAttribute('aria-describedby'); }
    control.removeAttribute('aria-invalid');
    const described = (control.getAttribute('aria-describedby') || '').split(/\s+/).filter(value => value && value !== id);
    if (described.length) control.setAttribute('aria-describedby', described.join(' '));
    else control.removeAttribute('aria-describedby');
    delete control.dataset.seErrorId;
  }
  function showError(control) {
    clearError(control);
    const visual = visualControl(control);
    const id = `se-field-error-${++nextId}`;
    const message = document.createElement('div');
    message.className = 'se-field-error';
    message.id = id;
    message.setAttribute('role', 'alert');
    message.textContent = errorMessage(control);
    visual.insertAdjacentElement('afterend', message);
    visual.classList.add('se-field-invalid');
    if (visual !== control) { visual.setAttribute('aria-invalid', 'true'); visual.setAttribute('aria-describedby', id); }
    control.dataset.seErrorId = id;
    control.setAttribute('aria-invalid', 'true');
    control.setAttribute('aria-describedby', `${control.getAttribute('aria-describedby') || ''} ${id}`.trim());
  }
  function inSystem(control) { return roots().some(root => root.contains(control)); }
  document.addEventListener('invalid', event => {
    const control = event.target;
    if (!(control instanceof HTMLElement) || !inSystem(control)) return;
    event.preventDefault();
    showError(control);
    if (!control.form?.dataset.seFocusErrorPending) {
      if (control.form) control.form.dataset.seFocusErrorPending = '1';
      setTimeout(() => {
        delete control.form?.dataset.seFocusErrorPending;
        const visual = visualControl(control);
        visual.scrollIntoView?.({block: 'nearest', behavior: 'smooth'});
        (control.type === 'file' ? control : visual).focus?.({preventScroll: true});
      }, 0);
    }
  }, true);
  const refreshError = event => {
    const control = event.target;
    if (!(control instanceof HTMLElement) || !inSystem(control) || !control.dataset.seErrorId) return;
    if (control.validity?.valid) clearError(control);
  };
  document.addEventListener('input', refreshError, true);
  document.addEventListener('change', refreshError, true);
  document.addEventListener('reset', event => {
    if (!inSystem(event.target)) return;
    setTimeout(() => event.target.querySelectorAll('[data-se-error-id]').forEach(clearError), 0);
  }, true);

  let pending = false;
  function enhance() {
    pending = false;
    roots().forEach(root => root.querySelectorAll('input[type="file"]:not([data-se-upload])').forEach(enhanceFile));
  }
  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(enhance);
  }
  function start() {
    roots().forEach(root => new MutationObserver(schedule).observe(root, {childList: true, subtree: true}));
    schedule();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true}); else start();
})();
