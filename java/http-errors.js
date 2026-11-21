(() => {
  const link = document.getElementById('volver-atras');
  if (!link) return;
  link.addEventListener('click', (event) => {
    try {
      const referrer = document.referrer && new URL(document.referrer);
      // Regresar solo si hay una página previa del mismo dominio.
      if (!referrer || referrer.origin !== location.origin || history.length < 2) return;
      event.preventDefault();
      history.back();
    } catch (_) { /* El enlace / es la alternativa segura. */ }
  });
})();
