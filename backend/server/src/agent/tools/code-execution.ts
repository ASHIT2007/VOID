import { browserTool } from './browser-workspace.js';
export function registerCodeExecutionTools(): void {
  browserTool('code_execution', 'Run a small Python or JavaScript program in an isolated, disposable on-device runtime. No host filesystem, DOM, account credentials or unrestricted network. Results appear in a separate workspace overlay and return to the conversation. Standard libraries only; external installs are unsupported.', {
    code: { type: 'string', maxLength: 30000 }, language: { type: 'string', enum: ['python', 'javascript'] }
  }, ['code', 'language']);
}
