import { describe, expect, it } from 'vitest';
import {
  buildDiverseMediaQueries,
  classifyMediaIntent,
  deriveMediaSubject,
  filterAndRankMediaCandidates,
  inferConcreteMediaSubjectFromEvidence,
  isStrongMetadataMediaMatch,
  mergePixelReviewedMediaCandidates,
  parseMediaPlan,
  parseMediaRelevanceDecision,
  requiresConcreteWebImage,
  resolveContextualMediaMessage,
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

describe('media intent classification', () => {
  it('canonicalizes misspelled car names for both search and verification', () => {
    const subject = deriveMediaSubject('tell me about lambo tarzo');
    expect(subject).toBe('Lamborghini Terzo Millennio');
    const plan = { ...safePlan, subject, queries: [] };
    const queries = buildDiverseMediaQueries(plan, 'person_or_subject');
    expect(queries.join(' ')).not.toMatch(/portrait|face|full body|tarzo/i);
    expect(queries[0]).toBe('Lamborghini Terzo Millennio official photo');
    const images = filterAndRankMediaCandidates([{
      url: 'https://upload.wikimedia.org/Lamborghini_Terzo_Millennio.jpg',
      title: 'Lamborghini Terzo Millennio', sourceUrl: 'https://en.wikipedia.org/wiki/Lamborghini_Terzo_Millennio',
      sourceDomain: 'wikipedia.org', width: 1200, height: 800, verified: true,
    }], plan, 'tell me about lambo tarzo');
    expect(images).toHaveLength(1);
    expect(isStrongMetadataMediaMatch(images[0], plan)).toBe(true);
    const wrongModel = { ...images[0], url: 'https://upload.wikimedia.org/Lamborghini_Aventador.jpg', title: 'Lamborghini Aventador', sourceUrl: 'https://en.wikipedia.org/wiki/Lamborghini_Aventador' };
    expect(isStrongMetadataMediaMatch(wrongModel, plan, true)).toBe(false);
    expect(filterAndRankMediaCandidates([wrongModel], plan, 'show me pictures of lambo tarzo')).toEqual([]);
  });
  it('rejects cosplay for a character profile but honors an explicit cosplay request', () => {
    const plan = { ...safePlan, subject: 'Hashirama Senju', queries: ['Hashirama Senju portrait'] };
    const image = { url: 'https://upload.wikimedia.org/Hashirama_Senju_cosplay.jpg', title: 'Hashirama Senju cosplay',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Hashirama_Senju_cosplay.jpg', sourceDomain: 'wikimedia.org',
      width: 1000, height: 1000, verified: true, score: .9 };
    expect(filterAndRankMediaCandidates([image], plan, 'Tell me about Hashirama Senju')).toEqual([]);
    expect(filterAndRankMediaCandidates([image], plan, 'Show Hashirama Senju cosplay')).toHaveLength(1);
  });
  it('recognizes explicit and inherently visual requests', () => {
    expect(classifyMediaIntent('What does a pangolin look like?')).toMatchObject({ considered: true, placement: 'top', renderPlacement: 'lead' });
    expect(classifyMediaIntent('Travel guide to mountain landmarks')).toMatchObject({ considered: true, category: 'place' });
    expect(classifyMediaIntent('Give a few pics of Kyoto')).toMatchObject({ considered: true, category: 'explicit', placement: 'top' });
    expect(classifyMediaIntent('Things to do in Kyoto')).toMatchObject({ considered: true, category: 'place', placement: 'inline' });
    expect(classifyMediaIntent('Ideas for plating a tiramisu recipe')).toMatchObject({ considered: true, category: 'food', placement: 'inline' });
  });

  it('implements the semantic image-decision contract', () => {
    expect(classifyMediaIntent('Who is Pikachu?')).toMatchObject({
      show_images: true,
      visual_intent: 'implicit',
      image_query: 'Pikachu',
      image_count: 3,
      placement: 'after_intro',
    });
    expect(classifyMediaIntent('What does the RTX 5090 look like?')).toMatchObject({
      show_images: true,
      visual_intent: 'explicit',
      placement: 'top',
    });
    expect(classifyMediaIntent('Different Naruto forms')).toMatchObject({
      show_images: true,
      visual_intent: 'implicit',
      image_count: 3,
      placement: 'inline',
    });
    expect(classifyMediaIntent('Best sneakers under ₹10,000')).toMatchObject({
      show_images: true,
      visual_intent: 'implicit',
      placement: 'inline',
    });
  });

  it('keeps pure text tasks out of the media pipeline', () => {
    expect(classifyMediaIntent('Debug this TypeScript stack trace')).toMatchObject({ considered: false });
    expect(classifyMediaIntent('Translate this paragraph into Hindi')).toMatchObject({ considered: false });
    expect(classifyMediaIntent('What is 12 * 8?')).toMatchObject({ considered: false });
    expect(classifyMediaIntent('Tell me about yourself')).toMatchObject({ considered: false, category: 'none' });
    expect(classifyMediaIntent('Who are you?')).toMatchObject({ considered: false, category: 'none' });
    expect(classifyMediaIntent('Compare quarterly stock price statistics')).toMatchObject({ considered: false, category: 'none' });
    expect(classifyMediaIntent('Give me a step-by-step Photoshop UI walkthrough')).toMatchObject({ considered: false, category: 'none' });
    expect(classifyMediaIntent('Explain recursion.')).toMatchObject({ show_images: false, visual_intent: 'none', placement: 'none' });
    expect(classifyMediaIntent('What is TCP?')).toMatchObject({ show_images: false, visual_intent: 'none', placement: 'none' });
    expect(classifyMediaIntent('Why did inflation increase?')).toMatchObject({ show_images: false, visual_intent: 'none', placement: 'none' });
    expect(classifyMediaIntent('RTX 5090 vs RTX 5080 performance.')).toMatchObject({ show_images: false, visual_intent: 'none', placement: 'none' });
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
    expect(events).toEqual([]);
  });

  it('adds relevant web imagery to ordinary explanatory answers', () => {
    expect(classifyMediaIntent('What is quantum computing?')).toMatchObject({ considered: false, category: 'none', placement: 'none' });
    expect(classifyMediaIntent('Explain how a solar eclipse works')).toMatchObject({ considered: true, category: 'instructional', placement: 'inline' });
    expect(classifyMediaIntent('Compare Gothic and Romanesque architecture')).toMatchObject({ considered: true, category: 'place', placement: 'inline' });
    expect(classifyMediaIntent('What is the latest Artemis mission announcement?')).toMatchObject({ considered: true, category: 'current_event' });
  });

  it('never replaces generated images or edits with web-image search', () => {
    expect(classifyMediaIntent('Generate an image of a black and white circle')).toMatchObject({ considered: false });
    expect(classifyMediaIntent('Generate an imdge of a simple action scene')).toMatchObject({ considered: false });
    expect(classifyMediaIntent('Edit this photo and remove the background')).toMatchObject({ considered: false });
  });

  it('considers presentations for verified web imagery', () => {
    expect(classifyMediaIntent('Make a presentation about OpenAI and Anthropic')).toMatchObject({
      considered: true,
      category: 'artifact',
      placement: 'inline',
    });
  });

  it('treats posters and infographics as visual artifacts rather than standalone image generation', () => {
    expect(classifyMediaIntent('Create a poster about Nikola Tesla')).toMatchObject({ considered: true, category: 'artifact' });
    expect(classifyMediaIntent('Design an infographic about ocean ecosystems')).toMatchObject({ considered: true, category: 'artifact' });
    expect(classifyMediaIntent('make an random infographics')).toMatchObject({ considered: true, category: 'artifact' });
  });

  it('does not search presentation imagery for a review request', () => {
    expect(classifyMediaIntent('Rate the PPT and explain what should improve')).toMatchObject({ considered: false });
    expect(classifyMediaIntent('Review this presentation')).toMatchObject({ considered: false });
  });

  it('allows a fictional-character subject while retaining normal safety checks', () => {
    const decision = classifyMediaIntent('tell me about itachi');
    expect(decision).toMatchObject({ considered: true, category: 'person_or_subject', placement: 'after_intro' });
    expect(decision.blockedReason).toBeUndefined();
  });

  it('pulls web images for standalone entities and varied question formats just like ChatGPT', () => {
    // Standalone entities
    expect(classifyMediaIntent('Lionel Messi')).toMatchObject({ considered: true, category: 'person_or_subject', image_query: 'Lionel Messi' });
    expect(classifyMediaIntent('Taj Mahal')).toMatchObject({ considered: true, category: 'person_or_subject', image_query: 'Taj Mahal' });
    expect(classifyMediaIntent('Axolotl')).toMatchObject({ considered: true, category: 'person_or_subject', image_query: 'Axolotl' });
    expect(classifyMediaIntent('Pikachu')).toMatchObject({ considered: true, category: 'person_or_subject', image_query: 'Pikachu' });

    // Question variants without "tell me about"
    expect(classifyMediaIntent('Who was Albert Einstein?')).toMatchObject({ considered: true, category: 'person_or_subject', image_query: 'Albert Einstein' });
    expect(classifyMediaIntent('What is an axolotl?')).toMatchObject({ considered: true, category: 'person_or_subject', image_query: 'axolotl' });
    expect(classifyMediaIntent('Where is the Eiffel Tower?')).toMatchObject({ considered: true, category: 'place', image_query: 'Eiffel Tower' });
    expect(classifyMediaIntent('Information about Nikola Tesla')).toMatchObject({ considered: true, category: 'person_or_subject', image_query: 'Nikola Tesla' });
    expect(classifyMediaIntent('History of the Colosseum')).toMatchObject({ considered: true, category: 'place', image_query: 'Colosseum' });
  });

  it('omits web images for conversational chat, creative requests, advice, and abstract words', () => {
    expect(classifyMediaIntent('hi')).toMatchObject({ considered: false });
    expect(classifyMediaIntent('hello how are you')).toMatchObject({ considered: false });
    expect(classifyMediaIntent('good morning')).toMatchObject({ considered: false });
    expect(classifyMediaIntent('tell me a joke')).toMatchObject({ considered: false });
    expect(classifyMediaIntent('write a poem about winter')).toMatchObject({ considered: false });
    expect(classifyMediaIntent('give me advice on career growth')).toMatchObject({ considered: false });
    expect(classifyMediaIntent('what is love')).toMatchObject({ considered: false });
  });

  it('treats a trailing request for the subject image as explicit visual intent', () => {
    expect(classifyMediaIntent('who is sasukae give its image too')).toMatchObject({
      considered: true,
      category: 'explicit',
      placement: 'top',
    });
  });

  it('binds a picture-only follow-up to the latest concrete user topic', () => {
    const context = JSON.stringify([
      { role: 'user', content: 'who were seven ninja swordsmens' },
      { role: 'assistant', content: 'The Seven Ninja Swordsmen of the Mist are an elite group from Kirigakure.' },
    ]);
    const resolved = resolveContextualMediaMessage('give pic too', context);
    expect(resolved).toBe('who were seven ninja swordsmens\ngive pic too');
    expect(deriveMediaSubject(resolved)).toBe('seven ninja swordsmens');
  });

  it('resolves pronoun appearance follow-ups without searching for the pronoun', () => {
    const context = JSON.stringify([{ role: 'user', content: 'Tell me about Naruto Uzumaki' }]);
    const resolved = resolveContextualMediaMessage('What does he look like?', context);
    expect(deriveMediaSubject(resolved)).toBe('Naruto Uzumaki');

    const neutralResolved = resolveContextualMediaMessage('What does it look like?', context);
    expect(deriveMediaSubject(neutralResolved)).toBe('Naruto Uzumaki');
  });

  it('fails closed when a picture-only follow-up has no resolvable topic', () => {
    expect(resolveContextualMediaMessage('give pic too')).toBe('give pic too');
    expect(deriveMediaSubject('give pic too')).toBe('');
  });

  it('requires retrieval for concrete visual identities but not every abstract topic', () => {
    for (const category of ['explicit', 'place', 'product', 'person_or_subject', 'animal_or_plant', 'historical', 'instructional'] as const) {
      expect(requiresConcreteWebImage(category)).toBe(true);
    }
    expect(requiresConcreteWebImage('food')).toBe(true);
    expect(requiresConcreteWebImage('topic')).toBe(false);
    expect(requiresConcreteWebImage('current_event')).toBe(false);
    expect(requiresConcreteWebImage('artifact')).toBe(false);
  });
});

describe('media planning and candidate ranking', () => {
  it('extracts the subject without conversational image-request filler', () => {
    expect(deriveMediaSubject('who is sasukae give its image too')).toBe('sasukae');
    expect(deriveMediaSubject('Please tell me about red pandas and include their photos too')).toBe('red pandas');
    expect(deriveMediaSubject('Make a 5-slide presentation on World War II, using relevant verified historical web images')).toBe('World War II');
    expect(deriveMediaSubject('Give me the latest news updates on GTA 6, with dates and sources')).toBe('GTA 6');
    expect(deriveMediaSubject('What does a pangolin look like? Show me a few pictures.')).toBe('pangolin');
    expect(deriveMediaSubject('Things to do in Kyoto')).toBe('Kyoto');
    expect(deriveMediaSubject('Search the web and tell me the name of the winner of the most recent Formula 1 Grand Prix race that occurred this month. Then, pull and display a real-time web image of that specific driver or their car on the track.'))
      .toBe('winner most recent Formula 1 Grand Prix race');
  });

  it('resolves a relational winner request to a concrete named subject from search evidence', () => {
    expect(inferConcreteMediaSubjectFromEvidence([
      { title: 'Kimi Antonelli beats George Russell to win Italian Grand Prix', content: 'Kimi Antonelli won the 2026 race at Monza.' },
      { title: 'Race report', content: 'Kimi Antonelli won after starting nineteenth.' },
      { title: 'Generic Formula One results', content: 'Browse every Grand Prix result.' },
    ])).toBe('Kimi Antonelli');
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
    expect(parseMediaRelevanceDecision('omit')).toMatchObject({ decision: 'omit' });
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

  it('allows a common multi-edit name misspelling to match authoritative metadata', () => {
    const selected = filterAndRankMediaCandidates([{
      url: 'https://upload.wikimedia.org/wikipedia/commons/e/e8/Albert_Einstein_Head.jpg',
      title: 'Albert Einstein portrait',
      sourceUrl: 'https://en.wikipedia.org/wiki/Albert_Einstein',
      sourceDomain: 'en.wikipedia.org',
      attribution: 'Wikimedia Commons',
      width: 1024,
      height: 1365,
      score: 0.95,
      verified: true,
    }], {
      ...safePlan,
      subject: 'enstine',
      queries: ['enstine portrait face'],
      altText: 'Albert Einstein portrait',
    }, 'who is enstine');

    expect(selected).toHaveLength(1);
    expect(selected[0].title).toBe('Albert Einstein portrait');
  });

  it('accepts one distinctive subject-name match for an explicit image request', () => {
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
    expect(selected).toHaveLength(1);
    expect(isStrongMetadataMediaMatch(selected[0], plan, true)).toBe(true);
    expect(isStrongMetadataMediaMatch(selected[0], plan)).toBe(false);
  });

  it('builds portrait, full-body, and contextual search variants', () => {
    const queries = buildDiverseMediaQueries({ ...safePlan, subject: 'Kakashi Hatake', queries: [] }, 'person_or_subject');
    expect(queries).toEqual([
      'Kakashi Hatake portrait face',
      'Kakashi Hatake full body',
      'Kakashi Hatake action scene',
    ]);
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

  it('uses technical diagram queries for instructional subjects', () => {
    const queries = buildDiverseMediaQueries({
      ...safePlan,
      subject: 'x86 multicore CPU architecture',
      queries: [],
    }, 'instructional');

    expect(queries).toEqual([
      'x86 multicore CPU architecture labeled diagram',
      'x86 multicore CPU architecture technical schematic',
      'x86 multicore CPU architecture architecture overview',
    ]);
  });

  it('uses event-specific query variants for recent news', () => {
    const queries = buildDiverseMediaQueries({
      ...safePlan,
      subject: 'Grand Theft Auto VI',
      queries: [],
    }, 'current_event');
    expect(queries).toEqual([
      'Grand Theft Auto VI latest official announcement',
      'Grand Theft Auto VI recent event photo',
      'Grand Theft Auto VI official press image',
    ]);
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
