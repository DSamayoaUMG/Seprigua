SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF COL_LENGTH('srv.SolicitudServicio', 'NumeroTicketCliente') IS NULL
    ALTER TABLE srv.SolicitudServicio ADD NumeroTicketCliente nvarchar(60) NULL;

IF OBJECT_ID('doc.ArchivoUsuarioAcceso', 'U') IS NULL
BEGIN
    CREATE TABLE doc.ArchivoUsuarioAcceso (
        ArchivoUsuarioAccesoId bigint IDENTITY(1,1) NOT NULL PRIMARY KEY,
        ArchivoUsuarioId bigint NOT NULL,
        BeneficiarioUsuarioId bigint NOT NULL,
        OtorgadoPorUsuarioId bigint NOT NULL,
        CreadoEn datetime2(0) NOT NULL DEFAULT SYSUTCDATETIME(),
        ExpiraEn datetime2(0) NOT NULL,
        RevocadoEn datetime2(0) NULL,
        CONSTRAINT FK_ArchivoUsuarioAcceso_Archivo FOREIGN KEY (ArchivoUsuarioId)
            REFERENCES doc.ArchivoUsuario(ArchivoUsuarioId) ON DELETE CASCADE,
        CONSTRAINT FK_ArchivoUsuarioAcceso_Beneficiario FOREIGN KEY (BeneficiarioUsuarioId)
            REFERENCES seg.Usuario(UsuarioId),
        CONSTRAINT FK_ArchivoUsuarioAcceso_Otorgante FOREIGN KEY (OtorgadoPorUsuarioId)
            REFERENCES seg.Usuario(UsuarioId)
    );
    CREATE INDEX IX_ArchivoUsuarioAcceso_Vigente
        ON doc.ArchivoUsuarioAcceso(BeneficiarioUsuarioId,ArchivoUsuarioId,ExpiraEn)
        INCLUDE (RevocadoEn);
END;

COMMIT TRANSACTION;
