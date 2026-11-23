import type {
  DecisionEspecialista,
  EstadoOperativoLocal,
  ExpedienteAuditadoRecord,
  OfflineQueueItem,
  SunatRucResponse,
} from '../contracts/schemas';

const DB_NAME = 'wasi_risk_sentinel_db';
const DB_VERSION = 1;
const STORE_EXPEDIENTES = 'expedientes';
const STORE_QUEUE = 'offline_queue';
const STORE_SUNAT = 'sunat_cache';
const CHANNEL_NAME = 'wasi-risk-sentinel-sync';

export type SyncEventType =
  | { type: 'EXPEDIENTE_UPSERT'; expediente_id: string }
  | { type: 'EXPEDIENTE_STATUS'; expediente_id: string; estado: EstadoOperativoLocal }
  | { type: 'EXPEDIENTES_CLEARED' }
  | { type: 'QUEUE_UPDATED'; count: number };

type SyncListener = (event: SyncEventType) => void;

const localListeners = new Set<SyncListener>();
let broadcastChannel: BroadcastChannel | null = null;

// In-memory fallback (para tests Vitest o contextos sin IndexedDB)
const memExpedientes = new Map<string, ExpedienteAuditadoRecord>();
const memQueue = new Map<string, OfflineQueueItem>();
const memSunat = new Map<string, SunatRucResponse>();

function ensureChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!broadcastChannel) {
    broadcastChannel = new BroadcastChannel(CHANNEL_NAME);
    broadcastChannel.onmessage = (ev: MessageEvent<SyncEventType>) => {
      if (ev.data && typeof ev.data.type === 'string') {
        localListeners.forEach((fn) => fn(ev.data));
      }
    };
  }
  return broadcastChannel;
}

export function subscribeSync(listener: SyncListener): () => void {
  ensureChannel();
  localListeners.add(listener);
  return () => {
    localListeners.delete(listener);
  };
}

