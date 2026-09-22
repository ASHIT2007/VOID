import type { Express } from 'express';
import { keysRouter } from '../routes/keys.js';
import { modelsRouter } from '../routes/models.js';
import { proxyRouter } from '../routes/proxy.js';
import { responsesRouter } from '../routes/responses.js';
import { fallbackRouter } from '../routes/fallback.js';
import { embeddingsRouter } from '../routes/embeddings.js';
import { analyticsRouter } from '../routes/analytics.js';
import { healthRouter } from '../routes/health.js';
import { settingsRouter } from '../routes/settings.js';
import { authRouter } from '../routes/auth.js';
import { voiceRouter } from '../routes/voice.js';
import { transcribeRouter } from '../routes/transcribe.js';
import { ttsRouter } from '../routes/tts.js';
import { agentRouter } from '../routes/agent.js';
import { chatRouter } from '../routes/chat.js';
import { attachmentsRouter } from '../routes/attachments.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { createProxyRateLimiter } from '../middleware/rateLimit.js';

export function mountApiRoutes(app: Express): void {
  // Dashboard auth bootstrap is public; the rest of /api admin is session-gated.
  app.use('/api/auth', authRouter);
  app.use('/api/keys', requireAuth, keysRouter);
  app.use('/api/models', requireAuth, modelsRouter);
  app.use('/api/fallback', requireAuth, fallbackRouter);
  app.use('/api/embeddings', requireAuth, embeddingsRouter);
  app.use('/api/analytics', requireAuth, analyticsRouter);
  app.use('/api/health', requireAuth, healthRouter);
  app.use('/api/settings', requireAuth, settingsRouter);

  // OpenAI-compatible proxy keeps unified API-key auth inside the router.
  app.use('/v1', createProxyRateLimiter());
  app.use('/v1', proxyRouter);
  app.use('/v1', responsesRouter);

  app.use('/api/voice-chat', voiceRouter);
  app.use('/api/transcribe', transcribeRouter);
  app.use('/api/tts', ttsRouter);
  app.use('/api/agent', agentRouter);
  app.use('/api/chat', chatRouter);
  app.use('/api/attachments', attachmentsRouter);

  app.get('/api/ping', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });
}
