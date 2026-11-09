-- Datos de destinatario propios de la cotización, sin alta en CRM ni cuenta de portal.
IF COL_LENGTH('cot.Cotizacion', 'ProspectoNombre') IS NULL
    ALTER TABLE cot.Cotizacion ADD ProspectoNombre nvarchar(200) NULL;
IF COL_LENGTH('cot.Cotizacion', 'ProspectoCorreo') IS NULL
    ALTER TABLE cot.Cotizacion ADD ProspectoCorreo nvarchar(254) NULL;
IF COL_LENGTH('cot.Cotizacion', 'ProspectoTelefono') IS NULL
    ALTER TABLE cot.Cotizacion ADD ProspectoTelefono nvarchar(40) NULL;
