"""Evidencia en modo avion: procesa una nota con la red desconectada y deja constancia.

    python -m agente_local.demo_modo_avion             exige estar sin conexion
    python -m agente_local.demo_modo_avion --grabar    ademas graba la pantalla y arma un video de 10 s
    python -m agente_local.demo_modo_avion --ensayo    permite tener red; todo queda marcado como ENSAYO
Otras opciones: --imagen RUTA  --ciiu 1810  --sin-abrir

Esta demo no puede fingir: si hay una tarjeta de red activa o responde internet, no genera evidencia.
"""

import argparse
import base64
import hashlib
import html
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

from . import candado_red, config

SALIDA = config.RAIZ / "evidencia"
NOTA_POR_DEFECTO = config.DATA / "imagenes_golden_samples" / "DOC-MAN-004_nota_mostrador_gamarrita_valida.png"
DESTINOS_DE_PRUEBA = [("1.1.1.1", 443), ("8.8.8.8", 443), ("www.google.com", 443)]
SEGUNDOS_VIDEO = 10.0


def tarjetas_de_red_activas() -> list:
    """Tarjetas fisicas conectadas (Wi-Fi o cable). El modo avion de Windows NO apaga el cable."""
    orden = "Get-NetAdapter -Physical | Where-Object Status -eq 'Up' | ForEach-Object { $_.Name + ' (' + $_.InterfaceDescription + ')' }"
    try:
        r = subprocess.run(["powershell", "-NoProfile", "-Command", orden], capture_output=True, text=True, timeout=30)
        if r.returncode != 0:
            return ["NO SE PUDO COMPROBAR"]
        return [l.strip() for l in r.stdout.splitlines() if l.strip()]
    except Exception:
        return ["NO SE PUDO COMPROBAR"]


def probar_internet() -> list:
    """Intenta salir a internet. Se llama ANTES de activar el candado y usa la funcion original de conexion."""
    resultados = []
    for host, puerto in DESTINOS_DE_PRUEBA:
        try:
            with _conectar_original((host, puerto), timeout=2.5):
                resultados.append((f"{host}:{puerto}", True, "respondio"))
        except Exception as exc:
            resultados.append((f"{host}:{puerto}", False, type(exc).__name__))
    return resultados


def _conectar_original(direccion, timeout):
    familia, tipo, proto, _, destino = _resolver_original(direccion[0], direccion[1], type=socket.SOCK_STREAM)[0]
    s = socket.socket(familia, tipo, proto)
    s.settimeout(timeout)
    try:
        _metodo_connect(s, destino)
    except Exception:
        s.close()
        raise
    return s


_resolver_original, _metodo_connect = socket.getaddrinfo, socket.socket.connect


def estado_red() -> dict:
    tarjetas, pruebas = tarjetas_de_red_activas(), probar_internet()
    return {
        "momento": datetime.now().astimezone().isoformat(timespec="seconds"),
        "tarjetas_activas": tarjetas,
        "pruebas_de_salida": [{"destino": d, "respondio": ok, "detalle": det} for d, ok, det in pruebas],
        "sin_conexion": not tarjetas and not any(ok for _, ok, _ in pruebas),
    }


# ---------------------------------------------------------------- presentacion
def _c(texto, color):
    codigos = {"v": "92", "r": "91", "a": "93", "m": "95", "n": "1"}
    return f"\033[{codigos[color]}m{texto}\033[0m"


def mostrar_red(red: dict) -> None:
    print(f"  Tarjetas de red conectadas: {', '.join(red['tarjetas_activas']) or 'NINGUNA'}")
    for p in red["pruebas_de_salida"]:
        print(f"  Salida a {p['destino']:<22} {'RESPONDIO' if p['respondio'] else 'sin respuesta (' + p['detalle'] + ')'}")
    print("  " + (_c("RED: SIN CONEXION", "v") if red["sin_conexion"] else _c("RED: CONECTADA  >>> ENSAYO, NO ES EVIDENCIA <<<", "r")))


