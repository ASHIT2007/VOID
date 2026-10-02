export const EXECUTION_METADATA_KEY = 'void_execution_v1';
const MODEL_ID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
export const ROLE_KINDS = ['researcher', 'analyst', 'fact_checker', 'answer_writer', 'custom'];

export function defaultExecutionConfig(primaryModelId = null) {
  return { version: 1, primaryModelId, roles: [], fallbackModelIds: [] };
}

// A device preference selects the coordinator, without discarding its team.
export function executionWithPrimary(config, primaryModelId) {
  return config ? { ...config, primaryModelId, fallbackModelIds: config.fallbackModelIds.filter(id => id !== primaryModelId) } : undefined;
}

export function suggestedRoleModel(config, eligibleIds) {
  const usage = new Map(eligibleIds.map(id => [id, 0]));
  for (const id of [config.primaryModelId, ...config.roles.map(role => role.modelId)]) {
    if (usage.has(id)) usage.set(id, usage.get(id) + 1);
  }
  return [...eligibleIds].sort((a, b) => usage.get(a) - usage.get(b))[0] || config.primaryModelId;
}

export function parseExecutionConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid execution settings.');
  if (value.version !== 1 || !(value.primaryModelId === null || typeof value.primaryModelId === 'string' && MODEL_ID.test(value.primaryModelId))) throw new Error('Choose a primary model.');
  if (!Array.isArray(value.roles) || value.roles.length > 6 || !Array.isArray(value.fallbackModelIds) || value.fallbackModelIds.length > 8) throw new Error('Use up to six roles and eight fallback models.');
  const roles = value.roles.map(role => {
    if (!role || typeof role.id !== 'string' || !/^[a-z\d-]{1,64}$/i.test(role.id) || typeof role.name !== 'string' || !role.name.trim() || role.name.length > 60 || !ROLE_KINDS.includes(role.kind) || typeof role.modelId !== 'string' || !MODEL_ID.test(role.modelId) || typeof role.instruction !== 'string' || role.instruction.length > 600) throw new Error('Each role needs a name, connected model and valid instructions.');
    if (role.kind === 'custom' && !role.instruction.trim()) throw new Error('Describe what the custom role should do.');
    return { id: role.id, name: role.name.trim(), kind: role.kind, modelId: role.modelId, instruction: role.instruction.trim() };
  });
  if (new Set(roles.map(role => role.id)).size !== roles.length || roles.filter(role => role.kind === 'answer_writer').length > 1) throw new Error('Use unique roles and one answer writer.');
  const fallbackModelIds = value.fallbackModelIds;
  if (fallbackModelIds.some(id => typeof id !== 'string' || !MODEL_ID.test(id)) || new Set(fallbackModelIds).size !== fallbackModelIds.length || fallbackModelIds.includes(value.primaryModelId)) throw new Error('Choose distinct fallback models after the primary model.');
  if (!value.primaryModelId && (roles.length || fallbackModelIds.length)) throw new Error('Choose a primary model first.');
  return { version: 1, primaryModelId: value.primaryModelId, roles: [...roles.filter(role => role.kind !== 'answer_writer'), ...roles.filter(role => role.kind === 'answer_writer')], fallbackModelIds: [...fallbackModelIds] };
}

// Disabled or disconnected models are never revived by a saved assignment.
export function reconcileExecutionConfig(value, eligibleIds, preferredId = null) {
  const eligible = new Set(eligibleIds);
  let config;
  try { config = parseExecutionConfig(value); } catch { config = defaultExecutionConfig(); }
  const primaryModelId = eligible.has(config.primaryModelId) ? config.primaryModelId
    : eligible.has(preferredId) ? preferredId : eligibleIds[0] || null;
  return { ...config, primaryModelId,
    roles: config.roles.filter(role => eligible.has(role.modelId)),
    fallbackModelIds: config.fallbackModelIds.filter(id => eligible.has(id) && id !== primaryModelId) };
}
