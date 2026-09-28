import { browserTool } from './browser-workspace.js';
export function registerMemoryTools(): void {
  browserTool('memory_set', 'Store a memory entry locally on this device and account only. Cloud memory sync is disabled. Explain the proposed memory and get device workspace approval.', {
    key: { type: 'string' }, value: { type: 'string' }, tags: { type: 'string' }
  }, ['key', 'value']);
  browserTool('memory_get', 'Read matching device/account memory entries. Only returned matches are sent to the connected model after user approval. Storage is local; cloud sync is disabled.', { query: { type: 'string' } });
  browserTool('memory_list', 'Audit all local memory entries for this device and account in the workspace. Cloud sync is disabled.', {});
  browserTool('memory_delete', 'Delete one local memory entry after explicit user approval.', { key: { type: 'string' } }, ['key']);
}
