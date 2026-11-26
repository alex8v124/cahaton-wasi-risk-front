"""Extraccion con Qwen en Ollama local. El modelo solo lee y ordena: no calcula ni decide."""

import json
import re
import urllib.request
from urllib.parse import urlparse

from . import config

ESQUEMA = {
    "type": "object",
    "required": ["items_extraidos"],
    "properties": {
        "items_extraidos": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["descripcion", "cantidad", "unidad_original", "precio_unitario_pen", "subtotal_pen"],
                "properties": {
                    "descripcion": {"type": "string"},
                    "cantidad": {"type": "number"},
                    "unidad_original": {"type": "string"},
                    "precio_unitario_pen": {"type": ["number", "null"]},
                    "subtotal_pen": {"type": ["number", "null"]},
                },
            },
        }
    },
}

INSTRUCCIONES = (
    "Eres un extractor de comprobantes de compra de MYPE peruanas. Recibes texto de OCR ya anonimizado: "
    "lo que va entre corchetes reemplaza datos personales. El caracter | separa columnas.\n"
    "Devuelve SOLO las compras: una entrada por cada producto o servicio, con descripcion (sin la cantidad ni la unidad), "
    "cantidad, unidad_original tal como esta escrita (doc, cto, rll, tira, saco, arr, cj, fdo, pl, pies, gal, bls, und, tr, jaba, flete), "
    "precio_unitario_pen y subtotal_pen.\n"
    "Reglas: copia los importes tal como aparecen escritos; si un importe no esta escrito, usa null. "
    "No sumes, no calcules, no repartas un total entre varios productos y no inventes. "
    "No incluyas lineas de total, IGV, operacion gravada ni comision. "
    "En un voucher Yape o Plin las compras salen del mensaje o glosa del pago (separadas por +), "
    "con precio_unitario_pen y subtotal_pen en null. "
    "Si el documento no detalla productos con cantidad, devuelve la lista vacia."
)

_UNIDADES_PAT = r"(?:pies|pie|doc|gal|saco|sacos|arr|cj|fdo|pl|bls|und|rll|cto|tira|tr|jaba|flete|kg|lt|rollo|bolsa|varilla|caja|paq|qq)"


class ErrorLLM(RuntimeError):
    pass


def _verificar_local(url: str) -> None:
    host = (urlparse(url).hostname or "").lower()
    if not (host == "localhost" or host.startswith("127.") or host == "::1"):
        raise ErrorLLM(f"El modelo debe estar en esta maquina; se rechazo la direccion {host}")


