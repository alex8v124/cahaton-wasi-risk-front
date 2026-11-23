import { useEffect, useMemo, useState } from 'preact/hooks';
import type { AuditarExpedienteRequest, ExpedienteAuditadoRecord } from '../contracts/schemas';
import { submitExpedienteAudit } from '../services/auditService';
import { formatPEN, getKanbanColumn } from '../utils/format';
import {
  BATCH_CSV_TEMPLATE,
  buildAuditBatchCsv,
  downloadTextFile,
  getSavedWebhookUrl,
  parseBatchExpedientesCsv,
  saveWebhookUrl,
  triggerCoreWebhook,
} from '../utils/webhook';

type ExecTab = 'pnl' | 'agencias' | 'ingestor' | 'webhook' | 'qr';

interface ExecutiveModalProps {
  open: boolean;
  expedientes: ExpedienteAuditadoRecord[];
  onClose: () => void;
  onClearBoard: () => Promise<void>;
  onBoardChanged: () => Promise<void>;
  onToast: (msg: string) => void;
}

export default function ExecutiveModal({
  open,
  expedientes,
  onClose,
  onClearBoard,
  onBoardChanged,
  onToast,
}: ExecutiveModalProps) {
  const [tab, setTab] = useState<ExecTab>('pnl');
  const [webhookUrl, setWebhookUrl] = useState<string>(() => getSavedWebhookUrl());
  const [webhookStatus, setWebhookStatus] = useState<{ ok: boolean | null; message: string } | null>(null);
  const [copiedJson, setCopiedJson] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // Ingestor CSV
  const [parsedBatch, setParsedBatch] = useState<AuditarExpedienteRequest[] | null>(null);
  const [uploadMsg, setUploadMsg] = useState<{ error?: string; success?: string } | null>(null);
  const [runningBatch, setRunningBatch] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const metrics = useMemo(() => {
    let provisionEvitada = 0;
    let solicitado = 0;
    let recomendado = 0;
    let fraudes = 0;
    let pokaYoke = 0;
    let fastTrack = 0;
    let recortes = 0;

    for (const item of expedientes) {
      const dr = item.response.dictamen_riesgos;
      provisionEvitada += dr.provision_sbs_evitada_pen ?? 0;
      solicitado += dr.monto_solicitado_original;
      recomendado += dr.monto_maximo_recomendado;
      if (dr.alerta_fraude_maquillaje) fraudes++;
      if (dr.requiere_revision_humana) pokaYoke++;
      const col = getKanbanColumn(item.response);
      if (col === 'VERDE') fastTrack++;
      else if (col === 'AMBAR') recortes++;
    }

    return {
      provisionEvitada,
      solicitado,
      recomendado,
      protegido: Math.max(0, solicitado - recomendado),
      fraudes,
      pokaYoke,
      fastTrack,
      recortes,
    };
  }, [expedientes]);

  const agencyStats = useMemo(() => {
    const map = new Map<
      string,
      {
        agencia: string;
        total: number;
        aprobados: number;
        bloqueados: number;
        protegido: number;
        provisionEvitada: number;
        latencySum: number;
      }
    >();

    for (const item of expedientes) {
      const key = item.agencia_origen || 'Agencia Principal';
      const cur = map.get(key) ?? {
        agencia: key,
        total: 0,
        aprobados: 0,
        bloqueados: 0,
        protegido: 0,
        provisionEvitada: 0,
        latencySum: 0,
      };
      const dr = item.response.dictamen_riesgos;
      cur.total += 1;
      if (dr.alerta_fraude_maquillaje || dr.requiere_revision_humana) cur.bloqueados += 1;
      else cur.aprobados += 1;
      cur.protegido += Math.max(0, dr.monto_solicitado_original - dr.monto_maximo_recomendado);
      cur.provisionEvitada += dr.provision_sbs_evitada_pen ?? 0;
      cur.latencySum += item.response.latencia_ms;
      map.set(key, cur);
    }

    return Array.from(map.values()).sort((a, b) => b.provisionEvitada - a.provisionEvitada);
  }, [expedientes]);

  const topFlags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of expedientes) {
      for (const flag of item.response.dictamen_riesgos.banderas_fraude_detectadas) {
        counts.set(flag, (counts.get(flag) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [expedientes]);

  const campoQrUrl = useMemo(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://wasi-risk.vercel.app';
    return `${origin}/campo`;
  }, []);

  if (!open) return null;

  const handleSaveWebhook = (val: string) => {
    setWebhookUrl(val);
    saveWebhookUrl(val);
  };

  const handleTestWebhook = async () => {
    if (!webhookUrl || !webhookUrl.startsWith('http')) {
      setWebhookStatus({ ok: false, message: 'Ingresa una URL válida (http/https).' });
      return;
    }
    if (webhookUrl.includes('docs.google.com/spreadsheets/')) {
      setWebhookStatus({
        ok: false,
        message:
          'Has pegado el enlace web de Google Sheets (error 405). Usa una URL de Apps Script (/exec), Make o Webhook.site.',
      });
      return;
    }
    setWebhookStatus({ ok: null, message: 'Enviando payload de prueba SBS…' });
    const sample = expedientes[0]?.response ?? {
      event: 'WASI_RISK_TEST',
      expediente_id: 'EXP-TEST-2026',
      moneda: 'PEN',
      timestamp: new Date().toISOString(),
    };
    const ok = await triggerCoreWebhook(webhookUrl, { event: 'WASI_RISK_WEBHOOK_TEST', payload: sample });
    setWebhookStatus(
      ok
        ? { ok: true, message: '✓ Webhook disparado correctamente hacia el endpoint configurado.' }
        : { ok: false, message: 'No se pudo conectar al destino. Verifica URL y permisos CORS.' }
    );
  };

  const handleExportCsv = () => {
    if (expedientes.length === 0) {
      onToast('Aún no hay expedientes auditados para exportar.');
      return;
    }
    const csv = buildAuditBatchCsv(expedientes);
    downloadTextFile(`wasi_risk_lote_sbs_${new Date().toISOString().slice(0, 10)}.csv`, csv);
    onToast(`Exportados ${expedientes.length} expedientes a CSV SBS.`);
  };

  const handleCopySampleJson = () => {
    const sample = expedientes[0]?.response ?? {
      expediente_id: 'EXP-TRUJ-2026-0101',
      modo_inferencia: 'HIBRIDO_SANITIZADO_DEEPSEEK_VPS_SOE',
      nota: 'Ejecuta un caso testigo para inspeccionar el payload real de 4 bloques.',
    };
    navigator.clipboard?.writeText(JSON.stringify(sample, null, 2)).catch(() => {});
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 2000);
  };

  const handleCsvUpload = (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (ev) => {
      const text = String(ev.target?.result ?? '');
      const { items, error } = await parseBatchExpedientesCsv(text);
      if (error) {
        setParsedBatch(null);
        setUploadMsg({ error });
      } else {
        setParsedBatch(items);
        setUploadMsg({
          success: `✓ Detectados ${items.length} expediente(s) MYPE listos para auditoría por lote.`,
        });
      }
    };
    reader.readAsText(file);
    input.value = '';
  };

  const handleRunBatch = async () => {
    if (!parsedBatch || parsedBatch.length === 0) return;
    setRunningBatch(true);
    try {
      for (const req of parsedBatch) {
        await submitExpedienteAudit(req, {
          origen: 'DEMO_RAPIDA',
          titulo_caso: `Lote CSV · ${req.expediente_id}`,
        });
      }
      await onBoardChanged();
      onToast(`Lote CSV auditado: ${parsedBatch.length} expedientes enviados al Kanban SBS.`);
      setParsedBatch(null);
      setUploadMsg({ success: `✓ Lote ejecutado con éxito. Revisa el Kanban en tiempo real.` });
    } catch (err) {
      setUploadMsg({
        error: err instanceof Error ? err.message : 'Error ejecutando el lote CSV.',
      });
    } finally {
      setRunningBatch(false);
    }
  };

  return (
    <div
      class="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Panel de Control Gerencial WASI-RISK"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div class="modal-card modal-lg">
        <div class="modal-head">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span class="badge badge-green">Centro de Control · Nodux Flow</span>
              <h2 class="card-h" style={{ fontSize: '18px' }}>Panel Gerencial de Riesgos SBS</h2>
            </div>
            <div class="card-sub">
              P&amp;L en tiempo real, agencias Caja Trujillo, ingestor de lotes CSV, conector Core/Webhook y QR móvil.
            </div>
          </div>
          <button type="button" class="btn btn-secondary btn-sm" onClick={onClose} aria-label="Cerrar panel">
            ×
          </button>
        </div>

        {/* Pestañas estilo Nodux Flow */}
        <div class="exec-tabs">
          {[
            { id: 'pnl', label: 'P&L & Alertas SBS' },
            { id: 'agencias', label: 'Rendimiento Agencias' },
            { id: 'ingestor', label: 'Ingestor Lote CSV' },
            { id: 'webhook', label: 'Core ERP & Webhook' },
            { id: 'qr', label: 'Acceso Campo (QR)' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              class={`btn btn-sm ${tab === t.id ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setTab(t.id as ExecTab)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div class="modal-body">
          {/* TAB 1: P&L & ALERTAS SBS */}
          {tab === 'pnl' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div class="stat-grid-3">
                <div class="stat-tile">
                  <div class="stat-tile-label">Provisiones SBS Evitadas</div>
                  <div class="stat-tile-value mono" style={{ color: 'var(--mint-dark)' }}>
                    {formatPEN(metrics.provisionEvitada)}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--ink-muted)' }}>
                    Exposición frenada: {formatPEN(metrics.protegido)}
                  </div>
                </div>
                <div class="stat-tile">
                  <div class="stat-tile-label">Expedientes Auditados</div>
                  <div class="stat-tile-value mono">{expedientes.length}</div>
                  <div style={{ fontSize: '11px', color: 'var(--ink-muted)' }}>
                    {metrics.fastTrack} Fast-Track · {metrics.recortes} Recorte
                  </div>
                </div>
                <div class="stat-tile">
                  <div class="stat-tile-label">Candados Disparados</div>
                  <div class="stat-tile-value mono" style={{ color: 'var(--red-dark)' }}>
                    {metrics.fraudes + metrics.pokaYoke}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--ink-muted)' }}>
                    {metrics.fraudes} Fraude · {metrics.pokaYoke} Poka-Yoke
                  </div>
                </div>
              </div>

              <div class="section-box">
                <h3 class="section-title">
                  <span>Banderas de Riesgo Detectadas en Sesión</span>
                  <span class="badge badge-slate">{topFlags.length} tipos</span>
                </h3>
                {topFlags.length === 0 ? (
                  <div class="kanban-empty">
                    Aún no se han detectado alertas en esta sesión. Ejecuta los 4 Casos Testigo para poblar la telemetría.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {topFlags.map(([flag, count]) => (
                      <div
                        key={flag}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '8px 12px',
                          background: 'var(--bg-subtle)',
                          borderRadius: '10px',
                        }}
                      >
                        <span class="mono" style={{ fontSize: '12px', fontWeight: 700 }}>
                          {flag}
                        </span>
                        <span class="badge badge-red">{count} caso(s)</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: RENDIMIENTO POR AGENCIA */}
          {tab === 'agencias' && (
            <div class="section-box">
              <h3 class="section-title">
                <span>Auditoría Pre-Desembolso por Agencia Caja Trujillo</span>
                <span class="badge badge-slate">{agencyStats.length} agencias</span>
              </h3>
              {agencyStats.length === 0 ? (
                <div class="kanban-empty">
                  No hay expedientes auditados todavía para desglosar por agencia.
                </div>
              ) : (
                <div class="table-wrap">
                  <table class="data-table">
                    <thead>
                      <tr>
                        <th>Agencia</th>
                        <th style={{ textAlign: 'center' }}>Auditados</th>
                        <th style={{ textAlign: 'center' }}>Bloqueados</th>
                        <th style={{ textAlign: 'right' }}>Provisión Evitada</th>
                        <th style={{ textAlign: 'right' }}>Latencia Prom.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {agencyStats.map((ag) => (
                        <tr key={ag.agencia}>
                          <td><strong>{ag.agencia}</strong></td>
                          <td class="mono" style={{ textAlign: 'center' }}>{ag.total}</td>
                          <td class="mono" style={{ textAlign: 'center', color: ag.bloqueados > 0 ? 'var(--red-dark)' : 'inherit', fontWeight: 700 }}>
                            {ag.bloqueados}
                          </td>
                          <td class="mono" style={{ textAlign: 'right', color: 'var(--mint-dark)', fontWeight: 800 }}>
                            {formatPEN(ag.provisionEvitada)}
                          </td>
                          <td class="mono" style={{ textAlign: 'right' }}>
                            {(ag.latencySum / ag.total).toFixed(0)} ms
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: INGESTOR LOTE CSV */}
          {tab === 'ingestor' && (
            <div class="section-box">
              <h3 class="section-title">
                <span>Ingestor Masivo de Expedientes MYPE (CSV)</span>
                <span class="badge badge-green">Data Sync Worker</span>
              </h3>
              <p style={{ fontSize: '12.5px', color: 'var(--ink-secondary)', marginTop: 0 }}>
                Carga un lote CSV de solicitudes pre-desembolso para auditarlas automáticamente en paralelo contra el contrato de 4 bloques.
              </p>

              <label class="csv-dropzone">
                <strong style={{ color: 'var(--indigo-accent)' }}>
                  Seleccionar archivo CSV de Expedientes MYPE
                </strong>
                <span style={{ fontSize: '11.5px', color: 'var(--ink-muted)' }}>
                  Columnas mínimas: ruc, ventas_declaradas, monto_solicitado (opcional: agencia_origen, giro_ciiu, texto_ocr)
                </span>
                <input type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={handleCsvUpload} />
              </label>

              {uploadMsg?.error && (
                <div class="alert-banner fraud" style={{ marginTop: '10px', padding: '10px 12px' }}>
                  <span>{uploadMsg.error}</span>
                </div>
              )}
              {uploadMsg?.success && (
                <div class="alert-banner ok" style={{ marginTop: '10px', padding: '10px 12px' }}>
                  <span>{uploadMsg.success}</span>
                </div>
              )}

              {parsedBatch && parsedBatch.length > 0 && (
                <div style={{ marginTop: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <strong style={{ fontSize: '12.5px' }}>
                      Vista previa ({parsedBatch.length} expedientes):
                    </strong>
                    <button
                      type="button"
                      class="btn btn-success btn-sm"
                      disabled={runningBatch}
                      onClick={handleRunBatch}
                    >
                      {runningBatch ? 'Auditando lote…' : `▶ Auditar ${parsedBatch.length} Expedientes en Vivo`}
                    </button>
                  </div>
                  <div class="table-wrap">
                    <table class="data-table">
                      <thead>
                        <tr>
                          <th>Expediente</th>
                          <th>RUC</th>
                          <th>CIIU</th>
                          <th style={{ textAlign: 'right' }}>Solicitado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {parsedBatch.slice(0, 5).map((row) => (
                          <tr key={row.expediente_id}>
                            <td class="mono">{row.expediente_id}</td>
                            <td class="mono">{row.ruc}</td>
                            <td class="mono">{row.giro_ciiu}</td>
                            <td class="mono" style={{ textAlign: 'right', fontWeight: 700 }}>
                              {formatPEN(row.monto_solicitado_original)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '14px' }}>
                <button
                  type="button"
                  class="btn btn-secondary btn-sm"
                  onClick={() => downloadTextFile('plantilla_lote_wasi_risk.csv', BATCH_CSV_TEMPLATE)}
                >
                  Descargar Plantilla CSV
                </button>
              </div>
            </div>
          )}

          {/* TAB 4: CONECTOR CORE & WEBHOOK + EXPORTACIÓN CSV */}
          {tab === 'webhook' && (
            <div class="section-box">
              <h3 class="section-title">
                <span>Conector Core Bancario / Webhook &amp; Lote Contable SBS</span>
                <span class="badge badge-slate">Art. 140 PII</span>
              </h3>
              <p style={{ fontSize: '12.5px', color: 'var(--ink-secondary)', marginTop: 0 }}>
                Cada expediente auditado puede disparar un webhook en tiempo real hacia Core Bancario, Make, Zapier o Google Sheets (Apps Script <code>/exec</code>), o descargarse en lote CSV.
              </p>

              <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                <input
                  type="url"
                  class="search-input"
                  style={{ flex: 1 }}
                  placeholder="https://hook.make.com/... o https://script.google.com/macros/s/.../exec"
                  value={webhookUrl}
                  onInput={(e) => handleSaveWebhook((e.currentTarget as HTMLInputElement).value)}
                />
                <button type="button" class="btn btn-primary btn-sm" onClick={handleTestWebhook}>
                  Probar Webhook
                </button>
              </div>

              {webhookStatus && (
                <div
                  class={`alert-banner ${webhookStatus.ok ? 'ok' : 'warn'}`}
                  style={{ marginTop: '10px', padding: '9px 12px', fontSize: '12px' }}
                >
                  {webhookStatus.message}
                </div>
              )}

              <details style={{ marginTop: '12px', fontSize: '12px', color: 'var(--ink-secondary)' }}>
                <summary style={{ cursor: 'pointer', fontWeight: 700, color: 'var(--indigo-accent)' }}>
                  ¿Cómo conectar a Google Sheets gratis en 2 minutos? (Ver Apps Script)
                </summary>
                <pre class="json-pre mono" style={{ marginTop: '8px' }}>
{`function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var d = JSON.parse(e.postData.contents);
  var r = d.response || d;
  sheet.appendRow([
    new Date(),
    r.expediente_id,
    r.validacion_fiscal.ruc,
    r.dictamen_riesgos.escala_interna_caja_trujillo,
    r.dictamen_riesgos.monto_maximo_recomendado,
    r.dictamen_riesgos.alerta_fraude_maquillaje
  ]);
  return ContentService.createTextOutput("OK");
}`}
                </pre>
              </details>

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '14px' }}>
                <button type="button" class="btn btn-primary btn-sm" onClick={handleExportCsv}>
                  Descargar Lote Auditoría SBS (CSV)
                </button>
                <button type="button" class="btn btn-secondary btn-sm" onClick={handleCopySampleJson}>
                  {copiedJson ? '✓ JSON Copiado' : 'Copiar Payload JSON 4 Bloques'}
                </button>
              </div>
            </div>
          )}

          {/* TAB 5: ACCESO MÓVIL CAMPO (QR) */}
          {tab === 'qr' && (
            <div class="section-box">
              <h3 class="section-title">
                <span>Acceso Directo Terminal Móvil Campo (PWA)</span>
                <span class="badge badge-green">Zero-Login · Offline-First</span>
              </h3>
              <p style={{ fontSize: '12.5px', color: 'var(--ink-secondary)', marginTop: 0 }}>
                Escanea este código QR desde cualquier celular en El Porvenir, Hermelinda o la gran final presencial en UPAO Trujillo para abrir el Terminal Móvil Campo PWA al instante.
              </p>

              <div class="qr-box">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&margin=4&data=${encodeURIComponent(campoQrUrl)}`}
                  alt="Código QR Terminal Móvil Campo"
                  width={144}
                  height={144}
                  style={{ borderRadius: '14px', background: '#ffffff', padding: '6px', border: '1px solid var(--border-subtle)' }}
                />
                <div style={{ flex: 1, minWidth: '220px' }}>
                  <div style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--ink-muted)', marginBottom: '6px' }}>
                    Enlace Directo Plano 1 (PWA &lt;150 KB):
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input type="text" readOnly class="search-input mono" style={{ flex: 1 }} value={campoQrUrl} />
                    <button
                      type="button"
                      class="btn btn-primary btn-sm"
                      onClick={() => {
                        navigator.clipboard?.writeText(campoQrUrl).catch(() => {});
                        setCopiedLink(true);
                        setTimeout(() => setCopiedLink(false), 2000);
                      }}
                    >
                      {copiedLink ? '✓ Copiado' : 'Copiar'}
                    </button>
                  </div>
                  <ul style={{ margin: '10px 0 0', paddingLeft: '18px', fontSize: '12px', color: 'var(--ink-secondary)', lineHeight: 1.6 }}>
                    <li>Instalable como PWA nativa sin tiendas de apps.</li>
                    <li>Captura offline en IndexedDB con sellado SHA-256 local.</li>
                    <li>Sincronización instantánea con Consola Riesgos vía BroadcastChannel.</li>
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>

        <div class="modal-footer" style={{ justifyContent: 'space-between' }}>
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            onClick={async () => {
              await onClearBoard();
              onToast('Tablero demo restablecido.');
            }}
          >
            Restablecer Sesión Demo
          </button>
          <button type="button" class="btn btn-dark btn-sm" onClick={onClose}>
            Cerrar Panel
          </button>
        </div>
      </div>
    </div>
  );
}
