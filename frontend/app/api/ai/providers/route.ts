import { requireDeploymentAccess } from '@/lib/deployment-access';
import { apiError, authenticatedUser, discoverModels, isAdminUser, NON_CHAT_MODEL_PATTERN, openKey, PROVIDERS, PROVIDER_CAPABILITIES, providerStorageError, safeBaseUrl, sealKey, serviceDb, type ProviderId, type TaskCapability } from '@/lib/ai/server';

export const runtime = 'nodejs';
const noStore = { 'Cache-Control': 'no-store' };
const ids = new Set<ProviderId>([...Object.keys(PROVIDERS) as ProviderId[], 'custom']);

async function owner(request: Request): Promise<string | Response> {
  const denied = requireDeploymentAccess(request);
  if (denied) return denied;
  try { return await authenticatedUser(request) || Response.json({ error: 'Sign in to manage AI providers.' }, { status: 401, headers: noStore }); }
  catch { return Response.json({ error: providerStorageError() }, { status: 503, headers: noStore }); }
}

async function ownedConnection(id: string, userId: string) {
  const { data } = await serviceDb().from('provider_connections').select('*').eq('id', id).eq('user_id', userId).single();
  return data;
}

export async function GET(request: Request) {
  const userId = await owner(request);
  if (typeof userId !== 'string') return userId;
  const db = serviceDb();
  const [connectionResult, preferenceResult] = await Promise.all([
    db.from('provider_connections').select('id,provider_id,display_name,masked_key,base_url,status,enabled,capability_usage,created_at,last_validated_at').eq('user_id', userId).order('created_at', { ascending: false }),
    db.from('routing_preferences').select('default_mode,preferred_model_id,image_model_id,voice_connection_id,fallback_enabled').eq('user_id', userId).maybeSingle(),
  ]);
  const missingColumn = (code?: string) => code === '42703' || code === 'PGRST204';
  const legacySchema = missingColumn(connectionResult.error?.code) || missingColumn(preferenceResult.error?.code);
  const legacyConnections = missingColumn(connectionResult.error?.code)
    ? await db.from('provider_connections').select('id,provider_id,display_name,masked_key,base_url,status,enabled,created_at,last_validated_at')
      .eq('user_id', userId).order('created_at', { ascending: false }) : null;
  const legacyPreferences = missingColumn(preferenceResult.error?.code)
    ? await db.from('routing_preferences').select('default_mode,preferred_model_id,image_model_id').eq('user_id', userId).maybeSingle() : null;
  const error = legacyConnections?.error || (legacyConnections ? null : connectionResult.error);
  if (error) return Response.json({ error: providerStorageError(error) }, { status: 503, headers: noStore });
  const connections = (legacyConnections?.data || connectionResult.data || []);
  const preferences = legacyPreferences?.data || preferenceResult.data;
  const connectionIds = (connections || []).map(row => row.id);
  const { data: models } = connectionIds.length
    ? await db.from('provider_models').select('id,connection_id,provider_id,model_id,display_name,capabilities,context_window,enabled,priority,status').in('connection_id', connectionIds)
    : { data: [] };
  const filteredModels = (models || []).filter(m => !NON_CHAT_MODEL_PATTERN.test(m.model_id));
  const admin = await isAdminUser(userId);
  return Response.json({ providers: connections, models: filteredModels, preferences: preferences || { default_mode: 'AUTO' },
    schemaOutdated: legacySchema,
    managed: { chat: (admin || process.env.VOID_ALLOW_FREE_CHAT !== 'false') && Boolean(process.env.GROQ_API_KEY)
      && /^[0-9a-f]{64}$/i.test(process.env.ENCRYPTION_KEY || ''),
      image: (admin && Boolean(process.env.CLOUDFLARE_SDXL_URL && (process.env.CLOUDFLARE_SDXL_KEY || process.env.IMG2IMG_WORKER_KEY)
        || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY)
        || process.env.VOID_ALLOW_FREE_IMAGE === 'true' && Boolean(process.env.POLLINATIONS_API_KEY)),
      voice: false } }, { headers: noStore });
}

