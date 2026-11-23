import { isOfflineNow, OfflineError, postAuditarExpediente } from '../api/client';
import type {
  AuditarExpedienteRequest,
  ExpedienteAuditadoRecord,
  OfflineQueueItem,
} from '../contracts/schemas';
import {
  enqueueOfflineAudit,
  listOfflineQueue,
  removeOfflineQueueItem,
  saveExpediente,
  updateOfflineQueueItem,
} from '../storage/db';
import { deriveInitialLocalStatus } from '../utils/format';
import { getSavedWebhookUrl, triggerCoreWebhook } from '../utils/webhook';

export type SubmitAuditResult =
  | {
      mode: 'AUDITED';
      record: ExpedienteAuditadoRecord;
    }
  | {
      mode: 'QUEUED_OFFLINE';
      queueItem: OfflineQueueItem;
      queueSize: number;
    };

export async function submitExpedienteAudit(
  payload: AuditarExpedienteRequest,
  meta: {
    origen: ExpedienteAuditadoRecord['origen'];
    titulo_caso?: string;
    razon_social?: string;
  }
): Promise<SubmitAuditResult> {
  if (isOfflineNow()) {
    return queueOffline(payload, meta);
  }

  try {
    const { response, contractWarning } = await postAuditarExpediente(payload);
    const now = new Date().toISOString();
    const record: ExpedienteAuditadoRecord = {
      expediente_id: response.expediente_id,
      titulo_caso: meta.titulo_caso,
      agencia_origen: payload.agencia_origen,
      razon_social: meta.razon_social,
      creado_en: now,
      actualizado_en: now,
      origen: meta.origen,
      estado_local: deriveInitialLocalStatus(response),
      request: payload,
      response,
      contract_warning: contractWarning,
    };
    await saveExpediente(record);
    const webhookUrl = getSavedWebhookUrl();
    if (webhookUrl) {
      triggerCoreWebhook(webhookUrl, {
        event: 'EXPEDIENTE_AUDITADO_SBS',
        ...record,
      }).catch(() => {});
    }
    return { mode: 'AUDITED', record };
  } catch (err) {
    if (err instanceof OfflineError || (err instanceof TypeError && isOfflineNow())) {
      return queueOffline(payload, meta);
    }
    throw err;
  }
}

async function queueOffline(
  payload: AuditarExpedienteRequest,
  meta: { titulo_caso?: string; razon_social?: string }
): Promise<SubmitAuditResult> {
  const queueItem: OfflineQueueItem = {
    queue_id: `Q-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    created_at: new Date().toISOString(),
    attempts: 0,
    titulo_caso: meta.titulo_caso,
    razon_social: meta.razon_social,
    payload,
  };
  const queueSize = await enqueueOfflineAudit(queueItem);
  return { mode: 'QUEUED_OFFLINE', queueItem, queueSize };
}

export async function flushOfflineQueue(): Promise<{
  synced: ExpedienteAuditadoRecord[];
  failed: number;
  remaining: number;
}> {
  if (isOfflineNow()) {
    const queue = await listOfflineQueue();
    return { synced: [], failed: 0, remaining: queue.length };
  }

  const items = await listOfflineQueue();
  const synced: ExpedienteAuditadoRecord[] = [];
  let failed = 0;

  for (const item of items) {
    try {
      const { response, contractWarning } = await postAuditarExpediente(item.payload);
      const now = new Date().toISOString();
      const record: ExpedienteAuditadoRecord = {
        expediente_id: response.expediente_id,
        titulo_caso: item.titulo_caso,
        agencia_origen: item.payload.agencia_origen,
        razon_social: item.razon_social,
        creado_en: item.created_at,
        actualizado_en: now,
        origen: 'CAMPO_OFFLINE_SYNC',
        estado_local: deriveInitialLocalStatus(response),
        request: item.payload,
        response,
        contract_warning: contractWarning,
      };
      await saveExpediente(record);
      await removeOfflineQueueItem(item.queue_id);
      synced.push(record);
    } catch (err) {
      failed += 1;
      await updateOfflineQueueItem({
        ...item,
        attempts: item.attempts + 1,
        last_error: err instanceof Error ? err.message : 'Error de sincronización',
      });
      if (err instanceof OfflineError) break;
    }
  }

  const remaining = (await listOfflineQueue()).length;
  return { synced, failed, remaining };
}
