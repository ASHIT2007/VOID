// The former environment-key voice pipeline is retired. All sessions use BYOK.
export { POST } from './session/route';
export async function GET() { return Response.json({ error: 'Use Voice Agent settings and POST /api/voice/session.' }, { status: 410, headers: { 'Cache-Control': 'no-store' } }); }
