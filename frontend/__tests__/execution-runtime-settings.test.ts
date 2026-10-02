import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultExecutionConfig, EXECUTION_METADATA_KEY } from '@void/shared/execution-config.mjs';
const mocks = vi.hoisted(() => ({ metadata: {} as Record<string, unknown> }));
vi.mock('@/lib/ai/server', () => ({ serviceDb: () => ({ auth: { admin: { getUserById: async () => ({ data: { user: { user_metadata: mocks.metadata } }, error: null }) } } }) }));
import { readExecutionConfig } from '@/lib/ai/execution-settings';
const primary = '11111111-1111-4111-8111-111111111111', unavailable = '22222222-2222-4222-8222-222222222222';
beforeEach(() => { mocks.metadata = {}; });
describe('runtime orchestration settings', () => {
  it('keeps unavailable assignments so routing can report their failure instead of dropping the team', async () => {
    const config = { ...defaultExecutionConfig(primary), roles: [{ id: 'research', name: 'Researcher', kind: 'researcher', modelId: unavailable, instruction: '' }], fallbackModelIds: [unavailable] };
    mocks.metadata[EXECUTION_METADATA_KEY] = config;
    expect(await readExecutionConfig('user', [primary])).toEqual(config);
  });
  it('keeps an unavailable primary rather than silently selecting a specialist as the coordinator', async () => {
    mocks.metadata[EXECUTION_METADATA_KEY] = defaultExecutionConfig(unavailable);
    expect(await readExecutionConfig('user', [primary])).toEqual(defaultExecutionConfig(unavailable));
  });
  it('defaults to an eligible model when there is no saved configuration', async () => {
    expect(await readExecutionConfig('user', [primary])).toEqual(defaultExecutionConfig(primary));
  });
});
