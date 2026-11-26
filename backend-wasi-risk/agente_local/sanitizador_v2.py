"""Sanitizador PII v2. Extiende el SanitizadorPIISBS del kit (mismo mapa reversible en RAM y purga).

Capas, en orden:
  1. numeros de operacion (no son DNI)        4. lineas de direccion
  2. lo que sigue a una etiqueta (Senor:, Para:, Cliente:, Proveedor:...)
  3. destinatario de un voucher Yape/Plin (la linea que sigue al monto)
  5. razones sociales (S.A.C., E.I.R.L., S.R.L., S.A.) y nombres comerciales cortados
  6. nombres conocidos y del padron, sin importar espacios ni tildes, y por parecido (errores de OCR)
  7. patrones: RUC, celular (con +51 o enmascarado), DNI, correo
"""

import difflib
import re
import unicodedata
from typing import Iterable, List, Tuple

from . import config  # noqa: F401  (agrega engine/ al path)
from .ocr_local import plano
from sanitizador_pii_sbs import SanitizadorPIISBS

TOKEN = re.compile(r"\[[A-Z_]+_\d{2,}\]")

_ETIQUETA = re.compile(
    r"^\s*(se[nñ]or\s*\(\s*(?:es|a)\s*\)|se[nñ]or(?:es|a)?|sr\s*\(\s*a\s*\)|sres?\.|cliente|para|destinatario|"
    r"titular|beneficiario|proveedor|raz[oó]n\s*social|nombre|enviado\s+a|entregado\s+por|recibido\s+por|recib[ií]\s+conforme|"
    r"atendido\s+por|vendedora?|compradora?)\s*(?::\s*(?P<resto>.*)|(?P<fin>\.?\s*$))",
    re.IGNORECASE,
)
_NOMBRE_PROPIO = r"(?:[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+|[A-ZÁÉÍÓÚÑ]{3,})"
# "la sra Elvira Tandaypan", "don Pepe", y "Entregado por Wilmer Otiniano" sin dos puntos
_TRATAMIENTO = re.compile(
    r"(?:\b(?i:sr|sra|srta|se[nñ]or|se[nñ]ora|don|do[nñ]a|entregado por|recibido por|atendido por)\b\.?\s+(?:(?i:la|el)\s+)?)"
    rf"(?P<nombre>{_NOMBRE_PROPIO}(?:\s+{_NOMBRE_PROPIO}){{0,3}})"
)
_DIRECCION = re.compile(
    r"(?:\b(?:av|avda|jr|psje|pje|urb|cdra)\b\.?|\b(?:avenida|jir[oó]n|calle|pasaje|urbanizaci[oó]n|galer[ií]a|puesto|cuadra)\b|"
    r"\bmz\.?\s*[A-Z0-9']{1,3}\b.*\b(?:lt|lote)\b|\bdirecci[oó]n\b|\bdomicilio\b)",
    re.IGNORECASE,
)
_RAZON_SOCIAL = re.compile(
    r"(?<![A-Za-z])(?:S\.\s?A\.\s?C\.?|SAC|E\.\s?I\.\s?R\.\s?L\.?|EIRL|S\.\s?R\.\s?L\.?|SRL|S\.\s?A\.)(?![A-Za-z])"
)
_OPERACION_ETIQUETA = re.compile(r"operaci[oó]n", re.IGNORECASE)
_CODIGO_WALLET = re.compile(r"\b(?:PLN|YAPE)[-\s]?\d{5,}\b", re.IGNORECASE)
_MONTO_PRINCIPAL = re.compile(r"^\s*S/\s*[\d][\d.,]*\s*$")
_FECHA = re.compile(r"\d{1,2}\s*(?:/|-|\s(?:ene|feb|mar|abr|may|jun|jul|ago|set|sep|oct|nov|dic))", re.IGNORECASE)

RUC = re.compile(r"(?<!\d)(?:10|15|16|17|20)\d{9}(?!\d)")
CELULAR = re.compile(r"(?<!\d)(?:\+\s?51[\s.-]?|51[\s.-])?9\d{2}[\s.-]?\d{3}[\s.-]?\d{3}(?!\d)")
CELULAR_PARCIAL = re.compile(r"(?<!\d)9\d{2}\s?[*•·xX.]{3}\s?\d{3}(?!\d)")
# el OCR puede partir un celular enmascarado en dos cajas: "948 ***" y "456"
CELULAR_CORTADO = re.compile(r"(?<![\d.,])9\d{2}\s?[*•·]{2,}(?:\s?\d{1,3})?")
_CELULAR_ETIQUETA = re.compile(r"\b(?:celular|cel\.|tel[eé]fono|tel\b|whatsapp)", re.IGNORECASE)
_SOLO_NUMERO_DE_TELEFONO = re.compile(r"^[\s\d*•·+().-]{2,}$")
DNI = re.compile(r"(?<!\d)(?<!\d[.,])\d{8}(?![.,]?\d)")
CORREO = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")

