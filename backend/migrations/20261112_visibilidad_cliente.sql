SET XACT_ABORT ON;

BEGIN TRANSACTION;
IF OBJECT_ID(N'seg.VisibilidadCliente', N'U') IS NULL
BEGIN
    CREATE TABLE seg.VisibilidadCliente (
        UsuarioId bigint NOT NULL PRIMARY KEY REFERENCES seg.Usuario(UsuarioId),
        ContactoClienteId bigint NOT NULL REFERENCES crm.ContactoCliente(ContactoClienteId),
        Modo varchar(12) NOT NULL CHECK (Modo IN ('SUCURSAL', 'ENCARGADO', 'SUPERVISOR'))
    );
END;
IF DATABASE_PRINCIPAL_ID(N'seprigua_produccion') IS NOT NULL
    GRANT SELECT, INSERT, UPDATE ON seg.VisibilidadCliente TO seprigua_produccion;
IF DATABASE_PRINCIPAL_ID(N'seprigua_pruebas') IS NOT NULL
    GRANT SELECT, INSERT, UPDATE ON seg.VisibilidadCliente TO seprigua_pruebas;
COMMIT TRANSACTION;
