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
        headers: { "Content-Type": "application/json" },
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

  redirectIfLoggedIn();
})();
