@echo off
setlocal
cd /d "%~dp0"

title SEPRIGUA - Entorno Local

echo ==============================================
echo          SEPRIGUA - ENTORNO LOCAL
echo ==============================================
echo.

REM ------------------------------------------------
REM 1. Detectar Python
REM ------------------------------------------------
where py >nul 2>nul
if %errorlevel%==0 (
    set "PYTHON=py"
) else (
    where python >nul 2>nul
    if %errorlevel%==0 (
        set "PYTHON=python"
    ) else (
        echo [ERROR] No se encontro Python instalado.
        echo Instala Python y marca la opcion "Add Python to PATH".
        echo.
        pause
        exit /b 1
    )
)

REM ------------------------------------------------
REM 2. Crear entorno virtual si no existe
REM ------------------------------------------------
if not exist ".venv\Scripts\python.exe" (
    echo [1/4] Creando entorno virtual...
    %PYTHON% -m venv .venv

    if not exist ".venv\Scripts\python.exe" (
        echo.
        echo [ERROR] No se pudo crear el entorno virtual.
        pause
        exit /b 1
    )
) else (
    echo [1/4] Entorno virtual encontrado.
)

REM ------------------------------------------------
REM 3. Crear .env si no existe
REM ------------------------------------------------
if not exist ".env" (
    if exist ".env.example" (
        echo [2/4] Creando archivo .env...
        copy /Y ".env.example" ".env" >nul
        echo.
        echo Se creo .env usando .env.example.
        echo Si tu servidor de SQL Server no es localhost,
        echo abre .env y cambia DB_SERVER por el mismo servidor que usas en SSMS.
        echo.
        pause
    ) else (
        echo.
        echo [ERROR] No se encontro .env.example.
        echo Este archivo debe estar en la misma carpeta que iniciar_local.bat.
        echo.
        pause
        exit /b 1
    )
) else (
    echo [2/4] Archivo .env encontrado.
)

REM ------------------------------------------------
REM 4. Instalar dependencias
REM No depende de requirements.txt.
REM ------------------------------------------------
echo [3/4] Instalando/verificando dependencias...
".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -q flask pyodbc argon2-cffi python-dotenv

if errorlevel 1 (
    echo.
    echo [ERROR] No fue posible instalar las dependencias de Python.
    echo Revisa tu conexion a Internet y vuelve a intentarlo.
    echo.
    pause
    exit /b 1
)

REM ------------------------------------------------
REM 5. Comprobar backend
REM ------------------------------------------------
if not exist "backend\app.py" (
    echo.
    echo [ERROR] No se encontro backend\app.py.
    echo Verifica que iniciar_local.bat este en la carpeta principal del sistema.
    echo.
    pause
    exit /b 1
)

echo [4/4] Iniciando SEPRIGUA...
echo.
echo Pagina: http://127.0.0.1:5000
echo Login:  http://127.0.0.1:5000/login
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
