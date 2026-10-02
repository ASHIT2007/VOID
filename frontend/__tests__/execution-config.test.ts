import { describe, expect, it } from 'vitest';
import { defaultExecutionConfig, parseExecutionConfig, reconcileExecutionConfig, executionWithPrimary, suggestedRoleModel } from '@void/shared/execution-config.mjs';
const primary = '11111111-1111-4111-8111-111111111111', second = '22222222-2222-4222-8222-222222222222';
describe('saved execution contract', () => {
  it('places the answer writer last without changing specialist order', () => {
    const config = { ...defaultExecutionConfig(primary), roles: [
      { id: 'writer', name: 'Writer', kind: 'answer_writer', modelId: primary, instruction: '' },
      { id: 'research', name: 'Researcher', kind: 'researcher', modelId: second, instruction: '' },
      { id: 'review', name: 'Review', kind: 'fact_checker', modelId: primary, instruction: '' },
    ] };
    expect(parseExecutionConfig(config).roles.map(role => role.id)).toEqual(['research', 'review', 'writer']);
  });
  it('rejects malformed model identifiers even when they have 36 characters', () => {
    expect(() => parseExecutionConfig(defaultExecutionConfig('-'.repeat(36)))).toThrow(/primary/);
  });
  it('defaults to a single model with no specialist workers or fallback', () => {
    expect(reconcileExecutionConfig(undefined, [primary, second])).toEqual(defaultExecutionConfig(primary));
  });
  it('allows one model to handle several named and custom roles', () => {
    const config = { ...defaultExecutionConfig(primary), roles: [
      { id: 'research', name: 'Researcher', kind: 'researcher', modelId: primary, instruction: '' },
      { id: 'review', name: 'Security review', kind: 'custom', modelId: primary, instruction: 'Check the answer for security errors.' },
    ] };
    expect(parseExecutionConfig(config).roles).toHaveLength(2);
  });
  it('retains the specialist assignments when a device preference selects another primary', () => {
    const config = parseExecutionConfig({ ...defaultExecutionConfig(primary), fallbackModelIds: [second], roles: [
      { id: 'research', name: 'Researcher', kind: 'researcher', modelId: primary, instruction: '' },
      { id: 'review', name: 'Security review', kind: 'custom', modelId: second, instruction: 'Check security.' },
    ] });
    expect(executionWithPrimary(config, second)).toEqual({ ...config, primaryModelId: second, fallbackModelIds: [] });
    expect(config.primaryModelId).toBe(primary);
    expect(config.fallbackModelIds).toEqual([second]);
    expect(executionWithPrimary(undefined, second)).toBeUndefined();
  });
  it('assigns new roles to unused connected models before sharing an existing model', () => {
    const third = '33333333-3333-4333-8333-333333333333';
    const config = parseExecutionConfig({ ...defaultExecutionConfig(primary), roles: [
      { id: 'research', name: 'Researcher', kind: 'researcher', modelId: second, instruction: '' },
    ] });
    expect(suggestedRoleModel(config, [primary, second, third])).toBe(third);
    expect(suggestedRoleModel(defaultExecutionConfig(primary), [primary, second])).toBe(second);
    expect(suggestedRoleModel(config, [primary])).toBe(primary);
  });
  it('keeps explicit fallback order and removes disconnected assignments', () => {
    const config = { ...defaultExecutionConfig(primary), fallbackModelIds: [second], roles: [{ id: 'research', name: 'Researcher', kind: 'researcher', modelId: second, instruction: '' }] };
    expect(reconcileExecutionConfig(config, [primary]).roles).toEqual([]);
    expect(reconcileExecutionConfig(config, [primary]).fallbackModelIds).toEqual([]);
    expect(reconcileExecutionConfig(config, [primary, second]).fallbackModelIds).toEqual([second]);
  });
  it('rejects duplicate fallbacks, ambiguous writers and empty custom instructions', () => {
    expect(() => parseExecutionConfig({ ...defaultExecutionConfig(primary), fallbackModelIds: [primary] })).toThrow(/distinct/);
    expect(() => parseExecutionConfig({ ...defaultExecutionConfig(primary), fallbackModelIds: [second, second] })).toThrow(/distinct/);
    expect(() => parseExecutionConfig({ ...defaultExecutionConfig(primary), roles: [{ id: 'x', name: 'Custom', kind: 'custom', modelId: primary, instruction: '' }] })).toThrow(/Describe/);
  });
});
