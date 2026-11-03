# Auditoría técnica y alcance de las pruebas

Fecha: 24/09/2026. Base: `Sistema Seprigua(2).zip`. Se inspeccionaron consultas del código, endpoints, permisos, archivos, sesiones, referencias y scripts. No se inspeccionaron definiciones de SP/triggers de una instancia remota: no está accesible.

| Área | Control realizado |
|---|---|
| SQL | Parámetros en datos; columnas/orden dinámicos mediante listas conocidas; búsquedas literales y errores sin SQL. Inventario de SP y objetos incluido en contrato_sql.json. |
| Autorización | Matriz de endpoints anónimos, permisos de módulos, pertenencia de OT/solicitudes/documentos y transiciones de vacaciones. |
| XSS/CSRF | Escape de texto de negocio, prueba de carga maliciosa, cabeceras, verificación de origen/cabecera en mutaciones. Las URL de archivos se generan como endpoints autorizados. |
| Sesiones | Expiración/revocación y permisos por petición, cambio obligatorio, cookies HttpOnly/SameSite. Recuperación con URL configurada; diagnóstico de enlaces restringido. |
| Archivos | Tamaño/lectura limitada, validación de contenido, imágenes y dimensiones, DOCX estructurado, descarga privada y bloqueo de rutas ajenas. No equivale a un análisis antivirus externo. |
| PWA | Destinos del mismo origen; sin caché de datos privados; ventana visible sin duplicación. HTTPS y entrega externa dependen de infraestructura. |
| Dependencias | Versiones de producción fijadas y revisión de vulnerabilidades conocidas. No significa ausencia absoluta de vulnerabilidades futuras. |
| UI | 240 pantallas verificadas en Chromium por cuatro perfiles y cinco anchos, más interacciones de agenda/cotización/vacaciones/cancelación y recargas con API ficticia. |
| Rendimiento | Cachés/invalidez, supresión de peticiones duplicadas, paginación de servidor en módulos de mayor carga, sin precarga indiscriminada. No se afirma una prueba de carga de la BD real. |
| Activos | Sintaxis Python/JS/scripts HTML, JSON y manifiesto; sin referencias locales ausentes. Retirados 28 CSS/JS sin consumidores y renderer alternativo inactivo. |
| Despliegue | Waitress real: 11 peticiones HTTP sin credenciales; bloqueo de archivos privados y cabeceras. Scripts Windows preparados, no ejecutados en un Windows remoto. |

Los tests del backend usan dobles controlados. Los de navegador y DOM usan datos en memoria y no conectan con producción. Sus recargas verifican contratos de interfaz, no persistencia SQL. Consulte VALIDACION_VM.md para la prueba real.

Los registros conservados de backend, Waitress, DOM, Service Worker, revisión estática y `npm audit` están en `docs/pruebas`. El inventario local identifica 53 procedimientos y 40 objetos SQL referenciados; es un contrato del código, no una certificación de que existan en la instancia remota. Las comprobaciones de Chromium y pip-audit se completaron en la ejecución anterior de esta misma auditoría; sus registros originales no se conservaron tras la recuperación del entorno.

## Discrepancias conservadas/documentadas

DERCAS define procesos y alcance; no se sustituyó Flask/Waitress por la propuesta Azure. La garantía vigente usa IncidenciaOrden y no requiere el SP ausente `usp_GarantiaPortal_Listar`. Se usa `Contenido` del almacenamiento binario existente, no `ContenidoArchivo`. `com.Notificacion` usa `CreadaEn`; las sedes usan `SucursalCliente.Nombre`.

La cancelación conserva eventos relacionados en las notificaciones existentes: no purgar `CANCELACION_*`. La disponibilidad por vacaciones se deriva de fechas aprobadas. No se inventaron salarios, categoría histórica ni duración futura de OT. Las discrepancias de SP instalados solo pueden confirmarse con la instancia real; el diagnóstico consulta metadatos sin DDL ni SP de negocio.

Fuentes técnicas: https://flask.palletsprojects.com/en/stable/web-security/ y https://docs.pylonsproject.org/projects/waitress/en/stable/usage.html.
