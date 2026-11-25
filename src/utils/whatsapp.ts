import type { ExpedienteAuditadoRecord } from '../contracts/schemas';
import { truncateHash } from './crypto';
import { formatConfidencePct, formatDeltaPct, formatPEN, formatRCC } from './format';

/**
 * Construcción del dictamen consolidado para WhatsApp (portado de Nodux Flow whatsapp.js).
 * Moneda estrictamente PEN (S/) con 2 decimales y cero dólares.
 */

const dateFmt = new Intl.DateTimeFormat('es-PE', {
  timeZone: 'America/Lima',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function buildAuditWhatsAppText(record: ExpedienteAuditadoRecord): string {
  const { response } = record;
  const vf = response.validacion_fiscal;
  const tf = response.triangulacion_financiera;
  const dr = response.dictamen_riesgos;

  const estadoOperativo = dr.alerta_fraude_maquillaje
    ? '🔴 BLOQUEADO — ALERTA FRAUDE MAQUILLAJE (>30%)'
    : dr.requiere_revision_humana
      ? '🟣 DERIVADO A AUDITOR SENIOR (Candado Poka-Yoke <0.85)'
      : record.estado_local === 'DESEMBOLSADO'
        ? '✅ DESEMBOLSADO PRE-AUDITADO'
        : dr.monto_maximo_recomendado < dr.monto_solicitado_original
          ? '🟠 RECORTE AUTOMÁTICO / GARANTÍA'
          : '🟢 FAST-TRACK APROBADO SIN RECORTE';

  const lines = [
    `*DICTAMEN WASI-RISK AI · ${response.expediente_id}*`,
    `Caja Trujillo · ${record.agencia_origen}`,
    `Fecha: ${dateFmt.format(new Date(record.actualizado_en))}`,
    record.titulo_caso || record.razon_social
      ? `Cliente: ${record.titulo_caso || record.razon_social}`
      : '',
    `RUC: ${vf.ruc} (${vf.estado_sunat} / ${vf.condicion_domicilio}) · CIIU ${vf.giro_ciiu}`,
    '',
    `Estado: *${estadoOperativo}*`,
    `Escala Caja Trujillo: *${dr.escala_interna_caja_trujillo}* (SBS ${
      dr.clasificacion_sbs_proyectada ?? 'Por verificar (Excluido SBS)'
    })`,
    '',
    `Ventas Declaradas: ${formatPEN(tf.ventas_declaradas_asesor)}`,
    `Ventas Implícitas: ${formatPEN(tf.ventas_implicitas_calculadas)} (Delta ${formatDeltaPct(tf.delta_desviacion_declarativa)})`,
    `RCC: ${formatRCC(tf.ratio_cobertura_cuota_rcc)} · OCR IA: ${formatConfidencePct(vf.confianza_extraccion_ia)}`,
    `Solicitado: ${formatPEN(dr.monto_solicitado_original)}`,
    `*Recomendado: ${formatPEN(dr.monto_maximo_recomendado)}*`,
    dr.provision_sbs_evitada_pen && dr.provision_sbs_evitada_pen > 0
      ? `Provisión SBS evitada: *${formatPEN(dr.provision_sbs_evitada_pen)}*`
      : '',
    '',
    `SHA-256: ${truncateHash(response.hash_integridad_sha256, 12, 8)}`,
    '_Auditado con WASI-RISK AI (Caja Trujillo · Art. 140 PII)_',
  ];

  return lines.filter((l, idx, arr) => l !== '' || (idx > 0 && arr[idx - 1] !== '')).join('\n');
}

export function buildWhatsAppUrl(phone: string, text: string): string {
  const digits = String(phone || '').replace(/\D/g, '');
  // Números peruanos de 9 dígitos → prefijo 51
  const intl = digits.length === 9 ? `51${digits}` : digits;
  const base = intl ? `https://wa.me/${intl}` : 'https://wa.me/';
  return `${base}?text=${encodeURIComponent(text)}`;
}
