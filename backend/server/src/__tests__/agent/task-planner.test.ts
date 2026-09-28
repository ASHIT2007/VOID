import { describe, expect, it } from 'vitest';
import { createExecutionPlan } from '../../agent/task-planner.js';

describe('adaptive agent task planner', () => {
  it('uses one agent for a greeting', () => {
    const plan = createExecutionPlan({ message: 'hi', mode: 'normal', reasoningEffort: 'low' });
    expect(plan.agents).toHaveLength(1);
    expect(plan.agents[0].role).toBe('general');
  });

  it('ignores transport directives when routing a greeting', () => {
    const plan = createExecutionPlan({
      message: 'hi\n\n[SYSTEM DIRECTIVE: You have access to web search tools. Use them for current sources and cite retrieved claims.]',
      mode: 'normal',
      reasoningEffort: 'high',
    });
    expect(plan.intent).toBe('simple');
    expect(plan.agents.map((agent) => agent.role)).toEqual(['general']);
  });

  it('keeps a short factual prompt single-agent even at high effort in auto mode', () => {
    const plan = createExecutionPlan({ message: 'Tell me about Kakashi', mode: 'normal', reasoningEffort: 'high' });
    expect(plan.intent).toBe('simple');
    expect(plan.agents.map((agent) => agent.role)).toEqual(['general']);
  });

  it('still fans out genuinely complex high-effort prompts', () => {
    const plan = createExecutionPlan({ message: 'Compare and evaluate three database architectures', mode: 'normal', reasoningEffort: 'high' });
    expect(plan.intent).toBe('reasoning');
    expect(plan.agents.map((agent) => agent.role)).toEqual(['analyst', 'fact_checker', 'general']);
  });

  it('uses three independent roles for deep research', () => {
    const plan = createExecutionPlan({ message: 'Deep research the current battery market', mode: 'deep_research', reasoningEffort: 'high' });
    expect(plan.agents).toHaveLength(3);
    expect(plan.agents.map((agent) => agent.role)).toEqual(['researcher', 'analyst', 'fact_checker']);
  });

  it('uses a bounded specialist pair for medium-effort presentations', () => {
    const plan = createExecutionPlan({ message: 'Make a presentation about Sri Lanka debt crisis, preview only', mode: 'normal', reasoningEffort: 'medium' });
    expect(plan.intent).toBe('artifact');
    expect(plan.agents).toHaveLength(2);
    expect(plan.artifactKind).toBe('visual');
  });

  it('routes plural infographic wording through the visual artifact contract', () => {
    const plan = createExecutionPlan({ message: 'make an random infographics', mode: 'normal', reasoningEffort: 'medium' });
    expect(plan).toMatchObject({ intent: 'artifact', artifactKind: 'visual' });
    expect(plan.agents.map((agent) => agent.role)).toEqual(['researcher', 'content_strategist']);
  });

  it('routes reports through the document artifact contract', () => {
    const plan = createExecutionPlan({ message: 'Make a detailed report on the Sri Lanka debt crisis', mode: 'normal', reasoningEffort: 'medium' });
    expect(plan.intent).toBe('artifact');
    expect(plan.artifactKind).toBe('report');
  });

  it('routes web previews through one fast artifact specialist', () => {
    const plan = createExecutionPlan({ message: 'Make a working responsive calculator in HTML CSS and JS and show the preview', mode: 'normal', reasoningEffort: 'medium' });
    expect(plan.intent).toBe('artifact');
    expect(plan.artifactKind).toBe('web');
    expect(plan.agents.map((agent) => agent.role)).toEqual(['artifact_architect']);
  });

  it('treats a complete attached question bank as complex coverage work', () => {
    const plan = createExecutionPlan({ message: 'Solve all questions in the attached R question bank', mode: 'normal', reasoningEffort: 'high', attachmentCount: 1 });
    expect(plan.intent).toBe('reasoning');
    expect(plan.agents.map((agent) => agent.role)).toEqual(['analyst', 'fact_checker', 'general']);
  });

  it('does not turn presentation review requests into deck creation', () => {
    for (const message of ['Rate the PPT', 'Review this presentation', 'Critique the attached slides', 'Evaluate my PowerPoint']) {
      expect(createExecutionPlan({ message, mode: 'normal', reasoningEffort: 'medium' }).intent).not.toBe('artifact');
    }
  });

  it('still creates an improved deck when creation is explicitly requested', () => {
    const plan = createExecutionPlan({ message: 'Rate this PPT and create an improved presentation', mode: 'normal', reasoningEffort: 'medium' });
    expect(plan).toMatchObject({ intent: 'artifact', artifactKind: 'visual' });
    expect(plan.agents).toHaveLength(2);
  });
  it.each(['Generate a PPT about solar energy', 'genrate a ppt on solar energy', 'Create a presentation on solar energy', 'Make a PowerPoint with a preview', 'Download a .pptx and show a preview', 'Make a PPT with diagrams about solar energy'])('routes %s through the presentation skill', message => {
    expect(createExecutionPlan({ message, mode: 'normal', reasoningEffort: 'medium' })).toMatchObject({ intent: 'artifact', artifactKind: 'visual' });
  });

  it('assigns a visual researcher when real images are required', () => {
    const plan = createExecutionPlan({ message: 'Make a PPT and use real images, preview only', mode: 'normal', reasoningEffort: 'high' });
    expect(plan.agents.map((agent) => agent.role)).toContain('visual_researcher');
    expect(plan.agents).toHaveLength(3);
  });

  it('honors the max-agent safety cap', () => {
    const plan = createExecutionPlan({ message: 'Make a researched PPT with real photos, preview only', mode: 'deep_research', reasoningEffort: 'high', maxAgents: 2 });
    expect(plan.agents).toHaveLength(2);
  });
  it.each(['Make a PowerPoint on solar energy', 'Create an Excel budget', 'Generate a PDF report'])('retains action tools through a single lead for %s', message => {
    const plan = createExecutionPlan({ message, mode: 'deep_research', reasoningEffort: 'high' });
    expect(plan.intent).toBe('simple'); expect(plan.artifactKind).toBeUndefined(); expect(plan.agents.map(agent => agent.role)).toEqual(['general']);
  });

  it('uses a specialist pair for a non-trivial medium request', () => {
    const plan = createExecutionPlan({
      message: 'Draft an implementation plan for adding passkeys to our account system',
      mode: 'normal',
      reasoningEffort: 'medium',
    });
    expect(plan.intent).toBe('reasoning');
    expect(plan.agents.map((agent) => agent.role)).toEqual(['analyst', 'general']);
  });

  it('keeps long mechanical payloads single-agent at every effort', () => {
    const payload = Array.from({ length: 200 }, (_, index) => `item ${200 - index}`).join('\n');
    for (const reasoningEffort of ['low', 'medium', 'high'] as const) {
      const plan = createExecutionPlan({
        message: `Sort this list alphabetically:\n\n${payload}`,
        mode: 'normal',
        reasoningEffort,
      });
      expect(plan.agents.map((agent) => agent.role)).toEqual(['general']);
    }
  });

  it('gives a one-line proof request high-effort fan-out', () => {
    const plan = createExecutionPlan({ message: 'Prove Fermat\'s little theorem', mode: 'normal', reasoningEffort: 'high' });
    expect(plan.intent).toBe('reasoning');
    expect(plan.agents.map((agent) => agent.role)).toEqual(['analyst', 'fact_checker', 'general']);
  });
});
