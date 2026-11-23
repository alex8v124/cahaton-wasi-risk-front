# cahaton-wasi-risk-front

**WASI-RISK AI (Nodux Sentinel) v2.6 — Cajathón Caja Trujillo · Desafío RIE-02 ("Descubrir redes de riesgo ocultas")**

Plataforma fullstack lista para despliegue **Todo-en-1 en Vercel** (Frontend PWA `< 60 KB gzip` + Backend FastAPI en `/api/*` con 0 dependencias pesadas) o **Frontend en Vercel + Backend en Hugging Face Spaces (`backend-wasi-risk/Dockerfile`)**.

## Arquitectura
- **Plano 1 (`/campo`):** PWA ligera del asesor en campo (`< 60 KB gzip`, offline-first con IndexedDB, Sanitizador PII v2 de 5 capas, Semáforo de Nitidez y vista previa real de los 7 documentos PNG del Kit de Soe).
- **Plano 2 (`/consola`):** Consola del Especialista de Riesgos con tablero de 4 carriles (Verde, Ámbar, Rojo, Gris Poka-Yoke), grafo interactivo 1/2 saltos, línea de tiempo cronológica, validación `RN-07` / `RN-08` y métricas `CP-09`.
- **Backend (`/api/*` · `backend-wasi-risk/engine/vps_api_soe.py`):** 8 endpoints oficiales RIE-02 (`GET /health`, `GET /sunat/{ruc}`, `POST /solicitudes/analizar`, `GET /red/{id}?saltos=1|2`, `GET /alertas`, `POST /alertas/{id}/decision`, `GET /casos-simulados`, `GET /metricas`) + `GET /imagenes_golden_samples/{filename}`.

## Ejecución local
```bash
# Backend FastAPI (puerto 8000)
cd backend-wasi-risk
pip install -r requirements.txt
python -m uvicorn engine.vps_api_soe:app --host 0.0.0.0 --port 8000

# Frontend Vite (puerto 5173)
npm install
npm run dev
```