export async function POST(request: Request) {
  const userId = await owner(request);
  if (typeof userId !== 'string') return userId;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return Response.json({ error: 'Invalid request.' }, { status: 400 }); }
  const providerId = body.providerId as ProviderId;
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim().slice(0, 80) : '';
  const customModel = typeof body.modelId === 'string' ? body.modelId.trim().slice(0, 160) : '';
  if (!ids.has(providerId) || !apiKey || apiKey.length > 4096 || (providerId === 'custom' && !customModel)) {
    return Response.json({ error: 'Choose a provider and provide an API key. Custom providers also need a model ID.' }, { status: 400 });
  }
  try {
    const baseUrl = providerId === 'custom' ? safeBaseUrl(String(body.baseUrl || '')) : null;
    const discovered = await discoverModels(providerId, apiKey, baseUrl || undefined, customModel || undefined);
    const db = serviceDb();
    const { data: connection, error } = await db.from('provider_connections').insert({ user_id: userId, provider_id: providerId,
      display_name: displayName || (providerId === 'custom' ? 'Custom provider' : PROVIDERS[providerId].name),
      ...sealKey(apiKey), base_url: baseUrl, status: 'connected', enabled: true, last_validated_at: new Date().toISOString() }).select('id').single();
    if (error || !connection) throw new Error(error?.code === 'PGRST205' || error?.code === '42P01'
      ? providerStorageError(error) : 'Could not save provider connection');

    const target = customModel.toLowerCase().trim();
    const primaryModelId = providerId === 'custom' && customModel
      ? (discovered.find(m => {
          const id = m.modelId.toLowerCase();
          return id === target || id.endsWith('/' + target) || id.includes(target);
        })?.modelId || customModel)
      : null;

    const { data: insertedModels, error: modelError } = await db.from('provider_models').insert(discovered.map(model => {
      const isPrimary = primaryModelId ? model.modelId.toLowerCase() === primaryModelId.toLowerCase() : false;
      return {
        connection_id: connection.id,
        provider_id: providerId,
        model_id: model.modelId,
        display_name: model.displayName,
        capabilities: model.capabilities,
        context_window: model.contextWindow,
        priority: isPrimary ? 10 : 0,
        enabled: (providerId === 'custom' && customModel) ? isPrimary : true,
      };
    })).select('id,model_id');
    if (modelError) {
      await db.from('provider_connections').delete().eq('id', connection.id).eq('user_id', userId);
      throw new Error(modelError.code === 'PGRST205' || modelError.code === '42P01'
        ? providerStorageError(modelError) : 'Could not save discovered models');
    }
    if (primaryModelId && insertedModels?.length) {
      const primaryRow = insertedModels.find(m => m.model_id.toLowerCase() === primaryModelId.toLowerCase());
      if (primaryRow?.id) {
        await db.from('routing_preferences').upsert({
          user_id: userId,
          preferred_model_id: primaryRow.id,
        }, { onConflict: 'user_id' });
      }
    }
    return Response.json({ id: connection.id, modelCount: discovered.length, status: 'connected' }, { status: 201, headers: noStore });
  } catch (error) { return Response.json({ error: apiError(error) }, { status: 400, headers: noStore }); }
}

export async function PATCH(request: Request) {
  const userId = await owner(request);
  if (typeof userId !== 'string') return userId;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return Response.json({ error: 'Invalid request.' }, { status: 400 }); }
  const id = String(body.id || '');
  const connection = await ownedConnection(id, userId);
  if (!connection) return Response.json({ error: 'Provider connection not found.' }, { status: 404 });
  const db = serviceDb();
  const action = String(body.action || '');
  try {
    if (action === 'capability') {
      const capability = body.capability as TaskCapability;
      if (!PROVIDER_CAPABILITIES[connection.provider_id as ProviderId]?.includes(capability) || typeof body.enabled !== 'boolean') {
        return Response.json({ error: 'Unsupported capability.' }, { status: 400 });
      }
      const { error } = await db.from('provider_connections').update({ capability_usage: {
        ...(connection.capability_usage || {}), [capability]: body.enabled,
      }, updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', userId);
      if (error) throw error;
    } else if (action === 'toggle' && typeof body.enabled === 'boolean') {
      const { error } = await db.from('provider_connections').update({ enabled: body.enabled, updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', userId);
      if (error) throw error;
    } else if (action === 'refresh' || action === 'test' || action === 'replace') {
      const key = action === 'replace' && typeof body.apiKey === 'string' ? body.apiKey.trim() : openKey(connection);
      if (!key) return Response.json({ error: 'Enter an API key.' }, { status: 400 });
      const { data: existing } = await db.from('provider_models').select('model_id').eq('connection_id', id).limit(1);
      const models = await discoverModels(connection.provider_id as ProviderId, key, connection.base_url || undefined,
        connection.provider_id === 'custom' ? existing?.[0]?.model_id : undefined);
      if (action === 'test') await db.from('provider_connections').update({ status: 'connected', last_validated_at: new Date().toISOString() })
        .eq('id', id).eq('user_id', userId);
      if (action !== 'test') {
        const update = { ...(action === 'replace' ? sealKey(key) : {}), status: 'connected', last_validated_at: new Date().toISOString(), updated_at: new Date().toISOString() };
        const { error } = await db.from('provider_connections').update(update).eq('id', id).eq('user_id', userId);
        if (error) throw error;
        const { error: modelError } = await db.from('provider_models').upsert(models.map(model => ({
          connection_id: id, provider_id: connection.provider_id, model_id: model.modelId, display_name: model.displayName,
          capabilities: model.capabilities, context_window: model.contextWindow, last_discovered_at: new Date().toISOString(),
        })), { onConflict: 'connection_id,model_id' });
        if (modelError) throw modelError;
      }
      return Response.json({ status: 'connected', modelCount: models.length }, { headers: noStore });
    } else return Response.json({ error: 'Unsupported action.' }, { status: 400 });
    return Response.json({ ok: true }, { headers: noStore });
  } catch (error) { return Response.json({ error: apiError(error) }, { status: 400, headers: noStore }); }
}

export async function DELETE(request: Request) {
  const userId = await owner(request);
  if (typeof userId !== 'string') return userId;
  const id = new URL(request.url).searchParams.get('id') || '';
  const { error, count } = await serviceDb().from('provider_connections').delete({ count: 'exact' }).eq('id', id).eq('user_id', userId);
  if (error) return Response.json({ error: 'Could not delete provider.' }, { status: 503 });
  return Response.json({ deleted: count || 0 }, { headers: noStore });
}
