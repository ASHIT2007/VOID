import { assessTask, effortBudget } from './effort-policy.js';
export type AgentRole =
  | 'general'
  | 'researcher'
  | 'analyst'
  | 'fact_checker'
  | 'content_strategist'
  | 'visual_researcher'
  | 'artifact_architect';

export interface PlannedAgent {
  id: string;
  role: AgentRole;
  label: string;
  instruction: string;
}

export interface AgentExecutionPlan {
  intent: 'simple' | 'reasoning' | 'research' | 'artifact';
  artifactKind?: 'visual' | 'report' | 'web' | 'other';
  agents: PlannedAgent[];
}

export interface TaskPlanningInput {
  message: string;
  mode: 'normal' | 'deep_research';
  reasoningEffort: 'low' | 'medium' | 'high';
  attachmentCount?: number;
  maxAgents?: number;
}

const ROLE_COPY: Record<AgentRole, Omit<PlannedAgent, 'id' | 'role'>> = {
  general: {
    label: 'General assistant',
    instruction: 'Solve the request directly and accurately. Return concise notes for the final responder.',
  },
  researcher: {
    label: 'Researcher',
    instruction: 'Research the request from authoritative sources. Search the web when facts are current or externally verifiable. Return findings with source URLs.',
  },
  analyst: {
    label: 'Analyst',
    instruction: 'Break down the problem, evaluate tradeoffs, and produce a rigorous solution outline. Flag assumptions and uncertainty.',
  },
  fact_checker: {
    label: 'Fact checker',
    instruction: 'Independently verify the consequential claims, numbers, dates, and assumptions. Return corrections and source URLs.',
  },
  content_strategist: {
    label: 'Narrative architect',
    instruction: 'Design the clearest narrative and information hierarchy. For a presentation, specify the slide sequence, one idea per slide, and the evidence each slide needs.',
  },
  visual_researcher: {
    label: 'Visual researcher',
    instruction: 'Find relevant real images and visual evidence using image search. Return direct image URLs, source-page URLs, captions, and suggested slide placement. Do not invent image links.',
  },
  artifact_architect: {
    label: 'Artifact architect',
    instruction: 'Define a valid, usable artifact structure. For presentations, plan layouts, charts, citations, image placement, and export-safe content. For websites and web apps, produce a complete responsive standalone HTML document with polished styling and working interactions. Do not invent facts.',
  },
};

function makeAgent(role: AgentRole, index: number): PlannedAgent {
  return { id: `agent-${index + 1}`, role, ...ROLE_COPY[role] };
}

export function isArtifactCreationRequest(message: string): boolean {
  const artifactNoun = /\b(?:presentations?|powerpoints?|pptx?|slide decks?|slides|posters?|infographics?|visual roadmaps?|study sheets?|flyers?|artifacts?|reports?|documents?|white papers?|briefing documents?|spreadsheets?|workbooks?)\b/i;
  if (isWebArtifactCreationRequest(message)) return true;
  if (!artifactNoun.test(message)) return false;
  const creationVerb = /\b(?:create|make|generate|build|design|prepare|draft|produce|compose|turn .+ into|convert .+ (?:to|into)|export)\b/i;
  const artifactFirst = /^\s*(?:a|an)?\s*(?:presentations?|powerpoints?|pptx?|slide decks?|posters?|infographics?|visual roadmaps?|study sheets?|flyers?|reports?|documents?|white papers?|briefing documents?|spreadsheets?|workbooks?)\s+(?:about|on|for)\b/i;
  return creationVerb.test(message) || artifactFirst.test(message);
}

export function isWebArtifactCreationRequest(message: string): boolean {
  const webNoun = /\b(?:websites?|web\s*pages?|landing\s*pages?|web\s*apps?|dashboards?|calculators?|simulators?|simulations?|games?|portfolio\s+(?:site|website|page)|saas\s+(?:site|app|dashboard)|frontend\s+(?:page|app|website))\b/i;
  const creationIntent = /\b(?:create|make|generate|build|design|code|develop|produce|implement|give me|show me)\b/i;
  return creationIntent.test(message) && webNoun.test(message)
    || /\b(?:html|css)\b[\s\S]{0,80}\b(?:javascript|js)\b[\s\S]{0,80}\bpreview\b/i.test(message)
    || /\bpreview\b[\s\S]{0,80}\b(?:html|web\s*app|website)\b/i.test(message);
}

