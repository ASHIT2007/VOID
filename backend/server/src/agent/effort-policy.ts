export type ReasoningEffort = 'low' | 'medium' | 'high';
export type EffortChoice = ReasoningEffort | 'auto';

export function isQuestionSetRequest(raw: string) {
  const message = raw.replace(/\s*\[SYSTEM DIRECTIVE:[\s\S]*?\]\s*/gi, ' ').trim();
  return /\b(?:solve|answer|work(?:\s+out)?|complete|provide solutions?\s+(?:for|to))\b[\s\S]{0,100}\b(?:all|every|full|complete|entire)?\s*(?:questions?|question bank|problem set|worksheet|exercises?|assignment)\b/i.test(message)
    || /\b(?:question bank|problem set|worksheet|exercise set)\b[\s\S]{0,100}\b(?:solve|answer|solutions?|fully|complete)\b/i.test(message);
}

/**
 * Short entity and concept prompts are simple to reason about, but they are
 * not requests for a one-sentence answer. Keep them single-agent while giving
 * the responder an explicit, useful coverage floor.
 */
export function answerDepthInstruction(raw: string) {
  const message = raw.replace(/\s*\[SYSTEM DIRECTIVE:[\s\S]*?\]\s*/gi, ' ').trim();
  const askedForBrevity = /\b(?:brief|briefly|short|shortly|concise|one sentence|one paragraph|quick answer|tl;?dr)\b/i.test(message);
  if (askedForBrevity) return '';

  const informationalOverview = /^\s*(?:please\s+)?(?:who (?:is|was|are|were)|tell me about|give me an overview of|overview of|biography of|what (?:is|are|was|were)|explain)\b/i.test(message)
    && !/^\s*(?:what is|calculate|solve)\s+[\d\s+\-*/().%=]+[?.!]?\s*$/i.test(message);
  if (!informationalOverview) return '';

  return 'INFORMATIONAL OVERVIEW DEPTH: Give a direct identification first, then enough context to make the answer genuinely useful. Unless the user requested brevity, cover the subject\'s background or definition, distinguishing traits or main ideas, significance, and relevant context in roughly 180-350 words. Use 2-4 compact paragraphs or a few descriptive sections when that improves readability. Do not stop after a single summary paragraph.';
}

export function effortAnswerInstruction(effort: ReasoningEffort, raw: string) {
  const message = raw.replace(/\s*\[SYSTEM DIRECTIVE:[\s\S]*?\]\s*/gi, ' ').trim();
  const requestedBrevity = /\b(?:brief|briefly|short|shortly|concise|one sentence|one paragraph|quick answer|tl;?dr)\b/i.test(message);
  if (requestedBrevity) return 'The user explicitly requested brevity. Respect that limit while still answering every requested point.';

  if (effort === 'high') {
    return 'TENEBRAE RESPONSE DEPTH: Produce a more complete and descriptive answer than Umbra or Penumbra would. After the direct answer, develop the important context, mechanisms or reasoning, concrete examples, material nuances, and implications that help the user understand the subject. Cover meaningful counterpoints or limitations when relevant. Do not pad with repetition, decorative headings, excessive bullets, unnecessary tables, or filler; earn the extra length through useful substance.';
  }
  if (effort === 'low') {
    return 'PENUMBRA RESPONSE DEPTH: Answer directly and concisely. Include the essential explanation and every explicitly requested item, but omit optional detours and secondary nuance.';
  }
  return 'UMBRA RESPONSE DEPTH: Give a balanced, adequately descriptive answer with the key context and examples needed for understanding, without the extended depth and cross-checking used by Tenebrae.';
}

