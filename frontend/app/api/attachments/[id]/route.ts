import { requireDeploymentAccess } from '@/lib/deployment-access';
import { backendUrl, backendHeaders } from '@/lib/backend';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = requireDeploymentAccess(request);
  if (denied) return denied;
  const { id } = await context.params;
  if (!/^[a-f0-9-]{36}$/i.test(id)) return new Response(null, { status: 400 });
  try {
    const response = await fetch(backendUrl(`/api/attachments/${id}`), { headers: backendHeaders(), signal: request.signal });
    return new Response(response.body, { status: response.status, headers: {
      'Content-Type': response.headers.get('content-type') || 'application/octet-stream',
      'Content-Disposition': response.headers.get('content-disposition') || 'attachment',
      'X-Content-Type-Options': 'nosniff',
    } });
  } catch { return new Response(null, { status: 503 }); }
}
