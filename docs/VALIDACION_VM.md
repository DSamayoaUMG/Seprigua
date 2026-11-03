# Recorrido de integración contra SQL Server

Esta guía no es un registro de pruebas ejecutadas aquí. Use cuentas/registros de ensayo y conserve trazabilidad; los pasos funcionales crean o actualizan datos de ensayo. El diagnóstico inicial es de lectura.

1. Respalde BD/configuración/archivos privados y ejecute `verificar_vm.bat`. Compare el inventario local (`python -m backend.diagnostico --contrato`) con metadatos, parámetros, permisos y restricciones reales (`python -m backend.diagnostico --json`). No cree columnas para ocultar discrepancias.
2. Inicie Waitress y acceda desde la VM y otra computadora. Compruebe que consola/red del navegador no muestran fallos de recursos locales.
3. **Cliente:** cree solicitud con sede, urgencia, descripción y adjunto. Recargue y abra otra sesión; debe conservarse. Otro cliente no debe acceder a su ID.
4. **Coordinador:** convierta en OT y asigne Supervisor y Operario. Ambos deben ver el mismo flujo, conservando categoría y función de cuadrilla por separado.
5. **Agenda:** mueva hora e integrante, guarde y recargue ambos portales. Intente versión original antigua, misma hora de otra OT, empleado inactivo o en vacaciones: rechazo sin guardar un lote parcial. En móvil pruebe Planificar.
6. **Emergencia:** priorice una nueva OT manteniendo trabajos futuros. El inicio simultáneo con el mismo integrante debe rechazarse.
7. **Empleado:** inicie OT, registre actividad, fotos antes/después y firma; recargue y descargue informe/evidencias. Un empleado ajeno debe recibir 403/404.
8. Finalice sin cotización emitida/aceptada, cumpliendo evidencias y ticket según configuración. Si un SP instalado impone otra regla, registre nombre/definición para ajustar solo ese SP. Verifique estado después de cerrar sesión.
9. **Vacaciones:** solicite, apruebe y compruebe aviso y disponibilidad por fecha. Una OT que coincide exige reasignación previa. En otras solicitudes pruebe rechazo con motivo y REPROGRAMAR → corrección/reenvío del empleado → nueva resolución. El empleado no puede aprobar, editar solicitudes ajenas ni cancelar por sí solo una aprobación. Recargue cada rol.
10. **Cotización:** seleccione catálogo, agregue varias líneas y una libre, ajuste precio con motivo/descuento/impuesto, guarde y compare PDF tras recargar. La línea libre no entra al catálogo salvo acción expresa. Pruebe duplicados de catálogo y nueva versión con motivo; conserve moneda. Envíe y responda como cliente. Una cotización cerrada no admite otra versión.
11. **Cancelación:** cliente solicita sobre solicitud sin convertir u OT abierta y confirma. Coordinación rechaza con motivo; otra petición se aprueba. Recargue cliente/coordinador: resolución e historial deben persistir sin borrar el trabajo. No se acepta dos veces la misma resolución. Marcar leído no cambia la resolución.
12. **Personal:** abra historial y resumen semanal. Cada OT cuenta una vez por persona; distinga OT únicas de participaciones. Canceladas no son completadas; las horas no deben presentarse como salario individual.
13. **Equipo:** inspección, falla y mantenimiento vinculado; recorra diagnóstico, autorización, ejecución, verificación y finalización/corrección. Compruebe ejecutor, verificador, repuestos y avisos. No habilite un equipo con fallas pendientes ni use repuestos sin autorización.
14. **Documentos:** suba expediente, recargue, descargue, verifique y archive con el rol permitido. Pruebe imagen dañada, ZIP renombrado DOCX, vacío y archivo sobre el límite. Rechazo sin metadatos/archivos huérfanos. Un empleado no accede a expedientes ajenos.
15. **Garantía:** configure sobre OT completada, solicite revisión y resuelva. Recargue y confirme que el plazo parte de la finalización original y no se reinicia.
16. **Permisos/sesiones:** rol sin módulo debe recibir 403 llamando directamente al endpoint; cierre/desactivación revoca acceso. Cliente/empleado no elevan permisos. No incluya contraseñas en los resultados.
17. **Push/SMTP:** con HTTPS, suscriba dispositivos por rol y pruebe solicitud, asignación, cambio, cierre, cancelación, cotización, vacaciones, equipo y garantía con ventana visible/en segundo plano. Con SMTP, pruebe recuperación desde URL canónica y rechazo de token reutilizado tras cambiar contraseña.
18. Pruebe filtros/búsqueda/orden/última página con más de una página; métricas globales en módulos aplicables. Revise teléfono/escritorio y temas. Distinga una vista previa sin guardar de un dato persistido.

Anote fecha, IDs de ensayo, resultado esperado/observado y evidencia. Registre discrepancias reales con objeto afectado y ajuste compatible; no marque el recorrido como aprobado sin ejecutarlo en la instancia correspondiente.
