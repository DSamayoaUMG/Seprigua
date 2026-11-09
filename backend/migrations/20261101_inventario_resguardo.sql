SET XACT_ABORT ON;

IF OBJECT_ID(N'eqp.VehiculoInventario', N'U') IS NULL
BEGIN
    CREATE TABLE eqp.VehiculoInventario (
        VehiculoInventarioId int IDENTITY(1,1) NOT NULL PRIMARY KEY,
        Codigo nvarchar(30) NOT NULL,
        Nombre nvarchar(120) NOT NULL,
        Placa nvarchar(25) NULL,
        Activo bit NOT NULL CONSTRAINT DF_VehiculoInventario_Activo DEFAULT (1),
        CreadoEn datetime2(0) NOT NULL CONSTRAINT DF_VehiculoInventario_CreadoEn DEFAULT SYSUTCDATETIME(),
        ActualizadoEn datetime2(0) NOT NULL CONSTRAINT DF_VehiculoInventario_ActualizadoEn DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_VehiculoInventario_Codigo UNIQUE (Codigo)
    );
END;

IF OBJECT_ID(N'eqp.ResguardoEquipo', N'U') IS NULL
BEGIN
    CREATE TABLE eqp.ResguardoEquipo (
        EquipoId bigint NOT NULL PRIMARY KEY,
        Tipo nvarchar(12) NOT NULL,
        VehiculoInventarioId int NULL,
        BodegaNombre nvarchar(120) NULL,
        ActualizadoEn datetime2(0) NOT NULL CONSTRAINT DF_ResguardoEquipo_ActualizadoEn DEFAULT SYSUTCDATETIME(),
        ActualizadoPorUsuarioId bigint NULL,
        CONSTRAINT FK_ResguardoEquipo_Equipo FOREIGN KEY (EquipoId) REFERENCES eqp.Equipo(EquipoId),
        CONSTRAINT FK_ResguardoEquipo_Vehiculo FOREIGN KEY (VehiculoInventarioId) REFERENCES eqp.VehiculoInventario(VehiculoInventarioId),
        CONSTRAINT CK_ResguardoEquipo_Tipo CHECK (
            (Tipo=N'VEHICULO' AND VehiculoInventarioId IS NOT NULL AND BodegaNombre IS NULL) OR
            (Tipo=N'BODEGA' AND VehiculoInventarioId IS NULL AND BodegaNombre IS NOT NULL)
        )
    );
    CREATE INDEX IX_ResguardoEquipo_Vehiculo ON eqp.ResguardoEquipo(VehiculoInventarioId);
END;
