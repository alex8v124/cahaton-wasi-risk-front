@echo off
rem Practica de la demo con red. Todo queda marcado como ENSAYO y no sirve como evidencia. No graba la pantalla.
chcp 65001 >nul
cd /d "%~dp0"
set PYTHONDONTWRITEBYTECODE=1
if "%WASI_PYTHON%"=="" set "WASI_PYTHON=%USERPROFILE%\wasi-venv\Scripts\python.exe"
"%WASI_PYTHON%" -X utf8 -W ignore -m agente_local.demo_modo_avion --ensayo %*
echo.
pause
