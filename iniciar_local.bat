@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title SEPRIGUA - Entorno Local

echo ==============================================
echo          SEPRIGUA - ENTORNO LOCAL
echo ==============================================
echo.

REM 1. Detectar Python del sistema
where py >nul 2>nul
if %errorlevel%==0 (
    set "PYTHON=py"
) else (
    where python >nul 2>nul
    if %errorlevel%==0 (
        set "PYTHON=python"
    ) else (
        echo [ERROR] No se encontro Python instalado.
        echo Instala Python y marca "Add Python to PATH".
        echo.
        pause
        exit /b 1
    )
)

REM 2. Validar entorno virtual existente.
REM Si fue copiado desde otra PC/ruta, se elimina y se vuelve a crear.
set "RECREAR_VENV=0"

if not exist ".venv\Scripts\python.exe" (
    set "RECREAR_VENV=1"
) else (
    ".venv\Scripts\python.exe" --version >nul 2>nul
    if errorlevel 1 set "RECREAR_VENV=1"
)

if "%RECREAR_VENV%"=="1" (
    echo [1/5] Recreando entorno virtual local...
    if exist ".venv" rmdir /S /Q ".venv"
    %PYTHON% -m venv .venv

    if not exist ".venv\Scripts\python.exe" (
        echo.
        echo [ERROR] No se pudo crear .venv.
        pause
        exit /b 1
    )
) else (
    echo [1/5] Entorno virtual valido.
)

REM 3. Revisar .env
if not exist ".env" (
    echo.
    echo [ERROR] No existe el archivo .env en la carpeta principal.
    echo Debe estar junto a iniciar_local.bat.
    echo.
    pause
    exit /b 1
) else (
    echo [2/5] Archivo .env encontrado.
)

REM 4. Instalar/verificar dependencias
echo [3/5] Instalando/verificando dependencias...
".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -q flask pyodbc argon2-cffi python-dotenv waitress

if errorlevel 1 (
    echo.
    echo [ERROR] No fue posible instalar las dependencias.
    echo Revisa tu conexion a Internet.
    echo.
    pause
    exit /b 1
)

REM 5. Diagnosticar SQL Server antes de arrancar
echo [4/5] Probando conexion con SQL Server...
".venv\Scripts\python.exe" "backend\diagnostico.py"
if errorlevel 1 (
    echo.
    echo ==============================================
    echo NO SE INICIO EL SISTEMA porque la BD no responde.
    echo Revisa el mensaje anterior.
    echo ==============================================
    echo.
    pause
    exit /b 1
)

REM 6. Iniciar Flask
echo.
echo [5/5] Iniciando SEPRIGUA...
echo.
echo Pagina: http://127.0.0.1:5000
echo Login:  http://127.0.0.1:5000/login
echo Prueba BD: http://127.0.0.1:5000/api/db/health
echo.
echo NO CIERRES ESTA VENTANA mientras uses el sistema.
echo ==============================================
echo.

".venv\Scripts\python.exe" "backend\app.py"

echo.
echo ==============================================
echo El servidor se detuvo.
echo Si aparecio un error arriba, toma una captura.
echo ==============================================
pause
