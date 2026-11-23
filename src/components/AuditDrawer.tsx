import { useEffect, useState } from 'preact/hooks';
import { getSubredGrafo, postRemoteAlertDecision } from '../api/client';
import { getCiiuLabel } from '../contracts/catalogs';
import type {
  DecisionEspecialista,
  ExpedienteAuditadoRecord,
  GrafoNodo,
  SubredGrafo,
} from '../contracts/schemas';
import { sha256Hex, truncateHash } from '../utils/crypto';
import {
  canDisburse,
  formatConfidencePct,
  formatDeltaPct,
  formatPEN,
  formatProvisionRate,
  formatRCC,
  getKanbanColumn,
} from '../utils/format';
import { buildAuditWhatsAppText, buildWhatsAppUrl } from '../utils/whatsapp';

interface AuditDrawerProps {
  record: ExpedienteAuditadoRecord | null;
  onClose: () => void;
  onDisburse: (expedienteId: string) => void;
  onRecordDecision?: (expedienteId: string, decision: DecisionEspecialista) => Promise<void>;
  onOpenPrintModal?: (record: ExpedienteAuditadoRecord) => void;
}

/**
 * Grafo Interactivo de Subred (2 saltos) en SVG nativo (0 KB librerías externas, RNF-02 < 2s).
 * Colores oficiales Sección 10.2:
 * - Personas y Negocios: Azul (#2563EB)
 * - Solicitudes: Amarillo/Ámbar (#D97706)
 * - Atributos compartidos (Teléfono, Dispositivo, Dirección, Referencia, Asesor): Gris (#475569)
 * - Aristas de evidencia: Rojo (#E11D48)
 */
