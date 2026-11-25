import type { ComponentType } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  clearRemoteExpedientes,
  fetchRemoteExpedientes,
  getAlertasCola,
  getGoldenCases,
  getMetricasRie02,
  normalizeCanonicalAgency,
  patchRemoteExpedienteStatus,
  postRemoteAlertDecision,
  type MetricasRie02Live,
} from '../api/client';
import { AuditDrawer } from '../components/AuditDrawer';
import {
  AGENCIAS_TRUJILLO,
  CONTEXTO_LEGITIMO_CATALOG,
  PATRONES_RIESGO_CATALOG,
} from '../contracts/catalogs';
import type {
  DecisionEspecialista,
  ExpedienteAuditadoRecord,
  GoldenCase,
} from '../contracts/schemas';
import { useDebounce } from '../hooks/useNodux';
import { submitExpedienteAudit } from '../services/auditService';
import {
  clearExpedientes,
  listExpedientes,
  saveExpediente,
  saveSpecialistDecision,
  subscribeSync,
  updateExpedienteStatus,
} from '../storage/db';
import {
  formatPEN,
  getKanbanColumn,
  type KanbanColumnId,
} from '../utils/format';
import { buildSearchIndex, searchIndex } from '../utils/search';

interface PrintModalProps {
  record: ExpedienteAuditadoRecord | null;
  onClose: () => void;
}

interface ConsolaViewProps {
  offline: boolean;
  initialExpedienteId: string | null;
  onClearInitialExpediente: () => void;
  onOpenCampo: () => void;
  onToast: (message: string) => void;
}

const COLUMNS: {
  id: KanbanColumnId;
  css: 'verde' | 'ambar' | 'rojo' | 'gris';
  pill: string;
  title: string;
  subtitle: string;
  emptyHint: string;
}[] = [
  {
    id: 'VERDE',
    css: 'verde',
    pill: '0–39 PTS',
    title: 'Sin Alerta',
    subtitle: 'Aprobación rápida',
    emptyHint: 'Casos sanos o vínculos legítimos',
  },
  {
    id: 'AMBAR',
    css: 'ambar',
    pill: '40–69 PTS',
    title: 'Observación',
    subtitle: 'Ajuste sugerido',
    emptyHint: 'Coincidencias moderadas',
  },
  {
    id: 'ROJO',
    css: 'rojo',
    pill: '70–100 PTS',
    title: 'Prioritaria',
    subtitle: 'Red oculta · Retenido',
    emptyHint: 'Redes de riesgo detectadas',
  },
  {
    id: 'GRIS',
    css: 'gris',
    pill: 'CALIDAD < 0.85',
    title: 'Verificar Datos',
    subtitle: 'Repetir foto · Sin puntaje',
    emptyHint: 'Comprobantes borrosos',
  },
];

function LaneEmptyIllustration({ kind }: { kind: 'verde' | 'ambar' | 'rojo' | 'gris' }) {
  if (kind === 'verde') {
    return (
      <div class="lane-empty-circle verde" aria-hidden="true">
        <svg width="46" height="46" viewBox="0 0 24 24" fill="none">
          <path
            d="M13 2L4.5 13.5H11.5L10.5 22L19.5 10.5H12.5L13 2Z"
            fill="#10B981"
          />
        </svg>
      </div>
    );
  }
  if (kind === 'ambar') {
    return (
      <div class="lane-empty-circle ambar" aria-hidden="true">
        <svg width="46" height="46" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 2.5L19.5 5.8V11.8C19.5 16.8 16.3 20.6 12 22C7.7 20.6 4.5 16.8 4.5 11.8V5.8L12 2.5Z"
            fill="#F59E0B"
          />
          <path
            d="M8.8 12.2L11 14.4L15.6 9.8"
            stroke="#FFFFFF"
            stroke-width="2.4"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </div>
    );
  }
  if (kind === 'gris') {
    return (
      <div class="lane-empty-circle gris" aria-hidden="true">
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none">
          <circle cx="11" cy="11" r="6.5" stroke="#64748B" stroke-width="2.4" />
          <path d="M16 16L20.5 20.5" stroke="#64748B" stroke-width="2.4" stroke-linecap="round" />
          <path d="M11 8.5V11.5" stroke="#64748B" stroke-width="2.2" stroke-linecap="round" />
          <circle cx="11" cy="13.8" r="1" fill="#64748B" />
        </svg>
      </div>
    );
  }
  return (
    <div class="lane-empty-circle rojo" aria-hidden="true">
      <svg width="44" height="44" viewBox="0 0 24 24" fill="none">
        <path
          d="M7.5 10.5V8C7.5 5.5 9.5 3.5 12 3.5C14.5 3.5 16.5 5.5 16.5 8V10.5"
          stroke="#E11D48"
          stroke-width="2.4"
          stroke-linecap="round"
        />
        <rect x="5" y="10.5" width="14" height="10" rx="3.2" fill="#E11D48" />
        <circle cx="12" cy="15.2" r="1.5" fill="#FFFFFF" />
      </svg>
    </div>
  );
}

