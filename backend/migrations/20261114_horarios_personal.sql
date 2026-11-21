IF OBJECT_ID(N'rh.HorarioEmpleado', N'U') IS NULL
BEGIN
    CREATE TABLE rh.HorarioEmpleado (
        EmpleadoId bigint NOT NULL REFERENCES rh.Empleado(EmpleadoId),
        Fecha date NOT NULL,
        Inicio time(0) NOT NULL,
        Fin time(0) NOT NULL,
        CONSTRAINT PK_HorarioEmpleado PRIMARY KEY (EmpleadoId, Fecha),
        CONSTRAINT CK_HorarioEmpleado_Rango CHECK (Inicio < Fin)
    );
END;

IF OBJECT_ID(N'srv.TrabajoExtraAutorizado', N'U') IS NULL
BEGIN
    CREATE TABLE srv.TrabajoExtraAutorizado (
        OrdenTrabajoId bigint NOT NULL REFERENCES srv.OrdenTrabajo(OrdenTrabajoId),
        EmpleadoId bigint NOT NULL REFERENCES rh.Empleado(EmpleadoId),
        AutorizadoPorUsuarioId bigint NOT NULL REFERENCES seg.Usuario(UsuarioId),
        AutorizadoEn datetime2(0) NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_TrabajoExtraAutorizado PRIMARY KEY (OrdenTrabajoId, EmpleadoId)
    );
END;
