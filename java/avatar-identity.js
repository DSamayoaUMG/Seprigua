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
    const configured = explicitUrl ||
      entity.avatar_url || entity.avatarUrl || entity.foto_url || entity.fotoUrl ||
      entity.imagen_url || entity.imagenUrl || entity.foto_perfil || entity.fotoPerfil ||
      entity.avatar || entity.foto || entity.imagen ||
      entity.cliente_foto || entity.clienteFoto || entity.foto_cliente || entity.fotoCliente ||
      entity.avatar_cliente || entity.avatarCliente ||
      entity.tecnico_foto || entity.tecnicoFoto || entity.foto_tecnico || entity.fotoTecnico ||
      entity.empleado_foto || entity.empleadoFoto || "";
    if (String(configured).trim()) return String(configured).trim();
    const userId = Number(entity.usuario_id || entity.usuarioId || entity.user_id || entity.userId || 0);
    if (Number.isSafeInteger(userId) && userId > 0) return `/api/perfiles/${userId}/foto`;
    const employeeId = Number(entity.empleado_id || entity.empleadoId || 0);
    if (Number.isSafeInteger(employeeId) && employeeId > 0) return `/api/avatares/empleado/${employeeId}`;
    const contactId = Number(entity.contacto_id || entity.contactoId || entity.contacto_cliente_id || entity.contactoClienteId || 0);
    return Number.isSafeInteger(contactId) && contactId > 0 ? `/api/avatares/contacto/${contactId}` : "";
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
