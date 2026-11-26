"""Adaptador: contrato de la PWA (schema_input) -> agente -> contrato intermedio -> motor -> contrato final.

El motor de Alejandro se usa tal cual, sin cambios.
"""

import hashlib
import re
from dataclasses import replace
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional

try:
    from jsonschema import Draft7Validator
except ImportError:
    Draft7Validator = None  # type: ignore

from . import config
from .pipeline import AgenteLocal, Lectura
from motor_scoring_wasi import WasiRiskScoringEngine


class EntradaInvalida(ValueError):
    def __init__(self, errores: List[str]) -> None:
        super().__init__("; ".join(errores))
        self.errores = errores


class _ValidadorLigero:
    def __init__(self, schema: Dict[str, Any]) -> None:
        self.schema = schema

    def iter_errors(self, objeto: Any) -> List[Any]:
        if not isinstance(objeto, dict):
            return [type("Err", (), {"path": [], "message": "Se esperaba un objeto JSON"})()]
        req = self.schema.get("required", [])
        faltantes = [k for k in req if k not in objeto]
        return [type("Err", (), {"path": [k], "message": f"Falta el campo obligatorio '{k}'"})() for k in faltantes]


def _esquema(nombre: str) -> Any:
    raw = config.cargar_json(config.SCHEMAS / nombre)
    return Draft7Validator(raw) if Draft7Validator is not None else _ValidadorLigero(raw)


def errores_de(validador: Any, objeto: Any) -> List[str]:
    return [f"{'/'.join(str(p) for p in e.path) or '(raiz)'}: {e.message}" for e in validador.iter_errors(objeto)]


def _meses_desde(fecha_iso: str, hoy: date) -> Optional[int]:
    try:
        f = date.fromisoformat(fecha_iso)
    except ValueError:
        return None
    return max(0, (hoy.year - f.year) * 12 + (hoy.month - f.month))


def _documento_en_rojo(doc_id: str, tipo: str) -> Dict[str, Any]:
    return {
        "doc_id": doc_id, "tipo_documento": tipo, "serie_correlativo": None, "fecha_emision": None,
        "proveedor_token": "PROVEEDOR_NO_IDENTIFICADO", "confianza_extraccion_ia": 0.0, "coherencia_insumos_giro": False,
        "es_documento_valido_computable": False, "requiere_revision_humana": True,
        "banderas_detectadas": ["FLAG_BAJA_CONFIANZA_OCR_POKA_YOKE"], "items_extraidos": [],
        "monto_declarado_documento_pen": 0.0, "monto_computable_valido_pen": 0.0,
    }


def marcar_duplicados(documentos: List[Dict[str, Any]], huellas: List[str]) -> None:
    vistos_huella, vistos_serie = set(), set()
    for doc, huella in zip(documentos, huellas):
        clave = (doc["serie_correlativo"], doc["monto_declarado_documento_pen"]) if doc["serie_correlativo"] else None
        if huella in vistos_huella or (clave and clave in vistos_serie):
            doc["banderas_detectadas"] = sorted(set(doc["banderas_detectadas"]) | {"FLAG_MONTOS_REPETIDOS_O_DUPLICADOS"})
            doc.update(es_documento_valido_computable=False, requiere_revision_humana=True, monto_computable_valido_pen=0.0)
        vistos_huella.add(huella)
        if clave:
            vistos_serie.add(clave)