PARECIDO_MINIMO = 0.85


def _indice_plano(texto: str) -> Tuple[str, List[int]]:
    """Version plana del texto y, por cada caracter plano, su posicion en el original."""
    chars, pos = [], []
    for i, c in enumerate(texto):
        for d in unicodedata.normalize("NFD", c):
            if d.isascii() and d.isalnum():
                chars.append(d.upper())
                pos.append(i)
    return "".join(chars), pos


def nombres_del_padron(padron: dict) -> Tuple[List[str], List[str]]:
    """Devuelve (frases a tapar si aparecen dentro de una linea, nombres completos para comparar por parecido)."""
    frases, completos = set(), set()
    for r in padron["registros_sunat"]:
        crudo = r["razon_social_sintetica"]
        base = crudo.split("(")[0].strip()
        comercial = crudo[crudo.find("(") + 1 : crudo.rfind(")")] if "(" in crudo else ""
        completos.add(plano(base))
        frases.add(plano(base))
        if comercial:
            frases.add(plano(comercial))
        if r["tipo_contribuyente"].startswith("PERSONA"):
            partes = base.split()
            if len(partes) >= 3:
                frases.add(plano(" ".join(partes[:2])))  # dos apellidos
    return sorted((f for f in frases if len(f) >= 10), key=len, reverse=True), sorted(completos)


