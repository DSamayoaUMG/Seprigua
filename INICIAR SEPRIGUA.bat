@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
title SEPRIGUA - Sistema Local

set "URL=http://127.0.0.1:5000/login"
set "HOST=127.0.0.1"
set "PORT=5000"
set "COOKIE_SECURE=false"
set "TRUST_PROXY_HEADERS=false"
set "ENABLE_HSTS=false"

cls
echo ============================================================
echo                  SEPRIGUA - SISTEMA LOCAL
echo ============================================================
echo.
echo Version completa: codigo + .env + .venv + dependencias.
echo Solo deja esta ventana abierta mientras uses el sistema.
echo.

if not exist ".env" goto :NO_ENV
if not exist "requirements.lock.txt" goto :NO_REQ

rem Si ya esta levantado, solo abre el navegador.
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r=Invoke-WebRequest -UseBasicParsing -Uri '%URL%' -TimeoutSec 2; if($r.StatusCode -ge 200 -and $r.StatusCode -lt 500){exit 0}else{exit 1} } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 (
    echo [OK] SEPRIGUA ya esta ejecutandose.
    start "" "%URL%"
    exit /b 0
)

set "VENV_OK=0"
if exist ".venv\Scripts\python.exe" (
    ".venv\Scripts\python.exe" -c "import sys; assert sys.version_info >= (3,11)" >nul 2>&1
    if not errorlevel 1 set "VENV_OK=1"
)

if "%VENV_OK%"=="0" (
    echo [AVISO] El .venv incluido no puede ejecutarse en esta PC.
    echo         Intentare reconstruirlo automaticamente.
    echo.
    call :FIND_PYTHON
    if not defined PY_CMD goto :NO_PYTHON
    if exist ".venv" rmdir /s /q ".venv"
    call %PY_CMD% -m venv .venv
    if errorlevel 1 goto :VENV_ERROR
)

echo [1/3] Verificando entorno virtual...
".venv\Scripts\python.exe" -c "import flask,waitress,pyodbc,argon2,dotenv,PIL,reportlab,cryptography,pywebpush,tzdata" >nul 2>&1
if errorlevel 1 (
    echo [AVISO] Faltan dependencias. Instalando las versiones del proyecto...
    ".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -r requirements.lock.txt
    if errorlevel 1 goto :PIP_ERROR
)

echo [2/3] Dependencias listas.
echo [3/3] Iniciando servidor local...
echo.
echo URL: %URL%
echo.
echo Para apagar SEPRIGUA, presiona Ctrl+C o cierra esta ventana.
echo ============================================================
echo.

rem Abre el navegador solo cuando Waitress ya responda.
start "" /b powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "$u='%URL%'; for($i=0;$i -lt 120;$i++){ try { $r=Invoke-WebRequest -UseBasicParsing -Uri $u -TimeoutSec 2; if($r.StatusCode -ge 200 -and $r.StatusCode -lt 500){Start-Process $u; exit 0} } catch {}; Start-Sleep -Milliseconds 500 }; exit 1" >nul 2>&1

".venv\Scripts\python.exe" -m backend.run_waitress
set "APP_ERROR=%errorlevel%"

echo.
if not "%APP_ERROR%"=="0" (
    echo [ERROR] SEPRIGUA se detuvo con codigo %APP_ERROR%.
    echo.
    echo Si el mensaje menciona SQL Server, verifica que:
    echo - SQL Server este encendido.
    echo - la direccion configurada en .env sea accesible.
    echo - tengas instalado Microsoft ODBC Driver 18 for SQL Server.
    echo - el parche SP de la entrega final ya haya sido aplicado una vez.
    echo.
    pause
)
exit /b %APP_ERROR%

:FIND_PYTHON
set "PY_CMD="
py -3.13 -c "import sys" >nul 2>&1
if not errorlevel 1 set "PY_CMD=py -3.13"
if defined PY_CMD exit /b 0
py -3.12 -c "import sys" >nul 2>&1
if not errorlevel 1 set "PY_CMD=py -3.12"
if defined PY_CMD exit /b 0
py -3.11 -c "import sys" >nul 2>&1
if not errorlevel 1 set "PY_CMD=py -3.11"
if defined PY_CMD exit /b 0
python -c "import sys; assert sys.version_info >= (3,11)" >nul 2>&1
if not errorlevel 1 set "PY_CMD=python"
exit /b 0

:NO_ENV
echo [ERROR] Falta .env. Esta entrega deberia incluirlo.
echo Vuelve a extraer el ZIP completo.
pause
exit /b 1

:NO_REQ
echo [ERROR] Falta requirements.lock.txt.
echo Vuelve a extraer el ZIP completo.
pause
exit /b 1

:NO_PYTHON
echo [ERROR] El .venv incluido no funciona en esta PC y no se encontro Python 3.11+
echo instalado para reconstruirlo.
echo.
echo Si esta es la misma PC donde trabajabas SEPRIGUA, comprueba que Python 3.13
 echo siga instalado. De lo contrario instala Python 3.13 de 64 bits y vuelve a abrir.
pause
exit /b 1

:VENV_ERROR
echo [ERROR] No se pudo reconstruir .venv.
pause
exit /b 1

:PIP_ERROR
echo [ERROR] No se pudieron instalar las dependencias faltantes.
echo Si el .venv incluido no era compatible, conecta esta PC a Internet y reintenta.
pause
exit /b 1