function notifySync(event: SyncEventType): void {
  localListeners.forEach((fn) => fn(event));
  try {
    ensureChannel()?.postMessage(event);
  } catch {
    // Ignore closed channel
  }
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_EXPEDIENTES)) {
          db.createObjectStore(STORE_EXPEDIENTES, { keyPath: 'expediente_id' });
        }
        if (!db.objectStoreNames.contains(STORE_QUEUE)) {
          db.createObjectStore(STORE_QUEUE, { keyPath: 'queue_id' });
        }
        if (!db.objectStoreNames.contains(STORE_SUNAT)) {
          db.createObjectStore(STORE_SUNAT, { keyPath: 'ruc' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise.catch(() => null);
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ── Expedientes auditados (Plano 1 → Plano 2 Kanban en tiempo real) ──

export async function saveExpediente(record: ExpedienteAuditadoRecord): Promise<void> {
  const db = await openDB();
  if (!db) {
    memExpedientes.set(record.expediente_id, record);
  } else {
    const tx = db.transaction(STORE_EXPEDIENTES, 'readwrite');
    await reqToPromise(tx.objectStore(STORE_EXPEDIENTES).put(record));
  }
  notifySync({ type: 'EXPEDIENTE_UPSERT', expediente_id: record.expediente_id });
}

export async function listExpedientes(): Promise<ExpedienteAuditadoRecord[]> {
  const db = await openDB();
  let items: ExpedienteAuditadoRecord[];
  if (!db) {
    items = Array.from(memExpedientes.values());
  } else {
    const tx = db.transaction(STORE_EXPEDIENTES, 'readonly');
    items = (await reqToPromise(tx.objectStore(STORE_EXPEDIENTES).getAll())) ?? [];
  }
  return items.sort((a, b) => b.actualizado_en.localeCompare(a.actualizado_en));
}

export async function updateExpedienteStatus(
  expedienteId: string,
  estado: EstadoOperativoLocal
): Promise<ExpedienteAuditadoRecord | null> {
  const db = await openDB();
  let existing: ExpedienteAuditadoRecord | undefined;
  if (!db) {
    existing = memExpedientes.get(expedienteId);
  } else {
    const tx = db.transaction(STORE_EXPEDIENTES, 'readonly');
    existing = await reqToPromise(tx.objectStore(STORE_EXPEDIENTES).get(expedienteId));
  }
  if (!existing) return null;

  const updated: ExpedienteAuditadoRecord = {
    ...existing,
    estado_local: estado,
    actualizado_en: new Date().toISOString(),
  };

  if (!db) {
    memExpedientes.set(expedienteId, updated);
  } else {
    const tx = db.transaction(STORE_EXPEDIENTES, 'readwrite');
    await reqToPromise(tx.objectStore(STORE_EXPEDIENTES).put(updated));
  }
  notifySync({ type: 'EXPEDIENTE_STATUS', expediente_id: expedienteId, estado });
  return updated;
}

export async function saveSpecialistDecision(
  expedienteId: string,
  decision: DecisionEspecialista
): Promise<ExpedienteAuditadoRecord | null> {
  const db = await openDB();
  let existing: ExpedienteAuditadoRecord | undefined;
  if (!db) {
    existing = memExpedientes.get(expedienteId);
  } else {
    const tx = db.transaction(STORE_EXPEDIENTES, 'readonly');
    existing = await reqToPromise(tx.objectStore(STORE_EXPEDIENTES).get(expedienteId));
  }
  if (!existing) return null;

  const estadoMap: Record<DecisionEspecialista['accion'], EstadoOperativoLocal> = {
    CONFIRMAR: 'ALERTA_CONFIRMADA',
    DESCARTAR: 'ALERTA_DESCARTADA',
    ESCALAR: 'ESCALADO_JEFATURA',
  };
  const nextEstado = estadoMap[decision.accion];

  // Si el especialista descarta el falso positivo con motivo justificado, habilita el monto solicitado
  const updatedResponse =
    decision.accion === 'DESCARTAR' &&
    existing.response.dictamen_riesgos.monto_maximo_recomendado === 0 &&
    !existing.response.dictamen_riesgos.requiere_revision_humana
      ? {
          ...existing.response,
          dictamen_riesgos: {
            ...existing.response.dictamen_riesgos,
            monto_maximo_recomendado:
              existing.response.dictamen_riesgos.monto_solicitado_original,
            provision_sbs_evitada_pen: 0,
          },
        }
      : existing.response;

  const updated: ExpedienteAuditadoRecord = {
    ...existing,
    estado_local: nextEstado,
    decision_especialista: decision,
    response: updatedResponse,
    actualizado_en: new Date().toISOString(),
  };

  if (!db) {
    memExpedientes.set(expedienteId, updated);
  } else {
    const tx = db.transaction(STORE_EXPEDIENTES, 'readwrite');
    await reqToPromise(tx.objectStore(STORE_EXPEDIENTES).put(updated));
  }
  notifySync({ type: 'EXPEDIENTE_STATUS', expediente_id: expedienteId, estado: nextEstado });
  return updated;
}

export async function clearExpedientes(): Promise<void> {
  const db = await openDB();
  if (!db) {
    memExpedientes.clear();
  } else {
    const tx = db.transaction(STORE_EXPEDIENTES, 'readwrite');
    await reqToPromise(tx.objectStore(STORE_EXPEDIENTES).clear());
  }
  notifySync({ type: 'EXPEDIENTES_CLEARED' });
}

// ── Cola Offline (El Porvenir / Hermelinda sin señal) ──

export async function enqueueOfflineAudit(item: OfflineQueueItem): Promise<number> {
  const db = await openDB();
  if (!db) {
    memQueue.set(item.queue_id, item);
  } else {
    const tx = db.transaction(STORE_QUEUE, 'readwrite');
    await reqToPromise(tx.objectStore(STORE_QUEUE).put(item));
  }
  const all = await listOfflineQueue();
  notifySync({ type: 'QUEUE_UPDATED', count: all.length });
  return all.length;
}

export async function listOfflineQueue(): Promise<OfflineQueueItem[]> {
  const db = await openDB();
  let items: OfflineQueueItem[];
  if (!db) {
    items = Array.from(memQueue.values());
  } else {
    const tx = db.transaction(STORE_QUEUE, 'readonly');
    items = (await reqToPromise(tx.objectStore(STORE_QUEUE).getAll())) ?? [];
  }
  return items.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function removeOfflineQueueItem(queueId: string): Promise<number> {
  const db = await openDB();
  if (!db) {
    memQueue.delete(queueId);
  } else {
    const tx = db.transaction(STORE_QUEUE, 'readwrite');
    await reqToPromise(tx.objectStore(STORE_QUEUE).delete(queueId));
  }
  const all = await listOfflineQueue();
  notifySync({ type: 'QUEUE_UPDATED', count: all.length });
  return all.length;
}

export async function updateOfflineQueueItem(item: OfflineQueueItem): Promise<void> {
  const db = await openDB();
  if (!db) {
    memQueue.set(item.queue_id, item);
  } else {
    const tx = db.transaction(STORE_QUEUE, 'readwrite');
    await reqToPromise(tx.objectStore(STORE_QUEUE).put(item));
  }
}

// ── Caché local SUNAT (para autocompletado offline) ──

export async function cacheSunatRecord(record: SunatRucResponse): Promise<void> {
  const db = await openDB();
  if (!db) {
    memSunat.set(record.ruc, record);
    return;
  }
  const tx = db.transaction(STORE_SUNAT, 'readwrite');
  await reqToPromise(tx.objectStore(STORE_SUNAT).put(record));
}

export async function getCachedSunatRecord(ruc: string): Promise<SunatRucResponse | null> {
  const db = await openDB();
  if (!db) {
    return memSunat.get(ruc) ?? null;
  }
  const tx = db.transaction(STORE_SUNAT, 'readonly');
  return (await reqToPromise(tx.objectStore(STORE_SUNAT).get(ruc))) ?? null;
}
