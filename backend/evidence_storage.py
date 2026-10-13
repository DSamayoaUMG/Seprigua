"""Límite de almacenamiento de evidencias: binarios y metadatos existentes.

La migración empresarial deberá sustituir esta implementación y mantener
los controles de pertenencia de la API; no existe una alternativa local silenciosa.
"""
class DatabaseEvidenceStorage:
    def __init__(self,execute_row):self.execute_row=execute_row
    def save(self,cursor,arguments):
        return self.execute_row(cursor,'EXEC srv.usp_EvidenciaServicio_CrearConArchivo ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?',arguments)
    def load(self,cursor,sql,arguments):
        # La consulta autorizada existente devuelve metadatos junto con Contenido.
        return self.execute_row(cursor,sql,arguments)
