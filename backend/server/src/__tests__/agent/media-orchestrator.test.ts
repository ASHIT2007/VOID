import { describe, expect, it } from 'vitest';
import {
  filterAndRankMediaCandidates,
  isStrongMetadataMediaMatch,
  mergePixelReviewedMediaCandidates,
  parseMediaPlan,
  parseMediaRelevanceDecision,
  runMediaWorker,
  type MediaPlan,
} from '../../agent/media-orchestrator.js';

const safePlan: MediaPlan = {
  decision: 'search',
  reason: 'A photo materially improves the explanation.',
  subject: 'red panda',
  queries: ['red panda habitat photo'],
  altText: 'A red panda in its forest habitat',
  placement: 'inline',
  safetyCategory: 'none',
};

describe('verified media metadata', () => {
  it('rejects cosplay for a character profile but honors an explicit cosplay request', () => {
    const plan = { ...safePlan, subject: 'Hashirama Senju', queries: ['Hashirama Senju portrait'] };
    const image = { url: 'https://upload.wikimedia.org/Hashirama_Senju_cosplay.jpg', title: 'Hashirama Senju cosplay',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Hashirama_Senju_cosplay.jpg', sourceDomain: 'wikimedia.org',
      width: 1000, height: 1000, verified: true, score: .9 };
    expect(filterAndRankMediaCandidates([image], plan, 'Tell me about Hashirama Senju')).toEqual([]);
    expect(filterAndRankMediaCandidates([image], plan, 'Show Hashirama Senju cosplay')).toHaveLength(1);
  });
  it('disables the complete media pipeline for voice turns', async () => {
    const events: unknown[] = [];
    const images = await runMediaWorker({
      message: 'Show me pictures of Kyoto',
      mode: 'normal',
      isVoice: true,
      onEvent: () => {},
    }, (event) => events.push(event));
    expect(images).toEqual([]);
    expect(events).toEqual([expect.objectContaining({ type: 'media_status', status: 'omitted' })]);
  });

  it('never restores a candidate that pixel review rejected', () => {
    const candidate = {
      url: 'https://media.formula1.com/generic-f1-car.jpg',
      title: 'Kimi Antonelli Formula 1 car',
      sourceUrl: 'https://media.formula1.com/race-report',
      sourceDomain: 'media.formula1.com',
      width: 1200,
      height: 800,
      score: 0.9,
      confidence: 0.9,
      verified: true,
    };
    const plan = { ...safePlan, subject: 'Kimi Antonelli', queries: ['Kimi Antonelli on track'] };

    expect(mergePixelReviewedMediaCandidates([candidate], [candidate], [], plan, true)).toEqual([]);
    expect(mergePixelReviewedMediaCandidates([candidate], [candidate], null, plan, true)).toEqual([candidate]);
  });

  it('accepts short, structured media queries', () => {
    expect(parseMediaPlan(JSON.stringify(safePlan))).toEqual(safePlan);
  });

  it('accepts an authoritative omit decision without fake search queries', () => {
    expect(parseMediaPlan(JSON.stringify({
      ...safePlan,
      decision: 'omit',
      reason: 'A text explanation is clearer and imagery would be decorative.',
      queries: [],
    }))).toMatchObject({ decision: 'omit', queries: [] });
  });

  it('rejects a search decision without a usable query', () => {
    expect(parseMediaPlan(JSON.stringify({ ...safePlan, queries: [] }))).toBeNull();
  });

  it('parses a compact worker decision without requiring authored search queries', () => {
    expect(parseMediaRelevanceDecision('{"decision":"search","reason":"A diagram explains the geometry."}')).toEqual({
      decision: 'search',
      reason: 'A diagram explains the geometry.',
    });
    expect(parseMediaRelevanceDecision('omit')).toBeNull();
  });

  it('rejects vague long queries', () => {
    expect(parseMediaPlan(JSON.stringify({
      ...safePlan,
      queries: ['please find me a really great image showing absolutely everything about red pandas'],
    }))).toBeNull();
  });

  it('ranks relevant attributed images and carries provenance and alt text', () => {
    const selected = filterAndRankMediaCandidates([
      {
        url: 'https://upload.wikimedia.org/red-panda.jpg',
        title: 'Red panda in forest habitat',
        sourceUrl: 'https://en.wikipedia.org/wiki/Red_panda',
        sourceDomain: 'wikipedia.org',
        attribution: 'Wikimedia Commons',
        width: 1200,
        height: 800,
        verified: true,
      },
      { url: 'https://random.example/other.jpg', title: 'Unrelated landscape', verified: true },
    ], safePlan, 'Tell me about red pandas');

    expect(selected).toHaveLength(1);
    expect(selected[0]).toMatchObject({
      sourceDomain: 'wikipedia.org',
      attribution: 'Wikimedia Commons',
      alt: safePlan.altText,
    });
    expect(selected[0].confidence).toBeGreaterThanOrEqual(0.5);
    expect(selected[0].verified).toBe(true);
  });

  it('rejects low-quality wallpaper and template discovery results unless requested', () => {
    const wallpaper = {
      url: 'https://walls.example/pikachu-wallpaper.jpg',
      title: 'Pikachu wallpaper free download',
      sourceUrl: 'https://walls.example/pikachu',
      sourceDomain: 'walls.example',
      width: 1920,
      height: 1080,
      score: 1,
      verified: true,
    };
    const pikachuPlan = {
      ...safePlan,
      subject: 'Pikachu',
      queries: ['Pikachu portrait'],
      altText: 'Pikachu',
    };
    expect(filterAndRankMediaCandidates([wallpaper], pikachuPlan, 'Who is Pikachu?')).toEqual([]);
    expect(filterAndRankMediaCandidates([wallpaper], pikachuPlan, 'Show me a Pikachu wallpaper')).toHaveLength(1);
  });

  it('allows a verified Pinterest discovery image when it is relevant and attributable', () => {
    const selected = filterAndRankMediaCandidates([{
      url: 'https://i.pinimg.com/originals/tesla.jpg',
      title: 'Nikola Tesla laboratory portrait',
      sourceUrl: 'https://www.pinterest.com/pin/123',
      sourceDomain: 'pinterest.com',
      width: 1200,
      height: 900,
      score: 1,
      verified: true,
    }], {
      ...safePlan,
      subject: 'Nikola Tesla',
      queries: ['Nikola Tesla laboratory portrait'],
      altText: 'Nikola Tesla',
    }, 'Create a presentation about Nikola Tesla');
    expect(selected).toHaveLength(1);
  });

  it('allows a one-edit spelling correction from authoritative image metadata', () => {
    const selected = filterAndRankMediaCandidates([{
      url: 'https://upload.wikimedia.org/wikipedia/en/4/42/SasukeKishimoto.jpg',
      title: 'Sasuke Uchiha — sasuke kishimoto',
      sourceUrl: 'https://en.wikipedia.org/wiki/Sasuke_Uchiha',
      sourceDomain: 'en.wikipedia.org',
      attribution: 'Wikipedia page image',
      width: 285,
      height: 349,
      score: 0.86,
      verified: true,
    }], {
      ...safePlan,
      subject: 'sasukae',
      queries: ['sasukae clear overview'],
    }, 'who is sasukae give its image too');

    expect(selected).toHaveLength(1);
    expect(selected[0].title).toContain('Sasuke Uchiha');
  });

  it('requires the complete subject metadata even for an explicit image request', () => {
    const plan = {
      ...safePlan,
      subject: 'Albert Einstein',
      queries: ['Albert Einstein portrait face'],
      altText: 'Albert Einstein portrait',
    };
    const candidate = {
      url: 'https://upload.wikimedia.org/wikipedia/commons/e/e8/Einstein_portrait.jpg',
      title: 'Einstein portrait',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Einstein_portrait.jpg',
      sourceDomain: 'commons.wikimedia.org',
      width: 1024,
      height: 1365,
      score: 0.95,
      verified: true,
    };

    const selected = filterAndRankMediaCandidates([candidate], plan, 'Show me an image of Albert Einstein');
    expect(selected).toEqual([]);
    expect(isStrongMetadataMediaMatch(candidate, plan)).toBe(false);
  });

  it('keeps metadata homonyms in the shortlist for pixel review instead of treating them as visually verified', () => {
    const homonym = {
      url: 'https://upload.wikimedia.org/naruto-whirlpool.jpg',
      title: 'Naruto Uzumaki — Naruto whirlpools',
      sourceUrl: 'https://en.wikipedia.org/wiki/Naruto_whirlpools',
      sourceDomain: 'wikipedia.org',
      width: 1200,
      height: 800,
      score: 0.9,
      verified: true,
    };
    const plan = {
      ...safePlan,
      subject: 'Naruto Uzumaki',
      queries: ['Naruto Uzumaki portrait face'],
    };
    const selected = filterAndRankMediaCandidates([homonym], plan, 'who is naruto');

    // Broad ranking can shortlist it, but the resilient no-vision fallback
    // must not treat the article-name prefix as evidence about the pixels.
    expect(selected).toHaveLength(1);
    expect(isStrongMetadataMediaMatch(selected[0], plan)).toBe(false);
  });

  it('allows exact attributable subject artwork when visual review is unavailable', () => {
    const candidate = {
      url: 'https://upload.wikimedia.org/wikipedia/en/NarutoUzumakiKishimoto.jpg',
      title: 'Naruto Uzumaki — naruto uzumaki kishimoto',
      sourceUrl: 'https://en.wikipedia.org/wiki/Naruto_Uzumaki',
      sourceDomain: 'en.wikipedia.org',
      width: 292,
      height: 340,
      score: 0.86,
      confidence: 0.82,
      verified: true,
    };
    const plan = {
      ...safePlan,
      subject: 'Naruto Uzumaki',
      queries: ['Naruto Uzumaki portrait face'],
    };
    expect(isStrongMetadataMediaMatch(candidate, plan)).toBe(true);
  });

  it('hard-filters stock and untrusted fan-source candidates', () => {
    const candidates = [
      { url: 'https://gettyimages.com/red-panda.jpg', title: 'Red panda stock image', verified: true },
      { url: 'https://fandom.com/itachi.jpg', title: 'Itachi anime character', verified: true },
    ];
    expect(filterAndRankMediaCandidates(candidates, safePlan, 'Tell me about red pandas')).toEqual([]);
  });

  it('does not treat the originating search query as proof of image relevance', () => {
    const selected = filterAndRankMediaCandidates([{
      url: 'https://example.com/generic-portrait.jpg',
      title: 'Abstract portrait study',
      sourceUrl: 'https://example.com/gallery',
      query: 'x86 multicore CPU architecture diagram',
      width: 1200,
      height: 800,
      verified: true,
    }], {
      ...safePlan,
      subject: 'x86 multicore CPU architecture',
      queries: ['x86 multicore CPU architecture diagram'],
    }, 'Explain x86 multicore CPU architecture');

    expect(selected).toEqual([]);
  });

  it('does not accept generic wording such as works or meaning as visual relevance', () => {
    const selected = filterAndRankMediaCandidates([{
      url: 'https://commons.wikimedia.org/unrelated-book-scan.jpg',
      title: 'Collected works of an ancient philosopher',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Unrelated_book_scan.jpg',
      sourceDomain: 'commons.wikimedia.org',
      width: 1200,
      height: 1800,
      score: 0.9,
      verified: true,
    }], {
      ...safePlan,
      subject: 'how a solar eclipse works',
      queries: ['solar eclipse mechanism diagram'],
    }, 'Explain how a solar eclipse works');

    expect(selected).toEqual([]);
  });

  it('deduplicates resized copies of the same Wikimedia image', () => {
    const plan = { ...safePlan, subject: 'Grand Theft Auto VI', queries: ['Grand Theft Auto VI official press image'] };
    const base = {
      title: 'Grand Theft Auto VI cover artwork',
      sourceUrl: 'https://en.wikipedia.org/wiki/Grand_Theft_Auto_VI',
      sourceDomain: 'wikipedia.org',
      width: 1200,
      height: 800,
      score: 0.9,
      verified: true,
    };
    const selected = filterAndRankMediaCandidates([
      { ...base, url: 'https://upload.wikimedia.org/wikipedia/en/thumb/a/a5/Grand_Theft_Auto_VI.png/320px-Grand_Theft_Auto_VI.png' },
      { ...base, url: 'https://upload.wikimedia.org/wikipedia/en/thumb/a/a5/Grand_Theft_Auto_VI.png/640px-Grand_Theft_Auto_VI.png?download=1' },
    ], plan, 'latest Grand Theft Auto VI news');
    expect(selected).toHaveLength(1);
  });
});
