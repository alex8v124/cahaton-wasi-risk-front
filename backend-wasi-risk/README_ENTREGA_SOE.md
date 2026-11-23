# Kit Oficial de Ingesta para VPS — Soe Macero (WASI-RISK AI)
**Cajathón 2026 — Caja Trujillo (Track de Riesgos)**  
**Versión:** `v2.5.0-SOE-INGESTION-KIT` | **Configuración Obligatoria del Agente:** `temperature = 0.0`

Este paquete contiene los **6 bloques completos** de datos de referencia, normativa SBS, muestras *few-shot*, heurísticas de fraude, glosario de jerga peruana y contratos JSON estrictos para calibrar tus agentes locales en el VPS sin entrenamiento desde cero (*In-Context Learning + RAG Paramétrico*).

---

## Mapa Directo de los 6 Bloques Entregados

| Bloque | Contenido | Archivo(s) en este Paquete |
| :---: | :--- | :--- |
| **1** | **Base Fiscal y Sectorial (SUNAT + 14 CIIUs Trujillo):** Padrón reducido muestra (30 RUCs 10/20 con `ACTIVO/HABIDO`, `fecha_inicio_actividades` y 8 casos trampa `NO HABIDO`/`BAJA`/`<6 meses`) + 14 giros CIIU (calzado, abarrotes, ferretería, confección, transporte carga/urbano, talleres, panadería, botica, carpintería, etc.) con margen y rotación. | `data/padron_sunat_trujillo_muestra.json`<br>`data/padron_sunat_trujillo_muestra.csv`<br>`data/reglas_parametricas_trujillo.json` |
| **2** | **Normativa SBS & Escala Caja Trujillo:** Provisiones Res. SBS N.° 11356-2008 (`1%`–`100%`), matriz `AAA–C`, System Prompt maestro (`temperature = 0.0`), plantilla obligatoria `explicacion_agente_sbs` y middleware de anonimización PII (Ley N.° 26702 Art. 140 y Res. SBS N.° 504-2021). | `AGENT_SKILL_SOE.md`<br>`SPEC.md`<br>`data/reglas_parametricas_trujillo.json`<br>`engine/sanitizador_pii_sbs.py` |
| **3** | **«Golden Samples» Documentales (Few-Shot):** 7 documentos atómicos emparejados (3 boletas/facturas mayoristas + 2 notas manuscritas de mostrador + 2 vouchers Yape/Plin) con OCR crudo → JSON ítem por ítem + 4 expedientes completos homologados. | `data/golden_samples_7_documentos.json`<br>`data/few_shot_golden_cases.json` |
| **4** | **Heurísticas de Fraude, Patrones de Red (`P-01..P-09`) y Contexto Legítimo (`L-01..L-06`) — RIE-02 v2.0:** Reglas explícitas de triangulación y grafos + los **6 Casos Simulados (`CS-01..CS-06`)** con subredes de 2 saltos listas para `Cytoscape.js`. | `data/catalogo_red_rie02_casos_simulados.json`<br>`data/heuristicas_fraude_banderas_rojas.json` |
| **5** | **Glosario de Jerga y Unidades Comerciales:** Lista cerrada de 22 unidades estándar (`DOCENA`, `ARROBA`, `QUINTAL`, `TAREA`, `PLANCHA`, `SACO_50KG`, `PIE_CUADRADO`, `JABA`, etc.) + mapeo de 45+ abreviaturas peruanas (`doc`, `cto`, `pl`, `arr`, `tira`, `saco`, `bls`, `fdo`, `tr`, `qq`, `pie`). | `data/lexico_unidades_mype.json` |
| **6** | **Contratos Inmutables (Input / Output JSON Schema Draft-07 v1 + v2.0 RIE-02):** Esquema exacto que recibes de la PWA de Alexander, esquema de salida RIE-02 v2.0 (`POST /solicitudes/analizar`) y esquemas v1.0. | `schemas/schema_rie02_analisis_red_v2.json`<br>`schemas/schema_input_alexander_a_soe.json`<br>`schemas/schema_output_soe_a_alejandro.json`<br>`schemas/schema_contrato_final_4_bloques.json` |

---

## Extras Incluidos Listos para Correr en el VPS
- **`engine/vps_api_soe.py` (PLUG-AND-PLAY FASTAPI v2.6 — 100% COMPATIBLE CON WORD v2.0 DE ALEXANDER):** Servidor en Python 3 puro (cero dependencias pesadas que fallen al instalar) con CORS, `SanitizadorPIISBS` (Art. 140 Ley 26702 & Ley 29733), motor de grafos RIE-02 (`P-01..P-09`, `L-01..L-06`, rareza $1/\log_2(1+n)$, puntaje `0–100`), triangulación `P-08` y candado Poka-Yoke (`RN-05 < 0.85`).
- **`engine/motor_scoring_wasi.py`:** Motor matemático determinista de Alejandro Flores (Triangulación CIIU + Puntaje de Red RIE-02).
- **`data/dataset_50_expedientes_trujillo.json`:** 50 expedientes sintéticos con nodos RIE-02 (`35 AAA/AA`, `8 A/B`, `7 C`).
- **`wasi_ingestion_command_center.html`:** Visor interactivo local (ábrelo con doble clic en navegador).

## Arranque en 3 Pasos en tu VPS (FastAPI + DeepSeek)
> **Nota OCR:** `deepseek-chat` es solo texto. Si recibes foto JPG/PNG de boleta o Yape desde la PWA de Alexander, pásala primero por tu OCR local (`PaddleOCR`/`Tesseract`/`Qwen-VL`).

```bash
pip install -r engine/requirements_vps_soe.txt
export DEEPSEEK_API_KEY="tu-api-key-aqui"   # Opcional: sin key corre en modo determinista local (<5 ms)
uvicorn engine.vps_api_soe:app --host 0.0.0.0 --port 8000
```

### Los 8 Endpoints Oficiales RIE-02 v2.0 (Tabla 18 del Word de Alexander) + 2 Retrocompatibles
1. `GET  /health` — Indicador `"VPS Soberano Online"` y conteo de reglas RIE-02.
2. `GET  /sunat/{ruc}` — Autocompletado RUC en `<5 ms` (30 RUCs Trujillo + alertas `NO HABIDO`/`BAJA`).
3. `POST /solicitudes/analizar` — **Endpoint principal RIE-02:** Seudonimización, patrones `P-01..P-09`, contexto `L-01..L-06`, puntaje `0–100`, expediente del agente con evidencias trazables a aristas + bloque de impacto SBS.
4. `GET  /red/{solicitud_id}?saltos=2` — Devuelve `nodos[]` y `aristas[]` de la subred listos para `Cytoscape.js`.
5. `GET  /alertas` — Cola priorizada filtrable por `nivel` y `agencia`.
6. `POST /alertas/{alerta_id}/decision` — Registra `CONFIRMAR`, `DESCARTAR` o `ESCALAR` con `motivo` obligatorio (`RN-07`) y sello `SHA-256`.
7. `GET  /casos-simulados` — Devuelve los 6 Casos Simulados (`CS-01` a `CS-06`).
8. `GET  /metricas` — Precisión, `0` falsos positivos en casos legítimos (`CS-02`/`CS-03`), tiempos y ahorro SBS.
*(Además siguen activos `GET /golden-cases` y `POST /auditar-expediente` de v1.0).*

## Verificación Rápida Sin Instalar Nada (Python 3 puro)
```bash
python engine/sanitizador_pii_sbs.py
python engine/motor_scoring_wasi.py
python engine/vps_api_soe.py --self-test
```
