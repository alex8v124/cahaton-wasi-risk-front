import type {
  AuditarExpedienteRequest,
  ExpedienteAuditadoRecord,
} from '../contracts/schemas';
import { sha256Hex } from './crypto';
import { formatDeltaPct, formatPEN, formatRCC } from './format';

const WEBHOOK_STORAGE_KEY = 'wasi.webhook_url';

export function getSavedWebhookUrl(): string {
  try {
    return localStorage.getItem(WEBHOOK_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function saveWebhookUrl(url: string): void {
  try {
    localStorage.setItem(WEBHOOK_STORAGE_KEY, url.trim());
  } catch {
    // Ignore private mode errors
  }
}

/**
 * Envío de webhook corporativo (Core Bancario / Google Sheets Apps Script / Make / Zapier),
 * portado de Nodux Flow (triggerCustomerWebhook).
 */
export async function triggerCoreWebhook(url: string, payload: unknown): Promise<boolean> {
  const trimmed = url.trim();
  if (!trimmed || !trimmed.startsWith('http')) return false;
  try {
    await fetch(trimmed, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    });
    return true;
  } catch {
    return false;
  }
}

function escapeCsvCell(val: string | number | boolean | null | undefined): string {
  const str = String(val ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Genera el Lote CSV de Auditoría SBS en Soles (PEN), portado de ExecutiveModal.jsx.
 */
export function buildAuditBatchCsv(records: readonly ExpedienteAuditadoRecord[]): string {
  const headers = [
    'EXPEDIENTE_ID',
    'FECHA_AUDITORIA',
    'AGENCIA',
    'RUC',
    'ESTADO_SUNAT',
    'CONDICION_SUNAT',
    'CIIU',
    'ESCALA_CAJA_TRUJILLO',
    'CLASIFICACION_SBS',
    'VENTAS_DECLARADAS_PEN',
    'VENTAS_IMPLICITAS_PEN',
    'DELTA_PCT',
    'RCC',
    'CONFIANZA_OCR',
    'ALERTA_FRAUDE_MAQUILLAJE',
    'REQUIERE_REVISION_HUMANA',
    'MONTO_SOLICITADO_PEN',
    'MONTO_RECOMENDADO_PEN',
    'PROVISION_SBS_EVITADA_PEN',
    'ESTADO_OPERATIVO',
    'HASH_SHA256',
  ];

  const rows = records.map((rec) => {
    const r = rec.response;
    const vf = r.validacion_fiscal;
    const tf = r.triangulacion_financiera;
    const dr = r.dictamen_riesgos;
    return [
      r.expediente_id,
      rec.actualizado_en,
      rec.agencia_origen,
      vf.ruc,
      vf.estado_sunat,
      vf.condicion_domicilio,
      vf.giro_ciiu,
      dr.escala_interna_caja_trujillo,
      dr.clasificacion_sbs_proyectada ?? 'VERIFICAR_DATOS',
      formatPEN(tf.ventas_declaradas_asesor),
      formatPEN(tf.ventas_implicitas_calculadas),
      formatDeltaPct(tf.delta_desviacion_declarativa),
      formatRCC(tf.ratio_cobertura_cuota_rcc),
      `${Math.round(vf.confianza_extraccion_ia * 100)}%`,
      dr.alerta_fraude_maquillaje ? 'SI' : 'NO',
      dr.requiere_revision_humana ? 'SI' : 'NO',
      formatPEN(dr.monto_solicitado_original),
      formatPEN(dr.monto_maximo_recomendado),
      formatPEN(dr.provision_sbs_evitada_pen ?? 0),
      rec.estado_local,
      r.hash_integridad_sha256,
    ]
      .map(escapeCsvCell)
      .join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}

export function downloadTextFile(filename: string, content: string, mime = 'text/csv;charset=utf-8;'): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const BATCH_CSV_TEMPLATE = [
  'expediente_id,ruc,agencia_origen,giro_ciiu,ventas_declaradas,inventario_fisico,gastos_familiares,cuota_sbs,cuota_propuesta,monto_solicitado,texto_ocr',
  'EXP-LOTE-2026-001,10401122334,Agencia El Porvenir,1520,8500,7200,450,200,950,9000,"210 pies cuero + suela -> S/ 5,800.00 (OCR: 0.96)"',
  'EXP-LOTE-2026-002,10404455667,Agencia Trujillo Centro,1810,14000,11500,750,300,1150,11000,"Rollos tela algodon + hilo -> S/ 9,500.00 (OCR: 0.94)"',
  'EXP-LOTE-2026-003,10402233445,Agencia Mercado La Hermelinda,5211,19500,4000,800,350,1400,14000,"Factura abarrotes -> S/ 4,800.00 (OCR: 0.91)"',
].join('\n');

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current.trim());
  return out;
}

/**
 * Parsea un CSV de expedientes MYPE para auditoría por lote (portado del Ingestor CSV de Nodux Flow).
 */
export async function parseBatchExpedientesCsv(
  csvText: string
): Promise<{ items: AuditarExpedienteRequest[]; error?: string }> {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return {
      items: [],
      error: 'El CSV debe tener al menos una fila de encabezados y un expediente.',
    };
  }

  const headers = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const idx = (keys: string[]) => headers.findIndex((h) => keys.some((k) => h.includes(k)));

  const rucIdx = idx(['ruc']);
  const ventasIdx = idx(['ventas']);
  const montoIdx = idx(['monto']);

  if (rucIdx === -1 || ventasIdx === -1 || montoIdx === -1) {
    return {
      items: [],
      error: 'Columnas mínimas requeridas: ruc, ventas_declaradas, monto_solicitado.',
    };
  }

  const expIdx = idx(['expediente', 'id']);
  const agenciaIdx = idx(['agencia']);
  const ciiuIdx = idx(['ciiu', 'giro']);
  const invIdx = idx(['inventario', 'stock']);
  const gastosIdx = idx(['gastos']);
  const deudaIdx = idx(['deuda', 'sbs']);
  const cuotaIdx = idx(['propuesta', 'cuota']);
  const ocrIdx = idx(['ocr', 'texto', 'evidencia']);

  const items: AuditarExpedienteRequest[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const ruc = (cols[rucIdx] || '').replace(/\D/g, '');
    if (ruc.length !== 11) continue;

    const ventas = Number(cols[ventasIdx]) || 0;
    const monto = Number(cols[montoIdx]) || 1000;
    const textoOcr =
      (ocrIdx !== -1 && cols[ocrIdx]) ||
      `Comprobante lote CSV -> S/ ${Math.round(ventas * 0.65).toFixed(2)} (OCR: 0.93)`;
    const hash = await sha256Hex(`${ruc}|${textoOcr}`);

    items.push({
      expediente_id:
        (expIdx !== -1 && cols[expIdx]) ||
        `EXP-CSV-${Date.now().toString().slice(-4)}-${String(i).padStart(2, '0')}`,
      ruc,
      agencia_origen: (agenciaIdx !== -1 && cols[agenciaIdx]) || 'Agencia El Porvenir',
      giro_ciiu: (ciiuIdx !== -1 && cols[ciiuIdx]) || '1520',
      ventas_declaradas_asesor: ventas,
      inventario_fisico_estimado: invIdx !== -1 ? Number(cols[invIdx]) || 4000 : 4000,
      gastos_operativos_familiares: gastosIdx !== -1 ? Number(cols[gastosIdx]) || 500 : 500,
      cuota_deuda_sbs_vigente: deudaIdx !== -1 ? Number(cols[deudaIdx]) || 200 : 200,
      cuota_mensual_propuesta: cuotaIdx !== -1 ? Number(cols[cuotaIdx]) || 950 : 950,
      monto_solicitado_original: monto,
      documentos_adjuntos: [
        {
          doc_id: 'DOC-1',
          tipo_documento: 'FACTURA_MAYORISTA',
          texto_ocr: textoOcr,
          hash_sha256: hash,
        },
      ],
    });
  }

  if (items.length === 0) {
    return { items: [], error: 'No se encontraron expedientes válidos con RUC de 11 dígitos.' };
  }

  return { items };
}
