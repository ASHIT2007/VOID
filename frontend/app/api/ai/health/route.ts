import { requireDeploymentAccess } from '@/lib/deployment-access';
import { authenticatedUser, loadByokContext, serviceDb } from '@/lib/ai/server';
import { backendHeaders, backendUrl } from '@/lib/backend';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'no-store' };

export async function GET(request: Request) {
  const denied = requireDeploymentAccess(request); if (denied) return denied;
  try {
    const userId = await authenticatedUser(request);
    if (!userId) return Response.json({ error: 'Sign in first.' }, { status: 401, headers });
    const db = serviceDb();
    const { data: providers, error } = await db.from('provider_connections').select('id').eq('user_id', userId);
    if (error) throw error;
    if (!providers?.length) return Response.json({ health: {} }, { headers });
    const { data: models, error: modelError } = await db.from('provider_models').select('id,connection_id,model_id').in('connection_id', providers.map(provider => provider.id));
    if (modelError) throw modelError;
    const response = await fetch(backendUrl('/api/ai/health'), {
      method: 'POST', cache: 'no-store', headers: backendHeaders({ 'Content-Type': 'application/json' }), signal: AbortSignal.timeout(5000),
      body: JSON.stringify({ userId, models: (models || []).map(model => ({ id: model.id, connectionId: model.connection_id, modelId: model.model_id })) }),
    });
    if (!response.ok) throw new Error('Health service unavailable');
    const data = await response.json();
    return Response.json({ health: data.health }, { headers });
  } catch { return Response.json({ error: 'Health service unavailable.' }, { status: 503, headers }); }
}

export async function POST(request: Request) {
  const denied = requireDeploymentAccess(request); if (denied) return denied;
  try {
    const userId = await authenticatedUser(request);
    if (!userId) return Response.json({ error: 'Sign in first.' }, { status: 401, headers });
    const body = await request.json().catch(() => null);
    if (!Array.isArray(body?.modelIds) || !body.modelIds.length || body.modelIds.length > 15
      || body.modelIds.some((id: unknown) => typeof id !== 'string' || !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(id))) {
      return Response.json({ error: 'Choose valid models to check.' }, { status: 400, headers });
    }
    const modelIds = [...new Set<string>(body.modelIds)];
    const context = await loadByokContext(userId, { includeManaged: false });
    const models = context.models.filter(model => modelIds.includes(model.id as string) && model.enabled
      && (model.capabilities as { text?: boolean; streaming?: boolean }).text && (model.capabilities as { streaming?: boolean }).streaming);
    if (models.length !== modelIds.length) return Response.json({ error: 'A selected model is unavailable.' }, { status: 400, headers });
    const response = await fetch(backendUrl('/api/ai/health/check'), {
      method: 'POST', cache: 'no-store', headers: backendHeaders({ 'Content-Type': 'application/json' }), signal: AbortSignal.timeout(130_000),
      body: JSON.stringify({ byok: { ...context, models }, modelIds }),
    });
    if (!response.ok) throw new Error('Readiness service unavailable');
    const data = await response.json();
    return Response.json({ health: data.health }, { headers });
  } catch { return Response.json({ error: 'Could not check model availability.' }, { status: 503, headers }); }
}