export function isReportCreationRequest(message: string): boolean {
  const reportNoun = /\b(?:report|research report|executive report|document|white paper|briefing document)\b/i;
  const creationVerb = /\b(?:create|make|generate|write|build|design|prepare|draft|produce|compose|turn .+ into|convert .+ (?:to|into)|export)\b/i;
  const reportFirst = /^\s*(?:a|an)?\s*(?:report|research report|executive report|document|white paper|briefing document)\s+(?:about|on|for)\b/i;
  return reportNoun.test(message) && (creationVerb.test(message) || reportFirst.test(message));
}

export function isVisualArtifactCreationRequest(message: string): boolean {
  return isArtifactCreationRequest(message)
    && /\b(?:presentations?|powerpoints?|pptx?|slide decks?|slides|posters?|infographics?|visual roadmaps?|study sheets?|flyers?)\b/i.test(message);
}

export function createExecutionPlan(input: TaskPlanningInput): AgentExecutionPlan {
  // The Next.js bridge appends capability instructions (web search, citations,
  // and so on) to the message. Planning must classify the user's actual task,
  // not those implementation instructions; otherwise even "hi" matches the
  // research keywords in the appended directive.
  const message = input.message
    .replace(/\s*\[SYSTEM DIRECTIVE:[\s\S]*?\]\s*/gi, ' ')
    .trim();
  const assessment = assessTask(message, input.attachmentCount);
  const cap = Math.max(1, Math.min(input.maxAgents ?? 4, effortBudget(input.reasoningEffort, assessment.simple).maxSpecialists));
  const artifact = !assessment.mechanical && isArtifactCreationRequest(message);
  const artifactKind: AgentExecutionPlan['artifactKind'] = artifact
    ? isReportCreationRequest(message) ? 'report' : isVisualArtifactCreationRequest(message) ? 'visual' : isWebArtifactCreationRequest(message) ? 'web' : 'other'
    : undefined;
  const research = !assessment.simple && (input.mode === 'deep_research' || assessment.research);
  const realImages = /\b(real|actual|authentic|source[ds]?)\b.{0,30}\b(images?|photos?|pictures?)\b/i.test(message)
    || /\b(images?|photos?|pictures?)\b.{0,30}\b(real|actual|authentic|source[ds]?)\b/i.test(message);
  const complex = assessment.complex;
  let intent: AgentExecutionPlan['intent'] = 'simple';
  let roles: AgentRole[] = ['general'];

  if (artifact) {
    intent = 'artifact';
    if (artifactKind === 'web') {
      // One artifact specialist avoids research/synthesis latency for a
      // self-contained preview while retaining the full output budget.
      roles = ['artifact_architect'];
    } else {
      roles = ['researcher', 'content_strategist', realImages ? 'visual_researcher' : 'artifact_architect'];
      if (input.reasoningEffort === 'high' || research) roles.push('fact_checker');
    }
  } else if (research) {
    intent = 'research';
    roles = ['researcher', 'analyst', 'fact_checker'];
  } else if (complex) {
    intent = 'reasoning';
    roles = input.reasoningEffort === 'high'
      ? ['analyst', 'fact_checker', 'general']
      : ['analyst', 'general'];
  } else if (!assessment.simple && input.reasoningEffort !== 'low') {
    intent = 'reasoning';
    roles = input.reasoningEffort === 'high' ? ['analyst', 'fact_checker', 'general'] : ['analyst', 'general'];
  }
  // Low never fans out, including research, attachments, and legacy team switches.
  if (cap === 1) roles = ['general'];

  return {
    intent,
    artifactKind,
    agents: roles.slice(0, cap).map(makeAgent),
  };
}