def informe_html(ruta: Path, d: dict, imagen: Path) -> None:
    doc, dg = d["resultado"]["documento"], d["resultado"]["diagnostico"]
    offline = d["red_antes"]["sin_conexion"] and d["red_despues"]["sin_conexion"]
    sello = "PROCESADO SIN CONEXIÓN A INTERNET" if offline else "ENSAYO CON RED: NO ES EVIDENCIA"
    color = "#0F7B45" if offline else "#B3261E"
    visto = html.escape(dg["texto_enviado_al_modelo"] or "(no se envió nada al modelo)")
    visto = re.sub(r"(\[[A-Z_]+_\d{2,}\])", r"<mark>\1</mark>", visto)
    def _monto(v):
        return "" if v is None else format(v, ",.2f")

    filas = "".join(
        f"<tr><td>{i['cantidad']:g} {html.escape(i['unidad_original'])}</td><td>{html.escape(i['descripcion'])}</td>"
        f"<td>{i['unidad_normalizada']}</td><td class='n'>{_monto(i['subtotal_pen'])}</td></tr>"
        for i in doc["items_extraidos"]
    )
    red = lambda r: (", ".join(r["tarjetas_activas"]) or "ninguna tarjeta conectada") + " · " + (
        "ninguna salida respondió" if not any(p["respondio"] for p in r["pruebas_de_salida"]) else "internet respondió")
    img = "data:image/png;base64," + base64.b64encode(imagen.read_bytes()).decode()
    tapados = ", ".join(f"{v} {k.lower().replace('_', ' ')}" for k, v in dg["datos_personales_tapados"].items()) or "ninguno"
    ruta.write_text(f"""<!doctype html><html lang="es"><meta charset="utf-8"><title>Evidencia agente local</title>
<style>body{{font:15px/1.45 Segoe UI,Arial,sans-serif;margin:0;color:#111;background:#fff}}
header{{background:{color};color:#fff;padding:12px 22px;font-size:22px;font-weight:700}}
header small{{display:block;font-size:13px;font-weight:400}}
.g{{display:grid;grid-template-columns:340px 1fr 1fr;gap:18px;padding:16px 22px}}
h2{{font-size:14px;margin:0 0 6px;text-transform:uppercase;letter-spacing:.04em}}
img{{width:100%;border:1px solid #bbb}}
pre{{white-space:pre-wrap;background:#f5f5f5;border:1px solid #ddd;padding:10px;font:12.5px/1.5 Consolas,monospace;margin:0}}
mark{{background:#111;color:#fff;padding:0 3px;border-radius:2px;font-size:11px}}
table{{border-collapse:collapse;width:100%;font-size:13px}}td,th{{border:1px solid #ccc;padding:4px 6px;text-align:left}}td.n{{text-align:right}}
.k{{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}}.k div{{border:1px solid #bbb;padding:6px 10px;border-radius:4px;font-size:13px}}
.k b{{display:block;font-size:18px}} footer{{padding:0 22px 16px;font-size:12px;color:#444}}</style>
<header>{sello}<small>{d['red_antes']['momento']} → {d['red_despues']['momento']} · Agente local WASI-RISK · OCR {config.OCR_RECONOCEDOR} + {config.MODELO_LLM} en esta máquina</small></header>
<div class="g"><div><h2>Documento (sintético)</h2><img src="{img}" alt="documento"></div>
<div><h2>Lo que vio el modelo</h2><pre>{visto}</pre></div>
<div><h2>Resultado verificado en Python</h2><table><tr><th>Cant.</th><th>Descripción</th><th>Unidad</th><th>S/</th></tr>{filas}</table>
<div class="k"><div>Compras computables<b>S/ {doc['monto_computable_valido_pen']:,.2f}</b></div><div>Confianza<b>{doc['confianza_extraccion_ia']:.2f}</b></div>
<div>Revisión humana<b>{'Sí' if doc['requiere_revision_humana'] else 'No'}</b></div><div>Tiempo real<b>{d['segundos']:.1f} s</b></div>
<div>Guardia de salida<b>{'aprobó' if dg['guardia_de_salida']['aprobado'] else 'bloqueó'}</b></div>
<div>Conexiones externas intentadas<b>{dg['conexiones_externas_bloqueadas']}</b></div></div>
<p>Tapados antes de llegar al modelo: {html.escape(tapados)}.<br>Banderas: {', '.join(doc['banderas_detectadas']) or 'ninguna'}.</p></div></div>
<footer>Red al empezar: {html.escape(red(d['red_antes']))}. Red al terminar: {html.escape(red(d['red_despues']))}.<br>
SHA-256 de la imagen: {d['sha256_imagen']}. Datos 100 % sintéticos.</footer></html>""", encoding="utf-8")


