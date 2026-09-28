import { Router } from 'express';
export { speechLanguage as inferLanguageCode } from '@void/shared/speech-language.mjs';
export const ttsRouter = Router();
ttsRouter.all(['/', ''], (_req, res) => res.status(410).json({ error: 'Use the authenticated BYOK speech endpoint on the frontend.' }));
