"""Banco de evaluacion: corre las 7 imagenes del kit de punta a punta y las compara con la respuesta esperada.

    python -m agente_local.evaluar            (todo)
    python -m agente_local.evaluar 006 007    (solo los documentos cuyo id contenga esos textos)
"""

import json
import sys
import time
from datetime import date

from . import candado_red, config
from .ocr_local import plano
from .pipeline import AgenteLocal

# datos personales o de terceros que aparecen en cada imagen y NO deben llegar al modelo
SENSIBLES = {
    "DOC-MAY-001": ["QUISPE VARGAS", "JORGE LUIS", "10423189012", "20604512891", "CURTIEMBRE Y PIELES", "SANCHEZ CARRION"],
    "DOC-MAY-002": ["MENDOZA CHAVEZ", "MARIA ELENA", "10489120345", "20539841207", "MOLINO Y ABARROTES", "VILLARREAL"],
    "DOC-MAY-003": ["PAREDES GOMEZ", "ROSAURA", "10411298765", "20601987432", "FERRETERA PACIFICO", "NICOLAS DE PIEROLA"],
    "DOC-MAN-004": ["LOZANO", "CARMEN JULIA", "ALBARRACIN", "PUESTO N"],
    "DOC-MAN-005": [],
    "DOC-WAL-006": ["TALLER APARADO", "948", "09482716"],
    "DOC-WAL-007": ["CAMPOS ALVA", "RICARDO", "944", "812", "7782310"],
}


def fugas(sample_id: str, texto: str) -> list:
    import re

    sin_tokens = re.sub(r"\[[A-Z_]+_\d{2,}\]", " ", texto)
    halladas = []
    for dato in SENSIBLES[sample_id]:
        if dato.isdigit() and len(dato) <= 3:
            if re.search(rf"(?<![\d.,]){dato}\s?[*•]", sin_tokens):
                halladas.append(dato)
        elif plano(dato) in plano(sin_tokens):
            halladas.append(dato)
    return halladas


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    filtro = sys.argv[1:]
    golden = config.cargar_json(config.DATA / "golden_samples_7_documentos.json")["muestras_documentales"]
    muestras = [m for m in golden if not filtro or any(f in m["sample_id"] for f in filtro)]

    print("Cargando OCR y modelo local...")
    agente = AgenteLocal()
    agente.calentar()

    filas, aciertos = [], 0
    for m in muestras:
        sid, esp = m["sample_id"], m["json_extraccion_esperado"]
        t0 = time.perf_counter()
        lectura = agente.leer_documento((config.DATA / m["archivo_imagen"]).read_bytes(), sid)
        if lectura.requiere_nueva_foto:
            print(f"{sid}: ROJO {lectura.motivos}")
            filas.append({"id": sid, "ok": False, "motivo": lectura.motivos})
            continue
        r = agente.extraer_y_verificar(lectura, m["ciiu_expediente_contexto"], hoy=date(2026, 11, 20))
        d, dg = r["documento"], r["diagnostico"]
        seg = round(time.perf_counter() - t0, 1)

        esperados = sorted(i["subtotal_pen"] for i in esp["items_extraidos"] if i["subtotal_pen"] is not None)
        obtenidos = sorted(i["subtotal_pen"] for i in d["items_extraidos"] if i["subtotal_pen"] is not None)
        comprobaciones = {
            "tipo": d["tipo_documento"] == esp["tipo_documento"],
            "total": abs(d["monto_declarado_documento_pen"] - esp["monto_declarado_documento_pen"]) < 0.01,
            "computable": abs(d["monto_computable_valido_pen"] - esp["monto_computable_valido_pen"]) < 0.01,
            "coherencia": d["coherencia_insumos_giro"] == esp["coherencia_insumos_giro"],
            "banderas": set(esp["banderas_detectadas"]) == set(d["banderas_detectadas"]),
            "n_items": len(d["items_extraidos"]) == len(esp["items_extraidos"]),
            "importes_item": esperados == obtenidos,
            "unidades": sorted(i["unidad_normalizada"] for i in d["items_extraidos"])
            == sorted(i["unidad_normalizada"] for i in esp["items_extraidos"]),
        }
        fuga = fugas(sid, lectura.texto_sanitizado)
        ok = all(comprobaciones.values()) and not fuga
        aciertos += ok
        fallos = [k for k, v in comprobaciones.items() if not v]
        print(f"{sid}  {'OK ' if ok else 'MAL'}  {seg:5.1f}s  {dg['semaforo']:8s} computable S/ {d['monto_computable_valido_pen']:>8,.2f} "
              f"conf {d['confianza_extraccion_ia']:.2f}  guardia {'OK' if dg['guardia_de_salida']['aprobado'] else 'BLOQUEO ' + str(dg['guardia_de_salida']['hallazgos'])}"
              f"{'  FALLA: ' + ', '.join(fallos) if fallos else ''}{'  FUGA: ' + str(fuga) if fuga else ''}")
        filas.append({"id": sid, "ok": ok, "segundos": seg, "fallos": fallos, "fugas": fuga,
                      "tiempos": dg["tiempos_seg"], "resultado": r})

    print(f"\nDocumentos correctos en todo: {aciertos}/{len(muestras)}")
    print(f"Documentos con fuga de datos: {sum(1 for f in filas if f.get('fugas'))}")
    print(f"Conexiones externas intentadas (bloqueadas): {len(candado_red.intentos_bloqueados)} {candado_red.intentos_bloqueados[:5]}")
    carpeta = config.RAIZ / "evidencia"
    carpeta.mkdir(exist_ok=True)
    (carpeta / "evaluacion.json").write_text(json.dumps(filas, ensure_ascii=False, indent=1), encoding="utf-8")
    return 0 if aciertos == len(muestras) else 1


if __name__ == "__main__":
    sys.exit(main())
