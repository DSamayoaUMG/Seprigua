SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF COL_LENGTH('cot.Cotizacion', 'ClienteId') IS NULL
    ALTER TABLE cot.Cotizacion ADD ClienteId bigint NULL;

IF EXISTS (SELECT 1 FROM sys.key_constraints
           WHERE parent_object_id=OBJECT_ID('cot.Cotizacion')
             AND name='UQ_cot_Cotizacion_1')
    ALTER TABLE cot.Cotizacion DROP CONSTRAINT UQ_cot_Cotizacion_1;

IF EXISTS (SELECT 1 FROM sys.foreign_keys
           WHERE parent_object_id=OBJECT_ID('cot.Cotizacion')
             AND name='FK_cot_Cotizacion_1_srv_OrdenTrabajo')
   AND EXISTS (SELECT 1 FROM sys.columns
               WHERE object_id=OBJECT_ID('cot.Cotizacion')
                 AND name='OrdenTrabajoId' AND is_nullable=0)
    ALTER TABLE cot.Cotizacion DROP CONSTRAINT FK_cot_Cotizacion_1_srv_OrdenTrabajo;

IF EXISTS (SELECT 1 FROM sys.columns
           WHERE object_id=OBJECT_ID('cot.Cotizacion')
             AND name='OrdenTrabajoId' AND is_nullable=0)
    ALTER TABLE cot.Cotizacion ALTER COLUMN OrdenTrabajoId bigint NULL;

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys
               WHERE parent_object_id=OBJECT_ID('cot.Cotizacion')
                 AND name='FK_cot_Cotizacion_1_srv_OrdenTrabajo')
    ALTER TABLE cot.Cotizacion WITH CHECK ADD CONSTRAINT FK_cot_Cotizacion_1_srv_OrdenTrabajo
    FOREIGN KEY(OrdenTrabajoId) REFERENCES srv.OrdenTrabajo(OrdenTrabajoId);

IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE object_id=OBJECT_ID('cot.Cotizacion')
                 AND name='UX_Cotizacion_OrdenTrabajoId_ConValor')
    CREATE UNIQUE INDEX UX_Cotizacion_OrdenTrabajoId_ConValor
        ON cot.Cotizacion(OrdenTrabajoId) WHERE OrdenTrabajoId IS NOT NULL;

GO

UPDATE q SET ClienteId=s.ClienteId
FROM cot.Cotizacion q
JOIN srv.OrdenTrabajo o ON o.OrdenTrabajoId=q.OrdenTrabajoId
JOIN srv.SolicitudServicio s ON s.SolicitudServicioId=o.SolicitudServicioId
WHERE q.ClienteId IS NULL;

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys
               WHERE parent_object_id=OBJECT_ID('cot.Cotizacion')
                 AND name='FK_Cotizacion_Cliente_Standalone')
    ALTER TABLE cot.Cotizacion WITH CHECK ADD CONSTRAINT FK_Cotizacion_Cliente_Standalone
    FOREIGN KEY(ClienteId) REFERENCES crm.Cliente(ClienteId);

COMMIT TRANSACTION;
