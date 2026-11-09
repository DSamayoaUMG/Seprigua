SET XACT_ABORT ON;

IF OBJECT_ID(N'seg.FotoPerfil', N'U') IS NULL
BEGIN
    CREATE TABLE seg.FotoPerfil (
        UsuarioId bigint NOT NULL PRIMARY KEY,
        Imagen varbinary(max) NOT NULL,
        MimeType varchar(30) NOT NULL CONSTRAINT DF_FotoPerfil_Mime DEFAULT ('image/webp'),
        PesoBytes int NOT NULL,
        ActualizadoEn datetime2(0) NOT NULL CONSTRAINT DF_FotoPerfil_ActualizadoEn DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_FotoPerfil_Usuario FOREIGN KEY (UsuarioId) REFERENCES seg.Usuario(UsuarioId),
        CONSTRAINT CK_FotoPerfil_Peso CHECK (PesoBytes>0 AND PesoBytes<=5242880)
    );
END;