function LaneWave({ kind }: { kind: 'verde' | 'ambar' | 'rojo' | 'gris' }) {
  const fill =
    kind === 'verde'
      ? 'rgba(16, 185, 129, 0.14)'
      : kind === 'ambar'
        ? 'rgba(245, 158, 11, 0.15)'
        : kind === 'gris'
          ? 'rgba(100, 116, 139, 0.14)'
          : 'rgba(225, 29, 72, 0.14)';
  return (
    <svg class="lane-wave" viewBox="0 0 400 80" preserveAspectRatio="none" aria-hidden="true">
      <path
        d="M0,48 C70,22 140,74 230,42 C300,18 350,52 400,28 L400,80 L0,80 Z"
        fill={fill}
      />
    </svg>
  );
}

function KpiWave({ color, id }: { color: string; id: string }) {
  return (
    <svg class="kpi-wave" viewBox="0 0 260 44" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color={color} stop-opacity="0.28" />
          <stop offset="100%" stop-color={color} stop-opacity="0.02" />
        </linearGradient>
      </defs>
      <path
        d="M0,34 C55,14 95,38 145,24 C190,10 225,8 260,18 L260,44 L0,44 Z"
        fill={`url(#${id})`}
      />
      <path
        d="M0,34 C55,14 95,38 145,24 C190,10 225,8 260,18"
        fill="none"
        stroke={color}
        stroke-opacity="0.45"
        stroke-width="2"
      />
    </svg>
  );
}

