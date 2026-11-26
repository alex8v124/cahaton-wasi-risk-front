"""Verificador determinista: montos, cuadre, unidades, coherencia de giro, fechas y confianza.

Todo numero que sale del agente se calcula o se comprueba aqui, en Python.
"""

import re
from datetime import date
from typing import Any, Dict, List, Optional, Tuple

from .ocr_local import Segmento, plano

TOLERANCIA_SOLES = 0.50
UMBRAL_CONFIANZA = 0.85
ANTIGUEDAD_MAXIMA_DIAS = 90
AJENO_MAXIMO = 0.20

_IMPORTE = re.compile(r"(?<![\d.,])(\d{1,3}(?:[.,]\d{3})+\.\d{2}|\d{1,3}(?:,\d{3})+\.\d{2}|\d+\.\d{2})(?![\d])")
_IMPORTE_CON_LETRAS = re.compile(r"S\s*/\s*[:.]?\s*(?=[\d.,OoSs]*\d)(?=[\d.,]*[OoSs])[\dOoSs.,]{4,}")
_MESES = {"ENE": 1, "FEB": 2, "MAR": 3, "ABR": 4, "MAY": 5, "JUN": 6, "JUL": 7, "AGO": 8, "SET": 9, "SEP": 9, "OCT": 10, "NOV": 11, "DIC": 12}


def a_numero(texto: str) -> float:
    """'1,260.00' y '5.000.00' (el OCR leyo la coma como punto) -> 1260.0 y 5000.0. No cambia ningun digito."""
    digitos = re.sub(r"[.,]", "", texto)
    return int(digitos) / 100.0


def importes_en(texto: str) -> List[float]:
    return [a_numero(m) for m in _IMPORTE.findall(texto)]


def total_documento(tipo: str, textos: List[str]) -> Tuple[Optional[float], str]:
    """Devuelve (total, motivo). Si no se lee como numero limpio, total = None: no se corrige ni se adivina."""
    if tipo.startswith("VOUCHER"):
        for t in textos:
            if "comisi" in t.lower():
                continue
            m = re.match(r"^\s*S\s*/\s*([\d][\d.,]*)\s*$", t)
            if m and importes_en(m.group(1)) and importes_en(m.group(1))[0] > 0:
                return importes_en(m.group(1))[0], "monto principal del voucher"
        return None, "no se encontro el monto principal"
    candidatos = [i for i, t in enumerate(textos) if "TOTAL" in plano(t) and "SUBTOTAL" not in plano(t)]
    for i in reversed(candidatos):
        for j in range(i, min(i + 3, len(textos))):
            if _IMPORTE_CON_LETRAS.search(textos[j]):
                return None, "importe total con letras en lugar de digitos"
            valores = importes_en(textos[j])
            if valores:
                return valores[-1], "junto a la etiqueta TOTAL"
    if any(_IMPORTE_CON_LETRAS.search(t) for t in textos):
        return None, "importe total con letras en lugar de digitos"
    return None, "no se encontro un total legible"


def serie_documento(tipo: str, textos: List[str]) -> Optional[str]:
    todo = "\n".join(textos)
    if tipo.startswith("VOUCHER"):
        m = re.search(r"\b(PLN[-\s]?\d{5,})\b", todo)
        if m:
            return m.group(1)
        for i, t in enumerate(textos):
            if "operaci" in t.lower():
                for cand in (t, textos[i + 1] if i + 1 < len(textos) else ""):
                    n = re.search(r"(?<!\d)\d{6,12}(?!\d)", cand)
                    if n:
                        return ("YAPE-" if tipo == "VOUCHER_YAPE" else "PLIN-") + n.group(0)
        return None
    m = re.search(r"\b([FB]\d{3}-\d{4,8})\b", todo)
    if m:
        return m.group(1)
    if tipo == "NOTA_MANUSCRITA":
        m = re.search(r"N\s*[°ºo.]\s*(\d{4,8})", todo)
        if m:
            return "NP-" + m.group(1)
    return None


