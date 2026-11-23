# Backend FastAPI Listo para Conectar con Frontend (Alexander Miranda — RIE-02 v2.0)

Este paquete contiene el backend completo con los **8 endpoints exactos de tu Documento Técnico v2.0 (`RIE-02 — Descubrir redes de riesgo ocultas`)**, CORS habilitado (`*`), los 6 Casos Simulados (`CS-01` a `CS-06`), 30 RUCs SUNAT de Trujillo, 50 expedientes sintéticos y subredes de 2 saltos con `cytoscape_elements` listas para `Cytoscape.js`.

---

## Arranque Rápido en 15 Segundos (Localhost:8000)

En Windows puedes hacer doble clic en **`INICIAR_BACKEND.bat`** o correr en terminal desde esta carpeta:

```bash
pip install fastapi uvicorn
python -m uvicorn engine.vps_api_soe:app --host 0.0.0.0 --port 8000 --reload
```

- **Swagger UI interactivo:** `http://localhost:8000/docs`
- **Auto-prueba en consola (sin levantar servidor):** `python engine/vps_api_soe.py --self-test`

---

## Los 8 Endpoints Activos (100% Alineados a tu Word v2.0 — Tabla 18)

| Método y Ruta | Qué devuelve / Qué hace |
| :--- | :--- |
| `GET /health` | Estado `"VPS Soberano Online"`, versión `2.6.0-RIE02` y conteo de reglas cargadas. |
| `GET /sunat/{ruc}` | Autocompletado RUC en `<5 ms` sobre `data/padron_sunat_trujillo_muestra.json` (incluye alertas `NO HABIDO`, `BAJA DE OFICIO` y `<6 meses`). |
| `POST /solicitudes/analizar` | **Endpoint principal RIE-02:** evalúa `P-01..P-09`, contexto legítimo `L-01..L-06`, rareza $1/\log_2(1+n)$ y devuelve el contrato de la **Tabla 19** (`calidad_datos`, `red`, `patrones_detectados`, `contexto_legitimo`, `priorizacion`, `expediente_agente`, `vista_asesor_plano1`, `control_desembolso`, `accion_recomendada`). |
| `GET /red/{solicitud_id}?saltos=2` | Acepta `SOL-TRUJ-2026-0412`, `CS-01..CS-06` o `EXP-TRUJ-2026-1001..1050`. Soporta `saltos=1` o `saltos=2`. Devuelve `nodos[]`, `aristas[]` **y también `cytoscape_elements: {nodes, edges}`** listo para `Cytoscape.js`. |
| `GET /alertas` | Cola priorizada (`REVISION_PRIORITARIA` y `OBSERVACION`) filtrable por `?nivel=` y `?agencia=`. (`CS-02` y `CS-03` tienen `0` falsos positivos y no entran a la cola). |
| `POST /alertas/{alerta_id}/decision` | Registra `{"decision": "CONFIRMAR" | "DESCARTAR" | "ESCALAR", "motivo": "...", "especialista_id": "ESP-01"}`. Valida **RN-07** (motivo obligatorio) y **RN-08** (bloquea si `especialista_id == asesor_originador_id`) y devuelve hash `SHA-256`. |
| `GET /casos-simulados` | Devuelve los 6 Casos Simulados (`CS-01` al `CS-06`) con su `request_entrada`, `response_analisis` y `subred_2_saltos`. |
| `GET /metricas` | Devuelve precisión, `0` falsos positivos en casos legítimos (`CS-02`/`CS-03`), evaluación completa `CP-09` sobre los 50 expedientes (`100% recall` en anillos) y métricas de negocio. |

---

## IDs Rápidos para Probar tus Botones de Demo (`CS-01` a `CS-06`)

- **`CS-01` (`SOL-TRUJ-2026-0412`):** Anillo de 4 solicitudes en 4 agencias → Puntaje **`86`** (`REVISION_PRIORITARIA` / Rojo / `RETENER_HASTA_REVISION`).
- **`CS-02` (`SOL-TRUJ-2026-0101`):** Madre e hija mismo domicilio (`L-01`) → Puntaje **`18`** (`SIN_ALERTA` / Verde / `CONTINUAR`).
- **`CS-03` (`SOL-TRUJ-2026-0415`):** 40 negocios en Mercado La Hermelinda (`L-02`, rareza `0.12`) → Puntaje **`12`** (`SIN_ALERTA` / Verde / `CONTINUAR`).
- **`CS-04` (`SOL-TRUJ-2026-0892`):** 5 RUCs en misma vivienda, 2 `NO HABIDO` y ventas infladas (`P-04, P-06, P-08`) → Puntaje **`78`** (`REVISION_PRIORITARIA` / Rojo / `RETENER_HASTA_REVISION`).
- **`CS-05` (`SOL-TRUJ-2026-0650`):** 7 solicitudes de un asesor (`ASE-017`) con tablet corporativa (`L-06`) y 2 teléfonos repetidos → Puntaje **`58`** (`OBSERVACION` / Ámbar / `MONITOREAR`).
- **`CS-06` (`SOL-TRUJ-2026-0910`):** Confianza `0.62 < 0.85` (Candado Poka-Yoke `RN-05`) → Puntaje **`null`** (`VERIFICAR_DATOS` / Gris).
