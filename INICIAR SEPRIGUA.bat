@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
title SEPRIGUA - INICIO LOCAL
color 0B
cd /d "%~dp0"
set "ROOT=%~dp0"
set "URL=http://127.0.0.1:5000/login"
set "ENV_HOME=%LOCALAPPDATA%\SEPRIGUA"
set "VENV=%ENV_HOME%\venv-local"
set "PYTHON=%VENV%\Scripts\python.exe"
set "LOG=%ENV_HOME%\instalacion-local.log"

set "HOST=127.0.0.1"
set "PORT=5000"
set "COOKIE_SECURE=false"
set "TRUST_PROXY_HEADERS=false"
set "ENABLE_HSTS=false"
set "FLASK_DEBUG=false"
set "PYTHONUNBUFFERED=1"

if not exist "%ENV_HOME%" mkdir "%ENV_HOME%" >nul 2>&1

echo ===========================================================
echo                 SEPRIGUA - VERSION LOCAL
echo ===========================================================
echo URL: %URL%
echo.
echo Entorno Python fuera de OneDrive:
echo %VENV%
echo.

if not exist "%ROOT%.env" (
    echo [ERROR] Falta el .env privado del sistema.
    goto :ERROR
)
if not exist "%ROOT%requirements.txt" (
    echo [ERROR] Falta requirements.txt.
    goto :ERROR
)
if not exist "%ROOT%backend\run_waitress.py" (
    echo [ERROR] Falta el backend de SEPRIGUA.
    goto :ERROR
)

rem Si hay una instancia iniciada, no intentar usar el puerto otra vez.
powershell -NoProfile -Command "try {$x=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5000/login' -TimeoutSec 2 -ErrorAction Stop; if($x.StatusCode -lt 500){exit 0}}catch{};exit 1" >nul 2>&1
if not errorlevel 1 (
    echo [AVISO] El puerto 5000 ya responde. Verifica que sea SEPRIGUA.
    start "" "%URL%"
    goto :FIN
)

echo [1/4] Preparando Python sin utilizar el .venv antiguo...
if exist "%PYTHON%" (
    "%PYTHON%" -c "import sys; assert sys.version_info >= (3,11)" >nul 2>&1
    if errorlevel 1 (
        echo [AVISO] Entorno anterior dañado. Lo resguardare.
        move "%VENV%" "%VENV%-respaldo-%RANDOM%" >nul 2>&1
        if errorlevel 1 (
            echo [ERROR] No se pudo mover el entorno anterior. Cierra procesos Python que lo esten usando.
            goto :ERROR
        )
    )
)
if not exist "%PYTHON%" call :CREAR_VENV
if errorlevel 1 goto :ERROR

echo [2/4] Comprobando dependencias...
if not exist "%VENV%\requirements.installed.txt" goto :INSTALAR
fc /b "%ROOT%requirements.txt" "%VENV%\requirements.installed.txt" >nul 2>&1
if errorlevel 1 goto :INSTALAR
"%PYTHON%" -c "import flask,waitress,pyodbc,argon2,dotenv,PIL,reportlab,cryptography,pywebpush,tzdata,openpyxl" >nul 2>&1
if errorlevel 1 goto :INSTALAR
goto :DEPENDENCIAS_LISTAS

:INSTALAR
echo [INFO] Instalando requisitos desde requirements.txt...
echo [INFO] El registro estara en %LOG%
"%PYTHON%" -m pip install --disable-pip-version-check --prefer-binary -r "%ROOT%requirements.txt" >"%LOG%" 2>&1
if errorlevel 1 (
    echo [ERROR] No se pudieron instalar las dependencias.
    powershell -NoProfile -Command "Get-Content -LiteralPath '%LOG%' -Tail 22" 2>nul
    goto :ERROR
)
copy /Y "%ROOT%requirements.txt" "%VENV%\requirements.installed.txt" >nul
:DEPENDENCIAS_LISTAS
echo [OK] Dependencias listas.

echo [3/4] Comprobando Microsoft ODBC Driver 18...
"%PYTHON%" -c "import pyodbc; assert 'ODBC Driver 18 for SQL Server' in pyodbc.drivers()" >nul 2>&1
if errorlevel 1 (
    echo [ERROR] No se encontro Microsoft ODBC Driver 18 for SQL Server.
    echo Instala el controlador oficial de 64 bits y ejecuta de nuevo.
    goto :ERROR
)
echo [OK] ODBC Driver 18 disponible.

echo [4/4] Iniciando SEPRIGUA...
echo.
echo ============================================================== 
echo  Accede a %URL%
echo  Mantener abierta esta ventana. CTRL+C para apagar.
echo ============================================================== 
echo.
rem Abre el navegador solo cuando el servidor ya responda.
start "" /B powershell -NoProfile -WindowStyle Hidden -Command "$u='http://127.0.0.1:5000/login'; for($i=0;$i -lt 90;$i++){try {$r=Invoke-WebRequest -UseBasicParsing -Uri $u -TimeoutSec 2 -ErrorAction Stop; if($r.StatusCode -lt 500){Start-Process $u;break}}catch{}; Start-Sleep -Milliseconds 700}" >nul 2>&1
"%PYTHON%" -m backend.run_waitress
if errorlevel 1 (
    echo.
    echo [ERROR] El backend se detuvo. Revisa el error mostrado arriba.
    echo Si dice 18456, SQL Server rechazo la clave configurada en .env.
    echo Si dice timeout, revisa red y el puerto 1433 de SQL Server.
    goto :ERROR
)
goto :FIN

:CREAR_VENV
set "PY_LAUNCH="
py -3.13 -c "import sys" >nul 2>&1
if not errorlevel 1 set "PY_LAUNCH=py -3.13"
if defined PY_LAUNCH goto :CREAR_VENV_CONT
py -3.12 -c "import sys" >nul 2>&1
if not errorlevel 1 set "PY_LAUNCH=py -3.12"
if defined PY_LAUNCH goto :CREAR_VENV_CONT
py -3.11 -c "import sys" >nul 2>&1
if not errorlevel 1 set "PY_LAUNCH=py -3.11"
if defined PY_LAUNCH goto :CREAR_VENV_CONT
py -3.14 -c "import sys" >nul 2>&1
if not errorlevel 1 set "PY_LAUNCH=py -3.14"
if defined PY_LAUNCH goto :CREAR_VENV_CONT
python -c "import sys; assert sys.version_info >= (3,11)" >nul 2>&1
if not errorlevel 1 set "PY_LAUNCH=python"
if not defined PY_LAUNCH (
    echo [ERROR] Instala Python 3.13 de 64 bits y vuelve a ejecutar el BAT.
    exit /b 1
)
:CREAR_VENV_CONT
echo [INFO] Creando entorno usando %PY_LAUNCH%...
%PY_LAUNCH% -m venv "%VENV%" >"%LOG%" 2>&1
if errorlevel 1 (
    echo [ERROR] No se pudo crear el entorno virtual. Detalle:
    type "%LOG%"
    exit /b 1
)
if not exist "%PYTHON%" (
    echo [ERROR] No se genero python.exe en el entorno nuevo.
    exit /b 1
)
exit /b 0

:ERROR
echo.
echo ===========================================================
echo Revisa los mensajes de error mostrados arriba.
echo La aplicacion y sus datos NO se han eliminado.
echo ===========================================================
pause
exit /b 1

:FIN
exit /b 0