def fecha_documento(textos: List[str]) -> Optional[date]:
    for t in textos:
        for patron, orden in (
            (r"(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)", "amd"),
            (r"(?<!\d)(\d{1,2})\s*/\s*(\d{1,2})\s*/\s*(\d{4}|\d{2})(?!\d)", "dma"),
            (r"(?<!\d)(\d{1,2})\s*([A-Za-z]{3})[a-z]*\.?\s*(\d{4})", "dMa"),
        ):
            m = re.search(patron, t)
            if not m:
                continue
            try:
                if orden == "amd":
                    return date(int(m[1]), int(m[2]), int(m[3]))
                anio = int(m[3]) + (2000 if len(m[3]) == 2 else 0)
                mes = int(m[2]) if orden == "dma" else _MESES[m[2].upper()]
                return date(anio, mes, int(m[1]))
            except (ValueError, KeyError):
                continue
    return None


def items_en_glosa(texto: str) -> int:
    """Cuantas compras separadas por + trae el mensaje de un voucher ('4 tr aparado + 3 gal pegamento' = 2)."""
    for linea in texto.split("\n"):
        if "+" in linea:
            partes = [p for p in linea.split("+") if re.search(r"(?<![\d.,])\d{1,4}\s+[A-Za-z]", p)]
            if len(partes) >= 2:
                return len(partes)
    return 0


def confianza_critica(segmentos: List[Segmento]) -> float:
    """Promedio de confianza OCR de las lineas que llevan importes o la palabra total."""
    criticas = [s.confianza for s in segmentos if importes_en(s.texto) or "TOTAL" in plano(s.texto)]
    base = criticas or [s.confianza for s in segmentos]
    return round(sum(base) / len(base), 3) if base else 0.0


def minima_critica(segmentos: List[Segmento]) -> float:
    criticas = [s.confianza for s in segmentos if importes_en(s.texto) or "TOTAL" in plano(s.texto)]
    return round(min(criticas), 3) if criticas else 0.0


def normalizar_unidad(original: str, lexico: dict) -> Tuple[str, bool]:
    mapa = lexico["mapeo_abreviaturas_informales"]
    clave = original.strip().lower().rstrip(".")
    for k in (clave, clave.split(" ")[0] if clave else "", clave.rstrip("s")):
        if k in mapa:
            return mapa[k], True
    if clave.upper() in lexico["unidades_estandar_permitidas"]:
        return clave.upper(), True
    return "UNIDAD", False


def _palabras(texto: str) -> List[str]:
    return [plano(p) for p in re.split(r"[\s_/,+()-]+", texto) if plano(p)]


def es_del_giro(descripcion: str, unidad_original: str, unidad_norm: str, insumos: List[str]) -> bool:
    """Un insumo del giro coincide si todas sus palabras estan en la descripcion o en la unidad."""
    disponibles = _palabras(f"{descripcion} {unidad_original} {unidad_norm}")
    for insumo in insumos:
        necesarias = [p for p in _palabras(insumo) if p not in ("DE", "X")]
        if necesarias and all(any(d == n or (len(n) >= 4 and d.startswith(n)) for d in disponibles) for n in necesarias):
            return True
    return False


