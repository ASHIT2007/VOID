import { requireDeploymentAccess } from '@/lib/deployment-access';
import { authenticatedUser, openKey, sealKey, serviceDb } from '@/lib/ai/server';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'no-store' };
const fields = 'id,provider_id,display_name,masked_key,enabled,priority,last_validated_at';
type Provider = 'tavily' | 'brave';
const isProvider = (value: unknown): value is Provider => value === 'tavily' || value === 'brave';
const validId = (value: unknown): value is string => typeof value === 'string' && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(value);
async function owner(request: Request): Promise<string | Response> {
  const denied = requireDeploymentAccess(request); if (denied) return denied;
  try { return await authenticatedUser(request) || Response.json({ error: 'Sign in to manage search providers.' }, { status: 401, headers }); }
  catch { return Response.json({ error: 'Search provider storage is unavailable.' }, { status: 503, headers }); }
}
function storageError(error: { code?: string } | null): Response {
  return Response.json({ error: error?.code === '42P01' || error?.code === 'PGRST205'
    ? 'Search storage needs its database update. Apply the search BYOK migration.' : 'Could not save search settings.' }, { status: 503, headers });
}
async function verifyKey(provider: Provider, key: string): Promise<void> {
  const response = provider === 'tavily' ? await fetch('https://api.tavily.com/search', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'Tavily search', search_depth: 'basic', max_results: 1, include_answer: false, include_images: false }),
    signal: AbortSignal.timeout(10000), redirect: 'error', cache: 'no-store',
  }) : await fetch('https://api.search.brave.com/res/v1/web/search?q=Brave%20Search&count=1', {
    headers: { 'X-Subscription-Token': key, Accept: 'application/json' }, signal: AbortSignal.timeout(10000), redirect: 'error', cache: 'no-store',
  });
  await response.body?.cancel();
  if (!response.ok) throw new Error([402, 429, 432, 433].includes(response.status) ? 'This search key is rate limited or out of credits.'
    : response.status === 401 || response.status === 403 ? 'The search provider rejected this key.' : 'The search provider is unavailable. Try again.');
}

export async function GET(request: Request) {
  const userId = await owner(request); if (typeof userId !== 'string') return userId;
  const { data, error } = await serviceDb().from('search_connections').select(fields).eq('user_id', userId).order('priority', { ascending: false }).order('created_at', { ascending: true });
  return error ? storageError(error) : Response.json({ connections: data || [] }, { headers });
}

export async function POST(request: Request) {
  const userId = await owner(request); if (typeof userId !== 'string') return userId;
  const body = await request.json().catch(() => null);
  if (!isProvider(body?.providerId) || typeof body?.apiKey !== 'string' || !body.apiKey.trim() || body.apiKey.length > 4096) return Response.json({ error: 'Choose a provider and enter a search key.' }, { status: 400, headers });
  const apiKey = body.apiKey.trim();
  const name = typeof body.displayName === 'string' ? body.displayName.trim().slice(0, 80) : '';
  try {
    const db = serviceDb();
    const { count, error: countError } = await db.from('search_connections').select('id', { count: 'exact', head: true }).eq('user_id', userId);
    if (countError) return storageError(countError);
    if ((count || 0) >= 20) return Response.json({ error: 'You can connect up to 20 search keys.' }, { status: 400, headers });
    await verifyKey(body.providerId, apiKey);
    const { data, error } = await db.from('search_connections').insert({ user_id: userId, provider_id: body.providerId,
      display_name: name || (body.providerId === 'tavily' ? 'Tavily' : 'Brave Search'), ...sealKey(apiKey), last_validated_at: new Date().toISOString() }).select(fields).single();
    if (error?.code === '23505') return Response.json({ error: 'This search key is already connected.' }, { status: 409, headers });
    return error ? storageError(error) : Response.json({ connection: data }, { status: 201, headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    return Response.json({ error: /^(This search key|The search provider)/.test(message) ? message : 'Could not connect. Check your key and try again.' }, { status: 400, headers });
  }
}

export async function PATCH(request: Request) {
  const userId = await owner(request); if (typeof userId !== 'string') return userId;
  const body = await request.json().catch(() => null);
  if (!validId(body?.id) || !['toggle', 'test', 'replace', 'priority'].includes(body?.action)) return Response.json({ error: 'Invalid search setting.' }, { status: 400, headers });
  const db = serviceDb();
  const { data: connection, error: loadError } = await db.from('search_connections').select('*').eq('id', body.id).eq('user_id', userId).maybeSingle();
  if (loadError) return storageError(loadError);
  if (!connection) return Response.json({ error: 'Search connection not found.' }, { status: 404, headers });
  const changes: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.action === 'toggle') {
    if (typeof body.enabled !== 'boolean') return Response.json({ error: 'Choose a valid enabled state.' }, { status: 400, headers });
    changes.enabled = body.enabled;
  } else if (body.action === 'priority') {
    if (!Number.isInteger(body.priority) || body.priority < 0 || body.priority > 100) return Response.json({ error: 'Choose a valid priority.' }, { status: 400, headers });
    changes.priority = body.priority;
  } else {
    if (body.action === 'replace' && (typeof body.apiKey !== 'string' || !body.apiKey.trim() || body.apiKey.length > 4096)) return Response.json({ error: 'Enter a search key.' }, { status: 400, headers });
    try {
      const key = body.action === 'replace' ? body.apiKey.trim() : openKey(connection);
      await verifyKey(connection.provider_id, key);
      if (body.action === 'replace') Object.assign(changes, sealKey(key));
      changes.last_validated_at = new Date().toISOString();
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      return Response.json({ error: /^(This search key|The search provider)/.test(message) ? message : 'Could not verify this search key.' }, { status: 400, headers });
    }
  }
  const { data, error } = await db.from('search_connections').update(changes).eq('id', body.id).eq('user_id', userId).select(fields).single();
  if (error?.code === '23505') return Response.json({ error: 'This search key is already connected.' }, { status: 409, headers });
  return error ? storageError(error) : Response.json({ connection: data }, { headers });
}

export async function DELETE(request: Request) {
  const userId = await owner(request); if (typeof userId !== 'string') return userId;
  const id = new URL(request.url).searchParams.get('id');
  if (!validId(id)) return Response.json({ error: 'Choose a search connection.' }, { status: 400, headers });
  const { error } = await serviceDb().from('search_connections').delete().eq('id', id).eq('user_id', userId);
  return error ? storageError(error) : Response.json({ deleted: true }, { headers });
}
