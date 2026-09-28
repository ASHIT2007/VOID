import { Router } from 'express';
export const voiceRouter = Router();
voiceRouter.all(['/', ''], (_req, res) => res.status(410).json({ error: 'Managed voice has been removed. Use the authenticated BYOK /api/voice/session endpoint.' }));
