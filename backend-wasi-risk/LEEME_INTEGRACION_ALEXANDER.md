# Agente local de protección de datos · guía de integración (v0.1.0)

**Para:** Alexander (PWA y Consola de Riesgos) · **De:** Soe

El agente lee las fotos de comprobantes **dentro de la máquina donde corre**: OCR, tapado de datos personales,
extracción con un modelo local y verificación en Python. El modelo solo recibe texto sin datos personales.
No usa DeepSeek ni ninguna API en la nube.

```text
foto ─► puerta de calidad ─► OCR (PaddleOCR latino) ─► sanitizador v2 ─► guardia de salida
                                                                             │  (fase 1: unos segundos)
                                                                             ▼
        contrato final ◄─ motor de Alejandro ◄─ verificador Python ◄─ qwen2.5:7b en Ollama   (fase 2: lenta)
```

## 1. Levantarlo (Windows)

Requisitos: Python 3.11, [Ollama](https://ollama.com) y unos 6 GB libres para los modelos.

```powershell
ollama pull qwen2.5:7b
py -3.11 -m venv $env:USERPROFILE/wasi-venv
& $env:USERPROFILE/wasi-venv/Scripts/python.exe -m pip install -r requirements_local.txt

# Solo la primera vez, con internet: descarga los modelos de OCR
$env:WASI_PERMITIR_DESCARGA = "1"
& $env:USERPROFILE/wasi-venv/Scripts/python.exe -c "from agente_local.ocr_local import OCRLocal; OCRLocal()"
Remove-Item Env:WASI_PERMITIR_DESCARGA
```

Después: doble clic en `INICIAR_API.bat`, o `python -m agente_local.api`.
La API queda en `http://127.0.0.1:8000` y la documentación interactiva en `/docs`
(ojo: la página `/docs` carga sus estilos desde internet; la API no los necesita).

## 2. Enchufarlo: son dos llamadas

### Paso 1 · Una foto por llamada: `POST /v1/documentos/ocr` (multipart)

| Campo | Obligatorio | Detalle |
| --- | --- | --- |
| `expediente_id` | sí | `EXP-TRUJ-2026-0101` |
| `doc_id` | sí | mínimo 3 caracteres |
| `hash_sha256_original` | sí | SHA-256 en hexadecimal minúscula de los **mismos bytes** que se envían |
| `archivo` | sí | JPEG o PNG, máximo 4 MB, lado mayor recomendado 1600 px (menos de 800 px sale en rojo) |
| `nombre_titular` | no | nombre del solicitante; ayuda a taparlo. No se devuelve ni se guarda |

Respuesta: `semaforo` (`VERDE`, `AMARILLO`, `ROJO`), `requiere_nueva_foto`, `motivos`, `tipo_documento_detectado`,
`texto_ocr_sanitizado`, `confianza_ocr`, `guardia_de_salida`, `datos_personales_tapados`, `segundos`.
Ejemplos reales en `ejemplos/respuestas/`.

- Si `requiere_nueva_foto` es `true`, **pidan repetir la foto en el momento** y no la incluyan en el paso 2.
- Si `guardia_de_salida.aprobado` es `false`, el texto llega vacío: ese documento va a revisión humana.

```js
async function subirFoto(blob, expedienteId, docId) {
  const bytes = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");

  const form = new FormData();
  form.append("expediente_id", expedienteId);
  form.append("doc_id", docId);
  form.append("hash_sha256_original", hash);
  form.append("archivo", blob, docId + ".jpg");

  const r = await fetch(`${AGENTE}/v1/documentos/ocr`, { method: "POST", headers: { "X-API-Key": CLAVE }, body: form });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}
```

### Paso 2 · El expediente: `POST /v1/expedientes/auditar` (JSON)

El cuerpo es **exactamente** `schemas/schema_input_alexander_a_soe.json` (no lo cambié). En cada elemento de
`documentos_adjuntos` van `doc_id`, `tipo_documento` (= `tipo_documento_detectado`), `hash_sha256` y
`texto_ocr_sanitizado`, tal como los devolvió el paso 1.

El agente busca la lectura por el hash y **usa su propio texto**, no el que llega de la PWA: así nadie puede
editar un importe en el camino. Las lecturas viven solo en memoria durante 1 hora. Si el hash no existe,
audita el texto recibido, lo vuelve a sanitizar y lo marca como `FOTO_NO_VERIFICADA` (queda en amarillo).

Respuesta:

| Clave | Qué es |
| --- | --- |
| `salida_intermedia` | cumple `schema_output_soe_a_alejandro.json` |
| `contrato_final` | cumple `schema_contrato_final_4_bloques.json`, o `null` |
| `contrato_final_pendiente_por` | motivo cuando `contrato_final` es `null` |
| `banderas_para_consola` | banderas de fraude (el contrato final no las admite dentro) |
| `validacion_schemas` | errores de validación; lista vacía = cumple |
| `diagnostico_documentos` | por documento: semáforo, avisos, texto enviado al modelo, tiempos |

## 3. Cosas que tenemos que acordar

1. **El contrato final pide el RUC real** y `schema_input` solo trae `token_ruc_solicitante`. Por ahora se
   envía en la cabecera `X-RUC-Solicitante`, dentro de la red interna. ¿Te sirve o prefieres otra vía?
2. **La fase 2 es lenta** en una laptop (ver tiempos abajo) y atiende **una petición a la vez**.
   La pantalla debe mostrar "procesando" y el `fetch` no puede cortar antes de 5 minutos.
3. **Estados nuevos para la consola:** semáforo, `requiere_nueva_foto` y `FOTO_NO_VERIFICADA`.
4. El bloqueo por foto mala sigue saliendo del motor como `PERDIDA` 100 %. No toqué el motor; es el tema
   pendiente con Alejandro.

## 4. Configuración

| Variable | Por defecto | Uso |
| --- | --- | --- |
| `WASI_HOST` | `127.0.0.1` | `0.0.0.0` para atender a otro equipo (exige `WASI_API_KEY`) |
| `WASI_PORT` | `8000` | |
| `WASI_API_KEY` | vacío | sin clave, solo atiende a la misma máquina |
| `WASI_CORS_ORIGINS` | `http://localhost:3000,http://localhost:5173` | pon aquí el origen de la PWA |
| `WASI_LLM` | `qwen2.5:7b` | cualquier modelo de Ollama |

**Si la PWA corre en otro equipo:** además de `WASI_HOST` y la clave, hay que abrir el puerto en el firewall.
Y ojo: una PWA servida por **HTTPS** normalmente no puede llamar a una API **HTTP** de la red local (el navegador
lo bloquea por contenido mixto). Para la demo lo más simple es PWA y agente en la misma laptop. Eso no lo probé con
tu PWA.

Códigos de error: `401` clave inválida · `403` otra máquina sin clave · `413` foto de más de 4 MB ·
`415` no es JPEG ni PNG · `422` hash distinto, imagen ilegible o entrada que no cumple el schema.

## 5. Comprobar que funciona

```powershell
python -m agente_local.pruebas_pii     # sanitizador y guardia, sin modelo (segundos)
python -m agente_local.evaluar         # las 7 imágenes del kit de punta a punta (varios minutos)
python ejemplos/cliente_ejemplo.py     # con la API levantada: el flujo completo de las dos llamadas
```

## 6. Resultados medidos y límites

Medido en una laptop AMD Ryzen AI 9 HX 370 con 27,6 GB de RAM (Qwen en la gráfica integrada):

| Documento | Semáforo | Fase 1 (s) | Fase 2 (s) | Computable S/ | Datos tapados | Banderas |
| --- | --- | --- | --- | --- | --- | --- |
| Factura curtiembre | VERDE | 11.2 | 31.1 | 3,840.00 | 5 | ninguna |
| Boleta Hermelinda | VERDE | 9.8 | 38.7 | 4,815.00 | 5 | ninguna |
| Factura ferretera (trampa de giro) | VERDE | 10.5 | 26.1 | 0.00 | 5 | FLAG_INCOHERENCIA_GIRO_CIIU |
| Nota Gamarrita | VERDE | 9.7 | 29.8 | 1,530.00 | 3 | ninguna |
| Nota borrosa (trampa) | AMARILLO | 6.5 | 1.6 | 0.00 | 1 | FLAG_BAJA_CONFIANZA_OCR_POKA_YOKE, FLAG_MONTO_REDONDO_SIN_DESGLOSE |
| Yape S/ 870 | VERDE | 4.8 | 13.0 | 870.00 | 4 | ninguna |
| Plin S/ 1,240 | VERDE | 5.3 | 18.4 | 1,240.00 | 3 | ninguna |

- **7 de 7** documentos coinciden con la respuesta esperada del kit (tipo, total, computable, coherencia, banderas, ítems, importes y unidades), en **dos corridas seguidas con resultado idéntico**.
- **0 datos personales** llegaron al modelo en las 7 imágenes. Sanitizador: 31 de 31 casos de prueba; la guardia de salida, sola, bloquea 6 de 6 textos sucios.
- **0 conexiones externas** intentadas por el agente. Probado aparte: una llamada a `api.deepseek.com` queda bloqueada y registrada.
- Con la API: los dos contratos validan sin errores; un hash falso se rechaza (422); si la PWA altera un importe (870 → 8.700), el agente usa lo que leyó él y avisa `TEXTO_DEL_CLIENTE_DISTINTO`.
- La nota borrosa sale en amarillo y, como no tiene ítems que sumar, termina en Poka‑Yoke (confianza 0,80).

Límites, para que nadie se sorprenda:

- Todo se probó con las **imágenes sintéticas** del kit. Falta probar con fotos reales de celular y letra a mano.
- El sanitizador **no tiene reconocimiento de entidades**. Tapa por etiqueta, posición en el voucher, padrón,
  parecido y patrones. Un nombre suelto en texto libre, sin etiqueta ni tratamiento y fuera del padrón, puede pasar.
- Las pruebas de datos personales las escribimos junto con las reglas: sirven para no retroceder, no demuestran
  que no exista otra forma de fuga.
- El candado de red cubre las conexiones hechas desde Python; no vigila a otros programas del equipo.
- La puerta de calidad se calibró con degradaciones simuladas.
- Datos del kit 100 % sintéticos.
