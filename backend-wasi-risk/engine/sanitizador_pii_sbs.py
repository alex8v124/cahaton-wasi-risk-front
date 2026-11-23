#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
WASI-RISK AI — Middleware Sanitizador PII Soberano (VPS de Soe Macero)
Cumplimiento: Art. 140° Ley N.° 26702 (Secreto Bancario) & Res. SBS N.° 504-2021.
Reemplaza RUC, DNI, celulares Yape/Plin y correos por tokens efimeros antes de
cualquier llamada de inferencia en modo hibrido. 100% biblioteca estandar Python 3.
"""

import re
import uuid
from typing import Dict, Tuple


class SanitizadorPIISBS:
    """Anonimizador reversible en memoria RAM volatil para el perimetro VPS."""

    REGEX_RUC = re.compile(r"\b(?:10|20)\d{9}\b")
    REGEX_DNI = re.compile(r"\b\d{8}\b")
    REGEX_CELULAR_PE = re.compile(r"\b9\d{2}[-\s]?\d{3}[-\s]?\d{3}\b")
    REGEX_EMAIL = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")

    def __init__(self) -> None:
        self._mapa_token_a_pii: Dict[str, str] = {}
        self._mapa_pii_a_token: Dict[str, str] = {}

    def _obtener_o_crear_token(self, prefijo: str, valor_original: str) -> str:
        if valor_original in self._mapa_pii_a_token:
            return self._mapa_pii_a_token[valor_original]
        token = f"[{prefijo}_{uuid.uuid4().hex[:8].upper()}]"
        self._mapa_pii_a_token[valor_original] = token
        self._mapa_token_a_pii[token] = valor_original
        return token

    def sanitizar_texto(self, texto: str, nombres_conocidos: Tuple[str, ...] = ()) -> str:
        """Elimina PII del texto OCR antes de enviarlo al agente LLM."""
        resultado = texto

        for nombre in nombres_conocidos:
            if nombre and len(nombre.strip()) >= 3:
                token = self._obtener_o_crear_token("TITULAR_MYPE", nombre.strip())
                resultado = re.sub(re.escape(nombre.strip()), token, resultado, flags=re.IGNORECASE)

        resultado = self.REGEX_RUC.sub(
            lambda m: self._obtener_o_crear_token("TOKEN_RUC", m.group(0)), resultado
        )
        resultado = self.REGEX_CELULAR_PE.sub(
            lambda m: self._obtener_o_crear_token("HASH_WALLET", m.group(0)), resultado
        )
        resultado = self.REGEX_DNI.sub(
            lambda m: self._obtener_o_crear_token("TOKEN_DNI", m.group(0)), resultado
        )
        resultado = self.REGEX_EMAIL.sub(
            lambda m: self._obtener_o_crear_token("TOKEN_EMAIL", m.group(0)), resultado
        )
        return resultado

    def rehidratar_texto(self, texto_sanitizado: str) -> str:
        """Restaura identidad solo dentro de la red privada interna de Caja Trujillo."""
        resultado = texto_sanitizado
        for token, valor_original in self._mapa_token_a_pii.items():
            resultado = resultado.replace(token, valor_original)
        return resultado

    def purgar_memoria(self) -> None:
        """Limpia el mapa efimero tras completar la evaluacion (cero persistencia PII)."""
        self._mapa_token_a_pii.clear()
        self._mapa_pii_a_token.clear()


if __name__ == "__main__":
    san = SanitizadorPIISBS()
    muestra = (
        "Cliente: QUISPE VARGAS JORGE LUIS | RUC 10423189012 | DNI 42318901 | "
        "Yape destino 948-123-456 | Correo: jorge.calzado@gmail.com | Compra S/ 2,450.00"
    )
    protegido = san.sanitizar_texto(muestra, nombres_conocidos=("QUISPE VARGAS JORGE LUIS",))
    restaurado = san.rehidratar_texto(protegido)
    assert "10423189012" not in protegido
    assert "42318901" not in protegido
    assert "948-123-456" not in protegido
    assert restaurado == muestra
    san.purgar_memoria()
    print("[OK] SanitizadorPIISBS verificado (Art. 140 Ley N.° 26702):")
    print("  Original :", muestra)
    print("  Sanitizado:", protegido)
