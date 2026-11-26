"""Bateria de pruebas del sanitizador v2 y la guardia de salida. No necesita OCR ni modelo.

    python -m agente_local.pruebas_pii

Todos los datos son inventados.
"""

import re
import sys

from . import config
from .guardia_salida import GuardiaSalida
from .ocr_local import plano
from .sanitizador_v2 import TOKEN, SanitizadorPIIv2

# (descripcion, texto, tipo, nombres conocidos, [datos que deben desaparecer], [texto que debe quedar])
CASOS = [
    ("celular con +51", "Yape a +51948123456 por S/ 870.00", "", (), ["948123456"], ["S/ 870.00"]),
    ("celular con 51 y espacios", "Plin 51 948 123 456", "", (), ["948 123 456"], []),
    ("celular con guiones", "Cel: 948-123-456", "", (), ["948-123-456"], []),
    ("celular enmascarado", "Celular destino | 948 *** 456", "", (), ["948 ***", "456"], []),
    ("celular partido en dos cajas", "Celular destino | 948 *** | 456", "", (), ["948", "456"], []),
    ("nombre tras Para:", "Para: Juan Carlos Perez Rojas", "", (), ["Juan Carlos", "Perez Rojas"], []),
    ("nombre tras Destinatario:", "Destinatario: Rosa Quispe M. | Monto S/ 50.00", "", (), ["Rosa Quispe"], ["S/ 50.00"]),
    ("etiqueta sola y nombre abajo", "Señor(a):\nMaria Fernanda Rios Pa", "", (), ["Fernanda", "Rios"], []),
    ("Cliente con espacios y dos puntos", "Cliente       : HUAMAN CRUZ JOSE ANTONIO", "", (), ["HUAMAN CRUZ"], []),
    ("direccion con manzana y lote", "Direccion: Mz. B Lt. 12 Urb. Rio Seco, El Porvenir", "", (), ["Mz. B", "Rio Seco"], []),
    ("direccion en avenida", "Av. Nicolas de Pierola 890 - La Esperanza", "", (), ["Pierola"], []),
    ("jiron", "Jr. Ayacucho 512 Int. 3", "", (), ["Ayacucho"], []),
    ("RUC pegado a la palabra", "RUC10423189012", "", (), ["10423189012"], []),
    ("RUC 20 de proveedor", "R.U.C. 20604512891", "", (), ["20604512891"], []),
    ("DNI con dos puntos", "DNI:42318901", "", (), ["42318901"], []),
    ("correo", "contacto: jorge.calzado@gmail.com", "", (), ["jorge.calzado"], []),
    ("razon social", "COMERCIAL LOS ANDES E.I.R.L.", "", (), ["LOS ANDES"], []),
    ("nombre conocido sin espacios", "Senor(es) PEDROCASTILLOREYES", "", ("CASTILLO REYES PEDRO",), ["CASTILLOREYES"], []),
    ("nombre conocido pegado", "PAREDESGOMEZROSAURA", "", ("PAREDES GOMEZ ROSAURA",), ["PAREDES"], []),
    ("padron mal leido por el OCR", "LOZANO RUTZ_CARMEN JULIA", "", (), ["LOZANO", "CARMEN"], []),
    ("nombre con tildes", "QUISPÉ VARGÁS JORGE LUÍS", "", (), ["VARG"], []),
    ("destinatario de Yape sin etiqueta", "Yapeaste!\nS/ 120.00\nElvira Tandaypan Ruiz\n12 nov. 2026", "VOUCHER_YAPE", (),
     ["Elvira", "Tandaypan"], ["S/ 120.00"]),
    ("destinatario de Plin sin etiqueta", "Transferencia Exitosa!\nS/ 1,240.00\nWILMER OTINIANO SAAVEDRA\n13/11/2026", "VOUCHER_PLIN", (),
     ["OTINIANO"], ["S/ 1,240.00"]),
    ("numero de operacion", "N° de operación | 09482716", "", (), ["09482716"], []),
    ("tratamiento dentro de la glosa", "Mensaje del pago:\npara la sra Elvira Tandaypan", "VOUCHER_YAPE", (), ["Elvira", "Tandaypan"], []),
    ("entregado por", "Entregado por Wilmer Otiniano", "", (), ["Otiniano"], []),
    ("recibi conforme", "Recibi conforme: Julio Chavarry", "", (), ["Chavarry"], []),
    ("apodo con don", "Casa de don Pepe, al costado del grifo", "", (), ["Pepe"], []),
    ("insumos intactos", "180 pies | Cuero Box Calf Negro 1ra | 10.50 | 1,890.00", "", (), [],
     ["180 pies", "Cuero Box Calf Negro 1ra", "10.50", "1,890.00"]),
    ("litros no son direccion", "5 lt | Aceite motor 20W50 | 32.00 | 160.00", "", (), [], ["Aceite motor", "160.00"]),
    ("glosa de pago intacta", "pago 4 tr aparado + 3 gal pegamento amarillo", "", (), [],
     ["4 tr aparado", "3 gal pegamento amarillo"]),
]


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    padron = config.cargar_json(config.DATA / "padron_sunat_trujillo_muestra.json")
    guardia = GuardiaSalida(padron)
    fallas = 0
    for nombre, texto, tipo, conocidos, fuera, dentro in CASOS:
        s = SanitizadorPIIv2(padron)
        limpio = s.sanitizar_texto(texto, conocidos, tipo)
        restaurado_ok = all(d in s.rehidratar_texto(limpio) for d in dentro)
        s.purgar_memoria()
        visible = TOKEN.sub(" ", limpio)
        fugas = [f for f in fuera if (plano(f) in plano(visible) if not f.isdigit() else re.search(re.escape(f), visible))]
        perdidos = [d for d in dentro if d not in limpio]
        bloqueo = guardia.revisar(limpio, conocidos)
        ok = not fugas and not perdidos and not bloqueo and restaurado_ok
        fallas += not ok
        print(f"{'OK ' if ok else 'MAL'} {nombre}" + ("" if ok else f"  fugas={fugas} perdidos={perdidos} guardia={bloqueo} -> {limpio!r}"))

    # la guardia tiene que bloquear por si sola si el sanitizador no corriera
    sucios = ["RUC 10423189012", "Llamar al 948 123 456", "Para QUISPE VARGAS JORGE LUIS", "x@y.com",
              "Celular destino | 948 *** | 456", "MOLINO Y ABARROTES LA HERMELINDA E.I.R.L."]
    detenidos = sum(1 for t in sucios if guardia.revisar(t))
    print(f"\nGuardia sin sanitizador: bloqueo {detenidos}/{len(sucios)} textos sucios")
    print(f"Sanitizador: {len(CASOS) - fallas}/{len(CASOS)} casos correctos")
    return 0 if fallas == 0 and detenidos == len(sucios) else 1


if __name__ == "__main__":
    sys.exit(main())