# ---------------------------------------------------------------- grabacion
def iniciar_grabacion(destino: Path):
    return subprocess.Popen(
        [shutil.which("ffmpeg"), "-y", "-loglevel", "error", "-f", "gdigrab", "-framerate", "15", "-i", "desktop",
         "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", str(destino)],
        stdin=subprocess.PIPE,
    )


def video_corto(origen: Path, destino: Path, duracion_real: float, es_evidencia: bool) -> float:
    """Comprime la grabacion a ~10 s. La velocidad y la duracion real quedan escritas en el video."""
    factor = max(1.0, duracion_real / SEGUNDOS_VIDEO)
    letrero = (f"Acelerado x{factor:.1f} - duracion real {duracion_real:.0f} s" if factor > 1.05
               else f"Tiempo real - {duracion_real:.0f} s")
    if not es_evidencia:
        letrero = "ENSAYO CON RED - " + letrero
    (destino.parent / "letrero.txt").write_text(letrero, encoding="utf-8")
    filtro = (f"setpts=PTS/{factor:.4f},scale=1920:-2,drawtext=fontfile='C\\:/Windows/Fonts/segoeuib.ttf':textfile=letrero.txt:"
              "fontsize=34:fontcolor=white:box=1:boxcolor=black@0.75:boxborderw=12:x=w-tw-30:y=30")
    subprocess.run([shutil.which("ffmpeg"), "-y", "-loglevel", "error", "-i", origen.name, "-vf", filtro, "-r", "30", "-an",
                    "-c:v", "libx264", "-crf", "23", "-pix_fmt", "yuv420p", destino.name], cwd=destino.parent, check=True)
    (destino.parent / "letrero.txt").unlink(missing_ok=True)
    return factor


