import { useEffect, useState } from 'preact/hooks';
import { getCiiuLabel } from '../contracts/catalogs';
import type { ExpedienteAuditadoRecord } from '../contracts/schemas';
import { truncateHash } from '../utils/crypto';
import {
  formatConfidencePct,
  formatDeltaPct,
  formatPEN,
  formatProvisionRate,
  formatRCC,
} from '../utils/format';
import { buildAuditWhatsAppText, buildWhatsAppUrl } from '../utils/whatsapp';

interface DictamenPrintModalProps {
  record: ExpedienteAuditadoRecord | null;
  onClose: () => void;
}

export default function DictamenPrintModal({ record, onClose }: DictamenPrintModalProps) {
  const [mode, setMode] = useState<'ACTA' | 'POKA_YOKE'>('ACTA');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!record) return;
    if (
      record.response.validacion_fiscal.confianza_extraccion_ia < 0.85 ||
      record.response.priorizacion?.nivel === 'VERIFICAR_DATOS'
    ) {
      setMode('POKA_YOKE');
    } else {
      setMode('ACTA');
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [record, onClose]);

  if (!record) return null;

  const { response } = record;
  const vf = response.validacion_fiscal;
  const tf = response.triangulacion_financiera;
  const dr = response.dictamen_riesgos;

  const docNumber = `SBS-${response.expediente_id}`;
  const fechaStr = new Date(record.actualizado_en).toLocaleString('es-PE');

  const handleCopyText = () => {
    const text = buildAuditWhatsAppText(record);
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleWhatsApp = () => {
    const text = buildAuditWhatsAppText(record);
    window.open(buildWhatsAppUrl('', text), '_blank', 'noopener,noreferrer');
  };

  const handlePrint = () => {
    window.print();
  };

  const isLowOcr = vf.confianza_extraccion_ia < 0.85;
  const checklistItems = [
    `Verificar comprobantes físicos originales (boletas/facturas) vinculados al RUC ${vf.ruc}.`,
    `Confirmar coherencia física de insumos y stock en local con el giro ${getCiiuLabel(vf.giro_ciiu)}.`,
    isLowOcr
      ? `Recapturar fotografía legible del documento (confianza IA actual: ${formatConfidencePct(vf.confianza_extraccion_ia)}, inferior al umbral mínimo de 85%).`
      : `Calidad fotográfica y OCR verificados (${formatConfidencePct(vf.confianza_extraccion_ia)} ≥ 85% requerido) — no requiere recaptura de imagen.`,
    `Validar inventario físico declarado (${formatPEN(record.request.inventario_fisico_estimado)}) y flujo real de caja en campo.`,
    `Emitir visto bueno o rechazo definitivo de Auditor Senior antes de habilitar desembolso.`,
  ];

  return (
    <div
      class="modal-backdrop print-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`Acta formal ${docNumber}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div class="modal-card modal-md print-sheet">
        {/* Barra superior no imprimible */}
        <div class="modal-head print-hidden">
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              class={`btn btn-sm ${mode === 'ACTA' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setMode('ACTA')}
            >
              Acta Formal SBS
            </button>
            <button
              type="button"
              class={`btn btn-sm ${mode === 'POKA_YOKE' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setMode('POKA_YOKE')}
            >
              Checklist Auditor Senior
            </button>
          </div>
          <button type="button" class="btn btn-secondary btn-sm" onClick={onClose} aria-label="Cerrar acta">
            ×
          </button>
        </div>

        <div class="modal-body">
          {/* Encabezado Formal */}
          <div class="print-doc-header">
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <strong style={{ fontSize: '19px', letterSpacing: '-0.02em' }}>WASI-RISK AI</strong>
                <span class="badge badge-slate">CAJA TRUJILLO · RIESGOS SBS</span>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--ink-secondary)', marginTop: '4px' }}>
                Agencia: <strong>{record.agencia_origen}</strong>
              </div>
              <div style={{ fontSize: '11.5px', color: 'var(--ink-muted)' }}>
                Capa de Auditoría Pre-Desembolso al 100% · Art. 140 PII Soberano
              </div>
            </div>

            <div class="print-doc-badge">
              <div style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--indigo-accent)' }}>
                {mode === 'ACTA' ? 'Acta Pre-Desembolso SBS' : 'Hoja de Verificación Poka-Yoke'}
              </div>
              <div class="mono" style={{ fontSize: '15px', fontWeight: 800, marginTop: '2px' }}>
                {docNumber}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--ink-muted)' }}>{fechaStr}</div>
            </div>
          </div>

          {/* Datos Cliente / Fiscal */}
          <div class="stat-grid-2" style={{ marginTop: '14px' }}>
            <div class="stat-tile">
              <div class="stat-tile-label">Cliente / Expediente</div>
              <div style={{ fontWeight: 800, fontSize: '13.5px', marginTop: '2px' }}>
                {record.titulo_caso || record.razon_social || `RUC ${vf.ruc}`}
              </div>
              <div class="mono" style={{ fontSize: '12px', color: 'var(--indigo-mid)', marginTop: '2px' }}>
                RUC {vf.ruc} · {vf.estado_sunat} / {vf.condicion_domicilio}
              </div>
            </div>
            <div class="stat-tile">
              <div class="stat-tile-label">Clasificación y Escala</div>
              <div style={{ fontWeight: 800, fontSize: '13.5px', marginTop: '2px' }}>
                Escala {dr.escala_interna_caja_trujillo} · SBS{' '}
                {dr.clasificacion_sbs_proyectada ?? 'Por verificar (Excluido SBS)'} (
                {formatProvisionRate(dr.tasa_provision_sbs)})
              </div>
              <div style={{ fontSize: '11.5px', color: 'var(--ink-muted)', marginTop: '2px' }}>
                {getCiiuLabel(vf.giro_ciiu)}
              </div>
            </div>
          </div>

          {mode === 'ACTA' ? (
            <>
              <div class="table-wrap" style={{ marginTop: '14px' }}>
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>Concepto de Triangulación SBS</th>
                      <th style={{ textAlign: 'right' }}>Valor (PEN S/)</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Ventas Declaradas por Asesor</td>
                      <td class="mono" style={{ textAlign: 'right', fontWeight: 700 }}>
                        {formatPEN(tf.ventas_declaradas_asesor)}
                      </td>
                    </tr>
                    <tr>
                      <td>Compras Comprobadas en Documentos (OCR {formatConfidencePct(vf.confianza_extraccion_ia)})</td>
                      <td class="mono" style={{ textAlign: 'right', fontWeight: 700 }}>
                        {formatPEN(tf.compras_comprobadas_documentos)}
                      </td>
                    </tr>
                    <tr>
                      <td>Ventas Implícitas Calculadas (Motor CIIU)</td>
                      <td class="mono" style={{ textAlign: 'right', fontWeight: 700 }}>
                        {formatPEN(tf.ventas_implicitas_calculadas)}
                      </td>
                    </tr>
                    <tr>
                      <td>Desviación Declarativa (Delta %) / Cobertura Cuota (RCC)</td>
                      <td class="mono" style={{ textAlign: 'right', fontWeight: 800 }}>
                        {formatDeltaPct(tf.delta_desviacion_declarativa)} · {formatRCC(tf.ratio_cobertura_cuota_rcc)}
                      </td>
                    </tr>
                    <tr>
                      <td>Flujo Neto Disponible / Cuota Propuesta</td>
                      <td class="mono" style={{ textAlign: 'right' }}>
                        {formatPEN(tf.flujo_neto_disponible)} / {formatPEN(tf.cuota_mensual_propuesta)}
                      </td>
                    </tr>
                    <tr>
                      <td>Monto Solicitado Original</td>
                      <td class="mono" style={{ textAlign: 'right', fontWeight: 700 }}>
                        {formatPEN(dr.monto_solicitado_original)}
                      </td>
                    </tr>
                    <tr>
                      <td>
                        <strong>Monto Máximo Recomendado Pre-Desembolso</strong>
                      </td>
                      <td class="mono" style={{ textAlign: 'right', fontWeight: 800, fontSize: '14px' }}>
                        {formatPEN(dr.monto_maximo_recomendado)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div class="sbs-narrative" style={{ marginTop: '14px' }}>
                {dr.explicacion_agente_sbs}
              </div>
            </>
          ) : (
            <div class="section-box" style={{ marginTop: '14px' }}>
              <h3 class="section-title">
                <span>Checklist Obligatorio de Auditoría Presencial</span>
                <span class="badge badge-poka">Derivado a Auditor Senior</span>
              </h3>
              <ul class="checklist-ul">
                {checklistItems.map((item) => (
                  <li key={item}>
                    <span class="checklist-box" aria-hidden="true">□</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <div class="print-signatures">
                <div class="print-sig-line">
                  <strong>Asesor de Negocios Campo</strong>
                  <span>Firma / Código Caja Trujillo</span>
                </div>
                <div class="print-sig-line">
                  <strong>Auditor Senior de Riesgos</strong>
                  <span>Visto Bueno / Sello SBS</span>
                </div>
              </div>
            </div>
          )}

          <div style={{ marginTop: '12px', fontSize: '11px', color: 'var(--ink-muted)', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
            <span class="mono">SHA-256: {truncateHash(response.hash_integridad_sha256, 16, 10)}</span>
            <span class="mono">{response.modo_inferencia} · {response.latencia_ms.toFixed(1)} ms</span>
          </div>
        </div>

        <div class="modal-footer print-hidden">
          <button type="button" class="btn btn-secondary btn-sm" onClick={handleCopyText}>
            {copied ? '✓ Texto Copiado' : 'Copiar Texto'}
          </button>
          <button type="button" class="btn btn-success btn-sm" onClick={handleWhatsApp}>
            Enviar por WhatsApp
          </button>
          <button type="button" class="btn btn-primary btn-sm" onClick={handlePrint}>
            Imprimir / Guardar PDF
          </button>
        </div>
      </div>
    </div>
  );
}
