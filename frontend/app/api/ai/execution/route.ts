import { requireDeploymentAccess } from '@/lib/deployment-access';
import { authenticatedUser, serviceDb } from '@/lib/ai/server';
import { connectedExecutionModels, executionMetadata } from '@/lib/ai/execution-settings';
import { EXECUTION_METADATA_KEY, parseExecutionConfig, reconcileExecutionConfig } from '@void/shared/execution-config.mjs';
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'no-store' };

async function owner(request: Request) { return await authenticatedUser(request); }
export async function GET(request: Request) {
  const denied = requireDeploymentAccess(request); if (denied) return denied;
  try {
    const userId = await owner(request); if (!userId) return Response.json({ error: 'Sign in first.' }, { status: 401, headers });
    const [models, metadata, preferences] = await Promise.all([connectedExecutionModels(userId), executionMetadata(userId),
      serviceDb().from('routing_preferences').select('preferred_model_id').eq('user_id', userId).maybeSingle()]);
    return Response.json({ config: reconcileExecutionConfig(metadata[EXECUTION_METADATA_KEY], models.map(model => model.id), preferences.data?.preferred_model_id) }, { headers });
  } catch { return Response.json({ error: 'Could not load execution settings.' }, { status: 503, headers }); }
}
export async function PATCH(request: Request) {
  const denied = requireDeploymentAccess(request); if (denied) return denied;
  try {
    const userId = await owner(request); if (!userId) return Response.json({ error: 'Sign in first.' }, { status: 401, headers });
    let config;
    try { config = parseExecutionConfig((await request.json()).config); }
    catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Invalid execution settings.' }, { status: 400, headers }); }
    const models = await connectedExecutionModels(userId), ids = new Set(models.map(model => model.id));
    if (models.length && !config.primaryModelId) return Response.json({ error: 'Choose a primary model.' }, { status: 400, headers });
    if ([config.primaryModelId, ...config.fallbackModelIds, ...config.roles.map(role => role.modelId)].some(id => id && !ids.has(id))) return Response.json({ error: 'Choose enabled chat models from your connected keys only.' }, { status: 400, headers });
    const metadata = await executionMetadata(userId);
    const { error } = await serviceDb().auth.admin.updateUserById(userId, { user_metadata: { ...metadata, [EXECUTION_METADATA_KEY]: config } });
    if (error) throw error;
    return Response.json({ config }, { headers });
  } catch { return Response.json({ error: 'Could not save execution settings. Please retry.' }, { status: 503, headers }); }
}
