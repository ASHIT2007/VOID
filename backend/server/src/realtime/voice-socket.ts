import type { Server } from 'http';
// Native realtime and Deepgram use scoped provider credentials directly.
// The old environment-key socket cannot issue or consume managed voice access.
export function attachVoiceWebSocket(server: Server): void {
  server.on('upgrade', (request, socket) => {
    if (new URL(request.url || '/', 'http://localhost').pathname !== '/api/voice-stream') return;
    socket.write('HTTP/1.1 410 Gone\r\nConnection: close\r\n\r\n'); socket.destroy();
  });
}
