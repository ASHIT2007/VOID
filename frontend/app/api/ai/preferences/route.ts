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
  if (!MODES.includes(body.mode as RoutingMode)) return Response.json({ error: 'Invalid routing mode.' }, { status: 400 });
  const db = serviceDb();
  const { data: current } = await db.from('routing_preferences').select('preferred_model_id,image_model_id,voice_connection_id,fallback_enabled')
    .eq('user_id', userId).maybeSingle();
  const modelId = Object.hasOwn(body, 'modelId') ? typeof body.modelId === 'string' ? body.modelId : null : current?.preferred_model_id || null;
  if (body.mode === 'MANUAL' && !modelId) return Response.json({ error: 'Choose a model for Manual mode.' }, { status: 400 });
  if (modelId) {
    const { data: model } = await db.from('provider_models').select('connection_id,enabled,capabilities').eq('id', modelId).single();
    const { data: connection } = model ? await db.from('provider_connections').select('id').eq('id', model.connection_id).eq('user_id', userId).eq('enabled', true).single() : { data: null };
    if (!connection || !model?.enabled || body.mode === 'MANUAL' && (!model.capabilities?.text || !model.capabilities?.streaming)) {
      return Response.json({ error: 'Choose an enabled chat model from your providers.' }, { status: 400 });
    }
  }
  const imageModelId = Object.hasOwn(body, 'imageModelId') ? typeof body.imageModelId === 'string' ? body.imageModelId : null : current?.image_model_id || null;
  if (imageModelId) {
    const { data: imageModel } = await db.from('provider_models').select('connection_id,enabled,capabilities')
      .eq('id', imageModelId).single();
    const { data: imageConnection } = imageModel ? await db.from('provider_connections').select('id')
      .eq('id', imageModel.connection_id).eq('user_id', userId).eq('enabled', true).single() : { data: null };
    if (!imageConnection || !imageModel?.enabled || !imageModel.capabilities?.imageGeneration) {
      return Response.json({ error: 'Choose an enabled image model from your providers.' }, { status: 400 });
    }
  }
  const voiceConnectionId = Object.hasOwn(body, 'voiceConnectionId')
    ? typeof body.voiceConnectionId === 'string' && body.voiceConnectionId ? body.voiceConnectionId : null
    : current?.voice_connection_id || null;
  if (voiceConnectionId) {
    const { data: voiceConnection } = await db.from('provider_connections').select('provider_id,capability_usage')
      .eq('id', voiceConnectionId).eq('user_id', userId).eq('enabled', true).eq('status', 'connected').single();
    if (!voiceConnection || voiceConnection.provider_id !== 'elevenlabs' || voiceConnection.capability_usage?.voice === false) {
      return Response.json({ error: 'Choose a connected voice provider.' }, { status: 400 });
    }
  }
  const { error } = await db.from('routing_preferences').upsert({ user_id: userId, default_mode: body.mode,
    preferred_model_id: modelId,
    image_model_id: imageModelId,
    voice_connection_id: voiceConnectionId,
    fallback_enabled: typeof body.fallbackEnabled === 'boolean' ? body.fallbackEnabled : current?.fallback_enabled !== false,
    updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  return error ? Response.json({ error: 'Could not save routing mode.' }, { status: 503 }) : Response.json({ ok: true });
}
