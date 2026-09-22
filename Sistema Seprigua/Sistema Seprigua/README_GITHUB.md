# SEPRIGUA — versión para GitHub

Esta carpeta es la versión de **código fuente segura para subir al repositorio**. No contiene `.env`, llaves privadas, documentos laborales privados ni `.venv`.

## Primer arranque local
1. Instala Python 3.13 (3.12+ también es válido) y Microsoft ODBC Driver 18 for SQL Server.
2. Copia `.env.example` como `.env` y completa los datos locales.
3. Ejecuta `preparar_local.bat` una sola vez.
4. Después usa `iniciar_local.bat`.

## Git
`.gitignore` ya excluye `.env`, `.venv`, `.seprigua-private`, uploads, backups, ZIP y llaves. No fuerces esos archivos al repositorio.

## Importante
Esta variante es para **GitHub como repositorio de código**. El portal actual usa Flask, sesiones/cookies y rutas `/api/*`; no es una exportación puramente estática para GitHub Pages.

## Base de datos
No se modifica la estructura de SQL Server desde esta entrega. Cualquier parche SQL debe mantenerse como archivo separado del sistema.
