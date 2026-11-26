"""Ejemplo de integracion: lo mismo que hara la PWA, usando solo la biblioteca estandar de Python.

Con la API levantada (python -m agente_local.api):

    python ejemplos/cliente_ejemplo.py

Sube dos fotos del kit, arma el payload de schema_input_alexander_a_soe.json y pide la auditoria.
Guarda las respuestas reales en ejemplos/respuestas/.
"""

import hashlib
import json
import os
import sys
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
API = os.getenv("WASI_API", "http://127.0.0.1:8000")
CLAVE = os.getenv("WASI_API_KEY", "")
SALIDA = Path(__file__).resolve().parent / "respuestas"
EXPEDIENTE = "EXP-TRUJ-2026-0101"
FOTOS = [("DOC-1", "DOC-MAY-001_factura_curtiembre_calzado.png"), ("DOC-2", "DOC-WAL-006_voucher_yape_870.png")]


def pedir(ruta, datos=None, cabeceras=None):
    cabeceras = dict(cabeceras or {})
    if CLAVE:
        cabeceras["X-API-Key"] = CLAVE
    req = urllib.request.Request(API + ruta, data=datos, headers=cabeceras)
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req, timeout=600) as r:
        return json.loads(r.read().decode("utf-8"))


def subir_foto(doc_id, ruta: Path):
    contenido = ruta.read_bytes()
    limite = uuid.uuid4().hex
    campos = {"expediente_id": EXPEDIENTE, "doc_id": doc_id, "hash_sha256_original": hashlib.sha256(contenido).hexdigest(),
              "nombre_titular": "QUISPE VARGAS JORGE LUIS"}
    cuerpo = b"".join(
        f'--{limite}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode() for k, v in campos.items()
    )
    cuerpo += (f'--{limite}\r\nContent-Disposition: form-data; name="archivo"; filename="{ruta.name}"\r\n'
               "Content-Type: image/png\r\n\r\n").encode() + contenido + f"\r\n--{limite}--\r\n".encode()
    return pedir("/v1/documentos/ocr", cuerpo, {"Content-Type": f"multipart/form-data; boundary={limite}"})


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    SALIDA.mkdir(exist_ok=True)
    print("health:", pedir("/health"))
    adjuntos = []
    for doc_id, archivo in FOTOS:
        r = subir_foto(doc_id, RAIZ / "data" / "imagenes_golden_samples" / archivo)
        print(f"{doc_id}: semaforo {r['semaforo']} | {r['tipo_documento_detectado']} | guardia {r['guardia_de_salida']} | {r['segundos']} s")
        (SALIDA / f"1_respuesta_ocr_{doc_id}.json").write_text(json.dumps(r, ensure_ascii=False, indent=2), encoding="utf-8")
        if not r["requiere_nueva_foto"]:
            adjuntos.append({"doc_id": doc_id, "tipo_documento": r["tipo_documento_detectado"],
                             "hash_sha256": r["hash_sha256"], "texto_ocr_sanitizado": r["texto_ocr_sanitizado"]})

    entrada = {
        "expediente_id": EXPEDIENTE,
        "token_expediente_pii": "UUID-EXP-0101",
        "timestamp_captura": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "agencia_origen": "Agencia El Porvenir",
        "datos_fiscales_prevalidados": {
            "token_ruc_solicitante": "[TOKEN_RUC_EXP_0101]", "estado_sunat": "ACTIVO", "condicion_domicilio": "HABIDO",
            "fecha_inicio_actividades": "2019-04-12", "giro_ciiu_declarado": "1520"},
        "declaracion_asesor": {
            "moneda": "PEN", "ventas_declaradas_asesor_pen": 7200.0, "inventario_fisico_estimado_pen": 6400.0,
            "gastos_operativos_familiares_pen": 410.0, "cuota_deuda_sbs_vigente_pen": 214.0,
            "cuota_mensual_propuesta_pen": 980.0, "monto_solicitado_pen": 8000.0},
        "documentos_adjuntos": adjuntos,
    }
    (SALIDA / "2_entrada_auditoria.json").write_text(json.dumps(entrada, ensure_ascii=False, indent=2), encoding="utf-8")
    r = pedir("/v1/expedientes/auditar", json.dumps(entrada).encode("utf-8"),
              {"Content-Type": "application/json", "X-RUC-Solicitante": "10423189012"})
    (SALIDA / "3_respuesta_auditoria.json").write_text(json.dumps(r, ensure_ascii=False, indent=2), encoding="utf-8")
    res = r["salida_intermedia"]["resumen_extraccion_compras"]
    print(f"compras validas S/ {res['compras_comprobadas_validas_pen']:,.2f} | errores de schema: {r['validacion_schemas']}")
    if r["contrato_final"]:
        d = r["contrato_final"]["dictamen_riesgos"]
        print(f"escala {d['escala_interna_caja_trujillo']} | monto recomendado S/ {d['monto_maximo_recomendado']:,.2f} | "
              f"banderas {r['banderas_para_consola']}")


if __name__ == "__main__":
    main()
