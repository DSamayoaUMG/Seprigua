-- Cambio aditivo para cotizaciones con o sin OT del sistema.
-- Ejecutar primero sobre una copia; conserva cotizaciones y movimientos existentes.
IF COL_LENGTH('cot.Cotizacion', 'SucursalClienteId') IS NULL
    ALTER TABLE cot.Cotizacion ADD SucursalClienteId bigint NULL;
IF COL_LENGTH('cot.Cotizacion', 'OrdenFisicaNumero') IS NULL
    ALTER TABLE cot.Cotizacion ADD OrdenFisicaNumero nvarchar(60) NULL;
GO
