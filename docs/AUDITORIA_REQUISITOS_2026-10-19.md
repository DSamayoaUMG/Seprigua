# AUDITORÍA DE MÓDULOS I, II Y III — SEPRIGUA

**Actualización 20/10/2026:** Se recibió el DERCAS final versión 3.0 (166 páginas). Define cuatro módulos principales, sin numeración formal I, II y III. El análisis actualizado y los entregables editables están en `entregables/`. Los submódulos añadidos al sistema después del DERCAS forman parte del alcance auditado. Las referencias de este informe a «DERCAS no disponible» corresponden al estado de la revisión del 19/10 y quedan superadas por esta actualización.

**Fecha:** 19 de octubre de 2026. **Alcance:** diagnóstico estático del directorio `C:\Users\USusario\Desktop\Sistema Seprigua`, comparación con el ZIP disponible, lectura del script `SEPRIGUA_DB` suministrado y prueba aislada de navegación de cotizaciones. **No es una certificación de la instancia SQL Server ni una aceptación del cliente.**

## 1. Base examinada y límites de evidencia

- El directorio no contiene `.git`; no es posible reconstruir commits ni atribuir parches posteriores por historial de versiones.
- No se encontró el archivo anunciado `Sistema Seprigua(20261019-032344).zip`. Sí existe `C:\Users\USusario\Desktop\Sistema Seprigua.zip`, fechado el 19/10/2026. Frente a ese ZIP, 135 archivos disponibles coincidían por SHA-256; los dos JavaScript de cotizaciones difieren por la corrección de esta intervención. Cinco archivos documentales presentes en el ZIP (`README.md`, `CAMBIOS.md`, `PENDIENTES.md`, `.env.example`, `LEEME_LOCAL.txt`) faltan en el directorio actual. El ZIP no se sustituyó ni se extrajo sobre el trabajo existente.
- Se revisaron `java/portal-ui.js`, `java/sistema.js`, `backend/app.py`, `backend/portal_extensions.py`, `backend/listings.py`, `backend/reports.py`, las pruebas de `tests/`, `docs/AUDITORIA.md`, `docs/VALIDACION_VM.md`, documentación del ZIP y el script SQL adjunto. No se leyó el contenido de `.env`, datos privados ni credenciales.
- El DERCAS final y la definición formal de «Módulos I, II y III» no están en el directorio ni entre los adjuntos. Por ello, **Solicitudes, Órdenes y Cotizaciones son una clasificación provisional**, no la numeración confirmada del ingeniero.
- No se proporcionó conexión comprobada a la instancia SQL Server, cuentas de ensayo ni un acta de pruebas de aceptación. El script SQL describe objetos, pero no prueba que la instancia desplegada tenga exactamente ese estado o que los procedimientos funcionen con datos reales. No se calcula un porcentaje de cumplimiento: faltan el denominador oficial y la validación integrada necesaria para sustentarlo.

## 2. Arquitectura observada

La aplicación privada usa Flask y pyodbc, con Waitress como servidor documentado. El frontend es HTML/CSS/JavaScript. El acceso se controla por sesión, rol y módulos habilitados; hay rutas específicas para Coordinador, Técnico y Cliente. Las cotizaciones usan tablas `cot.Cotizacion`, `cot.VersionCotizacion`, `cot.DetalleCotizacion` y procedimientos de envío, respuesta y expediente. Las evidencias y documentos combinan almacenamiento binario de servicio y archivos laborales privados según el código y la guía del ZIP. Los scripts de despliegue y el `.env` respaldan la configuración externa. La guía menciona dos VM Windows en AWS usadas para pruebas; su configuración real de red, respaldos y disponibilidad no se verificó aquí.

Se contaron 52 tablas y 329 procedimientos definidos en el script adjunto. Una búsqueda estática encontró 63 nombres de procedimientos `EXEC esquema.nombre` en el backend: 62 están definidos en el script; `sys.sp_set_session_context` es un procedimiento del sistema. Esto verifica presencia textual, no compatibilidad de firmas ni comportamiento de la base instalada.

## 3. Corrección puntual de cotizaciones

**Causa comprobada en el código:** `quoteForm` recibía `saved.item.id`, pero después de guardar o guardar y enviar solo ejecutaba `navigate('cotizaciones',{force:true})`. La acción `enviar-cotizacion` repetía el patrón. La bandeja del Coordinador tampoco ofrecía «Ver detalle» por fila. Si el formulario se abría desde una OT, esto hacía perder el contexto del registro; el código examinado no contiene una instrucción explícita que navegue a Órdenes después del envío. Un desvío a Órdenes en una instalación concreta requeriría reproducirla con su versión y permisos reales.

