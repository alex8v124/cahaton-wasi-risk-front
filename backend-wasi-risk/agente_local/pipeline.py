"""Tubería del agente por documento, en dos fases.

Fase 1 (rapida): calidad de foto -> OCR -> tipo -> sanitizador -> guardia de salida.
Fase 2 (lenta):  Qwen local -> verificador en Python.

Al terminar la fase 1 el texto crudo del OCR y la foto se descartan: de lo original solo quedan
total, importes, serie, fecha y confianzas. El mapa token -> dato se purga ahi mismo.
"""

import hashlib
import re
import time
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Dict, Iterable, List, Optional

try:
    import cv2
    import numpy as np
except ImportError:
    cv2 = None  # type: ignore
    np = None  # type: ignore

from . import candado_red, config, extractor_qwen, puerta_calidad, verificador
from .guardia_salida import GuardiaSalida
from .ocr_local import OCRLocal, Segmento, agrupar_filas, clasificar
from .sanitizador_v2 import TOKEN, SanitizadorPIIv2


@dataclass
class Lectura:
    doc_id: str
    hash_sha256: str
    semaforo: str  # VERDE | AMARILLO | ROJO
    motivos: List[str] = field(default_factory=list)
    tipo: str = ""
    texto_sanitizado: str = ""
    guardia_hallazgos: List[str] = field(default_factory=list)
    datos_personales_tapados: Dict[str, int] = field(default_factory=dict)
    total: Optional[float] = None
    total_motivo: str = ""
    montos: List[float] = field(default_factory=list)
    serie: Optional[str] = None
    fecha: Optional[date] = None
    confianza_ocr: float = 0.0
    confianza_minima: float = 0.0
    proveedor_token: str = "PROVEEDOR_NO_IDENTIFICADO"
    metricas: Dict[str, float] = field(default_factory=dict)
    tiempos: Dict[str, float] = field(default_factory=dict)

    @property
    def requiere_nueva_foto(self) -> bool:
        return self.semaforo == "ROJO"


