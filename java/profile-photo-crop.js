/* Editor de recorte inspirado en la interfaz de Karla. La cuenta guarda la foto en el servidor. */
(() => {
  "use strict";
  const supported = new Set(["image/png", "image/jpeg", "image/webp"]);
  const maxSize = 5 * 1024 * 1024;
  let active = null;

  function open(file) {
    if (!file || !supported.has(file.type)) return Promise.reject(new Error("Selecciona una imagen JPG, PNG o WEBP."));
    if (file.size > maxSize) return Promise.reject(new Error("La fotografía no puede superar los 5 MB."));
    if (active) active.cancel();

    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const photo = new Image();
      const editor = {cancel: () => finish(null)};
      active = editor;
      let overlay = null;
      let zoom = 1;
      let offsetX = 0;
      let offsetY = 0;
      let pointer = null;
      let saving = false;
      let finished = false;

      function finish(result, error) {
        if (finished) return;
        finished = true;
        document.removeEventListener("keydown", onKeydown);
        overlay?.remove();
        URL.revokeObjectURL(url);
        if (active === editor) active = null;
        if (error) reject(error);
        else resolve(result);
      }

      function redraw() {
        const canvas = overlay?.querySelector("canvas");
        if (!canvas) return;
        const size = canvas.width;
        const scale = Math.max(size / photo.naturalWidth, size / photo.naturalHeight) * zoom;
        const width = photo.naturalWidth * scale;
        const height = photo.naturalHeight * scale;
        offsetX = Math.max((size - width) / 2, Math.min((width - size) / 2, offsetX));
        offsetY = Math.max((size - height) / 2, Math.min((height - size) / 2, offsetY));
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, size, size);
        ctx.drawImage(photo, (size - width) / 2 + offsetX, (size - height) / 2 + offsetY, width, height);
      }

      function onKeydown(event) {
        if (event.key === "Escape") { event.stopPropagation(); finish(null); }
      }

      photo.onerror = () => finish(null, new Error("No se pudo abrir esa fotografía."));
      photo.onload = () => {
        if (finished) return;
        overlay = document.createElement("div");
        overlay.className = "se-photo-backdrop";
        overlay.innerHTML = `<section role="dialog" aria-modal="true" aria-labelledby="sePhotoEditorTitle" class="se-photo-dialog">
          <header><div><span class="se-photo-kicker">MI CUENTA</span><h2 id="sePhotoEditorTitle">Ajustar fotografía</h2><p>Arrastra la imagen y ajusta el tamaño antes de aplicarla.</p></div><button class="se-photo-close" type="button" data-se-crop="cancel" aria-label="Cerrar"><i data-lucide="x"></i></button></header>
          <div class="se-photo-editor-content"><canvas width="600" height="600" role="img" aria-label="Vista previa del recorte"></canvas><label class="se-photo-zoom"><i data-lucide="zoom-in"></i> Acercar <input type="range" min="1" max="3" step="0.05" value="1" aria-label="Zoom de la fotografía"></label></div>
          <footer><button class="btn" type="button" data-se-crop="cancel">Cancelar</button><button class="btn primary" type="button" data-se-crop="apply"><i data-lucide="check"></i> Aplicar recorte</button></footer>
          <p class="se-photo-editor-note">Después de aplicar el recorte, pulsa «Guardar fotografía» para subirla a tu cuenta.</p>
        </section>`;
        document.body.appendChild(overlay);
        window.lucide?.createIcons();
        const canvas = overlay.querySelector("canvas");
        const zoomInput = overlay.querySelector('input[type="range"]');
        zoomInput.addEventListener("input", () => { zoom = Number(zoomInput.value); offsetX = 0; offsetY = 0; redraw(); });
        canvas.addEventListener("pointerdown", event => { pointer = {id:event.pointerId,x:event.clientX,y:event.clientY,ox:offsetX,oy:offsetY}; canvas.setPointerCapture(event.pointerId); });
        canvas.addEventListener("pointermove", event => {
          if (!pointer || pointer.id !== event.pointerId) return;
          const ratio = canvas.width / canvas.getBoundingClientRect().width;
          offsetX = pointer.ox + (event.clientX - pointer.x) * ratio;
          offsetY = pointer.oy + (event.clientY - pointer.y) * ratio;
          redraw();
        });
        canvas.addEventListener("pointerup", () => { pointer = null; });
        canvas.addEventListener("pointercancel", () => { pointer = null; });
        overlay.addEventListener("click", async event => {
          if (event.target === overlay || event.target.closest('[data-se-crop="cancel"]')) return finish(null);
          if (!event.target.closest('[data-se-crop="apply"]') || saving) return;
          saving = true;
          const applyButton = overlay.querySelector('[data-se-crop="apply"]');
          applyButton.disabled = true;
          try {
            const blob = await new Promise(done => canvas.toBlob(done, "image/webp", .86));
            if (!blob) throw new Error("No se pudo preparar la fotografía recortada.");
            finish(blob);
          } catch (error) { finish(null, error); }
        });
        document.addEventListener("keydown", onKeydown);
        redraw();
        overlay.querySelector(".se-photo-close").focus();
      };
      photo.src = url;
    });
  }

  window.SEPRIGUAProfileCrop = Object.freeze({open});
})();
