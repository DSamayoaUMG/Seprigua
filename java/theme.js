(() => {
  "use strict";

  const STORAGE_KEY = "seprigua_theme";
  const root = document.documentElement;
  const button = document.getElementById("themeToggleButton");
  let animationTimer = null;

  const currentTheme = () => root.dataset.theme === "dark" ? "dark" : "light";

  function paintButton() {
    if (!button) return;
    const dark = currentTheme() === "dark";
    button.classList.toggle("is-dark", dark);
    button.setAttribute("aria-label", dark ? "Cambiar a modo claro" : "Cambiar a modo oscuro");
    button.setAttribute("aria-pressed", String(dark));
    button.setAttribute("title", dark ? "Cambiar a modo claro" : "Cambiar a modo oscuro");
    button.innerHTML = `<i data-lucide="${dark ? "sun" : "moon"}" aria-hidden="true"></i><span class="theme-toggle-label">${dark ? "Claro" : "Oscuro"}</span>`;
    window.lucide?.createIcons();
  }

  function markThemeTransition() {
    root.classList.remove("se-theme-changing");
    // Force a style boundary so repeated toggles still animate cleanly.
    void root.offsetWidth;
    root.classList.add("se-theme-changing");
    clearTimeout(animationTimer);
    animationTimer = window.setTimeout(() => root.classList.remove("se-theme-changing"), 260);
  }

  function applyTheme(next, { persist = true, animate = false } = {}) {
    const theme = next === "dark" ? "dark" : "light";
    if (animate) markThemeTransition();
    root.dataset.theme = theme;
    // Keep native/browser controls in light color-scheme. SEPRIGUA's dark mode is
    // deliberately page-only so the browser/OS auto-dark cannot recolor controls.
    root.style.colorScheme = "light";
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) themeMeta.setAttribute("content", theme === "dark" ? "#061525" : "#ffffff");
    if (persist) {
      try { localStorage.setItem(STORAGE_KEY, theme); } catch (_) {}
    }
    paintButton();
    window.dispatchEvent(new CustomEvent("seprigua:themechange", { detail: { theme } }));
  }

  if (button) {
    button.addEventListener("click", () => {
      applyTheme(currentTheme() === "dark" ? "light" : "dark", { animate: true });
    });
  }

  // The inline boot script already resolved the saved theme before first paint.
  // Normalize the value here without consulting prefers-color-scheme.
  applyTheme(currentTheme(), { persist: false, animate: false });
})();
