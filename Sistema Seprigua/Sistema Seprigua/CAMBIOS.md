# Cambios de interfaz y limpieza

- Se corrigieron botones que habían quedado con estilo nativo en Cotizaciones, Clientes/Personal y acciones administrativas.
- Se corrigió el menú de acciones de Cotizaciones: botón principal, menú de tres puntos, Descargar PDF y Ver OT.
- Se corrigió el espaciado de los indicadores de Notificaciones y Roles y accesos para evitar textos pegados a los contadores.
- Se corrigió la sección de notificaciones de Mi cuenta: estado, bloque informativo, acciones y encabezado de dispositivos.
- Se añadieron estilos coherentes para acciones compactas, estados de usuario, alertas operativas y estados vacíos.
- Se eliminaron 28 archivos CSS/JS heredados que ya no tenían ninguna referencia en el proyecto actual y que habían quedado de fusiones anteriores.
- Se eliminaron funciones JavaScript comprobadas como no utilizadas.
- `sistema.html` continúa cargando una sola hoja principal para el portal: `css/sistema.css`.
- Se actualizaron las versiones de caché de `sistema.css` y `sistema.js` para que el navegador reciba los cambios.
- No se modificó backend, estructura de base de datos, tablas, columnas, SP, triggers, endpoints ni autenticación.
