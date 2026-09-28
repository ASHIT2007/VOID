import type { Express } from 'express';
import { voiceRouter } from '../routes/voice.js';
import { transcribeRouter } from '../routes/transcribe.js';
import { ttsRouter } from '../routes/tts.js';
import { agentRouter } from '../routes/agent.js';
import { chatRouter } from '../routes/chat.js';
import { attachmentsRouter } from '../routes/attachments.js';
import { aiGenerateRouter } from '../routes/ai-generate.js';
import { requireInternalAccess } from '../middleware/requireInternalAccess.js';

export function mountApiRoutes(app: Express): void {
  app.use('/api/voice-chat', requireInternalAccess, voiceRouter);
  app.use('/api/transcribe', requireInternalAccess, transcribeRouter);
  app.use('/api/tts', requireInternalAccess, ttsRouter);
  app.use('/api/agent', requireInternalAccess, agentRouter);
  app.use('/api/ai', requireInternalAccess, aiGenerateRouter);
  app.use('/api/chat', requireInternalAccess, chatRouter);
  app.use('/api/attachments', requireInternalAccess, attachmentsRouter);

  // Liveness exposes no credentials or user data. Hosting health probes cannot
  // supply the internal service key, so this one endpoint stays public.
  app.get('/api/ping', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });
}
