import { browserTool } from './browser-workspace.js';
export function registerFileTools(): void {
  browserTool('file_read', 'Read a file explicitly selected by the user, including PDF/scans, DOCX, XLSX, text/code or an image. This never reads arbitrary host paths. The user approves sending selected content to VOID and the connected model.', { filename: { type: 'string' } });
  browserTool('file_write', 'Create an on-device downloadable raw text, code or CSV file. Use format-specific generation for DOCX/PPTX/XLSX/PDF. Does not overwrite host files.', {
    filename: { type: 'string' }, content: { type: 'string', maxLength: 100000 }
  }, ['filename', 'content']);
}
