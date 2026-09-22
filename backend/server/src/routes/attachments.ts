import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { attachmentDirectory, attachmentPath, ATTACHMENT_MAX_MB } from '../lib/attachment-store.js';

export const attachmentsRouter = Router();
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      mkdirSync(attachmentDirectory, { recursive: true });
      callback(null, attachmentDirectory);
    },
    filename: (_req, _file, callback) => callback(null, randomUUID()),
  }),
  limits: { fileSize: ATTACHMENT_MAX_MB * 1024 * 1024, files: 1, fields: 0 },
});
attachmentsRouter.post('/', (req, res) => {
  upload.single('file')(req, res, (error) => {
    if (error) {
      res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: error.code === 'LIMIT_FILE_SIZE'
        ? `The file exceeds the server's ${ATTACHMENT_MAX_MB} MB upload limit.` : 'Attachment upload failed.' });
      return;
    }
    if (!req.file) { res.status(400).json({ error: 'A file is required.' }); return; }
    res.json({ url: `/api/attachments/${req.file.filename}`, name: req.file.originalname, type: req.file.mimetype });
  });
});
attachmentsRouter.get('/:id', async (req, res) => {
  try {
    const filePath = attachmentPath(String(req.params.id));
    const handle = await open(filePath, 'r');
    const header = Buffer.alloc(16);
    try { await handle.read(header, 0, 16, 0); } finally { await handle.close(); }
    // Sniff safe preview formats, never trust a user-supplied HTML/SVG MIME.
    const mime = header.subarray(0, 5).toString() === '%PDF-' ? 'application/pdf'
      : header.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png'
      : header[0] === 255 && header[1] === 216 && header[2] === 255 ? 'image/jpeg'
      : header.subarray(0, 3).toString() === 'GIF' ? 'image/gif'
      : header.subarray(0, 4).toString() === 'RIFF' && header.subarray(8, 12).toString() === 'WEBP' ? 'image/webp'
      : 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', mime === 'application/octet-stream' ? 'attachment' : 'inline');
    res.sendFile(filePath, (error) => {
      if (error && !res.headersSent) res.status(404).end();
    });
  } catch { res.status(404).end(); }
});