# ---------------------------------------------------------------- principal
def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    os.system("")  # habilita colores ANSI en la consola de Windows
    ap = argparse.ArgumentParser()
    ap.add_argument("--imagen", type=Path, default=NOTA_POR_DEFECTO)
    ap.add_argument("--ciiu", default="1810")
    ap.add_argument("--ensayo", action="store_true")
    ap.add_argument("--grabar", action="store_true")
    ap.add_argument("--sin-abrir", action="store_true")
    ap.add_argument("--sin-pausa", action="store_true")
    a = ap.parse_args()

    print(_c("\nAGENTE LOCAL WASI-RISK · comprobando la red...", "n"))
    red = estado_red()
    mostrar_red(red)
    if not red["sin_conexion"] and not a.ensayo:
        print(_c("\nNo se genera evidencia con red. Antes de grabar:", "a"))
        print("  1) Desconecta el CABLE Ethernet (el modo avion no lo apaga).")
        print("  2) Activa el modo avion (Wi-Fi y Bluetooth apagados).")
        print("  3) Vuelve a ejecutar. Para practicar con red: --ensayo\n")
        return 2
    if a.grabar and not shutil.which("ffmpeg"):
        print("No se encontro ffmpeg; graba la pantalla con Win + Shift + R y quita --grabar.")
        return 2

    print("\nPreparando OCR y modelo local (esto todavia no se graba)...")
    from .pipeline import AgenteLocal

    agente = AgenteLocal()  # activa el candado de red
    agente.calentar()
    SALIDA.mkdir(exist_ok=True)
    marca = datetime.now().strftime("%Y%m%d_%H%M%S") + ("" if red["sin_conexion"] else "_ENSAYO")

    if a.grabar:
        print(_c("\nSe va a grabar TODA la pantalla. Cierra WhatsApp, correo y cualquier cosa personal.", "a"))
    if not a.sin_pausa:
        input(_c("Pulsa ENTER para empezar. ", "n"))
    os.system("cls" if os.name == "nt" else "clear")

    grabacion, inicio_video, crudo = None, 0.0, SALIDA / f"grabacion_completa_{marca}.mp4"
    datos = None
    if a.grabar:
        grabacion, inicio_video = iniciar_grabacion(crudo), time.perf_counter()
        time.sleep(1.5)
    try:
        print(_c("AGENTE LOCAL WASI-RISK · todo ocurre dentro de esta maquina\n", "m"))
        antes = estado_red()  # comprobacion nueva, justo antes de procesar
        mostrar_red(antes)
        if not antes["sin_conexion"] and not a.ensayo:
            print(_c("\nLa red volvio a conectarse. Se cancela: no hay evidencia.", "r"))
            return 2
        contenido = a.imagen.read_bytes()
        t0 = time.perf_counter()
        print(f"\n[1] Foto: {a.imagen.name}")
        lectura = agente.leer_documento(contenido, "DOC-1")
        if lectura.requiere_nueva_foto:
            print(_c(f"    SEMAFORO ROJO {lectura.motivos}: repetir la foto.", "r"))
            return 1
        print(f"    OCR local: {lectura.tipo} · semaforo {lectura.semaforo} · {lectura.tiempos['ocr']} s")
        tapados = ", ".join(f"{v} {k}" for k, v in lectura.datos_personales_tapados.items()) or "ninguno"
        print(f"\n[2] Sanitizador: {tapados}")
        for linea in [l for l in lectura.texto_sanitizado.split("\n") if "[" in l][:4]:
            print("    " + linea[:100])
        print("    Guardia de salida: " + (_c("APROBADO", "v") if not lectura.guardia_hallazgos else _c(f"BLOQUEADO {lectura.guardia_hallazgos}", "r")))
        print(f"\n[3] {config.MODELO_LLM} en esta maquina, leyendo los items...")
        resultado = agente.extraer_y_verificar(lectura, a.ciiu)
        doc = resultado["documento"]
        for i in doc["items_extraidos"]:
            monto = "" if i["subtotal_pen"] is None else f"S/ {i['subtotal_pen']:,.2f}"
            print(f"    {i['cantidad']:g} {i['unidad_normalizada']:<13} {i['descripcion'][:38]:<38} {monto:>12}")
        segundos = time.perf_counter() - t0
        print(f"\n[4] Verificador en Python: compras computables " + _c(f"S/ {doc['monto_computable_valido_pen']:,.2f}", "n")
              + f" · confianza {doc['confianza_extraccion_ia']:.2f} · revision humana {'SI' if doc['requiere_revision_humana'] else 'no'}")
        if doc["banderas_detectadas"]:
            print("    Banderas: " + ", ".join(doc["banderas_detectadas"]))
        despues = estado_red()  # y otra al terminar
        sin_red = antes["sin_conexion"] and despues["sin_conexion"]
        print("\n" + "=" * 78)
        print(f"  Tiempo real: {segundos:.1f} s · Conexiones externas intentadas por el agente: {len(candado_red.intentos_bloqueados)}")
        print(f"  Red al terminar: {'sin conexion' if despues['sin_conexion'] else 'CONECTADA'}")
        print("  " + (_c("PROCESADO SIN CONEXION A INTERNET", "v") if sin_red else _c("ENSAYO CON RED · NO ES EVIDENCIA", "r")))
        print("=" * 78)

        datos = {"red_antes": antes, "red_despues": despues, "segundos": segundos, "resultado": resultado,
                 "sha256_imagen": hashlib.sha256(contenido).hexdigest()}
        (SALIDA / f"evidencia_{marca}.json").write_text(json.dumps(datos, ensure_ascii=False, indent=2), encoding="utf-8")
        pagina = SALIDA / f"evidencia_{marca}.html"
        informe_html(pagina, datos, a.imagen)
        print(f"\nEvidencia guardada en: {pagina}")
        time.sleep(3 if a.grabar else 0)
        if not a.sin_abrir:
            os.startfile(pagina)
            time.sleep(6 if a.grabar else 0)
    finally:
        if grabacion:
            duracion = time.perf_counter() - inicio_video
            grabacion.communicate(input=b"q", timeout=60)
            corto = SALIDA / f"video_10s_{marca}.mp4"
            fue_sin_red = bool(datos and datos["red_antes"]["sin_conexion"] and datos["red_despues"]["sin_conexion"])
            factor = video_corto(crudo, corto, duracion, fue_sin_red)
            print(f"Video corto (x{factor:.1f}): {corto}\nGrabacion completa: {crudo}\nRevisalos antes de enviarlos.")
    return 0



if __name__ == "__main__":
    sys.exit(main())
