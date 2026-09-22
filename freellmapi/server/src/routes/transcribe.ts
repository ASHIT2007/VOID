import { Router } from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';

import { getUnifiedApiKey } from '../db/index.js';
import { timingSafeStringEqual, extractApiToken } from './proxy.js';

export const transcribeRouter = Router();

const upload = multer({ storage: multer.memoryStorage() });

transcribeRouter.post(['/', ''], upload.single('audio'), async (req: Request, res: Response): Promise<void> => {
  const token = extractApiToken(req);
  const unifiedKey = getUnifiedApiKey();
  if (!token || !timingSafeStringEqual(token, unifiedKey)) {
    res.status(401).json({ error: { message: 'Invalid API key', type: 'authentication_error' } });
    return;
  }

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
        'Authorization': `Bearer ${groqKey}`
      },
      body: formData
    });

    if (!response.ok) {
      throw new Error(`Groq returned ${response.status}: ${await response.text()}`);
    }

    const data = await response.json() as { text?: string };
    res.json({ text: data.text || '' });
  } catch (error: any) {
    console.error('Transcribe Route Error:', error);
    res.status(500).json({ error: { message: error.message || 'Internal Server Error' } });
  }
});
