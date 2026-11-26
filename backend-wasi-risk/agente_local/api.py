"""API del agente local para la PWA.

    python -m agente_local.api

Variables:
  WASI_HOST          127.0.0.1 (por defecto). Para atender a otro equipo: 0.0.0.0, y exige WASI_API_KEY.
  WASI_PORT          8000
  WASI_API_KEY       si se define, toda peticion (menos /health) debe traer la cabecera X-API-Key
  WASI_CORS_ORIGINS  origenes permitidos separados por coma
"""

import email.parser
import email.policy
import hashlib
import hmac
import os
import re
import sys
import threading
import time
from collections import OrderedDict
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from . import candado_red, config, extractor_qwen
from .expediente import AuditorExpediente, EntradaInvalida
from .pipeline import AgenteLocal

MAXIMO_BYTES = 4 * 1024 * 1024
MAXIMO_EN_MEMORIA = 200
VIDA_SEGUNDOS = 3600
ORIGENES_DEFAULT = "http://localhost:3000,http://localhost:5173,http://127.0.0.1:5173,https://cahaton-wasi-risk.vercel.app"
ORIGENES = [o.strip() for o in os.getenv("WASI_CORS_ORIGINS", ORIGENES_DEFAULT).split(",") if o.strip()]

estado: dict = {}
lecturas: "OrderedDict[str, tuple]" = OrderedDict()  # hash -> (momento, Lectura); solo en RAM
candado_trabajo = threading.Lock()  # el OCR no admite llamadas simultaneas


def asegurar_inicializado() -> None:
    if "agente" not in estado or "auditor" not in estado:
        agente = AgenteLocal()
        try:
            agente.calentar()
            estado["modelo_listo"] = extractor_qwen._OLLAMA_DISPONIBLE
        except Exception:
            estado["modelo_listo"] = False
        estado["agente"], estado["auditor"] = agente, AuditorExpediente(agente)


@asynccontextmanager
async def ciclo(_app: FastAPI):
    asegurar_inicializado()
    yield
    lecturas.clear()


app = FastAPI(title="WASI-RISK AI - Agente local de proteccion de datos", version="0.1.0", lifespan=ciclo)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ORIGENES,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-API-Key", "X-RUC-Solicitante"],
)


def autorizar(request: Request, x_api_key: Optional[str] = Header(default=None)) -> None:
    clave = os.getenv("WASI_API_KEY", "")
    if clave:
        if not x_api_key or not hmac.compare_digest(x_api_key.encode(), clave.encode()):
            raise HTTPException(401, "Falta la cabecera X-API-Key o no es valida")
    elif request.client is not None and request.client.host not in ("127.0.0.1", "::1", "localhost", "testclient"):
        # En Vercel Serverless request.client.host puede ser IP interna del proxy
        if not os.getenv("VERCEL"):
            raise HTTPException(403, "Sin WASI_API_KEY solo se atiende a esta misma maquina")


def _vigentes() -> dict:
    limite = time.time() - VIDA_SEGUNDOS
    for huella in [h for h, (momento, _) in lecturas.items() if momento < limite]:
        del lecturas[huella]
    while len(lecturas) > MAXIMO_EN_MEMORIA:
        lecturas.popitem(last=False)
    return {h: lectura for h, (_, lectura) in lecturas.items()}


async def _extraer_campos_multipart(request: Request) -> Tuple[Dict[str, str], bytes]:
    """Extrae campos form-data y bytes de 'archivo' usando stdlib pura (sin requerir python-multipart)."""
    content_type = request.headers.get("content-type", "")
    if "multipart/form-data" not in content_type.lower():
        raise HTTPException(415, "Se requiere Content-Type: multipart/form-data")
    cuerpo = await request.body()
    cabecera_mime = f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode("latin-1")
    mensaje = email.parser.BytesParser(policy=email.policy.HTTP).parsebytes(cabecera_mime + cuerpo)
    campos: Dict[str, str] = {}
    archivo_bytes: Optional[bytes] = None
    for parte in mensaje.iter_parts():
        nombre = parte.get_param("name", header="content-disposition")
        if not nombre:
            continue
        payload = parte.get_payload(decode=True) or b""
        if nombre == "archivo" or parte.get_filename() is not None:
            archivo_bytes = payload
        else:
            campos[nombre] = payload.decode("utf-8", errors="replace").strip()
    if archivo_bytes is None:
        raise HTTPException(422, "Falta el campo 'archivo' en el formulario multipart")
    return campos, archivo_bytes


def procesar_ocr_documento(
    expediente_id: str,
    doc_id: str,
    hash_sha256_original: str,
    contenido: bytes,
    nombre_titular: Optional[str] = None,
) -> dict:
    asegurar_inicializado()
    if not re.fullmatch(r"^(?:EXP|SOL)-TRUJ-2026-[0-9]{4}$", expediente_id):
        raise HTTPException(422, "expediente_id debe cumplir el formato EXP-TRUJ-2026-XXXX")
    if len(doc_id) < 3:
        raise HTTPException(422, "doc_id debe tener al menos 3 caracteres")
    if not re.fullmatch(r"^[a-f0-9]{64}$", hash_sha256_original):
        raise HTTPException(422, "hash_sha256_original debe ser SHA-256 hex de 64 caracteres en minuscula")
    if len(contenido) > MAXIMO_BYTES:
        raise HTTPException(413, "La foto supera los 4 MB")
    if not (contenido.startswith(b"\xff\xd8\xff") or contenido.startswith(b"\x89PNG\r\n\x1a\n")):
        raise HTTPException(415, "Solo se aceptan JPEG o PNG")
    if hashlib.sha256(contenido).hexdigest() != hash_sha256_original:
        raise HTTPException(422, "El SHA-256 no coincide con el archivo recibido")

    t0 = time.perf_counter()
    with candado_trabajo:
        try:
            lectura = estado["agente"].leer_documento(
                contenido, doc_id, [nombre_titular] if nombre_titular else []
            )
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        lecturas[hash_sha256_original] = (time.time(), lectura)
        _vigentes()
    aprobado = not lectura.guardia_hallazgos
    return {
        "expediente_id": expediente_id,
        "doc_id": doc_id,
        "hash_sha256": hash_sha256_original,
        "semaforo": lectura.semaforo,
        "requiere_nueva_foto": lectura.requiere_nueva_foto,
        "motivos": lectura.motivos,
        "tipo_documento_detectado": lectura.tipo or None,
        # si la guardia encontro algo, el texto no sale ni hacia la PWA
        "texto_ocr_sanitizado": lectura.texto_sanitizado if aprobado else "",
        "confianza_ocr": lectura.confianza_ocr,
        "guardia_de_salida": {"aprobado": aprobado, "hallazgos": lectura.guardia_hallazgos},
        "datos_personales_tapados": lectura.datos_personales_tapados,
        "segundos": round(time.perf_counter() - t0, 2),
    }


