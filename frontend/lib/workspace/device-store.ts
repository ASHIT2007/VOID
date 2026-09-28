type Entry<T = unknown> = { id: string; owner: string; kind: string; value: T };
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => { const request = indexedDB.open('void-device-workspace', 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('entries', { keyPath: 'id' }); };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error('Device storage is unavailable.')); });
}
export async function deviceEntries<T>(owner: string, kind: string): Promise<Entry<T>[]> {
  const db = await database();
  try { return await new Promise((resolve, reject) => { const request = db.transaction('entries').objectStore('entries').getAll();
    request.onsuccess = () => resolve(request.result.filter(entry => entry.owner === owner && entry.kind === kind)); request.onerror = () => reject(new Error('Could not read device storage.')); }); }
  finally { db.close(); }
}
export async function devicePut(owner: string, kind: string, key: string, value: unknown) {
  const db = await database();
  try { await new Promise<void>((resolve, reject) => { const transaction = db.transaction('entries', 'readwrite'); transaction.objectStore('entries').put({ id: `${owner}:${kind}:${key}`, owner, kind, value });
    transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(new Error('Could not save to device storage.')); transaction.onabort = () => reject(new Error('Device storage write was cancelled.')); }); }
  finally { db.close(); }
}
export async function deviceDelete(owner: string, kind: string, key: string) {
  const db = await database();
  try { await new Promise<void>((resolve, reject) => { const transaction = db.transaction('entries', 'readwrite'); transaction.objectStore('entries').delete(`${owner}:${kind}:${key}`);
    transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(new Error('Could not delete the memory.')); }); }
  finally { db.close(); }
}
export type UsageRecord = { id: string; providerId: string; modelId: string; conversationId: string; inputTokens: number; outputTokens: number; estimated: boolean };
export type Price = { input: number; output: number };
export function usageSummary(records: UsageRecord[], prices: Record<string, Price>) {
  const groups = new Map<string, { provider: string; model: string; inputTokens: number; outputTokens: number; estimated: boolean; estimatedCostUsd: number | null }>();
  for (const record of records) {
    const key = `${record.providerId}/${record.modelId}`;
    const price = prices[key];
    const known = price && Number.isFinite(price.input) && Number.isFinite(price.output) && price.input >= 0 && price.output >= 0;
    const group = groups.get(key) || { provider: record.providerId, model: record.modelId, inputTokens: 0, outputTokens: 0, estimated: false, estimatedCostUsd: known ? 0 : null };
    group.inputTokens += record.inputTokens; group.outputTokens += record.outputTokens; group.estimated ||= record.estimated;
    if (group.estimatedCostUsd !== null) group.estimatedCostUsd += (record.inputTokens * price.input + record.outputTokens * price.output) / 1e6;
    groups.set(key, group);
  }
  const models = [...groups.values()];
  return { inputTokens: models.reduce((sum, row) => sum + row.inputTokens, 0), outputTokens: models.reduce((sum, row) => sum + row.outputTokens, 0),
    estimatedCostUsd: !models.length || models.some(row => row.estimatedCostUsd === null) ? null : models.reduce((sum, row) => sum + (row.estimatedCostUsd || 0), 0),
    models, disclosure: 'Stored on this device. USD costs use your configured per-million-token rates; estimates are not an invoice. Provider-reported counts are used when available; otherwise token counts are estimated. Unreported failed attempts, images and voice charges are not included.' };
}
export function workspaceStreamEvent(event: Record<string, unknown>) {
  if (event.type === 'client_tool' || event.type === 'usage_record') window.dispatchEvent(new CustomEvent('void:workspace-event', { detail: event }));
}
export function openWorkspace(tab = 'Files') {
  window.dispatchEvent(new CustomEvent('void:open-workspace', { detail: { tab } }));
}
