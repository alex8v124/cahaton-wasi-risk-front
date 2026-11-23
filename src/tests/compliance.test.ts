import { describe, expect, it } from 'vitest';
import {
  evaluarFotoCalidad,
  getGoldenCases,
  getSubredGrafo,
  getSunatByRuc,
  postAuditarExpediente,
} from '../api/client';
import {
  adaptarPayloadEntrada,
  ejecutarBarridoPoblacionSintetica,
  parseAmountFromOcr,
  sanitizarTextoPiiV2,
  UNIDADES_MYPE_22,
  verificarEvidenciasContraGrafo,
  verificarMatematicaComprobantePython,
} from '../api/mockBackend';
import { SOE_KIT_DOCUMENTS_CATALOG } from '../contracts/catalogs';
import {
  AuditarExpedienteResponseSchema,
  type DecisionEspecialista,
  type ExpedienteAuditadoRecord,
} from '../contracts/schemas';
import { sha256Hex } from '../utils/crypto';
import {
  canDisburse,
  formatPEN,
  getAsesorStatusLabel,
  getKanbanColumn,
} from '../utils/format';
import { isValidRucChecksum } from '../utils/ruc';
import { buildSearchIndex, searchIndex } from '../utils/search';
import { BATCH_CSV_TEMPLATE, buildAuditBatchCsv, parseBatchExpedientesCsv } from '../utils/webhook';
import { buildAuditWhatsAppText, buildWhatsAppUrl } from '../utils/whatsapp';