def procesar_auditoria_expediente(entrada: dict, x_ruc_solicitante: Optional[str] = None) -> dict:
    asegurar_inicializado()
    with candado_trabajo:
        try:
            return estado["auditor"].auditar(entrada, _vigentes(), x_ruc_solicitante)
        except EntradaInvalida as exc:
            raise HTTPException(
                422,
                {"error": "La entrada no cumple schema_input_alexander_a_soe.json", "detalle": exc.errores},
            ) from exc
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc


@app.get("/health")
def health() -> dict:
    asegurar_inicializado()
    return {
        "estado": "OK",
        "status": "OK",
        "modo_inferencia": config.MODO_INFERENCIA,
        "ocr": f"{config.OCR_DETECTOR} + {config.OCR_RECONOCEDOR}",
        "modelo": config.MODELO_LLM,
        "modelo_listo": estado.get("modelo_listo", False),
        "candado_de_red": candado_red.activo(),
        "conexiones_externas_bloqueadas": len(candado_red.intentos_bloqueados),
    }


@app.post("/v1/documentos/ocr", dependencies=[Depends(autorizar)])
async def leer_foto(request: Request) -> dict:
    """Fase rapida: calidad, OCR y sanitizado. La foto no se guarda en disco por esta API."""
    campos, contenido = await _extraer_campos_multipart(request)
    return procesar_ocr_documento(
        expediente_id=campos.get("expediente_id", ""),
        doc_id=campos.get("doc_id", ""),
        hash_sha256_original=campos.get("hash_sha256_original", ""),
        contenido=contenido,
        nombre_titular=campos.get("nombre_titular") or None,
    )


@app.post("/v1/expedientes/auditar", dependencies=[Depends(autorizar)])
def auditar(entrada: dict, x_ruc_solicitante: Optional[str] = Header(default=None)) -> dict:
    """Fase lenta: Qwen local, verificador, motor de Alejandro y contratos validados."""
    return procesar_auditoria_expediente(entrada, x_ruc_solicitante)


def _orquestador():
    if "orquestador" not in estado:
        from vps_api_soe import WasiVpsOrchestrator
        estado["orquestador"] = WasiVpsOrchestrator()
    return estado["orquestador"]


@app.get("/sunat/{ruc}")
def lookup_sunat(ruc: str) -> Dict[str, Any]:
    return _orquestador().consultar_sunat(ruc)


@app.post("/solicitudes/analizar")
def analizar_solicitud(payload: Dict[str, Any]) -> Dict[str, Any]:
    try:
        return _orquestador().analizar_solicitud_rie02(payload)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/red/{solicitud_id}")
def obtener_red(solicitud_id: str, saltos: int = Query(default=2, ge=1, le=3)) -> Dict[str, Any]:
    try:
        return _orquestador().obtener_subred(solicitud_id, saltos=saltos)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/alertas")
def listar_alertas(nivel: Optional[str] = Query(default=None), agencia: Optional[str] = Query(default=None)) -> Dict[str, Any]:
    return _orquestador().listar_alertas(nivel=nivel, agencia=agencia)


@app.post("/alertas/{alerta_id}/decision")
def decidir_alerta(alerta_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    try:
        return _orquestador().registrar_decision_especialista(alerta_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/casos-simulados")
def listar_casos_simulados() -> Dict[str, Any]:
    orq = _orquestador()
    return {
        "total_casos": len(orq.rie02_data["casos_simulados"]),
        "casos_simulados": orq.rie02_data["casos_simulados"],
    }


@app.get("/metricas")
def obtener_metricas() -> Dict[str, Any]:
    return _orquestador().obtener_metricas_rie02()


@app.get("/imagenes_golden_samples/{filename}")
def get_golden_sample_image(filename: str) -> Any:
    safe_name = Path(filename).name
    img_path = config.DATA / "imagenes_golden_samples" / safe_name
    if not img_path.exists():
        raise HTTPException(status_code=404, detail=f"Imagen {safe_name} no encontrada")
    return FileResponse(str(img_path), media_type="image/png")


def main() -> None:
    import uvicorn

    host, puerto = os.getenv("WASI_HOST", "127.0.0.1"), int(os.getenv("WASI_PORT", "8000"))
    if host not in ("127.0.0.1", "localhost", "::1") and not os.getenv("WASI_API_KEY"):
        sys.exit("Para atender a otros equipos hay que definir WASI_API_KEY.")
    uvicorn.run(app, host=host, port=puerto)


if __name__ == "__main__":
    main()