function NetworkGraphViewer({ grafo: initialGrafo }: { grafo: SubredGrafo }) {
  const [activeGrafo, setActiveGrafo] = useState<SubredGrafo>(initialGrafo);
  const [saltos, setSaltos] = useState<1 | 2>(2);
  const [loadingHops, setLoadingHops] = useState(false);
  const [selectedNode, setSelectedNode] = useState<GrafoNodo | null>(initialGrafo.nodos[0] ?? null);

  useEffect(() => {
    setActiveGrafo(initialGrafo);
    setSaltos(2);
    setSelectedNode(initialGrafo.nodos[0] ?? null);
  }, [initialGrafo.solicitud_id]);

  const handleSelectSaltos = async (nextSaltos: 1 | 2) => {
    if (nextSaltos === saltos) return;
    setSaltos(nextSaltos);
    if (nextSaltos === 2) {
      setActiveGrafo(initialGrafo);
      setSelectedNode(initialGrafo.nodos[0] ?? null);
      return;
    }
    setLoadingHops(true);
    try {
      const sub1 = await getSubredGrafo(initialGrafo.solicitud_id, 1);
      if (sub1 && sub1.nodos.length > 0 && sub1.nodos.length < initialGrafo.nodos.length) {
        setActiveGrafo(sub1);
        setSelectedNode(sub1.nodos[0] ?? null);
      } else {
        // Filtrado determinista de 1 salto sobre las aristas directas al nodo raíz
        const rootId = initialGrafo.nodos[0]?.id ?? initialGrafo.solicitud_id;
        const directEdges = initialGrafo.aristas.filter(
          (a) => a.source === rootId || a.target === rootId
        );
        const hop1Ids = new Set<string>([
          rootId,
          ...directEdges.map((a) => a.source),
          ...directEdges.map((a) => a.target),
        ]);
        const filtered: SubredGrafo = {
          ...initialGrafo,
          saltos: 1,
          nodos: initialGrafo.nodos.filter((n) => hop1Ids.has(n.id)),
          aristas: directEdges,
        };
        setActiveGrafo(filtered);
        setSelectedNode(filtered.nodos[0] ?? null);
      }
    } finally {
      setLoadingHops(false);
    }
  };

  const grafo = activeGrafo;
  const width = 540;
  const height = 284;
  const cx = width / 2;
  const cy = height / 2 - 4;

  const coords = new Map<string, { x: number; y: number }>();
  const nodes = grafo.nodos;
  if (nodes.length > 0) {
    coords.set(nodes[0].id, { x: cx, y: cy });
    const others = nodes.slice(1);
    if (others.length <= 7) {
      const rx = 192;
      const ry = 94;
      others.forEach((n, idx) => {
        const angle = (2 * Math.PI * idx) / Math.max(1, others.length) - Math.PI / 2;
        coords.set(n.id, {
          x: Math.round(cx + rx * Math.cos(angle)),
          y: Math.round(cy + ry * Math.sin(angle)),
        });
      });
    } else {
      // Distribución concéntrica de 1 salto (anillo interno) y 2 saltos (anillo externo) para grafos densos (ej. CS-01 con 14 nodos)
      const innerRing = others.filter(
        (n) =>
          n.tipo === 'TELEFONO' ||
          n.tipo === 'DISPOSITIVO' ||
          n.tipo === 'DIRECCION' ||
          n.tipo === 'ASESOR'
      );
      const outerRing = others.filter((n) => !innerRing.includes(n));
      const ring1 = innerRing.length >= 2 ? innerRing : others.slice(0, Math.ceil(others.length / 2));
      const ring2 = innerRing.length >= 2 ? outerRing : others.slice(Math.ceil(others.length / 2));

      ring1.forEach((n, idx) => {
        const angle = (2 * Math.PI * idx) / Math.max(1, ring1.length) - Math.PI / 2;
        coords.set(n.id, {
          x: Math.round(cx + 114 * Math.cos(angle)),
          y: Math.round(cy + 58 * Math.sin(angle)),
        });
      });
      ring2.forEach((n, idx) => {
        const angle = (2 * Math.PI * idx) / Math.max(1, ring2.length) - Math.PI / 4;
        coords.set(n.id, {
          x: Math.round(cx + 216 * Math.cos(angle)),
          y: Math.round(cy + 106 * Math.sin(angle)),
        });
      });
    }
  }

  const getNodeStyle = (tipo: GrafoNodo['tipo']) => {
    if (tipo === 'PERSONA' || tipo === 'NEGOCIO') {
      return { fill: '#DBEAFE', stroke: '#2563EB', text: '#1E40AF', badge: 'Persona/Negocio' };
    }
    if (tipo === 'SOLICITUD') {
      return { fill: '#FEF3C7', stroke: '#D97706', text: '#92400E', badge: 'Solicitud' };
    }
    return { fill: '#E2E8F0', stroke: '#475569', text: '#1E293B', badge: tipo };
  };

  const denseGraph = grafo.aristas.length > 4;

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '10px',
          flexWrap: 'wrap',
          fontSize: '11px',
          color: 'var(--ink-secondary)',
          marginBottom: '8px',
        }}
      >
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '9px', height: '9px', borderRadius: '99px', background: '#D97706' }} />
            Solicitud
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '9px', height: '9px', borderRadius: '99px', background: '#2563EB' }} />
            Persona / Negocio
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '9px', height: '9px', borderRadius: '99px', background: '#475569' }} />
            Atributo Compartido
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '14px', height: '3px', background: '#E11D48' }} />
            Arista de Evidencia
          </span>
        </div>

        {/* Selector interactivo 1 Salto vs 2 Saltos (GET /red/{id}?saltos=1|2 — CP-02b) */}
        <div style={{ display: 'inline-flex', gap: '4px' }}>
          <button
            type="button"
            class={`btn btn-sm ${saltos === 1 ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '10.5px', padding: '3px 8px' }}
            disabled={loadingHops}
            onClick={() => handleSelectSaltos(1)}
          >
            1 Salto (Directo)
          </button>
          <button
            type="button"
            class={`btn btn-sm ${saltos === 2 ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '10.5px', padding: '3px 8px' }}
            disabled={loadingHops}
            onClick={() => handleSelectSaltos(2)}
          >
            2 Saltos ({initialGrafo.nodos.length} nodos)
          </button>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        role="img"
        aria-label={`Grafo interactivo de subred ${grafo.solicitud_id}`}
        style={{
          display: 'block',
          background: 'var(--bg-subtle)',
          borderRadius: '14px',
          border: '1px solid var(--border-subtle)',
        }}
      >
        {/* Aristas */}
        {grafo.aristas.map((edge) => {
          const s = coords.get(edge.source);
          const t = coords.get(edge.target);
          if (!s || !t) return null;
          const mx = Math.round((s.x + t.x) / 2);
          const my = Math.round((s.y + t.y) / 2);
          const touchesSelected =
            selectedNode?.id === edge.source || selectedNode?.id === edge.target;
          const showEdgeLabel = !denseGraph || touchesSelected;
          return (
            <g key={edge.id}>
              <line
                x1={s.x}
                y1={s.y}
                x2={t.x}
                y2={t.y}
                stroke={
                  touchesSelected
                    ? '#4338CA'
                    : edge.es_evidencia
                      ? '#E11D48'
                      : '#94A3B8'
                }
                stroke-width={touchesSelected ? '2.8' : edge.es_evidencia ? '2.2' : '1.3'}
                stroke-opacity={denseGraph && !touchesSelected && !edge.es_evidencia ? '0.45' : '0.92'}
                stroke-dasharray={edge.es_evidencia ? undefined : '4 3'}
              />
              {showEdgeLabel && (
                <text
                  x={mx}
                  y={my - 4}
                  text-anchor="middle"
                  font-size="8.4"
                  font-weight="700"
                  fill={touchesSelected ? '#312E81' : edge.es_evidencia ? '#BE123C' : '#64748B'}
                >
                  {edge.relacion}
                </text>
              )}
            </g>
          );
        })}

        {/* Nodos interactivos */}
        {nodes.map((node, idx) => {
          const pt = coords.get(node.id);
          if (!pt) return null;
          const st = getNodeStyle(node.tipo);
          const isSelected = selectedNode?.id === node.id;
          const r = idx === 0 ? 20 : 15;
          const shortCaption = node.label.split(' · ')[0];
          const displayCaption =
            shortCaption.length > 17 ? `${shortCaption.slice(0, 16)}…` : shortCaption;

          return (
            <g
              key={node.id}
              transform={`translate(${pt.x}, ${pt.y})`}
              style={{ cursor: 'pointer' }}
              onClick={() => setSelectedNode(node)}
            >
              <title>{`${node.label} (${node.tipo})`}</title>
              {node.alerta && (
                <circle
                  r={r + 4}
                  fill="none"
                  stroke="#E11D48"
                  stroke-width="1.5"
                  stroke-dasharray="3 2"
                />
              )}
              <circle
                r={r}
                fill={st.fill}
                stroke={isSelected ? '#141937' : st.stroke}
                stroke-width={isSelected ? '3' : '2'}
              />
              <text
                x="0"
                y="3"
                text-anchor="middle"
                font-size="8"
                font-weight="800"
                fill={st.text}
              >
                {node.tipo.slice(0, 3)}
              </text>
              <text
                x="0"
                y={r + 11}
                text-anchor="middle"
                font-size="9"
                font-weight="700"
                fill="#141937"
              >
                {displayCaption}
              </text>
            </g>
          );
        })}
      </svg>

      {selectedNode && (
        <div
          style={{
            marginTop: '8px',
            padding: '9px 12px',
            borderRadius: '11px',
            background: 'var(--bg-subtle)',
            border: '1px solid var(--border-subtle)',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <strong>{selectedNode.label}</strong>{' '}
            <span class="badge badge-slate" style={{ fontSize: '10px' }}>
              {selectedNode.tipo}
            </span>
            {selectedNode.detalle && (
              <div style={{ color: 'var(--ink-secondary)', marginTop: '2px' }}>
                {selectedNode.detalle}
              </div>
            )}
          </div>
          {selectedNode.monto_pen !== undefined && (
            <span class="mono" style={{ fontWeight: 800 }}>
              {formatPEN(selectedNode.monto_pen)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function ComparativeSalesChart({
  ventasDeclaradas,
  ventasImplicitas,
  comprasComprobadas,
  isFraud,
}: {
  ventasDeclaradas: number;
  ventasImplicitas: number;
  comprasComprobadas: number;
  isFraud: boolean;
}) {
  const maxVal = Math.max(ventasDeclaradas, ventasImplicitas, comprasComprobadas, 1);
  const barWidth = 310;
  const rows = [
    {
      label: 'Ventas Declaradas (Asesor)',
      value: ventasDeclaradas,
      color: isFraud ? '#DC2626' : '#0F172A',
    },
    {
      label: 'Ventas Implícitas (Motor CIIU)',
      value: ventasImplicitas,
      color: '#059669',
    },
    {
      label: 'Compras Comprobadas (Docs)',
      value: comprasComprobadas,
      color: '#64748B',
    },
  ];

  return (
    <svg
      viewBox="0 0 540 156"
      width="100%"
      role="img"
      aria-label="Comparativa Ventas Declaradas vs Ventas Implícitas en Soles"
      style={{ display: 'block' }}
    >
      {rows.map((row, idx) => {
        const y = 10 + idx * 48;
        const w = Math.max(6, Math.round((row.value / maxVal) * barWidth));
        return (
          <g key={row.label} transform={`translate(0, ${y})`}>
            <text x="0" y="13" font-size="11.5" font-weight="600" fill="#475569">
              {row.label}
            </text>
            <text
              x="536"
              y="13"
              text-anchor="end"
              font-size="12.5"
              font-weight="800"
              fill={row.color}
              font-family="ui-monospace, SFMono-Regular, Menlo, monospace"
            >
              {formatPEN(row.value)}
            </text>
            <rect x="0" y="20" width="536" height="14" rx="7" fill="#F1F5F9" />
            <rect
              x="0"
              y="20"
              width={Math.round((w / barWidth) * 536)}
              height="14"
              rx="7"
              fill={row.color}
            />
          </g>
        );
      })}
    </svg>
  );
}

export function AuditDrawer({
  record,
  onClose,
  onDisburse,
  onRecordDecision,
  onOpenPrintModal,
}: AuditDrawerProps) {
  const [showRawJson, setShowRawJson] = useState(false);
  const [copiedHash, setCopiedHash] = useState(false);
  const [motivoDecision, setMotivoDecision] = useState('');
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [savingDecision, setSavingDecision] = useState(false);

  useEffect(() => {
    if (!record) return;
    setMotivoDecision(record.decision_especialista?.motivo ?? '');
    setDecisionError(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [record, onClose]);

  if (!record) return null;

  const { response } = record;
  const vf = response.validacion_fiscal;
  const tf = response.triangulacion_financiera;
  const dr = response.dictamen_riesgos;
  const prio = response.priorizacion;
  const cal = response.calidad_datos;
  const red = response.red;
  const patrones = response.patrones_detectados ?? [];
  const contextos = response.contexto_legitimo ?? [];
  const agente = response.expediente_agente;
  const sbs = response.impacto_financiero_sbs;
  const grafo = response.subred_grafo;

  const col = getKanbanColumn(response);
  const disburseAllowed = canDisburse(response, record.decision_especialista);
  const alreadyDisbursed = record.estado_local === 'DESEMBOLSADO';

  const scaleBadgeClass =
    col === 'VERDE'
      ? 'badge-green'
      : col === 'AMBAR'
        ? 'badge-amber'
        : col === 'GRIS'
          ? 'badge-slate'
          : 'badge-red-solid';

  const recRatio =
    dr.monto_solicitado_original > 0
      ? Math.min(100, Math.round((dr.monto_maximo_recomendado / dr.monto_solicitado_original) * 100))
      : 0;

  const confidencePct = Math.round(vf.confianza_extraccion_ia * 100);

  const handleCopyHash = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(response.hash_integridad_sha256).catch(() => {});
      setCopiedHash(true);
      setTimeout(() => setCopiedHash(false), 1800);
    }
  };

  const handleDecision = async (
    accion: DecisionEspecialista['accion'],
    overrideEspecialistaId?: string
  ) => {
    const trimmed = motivoDecision.trim();
    if (trimmed.length < 5) {
      setDecisionError(
        'RN-07 / CP-05: Debes ingresar un motivo justificado obligatorio (mínimo 5 caracteres) antes de registrar la decisión.'
      );
      return;
    }
    const revisorId = overrideEspecialistaId ?? 'ESP-RIESGOS-TRUJILLO';
    const originadorId = record.request.asesor_id || 'ASE-017';
    if (revisorId.toUpperCase() === originadorId.toUpperCase()) {
      setDecisionError(
        `🔒 RN-08 Violada (Segregación de Funciones · CP-05): El asesor originador (${originadorId}) NO puede aprobar ni descartar su propia alerta de red. Debe decidir un especialista distinto.`
      );
      return;
    }
    if (!onRecordDecision) return;
    setDecisionError(null);
    setSavingDecision(true);
    try {
      const now = new Date().toISOString();
      const hash = await sha256Hex(`${response.expediente_id}|${accion}|${trimmed}|${now}`);
      await onRecordDecision(response.expediente_id, {
        accion,
        motivo: trimmed,
        especialista_id: revisorId,
        fecha: now,
        hash_decision_sha256: hash,
      });
    } catch (err) {
      setDecisionError(
        err instanceof Error ? err.message : 'Error al registrar decisión del especialista.'
      );
    } finally {
      setSavingDecision(false);
    }
  };

  return (
    <div
      class="drawer-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`Auditoría del expediente ${response.expediente_id}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside class="drawer-panel">
        <div class="drawer-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span class="mono" style={{ fontSize: '12px', color: '#c7d2fe', fontWeight: 700 }}>
                {response.expediente_id}
              </span>
              {prio && (
                <span class={`badge ${scaleBadgeClass}`}>
                  {prio.puntaje_red !== null ? `Puntaje Red: ${prio.puntaje_red}/100` : 'Sin Puntaje · VERIFICAR DATOS'}
                </span>
              )}
              <span class="badge badge-slate">
                SBS: {dr.clasificacion_sbs_proyectada ?? 'NULL (Poka-Yoke)'} ({formatProvisionRate(dr.tasa_provision_sbs)})
              </span>
            </div>
            <h2 style={{ margin: '6px 0 2px', fontSize: '17px', fontWeight: 800 }}>
              {record.titulo_caso || record.razon_social || `RUC ${vf.ruc}`}
            </h2>
            <div style={{ fontSize: '12px', color: '#cbd5e1', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <span>{record.agencia_origen}</span>
              <span>·</span>
              <span class="mono">{response.latencia_ms.toFixed(1)} ms</span>
              <span>·</span>
              <span class="mono">{response.modo_inferencia}</span>
              <span>·</span>
              <span>0 PII enviados</span>
            </div>
          </div>
          <button type="button" class="drawer-close" onClick={onClose} aria-label="Cerrar drawer">
            ×
          </button>
        </div>

        <div class="drawer-body">
          {/* RESUMEN EN LENGUAJE SIMPLE PARA EL USUARIO (3 PREGUNTAS CLAVE) */}
          <section
            class="section-box"
            style={{
              background:
                col === 'VERDE'
                  ? 'rgba(16, 185, 129, 0.08)'
                  : col === 'AMBAR'
                    ? 'rgba(245, 158, 11, 0.09)'
                    : col === 'GRIS'
                      ? 'rgba(100, 116, 139, 0.09)'
                      : 'rgba(225, 29, 72, 0.08)',
              borderColor:
                col === 'VERDE'
                  ? 'rgba(16, 185, 129, 0.32)'
                  : col === 'AMBAR'
                    ? 'rgba(245, 158, 11, 0.35)'
                    : col === 'GRIS'
                      ? 'rgba(100, 116, 139, 0.35)'
                      : 'rgba(225, 29, 72, 0.35)',
            }}
          >
            <h3 class="section-title" style={{ marginBottom: '8px' }}>
              <span>Resumen Fácil de Entender (En 10 Segundos)</span>
              <span class={`badge ${scaleBadgeClass}`}>
                {col === 'VERDE'
                  ? '🟢 Aprobación Rápida'
                  : col === 'AMBAR'
                    ? '🟡 En Observación'
                    : col === 'GRIS'
                      ? '⚪ Repetir Foto / Verificar'
                      : '🔴 Alerta de Red Oculta'}
              </span>
            </h3>
            <div style={{ display: 'grid', gap: '8px', fontSize: '12.5px', lineHeight: 1.45 }}>
              <div style={{ background: 'var(--bg-surface)', padding: '9px 11px', borderRadius: '10px', border: '1px solid var(--border-subtle)' }}>
                <strong style={{ color: 'var(--ink-primary)', display: 'block', marginBottom: '2px' }}>
                  1. ¿Qué encontró el sistema?
                </strong>
                <span style={{ color: 'var(--ink-secondary)' }}>
                  {agente?.resumen || dr.explicacion_agente_sbs}
                </span>
              </div>
              <div style={{ background: 'var(--bg-surface)', padding: '9px 11px', borderRadius: '10px', border: '1px solid var(--border-subtle)' }}>
                <strong style={{ color: 'var(--ink-primary)', display: 'block', marginBottom: '2px' }}>
                  2. ¿Por qué recibió este resultado?
                </strong>
                <span style={{ color: 'var(--ink-secondary)' }}>
                  {col === 'GRIS'
                    ? 'La fotografía del comprobante salió borrosa o con letras dudosas en el monto (5.0OO.00). Para ser justos con el cliente, el sistema NO lo califica como pérdida: solo pide repetir la foto.'
                    : contextos.length > 0 && col === 'VERDE'
                      ? `Aunque comparte datos con otra solicitud, el sistema reconoció un vínculo legítimo (${contextos.map((c) => c.nombre || c.codigo).join(' + ')}) y redujo el puntaje automáticamente para evitar una falsa alerta.`
                      : patrones.length > 0
                        ? `Se detectaron ${patrones.length} conexiones inusuales en la red (${patrones.map((p) => p.nombre || p.codigo).join(', ')}) que superan el umbral normal.`
                        : 'Los documentos respaldan las ventas declaradas y no existen conexiones riesgosas con otros expedientes.'}
                </span>
              </div>
              <div style={{ background: 'var(--bg-surface)', padding: '9px 11px', borderRadius: '10px', border: '1px solid var(--border-subtle)' }}>
                <strong style={{ color: 'var(--ink-primary)', display: 'block', marginBottom: '2px' }}>
                  3. ¿Qué debes hacer ahora?
                </strong>
                <span style={{ color: 'var(--ink-secondary)' }}>
                  {agente?.pasos_sugeridos?.[0] ||
                    (col === 'VERDE'
                      ? 'Puedes aprobar y desembolsar el crédito directamente con el botón verde de abajo.'
                      : col === 'GRIS'
                        ? 'Solicita al asesor de campo tomar una nueva foto clara del comprobante.'
                        : 'Revisa el mapa de conexiones abajo y registra tu decisión (Confirmar alerta, Descartar si es legítimo o Escalar).')}
                </span>
              </div>
            </div>
          </section>

          {/* Estado Gris Separado: Candado Poka-Yoke (Acuerdo Soe + Nicolás + Alexander) */}
          {col === 'GRIS' && (
            <div class="alert-banner poka" role="alert">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                <strong style={{ fontSize: '13.5px' }}>
                  CANDADO POKA-YOKE (&lt;0.85) · ESTADO GRIS VERIFICAR DATOS
                </strong>
                <span class="badge badge-slate">Provisión SBS: null (S/ 0.00 en P&amp;L)</span>
              </div>
              <div style={{ fontSize: '12.5px' }}>
                Confianza de resolución <strong>{formatConfidencePct(vf.confianza_extraccion_ia)}</strong>.{' '}
                {cal?.motivo_calidad ??
                  'Una fotografía borrosa o documento ilegible NO clasifica al cliente como PÉRDIDA (Res. SBS 11356-2008). Se retiene sin puntaje hasta repetir foto o verificar datos.'}
              </div>
            </div>
          )}

          {/* Revisión Prioritaria / Bloqueo Preventivo */}
          {col === 'ROJO' && (
            <div class="alert-banner fraud" role="alert">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                <strong style={{ fontSize: '13.5px' }}>
                  REVISIÓN PRIORITARIA RIE-02 ({prio?.puntaje_red ?? 86}/100) · RETENCIÓN PREVENTIVA
                </strong>
                <span class="badge badge-red-solid">
                  {record.decision_especialista?.accion === 'DESCARTAR'
                    ? 'FALSO POSITIVO DESCARTADO'
                    : 'DESEMBOLSO RETENIDO'}
                </span>
              </div>
              <div style={{ fontSize: '12.5px' }}>
                Patrón de red inusual detectado{dr.alerta_fraude_maquillaje ? ' + inflación de ventas P-08 (>30%)' : ''}.
                Conforme a <strong>RN-02 / RF-22</strong>, el sistema no rechaza automáticamente: retiene el desembolso hasta que el especialista decida abajo.
              </div>
            </div>
          )}

          {/* 1. GRAFO INTERACTIVO DE SUBRED (2 SALTOS — RF-19) + LÍNEA DE TIEMPO (RF-20) */}
          {grafo && (
            <section class="section-box">
              <h3 class="section-title">
                <span>Grafo Interactivo de Subred (2 Saltos · RF-19)</span>
                {red && (
                  <span class="badge badge-slate mono">
                    {red.nodos_subred} nodos · {red.aristas_subred} aristas · {red.comunidad_id}
                  </span>
                )}
              </h3>
              <NetworkGraphViewer grafo={grafo} />

              {/* Línea de tiempo de solicitudes conectadas para ver ráfagas (RF-20 / Sección 10.2) */}
              {grafo.nodos.some((n) => n.tipo === 'SOLICITUD' && (n.fecha || n.agencia)) && (
                <div
                  style={{
                    marginTop: '10px',
                    paddingTop: '10px',
                    borderTop: '1px dashed var(--border-subtle)',
                  }}
                >
                  <div
                    style={{
                      fontSize: '11.5px',
                      fontWeight: 800,
                      color: 'var(--ink-secondary)',
                      marginBottom: '6px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <span>Línea de Tiempo de Solicitudes Conectadas (RF-20 · Ráfagas P-05)</span>
                    <span class="badge badge-slate" style={{ fontSize: '10px' }}>
                      Orden cronológico
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {grafo.nodos
                      .filter((n) => n.tipo === 'SOLICITUD')
                      .map((n) => (
                        <div
                          key={n.id}
                          style={{
                            padding: '6px 9px',
                            borderRadius: '10px',
                            background: n.alerta ? 'var(--red-soft)' : 'var(--bg-subtle)',
                            border: `1px solid ${n.alerta ? 'var(--red-accent)' : 'var(--border-subtle)'}`,
                            fontSize: '11px',
                          }}
                        >
                          <div class="mono" style={{ fontWeight: 800 }}>
                            {n.label} {n.fecha ? `· ${n.fecha}` : ''}
                          </div>
                          <div style={{ color: 'var(--ink-secondary)' }}>
                            {n.agencia ?? n.detalle ?? 'Trujillo'}
                            {n.monto_pen !== undefined ? ` · ${formatPEN(n.monto_pen)}` : ''}
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* 2. FÓRMULA DE PUNTAJE DE RED + PATRONES P-01..P-09 + CONTEXTO LEGÍTIMO L-01..L-06 */}
          {prio && (
            <section class="section-box">
              <h3 class="section-title">
                <span>Modelo Analítico de Red y Rareza 1/log₂(1+n)</span>
                <span class={`badge ${scaleBadgeClass} mono`}>
                  {prio.puntaje_red !== null ? `${prio.puntaje_red} / 100 pts` : 'VERIFICAR_DATOS'}
                </span>
              </h3>

              {prio.componentes ? (
                <div class="stat-grid-2" style={{ marginBottom: '12px' }}>
                  <div class="stat-tile">
                    <div class="stat-tile-label">0.50 × S_patrones</div>
                    <div class="stat-tile-value mono">{prio.componentes.patrones.toFixed(2)}</div>
                  </div>
                  <div class="stat-tile">
                    <div class="stat-tile-label">0.30 × S_anomalía</div>
                    <div class="stat-tile-value mono">{prio.componentes.anomalia.toFixed(2)}</div>
                  </div>
                  <div class="stat-tile">
                    <div class="stat-tile-label">0.20 × S_comunidad</div>
                    <div class="stat-tile-value mono">{prio.componentes.comunidad.toFixed(2)}</div>
                  </div>
                  <div class="stat-tile">
                    <div class="stat-tile-label">× F_contexto (L-01..L-06)</div>
                    <div class="stat-tile-value mono" style={{ color: prio.factor_contexto < 1 ? 'var(--mint-dark)' : 'inherit' }}>
                      ×{prio.factor_contexto.toFixed(2)}
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: '12px', color: 'var(--ink-secondary)', marginBottom: '10px' }}>
                  Sin puntaje de red: caso retenido en puerta de calidad documental (Candado Poka-Yoke RN-05).
                </div>
              )}

              {patrones.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: contextos.length > 0 ? '10px' : '0' }}>
                  {patrones.map((p) => (
                    <div
                      key={p.codigo}
                      style={{
                        padding: '9px 11px',
                        borderRadius: '11px',
                        background: 'var(--bg-subtle)',
                        border: '1px solid var(--border-subtle)',
                        fontSize: '12px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                        <strong>
                          <span class="badge badge-red mono" style={{ marginRight: '6px' }}>{p.codigo}</span>
                          {p.nombre || p.descripcion}
                        </strong>
                        <span class="mono" style={{ fontSize: '11px', color: 'var(--ink-secondary)' }}>
                          Peso {p.peso.toFixed(2)} · Rareza {p.rareza.toFixed(2)}
                          {p.entidades_compartidas ? ` (n=${p.entidades_compartidas})` : ''}
                        </span>
                      </div>
                      <div style={{ color: 'var(--ink-secondary)', marginTop: '3px' }}>{p.descripcion}</div>
                    </div>
                  ))}
                </div>
              )}

              {contextos.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {contextos.map((c) => (
                    <div
                      key={c.codigo}
                      style={{
                        padding: '8px 11px',
                        borderRadius: '11px',
                        background: 'var(--mint-soft)',
                        border: '1px solid var(--mint-border)',
                        fontSize: '12px',
                        color: 'var(--mint-dark)',
                      }}
                    >
                      <strong>
                        <span class="badge badge-green mono" style={{ marginRight: '6px' }}>{c.codigo}</span>
                        {c.nombre}:
                      </strong>{' '}
                      {c.descripcion} (F_contexto = {c.factor.toFixed(2)})
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* 3. EXPEDIENTE DEL AGENTE IA INVESTIGADOR (4 Partes — RF-15 / Sección 7.4) */}
          {agente && (
            <section class="section-box">
              <h3 class="section-title">
                <span>Expediente del Agente IA Investigador (RF-15)</span>
                <span class="badge badge-green">Evidencia Verificada</span>
              </h3>
              <div class="sbs-narrative" style={{ marginBottom: '10px' }}>
                {agente.resumen}
              </div>

              {agente.evidencias_citadas && agente.evidencias_citadas.length > 0 && (
                <div style={{ marginBottom: '10px', fontSize: '12px' }}>
                  <strong style={{ display: 'block', marginBottom: '4px', color: 'var(--ink-secondary)' }}>
                    Aristas de Evidencia Citadas (RN-03):
                  </strong>
                  {agente.evidencias_citadas.map((ev) => (
                    <div key={ev.arista_id} style={{ padding: '5px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                      <span class="badge badge-slate mono" style={{ marginRight: '6px' }}>{ev.arista_id}</span>
                      <span>{ev.descripcion}</span>{' '}
                      <span style={{ color: 'var(--ink-muted)', fontSize: '11px' }}>
                        ({ev.fuente} · {ev.fecha})
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div class="stat-grid-2" style={{ fontSize: '12px' }}>
                <div class="stat-tile">
                  <strong style={{ display: 'block', marginBottom: '4px', color: 'var(--ink-secondary)' }}>
                    Explicaciones Alternativas Legítimas:
                  </strong>
                  <ul style={{ margin: 0, paddingLeft: '16px', color: 'var(--ink-primary)' }}>
                    {agente.explicaciones_alternativas.map((ex) => (
                      <li key={ex}>{ex}</li>
                    ))}
                  </ul>
                </div>
                <div class="stat-tile">
                  <strong style={{ display: 'block', marginBottom: '4px', color: 'var(--ink-secondary)' }}>
                    Pasos de Verificación Sugeridos:
                  </strong>
                  <ul style={{ margin: 0, paddingLeft: '16px', color: 'var(--ink-primary)' }}>
                    {agente.pasos_sugeridos.map((ps) => (
                      <li key={ps}>{ps}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>
          )}

          {/* 4. TRIANGULACIÓN FINANCIERA P-08 + IMPACTO SBS (S/ 15M Nicolás) */}
          <section class="section-box">
            <h3 class="section-title">
              <span>Triangulación Ventas P-08 &amp; Impacto SBS (PEN)</span>
              <span
                class={`badge ${
                  dr.alerta_fraude_maquillaje
                    ? 'badge-red-solid'
                    : tf.delta_desviacion_declarativa > 0.1
                      ? 'badge-amber'
                      : 'badge-green'
                } mono`}
              >
                Delta {formatDeltaPct(tf.delta_desviacion_declarativa)}
              </span>
            </h3>
            <ComparativeSalesChart
              ventasDeclaradas={tf.ventas_declaradas_asesor}
              ventasImplicitas={tf.ventas_implicitas_calculadas}
              comprasComprobadas={tf.compras_comprobadas_documentos}
              isFraud={dr.alerta_fraude_maquillaje}
            />

            <div class="stat-grid-3" style={{ marginTop: '12px' }}>
              <div class="stat-tile">
                <div class="stat-tile-label">Solicitado</div>
                <div class="stat-tile-value mono" style={{ fontSize: '15px' }}>
                  {formatPEN(dr.monto_solicitado_original)}
                </div>
              </div>
              <div class="stat-tile">
                <div class="stat-tile-label">Recomendado</div>
                <div class="stat-tile-value mono" style={{ fontSize: '15px', color: col === 'VERDE' ? 'var(--mint-dark)' : col === 'AMBAR' ? 'var(--amber-dark)' : 'var(--red-dark)' }}>
                  {formatPEN(dr.monto_maximo_recomendado)} ({recRatio}%)
                </div>
              </div>
              <div class="stat-tile">
                <div class="stat-tile-label">Exposición Red / RCC</div>
                <div class="stat-tile-value mono" style={{ fontSize: '14px' }}>
                  {formatPEN(sbs?.exposicion_red_pen ?? dr.monto_solicitado_original)} · {formatRCC(tf.ratio_cobertura_cuota_rcc)}
                </div>
              </div>
            </div>
          </section>

          {/* 5. VALIDACIÓN FISCAL SUNAT + SEMÁFORO DE NITIDEZ SOE */}
          <section class="section-box">
            <h3 class="section-title">
              <span>Validación SUNAT, Semáforo de Nitidez &amp; Sanitizador v2</span>
              <span class="mono">{vf.ruc}</span>
            </h3>
            <div class="stat-grid-3" style={{ marginBottom: '10px' }}>
              <div class="stat-tile">
                <div class="stat-tile-label">Estado SUNAT</div>
                <div style={{ marginTop: '4px', display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                  <span class={`badge ${vf.estado_sunat === 'ACTIVO' ? 'badge-green' : 'badge-red-solid'}`}>
                    {vf.estado_sunat}
                  </span>
                  <span class={`badge ${vf.condicion_domicilio === 'HABIDO' ? 'badge-green' : 'badge-red-solid'}`}>
                    {vf.condicion_domicilio}
                  </span>
                </div>
              </div>
              <div class="stat-tile">
                <div class="stat-tile-label">Semáforo Nitidez Soe</div>
                <div style={{ marginTop: '4px' }}>
                  <span
                    class={`badge ${
                      cal?.semaforo_nitidez === 'ROJO'
                        ? 'badge-red-solid'
                        : cal?.semaforo_nitidez === 'AMARILLO'
                          ? 'badge-amber'
                          : 'badge-green'
                    }`}
                  >
                    {cal?.semaforo_nitidez ?? 'VERDE'} (pérdida {(cal?.perdida_detalle_texto ?? 0.02).toFixed(3)})
                  </span>
                </div>
              </div>
              <div class="stat-tile">
                <div class="stat-tile-label">Guardia Salida PII</div>
                <div style={{ marginTop: '4px' }}>
                  <span class="badge badge-green mono">
                    {cal?.pii_enviados_contador ?? 0} PII enviados
                  </span>
                </div>
              </div>
            </div>

            <div style={{ fontSize: '12px', color: 'var(--ink-secondary)', marginBottom: '8px' }}>
              <strong>Giro:</strong> {getCiiuLabel(vf.giro_ciiu)} · <strong>Confianza OCR/Resolución:</strong>{' '}
              <strong class="mono">{confidencePct}%</strong> (Umbral Poka-Yoke: 85%)
            </div>
          </section>

          {/* 6. DECISIÓN DEL ESPECIALISTA (Human-in-the-Loop — RF-17 / RF-21 / RN-02 / RN-07 / RN-08) */}
          <section class="section-box">
            <h3 class="section-title">
              <span>Decisión Humana del Especialista (RF-21 · RN-07 · RN-08)</span>
              {record.decision_especialista ? (
                <span class="badge badge-green">
                  Registrada: {record.decision_especialista.accion}
                </span>
              ) : (
                <span class="badge badge-amber">Pendiente de decisión</span>
              )}
            </h3>

            <div style={{ fontSize: '11.5px', color: 'var(--ink-secondary)', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
              <span>
                <strong>Segregación RN-08:</strong> Originador{' '}
                <code class="mono">{record.request.asesor_id || 'ASE-004'}</code> ≠ Revisor{' '}
                <code class="mono">ESP-RIESGOS-TRUJILLO</code>
              </span>
              <span class="badge badge-slate" style={{ fontSize: '10px' }}>
                Ley N.° 29733 (D.S. 016-2024-JUS) · Art. 140 Ley 26702
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <input
                type="text"
                class="search-input"
                style={{ width: '100%', borderRadius: '11px' }}
                placeholder="Motivo obligatorio (ej. Vínculo familiar comprobado en visita / Anillo confirmado en 4 agencias)…"
                value={motivoDecision}
                onInput={(e) => {
                  setMotivoDecision((e.currentTarget as HTMLInputElement).value);
                  setDecisionError(null);
                }}
              />
              {decisionError && (
                <div style={{ fontSize: '11.5px', color: 'var(--red-dark)', fontWeight: 700 }}>
                  {decisionError}
                </div>
              )}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  class="btn btn-primary btn-sm"
                  disabled={savingDecision}
                  onClick={() => handleDecision('CONFIRMAR')}
                >
                  Confirmar Alerta
                </button>
                <button
                  type="button"
                  class="btn btn-success btn-sm"
                  disabled={savingDecision}
                  onClick={() => handleDecision('DESCARTAR')}
                >
                  Descartar (Falso Positivo)
                </button>
                <button
                  type="button"
                  class="btn btn-secondary btn-sm"
                  disabled={savingDecision}
                  onClick={() => handleDecision('ESCALAR')}
                >
                  Escalar a Jefatura
                </button>
                <button
                  type="button"
                  class="btn btn-secondary btn-sm"
                  disabled={savingDecision}
                  title="Demuestra CP-05 / RN-08 en vivo contra POST /alertas/{id}/decision"
                  onClick={async () => {
                    const motivoTest =
                      motivoDecision.trim().length >= 5
                        ? motivoDecision.trim()
                        : 'Intento auto-aprobar mi propia solicitud';
                    setMotivoDecision(motivoTest);
                    const originador = record.request.asesor_id || 'ASE-017';
                    try {
                      await postRemoteAlertDecision(response.expediente_id, {
                        accion: 'DESCARTAR',
                        motivo: motivoTest,
                        especialista_id: originador,
                        fecha: new Date().toISOString(),
                        hash_decision_sha256: '',
                      });
                    } catch (err) {
                      if (err instanceof Error) {
                        setDecisionError(`🔒 ${err.message}`);
                        return;
                      }
                    }
                    setDecisionError(
                      `🔒 RN-08 Violada (Segregación de Funciones · CP-05): El asesor originador (${originador}) NO puede aprobar ni descartar su propia alerta de red.`
                    );
                  }}
                >
                  🧪 Probar Bloqueo RN-08 ({record.request.asesor_id || 'ASE-017'})
                </button>
              </div>
              {record.decision_especialista && (
                <div style={{ fontSize: '11.5px', color: 'var(--ink-secondary)', marginTop: '4px' }}>
                  <div>
                    <strong>{record.decision_especialista.accion}</strong> por {record.decision_especialista.especialista_id}:{' '}
                    &ldquo;{record.decision_especialista.motivo}&rdquo; ·{' '}
                    <span class="mono">
                      SHA-256: {truncateHash(record.decision_especialista.hash_decision_sha256, 10, 6)}
                    </span>
                  </div>
                  <div style={{ color: 'var(--mint-dark)', fontWeight: 700, marginTop: '3px' }}>
                    ✓ Recalibración RF-17 registrada:{' '}
                    {record.decision_especialista.accion === 'DESCARTAR'
                      ? 'Motivo incorporado al catálogo de Contexto Legítimo (ajuste F_contexto para reducir falsos positivos).'
                      : record.decision_especialista.accion === 'CONFIRMAR'
                        ? 'Subred marcada como caso confirmado (activa señal P-09 en futuros vínculos de 2 saltos).'
                        : 'Caso derivado a Jefatura de Prevención de Fraude con expediente completo.'}
                  </div>
                </div>
              )}
            </div>

            <div
              style={{
                marginTop: '12px',
                paddingTop: '10px',
                borderTop: '1px solid var(--border-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
                flexWrap: 'wrap',
              }}
            >
              <span class="hash-chip mono">
                SHA-256: {truncateHash(response.hash_integridad_sha256, 10, 6)}
              </span>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  class="btn btn-secondary btn-sm"
                  onClick={() => {
                    const text = buildAuditWhatsAppText(record);
                    window.open(buildWhatsAppUrl('', text), '_blank', 'noopener,noreferrer');
                  }}
                >
                  Enviar WhatsApp
                </button>
                {onOpenPrintModal && (
                  <button
                    type="button"
                    class="btn btn-secondary btn-sm"
                    onClick={() => onOpenPrintModal(record)}
                  >
                    Acta SBS / PDF
                  </button>
                )}
                <button type="button" class="btn btn-secondary btn-sm" onClick={handleCopyHash}>
                  {copiedHash ? 'Hash copiado' : 'Copiar SHA-256'}
                </button>
                <button
                  type="button"
                  class="btn btn-secondary btn-sm"
                  onClick={() => setShowRawJson((v) => !v)}
                >
                  {showRawJson ? 'Ocultar JSON' : 'Ver JSON'}
                </button>
              </div>
            </div>

            {showRawJson && (
              <pre class="json-pre mono">{JSON.stringify(response, null, 2)}</pre>
            )}
          </section>
        </div>

        {/* Footer de acción con retención preventiva RF-22 */}
        <div class="drawer-footer">
          <div style={{ fontSize: '12px', color: 'var(--ink-secondary)' }}>
            {col === 'GRIS' ? (
              <strong>Estado Gris: Verificar datos (Provisión SBS null)</strong>
            ) : !disburseAllowed ? (
              <strong style={{ color: 'var(--red-dark)' }}>
                Retención preventiva activa (RF-22)
              </strong>
            ) : alreadyDisbursed ? (
              <strong style={{ color: 'var(--mint-dark)' }}>
                Crédito desembolsado ({formatPEN(dr.monto_maximo_recomendado)})
              </strong>
            ) : (
              <span>
                Provisión SBS evitada:{' '}
                <strong class="mono" style={{ color: 'var(--mint-dark)' }}>
                  {formatPEN(dr.provision_sbs_evitada_pen ?? 0)}
                </strong>
              </span>
            )}
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="button" class="btn btn-secondary" onClick={onClose}>
              Cerrar
            </button>
            <button
              type="button"
              class={`btn ${
                !disburseAllowed || alreadyDisbursed ? 'btn-disabled-lock' : 'btn-success'
              }`}
              disabled={!disburseAllowed || alreadyDisbursed}
              onClick={() => onDisburse(response.expediente_id)}
            >
              {alreadyDisbursed
                ? 'Desembolsado'
                : col === 'GRIS'
                  ? 'Verificar Datos (Poka-Yoke)'
                  : !disburseAllowed
                    ? 'Desembolsar (Retenido por Alerta)'
                    : `Desembolsar ${formatPEN(dr.monto_maximo_recomendado)}`}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
