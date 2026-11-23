from pathlib import Path
import sys
from fastapi import FastAPI

ROOT_DIR = Path(__file__).resolve().parent.parent
BACKEND_DIR = ROOT_DIR / "backend-wasi-risk"
ENGINE_DIR = BACKEND_DIR / "engine"

for p in (str(BACKEND_DIR), str(ENGINE_DIR)):
    if p not in sys.path:
        sys.path.insert(0, p)

from engine.vps_api_soe import app as backend_app  # noqa: E402

app = FastAPI(title="WASI-RISK AI (Nodux Sentinel) — Vercel Fullstack API")
app.mount("/api", backend_app)
app.mount("/", backend_app)
