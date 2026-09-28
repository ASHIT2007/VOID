import { Router } from 'express';
export const transcribeRouter = Router();
transcribeRouter.all(['/', ''], (_req, res) => res.status(410).json({ error: 'Use the authenticated BYOK transcription endpoint on the frontend.' }));
