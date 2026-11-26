@echo off
rem Levanta el agente local en http://127.0.0.1:8000  (documentacion en /docs)
chcp 65001 >nul
cd /d "%~dp0"
set PYTHONDONTWRITEBYTECODE=1
if "%WASI_PYTHON%"=="" set "WASI_PYTHON=%USERPROFILE%\wasi-venv\Scripts\python.exe"
"%WASI_PYTHON%" -X utf8 -W ignore -m agente_local.api
pause
