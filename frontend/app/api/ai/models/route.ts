import { requireDeploymentAccess } from '@/lib/deployment-access';
import { authenticatedUser, serviceDb } from '@/lib/ai/server';

export const runtime = 'nodejs';

export async function PATCH(request: Request) {
  const denied = requireDeploymentAccess(request);
  if (denied) return denied;
  const userId = await authenticatedUser(request);
  if (!userId) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const id = String(body.id || '');
  const enabled = body.enabled;
  const priority = body.priority;
  if (typeof enabled !== 'boolean' && !(typeof priority === 'number' && Number.isInteger(priority) && priority >= -10 && priority <= 10)) {
    return Response.json({ error: 'Invalid model settings.' }, { status: 400 });
  }
  const db = serviceDb();
  const { data: model } = await db.from('provider_models').select('id,connection_id').eq('id', id).single();
  if (!model) return Response.json({ error: 'Model not found.' }, { status: 404 });
  const { data: owned } = await db.from('provider_connections').select('id').eq('id', model.connection_id).eq('user_id', userId).single();
  if (!owned) return Response.json({ error: 'Model not found.' }, { status: 404 });
  const { error } = await db.from('provider_models').update({ ...(typeof enabled === 'boolean' ? { enabled } : {}),
    ...(typeof priority === 'number' ? { priority } : {}) }).eq('id', id).eq('connection_id', owned.id);
  return error ? Response.json({ error: 'Could not update model.' }, { status: 503 }) : Response.json({ ok: true });
}