describe('Reglas Duras RIE-02 v2.0 + Agente Local Soe + Compliance SBS (WASI-RISK AI)', () => {
  it('Regla #1: Moneda Obligatoria siempre en PEN (S/) con 2 decimales exactos y cero dólares', () => {
    expect(formatPEN(7352.94)).toBe('S/ 7,352.94');
    expect(formatPEN(8000)).toBe('S/ 8,000.00');
    expect(formatPEN(0)).toBe('S/ 0.00');
    expect(formatPEN(15000.5)).toBe('S/ 15,000.50');
    expect(formatPEN(7352.94)).not.toContain('$');
  });

  it('SHA-256 nativo produce digest hex de 64 caracteres válido', async () => {
    const digest = await sha256Hex('180 pies cuero + suela -> S/ 5,000.00 (OCR: 0.95)');
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('SUNAT lookup devuelve alertas NO HABIDO / BAJA DE OFICIO en RUCs de Trujillo', async () => {
    const active = await getSunatByRuc('10423189012');
    expect(active.data.estado_sunat).toBe('ACTIVO');
    expect(active.data.condicion_domicilio).toBe('HABIDO');
    expect(active.data.giro_ciiu).toBe('1520');

    const baja = await getSunatByRuc('10403344556');
    expect(baja.data.estado_sunat).toBe('BAJA DE OFICIO');
    expect(baja.data.condicion_domicilio).toBe('NO HABIDO');
  });

  it('Los 6 Casos Simulados RIE-02 (CS-01..CS-06) cumplen puntajes de red, contexto legítimo y separación Poka-Yoke Gris', async () => {
    const cases = await getGoldenCases();
    expect(cases).toHaveLength(6);

    // CS-01: Anillo 4 Agencias (Rojo, Puntaje 86)
    const c1 = await postAuditarExpediente(cases[0].payload);
    expect(AuditarExpedienteResponseSchema.safeParse(c1.response).success).toBe(true);
    expect(c1.response.priorizacion?.puntaje_red).toBe(86);
    expect(c1.response.priorizacion?.nivel).toBe('REVISION_PRIORITARIA');
    expect(getKanbanColumn(c1.response)).toBe('ROJO');
    expect(getAsesorStatusLabel(c1.response).label).toBe('En revisión por especialista');
    expect(canDisburse(c1.response)).toBe(false);

    // Si el especialista descarta con motivo obligatorio (RF-21 / CP-04), se desbloquea
    const decisionDescartar: DecisionEspecialista = {
      accion: 'DESCARTAR',
      motivo: 'Verificado en campo: socios comparten línea corporativa autorizada.',
      especialista_id: 'ESP-TRUJ-01',
      fecha: new Date().toISOString(),
      hash_decision_sha256: await sha256Hex('DESCARTAR|CS-01'),
    };
    expect(canDisburse(c1.response, decisionDescartar)).toBe(true);

    // CS-02: Familia Mismo Domicilio (Verde, Puntaje 18, Contexto L-01)
    const c2 = await postAuditarExpediente(cases[1].payload);
    expect(AuditarExpedienteResponseSchema.safeParse(c2.response).success).toBe(true);
    expect(c2.response.priorizacion?.puntaje_red).toBe(18);
    expect(c2.response.contexto_legitimo?.[0]?.codigo).toBe('L-01');
    expect(getKanbanColumn(c2.response)).toBe('VERDE');
    expect(getAsesorStatusLabel(c2.response).label).toBe('Continuar');
    expect(canDisburse(c2.response)).toBe(true);

    // CS-03: Mercado La Hermelinda (Verde, Puntaje 12, Contexto L-02, Rareza 0.12)
    const c3 = await postAuditarExpediente(cases[2].payload);
    expect(AuditarExpedienteResponseSchema.safeParse(c3.response).success).toBe(true);
    expect(c3.response.priorizacion?.puntaje_red).toBe(12);
    expect(c3.response.contexto_legitimo?.[0]?.codigo).toBe('L-02');
    expect(getKanbanColumn(c3.response)).toBe('VERDE');
    expect(canDisburse(c3.response)).toBe(true);

    // CS-04: 5 RUCs Recientes + 2 NO HABIDO + Ventas Infladas P-08 (Rojo, Puntaje 78)
    const c4 = await postAuditarExpediente(cases[3].payload);
    expect(AuditarExpedienteResponseSchema.safeParse(c4.response).success).toBe(true);
    expect(c4.response.priorizacion?.puntaje_red).toBe(78);
    expect(c4.response.validacion_fiscal.ruc).toBe('10402233445');
    expect(c4.response.validacion_fiscal.condicion_domicilio).toBe('NO HABIDO');
    expect(c4.response.dictamen_riesgos.alerta_fraude_maquillaje).toBe(true);
    expect(getKanbanColumn(c4.response)).toBe('ROJO');
    expect(canDisburse(c4.response)).toBe(false);

    // CP-02 (Tabla 22 Word v2.0): Verificar que TODA evidencia citada en CS-01..CS-06 exista como arista real en su subred_grafo
    for (const resp of [c1.response, c4.response]) {
      const evs = resp.expediente_agente?.evidencias_citadas ?? [];
      expect(evs.length).toBeGreaterThan(0);
      const edgeIds = new Set(resp.subred_grafo?.aristas.map((a) => a.id) ?? []);
      for (const ev of evs) {
        expect(edgeIds.has(ev.arista_id)).toBe(true);
      }
      expect(verificarEvidenciasContraGrafo(evs, resp.subred_grafo)).toHaveLength(evs.length);
    }

    // CS-05: Concentración en Asesor ASE-017 + L-06 (Ámbar, Puntaje 58)
    const c5 = await postAuditarExpediente(cases[4].payload);
    expect(AuditarExpedienteResponseSchema.safeParse(c5.response).success).toBe(true);
    expect(c5.response.priorizacion?.puntaje_red).toBe(58);
    expect(getKanbanColumn(c5.response)).toBe('AMBAR');
    expect(c5.response.dictamen_riesgos.monto_maximo_recomendado).toBe(8500);
    expect(canDisburse(c5.response)).toBe(true);

    // CS-06: Poka-Yoke Confianza 0.62 & 5.0OO.00 -> Estado GRIS separado (Sin puntaje, Provisión null / S/ 0.00)
    const c6 = await postAuditarExpediente(cases[5].payload);
    expect(AuditarExpedienteResponseSchema.safeParse(c6.response).success).toBe(true);
    expect(c6.response.priorizacion?.puntaje_red).toBeNull();
    expect(c6.response.priorizacion?.nivel).toBe('VERIFICAR_DATOS');
    expect(c6.response.dictamen_riesgos.clasificacion_sbs_proyectada).toBeNull();
    expect(c6.response.dictamen_riesgos.tasa_provision_sbs).toBeNull();
    expect(c6.response.dictamen_riesgos.provision_sbs_evitada_pen).toBe(0);
    expect(getKanbanColumn(c6.response)).toBe('GRIS');
    expect(getAsesorStatusLabel(c6.response).label).toBe('Verificar datos');
    expect(canDisburse(c6.response)).toBe(false);
  });

  it('Agente Local Soe: Sanitizador v2 (0 PII enviados), Semáforo de Nitidez (5.0OO.00), D1..D12 y Grafo de 2 Saltos', async () => {
    // 1. Sanitizador v2 de 5 capas + D5/D8/D10 (preserva código op Yape 09482716, oculta PAREDESGOMEZROSAURA y filtra pie CASO TRAMPA)
    const scrubbed = sanitizarTextoPiiV2(
      'RUC10423189012 Para: CAMPOS ALVA RICARDO PAREDESGOMEZROSAURA Cel +51 948332190 N° op 09482716 CASO TRAMPA POKA-YOKE'
    );
    expect(scrubbed.pii_enviados_contador).toBe(0);
    expect(scrubbed.pii_detectados_y_ocultados).toBeGreaterThanOrEqual(3);
    expect(scrubbed.texto_sanitizado).not.toContain('10423189012');
    expect(scrubbed.texto_sanitizado).not.toContain('948332190');
    expect(scrubbed.texto_sanitizado).not.toContain('PAREDESGOMEZROSAURA');
    expect(scrubbed.texto_sanitizado).not.toContain('CAMPOS ALVA RICARDO');
    expect(scrubbed.texto_sanitizado).not.toContain('CASO TRAMPA POKA-YOKE');
    expect(scrubbed.texto_sanitizado).toContain('09482716');

    // 2. Hallazgo D3/D4: Yape S/ 870.00 con "Comisión S/ 0.00 (Gratis)" debe computar 870 y no 0
    expect(
      parseAmountFromOcr('Yapeaste S/ 870.00 · Comisión S/ 0.00 (Gratis) · N° op 09482716')
    ).toBe(870);

    // 3. Hallazgo D7 & Sección 9 Paso 3: 22 unidades MYPE, IGV 1.18 y coherencia de giro sobre montos (>20%)
    expect(UNIDADES_MYPE_22).toHaveLength(22);
    const checkOk = verificarMatematicaComprobantePython({
      giro_ciiu: '5211',
      monto_total_pen: 1180,
      base_gravada_pen: 1000,
      monto_fuera_giro_pen: 150, // 12.7% <= 20%
    });
    expect(checkOk.igv_valido).toBe(true);
    expect(checkOk.coherencia_insumos_giro).toBe(true);

    const checkFail = verificarMatematicaComprobantePython({
      giro_ciiu: '5211',
      monto_total_pen: 2400,
      monto_fuera_giro_pen: 1800, // 75% > 20% (cemento en bodega)
    });
    expect(checkFail.coherencia_insumos_giro).toBe(false);

    // 4. Hallazgo D1/D2: Adaptador Universal de Contrato (acepta payload anidado de Word v2.0 y kit de Soe)
    const adaptedWord = adaptarPayloadEntrada({
      solicitud_id: 'SOL-TRUJ-2026-0412',
      agencia_origen: 'Agencia Florencia',
      monto_solicitado: 15000,
      negocio: { ruc: '10456712390', giro_ciiu: '1520' },
      solicitante: { telefonos: ['948112233'], direccion: 'Calle Los Laureles' },
      dispositivo: { fingerprint: 'dev:7a1e', tipo: 'CORPORATIVO_ASESOR' },
      ventas_declaradas: 18500,
      compras_comprobadas: 7200,
    });
    expect(adaptedWord.expediente_id).toBe('SOL-TRUJ-2026-0412');
    expect(adaptedWord.ruc).toBe('10456712390');
    expect(adaptedWord.ventas_declaradas_asesor).toBe(18500);
    expect(adaptedWord.dispositivo_tipo).toBe('CORPORATIVO_ASESOR');

    // 5. Evaluador de nitidez y detección de letras O/l en montos (5.0OO.00)
    const blurry = await evaluarFotoCalidad({
      nombre_archivo: 'nota_borrosa.jpg',
      texto_ocr: 'Venta semanal S/ 5.0OO.00 (OCR: 0.62)',
    });
    expect(blurry.semaforo_nitidez).toBe('ROJO');
    expect(blurry.pii_enviados_contador).toBe(0);
    expect(blurry.contiene_importe_ambiguo_letras).toBe(true);

    // 6. Subred de 2 saltos
    const graph = await getSubredGrafo('SOL-TRUJ-2026-0412', 2);
    expect(graph.nodos.length).toBeGreaterThanOrEqual(4);
    expect(graph.aristas.length).toBeGreaterThanOrEqual(3);

    // 7. Los 7 Documentos del Kit de Soe + Barrido Población Sintética (RF-16 / CP-09: 2,000 solicitudes y 50 expedientes)
    expect(SOE_KIT_DOCUMENTS_CATALOG).toHaveLength(7);
    const sweep = ejecutarBarridoPoblacionSintetica();
    expect(sweep.poblacion_grafo.total_solicitudes).toBe(2000);
    expect(sweep.poblacion_grafo.total_personas).toBe(1500);
    expect(sweep.poblacion_grafo.tasa_deteccion_anillos_pct).toBe(100);
    expect(sweep.poblacion_grafo.falsos_positivos_en_legitimos).toBe(0);
    expect(sweep.benchmark_kit_soe.dataset_50_expedientes.total).toBe(50);
    expect(sweep.benchmark_kit_soe.dataset_50_expedientes.verde_aaa_aa).toBe(35);
    expect(sweep.benchmark_kit_soe.dataset_50_expedientes.ambar_a_b).toBe(8);
    expect(sweep.benchmark_kit_soe.dataset_50_expedientes.rojo_c_fraude_real).toBe(5);
    expect(sweep.benchmark_kit_soe.dataset_50_expedientes.gris_poka_yoke_sin_puntaje).toBe(2);
  });

  it('Funcionalidades Nodux Flow: RUC Módulo 11, búsqueda in-memory, WhatsApp PEN y lote CSV', async () => {
    expect(isValidRucChecksum('20524854521')).toBe(true);
    expect(isValidRucChecksum('20100047218')).toBe(true);
    expect(isValidRucChecksum('12345678901')).toBe(false);

    const idx = buildSearchIndex(
      [
        { id: 'EXP-1', title: 'Calzado El Porvenir', agencia: 'Agencia El Porvenir' },
        { id: 'EXP-2', title: 'Bodega San Martín', agencia: 'Agencia La Esperanza' },
      ],
      (x) => ({ primary: x.id, secondary: [x.title, x.agencia] })
    );
    expect(searchIndex(idx, 'martin')).toHaveLength(1);
    expect(searchIndex(idx, 'martin')[0].id).toBe('EXP-2');

    const cases = await getGoldenCases();
    const { response } = await postAuditarExpediente(cases[1].payload);
    const rec: ExpedienteAuditadoRecord = {
      expediente_id: response.expediente_id,
      titulo_caso: cases[1].titulo,
      agencia_origen: cases[1].payload.agencia_origen,
      creado_en: new Date().toISOString(),
      actualizado_en: new Date().toISOString(),
      origen: 'DEMO_RAPIDA',
      estado_local: 'AUDITADO',
      request: cases[1].payload,
      response,
    };
    const waText = buildAuditWhatsAppText(rec);
    expect(waText).toContain('S/ 8,000.00');
    expect(waText).not.toContain('$');
    expect(buildWhatsAppUrl('999111222', waText)).toContain('https://wa.me/51999111222?text=');

    const csv = buildAuditBatchCsv([rec]);
    expect(csv).toContain('EXP-TRUJ-2026-0101');
    expect(csv).toContain('S/ 8,000.00');
    expect(csv).not.toContain('$');

    const parsed = await parseBatchExpedientesCsv(BATCH_CSV_TEMPLATE);
    expect(parsed.error).toBeUndefined();
    expect(parsed.items).toHaveLength(3);
  });
});