**Cambio:** `java/portal-ui.js` conserva el ID y abre el detalle tras refrescar Cotizaciones; el detalle muestra historial, versión, estado, descarga PDF y regreso al listado. `java/sistema.js` abre el mismo detalle después del envío directo y añade «Ver detalle» a la bandeja. No se modificaron endpoints, procedimientos, tablas, autenticación ni reglas comerciales.

**Prueba realizada:** Edge sin interfaz contra la API simulada de `tests/browser.test.cjs`: guardar borrador, crear y enviar, conservar el módulo Cotizaciones, abrir detalle, comprobar enlace de PDF e historial, cerrar y reabrir desde la lista, crear versión con motivo y enviar desde la lista. **Resultado:** pasó. El doble de prueba omite `porcentaje_impuesto` al devolver el detalle; se suministró `0` en la prueba de versión, mientras la ruta real selecciona ese campo de `cot.DetalleCotizacion`. La prueba no descargó un PDF real ni escribió en SQL Server. La ruta `GET /api/cotizaciones/<id>/pdf` y su autorización se comprobaron por lectura de código, no por ejecución contra datos reales.

## 4. Módulos provisionales I, II y III

| Área provisional | Pantallas y rutas identificadas | Datos y permisos observados | Estado verificable | Falta para declarar 100 % |
|---|---|---|---|---|
| Solicitudes | `renderSolicitudes`, `requestForm`, `openRequest`; `GET/POST /api/solicitudes`, `GET /api/solicitudes/<id>`, evidencias y cancelaciones relacionadas | `srv.SolicitudServicio`, ubicación, cliente, evidencias; Coordinador y Cliente con comprobaciones de pertenencia | Implementada en código; sin prueba integrada en esta intervención | DERCAS, recorrido con alta/consulta/cancelación/emergencia en SQL real, aislamiento entre clientes y recarga entre sesiones |
| Órdenes de trabajo | `renderOrdenes`, `openOrder`; listado, detalle, creación, edición, cuadrilla, estados, actividades, incidencias, evidencias, cambios de alcance, reporte PDF y collage | `srv.OrdenTrabajo`, `srv.TecnicoOrden`, `srv.ActividadServicio`, `srv.EvidenciaServicio`, estados; Coordinador, Técnico y Cliente con accesos diferenciados | Implementada en código; varios flujos constan como probados en documentación anterior, pero no se reprodujeron aquí contra SQL | Estados y restricciones reales de cierre, firma, asignación, evidencias, PDF y permisos por registro en VM |
| Cotizaciones | `renderCotizaciones`, `quoteForm`, `quoteDetail`; listado, creación, detalle, PDF, envío, respuesta, versiones | `cot.Cotizacion`, `cot.VersionCotizacion`, `cot.DetalleCotizacion`; Coordinador crea/envía/versiona, Cliente consulta y responde | Navegación puntual probada con API simulada; contratos y controles leídos | Guardar borrador/enviar/descargar/aceptar/rechazar/pedir revisión/versionar con datos de ensayo y SP instalados |

**CRUD y estados:** las operaciones de las tres áreas existen como rutas o acciones de negocio. «Eliminar» no equivale necesariamente a borrado físico: las solicitudes y órdenes emplean cancelación y estados; las cotizaciones mantienen versiones e historial. La definición formal de CRUD exigido para estos módulos debe contrastarse con DERCAS antes de medir cobertura. El backend bloquea versiones de cotizaciones aceptadas/anuladas y de OT cerradas; envío y respuesta se delegan a procedimientos del esquema `cot`, cuyas reglas instaladas requieren prueba.

## 5. Matriz de requisitos del ingeniero

