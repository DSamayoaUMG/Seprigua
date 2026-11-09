SET XACT_ABORT ON;
IF OBJECT_ID(N'seg.RegistroPruebaQA', N'U') IS NULL
BEGIN
    CREATE TABLE seg.RegistroPruebaQA (
        Entidad nvarchar(80) NOT NULL,
        RegistroId bigint NOT NULL,
        Lote nvarchar(30) NOT NULL,
        MarcadoEn datetime2(0) NOT NULL CONSTRAINT DF_RegistroPruebaQA_MarcadoEn DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_RegistroPruebaQA PRIMARY KEY (Entidad, RegistroId)
    );
    CREATE INDEX IX_RegistroPruebaQA_Lote ON seg.RegistroPruebaQA(Lote, Entidad);
END;

;WITH Pruebas AS (
    SELECT N'srv.SolicitudServicio' AS Entidad, CAST(s.SolicitudServicioId AS bigint) AS RegistroId
    FROM srv.SolicitudServicio s WHERE s.SolicitudServicioId BETWEEN 19 AND 29 AND s.DescripcionProblema LIKE N'%PRUEBA QA 20261031%'
    UNION ALL SELECT N'srv.OrdenTrabajo', o.OrdenTrabajoId FROM srv.OrdenTrabajo o
        JOIN srv.SolicitudServicio s ON s.SolicitudServicioId=o.SolicitudServicioId
        WHERE s.SolicitudServicioId BETWEEN 19 AND 29 AND s.DescripcionProblema LIKE N'%PRUEBA QA 20261031%'
    UNION ALL SELECT N'cot.Cotizacion', q.CotizacionId FROM cot.Cotizacion q
        JOIN srv.OrdenTrabajo o ON o.OrdenTrabajoId=q.OrdenTrabajoId
        JOIN srv.SolicitudServicio s ON s.SolicitudServicioId=o.SolicitudServicioId
        WHERE s.SolicitudServicioId BETWEEN 19 AND 29 AND s.DescripcionProblema LIKE N'%PRUEBA QA 20261031%'
    UNION ALL SELECT N'crm.SucursalCliente', sc.SucursalClienteId FROM crm.SucursalCliente sc
        WHERE sc.SucursalClienteId=319 AND sc.Nombre LIKE N'%PRUEBA QA 20261031%'
    UNION ALL SELECT N'crm.UbicacionServicio', u.UbicacionServicioId FROM crm.UbicacionServicio u
        JOIN crm.SucursalCliente sc ON sc.SucursalClienteId=u.SucursalClienteId
        WHERE sc.SucursalClienteId=319 AND sc.Nombre LIKE N'%PRUEBA QA 20261031%'
    UNION ALL SELECT N'rh.SolicitudVacacion', v.SolicitudVacacionId FROM rh.SolicitudVacacion v
        WHERE v.SolicitudVacacionId IN (4,5) AND v.Motivo LIKE N'%PRUEBA QA 20261031%'
    UNION ALL SELECT N'doc.ArchivoUsuario', a.ArchivoUsuarioId FROM doc.ArchivoUsuario a
        WHERE a.ArchivoUsuarioId IN (6,7) AND a.Descripcion LIKE N'%PRUEBA QA 20261031%'
    UNION ALL SELECT N'srv.IncidenciaOrden', i.IncidenciaOrdenId FROM srv.IncidenciaOrden i
        JOIN srv.OrdenTrabajo o ON o.OrdenTrabajoId=i.OrdenTrabajoId
        JOIN srv.SolicitudServicio s ON s.SolicitudServicioId=o.SolicitudServicioId
        WHERE s.SolicitudServicioId BETWEEN 19 AND 29 AND s.DescripcionProblema LIKE N'%PRUEBA QA 20261031%'
    UNION ALL SELECT N'com.Notificacion', n.NotificacionId FROM com.Notificacion n
        WHERE n.Mensaje LIKE N'%PRUEBA QA 20261031%'
           OR (n.Entidad=N'SolicitudServicio' AND n.EntidadId BETWEEN 19 AND 29)
           OR (n.Entidad=N'OrdenTrabajo' AND n.EntidadId BETWEEN 17 AND 20)
           OR (n.Entidad=N'Cotizacion' AND n.EntidadId=10)
           OR (n.Entidad=N'Vacaciones' AND n.EntidadId IN (4,5))
           OR (n.Entidad=N'Cancelacion' AND n.EntidadId IN (491,499))
)
INSERT INTO seg.RegistroPruebaQA(Entidad,RegistroId,Lote)
SELECT DISTINCT p.Entidad,p.RegistroId,N'QA-20261031' FROM Pruebas p
WHERE NOT EXISTS (SELECT 1 FROM seg.RegistroPruebaQA q WHERE q.Entidad=p.Entidad AND q.RegistroId=p.RegistroId);
