@echo off
setlocal EnableExtensions
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo [ERROR] Falta .venv. Ejecuta preparar_vm.bat primero.
  exit /b 1
)
".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -r requirements.txt
exit /b %errorlevel%