| Requisito | Existe en el código o esquema | Funciona comprobado aquí | Brecha principal | Estado |
|---|---|---|---|---|
| Módulos I, II y III | Sí, para los tres candidatos provisionales | Solo navegación de cotizaciones con API simulada | Numeración DERCAS y pruebas SQL por rol | Implementados; cumplimiento no cuantificable |
| Mantenimientos completos | Equipo, inspección, falla, mantenimiento, transiciones, repuestos y avisos | No en SQL real | Recorrido preventivo/correctivo, evidencias específicas y reportes según DERCAS | Implementado parcialmente comprobado |
| Inventario CRUD de mantenimiento | Seis tablas `eqp` y rutas localizadas | No | Excel trazable por operación/ruta/formulario/SP/rol/prueba; distinguir SP genéricos del portal | Pendiente como entregable |
| Formularios y seguimiento | Solicitudes, OT, cierre, cotizaciones, mantenimiento y documentos presentes | Flujo aislado de cotización | Persistencia, dobles envíos y validaciones con datos reales | Requiere integración |
| Reportes HTML y PDF | Listados filtrados; PDF de OT y cotización | Enlace de cotización verificado, PDF real no | Ficha modal y PDF individual de usuarios; matriz y cobertura de otros reportes | Parcial |
| Entrega final a clientes | Guías técnicas en ZIP | No | Carta, taller, diapositivas, manuales, aceptación y cronograma acordado | Pendiente |
| Catálogos iniciales | Catálogo maestro y tablas catálogo en script | No se consultaron datos instalados | Distinguir valores reales, obligatorios y ejemplos; preparar script idempotente separado si procede | Diagnóstico pendiente |
| Infraestructura actual y propuesta | Scripts Waitress, configuración, guía de VM | No se comprobó AWS/Azure en esta sesión | Inventario real, costos y compatibilidad Azure/Blob sustentados | Análisis documental pendiente |
| Resolución de errores | Pruebas y bitácoras previas en `docs/pruebas`; corrección actual | Navegación de cotización simulada | Matriz de 24 incidencias, evidencia por caso y regresión SQL/VM | Parcial |
| Formulario de visita presencial | No localizado | No | Documento editable para aceptación parcial y firmas | Pendiente |

## 6. Mantenimiento: inventario técnico preliminar

Las seis tablas del esquema `eqp` identificadas son `Equipo`, `EquipoOrden`, `FallaEquipo`, `InspeccionEquipo`, `MantenimientoEquipo` y `RepuestoMantenimiento`. La existencia de procedimientos CRUD genéricos en el script no implica que el portal utilice todas esas operaciones. En particular, una baja lógica de equipo usa `Activo`; no se encontró una ruta del portal que borre físicamente un equipo.

| Tabla | Ruta o proceso real del portal | Formulario o vista | Operación observada | Pendiente de verificar |
|---|---|---|---|---|
| `eqp.Equipo` | `GET/POST /api/equipos`, `GET/PATCH /api/equipos/<id>`, `PATCH /estado` | Inventario, alta y edición | Crear, leer, actualizar, estado/baja lógica | Alta duplicada e inválidos en instancia real; reglas de baja |
| `eqp.EquipoOrden` | `POST /api/ordenes/<id>/equipos` y liberación por proceso de OT | Asignación de equipo en OT | Vincular y consultar | Confirmar ruta/transición exacta de liberación y CRUD requerido |
| `eqp.FallaEquipo` | `POST /api/equipos/<id>/fallas`, `PATCH /fallas/<falla_id>` | Reportar y gestionar falla | Crear, leer, actualizar estado | Cierre ligado a mantenimiento, permisos y evidencia |
| `eqp.InspeccionEquipo` | `POST /api/equipos/<id>/inspecciones`, lectura en detalle | Inspección | Crear y leer | Si actualización/eliminación son requeridas por DERCAS |
| `eqp.MantenimientoEquipo` | `GET/POST /api/mantenimientos`, `GET/PATCH /api/mantenimientos/<id>` | Programar, seguimiento y cierre | Crear, leer, actualizar por estados | Preventivo/correctivo, ejecutor, verificador, resultado y próxima revisión en SQL |
| `eqp.RepuestoMantenimiento` | `POST /api/mantenimientos/<id>/repuestos`, lectura en detalle | Agregar repuesto | Crear y leer | Edición, anulación y uso autorizado según DERCAS |

El código llama `eqp.usp_AppEquipoCrear`, `eqp.usp_AppEquipoCambiarEstado` y `eqp.usp_AppCrearMantenimiento`; existen por nombre en el script. Otras rutas ejecutan SQL parametrizado directamente. El Excel definitivo debe detallar cada operación y no asumir que los SP `usp_*_Eliminar` del script están expuestos a usuarios del portal.

## 7. Reportes y catálogos

| Reporte | Ruta HTML / datos | Filtros | Ficha | PDF | Estado |
|---|---|---|---|---|---|
| Usuarios | `renderUsuarios` / `GET /api/usuarios` | Búsqueda, estado, rol, fecha, orden y paginación | Hay gestión y consulta `GET /api/usuarios/<id>`; no se identificó ficha de reporte separada | No se identificó ruta PDF individual | Parcial frente al ejemplo obligatorio |
| Órdenes | `renderOrdenes` / `GET /api/ordenes` | Listado y filtros | `GET /api/ordenes/<id>` | `GET /api/ordenes/<id>/reporte.pdf` | Implementado; descarga real pendiente |
| Cotizaciones | `renderCotizaciones` / `GET /api/cotizaciones` | Búsqueda, estado, fecha, orden | `GET /api/cotizaciones/<id>/detalle` | `GET /api/cotizaciones/<id>/pdf` | Enlace y navegación probados; PDF real pendiente |
| Equipo y mantenimiento | `renderEquipos`, `renderMantenimientos` | Listados y filtros | Detalles por ID | No se identificó PDF individual | Cobertura según DERCAS por definir |
| Solicitudes, clientes, técnicos, garantías y servicios | Hay vistas/datos de portal | Variable | Variable | No se identificó matriz integral de PDF | Requiere decisión de alcance documentado |

