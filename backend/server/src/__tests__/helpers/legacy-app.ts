// Historical proxy tests retain coverage without exposing these APIs in VOID.
import { createApp as createVoidApp } from '../../app.js';
import { keysRouter } from '../../routes/keys.js';
import { modelsRouter } from '../../routes/models.js';
import { proxyRouter } from '../../routes/proxy.js';
import { responsesRouter } from '../../routes/responses.js';
import { fallbackRouter } from '../../routes/fallback.js';
import { embeddingsRouter } from '../../routes/embeddings.js';
import { analyticsRouter } from '../../routes/analytics.js';
import { healthRouter } from '../../routes/health.js';
import { settingsRouter } from '../../routes/settings.js';
import { authRouter } from '../../routes/auth.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { createProxyRateLimiter } from '../../middleware/rateLimit.js';
import { errorHandler } from '../../middleware/errorHandler.js';

export function createApp() {
  const app = createVoidApp();
  app.use('/api/auth', authRouter);
  app.use('/api/keys', requireAuth, keysRouter);
  app.use('/api/models', requireAuth, modelsRouter);
  app.use('/api/fallback', requireAuth, fallbackRouter);
  app.use('/api/embeddings', requireAuth, embeddingsRouter);
  app.use('/api/analytics', requireAuth, analyticsRouter);
  app.use('/api/health', requireAuth, healthRouter);
  app.use('/api/settings', requireAuth, settingsRouter);
  app.use('/v1', createProxyRateLimiter(), proxyRouter, responsesRouter);
  app.use(errorHandler);
  return app;
}
