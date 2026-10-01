import { requireDeploymentAccess } from '@/lib/deployment-access';
import { authenticatedUser, serviceDb, type RoutingMode } from '@/lib/ai/server';

export const runtime = 'nodejs';
const MODES: RoutingMode[] = ['AUTO', 'FAST', 'DEEP', 'CREATIVE', 'EFFICIENT', 'MANUAL'];

export async function PATCH(request: Request) {
  const denied = requireDeploymentAccess(request);
  if (denied) return denied;
  const userId = await authenticatedUser(request);
  if (!userId) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ error: 'Invalid preferences.' }, { status: 400 });
  const has = (field: string) => Object.hasOwn(body, field);
  if (!['mode', 'modelId', 'imageModelId', 'voiceConnectionId', 'fallbackEnabled'].some(has)) return Response.json({ error: 'Choose a preference to update.' }, { status: 400 });
  if (has('mode') && !MODES.includes(body.mode as RoutingMode)) return Response.json({ error: 'Invalid routing mode.' }, { status: 400 });
  if (['modelId', 'imageModelId', 'voiceConnectionId'].some(field => has(field) && body[field] !== null && typeof body[field] !== 'string')
    || has('fallbackEnabled') && typeof body.fallbackEnabled !== 'boolean') return Response.json({ error: 'Invalid preferences.' }, { status: 400 });
  const db = serviceDb();
  const { data: current, error: readError } = await db.from('routing_preferences').select('default_mode,preferred_model_id')
    .eq('user_id', userId).maybeSingle();
  if (readError) return Response.json({ error: 'Could not load preferences.' }, { status: 503 });
  const mode = (has('mode') ? body.mode : current?.default_mode || 'AUTO') as RoutingMode;
  const modelId = has('modelId') ? body.modelId || null : current?.preferred_model_id || null;
  // Independent image/voice updates must not revalidate unrelated chat settings.
  const validateChat = has('modelId') || has('mode') && mode === 'MANUAL';
  if (validateChat && mode === 'MANUAL' && !modelId) return Response.json({ error: 'Choose a model for Manual mode.' }, { status: 400 });
  if (validateChat && modelId) {
    const { data: model } = await db.from('provider_models').select('connection_id,enabled,capabilities').eq('id', modelId).single();
    const { data: connection } = model ? await db.from('provider_connections').select('id,capability_usage').eq('id', model.connection_id).eq('user_id', userId).eq('enabled', true).eq('status', 'connected').single() : { data: null };
    if (!connection || connection.capability_usage?.chat === false || !model?.enabled || !model.capabilities?.text || !model.capabilities?.streaming) {
      return Response.json({ error: 'Choose an enabled chat model from your providers.' }, { status: 400 });
    }
  }
  const imageModelId = has('imageModelId') ? body.imageModelId || null : null;
  if (imageModelId) {
    const { data: imageModel } = await db.from('provider_models').select('connection_id,enabled,capabilities')
      .eq('id', imageModelId).single();
    const { data: imageConnection } = imageModel ? await db.from('provider_connections').select('id,capability_usage')
      .eq('id', imageModel.connection_id).eq('user_id', userId).eq('enabled', true).eq('status', 'connected').single() : { data: null };
    if (!imageConnection || imageConnection.capability_usage?.image === false || !imageModel?.enabled || !imageModel.capabilities?.imageGeneration) {
      return Response.json({ error: 'Choose an enabled image model from your providers.' }, { status: 400 });
    }
  }
  const voiceConnectionId = has('voiceConnectionId') ? body.voiceConnectionId || null : null;
  if (voiceConnectionId) {
    const { data: voiceConnection } = await db.from('provider_connections').select('provider_id,capability_usage')
      .eq('id', voiceConnectionId).eq('user_id', userId).eq('enabled', true).eq('status', 'connected').single();
    if (!voiceConnection || voiceConnection.provider_id !== 'elevenlabs' || voiceConnection.capability_usage?.voice === false) {
      return Response.json({ error: 'Choose a connected voice provider.' }, { status: 400 });
    }
  }
  // Write only changed columns so one panel cannot overwrite another panel's save.
  const { error } = await db.from('routing_preferences').upsert({ user_id: userId,
    ...(has('mode') ? { default_mode: mode } : {}),
    ...(has('modelId') ? { preferred_model_id: modelId } : {}),
    ...(has('imageModelId') ? { image_model_id: imageModelId } : {}),
    ...(has('voiceConnectionId') ? { voice_connection_id: voiceConnectionId } : {}),
    ...(has('fallbackEnabled') ? { fallback_enabled: body.fallbackEnabled } : {}),
    updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  return error ? Response.json({ error: 'Could not save routing mode.' }, { status: 503 }) : Response.json({ ok: true });
}
