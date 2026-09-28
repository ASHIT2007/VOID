import { requireDeploymentAccess } from '@/lib/deployment-access';
import { authenticatedUser, loadByokContext } from '@/lib/ai/server';
import { backendHeaders, backendUrl } from '@/lib/backend';
export async function POST(request: Request) {
  const denied = requireDeploymentAccess(request); if (denied) return denied;
  const userId = await authenticatedUser(request); if (!userId) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'Invalid selected-file request.' }, { status: 400 }); }
  if (!body) return Response.json({ error: 'Choose a supported file.' }, { status: 400 });
  if (!body.attachment || typeof body.attachment.base64 !== 'string' || body.attachment.base64.length > 20000000) return Response.json({ error: 'Choose a file smaller than 15 MB.' }, { status: 400 });
  const byok = await loadByokContext(userId);
  const result = await fetch(backendUrl('/api/agent/read-file'), { method: 'POST', headers: backendHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ byok, attachments: [body.attachment] }), signal: request.signal });
  return new Response(result.body, { status: result.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