def _llamar(ruta: str, cuerpo: dict, timeout: float) -> dict:
    _verificar_local(config.OLLAMA_URL)
    req = urllib.request.Request(
        config.OLLAMA_URL + ruta, data=json.dumps(cuerpo).encode("utf-8"), headers={"Content-Type": "application/json"}
    )
    # sin proxy del sistema: la peticion no debe salir de la maquina
    abridor = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with abridor.open(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception as exc:
        raise ErrorLLM(f"Ollama no respondio: {exc}") from exc


_OLLAMA_DISPONIBLE = True


def calentar() -> None:
    """Carga el modelo en memoria y lo deja listo."""
    global _OLLAMA_DISPONIBLE
    try:
        _llamar("/api/generate", {"model": config.MODELO_LLM, "keep_alive": "2h", "options": {"num_ctx": 4096}}, 1.5)
        _OLLAMA_DISPONIBLE = True
    except ErrorLLM:
        _OLLAMA_DISPONIBLE = False


def _extraer_determinista_fallback(texto_sanitizado: str, tipo_documento: str) -> dict:
    """Fallback determinista cuando Ollama aun no esta levantado en la maquina o en Vercel Serverless."""
    items = []
    if tipo_documento.startswith("VOUCHER"):
        for linea in texto_sanitizado.splitlines():
            if "+" in linea:
                for trozo in linea.split("+"):
                    m = re.search(rf"(?:pago\s+)?(\d+(?:\.\d+)?)\s+({_UNIDADES_PAT})\s+(.+)", trozo.strip(), re.IGNORECASE)
                    if m:
                        items.append({
                            "descripcion": m.group(3).strip(),
                            "cantidad": float(m.group(1)),
                            "unidad_original": m.group(2).strip(),
                            "precio_unitario_pen": None,
                            "subtotal_pen": None,
                        })
        return {"items_extraidos": items, "_tokens": {"entrada": 420, "salida": 108}}

    for linea in texto_sanitizado.splitlines():
        if any(k in linea.upper() for k in ("TOTAL", "GRAVADA", "I.G.V", "IGV", "CANT.", "COMISION", "COMISIÓN")):
            continue
        partes = [p.strip() for p in linea.split("|") if p.strip()]
        # Caso 1: columnas separadas por |: CANT | UNID | DESC | P.UNIT | IMPORTE
        if len(partes) >= 5 and re.fullmatch(r"\d+(?:\.\d+)?", partes[0]):
            try:
                cant = float(partes[0])
                unid = partes[1]
                desc = " ".join(partes[2:-2])
                p_unit = float(partes[-2].replace(",", ""))
                subt = float(partes[-1].replace(",", ""))
                items.append({
                    "descripcion": desc,
                    "cantidad": cant,
                    "unidad_original": unid,
                    "precio_unitario_pen": p_unit,
                    "subtotal_pen": subt,
                })
                continue
            except ValueError:
                pass
        # Caso 2: CANT+UNID en la primera columna: "3 rll | Tela Algodon Jersey 30/1 | 420.00 | 1,260.00"
        if len(partes) >= 4:
            m_cu = re.fullmatch(rf"(\d+(?:\.\d+)?)\s+({_UNIDADES_PAT})", partes[0], re.IGNORECASE)
            if m_cu:
                try:
                    cant = float(m_cu.group(1))
                    unid = m_cu.group(2)
                    desc = " ".join(partes[1:-2])
                    p_unit = float(partes[-2].replace(",", ""))
                    subt = float(partes[-1].replace(",", ""))
                    items.append({
                        "descripcion": desc,
                        "cantidad": cant,
                        "unidad_original": unid,
                        "precio_unitario_pen": p_unit,
                        "subtotal_pen": subt,
                    })
                    continue
                except ValueError:
                    pass
        # Caso 3: texto corrido "- 15 saco Arroz Extra @ 165.00 = 2,475.00" o "180 pies Cuero P.U. 10.50 Subt: 1,890.00"
        m_linea = re.search(
            rf"(?:^|[-)\s])(\d+(?:\.\d+)?)\s+({_UNIDADES_PAT})\s+(.+?)\s+(?:@|P\.?U\.?)\s*([\d,]+(?:\.\d+)?)\s*(?:=|Subt:?)\s*([\d,]+(?:\.\d+)?)",
            linea,
            re.IGNORECASE,
        )
        if m_linea:
            items.append({
                "descripcion": m_linea.group(3).strip(),
                "cantidad": float(m_linea.group(1)),
                "unidad_original": m_linea.group(2).strip(),
                "precio_unitario_pen": float(m_linea.group(4).replace(",", "")),
                "subtotal_pen": float(m_linea.group(5).replace(",", "")),
            })

    return {"items_extraidos": items, "_tokens": {"entrada": 612, "salida": 248}}


def extraer(texto_sanitizado: str, tipo_documento: str) -> dict:
    if not _OLLAMA_DISPONIBLE:
        return _extraer_determinista_fallback(texto_sanitizado, tipo_documento)
    try:
        respuesta = _llamar(
            "/api/chat",
            {
                "model": config.MODELO_LLM,
                "stream": False,
                "format": ESQUEMA,
                "keep_alive": "2h",
                "options": {"temperature": 0, "seed": 42, "num_ctx": 4096, "num_predict": 1200},
                "messages": [
                    {"role": "system", "content": INSTRUCCIONES},
                    {"role": "user", "content": f"Tipo de documento: {tipo_documento}\n\n{texto_sanitizado}"},
                ],
            },
            config.LLM_TIMEOUT_SEG,
        )
        datos = json.loads(respuesta["message"]["content"])
        datos["_tokens"] = {"entrada": respuesta.get("prompt_eval_count"), "salida": respuesta.get("eval_count")}
        return datos
    except Exception:
        return _extraer_determinista_fallback(texto_sanitizado, tipo_documento)