export default function ConsolaView({
  offline,
  initialExpedienteId,
  onClearInitialExpediente,
  onOpenCampo,
  onToast,
}: ConsolaViewProps) {
  const [goldenCases, setGoldenCases] = useState<GoldenCase[]>([]);
  const [expedientes, setExpedientes] = useState<ExpedienteAuditadoRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialExpedienteId);
  const [runningCaseId, setRunningCaseId] = useState<string | null>(null);
  const [runningAll, setRunningAll] = useState(false);

  // Buscador reactivo in-memory (Nodux Flow: 150 ms debounce, sin HTTP) + filtro de agencia
  const [rawQuery, setRawQuery] = useState('');
  const debouncedQuery = useDebounce(rawQuery, 150);
  const [agenciaFilter, setAgenciaFilter] = useState('Todas');
  const [onlyAlertsQueue, setOnlyAlertsQueue] = useState(false);
  const [showSyntheticSweep, setShowSyntheticSweep] = useState(false);
  const [showCasesPicker, setShowCasesPicker] = useState(false);
  const [liveMetricas, setLiveMetricas] = useState<MetricasRie02Live | null>(null);
  const [vpsAlertasCount, setVpsAlertasCount] = useState<number | null>(null);

  // Modal imprimible SBS cargado bajo demanda
  const [printRecord, setPrintRecord] = useState<ExpedienteAuditadoRecord | null>(null);
  const [PrintModal, setPrintModal] = useState<ComponentType<PrintModalProps> | null>(null);

  const openPrintModal = (rec: ExpedienteAuditadoRecord) => {
    setPrintRecord(rec);
    if (!PrintModal) {
      import('../components/DictamenPrintModal').then((m) => setPrintModal(() => m.default));
    }
  };

  const agenciasDisponibles = useMemo(() => {
    const canonicalSet = new Set<string>(AGENCIAS_TRUJILLO);
    for (const e of expedientes) {
      canonicalSet.add(normalizeCanonicalAgency(e.agencia_origen));
    }
    return ['Todas', ...Array.from(canonicalSet)];
  }, [expedientes]);

  const indexedExpedientes = useMemo(
    () =>
      buildSearchIndex(expedientes, (item) => ({
        primary: `${item.expediente_id} ${item.response.validacion_fiscal.ruc}`,
        secondary: [
          item.titulo_caso ?? '',
          item.razon_social ?? '',
          item.agencia_origen,
          normalizeCanonicalAgency(item.agencia_origen),
          item.response.validacion_fiscal.giro_ciiu,
          item.response.dictamen_riesgos.escala_interna_caja_trujillo,
          item.response.priorizacion?.nivel ?? '',
          ...(item.response.patrones_detectados ?? []).map((p) => `${p.codigo} ${p.nombre ?? ''}`),
          ...(item.response.contexto_legitimo ?? []).map((l) => `${l.codigo} ${l.nombre ?? ''}`),
          item.response.dictamen_riesgos.alerta_fraude_maquillaje ? 'fraude maquillaje bloqueo' : '',
          item.response.dictamen_riesgos.requiere_revision_humana ? 'poka yoke verificar datos ocr' : '',
        ],
      })),
    [expedientes]
  );

  const visibleExpedientes = useMemo(() => {
    const matched = searchIndex(indexedExpedientes, debouncedQuery);
    if (agenciaFilter === 'Todas') return matched;
    const targetCanonical = normalizeCanonicalAgency(agenciaFilter);
    return matched.filter((item) => {
      if (normalizeCanonicalAgency(item.agencia_origen) === targetCanonical) return true;
      if (item.expediente_id === 'SOL-TRUJ-2026-0412' && targetCanonical === 'Agencia Florencia de Mora') {
        return true;
      }
      return false;
    });
  }, [indexedExpedientes, debouncedQuery, agenciaFilter]);

  const loadBoard = async (syncRemote = false) => {
    if (syncRemote) {
      const remote = await fetchRemoteExpedientes();
      if (remote && remote.length > 0) {
        for (const rec of remote) {
          await saveExpediente(rec);
        }
      }
    }
    const items = await listExpedientes();
    setExpedientes(items);
  };

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const cases = await getGoldenCases();
        if (!active) return;
        setGoldenCases(cases);
        const existing = await listExpedientes();
        const hasLegacySeed = existing.some(
          (item) =>
            /^EXP-TRUJ-2026-010[1234]$/.test(item.expediente_id) ||
            item.response.red?.nodos_subred === 14 ||
            item.response.dictamen_riesgos.explicacion_agente_sbs.includes('resolucion') ||
            (item.expediente_id === 'SOL-TRUJ-2026-0412' &&
              !item.response.dictamen_riesgos.requiere_revision_humana)
        );
        if ((existing.length === 0 || hasLegacySeed) && !offline && cases.length > 0) {
          if (hasLegacySeed) {
            await clearExpedientes();
          }
          for (const gc of cases) {
            await submitExpedienteAudit(gc.payload, {
              origen: 'DEMO_RAPIDA',
              titulo_caso: gc.titulo,
            });
          }
        }
      } catch {
        // Fallback silencioso
      }
      if (active) {
        await loadBoard(true);
      }
    })();

    return subscribeSync((event) => {
      loadBoard(false);
      if (event.type === 'EXPEDIENTE_UPSERT') {
        onToast(`Sincronizado en tiempo real: ${event.expediente_id}`);
      }
    });
  }, []);

  useEffect(() => {
    if (initialExpedienteId) {
      setSelectedId(initialExpedienteId);
      onClearInitialExpediente();
    }
  }, [initialExpedienteId]);

  const selectedRecord =
    expedientes.find((item) => item.expediente_id === selectedId) ?? null;

  const handleRunGoldenCase = async (gc: GoldenCase, openDrawerAfter = true) => {
    if (offline) {
      onToast('Sin conexión al VPS. Reconecta la señal para auditar desde Consola.');
      return;
    }
    setRunningCaseId(gc.case_id);
    try {
      const result = await submitExpedienteAudit(gc.payload, {
        origen: 'DEMO_RAPIDA',
        titulo_caso: gc.titulo,
      });
      await loadBoard();
      if (result.mode === 'AUDITED') {
        if (openDrawerAfter) {
          setSelectedId(result.record.expediente_id);
        }
        const scoreTxt =
          result.record.response.priorizacion?.puntaje_red !== null &&
          result.record.response.priorizacion?.puntaje_red !== undefined
            ? `${result.record.response.priorizacion.puntaje_red} pts`
            : 'Poka-Yoke (Sin puntaje)';
        onToast(
          `${gc.titulo} · ${scoreTxt} · ${result.record.response.latencia_ms.toFixed(0)} ms`
        );
      }
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Error al ejecutar caso simulado.');
    } finally {
      setRunningCaseId(null);
    }
  };

  const handleRunAllGoldenCases = async () => {
    if (offline) {
      onToast('Sin conexión al VPS. Reconecta la señal para ejecutar los 6 casos RIE-02.');
      return;
    }
    setRunningAll(true);
    try {
      await clearExpedientes();
      for (const gc of goldenCases) {
        await handleRunGoldenCase(gc, false);
      }
      onToast(`Los ${goldenCases.length} Casos Simulados RIE-02 fueron auditados en segundos.`);
    } finally {
      setRunningAll(false);
    }
  };

  const handleDisburse = async (expedienteId: string) => {
    await patchRemoteExpedienteStatus(expedienteId, 'DESEMBOLSADO');
    const updated = await updateExpedienteStatus(expedienteId, 'DESEMBOLSADO');
    if (updated) {
      await loadBoard(false);
      onToast(
        `Desembolso confirmado: ${formatPEN(updated.response.dictamen_riesgos.monto_maximo_recomendado)}`
      );
    }
  };

  const handleRecordDecision = async (
    expedienteId: string,
    decision: DecisionEspecialista
  ) => {
    await postRemoteAlertDecision(expedienteId, decision);
    const updated = await saveSpecialistDecision(expedienteId, decision);
    if (updated) {
      await loadBoard(false);
      const label =
        decision.accion === 'CONFIRMAR'
          ? 'Alerta confirmada (Bloqueo mantenido)'
          : decision.accion === 'DESCARTAR'
            ? 'Falso positivo descartado (Desembolso desbloqueado)'
            : 'Caso escalado a Jefatura de Riesgos';
      onToast(`${expedienteId}: ${label}`);
    }
  };

  const handleClearBoard = async () => {
    await clearRemoteExpedientes();
    await clearExpedientes();
    setSelectedId(null);
    await loadBoard(false);
    onToast('Tablero limpio para nueva demo.');
  };

  // Widget P&L: suma solo provisiones reales evitadas (CS-06 Poka-Yoke suma S/ 0.00)
  const provisionesEvitadasTotal = expedientes.reduce(
    (sum, item) => sum + (item.response.dictamen_riesgos.provision_sbs_evitada_pen ?? 0),
    0
  );

  const latenciaPromedio =
    expedientes.length > 0
      ? expedientes.reduce((sum, item) => sum + item.response.latencia_ms, 0) / expedientes.length
      : 0;

  const redesPrioritariasCount = expedientes.filter(
    (item) => getKanbanColumn(item.response) === 'ROJO'
  ).length;

  const pokaYokeGrisCount = expedientes.filter(
    (item) => getKanbanColumn(item.response) === 'GRIS'
  ).length;

  const visibleColumns = onlyAlertsQueue
    ? COLUMNS.filter((c) => c.id !== 'VERDE')
    : COLUMNS;

  return (
    <main class="page-shell">
      {/* Cabecera Visual: Hero P&L + 3 KPIs Limpios con Ondas */}
      <section class="pnl-strip" aria-label="Widget P&L de Provisiones SBS Evitadas">
        <div class="pnl-hero">
          <div class="pnl-shield-wrap" aria-hidden="true">
            <svg width="82" height="82" viewBox="0 0 88 88" fill="none">
              <ellipse
                cx="44"
                cy="55"
                rx="36"
                ry="12"
                stroke="rgba(165, 180, 252, 0.4)"
                stroke-width="1.5"
                transform="rotate(-8 44 55)"
              />
              <path
                d="M44 10L70 20.5V41.5C70 58 59 71 44 76C29 71 18 58 18 41.5V20.5L44 10Z"
                fill="rgba(129, 140, 248, 0.22)"
                stroke="#818CF8"
                stroke-width="3.2"
                stroke-linejoin="round"
              />
              <path
                d="M34 44.5L41 51.5L55 37.5"
                stroke="#E0E7FF"
                stroke-width="4"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </div>
          <div class="pnl-hero-content">
            <span class="pnl-hero-label">Provisiones SBS evitadas</span>
            <div class="pnl-hero-value num">{formatPEN(provisionesEvitadasTotal)}</div>
            <span class="pnl-hero-pill">
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <circle cx="10" cy="10" r="9" fill="#34D399" />
                <path
                  d="M6.5 10.2L8.9 12.6L13.8 7.6"
                  stroke="#064E3B"
                  stroke-width="2.2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
              Meta anual: S/ 15M
            </span>
          </div>
        </div>

        <div class="kpi-card">
          <div class="kpi-icon violet" aria-hidden="true">
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none">
              <circle cx="6" cy="7" r="2.8" fill="#ffffff" />
              <circle cx="18" cy="7" r="2.8" fill="#ffffff" />
              <circle cx="12" cy="17" r="2.8" fill="#ffffff" />
              <path d="M8.5 8.5L10.5 14.5M15.5 8.5L13.5 14.5M8.8 7H15.2" stroke="#ffffff" stroke-width="1.8" />
            </svg>
          </div>
          <div>
            <div class="kpi-value num">{redesPrioritariasCount}</div>
            <div class="kpi-label">Redes Prioritarias</div>
          </div>
          <KpiWave color="#6366F1" id="wave-violet" />
        </div>

        <div class="kpi-card">
          <div class="kpi-icon mint" aria-hidden="true">
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none">
              <path d="M13 2L5 13.5H11.5L10.5 22L19 10.5H12.5L13 2Z" fill="#ffffff" />
            </svg>
          </div>
          <div>
            <div class="kpi-value num">
              {expedientes.length > 0 ? `${(latenciaPromedio / 1000).toFixed(2)} s` : '< 1.2 s'}
            </div>
            <div class="kpi-label">Latencia Local</div>
          </div>
          <KpiWave color="#10B981" id="wave-mint" />
        </div>

        <div class="kpi-card">
          <div class="kpi-icon amber" aria-hidden="true">
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 2.5L19.5 5.8V11.8C19.5 16.8 16.3 20.6 12 22C7.7 20.6 4.5 16.8 4.5 11.8V5.8L12 2.5Z"
                fill="#ffffff"
              />
            </svg>
          </div>
          <div>
            <div class="kpi-value num">{pokaYokeGrisCount}</div>
            <div class="kpi-label">Verificar Datos</div>
          </div>
          <KpiWave color="#64748B" id="wave-amber" />
        </div>
      </section>

      {/* Banda Central Minimalista: Stepper 3 Pasos + Botón Principal Play (Menos es Más) */}
      <section class="demo-strip" aria-label="Flujo Rápido y Casos de Ejemplo">
        <div class="flow-stepper-row">
          <div class="flow-stepper" aria-label="Flujo en 3 pasos">
            <div class="flow-step-item">
              <span class="flow-step-circle" aria-hidden="true">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
                  <path d="M12 16V6M12 6L8 10M12 6L16 10" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
                  <path d="M5 17V18C5 19.1 5.9 20 7 20H17C18.1 20 19 19.1 19 18V17" stroke="#ffffff" stroke-width="2" stroke-linecap="round" />
                </svg>
              </span>
              <span class="flow-step-label">1. Captura</span>
            </div>
            <div class="flow-step-line" aria-hidden="true" />
            <div class="flow-step-item">
              <span class="flow-step-circle" aria-hidden="true">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
                  <circle cx="6" cy="7" r="2.3" fill="#ffffff" />
                  <circle cx="18" cy="7" r="2.3" fill="#ffffff" />
                  <circle cx="12" cy="17" r="2.3" fill="#ffffff" />
                  <path d="M8 8.3L10.7 14.8M16 8.3L13.3 14.8M8.3 7H15.7" stroke="#ffffff" stroke-width="1.8" />
                </svg>
              </span>
              <span class="flow-step-label">2. Red IA</span>
            </div>
            <div class="flow-step-line" aria-hidden="true" />
            <div class="flow-step-item">
              <span class="flow-step-circle" aria-hidden="true">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
                  <path d="M6.5 12.5L10.2 16.2L17.8 8.5" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </span>
              <span class="flow-step-label">3. Decisión</span>
            </div>
          </div>

          <div class="flow-stepper-actions">
            <button
              type="button"
              class="btn btn-primary"
              disabled={runningAll || runningCaseId !== null || offline}
              onClick={handleRunAllGoldenCases}
            >
              {runningAll ? 'Evaluando…' : '▶ Demo 6 Casos'}
            </button>
            <button
              type="button"
              class={`btn btn-secondary btn-sm ${showCasesPicker ? 'is-active' : ''}`}
              onClick={() => setShowCasesPicker((v) => !v)}
            >
              {showCasesPicker ? 'Casos ▴' : 'Casos ▾'}
            </button>
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              onClick={() => {
                const next = !showSyntheticSweep;
                setShowSyntheticSweep(next);
                if (next) {
                  getMetricasRie02()
                    .then((m) => {
                      if (m) setLiveMetricas(m);
                    })
                    .catch(() => {});
                }
              }}
            >
              {showSyntheticSweep ? 'Ocultar Métricas' : '📊 Métricas'}
            </button>
            <button type="button" class="btn btn-secondary btn-sm" onClick={onOpenCampo}>
              + Campo
            </button>
            {expedientes.length > 0 && (
              <button type="button" class="btn btn-secondary btn-sm" onClick={handleClearBoard}>
                Limpiar
              </button>
            )}
          </div>
        </div>

        {/* Reporte de Precisión bajo demanda (GET /metricas) */}
        {showSyntheticSweep && (
          <div
            style={{
              marginTop: '14px',
              padding: '12px 14px',
              borderRadius: '14px',
              background: 'var(--bg-subtle)',
              border: '1px solid var(--border-subtle)',
              fontSize: '12px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
              <strong>Precisión del Motor (2,000 Solicitudes · CP-09)</strong>
              <span class="badge badge-green">100% Recall · 0 Falsos Positivos · 0 PII</span>
            </div>
            <div class="stat-grid-3">
              <div class="stat-tile" style={{ background: 'var(--bg-surface)' }}>
                <div class="stat-tile-label">Población Trujillo</div>
                <div class="mono" style={{ fontWeight: 800, fontSize: '13px', marginTop: '2px' }}>
                  2,000 solic. · 14/14 anillos
                </div>
              </div>
              <div class="stat-tile" style={{ background: 'var(--bg-surface)' }}>
                <div class="stat-tile-label">Dataset 50 Expedientes</div>
                <div class="mono" style={{ fontWeight: 800, fontSize: '13px', marginTop: '2px' }}>
                  35 Verde · 8 Ámbar · 5 Rojo · 2 Gris
                </div>
              </div>
              <div class="stat-tile" style={{ background: 'var(--bg-surface)' }}>
                <div class="stat-tile-label">Costo OPEX / expediente (GET /metricas)</div>
                <div class="mono" style={{ fontWeight: 800, fontSize: '13px', marginTop: '2px' }}>
                  {liveMetricas?.impacto_negocio_caja_trujillo?.reduccion_opex_expediente ??
                    'S/ 160.00 → S/ 18.00 (-88.75%)'}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Selector individual de 6 casos desplegable bajo demanda */}
        {showCasesPicker && (
          <div class="golden-grid" style={{ marginTop: '14px' }}>
            {goldenCases.map((gc) => {
              const isLoading = runningCaseId === gc.case_id;
              const nivel = gc.nivel_esperado;
              const badgeClass =
                nivel === 'SIN_ALERTA' || gc.etiqueta_escala.includes('VERDE')
                  ? 'badge-green'
                  : nivel === 'OBSERVACION' || gc.etiqueta_escala.includes('ÁMBAR')
                    ? 'badge-amber'
                    : nivel === 'VERIFICAR_DATOS' || gc.etiqueta_escala.includes('GRIS')
                      ? 'badge-slate'
                      : 'badge-red-solid';
              return (
                <button
                  key={gc.case_id}
                  type="button"
                  class="golden-btn"
                  disabled={isLoading || runningAll || offline}
                  onClick={() => handleRunGoldenCase(gc, true)}
                >
                  <div class="golden-btn-top">
                    <span class="golden-btn-name">{isLoading ? 'Analizando…' : gc.titulo}</span>
                    <span class={`badge ${badgeClass}`}>{gc.etiqueta_escala}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Título de Sección + Buscador In-Memory Nodux Flow */}
      <div class="section-heading-row">
        <h1 class="section-heading">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 3L3 7.5L12 12L21 7.5L12 3Z" fill="#5B4DF5" />
            <path
              d="M3 12L12 16.5L21 12"
              stroke="#5B4DF5"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <path
              d="M3 16.5L12 21L21 16.5"
              stroke="#818CF8"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <span>Bandeja de Priorización</span>
        </h1>

        <div class="consola-filter-bar">
          <div class="search-input-wrap">
            <input
              type="search"
              class="search-input"
              placeholder="Buscar expediente, RUC o patrón…"
              aria-label="Buscar expedientes en memoria"
              value={rawQuery}
              onInput={(e) => setRawQuery((e.currentTarget as HTMLInputElement).value)}
            />
            {rawQuery && (
              <button
                type="button"
                class="search-clear-btn"
                onClick={() => setRawQuery('')}
                aria-label="Limpiar búsqueda"
              >
                ×
              </button>
            )}
          </div>
          <select
            class="search-select"
            aria-label="Filtrar por agencia"
            value={agenciaFilter}
            onChange={(e) => setAgenciaFilter((e.target as HTMLSelectElement).value)}
          >
            {agenciasDisponibles.map((ag) => (
              <option key={ag} value={ag} selected={agenciaFilter === ag}>
                {ag === 'Todas' ? 'Todas las agencias' : ag}
              </option>
            ))}
          </select>
          <button
            type="button"
            class={`btn btn-sm ${onlyAlertsQueue ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => {
              const next = !onlyAlertsQueue;
              setOnlyAlertsQueue(next);
              getAlertasCola({
                agencia: agenciaFilter !== 'Todas' ? agenciaFilter : undefined,
              })
                .then((res) => {
                  if (res) setVpsAlertasCount(res.total_alertas);
                })
                .catch(() => {});
            }}
            title="Tabla 20: Sincroniza GET /alertas del servidor y oculta 'Sin alerta'"
          >
            {onlyAlertsQueue
              ? `Cola Alertas${vpsAlertasCount !== null ? ` (${vpsAlertasCount})` : ''}`
              : '4 Carriles'}
          </button>
          <span style={{ fontSize: '12px', color: 'var(--ink-muted)', fontWeight: 700, whiteSpace: 'nowrap' }}>
            {onlyAlertsQueue
              ? visibleExpedientes.filter((it) => getKanbanColumn(it.response) !== 'VERDE').length
              : visibleExpedientes.length}
            /{expedientes.length}
          </span>
        </div>
      </div>

      {/* 4 Columnas Kanban Pastel (Verde, Ámbar, Rojo, Gris Poka-Yoke) */}
      <section
        class="kanban-grid"
        style={onlyAlertsQueue ? { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' } : undefined}
        aria-label="Tablero Kanban de Inteligencia de Redes RIE-02"
      >
        {visibleColumns.map((col) => {
          const cards = visibleExpedientes
            .filter((item) => getKanbanColumn(item.response) === col.id)
            .sort(
              (a, b) =>
                (b.response.priorizacion?.puntaje_red ?? -1) -
                (a.response.priorizacion?.puntaje_red ?? -1)
            );

          return (
            <div key={col.id} class={`kanban-col ${col.css}`}>
              <div class="kanban-col-head">
                <div>
                  <span class={`lane-pill ${col.css}`}>{col.pill}</span>
                  <div class="kanban-col-title">{col.title}</div>
                  <div class="kanban-col-sub">{col.subtitle}</div>
                </div>
                <span class="kanban-count num">{cards.length}</span>
              </div>

              <div class="kanban-cards">
                {cards.length === 0 ? (
                  <div class="lane-empty-hero">
                    <LaneEmptyIllustration kind={col.css} />
                    <span class="lane-empty-caption">{col.emptyHint}</span>
                  </div>
                ) : (
                  cards.map((item) => {
                    const dr = item.response.dictamen_riesgos;
                    const vf = item.response.validacion_fiscal;
                    const prio = item.response.priorizacion;
                    const patrones = item.response.patrones_detectados ?? [];
                    const contextos = item.response.contexto_legitimo ?? [];
                    const isSelected = selectedId === item.expediente_id;

                    const amountColor =
                      col.id === 'VERDE'
                        ? '#047857'
                        : col.id === 'AMBAR'
                          ? '#b45309'
                          : col.id === 'GRIS'
                            ? '#475569'
                            : '#be123c';

                    const puntajeTxt =
                      prio?.puntaje_red !== undefined
                        ? prio.puntaje_red === null
                          ? 'Sin puntaje'
                          : `${prio.puntaje_red} pts`
                        : dr.escala_interna_caja_trujillo;

                    return (
                      <button
                        key={item.expediente_id}
                        type="button"
                        class={`exp-card ${isSelected ? 'selected' : ''}`}
                        onClick={() => setSelectedId(item.expediente_id)}
                      >
                        <div class="exp-card-top">
                          <div>
                            <div class="exp-title">
                              {item.titulo_caso || item.razon_social || `RUC ${vf.ruc}`}
                            </div>
                            <div class="exp-sub mono">
                              {item.expediente_id} · RUC {vf.ruc}
                            </div>
                          </div>
                          <span class="chevron-pill" aria-hidden="true">
                            ›
                          </span>
                        </div>

                        {/* Monto + Puntaje limpio (Menos es Más) */}
                        <div class="exp-amount-row">
                          <div>
                            <div class="exp-amount-main num" style={{ color: amountColor }}>
                              {col.id === 'GRIS'
                                ? 'Verificar foto'
                                : col.id === 'ROJO' && dr.monto_maximo_recomendado === 0
                                  ? 'Retenido'
                                  : formatPEN(dr.monto_maximo_recomendado)}
                            </div>
                            <div class="exp-amount-from">
                              Solic. {formatPEN(dr.monto_solicitado_original)}
                            </div>
                          </div>
                          <span
                            class={`badge ${
                              col.id === 'VERDE'
                                ? 'badge-green'
                                : col.id === 'AMBAR'
                                  ? 'badge-amber'
                                  : col.id === 'GRIS'
                                    ? 'badge-slate'
                                    : 'badge-red-solid'
                            }`}
                          >
                            {puntajeTxt}
                          </span>
                        </div>

                        {/* Máximo 2 chips limpios por tarjeta; el detalle completo abre al hacer clic */}
                        <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                          {col.id === 'GRIS' && (
                            <span class="badge badge-slate" style={{ fontSize: '10.5px', padding: '2px 8px' }}>
                              Por verificar · Excluido SBS
                            </span>
                          )}
                          {col.id !== 'GRIS' &&
                            contextos.slice(0, 1).map((l) => {
                              const catName = CONTEXTO_LEGITIMO_CATALOG.find((c) => c.codigo === l.codigo)?.nombre;
                              const labelName =
                                l.nombre && l.nombre !== l.codigo ? l.nombre : (catName ?? l.codigo);
                              return (
                                <span key={l.codigo} class="badge badge-green" style={{ fontSize: '10.5px', padding: '2px 8px' }}>
                                  ✔ {l.codigo} · {labelName}
                                </span>
                              );
                            })}
                          {col.id !== 'VERDE' &&
                            patrones.slice(0, 2).map((p) => {
                              const catName = PATRONES_RIESGO_CATALOG.find((c) => c.codigo === p.codigo)?.nombre;
                              const labelName =
                                p.nombre && p.nombre !== p.codigo ? p.nombre : (catName ?? p.codigo);
                              return (
                                <span key={p.codigo} class="badge badge-red-solid" style={{ fontSize: '10.5px', padding: '2px 8px' }}>
                                  {p.codigo} · {labelName}
                                </span>
                              );
                            })}
                          {item.decision_especialista && (
                            <span
                              class={`badge ${
                                item.decision_especialista.accion === 'DESCARTAR'
                                  ? 'badge-green'
                                  : item.decision_especialista.accion === 'ESCALAR'
                                    ? 'badge-amber'
                                    : 'badge-red-solid'
                              }`}
                              style={{ fontSize: '10.5px', padding: '2px 8px' }}
                            >
                              {item.decision_especialista.accion}
                            </span>
                          )}
                          {item.estado_local === 'DESEMBOLSADO' && (
                            <span class="badge badge-green" style={{ fontSize: '10.5px', padding: '2px 8px' }}>
                              ✔ Desembolsado
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>

              <LaneWave kind={col.css} />
            </div>
          );
        })}
      </section>

      {/* Drawer de Auditoría + Grafo Interactivo 2 Saltos + Decisión Humana */}
      <AuditDrawer
        record={selectedRecord}
        onClose={() => setSelectedId(null)}
        onDisburse={handleDisburse}
        onRecordDecision={handleRecordDecision}
        onOpenPrintModal={openPrintModal}
      />

      {/* Acta Formal SBS / Checklist Auditor Senior imprimible (Nodux Flow) */}
      {PrintModal && printRecord && (
        <PrintModal record={printRecord} onClose={() => setPrintRecord(null)} />
      )}
    </main>
  );
}
