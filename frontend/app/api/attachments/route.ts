import { backendUrl } from '@/lib/backend';

export const runtime = 'nodejs';

// Stream multipart bytes to disk on the backend; never base64 a large file
// into the chat JSON body or buffer the whole upload in the Next.js process.
export async function POST(request: Request) {
  try {
    const response = await fetch(backendUrl('/api/attachments'), {
      method: 'POST', headers: { 'Content-Type': request.headers.get('content-type') || 'application/octet-stream' },
      body: request.body, signal: request.signal, duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    return new Response(response.body, { status: response.status, headers: { 'Content-Type': 'application/json' } });
  } catch {
    return Response.json({ error: 'Attachment upload was interrupted. Please retry.' }, { status: 503 });
  }
}
