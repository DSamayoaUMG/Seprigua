(() => {
  "use strict";

  window.lucide?.createIcons();

  const form = document.getElementById("loginForm");
  const identity = document.getElementById("identity");
  const password = document.getElementById("password");
  const remember = document.getElementById("remember");
  const toggle = document.getElementById("togglePassword");
  const status = document.getElementById("loginStatus");
  const identityError = document.getElementById("identityError");
  const passwordError = document.getElementById("passwordError");
  const submit = form?.querySelector(".login-submit");

  toggle?.addEventListener("click", () => {
    const isVisible = password.type === "text";
    password.type = isVisible ? "password" : "text";
    toggle.setAttribute(
      "aria-label",
      isVisible ? "Mostrar contraseña" : "Ocultar contraseña"
    );
    toggle.innerHTML = `<i data-lucide="${isVisible ? "eye" : "eye-off"}"></i>`;
    window.lucide?.createIcons();
  });

  async function redirectIfLoggedIn() {
    try {
      const response = await fetch("/api/auth/me", { credentials: "same-origin" });
      if (!response.ok) return;
      const data = await response.json();
      if (!data.ok) return;

      const paths = {
        COORDINADOR: "/sistema/coordinador",
        TECNICO: "/sistema/tecnico",
        CLIENTE: "/sistema/cliente"
      };
      const destination = paths[String(data.user?.rol || "").toUpperCase()];
      if (destination) window.location.replace(destination);
    } catch (_error) {
      // El formulario sigue disponible si el backend aún no responde.
    }
  }

  form?.addEventListener("submit", async event => {
    event.preventDefault();

    identityError.textContent = "";
    passwordError.textContent = "";
    status.textContent = "";

    let valid = true;

    if (!identity.value.trim()) {
      identityError.textContent = "Ingresa tu usuario o correo electrónico.";
      valid = false;
    }

    if (!password.value) {
      passwordError.textContent = "Ingresa tu contraseña.";
      valid = false;
    }

    if (!valid) return;

    submit.disabled = true;
    status.textContent = "Validando credenciales...";

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-SEPRIGUA-Request": "1"
        },
        credentials: "same-origin",
        body: JSON.stringify({
          identity: identity.value.trim(),
          password: password.value,
          remember: Boolean(remember?.checked)
        })
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.ok) {
        status.textContent = data.message || "No fue posible iniciar sesión.";
        return;
      }

      status.textContent = "Acceso correcto. Ingresando...";
      window.setTimeout(() => {
        window.location.assign(data.redirect || "/");
      }, 350);
    } catch (_error) {
      status.textContent = "No se pudo conectar con el servidor local. Comprueba que el backend esté iniciado.";
    } finally {
      submit.disabled = false;
    }
  });


  // ------------------------------------------------------------
  // Recuperación de contraseña
  // ------------------------------------------------------------
  const recoveryModal = document.getElementById("recoveryModal");
  const forgotPasswordLink = document.getElementById("forgotPasswordLink");
  const recoveryRequestView = document.getElementById("recoveryRequestView");
  const recoveryConfirmView = document.getElementById("recoveryConfirmView");
  const recoveryRequestForm = document.getElementById("recoveryRequestForm");
  const recoveryConfirmForm = document.getElementById("recoveryConfirmForm");
  const recoveryIdentity = document.getElementById("recoveryIdentity");
  const recoveryRequestStatus = document.getElementById("recoveryRequestStatus");
  const recoveryConfirmStatus = document.getElementById("recoveryConfirmStatus");
  const newPassword = document.getElementById("newPassword");
  const confirmPassword = document.getElementById("confirmPassword");

  function openRecovery(mode = "request") {
    if (!recoveryModal) return;
    recoveryModal.hidden = false;
    document.body.classList.add("recovery-open");
    const confirmMode = mode === "confirm";
    if (recoveryRequestView) recoveryRequestView.hidden = confirmMode;
    if (recoveryConfirmView) recoveryConfirmView.hidden = !confirmMode;
    window.lucide?.createIcons();
    window.setTimeout(() => (confirmMode ? newPassword : recoveryIdentity)?.focus(), 40);
  }

  function closeRecovery() {
    if (!recoveryModal) return;
    recoveryModal.hidden = true;
    document.body.classList.remove("recovery-open");
  }

  forgotPasswordLink?.addEventListener("click", event => {
    event.preventDefault();
    if (recoveryRequestStatus) recoveryRequestStatus.textContent = "";
    if (recoveryIdentity && identity?.value.trim()) recoveryIdentity.value = identity.value.trim();
    openRecovery("request");
  });

  recoveryModal?.querySelectorAll("[data-recovery-close]").forEach(button => {
    button.addEventListener("click", closeRecovery);
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && recoveryModal && !recoveryModal.hidden) closeRecovery();
  });

  recoveryRequestForm?.addEventListener("submit", async event => {
    event.preventDefault();
    const value = recoveryIdentity?.value.trim() || "";
    if (!value) {
      recoveryRequestStatus.textContent = "Ingresa tu usuario o correo electrónico.";
      return;
    }
    const button = recoveryRequestForm.querySelector("button[type='submit']");
    button.disabled = true;
    recoveryRequestStatus.textContent = "Procesando solicitud...";
    try {
      const requestOptions = {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-SEPRIGUA-Request": "1" },
        credentials: "same-origin",
        body: JSON.stringify({ identity: value })
      };
      let response = await fetch("/api/auth/password-reset/request", requestOptions);
      // Compatibilidad defensiva con instalaciones que aún tengan una ruta anterior.
      if (response.status === 404) {
        response = await fetch("/api/password-reset/request", requestOptions);
      }
      const data = await response.json().catch(() => ({}));
      recoveryRequestStatus.textContent = data.message || "Solicitud procesada.";
      if (data.email_available === false) {
        recoveryRequestStatus.textContent += " La recuperación por correo aún no está configurada; puedes contactar a SEPRIGUA por WhatsApp.";
      }
      if (data.debug_reset_url) {
        const testLink = document.createElement("a");
        testLink.href = data.debug_reset_url;
        testLink.className = "recovery-debug-link";
        testLink.textContent = "Abrir enlace de prueba local";
        recoveryRequestStatus.append(document.createElement("br"), testLink);
      }
    } catch (_error) {
      recoveryRequestStatus.textContent = "No fue posible conectar con el servidor.";
    } finally {
      button.disabled = false;
    }
  });

  recoveryConfirmForm?.addEventListener("submit", async event => {
    event.preventDefault();
    const token = new URLSearchParams(window.location.search).get("reset_token") || "";
    const first = newPassword?.value || "";
    const second = confirmPassword?.value || "";
    if (first !== second) {
      recoveryConfirmStatus.textContent = "Las contraseñas no coinciden.";
      return;
    }
    if (first.length < 8 || !/[A-ZÁÉÍÓÚÑ]/.test(first) || !/[a-záéíóúñ]/.test(first) || !/\d/.test(first)) {
      recoveryConfirmStatus.textContent = "Usa al menos 8 caracteres e incluye mayúscula, minúscula y número.";
      return;
    }
    const button = recoveryConfirmForm.querySelector("button[type='submit']");
    button.disabled = true;
    recoveryConfirmStatus.textContent = "Actualizando contraseña...";
    try {
      const confirmOptions = {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-SEPRIGUA-Request": "1" },
        credentials: "same-origin",
        body: JSON.stringify({ token, password: first })
      };
      let response = await fetch("/api/auth/password-reset/confirm", confirmOptions);
      if (response.status === 404) {
        response = await fetch("/api/password-reset/confirm", confirmOptions);
      }
      const data = await response.json().catch(() => ({}));
      recoveryConfirmStatus.textContent = data.message || "No fue posible actualizar la contraseña.";
      if (response.ok && data.ok) {
        newPassword.value = "";
        confirmPassword.value = "";
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete("reset_token");
        history.replaceState({}, "", cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
        window.setTimeout(() => {
          closeRecovery();
          identity?.focus();
          status.textContent = "Contraseña actualizada. Inicia sesión con tu nueva contraseña.";
        }, 1400);
      }
    } catch (_error) {
      recoveryConfirmStatus.textContent = "No fue posible conectar con el servidor.";
    } finally {
      button.disabled = false;
    }
  });

  const initialResetToken = new URLSearchParams(window.location.search).get("reset_token");
  if (initialResetToken) openRecovery("confirm");

  redirectIfLoggedIn();
})();
