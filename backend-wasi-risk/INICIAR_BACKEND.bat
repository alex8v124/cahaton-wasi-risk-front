@echo off
title WASI-RISK AI - Backend Local RIE-02 (Puerto 8000)
echo ===============================================================================
echo WASI-RISK AI (Nodux Sentinel) - Iniciando Backend FastAPI en http://localhost:8000
echo Swagger UI disponible en: http://localhost:8000/docs
echo ===============================================================================
python -m uvicorn engine.vps_api_soe:app --host 0.0.0.0 --port 8000 --reload
pause
