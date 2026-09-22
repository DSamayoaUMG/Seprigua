@echo off
setlocal EnableExtensions
cd /d "%~dp0"
if not exist ".env" (
  echo [ERROR] Copia .env.example a .env y completa la configuracion.
  exit /b 1
)
if exist ".venv\Scripts\python.exe" goto install
where py >nul 2>nul
if not errorlevel 1 (
  py -3.13 -m venv .venv >nul 2>nul
  if exist ".venv\Scripts\python.exe" goto install
  py -3 -m venv .venv
  goto install
)
where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Instala Python 3.13 ^(o 3.12+^) y vuelve a ejecutar este archivo.
  exit /b 1
)
python -m venv .venv
:install
if not exist ".venv\Scripts\python.exe" (
  echo [ERROR] No se pudo crear el entorno virtual.
  exit /b 1
)
echo [1/3] Actualizando pip...
".venv\Scripts\python.exe" -m pip install --disable-pip-version-check --upgrade pip
if errorlevel 1 exit /b 1
echo [2/3] Instalando dependencias...
".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -r requirements.txt
if errorlevel 1 exit /b 1
echo [3/3] Verificando SQL Server y objetos requeridos...
".venv\Scripts\python.exe" -m backend.diagnostico
if errorlevel 1 exit /b 1
echo.
echo [OK] SEPRIGUA preparado. A partir de ahora usa iniciar_vm.bat o iniciar_local.bat.
exit /b 0
