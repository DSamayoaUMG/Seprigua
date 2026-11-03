@echo off
setlocal
cd /d "%~dp0"
title SEPRIGUA - Servidor VM

where py >nul 2>nul
if %errorlevel%==0 (
    set "PYTHON=py"
) else (
    set "PYTHON=python"
)

if not exist ".venv\Scripts\python.exe" (
    echo [1/3] Creando entorno virtual...
    %PYTHON% -m venv .venv
) else (
    echo [1/3] Entorno virtual encontrado.
)

echo [2/3] Instalando/verificando dependencias...
".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -q -r requirements.txt

if not exist ".env" (
    echo [ERROR] Falta el archivo .env.
    pause
    exit /b 1
)

echo [3/3] Iniciando SEPRIGUA en 0.0.0.0:5000...
".venv\Scripts\waitress-serve.exe" --listen=0.0.0.0:5000 backend.app:app
pause