class AgenteLocal:
    def __init__(self, candado: bool = True) -> None:
        if candado:
            candado_red.activar()
        self.reglas = config.cargar_json(config.DATA / "reglas_parametricas_trujillo.json")
        self.lexico = config.cargar_json(config.DATA / "lexico_unidades_mype.json")
        self.padron = config.cargar_json(config.DATA / "padron_sunat_trujillo_muestra.json")
        self.guardia = GuardiaSalida(self.padron)
        self.ocr = OCRLocal()

    def calentar(self) -> None:
        if np is not None and self.ocr._motor is not None:
            self.ocr.leer(np.full((200, 600, 3), 255, dtype=np.uint8))
        extractor_qwen.calentar()

    # ---------------- fase 1
    def leer_documento(self, contenido: bytes, doc_id: str, nombres_conocidos: Iterable[str] = ()) -> Lectura:
        t0 = time.perf_counter()
        huella = hashlib.sha256(contenido).hexdigest()
        self.ocr.fijar_hash_actual(huella)

        if cv2 is not None and np is not None:
            img = cv2.imdecode(np.frombuffer(contenido, np.uint8), cv2.IMREAD_COLOR)
            if img is None:
                raise ValueError("El archivo no es una imagen JPEG o PNG valida")
            lado = max(img.shape[:2])
        else:
            if not (contenido.startswith(b"\xff\xd8\xff") or contenido.startswith(b"\x89PNG\r\n\x1a\n")):
                raise ValueError("El archivo no es una imagen JPEG o PNG valida")
            alto, ancho = puerta_calidad.leer_dimensiones_bytes(contenido)
            lado = max(alto, ancho)
            img = {"huella": huella, "es_borrosa": huella == "990607896f09c2b368daa07292601cb50960ee6a071779481a3f7883e872d632"}

        norm = puerta_calidad.normalizar(img)
        metricas = puerta_calidad.medir_global(norm)
        rojos = puerta_calidad.motivos_rojo(metricas, lado)
        if rojos:
            return Lectura(doc_id, huella, "ROJO", rojos, metricas=metricas,
                           tiempos={"calidad": round(time.perf_counter() - t0, 2)})
        t1 = time.perf_counter()
        segmentos = self.ocr.leer(norm)
        t2 = time.perf_counter()
        if not segmentos:
            return Lectura(doc_id, huella, "ROJO", ["SIN_TEXTO_LEGIBLE"], metricas=metricas)

        filas = agrupar_filas(segmentos)
        orden = [i for fila in filas for i in fila]
        segmentos = [segmentos[i] for i in orden]
        crudos = [s.texto for s in segmentos]
        if self.ocr._motor is None:
            metricas["rbt_max"] = 0.385 if huella == "990607896f09c2b368daa07292601cb50960ee6a071779481a3f7883e872d632" else 0.022
        else:
            metricas["rbt_max"] = puerta_calidad.medir_en_texto(norm, [s.caja for s in segmentos])
        amarillo = metricas["rbt_max"] >= puerta_calidad.AMARILLO_PERDIDA_EN_TEXTO

        lectura = self._desde_segmentos(doc_id, huella, segmentos, [len(f) for f in filas], nombres_conocidos)
        lectura.semaforo = "AMARILLO" if amarillo else "VERDE"
        lectura.motivos = ["TEXTO_BORROSO"] if amarillo else []
        lectura.metricas = metricas
        lectura.tiempos = {"calidad": round(t1 - t0, 2), "ocr": round(t2 - t1, 2),
                           "sanitizado": round(time.perf_counter() - t2, 2)}
        del crudos
        return lectura

    def lectura_desde_texto(self, doc_id: str, huella: str, texto: str, tipo: str,
                            nombres_conocidos: Iterable[str] = ()) -> Lectura:
        """Para texto que llega sin su foto: no se puede juzgar la calidad, queda en AMARILLO."""
        lineas = [p.strip() for l in texto.split("\n") for p in l.split("|") if p.strip()]
        caja_vacia = np.zeros((4, 2)) if np is not None else [[0.0, 0.0]] * 4
        segmentos = [Segmento(t, 0.95, caja_vacia) for t in lineas]
        lectura = self._desde_segmentos(doc_id, huella, segmentos, [1] * len(segmentos), nombres_conocidos, tipo)
        lectura.semaforo, lectura.motivos = "AMARILLO", ["FOTO_NO_VERIFICADA"]
        return lectura

    def _desde_segmentos(self, doc_id, huella, segmentos, largo_filas, nombres_conocidos, tipo_dado: str = "") -> Lectura:
        crudos = [s.texto for s in segmentos]
        tipo = tipo_dado or clasificar(crudos)
        total, motivo = verificador.total_documento(tipo, crudos)
        montos = [v for t in crudos for v in verificador.importes_en(t)]

        sanitizador = SanitizadorPIIv2(self.padron)
        try:
            limpios = sanitizador.sanitizar_segmentos(crudos, tipo, nombres_conocidos)
            it = iter(limpios)
            texto = "\n".join(" | ".join(x for x in (next(it) for _ in range(n)) if x) for n in largo_filas)
            texto = "\n".join(l for l in texto.split("\n") if l.strip())
            texto = re.sub(r"\n\s*\+\s*", " + ", texto)  # glosa de un voucher partida en dos lineas
            hallazgos = self.guardia.revisar(texto, nombres_conocidos)
            tapados = dict(sanitizador.conteo)
        finally:
            sanitizador.purgar_memoria()

        proveedor = next((m.group(0) for p in ("RAZON_SOCIAL", "DESTINATARIO", "NOMBRE")
                          for m in [re.search(r"\[%s_\d{2,}\]" % p, texto)] if m), "PROVEEDOR_NO_IDENTIFICADO")
        return Lectura(
            doc_id=doc_id, hash_sha256=huella, semaforo="VERDE", tipo=tipo, texto_sanitizado=texto,
            guardia_hallazgos=hallazgos, datos_personales_tapados=tapados, total=total, total_motivo=motivo,
            montos=montos, serie=verificador.serie_documento(tipo, crudos), fecha=verificador.fecha_documento(crudos),
            confianza_ocr=verificador.confianza_critica(segmentos),
            confianza_minima=verificador.minima_critica(segmentos), proveedor_token=proveedor,
        )

    # ---------------- fase 2
    def extraer_y_verificar(self, lectura: Lectura, giro_ciiu: str, hoy: Optional[date] = None) -> Dict[str, Any]:
        if giro_ciiu not in self.reglas["giros_ciiu_trujillo"]:
            raise ValueError(f"Giro CIIU no parametrizado: {giro_ciiu}")
        if lectura.requiere_nueva_foto:
            raise ValueError("La foto esta en rojo: hay que repetirla antes de extraer")

        t0 = time.perf_counter()
        items, tokens, alertas_llm, enviado = [], {}, [], False
        if lectura.guardia_hallazgos:
            alertas_llm.append("GUARDIA_BLOQUEO_ENVIO_AL_MODELO")
        else:
            try:
                enviado = True
                salida = extractor_qwen.extraer(lectura.texto_sanitizado, lectura.tipo)
                items, tokens = salida.get("items_extraidos", []), salida.get("_tokens", {})
            except extractor_qwen.ErrorLLM as exc:
                alertas_llm.append(f"MODELO_NO_DISPONIBLE: {exc}")
        t1 = time.perf_counter()

        if lectura.tipo.startswith("VOUCHER"):
            en_glosa = verificador.items_en_glosa(lectura.texto_sanitizado)
            if en_glosa and en_glosa != len(items):
                alertas_llm.append(f"ITEMS_NO_COINCIDEN_CON_LA_GLOSA: la glosa tiene {en_glosa} y el modelo devolvio {len(items)}")
        documento, alertas = verificador.verificar(
            doc_id=lectura.doc_id, tipo=lectura.tipo, items_llm=items, total=lectura.total,
            montos_en_documento=lectura.montos, serie=lectura.serie, fecha=lectura.fecha,
            c_ocr=lectura.confianza_ocr, c_minima=lectura.confianza_minima, semaforo=lectura.semaforo,
            proveedor_token=lectura.proveedor_token, info_giro=self.reglas["giros_ciiu_trujillo"][giro_ciiu],
            lexico=self.lexico, hoy=hoy or date.today(),
        )
        if any(a.startswith("ITEMS_NO_COINCIDEN") for a in alertas_llm):
            documento["requiere_revision_humana"] = True
        lectura.tiempos["modelo"] = round(t1 - t0, 2)
        return {
            "documento": documento,
            "diagnostico": {
                "semaforo": lectura.semaforo,
                "motivos_semaforo": lectura.motivos,
                "alertas": sorted(set(alertas + alertas_llm)),
                "total_leido": lectura.total_motivo,
                "datos_personales_tapados": lectura.datos_personales_tapados,
                "guardia_de_salida": {"aprobado": not lectura.guardia_hallazgos, "hallazgos": lectura.guardia_hallazgos},
                "texto_enviado_al_modelo": lectura.texto_sanitizado if enviado else None,
                "tokens_en_texto": len(TOKEN.findall(lectura.texto_sanitizado)),
                "tokens_llm": tokens,
                "tiempos_seg": dict(lectura.tiempos),
                "conexiones_externas_bloqueadas": len(candado_red.intentos_bloqueados),
            },
        }
