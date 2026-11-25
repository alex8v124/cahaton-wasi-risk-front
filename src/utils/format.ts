import type {
  AuditarExpedienteResponse,
  DecisionEspecialista,
  EstadoOperativoLocal,
} from '../contracts/schemas';

/**
 * REGLA DURA SBS / RN-09: Moneda Obligatoria
 * Siempre PEN (S/) con 2 decimales exactos (ej. S/ 7,352.94). Cero dólares.
 */
const numberFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatPEN(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  const isNegative = safe < 0;
  const formatted = numberFormatter.format(Math.abs(safe));
  return isNegative ? `-S/ ${formatted}` : `S/ ${formatted}`;
}

export function formatDeltaPct(deltaRatio: number): string {
  const pct = (Number.isFinite(deltaRatio) ? deltaRatio : 0) * 100;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

export function formatRCC(rcc: number): string {
  const safe = Number.isFinite(rcc) ? rcc : 0;
  return `${safe.toFixed(2)}x`;
}

export function formatConfidencePct(confidence: number): string {
  const safe = Number.isFinite(confidence) ? confidence : 0;
  return `${Math.round(safe * 100)}%`;
}

export function formatProvisionRate(rate: number | null | undefined): string {
  if (rate === null || rate === undefined) return 'N/A (Por verificar)';
  const safe = Number.isFinite(rate) ? rate : 0;
  return `${(safe * 100).toFixed(1)}%`;
}

/**
 * 4 Carriles de Investigación (Tabla 14 & 20 RIE-02 v2.0 + Acuerdo Soe/Nicolás/Alexander):
 * - ROJO:  Revisión prioritaria (Puntaje 70–100 o alerta fraude maquillaje >30%)
 * - AMBAR: Observación (Puntaje 40–69 o escala A/B)
 * - VERDE: Sin alerta / Contexto legítimo (Puntaje 0–39 o escala AAA/AA)
 * - GRIS:  Verificar datos / Candado Poka-Yoke (Confianza < 0.85, sin puntaje, provisión null)
 */
export type KanbanColumnId = 'ROJO' | 'AMBAR' | 'VERDE' | 'GRIS';

export function getKanbanColumn(response: AuditarExpedienteResponse): KanbanColumnId {
  const nivel = response.priorizacion?.nivel;
  if (nivel === 'VERIFICAR_DATOS') return 'GRIS';
  if (nivel === 'REVISION_PRIORITARIA') return 'ROJO';
  if (nivel === 'OBSERVACION') return 'AMBAR';
  if (nivel === 'SIN_ALERTA') return 'VERDE';

  const { alerta_fraude_maquillaje, requiere_revision_humana, escala_interna_caja_trujillo } =
    response.dictamen_riesgos;

  // Acuerdo Soe + Nicolás: confianza < 0.85 (Poka-Yoke) va al carril GRIS separado
  if (
    response.validacion_fiscal.confianza_extraccion_ia < 0.85 ||
    (requiere_revision_humana && !alerta_fraude_maquillaje)
  ) {
    return 'GRIS';
  }
  if (alerta_fraude_maquillaje) {
    return 'ROJO';
  }

  const normalized = escala_interna_caja_trujillo.trim().toUpperCase();
  if (normalized.includes('PY') || normalized.includes('VERIFICAR')) return 'GRIS';
  if (normalized === 'AAA' || normalized === 'AA') return 'VERDE';
  if (normalized === 'A' || normalized === 'B') return 'AMBAR';
  return 'ROJO';
}

/**
 * Estado sin detalle para el Asesor de Campo (RF-07 / Tabla 20 / RN-08 Segregación de Funciones):
 * El asesor solo ve "Continuar", "En revisión por especialista" o "Verificar datos".
 */
export function getAsesorStatusLabel(response: AuditarExpedienteResponse): {
  label: 'Continuar' | 'En revisión por especialista' | 'Verificar datos';
  tone: 'verde' | 'rojo' | 'gris';
  description: string;
} {
  const col = getKanbanColumn(response);
  if (col === 'GRIS') {
    return {
      label: 'Verificar datos',
      tone: 'gris',
      description:
        'Candado Poka-Yoke activado por calidad documental o datos incompletos (<85%). Repetir foto o verificar comprobante original.',
    };
  }
  if (col === 'ROJO') {
    return {
      label: 'En revisión por especialista',
      tone: 'rojo',
      description:
        'Desembolso en retención preventiva hasta que el Especialista de Riesgos / Prevención de Fraude revise la evidencia.',
    };
  }
  return {
    label: 'Continuar',
    tone: 'verde',
    description:
      'Trámite habilitado para continuar en el flujo crediticio conforme a las políticas de Caja Trujillo.',
  };
}

/**
 * REGLAS DURAS SBS + RIE-02 (RN-02 / RF-22 Retención Preventiva):
 * - Si está en GRIS (Poka-Yoke VERIFICAR_DATOS) -> no se puede desembolsar.
 * - Si alerta_fraude_maquillaje === true o nivel === 'REVISION_PRIORITARIA':
 *   desembolso retenido salvo que el especialista haya tomado la decisión explícita 'DESCARTAR'
 *   (falso positivo descartado con motivo justificado).
 * - Si el especialista ya confirmó la alerta ('CONFIRMAR') o la escaló ('ESCALAR') -> bloqueado.
 */
export function canDisburse(
  response: AuditarExpedienteResponse,
  decision?: DecisionEspecialista
): boolean {
  const d = response.dictamen_riesgos;
  const col = getKanbanColumn(response);

  if (col === 'GRIS') return false;
  if (decision?.accion === 'CONFIRMAR' || decision?.accion === 'ESCALAR') return false;

  if (col === 'ROJO' || d.alerta_fraude_maquillaje === true || d.requiere_revision_humana === true) {
    // CP-04 / RF-22 / RN-02: Desembolso retenido hasta revisión humana donde el especialista decida descartar con motivo
    if (decision?.accion === 'DESCARTAR') return true;
    return false;
  }

  if (d.monto_maximo_recomendado <= 0) return false;
  return true;
}

export function deriveInitialLocalStatus(response: AuditarExpedienteResponse): EstadoOperativoLocal {
  const col = getKanbanColumn(response);
  if (col === 'GRIS') return 'DERIVADO_AUDITOR';
  if (col === 'ROJO') return 'BLOQUEADO_FRAUDE';
  return 'AUDITADO';
}

export function formatShortTime(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toLocaleTimeString('es-PE', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return '--:--:--';
  }
}
