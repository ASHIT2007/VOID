import crypto from 'crypto';
import { z } from 'zod';
import { runAgentLoop, type AgentEvent, type AgentLoopOptions } from './agent-loop.js';
import { getTool, type ToolImage } from './tool-registry.js';

export type MediaIntentCategory = 'explicit' | 'place' | 'product' | 'person_or_subject' | 'animal_or_plant' | 'food' | 'historical' | 'instructional' | 'topic' | 'current_event' | 'artifact' | 'none';

export interface MediaIntentDecision {
  show_images: boolean;
  visual_intent: 'explicit' | 'implicit' | 'none';
  image_query: string | null;
  image_count: number;
  placement: 'top' | 'inline' | 'after_intro' | 'none';
  reason: string;
  considered: boolean;
  category: MediaIntentCategory;
  renderPlacement: 'lead' | 'inline';
  blockedReason?: string;
}

const PURE_TEXT_TASK = /\b(?:write|rewrite|email|cover letter|code|debug|stack trace|typescript|javascript|python|sql|regex|equation|calculate|numeric analysis|troubleshoot|terminal command|translate|translation|proofread|grammar|summarize this text)\b/i;
const GENERATED_IMAGE_REQUEST = /\b(?:generate|genrate|genarate|generat|create|make|design|draw|render|paint|illustrate)\b[\s\S]{0,180}\b(?:images?|pictures?|photos?|illustrations?|artworks?|posters?|wallpapers?|logos?|icons?|portraits?|scenes?|img|imdge)\b/i;
const GENERATED_IMAGE_EDIT = /\b(?:edit|modify|restyle|rework|recolor|remove|replace|crop|resize|rotate|upscale)\b[\s\S]{0,180}\b(?:images?|pictures?|photos?|background|foreground|it|this|that)\b/i;
const EXPLICIT_VISUAL = /\b(?:show me|let me see|pictures? of|photos? of|images? of|pics? of|what(?:'s| is| does)? .+ look like|how does .+ appear|visuali[sz]e|visual reference|before and after|(?:give|provide|include|add)(?:\s+me)?\s+(?:(?:its|their|an?|the|a few|few|some)\s+)?(?:images?|photos?|pictures?|pics?))\b/i;
const PLACE_VISUAL = /\b(?:travel|trip|vacation|tourism|itinerary|things to do|places to (?:visit|see)|destination|landmark|cityscape|beach|mountain|national park|architecture|hotel|resort|museum|monument|temple|palace|tower|castle|bridge|statue|stadium|arena|cathedral|church|mosque|shrine|pyramid|colosseum)\b|^\s*where\s+(?:is|are)\b/i;
const PRODUCT_VISUAL = /\b(?:product|phone|laptop|camera|car|vehicle|motorcycle|bike|truck|shoe|sneaker|dress|watch|furniture|appliance|device|gadget)\b/i;
const VEHICLE_SUBJECT = /\b(?:lambo(?:rghini)?|ferrari|porsche|bugatti|mclaren|mercedes|bmw|audi|toyota|terzo|car|vehicle|motorcycle|automobile|supercar|hypercar)\b/i;

/** Deterministic aliases cover common shorthand when the semantic planner is
 * unavailable. The planner handles other entities and contextual synonyms. */
export function canonicalizeMediaSubject(value: string): string {
  return value
    .replace(/\b(?:lambo(?:rghini)?\s+)?(?:tarzo|terzo)(?:\s+(?:millenio|millenium|millennio|millennium))?\b/gi, 'Lamborghini Terzo Millennio')
    .replace(/\blambo\b/gi, 'Lamborghini')
    .replace(/\b(?:enstine|einsten)\b/gi, 'Albert Einstein')
    .replace(/\bautomobile\b/gi, 'car')
    .replace(/\bcellphone\b/gi, 'phone')
    .replace(/\s+/g, ' ').trim();
}
const ANIMAL_VISUAL = /\b(?:animal|bird|fish|insect|dog breed|cat breed|plant|flower|tree|species|wildlife|tiger|lion|panda|pangolin|elephant|giraffe|shark|whale|dolphin|eagle|falcon|butterfly)\b/i;
const FOOD_VISUAL = /\b(?:recipe|dish|meal|dessert|cake|pastry|cuisine|plating|food presentation|cocktail)\b/i;
const HISTORICAL_VISUAL = /\b(?:historical event|historic event|archival|protest|revolution|battle|world war|moon landing)\b/i;
const INSTRUCTIONAL_VISUAL = /\b(?:assembly|anatomy|cycle|diagram|mechanism|physical process|schematic|structure|workflow)\b/i;
const NUMERIC_OR_DATA_TASK = /\b(?:financial figures?|market data|stock price|share price|statistics?|dataset|numeric(?:al)?|earnings|revenue|percentage|chart|graph|plot)\b/i;
const SOFTWARE_UI_GUIDE = /\b(?:step[- ]?by[- ]?step|walkthrough|tutorial|instructions?|how to)\b[\s\S]{0,100}\b(?:software|app|website|dashboard|interface|screen|ui|menu|settings|click|button|terminal|ide|editor)\b/i;
const PRESENTATION_VISUAL = /\b(?:create|make|generate|build|design|prepare|draft|produce)\b[\s\S]{0,140}\b(?:presentation|powerpoint|pptx?|slide deck|slides)\b/i;
const POSTER_VISUAL = /\b(?:create|make|generate|build|design|prepare|draft|produce)\b[\s\S]{0,140}\b(?:posters?|infographics?|flyers?|one-page briefs?|study sheets?)\b/i;
const ARTIFACT_VISUAL = new RegExp(`${PRESENTATION_VISUAL.source}|${POSTER_VISUAL.source}`, 'i');
const SUBJECT_PROMPT = /^\s*(?:who\s+(?:is|was|are|were|am)|what\s+(?:is|are|was|were|'s)|where\s+(?:is|are|was|were)|tell\s+me\s+(?:about|more\s+about|all\s+about|of)|information\s+(?:about|on)|info\s+(?:about|on)|details?\s+(?:about|on)|facts?\s+about|biography\s+of|overview\s+of|summary\s+of|profile\s+of|history\s+of)\s+.{2,100}[?.!]?\s*$/i;
const TOPIC_PROMPT = /^\s*(?:what (?:is|are|was|were)|how (?:does|do|did|is|are)|why (?:does|do|did|is|are)|explain|describe|compare|difference between|history of|guide to|introduction to|learn about)\s+.{3,180}[?.!]?\s*$/i;
const CURRENT_EVENT_VISUAL = /\b(?:latest|recent|current|today(?:'s)?|news|announcement|launch|election|summit|festival|ceremony|mission)\b/i;
const QUICK_NON_VISUAL_ANSWER = /^\s*(?:what is|calculate|solve)\s+[\d\s+\-*/().%=]+[?.!]?\s*$/i;
const GRAPHIC_OR_SENSITIVE = /\b(?:gore|graphic|corpse|dead body|autopsy|execution|beheading|sexual|nude|self[- ]?harm)\b/i;
const PERSON_SENSITIVE_CONTEXT = /\b(?:accused|arrested|crime|victim|medical condition|disease|mental health|addiction|abuse|scandal)\b/i;
const ASSISTANT_SELF_DESCRIPTION = /^\s*(?:tell me about yourself|who are you|what are you|describe yourself|what can you do|introduce yourself)[?.!\s]*$/i;
const CONVERSATIONAL_CHAT = /^\s*(?:hi|hello|hey|howdy|sup|greetings|good\s+(?:morning|afternoon|evening|night|day))\b[\s,.]*(?:there|all|everyone|folks|how\s+are\s+you(?: doing)?|how's\s+it\s+going|what'?s\s+up|hope\s+you(?:'re|\s+are)\s+well)?[.!?\s]*$/i;
const CONVERSATIONAL_QUERY = /^\s*(?:how\s+are\s+you(?: doing)?|how's\s+it\s+going|what'?s\s+up|thanks?(?:\s+you)?(?:\s+so\s+much)?|ok|okay|yes|no|yep|nope|sure|cool|great|awesome|nice|bye|goodbye|see\s+ya|help|test|ping|pong)[.!?\s]*$/i;
const CREATIVE_OR_ADVICE_TASK = /\b(?:tell\s+me\s+a\s+(?:joke|story|riddle)|write\s+a\s+(?:poem|story|song|essay|letter|script)|give\s+me\s+(?:advice|ideas|suggestions|names)|brainstorm|recommend\s+me\s+a)\b/i;
const ABSTRACT_CONCEPT_WORD = /^(?:love|peace|hope|truth|justice|freedom|happiness|sadness|anger|courage|wisdom|knowledge|faith|loyalty|friendship|life|death|time|destiny|reality|existence|consciousness|philosophy|ethics|morality|logic|mathematics|math|science|physics|chemistry|biology|economics|history|language|linguistics|grammar|psychology|sociology)$/i;

export function isStandaloneSubject(clean: string): boolean {
  const stripped = clean.replace(/[?.!]+$/, '').trim();
  const words = stripped.split(/\s+/);
  if (words.length < 1 || words.length > 5) return false;
  if (CONVERSATIONAL_CHAT.test(stripped) || CONVERSATIONAL_QUERY.test(stripped)) return false;
  if (/\b(?:hello|hey|howdy|greetings|good\s+(?:morning|afternoon|evening|night)|how\s+are\s+you|how's\s+it\s+going|what's\s+up)\b/i.test(stripped)) return false;
  if (CREATIVE_OR_ADVICE_TASK.test(stripped)) return false;
  if (ABSTRACT_TEXT_SUBJECT.test(stripped)) return false;
  if (ABSTRACT_CONCEPT_WORD.test(stripped)) return false;
  if (PURE_TEXT_TASK.test(stripped)) return false;
  if (NUMERIC_OR_DATA_TASK.test(stripped)) return false;
  if (QUICK_NON_VISUAL_ANSWER.test(stripped)) return false;
  if (/\b(?:review|rate|critique|evaluate|assess|feedback|grade)\b/i.test(stripped)) return false;
  if (/\b(?:this|the|my|our)\s+(?:presentation|deck|slide|ppt|pptx|document|doc|essay|resume|code|repo|file|image|photo|video|audio)\b/i.test(stripped)) return false;
  if (/^(?:why|how|when|what|who|where|which)\b/i.test(stripped)) return false;
  if (/^(?:is|are|was|were|do|does|did|can|could|would|should|may|might|must|will|shall)\b/i.test(stripped)) return false;
  if (/^(?:please|show|give|find|search|tell|write|create|make|code|debug|calculate|summarize|translate|explain|describe|review|rate|critique|evaluate|assess|analyze|check|fix|edit|update|improve)\b/i.test(stripped)) return false;
  return true;
}
const CONTEXTUAL_VISUAL_FOLLOWUP = /^\s*(?:please\s+)?(?:(?:can|could|would|will)\s+you\s+)?(?:give|show|send|include|add|find|get)?(?:\s+me)?\s*(?:(?:a|the)\s+)?(?:(?:few|some|more|their|its|his|her)\s+)*(?:images?|photos?|pictures?|pics?|visuals?)(?:\s+(?:too|also|instead|please))?[?.!\s]*$/i;
const PRONOUN_APPEARANCE_FOLLOWUP = /^\s*(?:and\s+)?what\s+(?:does|do)\s+(?:it|that|he|she|they|those|this)\s+look\s+like[?.!\s]*$/i;
const GENERIC_MEDIA_SUBJECT = /^(?:(?:a|an|the|few|some|more|its|their|this|that|those|them|it|please|too|also)\s+)*(?:images?|photos?|pictures?|pics?|visuals?)(?:\s+(?:please|too|also))?$/i;
const FASHION_OR_ART_VISUAL = /\b(?:fashion|clothing|outfit|sneakers?|trainers?|jewelry|jewellery|handbag|artwork|painting|sculpture|illustration|design style)\b/i;
const CHARACTER_OR_FICTION_VISUAL = /\b(?:fictional character|anime|manga|pokemon|naruto|superhero|character forms?|transformations?)\b/i;
const PHYSICAL_EXPLANATION_VISUAL = /\b(?:anatomy|hardware components?|circuit board|engine|machine|architecture|geography|physical object|transformation|before and after|aurora|eclipse|volcano|spacecraft|space mission)\b/i;
const VISUAL_COMPARISON = /\b(?:best|top|different|compare|comparison|versus|\bvs\b|which)\b/i;
const ABSTRACT_TEXT_SUBJECT = /\b(?:recursion|tcp|udp|api|backend|database|algorithm|grammar|inflation|quantum computing|philosophy|economics|interest rates?|authentication|authorization|javascript|typescript|python|software architecture|love|happiness|sadness|freedom|truth|justice|morality|consciousness|existence|meaning of life)\b/i;
const PERFORMANCE_ONLY_COMPARISON = /\b(?:performance|benchmarks?|fps|throughput|latency|specifications?|specs?|statistics?|financial|price history)\b/i;
const DIRECT_VISUAL_ANSWER = /\b(?:show me|let me see|what(?:'s| is| does)? .+ look like|how does .+ appear|pictures? of|photos? of|images? of|pics? of|visuali[sz]e)\b/i;
const REFERENTIAL_MEDIA_SUBJECT = /\b(?:that|this|those|these|same|specific|aforementioned|above|former|latter|winner|winning|newly|latest|most recent|current|their|his|her|its|him|them)\b/i;

type ContextMessage = { role?: unknown; content?: unknown };

function cleanContextMessage(value: string): string {
  return value
    .split('[META_JSON:')[0]
    .split('[ATTACHMENTS_JSON:')[0]
    .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function contextualUserMessages(rawContext: string): string[] {
  const serializedCandidates = [rawContext, ...rawContext.split(/\r?\n/).filter((line) => line.trim().startsWith('['))];
  for (const serialized of serializedCandidates) {
    try {
      const parsed = JSON.parse(serialized) as unknown;
      if (!Array.isArray(parsed)) continue;
      const messages = (parsed as ContextMessage[])
        .filter((item) => item?.role === 'user' && typeof item.content === 'string')
        .map((item) => cleanContextMessage(String(item.content)))
        .filter(Boolean);
      if (messages.length) return messages;
    } catch {
      // Topic-context text below is a supported non-JSON fallback.
    }
  }
  const topic = rawContext.match(/Topic context from the latest relevant conversation turn:\s*([\s\S]*?)(?:\nLatest response|\n\[|$)/i)?.[1];
  return topic ? [cleanContextMessage(topic)] : [];
}

export function resolveContextualMediaMessage(message: string, mediaContext = ''): string {
  const clean = cleanContextMessage(message);
  if (!CONTEXTUAL_VISUAL_FOLLOWUP.test(clean) && !PRONOUN_APPEARANCE_FOLLOWUP.test(clean)) return clean;
  const prior = contextualUserMessages(mediaContext)
    .reverse()
    .find((candidate) => candidate.length >= 3
      && candidate.toLowerCase() !== clean.toLowerCase()
      && !CONTEXTUAL_VISUAL_FOLLOWUP.test(candidate)
      && !PRONOUN_APPEARANCE_FOLLOWUP.test(candidate));
  return prior ? `${prior}\n${clean}` : clean;
}

export function classifyMediaIntent(message: string): MediaIntentDecision {
  const clean = canonicalizeMediaSubject(message.replace(/\[[^\]]*SYSTEM DIRECTIVE[^\]]*\]/gi, '').trim());
  const omitted = (reason: string): MediaIntentDecision => ({
    show_images: false,
    visual_intent: 'none',
    image_query: null,
    image_count: 1,
    placement: 'none',
    reason,
    considered: false,
    category: 'none',
    renderPlacement: 'inline',
  });
  // Pronouns in assistant self-description prompts are not a searchable visual
  // subject. Treating "yourself" as an entity produced unrelated songs and
  // celebrity photos whose metadata happened to contain that word.
  if (ASSISTANT_SELF_DESCRIPTION.test(clean)) {
    return omitted('A self-description is clearer as text.');
  }
  if (CONVERSATIONAL_CHAT.test(clean) || CONVERSATIONAL_QUERY.test(clean)) {
    return omitted('Conversational greetings do not require web imagery.');
  }
  if (CREATIVE_OR_ADVICE_TASK.test(clean)) {
    return omitted('Creative text and advice tasks do not require web imagery.');
  }
  // Generated media and web-reference media are separate products. A failed
  // generation must surface as a generation error, never as unrelated search
  // results that merely happen to match words in the prompt.
  if (!ARTIFACT_VISUAL.test(clean) && (GENERATED_IMAGE_REQUEST.test(clean) || GENERATED_IMAGE_EDIT.test(clean))) {
    return omitted('This is an image-generation or image-editing request, not web-image retrieval.');
  }
  // A chart or native, version-correct instruction is more informative than a
  // decorative stock photo or a potentially stale software screenshot.
  const explicit = EXPLICIT_VISUAL.test(clean);
  if (SOFTWARE_UI_GUIDE.test(clean)) return omitted('A version-specific software screenshot could mislead the user.');
  if (!explicit && (NUMERIC_OR_DATA_TASK.test(clean) || PERFORMANCE_ONLY_COMPARISON.test(clean))) {
    return omitted('Data, performance, or calculations are better represented with text, specifications, or a chart.');
  }
  if (!explicit && (PURE_TEXT_TASK.test(clean) || QUICK_NON_VISUAL_ANSWER.test(clean))) {
    return omitted('The task is text-only and web imagery would not add useful information.');
  }
  const standaloneSubject = isStandaloneSubject(clean);
  const subjectPrompt = (SUBJECT_PROMPT.test(clean) || standaloneSubject) && !ABSTRACT_TEXT_SUBJECT.test(clean);
  const topicPrompt = TOPIC_PROMPT.test(clean) && !ABSTRACT_TEXT_SUBJECT.test(clean);
  const visualComparison = VISUAL_COMPARISON.test(clean)
    && (PLACE_VISUAL.test(clean) || PRODUCT_VISUAL.test(clean) || ANIMAL_VISUAL.test(clean)
      || FOOD_VISUAL.test(clean) || FASHION_OR_ART_VISUAL.test(clean) || CHARACTER_OR_FICTION_VISUAL.test(clean));
  const category: MediaIntentCategory = ARTIFACT_VISUAL.test(clean) ? 'artifact' : explicit ? 'explicit'
    : PLACE_VISUAL.test(clean) ? 'place'
      : PRODUCT_VISUAL.test(clean) || VEHICLE_SUBJECT.test(clean) ? 'product'
        : ANIMAL_VISUAL.test(clean) ? 'animal_or_plant'
          : FOOD_VISUAL.test(clean) ? 'food'
            : HISTORICAL_VISUAL.test(clean) ? 'historical'
              : CURRENT_EVENT_VISUAL.test(clean) && (PHYSICAL_EXPLANATION_VISUAL.test(clean) || /\b(?:mission|launch|ceremony|protest|festival|summit)\b/i.test(clean)) ? 'current_event'
              : INSTRUCTIONAL_VISUAL.test(clean) || PHYSICAL_EXPLANATION_VISUAL.test(clean) ? 'instructional'
              : FASHION_OR_ART_VISUAL.test(clean) || CHARACTER_OR_FICTION_VISUAL.test(clean) || visualComparison ? 'person_or_subject'
              : subjectPrompt ? 'person_or_subject'
                : topicPrompt ? 'topic'
                : 'none';
  const considered = category !== 'none';
  if (!considered) return omitted('Images would not materially improve this answer.');

  const placement: MediaIntentDecision['placement'] = explicit || DIRECT_VISUAL_ANSWER.test(clean)
    ? 'top'
    : visualComparison || category === 'place' && /\b(?:things to do|places to|itinerary|travel)\b/i.test(clean)
      ? 'inline'
      : category === 'artifact' || category === 'instructional' || category === 'food'
        ? 'inline'
        : 'after_intro';
  const imageCount = Math.max(1, Math.min(12,
    /\b(?:one|an?)\s+(?:image|photo|picture|pic)\b/i.test(clean) ? 1
      : category === 'artifact' ? 10
        : 3));
  const imageQuery = deriveMediaSubject(clean) || null;
  const reason = explicit
    ? 'The user explicitly asked for visual results.'
    : visualComparison
      ? 'Images materially improve comparison between visual options.'
      : 'The subject is inherently visual and images improve identification or understanding.';
  const decision: MediaIntentDecision = {
    show_images: true,
    visual_intent: explicit ? 'explicit' : 'implicit',
    image_query: imageQuery,
    image_count: imageCount,
    placement,
    reason,
    considered: true,
    category,
    renderPlacement: placement === 'top' ? 'lead' : 'inline',
  };

  if (GRAPHIC_OR_SENSITIVE.test(clean)) {
    return { ...decision, show_images: false, placement: 'none', blockedReason: 'Web imagery was omitted by the graphic or sensitive-content filter.' };
  }
  if (category === 'person_or_subject' && PERSON_SENSITIVE_CONTEXT.test(clean)) {
    return { ...decision, show_images: false, placement: 'none', blockedReason: 'Web imagery was omitted because the request places an identifiable person in a sensitive context.' };
  }
  return decision;
}

const mediaPlanSchema = z.object({
  decision: z.enum(['search', 'omit']),
  reason: z.string().min(1).max(500),
  subject: z.string().min(1).max(120),
  queries: z.array(z.string().min(3).max(100)).max(5),
  altText: z.string().min(3).max(240),
  placement: z.enum(['lead', 'inline']),
  safetyCategory: z.enum(['none', 'graphic', 'sensitive_person', 'sports_or_media_still', 'artwork_reproduction']),
}).superRefine((plan, context) => {
  if (plan.decision === 'search' && plan.queries.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['queries'], message: 'Search plans require at least one query.' });
  }
});

const mediaRelevanceDecisionSchema = z.object({
  decision: z.enum(['search', 'omit']),
  reason: z.string().min(1).max(500),
  subject: z.string().min(1).max(120).optional(),
});

export type MediaPlan = z.infer<typeof mediaPlanSchema>;

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced || text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  return JSON.parse(candidate);
}

export function parseMediaPlan(text: string): MediaPlan | null {
  try {
    const parsed = mediaPlanSchema.safeParse(extractJson(text.trim()));
    if (!parsed.success) return null;
    if (parsed.data.decision === 'omit') return { ...parsed.data, queries: [] };
    const queries = parsed.data.queries
      .map((query) => query.replace(/\s+/g, ' ').trim())
      .filter((query) => {
        const words = query.split(/\s+/).length;
        return words >= 3 && words <= 8;
      });
    return queries.length > 0 ? { ...parsed.data, queries } : null;
  } catch {
    return null;
  }
}

function plannerPrompt(decision: MediaIntentDecision): string {
  return `You are the dedicated media relevance worker for a chat response. Decide whether verified web images materially improve this specific answer before any search occurs.

The orchestrator classified the request as: ${decision.category}.

Choose "search" only when a real image would help the user identify a person, place, product, organism, object, event, artwork, physical structure, or visually understand a concrete process. Choose "omit" when imagery would be decorative, redundant with text, weakly related, or the answer is mainly abstract explanation, writing, code, mathematics, definitions, or advice. An explicit request to see or find images must use "search" unless blocked by safety. Presentations may use "search" when subject-specific visuals strengthen one or more slides, but should use "omit" when native diagrams, charts, or typography are more appropriate.

Return only this compact JSON shape:
{"decision":"search|omit","reason":"one short sentence","subject":"precise canonical name of the requested subject, correcting obvious spelling"}

Do not omit merely because a subject is fictional or protected IP. A relevant character reference or illustration is useful for identifying fictional subjects. Omit decorative stock imagery, graphic content, identifiable people in sensitive contexts, celebrity paparazzi, fan art, and unrelated artwork reproductions. Never invent a source URL.`;
}

export function deriveMediaSubject(message: string): string {
  const appearanceCandidate = message.match(/\bwhat(?:'s| is| does)?\s+(?:an?\s+|the\s+)?(.{2,100}?)\s+look like\b/i)?.[1]?.trim();
  const appearanceSubject = appearanceCandidate && !/^(?:it|this|that|he|him|she|her|they|them|those)$/i.test(appearanceCandidate)
    ? appearanceCandidate
    : undefined;
  const explicitImageCandidate = message.match(/\b(?:pictures?|photos?|images?|pics?)\s+of\s+([^,.!?]+)/i)?.[1]?.trim();
  // "Show an image of that winner/driver" points back to an entity that must
  // first be resolved from the factual part of the request. Searching the
  // demonstrative phrase itself produces generic cars, stock drivers, and
  // other word-overlap false positives.
  const explicitImageSubject = explicitImageCandidate && !REFERENTIAL_MEDIA_SUBJECT.test(explicitImageCandidate)
    ? explicitImageCandidate
    : undefined;
  const namedRelationSubject = message.match(/\b(?:name|identity)\s+of\s+(?:the\s+)?([^.!?\n]{3,160})/i)?.[1]
    ?.split(/\b(?:give|show|provide|include|display|pull|then)\b/i)[0]
    ?.trim();
  const questionRelation = message.match(/\bwho\s+(won)\s+([^.!?\n]{3,140})/i);
  const relationalSubject = namedRelationSubject
    || (questionRelation ? `winner of ${questionRelation[2]}` : undefined);
  const placeSubject = message.match(/\b(?:things to do in|places to (?:visit|see) in|travel(?: guide)? to|trip to|visit)\s+([^,.!?]+)/i)?.[1]?.trim();
  const currentEventSubject = message.match(/\b(?:news|updates?|announcement|coverage)\s+(?:on|about|for)\s+([^,.!?]+)/i)?.[1]
    ?.split(/\b(?:with|including|using|and give|and include)\b/i)[0]
    ?.trim();
  const subjectRequest = appearanceSubject || explicitImageSubject || relationalSubject || placeSubject || currentEventSubject || (ARTIFACT_VISUAL.test(message)
    ? (message.match(/\b(?:presentations?|powerpoints?|pptx?|slide decks?|slides|posters?|infographics?|flyers?|study sheets?)\s+(?:on|about|for)\s+([^\n.!?]+)/i)?.[1] || message)
      .split(/,|\b(?:with|using|including|use|include)\b/i)[0]
    : message);
  const subject = subjectRequest
    .replace(/\bworld war\s+(?:2|two)\b/gi, 'World War II')
    .replace(/\bworld war\s+(?:1|one)\b/gi, 'World War I')
    .replace(/^(?:please\s+)?(?:show me|who (?:is|was|are|were|am)|tell me (?:about|more about|all about|of)|give me an overview of|what (?:is|are|was|were|does|'s)|where (?:is|are|was|were)|information (?:about|on)|info (?:about|on)|details? (?:about|on)|facts? about|biography of|summary of|profile of|how (?:does|do|did|is|are)|why (?:does|do|did|is|are)|explain|describe|history of|introduction to|guide to|learn about|compare|difference between|picture of|photo of|image of)\s+/i, '')
    .replace(/\b(?:and\s+)?what\s+(?:does|do)\s+(?:it|that|he|she|they|those|this)\s+look\s+like\b[\s?.!]*$/i, ' ')
    .replace(/\blook like\b/gi, ' ')
    .replace(/\b(?:give|show|provide|include|add)(?:\s+me)?\s+(?:(?:its|their|an?|the|a few|few|some|more)\s+)?(?:images?|photos?|pictures?|pics?|visuals?)(?:\s+(?:too|also))?\b[\s\S]*$/i, ' ')
    .replace(/\b(?:and|then)\s*$/i, ' ')
    .replace(/\b(?:please|create|make|generate|build|design|prepare|draft|produce|give|provide|include|add|also|too|its|their|me|a|an|the|presentations?|powerpoints?|pptx?|slide decks?|slides|posters?|infographics?|about|of|on|for|with|using|use|real|actual|verified|web|where|info|information|details?|summary|profile|facts?|images?|photos?|pictures?|pics?|visuals?)\b/gi, ' ')
    .replace(/[^a-z0-9\s-]/gi, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .join(' ');
  return GENERIC_MEDIA_SUBJECT.test(subject) ? '' : canonicalizeMediaSubject(subject);
}

type MediaResolutionEvidence = { title?: string; content?: string };

export function inferConcreteMediaSubjectFromEvidence(evidence: MediaResolutionEvidence[]): string | null {
  const scores = new Map<string, { value: string; score: number }>();
  const add = (value: string, weight: number) => {
    const clean = value.replace(/\s+/g, ' ').trim();
    if (clean.split(/\s+/).length < 2 || clean.length > 60) return;
    const key = clean.toLowerCase();
    const previous = scores.get(key);
    scores.set(key, { value: clean, score: (previous?.score || 0) + weight });
  };

  evidence.forEach((item, index) => {
    const rankWeight = Math.max(1, 5 - index * 0.35);
    const text = `${item.title || ''}. ${item.content || ''}`;
    for (const match of text.matchAll(/\b([A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+){1,3})\s+(?:won|wins|beat|beats|claimed|claims|secured|secures|took|takes)\b/g)) {
      add(match[1], rankWeight);
    }
    for (const match of text.matchAll(/\b(?:won by|winner(?:\s+was|\s+is)?|victory for)\s+([A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+){1,3})\b/g)) {
      add(match[1], rankWeight);
    }
    if (/\b(?:winner|wins?|race report|results?|highlights?)\b/i.test(item.title || '')) {
      for (const match of (item.title || '').matchAll(/:\s*([A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+){1,3})(?=\s*(?:[-–—|.]|$))/g)) {
        add(match[1], rankWeight * 0.9);
      }
    }
  });

  return [...scores.values()].sort((left, right) => right.score - left.score)[0]?.value || null;
}

function needsConcreteSubjectResolution(message: string, subject: string): boolean {
  const explicitImageSubject = message.match(/\b(?:pictures?|photos?|images?|pics?)\s+of\s+([^,.!?]+)/i)?.[1]?.trim() || '';
  return REFERENTIAL_MEDIA_SUBJECT.test(explicitImageSubject)
    && /\b(?:latest|most recent|current|today|this (?:week|month|year)|winner|won|elected|announced|selected|named)\b/i.test(`${message} ${subject}`);
}

function dateAwareResolutionQuery(subject: string, message: string): string {
  if (!/\b(?:today|current|latest|most recent|this (?:week|month|year))\b/i.test(message)) return subject;
  const now = new Date();
  const month = now.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  const orderedSubject = subject.replace(/^winner\s+(.+)$/i, '$1 winner');
  return `${month} ${now.getUTCFullYear()} ${orderedSubject}`;
}

async function resolveConcreteMediaSubject(options: AgentLoopOptions, message: string, subject: string): Promise<string | null> {
  const webSearch = getTool('web_search');
  if (!webSearch) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      webSearch.handler({
        query: dateAwareResolutionQuery(subject, message),
        maxResults: 8,
        searchDepth: 'advanced',
        includeImages: false,
      }),
      new Promise<import('./tool-registry.js').ToolResult>((resolve) => {
        timer = setTimeout(() => resolve({ content: 'Subject resolution timed out.', error: 'timeout' }), 8_000);
      }),
    ]);
    options.signal?.throwIfAborted();
    return inferConcreteMediaSubjectFromEvidence(result.sources || []);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function requiresConcreteWebImage(category: MediaIntentCategory): boolean {
  return [
    'explicit',
    'place',
    'product',
    'person_or_subject',
    'animal_or_plant',
    'food',
    'historical',
    'instructional',
  ].includes(category);
}

function fallbackPlan(message: string, decision: MediaIntentDecision): MediaPlan | null {
  const subject = deriveMediaSubject(message);
  if (!subject) return null;
  const queries = decision.category === 'artifact'
    ? [
        `${subject} authoritative overview`,
        `${subject} important people places`,
        `${subject} diagram mechanism`,
        `${subject} archive primary source`,
        `${subject} modern application`,
      ]
    : decision.category === 'instructional'
    ? [`${subject} labeled diagram`, `${subject} technical schematic`, `${subject} architecture overview`]
    : VEHICLE_SUBJECT.test(subject)
      ? [`${subject} official photo`, `${subject} exterior side view`, `${subject} design details`]
    : decision.category === 'person_or_subject'
      ? [`${subject} portrait face`, `${subject} full body`, `${subject} action scene`]
      : decision.category === 'current_event'
        ? [`${subject} latest official announcement`, `${subject} recent event photo`, `${subject} official press image`]
      : [`${subject} clear overview`, `${subject} close up detail`, `${subject} full view context`];
  return {
    decision: 'search',
    reason: 'The request is explicitly or inherently visual.',
    subject,
    queries,
    altText: `Web image supporting the explanation of ${subject}`,
    placement: decision.renderPlacement,
    safetyCategory: 'none',
  };
}

const BLOCKED_SOURCE = /(?:gettyimages|shutterstock|alamy|dreamstime|depositphotos|youtube|tiktok|instagram|facebook|artstation|deviantart|dailyanimeart|slideshare|teacherspayteachers)/i;
const BLOCKED_METADATA = /\b(?:paparazzi|celebrity gossip|fan art|graphic injury|gore|corpse|autopsy|nsfw|nude)\b/i;
const LOW_QUALITY_DISCOVERY_MEDIA = /\b(?:wallpapers?|wallpaper cave|printables?|coloring pages?|drawing step by step|free (?:image|photo|download)|word templates?|stock vector|reddit)\b/i;
const TRUSTED_SOURCE = /(?:\.gov|\.edu|\.ac\.|wikipedia\.org|wikimedia\.org|britannica\.com|nasa\.gov|who\.int|nationalgeographic\.com|fandom\.com|wikia\.nocookie\.net|cbrimages\.com)/i;
const GENERIC_RELEVANCE_WORDS = new Set([
  'about', 'advantages', 'answer', 'clear', 'context', 'detail', 'explain', 'full', 'image', 'images',
  'guide', 'introduction', 'learn', 'meaning', 'overview', 'photo', 'picture', 'process', 'reference',
  'add', 'also', 'give', 'include', 'its', 'provide', 'show', 'tell', 'too', 'view', 'visual', 'what',
  'who', 'with', 'works',
]);
// A manufacturer alone cannot identify a requested product model. Keep the
// partial-name resilience for e.g. Einstein, but never substitute an Aventador
// for a Terzo Millennio just because both carry the Lamborghini badge.
const SHARED_BRAND_WORDS = new Set(['lamborghini', 'ferrari', 'porsche', 'bugatti', 'mclaren', 'mercedes', 'toyota', 'samsung', 'apple', 'nvidia', 'google', 'microsoft', 'lenovo']);

function words(value: string): Set<string> {
  let decoded = value;
  try { decoded = decodeURIComponent(value); } catch { /* keep malformed URLs as text */ }
  return new Set(decoded.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2 && !GENERIC_RELEVANCE_WORDS.has(word)));
}

function boundedEditDistance(left: string, right: string, limit: number): number {
  let previous = Array.from({ length: right.length + 1 }, (_value, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
    const current = [leftIndex];
    let rowMinimum = current[0];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
      rowMinimum = Math.min(rowMinimum, current[rightIndex]);
    }
    if (rowMinimum > limit) return limit + 1;
    previous = current;
  }
  return previous[right.length];
}

function fuzzyWordMatch(left: string, right: string): boolean {
  if (left === right) return true;
  const longest = Math.max(left.length, right.length);
  const shortest = Math.min(left.length, right.length);
  if (shortest < 5 || Math.abs(left.length - right.length) > 2) return false;
  // Short names retain the old one-edit rule. A same-initial name of 7-8
  // characters gets a small extra typo budget so common phonetic misspellings
  // such as "enstine" can match authoritative "Einstein" metadata.
  const limit = longest <= 6 ? 1 : longest <= 8 && left[0] === right[0] ? 3 : 2;
  return boundedEditDistance(left, right, limit) <= limit;
}

function countRelevantWordMatches(queryWords: Set<string>, metadataWords: Set<string>): number {
  return [...queryWords].filter((queryWord) => (
    [...metadataWords].some((metadataWord) => fuzzyWordMatch(queryWord, metadataWord))
  )).length;
}

function canonicalImageFingerprint(candidate: ToolImage): string {
  const raw = candidate.url.trim();
  try {
    const parsed = new URL(raw);
    parsed.search = '';
    parsed.hash = '';
    let path = parsed.pathname.replace(/\/thumb\//i, '/');
    // Wikimedia thumbnail URLs append a rendered-size copy of the original
    // filename. Remove that suffix so different thumbnail sizes collapse to
    // the same underlying image.
    path = path.replace(/\/\d+px-[^/]+$/i, '');
    return `${parsed.hostname.toLowerCase()}${path.toLowerCase()}`;
  } catch {
    return raw.toLowerCase().split(/[?#]/)[0];
  }
}

function canonicalMetadataFingerprint(candidate: ToolImage): string {
  const rawTitle = candidate.title || '';
  const specificTitle = rawTitle.includes('—') ? rawTitle.split('—').slice(1).join(' ') : rawTitle;
  const title = [...words(specificTitle)].sort().join('-');
  let source = (candidate.sourceUrl || '').toLowerCase().split(/[?#]/)[0];
  try {
    const parsed = new URL(candidate.sourceUrl || '');
    source = `${parsed.hostname.toLowerCase()}${parsed.pathname.toLowerCase()}`;
  } catch {}
  return title && source ? `${source}|${title}` : '';
}

export function isStrongMetadataMediaMatch(candidate: ToolImage, plan: MediaPlan, allowDistinctivePartialMatch = false): boolean {
  if (!candidate.verified || !/^https?:\/\//i.test(candidate.url)) return false;
  const subjectWords = words(plan.subject);
  if (subjectWords.size === 0) return false;

  // Wikipedia file candidates are titled "Article — file name". Only the file
  // name is evidence about the actual pixels; the article prefix merely says
  // where the image was discovered and caused homonyms to rank as exact hits.
  const rawTitle = candidate.title || '';
  const specificTitle = rawTitle.includes('—') ? rawTitle.split('—').slice(1).join(' ') : rawTitle;
  const specificWords = words(`${specificTitle} ${candidate.url}`);
  const specificMatches = countRelevantWordMatches(subjectWords, specificWords);
  const hasDistinctivePartialMatch = allowDistinctivePartialMatch
    && specificMatches >= 1
    && [...subjectWords].some((subjectWord) => subjectWord.length >= 6 && !SHARED_BRAND_WORDS.has(subjectWord)
      && [...specificWords].some((metadataWord) => fuzzyWordMatch(subjectWord, metadataWord)));
  const requiredMatches = hasDistinctivePartialMatch ? 1 : Math.min(2, subjectWords.size);
  if (specificMatches < requiredMatches) return false;

  const sourceText = `${candidate.sourceDomain || ''} ${candidate.sourceUrl || ''}`;
  const authority = TRUSTED_SOURCE.test(sourceText) || Boolean(candidate.sourceUrl);
  return authority && (candidate.confidence || 0) >= 0.62;
}

export function filterAndRankMediaCandidates(candidates: ToolImage[], plan: MediaPlan, originalMessage: string): ToolImage[] {
  if (plan.safetyCategory !== 'none') return [];
  const queryWords = words(plan.subject);
  const explicitVisualRequest = EXPLICIT_VISUAL.test(originalMessage);
  const seenUrls = new Set<string>();

  const ranked = candidates
    .filter((candidate) => {
      const metadata = `${candidate.url} ${candidate.title || ''} ${candidate.sourceUrl || ''} ${candidate.sourceDomain || ''} ${candidate.attribution || ''}`;
      const accepted = /^https?:\/\//i.test(candidate.url)
        && candidate.verified === true
        && !seenUrls.has(candidate.url)
        && !BLOCKED_SOURCE.test(metadata)
        && !BLOCKED_METADATA.test(metadata)
        && (!LOW_QUALITY_DISCOVERY_MEDIA.test(metadata) || LOW_QUALITY_DISCOVERY_MEDIA.test(originalMessage))
        && !(/\b(?:cosplay|cosplayer|costume|figurine|merchandise)\b/i.test(metadata)
          && !/\b(?:cosplay|cosplayer|costume|figurine|merchandise)\b/i.test(originalMessage))
        && !(/\b(?:world war|historical|history|battle)\b/i.test(originalMessage)
          && /(?:amazon|ebay|etsy|book cover|novel cover|merchandise)/i.test(metadata));
      if (accepted) seenUrls.add(candidate.url);
      return accepted;
    })
    .map((candidate) => {
      const metadataWords = words(`${candidate.title || ''} ${candidate.url} ${candidate.sourceUrl || ''} ${candidate.sourceDomain || ''} ${candidate.attribution || ''}`);
      const overlap = countRelevantWordMatches(queryWords, metadataWords);
      const relevance = queryWords.size > 0 ? Math.min(overlap / Math.min(queryWords.size, 6), 1) : 0;
      const sourceText = `${candidate.sourceDomain || ''} ${candidate.sourceUrl || ''}`;
      const authority = TRUSTED_SOURCE.test(sourceText) ? 0.2 : candidate.sourceUrl ? 0.08 : 0;
      const resolution = (candidate.width || 0) >= 800 && (candidate.height || 0) >= 500 ? 0.15
        : (candidate.width || 0) >= 400 && (candidate.height || 0) >= 250 ? 0.08 : 0;
      const upstream = Math.min(Math.max(candidate.score || 0, 0), 1) * 0.12;
      const canonicalSubject = [...queryWords].join(' ');
      const canonicalTitle = [...words(candidate.title || '')].join(' ');
      const directSubjectImage = canonicalTitle === canonicalSubject && /wikipedia\.org/.test(sourceText) ? 0.12 : 0;
      const confidence = Math.min(0.98, 0.12 + relevance * 0.4 + authority + resolution + upstream + directSubjectImage);
      const distinctivePartialMatch = explicitVisualRequest
        && overlap >= 1
        && [...queryWords].some((queryWord) => queryWord.length >= 6 && !SHARED_BRAND_WORDS.has(queryWord)
          && [...metadataWords].some((metadataWord) => fuzzyWordMatch(queryWord, metadataWord)));
      return {
        ...candidate,
        alt: plan.altText,
        query: candidate.query || plan.queries[0],
        attribution: candidate.attribution || candidate.sourceDomain || 'Source website',
        confidence: overlap === 0 || (queryWords.size > 1 && overlap < Math.min(2, queryWords.size) && !distinctivePartialMatch) ? 0 : confidence,
        verified: true,
      };
    })
    .filter((candidate) => (candidate.confidence || 0) >= 0.42)
    .sort((left, right) => (right.confidence || 0) - (left.confidence || 0));

  const selected: ToolImage[] = [];
  const selectedUrls = new Set<string>();
  const selectedDomains = new Set<string>();
  const selectedImageFingerprints = new Set<string>();
  const selectedMetadataFingerprints = new Set<string>();
  const take = (candidate: ToolImage | undefined, allowRepeatedDomain = false) => {
    if (!candidate || selectedUrls.has(candidate.url)) return;
    const domain = candidate.sourceDomain || '';
    if (!allowRepeatedDomain && domain && selectedDomains.has(domain)) return;
    const imageFingerprint = canonicalImageFingerprint(candidate);
    const metadataFingerprint = canonicalMetadataFingerprint(candidate);
    if (selectedImageFingerprints.has(imageFingerprint) || (metadataFingerprint && selectedMetadataFingerprints.has(metadataFingerprint))) return;
    selected.push(candidate);
    selectedUrls.add(candidate.url);
    selectedImageFingerprints.add(imageFingerprint);
    if (metadataFingerprint) selectedMetadataFingerprints.add(metadataFingerprint);
    if (domain) selectedDomains.add(domain);
  };

  // Prefer one verified result from each deliberately different query before
  // filling any remaining collage slot by confidence.
  for (const query of plan.queries) {
    take(ranked.find((candidate) => candidate.query?.toLowerCase() === query.toLowerCase()
      && !selectedUrls.has(candidate.url)));
  }
  for (const candidate of ranked) {
    if (selected.length >= 12) break;
    take(candidate);
  }
  // If authoritative coverage comes from one archive, allow repeated domains
  // only after diversity has been attempted.
  for (const candidate of ranked) {
    if (selected.length >= 12) break;
    take(candidate, true);
  }
  return selected.slice(0, 12);
}

export function buildDiverseMediaQueries(plan: MediaPlan, category: MediaIntentCategory): string[] {
  const subject = canonicalizeMediaSubject(plan.subject);
  const conciseSubject = subject.split(/\s+/).slice(0, 5).join(' ');
  const defaults = category === 'instructional'
    ? [`${conciseSubject} labeled diagram`, `${conciseSubject} technical schematic`, `${conciseSubject} architecture overview`]
    : category === 'current_event'
      ? [`${conciseSubject} latest official announcement`, `${conciseSubject} recent event photo`, `${conciseSubject} official press image`]
    : VEHICLE_SUBJECT.test(subject)
    ? [`${subject} official photo`, `${subject} exterior side view`, `${subject} design details`]
    : category === 'person_or_subject' || /\b(?:person|actor|author|artist|character|anime|manga)\b/i.test(subject)
    ? [`${subject} portrait face`, `${subject} full body`, `${subject} action scene`]
    : [`${subject} clear overview`, `${subject} close up detail`, `${subject} full view context`];
  const queries = [...plan.queries, ...defaults]
    .map((query) => canonicalizeMediaSubject(query))
    .filter((query) => !VEHICLE_SUBJECT.test(subject) || !/\b(?:portrait|face|body|action scene)\b/i.test(query))
    .filter((query) => {
      const count = query.split(/\s+/).length;
      return count >= 3 && count <= 8;
    });
  return [...new Set(queries.map((query) => query.toLowerCase()))]
    .map((normalized) => queries.find((query) => query.toLowerCase() === normalized)!)
    .slice(0, category === 'artifact' ? 5 : 3);
}

async function planMedia(options: AgentLoopOptions, decision: MediaIntentDecision): Promise<MediaPlan | null> {
  let text = '';
  let failed = false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('Media planning timed out'), 8_000);
  try {
    await runAgentLoop({
      ...options,
      sessionId: `media-${crypto.randomUUID()}`,
      message: resolveContextualMediaMessage(options.message || '', options.mediaContext),
      mode: 'normal',
      reasoningEffort: 'low',
      systemContext: plannerPrompt(decision),
      allowedTools: [],
      attachments: [],
      searchMode: 'off',
      maxOutputTokens: 450,
      maxIterations: 2,
      signal: options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal,
      onEvent: (event) => {
        if (event.type === 'text_delta') text += event.content;
        else if (event.type === 'response_reset') text = '';
        else if (event.type === 'error') failed = true;
      },
    });
  } catch {
    failed = true;
  } finally {
    clearTimeout(timer);
  }
  if (failed) return null;
  const relevance = parseMediaRelevanceDecision(text);
  const basePlan = fallbackPlan(relevance?.subject || options.message || '', decision);
  if (!relevance || !basePlan) return null;
  return {
    ...basePlan,
    decision: relevance.decision,
    reason: relevance.reason,
    queries: relevance.decision === 'omit' ? [] : basePlan.queries,
  };
}

export function mergePixelReviewedMediaCandidates(
  qualityRanked: ToolImage[],
  reviewShortlist: ToolImage[],
  visuallyVerified: ToolImage[] | null,
  plan: MediaPlan,
  allowDistinctivePartialMatch: boolean,
): ToolImage[] {
  const visuallyAccepted = visuallyVerified || [];
  const acceptedUrls = new Set(visuallyAccepted.map((candidate) => candidate.url));
  const reviewedUrls = new Set(reviewShortlist.map((candidate) => candidate.url));
  const resilientMatches = qualityRanked.filter((candidate) =>
    !acceptedUrls.has(candidate.url)
    // A completed pixel review is authoritative for every candidate it saw.
    // Only an unavailable review, or a strong metadata match that was not in
    // the bounded shortlist, may use the resilient metadata fallback.
    && (visuallyVerified === null || !reviewedUrls.has(candidate.url))
    && isStrongMetadataMediaMatch(candidate, plan, allowDistinctivePartialMatch));
  return [...visuallyAccepted, ...resilientMatches];
}

const mediaVisualReviewSchema = z.object({
  ratings: z.array(z.object({
    index: z.number().int().nonnegative(),
    score: z.number().min(0).max(100),
  })).min(1).max(5),
});

async function verifyMediaCandidatesVisually(
  options: AgentLoopOptions,
  candidates: ToolImage[],
  plan: MediaPlan,
): Promise<ToolImage[] | null> {
  const shortlist = candidates.slice(0, 5);
  if (shortlist.length === 0) return [];

  let text = '';
  let failed = false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('Visual relevance review timed out'), 12_000);
  try {
    await runAgentLoop({
      ...options,
      sessionId: `media-review-${crypto.randomUUID()}`,
      message: `Subject that the images must visibly depict: ${plan.subject}\n\nCandidate metadata, in attachment order:\n${shortlist.map((candidate, index) => `${index}: ${candidate.title || 'Untitled'} (${candidate.sourceDomain || 'unknown source'})`).join('\n')}`,
      mode: 'normal',
      reasoningEffort: 'low',
      searchMode: 'off',
      attachments: shortlist.map((candidate, index) => ({
        name: `candidate-${index + 1}`,
        type: candidate.mimeType || 'image/jpeg',
        url: candidate.url,
      })),
      allowedTools: [],
      maxIterations: 1,
      signal: options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal,
      systemContext: `You rate web-image relevance from the visible pixels, not from titles or URLs. Score every attached candidate from 0 to 100 for how clearly it depicts the requested subject and how useful it is for explaining that subject. Decorative hero art, generic portraits, loosely related stock imagery, screenshots of unrelated pages, and mislabeled images score low. For technical topics, prefer legible diagrams, schematics, or clearly identifiable hardware. Return only JSON: {"ratings":[{"index":0,"score":92}]}. Use zero-based attachment indices, include every attachment exactly once, and order ratings from highest to lowest.`,
      onEvent: (event) => {
        if (event.type === 'text_delta') text += event.content;
        else if (event.type === 'response_reset') text = '';
        else if (event.type === 'error') failed = true;
      },
    });
  } catch {
    failed = true;
  } finally {
    clearTimeout(timer);
  }

  if (failed || !text.trim()) return null;
  try {
    const review = mediaVisualReviewSchema.parse(extractJson(text));
    const ratingByIndex = new Map(review.ratings
      .filter((rating) => rating.index < shortlist.length)
      .map((rating) => [rating.index, rating.score]));
    if (ratingByIndex.size !== shortlist.length) return null;
    return shortlist
      .map((candidate, index) => ({
        ...candidate,
        confidence: Math.min(0.99, Math.max(0, (candidate.confidence || 0) * 0.55 + (ratingByIndex.get(index) || 0) / 100 * 0.45)),
      }))
      .filter((_candidate, index) => (ratingByIndex.get(index) || 0) >= 65)
      .sort((left, right) => (right.confidence || 0) - (left.confidence || 0));
  } catch {
    return null;
  }
}

export async function runMediaWorker(options: AgentLoopOptions, onEvent: (event: AgentEvent) => void): Promise<ToolImage[]> {
  // Voice search is deliberately audio-first. Images add latency, consume
  // provider capacity, and cannot be conveyed faithfully through speech.
  if (options.isVoice) return [];
  const rawMessage = options.message || '';
  const message = resolveContextualMediaMessage(rawMessage, options.mediaContext);
  const contextualFollowUp = message !== cleanContextMessage(rawMessage);
  const decision = classifyMediaIntent(message);
  if (!decision.considered) return [];
  if (decision.blockedReason) {
    onEvent({ type: 'media_status', status: 'omitted', label: 'Web images omitted', reason: decision.blockedReason });
    return [];
  }

  onEvent({ type: 'media_status', status: 'planning', label: 'Planning relevant web imagery' });
  // Explicit requests always search. For every implicit case, a small dedicated
  // worker decides whether imagery adds real explanatory value before retrieval.
  // The deterministic plan is only a resilience fallback when that worker is
  // temporarily unavailable; a valid "omit" decision remains authoritative.
  const artifactExplicitlyRequestsImages = decision.category === 'artifact'
    && /\b(?:with|using|use|include|add|give|provide)\b[\s\S]{0,100}\b(?:web\s+)?(?:images?|photos?|pictures?|pics?|visuals?)\b/i.test(message);
  const concreteImageRequired = requiresConcreteWebImage(decision.category) || artifactExplicitlyRequestsImages;
  // The planner still canonicalizes ambiguous names ("Naruto" -> "Naruto
  // Uzumaki"), but it cannot veto imagery for a concrete identity/appearance
  // request. Its omit decision is advisory only for abstract topics, current
  // events, and artifacts where native diagrams may be more useful.
  const workerPlan = await planMedia(options, decision);
  const optionalTopic = decision.category === 'topic' || decision.category === 'current_event';
  const unmistakablyVisualTopic = /\b(?:anatomy|appearance|architecture|aurora|diagram|eclipse|engine|geography|landform|machine|map|mechanism|moon|planet|spacecraft|storm|structure|volcano|weather)\b/i.test(message);
  const concreteCurrentEvent = decision.category === 'current_event'
    && /\b(?:game|gta|film|movie|vehicle|car|phone|device|launch|trailer|spacecraft|mission|ceremony|protest|election)\b/i.test(message);
  let plan = concreteImageRequired
    ? fallbackPlan(workerPlan?.subject || message, decision)
    : workerPlan ?? (optionalTopic && !unmistakablyVisualTopic && !concreteCurrentEvent ? null : fallbackPlan(message, decision));
  options.signal?.throwIfAborted();
  if (!plan || plan.decision === 'omit' || plan.safetyCategory !== 'none') {
    onEvent({
      type: 'media_status',
      status: 'omitted',
      label: 'Web images omitted',
      reason: plan?.reason || 'No sufficiently useful and safe image query was identified.',
    });
    return [];
  }

  const needsSubjectResolution = decision.visual_intent === 'explicit'
    && needsConcreteSubjectResolution(message, plan.subject);
  let subjectResolved = false;
  if (needsSubjectResolution) {
    onEvent({ type: 'media_status', status: 'planning', label: 'Resolving the exact image subject' });
    const resolvedSubject = await resolveConcreteMediaSubject(options, message, plan.subject);
    if (resolvedSubject) {
      const resolvedPlan = fallbackPlan(resolvedSubject, decision);
      if (resolvedPlan) {
        subjectResolved = true;
        plan = {
          ...resolvedPlan,
          queries: [
            `${resolvedSubject} official portrait`,
            `${resolvedSubject} recent event photo`,
            `${resolvedSubject} on track`,
          ],
        };
      }
    }
  }

  const imageSearch = process.env.BRAVE_API_KEY || !process.env.TAVILY_API_KEY
    ? getTool('image_search')
    : getTool('web_search');
  if (!imageSearch) {
    onEvent({ type: 'media_status', status: 'failed', label: 'Web image search unavailable' });
    return [];
  }

  onEvent({ type: 'media_status', status: 'searching', label: `Searching images for ${plan.subject}` });
  const posterRequest = POSTER_VISUAL.test(message);
  // More slots never relax the subject or duplicate checks.
  const imageLimit = posterRequest ? Math.min(3, decision.image_count) : decision.image_count;
  const queryLimit = decision.category === 'explicit' ? 3
    : decision.category === 'artifact' ? (options.reasoningEffort === 'low' ? 2 : 5)
      : options.reasoningEffort === 'low' ? 1 : 3;
  const searchQueries = buildDiverseMediaQueries(plan, decision.category).slice(0, queryLimit);
  let searchPlan = {
    ...plan,
    queries: searchQueries,
    placement: decision.renderPlacement,
  };
  const searchTools = [...new Map(
    [imageSearch, getTool('image_search')]
      .filter((tool): tool is NonNullable<typeof tool> => Boolean(tool))
      .map((tool) => [tool.name, tool]),
  ).values()];
  const results = await Promise.all(searchTools.flatMap((tool) => searchQueries.map(async (query) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        tool.handler(tool.name === 'web_search'
          ? { query, maxResults: 6, searchDepth: 'basic', includeImages: true }
          : { query, maxResults: 6 }),
        new Promise<import('./tool-registry.js').ToolResult>((resolve) => {
          timer = setTimeout(() => resolve({ content: 'Image search timed out.', error: 'timeout' }), 17_000);
        }),
      ]);
    } catch { return { content: 'Image search unavailable.', error: 'search_unavailable' }; }
    finally { if (timer) clearTimeout(timer); }
  })));
  const candidates = results.flatMap((result) => result.images || []);
  if (needsSubjectResolution && !subjectResolved) {
    const candidateSubject = inferConcreteMediaSubjectFromEvidence(candidates.map((candidate) => ({ title: candidate.title })));
    if (candidateSubject) {
      const candidatePlan = fallbackPlan(candidateSubject, decision);
      if (candidatePlan) {
        plan = candidatePlan;
        searchPlan = { ...candidatePlan, queries: searchQueries, placement: decision.renderPlacement };
      }
    }
  }
  onEvent({ type: 'media_status', status: 'verifying', label: 'Verifying image relevance, framing, and provenance' });
  const ranked = filterAndRankMediaCandidates(candidates, searchPlan, message);
  const allowDistinctivePartialMatch = decision.visual_intent === 'explicit';
  const metadataMatches = ranked.filter((candidate) => isStrongMetadataMediaMatch(candidate, searchPlan, allowDistinctivePartialMatch));
  // Identification images should favor encyclopedic, official, institutional,
  // and first-party archives. Keep other exact matches as fallbacks, but never
  // let a wallpaper/template result outrank a usable Wikimedia or Fandom file.
  const trustedMatches = metadataMatches.filter((candidate) => TRUSTED_SOURCE.test(
    `${candidate.sourceDomain || ''} ${candidate.sourceUrl || ''} ${candidate.url}`,
  ));
  const qualityRanked = [
    ...trustedMatches,
    ...ranked.filter((candidate) => !trustedMatches.some((trusted) => trusted.url === candidate.url)),
  ];
  let selected = qualityRanked.filter((candidate) => isStrongMetadataMediaMatch(candidate, searchPlan, allowDistinctivePartialMatch)).slice(0, imageLimit);
  // Strong, subject-specific source metadata is sufficient for ordinary
  // reference images. Reserve scarce vision capacity for ambiguous candidates.
  const requiresPixelReview = selected.length === 0 || contextualFollowUp;
  if (qualityRanked.length > 0 && requiresPixelReview) {
    // Review more candidates than the final slot count. If the highest-ranked
    // metadata hit is a homonym (for example Naruto whirlpools), a lower-ranked
    // image that actually depicts the character can still win.
    const reviewShortlist = qualityRanked.slice(0, 5);
    const visuallyVerified = await verifyMediaCandidatesVisually(options, reviewShortlist, searchPlan);
    // Pixel review remains preferred. If the vision route cannot load a remote
    // URL or returns no decision, exact subject-bearing metadata from an
    // attributable source keeps required imagery working without reviving
    // single-word homonyms.
    selected = mergePixelReviewedMediaCandidates(
      qualityRanked,
      reviewShortlist,
      visuallyVerified,
      searchPlan,
      allowDistinctivePartialMatch,
    ).slice(0, imageLimit);
  }
  if (selected.length < 1) {
    const reason = results.some((result) => result.error)
      ? 'Image search failed or timed out; the text response is unaffected.'
      : 'No candidate passed relevance, framing, provenance, and safety checks.';
    onEvent({ type: 'media_status', status: 'omitted', label: 'Continuing without web images', reason });
    return [];
  }

  onEvent({ type: 'media', query: plan.subject, placement: searchPlan.placement, images: selected });
  onEvent({ type: 'media_status', status: 'completed', label: `${selected.length} relevant web image${selected.length === 1 ? '' : 's'} selected` });
  return selected;
}

export function parseMediaRelevanceDecision(text: string): { decision: 'search' | 'omit'; reason: string; subject?: string } | null {
  try {
    const parsed = mediaRelevanceDecisionSchema.safeParse(extractJson(text.trim()));
    if (parsed.success) return parsed.data;
  } catch {}
  const decision = text.match(/(?:^|[,{\s])(?:["']?decision["']?\s*[:=-]\s*)?["']?(search|omit)["']?/i)?.[1]?.toLowerCase();
  if (decision !== 'search' && decision !== 'omit') return null;
  return {
    decision,
    reason: decision === 'search'
      ? 'A concrete visual would materially improve this answer.'
      : 'The answer is clearer without decorative or redundant imagery.',
  };
}
