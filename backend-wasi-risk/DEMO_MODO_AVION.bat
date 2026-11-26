@echo off
rem Evidencia en modo avion con grabacion de pantalla. Antes: desconectar el cable Ethernet y activar el modo avion.
chcp 65001 >nul
cd /d "%~dp0"
set PYTHONDONTWRITEBYTECODE=1
if "%WASI_PYTHON%"=="" set "WASI_PYTHON=%USERPROFILE%\wasi-venv\Scripts\python.exe"
"%WASI_PYTHON%" -X utf8 -W ignore -m agente_local.demo_modo_avion --grabar %*
echo.
pause
