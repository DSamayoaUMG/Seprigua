@echo off
setlocal EnableExtensions
cd /d "%~dp0"
if not exist ".env" (
  echo [ERROR] Falta .env. Ejecuta preparar_vm.bat primero.
  exit /b 1
)
if not exist ".venv\Scripts\python.exe" (
  echo [ERROR] Falta .venv. Ejecuta preparar_vm.bat primero.
  exit /b 1
)
".venv\Scripts\python.exe" -m backend.run_waitress
exit /b %errorlevel%