def verificar(
    *,
    doc_id: str,
    tipo: str,
    items_llm: List[Dict[str, Any]],
    total: Optional[float],
    montos_en_documento: List[float],
    serie: Optional[str],
    fecha: Optional[date],
    c_ocr: float,
    c_minima: float,
    semaforo: str,
    proveedor_token: str,
    info_giro: dict,
    lexico: dict,
    hoy: date,
) -> Tuple[Dict[str, Any], List[str]]:
    """Devuelve (documento segun schema_output_soe_a_alejandro, alertas de diagnostico)."""
    alertas: List[str] = []
    es_voucher = tipo.startswith("VOUCHER")
    presentes = {round(v, 2) for v in montos_en_documento}
    items = []
    for it in items_llm:
        unidad, conocida = normalizar_unidad(str(it.get("unidad_original", "")), lexico)
        if not conocida:
            alertas.append(f"UNIDAD_NO_RECONOCIDA: {it.get('unidad_original', '')}")
        precio, subtotal = it.get("precio_unitario_pen"), it.get("subtotal_pen")
        if es_voucher:
            precio = subtotal = None  # un voucher no trae importes por item
        else:
            if subtotal is not None and round(float(subtotal), 2) not in presentes:
                alertas.append("MONTO_NO_PRESENTE_EN_DOCUMENTO")  # el modelo escribio algo que no esta impreso
                subtotal = None
            if precio is not None and round(float(precio), 2) not in presentes:
                alertas.append("MONTO_NO_PRESENTE_EN_DOCUMENTO")
                precio = None
        descripcion = str(it.get("descripcion", "")).strip()
        items.append(
            {
                "descripcion": descripcion,
                "cantidad": max(0, float(it.get("cantidad") or 0)),
                "unidad_original": str(it.get("unidad_original", "")),
                "unidad_normalizada": unidad,
                "precio_unitario_pen": precio,
                "subtotal_pen": subtotal,
                "insumo_coherente_ciiu": es_del_giro(
                    descripcion, str(it.get("unidad_original", "")), unidad, info_giro["insumos_validos_informales"]
                ),
            }
        )

    # coherencia de giro: por monto cuando hay importes; si no, por cantidad de items
    con_monto = [i for i in items if i["subtotal_pen"]]
    monto_ajeno = sum(i["subtotal_pen"] for i in con_monto if not i["insumo_coherente_ciiu"])
    if con_monto and len(con_monto) == len(items):
        proporcion_ajena = monto_ajeno / sum(i["subtotal_pen"] for i in con_monto)
    elif items:
        proporcion_ajena = sum(not i["insumo_coherente_ciiu"] for i in items) / len(items)
    else:
        proporcion_ajena = 1.0
    coherente = bool(items) and proporcion_ajena <= AJENO_MAXIMO

    # cuadre
    if es_voucher:
        cuadra = total is not None
    else:
        cuadra = (
            total is not None
            and bool(items)
            and len(con_monto) == len(items)
            and abs(sum(i["subtotal_pen"] for i in con_monto) - total) <= TOLERANCIA_SOLES
        )

    c_cuadre = 1.0 if cuadra else 0.80
    if semaforo == "VERDE":
        c_calidad = 1.0
    else:
        c_calidad = 0.90 if (cuadra and c_minima >= 0.90) else 0.80
    confianza = round(min(c_ocr, c_cuadre, c_calidad), 2) if total is not None else round(min(c_ocr, 0.70), 2)

    banderas = []
    if confianza < UMBRAL_CONFIANZA:
        banderas.append("FLAG_BAJA_CONFIANZA_OCR_POKA_YOKE")
    if tipo == "NOTA_MANUSCRITA" and total and total % 1000 == 0 and len(con_monto) <= 1:
        banderas.append("FLAG_MONTO_REDONDO_SIN_DESGLOSE")
    if items and not coherente:
        banderas.append("FLAG_INCOHERENCIA_GIRO_CIIU")
    if fecha is None:
        alertas.append("FECHA_ILEGIBLE")
    elif fecha > hoy or (hoy - fecha).days > ANTIGUEDAD_MAXIMA_DIAS:
        banderas.append("FLAG_FECHA_FUTURA_O_VENCIDA")
    if total is not None and not cuadra:
        alertas.append("NO_CUADRA_SUMA_DE_ITEMS_CON_TOTAL")

    computable_ok = total is not None and cuadra and coherente and not banderas
    computable = round(total - (monto_ajeno if con_monto else 0.0), 2) if computable_ok else 0.0

    documento = {
        "doc_id": doc_id,
        "tipo_documento": tipo,
        "serie_correlativo": serie,
        "fecha_emision": fecha.isoformat() if fecha else None,
        "proveedor_token": proveedor_token,
        "confianza_extraccion_ia": confianza,
        "coherencia_insumos_giro": coherente,
        "es_documento_valido_computable": computable_ok,
        "requiere_revision_humana": (not computable_ok) or "FECHA_ILEGIBLE" in alertas,
        "banderas_detectadas": banderas,
        "items_extraidos": items,
        "monto_declarado_documento_pen": float(total or 0.0),
        "monto_computable_valido_pen": computable,
    }
    return documento, sorted(set(alertas))
