"""Guardia de salida: ultima revision antes de que un texto llegue al modelo de lenguaje.

No limpia: solo decide si deja pasar. Si encuentra algo, el texto NO se envia.
Devuelve tipos de hallazgo, nunca el dato.
"""

import difflib
import re
from typing import Iterable, List

from .ocr_local import plano
from .sanitizador_v2 import (_RAZON_SOCIAL, CELULAR, CELULAR_CORTADO, CELULAR_PARCIAL, CORREO, DNI, PARECIDO_MINIMO, RUC,
                             TOKEN, nombres_del_padron)


class GuardiaSalida:
    def __init__(self, padron: dict) -> None:
        self._frases, self._completos = nombres_del_padron(padron)

    def revisar(self, texto: str, nombres_conocidos: Iterable[str] = ()) -> List[str]:
        limpio = TOKEN.sub(" ", texto)
        hallazgos = set()
        for linea in limpio.split("\n"):
            if RUC.search(linea):
                hallazgos.add("RUC")
            if CELULAR.search(linea) or CELULAR_PARCIAL.search(linea) or CELULAR_CORTADO.search(linea):
                hallazgos.add("CELULAR")
            # numero partido en columnas junto a su etiqueta
            if re.search(r"\b(?:celular|tel[eé]fono|tel\b)[^\[]*?\d{3}", linea, re.IGNORECASE):
                hallazgos.add("CELULAR")
            if "S/" not in linea and DNI.search(linea):
                hallazgos.add("NUMERO_DE_8_DIGITOS")
            if CORREO.search(linea) or "+51" in linea:
                hallazgos.add("CORREO_O_PREFIJO_TELEFONICO")
            if _RAZON_SOCIAL.search(linea):
                hallazgos.add("RAZON_SOCIAL")
            for celda in linea.split("|"):
                c = plano(celda)
                if len(c) >= 12 and any(
                    abs(len(n) - len(c)) <= 0.25 * len(n) and difflib.SequenceMatcher(None, n, c).ratio() >= PARECIDO_MINIMO
                    for n in self._completos
                ):
                    hallazgos.add("NOMBRE_PARECIDO_AL_PADRON")
        todo = plano(limpio)
        conocidos = [plano(n) for n in nombres_conocidos if len(plano(n)) >= 6]
        if any(n in todo for n in conocidos):
            hallazgos.add("NOMBRE_CONOCIDO")
        if any(f in todo for f in self._frases):
            hallazgos.add("NOMBRE_DEL_PADRON")
        return sorted(hallazgos)
