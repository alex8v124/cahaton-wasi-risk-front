#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
WASI-RISK AI — Motor Cuantitativo Determinista de Triangulación Microfinanciera
Evento: Cajathón 2026 — Caja Trujillo (Track de Riesgos)
Autores:
  - Alejandro Flores (Scoring Cuantitativo & BPMN 2.0)
  - Soe Macero (Compliance SBS & Integración IA Agéntica en VPS)
  - Nicolás López (Reglas Paramétricas & P&L Bancario)
  - Alexander Miranda (Arquitectura Core & Contrato JSON)

100% Biblioteca Estándar de Python 3 (json, math, random, pathlib, hashlib).
Cero dependencias externas para máxima auditabilidad regulatoria SBS.
"""

import hashlib
import json
import math
import random
from pathlib import Path
from typing import Any, Dict, List, Tuple


class WasiRiskScoringEngine:
    """
    Motor determinista auditable bajo la Resolución SBS N.° 11356-2008.
    Calcula Ventas Implícitas, Delta de Fraude Declarativo, Flujo Neto Disponible (FND),
    Ratio de Cobertura de Cuota (RCC) y homologa a la escala interna de Caja Trujillo (AAA - C).
    """

    def __init__(self, reglas_path: Path, lexico_path: Path) -> None:
        self.reglas_path = reglas_path
        self.lexico_path = lexico_path
        with open(self.reglas_path, "r", encoding="utf-8") as f:
            self.reglas: Dict[str, Any] = json.load(f)
        with open(self.lexico_path, "r", encoding="utf-8") as f:
            self.lexico: Dict[str, Any] = json.load(f)

        self.giros_ciiu: Dict[str, Any] = self.reglas["giros_ciiu_trujillo"]
        self.provisiones_sbs: Dict[str, float] = self.reglas["provisiones_sbs_11356"]
        self.matriz_caja: Dict[str, Any] = self.reglas["matriz_homologacion_caja_trujillo"]
        self.umbral_fraude: float = float(
            self.reglas["metadata_repositorio"]["umbral_alerta_fraude_delta"]
        )
        self.umbral_ocr: float = float(
            self.reglas["metadata_repositorio"]["umbral_minimo_confianza_ocr"]
        )

    @staticmethod
    def calcular_ventas_implicitas(
        compras_comprobadas: float,
        margen_bruto_ciiu: float,
        factor_rotacion_mensual: float = 1.00,
    ) -> float:
        """
        Fórmula Oficial WASI-RISK AI:
            V_imp = (C_comp / (1 - margen_bruto_ciiu)) * factor_rotacion_mensual
        Retorna el importe en Soles Peruanos (PEN) redondeado a 2 decimales exactos.
        """
        if margen_bruto_ciiu >= 1.0 or margen_bruto_ciiu < 0.0:
            raise ValueError(f"Margen bruto CIIU inválido: {margen_bruto_ciiu}")
        if compras_comprobadas <= 0.0:
            return 0.00
        ventas_imp = (compras_comprobadas / (1.0 - margen_bruto_ciiu)) * factor_rotacion_mensual
        return round(ventas_imp, 2)

    @staticmethod
    def calcular_delta_fraude(
        ventas_declaradas: float,
        ventas_implicitas: float,
    ) -> float:
        """
        Fórmula Oficial de Desviación Declarativa (Maquillaje de Ventas):
            Delta_fraude = (V_decl - V_imp) / V_imp
        Retorna el ratio redondeado a 3 decimales (ej. 0.212 = +21.2%).
        """
        if ventas_implicitas <= 0.0:
            return 99.000
        delta = (ventas_declaradas - ventas_implicitas) / ventas_implicitas
        return round(delta, 3)

    @staticmethod
    def calcular_flujo_neto_disponible(
        ventas_declaradas: float,
        ventas_implicitas: float,
        margen_bruto_ciiu: float,
        gastos_operativos_familiares: float,
        cuota_deuda_sbs_vigente: float,
    ) -> float:
        """
        Principio Prudencial SBS N.° 11356-2008:
        Se toma SIEMPRE el mínimo entre Ventas Declaradas y Ventas Implícitas
        para impedir que la inflación declarativa eleve artificialmente el flujo.
            FND = (min(V_decl, V_imp) * margen_bruto_ciiu) - G_op_fam - D_sbs
        """
        base_ventas_prudencial = min(ventas_declaradas, ventas_implicitas)
        utilidad_bruta = base_ventas_prudencial * margen_bruto_ciiu
        fnd = utilidad_bruta - gastos_operativos_familiares - cuota_deuda_sbs_vigente
        return round(max(0.00, fnd), 2)

    @staticmethod
    def calcular_rcc(
        flujo_neto_disponible: float,
        cuota_mensual_propuesta: float,
    ) -> float:
        """
        Fórmula del Ratio de Cobertura de Cuota (RCC):
            RCC = FND / Cuota_Propuesta
        Retorna el ratio redondeado a 2 decimales.
        """
        if cuota_mensual_propuesta <= 0.0:
            raise ValueError("La cuota mensual propuesta debe ser mayor a S/ 0.00")
        rcc = flujo_neto_disponible / cuota_mensual_propuesta
        return round(max(0.00, rcc), 2)

    # ==========================================================================
    # EXTENSIÓN OFICIAL RIE-02: MOTOR DE GRAFOS, RAREZA Y PUNTAJE DE RED (v2.0)
    # ==========================================================================
    @staticmethod
    def calcular_rareza_atributo(n_entidades: int) -> float:
        """
        Fórmula de Rareza RIE-02 (Sección 7.2 Especificación v2.0):
            rareza = 1 / log2(1 + n)
        Donde n = número de entidades que comparten el atributo (teléfono, dirección, etc.).
        Ejemplos: n=2 -> 0.63 | n=3 -> 0.50 | n=300 (Mercado La Hermelinda) -> 0.12.
        """
        if n_entidades <= 0:
            return 1.00
        return round(1.0 / math.log2(1.0 + n_entidades), 2)

    @staticmethod
    def calcular_s_patrones(patrones_detectados: List[Dict[str, Any]]) -> float:
        """
        Fórmula S_patrones (Sección 7.2 Especificación v2.0):
            S_patrones = min(1.0, suma de [peso_patron * rareza * factor_subred])
        Si el patrón incluye 'aporte_normalizado_subred', suma dicho aporte exacto;
        de lo contrario suma peso * rareza.
        """
        if not patrones_detectados:
            return 0.00
        total = 0.0
        for p in patrones_detectados:
            if "aporte_normalizado_subred" in p:
                total += float(p["aporte_normalizado_subred"])
            else:
                total += float(p.get("peso", 0.25)) * float(p.get("rareza", 0.50))
        return round(min(1.00, max(0.00, total)), 2)

    @staticmethod
    def calcular_puntaje_red_rie02(
        s_patrones: float,
        s_anomalia: float,
        s_comunidad: float,
        f_contexto: float = 1.00,
    ) -> int:
        """
        Fórmula Oficial de Puntaje de Red RIE-02 (0 a 100):
            Puntaje_red = 100 * (0.50 * S_patrones + 0.30 * S_anomalia + 0.20 * S_comunidad) * F_contexto
        """
        sp = min(1.0, max(0.0, s_patrones))
        sa = min(1.0, max(0.0, s_anomalia))
        sc = min(1.0, max(0.0, s_comunidad))
        fc = min(1.0, max(0.30, f_contexto))
        raw = 100.0 * (0.50 * sp + 0.30 * sa + 0.20 * sc) * fc
        return int(round(raw))

    @staticmethod
    def clasificar_prioridad_rie02(
        puntaje_red: Any,
        confianza_resolucion: float = 0.95,
    ) -> Dict[str, Any]:
        """
        Tabla 14 & RN-04 / RN-05 (Poka-Yoke):
          - confianza < 0.85 -> VERIFICAR_DATOS (Sin puntaje)
          - 0..39            -> SIN_ALERTA (CONTINUAR)
          - 40..69           -> OBSERVACION (MONITOREAR)
          - 70..100          -> REVISION_PRIORITARIA (RETENER_HASTA_REVISION)
        """
        if confianza_resolucion < 0.85 or puntaje_red is None:
            return {
                "puntaje_red": None,
                "nivel": "VERIFICAR_DATOS",
                "accion_recomendada": "VERIFICAR_DATOS",
                "requiere_verificacion_manual": True,
            }
        p = int(puntaje_red)
        if p >= 70:
            return {
                "puntaje_red": p,
                "nivel": "REVISION_PRIORITARIA",
                "accion_recomendada": "RETENER_HASTA_REVISION",
                "requiere_verificacion_manual": False,
            }
        if p >= 40:
            return {
                "puntaje_red": p,
                "nivel": "OBSERVACION",
                "accion_recomendada": "MONITOREAR",
                "requiere_verificacion_manual": False,
            }
        return {
            "puntaje_red": p,
            "nivel": "SIN_ALERTA",
            "accion_recomendada": "CONTINUAR",
            "requiere_verificacion_manual": False,
        }

    def validar_casos_simulados_rie02(self, rie02_path: Path) -> Tuple[bool, List[str]]:
        """Verifica matemáticamente los 6 Casos Simulados (CS-01 a CS-06) del documento v2.0."""
        with open(rie02_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        logs: List[str] = []
        todo_ok = True
        for cs in data["casos_simulados"]:
            cid = cs["caso_id"]
            resp = cs["response_analisis"]
            cal = resp["calidad_datos"]
            prio = resp["priorizacion"]
            sub = cs["subred_2_saltos"]
            aristas_grafo_ids = {a["id"] for a in sub["aristas"] if "id" in a}
            aristas_citadas = set(resp["expediente_agente"].get("aristas_evidencia_ids", []))
            evidencia_integra = aristas_citadas.issubset(aristas_grafo_ids)

            if cal["confianza_resolucion"] < 0.85:
                calc = self.clasificar_prioridad_rie02(None, cal["confianza_resolucion"])
                ok = (calc["nivel"] == prio["nivel"]) and (prio["puntaje_red"] is None) and evidencia_integra
                logs.append(
                    f"[{'OK' if ok else 'ERR'}] {cid} ({cs['solicitud_id']}): "
                    f"Poka-Yoke Confianza={cal['confianza_resolucion']} -> {calc['nivel']} | "
                    f"AristasVerificadas={len(aristas_citadas)}/{len(aristas_citadas)}"
                )
            else:
                comp = prio["componentes"]
                sp_from_pats = self.calcular_s_patrones(resp["patrones_detectados"])
                p_calc = self.calcular_puntaje_red_rie02(
                    comp["patrones"],
                    comp["anomalia"],
                    comp["comunidad"],
                    prio["factor_contexto"],
                )
                calc = self.clasificar_prioridad_rie02(p_calc, cal["confianza_resolucion"])
                ok = (
                    (p_calc == prio["puntaje_red"])
                    and (calc["nivel"] == prio["nivel"])
                    and math.isclose(sp_from_pats, comp["patrones"], abs_tol=0.01)
                    and evidencia_integra
                )
                logs.append(
                    f"[{'OK' if ok else 'ERR'}] {cid} ({cs['solicitud_id']}): "
                    f"S_pat={sp_from_pats:.2f} | Puntaje={p_calc}/100 | Nivel={calc['nivel']} | "
                    f"AristasVerificadas={len(aristas_citadas)}/{len(aristas_citadas)}"
                )
            if not ok:
                todo_ok = False
        return todo_ok, logs

    def homologar_escala_caja_trujillo(
        self,
        delta_fraude: float,
        rcc: float,
        coherencia_insumos_giro: bool = True,
        confianza_extraccion_ia: float = 0.95,
        monto_solicitado: float = 10000.00,
    ) -> Dict[str, Any]:
        """
        Homologa el vector cuantitativo a la matriz interna de Caja Trujillo (AAA, AA, A, B, C)
        y a la clasificación regulatoria Res. SBS N.° 11356-2008.
        Aplica reglas EARS (Ubiquitous, Event-Driven y Poka-Yoke).
        """
        alerta_fraude_maquillaje = bool(delta_fraude > self.umbral_fraude)
        poka_yoke_activo = bool(
            (confianza_extraccion_ia < self.umbral_ocr) or (not coherencia_insumos_giro)
        )

        # Regla Unwanted Behavior (Poka-Yoke Documental o Incoherencia de Giro)
        if poka_yoke_activo:
            return {
                "escala_interna_caja_trujillo": "C",
                "clasificacion_sbs_proyectada": "PERDIDA",
                "tasa_provision_sbs": self.provisiones_sbs["PERDIDA"],
                "accion_operativa": "BLOQUEO_POKA_YOKE_DERIVACION_AUDITOR_HUMANO",
                "alerta_fraude_maquillaje": alerta_fraude_maquillaje,
                "requiere_revision_humana": True,
                "monto_maximo_recomendado": 0.00,
            }

        # Evaluación secuencial contra la Matriz de Homologación Caja Trujillo
        if delta_fraude <= self.matriz_caja["AAA"]["delta_max"] and rcc >= self.matriz_caja["AAA"]["rcc_min"]:
            escala = "AAA"
        elif delta_fraude <= self.matriz_caja["AA"]["delta_max"] and rcc >= self.matriz_caja["AA"]["rcc_min"]:
            escala = "AA"
        elif delta_fraude <= self.matriz_caja["A"]["delta_max"] and rcc >= self.matriz_caja["A"]["rcc_min"]:
            escala = "A"
        elif delta_fraude <= self.matriz_caja["B"]["delta_max"] and rcc >= self.matriz_caja["B"]["rcc_min"]:
            escala = "B"
        else:
            escala = "C"

        cfg = self.matriz_caja[escala]
        clasificacion_sbs = cfg["clasificacion_sbs_equivalente"]
        tasa_provision = float(cfg["tasa_provision_sbs"])
        accion_operativa = cfg["accion"]

        # Cálculo del monto máximo recomendado (redondeado al múltiplo de S/ 500 más cercano para MYPE)
        if escala in ("AAA", "AA"):
            monto_recomendado = round(monto_solicitado, 2)
            requiere_revision = False
        elif escala == "A":
            monto_bruto = monto_solicitado * cfg["factor_aprobacion_monto"]
            monto_recomendado = round(round(monto_bruto / 500.0) * 500.0, 2)
            requiere_revision = False
        elif escala == "B":
            monto_bruto = monto_solicitado * cfg["factor_aprobacion_monto"]
            monto_recomendado = round(round(monto_bruto / 500.0) * 500.0, 2)
            requiere_revision = True
        else:
            monto_bruto = monto_solicitado * cfg["factor_aprobacion_monto"]
            monto_recomendado = round(round(monto_bruto / 500.0) * 500.0, 2)
            requiere_revision = True

        return {
            "escala_interna_caja_trujillo": escala,
            "clasificacion_sbs_proyectada": clasificacion_sbs,
            "tasa_provision_sbs": tasa_provision,
            "accion_operativa": accion_operativa,
            "alerta_fraude_maquillaje": alerta_fraude_maquillaje,
            "requiere_revision_humana": requiere_revision,
            "monto_maximo_recomendado": monto_recomendado,
        }

    def redactar_explicacion_sbs(
        self,
        giro_ciiu: str,
        nombre_giro: str,
        confianza_ocr: float,
        coherencia_giro: bool,
        compras_comp: float,
        margen: float,
        rotacion: float,
        ventas_imp: float,
        ventas_decl: float,
        delta: float,
        fnd: float,
        cuota: float,
        rcc: float,
        dictamen: Dict[str, Any],
        monto_solicitado: float,
    ) -> str:
        """
        Genera la sustentación normativa auditable según AGENT_SKILL_SOE.md.
        """
        if not coherencia_giro or confianza_ocr < self.umbral_ocr:
            return (
                f"AUDITORÍA PRE-DESEMBOLSO SBS [CIIU {giro_ciiu} - {nombre_giro}]: "
                f"BLOQUEO PREVENTIVO POKA-YOKE ACTIVADO. Certeza OCR de {confianza_ocr*100:.0f}% "
                f"y coherencia de insumos = {str(coherencia_giro).lower()}. "
                f"En cumplimiento de la Res. SBS N.° 11356-2008, el agente no interpola montos "
                f"ilegibles ni admite boletas cruzadas de otro giro. "
                f"Dictamen Escala Caja Trujillo [{dictamen['escala_interna_caja_trujillo']}]: "
                f"{dictamen['accion_operativa']}, recomendando S/ 0.00 de desembolso automático."
            )

        estado_coherencia = "100% coherentes" if coherencia_giro else "incoherentes"
        return (
            f"AUDITORÍA PRE-DESEMBOLSO SBS [CIIU {giro_ciiu} - {nombre_giro}]: "
            f"Evidencia documental con certeza OCR de {confianza_ocr*100:.0f}% e insumos {estado_coherencia} "
            f"con el giro declarado. La triangulación microfinanciera registra compras comprobadas por "
            f"S/ {compras_comp:,.2f} (margen estándar {margen*100:.0f}%, rotación {rotacion:.2f}x), "
            f"sustentando Ventas Implícitas de S/ {ventas_imp:,.2f} frente a las Ventas Declaradas por el asesor "
            f"de S/ {ventas_decl:,.2f} (desviación declarativa Delta de {delta*100:+.1f}%). "
            f"Conforme a la Res. SBS N.° 11356-2008 (evaluación de capacidad de pago real deudor MYPE, "
            f"clasificación proyectada {dictamen['clasificacion_sbs_proyectada']} con provisión del "
            f"{dictamen['tasa_provision_sbs']*100:.0f}%), el Flujo Neto Disponible conservador de "
            f"S/ {fnd:,.2f} genera un RCC de {rcc:.2f}x sobre la cuota de S/ {cuota:,.2f}. "
            f"Dictamen Escala Caja Trujillo [{dictamen['escala_interna_caja_trujillo']}]: "
            f"{dictamen['accion_operativa']}, recomendando un tope de "
            f"S/ {dictamen['monto_maximo_recomendado']:,.2f} sobre los S/ {monto_solicitado:,.2f} solicitados."
        )

    def validar_golden_cases(self, golden_cases_path: Path) -> Tuple[bool, List[str]]:
        """
        Verifica matemáticamente los 4 Casos Testigo Oficiales de few_shot_golden_cases.json.
        """
        with open(golden_cases_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        logs: List[str] = []
        todo_ok = True

        for caso in data["casos_testigo"]:
            out = caso["output_contrato_json"]
            exp_id = out["expediente_id"]
            vf = out["validacion_fiscal"]
            tf = out["triangulacion_financiera"]
            dr = out["dictamen_riesgos"]

            v_imp_calc = self.calcular_ventas_implicitas(
                tf["compras_comprobadas_documentos"],
                tf["margen_bruto_ciiu"],
                tf["factor_rotacion_mensual"],
            )
            delta_calc = self.calcular_delta_fraude(
                tf["ventas_declaradas_asesor"],
                v_imp_calc,
            )
            fnd_calc = self.calcular_flujo_neto_disponible(
                tf["ventas_declaradas_asesor"],
                v_imp_calc,
                tf["margen_bruto_ciiu"],
                tf["gastos_operativos_familiares"],
                tf["cuota_deuda_sbs_vigente"],
            )
            rcc_calc = self.calcular_rcc(fnd_calc, tf["cuota_mensual_propuesta"])
            homologacion = self.homologar_escala_caja_trujillo(
                delta_fraude=delta_calc,
                rcc=rcc_calc,
                coherencia_insumos_giro=vf["coherencia_insumos_giro"],
                confianza_extraccion_ia=vf["confianza_extraccion_ia"],
                monto_solicitado=dr["monto_solicitado_original"],
            )

            checks = [
                math.isclose(v_imp_calc, tf["ventas_implicitas_calculadas"], abs_tol=0.05),
                math.isclose(delta_calc, tf["delta_desviacion_declarativa"], abs_tol=0.005),
                math.isclose(fnd_calc, tf["flujo_neto_disponible"], abs_tol=0.05),
                math.isclose(rcc_calc, tf["ratio_cobertura_cuota_rcc"], abs_tol=0.02),
                homologacion["escala_interna_caja_trujillo"] == dr["escala_interna_caja_trujillo"],
                homologacion["alerta_fraude_maquillaje"] == dr["alerta_fraude_maquillaje"],
                math.isclose(
                    homologacion["monto_maximo_recomendado"],
                    dr["monto_maximo_recomendado"],
                    abs_tol=1.0,
                ),
            ]

            if all(checks):
                logs.append(
                    f"[OK] {exp_id} ({caso['etiqueta_ui']}): "
                    f"V_imp=S/ {v_imp_calc:,.2f} | Delta={delta_calc:+.3f} | "
                    f"FND=S/ {fnd_calc:,.2f} | RCC={rcc_calc:.2f}x | "
                    f"Escala={homologacion['escala_interna_caja_trujillo']}"
                )
            else:
                todo_ok = False
                logs.append(f"[ERROR] Discrepancia en {exp_id}: calculado={homologacion}")

        return todo_ok, logs

    def generar_dataset_50_expedientes(self, output_path: Path, seed: int = 2026) -> Dict[str, Any]:
        """
        Genera 50 expedientes sintéticos realistas para Trujillo con distribución exacta:
          - 35 expedientes saludables en AAA / AA (Fast-Track y Aprobación Estándar)
          - 8 expedientes intermedios en A / B (Recorte automático de monto / Observado)
          - 7 expedientes críticos en C (Maquillaje de asesor Viernes 6pm / Poka-Yoke)
        """
        rng = random.Random(seed)
        agencias_trujillo = [
            "Agencia El Porvenir",
            "Agencia La Hermelinda",
            "Agencia Centro Historico - Jr. Pizarro",
            "Agencia La Esperanza",
            "Agencia San Nicolas",
            "Agencia Laredo",
            "Agencia Moche",
        ]
        codigos_ciiu = list(self.giros_ciiu.keys())
        expedientes: List[Dict[str, Any]] = []

        # Plan de distribución exacta: 35 (AAA/AA), 8 (A/B), 7 (C)
        perfiles_objetivo: List[str] = (
            ["AAA"] * 22
            + ["AA"] * 13
            + ["A"] * 5
            + ["B"] * 3
            + ["C_MAQUILLAJE"] * 5
            + ["C_POKA_YOKE"] * 2
        )

        for idx, perfil in enumerate(perfiles_objetivo, start=1):
            exp_id = f"EXP-TRUJ-2026-{1000 + idx:04d}"
            ciiu = codigos_ciiu[(idx - 1) % len(codigos_ciiu)]
            info_giro = self.giros_ciiu[ciiu]
            margen = float(info_giro["margen_bruto_estandar"])
            rotacion = float(info_giro["factor_rotacion_mensual"])
            agencia = agencias_trujillo[(idx - 1) % len(agencias_trujillo)]
            ruc = f"104{rng.randint(1000000, 9999999)}{idx % 10}"

            # Compras comprobadas base entre S/ 3,500 y S/ 9,500
            compras_comp = round(rng.uniform(3800.0, 8800.0), -1)
            v_imp = self.calcular_ventas_implicitas(compras_comp, margen, rotacion)

            coherencia_giro = True
            confianza_ocr = round(rng.uniform(0.90, 0.98), 2)

            if perfil == "AAA":
                factor_decl = rng.uniform(0.96, 1.07)
                target_rcc = rng.uniform(1.65, 2.15)
                monto_sol = round(rng.uniform(6000.0, 14000.0), -2)
            elif perfil == "AA":
                factor_decl = rng.uniform(1.105, 1.142)
                target_rcc = rng.uniform(1.38, 1.56)
                monto_sol = round(rng.uniform(7000.0, 15000.0), -2)
            elif perfil == "A":
                factor_decl = rng.uniform(1.16, 1.24)
                target_rcc = rng.uniform(1.17, 1.31)
                monto_sol = round(rng.uniform(9000.0, 16000.0), -2)
            elif perfil == "B":
                factor_decl = rng.uniform(1.26, 1.34)
                target_rcc = rng.uniform(1.02, 1.13)
                monto_sol = round(rng.uniform(10000.0, 18000.0), -2)
            elif perfil == "C_MAQUILLAJE":
                # Asesor inflando ventas entre +65% y +155% (Viernes 6pm)
                factor_decl = rng.uniform(1.65, 2.55)
                target_rcc = rng.uniform(0.68, 0.92)
                monto_sol = round(rng.uniform(12000.0, 22000.0), -2)
            else:
                # C_POKA_YOKE: Baja certeza OCR o incoherencia de giro
                factor_decl = rng.uniform(1.45, 2.10)
                target_rcc = rng.uniform(0.50, 0.85)
                monto_sol = round(rng.uniform(8000.0, 15000.0), -2)
                coherencia_giro = False
                confianza_ocr = round(rng.uniform(0.68, 0.81), 2)

            ventas_decl = round(v_imp * factor_decl, 2)
            delta = self.calcular_delta_fraude(ventas_decl, v_imp)

            base_prudencial = min(ventas_decl, v_imp)
            utilidad_bruta = base_prudencial * margen
            cuota_propuesta = round(utilidad_bruta * 0.42, 2)
            fnd_objetivo = round(cuota_propuesta * target_rcc, 2)

            # Ajustar gastos y deuda para que el FND sea exacto y consistente
            gastos_totales = max(250.0, round(utilidad_bruta - fnd_objetivo, 2))
            deuda_sbs = round(gastos_totales * 0.30, 2)
            gastos_op_fam = round(gastos_totales - deuda_sbs, 2)

            fnd = self.calcular_flujo_neto_disponible(
                ventas_decl, v_imp, margen, gastos_op_fam, deuda_sbs
            )
            rcc = self.calcular_rcc(fnd, cuota_propuesta)
            dictamen = self.homologar_escala_caja_trujillo(
                delta_fraude=delta,
                rcc=rcc,
                coherencia_insumos_giro=coherencia_giro,
                confianza_extraccion_ia=confianza_ocr,
                monto_solicitado=monto_sol,
            )

            explicacion = self.redactar_explicacion_sbs(
                giro_ciiu=ciiu,
                nombre_giro=info_giro["nombre_giro"],
                confianza_ocr=confianza_ocr,
                coherencia_giro=coherencia_giro,
                compras_comp=compras_comp,
                margen=margen,
                rotacion=rotacion,
                ventas_imp=v_imp,
                ventas_decl=ventas_decl,
                delta=delta,
                fnd=fnd,
                cuota=cuota_propuesta,
                rcc=rcc,
                dictamen=dictamen,
                monto_solicitado=monto_sol,
            )

            hash_sha256 = hashlib.sha256(f"{exp_id}-{ruc}-{ventas_decl}".encode("utf-8")).hexdigest()
            inventario_est = round(compras_comp * rng.uniform(1.15, 1.45), 2)

            # Bloque RIE-02 (Grafo de Redes Ocultas v2.0) coherente con la escala AAA-C
            escala_actual = dictamen["escala_interna_caja_trujillo"]
            asesor_code = f"ASE-{(idx % 12) + 1:03d}"
            tel_hash = f"TEL-94{8000000 + (idx % 7) * 11111 if escala_actual == 'C' else 8100000 + idx}"
            dir_node = "DIR-HERMELINDA-CENTRAL" if ciiu in ("5211", "5122") else f"DIR-TRUJ-{(idx % 15) + 1:03d}"

            if perfil == "C_POKA_YOKE":
                rie02_block = {
                    "ground_truth_es_anillo": None,
                    "comunidad_id": None,
                    "asesor_id": asesor_code,
                    "telefono_seudonimizado": tel_hash,
                    "direccion_nodo": dir_node,
                    "dispositivo_fingerprint": f"dev:corp-{asesor_code.lower()}",
                    "patrones_detectados": [],
                    "contexto_legitimo": [],
                    "puntaje_red": None,
                    "nivel_prioridad": "VERIFICAR_DATOS",
                    "accion_recomendada": "VERIFICAR_DATOS",
                }
            elif escala_actual == "C":
                p_red = rng.randint(76, 92)
                rie02_block = {
                    "ground_truth_es_anillo": True,
                    "comunidad_id": f"COM-ANILLO-{(idx % 3) + 1:02d}",
                    "asesor_id": "ASE-017",
                    "telefono_seudonimizado": "TEL-948112233",
                    "direccion_nodo": "DIR-MZ-K-LT14",
                    "dispositivo_fingerprint": "dev:7a1e99c2f0",
                    "patrones_detectados": ["P-01", "P-02", "P-03", "P-08"],
                    "contexto_legitimo": [],
                    "puntaje_red": p_red,
                    "nivel_prioridad": "REVISION_PRIORITARIA",
                    "accion_recomendada": "RETENER_HASTA_REVISION",
                }
            elif escala_actual in ("A", "B"):
                p_red = rng.randint(44, 66)
                rie02_block = {
                    "ground_truth_es_anillo": True,
                    "comunidad_id": f"COM-OBS-{(idx % 4) + 1:02d}",
                    "asesor_id": "ASE-017" if idx % 2 == 0 else asesor_code,
                    "telefono_seudonimizado": tel_hash,
                    "direccion_nodo": dir_node,
                    "dispositivo_fingerprint": f"dev:corp-{asesor_code.lower()}",
                    "patrones_detectados": ["P-01", "P-07"],
                    "contexto_legitimo": ["L-06"],
                    "puntaje_red": p_red,
                    "nivel_prioridad": "OBSERVACION",
                    "accion_recomendada": "MONITOREAR",
                }
            else:
                p_red = rng.randint(8, 28)
                ctx_leg = ["L-02", "L-06"] if ciiu in ("5211", "5122") else ["L-01", "L-06"]
                rie02_block = {
                    "ground_truth_es_anillo": False,
                    "comunidad_id": f"COM-LEGIT-{(idx % 6) + 1:02d}",
                    "asesor_id": asesor_code,
                    "telefono_seudonimizado": tel_hash,
                    "direccion_nodo": dir_node,
                    "dispositivo_fingerprint": f"dev:corp-{asesor_code.lower()}",
                    "patrones_detectados": ["P-04"] if p_red > 15 else [],
                    "contexto_legitimo": ctx_leg,
                    "puntaje_red": p_red,
                    "nivel_prioridad": "SIN_ALERTA",
                    "accion_recomendada": "CONTINUAR",
                }

            rie02_block["subred_2_saltos"] = {
                "nodos": [
                    {"id": exp_id, "tipo": "SOLICITUD", "etiqueta": f"{exp_id} (S/ {monto_sol:,.0f})", "color": "#F59E0B", "salto": 0},
                    {"id": f"NEG-{ruc}", "tipo": "NEGOCIO", "etiqueta": f"RUC {ruc} (CIIU {ciiu})", "color": "#3B82F6", "salto": 1},
                    {"id": rie02_block["telefono_seudonimizado"], "tipo": "TELEFONO", "etiqueta": rie02_block["telefono_seudonimizado"], "color": "#64748B", "salto": 1},
                    {"id": rie02_block["direccion_nodo"], "tipo": "DIRECCION", "etiqueta": rie02_block["direccion_nodo"], "color": "#10B981", "salto": 1},
                ],
                "aristas": [
                    {"id": f"{exp_id}-E01", "origen": exp_id, "destino": f"NEG-{ruc}", "relacion": "financia", "es_evidencia": escala_actual == "C", "fuente": "SUNAT", "fecha": "2026-11-15", "salto": 1},
                    {"id": f"{exp_id}-E02", "origen": exp_id, "destino": rie02_block["telefono_seudonimizado"], "relacion": "usa_telefono", "es_evidencia": "P-01" in rie02_block["patrones_detectados"], "fuente": "Campo", "fecha": "2026-11-15", "salto": 1},
                    {"id": f"{exp_id}-E03", "origen": f"NEG-{ruc}", "destino": rie02_block["direccion_nodo"], "relacion": "opera_en", "es_evidencia": False, "fuente": "Geohash", "fecha": "2026-11-15", "salto": 2},
                ],
            }

            expedientes.append(
                {
                    "expediente_id": exp_id,
                    "timestamp_auditoria": f"2026-11-15T{9 + (idx % 10):02d}:{(idx * 7) % 60:02d}:00-05:00",
                    "agencia_origen": agencia,
                    "modo_inferencia": "HIBRIDO_SANITIZADO_VPS_SOE",
                    "hash_integridad_sha256": hash_sha256,
                    "validacion_fiscal": {
                        "ruc": ruc,
                        "estado_sunat": "ACTIVO",
                        "condicion_domicilio": "HABIDO",
                        "giro_ciiu": ciiu,
                        "nombre_giro": info_giro["nombre_giro"],
                        "coherencia_insumos_giro": coherencia_giro,
                        "confianza_extraccion_ia": confianza_ocr,
                    },
                    "triangulacion_financiera": {
                        "moneda": "PEN",
                        "ventas_declaradas_asesor": ventas_decl,
                        "compras_comprobadas_documentos": compras_comp,
                        "margen_bruto_ciiu": margen,
                        "factor_rotacion_mensual": rotacion,
                        "inventario_fisico_estimado": inventario_est,
                        "gastos_operativos_familiares": gastos_op_fam,
                        "cuota_deuda_sbs_vigente": deuda_sbs,
                        "ventas_implicitas_calculadas": v_imp,
                        "delta_desviacion_declarativa": delta,
                        "flujo_neto_disponible": fnd,
                        "cuota_mensual_propuesta": cuota_propuesta,
                        "ratio_cobertura_cuota_rcc": rcc,
                    },
                    "analisis_red_rie02": rie02_block,
                    "dictamen_riesgos": {
                        "alerta_fraude_maquillaje": dictamen["alerta_fraude_maquillaje"],
                        "requiere_revision_humana": dictamen["requiere_revision_humana"],
                        "clasificacion_sbs_proyectada": dictamen["clasificacion_sbs_proyectada"],
                        "tasa_provision_sbs": dictamen["tasa_provision_sbs"],
                        "escala_interna_caja_trujillo": dictamen["escala_interna_caja_trujillo"],
                        "accion_operativa": dictamen["accion_operativa"],
                        "monto_solicitado_original": monto_sol,
                        "monto_maximo_recomendado": dictamen["monto_maximo_recomendado"],
                        "explicacion_agente_sbs": explicacion,
                    },
                }
            )

        resumen_escalas: Dict[str, int] = {"AAA": 0, "AA": 0, "A": 0, "B": 0, "C": 0}
        for exp in expedientes:
            esc = exp["dictamen_riesgos"]["escala_interna_caja_trujillo"]
            resumen_escalas[esc] = resumen_escalas.get(esc, 0) + 1

        payload_dataset = {
            "metadata_dataset": {
                "sistema": "WASI-RISK AI - Simulador Cartera MYPE Caja Trujillo",
                "total_expedientes": len(expedientes),
                "distribucion_escalas": resumen_escalas,
                "resumen_grupos": {
                    "AAA_AA_saludables": resumen_escalas["AAA"] + resumen_escalas["AA"],
                    "A_B_intermedios_recorte": resumen_escalas["A"] + resumen_escalas["B"],
                    "C_bloqueo_fraude_poka_yoke": resumen_escalas["C"],
                },
                "moneda": "PEN",
            },
            "expedientes": expedientes,
        }

        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(payload_dataset, f, ensure_ascii=False, indent=2)

        return payload_dataset


def main() -> None:
    base_dir = Path(__file__).resolve().parent.parent
    reglas_path = base_dir / "data" / "reglas_parametricas_trujillo.json"
    lexico_path = base_dir / "data" / "lexico_unidades_mype.json"
    golden_path = base_dir / "data" / "few_shot_golden_cases.json"
    rie02_path = base_dir / "data" / "catalogo_red_rie02_casos_simulados.json"
    dataset_out_path = base_dir / "data" / "dataset_50_expedientes_trujillo.json"

    print("=" * 84)
    print("WASI-RISK AI | MOTOR CUANTITATIVO & GRAFOS RIE-02 — CAJATHÓN 2026 (CAJA TRUJILLO)")
    print("=" * 84)

    engine = WasiRiskScoringEngine(reglas_path=reglas_path, lexico_path=lexico_path)

    print("\n[1/3] Validando los 4 Casos Testigo de Triangulación (few_shot_golden_cases.json)...")
    ok, logs = engine.validar_golden_cases(golden_path)
    for line in logs:
        print("  " + line)
    if not ok:
        raise RuntimeError("Fallo en la validación matemática de los Casos Testigo Oficiales.")

    print("\n[2/3] Validando los 6 Casos Simulados de Red RIE-02 (CS-01 a CS-06 v2.0)...")
    ok_rie, logs_rie = engine.validar_casos_simulados_rie02(rie02_path)
    for line in logs_rie:
        print("  " + line)
    if not ok_rie:
        raise RuntimeError("Fallo en la validación de los Casos Simulados RIE-02.")

    print("\n[3/3] Generando lote sintético de 50 expedientes con nodos RIE-02...")
    dataset = engine.generar_dataset_50_expedientes(dataset_out_path)
    meta = dataset["metadata_dataset"]
    print(f"  -> Archivo generado en: {dataset_out_path}")
    print(f"  -> Total expedientes auditados: {meta['total_expedientes']}")
    print(f"  -> Distribución por escala Caja Trujillo: {meta['distribucion_escalas']}")
    print(
        f"  -> Grupos de Control: AAA/AA={meta['resumen_grupos']['AAA_AA_saludables']} | "
        f"A/B={meta['resumen_grupos']['A_B_intermedios_recorte']} | "
        f"C (Alerta Roja/Poka-Yoke)={meta['resumen_grupos']['C_bloqueo_fraude_poka_yoke']}"
    )
    print("\n[AUDITORÍA COMPLETADA CON ÉXITO - 100% DETERMINISTA Y HOMOLOGADO A RIE-02 + RES. SBS 11356-2008]")


if __name__ == "__main__":
    main()
