import { describe, expect, it } from 'vitest';
import { assessTask, effortBudget, resolveEffort } from '../../agent/effort-policy.js';

describe('thinking effort policy', () => {
  it('starts Auto at medium for straightforward work', () => {
    const policy = resolveEffort('auto', 'Explain JavaScript closures');
    expect(policy.effective).toBe('medium');
    expect(policy.automatic).toBe(true);
    expect(policy.assessment.simple).toBe(true);
  });

  it('escalates Auto conservatively for difficult verified reasoning', () => {
    const policy = resolveEffort('auto', 'Debug and verify an ambiguous production race condition');
    expect(policy.effective).toBe('high');
    expect(policy.reason).toMatch(/verification|uncertainty/i);
    expect(policy.searchMode).toBe('advanced');
  });

  it('never overrides a manual choice', () => {
    expect(resolveEffort('low', 'Prove this theorem').effective).toBe('low');
    expect(resolveEffort('high', 'Hello').effective).toBe('high');
  });

  it('classifies by the requested operation rather than payload length', () => {
    const longList = Array.from({ length: 500 }, (_, index) => `row ${index}`).join('\n');
    expect(assessTask(`Alphabetize this list:\n\n${longList}`).simple).toBe(true);
    expect(assessTask('Prove this theorem').hard).toBe(true);
  });

  it('keeps simple prompts to one agent while scaling substantive work', () => {
    expect(effortBudget('high', true).maxSpecialists).toBe(1);
    expect(effortBudget('low', false).maxSpecialists).toBe(1);
    expect(effortBudget('medium', false).maxSpecialists).toBe(2);
    expect(effortBudget('high', false).maxSpecialists).toBe(3);
  });

  it('escalates full question-bank solving and records the coverage requirement', () => {
    const policy = resolveEffort('auto', 'Solve every question in this R problem set', 1);
    expect(policy.effective).toBe('high');
    expect(policy.assessment.questionSet).toBe(true);
    expect(policy.assessment.simple).toBe(false);
  });
});
