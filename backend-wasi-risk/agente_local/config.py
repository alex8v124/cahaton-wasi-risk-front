"""Rutas, modelos y parametros del agente local."""

import json
import os
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
DATA = RAIZ / "data"
ENGINE = RAIZ / "engine"
SCHEMAS = RAIZ / "schemas"

# motor_scoring_wasi.py y sanitizador_pii_sbs.py son del kit del equipo
if str(ENGINE) not in sys.path:
    sys.path.insert(0, str(ENGINE))

# OCR: los DOS modelos van por nombre. Si solo se fija el detector, PaddleOCR ignora lang="es"
# y usa el reconocedor "server" en lugar del latino.
OCR_DETECTOR = "PP-OCRv5_mobile_det"
OCR_RECONOCEDOR = "latin_PP-OCRv5_mobile_rec"
OCR_HILOS = int(os.getenv("WASI_HILOS", "12"))

OLLAMA_URL = os.getenv("WASI_OLLAMA_URL", "http://127.0.0.1:11434")
MODELO_LLM = os.getenv("WASI_LLM", "qwen2.5:7b")
LLM_TIMEOUT_SEG = float(os.getenv("WASI_LLM_TIMEOUT", "240"))

MODO_INFERENCIA = "ON_PREMISE_LOCAL_CPU"  # valor que ya existe en schema_output_soe_a_alejandro.json


def cargar_json(ruta: Path) -> dict:
    return json.loads(ruta.read_text(encoding="utf-8"))
