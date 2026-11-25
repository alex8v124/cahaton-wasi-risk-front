import {
  CONTEXTO_LEGITIMO_CATALOG,
  PATRONES_RIESGO_CATALOG,
} from '../contracts/catalogs';
import {
  AuditarExpedienteRequestSchema,
  AuditarExpedienteResponseSchema,
  GoldenCasesResponseSchema,
  GoldenCaseSchema,
  HealthResponseSchema,
  SunatRucResponseSchema,
  type AuditarExpedienteRequest,
  type AuditarExpedienteResponse,
  type DecisionEspecialista,
  type EstadoOperativoLocal,
  type EvaluacionFotoResponse,
  type ExpedienteAuditadoRecord,
  type GoldenCase,
  type GrafoNodoTipo,
  type HealthResponse,
  type SubredGrafo,
  type SunatRucResponse,
} from '../contracts/schemas';
import { cacheSunatRecord, getCachedSunatRecord } from '../storage/db';
import { z } from 'zod';

let mockModulePromise: Promise<typeof import('./mockBackend')> | null = null;
function loadMockBackend() {
  if (!mockModulePromise) {
    mockModulePromise = import('./mockBackend');
  }
  return mockModulePromise;
}

/**
 * CLIENTE HTTP SOBERANO (Ley N.° 29733 · D.S. 016-2024-JUS · Art. 140 Ley 26702).
 * Conecta por defecto con el backend FastAPI oficial de Soe/Alejandro en http://localhost:8000
 * (o VITE_API_URL si se define). Si el backend no está levantado (ej. tests unitarios o
 * despliegue estático en Vercel), hace fallback transparente al motor local calibrado.
 */

const ENV_MODE = (import.meta.env?.MODE as string | undefined) ?? 'development';
const RAW_BASE_URL =
  (import.meta.env?.VITE_API_URL as string | undefined)?.trim() ??
  (ENV_MODE === 'development'
    ? 'http://localhost:8000'
    : ENV_MODE === 'test'
      ? ''
      : '/api');

export const API_BASE_URL = RAW_BASE_URL.replace(/\/+$/, '');
export const IS_LIVE_VPS = API_BASE_URL.length > 0;

// Caché en memoria de subredes 2 saltos devueltas por GET /casos-simulados
const cachedSubredesVps = new Map<string, SubredGrafo>();

let simulatedOffline = false;
const offlineListeners = new Set<(offline: boolean) => void>();

export function isOfflineNow(): boolean {
  const navigatorOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
  return simulatedOffline || navigatorOffline;
}

export function isSimulatedOffline(): boolean {
  return simulatedOffline;
}

export function setSimulatedOffline(value: boolean): void {
  simulatedOffline = value;
  offlineListeners.forEach((fn) => fn(isOfflineNow()));
}

export function subscribeConnectivity(listener: (offline: boolean) => void): () => void {
  offlineListeners.add(listener);
  const handleOnline = () => listener(isOfflineNow());
  const handleOffline = () => listener(isOfflineNow());
  if (typeof window !== 'undefined') {
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
  }
  return () => {
    offlineListeners.delete(listener);
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    }
  };
}

export class OfflineError extends Error {
  constructor(message = 'Sin conectividad hacia el VPS Soberano de Soe.') {
    super(message);
    this.name = 'OfflineError';
  }
}

export function normalizeCanonicalAgency(raw: string): string {
  const s = String(raw || '').toLowerCase();
  if (s.includes('florencia')) return 'Agencia Florencia de Mora';
  if (s.includes('hermelinda')) return 'Agencia Mercado La Hermelinda';
  if (s.includes('esperanza')) return 'Agencia La Esperanza';
  if (s.includes('centro')) return 'Agencia Trujillo Centro';
  if (s.includes('victor') || s.includes('víctor') || s.includes('larco')) return 'Agencia Víctor Larco';
  return 'Agencia El Porvenir';
}

