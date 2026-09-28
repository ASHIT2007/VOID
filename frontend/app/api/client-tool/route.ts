import { requireDeploymentAccess } from '@/lib/deployment-access';
import { authenticatedUser } from '@/lib/ai/server';
import { backendHeaders, backendUrl } from '@/lib/backend';
export async function POST(request: Request) {
  const denied = requireDeploymentAccess(request); if (denied) return denied;
  const userId = await authenticatedUser(request); if (!userId) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON result.' }, { status: 400 }); }
  if (!body || typeof body.content !== 'string' || body.content.length > 100000 || typeof body.token !== 'string' || body.token.length !== 64 || typeof body.requestId !== 'string') return Response.json({ error: 'Invalid workspace result.' }, { status: 400 });
  const result = await fetch(backendUrl('/api/agent/client-result'), { method: 'POST', headers: backendHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ requestId: body.requestId, token: body.token, content: body.content, error: body.error, userId }), signal: request.signal });
  return new Response(result.body, { status: result.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