class AuditorExpediente:
    def __init__(self, agente: AgenteLocal) -> None:
        self.agente = agente
        self.motor = WasiRiskScoringEngine(
            config.DATA / "reglas_parametricas_trujillo.json", config.DATA / "lexico_unidades_mype.json"
        )
        self.v_entrada = _esquema("schema_input_alexander_a_soe.json")
        self.v_intermedio = _esquema("schema_output_soe_a_alejandro.json")
        self.v_final = _esquema("schema_contrato_final_4_bloques.json")

    def auditar(
        self, entrada: Dict[str, Any], lecturas: Dict[str, Lectura], ruc_interno: Optional[str] = None,
        hoy: Optional[date] = None,
    ) -> Dict[str, Any]:
        errores = errores_de(self.v_entrada, entrada)
        if errores:
            raise EntradaInvalida(errores)
        hoy = hoy or date.today()
        fiscal = entrada["datos_fiscales_prevalidados"]
        giro = fiscal["giro_ciiu_declarado"]

        documentos, diagnosticos, huellas = [], {}, []
        for adj in entrada["documentos_adjuntos"]:
            avisos = []
            lectura = lecturas.get(adj["hash_sha256"])
            if lectura is None:
                lectura = self.agente.lectura_desde_texto(
                    adj["doc_id"], adj["hash_sha256"], adj["texto_ocr_sanitizado"], adj["tipo_documento"]
                )
                avisos.append("FOTO_NO_VERIFICADA: el agente no recibio la imagen de este documento")
            elif not lectura.requiere_nueva_foto:
                if lectura.texto_sanitizado.strip() != adj["texto_ocr_sanitizado"].strip():
                    avisos.append("TEXTO_DEL_CLIENTE_DISTINTO: se usa el texto que leyo el agente, no el recibido")
                if lectura.tipo != adj["tipo_documento"]:
                    avisos.append(f"TIPO_DISTINTO: la PWA dijo {adj['tipo_documento']} y el agente leyo {lectura.tipo}")
            lectura = replace(lectura, doc_id=adj["doc_id"], tiempos=dict(lectura.tiempos))
            if lectura.requiere_nueva_foto:
                documentos.append(_documento_en_rojo(adj["doc_id"], adj["tipo_documento"]))
                diagnosticos[adj["doc_id"]] = {"semaforo": "ROJO", "motivos_semaforo": lectura.motivos, "avisos": avisos}
            else:
                r = self.agente.extraer_y_verificar(lectura, giro, hoy)
                documentos.append(r["documento"])
                diagnosticos[adj["doc_id"]] = {**r["diagnostico"], "avisos": avisos}
            huellas.append(adj["hash_sha256"])
        marcar_duplicados(documentos, huellas)

        banderas = {b for d in documentos for b in d["banderas_detectadas"]}
        if fiscal["estado_sunat"] != "ACTIVO" or fiscal["condicion_domicilio"] != "HABIDO":
            banderas.add("FLAG_RUC_NO_HABIDO_O_BAJA")
        meses = _meses_desde(fiscal["fecha_inicio_actividades"], hoy)
        if meses is not None and meses < 6:
            banderas.add("FLAG_ANTIGUEDAD_FISCAL_INSUFICIENTE")

        confianza = min(d["confianza_extraccion_ia"] for d in documentos)
        coherente = "FLAG_INCOHERENCIA_GIRO_CIIU" not in banderas
        compras = round(sum(d["monto_computable_valido_pen"] for d in documentos), 2)
        rechazadas = round(sum(max(0.0, d["monto_declarado_documento_pen"] - d["monto_computable_valido_pen"]) for d in documentos), 2)
        revision = (
            confianza < 0.85
            or any(d["requiere_revision_humana"] for d in documentos)
            or "FLAG_RUC_NO_HABIDO_O_BAJA" in banderas
        )
        intermedio = {
            "expediente_id": entrada["expediente_id"],
            "modo_inferencia": config.MODO_INFERENCIA,
            "validacion_fiscal_resultado": {
                "giro_ciiu": giro, "estado_sunat": fiscal["estado_sunat"], "condicion_domicilio": fiscal["condicion_domicilio"],
                "coherencia_insumos_giro": coherente, "confianza_extraccion_ia": confianza,
            },
            "resumen_extraccion_compras": {
                "moneda": "PEN", "compras_comprobadas_validas_pen": compras, "compras_rechazadas_pen": rechazadas,
                "total_documentos_auditados": len(documentos),
                "total_documentos_rechazados": sum(not d["es_documento_valido_computable"] for d in documentos),
            },
            "documentos_procesados": documentos,
            "banderas_fraude_detectadas": sorted(banderas),
            "requiere_revision_humana": revision,
        }

        final, pendiente, banderas_consola = self._contrato_final(entrada, intermedio, ruc_interno)
        return {
            "salida_intermedia": intermedio,
            "contrato_final": final,
            "contrato_final_pendiente_por": pendiente,
            "banderas_para_consola": banderas_consola,
            "validacion_schemas": {
                "intermedio": errores_de(self.v_intermedio, intermedio),
                "final": errores_de(self.v_final, final) if final else None,
            },
            "diagnostico_documentos": diagnosticos,
        }

    def _contrato_final(self, entrada, intermedio, ruc):
        vf, resumen = intermedio["validacion_fiscal_resultado"], intermedio["resumen_extraccion_compras"]
        decl, giro = entrada["declaracion_asesor"], vf["giro_ciiu"]
        info = self.motor.giros_ciiu[giro]
        margen, rotacion = float(info["margen_bruto_estandar"]), float(info["factor_rotacion_mensual"])
        compras = resumen["compras_comprobadas_validas_pen"]
        ventas, cuota = float(decl["ventas_declaradas_asesor_pen"]), float(decl["cuota_mensual_propuesta_pen"])
        gastos, deuda = float(decl["gastos_operativos_familiares_pen"]), float(decl["cuota_deuda_sbs_vigente_pen"])
        monto = float(decl["monto_solicitado_pen"])

        v_imp = self.motor.calcular_ventas_implicitas(compras, margen, rotacion)
        delta = self.motor.calcular_delta_fraude(ventas, v_imp)
        fnd = self.motor.calcular_flujo_neto_disponible(ventas, v_imp, margen, gastos, deuda)
        rcc = self.motor.calcular_rcc(fnd, cuota)
        dictamen = self.motor.homologar_escala_caja_trujillo(
            delta_fraude=delta, rcc=rcc, coherencia_insumos_giro=vf["coherencia_insumos_giro"],
            confianza_extraccion_ia=vf["confianza_extraccion_ia"], monto_solicitado=monto,
        )
        banderas = set(intermedio["banderas_fraude_detectadas"])
        if dictamen["alerta_fraude_maquillaje"]:
            banderas.add("FLAG_MAQUILLAJE_VENTAS_30")
        if intermedio["requiere_revision_humana"]:
            dictamen["requiere_revision_humana"] = True
        if "FLAG_RUC_NO_HABIDO_O_BAJA" in banderas and dictamen["escala_interna_caja_trujillo"] in ("AAA", "AA"):
            dictamen["escala_interna_caja_trujillo"] = "B"
            dictamen["accion_operativa"] = "OBSERVADO_RETENCION_VALIDACION_FISCAL_SUNAT"

        if not ruc or not re.fullmatch(r"(10|20)\d{9}", ruc):
            return None, ("El contrato final exige el RUC real y schema_input solo trae un token. "
                          "Enviar la cabecera X-RUC-Solicitante dentro de la red interna."), sorted(banderas)

        explicacion = self.motor.redactar_explicacion_sbs(
            giro_ciiu=giro, nombre_giro=info["nombre_giro"], confianza_ocr=vf["confianza_extraccion_ia"],
            coherencia_giro=vf["coherencia_insumos_giro"], compras_comp=compras, margen=margen, rotacion=rotacion,
            ventas_imp=v_imp, ventas_decl=ventas, delta=delta, fnd=fnd, cuota=cuota, rcc=rcc, dictamen=dictamen,
            monto_solicitado=monto,
        )
        ahora = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")
        huella = hashlib.sha256(f"{entrada['expediente_id']}|{ruc}|{ventas}|{compras}".encode("utf-8")).hexdigest()
        claves = ("alerta_fraude_maquillaje", "requiere_revision_humana", "clasificacion_sbs_proyectada", "tasa_provision_sbs",
                  "escala_interna_caja_trujillo", "accion_operativa", "monto_maximo_recomendado")
        return {
            "expediente_id": entrada["expediente_id"],
            "timestamp_auditoria": ahora,
            "agencia_origen": entrada["agencia_origen"],
            "modo_inferencia": config.MODO_INFERENCIA,
            "hash_integridad_sha256": huella,
            "validacion_fiscal": {
                "ruc": ruc, "estado_sunat": vf["estado_sunat"], "condicion_domicilio": vf["condicion_domicilio"],
                "giro_ciiu": giro, "nombre_giro": info["nombre_giro"],
                "coherencia_insumos_giro": vf["coherencia_insumos_giro"],
                "confianza_extraccion_ia": vf["confianza_extraccion_ia"],
            },
            "triangulacion_financiera": {
                "moneda": "PEN", "ventas_declaradas_asesor": ventas, "compras_comprobadas_documentos": compras,
                "margen_bruto_ciiu": margen, "factor_rotacion_mensual": rotacion,
                "inventario_fisico_estimado": float(decl["inventario_fisico_estimado_pen"]),
                "gastos_operativos_familiares": gastos, "cuota_deuda_sbs_vigente": deuda,
                "ventas_implicitas_calculadas": v_imp, "delta_desviacion_declarativa": delta,
                "flujo_neto_disponible": fnd, "cuota_mensual_propuesta": cuota, "ratio_cobertura_cuota_rcc": rcc,
            },
            "dictamen_riesgos": {
                **{k: dictamen[k] for k in claves},
                "monto_solicitado_original": monto,
                "explicacion_agente_sbs": explicacion,
            },
        }, None, sorted(banderas)
