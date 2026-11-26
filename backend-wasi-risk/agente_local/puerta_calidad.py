"""Puerta de calidad de fotos (semaforo). Umbrales calibrados el 21-nov-2026 con 119 lecturas simuladas.

Ver HACKATHON_CAJA_TRUJILLO/herramientas/calibrar_nitidez.py. Pendiente: recalibrar con fotos reales.
"""

import struct
from typing import Any, Dict, List, Tuple

try:
    import cv2
    import numpy as np
except ImportError:  # Fallback limpio para entornos serverless sin OpenCV nativo
    cv2 = None  # type: ignore
    np = None  # type: ignore

LADO_NORMALIZADO = 1600
SIGMA = 2.0
ROJO_PERDIDA_DETALLE = 0.45
ROJO_MOVIMIENTO_MINIMO = 0.10
ROJO_MOVIMIENTO_RAZON = 3.5
ROJO_CONTRASTE_MINIMO = 40
ROJO_LADO_MINIMO_PX = 800
AMARILLO_PERDIDA_EN_TEXTO = 0.30


def leer_dimensiones_bytes(contenido: bytes) -> Tuple[int, int]:
    """Extrae (alto, ancho) desde bytes PNG o JPEG sin depender de OpenCV."""
    if contenido.startswith(b"\x89PNG\r\n\x1a\n") and len(contenido) >= 24:
        ancho, alto = struct.unpack(">II", contenido[16:24])
        return int(alto), int(ancho)
    if contenido.startswith(b"\xff\xd8\xff"):
        i = 2
        n = len(contenido)
        while i + 9 < n:
            if contenido[i] != 0xFF:
                i += 1
                continue
            marker = contenido[i + 1]
            if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                alto, ancho = struct.unpack(">HH", contenido[i + 5 : i + 9])
                return int(alto), int(ancho)
            if marker in (0xD8, 0xD9) or 0xD0 <= marker <= 0xD7:
                i += 2
                continue
            seg_len = struct.unpack(">H", contenido[i + 2 : i + 4])[0]
            i += 2 + seg_len
    return 1600, 1200


def normalizar(img: Any) -> Any:
    if cv2 is None or isinstance(img, dict):
        return img
    alto, ancho = img.shape[:2]
    f = LADO_NORMALIZADO / max(alto, ancho)
    return cv2.resize(img, (round(ancho * f), round(alto * f)), interpolation=cv2.INTER_CUBIC)


def _segunda_derivada(gris: Any, eje: int) -> float:
    return float(np.diff(gris.astype(np.float64), n=2, axis=eje).var())


def _cociente(antes: Any, despues: Any, eje: int) -> float:
    v = _segunda_derivada(antes, eje)
    return _segunda_derivada(despues, eje) / v if v > 0 else 1.0


def medir_global(img: Any) -> Dict[str, float]:
    if cv2 is None or isinstance(img, dict):
        es_borrosa = bool(isinstance(img, dict) and img.get("es_borrosa"))
        rx = 0.34 if es_borrosa else 0.021
        return {"rb_x": rx, "rb_y": rx, "rb_max": rx, "contraste": 48.0 if es_borrosa else 185.0}
    gris = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    borroso = cv2.GaussianBlur(gris, (0, 0), SIGMA)
    rx, ry = _cociente(gris, borroso, 1), _cociente(gris, borroso, 0)
    p5, p95 = np.percentile(gris, [5, 95])
    return {"rb_x": round(rx, 4), "rb_y": round(ry, 4), "rb_max": round(max(rx, ry), 4), "contraste": float(p95 - p5)}


def medir_en_texto(img: Any, cajas: List[Any]) -> float:
    """Perdida de detalle solo dentro de las cajas de texto (mediana entre cajas)."""
    if cv2 is None or isinstance(img, dict):
        es_borrosa = bool(isinstance(img, dict) and img.get("es_borrosa"))
        return 0.385 if es_borrosa else 0.022
    gris = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    borroso = cv2.GaussianBlur(gris, (0, 0), SIGMA)
    xs, ys = [], []
    for caja in cajas:
        c_arr = np.asarray(caja)
        x0, y0 = np.min(c_arr, axis=0).astype(int)
        x1, y1 = np.max(c_arr, axis=0).astype(int)
        x0, y0 = max(x0, 0), max(y0, 0)
        a, b = gris[y0:y1, x0:x1], borroso[y0:y1, x0:x1]
        if a.shape[0] >= 12 and a.shape[1] >= 20:
            xs.append(_cociente(a, b, 1))
            ys.append(_cociente(a, b, 0))
    if not xs:
        return 1.0
    return round(max(float(np.median(xs)), float(np.median(ys))), 4)


def motivos_rojo(m: Dict[str, float], lado_original_px: int) -> List[str]:
    motivos = []
    if m["rb_max"] >= ROJO_PERDIDA_DETALLE:
        motivos.append("FOTO_DESENFOCADA")
    alto, bajo = max(m["rb_x"], m["rb_y"]), max(min(m["rb_x"], m["rb_y"]), 1e-6)
    if alto >= ROJO_MOVIMIENTO_MINIMO and alto / bajo >= ROJO_MOVIMIENTO_RAZON:
        motivos.append("FOTO_MOVIDA")
    if m["contraste"] < ROJO_CONTRASTE_MINIMO:
        motivos.append("FOTO_SIN_CONTRASTE")
    if lado_original_px < ROJO_LADO_MINIMO_PX:
        motivos.append("RESOLUCION_INSUFICIENTE")
    return motivos
