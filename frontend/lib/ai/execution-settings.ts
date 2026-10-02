import 'server-only';
import { EXECUTION_METADATA_KEY, parseExecutionConfig, reconcileExecutionConfig, type ExecutionConfig } from '@void/shared/execution-config.mjs';
import { serviceDb } from './server';

export async function executionMetadata(userId: string): Promise<Record<string, unknown>> {
  const { data, error } = await serviceDb().auth.admin.getUserById(userId);
  if (error || !data.user) throw new Error('Could not load execution settings.');
  return data.user.user_metadata || {};
}

export async function connectedExecutionModels(userId: string) {
  const db = serviceDb();
  const { data: connections, error } = await db.from('provider_connections').select('id,capability_usage')
    .eq('user_id', userId).eq('enabled', true).eq('status', 'connected');
  if (error) throw new Error('Could not load connected providers.');
  const ids = (connections || []).filter(connection => connection.capability_usage?.chat !== false).map(connection => connection.id);
  if (!ids.length) return [];
  const { data: models, error: modelError } = await db.from('provider_models').select('id,capabilities,priority').in('connection_id', ids).eq('enabled', true).order('priority', { ascending: false });
  if (modelError) throw new Error('Could not load connected models.');
  return (models || []).filter(model => model.capabilities?.text && model.capabilities?.streaming)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0) || a.id.localeCompare(b.id));
}

export async function readExecutionConfig(userId: string, eligibleIds: string[], preferredId?: string | null): Promise<ExecutionConfig> {
  const saved = (await executionMetadata(userId))[EXECUTION_METADATA_KEY];
  try {
    const config = parseExecutionConfig(saved);
    // Routing must report an unavailable assignment or use its explicit backup.
    // Removing it here can silently turn an entire team into a primary-only run.
    if (config.primaryModelId) return config;
  } catch { /* Legacy or missing settings use the connected-model default. */ }
  return reconcileExecutionConfig(saved, eligibleIds, preferredId);
}