El catálogo maestro usa `GET/POST /api/catalogo-maestro` y `PATCH /api/catalogo-maestro/<id>`; las tablas catálogo y SP figuran en el esquema. El script no confirma qué registros están cargados en la instancia. No se insertaron datos iniciales. La empresa debe aportar servicios/conceptos, unidades, categorías y precios de referencia aprobados, y validar qué estados son configurables antes de cualquier carga.

## 8. Incidencias previas, infraestructura y entrega

Las incidencias enumeradas en el prompt incluyen cancelación, cierre de OT, firma, documentos, equipos, cotizaciones, notificaciones, cuenta, vacaciones e importación de sedes. `docs/AUDITORIA.md` y las pruebas existentes documentan controles anteriores con dobles; `docs/VALIDACION_VM.md` describe el recorrido real pendiente. No se localizaron los 24 expedientes de incidencia con evidencia individual, de modo que su estado actual no puede darse por aprobado. La navegación de cotizaciones es la única incidencia corregida y probada en esta intervención.

La documentación del ZIP describe uso de dos VM Windows para app y SQL Server en AWS, y scripts para Waitress. HTTPS, SMTP, push, respaldos y conectividad final requieren evidencia de la instalación. Azure VM, App Service, Azure SQL Database, Managed Instance y Blob Storage permanecen alternativas por evaluar: compatibilidad de procedimientos/triggers, conectividad, costos, respaldos y migración. No se aprovisionaron recursos ni se modificó almacenamiento.

No se localizaron la carta de taller, guía con capturas, diapositivas, guías rápidas, plan de entrega firmado ni formulario de validación de visita. Deben prepararse sobre el flujo final verificado y dejar espacios de fecha, responsables y aceptación parcial sin suponer aprobación empresarial.

## 9. Plan de cumplimiento propuesto

| Prioridad | Actividad y dependencia | Ámbito | Estimación orientativa |
|---|---|---|---|
| Crítica | Obtener DERCAS final y definición oficial de módulos; fijar criterios medibles | Académico | 0.5–1 día de revisión |
| Crítica | Ejecutar `verificar_vm.bat` y `docs/VALIDACION_VM.md` con cuentas/datos de ensayo, incluyendo cotizaciones, PDF, versiones y aislamiento | Académico y empresarial | 2–4 días según acceso y hallazgos |
| Alta | Elaborar Excel CRUD de las seis tablas `eqp`, cruzando ruta, formulario, SP, rol y resultado real | Académico | 1–2 días tras acceso SQL |
| Alta | Cerrar brecha del reporte de usuarios: ficha autorizada y PDF individual, después de validar alcance y campos permitidos | Académico | 1–3 días de implementación y prueba |
| Alta | Matriz de incidencias y regresión con las 24 evidencias originales | Académico | 1–2 días tras recibir evidencias |
| Media | Inventariar catálogos cargados; proponer carga idempotente con datos aprobados | Empresarial | 1–2 días; ejecución separada |
| Media | Documentar infraestructura actual y comparar opciones Azure con precios vigentes y supuestos; confirmar respaldos | Empresarial | 2–3 días de análisis |
| Media | Carta, taller, diapositivas, guías y formulario de visita; validar con la empresa | Académico y empresarial | 3–5 días tras estabilización |

Estas estimaciones son de trabajo técnico, no fechas ni compromisos de servicio. Cualquier función adicional o cambio SQL requiere contrastar DERCAS y la aprobación prevista en el prompt antes de implementarse.

## 10. Control de cambios y reversión

Archivos de código modificados: `java/portal-ui.js` y `java/sistema.js`. Motivo: conservar el contexto de cotización tras guardar/enviar y permitir reabrir su detalle. Riesgo residual: diferencias entre el frontend local y la versión desplegada, o fallos de SP/datos reales. Para revertir el cambio puntual, recuperar únicamente esos dos archivos del ZIP local fechado 19/10/2026 tras respaldar la versión actual; no sustituir el proyecto completo ni la configuración privada.