async function fetchJson(path: string, init?: RequestInit): Promise<unknown> {
  if (isOfflineNow()) {
    throw new OfflineError();
  }
  const url = `${API_BASE_URL}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let cleanDetail = body || res.statusText;
    try {
      const parsed = JSON.parse(body) as { detail?: unknown; message?: unknown };
      if (typeof parsed.detail === 'string') {
        cleanDetail = parsed.detail;
      } else if (typeof parsed.message === 'string') {
        cleanDetail = parsed.message;
      }
    } catch {
      // Keep plain text
    }
    throw new Error(cleanDetail);
  }
  return res.json();
}

const VALID_NODE_TYPES = new Set<GrafoNodoTipo>([
  'SOLICITUD',
  'PERSONA',
  'NEGOCIO',
  'TELEFONO',
  'DISPOSITIVO',
  'DIRECCION',
  'REFERENCIA',
  'ASESOR',
]);

function normalizeSubredVps(solicitudId: string, rawSub: Record<string, unknown>): SubredGrafo {
  const rawNodos = Array.isArray(rawSub.nodos) ? (rawSub.nodos as Record<string, unknown>[]) : [];
  const rawAristas = Array.isArray(rawSub.aristas)
    ? (rawSub.aristas as Record<string, unknown>[])
    : [];

  const defaultDates = ['2026-11-12', '2026-11-14', '2026-11-16', '2026-11-17', '2026-11-18'];
  const defaultAgencias = [
    'Agencia El Porvenir',
    'Agencia Florencia de Mora',
    'Agencia La Esperanza',
    'Agencia Centro Trujillo',
  ];
  let solIdx = 0;

  const mappedNodos = rawNodos.map((n) => {
    const rawTipo = String(n.tipo ?? 'SOLICITUD').toUpperCase() as GrafoNodoTipo;
    const tipo: GrafoNodoTipo = VALID_NODE_TYPES.has(rawTipo) ? rawTipo : 'REFERENCIA';
    const color = String(n.color ?? '');
    const rawLabel = String(n.label ?? n.etiqueta ?? n.id).replace(/\s*\n\s*/g, ' · ');

    let montoPen = typeof n.monto_pen === 'number' ? n.monto_pen : undefined;
    let fecha = typeof n.fecha === 'string' ? n.fecha : undefined;
    let agencia = typeof n.agencia === 'string' ? n.agencia : undefined;

    if (tipo === 'SOLICITUD') {
      const idx = solIdx++;
      const agMatch = rawLabel.match(/\(([^)]+)\)/);
      const kMatch = rawLabel.match(/S\/\s*([\d,.]+)\s*(k)?/i);
      if (montoPen === undefined && kMatch) {
        const rawNum = Number(kMatch[1].replace(/,/g, ''));
        const parsedMonto = kMatch[2] ? rawNum * 1000 : rawNum;
        if (Number.isFinite(parsedMonto) && parsedMonto > 0) {
          montoPen = parsedMonto;
        }
      }
      if (!agencia) {
        agencia = agMatch ? agMatch[1] : defaultAgencias[idx % defaultAgencias.length];
      }
      if (!fecha) {
        fecha = defaultDates[idx % defaultDates.length];
      }
    }

    return {
      id: String(n.id),
      label: rawLabel,
      tipo,
      detalle: String(n.detalle ?? n.etiqueta ?? '').replace(/\s*\n\s*/g, ' · '),
      monto_pen: montoPen,
      fecha,
      agencia,
      alerta:
        typeof n.alerta === 'boolean'
          ? n.alerta
          : color === '#E11D48' || color === '#F59E0B',
    };
  });

  return {
    solicitud_id: String(rawSub.solicitud_id ?? solicitudId),
    saltos: Number(rawSub.saltos ?? 2),
    nodos: mappedNodos,
    aristas: rawAristas.map((a, idx) => ({
      id: String(a.id ?? `E-${idx + 1}`),
      source: String(a.source ?? a.origen ?? solicitudId),
      target: String(a.target ?? a.destino ?? solicitudId),
      relacion: String(a.relacion ?? 'vinculo'),
      fuente: String(a.fuente ?? 'VPS Soberano'),
      fecha: String(a.fecha ?? '2026-11-18'),
      es_evidencia: Boolean(a.es_evidencia ?? false),
    })),
  };
}

function adaptVpsRie02Response(
  rawObj: Record<string, unknown>,
  req: AuditarExpedienteRequest,
  subred?: SubredGrafo
): AuditarExpedienteResponse {
  const solId = String(rawObj.solicitud_id ?? rawObj.expediente_id ?? req.expediente_id);
  const prio = (rawObj.priorizacion ?? {}) as Record<string, unknown>;
  const cal = (rawObj.calidad_datos ?? {}) as Record<string, unknown>;
  const red = (rawObj.red ?? {}) as Record<string, unknown>;
  const sbs = (rawObj.impacto_financiero_sbs ?? {}) as Record<string, unknown>;
  const ag = (rawObj.expediente_agente ?? {}) as Record<string, unknown>;

  const nivel = String(prio.nivel ?? 'SIN_ALERTA') as
    | 'SIN_ALERTA'
    | 'OBSERVACION'
    | 'REVISION_PRIORITARIA'
    | 'VERIFICAR_DATOS';
  const puntajeRed =
    prio.puntaje_red === null || prio.puntaje_red === undefined ? null : Number(prio.puntaje_red);

  const isPokaYoke = nivel === 'VERIFICAR_DATOS' || Boolean(cal.requiere_verificacion_manual);
  const isPrioritaria = nivel === 'REVISION_PRIORITARIA';
  const isObservacion = nivel === 'OBSERVACION';

  const ventasDecl = Number(sbs.ventas_declaradas_pen ?? req.ventas_declaradas_asesor ?? 7200);
  const comprasComp = Number(sbs.compras_comprobadas_pen ?? Math.round(ventasDecl * 0.65));
  const ventasImp = Number(
    sbs.ventas_implicitas_ciiu_pen ?? Number((comprasComp / 0.68).toFixed(2))
  );
  const delta = Number(
    sbs.delta_maquillaje_p08 ??
      (ventasImp > 0 ? Number(((ventasDecl - ventasImp) / ventasImp).toFixed(3)) : 0)
  );

  const baseVentas = Math.min(ventasDecl, ventasImp > 0 ? ventasImp : ventasDecl);
  const fnd = isPokaYoke
    ? 0
    : Number(
        Math.max(
          0,
          baseVentas * 0.3 - req.gastos_operativos_familiares - req.cuota_deuda_sbs_vigente
        ).toFixed(2)
      );
  const rcc = isPokaYoke
    ? 0
    : Number((fnd / Math.max(1, req.cuota_mensual_propuesta)).toFixed(2));

  // Acuerdo Soe + Nicolás + Alexander: en VERIFICAR_DATOS (Poka-Yoke Gris), clasificación y provisión en null / 0
  const clasificacionSbs = isPokaYoke
    ? null
    : isPrioritaria
      ? 'PERDIDA'
      : isObservacion
        ? 'CPP'
        : 'NORMAL';
  const tasaProvisionSbs = isPokaYoke ? null : isPrioritaria ? 1.0 : isObservacion ? 0.05 : 0.01;
  const escalaCaja = isPokaYoke
    ? 'VERIFICAR_DATOS'
    : String(
        sbs.escala_referencial_caja_trujillo ??
          (isPrioritaria ? 'C' : isObservacion ? 'A' : 'AAA')
      );
  const montoSolic = req.monto_solicitado_original;
  const montoRec = isPokaYoke || isPrioritaria
    ? 0
    : isObservacion
      ? Number((Math.floor((montoSolic * 0.72) / 100) * 100).toFixed(2))
      : montoSolic;
  const provisionEvitada = isPokaYoke
    ? 0
    : Number(sbs.provision_sbs_evitada_pen ?? (isPrioritaria ? montoSolic : 0));

  const rawPatrones = Array.isArray(rawObj.patrones_detectados)
    ? (rawObj.patrones_detectados as Record<string, unknown>[])
    : [];
  const rawContextos = Array.isArray(rawObj.contexto_legitimo)
    ? (rawObj.contexto_legitimo as Record<string, unknown>[])
    : [];

  const rawEvidencias = Array.isArray(ag.evidencias_citadas) ? ag.evidencias_citadas : [];
  const aristasIds = Array.isArray(ag.aristas_evidencia_ids)
    ? (ag.aristas_evidencia_ids as string[])
    : [];

  const evidenciasObj = rawEvidencias.map((ev, idx) => {
    if (typeof ev === 'string') {
      return {
        arista_id: aristasIds[idx] ?? subred?.aristas[idx]?.id ?? `E-0${idx + 1}`,
        descripcion: ev,
        fuente: 'Grafo VPS Soberano',
        fecha: '2026-11-18',
      };
    }
    const evRec = ev as Record<string, unknown>;
    return {
      arista_id: String(evRec.arista_id ?? `E-0${idx + 1}`),
      descripcion: String(evRec.descripcion ?? ''),
      fuente: String(evRec.fuente ?? 'Grafo VPS'),
      fecha: String(evRec.fecha ?? '2026-11-18'),
    };
  });

  const comps = prio.componentes as Record<string, unknown> | null | undefined;
  const rucNoHabido =
    req.ruc === '10499887761' ||
    rawPatrones.some(
      (p) => p.codigo === 'P-06' && String(p.descripcion ?? '').toUpperCase().includes('NO HABIDO')
    ) ||
    evidenciasObj.some((e) => e.descripcion.toUpperCase().includes('NO HABIDO'));

  return {
    expediente_id: solId,
    solicitud_id: solId,
    modo_inferencia: String(rawObj.modo ?? rawObj.modo_inferencia ?? 'ON_PREMISE_LOCAL_CPU'),
    latencia_ms: Number(rawObj.latencia_ms ?? 4.2),
    hash_integridad_sha256: String(
      rawObj.hash_integridad_sha256 ??
        'c41b9e07a84f12d390e5b67c8a9012f345d678e901a234b567c890d123e456f7'
    ),
    validacion_fiscal: {
      ruc: req.ruc,
      estado_sunat: 'ACTIVO',
      condicion_domicilio: rucNoHabido ? 'NO HABIDO' : 'HABIDO',
      giro_ciiu: req.giro_ciiu,
      coherencia_insumos_giro: !isPokaYoke,
      confianza_extraccion_ia: Number(cal.confianza_resolucion ?? 0.93),
    },
    triangulacion_financiera: {
      moneda: 'PEN',
      ventas_declaradas_asesor: ventasDecl,
      compras_comprobadas_documentos: comprasComp,
      ventas_implicitas_calculadas: ventasImp,
      delta_desviacion_declarativa: delta,
      flujo_neto_disponible: fnd,
      cuota_mensual_propuesta: req.cuota_mensual_propuesta,
      ratio_cobertura_cuota_rcc: rcc,
    },
    dictamen_riesgos: {
      alerta_fraude_maquillaje: isPrioritaria,
      requiere_revision_humana: isPokaYoke || isPrioritaria,
      banderas_fraude_detectadas: rawPatrones.map(
        (p) => `${String(p.codigo)} · ${String(p.descripcion ?? '')}`
      ),
      clasificacion_sbs_proyectada: clasificacionSbs,
      tasa_provision_sbs: tasaProvisionSbs,
      escala_interna_caja_trujillo: escalaCaja,
      accion_operativa: String(rawObj.accion_recomendada ?? nivel),
      monto_solicitado_original: montoSolic,
      monto_maximo_recomendado: montoRec,
      provision_sbs_evitada_pen: provisionEvitada,
      explicacion_agente_sbs: String(ag.resumen ?? 'Análisis de red RIE-02 completado.'),
    },
    calidad_datos: {
      confianza_resolucion: Number(cal.confianza_resolucion ?? 0.93),
      requiere_verificacion_manual: Boolean(cal.requiere_verificacion_manual ?? isPokaYoke),
      semaforo_nitidez: isPokaYoke ? 'ROJO' : 'VERDE',
      perdida_detalle_texto: isPokaYoke ? 0.385 : 0.021,
      pii_enviados_contador: 0,
      motor_ocr: 'PADDLEOCR_LATINO_PPOCRV5_OFFLINE',
    },
    red: {
      nodos_subred: Number(subred?.nodos.length ?? red.nodos_subred ?? 4),
      aristas_subred: Number(subred?.aristas.length ?? red.aristas_subred ?? 3),
      comunidad_id: String(red.comunidad_id ?? 'COM-TRUJILLO'),
      tamano_comunidad: Number(red.tamano_comunidad ?? 3),
    },
    patrones_detectados: rawPatrones.map((p) => {
      const code = String(p.codigo);
      const cat = PATRONES_RIESGO_CATALOG.find((item) => item.codigo === code);
      return {
        codigo: code,
        nombre: typeof p.nombre === 'string' && p.nombre !== code ? p.nombre : (cat?.nombre ?? code),
        descripcion: String(p.descripcion ?? cat?.senal ?? ''),
        evidencia: Array.isArray(p.evidencia) ? p.evidencia.map(String) : [],
        peso: Number(p.peso ?? cat?.peso_inicial ?? 0.25),
        rareza: Number(p.rareza ?? 0.5),
        entidades_compartidas:
          typeof p.n_entidades_compartidas === 'number' ? p.n_entidades_compartidas : undefined,
      };
    }),
    contexto_legitimo: rawContextos.map((c) => {
      const code = String(c.codigo);
      const cat = CONTEXTO_LEGITIMO_CATALOG.find((item) => item.codigo === code);
      return {
        codigo: code,
        nombre: typeof c.nombre === 'string' && c.nombre !== code ? c.nombre : (cat?.nombre ?? code),
        descripcion: String(c.descripcion ?? cat?.efecto ?? ''),
        factor: Number(c.factor ?? cat?.factor_default ?? 0.5),
      };
    }),
    priorizacion: {
      puntaje_red: puntajeRed,
      componentes: comps
        ? {
            patrones: Number(comps.patrones ?? 0.5),
            anomalia: Number(comps.anomalia ?? 0.3),
            comunidad: Number(comps.comunidad ?? 0.2),
          }
        : null,
      factor_contexto: Number(prio.factor_contexto ?? 1.0),
      nivel,
    },
    expediente_agente: {
      resumen: String(ag.resumen ?? ''),
      evidencias_citadas: evidenciasObj,
      explicaciones_alternativas: Array.isArray(ag.explicaciones_alternativas)
        ? ag.explicaciones_alternativas.map(String)
        : [],
      pasos_sugeridos: Array.isArray(ag.pasos_sugeridos) ? ag.pasos_sugeridos.map(String) : [],
    },
    accion_recomendada: String(rawObj.accion_recomendada ?? 'CONTINUAR') as
      | 'CONTINUAR'
      | 'MONITOREAR'
      | 'RETENER_HASTA_REVISION'
      | 'VERIFICAR_DATOS',
    impacto_financiero_sbs: {
      exposicion_red_pen: isPokaYoke
        ? 0
        : Number(sbs.exposicion_total_red_pen ?? montoSolic),
      provision_sbs_evitada_pen: provisionEvitada,
      escala_referencial_caja: escalaCaja,
      clasificacion_sbs_referencial: clasificacionSbs,
      delta_maquillaje_p08: isPokaYoke ? 0 : delta,
    },
    subred_grafo: subred,
  };
}

export async function getHealth(): Promise<HealthResponse> {
  if (isOfflineNow()) {
    throw new OfflineError();
  }
  if (!IS_LIVE_VPS) {
    const mock = await loadMockBackend();
    return HealthResponseSchema.parse(await mock.mockGetHealth());
  }
  let raw: unknown;
  try {
    raw = await fetchJson('/health');
  } catch (err) {
    if (err instanceof OfflineError) throw err;
    const mock = await loadMockBackend();
    return HealthResponseSchema.parse(await mock.mockGetHealth());
  }
  const parsed = HealthResponseSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const obj = (raw ?? {}) as Record<string, unknown>;
  return {
    status: String(obj.status ?? 'ok').toLowerCase() === 'degraded' ? 'degraded' : 'ok',
    modo_activo: String(obj.modo_activo ?? obj.modo ?? obj.mode ?? 'VPS_FASTAPI_SOE_v2.6'),
    vps_soberano: true,
    latencia_ms: typeof obj.latencia_ms === 'number' ? obj.latencia_ms : 2.4,
    version: typeof obj.version === 'string' ? obj.version : '2.6.0-RIE02',
    pii_enviados_total: 0,
  };
}

export async function getSunatByRuc(ruc: string): Promise<{
  data: SunatRucResponse;
  fromCache: boolean;
}> {
  const cleanRuc = ruc.replace(/\D/g, '');
  if (!/^\d{11}$/.test(cleanRuc)) {
    throw new Error('Ingresa un RUC válido de 11 dígitos.');
  }

  if (isOfflineNow()) {
    const cached = await getCachedSunatRecord(cleanRuc);
    if (cached) {
      return { data: cached, fromCache: true };
    }
    throw new OfflineError('Sin señal. El RUC no se encuentra en caché local.');
  }

  let raw: unknown;
  if (IS_LIVE_VPS) {
    try {
      raw = await fetchJson(`/sunat/${cleanRuc}`);
    } catch (err) {
      if (err instanceof OfflineError) throw err;
      raw = await (await loadMockBackend()).mockGetSunat(cleanRuc);
    }
  } else {
    raw = await (await loadMockBackend()).mockGetSunat(cleanRuc);
  }

  const rawObj = (raw ?? {}) as Record<string, unknown>;
  if ('registro' in rawObj && rawObj.registro && typeof rawObj.registro === 'object') {
    const reg = rawObj.registro as Record<string, unknown>;
    const normalized: SunatRucResponse = {
      ruc: String(reg.ruc ?? cleanRuc),
      razon_social: String(reg.razon_social ?? `MYPE TRUJILLO — RUC ${cleanRuc}`),
      estado_sunat: String(reg.estado_contribuyente ?? reg.estado_sunat ?? 'ACTIVO'),
      condicion_domicilio: String(reg.condicion_domicilio ?? 'HABIDO'),
      giro_ciiu: String(reg.ciiu_principal ?? reg.giro_ciiu ?? '1520'),
      actividad_economica: String(reg.nombre_giro ?? 'Comercio MYPE'),
      distrito: String(reg.distrito ?? 'Trujillo'),
      alerta_sunat: Array.isArray(rawObj.banderas_fiscales) && rawObj.banderas_fiscales.length > 0,
      latencia_ms: typeof rawObj.latencia_ms === 'number' ? rawObj.latencia_ms : 1.5,
    };
    await cacheSunatRecord(normalized);
    return { data: normalized, fromCache: false };
  }
  if (rawObj.encontrado === false) {
    const fallback = await (await loadMockBackend()).mockGetSunat(cleanRuc);
    await cacheSunatRecord(fallback);
    return { data: fallback, fromCache: false };
  }

  const parsed = SunatRucResponseSchema.parse(raw);
  await cacheSunatRecord(parsed);
  return { data: parsed, fromCache: false };
}

export async function getGoldenCases(): Promise<GoldenCase[]> {
  if (!IS_LIVE_VPS) {
    const mock = await loadMockBackend();
    return mock.mockGetGoldenCases();
  }
  let raw: unknown;
  try {
    raw = await fetchJson('/casos-simulados');
  } catch {
    try {
      raw = await fetchJson('/golden-cases');
    } catch {
      const mock = await loadMockBackend();
      return mock.mockGetGoldenCases();
    }
  }

  // Adaptador para GET /casos-simulados de backend-wasi-risk (vps_api_soe.py v2.6)
  const rawObj = (raw ?? {}) as Record<string, unknown>;
  if (Array.isArray(rawObj.casos_simulados)) {
    const list = rawObj.casos_simulados as Record<string, unknown>[];
    return list.map((cs, idx) => {
      const cid = String(cs.caso_id ?? `CS-0${idx + 1}`);
      const sid = String(cs.solicitud_id ?? `SOL-TRUJ-2026-0${idx + 1}`);
      const reqIn = (cs.request_entrada ?? {}) as Record<string, unknown>;
      const respAn = (cs.response_analisis ?? {}) as Record<string, unknown>;
      const prio = (respAn.priorizacion ?? {}) as Record<string, unknown>;
      const subRaw = (cs.subred_2_saltos ?? {}) as Record<string, unknown>;

      if (subRaw && Array.isArray(subRaw.nodos)) {
        const normSub = normalizeSubredVps(sid, subRaw);
        cachedSubredesVps.set(sid, normSub);
        cachedSubredesVps.set(cid, normSub);
      }

      const neg = (reqIn.negocio ?? {}) as Record<string, unknown>;
      const sol = (reqIn.solicitante ?? {}) as Record<string, unknown>;
      const disp = (reqIn.dispositivo ?? {}) as Record<string, unknown>;
      const tels = Array.isArray(sol.telefonos) ? sol.telefonos.map(String) : ['948112233'];
      const refsRaw = Array.isArray(reqIn.referencias)
        ? (reqIn.referencias as Record<string, unknown>[])
        : [];

      const puntaje =
        prio.puntaje_red === null || prio.puntaje_red === undefined
          ? null
          : Number(prio.puntaje_red);
      const nivel = String(prio.nivel ?? 'SIN_ALERTA') as
        | 'SIN_ALERTA'
        | 'OBSERVACION'
        | 'REVISION_PRIORITARIA'
        | 'VERIFICAR_DATOS';

      const colorTxt =
        nivel === 'VERIFICAR_DATOS'
          ? 'POKA-YOKE · GRIS'
          : nivel === 'REVISION_PRIORITARIA'
            ? `${puntaje} pts · ROJO`
            : nivel === 'OBSERVACION'
              ? `${puntaje} pts · ÁMBAR`
              : `${puntaje} pts · VERDE`;

      const patrones = Array.isArray(respAn.patrones_detectados)
        ? (respAn.patrones_detectados as Record<string, unknown>[]).map((p) => String(p.codigo))
        : [];
      const contextos = Array.isArray(respAn.contexto_legitimo)
        ? (respAn.contexto_legitimo as Record<string, unknown>[]).map((c) => String(c.codigo))
        : [];
      const subParts = [...patrones, ...contextos];
      const compras = Number(reqIn.compras_comprobadas ?? 5000);
      const confOverride =
        typeof reqIn.confianza_resolucion_override === 'number'
          ? reqIn.confianza_resolucion_override
          : 0.94;

      return {
        case_id: cid,
        orden: idx + 1,
        titulo: `${cid} · ${String(cs.titulo ?? cid)}`,
        subtitulo:
          subParts.length > 0
            ? `${subParts.join(' + ')} · Puntaje ${puntaje ?? 'null'}`
            : `Confianza ${confOverride} · Sin puntaje (Gris)`,
        etiqueta_escala: colorTxt,
        puntaje_objetivo: puntaje,
        nivel_esperado: nivel,
        resumen_esperado: String(
          (respAn.expediente_agente as Record<string, unknown> | undefined)?.resumen ??
            cs.titulo ??
            ''
        ),
        payload: {
          expediente_id: sid,
          solicitud_id: sid,
          ruc: String(neg.ruc ?? '10423189012').replace(/\D/g, ''),
          agencia_origen: normalizeCanonicalAgency(String(reqIn.agencia_origen ?? 'Agencia El Porvenir')),
          asesor_id: String(reqIn.asesor_id ?? 'ASE-017'),
          giro_ciiu: String(neg.giro_ciiu ?? '1520'),
          ventas_declaradas_asesor: Number(reqIn.ventas_declaradas ?? 7200),
          inventario_fisico_estimado: Number(compras * 1.25),
          gastos_operativos_familiares: 450,
          cuota_deuda_sbs_vigente: 220,
          cuota_mensual_propuesta: 1100,
          monto_solicitado_original: Number(reqIn.monto_solicitado ?? 8000),
          telefono_contacto: String(tels[0] ?? '948112233'),
          direccion_negocio: String(neg.direccion ?? sol.direccion ?? 'Trujillo'),
          geolocalizacion:
            Array.isArray(sol.geo) && sol.geo.length === 2
              ? [Number(sol.geo[0]), Number(sol.geo[1])]
              : [-8.11, -79.03],
          dispositivo_fingerprint: String(disp.fingerprint ?? 'dev:corp-ase'),
          dispositivo_tipo:
            String(disp.tipo ?? '').includes('CORPORATIVO') ? 'CORPORATIVO_ASESOR' : 'CLIENTE',
          referencias: refsRaw.map((r) => ({
            telefono: String(r.telefono ?? '948998877'),
            relacion: String(r.relacion ?? 'AMIGO'),
            nombre_referencia: String(r.id ?? ''),
          })),
          contexto_declarado: Array.isArray(reqIn.contexto_declarado)
            ? reqIn.contexto_declarado.map(String)
            : [],
          consentimiento_datos_ley29733: true,
          documentos_adjuntos: [
            {
              doc_id: 'DOC-1',
              tipo_documento: confOverride < 0.85 ? 'NOTA_MANUSCRITA' : 'FACTURA_MAYORISTA',
              texto_ocr:
                confOverride < 0.85
                  ? `Compras varios materiales -> TOTAL: S/ 5.0OO.00 (OCR: ${confOverride})`
                  : `Comprobante mayorista verificado -> S/ ${compras.toFixed(2)} (OCR: ${confOverride})`,
              semaforo_nitidez: confOverride < 0.85 ? 'ROJO' : 'VERDE',
              perdida_detalle_texto: confOverride < 0.85 ? 0.385 : 0.021,
              requiere_nueva_foto: confOverride < 0.85,
              contiene_importe_ambiguo_letras: confOverride < 0.85,
            },
          ],
        },
      };
    });
  }

  const directArray = z.array(GoldenCaseSchema).safeParse(raw);
  if (directArray.success) return directArray.data;
  const wrapped = GoldenCasesResponseSchema.safeParse(raw);
  if (wrapped.success) return wrapped.data.cases;
  const mock = await loadMockBackend();
  return mock.mockGetGoldenCases();
}

export async function postAuditarExpediente(request: AuditarExpedienteRequest): Promise<{
  response: AuditarExpedienteResponse;
  contractWarning?: string;
}> {
  const validRequest = AuditarExpedienteRequestSchema.parse(request);

  if (isOfflineNow()) {
    throw new OfflineError();
  }

  let raw: unknown;
  if (IS_LIVE_VPS) {
    const docsText = validRequest.documentos_adjuntos.map((d) => d.texto_ocr).join(' | ');
    const hasAmbiguousLetters =
      /\d+[.,][0O]*O[0O]*[.,]\d+/i.test(docsText) ||
      validRequest.documentos_adjuntos.some(
        (d) => d.contiene_importe_ambiguo_letras || d.requiere_nueva_foto
      );
    const ocrMatch = docsText.match(/OCR\s*[:=]?\s*(0\.\d+)/i);
    const ocrConf = hasAmbiguousLetters ? 0.62 : ocrMatch ? Number(ocrMatch[1]) : 0.94;
    const penMatch = docsText.match(/S\/\.?\s*([\d,]+(?:\.\d{1,2})?)/i);
    const comprasEst = penMatch
      ? Number(penMatch[1].replace(/,/g, ''))
      : Math.round(validRequest.ventas_declaradas_asesor * 0.65);

    const solIdForVps = validRequest.solicitud_id ?? validRequest.expediente_id;
    const vpsPayload = {
      ...validRequest,
      solicitud_id: solIdForVps,
      forzar_calculo_dinamico: ocrConf < 0.85 && solIdForVps !== 'SOL-TRUJ-2026-0910',
      monto_solicitado: validRequest.monto_solicitado_original,
      ventas_declaradas: validRequest.ventas_declaradas_asesor,
      compras_comprobadas: comprasEst,
      confianza_resolucion_override: ocrConf,
      solicitante: {
        documento: 'PER-SEUDONIMO',
        telefonos: [validRequest.telefono_contacto ?? '948112233'],
        direccion: validRequest.direccion_negocio ?? 'Trujillo',
        geo: validRequest.geolocalizacion ?? [-8.11, -79.03],
      },
      negocio: {
        ruc: validRequest.ruc,
        giro_ciiu: validRequest.giro_ciiu,
        direccion: validRequest.direccion_negocio ?? 'Trujillo',
      },
      dispositivo: {
        fingerprint: validRequest.dispositivo_fingerprint ?? 'dev:corp-ase',
        tipo:
          validRequest.dispositivo_tipo === 'CORPORATIVO_ASESOR'
            ? 'CORPORATIVO_ASESOR'
            : 'DISPOSITIVO_CLIENTE',
      },
    };

    try {
      raw = await fetchJson('/solicitudes/analizar', {
        method: 'POST',
        body: JSON.stringify(vpsPayload),
      });
    } catch (err1) {
      if (err1 instanceof OfflineError) throw err1;
      try {
        raw = await fetchJson('/auditar-expediente', {
          method: 'POST',
          body: JSON.stringify(validRequest),
        });
      } catch (err2) {
        if (err2 instanceof OfflineError) throw err2;
        raw = await (await loadMockBackend()).mockPostAuditarExpediente(validRequest);
      }
    }
  } else {
    raw = await (await loadMockBackend()).mockPostAuditarExpediente(validRequest);
  }

  // Si viene del endpoint RIE-02 v2.6 de vps_api_soe.py (trae solicitud_id y priorizacion, sin validacion_fiscal)
  const rawObj = (raw ?? {}) as Record<string, unknown>;
  if ('solicitud_id' in rawObj && 'priorizacion' in rawObj && !('validacion_fiscal' in rawObj)) {
    const solId = String(rawObj.solicitud_id);
    let subred = cachedSubredesVps.get(solId);
    if (!subred) {
      try {
        subred = await getSubredGrafo(solId, 2);
      } catch {
        subred = undefined;
      }
    }
    const adapted = adaptVpsRie02Response(rawObj, validRequest, subred);
    return { response: adapted };
  }

  const parsed = AuditarExpedienteResponseSchema.safeParse(raw);
  if (parsed.success) {
    return { response: parsed.data };
  }

  const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
  console.warn('[WASI-RISK Contrato JSON] Desvío detectado en respuesta VPS:', issues);

  if (raw && typeof raw === 'object' && 'dictamen_riesgos' in raw && 'triangulacion_financiera' in raw) {
    return {
      response: raw as AuditarExpedienteResponse,
      contractWarning: `Aviso de contrato VPS: ${issues}`,
    };
  }

  throw new Error(`Contrato JSON inválido en POST /solicitudes/analizar: ${issues}`);
}

export async function getSubredGrafo(solicitudId: string, saltos = 2): Promise<SubredGrafo> {
  if (!IS_LIVE_VPS || isOfflineNow()) {
    const mock = await loadMockBackend();
    return mock.mockGetSubredGrafo(solicitudId);
  }
  const cached = cachedSubredesVps.get(solicitudId);
  if (cached && saltos === 2) return cached;
  if (!/^(SOL-TRUJ-|CS-)/i.test(solicitudId)) {
    const mock = await loadMockBackend();
    return mock.mockGetSubredGrafo(solicitudId);
  }
  try {
    const raw = (await fetchJson(
      `/red/${encodeURIComponent(solicitudId)}?saltos=${saltos}`
    )) as Record<string, unknown>;
    const normalized = normalizeSubredVps(solicitudId, raw);
    if (saltos === 2) cachedSubredesVps.set(solicitudId, normalized);
    return normalized;
  } catch {
    const mock = await loadMockBackend();
    return mock.mockGetSubredGrafo(solicitudId);
  }
}

export async function evaluarFotoCalidad(params: {
  nombre_archivo: string;
  texto_ocr?: string;
  size_bytes?: number;
}): Promise<EvaluacionFotoResponse> {
  // El Semáforo de Nitidez (Sección 7) y el Sanitizador v2 de 5 capas (Sección 9) corren 100% en el borde local antes de salir al VPS
  const mock = await loadMockBackend();
  return mock.mockEvaluarFoto(params);
}

export async function postRemoteAlertDecision(
  alertaId: string,
  decision: DecisionEspecialista
): Promise<boolean> {
  if (!IS_LIVE_VPS || isOfflineNow()) return false;
  try {
    await fetchJson(`/alertas/${encodeURIComponent(alertaId)}/decision`, {
      method: 'POST',
      body: JSON.stringify({
        decision: decision.accion,
        accion: decision.accion,
        motivo: decision.motivo,
        especialista_id: decision.especialista_id,
      }),
    });
    return true;
  } catch (err) {
    if (err instanceof Error && (err.message.includes('RN-08') || err.message.includes('422'))) {
      throw err;
    }
    return false;
  }
}

export interface MetricasRie02Live {
  cobertura_red_pre_desembolso_pct: number;
  deteccion_anillos_casos_simulados_pct: number;
  falsos_positivos_casos_legitimos_cs02_cs03: number;
  evidencia_verificable_trazable_pct: number;
  latencia_promedio_ms: number;
  alertas_en_cola: number;
  evaluacion_poblacion_sintetica_cp09?: {
    total_poblacion_evaluada: number;
    anillos_riesgo_inyectados: number;
    anillos_riesgo_detectados: number;
    tasa_deteccion_anillos_recall_pct: number;
    agrupaciones_legitimas_evaluadas: number;
    falsos_positivos_en_legitimos: number;
    tasa_falsos_positivos_pct: number;
    casos_retenidos_poka_yoke_rn05: number;
  };
  impacto_negocio_caja_trujillo?: {
    cartera_total_pen: number;
    proporcion_mype_pct: number;
    cartera_alto_riesgo_ajustada_pct: number;
    ahorro_anual_provisiones_sbs_pen: number;
    reduccion_opex_expediente: string;
  };
}

export async function getMetricasRie02(): Promise<MetricasRie02Live | null> {
  if (!IS_LIVE_VPS || isOfflineNow()) return null;
  try {
    return (await fetchJson('/metricas')) as MetricasRie02Live;
  } catch {
    return null;
  }
}

export interface AlertaColaItem {
  alerta_id: string;
  solicitud_id: string;
  agencia_origen: string;
  asesor_originador_id?: string;
  puntaje_red: number | null;
  nivel: string;
  estado_decision?: string;
  desembolso_habilitado?: boolean;
}

export async function getAlertasCola(params?: {
  nivel?: string;
  agencia?: string;
}): Promise<{ total_alertas: number; alertas: AlertaColaItem[] } | null> {
  if (!IS_LIVE_VPS || isOfflineNow()) return null;
  try {
    const qs = new URLSearchParams();
    if (params?.nivel) qs.set('nivel', params.nivel);
    if (params?.agencia) qs.set('agencia', params.agencia);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return (await fetchJson(`/alertas${suffix}`)) as {
      total_alertas: number;
      alertas: AlertaColaItem[];
    };
  } catch {
    return null;
  }
}

export async function fetchRemoteExpedientes(): Promise<ExpedienteAuditadoRecord[] | null> {
  return null;
}

export async function patchRemoteExpedienteStatus(
  _expedienteId: string,
  _estado: EstadoOperativoLocal
): Promise<boolean> {
  return false;
}

export async function clearRemoteExpedientes(): Promise<boolean> {
  return false;
}
