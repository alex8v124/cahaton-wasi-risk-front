import type { ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import {
  API_BASE_URL,
  evaluarFotoCalidad,
  getGoldenCases,
  getSunatByRuc,
  OfflineError,
} from '../api/client';
import {
  AGENCIAS_TRUJILLO,
  CIIU_CATALOG,
  DOCUMENT_TYPES,
  RELACIONES_REFERENCIA,
  SOE_KIT_DOCUMENTS_CATALOG,
} from '../contracts/catalogs';
import type {
  AuditarExpedienteRequest,
  DocumentoAdjunto,
  EvaluacionFotoResponse,
  ExpedienteAuditadoRecord,
  GoldenCase,
  OfflineQueueItem,
  SunatRucResponse,
} from '../contracts/schemas';
import { useNow } from '../hooks/useNodux';
import { flushOfflineQueue, submitExpedienteAudit } from '../services/auditService';
import { listOfflineQueue, subscribeSync } from '../storage/db';
import { sha256Hex, truncateHash } from '../utils/crypto';
import {
  formatDeltaPct,
  formatPEN,
  formatRCC,
  formatShortTime,
  getAsesorStatusLabel,
  getKanbanColumn,
} from '../utils/format';
import { isValidRucChecksum } from '../utils/ruc';
import { buildAuditWhatsAppText, buildWhatsAppUrl } from '../utils/whatsapp';

interface PrintModalProps {
  record: ExpedienteAuditadoRecord | null;
  onClose: () => void;
}

interface CampoViewProps {
  offline: boolean;
  onOpenConsola: (expedienteId?: string) => void;
  onToast: (message: string) => void;
}

function generateExpedienteId(): string {
  const seq = String(Math.floor(1000 + Math.random() * 9000));
  return `EXP-TRUJ-2026-${seq}`;
}

function CaseTileIcon({ colorKey }: { colorKey: 'verde' | 'ambar' | 'rojo' | 'gris' }) {
  if (colorKey === 'verde') {
    return (
      <div class="case-tile-icon verde" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 2.5L19 5.5V11.8C19 16.5 16 20 12 21.5C8 20 5 16.5 5 11.8V5.5L12 2.5Z"
            stroke="currentColor"
            stroke-width="2"
            stroke-linejoin="round"
          />
          <path
            d="M9 12L11 14L15.2 9.8"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </div>
    );
  }
  if (colorKey === 'ambar') {
    return (
      <div class="case-tile-icon ambar" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="8.5" r="3.5" stroke="currentColor" stroke-width="2" />
          <path
            d="M5.5 19.5C6.5 16.2 9 14.5 12 14.5C15 14.5 17.5 16.2 18.5 19.5"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          />
        </svg>
      </div>
    );
  }
  if (colorKey === 'rojo') {
    return (
      <div class="case-tile-icon rojo" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 2.5L19 5.5V11.8C19 16.5 16 20 12 21.5C8 20 5 16.5 5 11.8V5.5L12 2.5Z"
            fill="currentColor"
            fill-opacity="0.16"
            stroke="currentColor"
            stroke-width="2"
            stroke-linejoin="round"
          />
          <path d="M12 8.2V12.6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
          <circle cx="12" cy="15.8" r="1.2" fill="currentColor" />
        </svg>
      </div>
    );
  }
  return (
    <div class="case-tile-icon gris" aria-hidden="true">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <rect x="4" y="6" width="16" height="11" rx="2" stroke="currentColor" stroke-width="2" />
        <path d="M2.5 19H21.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      </svg>
    </div>
  );
}

export default function CampoView({ offline, onOpenConsola, onToast }: CampoViewProps) {
  const [goldenCases, setGoldenCases] = useState<GoldenCase[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [tituloCaso, setTituloCaso] = useState<string>('');

  const [expedienteId, setExpedienteId] = useState<string>(() => generateExpedienteId());
  const [ruc, setRuc] = useState<string>('10423189012');
  const [sunatInfo, setSunatInfo] = useState<SunatRucResponse | null>(null);
  const [sunatFromCache, setSunatFromCache] = useState(false);
  const [sunatLoading, setSunatLoading] = useState(false);
  const [sunatError, setSunatError] = useState<string | null>(null);

  const [agenciaOrigen, setAgenciaOrigen] = useState<string>(AGENCIAS_TRUJILLO[0]);
  const [giroCiiu, setGiroCiiu] = useState<string>('1520');
  const [ventasDeclaradas, setVentasDeclaradas] = useState<string>('7200');
  const [inventarioStock, setInventarioStock] = useState<number>(6400);
  const [stockDraft, setStockDraft] = useState<string>('6400');
  const [editingStock, setEditingStock] = useState<boolean>(false);
  const [gastosFamiliares, setGastosFamiliares] = useState<string>('410');
  const [cuotaSbsVigente, setCuotaSbsVigente] = useState<string>('214');
  const [cuotaPropuesta, setCuotaPropuesta] = useState<string>('980');
  const [montoSolicitado, setMontoSolicitado] = useState<string>('8000');

  // Vínculos de Red y Contexto Legítimo Declarado (RF-03, RF-04)
  const [telefonoContacto, setTelefonoContacto] = useState<string>('949334411');
  const [direccionNegocio, setDireccionNegocio] = useState<string>('Jr. Túpac Amaru 820, El Porvenir');
  const [coordenadasGps, setCoordenadasGps] = useState<string>('-8.0780, -79.0030');
  const [referenciaTelefono, setReferenciaTelefono] = useState<string>('949334499');
  const [referenciaRelacion, setReferenciaRelacion] = useState<string>(RELACIONES_REFERENCIA[0].value);
  const [asesorId, setAsesorId] = useState<string>('ASE-004');
  const [dispositivoFingerprint, setDispositivoFingerprint] = useState<string>('dev:corp-ase004-tab');
  const [contextoDeclarado, setContextoDeclarado] = useState<string[]>([]);
  const [consentimientoLey29733, setConsentimientoLey29733] = useState<boolean>(true);

  const [documentos, setDocumentos] = useState<DocumentoAdjunto[]>([
    {
      doc_id: 'DOC-1',
      tipo_documento: 'FACTURA_MAYORISTA',
      texto_ocr: '180 pies cuero + suela -> S/ 5,000.00 (OCR: 0.95)',
      semaforo_nitidez: 'VERDE',
    },
  ]);
  const [newDocType, setNewDocType] = useState<string>(DOCUMENT_TYPES[0].value);
  const [newDocText, setNewDocText] = useState<string>('');
  const [hashingFile, setHashingFile] = useState(false);
  const [fotoEval, setFotoEval] = useState<EvaluacionFotoResponse | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [lastAudit, setLastAudit] = useState<ExpedienteAuditadoRecord | null>(null);
  // RF-07 Segregación de funciones: por defecto vista Asesor oculta score/grafo de red
  const [showDemoTechDetail, setShowDemoTechDetail] = useState<boolean>(false);
  const [queueItems, setQueueItems] = useState<OfflineQueueItem[]>([]);
  const [syncingQueue, setSyncingQueue] = useState(false);

  // Cronómetro de velocidad Nodux Flow
  const [captureStartedAt, setCaptureStartedAt] = useState<number | null>(null);
  const [lastCycleSeconds, setLastCycleSeconds] = useState<number | null>(null);
  const nowTick = useNow(captureStartedAt !== null && !submitting, 200);
  const liveSeconds =
    captureStartedAt !== null ? Math.max(0.1, (nowTick - captureStartedAt) / 1000) : null;

  // Modal imprimible Acta SBS / Checklist Auditor Senior (lazy-loaded)
  const [printRecord, setPrintRecord] = useState<ExpedienteAuditadoRecord | null>(null);
  const [PrintModal, setPrintModal] = useState<ComponentType<PrintModalProps> | null>(null);

  const openPrintModal = (rec: ExpedienteAuditadoRecord) => {
    setPrintRecord(rec);
    if (!PrintModal) {
      import('../components/DictamenPrintModal').then((m) => setPrintModal(() => m.default));
    }
  };

  const refreshQueue = async () => {
    setQueueItems(await listOfflineQueue());
  };

  useEffect(() => {
    getGoldenCases()
      .then(setGoldenCases)
      .catch(() => {});
    refreshQueue();

    sha256Hex('180 pies cuero + suela -> S/ 5,000.00 (OCR: 0.95)').then((hash) => {
      setDocumentos((prev) =>
        prev.map((d, idx) => (idx === 0 && !d.hash_sha256 ? { ...d, hash_sha256: hash } : d))
      );
    });

    return subscribeSync(() => {
      refreshQueue();
    });
  }, []);

  // Autocompletado RUC automático al completar 11 dígitos
  useEffect(() => {
    const clean = ruc.replace(/\D/g, '');
    if (clean.length !== 11) {
      setSunatInfo(null);
      setSunatError(null);
      return;
    }

    let cancelled = false;
    setSunatLoading(true);
    setSunatError(null);

    getSunatByRuc(clean)
      .then(({ data, fromCache }) => {
        if (cancelled) return;
        setSunatInfo(data);
        setSunatFromCache(fromCache);
        setGiroCiiu(data.giro_ciiu);
      })
      .catch((err) => {
        if (cancelled) return;
        setSunatInfo(null);
        setSunatError(err instanceof Error ? err.message : 'No se pudo consultar SUNAT.');
      })
      .finally(() => {
        if (!cancelled) setSunatLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [ruc, offline]);

  const toggleContextoCode = (code: string) => {
    setContextoDeclarado((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  };

  const handleLoadGoldenCase = async (gc: GoldenCase) => {
    const p = gc.payload;
    setCaptureStartedAt(Date.now());
    setLastCycleSeconds(null);
    setSelectedCaseId(gc.case_id);
    setTituloCaso(gc.titulo);
    setExpedienteId(p.expediente_id);
    setRuc(p.ruc);
    setAgenciaOrigen(p.agencia_origen);
    setGiroCiiu(p.giro_ciiu);
    setVentasDeclaradas(String(p.ventas_declaradas_asesor));
    setInventarioStock(p.inventario_fisico_estimado);
    setStockDraft(String(p.inventario_fisico_estimado));
    setGastosFamiliares(String(p.gastos_operativos_familiares));
    setCuotaSbsVigente(String(p.cuota_deuda_sbs_vigente));
    setCuotaPropuesta(String(p.cuota_mensual_propuesta));
    setMontoSolicitado(String(p.monto_solicitado_original));
    setFormError(null);

    setTelefonoContacto(p.telefono_contacto ?? '948112233');
    setDireccionNegocio(p.direccion_negocio ?? 'El Porvenir, Trujillo');
    setCoordenadasGps(
      p.geolocalizacion ? `${p.geolocalizacion[0]}, ${p.geolocalizacion[1]}` : '-8.0812, -79.0024'
    );
    setReferenciaTelefono(p.referencias?.[0]?.telefono ?? '948998877');
    setReferenciaRelacion(p.referencias?.[0]?.relacion ?? RELACIONES_REFERENCIA[0].value);
    setAsesorId(p.asesor_id ?? 'ASE-004');
    setDispositivoFingerprint(p.dispositivo_fingerprint ?? 'dev:corp-ase004-tab');
    setContextoDeclarado(p.contexto_declarado ?? []);
    setConsentimientoLey29733(p.consentimiento_datos_ley29733 ?? true);

    const hashedDocs = await Promise.all(
      p.documentos_adjuntos.map(async (d) => ({
        ...d,
        hash_sha256: d.hash_sha256 ?? (await sha256Hex(`${d.tipo_documento}|${d.texto_ocr}`)),
      }))
    );
    setDocumentos(hashedDocs);

    if (hashedDocs[0]) {
      const evalRes = await evaluarFotoCalidad({
        nombre_archivo: hashedDocs[0].nombre_archivo ?? `${gc.case_id}.jpg`,
        texto_ocr: hashedDocs[0].texto_ocr,
      });
      setFotoEval(evalRes);
    }

    onToast(`Caso cargado en formulario: ${gc.titulo}`);
  };

  const handleStockAdjust = (delta: number) => {
    setInventarioStock((prev) => {
      const next = Math.max(0, Number((prev + delta).toFixed(2)));
      setStockDraft(String(next));
      return next;
    });
  };

  const handleStockReset = () => {
    setInventarioStock(0);
    setStockDraft('0');
  };

  const handleStockInput = (raw: string) => {
    const cleaned = raw.replace(/[^0-9.]/g, '');
    const parts = cleaned.split('.');
    const normalized =
      parts.length > 2 ? `${parts[0]}.${parts.slice(1).join('')}` : cleaned;
    setStockDraft(normalized);
    if (normalized === '' || normalized === '.') {
      setInventarioStock(0);
      return;
    }
    const num = Number(normalized);
    if (Number.isFinite(num) && num >= 0) {
      setInventarioStock(Number(num.toFixed(2)));
    }
  };

  const handleAddTextEvidence = async () => {
    const trimmed = newDocText.trim();
    if (!trimmed) return;
    const evalRes = await evaluarFotoCalidad({
      nombre_archivo: 'captura_ocr_campo.jpg',
      texto_ocr: trimmed,
    });
    setFotoEval(evalRes);
    const hash = await sha256Hex(`${newDocType}|${trimmed}`);
    const nextDoc: DocumentoAdjunto = {
      doc_id: `DOC-${documentos.length + 1}`,
      tipo_documento: newDocType,
      texto_ocr: trimmed,
      hash_sha256: hash,
      semaforo_nitidez: evalRes.semaforo_nitidez,
      perdida_detalle_texto: evalRes.perdida_detalle_texto,
      requiere_nueva_foto: evalRes.requiere_nueva_foto,
      contiene_importe_ambiguo_letras: evalRes.contiene_importe_ambiguo_letras,
    };
    setDocumentos((prev) => [...prev, nextDoc]);
    setNewDocText('');
    onToast(
      `Evidencia sellada · Nitidez ${evalRes.semaforo_nitidez} · 0 PII enviados`
    );
  };

  const handleTestBlurryNote = async () => {
    const sample =
      'Nota manuscrita borrosa con sombra: Venta semanal S/ 5.0OO.00 (letras O en vez de ceros, OCR: 0.62)';
    const evalRes = await evaluarFotoCalidad({
      nombre_archivo: 'DOC-MAN-005_nota_borrosa_poka_yoke_5000.png',
      texto_ocr: sample,
    });
    setFotoEval(evalRes);
    const hash = await sha256Hex(`NOTA_MANUSCRITA|${sample}`);
    setDocumentos([
      {
        doc_id: 'DOC-POKA-1',
        tipo_documento: 'NOTA_MANUSCRITA',
        texto_ocr: sample,
        hash_sha256: hash,
        nombre_archivo: 'DOC-MAN-005_nota_borrosa_poka_yoke_5000.png',
        semaforo_nitidez: evalRes.semaforo_nitidez,
        perdida_detalle_texto: evalRes.perdida_detalle_texto,
        requiere_nueva_foto: evalRes.requiere_nueva_foto,
        contiene_importe_ambiguo_letras: evalRes.contiene_importe_ambiguo_letras,
      },
    ]);
    onToast('Semáforo ROJO activado: monto con letras 5.0OO.00 detectado (Poka-Yoke Gris).');
  };

  const handleFileAttach = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    setHashingFile(true);
    try {
      const buffer = await file.arrayBuffer();
      const hash = await sha256Hex(buffer);
      const docText =
        newDocText.trim() ||
        `Foto adjunta (${file.name}, ${Math.max(1, Math.round(file.size / 1024))} KB) -> Evidencia verificada (OCR: 0.94)`;
      const evalRes = await evaluarFotoCalidad({
        nombre_archivo: file.name,
        size_bytes: file.size,
        texto_ocr: docText,
      });
      setFotoEval(evalRes);
      const nextDoc: DocumentoAdjunto = {
        doc_id: `DOC-${documentos.length + 1}`,
        tipo_documento: newDocType,
        texto_ocr: docText,
        hash_sha256: hash,
        nombre_archivo: file.name,
        semaforo_nitidez: evalRes.semaforo_nitidez,
        perdida_detalle_texto: evalRes.perdida_detalle_texto,
        requiere_nueva_foto: evalRes.requiere_nueva_foto,
        contiene_importe_ambiguo_letras: evalRes.contiene_importe_ambiguo_letras,
      };
      setDocumentos((prev) => [...prev, nextDoc]);
      setNewDocText('');
      onToast(
        `Archivo sellado SHA-256 (${truncateHash(hash, 8, 4)}) · Nitidez ${evalRes.semaforo_nitidez}`
      );
    } finally {
      setHashingFile(false);
      input.value = '';
    }
  };

  const handleRemoveDoc = (docId: string) => {
    setDocumentos((prev) => prev.filter((d) => d.doc_id !== docId));
  };

  const handleManualSync = async () => {
    if (offline) {
      onToast('Sin señal activa. Reconecta para sincronizar la cola offline.');
      return;
    }
    setSyncingQueue(true);
    try {
      const res = await flushOfflineQueue();
      await refreshQueue();
      if (res.synced.length > 0) {
        setLastAudit(res.synced[res.synced.length - 1]);
        onToast(`Sincronizados ${res.synced.length} expediente(s) hacia la Consola Riesgos.`);
      } else {
        onToast('No había expedientes pendientes por sincronizar.');
      }
    } finally {
      setSyncingQueue(false);
    }
  };

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setFormError(null);

    const cleanRuc = ruc.replace(/\D/g, '');
    if (cleanRuc.length !== 11) {
      setFormError('El RUC debe tener exactamente 11 dígitos.');
      return;
    }
    if (!consentimientoLey29733) {
      setFormError('Debes confirmar el consentimiento de tratamiento de datos (Ley N.° 29733).');
      return;
    }
    if (documentos.length === 0) {
      setFormError('Adjunta al menos 1 evidencia documental (boleta, factura o voucher Yape/Plin).');
      return;
    }

    const gpsParts = coordenadasGps
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n));
    const parsedGps: [number, number] | undefined =
      gpsParts.length === 2 ? [gpsParts[0], gpsParts[1]] : undefined;

    const payload: AuditarExpedienteRequest = {
      expediente_id: expedienteId.trim() || generateExpedienteId(),
      ruc: cleanRuc,
      agencia_origen: agenciaOrigen,
      asesor_id: asesorId,
      giro_ciiu: giroCiiu,
      ventas_declaradas_asesor: Number(ventasDeclaradas) || 0,
      inventario_fisico_estimado: inventarioStock,
      gastos_operativos_familiares: Number(gastosFamiliares) || 0,
      cuota_deuda_sbs_vigente: Number(cuotaSbsVigente) || 0,
      cuota_mensual_propuesta: Number(cuotaPropuesta) || 1,
      monto_solicitado_original: Number(montoSolicitado) || 1,
      documentos_adjuntos: documentos,
      telefono_contacto: telefonoContacto.trim() || undefined,
      direccion_negocio: direccionNegocio.trim() || undefined,
      geolocalizacion: parsedGps,
      dispositivo_fingerprint: dispositivoFingerprint,
      dispositivo_tipo: contextoDeclarado.includes('L-06') ? 'CORPORATIVO_ASESOR' : 'CLIENTE',
      referencias: referenciaTelefono.trim()
        ? [{ telefono: referenciaTelefono.trim(), relacion: referenciaRelacion }]
        : undefined,
      contexto_declarado: contextoDeclarado,
      consentimiento_datos_ley29733: consentimientoLey29733,
    };

    setSubmitting(true);
    try {
      const result = await submitExpedienteAudit(payload, {
        origen: 'CAMPO_ONLINE',
        titulo_caso: tituloCaso || undefined,
        razon_social: sunatInfo?.razon_social,
      });

      if (result.mode === 'QUEUED_OFFLINE') {
        await refreshQueue();
        onToast(
          `Sin señal: ${payload.expediente_id} guardado en IndexedDB (cola offline: ${result.queueSize}).`
        );
      } else {
        setLastAudit(result.record);
        if (captureStartedAt !== null) {
          setLastCycleSeconds(Math.max(0.2, (Date.now() - captureStartedAt) / 1000));
          setCaptureStartedAt(null);
        } else {
          setLastCycleSeconds(Number((result.record.response.latencia_ms / 1000).toFixed(1)));
        }
        const asesorEstado = getAsesorStatusLabel(result.record.response);
        onToast(
          `Recibido en ${result.record.response.latencia_ms.toFixed(0)} ms · Estado Asesor: ${asesorEstado.label}`
        );
      }
    } catch (err) {
      if (err instanceof OfflineError) {
        onToast('Sin conectividad: intenta nuevamente para encolar offline.');
      } else {
        setFormError(err instanceof Error ? err.message : 'Error al auditar expediente.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const lastCol = lastAudit ? getKanbanColumn(lastAudit.response) : null;
  const asesorStatus = lastAudit ? getAsesorStatusLabel(lastAudit.response) : null;
  const sunatAlert =
    sunatInfo &&
    (sunatInfo.estado_sunat !== 'ACTIVO' || sunatInfo.condicion_domicilio !== 'HABIDO');

  return (
    <main class="page-shell">
      {/* Banda Superior: Hero Evaluación de Riesgo + 6 Tarjetas de Casos Simulados RIE-02 */}
      <section class="campo-hero-strip" aria-label="6 Casos Simulados RIE-02">
        <div class="campo-hero-banner">
          <svg width="74" height="74" viewBox="0 0 80 80" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
            <circle cx="38" cy="42" r="32" fill="rgba(99, 102, 241, 0.12)" />
            <rect
              x="21"
              y="12"
              width="34"
              height="52"
              rx="8"
              fill="#FFFFFF"
              stroke="#3730A3"
              stroke-width="2.5"
            />
            <circle cx="38" cy="30" r="7" fill="#C7D2FE" />
            <path d="M29 45H47" stroke="#CBD5E1" stroke-width="2.5" stroke-linecap="round" />
            <path d="M29 51H42" stroke="#CBD5E1" stroke-width="2.5" stroke-linecap="round" />
            <circle cx="56" cy="52" r="11" fill="#10B981" />
            <path
              d="M51.5 52.3L54.6 55.4L60.8 49.2"
              stroke="#FFFFFF"
              stroke-width="2.4"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <span class="badge badge-slate">Terminal Móvil Campo · PWA</span>
              <span class="badge badge-green">0 PII enviados</span>
              {liveSeconds !== null && (
                <span class="stopwatch-pill mono" title="Cronómetro de captura Nodux Flow">
                  ⏱ {liveSeconds.toFixed(1)} s
                </span>
              )}
            </div>
            <h1 class="campo-hero-title">Evaluación de riesgo</h1>
            <div class="campo-hero-sub">6 casos RIE-02 · Vínculos + Nitidez Local</div>
            <div class="campo-hero-bar" />
          </div>
        </div>

        <div class="campo-cases-grid">
          {goldenCases.map((gc) => {
            const nivel = gc.nivel_esperado;
            const colorKey: 'verde' | 'ambar' | 'rojo' | 'gris' =
              nivel === 'SIN_ALERTA' || gc.etiqueta_escala.includes('VERDE')
                ? 'verde'
                : nivel === 'OBSERVACION' || gc.etiqueta_escala.includes('ÁMBAR')
                  ? 'ambar'
                  : nivel === 'VERIFICAR_DATOS' || gc.etiqueta_escala.includes('GRIS')
                    ? 'gris'
                    : 'rojo';
            const badgeClass =
              colorKey === 'verde'
                ? 'badge-green'
                : colorKey === 'ambar'
                  ? 'badge-amber'
                  : colorKey === 'gris'
                    ? 'badge-slate'
                    : 'badge-red-solid';
            const shortTitle = gc.titulo.replace(/^CS-0\d\s*·\s*/, '');

            return (
              <button
                key={gc.case_id}
                type="button"
                class={`case-tile ${selectedCaseId === gc.case_id ? 'is-active' : ''}`}
                onClick={() => handleLoadGoldenCase(gc)}
              >
                <div class="case-tile-head">
                  <CaseTileIcon colorKey={colorKey} />
                  <span class={`badge ${badgeClass}`}>{gc.etiqueta_escala}</span>
                </div>
                <div>
                  <div class="case-tile-num num">{gc.case_id}</div>
                  <div class="case-tile-name">{shortTitle}</div>
                </div>
                <div class={`case-tile-bar ${colorKey}`} />
              </button>
            );
          })}
        </div>
      </section>

      <div class="campo-layout">
        {/* Columna Izquierda: Tarjetas de Captura */}
        <form class="campo-stack" onSubmit={handleSubmit}>
          {offline && (
            <div class="alert-banner warn">
              <strong>Modo Offline-First activo (El Porvenir / Hermelinda sin señal)</strong>
              <span style={{ fontSize: '12px' }}>
                Tu captura se guardará en IndexedDB con hash SHA-256 local y se sincronizará
                automáticamente con el servidor local al volver la señal.
              </span>
            </div>
          )}

          {/* TARJETA A: Validación RUC */}
          <section class="campo-card">
            <div class="card-title-row">
              <div class="card-title-left">
                <div class="card-icon-circle" aria-hidden="true">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <rect x="5" y="3" width="14" height="18" rx="3" stroke="currentColor" stroke-width="2" />
                    <path d="M9 8H15M9 12H15M9 16H12" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                  </svg>
                </div>
                <div>
                  <h2 class="card-h">Validación RUC</h2>
                  <div class="card-sub">Consulta en segundos el estado SUNAT del cliente</div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                {ruc.replace(/\D/g, '').length === 11 && (
                  <span
                    class={`badge ${isValidRucChecksum(ruc) ? 'badge-green' : 'badge-slate'}`}
                    title="Validación de dígito verificador SUNAT Módulo 11 (Nodux Flow)"
                  >
                    {isValidRucChecksum(ruc) ? '✓ Mod-11 SUNAT' : 'Padrón Trujillo'}
                  </span>
                )}
                {sunatInfo && !sunatAlert && (
                  <span class="badge badge-green">✓ RUC Válido</span>
                )}
                {sunatAlert && (
                  <span class="badge badge-red-solid">
                    {sunatInfo.estado_sunat} · {sunatInfo.condicion_domicilio}
                  </span>
                )}
                <button
                  type="button"
                  class="btn btn-secondary btn-sm"
                  onClick={() => {
                    setSelectedCaseId(null);
                    setTituloCaso('');
                    setExpedienteId(generateExpedienteId());
                    onToast('Nuevo ID de expediente generado.');
                  }}
                >
                  + Nuevo ID
                </button>
              </div>
            </div>

            <div class="ruc-tiles-grid">
              <div class="icon-input-tile">
                <div class="tile-icon" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path d="M3 10L12 4L21 10H3Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
                    <path d="M6 10V18M10 10V18M14 10V18M18 10V18M3 18H21" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                  </svg>
                </div>
                <div class="tile-body">
                  <label htmlFor="ruc-input">RUC del cliente (11 dígitos)</label>
                  <input
                    id="ruc-input"
                    class="mono"
                    type="text"
                    inputMode="numeric"
                    maxLength={11}
                    value={ruc}
                    onInput={(e) => {
                      setSelectedCaseId(null);
                      setRuc((e.currentTarget as HTMLInputElement).value.replace(/\D/g, ''));
                    }}
                    placeholder="10423189012"
                    required
                  />
                </div>
              </div>

              <div class="icon-input-tile">
                <div class="tile-icon" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <rect x="4" y="5" width="16" height="15" rx="3" stroke="currentColor" stroke-width="2" />
                    <path d="M8 3V7M16 3V7M4 10H20" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                  </svg>
                </div>
                <div class="tile-body">
                  <label htmlFor="exp-id">ID de Expediente</label>
                  <input
                    id="exp-id"
                    class="mono"
                    type="text"
                    value={expedienteId}
                    onInput={(e) => setExpedienteId((e.currentTarget as HTMLInputElement).value)}
                    required
                  />
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' }}>
              <button
                type="button"
                class="btn btn-secondary btn-sm"
                onClick={() => setRuc('10402233445')}
              >
                Probar NO HABIDO (P-06)
              </button>
              <button
                type="button"
                class="btn btn-secondary btn-sm"
                onClick={() => setRuc('10403344556')}
              >
                Probar BAJA OFICIO
              </button>
              {sunatLoading && (
                <span style={{ fontSize: '12px', color: '#7a83a1', alignSelf: 'center' }}>
                  Consultando SUNAT…
                </span>
              )}
            </div>

            {sunatError && (
              <div class="alert-banner warn" style={{ marginTop: '10px', padding: '8px 12px' }}>
                <span style={{ fontSize: '12px' }}>{sunatError}</span>
              </div>
            )}

            {sunatInfo && (
              <div class={`ruc-result ${sunatAlert ? 'alert' : ''}`}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                    flexWrap: 'wrap',
                  }}
                >
                  <strong>{sunatInfo.razon_social}</strong>
                  <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                    <span class={`badge ${sunatInfo.estado_sunat === 'ACTIVO' ? 'badge-green' : 'badge-red-solid'}`}>
                      {sunatInfo.estado_sunat}
                    </span>
                    <span class={`badge ${sunatInfo.condicion_domicilio === 'HABIDO' ? 'badge-green' : 'badge-red-solid'}`}>
                      {sunatInfo.condicion_domicilio}
                    </span>
                    {sunatFromCache && <span class="badge badge-amber">Caché Offline</span>}
                  </div>
                </div>
                <div style={{ fontSize: '11.5px', color: '#4c5574', marginTop: '4px' }}>
                  CIIU autocompletado: <strong class="mono">{sunatInfo.giro_ciiu}</strong>
                  {sunatInfo.distrito ? ` · ${sunatInfo.distrito}` : ''}
                  {sunatInfo.latencia_ms ? ` · ${sunatInfo.latencia_ms.toFixed(1)} ms` : ''}
                </div>
              </div>
            )}
          </section>

          {/* TARJETA A2: Vínculos de Red y Contexto Legítimo Declarado (RF-03, RF-04) */}
          <section class="campo-card">
            <div class="card-title-row">
              <div class="card-title-left">
                <div class="card-icon-circle" aria-hidden="true">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <circle cx="6" cy="7" r="3" stroke="currentColor" stroke-width="2" />
                    <circle cx="18" cy="7" r="3" stroke="currentColor" stroke-width="2" />
                    <circle cx="12" cy="18" r="3" stroke="currentColor" stroke-width="2" />
                    <path d="M8.5 8.5L10.5 15.5M15.5 8.5L13.5 15.5M9 7H15" stroke="currentColor" stroke-width="1.8" />
                  </svg>
                </div>
                <div>
                  <h2 class="card-h">2. Contacto y Contexto</h2>
                  <div class="card-sub">Teléfono, dirección y vínculo legítimo</div>
                </div>
              </div>
              <span class="badge badge-slate">Vínculos de Red</span>
            </div>

            <div class="ruc-tiles-grid">
              <div class="icon-input-tile">
                <div class="tile-icon" aria-hidden="true">
                  <span style={{ fontWeight: 800, fontSize: '13px' }}>📱</span>
                </div>
                <div class="tile-body">
                  <label htmlFor="tel-contacto">Teléfono de contacto del solicitante</label>
                  <input
                    id="tel-contacto"
                    class="mono"
                    type="tel"
                    value={telefonoContacto}
                    onInput={(e) => setTelefonoContacto((e.currentTarget as HTMLInputElement).value)}
                    placeholder="948332190"
                  />
                </div>
              </div>

              <div class="icon-input-tile">
                <div class="tile-icon" aria-hidden="true">
                  <span style={{ fontWeight: 800, fontSize: '13px' }}>🤝</span>
                </div>
                <div class="tile-body">
                  <label htmlFor="tel-ref">Teléfono de Referencia / Aval</label>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <input
                      id="tel-ref"
                      class="mono"
                      type="tel"
                      value={referenciaTelefono}
                      onInput={(e) => setReferenciaTelefono((e.currentTarget as HTMLInputElement).value)}
                      placeholder="948332199"
                      style={{ flex: 1 }}
                    />
                    <select
                      aria-label="Relación de referencia"
                      value={referenciaRelacion}
                      onChange={(e) => setReferenciaRelacion((e.currentTarget as HTMLSelectElement).value)}
                      style={{ width: '130px', fontSize: '11.5px' }}
                    >
                      {RELACIONES_REFERENCIA.map((rel) => (
                        <option key={rel.value} value={rel.value}>
                          {rel.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div class="icon-input-tile">
                <div class="tile-icon" aria-hidden="true">
                  <span style={{ fontWeight: 800, fontSize: '13px' }}>📍</span>
                </div>
                <div class="tile-body">
                  <label htmlFor="dir-negocio">Dirección comercial / Puesto</label>
                  <input
                    id="dir-negocio"
                    type="text"
                    value={direccionNegocio}
                    onInput={(e) => setDireccionNegocio((e.currentTarget as HTMLInputElement).value)}
                    placeholder="Mercado La Hermelinda Puesto B-114"
                  />
                </div>
              </div>

              <div class="icon-input-tile">
                <div class="tile-icon" aria-hidden="true">
                  <span style={{ fontWeight: 800, fontSize: '13px' }}>🛰</span>
                </div>
                <div class="tile-body">
                  <label htmlFor="gps-input">Geolocalización GPS (Trujillo)</label>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <input
                      id="gps-input"
                      class="mono"
                      type="text"
                      value={coordenadasGps}
                      onInput={(e) => setCoordenadasGps((e.currentTarget as HTMLInputElement).value)}
                      style={{ flex: 1 }}
                    />
                    <button
                      type="button"
                      class="btn btn-secondary btn-sm"
                      onClick={() => {
                        setCoordenadasGps('-8.0914, -79.0152');
                        onToast('Coordenadas GPS capturadas en campo.');
                      }}
                    >
                      GPS
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Chips de Contexto Legítimo Declarado (L-01, L-02, L-03, L-06) */}
            <div style={{ marginTop: '12px' }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#3f486b', marginBottom: '8px' }}>
                Contexto legítimo (opcional):
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {[
                  { code: 'L-01', label: '🏠 Familia (L-01)' },
                  { code: 'L-02', label: '🏪 Mercado (L-02)' },
                  { code: 'L-03', label: '👨‍👩‍👧 Negocio familiar (L-03)' },
                  { code: 'L-06', label: '📱 Tablet asesor (L-06)' },
                ].map((ctx) => (
                  <label
                    key={ctx.code}
                    class={`badge ${contextoDeclarado.includes(ctx.code) ? 'badge-green' : 'badge-slate'}`}
                    style={{
                      cursor: 'pointer',
                      padding: '6px 10px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={contextoDeclarado.includes(ctx.code)}
                      onChange={() => toggleContextoCode(ctx.code)}
                    />
                    <span>{ctx.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Consentimiento Ley 29733 */}
            <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px dashed rgba(99,102,241,0.18)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#3f486b', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={consentimientoLey29733}
                  onChange={(e) => setConsentimientoLey29733((e.currentTarget as HTMLInputElement).checked)}
                />
                <span>
                  <strong>Consentimiento Ley N.° 29733 y Art. 140:</strong> El titular autoriza la
                  evaluación pre-desembolso con procesamiento 100% local (Sanitizador v2: 0 PII enviados a la nube).
                </span>
              </label>
            </div>
          </section>

          {/* TARJETA B: Datos Financieros MYPE + Monto Solicitado Hero */}
          <section class="campo-card">
            <div class="card-title-row">
              <div class="card-title-left">
                <div class="card-icon-circle" aria-hidden="true">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <ellipse cx="12" cy="6.5" rx="7" ry="3" stroke="currentColor" stroke-width="2" />
                    <path d="M5 6.5V12C5 13.7 8.1 15 12 15C15.9 15 19 13.7 19 12V6.5" stroke="currentColor" stroke-width="2" />
                    <path d="M5 12V17.5C5 19.2 8.1 20.5 12 20.5C15.9 20.5 19 19.2 19 17.5V12" stroke="currentColor" stroke-width="2" />
                  </svg>
                </div>
                <div>
                  <h2 class="card-h">3. Ventas y Monto</h2>
                  <div class="card-sub">Datos financieros en Soles (S/)</div>
                </div>
              </div>
              <span class="badge badge-slate">14 CIIUs MYPE</span>
            </div>

            <div class="ruc-tiles-grid">
              <div class="icon-input-tile">
                <div class="tile-icon" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path d="M4 10L6 5H18L20 10" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
                    <path d="M5 10V19H19V10M9 19V14H15V19" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
                  </svg>
                </div>
                <div class="tile-body">
                  <label htmlFor="agencia-select">Agencia Caja Trujillo</label>
                  <select
                    id="agencia-select"
                    value={agenciaOrigen}
                    onChange={(e) => setAgenciaOrigen((e.currentTarget as HTMLSelectElement).value)}
                  >
                    {AGENCIAS_TRUJILLO.map((ag) => (
                      <option key={ag} value={ag}>
                        {ag}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div class="icon-input-tile">
                <div class="tile-icon" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <rect x="4" y="7" width="16" height="12" rx="2.5" stroke="currentColor" stroke-width="2" />
                    <path d="M9 7V5.5C9 4.7 9.7 4 10.5 4H13.5C14.3 4 15 4.7 15 5.5V7" stroke="currentColor" stroke-width="2" />
                  </svg>
                </div>
                <div class="tile-body">
                  <label htmlFor="ciiu-select">Giro de Negocio (CIIU)</label>
                  <select
                    id="ciiu-select"
                    value={giroCiiu}
                    onChange={(e) => setGiroCiiu((e.currentTarget as HTMLSelectElement).value)}
                  >
                    {CIIU_CATALOG.map((item) => (
                      <option key={item.codigo} value={item.codigo}>
                        {item.codigo} — {item.nombre}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div class="icon-input-tile">
                <div class="tile-icon" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="2" />
                    <path d="M9 14L11 11L13 13L16 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </div>
                <div class="tile-body">
                  <label htmlFor="ventas-input">Ventas Declaradas Mensuales (S/)</label>
                  <div class="tile-pen-row">
                    <span class="tile-pen-prefix">S/</span>
                    <input
                      id="ventas-input"
                      class="mono"
                      type="number"
                      step="0.01"
                      min="0"
                      value={ventasDeclaradas}
                      onInput={(e) => setVentasDeclaradas((e.currentTarget as HTMLInputElement).value)}
                      required
                    />
                  </div>
                </div>
              </div>

              <div class="icon-input-tile">
                <div class="tile-icon" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2" />
                    <path
                      d="M12 4V6M12 18V20M4 12H6M18 12H20M6.3 6.3L7.8 7.8M16.2 16.2L17.7 17.7M17.7 6.3L16.2 7.8M7.8 16.2L6.3 17.7"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                    />
                  </svg>
                </div>
                <div class="tile-body">
                  <label htmlFor="gastos-input">Gastos Operativos y Familiares (S/)</label>
                  <div class="tile-pen-row">
                    <span class="tile-pen-prefix">S/</span>
                    <input
                      id="gastos-input"
                      class="mono"
                      type="number"
                      step="0.01"
                      min="0"
                      value={gastosFamiliares}
                      onInput={(e) => setGastosFamiliares((e.currentTarget as HTMLInputElement).value)}
                      required
                    />
                  </div>
                </div>
              </div>

              <div class="icon-input-tile">
                <div class="tile-icon" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <rect x="3" y="6" width="18" height="12" rx="2.5" stroke="currentColor" stroke-width="2" />
                    <path d="M3 10H21" stroke="currentColor" stroke-width="2" />
                  </svg>
                </div>
                <div class="tile-body">
                  <label htmlFor="deuda-sbs-input">Cuota Deuda SBS Vigente (S/)</label>
                  <div class="tile-pen-row">
                    <span class="tile-pen-prefix">S/</span>
                    <input
                      id="deuda-sbs-input"
                      class="mono"
                      type="number"
                      step="0.01"
                      min="0"
                      value={cuotaSbsVigente}
                      onInput={(e) => setCuotaSbsVigente((e.currentTarget as HTMLInputElement).value)}
                      required
                    />
                  </div>
                </div>
              </div>

              <div class="icon-input-tile">
                <div class="tile-icon" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path d="M4 17L10 11L14 15L20 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                    <path d="M15 7H20V12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </div>
                <div class="tile-body">
                  <label htmlFor="cuota-prop-input">Cuota Mensual Propuesta (S/)</label>
                  <div class="tile-pen-row">
                    <span class="tile-pen-prefix">S/</span>
                    <input
                      id="cuota-prop-input"
                      class="mono"
                      type="number"
                      step="0.01"
                      min="1"
                      value={cuotaPropuesta}
                      onInput={(e) => setCuotaPropuesta((e.currentTarget as HTMLInputElement).value)}
                      required
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Bloque Destacado: Monto Solicitado Original (S/) */}
            <div class="monto-hero-box">
              <div class="monto-hero-icon" aria-hidden="true">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <path d="M12 3L3 7.5L12 12L21 7.5L12 3Z" fill="#FFFFFF" />
                  <path d="M3 12L12 16.5L21 12" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                  <path d="M3 16.5L12 21L21 16.5" stroke="#C7D2FE" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </div>
              <div style={{ flex: 1 }}>
                <label
                  htmlFor="monto-solic-input"
                  style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#4c5574' }}
                >
                  Monto Solicitado Original (S/)
                </label>
                <div class="monto-hero-input-wrap">
                  <span class="monto-hero-prefix">S/</span>
                  <input
                    id="monto-solic-input"
                    class="monto-hero-input mono"
                    type="number"
                    step="0.01"
                    min="1"
                    value={montoSolicitado}
                    onInput={(e) => setMontoSolicitado((e.currentTarget as HTMLInputElement).value)}
                    required
                  />
                </div>
              </div>
            </div>
          </section>

          {/* TARJETA C: Conteo Táctil de Stock + Evidencia Documental + Semáforo Nitidez Soe */}
          <section class="campo-card">
            <div class="form-section-head">
              <span class="step-badge">
                <span class="step-num">1</span>
                <span>Conteo Táctil de Stock Físico</span>
              </span>
              <button
                type="button"
                class="btn btn-secondary btn-sm"
                onClick={handleStockReset}
              >
                Reiniciar a S/ 0.00 ↻
              </button>
            </div>

            <div class="stock-widget">
              <div class="stock-display">
                <label
                  htmlFor="inventario-stock-input"
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, color: '#3f486b', fontSize: '13px', cursor: 'pointer' }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M12 3L4 7.5V16.5L12 21L20 16.5V7.5L12 3Z" stroke="#4338CA" stroke-width="2" stroke-linejoin="round" />
                    <path d="M4 7.5L12 12L20 7.5M12 12V21" stroke="#4338CA" stroke-width="2" />
                  </svg>
                  <span>Inventario físico estimado en local</span>
                </label>
                <div class="stock-input-wrap">
                  <span class="stock-input-prefix">S/</span>
                  <input
                    id="inventario-stock-input"
                    class="stock-input mono"
                    type="text"
                    inputMode="decimal"
                    aria-label="Inventario físico estimado en local en Soles"
                    value={
                      editingStock
                        ? stockDraft
                        : formatPEN(inventarioStock).replace(/^S\/\s*/, '')
                    }
                    onFocus={(e) => {
                      setEditingStock(true);
                      setStockDraft(inventarioStock === 0 ? '' : String(inventarioStock));
                      (e.currentTarget as HTMLInputElement).select();
                    }}
                    onInput={(e) => handleStockInput((e.currentTarget as HTMLInputElement).value)}
                    onBlur={() => {
                      setEditingStock(false);
                      setStockDraft(String(inventarioStock));
                    }}
                  />
                </div>
              </div>
              <div class="tactile-row">
                <button
                  type="button"
                  class="tactile-btn step-10"
                  onClick={() => handleStockAdjust(10)}
                >
                  +10
                </button>
                <button
                  type="button"
                  class="tactile-btn step-50"
                  onClick={() => handleStockAdjust(50)}
                >
                  +50
                </button>
                <button
                  type="button"
                  class="tactile-btn step-100"
                  onClick={() => handleStockAdjust(100)}
                >
                  +100
                </button>
                <button
                  type="button"
                  class="tactile-btn"
                  onClick={() => handleStockAdjust(-10)}
                >
                  -10
                </button>
              </div>
            </div>

            <div class="form-section-head">
              <span class="step-badge">
                <span class="step-num">2</span>
                <span>Evidencia Documental (Hash SHA-256 + Semáforo de Nitidez Local)</span>
              </span>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                <select
                  class="search-select"
                  aria-label="Cargar uno de los 7 documentos del kit de Soe"
                  style={{ fontSize: '11.5px', padding: '5px 10px' }}
                  onChange={async (e) => {
                    const selectEl = e.currentTarget as HTMLSelectElement;
                    const id = selectEl.value;
                    selectEl.value = '';
                    if (!id) return;
                    const sample = SOE_KIT_DOCUMENTS_CATALOG.find((s) => s.id === id);
                    if (!sample) return;
                    const evalRes = await evaluarFotoCalidad({
                      nombre_archivo: sample.nombre_archivo,
                      texto_ocr: sample.texto_ocr,
                    });
                    setFotoEval(evalRes);
                    const hash = await sha256Hex(`${sample.tipo_documento}|${sample.texto_ocr}`);
                    setDocumentos([
                      {
                        doc_id: sample.id,
                        tipo_documento: sample.tipo_documento,
                        texto_ocr: evalRes.texto_sanitizado,
                        hash_sha256: hash,
                        nombre_archivo: sample.nombre_archivo,
                        semaforo_nitidez: evalRes.semaforo_nitidez,
                        perdida_detalle_texto: evalRes.perdida_detalle_texto,
                        requiere_nueva_foto: evalRes.requiere_nueva_foto,
                        contiene_importe_ambiguo_letras: evalRes.contiene_importe_ambiguo_letras,
                      },
                    ]);
                    onToast(`${sample.label} · ${sample.hallazgo_demostrado}`);
                  }}
                >
                  <option value="">+ Cargar 7 Docs Kit Soe…</option>
                  {SOE_KIT_DOCUMENTS_CATALOG.map((doc) => (
                    <option key={doc.id} value={doc.id}>
                      {doc.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  class="btn btn-secondary btn-sm"
                  onClick={handleTestBlurryNote}
                  title="Simula CS-06: foto con sombra y monto ambiguo 5.0OO.00"
                >
                  Probar Nota Borrosa (5.0OO.00)
                </button>
                <span class="badge badge-slate">{documentos.length} adjunto(s)</span>
              </div>
            </div>

            {/* Semáforo de Nitidez de Soe (Sección 7) */}
            {fotoEval && (
              <div
                class={`alert-banner ${
                  fotoEval.semaforo_nitidez === 'VERDE'
                    ? 'ok'
                    : fotoEval.semaforo_nitidez === 'AMARILLO'
                      ? 'warn'
                      : 'poka'
                }`}
                style={{ marginBottom: '12px', padding: '10px 12px' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <strong>
                    Semáforo de Nitidez Local: {fotoEval.semaforo_nitidez} (Pérdida:{' '}
                    {(fotoEval.perdida_detalle_texto * 100).toFixed(1)}%)
                  </strong>
                  <span class="badge badge-green">0 datos personales enviados</span>
                </div>
                <span style={{ fontSize: '12px' }}>{fotoEval.motivo}</span>
                {fotoEval.contiene_importe_ambiguo_letras && (
                  <span class="mono" style={{ fontSize: '11.5px', fontWeight: 800 }}>
                    Poka-Yoke OCR: Monto con letras ambiguas detectado (5.0OO.00 — prohibido adivinar dígitos)
                  </span>
                )}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '14px' }}>
              {documentos.map((doc) => (
                <div key={doc.doc_id} class="doc-item">
                  <div class="tile-icon" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <rect x="5" y="3" width="14" height="18" rx="3" stroke="currentColor" stroke-width="2" />
                      <path d="M9 8H15M9 12H15M9 16H13" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                    </svg>
                  </div>
                  <div class="doc-item-body">
                    <div class="doc-item-top">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                        <strong class="mono" style={{ fontSize: '12.5px' }}>{doc.doc_id}</strong>
                        <span class="badge badge-slate">{doc.tipo_documento}</span>
                        {doc.semaforo_nitidez && (
                          <span
                            class={`badge ${
                              doc.semaforo_nitidez === 'VERDE'
                                ? 'badge-green'
                                : doc.semaforo_nitidez === 'AMARILLO'
                                  ? 'badge-amber'
                                  : 'badge-red-solid'
                            }`}
                          >
                            Nitidez {doc.semaforo_nitidez}
                          </span>
                        )}
                        {doc.nombre_archivo && (
                          <span style={{ fontSize: '11.5px', color: '#7a83a1' }}>
                            ({doc.nombre_archivo})
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        class="btn btn-secondary btn-sm"
                        style={{ padding: '4px 10px' }}
                        onClick={() => handleRemoveDoc(doc.doc_id)}
                      >
                        Quitar
                      </button>
                    </div>
                    <div style={{ fontSize: '12.5px', color: '#3f486b' }}>{doc.texto_ocr}</div>
                    {API_BASE_URL && doc.nombre_archivo?.endsWith('.png') && (
                      <div style={{ marginTop: '8px' }}>
                        <img
                          src={`${API_BASE_URL}/imagenes_golden_samples/${doc.nombre_archivo}`}
                          alt={`Vista previa comprobante ${doc.nombre_archivo}`}
                          loading="lazy"
                          style={{
                            maxHeight: '165px',
                            maxWidth: '100%',
                            borderRadius: '10px',
                            border: '1px solid rgba(99, 102, 241, 0.25)',
                            display: 'block',
                          }}
                          onError={(ev) => {
                            (ev.currentTarget as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      </div>
                    )}
                    {doc.hash_sha256 && (
                      <div>
                        <span class="hash-chip mono">
                          # SHA-256: {truncateHash(doc.hash_sha256, 12, 8)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div class="field-grid" style={{ alignItems: 'end' }}>
              <div class="field">
                <label htmlFor="doc-type-select">
                  <span class="step-badge">
                    <span class="step-num" style={{ width: '20px', height: '20px', fontSize: '11px' }}>3</span>
                    <span>Tipo de Comprobante</span>
                  </span>
                </label>
                <select
                  id="doc-type-select"
                  value={newDocType}
                  onChange={(e) => setNewDocType((e.currentTarget as HTMLSelectElement).value)}
                >
                  {DOCUMENT_TYPES.map((dt) => (
                    <option key={dt.value} value={dt.value}>
                      {dt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div class="field">
                <label htmlFor="doc-file-input">Adjuntar foto / voucher (SHA-256)</label>
                <input
                  id="doc-file-input"
                  type="file"
                  accept="image/*,.pdf"
                  disabled={hashingFile}
                  onChange={handleFileAttach}
                />
              </div>
              <div class="field full">
                <label htmlFor="doc-text-input">
                  <span class="step-badge">
                    <span class="step-num" style={{ width: '20px', height: '20px', fontSize: '11px' }}>4</span>
                    <span>Texto OCR / detalle de boleta, nota manuscrita o voucher Yape/Plin</span>
                  </span>
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    id="doc-text-input"
                    type="text"
                    value={newDocText}
                    onInput={(e) => setNewDocText((e.currentTarget as HTMLInputElement).value)}
                    placeholder="Ej. Voucher Yape proveedor cuero -> S/ 2,850.00 (OCR: 0.96)"
                  />
                  <button
                    type="button"
                    class="btn btn-secondary"
                    onClick={handleAddTextEvidence}
                    disabled={!newDocText.trim()}
                  >
                    + Agregar
                  </button>
                </div>
              </div>
            </div>

            {formError && (
              <div class="alert-banner fraud" style={{ marginTop: '14px' }}>
                <strong>Validación:</strong>
                <span>{formError}</span>
              </div>
            )}

            {/* CTA Principal estilo cápsula degradada */}
            <div style={{ marginTop: '20px' }}>
              <button
                type="submit"
                class={`cta-submit-pill ${offline ? 'offline' : ''}`}
                disabled={submitting}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '10px' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="12" cy="12" r="9.5" fill="rgba(255,255,255,0.22)" />
                    <path
                      d="M8.5 12.2L10.8 14.5L15.8 9.5"
                      stroke="#FFFFFF"
                      stroke-width="2.2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                  <span>
                    {submitting
                      ? 'Evaluando…'
                      : offline
                        ? 'Guardar Offline'
                        : 'Evaluar Solicitud'}
                  </span>
                </span>
                <span aria-hidden="true" style={{ fontSize: '18px' }}>
                  ›
                </span>
              </button>
            </div>
          </section>
        </form>

        {/* Columna Derecha Sticky: Estado de Solicitud (con Segregación RF-07) + Cola Offline */}
        <aside class="campo-stack">
          <section class="campo-card">
            <div class="card-title-row" style={{ marginBottom: '12px' }}>
              <div class="card-title-left">
                <div class="card-icon-circle solid" aria-hidden="true">
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M7.5 12.3L10.5 15.3L16.8 9"
                      stroke="#FFFFFF"
                      stroke-width="2.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                </div>
                <h2 class="card-h">Estado de Solicitud (Asesor)</h2>
              </div>
              <span class="badge badge-green">Segregación RF-07</span>
            </div>

            {!lastAudit ? (
              <div class="verdict-ready-box">
                <div class="lane-empty-circle verde" style={{ width: '70px', height: '70px' }} aria-hidden="true">
                  <svg width="34" height="34" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" fill="#10B981" />
                    <path
                      d="M8.2 12.3L10.8 14.9L16 9.6"
                      stroke="#FFFFFF"
                      stroke-width="2.4"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                </div>
                <span class="badge badge-green" style={{ padding: '5px 14px', fontSize: '12.5px' }}>
                  ✓ Listo para evaluar
                </span>
                <div style={{ fontSize: '12px', color: '#4c5574', maxWidth: '260px' }}>
                  Selecciona uno de los <strong>6 Casos Simulados RIE-02</strong> arriba o captura
                  los datos y pulsa <strong>Analizar Solicitud</strong>.
                </div>
              </div>
            ) : (
              <div>
                <div class="verdict-exp-bar">
                  <span class="mono" style={{ fontWeight: 800, fontSize: '13px', color: '#141937' }}>
                    {lastAudit.expediente_id}
                  </span>
                  <span
                    class={`badge ${
                      asesorStatus?.label === 'Continuar'
                        ? 'badge-green'
                        : asesorStatus?.label === 'Verificar datos'
                          ? 'badge-slate'
                          : 'badge-red-solid'
                    }`}
                  >
                    {asesorStatus?.label}
                  </span>
                </div>

                {/* Mensaje operativo para el asesor según Segregación de Funciones (RF-07 / CP-03) */}
                {asesorStatus && (
                  <div
                    class={`alert-banner ${
                      asesorStatus.tone === 'verde'
                        ? 'ok'
                        : asesorStatus.tone === 'gris'
                          ? 'poka'
                          : 'fraud'
                    }`}
                    style={{ marginBottom: '12px', padding: '10px 12px' }}
                  >
                    <strong>Estado Operativo: {asesorStatus.label.toUpperCase()}</strong>
                    <span style={{ fontSize: '12px' }}>{asesorStatus.description}</span>
                  </div>
                )}

                {/* Toggle opcional para el presentador en la demo */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <span style={{ fontSize: '11.5px', color: '#64748b' }}>
                    0 PII enviados · {lastAudit.response.latencia_ms.toFixed(1)} ms
                  </span>
                  <button
                    type="button"
                    class="btn btn-secondary btn-sm"
                    style={{ fontSize: '11px', padding: '3px 8px' }}
                    onClick={() => setShowDemoTechDetail((v) => !v)}
                  >
                    {showDemoTechDetail ? 'Ocultar resumen financiero' : 'Ver resumen financiero'}
                  </button>
                </div>

                {showDemoTechDetail && (
                  <div class="verdict-metric-grid">
                    <div class="verdict-metric-tile">
                      <div class="verdict-metric-icon" aria-hidden="true">
                        <span style={{ fontWeight: 800, fontSize: '11px' }}>S/</span>
                      </div>
                      <div>
                        <div class="stat-tile-label">Solicitado</div>
                        <div class="mono" style={{ fontWeight: 800, fontSize: '13.5px' }}>
                          {formatPEN(lastAudit.response.dictamen_riesgos.monto_solicitado_original)}
                        </div>
                      </div>
                    </div>

                    <div class="verdict-metric-tile">
                      <div class="verdict-metric-icon" aria-hidden="true">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                          <path d="M5 17L10 12L14 15L19 8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
                        </svg>
                      </div>
                      <div>
                        <div class="stat-tile-label">Recomendado</div>
                        <div
                          class="mono"
                          style={{
                            fontWeight: 800,
                            fontSize: '13.5px',
                            color:
                              lastCol === 'VERDE'
                                ? '#047857'
                                : lastCol === 'AMBAR'
                                  ? '#b45309'
                                  : '#be123c',
                          }}
                        >
                          {formatPEN(lastAudit.response.dictamen_riesgos.monto_maximo_recomendado)}
                        </div>
                      </div>
                    </div>

                    <div class="verdict-metric-tile">
                      <div class="verdict-metric-icon" aria-hidden="true">
                        <span style={{ fontWeight: 800, fontSize: '12px' }}>Δ</span>
                      </div>
                      <div>
                        <div class="stat-tile-label">Delta Ventas</div>
                        <div class="mono" style={{ fontWeight: 800, fontSize: '13.5px' }}>
                          {formatDeltaPct(
                            lastAudit.response.triangulacion_financiera.delta_desviacion_declarativa
                          )}
                        </div>
                      </div>
                    </div>

                    <div class="verdict-metric-tile">
                      <div class="verdict-metric-icon" aria-hidden="true">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                          <circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="2" />
                          <path d="M12 12L16 9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
                        </svg>
                      </div>
                      <div>
                        <div class="stat-tile-label">RCC</div>
                        <div class="mono" style={{ fontWeight: 800, fontSize: '13.5px' }}>
                          {formatRCC(
                            lastAudit.response.triangulacion_financiera.ratio_cobertura_cuota_rcc
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {lastCycleSeconds !== null && (
                  <div class="cycle-proof-bar">
                    <span>Tiempo de ciclo Nodux Flow:</span>
                    <strong class="mono">{lastCycleSeconds.toFixed(1)} s</strong>
                    <span style={{ opacity: 0.7 }}>(vs 72h manual AS-IS)</span>
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                  <button
                    type="button"
                    class="btn btn-success btn-sm"
                    onClick={() => {
                      const text = buildAuditWhatsAppText(lastAudit);
                      window.open(buildWhatsAppUrl('', text), '_blank', 'noopener,noreferrer');
                    }}
                  >
                    WhatsApp
                  </button>
                  <button
                    type="button"
                    class="btn btn-secondary btn-sm"
                    onClick={() => openPrintModal(lastAudit)}
                  >
                    Acta SBS / PDF
                  </button>
                </div>

                <button
                  type="button"
                  class="btn btn-dark"
                  style={{ width: '100%' }}
                  onClick={() => onOpenConsola(lastAudit.expediente_id)}
                >
                  Abrir en Consola de Investigación (Grafo Red) →
                </button>
              </div>
            )}
          </section>

          {/* Cola Offline (IndexedDB) */}
          <section class="campo-card">
            <div class="card-title-row" style={{ marginBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span class={`pulse-dot ${offline || queueItems.length > 0 ? 'offline' : ''}`} />
                <h2 class="card-h" style={{ fontSize: '15px' }}>
                  Cola Offline (IndexedDB)
                </h2>
              </div>
              <span class={`badge ${queueItems.length > 0 ? 'badge-amber' : 'badge-green'}`}>
                {queueItems.length} pendiente(s)
              </span>
            </div>

            {queueItems.length === 0 ? (
              <div class="offline-cloud-box">
                <svg width="58" height="46" viewBox="0 0 64 50" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
                  <path
                    d="M18 42H48C54.6 42 60 36.8 60 30.5C60 24.7 55.6 19.9 49.8 19.2C48 11.1 40.7 5 32 5C22.4 5 14.5 12.4 13.7 21.8C8.3 22.8 4 27.5 4 33.2C4 38.1 7.9 42 13 42H18Z"
                    fill="#E0E7FF"
                  />
                  <path
                    d="M32 34V19M32 19L26 25M32 19L38 25"
                    stroke="#5B4DF5"
                    stroke-width="3"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
                <div>
                  <div style={{ fontWeight: 800, fontSize: '13.5px', color: '#141937', marginBottom: '2px' }}>
                    Respaldo sin conexión listo
                  </div>
                  <div style={{ fontSize: '12px', color: '#4c5574' }}>
                    Los datos se guardarán en IndexedDB y se sincronizarán automáticamente al volver la señal.
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {queueItems.map((item) => (
                  <div key={item.queue_id} class="doc-item" style={{ padding: '10px 12px' }}>
                    <div class="doc-item-body">
                      <div class="doc-item-top">
                        <strong class="mono" style={{ fontSize: '12px' }}>
                          {item.payload.expediente_id}
                        </strong>
                        <span class="badge badge-amber">En cola</span>
                      </div>
                      <div style={{ fontSize: '12px', color: '#4c5574' }}>
                        RUC {item.payload.ruc} · {formatPEN(item.payload.monto_solicitado_original)}{' '}
                        · {formatShortTime(item.created_at)}
                      </div>
                      {item.last_error && (
                        <div style={{ fontSize: '11px', color: 'var(--red-dark)' }}>
                          Último intento: {item.last_error}
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                <button
                  type="button"
                  class="btn btn-primary"
                  style={{ width: '100%' }}
                  disabled={offline || syncingQueue}
                  onClick={handleManualSync}
                >
                  {syncingQueue
                    ? 'Sincronizando cola…'
                    : offline
                      ? 'Esperando señal para sincronizar…'
                      : `Sincronizar ${queueItems.length} expediente(s) ahora`}
                </button>
              </div>
            )}
          </section>
        </aside>
      </div>

      {PrintModal && printRecord && (
        <PrintModal record={printRecord} onClose={() => setPrintRecord(null)} />
      )}
    </main>
  );
}
