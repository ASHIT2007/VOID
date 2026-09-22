import type { Server as HttpServer, IncomingMessage } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { getAllowedCorsOrigins } from '../config/server.js';

const VOICE_SOCKET_PATH = '/api/voice-stream';
const MAX_PENDING_AUDIO_BYTES = 1_500_000;

function isAllowedOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  return !origin || getAllowedCorsOrigins().has(origin);
}

/**
 * Streams browser microphone chunks through the local server to Deepgram.
 * This is used when the configured key cannot mint scoped browser tokens.
 */
export function attachVoiceWebSocket(server: HttpServer): void {
  const voiceServer = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '/', 'http://localhost');
    if (url.pathname !== VOICE_SOCKET_PATH) return;
    if (!isAllowedOrigin(request)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    voiceServer.handleUpgrade(request, socket, head, (client) => {
      voiceServer.emit('connection', client, request);
    });
  });

  voiceServer.on('connection', (client, request) => {
    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) {
      client.close(1011, 'Live transcription is not configured');
      return;
    }

    const requestUrl = new URL(request.url || VOICE_SOCKET_PATH, 'http://localhost');
    const searchParams = new URLSearchParams(requestUrl.search);
    const utteranceMs = Number(searchParams.get('utterance_end_ms'));
    if (utteranceMs && utteranceMs < 1000) {
      searchParams.set('utterance_end_ms', '1000');
    }
    const upstreamUrl = `wss://api.deepgram.com/v1/listen?${searchParams.toString()}`;
    const upstream = new WebSocket(upstreamUrl, {
      headers: { Authorization: `Token ${apiKey}` },
    });
    const pendingAudio: Array<Buffer | ArrayBuffer | Buffer[]> = [];
    let pendingBytes = 0;

    upstream.on('open', () => {
      for (const chunk of pendingAudio) upstream.send(chunk);
      pendingAudio.length = 0;
      pendingBytes = 0;
      if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: 'ProxyReady' }));
    });

    upstream.on('unexpected-response', (_req, res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        console.warn(`Deepgram live socket unexpected response ${res.statusCode}:`, body);
      });
    });

    upstream.on('message', (data, isBinary) => {
      if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
    });

    upstream.on('error', (error) => {
      console.warn('Deepgram live socket error:', error.message);
      if (client.readyState === WebSocket.OPEN) client.close(1011, 'Transcription provider unavailable');
    });

    upstream.on('close', (code, reason) => {
      if (client.readyState === WebSocket.OPEN) client.close(code === 1000 ? 1000 : 1011, reason.toString().slice(0, 120));
    });

    client.on('message', (data, isBinary) => {
      if (upstream.readyState === WebSocket.OPEN) {
        upstream.send(data, { binary: isBinary });
        return;
      }
      const byteLength = Array.isArray(data)
        ? data.reduce((sum, item) => sum + item.byteLength, 0)
        : data.byteLength;
      if (pendingBytes + byteLength > MAX_PENDING_AUDIO_BYTES) {
        client.close(1009, 'Audio buffer limit reached');
        return;
      }
      pendingAudio.push(data);
      pendingBytes += byteLength;
    });

    client.on('close', () => {
      pendingAudio.length = 0;
      if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.close(1000, 'Client disconnected');
    });

    client.on('error', () => {
      if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.close();
    });
  });
}
