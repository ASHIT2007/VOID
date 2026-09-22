import { describe, expect, it } from 'vitest';
import { buildEvidenceFallback, hasSubstantivePresentation, hasSubstantiveReport, hasSubstantiveWebArtifact, parseWorkerReport, requestedPresentationMinimumSlides } from '../../agent/multi-agent-orchestrator.js';

const validReport = {
  status: 'ok',
  summary: 'The requested behavior is supported.',
  findings: ['Finding one'],
  claims: [{
    claim: 'Claim one',
    evidence: 'Primary source evidence',
    sourceUrls: ['https://example.com/source'],
    confidence: 0.9,
  }],
  sources: [{ url: 'https://example.com/source', title: 'Primary source' }],
  risks: [],
  confidence: 0.85,
};

describe('multi-agent worker report contract', () => {
  it('accepts a strict JSON report', () => {
    expect(parseWorkerReport(JSON.stringify(validReport))).toEqual(validReport);
  });

  it('accepts a fenced JSON report without accepting surrounding prose', () => {
    expect(parseWorkerReport(`\`\`\`json\n${JSON.stringify(validReport)}\n\`\`\``)).toEqual(validReport);
  });

  it('rejects malformed or incomplete reports', () => {
    expect(parseWorkerReport('{"status":"ok","summary":"missing fields"}')).toBeNull();
    expect(parseWorkerReport('not json')).toBeNull();
  });

  it('rejects title-only presentation slides and accepts substantive slides', () => {
    const titleOnly = {
      title: 'AI presentation',
      slides: [
        { title: 'AI presentation', layout: 'hero', content: {} },
        { title: 'Foundational philosophies', subtitle: 'The choice depends on priority', layout: 'editorial', content: {} },
      ],
    };
    const substantive = {
      ...titleOnly,
      slides: [
        titleOnly.slides[0],
        {
          ...titleOnly.slides[1],
          content: {
            bodyText: 'Rule-based systems and statistical learning make different tradeoffs in explainability, data needs, and adaptability.',
            bullets: ['Symbolic systems encode explicit rules.', 'Statistical models learn patterns from examples.'],
          },
        },
      ],
    };
    expect(hasSubstantivePresentation(`\`\`\`gamma-presentation\n${JSON.stringify(titleOnly)}\n\`\`\``)).toBe(false);
    expect(hasSubstantivePresentation(`\`\`\`gamma-presentation\n${JSON.stringify(substantive)}\n\`\`\``)).toBe(true);
  });

  it('preserves one-slide-per-member coverage before structural slides', () => {
    const request = 'Make a PPT on seven ninja swordsmen and allocate a slide to each member with pictures.';
    expect(requestedPresentationMinimumSlides(request)).toBe(10);
    const slide = (index: number) => ({
      title: index === 0 ? 'Seven Ninja Swordsmen' : `Member ${index}`,
      layout: index === 0 ? 'hero' : 'image-feature',
      imageUrl: `https://images.example/member-${index}.jpg`,
      content: {
        bodyText: 'This profile explains the member, their weapon, fighting style, affiliations, and significance to the group.',
        bullets: ['The member has a distinct weapon and combat role.', 'Their history connects to Kirigakure and the wider team.'],
      },
    });
    const shortDeck = { title: 'Seven Ninja Swordsmen', slides: Array.from({ length: 7 }, (_, index) => slide(index)) };
    const completeDeck = { ...shortDeck, slides: Array.from({ length: 10 }, (_, index) => slide(index)) };
    expect(hasSubstantivePresentation(`\`\`\`gamma-presentation\n${JSON.stringify(shortDeck)}\n\`\`\``, request)).toBe(false);
    expect(hasSubstantivePresentation(`\`\`\`gamma-presentation\n${JSON.stringify(completeDeck)}\n\`\`\``, request)).toBe(true);
  });

  it('rejects a heading plus one thin paragraph and accepts a complete native figure', () => {
    const thin = {
      title: 'Tesla',
      slides: [
        { title: 'Tesla', layout: 'hero', content: {} },
        { title: 'Wardenclyffe Tower', layout: 'editorial', content: { bodyText: 'Tesla hoped the tower would transmit messages and power.' } },
      ],
    };
    const timeline = {
      ...thin,
      slides: [thin.slides[0], {
        title: 'Development', layout: 'timeline', content: { timeline: [
          { step: '1898', title: 'Control', description: 'Tesla demonstrated radio control before a public audience.' },
          { step: '1901', title: 'Construction', description: 'Construction began on the Wardenclyffe transmission station.' },
          { step: '1917', title: 'Demolition', description: 'The tower was dismantled after financing had collapsed.' },
        ] },
      }],
    };
    expect(hasSubstantivePresentation(`\`\`\`gamma-presentation\n${JSON.stringify(thin)}\n\`\`\``)).toBe(false);
    expect(hasSubstantivePresentation(`\`\`\`gamma-presentation\n${JSON.stringify(timeline)}\n\`\`\``)).toBe(true);
  });

  it('rejects empty infographics and requires a native information figure plus explanation', () => {
    const empty = { title: 'Water Cycle', format: 'infographic', slides: [{ title: 'The Water Cycle', layout: 'poster', content: {} }] };
    const complete = { title: 'Water Cycle', format: 'infographic', slides: [{
      title: 'The Water Cycle', layout: 'poster', content: {
        bodyText: 'Water continually circulates between Earth’s surface and atmosphere, driven by solar energy and gravity through linked phase changes.',
        process: [
          { title: 'Evaporation', description: 'Solar heat turns surface water into vapor.' },
          { title: 'Condensation', description: 'Cooling vapor forms droplets and clouds.' },
          { title: 'Precipitation', description: 'Water returns as rain, snow, or hail.' },
          { title: 'Collection', description: 'Runoff and groundwater replenish stores.' },
        ],
      },
    }] };
    expect(hasSubstantivePresentation(`\`\`\`gamma-presentation\n${JSON.stringify(empty)}\n\`\`\``)).toBe(false);
    expect(hasSubstantivePresentation(`\`\`\`gamma-presentation\n${JSON.stringify(complete)}\n\`\`\``)).toBe(true);
  });

  it('builds a readable cited answer from successful worker evidence', () => {
    const fallback = buildEvidenceFallback([{
      agent: { id: 'researcher', role: 'researcher', label: 'Researcher', instruction: 'Research.' },
      ok: true,
      report: validReport,
      sources: [],
    }]);
    expect(fallback).toContain('The requested behavior is supported.');
    expect(fallback).toContain('## Key findings');
    expect(fallback).toContain('Claim one[1]');
    expect(fallback).toContain('[Primary source](https://example.com/source)');
  });

  it('removes provider-internal retrieval markers from recovered evidence', () => {
    const fallback = buildEvidenceFallback([{
      agent: { id: 'researcher', role: 'researcher', label: 'Researcher', instruction: 'Research.' },
      ok: true,
      report: { ...validReport, summary: 'Confirmed by the official update【2†L1-L3】.', findings: ['A dated result【3†source】 was reported.'] },
      sources: [],
    }]);
    expect(fallback).not.toContain('【');
    expect(fallback).toContain('Confirmed by the official update.');
  });

  it('rejects chat-summary reports and accepts a substantive structured report', () => {
    const thin = { title: 'Debt crisis', sections: [{ id: 's1', type: 'executive_summary', title: 'Summary', content: 'A short summary.' }] };
    const paragraph = 'Sri Lanka entered the crisis with persistent fiscal and external imbalances. The section explains the evidence, preserves the relevant time period, and connects the finding to the report question without replacing analysis with isolated labels or unsupported claims. It also distinguishes direct evidence from interpretation and keeps material uncertainty visible to the reader.';
    const complete = { title: 'Debt crisis', sections: [
      { id: 's1', type: 'executive_summary', title: 'Executive summary', content: `${paragraph} ${paragraph}` },
      { id: 's2', type: 'key_takeaways', title: 'Background', content: paragraph },
      { id: 's3', type: 'key_takeaways', title: 'External financing', content: paragraph },
      { id: 's4', type: 'key_takeaways', title: 'Outlook', content: paragraph },
      { id: 's5', type: 'key_takeaways', title: 'Policy implications', content: paragraph },
    ] };
    expect(hasSubstantiveReport(`\`\`\`canva-doc\n${JSON.stringify(thin)}\n\`\`\``)).toBe(false);
    expect(hasSubstantiveReport(`\`\`\`canva-doc\n${JSON.stringify(complete)}\n\`\`\``)).toBe(true);
  });

  it('rejects partial previews and accepts complete responsive standalone HTML', () => {
    const partial = '```html\n<!DOCTYPE html><html><head><style>body{color:#111}</style></head><body><main>Calculator';
    const complete = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Calculator</title><style>:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;font-family:system-ui;background:#111;color:#fff}.shell{width:min(100% - 2rem,70rem);margin:auto;padding:2rem}.calculator{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.75rem}button{min-height:44px;border:0;border-radius:1rem}.display{grid-column:1/-1;padding:2rem;background:#222}@media(max-width:600px){.shell{padding:1rem}.calculator{gap:.5rem}}${'.surface{border:1px solid #333;padding:1rem;border-radius:1rem}'.repeat(18)}</style></head><body><main class="shell"><section class="calculator"><output id="display" class="display" aria-live="polite">0</output><button type="button">1</button><button type="button">2</button><button type="button">+</button><button type="button">=</button></section></main><script>document.querySelectorAll('button').forEach((button)=>button.addEventListener('click',()=>{document.querySelector('#display').textContent=button.textContent;}));</script></body></html>`;
    expect(hasSubstantiveWebArtifact(partial)).toBe(false);
    expect(hasSubstantiveWebArtifact(`\`\`\`html\n${complete}\n\`\`\``)).toBe(true);
  });
});
