import { Router } from 'express';
import type { Request, Response } from 'express';
import { DeepgramClient } from '@deepgram/sdk';
import multer from 'multer';

export const transcribeRouter = Router();

const upload = multer({ storage: multer.memoryStorage() });

function errorStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object' || !('statusCode' in error)) return undefined;
  return typeof error.statusCode === 'number' ? error.statusCode : undefined;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Mint a short-lived browser token for the real-time transcription socket.
 * The long-lived Deepgram key never leaves the server.
 */
transcribeRouter.get(['/', ''], async (_req: Request, res: Response): Promise<void> => {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: { message: 'Live transcription is not configured' } });
    return;
  }

  try {
    const deepgram = new DeepgramClient({ apiKey });
    const token = await deepgram.auth.v1.tokens.grant({ ttl_seconds: 60 });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ token: token.access_token, expiresIn: token.expires_in ?? 60 });
  } catch (error: unknown) {
    // Some Deepgram keys can use speech APIs but cannot grant scoped JWTs.
    // In that case the client connects through our server-side WebSocket proxy.
    if (errorStatusCode(error) === 403) {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ proxy: true });
      return;
    }
    console.error('Deepgram token grant error:', error);
    res.status(502).json({ error: { message: 'Unable to start live transcription' } });
  }
});

transcribeRouter.post(['/', ''], upload.single('audio'), async (req: Request, res: Response): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ error: { message: 'Missing "audio" file' } });
    return;
  }

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    res.status(500).json({ error: { message: 'GROQ_API_KEY not configured' } });
    return;
  }

  try {
    const formData = new FormData();
    formData.append('file', new Blob([req.file.buffer], { type: req.file.mimetype || 'audio/webm' }), req.file.originalname || 'audio.webm');
    formData.append('model', 'whisper-large-v3-turbo');

    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${groqKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Groq returned ${response.status}: ${await response.text()}`);
    }

    const data = await response.json() as { text?: string };
    res.json({ text: data.text || '' });
  } catch (error: unknown) {
    console.error('Transcribe Route Error:', error);
    res.status(500).json({ error: { message: errorMessage(error, 'Internal Server Error') } });
  }
});