class SanitizadorPIIv2(SanitizadorPIISBS):
    def __init__(self, padron: dict) -> None:
        super().__init__()
        self._frases, self._completos = nombres_del_padron(padron)
        self.conteo: dict = {}
        self._numero: dict = {}

    def _obtener_o_crear_token(self, prefijo: str, valor_original: str) -> str:
        """Fichas numeradas, no aleatorias: la misma foto produce el mismo texto y asi la misma respuesta del modelo."""
        if valor_original not in self._mapa_pii_a_token:
            self._numero[prefijo] = self._numero.get(prefijo, 0) + 1
            token = f"[{prefijo}_{self._numero[prefijo]:02d}]"
            self._mapa_pii_a_token[valor_original] = token
            self._mapa_token_a_pii[token] = valor_original
        return self._mapa_pii_a_token[valor_original]

    def _tok(self, prefijo: str, valor: str) -> str:
        valor = valor.strip()
        if not valor or TOKEN.fullmatch(valor):
            return valor
        self.conteo[prefijo] = self.conteo.get(prefijo, 0) + 1
        return self._obtener_o_crear_token(prefijo, valor)

    # ---------- capas que necesitan ver las lineas vecinas
    def sanitizar_segmentos(
        self, segmentos: List[str], tipo_documento: str = "", nombres_conocidos: Iterable[str] = ()
    ) -> List[str]:
        s = list(segmentos)
        s = [x for x in s]
        for i in range(len(s)):
            if s[i].lower().startswith("hash:"):
                s[i] = ""

        self._operaciones(s)
        self._celulares_con_etiqueta(s)
        self._etiquetas(s)
        if tipo_documento.startswith("VOUCHER"):
            self._destinatario_voucher(s)

        conocidos = sorted((plano(n) for n in nombres_conocidos if len(plano(n)) >= 6), key=len, reverse=True)
        salida = []
        for linea in s:
            salida.append(self._una_linea(linea, conocidos))
        return salida

    def sanitizar_texto(self, texto: str, nombres_conocidos: Iterable[str] = (), tipo_documento: str = "") -> str:
        """Misma firma base que el kit: recibe texto y devuelve texto. '|' separa columnas."""
        lineas = texto.split("\n")
        partes = [[p.strip() for p in l.split("|")] for l in lineas]
        planos = [p for fila in partes for p in fila]
        limpios = iter(self.sanitizar_segmentos(planos, tipo_documento, nombres_conocidos))
        return "\n".join(" | ".join(next(limpios) for _ in fila) for fila in partes)

    def _operaciones(self, s: List[str]) -> None:
        for i, linea in enumerate(s):
            s[i] = _CODIGO_WALLET.sub(lambda m: self._tok("NUM_OPERACION", m.group(0)), s[i])
            if _OPERACION_ETIQUETA.search(linea):
                nuevo, n = re.subn(r"(?<!\d)\d{6,12}(?!\d)", lambda m: self._tok("NUM_OPERACION", m.group(0)), s[i])
                if n:
                    s[i] = nuevo
                elif i + 1 < len(s) and re.fullmatch(r"\s*\d{6,12}\s*", s[i + 1]):
                    s[i + 1] = self._tok("NUM_OPERACION", s[i + 1])

    def _celulares_con_etiqueta(self, s: List[str]) -> None:
        """Despues de 'Celular' o 'Telefono', todo trozo que sea solo numeros y asteriscos es parte del numero."""
        for i, linea in enumerate(s):
            if not _CELULAR_ETIQUETA.search(linea):
                continue
            for j in range(i + 1, min(i + 4, len(s))):
                if _SOLO_NUMERO_DE_TELEFONO.match(s[j]) and any(c.isdigit() or c in "*•" for c in s[j]):
                    s[j] = self._tok("CELULAR", s[j])
                else:
                    break

    def _etiquetas(self, s: List[str]) -> None:
        for i, linea in enumerate(s):
            m = _ETIQUETA.match(linea)
            if not m:
                continue
            resto = (m.group("resto") or "").strip()
            if len(plano(resto)) >= 3:
                s[i] = linea[: m.start("resto")] + self._tok("NOMBRE", resto)
                continue
            for j in range(i + 1, min(i + 3, len(s))):
                if len(plano(s[j])) >= 3:
                    if not re.match(r"^\s*(fecha|r\.?u\.?c|dni|moneda|condici|tel|monto)", s[j], re.IGNORECASE):
                        s[j] = self._tok("NOMBRE", s[j])
                    break

    def _destinatario_voucher(self, s: List[str]) -> None:
        for i, linea in enumerate(s[:-1]):
            if _MONTO_PRINCIPAL.match(linea) and not re.match(r"^\s*S/\s*0[.,]00", linea):
                siguiente = s[i + 1]
                if siguiente and not _FECHA.match(siguiente.strip()) and not siguiente.strip().startswith("["):
                    s[i + 1] = self._tok("DESTINATARIO", siguiente)
                return

    # ---------- capas linea por linea
    def _una_linea(self, linea: str, conocidos: List[str]) -> str:
        if not linea:
            return linea
        if _RAZON_SOCIAL.search(linea):
            return self._tok("RAZON_SOCIAL", linea)
        if _DIRECCION.search(linea):
            return self._tok("DIRECCION", linea)

        linea = self._por_frase(linea, conocidos, "TITULAR_MYPE")
        linea = self._por_frase(linea, self._frases, "NOMBRE_PADRON")
        if self._se_parece_a_nombre(linea, conocidos):
            return self._tok("NOMBRE_SIMILAR", linea)

        linea = _TRATAMIENTO.sub(
            lambda m: m.group(0)[: m.start("nombre") - m.start(0)] + self._tok("NOMBRE", m.group("nombre")), linea
        )
        linea = CORREO.sub(lambda m: self._tok("CORREO", m.group(0)), linea)
        linea = RUC.sub(lambda m: self._tok("RUC", m.group(0)), linea)
        linea = CELULAR_PARCIAL.sub(lambda m: self._tok("CELULAR", m.group(0)), linea)
        linea = CELULAR.sub(lambda m: self._tok("CELULAR", m.group(0)), linea)
        linea = CELULAR_CORTADO.sub(lambda m: self._tok("CELULAR", m.group(0)), linea)
        if "S/" not in linea:
            linea = DNI.sub(lambda m: self._tok("DNI", m.group(0)), linea)
        return linea

    def _por_frase(self, linea: str, frases: List[str], prefijo: str) -> str:
        for frase in frases:
            texto_plano, pos = _indice_plano(linea)
            k = texto_plano.find(frase)
            if k >= 0:
                ini, fin = pos[k], pos[k + len(frase) - 1] + 1
                linea = linea[:ini] + self._tok(prefijo, linea[ini:fin]) + linea[fin:]
            elif len(texto_plano) >= 22 and frase.startswith(texto_plano):
                return self._tok(prefijo, linea)  # nombre cortado en el borde del papel
        return linea

    def _se_parece_a_nombre(self, linea: str, conocidos: List[str]) -> bool:
        texto_plano = plano(TOKEN.sub("", linea))
        if len(texto_plano) < 12 or sum(c.isdigit() for c in texto_plano) > 2:
            return False
        for nombre in list(conocidos) + self._completos:
            if abs(len(nombre) - len(texto_plano)) <= 0.25 * len(nombre):
                if difflib.SequenceMatcher(None, nombre, texto_plano).ratio() >= PARECIDO_MINIMO:
                    return True
        return False