export function assessTask(raw: string, attachmentCount = 0) {
  const message = raw.replace(/\s*\[SYSTEM DIRECTIVE:[\s\S]*?\]\s*/gi, ' ').trim();
  // Inspect the requested operation, not the length or keywords in its data payload.
  const instruction = message.split(/\n\s*\n|:\s*\n/)[0].replace(/```[\s\S]*$/g, '');
  const mechanical = /^(?:please\s+)?(?:reformat|format|sort|alphabeti[sz]e|translate|rename|convert (?:case|this|these)|fix (?:grammar|spelling)|spellcheck)\b/i.test(instruction)
    && !/\b(?:then|also|and)\s+(?:analy[sz]e|evaluate|prove|debug|audit)\b/i.test(instruction);
  const greeting = /^(?:hi|hello|hey|yo|thanks|thank you|good (?:morning|afternoon|evening))[!.?\s]*$/i.test(message);
  const proof = /\b(?:prove|disprove|derive|theorem|formal proof|multi-step (?:math|logic))\b/i.test(instruction);
  const stakes = /\b(?:medical|legal|financial|security|safety|production|outage|data loss|compliance|patient|dosage)\b/i.test(instruction);
  const deliberation = /\b(?:debug|root cause|architecture|trade-?offs?|investigate|race condition|deadlock|migration|optimi[sz]e)\b/i.test(instruction);
  const ambiguity = /\b(?:ambiguous|uncertain|alternatives?|multiple approaches|compare|evaluate|conflicting)\b/i.test(instruction);
  const verification = /\b(?:verify|fact[ -]?check|evidence|cross-check|audit)\b/i.test(instruction);
  const research = /\b(?:research|sources?|citations?|latest|current|today|news|fact[ -]?check)\b/i.test(instruction);
  const attachmentAnalysis = attachmentCount > 0 && /\b(?:analy[sz]e|review|compare|debug|audit)\b/i.test(instruction);
  const questionSet = isQuestionSetRequest(message);
  const lookup = /^(?:please\s+)?(?:what (?:is|are)|who (?:is|was)|define|tell me about|explain|look up)\b/i.test(instruction);
  const simple = mechanical || greeting || (lookup && !proof && !deliberation && !ambiguity && !verification && !attachmentAnalysis && !questionSet);
  const hard = !mechanical && !greeting && (proof || questionSet || (stakes && (deliberation || ambiguity || verification || attachmentAnalysis)) || (deliberation && (ambiguity || verification)));
  return { message, mechanical, simple, hard, research, questionSet, complex: !simple && (proof || questionSet || deliberation || ambiguity || attachmentAnalysis),
    reason: questionSet ? 'Complete multi-question coverage is required' : proof ? 'Formal proof or multi-step logic' : stakes && hard ? 'High stakes with uncertainty or verification' : hard ? 'Competing approaches need careful verification' : simple ? 'Straightforward request; no specialist fan-out needed' : 'Bounded everyday reasoning' };
}

export function resolveEffort(choice: EffortChoice | undefined, message: string, attachmentCount = 0) {
  const assessment = assessTask(message, attachmentCount);
  const requested = choice ?? 'auto';
  // Auto starts at Medium and escalates conservatively. Manual choices always win.
  const effective: ReasoningEffort = requested === 'auto' ? assessment.hard ? 'high' : 'medium' : requested;
  return { requested, effective, automatic: requested === 'auto', assessment,
    reason: requested === 'auto' ? assessment.reason : `Manually selected ${effective} effort`,
    searchMode: effective === 'high' ? 'advanced' as const : 'standard' as const };
}

export function effortBudget(effort: ReasoningEffort, simple: boolean) {
  // A high setting retains its reasoning depth; trivial asks don't need extra agents or rounds.
  return {
    maxSpecialists: effort === 'low' || simple ? 1 : effort === 'medium' ? 2 : 3,
    workerMs: effort === 'high' ? 30_000 : 18_000,
    responseMs: simple ? 22_000 : effort === 'high' ? 65_000 : effort === 'medium' ? 40_000 : 28_000,
    maxIterations: simple ? 3 : effort === 'high' ? 10 : effort === 'medium' ? 6 : 4,
    maxOutputTokens: effort === 'high' ? 8000 : effort === 'medium' ? 4000 : 1800,
  };
}
