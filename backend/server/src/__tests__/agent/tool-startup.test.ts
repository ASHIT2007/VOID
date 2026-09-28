import { afterEach, describe, expect, it, vi } from 'vitest';
import { TOOL_NAMES } from '@void/shared/tool-protocol.mjs';
const deviceTools = ['code_execution', 'file_read', 'file_write', 'memory_list', 'generate_document', 'generate_presentation', 'generate_spreadsheet', 'generate_pdf'];
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
describe('server tool initialization', () => {
  it('registers every deployment tool, including exported initializers, and makes them discoverable', async () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('ENABLE_LOCAL_HOST_TOOLS', 'true'); vi.resetModules();
    const { getAllTools, getTool } = await import('../../agent/index.js');
    expect(getAllTools().map(tool => tool.name).sort()).toEqual([...TOOL_NAMES].sort());
    const result = await getTool('tool_search')!.handler({ query: 'calculator' });
    expect(result.availableTools).toContain('calculator');
    expect((await getTool('calculator')!.handler({ expression: '12 + 27' })).content).toContain('39');
    expect(getTool('render_diagram')).toBeDefined();
  });
  it('registers device tools in normal chat without exposing host execution', async () => {
    vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('ENABLE_LOCAL_HOST_TOOLS', 'false'); vi.resetModules();
    const { getTool } = await import('../../agent/index.js');
    for (const name of deviceTools) expect((await getTool(name)!.handler({})).error).toBe('browser_unavailable');
  });
  it('does not restore host access through the old development flag', async () => {
    vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('ENABLE_LOCAL_HOST_TOOLS', 'true'); vi.resetModules();
    const { getAllTools, getTool } = await import('../../agent/index.js');
    expect(getAllTools().map(tool => tool.name).sort()).toEqual([...TOOL_NAMES].sort());
    expect((await getTool('code_execution')!.handler({ code: 'process.exit()', language: 'javascript' })).error).toBe('browser_unavailable');
  });
});
