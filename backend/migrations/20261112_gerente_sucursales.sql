CREATE OR ALTER FUNCTION seg.ufn_SucursalesPermitidas(@UsuarioId bigint)
RETURNS TABLE
AS
RETURN
(
    SELECT sc.SucursalClienteId, sc.ClienteId
    FROM seg.Usuario u
    JOIN seg.Rol r ON r.RolId = u.RolId
    JOIN crm.ContactoCliente cc ON cc.ContactoClienteId = u.ContactoClienteId
    JOIN crm.Cliente c ON c.ClienteId = cc.ClienteId
    JOIN crm.SucursalCliente sc ON sc.ClienteId = c.ClienteId
    WHERE u.UsuarioId = @UsuarioId
      AND u.Activo = 1 AND r.Activo = 1 AND cc.Activo = 1
      AND c.Activo = 1
      AND UPPER(LTRIM(RTRIM(r.Nombre))) = N'CLIENTE'
);
