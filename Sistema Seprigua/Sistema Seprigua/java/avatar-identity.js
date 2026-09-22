(() => {
  "use strict";

  const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  })[char]);

  function initials(nombre) {
    const parts = String(nombre || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    return parts.slice(0, 2).map(part => part.charAt(0).toUpperCase()).join("");
  }

  function resolveUrl(entity = {}, explicitUrl = "") {
    return String(explicitUrl ||
      entity.avatar_url || entity.avatarUrl || entity.foto_url || entity.fotoUrl ||
      entity.imagen_url || entity.imagenUrl || entity.foto_perfil || entity.fotoPerfil ||
      entity.avatar || entity.foto || entity.imagen ||
      entity.cliente_foto || entity.clienteFoto || entity.foto_cliente || entity.fotoCliente ||
      entity.avatar_cliente || entity.avatarCliente ||
      entity.tecnico_foto || entity.tecnicoFoto || entity.foto_tecnico || entity.fotoTecnico ||
      entity.empleado_foto || entity.empleadoFoto || "").trim();
  }

  function render(nombre, options = {}) {
    const safeName = String(nombre || options.fallbackName || "Sin nombre").trim() || "Sin nombre";
    const avatarUrl = resolveUrl(options.entity || {}, options.url || "");
    const subtitle = String(options.subtitle || "").trim();
    const extraClass = String(options.className || "").trim();

    return `<div class="entity-identity${extraClass ? ` ${escapeHtml(extraClass)}` : ""}">
      <span class="entity-avatar-shell" aria-hidden="true">
        <span class="entity-avatar-fallback">${escapeHtml(initials(safeName))}</span>
        ${avatarUrl ? `<img class="entity-avatar-image" src="${escapeHtml(avatarUrl)}" alt="" loading="lazy" onerror="this.remove()">` : ""}
      </span>
      <div class="entity-identity-copy">
        <strong>${escapeHtml(safeName)}</strong>
        ${subtitle ? `<span>${escapeHtml(subtitle)}</span>` : ""}
      </div>
    </div>`;
  }

  window.SEPRIGUAAvatar = Object.freeze({ initials, resolveUrl, render });
})();
