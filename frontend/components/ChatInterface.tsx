"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import DynamicLoader, { ProgressMark } from "./DynamicLoader";
import { analysisMayBenefitFromChart } from "@/lib/analysis-visuals";
import { motion, AnimatePresence } from "framer-motion";
import StudioPreferenceModal from "./StudioPreferenceModal";
import { PresentationData } from "@/types/presentation";
import { ReportData } from "@/types/report";
import { type EffortInfo } from "./EffortNotice";
import {
  asPoster, assignPresentationMedia, isInfographicCreationRequest, isNaturalImageGeneration, isPosterCreationRequest,
  hasRenderablePosterContent,
  isRasterPosterCreationRequest, prepareRasterPosterPrompt, resolveInfographicFollowUp,
  isPresentationCreationRequest, isStudioCreationRequest, isUsableChatImageUrl,
  isUsefulImageSize, mergeChatMediaImages, normalizeChatEffort, prepareStudioMessages,
  visibleProgressLogs, visibleThinkingText, extractAndStripWebImages,
  extractThinkAndDisplayContent, extractMarkdownReasoning,
  useSmoothTypewriter, completePartialMarkdown, normalizeAnswerMarkdownSpacing,
  referencesEarlierAttachment,
} from "./ChatInterface.helpers";
import ThinkingEnergy from "./ThinkingEnergy";
import { responsePhaseForEvent, type ResponsePhase } from "@/lib/response-stream";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import {
  oneLight,
  vscDarkPlus,
} from "react-syntax-highlighter/dist/cjs/styles/prism";
import {
  Send,
  User,
  Bot,
  Ghost,
  Code,
  PenTool,
  Lightbulb,
  PanelLeft,
  Plus,
  X,
  ImageIcon,
  Film,
  Copy,
  Download,
  ThumbsUp,
  ThumbsDown,
  RefreshCcw,
  ChevronDown,
  Check,
  ChevronRight,
  ChevronLeft,
  Pencil,
  FileText,
  FileSpreadsheet,
  Globe,
  ExternalLink,
  CheckCircle2,
  Sparkles,
  BrainCircuit,
  Cpu,
  Square,
  Upload,
  Zap,
  Maximize2,
  Eye,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { normalizePresentation } from "@/lib/design/visual-design-engine";
import { fetchWithRetry } from "@/lib/reliability";
import { placeCitationsAtParagraphEnds, stripTrailingSourcesSection } from "@/lib/citations";
import { imageModelForRequest, POSTER_CLOUDFLARE_MODEL, POSTER_FLUX_MODEL, POSTER_IMAGE_MODEL } from "@/lib/image-model-routing";
import { ImageGenerationError } from "@/lib/image-provider-errors";
import { buildAiPosterPrompt } from "@/lib/poster-generation";
import { isWebArtifactCreationRequest } from "@/lib/web-generation";
import { createCompletionChime, type CompletionChimeController } from "@/lib/completion-chime";

import { useTheme } from "./ThemeProvider";
import FilePreviewModal from "./FilePreviewModal";
import VoiceAgent from "./VoiceAgent";
import ArtifactCanvas, { Artifact } from "./ArtifactCanvas";
import MindMapViewer, { parseMindMapData } from "./MindMapViewer";
import ChartViewer, { parseChartData } from "./ChartViewer";
import GraphViewer, { parseGraphData } from "./GraphViewer";
import CodeBlockWithPreview from "./CodeBlockWithPreview";
import WritingBlock, { inferWritingType } from "./WritingBlock";

type WebSearchResult = { title: string; url: string; content?: string };
type WebSearchData = { query: string; results: WebSearchResult[]; images?: string[] };
type WebMediaImage = {
  url: string;
  title?: string;
  sourceUrl?: string;
  sourceDomain?: string;
  attribution?: string;
  alt?: string;
  query?: string;
  confidence?: number;
  verified?: boolean;
  width?: number;
  height?: number;
  generated?: boolean;
  modelUsed?: string;
  slideId?: string;
  slideNumber?: number;
};
type MediaPayload = { query: string; placement: "lead" | "inline"; images: WebMediaImage[] };
type ReasoningEffort = "low" | "medium" | "high";

function mergeSourceUrls(previous: string[] = [], incoming: unknown): string[] {
  const next = Array.isArray(incoming) ? incoming.filter((value): value is string => typeof value === "string") : [];
  return [...new Set([...previous, ...next].map((value) => value.trim()).filter(Boolean))].slice(0, 24);
}

function mergeWebSearchData(previous: WebSearchData | undefined, incoming: any): WebSearchData | undefined {
  if (!incoming || typeof incoming !== "object") return previous;
  const results = [...(previous?.results || []), ...(Array.isArray(incoming.results) ? incoming.results : [])]
    .filter((result): result is WebSearchResult => Boolean(result && typeof result.url === "string"));
  const uniqueResults = [...new Map(results.map((result) => [result.url, result])).values()].slice(0, 24);
  const images = [...new Set([
    ...(previous?.images || []),
    ...(Array.isArray(incoming.images) ? incoming.images.filter((value: unknown): value is string => typeof value === "string") : []),
  ])].slice(0, 12);
  return {
    query: previous?.query || (typeof incoming.query === "string" ? incoming.query : "Web research"),
    results: uniqueResults,
    ...(images.length ? { images } : {}),
  };
}

function sourceUrlsFromWebSearch(incoming: unknown): string[] {
  if (!incoming || typeof incoming !== "object") return [];
  const results = Array.isArray((incoming as { results?: unknown }).results)
    ? (incoming as { results: unknown[] }).results
    : [];
  return results
    .map((result) => result && typeof result === "object" ? (result as { url?: unknown }).url : undefined)
    .filter((url): url is string => typeof url === "string" && /^https?:\/\//i.test(url));
}

function mergeMediaPayload(previous: MediaPayload | undefined, incoming: any): MediaPayload | undefined {
  if (!incoming || typeof incoming !== "object") return previous;
  const images = mergeChatMediaImages(previous?.images || [], Array.isArray(incoming.images) ? incoming.images : []);
  if (!images.length) return previous;
  return {
    query: previous?.query || (typeof incoming.query === "string" ? incoming.query : "Web images"),
    placement: previous?.placement === "lead" || incoming.placement === "lead" ? "lead" : "inline",
    images,
  };
}

type AgentResultEvent = {
  confidence?: number;
  label?: string;
  summary?: string;
};

function agentResultLog(data: AgentResultEvent): { action: string; query: string } {
  return { action: "Research findings ready", query: visibleThinkingText(data.summary || null) || "" };
}

async function authenticatedJsonHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return {
    "Content-Type": "application/json",
    ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
  };
}

async function readJsonResponse<T extends Record<string, unknown>>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") || "";
  const body = await response.text();

  if (!contentType.toLowerCase().includes("application/json")) {
    const endpoint = new URL(response.url, window.location.href).pathname;
    throw new Error(
      `The server returned ${response.status} ${response.statusText || ""} for ${endpoint} instead of JSON. ` +
      "Restart the Next.js development server if this API route was recently added or changed.",
    );
  }

  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(`The server returned invalid JSON (${response.status})`);
  }
}

async function readTextSseResponse(response: Response): Promise<string> {
  if (!response.ok) throw new Error(`Server returned ${response.status}`);
  if (!response.body) throw new Error("No response body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";

  const processLine = (line: string) => {
    if (!line.startsWith("data: ") || line.trim() === "data: [DONE]") return;
    try {
      const event = JSON.parse(line.slice(6)) as { type?: string; content?: string; fullText?: string; message?: string };
      if (event.type === "reset") text = "";
      else if (event.type === "text" && event.content) text += event.content;
      else if (event.type === "done" && !text.trim() && event.fullText) text = event.fullText;
      else if (event.type === "error") throw new Error(event.message || "Text generation failed");
    } catch (error) {
      if (error instanceof SyntaxError) return;
      throw error;
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    lines.forEach(processLine);
    if (done) break;
  }
  if (buffer.trim()) processLine(buffer.trim());
  return text.trim();
}

type Message = {
  role: "user" | "assistant" | "system";
  content: string;
  thoughtTime?: number;
  modelName?: string;
  sources?: string[];
  isStreaming?: boolean;
  responsePhase?: ResponsePhase;
  effortInfo?: EffortInfo;
  effortRecovery?: string;
  webSearch?: WebSearchData;
  media?: MediaPayload;
  attachments?: { name: string; type: string; base64?: string; url?: string }[];
  statusLogs?: any[];
  searchIntent?: { webSearchIntent: string; webImageIntent: string };
  isImageGenerating?: boolean;
  id?: string;
  versions?: string[];
  activeVersionIndex?: number;
};

function getMessageAttachments(message: Pick<Message, "content" | "attachments">): NonNullable<Message["attachments"]> {
  if (message.attachments?.length) return message.attachments;
  const marker = message.content?.match(/\[ATTACHMENTS_JSON:\s*(\[[\s\S]*?\])\s*\]/);
  if (!marker) return [];
  try {
    const parsed = JSON.parse(marker[1]);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function latestConversationImage(messages: Message[]): { url: string; sourcePrompt?: string } | undefined {
  const sourcePromptBefore = (messageIndex: number) => {
    for (let promptIndex = messageIndex - 1; promptIndex >= 0; promptIndex -= 1) {
      if (messages[promptIndex].role === "user" && messages[promptIndex].content.trim()) {
        return messages[promptIndex].content.trim().slice(0, 600);
      }
    }
    return undefined;
  };

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const attachments = getMessageAttachments(message);
    for (let attachmentIndex = attachments.length - 1; attachmentIndex >= 0; attachmentIndex -= 1) {
      const attachment = attachments[attachmentIndex];
      if (!attachment.type?.startsWith("image/")) continue;
      if (attachment.base64) return { url: `data:${attachment.type};base64,${attachment.base64}`, sourcePrompt: sourcePromptBefore(index) };
      if (attachment.url) return { url: attachment.url, sourcePrompt: sourcePromptBefore(index) };
    }

    const imageMatches = [...message.content.matchAll(/!\[[^\]]*\]\(((?:data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+)|(?:https:\/\/[^\s)]+)|(?:\/api\/generated-image\/[a-f0-9-]+\.(?:png|jpg|webp)))\)/gi)];
    const latestMatch = imageMatches[imageMatches.length - 1]?.[1];
    if (latestMatch) return { url: latestMatch, sourcePrompt: sourcePromptBefore(index) };
  }
  return undefined;
}

function compactMessagesForTransport(messages: Message[]): Message[] {
  return messages.map((message) => {
    const content = message.content
      .replace(/!\[([^\]]*)\]\(data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+\)/gi, (_match, alt: string) => `[Earlier generated image: ${alt || "image"}]`)
      .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, "[embedded image omitted from text context]");
    const attachments = message.attachments?.map((attachment) => (
      attachment.base64
        ? { name: attachment.name, type: attachment.type, url: attachment.url }
        : attachment
    ));
    return { ...message, content, attachments };
  });
}

function compactAttachmentsForHistory(
  attachments: NonNullable<Message["attachments"]>,
): NonNullable<Message["attachments"]> {
  return attachments.map(({ name, type, url, base64 }) => ({ name, type, url, ...(!url && base64 ? { base64 } : {}) }));
}

function referencesPreviousImage(prompt: string): boolean {
  return /\b(?:edit|modify|change|restyle|rework|variation|variant|another version|similar version|use (?:it|this|that)|make (?:it|this|that|the|its)|turn (?:it|this|that|the)|same (?:image|picture|photo|illustration)|add|remove|replace|recolor|colour|color|crop|resize|rotate|flip|erase|extend|upscale|background|foreground|transparent|transparency|cut[ -]?out)\b/i.test(prompt)
    || /^\s*(?:now\s+|next\s+|please\s+)?(?:make|change|turn|add|remove|replace|recolor|crop|resize|rotate|flip|erase|extend|upscale)\b/i.test(prompt);
}

interface ChatInterfaceProps {
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  conversationId: string | null;
  setConversationId: React.Dispatch<React.SetStateAction<string | null>>;
  isIncognito: boolean;
  setIsIncognito: React.Dispatch<React.SetStateAction<boolean>>;
  toggleSidebar: () => void;
  isSidebarCollapsed: boolean;
  onConversationCreated?: () => void;
  userName?: string;
  onOpenSettings?: (tab?: "general" | "models" | "display" | "account") => void;
  sessionUsage: any;
  setSessionUsage: React.Dispatch<React.SetStateAction<any>>;
}

export { extractThinkAndDisplayContent, extractMarkdownReasoning };

const ThinkingBlock = React.memo(function ThinkingBlock({
  content,
  thoughtTime,
  isStreaming,
}: {
  content?: string | null;
  thoughtTime?: number;
  isStreaming?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const hasContent = !!content && content.trim().length > 0;
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full mb-4"
    >
      <button
        onClick={() => hasContent && setIsOpen(!isOpen)}
        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#18181B] ${hasContent ? 'hover:bg-[#222226] cursor-pointer' : 'cursor-default'} transition-all border border-[#27272A] ${hasContent ? 'hover:border-gray-500/40' : ''} shadow-sm w-fit group`}
      >
        {hasContent && (
          <motion.div
            animate={{ rotate: isOpen ? 90 : 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
          >
            <ChevronRight size={14} className="text-gray-400 group-hover:text-gray-200" />
          </motion.div>
        )}
        <BrainCircuit size={14} className={`text-gray-400 ${hasContent ? 'group-hover:text-gray-200' : ''} ${isStreaming ? 'animate-pulse text-amber-400/80' : ''}`} />
        <span className={`text-xs font-mono text-gray-400 ${hasContent ? 'group-hover:text-gray-200' : ''}`}>
          {isStreaming ? 'Thinking...' : `Thought${thoughtTime ? ` for ${thoughtTime}s` : ' process'}`}
        </span>
      </button>
      <AnimatePresence>
        {isOpen && hasContent && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="overflow-hidden"
          >
            <div className="mt-3 pl-4 border-l-2 border-gray-200 dark:border-[#333] text-sm text-gray-600 dark:text-gray-400 leading-relaxed whitespace-pre-wrap max-h-[400px] overflow-y-auto scrollbar-thin">
              {content}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
});

const LinkRefPill = React.memo(function LinkRefPill({ href, children }: { href: string; children: React.ReactNode }) {
  const [isHovered, setIsHovered] = useState(false);
  const [imgError, setImgError] = useState(false);
  const domain = React.useMemo(() => {
    try {
      return new URL(href).hostname.replace("www.", "");
    } catch {
      return href;
    }
  }, [href]);

  return (
    <span 
      className="relative inline-flex items-center mx-1 align-middle"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#18181B] hover:bg-[#222226] border border-[#27272A] hover:border-gray-500/50 rounded-lg text-xs font-medium text-gray-200 transition-colors no-underline group shadow-sm"
      >
        {!imgError ? (
          <img
            src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
            className="w-3.5 h-3.5 object-contain shrink-0 rounded-sm"
            alt={domain}
            onError={() => setImgError(true)}
          />
        ) : (
          <Globe size={13} className="text-gray-400 shrink-0" />
        )}
        <span>{domain}</span>
      </a>
      
      <AnimatePresence>
        {isHovered && (
          <motion.span
            initial={{ opacity: 0, y: 3, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 3, scale: 0.96 }}
            transition={{ duration: 0.12 }}
            className="absolute top-full left-0 mt-1.5 w-72 p-3 bg-[#121214] border border-[#27272A] rounded-xl shadow-2xl z-[9999] flex flex-col text-left pointer-events-none"
          >
            <span className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-white line-clamp-2 leading-relaxed">
                {children}
              </span>
              <span className="flex items-center gap-2 pt-1 border-t border-[#27272A]">
                {!imgError ? (
                  <img
                    src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
                    className="w-3.5 h-3.5 object-contain shrink-0"
                    alt=""
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = "none";
                    }}
                  />
                ) : (
                  <Globe size={13} className="text-gray-400 shrink-0" />
                )}
                <span className="text-[11px] text-gray-400 font-mono truncate">
                  {href}
                </span>
              </span>
            </span>
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
});

const ExpandableSearchRow = React.memo(function ExpandableSearchRow({
  log,
  data,
  isLast,
  modelName,
  thinkContent,
}: {
  log: any;
  data: WebSearchData | undefined;
  isLast: boolean;
  modelName?: string;
  thinkContent?: string | null;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isWebSearch = log.action === "Searching web";
  const isIntent = log.action === "Analyzing intent";
  const isGenerating = log.action === "Generating response";
  
  const hasResults = (isWebSearch && data && data.results && data.results.length > 0) || isIntent || isGenerating;
  
  let displayTitle = log.action;
  if (isWebSearch) displayTitle = log.query || log.action;
  if (isIntent) displayTitle = "Analyzed intent";
  if (isGenerating) displayTitle = `Generated response using ${modelName || 'Model'}`;

  return (
    <div className="flex flex-col relative z-10 mb-8 group">
      {!isLast && (
        <div className="absolute left-[9px] top-[24px] bottom-[-40px] w-[2px] border-l-2 border-dashed border-gray-300 dark:border-white/30 z-0" />
      )}
      <button 
        onClick={() => hasResults && setIsExpanded(!isExpanded)}
        className={`flex flex-col text-left transition-colors relative ${hasResults ? 'cursor-pointer' : 'cursor-default'}`}
      >
        <div className="flex items-center gap-4 relative">
          <div className="flex items-center justify-center w-5 h-5 bg-white dark:bg-[#0f0f0f] shrink-0 relative z-10">
            {isIntent && <BrainCircuit size={16} className="text-gray-900 dark:text-white" />}
            {isWebSearch && <Globe size={16} className="text-gray-900 dark:text-white" />}
            {isGenerating && <Sparkles size={16} className="text-gray-900 dark:text-white" />}
          </div>
          <span className="text-[15px] text-gray-900 dark:text-white font-medium">
            {displayTitle}
          </span>
        </div>
        
        {hasResults && (
          <div className="flex items-center mt-1">
             <div className="w-5 flex justify-center z-10 bg-white dark:bg-[#0f0f0f] py-1">
               <motion.div animate={{ rotate: isExpanded ? 180 : 0 }}>
                 <ChevronDown size={14} className="text-gray-500 dark:text-gray-400" />
               </motion.div>
             </div>
          </div>
        )}
      </button>

      <AnimatePresence>
        {isExpanded && hasResults && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden ml-8 mt-4"
          >
            {isWebSearch && data && (
              <div className="flex flex-col gap-5 bg-white dark:bg-[#0f0f0f] relative z-10">
                {data.results.map((r: any, i: number) => (
                  <a
                    key={i}
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex flex-col gap-1 group/link"
                  >
                    {(() => {
                      let domain = r.url;
                      try { domain = new URL(r.url).hostname.replace("www.", ""); } catch(e) {}
                      return (
                        <span className="flex items-center gap-2 text-[14px] font-semibold text-gray-900 dark:text-white group-hover/link:underline line-clamp-1">
                          <img
                            src={`https://www.google.com/s2/favicons?domain=${domain}&sz=16`}
                            className="w-4 h-4 rounded-sm shrink-0"
                            alt=""
                          />
                          {r.title}
                        </span>
                      );
                    })()}
                    <span className="text-[13px] text-gray-500 dark:text-gray-400 line-clamp-2 leading-relaxed">
                      {r.content}
                    </span>
                  </a>
                ))}
              </div>
            )}
            {isIntent && (
              <div className="flex flex-col gap-1 relative z-10 pt-2 mb-2">
                <span className="text-[13px] font-medium text-gray-900 dark:text-white">
                  Intent Analysis Result
                </span>
                <span className="text-[12px] text-gray-600 dark:text-gray-400 leading-relaxed flex items-start gap-2">
                  <span className="text-gray-400 mt-0.5">•</span>
                  <span>{data && data.results ? "Live internet access was determined to be REQUIRED for this prompt to ensure up-to-date facts and accuracy." : "Live internet access was determined to be NOT REQUIRED for this prompt."}</span>
                </span>
              </div>
            )}
            {isGenerating && (
              <div className="flex flex-col gap-4 bg-transparent relative z-10 pt-2">
                {thinkContent && (
                  <div className="flex flex-col gap-1">
                    <span className="text-[13px] font-bold text-gray-900 dark:text-white">
                      Agent Planning & Execution
                    </span>
                    <div className="text-[12px] text-gray-600 dark:text-gray-400 leading-relaxed max-h-60 overflow-y-auto prose prose-sm dark:prose-invert prose-p:my-1 prose-li:my-0 marker:text-gray-400">
                      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{preprocessLaTeX(thinkContent)}</ReactMarkdown>
                    </div>
                  </div>
                )}
                {data && data.results && data.results.length > 0 && (
                  <div className="flex flex-col gap-2 mt-2">
                    <span className="text-[13px] font-bold text-gray-900 dark:text-white">
                      Web Search Context Injected
                    </span>
                    <ul className="text-[12px] text-gray-600 dark:text-gray-400 leading-relaxed max-h-40 overflow-y-auto list-disc pl-4 flex flex-col gap-2">
                      {data.results.map((r: any, idx: number) => (
                        <li key={idx}><strong className="text-gray-700 dark:text-gray-300">{r.title}</strong>: {r.content}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {!thinkContent && (!data || !data.results || data.results.length === 0) && (
                  <div className="flex flex-col gap-1 mt-2">
                    <span className="text-[12px] text-gray-600 dark:text-gray-400 italic flex items-start gap-2">
                      <span className="text-gray-400 mt-0.5">•</span>
                      <span>Standard generation without external web context or explicit planning logs.</span>
                    </span>
                  </div>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});


function sanitizeSourceSnippet(raw?: string): string {
  if (!raw || typeof raw !== "string") return "";
  let text = raw
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/!\[\[object\s+Object\][^\]]*\]/gi, "")
    .replace(/\|?\s*:?-+:?\s*\|/g, " ")
    .replace(/\|/g, " ")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return text;
}const SourcesModal = React.memo(function SourcesModal({
  msg,
  onClose,
}: {
  msg: Message;
  onClose: () => void;
}) {
  if (!msg) return null;
  const { thinkContent } = extractThinkAndDisplayContent(msg.content || "");
  const webResults = msg.webSearch?.results || [];

  const [expandedSection, setExpandedSection] = useState<'sources' | 'think' | 'intent' | null>('sources');

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.94, y: 12 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg bg-[#121214] border border-[#27272A] rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] p-6 relative text-white"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[#27272A] mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-white/10 flex items-center justify-center shrink-0 border border-white/10">
              <Globe size={16} className="text-white shrink-0 block animate-pulse" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white tracking-tight">
                Execution Trace & Sources
              </h2>
              <p className="text-xs text-gray-400 font-mono">
                {webResults.length} web sources • Model: {msg.modelName || "Llama 3.3 70B"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/15 flex items-center justify-center shrink-0 text-gray-400 hover:text-white transition-colors"
          >
            <X size={16} className="shrink-0 block" />
          </button>
        </div>

        {/* Timeline Body */}
        <div className="flex-1 overflow-y-auto pr-2 space-y-6 my-2 custom-scrollbar">
          
          {/* Step 1: Analyzed intent */}
          <div className="flex items-start gap-3.5 relative group">
            <div className="flex flex-col items-center shrink-0">
              <div className="w-7 h-7 rounded-full bg-[#18181B] border border-white/30 flex items-center justify-center shrink-0 text-white shadow-sm mt-0.5">
                <BrainCircuit size={14} className="shrink-0 block text-white" />
              </div>
              <div className="w-[1px] flex-1 bg-[#27272A] min-h-[30px] my-1.5" />
            </div>

            <div className="flex-1 min-w-0">
              <button
                onClick={() => setExpandedSection(expandedSection === 'intent' ? null : 'intent')}
                className="w-full flex items-center justify-between text-left group"
              >
                <div>
                  <h3 className="text-sm font-semibold text-white group-hover:text-gray-200">
                    Analyzed intent
                  </h3>
                  <p className="text-xs text-gray-400 font-mono mt-0.5">
                    Web Search: {msg.searchIntent?.webSearchIntent || (webResults.length > 0 ? "Required" : "Not Required")} • Web Images: {msg.searchIntent?.webImageIntent || (webResults.length > 0 ? "Required" : "Not Required")}
                  </p>
                </div>
                <ChevronDown
                  size={14}
                  className={`text-gray-400 shrink-0 block transition-transform ${expandedSection === 'intent' ? 'rotate-180' : ''}`}
                />
              </button>

              <AnimatePresence>
                {expandedSection === 'intent' && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden mt-2.5 p-3 bg-[#18181B] border border-[#27272A] rounded-xl text-xs text-gray-300 space-y-1.5"
                  >
                    <p><strong className="text-white">Web Search Intent:</strong> <span className={msg.searchIntent?.webSearchIntent === "Required" || webResults.length > 0 ? "text-emerald-400 font-semibold" : "text-gray-400"}>{msg.searchIntent?.webSearchIntent || (webResults.length > 0 ? "Required" : "Not Required")}</span></p>
                    <p><strong className="text-white">Web Image Intent:</strong> <span className={msg.searchIntent?.webImageIntent === "Required" || webResults.length > 0 ? "text-emerald-400 font-semibold" : "text-gray-400"}>{msg.searchIntent?.webImageIntent || (webResults.length > 0 ? "Required" : "Not Required")}</span></p>
                    <p><strong className="text-white">Status:</strong> {webResults.length > 0 ? "Intent analysis triggered web search pipeline & image extraction." : "Answered using internal knowledge base."}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Step 2: Searching web (Collapsible Dropdown of All Sources) */}
          {webResults.length > 0 && (
            <div className="flex items-start gap-3.5 relative group">
              <div className="flex flex-col items-center shrink-0">
                <div className="w-7 h-7 rounded-full bg-[#18181B] border border-white/30 flex items-center justify-center shrink-0 text-white shadow-sm mt-0.5">
                  <Globe size={14} className="shrink-0 block text-white" />
                </div>
                <div className="w-[1px] flex-1 bg-[#27272A] min-h-[30px] my-1.5" />
              </div>

              <div className="flex-1 min-w-0">
                <button
                  onClick={() => setExpandedSection(expandedSection === 'sources' ? null : 'sources')}
                  className="w-full flex items-center justify-between text-left group"
                >
                  <div>
                    <h3 className="text-sm font-semibold text-white group-hover:text-gray-200">
                      Searching web ({webResults.length} sources)
                    </h3>
                    <p className="text-xs text-gray-400 font-mono mt-0.5 truncate">
                      Crawled verified web pages & articles
                    </p>
                  </div>
                  <ChevronDown
                    size={14}
                    className={`text-gray-400 shrink-0 block transition-transform ${expandedSection === 'sources' ? 'rotate-180' : ''}`}
                  />
                </button>

                <AnimatePresence>
                  {expandedSection === 'sources' && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden mt-2.5 space-y-2"
                    >
                      {webResults.map((res: any, idx: number) => {
                        let domain = "";
                        try {
                          domain = new URL(res.url).hostname.replace("www.", "");
                        } catch {
                          domain = res.url;
                        }
                        const snippet = sanitizeSourceSnippet(res.content);

                        return (
                          <a
                            key={idx}
                            href={res.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="group/card block p-3 bg-[#18181B] hover:bg-[#202024] border border-[#27272A] hover:border-gray-500/50 rounded-xl transition-all shadow-sm"
                          >
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <div className="flex items-center gap-2 min-w-0">
                                <div className="w-5 h-5 rounded bg-[#252528] flex items-center justify-center shrink-0 border border-[#333] overflow-hidden">
                                  <img
                                    src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
                                    alt={domain}
                                    className="w-3 h-3 object-contain shrink-0 block"
                                    onError={(e) => {
                                      (e.target as HTMLElement).style.display = "none";
                                    }}
                                  />
                                </div>
                                <span className="text-xs font-mono text-gray-300 group-hover/card:text-white truncate">
                                  {domain}
                                </span>
                              </div>
                              <ExternalLink
                                size={12}
                                className="text-gray-500 shrink-0 block group-hover/card:text-white transition-transform"
                              />
                            </div>

                            <h4 className="text-xs font-medium text-white group-hover/card:text-gray-100 truncate mb-0.5">
                              {res.title || domain}
                            </h4>

                            {snippet && (
                              <p className="text-[11px] text-gray-400 group-hover/card:text-gray-300 line-clamp-2 leading-snug">
                                {snippet}
                              </p>
                            )}
                          </a>
                        );
                      })}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          )}

          {/* Step 3: Generating response using model (Collapsible Dropdown of AI Reasoning & Thoughts) */}
          <div className="flex items-start gap-3.5 relative group">
            <div className="flex flex-col items-center shrink-0">
              <div className="w-7 h-7 rounded-full bg-[#18181B] border border-white/30 flex items-center justify-center shrink-0 text-white shadow-sm mt-0.5">
                <Sparkles size={14} className="shrink-0 block text-white" />
              </div>
            </div>

            <div className="flex-1 min-w-0">
              <button
                onClick={() => setExpandedSection(expandedSection === 'think' ? null : 'think')}
                className="w-full flex items-center justify-between text-left group"
              >
                <div>
                  <h3 className="text-sm font-semibold text-white group-hover:text-gray-200">
                    Generating response using {msg.modelName || "Llama 3.3 70B"}
                  </h3>
                  <p className="text-xs text-gray-400 font-mono mt-0.5">
                    {thinkContent ? "Synthesized research & step-by-step reasoning" : "Synthesized final answer"}
                  </p>
                </div>
                <ChevronDown
                  size={14}
                  className={`text-gray-400 transition-transform ${expandedSection === 'think' ? 'rotate-180' : ''}`}
                />
              </button>

              <AnimatePresence>
                {expandedSection === 'think' && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden mt-2.5 p-3 bg-[#18181B] border border-[#27272A] rounded-xl text-xs text-gray-300 space-y-2 max-h-60 overflow-y-auto custom-scrollbar"
                  >
                    {thinkContent ? (
                      <div className="prose prose-invert prose-xs leading-relaxed">
                        <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{preprocessLaTeX(thinkContent)}</ReactMarkdown>
                      </div>
                    ) : (
                      <div className="space-y-2.5 text-xs text-gray-300">
                        {webResults.length > 0 && (
                          <div className="flex items-start gap-2">
                            <span className="text-blue-400 font-bold">•</span>
                            <div>
                              <span className="font-semibold text-white">Source Integration:</span> Extracted key factual data from {webResults.length} web sources.
                            </div>
                          </div>
                        )}
                        <div className="flex items-start gap-2">
                          <span className="text-purple-400 font-bold">•</span>
                          <div>
                            <span className="font-semibold text-white">Fact Verification:</span> Cross-referenced data across trusted domain sources.
                          </div>
                        </div>
                        <div className="flex items-start gap-2">
                          <span className="text-emerald-400 font-bold">•</span>
                          <div>
                            <span className="font-semibold text-white">Model Synthesis:</span> Synthesized response using {msg.modelName || "Llama 3.3 70B"}.
                          </div>
                        </div>
                        {msg.content && (
                          <div className="mt-3 pt-2.5 border-t border-[#27272A] text-gray-400 text-[11px] leading-relaxed">
                            <span className="text-gray-300 font-semibold block mb-1">Response Summary:</span>
                            <p className="line-clamp-4 italic text-gray-300">
                              {extractThinkAndDisplayContent(msg.content).displayContent.slice(0, 300)}...
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

        </div>
      </motion.div>
    </div>
  );
});

function stripOrphanImageMarkdown(markdown: string, removeValidImages = false): string {
  if (!markdown || typeof markdown !== "string") return markdown;
  let clean = markdown
    .replace(/!\[[^\]]*\]\((?:\s*|undefined|null|\[object\s+Object\])\)/gi, "")
    .replace(/!\[\[object\s+Object\][^\]]*\]/gi, "")
    .replace(/(^|\n)[ \t]*![ \t]*(?=\n|$)/g, "$1");

  if (removeValidImages) {
    clean = clean.replace(/!\[[^\]]*\]\(https?:\/\/[^)\s]+\)/gi, "");
  }

  return clean
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const SafeFavicon = React.memo(function SafeFavicon({
  domain,
  size = 14,
  className = "",
}: {
  domain: string;
  size?: number;
  className?: string;
}) {
  const [error, setError] = React.useState(false);
  const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];

  if (error || !cleanDomain) {
    return <Globe size={size} className={`text-gray-400 shrink-0 ${className}`} />;
  }

  return (
    <img
      src={`https://icons.duckduckgo.com/ip3/${cleanDomain}.ico`}
      alt=""
      width={size}
      height={size}
      className={`shrink-0 object-contain rounded-sm ${className}`}
      onError={() => setError(true)}
    />
  );
});

const SourcesPill = React.memo(function SourcesPill({
  msg,
  onClick,
}: {
  msg: Message;
  onClick: () => void;
}) {
  const isCacheHit = msg.statusLogs?.some((log) =>
    log.action.includes("Served from VOID") || log.action.includes("Cloudflare KV")
  );

  if (isCacheHit) {
    return (
      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#18181B] border border-cyan-500/40 text-cyan-400 mb-4 shadow-sm w-fit text-xs font-medium select-none">
        <Zap size={14} className="text-cyan-400 fill-cyan-400/20 shrink-0" />
        <span>Served from VOID Instant Edge Cache</span>
      </div>
    );
  }

  const sourcesList: string[] = React.useMemo(() => {
    if (msg.sources && msg.sources.length > 0) return msg.sources;
    if (msg.webSearch?.results && msg.webSearch.results.length > 0) {
      return msg.webSearch.results.map((r: any) => {
        try {
          return new URL(r.url).hostname.replace("www.", "");
        } catch {
          return r.url;
        }
      });
    }
    return [];
  }, [msg.sources, msg.webSearch]);

  const hasSources = sourcesList.length > 0;

  if (!hasSources) return null;

  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#18181B] hover:bg-[#222226] cursor-pointer group transition-all border border-[#27272A] hover:border-gray-500/40 mb-4 shadow-sm w-fit`}
    >
      <div className="flex -space-x-2 mr-0.5">
        {sourcesList.slice(0, 3).map((domain, i) => (
          <div
            key={i}
            className="w-5 h-5 rounded-full bg-[#252528] border border-[#18181B] overflow-hidden flex items-center justify-center relative shadow-sm"
            style={{ zIndex: 3 - i }}
          >
            <SafeFavicon domain={domain} size={14} className="w-3.5 h-3.5" />
          </div>
        ))}
        {sourcesList.length > 3 && (
          <div className="w-5 h-5 rounded-full bg-[#27272A] border border-[#18181B] flex items-center justify-center relative z-0">
            <span className="text-[9px] font-bold text-gray-300">
              +{sourcesList.length - 3}
            </span>
          </div>
        )}
      </div>
      <span className="text-xs font-medium text-white group-hover:text-gray-200 transition-colors">
        {sourcesList.length} sources
      </span>
    </button>
  );
});

type SearchImagePreview = WebMediaImage & { originalUrl: string; displayUrl: string };

function SearchImageCard({
  image,
  index,
  query,
  heightClass,
  roundedClass = "rounded-xl sm:rounded-2xl",
  onPreview,
  loadedUrls,
  aspectRatios,
  onLoad,
  onError,
}: {
  image: SearchImagePreview;
  index: number;
  query?: string;
  heightClass: string;
  roundedClass?: string;
  onPreview?: (image: SearchImagePreview, index: number) => void;
  loadedUrls: Set<string>;
  aspectRatios: Record<string, number>;
  onLoad: (url: string, e: React.SyntheticEvent<HTMLImageElement>) => void;
  onError: (url: string) => void;
}) {
  const isLoaded = loadedUrls.has(image.originalUrl);
  const ratio = aspectRatios[image.originalUrl];
  const isPortrait = typeof ratio === "number" ? ratio < 0.85 : false;
  const [useDirectUrl, setUseDirectUrl] = React.useState(false);
  const resolvedSrc = useDirectUrl ? image.originalUrl : image.displayUrl;

  const handleDisplayError = () => {
    // The proxy protects privacy and normalizes headers, but a few publisher
    // CDNs reject server-side fetches while allowing an ordinary browser img.
    // Retry once with the verified original before removing the card.
    if (!useDirectUrl && image.displayUrl !== image.originalUrl) {
      setUseDirectUrl(true);
      return;
    }
    onError(image.originalUrl);
  };

  return (
    <motion.figure
      initial={{ opacity: 0, y: 14, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        duration: 0.45,
        delay: Math.min(index * 0.08, 0.4),
        ease: [0.22, 1, 0.36, 1],
      }}
      whileHover={{ y: -3, transition: { duration: 0.2 } }}
      className={`relative group overflow-hidden ${roundedClass} bg-zinc-100 dark:bg-[#18181b] border border-black/[0.08] dark:border-white/[0.08] shadow-sm hover:shadow-lg hover:border-black/20 dark:hover:border-white/20 ${heightClass} transition-shadow duration-300`}
    >
      <button
        type="button"
        onClick={() => onPreview ? onPreview({ ...image, displayUrl: resolvedSrc }, index) : window.open(image.originalUrl, "_blank", "noopener,noreferrer")}
        aria-label={`Preview: ${image.title || image.alt || query || `Image ${index + 1}`}`}
        className="relative block w-full h-full text-left outline-none cursor-pointer overflow-hidden"
      >
        <AnimatePresence>
          {!isLoaded && (
            <motion.div
              initial={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-zinc-100 dark:bg-[#1e1e22] overflow-hidden"
            >
              {/* Shimmer wave */}
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-black/[0.05] dark:via-white/[0.07] to-transparent bg-[length:200%_100%] animate-[shimmer_1.8s_infinite]" />
              <div className="relative z-10 flex flex-col items-center gap-1.5 opacity-40">
                <ImageIcon className="w-5 h-5 text-zinc-500 dark:text-zinc-400 animate-pulse" />
                <span className="text-[10px] font-medium tracking-wider text-zinc-500 dark:text-zinc-400 uppercase">
                  Loading
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Ambient blurred backdrop for portrait/vertical images */}
        {isPortrait && (
          <img
            src={resolvedSrc}
            alt=""
            aria-hidden="true"
            className={`absolute inset-0 w-full h-full object-cover blur-xl scale-110 pointer-events-none select-none transition-opacity duration-700 ${
              isLoaded ? "opacity-35" : "opacity-0"
            }`}
          />
        )}

        {/* Main image: smooth de-blur and scale reveal */}
        <img
          src={resolvedSrc}
          alt={image.alt || image.title || query || `Web image ${index + 1}`}
          loading="eager"
          decoding="async"
          className={`w-full h-full transition-all duration-700 ease-out group-hover:scale-[1.03] ${
            isPortrait
              ? "relative z-10 object-contain drop-shadow-sm"
              : "object-cover object-top"
          } ${
            isLoaded
              ? "opacity-100 scale-100 blur-0"
              : "opacity-0 scale-[1.04] blur-xs"
          }`}
          onLoad={(e) => onLoad(image.originalUrl, e)}
          onError={handleDisplayError}
        />

        <div className="absolute inset-0 z-20 bg-gradient-to-t from-black/60 via-black/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none" />
        <span className="absolute top-2 right-2 sm:top-2.5 sm:right-2.5 z-20 grid h-6 w-6 sm:h-7 sm:w-7 place-items-center rounded-full bg-black/60 text-white backdrop-blur-md opacity-0 transition-opacity duration-200 group-hover:opacity-100 shadow-sm hover:bg-black/80">
          <Maximize2 size={13} aria-hidden="true" />
        </span>
        {(image.title || image.sourceDomain) && (
          <div className="absolute bottom-2 left-2 right-2 sm:bottom-2.5 sm:left-3 sm:right-3 z-20 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <p className="text-[10px] sm:text-xs font-medium text-white drop-shadow-md truncate">
              {image.title || image.alt || image.sourceDomain}
            </p>
          </div>
        )}
      </button>
    </motion.figure>
  );
}

export function WebSearchImageGrid({
  images,
  query,
  placement = "inline",
  onPreview,
  onReady,
}: {
  images?: Array<string | WebMediaImage>;
  query?: string;
  placement?: "lead" | "inline";
  onPreview?: (image: SearchImagePreview, index: number) => void;
  onReady?: () => void;
}) {
  const [failedUrls, setFailedUrls] = useState<Set<string>>(new Set());
  const [loadedUrls, setLoadedUrls] = useState<Set<string>>(new Set());
  const [aspectRatios, setAspectRatios] = useState<Record<string, number>>({});
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const handleImageLoad = useCallback((url: string, e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (img.naturalWidth && img.naturalHeight) {
      const ratio = img.naturalWidth / img.naturalHeight;
      setAspectRatios((prev) => (prev[url] === ratio ? prev : { ...prev, [url]: ratio }));
    }
    setLoadedUrls((prev) => new Set([...prev, url]));
  }, []);

  const handleImageError = useCallback((url: string) => {
    setFailedUrls((prev) => new Set([...prev, url]));
  }, []);

  const rawCandidates: SearchImagePreview[] = React.useMemo(() => {
    const input = images || [];
    return input
      .map((img) => (typeof img === "string" ? { url: img } : img))
      .filter((img): img is WebMediaImage => Boolean(img && isUsableChatImageUrl(img.url)))
      .filter((img, idx, arr) => arr.findIndex((item) => item.url === img.url) === idx)
      .slice(0, 8)
      .map((img) => ({
        ...img,
        originalUrl: img.url,
        displayUrl: img.url.startsWith("/") ? img.url : `/api/image-proxy?url=${encodeURIComponent(img.url)}`,
      }));
  }, [images]);

  const visibleImages = rawCandidates.filter((img) => !failedUrls.has(img.originalUrl));

  useEffect(() => {
    if (rawCandidates.length > 0 && loadedUrls.size + failedUrls.size >= rawCandidates.length) {
      onReady?.();
    }
  }, [rawCandidates.length, loadedUrls.size, failedUrls.size, onReady]);

  const checkScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  }, []);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    checkScroll();
    el.addEventListener("scroll", checkScroll, { passive: true });
    window.addEventListener("resize", checkScroll);
    return () => {
      el.removeEventListener("scroll", checkScroll);
      window.removeEventListener("resize", checkScroll);
    };
  }, [visibleImages.length, checkScroll]);

  const handleScroll = (direction: "left" | "right") => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distance = el.clientWidth * 0.75;
    el.scrollBy({ left: direction === "left" ? -distance : distance, behavior: "smooth" });
  };

  if (!visibleImages.length) return null;

  const count = visibleImages.length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="relative clear-both my-6 sm:my-7 w-full max-w-full select-none"
    >
      <div className="flex items-center justify-between mb-2.5 px-0.5">
        <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
          {query ? `Web images: ${query}` : "Related web images"}
        </span>
        <span className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500">
          {count} {count === 1 ? "image" : "images"}
        </span>
      </div>

      {/* 1 image: centered/aligned single featured card */}
      {count === 1 && (
        <div className="w-full max-w-md">
          <SearchImageCard
            image={visibleImages[0]}
            index={0}
            query={query}
            heightClass="h-48 sm:h-56 md:h-64"
            roundedClass="rounded-2xl"
            onPreview={onPreview}
            loadedUrls={loadedUrls}
            aspectRatios={aspectRatios}
            onLoad={handleImageLoad}
            onError={handleImageError}
          />
        </div>
      )}

      {/* 2 images: exactly 2 equal columns, equal height */}
      {count === 2 && (
        <div className="grid grid-cols-2 gap-2 sm:gap-2.5 w-full">
          {visibleImages.map((image, index) => (
            <SearchImageCard
              key={image.originalUrl}
              image={image}
              index={index}
              query={query}
              heightClass="h-40 sm:h-48 md:h-52"
              roundedClass="rounded-2xl"
              onPreview={onPreview}
              loadedUrls={loadedUrls}
              aspectRatios={aspectRatios}
              onLoad={handleImageLoad}
              onError={handleImageError}
            />
          ))}
        </div>
      )}

      {/* 3 images: exactly 3 equal columns, equal height */}
      {count === 3 && (
        <div className="grid grid-cols-3 gap-1.5 sm:gap-2.5 w-full">
          {visibleImages.map((image, index) => (
            <SearchImageCard
              key={image.originalUrl}
              image={image}
              index={index}
              query={query}
              heightClass="h-28 xs:h-36 sm:h-44 md:h-48"
              roundedClass="rounded-xl sm:rounded-2xl"
              onPreview={onPreview}
              loadedUrls={loadedUrls}
              aspectRatios={aspectRatios}
              onLoad={handleImageLoad}
              onError={handleImageError}
            />
          ))}
        </div>
      )}

      {/* 4+ images: smooth horizontal carousel with snap and scrollbar suppression */}
      {count >= 4 && (
        <div className="relative group/carousel w-full">
          {canScrollLeft && (
            <button
              type="button"
              onClick={() => handleScroll("left")}
              aria-label="Scroll left"
              className="absolute left-2 top-1/2 -translate-y-1/2 z-10 hidden md:grid h-8 w-8 place-items-center rounded-full bg-black/70 text-white backdrop-blur-md shadow-md hover:bg-black/90 transition-all cursor-pointer"
            >
              <ChevronLeft size={16} />
            </button>
          )}
          {canScrollRight && (
            <button
              type="button"
              onClick={() => handleScroll("right")}
              aria-label="Scroll right"
              className="absolute right-2 top-1/2 -translate-y-1/2 z-10 hidden md:grid h-8 w-8 place-items-center rounded-full bg-black/70 text-white backdrop-blur-md shadow-md hover:bg-black/90 transition-all cursor-pointer"
            >
              <ChevronRight size={16} />
            </button>
          )}
          <div
            ref={scrollContainerRef}
            className="flex gap-2 sm:gap-2.5 overflow-x-auto pb-1.5 scrollbar-hide scrollbar-none snap-x snap-mandatory w-full"
          >
            {visibleImages.map((image, index) => (
              <div
                key={image.originalUrl}
                className="flex-shrink-0 w-[calc(33.333%-6px)] min-w-[140px] sm:min-w-[180px] snap-start"
              >
                <SearchImageCard
                  image={image}
                  index={index}
                  query={query}
                  heightClass="h-28 xs:h-36 sm:h-44 md:h-48"
                  onPreview={onPreview}
                  loadedUrls={loadedUrls}
                  aspectRatios={aspectRatios}
                  onLoad={handleImageLoad}
                  onError={handleImageError}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}

// "Searched the web" collapsible panel with favicons
function WebSearchPanel({ data }: { data: WebSearchData }) {
  const [isOpen, setIsOpen] = useState(false);
  const getDomain = (url: string) => {
    try {
      return new URL(url).hostname.replace("www.", "");
    } catch {
      return url;
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full mb-4 flex flex-col gap-3"
    >
      
      <div className="w-full">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 transition-colors bg-white dark:bg-[#2A2A2A] px-3 py-1.5 rounded-full border border-gray-200 dark:border-[#3A3A3A] shadow-sm w-fit"
        >
          <motion.div
            animate={{ rotate: isOpen ? 90 : 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
          >
            <ChevronRight size={16} />
          </motion.div>
          <GlobeSpin size={14} />
          <span>Searched the web</span>
        </button>
        <AnimatePresence>
          {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="overflow-hidden"
          >
            <div className="mt-3 ml-2 pl-4 border-l-2 border-gray-200 dark:border-[#3A3A3A]">
              <div className="flex items-center gap-2 mb-3 text-sm text-gray-500 dark:text-gray-400">
                <GlobeSpin size={12} />
                <span className="text-gray-800 dark:text-gray-200">
                  {data.query}
                </span>
                <span className="ml-auto text-xs text-gray-400">
                  {data.results.length} results
                </span>
              </div>
              <div className="space-y-1">
                {data.results.map((r, i) => (
                  <a
                    key={i}
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-[#2A2A2A] transition-colors group"
                  >
                    <SafeFavicon domain={getDomain(r.url)} size={16} />
                    <span className="text-sm text-gray-700 dark:text-gray-300 truncate flex-1 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                      {r.title}
                    </span>
                    <span className="text-xs text-gray-400 shrink-0 hidden sm:inline">
                      {getDomain(r.url)}
                    </span>
                    <ExternalLink
                      size={12}
                      className="text-gray-300 dark:text-gray-600 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    />
                  </a>
                ))}
              </div>
              <div className="flex items-center gap-2 mt-3 pt-2 text-xs text-gray-400">
                <span className="w-1.5 h-1.5 rounded-full bg-white" />
                <span>Done</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      </div>
    </motion.div>
  );
}

// Fun monochrome animations for loading states
const BrainFloat = ({ size = 16 }: { size?: number }) => (
  <motion.div
    animate={{ y: [0, -2, 0] }}
    transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
    className="flex items-center justify-center text-gray-600 dark:text-gray-400"
    style={{ width: size, height: size }}
  >
    <BrainCircuit size={size} />
  </motion.div>
);

const GlobeSpin = ({ size = 16 }: { size?: number }) => (
  <motion.div
    animate={{ rotate: 360 }}
    transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
    className="flex items-center justify-center text-gray-600 dark:text-gray-400"
    style={{ width: size, height: size }}
  >
    <Globe size={size} />
  </motion.div>
);

const PenWrite = ({ size = 16 }: { size?: number }) => (
  <motion.div
    animate={{ rotate: [0, -15, 10, -5, 0], x: [0, 2, -1, 1, 0] }}
    transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
    className="flex items-center justify-center text-gray-600 dark:text-gray-400"
    style={{ width: size, height: size }}
  >
    <PenTool size={size} />
  </motion.div>
);

// One continuous, rounded figure-eight gives the loading stroke a smooth loop.
const INFINITY_PATH = "M2.5 9C5.5 3.1 9.2 3.1 12 9C14.8 14.9 18.5 14.9 21.5 9C18.5 3.1 14.8 3.1 12 9C9.2 14.9 5.5 14.9 2.5 9";

const AutoGlyph = ({ size = 18, active = false }: { size?: number; active?: boolean }) => (
  <span
    className="relative inline-flex shrink-0 items-center justify-center text-gray-800 dark:text-gray-100"
    style={{ width: Math.round(size * 1.8), height: size }}
    aria-label="Automatic model routing"
  >
    <svg viewBox="0 0 24 18" fill="none" className="h-full w-full overflow-visible" aria-hidden="true">
      <path
        d={INFINITY_PATH}
        stroke="currentColor"
        strokeWidth="3.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={active ? 0.3 : 0.96}
      />
      {active ? (
        <path
          d={INFINITY_PATH}
          pathLength={1}
          stroke="currentColor"
          strokeWidth="3.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="0.22 0.78"
          strokeDashoffset="1"
        >
          <animate attributeName="stroke-dashoffset" from="1" to="0" dur="1.35s" repeatCount="indefinite" />
        </path>
      ) : null}
    </svg>
  </span>
);

export const getCompanyLogo = (modelName: string) => {
  let iconName = "";
  let needsInvert = false;
  let fallback = false;
  const lower = modelName.toLowerCase();
  
  if (lower.includes("wikipedia") || lower.includes("wikimedia")) iconName = "wikipedia";
  else if (lower.includes("web") || lower.includes("unsplash") || lower.includes("search")) iconName = "web";
  else if (lower.includes("cloudflare") || lower.includes("cloudfare") || lower.includes("cloud fare") || lower.includes("sdxl")) iconName = "cloudflare";
  else if (lower.includes("nvidia") || lower.includes("nemotron")) iconName = "nvidia";
  else if (lower.includes("mistral") || lower.includes("codestral")) iconName = "mistralai";
  else if (lower.includes("qwen")) iconName = "alibabacloud";
  else if (lower.includes("deepseek")) iconName = "deepseek";
  else if (lower.includes("cerebras")) iconName = "cerebras";
  else if (lower.includes("sambanova") || lower.includes("samba")) iconName = "sambanova";
  else if (lower.includes("llama")) iconName = "meta";
  else if (lower.includes("gemini")) iconName = "google";
  else if (lower.includes("gpt")) { iconName = "openai"; }
  else if (lower.includes("hf") || lower.includes("flux") || lower.includes("ideogram")) iconName = "huggingface";
  else fallback = true;

  if (fallback) {
    return <AutoGlyph />;
  }

  if (iconName === "wikipedia") {
    return (
      <svg role="img" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 shrink-0 text-gray-200">
        <path d="M12.09 13.114l2.67-5.787 2.767 5.787h-5.437zm-2.073-9.114l-6.017 14h2.463l1.196-2.887h6.812l1.173 2.887h2.463l-6.017-14h-2.073z"/>
      </svg>
    );
  }

  if (iconName === "web") {
    return (
      <svg role="img" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 shrink-0 text-blue-400">
        <circle cx="12" cy="12" r="10"/>
        <line x1="2" y1="12" x2="22" y2="12"/>
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
      </svg>
    );
  }

  if (iconName === "cerebras") {
    return (
      <svg role="img" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 shrink-0 text-cyan-400">
        <path d="M12 2L2 7V17L12 22L22 17V7L12 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M12 6L6 9.5V14.5L12 18L18 14.5V9.5L12 6Z" fill="currentColor" opacity="0.7"/>
      </svg>
    );
  }

  if (iconName === "sambanova") {
    return (
      <svg role="img" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 shrink-0 text-purple-400">
        <rect x="3" y="3" width="18" height="18" rx="4" stroke="currentColor" strokeWidth="2"/>
        <circle cx="8" cy="8" r="2" fill="#C084FC"/>
        <circle cx="16" cy="16" r="2" fill="#E9D5FF"/>
        <path d="M8 8L16 16" stroke="currentColor" strokeWidth="2"/>
      </svg>
    );
  }

  if (iconName === "cloudflare") {
    return (
      <svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 shrink-0 fill-[#F38020]">
        <path d="M16.924 10.638A4.954 4.954 0 0 0 12.242 7c-2.3 0-4.248 1.57-4.8 3.737A3.676 3.676 0 0 0 6.273 10.4C4.465 10.4 3 11.865 3 13.673c0 .245.027.484.078.714A4.475 4.475 0 0 0 0 18.25C0 20.873 2.127 23 4.75 23h14.5C21.873 23 24 20.873 24 18.25c0-2.24-1.554-4.116-3.666-4.604a4.437 4.437 0 0 0-3.41-3.008z"/>
      </svg>
    );
  }

  if (iconName === "openai") {
    return (
      <svg role="img" viewBox="0 0 2406 2406" xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 shrink-0 fill-current text-gray-900 dark:text-gray-100">
        <path id="a" d="M1107.3 299.1c-197.999 0-373.9 127.3-435.2 315.3L650 743.5v427.9c0 21.4 11 40.4 29.4 51.4l344.5 198.515V833.3h.1v-27.9L1372.7 604c33.715-19.52 70.44-32.857 108.47-39.828L1447.6 450.3C1361 353.5 1237.1 298.5 1107.3 299.1zm0 117.5-.6.6c79.699 0 156.3 27.5 217.6 78.4-2.5 1.2-7.4 4.3-11 6.1L952.8 709.3c-18.4 10.4-29.4 30-29.4 51.4V1248l-155.1-89.4V755.8c-.1-187.099 151.601-338.9 339-339.2z" />
        <use href="#a" transform="rotate(60 1203 1203)"/>
        <use href="#a" transform="rotate(120 1203 1203)"/>
        <use href="#a" transform="rotate(180 1203 1203)"/>
        <use href="#a" transform="rotate(240 1203 1203)"/>
        <use href="#a" transform="rotate(300 1203 1203)"/>
      </svg>
    );
  }

  return (
    <img 
      src={`https://cdn.simpleicons.org/${iconName}`} 
      className={`w-3.5 h-3.5 shrink-0 object-contain ${needsInvert ? 'dark:invert opacity-80' : ''}`} 
      alt=""
      onError={(e) => {
        e.currentTarget.style.display = 'none';
      }}
    />
  );
};

const LONG_PROMPT_CHARACTERS = 420;
const LONG_PROMPT_LINES = 5;

function UserPromptBubble({
  content,
  modern,
  fontSize,
  onActivate,
}: {
  content: string;
  modern: boolean;
  fontSize: "small" | "medium" | "large";
  onActivate: () => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const lineCount = content.split(/\r?\n/).length;
  const isLongPrompt = content.length > LONG_PROMPT_CHARACTERS || lineCount > LONG_PROMPT_LINES;
  const words = content.trim().split(/\s+/).filter(Boolean).length;

  return (
    <motion.div
      layout="position"
      transition={{ duration: 0.2, ease: "easeInOut" }}
      onClick={onActivate}
      className={`${modern ? "w-full rounded-none bg-transparent px-0 py-1 dark:bg-transparent" : "w-fit max-w-full rounded-3xl bg-gray-200 px-5 py-3 dark:bg-[#2A2A2A]"} ${fontSize === "small" ? "text-sm" : fontSize === "large" ? "text-lg" : "text-base"} text-gray-900 dark:text-gray-100 leading-relaxed break-words cursor-pointer select-none`}
    >
      <div className={`whitespace-pre-wrap ${isLongPrompt && !isExpanded ? "line-clamp-4" : ""}`}>
        {content}
      </div>
      {isLongPrompt && (
        <div className="mt-2 flex items-center justify-between gap-3 text-xs text-gray-600 dark:text-gray-400">
          <span>{words.toLocaleString()} words</span>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setIsExpanded((expanded) => !expanded);
            }}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 font-medium text-gray-800 hover:bg-gray-300/70 dark:text-gray-200 dark:hover:bg-[#3A3A3A]"
            aria-expanded={isExpanded}
            aria-label={isExpanded ? "Collapse prompt" : "Expand full prompt"}
          >
            {isExpanded ? "Show less" : "Show full prompt"}
            <ChevronDown size={14} className={`transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`} aria-hidden="true" />
          </button>
        </div>
      )}
    </motion.div>
  );
}

const ImageLoaderSkeleton = React.memo(function ImageLoaderSkeleton({ modelName }: { modelName?: string }) {
  const progressWords = ["Preparing", "Composing", "Rendering", "Refining", "Polishing"];
  const [progressWordIndex, setProgressWordIndex] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => {
      setProgressWordIndex((index) => (index + 1) % progressWords.length);
    }, 1800);
    return () => window.clearInterval(timer);
  }, [progressWords.length]);

  const isWebImage =
    modelName?.toLowerCase().includes("web") ||
    modelName?.toLowerCase().includes("wikipedia") ||
    modelName?.toLowerCase().includes("unsplash") ||
    modelName?.toLowerCase().includes("wikimedia") ||
    modelName?.toLowerCase().includes("source");

  if (isWebImage) {
    return (
      <span className="block w-full min-h-[150px] sm:min-h-[200px] bg-gray-200 dark:bg-[#1E1E1E] animate-pulse rounded-2xl" />
    );
  }

  const cleanModelName = modelName || "FLUX V1";

  return (
    <span className="block w-full relative isolate overflow-hidden rounded-2xl border border-gray-300 bg-[#F1F1EF] shadow-sm dark:border-[#3A3A3A] dark:bg-[#1D1D1F] aspect-[4/3] sm:aspect-[16/10]">
      <motion.span
        aria-hidden="true"
        className="absolute inset-y-0 w-[32%] bg-white/45 blur-2xl dark:bg-white/[0.035]"
        animate={{ x: ["-140%", "430%"] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut", repeatDelay: 0.25 }}
      />
      <span className="absolute inset-3 sm:inset-5 rounded-xl border border-gray-300/80 bg-white/35 dark:border-[#343434] dark:bg-[#202020]" />
      <motion.span
        aria-hidden="true"
        className="absolute inset-x-[14%] top-[17%] h-3 rounded-full bg-gray-300/80 dark:bg-[#343434]"
        animate={{ opacity: [0.62, 0.92, 0.62] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.span
        aria-hidden="true"
        className="absolute inset-x-[27%] top-[25%] h-2.5 rounded-full bg-gray-300/65 dark:bg-[#2D2D2F]"
        animate={{ opacity: [0.45, 0.78, 0.45] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut", delay: 0.18 }}
      />

      <span className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 px-6 pt-[12%] text-center">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={cleanModelName}
            initial={{ opacity: 0, y: 5, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -5, scale: 0.96 }}
            transition={{ duration: 0.24, ease: "easeInOut" }}
            className="inline-flex items-center gap-2 rounded-full border border-gray-300 bg-white/90 px-3.5 py-1.5 text-xs font-semibold text-gray-900 shadow-sm dark:border-[#484848] dark:bg-[#272729] dark:text-white"
          >
            {getCompanyLogo(cleanModelName)}
            <span>{cleanModelName}</span>
          </motion.span>
        </AnimatePresence>
        <span className="flex items-center justify-center" aria-label="Generating image">
          <ProgressMark />
        </span>
        <span
          aria-live="polite"
          className="flex min-h-7 items-center text-sm font-medium tracking-normal text-gray-600 dark:text-gray-300"
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={progressWords[progressWordIndex]}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
            >
              {progressWords[progressWordIndex]}
            </motion.span>
          </AnimatePresence>
          {[0, 1, 2].map((dot) => (
            <motion.span
              key={dot}
              animate={{ opacity: [0.2, 1, 0.2], y: [0, -3, 0] }}
              transition={{ duration: 1.1, repeat: Infinity, delay: dot * 0.18, ease: "easeInOut" }}
            >
              .
            </motion.span>
          ))}
        </span>
      </span>
    </span>
  );
});

function ImageGenerationLoader({ modelName }: { modelName?: string }) {
  return (
    <div className="w-full min-w-0 max-w-4xl xl:max-w-5xl mx-auto py-3 px-2 sm:px-4">
      <ImageLoaderSkeleton modelName={modelName} />
    </div>
  );
}

function generationAbortError() {
  return new DOMException("Generation stopped by user", "AbortError");
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(generationAbortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(generationAbortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function preloadGeneratedImage(url: string, timeoutMs = 90000, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const onAbort = () => {
      window.clearTimeout(timeoutId);
      image.src = "";
      reject(generationAbortError());
    };
    const timeoutId = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      image.src = "";
      reject(new Error("The generated image took too long to load. Please try again."));
    }, timeoutMs);

    image.onload = () => {
      window.clearTimeout(timeoutId);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    image.onerror = () => {
      window.clearTimeout(timeoutId);
      signal?.removeEventListener("abort", onAbort);
      reject(new Error("The image provider returned an image that could not be loaded."));
    };
    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });
    image.src = url;
  });
}

function rasterPosterPrompt(rawPrompt: string): string {
  const size = /\b(?:landscape|horizontal|wide|banner)\b/i.test(rawPrompt) ? "1536x1024" : "1024x1536";
  return buildAiPosterPrompt(rawPrompt, size);
}

const VECTOR_INFOGRAPHIC_MODEL = "VOID Vector Infographic";

async function generateVectorInfographicAsset(
  rawPrompt: string,
  signal: AbortSignal,
): Promise<{ url: string; modelUsed: string; warnings?: string[] }> {
  const response = await fetchWithRetry("/api/poster/render", {
    method: "POST",
    headers: await authenticatedJsonHeaders(),
    body: JSON.stringify({ topic: rawPrompt, rawText: rawPrompt }),
    signal,
  }, { attempts: 1, connectTimeoutMs: 110_000 });
  const payload = await readJsonResponse<{ pngUrl?: string; providerUsed?: string; error?: string; warnings?: string[] }>(response);
  if (!response.ok || !payload.pngUrl) throw new Error(payload.error || "Failed to render infographic");
  return {
    url: payload.pngUrl,
    modelUsed: `${payload.providerUsed || "Structured layout"} · readable SVG`,
    warnings: payload.warnings,
  };
}

async function generateRasterPosterAsset(
  rawPrompt: string,
  signal: AbortSignal,
  onModelChange?: (modelName: string) => void,
): Promise<{ url: string; modelUsed: string }> {
  if (isInfographicCreationRequest(rawPrompt)) {
    onModelChange?.(VECTOR_INFOGRAPHIC_MODEL);
    return generateVectorInfographicAsset(rawPrompt, signal);
  }
  const finalPrompt = rasterPosterPrompt(rawPrompt);
  const size = /\b(?:landscape|horizontal|wide|banner)\b/i.test(rawPrompt) ? "1536x1024" : "1024x1536";
  const requestModel = async (model: string) => {
    const response = await fetchWithRetry("/api/generate-image", {
      method: "POST",
      headers: await authenticatedJsonHeaders(),
      body: JSON.stringify({ prompt: finalPrompt, model, quality: "high", size }),
      signal,
    }, { attempts: 1, connectTimeoutMs: 180_000 });
    const payload = await readJsonResponse<{ url?: string; modelUsed?: string; error?: string }>(response);
    if (!response.ok || !payload.url) throw new Error(payload.error || "Failed to generate poster");
    return { url: payload.url, modelUsed: payload.modelUsed || model };
  };

  try {
    onModelChange?.(POSTER_IMAGE_MODEL);
    return await requestModel(POSTER_IMAGE_MODEL);
  } catch (geminiError) {
    if (signal.aborted) throw geminiError;
  }
  try {
    onModelChange?.("Cloudflare FLUX.1 Schnell");
    return await requestModel(POSTER_CLOUDFLARE_MODEL);
  } catch (cloudflareError) {
    if (signal.aborted) throw cloudflareError;
  }
  try {
    onModelChange?.("FLUX 1.1 Pro");
    return await requestModel(POSTER_FLUX_MODEL);
  } catch (fluxError) {
    if (signal.aborted) throw fluxError;
  }

  throw new Error("No AI image provider could generate this poster right now. Please retry in a moment.");
}

// Component that generates an image from a text prompt through VOID's server-side providers.
const GeneratedImageBlock = React.memo(function GeneratedImageBlock({
  prompt,
  messageId,
  model = "FLUX V1",
  onGenerated,
  onLoadedStateChange,
  userEmail,
}: {
  prompt: string;
  messageId?: string;
  model?: string;
  userEmail?: string | null;
  onGenerated?: (msgId: string, prompt: string, url: string) => void;
  onLoadedStateChange?: (loaded: boolean) => void;
}) {
  const [state, setState] = React.useState<"loading" | "loaded" | "error">(
    "loading",
  );
  const [imageUrl, setImageUrl] = React.useState<string | null>(null);
  const [imgLoaded, setImgLoaded] = React.useState(false);
  const [imgRetryCount, setImgRetryCount] = React.useState(0);
  const [retryCount, setRetryCount] = React.useState(0);

  React.useEffect(() => {
    if (state === "loaded" && imgLoaded) {
      onLoadedStateChange?.(true);
    } else if (state === "error") {
      onLoadedStateChange?.(true);
    } else {
      onLoadedStateChange?.(false);
    }
  }, [state, imgLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Store url in a ref so the deferred onGenerated effect can access it
  const generatedUrlRef = React.useRef<string | null>(null);

  // Defer onGenerated until the image has actually loaded in the <img> element
  const [modelName, setModelName] = React.useState<string>("");

  React.useEffect(() => {
    if (imgLoaded && generatedUrlRef.current && messageId && onGenerated) {
      onGenerated(messageId, prompt, generatedUrlRef.current);
    }
  }, [imgLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    let cancelled = false;
    setState("loading");
    setImgLoaded(false);
    setImgRetryCount(0);
    generatedUrlRef.current = null;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 180000);

    (async () => {
      try {
        const finalPrompt = prompt.replace(/\n/g, " ").trim().substring(0, 800);

        const res = await fetchWithRetry("/api/generate-image", {
          method: "POST",
          headers: await authenticatedJsonHeaders(),
          body: JSON.stringify({ prompt: finalPrompt, model, userEmail }),
          signal: controller.signal,
        }, { attempts: 1, connectTimeoutMs: 180_000 });
        const data = await readJsonResponse<{ url?: string; modelUsed?: string; error?: string }>(res);
        if (!res.ok) throw new Error(data.error || "Failed to generate image");

        clearTimeout(timeoutId);

        if (!cancelled) {
          if (data.url) {
            setImageUrl(data.url);
            if (data.modelUsed) setModelName(data.modelUsed);
            generatedUrlRef.current = data.url;
            setState("loaded");
            // onGenerated is now deferred until imgLoaded === true
          } else {
            throw new Error(data.error || "Failed to generate image");
          }
        }
      } catch (err: any) {
        clearTimeout(timeoutId);
        if (!cancelled) {
          console.error("Image generation error:", err);
          setState("error");
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeoutId);
    };
  }, [prompt, retryCount]);

  let detectedModelName = modelName;
  if (!detectedModelName && imageUrl) {
    if (imageUrl.includes("model_name=")) {
      try {
        const urlObj = new URL(imageUrl, "http://localhost");
        detectedModelName = urlObj.searchParams.get("model_name") || "";
      } catch {}
    }
    if (!detectedModelName) {
      if (imageUrl.includes("model=flux-anime")) detectedModelName = "FLUX Anime";
      else if (imageUrl.includes("model=flux-realism")) detectedModelName = "FLUX Realism";
      else if (imageUrl.includes("model=flux-3d")) detectedModelName = "FLUX 3D";
      else if (imageUrl.includes("model=turbo")) detectedModelName = "Ideogram";
      else if (imageUrl.includes("model=flux")) detectedModelName = "FLUX V1";
      else if (imageUrl.startsWith("data:image")) detectedModelName = "Cloudflare FLUX.1 Schnell";
    }
  }

  return (
    <span className="block relative group w-full max-w-4xl mx-auto my-6 rounded-2xl border border-gray-200 dark:border-[#3A3A3A] overflow-hidden shadow-md bg-gray-50 dark:bg-[#1E1E1E]">
      {(state === "loading" || (state === "loaded" && !imgLoaded)) && (
        <ImageLoaderSkeleton modelName={detectedModelName || model} />
      )}
      {state === "error" && (
        <span
          className="block w-full flex flex-col items-center justify-center gap-3 py-12 text-gray-400 dark:text-gray-500"
          style={{ aspectRatio: "16/9" }}
        >
          <svg
            className="w-10 h-10"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span className="text-sm font-medium">Image failed to generate</span>
          <button
            onClick={() => setRetryCount((c) => c + 1)}
            className="px-4 py-1.5 rounded-xl bg-gray-900 text-white dark:bg-white dark:text-black text-xs font-semibold hover:opacity-90 transition-all shadow-sm active:scale-95"
          >
            Retry
          </button>
        </span>
      )}
      {state === "loaded" && imageUrl && (
        <>
          <img
            src={imgRetryCount > 0 ? `${imageUrl}&ts=${imgRetryCount}` : imageUrl}
            alt={prompt}
            className={`w-full h-auto object-contain transition-opacity duration-500 ${imgLoaded ? "opacity-100" : "opacity-0 absolute"}`}
            onLoad={() => setImgLoaded(true)}
            onError={() => {
              if (imgRetryCount < 2) {
                setTimeout(() => setImgRetryCount((c) => c + 1), 1500);
              } else {
                setState("error");
              }
            }}
          />
          {imgLoaded && (
            <>
              {detectedModelName && (
                <span className="absolute bottom-2.5 left-2.5 px-2.5 py-1 rounded-full bg-black/75 backdrop-blur-md border border-white/15 text-[10px] font-semibold text-white shadow-lg flex items-center gap-1.5 select-none pointer-events-none z-10">
                  {getCompanyLogo(detectedModelName)}
                  <span>{detectedModelName}</span>
                </span>
              )}
              <span className="absolute top-2 right-2 flex gap-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
            <button
              onClick={async (e) => {
                const btn = e.currentTarget;
                const original = btn.innerHTML;
                try {
                  const res = await fetch(imageUrl);
                  const blob = await res.blob();
                  let clipboardBlob = blob;
                  if (blob.type !== "image/png") {
                    clipboardBlob = await new Promise<Blob>(
                      (resolve, reject) => {
                        const objectUrl = URL.createObjectURL(blob);
                        const imgObj = new Image();
                        imgObj.crossOrigin = "anonymous";
                        imgObj.onload = () => {
                          URL.revokeObjectURL(objectUrl);
                          const canvas = document.createElement("canvas");
                          canvas.width = imgObj.width;
                          canvas.height = imgObj.height;
                          const ctx = canvas.getContext("2d");
                          if (!ctx) return reject(new Error("Context failed"));
                          ctx.drawImage(imgObj, 0, 0);
                          canvas.toBlob(
                            (b) =>
                              b ? resolve(b) : reject(new Error("Blob failed")),
                            "image/png",
                          );
                        };
                        imgObj.onerror = () => {
                          URL.revokeObjectURL(objectUrl);
                          reject(new Error("Image failed to load"));
                        };
                        imgObj.src = objectUrl;
                      },
                    );
                  }
                  await navigator.clipboard.write([
                    new ClipboardItem({ "image/png": clipboardBlob }),
                  ]);
                  btn.innerHTML = `<span class="text-xs font-bold px-1 text-green-500">Copied</span>`;
                  setTimeout(() => {
                    btn.innerHTML = original;
                  }, 2000);
                } catch (err) {
                  btn.innerHTML = `<span class="text-xs font-bold px-1 text-red-500">Failed</span>`;
                  setTimeout(() => {
                    btn.innerHTML = original;
                  }, 2000);
                }
              }}
              className="p-2 bg-white/90 dark:bg-black/80 backdrop-blur-sm rounded-lg hover:bg-white dark:hover:bg-black text-gray-700 dark:text-gray-300 transition-colors shadow-sm"
              title="Copy Image"
            >
              <Copy size={16} />
            </button>
            <button
              onClick={async (e) => {
                e.preventDefault();
                try {
                  const res = await fetch(imageUrl);
                  const blob = await res.blob();
                  const url = window.URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `generated_${Date.now()}.png`;
                  document.body.appendChild(a);
                  a.click();
                  window.URL.revokeObjectURL(url);
                  document.body.removeChild(a);
                } catch (error) {
                  console.error("Download failed, using fallback", error);
                  const a = document.createElement("a");
                  a.href = imageUrl;
                  a.download = `generated_${Date.now()}.png`;
                  a.target = "_blank";
                  a.click();
                }
              }}
              className="p-2 bg-white/90 dark:bg-black/80 backdrop-blur-sm rounded-lg hover:bg-white dark:hover:bg-black text-gray-700 dark:text-gray-300 transition-colors shadow-sm"
              title="Download Image"
            >
              <Download size={16} />
            </button>
          </span>
            </>
          )}
        </>
      )}
    </span>
  );
});

const MarkdownImage = React.memo(function MarkdownImage({
  src,
  alt,
  onLoadedStateChange,
  setPreviewAttachment,
  onCustomizePoster,
  artifactKind,
  ...props
}: any) {
  const [imgState, setImgState] = React.useState<
    "loading" | "loaded" | "error"
  >("loading");
  const [retryCount, setRetryCount] = React.useState(0);
  const [customizing, setCustomizing] = React.useState(false);
  const [customizeError, setCustomizeError] = React.useState("");
  const maxRetries = 1;

  React.useEffect(() => {
    if (imgState === "loaded" || imgState === "error") {
      onLoadedStateChange?.(true);
    } else {
      onLoadedStateChange?.(false);
    }
  }, [imgState]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!src || imgState === "error") return null;
  
  // Block any AI hallucinatory image gen unless explicitly requested via special tags
  if (src.includes("pollinations.ai") && !src.includes("void_generated=true")) {
    return null;
  }
  
  if (src.endsWith("...")) {
    return null;
  }
  
  let finalSrc = src;
  const isExternalSearchImage = src.startsWith('http') && !src.includes('localhost') && !src.startsWith('/') && !src.includes('pollinations.ai');
  if (isExternalSearchImage) {
    finalSrc = `/api/image-proxy?url=${encodeURIComponent(src)}`;
  }
  
  const imgSrc =
    retryCount > 0
      ? finalSrc.includes("?")
        ? `${finalSrc}&seed=${retryCount}`
        : `${finalSrc}?seed=${retryCount}`
      : finalSrc;

  let detectedModelName = "";
  if (alt && alt.includes("model=")) {
    const match = alt.match(/model=([^\]|]+)/);
    if (match) detectedModelName = match[1].trim();
  }
  if (!detectedModelName && src.includes("model_name=")) {
    try {
      const urlObj = new URL(src, "http://localhost");
      detectedModelName = urlObj.searchParams.get("model_name") || "";
    } catch {}
  }
  if (!detectedModelName) {
    if (src.includes("model=flux-anime")) detectedModelName = "FLUX Anime";
    else if (src.includes("model=flux-realism")) detectedModelName = "FLUX Realism";
    else if (src.includes("model=flux-3d")) detectedModelName = "FLUX 3D";
    else if (src.includes("model=turbo")) detectedModelName = "Ideogram";
    else if (src.includes("model=flux")) detectedModelName = "FLUX V1";
    else if (src.startsWith("data:image")) detectedModelName = "Cloudflare FLUX.1 Schnell";
    else if (src.includes("wikimedia.org") || src.includes("wikipedia.org")) detectedModelName = "Wikipedia Source";
    else if (src.includes("unsplash.com")) detectedModelName = "Unsplash Image";
    else if (src.includes("image-proxy") || src.startsWith("http://") || src.startsWith("https://")) detectedModelName = "Web Source";
  }
  const altLower = (alt || "").toLowerCase();
  
  const isGenerated = detectedModelName && detectedModelName !== "Web Source" && detectedModelName !== "Wikipedia Source" && detectedModelName !== "Unsplash Image";

  // Smart placement logic based on image context hints
  const isCharacter = altLower.includes("character") || altLower.includes("profile") || altLower.includes("avatar") || altLower.includes("person") || altLower.includes("icon");
  const isDiagram = isGenerated || altLower.includes("diagram") || altLower.includes("map") || altLower.includes("chart") || altLower.includes("hero") || altLower.includes("graph") || altLower.includes("workflow");
  
  // Keep response media in the document flow. Floats make a standalone image
  // drift to the far edge of a wide answer and can collide with later content.
  const isPosterResult = typeof onCustomizePoster === "function";
  const containerClass = isPosterResult
    ? "clear-both relative mx-auto my-6 block w-full max-w-2xl overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-lg dark:border-white/10 dark:bg-[#171717]"
    : isCharacter
    ? "clear-both relative my-6 block w-full max-w-sm overflow-hidden rounded-2xl border border-gray-200 bg-gray-50 shadow-sm dark:border-[#3A3A3A] dark:bg-[#202020]"
    : isDiagram 
    ? "block relative group w-full max-w-4xl mx-auto my-6 rounded-2xl border border-gray-200 dark:border-[#3A3A3A] overflow-hidden shadow-lg bg-black/5 dark:bg-white/5"
    : "clear-both relative my-6 block w-full max-w-xl overflow-hidden rounded-2xl border border-gray-200 bg-gray-50 shadow-md dark:border-[#3A3A3A] dark:bg-[#202020]";

  const imgClass = isPosterResult
    ? `mx-auto block ${artifactKind === "infographic" ? "h-auto w-full" : "max-h-[min(74vh,720px)] w-full object-contain"} transition-all duration-700 ease-out cursor-pointer hover:opacity-95 ${imgState === "loaded" ? "opacity-100 scale-100 blur-0" : "opacity-0 scale-[1.03] blur-xs absolute"}`
    : isCharacter
    ? `w-full h-auto max-h-56 object-contain transition-all duration-700 ease-out cursor-pointer hover:scale-[1.02] ${imgState === "loaded" ? "opacity-100 scale-100 blur-0" : "opacity-0 scale-[1.03] blur-xs absolute"}`
    : isGenerated
      ? `w-full h-auto max-h-[680px] object-contain transition-all duration-700 ease-out cursor-pointer hover:opacity-90 ${imgState === "loaded" ? "opacity-100 scale-100 blur-0" : "opacity-0 scale-[1.03] blur-xs absolute"}`
      : `w-full h-auto max-h-72 object-contain transition-all duration-700 ease-out cursor-pointer hover:opacity-90 ${imgState === "loaded" ? "opacity-100 scale-100 blur-0" : "opacity-0 scale-[1.03] blur-xs absolute"}`;

  return (
    <span
      className={containerClass}
      style={isGenerated ? { width: "min(100%, 720px)", minHeight: imgState === "loading" ? "300px" : undefined } : undefined}
      onClick={() => setPreviewAttachment?.({ name: alt || "Image", url: imgSrc, type: "image/png" })}
    >
      {isPosterResult && (
        <span className="flex min-h-12 items-center justify-between gap-3 border-b border-gray-200 px-3 py-2 dark:border-white/10">
          <span className="min-w-0">
            <span className="block truncate text-xs font-semibold text-gray-900 dark:text-white">{artifactKind === "infographic" ? "Infographic" : "Poster"} preview</span>
            <span className="block truncate text-[10px] text-gray-500 dark:text-gray-400">Full-size artwork · editor available</span>
          </span>
          <button
            type="button"
            disabled={customizing}
            onClick={async (event) => {
              event.stopPropagation();
              setCustomizing(true);
              setCustomizeError("");
              try {
                await onCustomizePoster(src, alt);
              } catch (error) {
                setCustomizeError(error instanceof Error ? error.message : "Could not open the editor.");
              } finally {
                setCustomizing(false);
              }
            }}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-gray-300 bg-gray-900 px-3 text-[11px] font-semibold text-white transition-colors hover:bg-black disabled:cursor-wait disabled:opacity-60 dark:border-white/20 dark:bg-white dark:text-black dark:hover:bg-gray-200"
          >
            <Pencil size={12} aria-hidden="true" />
            {customizing ? "Preparing…" : "Open editor"}
          </button>
        </span>
      )}
      {isPosterResult && customizeError && <span className="block border-b border-gray-200 px-3 py-2 text-[11px] text-gray-600 dark:border-white/10 dark:text-gray-300">{customizeError}</span>}
      {imgState === "loading" && (
        <span className="flex w-full min-w-0 h-full min-h-[300px] items-center justify-center">
          <ImageLoaderSkeleton modelName={detectedModelName} />
        </span>
      )}
      <img
        key={retryCount}
        src={imgSrc}
        alt={alt || ""}
        className={imgClass}
        loading="lazy"
        referrerPolicy="no-referrer"
        onLoad={() => setImgState("loaded")}
        onError={() => {
          if (retryCount < maxRetries) {
            setTimeout(() => setRetryCount((c) => c + 1), 1000);
          } else {
            setImgState("error");
          }
        }}
        {...props}
      />
      {imgState === "loaded" && detectedModelName && !isCharacter && detectedModelName !== "Web Source" && detectedModelName !== "Wikipedia Source" && (
        <span className="absolute bottom-2.5 left-2.5 px-2.5 py-1 rounded-full bg-black/75 backdrop-blur-md border border-white/15 text-[10px] font-semibold text-white shadow-lg flex items-center gap-1.5 select-none pointer-events-none z-10">
          {getCompanyLogo(detectedModelName)}
          <span>{detectedModelName}</span>
        </span>
      )}
    </span>
  );
});

function preprocessLaTeX(text: string): string {
  if (!text || typeof text !== "string") return text;
  
  return text
    // Convert OpenAI-style citation tokens like 【1†L1-L4】 or 【2†source】 into [1], [2]
    .replace(/【(\d+)(?:[†:][^】]*)?】/g, "[$1]")
    .replace(/【[^】]*】/g, "")
    // Convert \( ... \) into $ ... $
    .replace(/\\\(s*([\s\S]*?)\s*\\\)/g, '$$$1$$')
    // Convert \[ ... \] into $$ ... $$
    .replace(/\\\[\s*([\s\S]*?)\s*\\\]/g, '$$$$$1$$$$')
    // Fix escaped dollar signs if used for math: \$V_{CC}\$ -> $V_{CC}$
    .replace(/\\\$([^\$\n]+?)\\\$/g, '$$$1$$')
    // Clean up escaped underscores or braces inside math blocks: $V\_\{CC\}$ -> $V_{CC}$
    .replace(/(\$\$?)([\s\S]+?)\1/g, (match, delimiter, mathContent) => {
      const cleanedMath = mathContent
        .replace(/\\_/g, "_")
        .replace(/\\\{/g, "{")
        .replace(/\\\}/g, "}");
      return `${delimiter}${cleanedMath}${delimiter}`;
    });
}

function normalizeGeneratedBreakTags(text: string): string {
  if (!text || typeof text !== "string") return text;
  return text
    .replace(/\\?&lt;br\s*\/?&gt;/gi, "&#10;")
    .replace(/\\?<br\s*\/?>/gi, "&#10;")
    .replace(/(?:&#10;[ \t]*){3,}/gi, "&#10;&#10;");
}

function generatedBreakTagsToPlainText(text: string): string {
  return normalizeGeneratedBreakTags(text)
    .replace(/&#(?:10|x0*a);/gi, "\n")
    .replace(/(?:[ \t]*\n){3,}/g, "\n\n");
}

function repairFragmentedMarkdown(text: string): string {
  text = normalizeAnswerMarkdownSpacing(text);
  if (/```|<writing\b|<artifact\b/i.test(text)) return text;
  const lines = text.split(/\r?\n/);
  const nonEmpty = lines.map((line) => line.trim()).filter(Boolean);
  if (nonEmpty.length < 12) return text;
  const markdownLines = nonEmpty.filter((line) => /^(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\|)/.test(line)).length;
  const shortLines = nonEmpty.filter((line) => line.length <= 32 || line.split(/\s+/).length <= 5).length;
  const blankLines = lines.filter((line) => !line.trim()).length;
  const isPathologicallyFragmented = shortLines / nonEmpty.length >= 0.72
    && blankLines / Math.max(lines.length, 1) >= 0.28
    && markdownLines <= Math.max(2, nonEmpty.length * 0.12);
  if (!isPathologicallyFragmented) return text;

  return nonEmpty.reduce((rebuilt, line) => {
    if (!rebuilt) return line;
    const startsStructure = /^(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>)/.test(line);
    const endsSentence = /[.!?:;]$/.test(rebuilt.trim());
    return `${rebuilt}${startsStructure || endsSentence ? "\n\n" : " "}${line}`;
  }, "");
}

function resolveNumericCitations(text: string, message: Message): string {
  const references = message.webSearch?.results?.length
    ? message.webSearch.results.map((result) => result.url)
    : message.sources || [];
  if (references.length === 0) return text;

  return text.replace(/\[((?:\d+\s*,\s*)*\d+)\](?!\s*\()/g, (_match, group: string) => {
    return group
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((number) => Number.isInteger(number) && references[number - 1])
      .map((number) => `[${number}](${references[number - 1]})`)
      .join(" ");
  });
}

const MemoizedMarkdown = React.memo(function MemoizedMarkdown({
  content,
  markdownComponents,
  isStreaming,
  revealEnabled = true,
  animatePlayback = isStreaming,
}: {
  content: string;
  markdownComponents: any;
  isStreaming?: boolean;
  revealEnabled?: boolean;
  animatePlayback?: boolean;
}) {
  const displayedText = useSmoothTypewriter(content, Boolean(isStreaming), revealEnabled, Boolean(animatePlayback));
  const isActivelyTyping = revealEnabled && (Boolean(isStreaming) || displayedText.length < content.length);

  const rawText = normalizeGeneratedBreakTags(displayedText);
  const safeText = isActivelyTyping ? completePartialMarkdown(rawText) : rawText;
  const processedText = preprocessLaTeX(safeText);

  // Auto-scroll following typing edge smoothly when user is near bottom
  useEffect(() => {
    if (isActivelyTyping) {
      const el = document.querySelector(".graceful-message-item:last-child");
      if (el) {
        const parent = el.parentElement;
        if (parent && parent.scrollHeight - parent.scrollTop - parent.clientHeight < 160) {
          parent.scrollTop = parent.scrollHeight - parent.clientHeight;
        }
      }
    }
  }, [displayedText, isActivelyTyping]);

  return (
    <div className="relative">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        urlTransform={(value: string) => value}
        components={markdownComponents}
      >
        {processedText}
      </ReactMarkdown>
      {isActivelyTyping && (
        <span
          className="inline-block w-px h-[1.05em] ml-1 bg-current opacity-50 align-middle"
          aria-hidden="true"
        />
      )}
    </div>
  );
});

const UserMessageAttachment = React.memo(function UserMessageAttachment({
  attachment,
  onClick,
}: {
  attachment: any;
  onClick: () => void;
}) {
  const src =
    attachment.url ||
    `data:${attachment.type};base64,${attachment.base64}`;

  if (attachment.type.startsWith("image/")) {
    return (
      <img
        onClick={onClick}
        src={src}
        alt={attachment.name}
        className="max-w-[200px] md:max-w-[250px] max-h-[250px] rounded-[1.5rem] object-cover border border-gray-200 dark:border-[#3A3A3A] shadow-sm cursor-pointer hover:opacity-90 transition-opacity"
      />
    );
  }
  return (
    <div
      onClick={onClick}
      className="flex items-center gap-2 bg-gray-100 dark:bg-[#1A1A1A] px-4 py-3 rounded-2xl border border-gray-200 dark:border-[#3A3A3A] w-fit shadow-sm cursor-pointer hover:bg-gray-200 dark:hover:bg-[#2A2A2A] transition-colors"
    >
      {attachment.type.startsWith("video/") ? (
        <Film size={20} className="text-blue-500 dark:text-blue-400 shrink-0" />
      ) : attachment.type.includes("spreadsheetml") ||
        attachment.type.includes("ms-excel") ? (
        <FileSpreadsheet
          size={20}
          className="text-emerald-500 dark:text-emerald-400 shrink-0"
        />
      ) : (
        <FileText
          size={20}
          className="text-gray-500 dark:text-gray-400 shrink-0"
        />
      )}
      <span className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate max-w-[200px]">
        {attachment.name}
      </span>
    </div>
  );
});

function parseStudioJson(raw: string): { title?: string; slides?: any[]; sections?: any[] } | null {
  if (!raw || typeof raw !== "string") return null;

  // 1. Strip markdown code block wrappers (```gamma-presentation ... ```)
  let clean = raw.trim();
  clean = clean.replace(/^```[a-zA-Z0-9_-]*\s*/, "").replace(/```$/, "").trim();

  // If there's extra prose text before { or after }, isolate the JSON object
  const firstBrace = clean.indexOf("{");
  const lastBrace = clean.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    clean = clean.substring(firstBrace, lastBrace + 1);
  }

  // 2. Direct JSON parse
  try {
    const parsed = JSON.parse(clean);
    if (parsed && (Array.isArray(parsed.slides) || Array.isArray(parsed.sections))) {
      return parsed;
    }
  } catch (e) {}

  // 3. Repair common AI format flaws (trailing commas, unescaped newlines/quotes)
  try {
    const repaired = clean
      .replace(/,\s*([}\]])/g, "$1") // trailing commas
      .replace(/[\r\n]+/g, " ");      // newlines in strings
    const parsed = JSON.parse(repaired);
    if (parsed && (Array.isArray(parsed.slides) || Array.isArray(parsed.sections))) {
      return parsed;
    }
  } catch (e) {}

  // 4. Robust Regex Fallback Extraction of Real Slide Objects
  if (raw.includes('"slides":') || raw.includes("slides")) {
    const titleMatch = raw.match(/"title":\s*"([^"]+)"/);
    const mainTitle = titleMatch ? titleMatch[1] : "Presentation Studio";

    const slideBlocks = raw.match(/\{[^{}]*"title"[^{}]*\}/g) || [];
    const extractedSlides: any[] = [];

    slideBlocks.forEach((block, idx) => {
      const slideTitleMatch = block.match(/"title":\s*"([^"]+)"/);
      const slideTitle = slideTitleMatch ? slideTitleMatch[1] : `Slide ${idx + 1}`;

      // Skip if title matches presentation main title (unless slide 1)
      if (idx > 0 && slideTitle === mainTitle) return;

      const subMatch = block.match(/"subtitle":\s*"([^"]+)"/);
      const sectionMatch = block.match(/"sectionLabel":\s*"([^"]+)"/);
      const accentMatch = block.match(/"accentColor":\s*"([^"]+)"/);
      const imgMatch = block.match(/"imagePrompt":\s*"([^"]+)"/);

      // Multiline bullets match using [\s\S]*? across newlines
      const bulletsMatch = block.match(/"bullets":\s*\[([\s\S]*?)\]/);
      let bullets: string[] = [];
      if (bulletsMatch && bulletsMatch[1]) {
        const rawBullets = bulletsMatch[1].match(/"([^"]+)"/g);
        if (rawBullets) {
          bullets = rawBullets.map((b: string) => b.replace(/^"|"$/g, "").trim());
        }
      }

      // Multiline bodyText match
      const bodyMatch = block.match(/"bodyText":\s*"([^"]+)"/);

      extractedSlides.push({
        id: `s${idx + 1}`,
        slideNumber: idx + 1,
        layout: idx === 0 ? "hero" : "bullets",
        sectionLabel: sectionMatch ? sectionMatch[1] : undefined,
        title: slideTitle,
        subtitle: subMatch ? subMatch[1] : undefined,
        accentColor: accentMatch ? accentMatch[1] : undefined,
        imagePrompt: imgMatch ? imgMatch[1] : undefined,
        content: {
          bullets: bullets.length > 0 ? bullets : undefined,
          bodyText: bodyMatch ? bodyMatch[1] : undefined
        }
      });
    });

    if (extractedSlides.length > 0) {
      return {
        title: mainTitle,
        slides: extractedSlides
      };
    }
  }

  return null;
}

/**
 * A synthesis retry can leave an earlier, incomplete deck before the final
 * fenced response. Prefer the last complete deck so the UI never promotes an
 * intermediate artifact over the finished one.
 */
function parseLatestStudioPresentation(raw: string): PresentationData | null {
  const fencedBlocks = [...raw.matchAll(/```[^\n]*\n([\s\S]*?)```/g)]
    .map((match) => match[1])
    .reverse();

  for (const block of fencedBlocks) {
    const parsed = parseStudioJson(block);
    if (parsed && Array.isArray(parsed.slides) && parsed.slides.length > 0) {
      return parsed as PresentationData;
    }
  }

  const parsed = parseStudioJson(raw);
  return parsed && Array.isArray(parsed.slides) && parsed.slides.length > 0
    ? (parsed as PresentationData)
    : null;
}

function presentationFromMarkdown(request: string, raw: string): PresentationData | null {
  const clean = raw
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[META_JSON:[\s\S]*?\]/g, " ")
    .replace(/<think>[\s\S]*?<\/think>/g, " ")
    .trim();
  if (clean.length < 80 || /no healthy model|could not be completed|temporarily unreachable/i.test(clean)) return null;

  const requestTitle = request
    .replace(/\b(?:please|make|create|generate|build|a|an|the|presentation|powerpoint|pptx?|slide deck|slides|about|on|for|with|using|use real images?)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const headingMatches = [...clean.matchAll(/^#{1,3}\s+(.+)$/gm)];
  const title = headingMatches[0]?.[1]?.replace(/[*_]/g, "").trim() || requestTitle || "Presentation";
  const sourceUrls = [...new Set([...clean.matchAll(/\[[^\]]+\]\((https?:\/\/[^)]+)\)/g)].map((match) => match[1]))];

  const sections: Array<{ title: string; text: string }> = [];
  if (headingMatches.length > 0) {
    headingMatches.forEach((match, index) => {
      const start = (match.index || 0) + match[0].length;
      const end = headingMatches[index + 1]?.index ?? clean.length;
      const sectionTitle = match[1].replace(/[*_]/g, "").trim();
      if (sectionTitle.toLowerCase() !== title.toLowerCase() || index > 0) {
        sections.push({ title: sectionTitle, text: clean.slice(start, end).trim() });
      }
    });
  } else {
    clean.split(/\n\s*\n+/).filter((part) => part.trim().length > 35).forEach((text, index) => {
      sections.push({ title: index === 0 ? "Overview" : `Key point ${index + 1}`, text });
    });
  }

  const contentSlides = sections.slice(0, 10).map((section, index) => {
    const bullets = section.text
      .split(/\n/)
      .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").replace(/\[[^\]]+\]\([^)]+\)/g, "").trim())
      .filter((line) => line.length > 8 && line.length < 240)
      .slice(0, 6);
    const bodyText = bullets.length < 2
      ? section.text.replace(/\[[^\]]+\]\([^)]+\)/g, "").replace(/\s+/g, " ").slice(0, 520)
      : undefined;
    return {
      id: `s${index + 2}`,
      slideNumber: index + 2,
      layout: "editorial" as const,
      title: section.title,
      visualRole: "documentary-image" as const,
      imagePrompt: `${title}: ${section.title}, factual documentary photograph`,
      content: { bullets: bullets.length >= 2 ? bullets : undefined, bodyText, sources: sourceUrls.slice(0, 4) },
    };
  }).filter((slide) => slide.content.bullets?.length || slide.content.bodyText);

  if (contentSlides.length === 0) return null;
  return {
    id: `presentation-${Date.now()}`,
    title,
    theme: "executive-slate",
    format: "presentation",
    slides: [
      {
        id: "s1",
        slideNumber: 1,
        layout: "hero",
        title,
        subtitle: "Generated from the completed research response",
        visualRole: "hero-image",
        imagePrompt: `${title}, factual documentary photograph`,
        content: { sources: sourceUrls.slice(0, 4) },
      },
      ...contentSlides,
    ],
  };
}

function ensurePosterSingleSlide(presData: PresentationData): PresentationData {
  if (!presData || !Array.isArray(presData.slides) || presData.slides.length === 0) {
    return presData;
  }

  // If already 1 slide, force layout = "poster"
  if (presData.slides.length === 1) {
    presData.slides[0].layout = "poster";
    return presData;
  }

  // Multi-slide deck returned when user requested a poster — consolidate all research facts & pillars into 1 poster slide!
  const firstSlide = presData.slides[0] || {};
  const allBullets: string[] = [];
  const allPillars: any[] = [];
  const allMetrics: any[] = [];
  const allTimeline: any[] = [];

  presData.slides.forEach((s: any, idx: number) => {
    const c = s.content || {};
    if (Array.isArray(c.bullets)) allBullets.push(...c.bullets);
    if (Array.isArray(c.characterCards)) allPillars.push(...c.characterCards);
    if (Array.isArray(c.factCards)) allMetrics.push(...c.factCards);
    if (Array.isArray(c.metrics)) allMetrics.push(...c.metrics);
    if (Array.isArray(c.timeline)) allTimeline.push(...c.timeline);

    if (s.title && idx > 0 && allPillars.length < 4) {
      allPillars.push({
        name: s.title,
        role: `PILLAR ${idx}`,
        description: s.subtitle || (c.bullets && c.bullets[0]) || `Key insights on ${s.title}`
      });
    }
  });

  const posterSlide: any = {
    id: "s1",
    slideNumber: 1,
    layout: "poster",
    sectionLabel: "A4 ACADEMIC RESEARCH POSTER",
    title: presData.title || firstSlide.title || "Academic Research Poster",
    subtitle: firstSlide.subtitle || "Comprehensive Strategic & Technical Breakdown",
    accentColor: firstSlide.accentColor || "#3B82F6",
    imagePrompt: firstSlide.imagePrompt,
    content: {
      bodyText: firstSlide.content?.bodyText || "Detailed analytical breakdown of strategic dynamics and foundational frameworks.",
      factCards: allMetrics.slice(0, 4),
      characterCards: allPillars.slice(0, 4),
      bullets: allBullets.slice(0, 4),
      timeline: allTimeline.slice(0, 4)
    }
  };

  return {
    ...presData,
    slides: [posterSlide]
  };
}

function extractRealSlidesFromCode(code: string): PresentationData | null {
  if (!code) return null;

  const mainTitleMatch = code.match(/"title":\s*"([^"]+)"/) || code.match(/Title:\s*"([^"]+)"/i) || code.match(/Title:\s*([^\*\n]+)/i);
  const mainTitle = mainTitleMatch ? mainTitleMatch[1].replace(/^["']|["']$/g, "").trim() : "Presentation Studio";

  // 1. Check for plaintext key-value slide patterns (e.g. Color: "#16a34a" * Slide 1: ... * Layout: bullets * Title: "...")
  if (code.includes("Slide ") && (code.includes("Layout:") || code.includes("Title:") || code.includes("Bullets:") || code.includes("Color:"))) {
    const rawSegments = code.split(/(?=(?:Color:|Slide\s*\d+:|\*\s*Slide\s*\d+:))/i).filter(s => s.trim().length > 0);
    const slides: any[] = [];

    rawSegments.forEach((seg, idx) => {
      const titleM = seg.match(/Title:\s*"([^"]+)"/i) || seg.match(/Title:\s*([^\*\n]+)/i);
      const numM = seg.match(/Slide\s*(\d+)/i);
      const slideNum = numM ? parseInt(numM[1], 10) : idx + 1;
      const layoutM = seg.match(/Layout:\s*"?([a-z0-9_-]+)"?/i);
      const sectionM = seg.match(/SectionLabel:\s*"([^"]+)"/i) || seg.match(/SectionLabel:\s*([^\*\n]+)/i);
      const accentM = seg.match(/Color:\s*"([^"]+)"/i) || seg.match(/Color:\s*([#a-f0-9]+)/i);
      
      const bulletsMatch = seg.match(/Bullets:\s*([\s\S]*?)(?=$|\*|\n\n)/i);
      let bullets: string[] = [];
      if (bulletsMatch && bulletsMatch[1]) {
        bullets = bulletsMatch[1]
          .split(/(?:\*\s*"|\*|\n\s*-|\n\s*\*)/)
          .map(b => b.replace(/^["'\s]+|["'\s]+$/g, "").trim())
          .filter(b => b.length > 2);
      }

      const slideTitle = titleM ? titleM[1].replace(/^["']|["']$/g, "").trim() : `Slide ${slideNum}`;

      slides.push({
        id: `s${slideNum}`,
        slideNumber: slideNum,
        layout: layoutM ? layoutM[1].toLowerCase() : (idx === 0 ? "hero" : "bullets"),
        sectionLabel: sectionM ? sectionM[1].replace(/^["']|["']$/g, "").trim() : undefined,
        title: slideTitle,
        accentColor: accentM ? accentM[1].split(" ")[0].replace(/^["']|["']$/g, "").trim() : undefined,
        imagePrompt: `${mainTitle} ${slideTitle}`,
        content: {
          bullets: bullets.length > 0 ? bullets : [`Key overview and insights on ${slideTitle}`]
        }
      });
    });

    if (slides.length > 0) {
      return {
        id: `pres-${Date.now()}`,
        title: mainTitle,
        theme: "academic-clean",
        slides
      };
    }
  }

  // 2. Try direct JSON.parse first (handles well-formed partial JSON)
  try {
    const firstBrace = code.indexOf("{");
    const lastBrace = code.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const jsonStr = code.substring(firstBrace, lastBrace + 1);
      const parsed = JSON.parse(jsonStr);
      if (parsed && Array.isArray(parsed.slides) && parsed.slides.length > 0) {
        const isPoster = /\b(poster|banner|infographic|flyer)\b/i.test(code) || (parsed.slides && parsed.slides.some((s: any) => s.layout === "poster"));
        const presResult = {
          id: parsed.id || `pres-${Date.now()}`,
          title: parsed.title || mainTitle,
          theme: parsed.theme || "academic-clean",
          slides: parsed.slides
        };
        return isPoster ? ensurePosterSingleSlide(presResult) : presResult;
      }
    }
  } catch (_e) { /* partial JSON, fall through to regex */ }

  // 3. Fallback to regex extraction — skip wrapper objects that contain "slides":
  const slideRegex = /\{\s*"(?:id|slideNumber|layout|sectionLabel)"[\s\S]*?(?=\{\s*"(?:id|slideNumber|layout|sectionLabel)"|$)/g;
  const slideBlocks = (code.match(slideRegex) || []).filter(block => {
    // Skip the outer wrapper object (it contains "slides":[ which is NOT a slide itself)
    return !/"slides"\s*:\s*\[/.test(block);
  });

  const slides: any[] = [];

  slideBlocks.forEach((block, idx) => {
    const titleM = block.match(/"title":\s*"([^"]+)"/);
    const subM = block.match(/"subtitle":\s*"([^"]+)"/);
    const sectionM = block.match(/"sectionLabel":\s*"([^"]+)"/);
    const accentM = block.match(/"accentColor":\s*"([^"]+)"/);
    const imgM = block.match(/"imagePrompt":\s*"([^"]+)"/);
    const bodyM = block.match(/"bodyText":\s*"([^"]+)"/);

    const bulletsMatch = block.match(/"bullets":\s*\[([\s\S]*?)\]/);
    let bullets: string[] = [];
    if (bulletsMatch && bulletsMatch[1]) {
      const rawB = bulletsMatch[1].match(/"([^"\\]*(?:\\.[^"\\]*)*)"/g);
      if (rawB) {
        bullets = rawB.map(b => b.replace(/^"|"$/g, "").replace(/\\"/g, '"').trim()).filter(b => b.length > 0);
      }
    }

    const slideTitle = titleM ? titleM[1] : (idx === 0 ? mainTitle : `Slide ${idx + 1}`);

    slides.push({
      id: `s${idx + 1}`,
      slideNumber: idx + 1,
      layout: idx === 0 ? "hero" : "bullets",
      sectionLabel: sectionM ? sectionM[1] : undefined,
      title: slideTitle,
      subtitle: subM ? subM[1] : undefined,
      accentColor: accentM ? accentM[1] : undefined,
      imagePrompt: imgM ? imgM[1] : `${mainTitle} ${slideTitle}`,
      content: {
        bullets: bullets.length > 0 ? bullets : undefined,
        bodyText: bodyM ? bodyM[1] : undefined
      }
    });
  });

  if (slides.length === 0) return null;

  return {
    id: `pres-${Date.now()}`,
    title: mainTitle,
    theme: "academic-clean",
    slides
  };
}


function convertHtmlToPresentation(title: string, htmlContent: string): PresentationData {
  const cleanTitle = title || "Presentation";
  const slides: any[] = [];

  const headerRegex = /<h[1-3][^>]*>(.*?)<\/h[1-3]>/gi;
  const headings: { title: string; index: number }[] = [];
  let hMatch;
  while ((hMatch = headerRegex.exec(htmlContent)) !== null) {
    headings.push({
      title: hMatch[1].replace(/<[^>]+>/g, "").trim(),
      index: hMatch.index
    });
  }

  if (headings.length > 0) {
    headings.forEach((h, idx) => {
      const start = h.index;
      const end = idx < headings.length - 1 ? headings[idx + 1].index : htmlContent.length;
      const block = htmlContent.slice(start, end);
      
      const bulletMatches = block.match(/<(?:li|p|div)[^>]*>(.*?)<\/(?:li|p|div)>/gi) || [];
      const bullets = bulletMatches
        .map(b => b.replace(/<[^>]+>/g, "").trim())
        .filter(b => b.length > 0 && b !== h.title)
        .slice(0, 4);

      slides.push({
        id: `s${idx + 1}`,
        slideNumber: idx + 1,
        layout: idx === 0 ? "hero" : "bullets",
        title: h.title,
        subtitle: idx === 0 ? `Overview of ${cleanTitle}` : undefined,
        content: { bullets: bullets.length > 0 ? bullets : ["Key insights & analysis"] }
      });
    });
  }

  if (slides.length === 0) {
    const rawText = htmlContent.replace(/<[^>]+>/g, "\n");
    const lines = rawText.split(/\n+/).map(l => l.trim()).filter(l => l.length > 0);
    slides.push({
      id: "s1",
      slideNumber: 1,
      layout: "hero",
      title: cleanTitle,
      subtitle: "Presentation Summary",
      content: { bullets: lines.slice(0, 4) }
    });
  }

  return {
    id: `pres-${Date.now()}`,
    title: cleanTitle,
    subtitle: `Presentation Deck: ${cleanTitle}`,
    theme: "cosmic-dark",
    slides
  };
}

const AssistantMessageContent = React.memo(function AssistantMessageContent({
  msg,
  index,
  previousUserContent,
  loadingStage,
  isWebSearch,
  userEmail,
  setSelectedMessageForSources,
  setActiveArtifact,
  imageReplacementsRef,
  setMessages,
  supabase,
  conversationId,
  markdownComponents,
  setPreviewAttachment,
}: {
  msg: any;
  index: number;
  previousUserContent: string;
  loadingStage: string;
  isWebSearch: boolean;
  userEmail?: string | null;
  setSelectedMessageForSources: (m: any) => void;
  setActiveArtifact: (a: any) => void;
  imageReplacementsRef: any;
  setMessages: React.Dispatch<React.SetStateAction<any[]>>;
  supabase: any;
  conversationId?: string;
  markdownComponents: any;
  setPreviewAttachment?: (a: any) => void;
}) {
  const { theme } = useTheme();
  const [animateGeneratedText] = React.useState(Boolean(msg?.isStreaming));
  const [loadedMediaKey, setLoadedMediaKey] = React.useState("");
  const rawContent = typeof msg?.content === "string" ? msg.content : "";
  const { thinkContent, displayContent: cleanDisplayContent } = extractThinkAndDisplayContent(rawContent);
  let displayContent = normalizeGeneratedBreakTags(cleanDisplayContent);

  const msgForPill = { ...msg };

  // 1. Always strip [META: thoughtTime=... model=...] from displayContent FIRST
  const metaMatchOld = displayContent.match(/\[META:\s*thoughtTime=(\d+)(?:\s+model=([^\]]+))?\]/);
  if (metaMatchOld) {
    msgForPill.thoughtTime = parseInt(metaMatchOld[1], 10);
    msgForPill.modelName = metaMatchOld[2];
    displayContent = displayContent.replace(/\[META:\s*thoughtTime=\d+(?:\s+model=[^\]]+)?\]\s*/g, "").trim();
  }

  // 2. Cleanly extract and strip [META_JSON: ...] BEFORE any rendering
  const metaJsonStart = displayContent.indexOf("[META_JSON:");
  if (metaJsonStart !== -1) {
    const rawMetaBlock = displayContent.slice(metaJsonStart);
    displayContent = displayContent.slice(0, metaJsonStart).trim();
    const jsonMatch = rawMetaBlock.match(/\[META_JSON:\s*([\s\S]*?)(?:\]\s*$|\](?=\s*\n))/);
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : rawMetaBlock.replace(/^\[META_JSON:\s*/, "").replace(/\]+\s*$/, "").trim();
    try {
      const parsed = JSON.parse(jsonStr);
      if (parsed) {
        if (parsed.statusLogs) msgForPill.statusLogs = parsed.statusLogs;
        if (parsed.effortInfo) msgForPill.effortInfo = parsed.effortInfo;
        if (parsed.effortRecovery) msgForPill.effortRecovery = parsed.effortRecovery;
        if (parsed.sources) msgForPill.sources = parsed.sources;
        if (parsed.webSearch) msgForPill.webSearch = parsed.webSearch;
        if (parsed.media) msgForPill.media = parsed.media;
        // Extract thoughtTime and model from consolidated META_JSON
        if (parsed.thoughtTime && !msgForPill.thoughtTime) msgForPill.thoughtTime = parsed.thoughtTime;
        if (parsed.model && !msgForPill.modelName) msgForPill.modelName = parsed.model;
      }
    } catch (e) {
      // Catch partial JSON parse attempts quietly
    }
  }

  // 3. Cleanly extract and strip [ARTIFACT_META: ...] BEFORE any rendering
  const artifactMetaStart = displayContent.indexOf("[ARTIFACT_META:");
  let artifactMeta: { title?: string; overview?: string; description?: string } | null = null;
  if (artifactMetaStart !== -1) {
    const rawMetaBlock = displayContent.slice(artifactMetaStart);
    displayContent = displayContent.slice(0, artifactMetaStart).trim();
    const jsonMatch = rawMetaBlock.match(/\[ARTIFACT_META:\s*(\{[\s\S]*?\})(?:\]\s*$|\](?=\s*\n))/);
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : rawMetaBlock.replace(/^\[ARTIFACT_META:\s*/, "").replace(/\]+\s*$/, "").trim();
    try {
      artifactMeta = JSON.parse(jsonStr);
    } catch (e) {
      // Catch partial JSON parse attempts quietly
    }
  }

  // 4. Final fallback: check raw content for [META: ...] that may not have been in displayContent
  const metaMatch = rawContent.match(/\[META:\s*thoughtTime=(\d+)(?:\s+model=([^\]]+))?\]/);
  if (metaMatch && !msgForPill.thoughtTime) {
    msgForPill.thoughtTime = parseInt(metaMatch[1], 10);
    msgForPill.modelName = metaMatch[2];
  }

  msgForPill.statusLogs = visibleProgressLogs(msgForPill.statusLogs);

  const isPresentationReview = /\b(?:rate|review|evaluate|critique|score|assess)\b[\s\S]{0,80}\b(?:presentation|powerpoint|pptx?|slide deck|slides)\b/i.test(previousUserContent)
    && !isPresentationCreationRequest(previousUserContent);

  // Extract any markdown or HTML web images from displayContent so they never appear randomly in prose
  const { cleanContent, extractedWebImages } = extractAndStripWebImages(displayContent);
  displayContent = cleanContent;

  const rawImages: any[] = [
    ...(msgForPill.media?.images || []),
    ...(msgForPill.webSearch?.images?.map((url: string) => ({ url })) || []),
    ...extractedWebImages,
  ];
  const candidateImages = mergeChatMediaImages([], rawImages)
    .sort((left, right) => (right.confidence ?? 0) - (left.confidence ?? 0))
    .slice(0, 3);

  const candidateResponseMedia: MediaPayload | undefined = isPresentationReview || isStudioCreationRequest(previousUserContent) || candidateImages.length === 0
    ? undefined
    : {
        query: msgForPill.media?.query || msgForPill.webSearch?.query || "",
        placement: msgForPill.media?.placement || "lead",
        images: candidateImages,
      };
  // Verified images appear first as soon as retrieval finishes.
  const responseMedia = candidateResponseMedia;
  const mediaKey = responseMedia?.images.map((image) => image.url).join("|") || "";
  const textRevealReady = !responseMedia || loadedMediaKey === mediaKey;

  displayContent = stripOrphanImageMarkdown(displayContent, Boolean(responseMedia));
  displayContent = stripTrailingSourcesSection(displayContent);
  displayContent = resolveNumericCitations(displayContent, msgForPill);
  displayContent = placeCitationsAtParagraphEnds(displayContent, msgForPill);

  const combinedRegex =
    /(?:\[GENERATE_IMAGE:\s*([^\]]+)\])|(?:<writing\s*([^>]*?)>([\s\S]*?)(?:<\/writing>|$))|(?:<(?:artifact|antArtifact)\s*([^>]*?)>([\s\S]*?)(?:<\/(?:artifact|antArtifact)>|$))/gi;
  const segments: {
    type: "text" | "image" | "artifact" | "media" | "writing";
    content: string;
    identifier?: string;
    artifactType?: string;
    title?: string;
    writingType?: string;
  }[] = [];
  let lastIndex = 0;
  let match;

  while ((match = combinedRegex.exec(displayContent)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        type: "text",
        content: displayContent.slice(lastIndex, match.index).trim(),
      });
    }

    if (match[1]) {
      segments.push({
        type: "image",
        content: match[1].trim(),
      });
    } else if (match[2] !== undefined && match[3] !== undefined) {
      const attrString = match[2];
      const writingContent = match[3].trim();
      const typeMatch = attrString.match(/(?:type|label)=["']([^"']+)["']/i);
      const rawType = (typeMatch?.[1] || "").toLowerCase().trim();
      if (rawType === "bio" || rawType === "biography" || rawType === "description") {
        segments.push({
          type: "text",
          content: writingContent,
        });
      } else {
        segments.push({
          type: "writing",
          content: writingContent,
          writingType: typeMatch?.[1] || inferWritingType(writingContent) || "Writing",
        });
      }
    } else if (match[4] !== undefined && match[5] !== undefined) {
      const attrString = match[4];
      const artifactContent = match[5].trim();

      const idMatch =
        attrString.match(/identifier=["']?([^"'\s>]+)["']?/i) ||
        attrString.match(/id=["']?([^"'\s>]+)["']?/i);
      const typeMatch =
        attrString.match(/type=["']?([^"'\s>]+)["']?/i) ||
        attrString.match(/language=["']?([^"'\s>]+)["']?/i);
      const titleMatch = attrString.match(/title=["']?([^"'\s>]+)["']?/i);

      const identifier = idMatch ? idMatch[1] : `artifact-${segments.length}`;
      const artifactType = typeMatch ? typeMatch[1] : "html";
      const rawTitle = titleMatch ? titleMatch[1] : identifier;
      const title = rawTitle
        .replace(/[-_]/g, " ")
        .replace(/\b\w/g, (l) => l.toUpperCase());

      // Intercept artifacts that are actually single image generations or pollinations links
      const pollinationsMatch = artifactContent.match(
        /image\.pollinations\.ai\/prompt\/([^?#"'\s>]+)/i,
      );
      const singleImgMatch = artifactContent.match(
        /^<img\s+[^>]*src=["']([^"']+)["'][^>]*\/?>$/i,
      );

      if (pollinationsMatch) {
        const rawPrompt = decodeURIComponent(pollinationsMatch[1]).replace(
          /%20/g,
          " ",
        );
        segments.push({
          type: "image",
          content: rawPrompt,
        });
      } else if (singleImgMatch) {
        segments.push({
          type: "text",
          content: `![${title}](${singleImgMatch[1]})`,
        });
      } else {
        segments.push({
          type: "artifact",
          identifier,
          artifactType,
          title,
          content: artifactContent,
        });
      }
    }

    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < displayContent.length) {
    segments.push({
      type: "text",
      content: displayContent.slice(lastIndex).trim(),
    });
  }

  if (segments.length === 0) {
    let finalContent = displayContent;
    if (!msg.isStreaming && !displayContent) {
      finalContent = "*(No response generated by the model)*";
    }
    segments.push({ type: "text", content: finalContent });
  }

  if (responseMedia?.placement === "lead") {
    segments.unshift({ type: "media", content: "" });
  } else if (responseMedia) {
    const firstTextIndex = segments.findIndex((segment) => segment.type === "text" && segment.content.trim());
    if (firstTextIndex < 0) {
      segments.unshift({ type: "media", content: "" });
    } else {
      const firstText = segments[firstTextIndex];
      const paragraphBreak = firstText.content.indexOf("\n\n");
      if (paragraphBreak > 0) {
        segments.splice(
          firstTextIndex,
          1,
          { ...firstText, content: firstText.content.slice(0, paragraphBreak).trim() },
          { type: "media", content: "" },
          { ...firstText, content: firstText.content.slice(paragraphBreak).trim() },
        );
      } else {
        segments.splice(firstTextIndex + 1, 0, { type: "media", content: "" });
      }
    }
  }

  // Only the final complete presentation block is allowed to create a card.
  // This prevents a retry/partial deck from appearing next to the final deck.
  const latestPresentationCode = (() => {
    const blocks = [...displayContent.matchAll(/```[^\n]*\n([\s\S]*?)```/g)]
      .map((match) => match[1].trim())
      .reverse();
    return blocks.find((block) => {
      const parsed = parseStudioJson(block);
      return Boolean(parsed && Array.isArray(parsed.slides) && parsed.slides.length > 0);
    }) || null;
  })();

  const hasAnyImage =
    /<img\s+[^>]*src=["']([^"']+)["']/i.test(rawContent) ||
    /image\.pollinations\.ai/i.test(rawContent);

  const [imageLoaded, setImageLoaded] = React.useState(!hasAnyImage);

  const openEditablePoster = React.useCallback(async (imageUrl?: string, imageAlt?: string) => {
    if (!imageUrl) throw new Error("The generated poster image is unavailable.");
    const landscape = /\b(?:landscape|horizontal|wide|banner)\b/i.test(previousUserContent);
    const isInfographic = isInfographicCreationRequest(previousUserContent);
    const title = previousUserContent
      .replace(/^\s*(?:(?:please|can you|could you)\s+)?(?:make|create|generate|genrate|design|render)\s+(?:an?\s+)?(?:poster|flyer|banner|infographics?|information graphic|visual (?:analysis|explainer|summary|overview|breakdown)|at[- ]a[- ]glance)\s*(?:about|on|for|of)?\s*/i, "")
      .replace(/\s+/g, " ").trim().slice(0, 100) || "Generated Poster";
    const presentationData = normalizePresentation({
      id: `poster-${Date.now()}`,
      title,
      format: isInfographic ? "infographic" : "poster",
      theme: "academic-clean",
      canvasAspectRatio: landscape ? "3:2" : "2:3",
      slides: [{
        id: "s1",
        slideNumber: 1,
        layout: "raster-poster",
        title,
        imageUrl,
        imagePrompt: imageAlt || previousUserContent,
        visualRole: "hero-image",
        content: {},
      }],
    });
    setActiveArtifact({
      identifier: presentationData.id,
      type: "poster",
      title: presentationData.title,
      content: JSON.stringify(presentationData),
      presentationData,
    });
  }, [previousUserContent, setActiveArtifact]);

  const customMarkdownComponents = React.useMemo(
    () => ({
      ...markdownComponents,
      img: (props: any) => (
        <MarkdownImage
          {...props}
          setPreviewAttachment={setPreviewAttachment}
          onCustomizePoster={isPosterCreationRequest(previousUserContent) ? openEditablePoster : undefined}
          artifactKind={isInfographicCreationRequest(previousUserContent) ? "infographic" : "poster"}
          onLoadedStateChange={(loaded: boolean) => {
            if (loaded) setImageLoaded(true);
          }}
        />
      ),
      code({ node, inline, className, children, ...props }: any) {
        const match = /language-([^\s]+)/.exec(className || "");
        const lang = (match ? match[1] : "").toLowerCase();
        const rawValue = String(children);
        const rawCode = rawValue.replace(/\n$/, "");
        const isInlineCode = inline === true || (!className && !rawValue.includes("\n"));

        if (isInlineCode) {
          return (
            <code
              className="bg-gray-100 dark:bg-[#2A2A2A] px-1.5 py-0.5 rounded text-sm text-amber-700 dark:text-amber-200 font-mono"
              {...props}
            >
              {children}
            </code>
          );
        }

        const writingType = inferWritingType(rawCode, lang);
        if (writingType) {
          return (
            <WritingBlock
              label={writingType}
              content={rawCode}
              isStreaming={Boolean(msg.isStreaming)}
            />
          );
        }

        const parsedStudio = parseStudioJson(rawCode);
        const chartRequestedByUser = /\b(?:chart|graph|plot|data visualization|visualise|visualize)\b/i.test(previousUserContent)
          && /\b(?:make|create|generate|build|draw|plot|show|compare|visualise|visualize)\b/i.test(previousUserContent);
        // Several fallback models return the correct native-chart JSON under a
        // generic `json` fence. The user's request plus schema validation is a
        // safer discriminator than trusting the fence label alone.
        const chartData = (["chart", "barchart", "visualization", "plot"].includes(lang)
          || (lang === "json" && (chartRequestedByUser || analysisMayBenefitFromChart(previousUserContent))))
          ? parseChartData(rawCode)
          : null;

        if (chartData) {
          return (
            <div className="my-5 w-full overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-[#3A3A3A] dark:bg-[#242424]">
              <div className="min-w-[520px]">
                <ChartViewer data={chartData} />
              </div>
            </div>
          );
        }

        // 1. Presentation detection:
        const isPresentationBlock =
          ["gamma-presentation", "gamma", "presentation", "ppt", "slides"].includes(lang) ||
          rawCode.includes('"slides":') ||
          (rawCode.includes("Slide ") &&
            (rawCode.includes("Bullets:") || rawCode.includes("Layout:")));

        // A model mentioning or evaluating a deck must never turn an accidental
        // presentation-shaped payload into an editable artifact.
        if (isPresentationBlock && !isStudioCreationRequest(previousUserContent)) {
          return null;
        }

        if (isPresentationBlock) {
          const presentationRequest = previousUserContent || displayContent;
          const presData =
            (parsedStudio && parsedStudio.slides
              ? (parsedStudio as PresentationData)
              : null)
            || extractRealSlidesFromCode(rawCode)
            || parseLatestStudioPresentation(rawCode)
            || presentationFromMarkdown(presentationRequest, rawCode);
          const extractedTitleMatch = rawCode.match(/"title":\s*"([^"]+)"/);
          const displayTitle =
            presData?.title ||
            (extractedTitleMatch ? extractedTitleMatch[1] : "Presentation Deck");
          const slideMatches = rawCode.match(/"slideNumber":\s*\d+/g);
          const displaySlideCount =
            presData?.slides?.length || (slideMatches ? slideMatches.length : 1);

          if (msg.isStreaming) return null;

          if (latestPresentationCode && rawCode.trim() !== latestPresentationCode) {
            return null;
          }

          if (presData) {
            return (
              <div
                onClick={() => {
                  const finalData = presData || extractRealSlidesFromCode(rawCode);
                  if (finalData) {
                    const normalized = normalizePresentation(finalData);
                    if (isPosterCreationRequest(previousUserContent) && !hasRenderablePosterContent(normalized)) return;
                    setActiveArtifact({
                      identifier: "presentation",
                      type: "presentation",
                      title: displayTitle,
                      content: rawCode,
                      presentationData: normalized,
                    });
                  }
                }}
                className="my-3 inline-flex items-center gap-3 px-4 py-2.5 bg-[#18181B] hover:bg-[#202024] border border-[#27272A] rounded-2xl shadow-lg transition-all group max-w-full cursor-pointer"
              >
                <div className="p-1.5 rounded-xl bg-[#27272A] text-white border border-[#3F3F46] shrink-0">
                  <Sparkles size={16} />
                </div>
                <div className="min-w-0 flex-1 flex items-center gap-2.5 overflow-hidden">
                  <span className="text-xs font-bold text-white truncate max-w-[200px] sm:max-w-md">
                    {displayTitle}
                  </span>
                  <span className="text-[10px] font-mono font-bold text-gray-200 bg-[#27272A] px-2 py-0.5 rounded-lg shrink-0 border border-[#3F3F46]">
                    {displaySlideCount} {displaySlideCount === 1 ? "Slide" : "Slides"}
                  </span>
                </div>
                <span className="px-3 py-1.5 bg-white group-hover:bg-gray-200 text-black text-xs font-bold rounded-xl flex items-center gap-1.5 transition-all shadow-md shrink-0">
                  <Eye size={13} />
                  <span>Open Preview</span>
                </span>
              </div>
            );
          }
        }

        // 2. Canva Document detection:
        const isCanvaDocBlock =
          ["canva-doc", "canvadoc", "canva"].includes(lang) ||
          (parsedStudio && parsedStudio.sections);
        if (isCanvaDocBlock) {
          const docData =
            parsedStudio && parsedStudio.sections
              ? (parsedStudio as ReportData)
              : null;
          const extractedTitleMatch = rawCode.match(/"title":\s*"([^"]+)"/);
          const displayTitle =
            docData?.title ||
            (extractedTitleMatch ? extractedTitleMatch[1] : "Executive Document");
          const sectionMatches = rawCode.match(/"id":\s*"sec-\d+"/g);
          const displaySectionCount =
            docData?.sections?.length ||
            (sectionMatches ? sectionMatches.length : 1);

          if (docData) {
            return (
              <div
                onClick={() => {
                  if (docData)
                    setActiveArtifact({
                      identifier: "document",
                      type: "report",
                      title: displayTitle,
                      content: rawCode,
                      reportData: docData,
                    });
                }}
                className="my-3 inline-flex items-center gap-3 px-4 py-2.5 bg-[#18181B] hover:bg-[#202024] border border-[#27272A] rounded-2xl shadow-lg transition-all group max-w-full cursor-pointer"
              >
                <div className="p-1.5 rounded-xl bg-[#27272A] text-white border border-[#3F3F46] shrink-0">
                  <FileText size={16} />
                </div>
                <div className="min-w-0 flex-1 flex items-center gap-2.5 overflow-hidden">
                  <span className="text-xs font-bold text-white truncate max-w-[200px] sm:max-w-md">
                    {displayTitle}
                  </span>
                  <span className="text-[10px] font-mono font-bold text-gray-200 bg-[#27272A] px-2 py-0.5 rounded-lg shrink-0 border border-[#3F3F46]">
                    {displaySectionCount} Sections
                  </span>
                  {msg.isStreaming && (
                    <span className="text-[10px] font-mono text-gray-400 animate-pulse flex items-center gap-1 ml-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-ping" />
                      Writing...
                    </span>
                  )}
                </div>
                <span className="px-3 py-1.5 bg-white group-hover:bg-gray-200 text-black text-xs font-bold rounded-xl flex items-center gap-1.5 transition-all shadow-md shrink-0">
                  <Eye size={13} />
                  <span>Open Preview</span>
                </span>
              </div>
            );
          }
        }

        // 3. Website / HTML / Web App detection:
        const isHtmlOrSvgBlock =
          ["html", "htm", "xhtml", "svg", "react"].includes(lang) ||
          rawCode.toLowerCase().includes("<!doctype html") ||
          rawCode.toLowerCase().includes("<html") ||
          (rawCode.startsWith("<svg") && rawCode.includes("</svg>"));

        if (isHtmlOrSvgBlock) {
          const extractedTitleMatch = rawCode.match(/<title>(.*?)<\/title>/i);
          const displayTitle = extractedTitleMatch ? extractedTitleMatch[1].trim() : "Web Preview";

          // A partial streamed document may have an opening fence but no
          // closing tags or script yet. Never open that transient blank page.
          if (msg.isStreaming) return null;

          return (
            <div
              onClick={() => {
                setActiveArtifact({
                  identifier: "website",
                  type: lang === "svg" ? "svg" : "html",
                  title: displayTitle,
                  content: rawCode,
                });
              }}
              className="my-3 inline-flex items-center gap-3 px-4 py-2.5 bg-[#18181B] hover:bg-[#202024] border border-[#27272A] rounded-2xl shadow-lg transition-all group max-w-full cursor-pointer"
            >
              <div className="p-1.5 rounded-xl bg-[#27272A] text-white border border-[#3F3F46] shrink-0">
                <Globe size={16} />
              </div>
              <div className="min-w-0 flex-1 flex items-center gap-2.5 overflow-hidden">
                <span className="text-xs font-bold text-white truncate max-w-[200px] sm:max-w-md">
                  {displayTitle}
                </span>
                <span className="text-[10px] font-mono font-bold text-gray-200 bg-[#27272A] px-2 py-0.5 rounded-lg shrink-0 border border-[#3F3F46]">
                  {lang === "svg" ? "VECTOR SVG" : "WEBSITE"}
                </span>
                {msg.isStreaming && (
                  <span className="text-[10px] font-mono text-gray-400 animate-pulse flex items-center gap-1 ml-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-ping" />
                    Writing...
                  </span>
                )}
              </div>
              <span className="px-3 py-1.5 bg-white group-hover:bg-gray-200 text-black text-xs font-bold rounded-xl flex items-center gap-1.5 transition-all shadow-md shrink-0">
                <Eye size={13} />
                <span>Open Preview</span>
              </span>
            </div>
          );
        }

        // 4. Fallback for other languages (Python, JSON, etc.)
        return (
          <CodeBlockWithPreview
            language={lang}
            code={rawCode}
            theme={theme}
            setActiveArtifact={setActiveArtifact}
            rawProps={props}
          />
        );
      },
    }),
    [markdownComponents, theme, setActiveArtifact, setPreviewAttachment, msg.isStreaming, previousUserContent, openEditablePoster, index, displayContent, latestPresentationCode],
  );

  // 8. Fallback thought content using status logs if LLM didn't output <think>
  const uniqueStatusLogs = Array.from(
    new Map(
      visibleProgressLogs(msgForPill.statusLogs).map((log: any) => [
        `${log.action || ""}|${log.query || ""}`,
        log,
      ]),
    ).values(),
  ) as any[];
  const fallbackThinkContent = (uniqueStatusLogs.length > 0 && msg.content && msg.content.trim())
    ? uniqueStatusLogs.map((log: any) => `- ${log.action}${log.query ? ` (${log.query})` : ''}`).join('\n')
    : null;
  const finalThinkContent = visibleThinkingText(thinkContent) || fallbackThinkContent;

  return (
    <>
      {msg.isStreaming && !displayContent.trim() && (
        <DynamicLoader
          stage={loadingStage}
          webSearchEnabled={isWebSearch}
          isGeneratingImage={false}
          prompt={previousUserContent}
          statusLogs={uniqueStatusLogs}
        />
      )}
      {/* Removed WebSearchPanel per user request */}

      <SourcesPill
        msg={msgForPill}
        onClick={() => setSelectedMessageForSources(msgForPill)}
      />
      
      {((finalThinkContent || (msgForPill.thoughtTime !== undefined && msgForPill.thoughtTime > 0)) && 
        (!msg.isStreaming || displayContent.length > 0)) ? (
        <ThinkingBlock 
          content={finalThinkContent} 
          thoughtTime={msgForPill.thoughtTime} 
          isStreaming={msg.isStreaming} 
        />
      ) : null}

      <div className="assistant-text-content w-full min-w-0 max-w-full space-y-4">
        {segments.map((seg, segIdx) => {
          if (seg.type === "media" && responseMedia) {
            return (
              <WebSearchImageGrid
                key={`media-${segIdx}`}
                images={responseMedia.images}
                query={responseMedia.query}
                placement={responseMedia.placement}
                onReady={() => setLoadedMediaKey(mediaKey)}
                onPreview={(image, imageIndex) => {
                  setPreviewAttachment?.({
                    url: image.displayUrl,
                    name: image.title || `Web image ${imageIndex + 1}`,
                    type: "image/jpeg",
                  });
                }}
              />
            );
          }
          if (seg.type === "image") {
            return (
              <GeneratedImageBlock userEmail={userEmail} 
                key={`img-${segIdx}`}
                prompt={seg.content}
                messageId={msg.id}
                onLoadedStateChange={(loaded) => {
                  if (loaded) setImageLoaded(true);
                }}
                onGenerated={async (id, p, url) => {
                  imageReplacementsRef.current[p] = url;
                  const newContent = msg.content.replace(
                    `[GENERATE_IMAGE: ${p}]`,
                    `![${p}](${url})`,
                  );

                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === id || m === msg ? { ...m, content: newContent } : m,
                    ),
                  );

                  if (id) {
                    try {
                      await supabase
                        .from("messages")
                        .update({ content: newContent })
                        .eq("id", id);
                    } catch (e) {
                      console.error("Failed to save generated image to DB", e);
                    }
                  } else if (conversationId) {
                    try {
                      await supabase
                        .from("messages")
                        .update({ content: newContent })
                        .eq("conversation_id", conversationId)
                        .like("content", `%[GENERATE_IMAGE: ${p}]%`);
                    } catch (e) {}
                  }
                }}
              />
            );
          }
          if (seg.type === "writing") {
            return (
              <WritingBlock
                key={`writing-${segIdx}`}
                label={seg.writingType}
                content={seg.content}
                isStreaming={Boolean(msg.isStreaming && segIdx === segments.length - 1)}
                revealEnabled={textRevealReady}
                animatePlayback={animateGeneratedText}
              />
            );
          }
          if (seg.type === "artifact") {
            const isPresentationArtifact =
              /presentation|slide|ppt|movie|deck/i.test(seg.title || "") ||
              seg.artifactType === "presentation";
            const hasNewerPresentationArtifact = isPresentationArtifact && segments
              .slice(segIdx + 1)
              .some((candidate) => candidate.type === "artifact" && (
                /presentation|slide|ppt|movie|deck/i.test(candidate.title || "") ||
                candidate.artifactType === "presentation"
              ));

            if (isPresentationArtifact && msg.isStreaming) return null;
            if (hasNewerPresentationArtifact) return null;

            const convertedPres = isPresentationArtifact
              ? convertHtmlToPresentation(seg.title || "Presentation", seg.content)
              : null;
            const isReportArtifact =
              /report|document|canva/i.test(seg.title || "") ||
              seg.artifactType === "report" ||
              seg.artifactType === "canva-doc";

            const typeLabel = (seg.artifactType || (isPresentationArtifact ? "presentation" : isReportArtifact ? "document" : "html")).toUpperCase();

            return (
              <div
                key={`art-${segIdx}`}
                onClick={() =>
                  setActiveArtifact({
                    identifier: seg.identifier || `art-${segIdx}`,
                    type: seg.artifactType || (isPresentationArtifact ? "presentation" : isReportArtifact ? "report" : "html"),
                    title: seg.title || "Artifact",
                    content: seg.content,
                    presentationData: convertedPres || undefined,
                  })
                }
                className="my-3 inline-flex items-center gap-3 px-4 py-2.5 bg-[#18181B] hover:bg-[#202024] border border-[#27272A] rounded-2xl shadow-lg transition-all group max-w-full cursor-pointer"
              >
                <div className="p-1.5 rounded-xl bg-[#27272A] text-white border border-[#3F3F46] shrink-0">
                  {isPresentationArtifact ? (
                    <Sparkles size={16} />
                  ) : isReportArtifact ? (
                    <FileText size={16} />
                  ) : (
                    <Globe size={16} />
                  )}
                </div>
                <div className="min-w-0 flex-1 flex items-center gap-2.5 overflow-hidden">
                  <span className="text-xs font-bold text-white truncate max-w-[200px] sm:max-w-md">
                    {seg.title || "Artifact"}
                  </span>
                  <span className="text-[10px] font-mono font-bold text-gray-200 bg-[#27272A] px-2 py-0.5 rounded-lg shrink-0 border border-[#3F3F46]">
                    {typeLabel}
                  </span>
                </div>
                <span className="px-3 py-1.5 bg-white group-hover:bg-gray-200 text-black text-xs font-bold rounded-xl flex items-center gap-1.5 transition-all shadow-md shrink-0">
                  <Eye size={13} />
                  <span>Open Preview</span>
                </span>
              </div>
            );
          }
          if (!seg.content) return null;
          const isLastSegment = segIdx === segments.length - 1;
          const cleanTextContent = repairFragmentedMarkdown(seg.content).replace(
            /<img\s+[^>]*src=["']([^"']+)["'][^>]*\/?>/gi,
            (m, src) => `![image](${src})`,
          );
          return (
            <MemoizedMarkdown
              key={`text-${segIdx}`}
              content={cleanTextContent}
              markdownComponents={customMarkdownComponents}
              isStreaming={msg.isStreaming && isLastSegment}
              revealEnabled={textRevealReady}
              animatePlayback={animateGeneratedText}
            />
          );
        })}
      </div>
    </>
  );
});

export const getUsageKey = (modelName: string) => {
  switch (modelName) {
    case "Llama 70B": return "llama_70b";
    case "Llama 3.3 70B": return "llama_70b";
    case "Llama 3.1 Fast": return "llama_3_1_fast";
    case "Llama 3.1 8B": return "llama_3_1_fast";
    case "Gemini 1.5 Flash": return "gemini_1_5_flash";
    case "GPT-OSS 120B": return "gpt_oss_120b";
    case "Llama 4 Scout": return "llama_4_scout";
    case "GPT-OSS 20B": return "gpt_oss_20b";
    case "FLUX V1": return "flux_v1";
    case "FLUX Realism": return "flux_realism";
    case "FLUX Anime": return "flux_anime";
    case "FLUX 3D": return "flux_3d";
    case "HF Super Realism": return "hf_super_realism";
    case "Ideogram": return "ideogram";
    case "Gemini Image": return "gemini_image";
    case "Void Voice Agent": return "voice_agent";
    default: return "llama_3_1_fast";
  }
};

export const MODEL_CATEGORIES = [{
  id: "automatic", name: "Automatic", icon: <AutoGlyph size={14} />,
  models: [{ name: "Auto", desc: "Routes automatically with provider failover", maxUsage: 22000000, contextWindow: "Adaptive" }],
}];
export const LLM_MODELS = MODEL_CATEGORIES.flatMap((category) => category.models);

export const IMG_MODELS = [
  { name: "Auto Image", desc: "Automatically tries available image providers", maxUsage: Infinity, contextWindow: "Adaptive" },
  { name: "Cloudflare FLUX.1 Schnell", desc: "Custom hosted FLUX.1 Schnell worker", maxUsage: Infinity, contextWindow: "N/A" },
  { name: "FLUX V1", desc: "High quality image generation", maxUsage: Infinity, contextWindow: "N/A" },
  { name: "FLUX Realism", desc: "Photorealistic style", maxUsage: Infinity, contextWindow: "N/A" },
  { name: "FLUX Anime", desc: "High quality anime style", maxUsage: Infinity, contextWindow: "N/A" },
  { name: "FLUX 3D", desc: "3D rendered style", maxUsage: Infinity, contextWindow: "N/A" },
  { name: "HF Super Realism", desc: "Ultra photorealistic style", maxUsage: Infinity, contextWindow: "N/A" },
  { name: "Gemini Image", desc: "Google Nano Banana 2 image generation", maxUsage: Infinity, contextWindow: "N/A" },
];

export default function ChatInterface({
  messages,
  setMessages,
  conversationId,
  setConversationId,
  isIncognito,
  setIsIncognito,
  toggleSidebar,
  isSidebarCollapsed,
  onConversationCreated,
  userName = "User",
  onOpenSettings,
  sessionUsage,
  setSessionUsage,
}: ChatInterfaceProps) {
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [currentContextTokens, setCurrentContextTokens] = useState(0);
  const [activeArtifact, setActiveArtifact] = useState<Artifact | null>(null);
  const [loadingText, setLoadingText] = useState("Thinking...");
  const [selectedModel, setSelectedModel] = useState("Auto");
  const [defaultImageModel, setDefaultImageModel] = useState("Auto Image");
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>("medium");
  const [isThinkingEffortOpen, setIsThinkingEffortOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isIncognitoAnimating, setIsIncognitoAnimating] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editInputText, setEditInputText] = useState<string>("");
  const [mobileActiveMessageIndex, setMobileActiveMessageIndex] = useState<number | null>(null);
  const [feedbackState, setFeedbackState] = useState<{
    [key: number]: "up" | "down" | null;
  }>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatScrollContainerRef = useRef<HTMLDivElement>(null);
  const [userHasScrolledUp, setUserHasScrolledUp] = useState(false);
  const scrollAnimationRef = useRef<number | null>(null);
  const [isGracefulScrolling, setIsGracefulScrolling] = useState(false);
  const userInterruptedScrollRef = useRef<boolean>(false);
  const [selectedMessageForSources, setSelectedMessageForSources] =
    useState<Message | null>(null);
  const [previewAttachment, setPreviewAttachment] = useState<{
    url?: string;
    name: string;
    type: string;
    base64?: string;
    presentationData?: PresentationData;
    reportData?: ReportData;
  } | null>(null);
  const [isWebSearch, setIsWebSearch] = useState(true);
  const [isImageMode, setIsImageMode] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [chatFontSize, setChatFontSize] = useState("medium");
  const [messageStyle, setMessageStyle] = useState("classic");
  const [systemPrompt, setSystemPrompt] = useState<string>("");
  const [loadingStage, setLoadingStage] = useState("thinking");
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [isVoiceModeActive, setIsVoiceModeActive] = useState(false);
  const hasActiveChat = messages.length > 0 || isVoiceModeActive;
  const [preferenceModal, setPreferenceModal] = useState<{
    isOpen: boolean;
    topic: string;
    type: "presentation" | "report";
  }>({ isOpen: false, topic: "", type: "presentation" });

  const handleConfirmStudioOptions = (options: {
    type: "presentation" | "report";
    topic: string;
    theme: string;
    slideCount: number;
    tone: string;
  }) => {
    setPreferenceModal({ isOpen: false, topic: "", type: "presentation" });
    const formattedPrompt = options.type === "presentation"
      ? `Generate a ${options.slideCount}-slide Gamma AI presentation on "${options.topic}". Theme: ${options.theme}. Tone: ${options.tone}.`
      : `Generate a Canva executive report on "${options.topic}". Tone: ${options.tone}.`;
    
    handleSend(formattedPrompt);
  };
  const [messageWebSearch, setMessageWebSearch] = useState<
    Record<number, WebSearchData>
  >({});
  const [artifactWidth, setArtifactWidth] = useState<number>(50);
  const [isResizingPane, setIsResizingPane] = useState(false);


  const containerRef = useRef<HTMLDivElement>(null);
  const chatPaneRef = useRef<HTMLDivElement>(null);
  const artifactPaneRef = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const abortControllerRef = useRef<AbortController | null>(null);
  const imageReplacementsRef = useRef<Record<string, string>>({});
  const voiceAssistantIdRef = useRef<string | null>(null);
  const voiceDraftActiveRef = useRef(false);
  const voiceTranscriptFrameRef = useRef<number | null>(null);
  const pendingVoiceTranscriptRef = useRef("");
  const agentSessionIdRef = useRef<string>(conversationId || crypto.randomUUID());
  const reasoningConversationRef = useRef<string | null | undefined>(undefined);
  const completionChimeRef = useRef<CompletionChimeController | null>(null);
  const completionChimeArmedRef = useRef(false);
  const leftTabDuringGenerationRef = useRef(false);

  const armCompletionChime = useCallback(() => {
    completionChimeArmedRef.current = true;
    leftTabDuringGenerationRef.current = typeof document !== "undefined"
      && document.visibilityState === "hidden";
    completionChimeRef.current ??= createCompletionChime();
    void completionChimeRef.current.prime().catch(() => {
      // Audio may be blocked by browser/device policy; generation must continue.
    });
  }, []);

  const disarmCompletionChime = useCallback(() => {
    completionChimeArmedRef.current = false;
    leftTabDuringGenerationRef.current = false;
  }, []);

  const announceGenerationComplete = useCallback(() => {
    const shouldPlay = completionChimeArmedRef.current
      && leftTabDuringGenerationRef.current
      && typeof document !== "undefined"
      && document.visibilityState === "hidden";
    disarmCompletionChime();
    if (shouldPlay) {
      void completionChimeRef.current?.play().catch(() => {
        // Keep completion silent when a browser/device disallows background audio.
      });
    }
  }, [disarmCompletionChime]);

  useEffect(() => {
    const markTabAsLeft = () => {
      if (completionChimeArmedRef.current && document.visibilityState === "hidden") {
        leftTabDuringGenerationRef.current = true;
      }
    };
    document.addEventListener("visibilitychange", markTabAsLeft);
    return () => {
      document.removeEventListener("visibilitychange", markTabAsLeft);
      void completionChimeRef.current?.destroy();
      completionChimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (isVoiceModeActive) return;
    pendingVoiceTranscriptRef.current = "";
    if (voiceTranscriptFrameRef.current !== null) {
      window.cancelAnimationFrame(voiceTranscriptFrameRef.current);
      voiceTranscriptFrameRef.current = null;
    }
    if (voiceDraftActiveRef.current) {
      voiceDraftActiveRef.current = false;
      setInput("");
    }
  }, [isVoiceModeActive]);

  useEffect(() => () => {
    if (voiceTranscriptFrameRef.current !== null) {
      window.cancelAnimationFrame(voiceTranscriptFrameRef.current);
    }
  }, []);

  useEffect(() => {
    const previousConversationId = reasoningConversationRef.current;
    const isFirstSavedTurn = previousConversationId === null && Boolean(conversationId) && messages.length > 0;

    if (isFirstSavedTurn && conversationId) {
      localStorage.setItem(`void:reasoning-effort:${conversationId}`, reasoningEffort);
    } else if (previousConversationId === undefined || previousConversationId !== conversationId) {
      const savedEffort = conversationId
        ? localStorage.getItem(`void:reasoning-effort:${conversationId}`)
        : null;
      const normalizedEffort = normalizeChatEffort(savedEffort);
      setReasoningEffort(normalizedEffort);
      if (conversationId && savedEffort !== normalizedEffort) {
        localStorage.setItem(`void:reasoning-effort:${conversationId}`, normalizedEffort);
      }
    }

    reasoningConversationRef.current = conversationId;
  }, [conversationId, messages.length, reasoningEffort]);

  const isAbortError = (error: any): boolean => {
    if (!error) return false;
    const msg = String(error?.message || error || "").toLowerCase();
    const name = String(error?.name || "").toLowerCase();
    return (
      name === "aborterror" ||
      name === "domexception" ||
      msg.includes("aborted") ||
      msg.includes("abort") ||
      msg.includes("bodystreambuffer") ||
      abortControllerRef.current?.signal.aborted === true
    );
  };

  const friendlyRequestError = (error: unknown): string => {
    if (error instanceof ImageGenerationError) return error.message;
    const message = error instanceof Error ? error.message.toLowerCase() : String(error || "").toLowerCase();
    if (/fetch failed|failed to fetch|network|econn|socket|server returned 5|no response body/.test(message)) {
      return "The AI service is reconnecting. Please retry in a moment; your message is still here.";
    }
    if (/timeout|timed out/.test(message)) {
      return "The model took too long to respond. Retry to continue with automatic fallback.";
    }
    return "The request was interrupted. Please retry; the app will select another healthy provider when possible.";
  };

  const stopActiveGeneration = useCallback(() => {
    const controller = abortControllerRef.current;
    if (!controller || controller.signal.aborted) return;
    controller.abort("User cancelled generation");
    // Give immediate feedback while the rejected fetch/provider promise unwinds.
    setIsLoading(false);
    setIsGeneratingImage(false);
    disarmCompletionChime();
  }, [disarmCompletionChime]);

  useEffect(() => {
    const loadSettings = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const localDefault = localStorage.getItem("defaultModel");
      const localImageDefault = localStorage.getItem("defaultImageModel");
      setChatFontSize(localStorage.getItem("fontSize") || "medium");
      setMessageStyle(localStorage.getItem("messageStyle") || "classic");
      if (localDefault) {
        const modelMapping: Record<string, string> = {
          llama3_3_pro: "Auto",
          llama3_1_fast: "Llama 3.1 8B",
          "Llama 70B": "Auto",
          "Llama 3.1 Fast": "Llama 3.1 8B",
          flux_v1: "FLUX V1",
        };
        const mapped = modelMapping[localDefault] || localDefault;
        setSelectedModel(LLM_MODELS.some((item) => item.name === mapped) ? mapped : "Auto");
      }
      if (localImageDefault && IMG_MODELS.some((model) => model.name === localImageDefault)) {
        setDefaultImageModel(localImageDefault);
      }
      if (session?.user) {
        setUserId(session.user.id);
        setUserEmail(session.user.email || null);
        const { data: profile } = await supabase
          .from("profiles")
          .select("default_model, system_prompt")
          .eq("id", session.user.id)
          .single();
        if (profile) {
          setSystemPrompt(profile.system_prompt || "");
          if (profile.default_model) {
            const modelMapping: Record<string, string> = {
              llama3_3_pro: "Auto",
              llama3_1_fast: "Llama 3.1 8B",
              "Llama 70B": "Auto",
              "Llama 3.1 Fast": "Llama 3.1 8B",
              flux_v1: "FLUX V1",
            };
            const mapped = modelMapping[profile.default_model] || profile.default_model;
            setSelectedModel(LLM_MODELS.some((item) => item.name === mapped) ? mapped : "Auto");
          }
        }
      }
    };

    loadSettings();

    const handleSettingsUpdate = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail) {
        if (typeof customEvent.detail.systemPrompt === "string") {
          setSystemPrompt(customEvent.detail.systemPrompt);
        }
        if (customEvent.detail.defaultModel) {
          const modelMapping: Record<string, string> = {
            llama3_3_pro: "Auto",
            llama3_1_fast: "Llama 3.1 8B",
            "Llama 70B": "Auto",
            "Llama 3.1 Fast": "Llama 3.1 8B",
            flux_v1: "FLUX V1",
          };
          const mapped = modelMapping[customEvent.detail.defaultModel] || customEvent.detail.defaultModel;
          setSelectedModel(LLM_MODELS.some((item) => item.name === mapped) ? mapped : "Auto");
        }
        if (customEvent.detail.defaultImageModel && IMG_MODELS.some((model) => model.name === customEvent.detail.defaultImageModel)) {
          setDefaultImageModel(customEvent.detail.defaultImageModel);
        }
        if (["small", "medium", "large"].includes(customEvent.detail.fontSize)) {
          setChatFontSize(customEvent.detail.fontSize);
        }
        if (["classic", "modern"].includes(customEvent.detail.messageStyle)) {
          setMessageStyle(customEvent.detail.messageStyle);
        }
      } else {
        loadSettings();
      }
    };

    window.addEventListener("settingsUpdated", handleSettingsUpdate);
    return () => {
      window.removeEventListener("settingsUpdated", handleSettingsUpdate);
    };
  }, []);

  const [attachments, setAttachments] = useState<any[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const MAX_FILE_BYTES = 20 * 1024 * 1024;
  const MAX_INLINE_BYTES = 4 * 1024 * 1024;

  const extractFirstName = (rawNameOrEmail?: string | null): string => {
    if (!rawNameOrEmail || typeof rawNameOrEmail !== "string") return "User";
    let name = rawNameOrEmail.trim();
    if (!name) return "User";
    if (name.includes("@")) {
      name = name.split("@")[0];
    }
    const firstWord = name.split(/[\s\._\-\d]/)[0];
    if (!firstWord) return "User";
    return firstWord.charAt(0).toUpperCase() + firstWord.slice(1).toLowerCase();
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  };

  const readFileAsBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(",")[1] || "");
      };
      reader.onerror = () =>
        reject(new Error("Could not read the selected file."));
      reader.readAsDataURL(file);
    });

  const inferMimeType = (file: File): string => {
    if (file.type && file.type !== "application/octet-stream") return file.type;
    const ext = file.name.split(".").pop()?.toLowerCase();
    const map: Record<string, string> = {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      webp: "image/webp",
      mp4: "video/mp4",
      webm: "video/webm",
      mov: "video/quicktime",
      pdf: "application/pdf",
      txt: "text/plain",
      csv: "text/csv",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      xls: "application/vnd.ms-excel",
    };
    return (ext && map[ext]) || "application/octet-stream";
  };

  const handleScroll = () => {
    const container = chatScrollContainerRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    // If user has scrolled up more than 100px from bottom, pause auto-scroll
    if (distanceFromBottom > 100) {
      setUserHasScrolledUp(true);
    } else {
      setUserHasScrolledUp(false);
    }
  };

  const fluidScrollToBottom = (force = false, options?: { duration?: number; animateWave?: boolean }) => {
    const container = chatScrollContainerRef.current;
    if (!container) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    if (userHasScrolledUp && !force) return;

    if (scrollAnimationRef.current) {
      cancelAnimationFrame(scrollAnimationRef.current);
      scrollAnimationRef.current = null;
    }

    const start = container.scrollTop;
    const target = container.scrollHeight - container.clientHeight;
    const distance = target - start;

    if (Math.abs(distance) <= 2) {
      container.scrollTop = target;
      setUserHasScrolledUp(false);
      return;
    }

    // Dynamic duration based on distance (400ms - 1100ms) for maximum fluid feel
    const duration = options?.duration || Math.min(1100, Math.max(400, Math.abs(distance) * 0.5));
    const startTime = performance.now();
    userInterruptedScrollRef.current = false;

    if (options?.animateWave !== false) {
      setIsGracefulScrolling(true);
    }

    // Dynamic easeInOutQuart curve for momentum physics
    const easeInOutQuart = (x: number): number =>
      x < 0.5 ? 8 * x * x * x * x : 1 - Math.pow(-2 * x + 2, 4) / 2;

    const step = (currentTime: number) => {
      if (userInterruptedScrollRef.current) {
        setIsGracefulScrolling(false);
        return;
      }

      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easedProgress = easeInOutQuart(progress);

      const currentTarget = container.scrollHeight - container.clientHeight;
      const nextScrollTop = start + (currentTarget - start) * easedProgress;

      container.scrollTop = nextScrollTop;

      if (progress < 1) {
        scrollAnimationRef.current = requestAnimationFrame(step);
      } else {
        container.scrollTop = container.scrollHeight - container.clientHeight;
        setUserHasScrolledUp(false);
        scrollAnimationRef.current = null;
        setTimeout(() => setIsGracefulScrolling(false), 500);
      }
    };

    scrollAnimationRef.current = requestAnimationFrame(step);
  };

  const scrollToBottom = (force = false) => {
    fluidScrollToBottom(force);
  };

  useEffect(() => {
    if (userHasScrolledUp) return;

    // Streaming can update the final message dozens of times per second. A
    // 400–1100 ms easing animation restarted for every token repeatedly read
    // the full (often image-heavy) scroll height and caused visible input lag.
    // Coalesce streaming scrolls into one paint and reserve animation for the
    // completed response.
    if (isLoading) {
      if (scrollAnimationRef.current) cancelAnimationFrame(scrollAnimationRef.current);
      scrollAnimationRef.current = requestAnimationFrame(() => {
        const container = chatScrollContainerRef.current;
        if (container) container.scrollTop = container.scrollHeight - container.clientHeight;
        scrollAnimationRef.current = null;
      });
      return;
    }

    scrollToBottom();
  }, [messages, isLoading, userHasScrolledUp]);

  useEffect(() => {
    if (isLoading) {
      if (isGeneratingImage) {
        setLoadingStage("painting");
      } else {
        setLoadingStage("thinking");
      }
    }
  }, [isLoading, isWebSearch, isGeneratingImage]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from((e.target as HTMLInputElement).files || []) as File[];
    if (files.length === 0) return;

    // Check limit
    if (attachments.length + files.length > 5) {
      alert("You can only upload up to 5 files at a time.");
      return;
    }

    setIsLoading(true);
    setLoadingText("Preparing attachments...");

    const newAttachments: any[] = [];

    for (const file of files) {
      // Persist every attachment when storage is available. Keeping even a
      // 2–4 MB base64 string in React state and chat history makes each later
      // render and request copy that payload again.
      const fileName = `${Date.now()}-${crypto.randomUUID()}-${file.name.replace(/[^\w.\-]+/g, "_")}`;
      const { data, error } = await supabase.storage
        .from("chat-attachments")
        .upload(fileName, file, {
          contentType: file.type || "application/octet-stream",
          upsert: false,
        });

      if (!error && data) {
        const { data: urlData } = supabase.storage
          .from("chat-attachments")
          .getPublicUrl(data.path);
        newAttachments.push({
          url: urlData.publicUrl,
          name: file.name,
          type: file.type || "application/octet-stream",
        });
      } else {
        try {
          const form = new FormData();
          form.append('file', file);
          const response = await fetch('/api/attachments', { method: 'POST', body: form });
          const result = await response.json();
          if (!response.ok || !result.url) throw new Error(result.error || 'Attachment upload failed.');
          newAttachments.push({ url: result.url, name: file.name, type: file.type || 'application/octet-stream' });
        } catch (error) {
          if (file.size <= MAX_INLINE_BYTES) {
            try {
              const base64 = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result).split(',')[1]);
                reader.onerror = () => reject(new Error('The file could not be read.'));
                reader.readAsDataURL(file);
              });
              newAttachments.push({ base64, name: file.name, type: file.type || 'application/octet-stream' });
            } catch { alert(`Could not read ${file.name}. Please retry.`); }
          } else {
            alert(`Could not upload ${file.name}: ${error instanceof Error ? error.message : 'Please retry.'}`);
          }
        }
      }
    }

    try {
      setAttachments((prev) => [...prev, ...newAttachments]);
    } catch (error: unknown) {
      console.error("Upload error:", error);
      const msg =
        error instanceof Error ? error.message : "Failed to prepare file.";
      alert(msg);
    } finally {
      setIsLoading(false);
      setLoadingText("Thinking...");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const relatedTarget = e.relatedTarget as Node | null;
    const currentTarget = e.currentTarget as Node | null;
    if (currentTarget && relatedTarget && currentTarget.contains(relatedTarget)) return;
    setIsDragging(false);
  };
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const pseudoEvent = {
        target: { files: Array.from(e.dataTransfer.files) },
      } as unknown as React.ChangeEvent<HTMLInputElement>;
      await handleFileUpload(pseudoEvent);
    }
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf("image") !== -1) {
        e.preventDefault(); // prevent text pasting if there's an image
        const blob = items[i].getAsFile();
        if (blob) {
          // Reuse handleFileUpload with a pseudo-event
          const pseudoEvent = {
            target: { files: [blob] },
          } as unknown as React.ChangeEvent<HTMLInputElement>;
          await handleFileUpload(pseudoEvent);
        }
        break; // Handle only the first image
      }
    }
  };

  const handleSend = async (customInput?: string) => { if (isLoading) return;
    setUserHasScrolledUp(false);
    setTimeout(() => scrollToBottom(true), 50);
    imageReplacementsRef.current = {};
    const textToSend = customInput || input;
    if (!textToSend.trim() && attachments.length === 0) return;

    const trimmedInput = textToSend.trim();
    if (/^\/models?(?:\s|$)/i.test(trimmedInput)) {
      setSelectedModel("Auto");
      setIsImageMode(false);
      setMessages((previous) => [...previous,
        { role: "user" as const, content: trimmedInput },
        { role: "assistant" as const, content: "Text chat uses **Auto** with automatic provider failover. The responding model is shown on each answer. Image preferences are available in Settings." },
      ]);
      if (!customInput) setInput("");
      return;
    }

    const isExplicitImageCommand = textToSend.trim().startsWith("/imagine ");
    const normalizedRequest = resolveInfographicFollowUp(messages, textToSend.trim());
    // Keep image generation independent of the selected text model and
    // thinking effort. Natural prompts should use the saved image default
    // even when the user leaves Auto selected. Include common "generate" typos
    // because otherwise they fall through to the web-media search path.
    const asksForTextOutput = /\b(?:response|reply|answer|text|code|list|plan|essay|story|poem|email|message|table|chart|analysis|report|presentation|website|app|explain|explanation|elaborate|describe|description|discuss|details?|write[- ]?up|caption)\b/i.test(normalizedRequest);
    const namesVisualOutput = /\b(?:images?|pictures?|photos?|illustrations?|artworks?|posters?|wallpapers?|logos?|icons?|portraits?|scenes?)\b/i.test(normalizedRequest);
    const containsImageGenerationVerb = /\b(?:generate|genrate|genarate|generat|create|make|design|draw|render|paint|illustrate)\b/i.test(normalizedRequest);
    const isHybridImageRequest = containsImageGenerationVerb && namesVisualOutput && asksForTextOutput;
    const isNaturalImageRequest = isNaturalImageGeneration(normalizedRequest);
    const isStudioRequest = isStudioCreationRequest(normalizedRequest);
    const isRasterPosterRequest = isRasterPosterCreationRequest(normalizedRequest);
    const isRasterInfographicRequest = isRasterPosterRequest && isInfographicCreationRequest(normalizedRequest);
    const previousConversationImage = latestConversationImage(messages);
    const isConversationalImageEdit = referencesPreviousImage(normalizedRequest)
      && Boolean(previousConversationImage);
    const isExplicitTextQuery = /^\s*(research|explain|write|how|what|why|compare|solve|code|summarize|list|tell me|who|when|where|can you|help|find|search)\b/i.test(textToSend.trim());
    const isImageModel = selectedModel.includes("FLUX") || selectedModel === "HF Super Realism" || selectedModel === "Ideogram" || selectedModel === "Gemini Image" || selectedModel === "Cloudflare SDXL" || selectedModel === "cloudflare-sdxl";

    // This branch runs before chat orchestration, so Auto routing and thinking
    // effort cannot turn an explicit image
    // request into a web-image lookup. `isImageMode` can briefly be stale
    // after settings/model updates, so it must never route ordinary text.
    const shouldGenerateImage = isExplicitImageCommand
      || (!isStudioRequest && (isNaturalImageRequest
        || isHybridImageRequest
        || isConversationalImageEdit
        || (isImageModel && !isExplicitTextQuery)));

    if (shouldGenerateImage) {
      const prompt = isExplicitImageCommand
        ? textToSend.trim().slice(9).trim()
        : isRasterPosterRequest
          ? prepareRasterPosterPrompt(messages, normalizedRequest)
          : textToSend.trim();
      if (!prompt) {
        alert(
          "Please provide a prompt describing the image you want to generate or the edits you want to make.",
        );
        return;
      }

      armCompletionChime();

      // Finished raster posters intentionally use Nano Banana. Every other
      // image request stays on the image model saved in Settings.
      const requestedImageModel = isRasterInfographicRequest
        ? VECTOR_INFOGRAPHIC_MODEL
        : imageModelForRequest(defaultImageModel, isRasterPosterRequest);
      const imageHistoryAttachments = compactAttachmentsForHistory(attachments);
      const newMessages: Message[] = [
        ...messages,
        {
          role: "user" as const,
          content: textToSend,
          attachments: imageHistoryAttachments.length > 0 ? imageHistoryAttachments : undefined,
        },
      ];
      setMessages([
        ...newMessages,
        {
          role: "assistant" as const,
          content: "",
          isStreaming: true,
          isImageGenerating: true,
          modelName: requestedImageModel,
        },
      ]);
      if (!customInput) setInput("");
      const imgStartTime = Date.now();
      setIsGeneratingImage(true);
      setIsLoading(true);
      const imageAbortController = new AbortController();
      abortControllerRef.current = imageAbortController;

      // Store the current attachment before we clear it from the UI so we can send it
      const img2imgAttachments = attachments;
      setAttachments([]);

      try {
        const rawImagePrompt = prompt.replace(/\n/g, " ").trim();
        const finalPrompt = isRasterPosterRequest ? rasterPosterPrompt(rawImagePrompt) : rawImagePrompt;
        const companionTextPromise = isHybridImageRequest
          ? (async () => {
              try {
                const response = await fetch("/api/chat", {
                  method: "POST",
                  headers: await authenticatedJsonHeaders(),
                  signal: imageAbortController.signal,
                  body: JSON.stringify({
                    messages: [{
                      role: "user",
                      content: `Provide the accompanying explanation requested for this finished visual. Discuss the subject, important details, context, and creative interpretation. Return only helpful prose and do not request or embed another visual.\n\nOriginal visual brief: ${finalPrompt}`,
                    }],
                    model: "Auto",
                    reasoningEffort,

                    attachments: [],
                    conversationId: `${agentSessionIdRef.current}-image-explanation-${Date.now()}`,
                    userId,
                    userEmail,
                    isWebSearch: false,
                  }),
                });
                return await readTextSseResponse(response);
              } catch (error) {
                if (!isAbortError(error)) console.warn("Companion image explanation failed:", error);
                return "";
              }
            })()
          : Promise.resolve("");

        const sourceImage = img2imgAttachments.find((attachment) => attachment.type.startsWith("image/") && (attachment.base64 || attachment.url));
        const attachedImageInput = sourceImage?.base64
          ? `data:${sourceImage.type};base64,${sourceImage.base64}`
          : sourceImage?.url;
        const imageInput = attachedImageInput
          || (isConversationalImageEdit ? previousConversationImage?.url : undefined);
        const sourcePrompt = attachedImageInput ? undefined : previousConversationImage?.sourcePrompt;
        const posterImageSize = /\b(?:landscape|horizontal|wide|banner)\b/i.test(finalPrompt) ? "1536x1024" : "1024x1536";
        let data: { url?: string; modelUsed?: string; error?: string; warnings?: string[] };
        const showGeneratingModel = (modelName: string) => setMessages((current) => {
          const next = [...current];
          const last = next[next.length - 1];
          if (last?.role === "assistant" && last.isImageGenerating) next[next.length - 1] = { ...last, modelName };
          return next;
        });
        const generateWithSelectedServerModel = async (model: string) => {
          const res = await fetchWithRetry("/api/generate-image", {
            method: "POST",
            headers: await authenticatedJsonHeaders(),
            body: JSON.stringify({
              prompt: finalPrompt,
              model,
              image: imageInput,
              sourcePrompt,
              ...(isRasterPosterRequest ? { quality: "high", size: posterImageSize } : {}),
            }),
            signal: imageAbortController.signal,
          }, { attempts: 1, connectTimeoutMs: 180_000 });
          const responseData = await readJsonResponse<{ url?: string; modelUsed?: string; error?: string }>(res);
          if (!res.ok) throw new ImageGenerationError(responseData.error || "Failed to generate image");
          return responseData;
        };
        if (isRasterInfographicRequest) {
          showGeneratingModel(VECTOR_INFOGRAPHIC_MODEL);
          data = await generateVectorInfographicAsset(rawImagePrompt, imageAbortController.signal);
        } else if (isRasterPosterRequest) {
          try {
            // Keep poster providers server-side. Browser-side Puter calls can
            // inject their own balance dialog into VOID, which breaks the
            // generation experience and cannot be styled or dismissed by us.
            data = await generateWithSelectedServerModel(POSTER_IMAGE_MODEL);
          } catch (serverPosterError) {
            if (imageAbortController.signal.aborted) throw serverPosterError;
            console.warn("Gemini poster generation was unavailable; trying Cloudflare:", serverPosterError);
            try {
              showGeneratingModel("Cloudflare FLUX.1 Schnell");
              data = await generateWithSelectedServerModel(POSTER_CLOUDFLARE_MODEL);
            } catch (cloudflarePosterError) {
              if (imageAbortController.signal.aborted) throw cloudflarePosterError;
              console.warn("Cloudflare poster generation was unavailable; trying FLUX:", cloudflarePosterError);
              try {
                showGeneratingModel("FLUX 1.1 Pro");
                data = await generateWithSelectedServerModel(POSTER_FLUX_MODEL);
              } catch (fluxPosterError) {
                if (imageAbortController.signal.aborted) throw fluxPosterError;
                console.warn("Every AI poster provider was unavailable:", fluxPosterError);
                throw new Error("No AI image provider could generate this poster right now. Please retry in a moment.");
              }
            }
          }
        } else {
          data = await generateWithSelectedServerModel(requestedImageModel);
        }

        if (!data.url) {
          throw new Error(data.error || "Failed to generate image");
        }

        // Some providers return a URL before rendering has completed. Keep the
        // full generation skeleton mounted until the actual image bytes load.
        await preloadGeneratedImage(data.url, 90_000, imageAbortController.signal);
        setIsGeneratingImage(false);

        if (!isRasterInfographicRequest) setSessionUsage((prev: any) => {
          const usageKey = getUsageKey(requestedImageModel);
          const newTotal = (prev?.[usageKey]?.generated || 0) + 1;
          
          if (usageKey === "flux_v1") {
            supabase.auth.getUser().then(({ data: { user } }) => {
              if (user) {
                supabase
                  .from("profiles")
                  .update({ images_flux_v1: newTotal })
                  .eq("id", user.id)
                  .then(undefined, (err) => console.error("Update error:", err));
              }
            }).catch((err) => console.error("GetUser error:", err));
          }
          return {
            ...prev,
            [usageKey]: {
              ...prev?.[usageKey],
              generated: newTotal,
            },
          };
        });

        const actualModelUsed = data.modelUsed || requestedImageModel;
        const imageThoughtTime = Math.max(1, Math.floor((Date.now() - imgStartTime) / 1000));
        const companionText = await companionTextPromise;
        const generatedVisualName = isRasterInfographicRequest
          ? "infographic"
          : isRasterPosterRequest
            ? "poster"
            : "image";
        const assistantResponse = `Here is the ${generatedVisualName} you requested:\n\n![Generated ${generatedVisualName} for ${prompt.replace(/\s+/g, ' ')} | model=${actualModelUsed}](${data.url})${data.warnings?.length ? `\n\n${data.warnings.join(' ')}` : ''}${companionText ? `\n\n${companionText}` : ""}\n\n[META_JSON: ${JSON.stringify({ thoughtTime: imageThoughtTime, model: actualModelUsed })}]`;
        const compactNewMessages = newMessages.map((message, index) => (
          index === newMessages.length - 1 && message.attachments
            ? { ...message, attachments: compactAttachmentsForHistory(message.attachments) }
            : message
        ));
        setMessages([
          ...compactNewMessages,
          { role: "assistant" as const, content: assistantResponse, thoughtTime: imageThoughtTime, modelName: actualModelUsed },
        ]);
        announceGenerationComplete();

        if (!isIncognito) {
          let activeConvId = conversationId;
          const {
            data: { session },
          } = await supabase.auth.getSession();

          if (!activeConvId && session?.user) {
            const { data: convData, error: convError } = await supabase
              .from("conversations")
              .insert([
                {
                  title: textToSend.substring(0, 30) || "Image Generation",
                  user_id: session.user.id,
                },
              ])
              .select()
              .single();

            if (!convError && convData) {
              activeConvId = convData.id;
              setConversationId(activeConvId);
              if (onConversationCreated) onConversationCreated();
            }
          }

          if (activeConvId) {
            await supabase.from("messages").insert([
              {
                conversation_id: activeConvId,
                role: "user",
                content: textToSend,
              },
              {
                conversation_id: activeConvId,
                role: "assistant",
                content: assistantResponse,
              },
            ]);
          }
        }
      } catch (error: any) {
        disarmCompletionChime();
        const wasCancelled = imageAbortController.signal.aborted || isAbortError(error);
        imageAbortController.abort();
        if (wasCancelled) {
          setMessages((previous) => {
            const next = [...previous];
            const last = next[next.length - 1];
            if (last?.role === "assistant" && last.isImageGenerating) {
              next[next.length - 1] = {
                ...last,
                content: "*[Generation stopped by user]*",
                isStreaming: false,
                isImageGenerating: false,
              };
            }
            return next;
          });
          return;
        }
        console.warn("Image generation unavailable:", error);
        setMessages([
          ...newMessages,
          {
            role: "assistant" as const,
            content: friendlyRequestError(error),
          },
        ]);
      } finally {
        abortControllerRef.current = null;
        setIsLoading(false);
        setIsGeneratingImage(false);
      }
      return;
    }

    if (isImageMode) {
      setIsImageMode(false);
    }

    const currentAttachments = [...attachments];
    const displayContent = textToSend.trim();
    const requestsGeneratedGraph = /\b(?:chart|graph|plot)\b/i.test(displayContent)
      && !/\b(?:image|photo|picture)s?\b/i.test(displayContent);
    const refersToEarlierAttachment = referencesEarlierAttachment(displayContent);
    const priorAttachments = currentAttachments.length === 0 && refersToEarlierAttachment
      ? [...messages]
          .reverse()
          .filter((message) => message.role === "user")
          .map((message) => getMessageAttachments(message))
          .find((messageAttachments) => messageAttachments.length > 0) || []
      : [];
    const requestAttachments = currentAttachments.length > 0 ? currentAttachments : priorAttachments;
    const currentHistoryAttachments = compactAttachmentsForHistory(currentAttachments);
    const requestContent = displayContent || (
      requestAttachments.some((attachment) => attachment.type.startsWith("image/"))
        ? "Analyze the attached image in detail and explain what it shows."
        : "Analyze the attached file and summarize its contents."
    );

    const newMessages: Message[] = [
      ...messages,
      {
        role: "user" as const,
        content: displayContent,
        attachments:
          currentHistoryAttachments.length > 0 ? currentHistoryAttachments : undefined,
      },
    ];
    armCompletionChime();
    const requestMessages = prepareStudioMessages(compactMessagesForTransport(newMessages.map((message, messageIndex) =>
      messageIndex === newMessages.length - 1 ? { ...message, content: requestContent } : message,
    )));
    setMessages(newMessages);
    if (!customInput) setInput("");
    setIsLoading(true);
    setAttachments([]);

    try {
      let streamingContent = "";
      let currentPhase: ResponsePhase = "thinking";
      let currentEffortInfo: EffortInfo | undefined;
      let currentEffortRecovery: string | undefined;
      let currentLogs: { action: string; query: string }[] = [];
      let currentSources: string[] = [];
      let currentWebSearch: WebSearchData | undefined = undefined;
      let currentMedia: MediaPayload | undefined = undefined;
      let currentSearchIntent: { webSearchIntent: string; webImageIntent: string } | undefined = undefined;
      let fallbackModelName: string | undefined = undefined;
      let startTime = Date.now();

      const assistantMessage: Message = {
        role: "assistant",
        content: "",
        isStreaming: true,
        statusLogs: [],
        thoughtTime: 0,
        modelName: selectedModel,
      };

      const newMessagesWithAssistant = [...newMessages, assistantMessage];
      setMessages(newMessagesWithAssistant);

      const timerInterval = setInterval(() => {
        setMessages((prev) => {
          const newM = [...prev];
          const last = newM[newM.length - 1];
          if (last && last.role === "assistant" && last.isStreaming) {
            newM[newM.length - 1] = {
              ...last,
              thoughtTime: Math.floor((Date.now() - startTime) / 1000),
            };
          }
          return newM;
        });
      }, 1000);

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: await authenticatedJsonHeaders(),
        signal: abortController.signal,
        body: JSON.stringify({
          messages: requestMessages,
          model: "Auto",
          systemPrompt: systemPrompt,
          reasoningEffort,

          attachments: requestAttachments,
          conversationId: agentSessionIdRef.current,
          userId: userId,
          userEmail: userEmail,
          isWebSearch: isWebSearch,
        }),
      });

      if (!response.ok) {
        clearInterval(timerInterval);
        throw new Error(`Server returned ${response.status}`);
      }

      if (!response.body) throw new Error("No response body");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let buffer = "";
      let streamRenderQueued = false;

      // SSE can deliver dozens of chunks in one JavaScript turn. Coalescing
      // them to one update per frame avoids React's nested-update guard while
      // keeping the answer visually streamed.
      const renderStreamingMessage = () => {
        if (streamRenderQueued) return;
        streamRenderQueued = true;
        requestAnimationFrame(() => {
          streamRenderQueued = false;
          setMessages((prev) => {
            const newM = [...prev];
            const last = newM[newM.length - 1];
            if (last && last.role === "assistant" && last.isStreaming) {
              newM[newM.length - 1] = {
                ...last,
                content: streamingContent,
                statusLogs: currentLogs,
                responsePhase: currentPhase,
                effortInfo: currentEffortInfo,
                effortRecovery: currentEffortRecovery,
                sources: currentSources,
                webSearch: currentWebSearch,
                media: currentMedia,
                searchIntent: currentSearchIntent,
                modelName: fallbackModelName || last.modelName,
              };
            }
            return newM;
          });
        });
      };

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value || readerDone) {
          buffer += readerDone ? decoder.decode() + '\n' : decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (line.startsWith("data: ") && line.trim() !== "data: [DONE]") {
              try {
                const data = JSON.parse(line.slice(6));
                currentPhase = responsePhaseForEvent(data, currentPhase);
                if (data.type === "effort") currentEffortInfo = data;
                if (data.type === "effort_recovery") currentEffortRecovery = data.message;
                if (data.type === "status") {
                  currentLogs = [
                    ...currentLogs,
                    { action: data.action, query: data.query },
                  ];
                } else if (data.type === "searchIntent") {
                  currentSearchIntent = {
                    webSearchIntent: data.webSearchIntent,
                    webImageIntent: data.webImageIntent,
                  };
                } else if (data.type === "sources") {
                  currentSources = mergeSourceUrls(currentSources, data.sources);
                } else if (data.type === "webSearch") {
                  currentWebSearch = mergeWebSearchData(currentWebSearch, requestsGeneratedGraph
                    ? { ...data, images: [] }
                    : data);
                  currentSources = mergeSourceUrls(currentSources, sourceUrlsFromWebSearch(data));
                } else if (data.type === "media") {
                  currentMedia = mergeMediaPayload(currentMedia, data);
                } else if (data.type === "media_status") {
                  currentLogs = [...currentLogs, { action: data.label || "Web image update", query: data.reason || "" }];
                } else if (data.type === "text") {
                  streamingContent += typeof data.content === 'string' ? data.content : '';
                } else if (data.type === "reset") {
                  streamingContent = "";
                } else if (data.type === "error") {
                  streamingContent += `\n\n${data.error}`;
                } else if (data.type === "model_fallback") {
                  fallbackModelName = data.uiName;
                } else if (data.type === "model_runtime") {
                  fallbackModelName = data.uiName || fallbackModelName;
                } else if (data.type === "agent_plan") {
                  currentLogs = [...currentLogs, { action: "Planning the work", query: "" }];
                } else if (data.type === "agent_status") {
                  const progress = visibleProgressLogs([{ action: data.label || "Reviewing the request" }]);
                  currentLogs = [...currentLogs, ...progress.map((log) => ({ action: log.action || "Reviewing the request", query: log.query || "" }))];
                } else if (data.type === "agent_result") {
                  currentLogs = [...currentLogs, agentResultLog(data)];
                } else if (data.type === "usage") {
                  if (data.usage?.prompt_tokens) {
                    setCurrentContextTokens(data.usage.prompt_tokens);
                  }
                  const targetKey = getUsageKey(selectedModel);
                  setSessionUsage((prev: any) => {
                    const newTotal =
                      (prev[targetKey]?.total || 0) +
                      (data.usage?.total_tokens || 0);

                    // Only save to DB if it's one of the original models with columns
                    if (targetKey === "llama_70b" || targetKey === "llama_3_1_fast") {
                      const dbKey = targetKey === "llama_70b" ? "tokens_llama3_3_pro" : "tokens_llama3_1_fast";
                      supabase.auth.getUser().then(({ data: { user } }) => {
                        if (user) {
                          supabase
                            .from("profiles")
                            .update({ [dbKey]: newTotal })
                            .eq("id", user.id)
                            .then(undefined, (err) => console.error("Update error:", err));
                        }
                      }).catch((err) => console.error("GetUser error:", err));
                    }

                    return {
                      ...prev,
                      [targetKey]: {
                        ...prev[targetKey],
                        prompt:
                          (prev[targetKey]?.prompt || 0) +
                          (data.usage?.prompt_tokens || 0),
                        completion:
                          (prev[targetKey]?.completion || 0) +
                          (data.usage?.completion_tokens || 0),
                        total: newTotal,
                      },
                    };
                  });
                }

              } catch (e) {}
            }
          }
          renderStreamingMessage();
        }
      }

      clearInterval(timerInterval);

      setMessages((prev) => {
        const newM = [...prev];
        const last = newM[newM.length - 1];
        if (last && last.role === "assistant") {
          let finalContent = streamingContent;
          for (const [p, url] of Object.entries(imageReplacementsRef.current)) {
            finalContent = finalContent.replace(`[GENERATE_IMAGE: ${p}]`, `![${p}](${url})`);
          }
          newM[newM.length - 1] = {
            ...last,
            content: finalContent,
            isStreaming: false,
            thoughtTime: Math.floor((Date.now() - startTime) / 1000),
            statusLogs: currentLogs,
            responsePhase: currentPhase,
            effortInfo: currentEffortInfo,
            effortRecovery: currentEffortRecovery,
            sources: currentSources,
            webSearch: currentWebSearch,
            media: currentMedia,
            searchIntent: currentSearchIntent,
            modelName: fallbackModelName || last.modelName,
          };
        }
        return newM;
      });
      announceGenerationComplete();
      // Quality Validation (Component 7): Check generated artifacts for common issues
      const validateArtifactQuality = (data: any, type: string): void => {
        const issues: string[] = [];
        if (type === "presentation" && data?.slides) {
          data.slides.forEach((s: any, i: number) => {
            if (!s.title || /lorem\s+ipsum/i.test(s.title || "")) issues.push(`Slide ${i + 1}: placeholder or missing title`);
            if (!s.content?.bullets?.length && !s.content?.bodyText && !s.content?.factCards?.length) issues.push(`Slide ${i + 1}: empty content`);
          });
        }
        if (type === "report" && data?.sections) {
          data.sections.forEach((s: any, i: number) => {
            if (!s.title && s.type !== "hero_header") issues.push(`Section ${i + 1}: missing title`);
            if (/lorem\s+ipsum/i.test(s.content || "")) issues.push(`Section ${i + 1}: placeholder content`);
          });
        }
        if (issues.length > 0) {
          console.warn(`[VOID Quality] ${type} has ${issues.length} issue(s):`, issues);
        }
      };

      // Auto-launch artifact Preview when AI generation completes
      const latestUserRequest = [...newMessages].reverse().find((message) => message.role === "user")?.content || "";
      const wasPosterRequest = isPosterCreationRequest(latestUserRequest);
      const wasPresentationRequest = isPresentationCreationRequest(latestUserRequest);
      const wasWebArtifactRequest = isWebArtifactCreationRequest(latestUserRequest);
      const artifactGenerationFailed = /(?:couldn['’]t|could not|unable to|failed to)\s+(?:complete|finish|generate|create)[\s\S]{0,100}(?:response|presentation|poster)|no final answer was produced|response time budget was reached/i.test(streamingContent);

      // Let the finished response commit before mounting the Studio pane.
      // This also ensures an incomplete deck cannot open a preview mid-stream.
      setIsLoading(false);
      if (!wasWebArtifactRequest) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }

      const parsedPresentation = (wasPresentationRequest || wasPosterRequest) && !artifactGenerationFailed
        ? parseLatestStudioPresentation(streamingContent)
          || presentationFromMarkdown(displayContent, streamingContent)
        : null;
      if (parsedPresentation && Array.isArray(parsedPresentation.slides)) {
          try {
            const presData = parsedPresentation as any;

              // Posters and infographics are single-page compositions. Preserve the researched
              // content while separating it from the visual plan used by the studio.
              if (wasPosterRequest && presData.slides.length > 1) {
                const firstSlide = presData.slides[0] || {};
                const allBullets: string[] = [];
                const allMetrics: any[] = [];
                const allTimeline: any[] = [];

                presData.slides.forEach((s: any) => {
                  const c = s.content || {};
                  if (Array.isArray(c.bullets)) allBullets.push(...c.bullets);
                  if (Array.isArray(c.factCards)) allMetrics.push(...c.factCards);
                  if (Array.isArray(c.metrics)) allMetrics.push(...c.metrics);
                  if (Array.isArray(c.timeline)) allTimeline.push(...c.timeline);
                });

                const posterSlide: any = {
                  id: "s1",
                  slideNumber: 1,
                  layout: "poster",
                  title: presData.title || firstSlide.title || "Visual Poster",
                  subtitle: firstSlide.subtitle,
                  visualRole: firstSlide.visualRole || "hero-image",
                  imagePrompt: firstSlide.imagePrompt || `${presData.title}: exact subject-specific editorial image`,
                  content: {
                    bodyText: firstSlide.content?.bodyText,
                    metrics: allMetrics.slice(0, 3),
                    bullets: allBullets.slice(0, 6),
                    timeline: allTimeline.slice(0, 6),
                    sources: presData.slides.flatMap((s: any) => s.content?.sources || []).slice(0, 8),
                  }
                };

                presData.slides = [posterSlide];
              }

              if (wasPosterRequest && !presData.format) {
                presData.format = /infographic/i.test(displayContent) ? "infographic" : /academic|research|conference/i.test(displayContent) ? "academic-poster" : "poster";
              }

              const preparedData = wasPosterRequest ? asPoster(presData, latestUserRequest) : presData;
              const upgradedData = normalizePresentation(assignPresentationMedia(preparedData, currentMedia?.images || []));
              if (wasPosterRequest && !hasRenderablePosterContent(upgradedData)) {
                throw new Error("The model returned an incomplete poster or infographic; the empty preview was suppressed.");
              }
              // Save the actual image-bearing artifact in the assistant response,
              // so reopening its card or conversation keeps the same visuals.
              const artifactBlock = `\`\`\`gamma-presentation\n${JSON.stringify(upgradedData)}\n\`\`\``;
              const fencedArtifact = /\`\`\`(?:gamma-presentation|gamma|presentation|json)?\s*\{[\s\S]*?"slides"\s*:[\s\S]*?\`\`\`/i;
              streamingContent = fencedArtifact.test(streamingContent)
                ? streamingContent.replace(fencedArtifact, () => artifactBlock)
                : `${streamingContent}\n\n${artifactBlock}`;
              setMessages((previous) => previous.map((message, index) => index === previous.length - 1 && message.role === "assistant"
                ? { ...message, content: streamingContent, media: currentMedia } : message));
              validateArtifactQuality(upgradedData, "presentation");
              setActiveArtifact({
                identifier: "presentation",
                type: wasPosterRequest ? "poster" : "presentation",
                title: presData.title || (wasPosterRequest ? "Poster" : "Presentation"),
                content: JSON.stringify(presData),
                presentationData: upgradedData,
              });

          } catch (e) {
            console.warn("Presentation preview recovery failed:", e);
          }
      } else if (streamingContent.includes('"sections":')) {
        const jsonMatch = streamingContent.match(/```(?:canva-doc|canva|report|doc|json)?\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
          try {
            const docData = JSON.parse(jsonMatch[1].trim());
            if (docData && Array.isArray(docData.sections)) {
              validateArtifactQuality(docData, "report");
              setActiveArtifact({
                identifier: "document",
                type: "report",
                title: docData.title || "Executive Document",
                content: jsonMatch[1].trim(),
                reportData: docData,
              });
            }
          } catch (e) {}
        }
      } else {
        const artMatch = streamingContent.match(/<(?:artifact|antArtifact)\s*([^>]*?)>([\s\S]*?)(?:<\/(?:artifact|antArtifact)>|$)/i);
        if (artMatch) {
          const attrStr = artMatch[1];
          const artContent = artMatch[2].trim();
          const idMatch = attrStr.match(/identifier=["']?([^"'\s>]+)["']?/i) || attrStr.match(/id=["']?([^"'\s>]+)["']?/i);
          const typeMatch = attrStr.match(/type=["']?([^"'\s>]+)["']?/i) || attrStr.match(/language=["']?([^"'\s>]+)["']?/i);
          const titleMatch = attrStr.match(/title=["']?([^"'\s>]+)["']?/i);
          const identifier = idMatch ? idMatch[1] : "artifact";
          const type = typeMatch ? typeMatch[1] : "html";
          const title = titleMatch ? titleMatch[1] : (identifier.replace(/[-_]/g, " ").replace(/\b\w/g, (l: string) => l.toUpperCase()));
          setActiveArtifact({ identifier, type, title, content: artContent });
        } else {
          const htmlBlock = streamingContent.match(/```(?:html|htm|svg)\s*([\s\S]*?)\s*```/i);
          if (htmlBlock && (htmlBlock[1].includes("<!DOCTYPE") || htmlBlock[1].includes("<html") || htmlBlock[1].includes("<body") || htmlBlock[1].includes("<style") || htmlBlock[1].includes("<script"))) {
            const titleMatch = htmlBlock[1].match(/<title>(.*?)<\/title>/i);
            const title = titleMatch ? titleMatch[1] : "Website Preview";
            setActiveArtifact({
              identifier: "web-preview",
              type: "html",
              title,
              content: htmlBlock[1].trim()
            });
          }
        }
      }

      // POSTER FALLBACK: If user asked for a poster but the model didn't output a gamma-presentation JSON block,
      // auto-convert the markdown content into a single poster slide for Presentation Studio
      if (wasPosterRequest && !artifactGenerationFailed && !streamingContent.includes('"slides":')) {
        try {
          const posterTopic = displayContent.replace(/\b(?:make|create|generate|design|poster|banner|infographic|flyer|on|for|about|a|an|the)\b/gi, " ").replace(/\s+/g, " ").trim();

          // Extract useful content from the markdown response
          const cleanText = streamingContent
            .replace(/\[META_JSON:[\s\S]*?\]/g, "")
            .replace(/<think>[\s\S]*?<\/think>/g, "")
            .trim();

          // Extract headings to recover information structure without fabricating content.
          const headingRegex = /^#{1,3}\s+(.+)$/gm;
          const headings: string[] = [];
          let hMatch;
          while ((hMatch = headingRegex.exec(cleanText)) !== null) {
            const h = hMatch[1].replace(/\*\*/g, "").trim();
            if (h.length > 2 && h.length < 80) headings.push(h);
          }

          // Extract bullet points
          const bulletRegex = /^[-*•]\s+(.+)$/gm;
          const bullets: string[] = [];
          let bMatch;
          while ((bMatch = bulletRegex.exec(cleanText)) !== null) {
            const b = bMatch[1].replace(/\*\*/g, "").trim();
            if (b.length > 5 && b.length < 200) bullets.push(b);
          }

          // Extract bold metrics (e.g. "Market Valuation: $321 Billion")
          const metricRegex = /\*\*([^*]+)\*\*[:\s]+([^\n*]+)/g;
          const factCards: { label: string; value: string; icon: string }[] = [];
          let mMatch;
          while ((mMatch = metricRegex.exec(cleanText)) !== null && factCards.length < 4) {
            const label = mMatch[1].trim();
            const value = mMatch[2].replace(/\*\*/g, "").trim();
            if (label.length > 1 && label.length < 40 && value.length > 0 && value.length < 50) {
              factCards.push({ label, value, icon: "chart" });
            }
          }

          // Extract first paragraph as body text
          const paragraphs = cleanText.split(/\n\n+/).filter(p => p.length > 40 && !p.startsWith("#") && !p.startsWith("-") && !p.startsWith("*"));
          const bodyText = paragraphs[0]?.replace(/\*\*/g, "").replace(/\[.*?\]\(.*?\)/g, "").trim().slice(0, 360);

          const posterData = {
            id: `poster-${Date.now()}`,
            title: posterTopic || headings[0] || "Visual Poster",
            format: (/infographic/i.test(displayContent) ? "infographic" : /academic|research|conference/i.test(displayContent) ? "academic-poster" : "poster") as PresentationData["format"],
            theme: "academic-clean" as const,
            slides: [{
              id: "s1",
              slideNumber: 1,
              layout: "poster" as const,
              title: posterTopic || headings[0] || "Visual Poster",
              subtitle: headings[1] || undefined,
              visualRole: "hero-image" as const,
              imagePrompt: `${posterTopic}, exact subject-specific editorial visual, no text, no generic stock imagery`,
              content: {
                bodyText,
                metrics: factCards.length > 0 ? factCards.map(({ label, value }) => ({ label, value })) : undefined,
                bullets: bullets.slice(0, 6),
              }
            }]
          } as PresentationData;

          const upgradedPosterData = normalizePresentation(assignPresentationMedia(posterData, currentMedia?.images || []));

          if (!hasRenderablePosterContent(upgradedPosterData)) {
            throw new Error("The fallback poster did not contain enough information to render safely.");
          }

          setActiveArtifact({
            identifier: "presentation",
            type: "poster",
            title: upgradedPosterData.title,
            content: JSON.stringify(upgradedPosterData),
            presentationData: upgradedPosterData,
          });
        } catch (e) {
          console.warn("Poster markdown fallback error:", e);
        }
      }

      if (!isIncognito) {
        let activeConvId = conversationId;
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!activeConvId && session?.user) {
          const { data: convData, error: convError } = await supabase
            .from("conversations")
            .insert([
              {
                title: displayContent.substring(0, 30) || "File Analysis",
                user_id: session.user.id,
              },
            ])
            .select()
            .single();

          if (!convError && convData) {
            activeConvId = convData.id;
            setConversationId(activeConvId);
            if (onConversationCreated) onConversationCreated();
          }
        }

        if (activeConvId) {
          let finalDbContent = streamingContent;
          for (const [p, url] of Object.entries(imageReplacementsRef.current)) {
            finalDbContent = finalDbContent.replace(`[GENERATE_IMAGE: ${p}]`, `![${p}](${url})`);
          }
          const userContentWithAttachments =
            currentAttachments && currentAttachments.length > 0
              ? displayContent + `\n\n[ATTACHMENTS_JSON: ${JSON.stringify(currentHistoryAttachments)}]`
              : displayContent;

          const { data: insertedMsgs } = await supabase.from("messages").insert([
            {
              conversation_id: activeConvId,
              role: "user",
              content: userContentWithAttachments,
            },
            {
              conversation_id: activeConvId,
              role: "assistant",
              content: finalDbContent + `\n\n[META_JSON: ${JSON.stringify({ thoughtTime: Math.floor((Date.now() - startTime) / 1000), model: fallbackModelName || selectedModel, statusLogs: currentLogs, sources: currentSources, webSearch: currentWebSearch, media: currentMedia, searchIntent: currentSearchIntent, effortInfo: currentEffortInfo, effortRecovery: currentEffortRecovery })}]`,
            },
          ]).select();
          
          if (insertedMsgs && insertedMsgs.length > 0) {
            const assistantDbMsg = insertedMsgs.find((m: any) => m.role === "assistant");
            if (assistantDbMsg) {
              setMessages((prev) => {
                const newM = [...prev];
                const last = newM[newM.length - 1];
                if (last && last.role === "assistant") {
                  newM[newM.length - 1] = { ...last, id: assistantDbMsg.id };
                }
                return newM;
              });
            }
          }
        }
      }
    } catch (error: any) {
      disarmCompletionChime();
      if (isAbortError(error)) {
        setMessages((prev) => {
          const newM = [...prev];
          const last = newM[newM.length - 1];
          if (last && last.role === "assistant") {
            newM[newM.length - 1] = {
              ...last,
              content:
                last.content +
                (last.content ? "\n\n" : "") +
                "*[Generation stopped by user]*",
              isStreaming: false,
            };
          }
          return newM;
        });
        return;
      }
      console.error("Chat error:", error);
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        const errorText = friendlyRequestError(error);
        if (last?.role === "assistant" && last.isStreaming) {
          next[next.length - 1] = {
            ...last,
            content: `${last.content}${last.content ? "\n\n" : ""}${errorText}`,
            isStreaming: false,
          };
          return next;
        }
        return [...next, { role: "assistant", content: errorText }];
      });
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  };



  const allModels = LLM_MODELS;
  const currentModelData = allModels.find((m) => m.name === selectedModel) || {
    name: selectedModel,
    desc: "AI model",
    maxUsage: 1000,
  };
  const thinkingLevels: Array<{ value: ReasoningEffort; label: string }> = [
    { value: "low", label: "Penumbra" },
    { value: "medium", label: "Umbra" },
    { value: "high", label: "Tenebrae" },
  ];
  const thinkingEffortIndex = Math.max(0, thinkingLevels.findIndex((level) => level.value === reasoningEffort));
  const thinkingLabel = thinkingLevels[thinkingEffortIndex].label;
  const thinkingStopPositions = ["10px", "50%", "calc(100% - 10px)"];
  const setThinkingEffortFromSlider = (value: number) => {
    const nextLevel = thinkingLevels[value];
    if (!nextLevel) return;
    setReasoningEffort(nextLevel.value);
    if (conversationId) {
      localStorage.setItem(`void:reasoning-effort:${conversationId}`, nextLevel.value);
    }
  };
  const thinkingEffortSelectorJsx = (
    <div className="relative shrink-0">
      <motion.button
        type="button"
        whileTap={{ scale: 0.97 }}
        onClick={() => {
          setIsThinkingEffortOpen((open) => !open);
        }}
        className={`flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1.5 text-sm font-medium transition-colors duration-200 ${
          isThinkingEffortOpen
            ? "bg-gray-200 text-gray-900 dark:bg-[#3A3A3A] dark:text-white"
            : "text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-[#303030] dark:hover:text-white"
        }`}
        aria-expanded={isThinkingEffortOpen}
        aria-haspopup="dialog"
        aria-label={`Thinking effort: ${thinkingLabel}`}
        title={`Thinking effort: ${thinkingLabel}`}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={thinkingLabel}
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -3 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
          >
            {thinkingLabel}
          </motion.span>
        </AnimatePresence>
        <motion.div animate={{ rotate: isThinkingEffortOpen ? 180 : 0 }} transition={{ duration: 0.18, ease: "easeOut" }}>
          <ChevronDown size={14} aria-hidden="true" />
        </motion.div>
      </motion.button>

      {isThinkingEffortOpen && (
        <button
          type="button"
          className="fixed inset-0 z-[55] cursor-default bg-transparent"
          onClick={() => setIsThinkingEffortOpen(false)}
          aria-label="Close thinking effort"
        />
      )}

      <AnimatePresence>
        {isThinkingEffortOpen && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 460, damping: 32, mass: 0.7 }}
            className="absolute bottom-full left-0 z-[60] mb-3 w-56 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-gray-200 bg-white p-3.5 shadow-2xl sm:left-auto sm:right-0 dark:border-[#454545] dark:bg-[#303030]"
            role="dialog"
            aria-label="Thinking effort"
          >
            <div className="mb-3 flex items-center justify-center text-base font-semibold text-gray-900 dark:text-white">
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={thinkingLabel}
                  initial={{ opacity: 0, y: 4, filter: "blur(2px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0, y: -4, filter: "blur(2px)" }}
                  transition={{ duration: 0.16, ease: "easeOut" }}
                >
                  {thinkingLabel}
                </motion.span>
              </AnimatePresence>
              <ChevronRight size={14} className="ml-1 inline-block text-gray-400" aria-hidden="true" />
            </div>
            <div className="relative h-8 min-w-0">
              <div className="absolute inset-x-3 top-1/2 h-5 -translate-y-1/2">
                <div className="absolute inset-0 overflow-hidden rounded-full bg-gray-200 dark:bg-[#4A4A4A]">
                  {/* ThinkingEnergy paints the gravitational fill inside this track. */}

                </div>
                <ThinkingEnergy level={thinkingEffortIndex} />
                <motion.div
                  className="pointer-events-none absolute top-1/2 z-20 h-6 w-6 rounded-full border border-gray-300 bg-white shadow-md dark:border-[#606060] dark:bg-[#F5F5F5]"
                  animate={{ left: thinkingStopPositions[thinkingEffortIndex], x: "-50%", y: "-50%" }}
                  transition={{ type: "spring", stiffness: 330, damping: 28, mass: 0.72 }}
                />
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="1"
                  value={thinkingEffortIndex}
                  onInput={(event) => setThinkingEffortFromSlider(Number(event.currentTarget.value))}
                  className="thinking-range absolute inset-0 z-30 h-full w-full cursor-pointer appearance-none opacity-0"
                  aria-label="Thinking effort"
                  aria-valuetext={thinkingLabel}
                  title="Drag to choose thinking effort"
                />
              </div>
            </div>
            <div className="mt-2 flex justify-between text-[11px] text-gray-500 dark:text-gray-400">
              {thinkingLevels.map((level, index) => (
                <button key={level.value} type="button" aria-pressed={reasoningEffort === level.value}
                  onClick={() => setThinkingEffortFromSlider(index)}
                  className="rounded-md px-2 py-1 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-gray-500 dark:hover:bg-white/10">
                  {level.label}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );

  const AttachmentChip = () => {
    if (attachments.length === 0) return null;
    return (
      <div className="flex flex-wrap gap-2 w-full">
        {attachments.map((att, idx) => {
          const isVideo = att.type.startsWith("video/");
          const isImage = att.type.startsWith("image/");
          const imagePreviewUrl =
            isImage && att.base64
              ? `data:${att.type};base64,${att.base64}`
              : att.url;

          return (
            <div
              key={idx}
              className="flex items-center gap-2 bg-gray-100 dark:bg-[#1A1A1A] px-3 py-2 rounded-xl border border-gray-200 dark:border-[#3A3A3A] w-fit shadow-sm group cursor-pointer hover:bg-gray-200 dark:hover:bg-[#2A2A2A] transition-colors"
              onClick={() => setPreviewAttachment(att)}
            >
              {isImage && imagePreviewUrl ? (
                <div className="relative">
                  <img
                    src={imagePreviewUrl}
                    alt="Preview"
                    className="h-10 w-10 object-cover rounded-md shadow-sm"
                  />
                </div>
              ) : isVideo ? (
                <Film
                  size={14}
                  className="text-blue-500 dark:text-blue-400 shrink-0"
                />
              ) : att.type.includes("spreadsheetml") ||
                att.type.includes("ms-excel") ? (
                <FileSpreadsheet
                  size={14}
                  className="text-green-600 dark:text-green-500 shrink-0"
                />
              ) : (
                <FileText size={14} className="text-gray-500 shrink-0" />
              )}
              <span className="text-xs text-gray-700 dark:text-gray-400 truncate max-w-[120px]">
                {att.name}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setAttachments((prev) => prev.filter((_, i) => i !== idx));
                }}
                className="text-gray-400 hover:text-red-500 transition-colors ml-1"
                aria-label="Remove attachment"
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    );
  };


  const handleCopy = (text: string, index: number) => {
    navigator.clipboard.writeText(generatedBreakTagsToPlainText(text)).catch((err) => console.error("Clipboard error:", err));
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const toggleFeedback = (index: number, feedbackType: string) => {
    setMessages(prev => prev.map((msg, i) => {
      if (i === index) {
        return { ...msg, feedback: feedbackType };
      }
      return msg;
    }));
  };

const handleRegenerate = async (index: number) => {
  imageReplacementsRef.current = {};
  const prevMsg = messages[index - 1];
  if (!prevMsg || prevMsg.role !== "user") return;

  const baseMessages = messages.slice(0, index);
  const originalAssistant = messages[index];
  if (!originalAssistant || originalAssistant.role !== "assistant") return;
  const suffixMessages = messages.slice(index + 1);
  const replacementId = originalAssistant.id || `regenerated-${Date.now()}-${index}`;
  const originalVersions = originalAssistant.versions?.length
    ? originalAssistant.versions
    : [originalAssistant.content];
  const replaceInConversation = (replacement: Message) => [
    ...baseMessages,
    { ...replacement, id: replacementId },
    ...suffixMessages,
  ];
  const regenerateAttachments = getMessageAttachments(prevMsg);
  armCompletionChime();

  const resolvedRegeneration = resolveInfographicFollowUp(baseMessages.slice(0, -1), prevMsg.content);
  if (isRasterPosterCreationRequest(resolvedRegeneration)) {
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const startedAt = Date.now();
    const preparedPrompt = prepareRasterPosterPrompt(baseMessages.slice(0, -1), resolvedRegeneration);
    setIsLoading(true);
    setIsGeneratingImage(true);
    setMessages(replaceInConversation({
      ...originalAssistant,
      role: "assistant",
      content: "",
      isStreaming: true,
      isImageGenerating: true,
      modelName: POSTER_IMAGE_MODEL,
      versions: originalVersions,
      activeVersionIndex: Math.max(0, originalVersions.length - 1),
    }));
    try {
      const generated = await generateRasterPosterAsset(preparedPrompt, controller.signal, (modelName) => {
        setMessages((current) => {
          const next = [...current];
          const targetIndex = next.findIndex((message) => message.id === replacementId);
          const target = next[targetIndex];
          if (target?.role === "assistant" && target.isImageGenerating) next[targetIndex] = { ...target, modelName };
          return next;
        });
      });
      await preloadGeneratedImage(generated.url, 90_000, controller.signal);
      const thoughtTime = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
      const content = `Here is the regenerated poster:\n\n![Generated poster for ${prevMsg.content} | model=${generated.modelUsed}](${generated.url})\n\n[META_JSON: ${JSON.stringify({ thoughtTime, model: generated.modelUsed })}]`;
      const completed: Message = {
        ...originalAssistant,
        role: "assistant",
        content,
        thoughtTime,
        modelName: generated.modelUsed,
        isStreaming: false,
        isImageGenerating: false,
        versions: [...originalVersions, content],
        activeVersionIndex: originalVersions.length,
      };
      setMessages(replaceInConversation(completed));
      announceGenerationComplete();
      if (!isIncognito && conversationId) {
        const query = originalAssistant.id
          ? supabase.from("messages").update({ content }).eq("id", originalAssistant.id).select()
          : supabase.from("messages").insert([{ conversation_id: conversationId, role: "assistant", content }]).select();
        const { data: inserted } = await query;
        const saved = inserted?.[0];
        if (saved) setMessages((current) => current.map((message) => message.id === replacementId ? { ...message, id: saved.id } : message));
      }
    } catch (error) {
      disarmCompletionChime();
      if (isAbortError(error)) {
        setMessages(replaceInConversation({ ...originalAssistant, content: "*[Poster regeneration stopped by user]*", isStreaming: false, isImageGenerating: false }));
      } else {
        console.error("Poster regenerate error:", error);
        setMessages(replaceInConversation({ ...originalAssistant, content: friendlyRequestError(error), isStreaming: false, isImageGenerating: false }));
      }
    } finally {
      setIsGeneratingImage(false);
      setIsLoading(false);
      abortControllerRef.current = null;
    }
    return;
  }

  const requestBaseMessages = prepareStudioMessages(compactMessagesForTransport(baseMessages.map((message, messageIndex) =>
    messageIndex === baseMessages.length - 1 && !message.content.trim()
      ? { ...message, content: "Analyze the attached image in detail and explain what it shows." }
      : message,
  )));
  setIsLoading(true);

  try {
    let streamingContent = "";
    let currentPhase: ResponsePhase = "thinking";
    let currentEffortInfo: EffortInfo | undefined;
    let currentEffortRecovery: string | undefined;
    let currentLogs: { action: string; query: string }[] = [];
    let currentSources: string[] = [];
    let currentWebSearch: WebSearchData | undefined = undefined;
    let currentMedia: MediaPayload | undefined = undefined;
    let currentSearchIntent: { webSearchIntent: string; webImageIntent: string } | undefined = undefined;
    let fallbackModelName: string | undefined = undefined;
    let startTime = Date.now();

    const assistantMessage: Message = {
      ...originalAssistant,
      role: "assistant",
      content: "",
      isStreaming: true,
      statusLogs: [],
      thoughtTime: 0,
      modelName: selectedModel,
      id: replacementId,
      versions: originalVersions,
      activeVersionIndex: Math.max(0, originalVersions.length - 1),
    };

    const newMessagesWithAssistant = replaceInConversation(assistantMessage);
    setMessages(newMessagesWithAssistant);

    const timerInterval = setInterval(() => {
      setMessages((prev) => {
        const newM = [...prev];
        const targetIndex = newM.findIndex((message) => message.id === replacementId);
        const target = newM[targetIndex];
        if (target && target.role === "assistant" && target.isStreaming) {
          newM[targetIndex] = {
            ...target,
            thoughtTime: Math.floor((Date.now() - startTime) / 1000),
          };
        }
        return newM;
      });
    }, 1000);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: await authenticatedJsonHeaders(),
      signal: abortController.signal,
      body: JSON.stringify({
        messages: requestBaseMessages,
        model: "Auto",
        systemPrompt: systemPrompt,
        reasoningEffort,

        attachments: regenerateAttachments,
        conversationId: agentSessionIdRef.current,
        userId: userId,
          userEmail: userEmail,
        isWebSearch: isWebSearch,
      }),
    });

    if (!response.ok) {
      clearInterval(timerInterval);
      throw new Error(`Server returned ${response.status}`);
    }

    if (!response.body) throw new Error("No response body");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let done = false;
    let buffer = "";

    while (!done) {
      const { value, done: readerDone } = await reader.read();
      done = readerDone;
      if (value) {
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ") && line.trim() !== "data: [DONE]") {
            try {
              const data = JSON.parse(line.slice(6));
              currentPhase = responsePhaseForEvent(data, currentPhase);
              if (data.type === "effort") currentEffortInfo = data;
              if (data.type === "effort_recovery") currentEffortRecovery = data.message;
              if (data.type === "status") {
                currentLogs = [
                  ...currentLogs,
                  { action: data.action, query: data.query },
                ];
              } else if (data.type === "searchIntent") {
                currentSearchIntent = {
                  webSearchIntent: data.webSearchIntent,
                  webImageIntent: data.webImageIntent,
                };
              } else if (data.type === "sources") {
                currentSources = mergeSourceUrls(currentSources, data.sources);
              } else if (data.type === "webSearch") {
                currentWebSearch = mergeWebSearchData(currentWebSearch, data);
                currentSources = mergeSourceUrls(currentSources, sourceUrlsFromWebSearch(data));
              } else if (data.type === "media") {
                currentMedia = mergeMediaPayload(currentMedia, data);
              } else if (data.type === "media_status") {
                currentLogs = [...currentLogs, { action: data.label || "Web image update", query: data.reason || "" }];
              } else if (data.type === "text") {
                streamingContent += data.content;
              } else if (data.type === "reset") {
                streamingContent = "";
              } else if (data.type === "error") {
                streamingContent += `\n\n${data.error}`;
              } else if (data.type === "model_fallback") {
                fallbackModelName = data.uiName;
              } else if (data.type === "model_runtime") {
                fallbackModelName = data.uiName || fallbackModelName;
              } else if (data.type === "agent_plan") {
                currentLogs = [...currentLogs, { action: "Planning the work", query: "" }];
              } else if (data.type === "agent_status") {
                const progress = visibleProgressLogs([{ action: data.label || "Reviewing the request" }]);
                currentLogs = [...currentLogs, ...progress.map((log) => ({ action: log.action || "Reviewing the request", query: log.query || "" }))];
              } else if (data.type === "agent_result") {
                currentLogs = [...currentLogs, agentResultLog(data)];
              }

            } catch (e) {}
          }
        }
              setMessages((prev) => {
                const newM = [...prev];
                const targetIndex = newM.findIndex((message) => message.id === replacementId);
                const target = newM[targetIndex];
                if (target && target.role === "assistant") {
                  newM[targetIndex] = {
                    ...target,
                    content: streamingContent,
                    statusLogs: currentLogs,
                    responsePhase: currentPhase,
                    effortInfo: currentEffortInfo,
                    effortRecovery: currentEffortRecovery,
                    sources: currentSources,
                    webSearch: currentWebSearch,
                    media: currentMedia,
                    searchIntent: currentSearchIntent,
                    modelName: fallbackModelName || target.modelName,
                  };
                }
                return newM;
              });
      }
    }

    clearInterval(timerInterval);

    setMessages((prev) => {
      const newM = [...prev];
      const targetIndex = newM.findIndex((message) => message.id === replacementId);
      const target = newM[targetIndex];
      if (target && target.role === "assistant") {
        let finalContent = normalizeGeneratedBreakTags(streamingContent);
        for (const [prompt, url] of Object.entries(imageReplacementsRef.current)) {
          finalContent = finalContent.replace(`[GENERATE_IMAGE: ${prompt}]`, `![${prompt}](${url})`);
        }
        newM[targetIndex] = {
          ...target,
          content: finalContent,
          isStreaming: false,
          thoughtTime: Math.floor((Date.now() - startTime) / 1000),
          statusLogs: currentLogs,
          responsePhase: currentPhase,
          effortInfo: currentEffortInfo,
          effortRecovery: currentEffortRecovery,
          sources: currentSources,
          webSearch: currentWebSearch,
          media: currentMedia,
          searchIntent: currentSearchIntent,
          modelName: fallbackModelName || target.modelName,
          versions: [...originalVersions, finalContent],
          activeVersionIndex: originalVersions.length,
        };
      }
      return newM;
    });
    announceGenerationComplete();

    if (!isIncognito && conversationId) {
      let finalDbContent = normalizeGeneratedBreakTags(streamingContent);
      for (const [p, url] of Object.entries(imageReplacementsRef.current)) {
        finalDbContent = finalDbContent.replace(`[GENERATE_IMAGE: ${p}]`, `![${p}](${url})`);
      }
      const persistedContent = finalDbContent + `\n\n[META_JSON: ${JSON.stringify({ thoughtTime: Math.floor((Date.now() - startTime) / 1000), model: fallbackModelName || selectedModel, statusLogs: currentLogs, sources: currentSources, webSearch: currentWebSearch, media: currentMedia, searchIntent: currentSearchIntent, effortInfo: currentEffortInfo, effortRecovery: currentEffortRecovery })}]`;
      const persistQuery = originalAssistant.id
        ? supabase.from("messages").update({ content: persistedContent }).eq("id", originalAssistant.id).select()
        : supabase.from("messages").insert([{
          conversation_id: conversationId,
          role: "assistant",
          content: persistedContent,
        }]).select();
      const { data: insertedMsgs } = await persistQuery;
      
      if (insertedMsgs && insertedMsgs.length > 0) {
        const assistantDbMsg = insertedMsgs.find((m: any) => m.role === "assistant") || insertedMsgs[0];
        if (assistantDbMsg) {
          setMessages((prev) => {
            const newM = [...prev];
            const targetIndex = newM.findIndex((message) => message.id === replacementId);
            const target = newM[targetIndex];
            if (target && target.role === "assistant") {
              newM[targetIndex] = { ...target, id: assistantDbMsg.id };
            }
            return newM;
          });
        }
      }
    }
  } catch (error: any) {
    disarmCompletionChime();
    if (isAbortError(error)) {
      setMessages((prev) => {
        const newM = [...prev];
        const targetIndex = newM.findIndex((message) => message.id === replacementId);
        const target = newM[targetIndex];
        if (target && target.role === "assistant") {
          newM[targetIndex] = {
            ...target,
            content:
              target.content +
              (target.content ? "\n\n" : "") +
              "*[Generation stopped by user]*",
            isStreaming: false,
          };
        }
        return newM;
      });
      return;
    }
    console.error("Regenerate Error:", error);
    setMessages(replaceInConversation({ ...originalAssistant, content: friendlyRequestError(error), isStreaming: false }));
  } finally {
    setIsLoading(false);
    abortControllerRef.current = null;
  }
};

const handleIncognitoToggle = () => {
  setIsIncognito(!isIncognito);
  setIsIncognitoAnimating(true);
  setTimeout(() => setIsIncognitoAnimating(false), 600);
};

const topControlsJsx = (
  <div className="w-full flex items-center justify-between px-3 sm:px-6 py-2.5 bg-gray-50 dark:bg-[#1E1E1E] border-b border-gray-200 dark:border-[#2A2A2A] shrink-0 z-20">
    <div className="flex items-center gap-2">
      <button
        onClick={toggleSidebar}
        className="p-2 rounded-lg text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white bg-white dark:bg-[#2A2A2A] hover:bg-gray-100 dark:hover:bg-[#333] transition-colors sm:hidden border border-gray-200 dark:border-[#3A3A3A]"
        title="Toggle Sidebar Menu"
      >
        <PanelLeft size={18} />
      </button>
      <button
        onClick={() => setMessages([])}
        className="p-2 rounded-lg text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white bg-white dark:bg-[#2A2A2A] hover:bg-gray-100 dark:hover:bg-[#333] transition-colors sm:hidden border border-gray-200 dark:border-[#3A3A3A]"
        title="New Chat"
      >
        <Plus size={18} />
      </button>
    </div>

    <div className="flex items-center gap-2">
      <button
        onClick={handleIncognitoToggle}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium transition-colors ${
          isIncognito
            ? "bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-200 border border-purple-300 dark:border-purple-700/40"
            : "bg-white dark:bg-[#2A2A2A] text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 border border-gray-300 dark:border-[#3A3A3A]"
        }`}
      >
        <Ghost
          size={16}
          className={isIncognitoAnimating ? "animate-ghost-eyes" : ""}
        />
        {isIncognito ? "Incognito On" : "Incognito Off"}
      </button>
    </div>
  </div>
);

const markdownComponents = React.useMemo(
  () => ({
    // Custom blocks own their <pre>; an outer pre would inherit nowrap and invalid nesting.
    pre: ({ children }: any) => <div className="markdown-block w-full min-w-0 max-w-full">{children}</div>,
    p: ({ children }: any) => (
      <span className="block mb-3 whitespace-normal leading-[1.65] text-gray-900 dark:text-gray-100 font-sans text-[15px] md:text-[16px] antialiased flow-root last:mb-0">
        {children}
      </span>
    ),
    li: ({ children }: any) => (
      <li className="mb-1 whitespace-normal leading-[1.65] text-gray-800 dark:text-gray-200 font-sans text-[15px] md:text-[16px] antialiased flow-root last:mb-0">
        {children}
      </li>
    ),
    ul: ({ children }: any) => (
      <ul className="ml-5 mb-4 list-disc space-y-0.5 text-gray-900 dark:text-gray-100 font-sans flow-root">
        {children}
      </ul>
    ),
    ol: ({ children }: any) => (
      <ol className="ml-5 mb-4 list-decimal space-y-0.5 text-gray-900 dark:text-gray-100 font-sans flow-root">
        {children}
      </ol>
    ),
    strong: ({ children }: any) => (
      <strong className="font-semibold text-gray-900 dark:text-white">
        {children}
      </strong>
    ),
    em: ({ children }: any) => (
      <span className="text-gray-700 dark:text-gray-300">{children}</span>
    ),
    a: ({ node, href, children, ...props }: any) => {
      if (!href) return <span>{children}</span>;

      let finalHref = href;
      // If the link does not start with a standard protocol or path
      if (!/^(https?:\/\/|mailto:|tel:|\/|#)/i.test(href)) {
        if (!href.includes(".")) {
          // If it's a single word like "Instagram", append .com to direct to the website
          // Clean up the string in case there are spaces or it's title-cased
          finalHref = `https://${href.toLowerCase().trim()}.com`;
        } else {
          // If it's something like "www.instagram.com", prepend https://
          finalHref = `https://${href}`;
        }
      }

      const citationLabel = React.Children.toArray(children)
        .map((child) => typeof child === "string" || typeof child === "number" ? String(child) : "")
        .join("")
        .trim();
      if (/^\d+$/.test(citationLabel)) {
        return <LinkRefPill href={finalHref}>Source {citationLabel}</LinkRefPill>;
      }

      return <LinkRefPill href={finalHref}>{children}</LinkRefPill>;
    },
    blockquote: ({ children }: any) => (
      <blockquote className="border-l-3 border-gray-400 dark:border-gray-500 pl-4 my-4 text-gray-700 dark:text-gray-300 bg-gray-50/50 dark:bg-[#2A2A2A]/50 py-3 rounded-r-lg font-sans not-italic">
        {children}
      </blockquote>
    ),
    h1: ({ children }: any) => (
      <h1 className="text-2xl font-bold mb-4 mt-6 text-gray-900 dark:text-white font-sans">
        {children}
      </h1>
    ),
    h2: ({ children }: any) => (
      <h2 className="text-xl font-bold mb-3 mt-5 text-gray-900 dark:text-white font-sans">
        {children}
      </h2>
    ),
    h3: ({ children }: any) => (
      <h3 className="text-lg font-semibold mb-2 mt-4 text-gray-900 dark:text-white font-sans">
        {children}
      </h3>
    ),
    hr: () => <hr className="my-6 border-gray-200 dark:border-[#3A3A3A]" />,
    table: ({ children }: any) => (
      <div className="my-5 overflow-x-auto rounded-xl border border-gray-200 dark:border-[#3A3A3A] shadow-sm">
        <table className="w-full text-sm text-left border-collapse font-sans text-gray-900 dark:text-gray-300">
          {children}
        </table>
      </div>
    ),
    thead: ({ children }: any) => (
      <thead className="bg-gray-100 dark:bg-[#252525] text-gray-700 dark:text-gray-200 uppercase text-xs font-bold border-b border-gray-200 dark:border-[#3A3A3A]">
        {children}
      </thead>
    ),
    th: ({ children }: any) => (
      <th className="whitespace-pre-line px-4 py-3 border-r border-gray-200 dark:border-[#3A3A3A] last:border-r-0">
        {children}
      </th>
    ),
    td: ({ children }: any) => (
      <td className="whitespace-pre-line px-4 py-3 border-b border-gray-200 dark:border-[#3A3A3A] border-r border-gray-200 dark:border-[#3A3A3A] last:border-r-0">
        {children}
      </td>
    ),
    tr: ({ children }: any) => (
      <tr className="hover:bg-gray-50/50 dark:hover:bg-[#2A2A2A]/50 transition-colors">
        {children}
      </tr>
    ),
    img: (props: any) => <MarkdownImage {...props} setPreviewAttachment={setPreviewAttachment} />,
    code: ({ className, children, ...props }: any) => {
      const match = /language-([^\s]+)/.exec(className || "");
      const rawValue = String(children);
      const isInline = !match && !rawValue.includes("\n");

      if (isInline) {
        return (
          <code
            className="bg-gray-100 dark:bg-[#2A2A2A] px-1.5 py-0.5 rounded text-sm text-amber-700 dark:text-amber-200 font-mono"
            {...props}
          >
            {children}
          </code>
        );
      }

      const language = match?.[1] || "";
      const codeString = rawValue.replace(/\n$/, "");

      const writingType = inferWritingType(codeString, language);
      if (writingType) {
        return <WritingBlock label={writingType} content={codeString} />;
      }

      const parsedStudio = parseStudioJson(codeString);

      // 1. Gamma Presentation Check:
      const langLower = (language || "").toLowerCase();
      const isPresentationBlock =
        ["gamma-presentation", "gamma", "presentation", "ppt", "slides"].includes(langLower) ||
        codeString.includes('"slides":');

      if (isPresentationBlock) {
        const presData =
          (parsedStudio && parsedStudio.slides
            ? (parsedStudio as PresentationData)
            : null) || extractRealSlidesFromCode(codeString);
        const extractedTitleMatch = codeString.match(/"title":\s*"([^"]+)"/);
        const displayTitle =
          presData?.title ||
          (extractedTitleMatch ? extractedTitleMatch[1] : "Gamma AI Presentation");
        const displaySlideCount = presData?.slides?.length || 10;

        if (presData) {
          return (
            <div
              onClick={() =>
                setActiveArtifact({
                  identifier: "presentation",
                  type: "presentation",
                  title: displayTitle,
                  content: codeString,
                  presentationData: normalizePresentation(presData),
                })
              }
              className="my-3 inline-flex items-center gap-3 px-4 py-2.5 bg-[#18181B] hover:bg-[#202024] border border-[#27272A] rounded-2xl shadow-lg transition-all group max-w-full cursor-pointer"
            >
              <div className="p-1.5 rounded-xl bg-[#27272A] text-white border border-[#3F3F46] shrink-0">
                <Sparkles size={16} />
              </div>
              <div className="min-w-0 flex-1 flex items-center gap-2.5 overflow-hidden">
                <span className="text-xs font-bold text-white truncate max-w-[200px] sm:max-w-md">
                  {displayTitle}
                </span>
                <span className="text-[10px] font-mono font-bold text-gray-200 bg-[#27272A] px-2 py-0.5 rounded-lg shrink-0 border border-[#3F3F46]">
                  {displaySlideCount} {displaySlideCount === 1 ? "Slide" : "Slides"}
                </span>
              </div>
              <span className="px-3 py-1.5 bg-white group-hover:bg-gray-200 text-black text-xs font-bold rounded-xl flex items-center gap-1.5 transition-all shadow-md shrink-0">
                <Eye size={13} />
                <span>Open Preview</span>
              </span>
            </div>
          );
        }
      }

      // 2. Document Check:
      if (parsedStudio && parsedStudio.sections) {
        const docData = parsedStudio as ReportData;
        return (
          <div
            onClick={() =>
              setActiveArtifact({
                identifier: "document",
                type: "report",
                title: docData.title || "Report",
                content: codeString,
                reportData: docData,
              })
            }
            className="my-3 inline-flex items-center gap-3 px-4 py-2.5 bg-[#18181B] hover:bg-[#202024] border border-[#27272A] rounded-2xl shadow-lg transition-all group max-w-full cursor-pointer"
          >
            <div className="p-1.5 rounded-xl bg-[#27272A] text-white border border-[#3F3F46] shrink-0">
              <FileText size={16} />
            </div>
            <div className="min-w-0 flex-1 flex items-center gap-2.5 overflow-hidden">
              <span className="text-xs font-bold text-white truncate max-w-[200px] sm:max-w-md">
                {docData.title || "Executive Document"}
              </span>
              <span className="text-[10px] font-mono font-bold text-gray-200 bg-[#27272A] px-2 py-0.5 rounded-lg shrink-0 border border-[#3F3F46]">
                {docData.sections.length} Sections
              </span>
            </div>
            <span className="px-3 py-1.5 bg-white group-hover:bg-gray-200 text-black text-xs font-bold rounded-xl flex items-center gap-1.5 transition-all shadow-md shrink-0">
              <Eye size={13} />
              <span>Open Preview</span>
            </span>
          </div>
        );
      }

      return (
        <CodeBlockWithPreview
          language={language}
          code={codeString}
          theme={theme}
          setActiveArtifact={setActiveArtifact}
          rawProps={props}
        />
      );
    },
  }),
  [theme],
);

  useEffect(() => {
    if (!isResizingPane) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current || !chatPaneRef.current || !artifactPaneRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const newWidthPercent = ((e.clientX - containerRect.left) / containerRect.width) * 100;
      const clampedWidth = Math.min(Math.max(newWidthPercent, 20), 80);
      chatPaneRef.current.style.width = `${clampedWidth}%`;
      artifactPaneRef.current.style.width = `${100 - clampedWidth}%`;
    };

    const handleMouseUp = (e: MouseEvent) => {
      setIsResizingPane(false);
      if (containerRef.current) {
        const containerRect = containerRef.current.getBoundingClientRect();
        const newWidthPercent = ((e.clientX - containerRect.left) / containerRect.width) * 100;
        const clampedWidth = Math.min(Math.max(newWidthPercent, 20), 80);
        setArtifactWidth(100 - clampedWidth);
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizingPane]);

  const prevConvIdRef = useRef(conversationId);
  useEffect(() => {
    // Only reset context tokens if we switch from one active chat to another,
    // or if the chat is completely empty (i.e. New Chat).
    // This prevents the tokens from resetting to 0 when the first message 
    // of a new chat is sent (which causes conversationId to transition from null to a UUID).
    if (messages.length === 0) {
      setCurrentContextTokens(0);
      if (prevConvIdRef.current !== null && conversationId === null) {
        agentSessionIdRef.current = crypto.randomUUID();
        setIsVoiceModeActive(false);
      }
    } else if (prevConvIdRef.current !== null && conversationId !== null && conversationId !== prevConvIdRef.current) {
      setCurrentContextTokens(0);
      agentSessionIdRef.current = conversationId;
    }
    prevConvIdRef.current = conversationId;
  }, [conversationId, messages.length]);

  const usageKey = getUsageKey(selectedModel);
  const isImageModel = selectedModel.includes("FLUX") || selectedModel === "HF Super Realism" || selectedModel === "Ideogram" || selectedModel === "Gemini Image" || selectedModel === "Cloudflare SDXL" || selectedModel === "cloudflare-sdxl";
  const isVoiceModel = selectedModel === "Void Voice Agent";
  const maxUsageLimit = currentModelData?.maxUsage || 1000;
  
  let currentUsageNum = 0;
  if (isImageModel) {
    currentUsageNum = sessionUsage?.[usageKey]?.generated || 0;
  } else if (isVoiceModel) {
    currentUsageNum = sessionUsage?.[usageKey]?.queries || 0;
  } else {
    currentUsageNum = sessionUsage?.[usageKey]?.total || 0;
  }

  const formatTokensStr = (num: number) => {
    if (!Number.isFinite(num)) return "Unlimited";
    if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
    if (num >= 1000) return (num / 1000).toFixed(1) + "k";
    return num.toString();
  };
  
  const isRateLimited = false; // Rate limiting handled gracefully on backend
  const usagePercentage = Math.min(currentUsageNum / maxUsageLimit, 1);
  const visualPercentage = currentUsageNum > 0 && usagePercentage < 0.05 ? 0.05 : usagePercentage;
  const displayPercentage = Math.round(usagePercentage * 100);
  const displayPercentageStr = displayPercentage === 0 && currentUsageNum > 0 ? "<1" : displayPercentage;

  const handleVoicePartialTranscript = useCallback((text: string) => {
    pendingVoiceTranscriptRef.current = text;
    if (voiceTranscriptFrameRef.current !== null) return;
    voiceTranscriptFrameRef.current = window.requestAnimationFrame(() => {
      voiceTranscriptFrameRef.current = null;
      const next = pendingVoiceTranscriptRef.current;
      if (next) {
        voiceDraftActiveRef.current = true;
        setInput(next);
      } else if (voiceDraftActiveRef.current) {
        voiceDraftActiveRef.current = false;
        setInput("");
      }
    });
  }, []);

  const handleVoiceTranscript = (userText: string) => {
    if (voiceTranscriptFrameRef.current !== null) {
      window.cancelAnimationFrame(voiceTranscriptFrameRef.current);
      voiceTranscriptFrameRef.current = null;
    }
    pendingVoiceTranscriptRef.current = "";
    voiceDraftActiveRef.current = false;
    setInput("");
    // A new spoken turn freezes any interrupted partial answer and starts a
    // fresh assistant bubble, just like typing another message in the chat.
    voiceAssistantIdRef.current = null;
    setMessages((previous) => [
      ...previous,
      { role: "user", content: userText },
    ]);
  };

  const handleVoiceResponseUpdate = (
    assistantText: string,
    complete: boolean,
    meta?: Pick<Message, "statusLogs" | "sources" | "webSearch" | "searchIntent" | "modelName">,
  ) => {
    const content = normalizeGeneratedBreakTags(assistantText);
    const responseId = voiceAssistantIdRef.current || `voice-response-${Date.now()}-${crypto.randomUUID()}`;
    voiceAssistantIdRef.current = responseId;
    setMessages((previous) => {
      const responseIndex = previous.findIndex((message) => message.id === responseId);
      const response: Message = {
        ...(responseIndex >= 0 ? previous[responseIndex] : {}),
        id: responseId,
        role: "assistant",
        content,
        modelName: meta?.modelName || "Void Voice Agent",
        isStreaming: !complete,
        statusLogs: meta?.statusLogs,
        sources: meta?.sources,
        webSearch: meta?.webSearch,
        searchIntent: meta?.searchIntent,
      };
      if (responseIndex < 0) return [...previous, response];
      const next = [...previous];
      next[responseIndex] = response;
      return next;
    });
    if (complete) voiceAssistantIdRef.current = null;
  };

  const handleVoiceTurnComplete = (_userText: string, assistantText: string) => {
    setMessages((previous) => [
      ...previous,
      { role: "assistant", content: assistantText, modelName: "Void Voice Agent" },
    ]);
  };

  const handleVoiceVisualRequest = (userText: string): boolean => {
    const trimmed = userText.trim();
    const normalized = resolveInfographicFollowUp(messages, trimmed);
    const isVisualRequest = trimmed.toLowerCase().startsWith("/imagine ")
      || isNaturalImageGeneration(normalized);
    if (!isVisualRequest) return false;

    if (voiceTranscriptFrameRef.current !== null) {
      window.cancelAnimationFrame(voiceTranscriptFrameRef.current);
      voiceTranscriptFrameRef.current = null;
    }
    pendingVoiceTranscriptRef.current = "";
    voiceDraftActiveRef.current = false;
    voiceAssistantIdRef.current = null;
    setInput("");
    void handleSend(trimmed);
    return true;
  };
  
  let formattedCurrent = "0";
  let formattedMax = formatTokensStr(maxUsageLimit);
  if (isImageModel) {
    formattedCurrent = currentUsageNum.toString() + " Img";
    formattedMax += " Img";
  } else if (isVoiceModel) {
    formattedCurrent = currentUsageNum.toString() + " Q";
    formattedMax += " Q";
  } else {
    formattedCurrent = formatTokensStr(currentUsageNum);
  }

  const parseContextWindow = (ctxStr: string) => {
    if (!ctxStr || ctxStr === "N/A") return 1;
    const str = ctxStr.toLowerCase();
    if (str.endsWith("k")) return parseFloat(str) * 1000;
    if (str.endsWith("m")) return parseFloat(str) * 1000000;
    return parseFloat(str) || 1;
  };

  const contextMaxTokens = parseContextWindow((currentModelData as any)?.contextWindow);
  const contextUsagePercentage = Math.min(currentContextTokens / contextMaxTokens, 1);
  const contextVisualPercentage = currentContextTokens > 0 && contextUsagePercentage < 0.05 ? 0.05 : contextUsagePercentage;

return (
  <div
    ref={containerRef}
    className="flex h-full w-full relative overflow-hidden bg-white dark:bg-[#1E1E1E]"
  >
    <AnimatePresence>
      {isIncognito && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.2, ease: "easeInOut" }}
          className="absolute inset-0 pointer-events-none z-50 overflow-hidden"
        >
          {/* Base thick purple edge shadow - Hardware accelerated box-shadow */}
          <div className="absolute inset-0 shadow-[inset_0_0_120px_rgba(107,33,168,0.4)] dark:shadow-[inset_0_0_160px_rgba(126,34,206,0.4)] pointer-events-none" />
          
          {/* Single lightweight pulsing edge gradient without mix-blend-mode or rotate/scale for maximum framerate */}
          <motion.div
            animate={{ 
              opacity: [0.4, 0.8, 0.4],
            }}
            transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
            className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_center,transparent_60%,rgba(147,51,234,0.3)_100%)] dark:bg-[radial-gradient(ellipse_at_center,transparent_60%,rgba(168,85,247,0.3)_100%)]"
          />
        </motion.div>
      )}
    </AnimatePresence>
    {isResizingPane && (
      <div className="fixed inset-0 z-[9999] cursor-col-resize" />
    )}
    <div
      ref={chatPaneRef}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{ width: activeArtifact ? `${100 - artifactWidth}%` : "100%" }}
      className={`relative h-full flex flex-col ease-in-out ${!isResizingPane ? "transition-all duration-300" : ""} ${activeArtifact ? "border-r border-gray-200 dark:border-[#3A3A3A]" : ""}`}
    >
      <div
        className={`flex flex-col h-full w-full relative overflow-hidden ${hasActiveChat ? "hidden" : ""} ${activeArtifact ? "px-4" : ""}`}
      >
        {topControlsJsx}

        <div className="flex-1 flex flex-col items-center justify-center w-full px-4 pb-20">
          <div className="flex items-center justify-center gap-3 md:gap-4 mb-12 flex-wrap">
            <motion.img 
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4 }}
              src="/void%20logo.png" 
              alt="VOID Logo" 
              className="w-10 h-10 md:w-12 md:h-12 object-contain bg-transparent border-none shadow-none outline-none dark:invert shrink-0" 
            />
            <motion.h1
              className="text-4xl md:text-5xl text-gray-900 dark:text-gray-100 font-serif tracking-tight text-center flex justify-center flex-wrap"
              initial="hidden"
              animate="visible"
              variants={{
                hidden: { opacity: 0 },
                visible: { opacity: 1, transition: { staggerChildren: 0.04, delayChildren: 0.1 } }
              }}
            >
              {`${getGreeting()}, ${extractFirstName(userName)}.`.split("").map((char, i) => (
                <motion.span
                  key={i}
                  variants={{
                    hidden: { opacity: 0, y: 8, filter: "blur(4px)" },
                    visible: { opacity: 1, y: 0, filter: "blur(0px)" }
                  }}
                  className={char === " " ? "w-3 md:w-4 inline-block" : "inline-block"}
                >
                  {char}
                </motion.span>
              ))}
            </motion.h1>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 15, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: 0.2, duration: 0.5, ease: "easeOut" }}
            className="w-full max-w-3xl lg:max-w-4xl xl:max-w-5xl relative shadow-2xl rounded-2xl"
          >
            <div className="absolute inset-0 bg-white dark:bg-[#2A2A2A] opacity-90 dark:opacity-60 rounded-2xl backdrop-blur-xl border border-gray-200 dark:border-[#3A3A3A]"></div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!isVoiceModeActive) handleSend();
              }}
              className="relative flex flex-col p-2"
            >
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onPaste={handlePaste}
                onKeyDown={(e) => {
                  if (isVoiceModeActive) return;
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={isRateLimited ? "Rate limit reached for this model." : "How can I help you today?"}
                className="w-full bg-transparent text-gray-900 dark:text-gray-100 placeholder-gray-500 rounded-xl px-4 py-4 min-h-[120px] resize-none focus:outline-none text-lg disabled:opacity-50"
                disabled={isLoading || isGeneratingImage || isRateLimited}
              />

              {attachments.length > 0 && (
                <div className="px-4 pb-2">
                  <AttachmentChip />
                </div>
              )}

              <div className="flex justify-between items-center px-2 pb-2 pt-1">
                <div className="flex gap-2">
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/quicktime,application/pdf,text/plain,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  <motion.button
                    whileTap={{ scale: 0.9 }}
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="p-3 rounded-full text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-[#3A3A3A] transition-colors"
                    title="Upload photo or video"
                  >
                    <Plus size={20} />
                  </motion.button>
                </div>
                <div className="flex items-center gap-2">
                  {thinkingEffortSelectorJsx}
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.035 }}
                    whileTap={{ scale: 0.92 }}
                    transition={{ type: "spring", stiffness: 360, damping: 26, mass: 0.55 }}
                    onClick={() => setIsVoiceModeActive(true)}
                    className="relative flex h-12 w-12 items-center justify-center rounded-full border border-gray-900 bg-gray-900 text-white shadow-none transition-colors duration-200 hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500/50 dark:border-white/15 dark:bg-white dark:text-black dark:hover:bg-gray-100"
                    title="Start Void voice"
                    aria-label="Start Void voice"
                  >
                    <span className="flex h-6 items-center gap-[3px]" aria-hidden="true">
                      {[10, 16, 22, 16, 10].map((height, index) => (
                        <motion.span
                          key={`${height}-${index}`}
                          className="w-[2.5px] origin-center rounded-full bg-current"
                          style={{ height }}
                          animate={{ scaleY: [0.72, 1, 0.84, 0.72], y: [0, -0.35, 0.25, 0] }}
                          transition={{
                            duration: 1.65 + index * 0.08,
                            delay: -index * 0.16,
                            repeat: Infinity,
                            ease: "easeInOut",
                          }}
                        />
                      ))}
                    </span>
                  </motion.button>
                  <AnimatePresence>
                    {(input.trim() || attachments.length > 0 || isLoading) && (
                      <motion.button
                        initial={{ opacity: 0, scale: 0.5, x: 10 }}
                        animate={{ opacity: 1, scale: 1, x: 0 }}
                        exit={{ opacity: 0, scale: 0.5, x: 10 }}
                        whileHover={{ y: -1 }}
                        whileTap={{ scale: 0.96 }}
                        transition={{ type: "spring", stiffness: 420, damping: 28 }}
                        type={isLoading ? "button" : "submit"}
                        disabled={isRateLimited}
                        onClick={isLoading ? (event) => {
                          event.preventDefault();
                          stopActiveGeneration();
                        } : undefined}
                        aria-label={isLoading ? "Stop generation" : "Send message"}
                        title={isLoading ? "Stop generation" : "Send message"}
                        className={`relative flex h-12 w-12 shrink-0 items-center justify-center rounded-xl p-0 text-white shadow-sm transition-colors dark:text-black ${isLoading ? "bg-[#202023] hover:bg-black dark:bg-[#3A3A3A] dark:text-white dark:hover:bg-[#4A4A4E]" : "bg-gray-900 hover:bg-black dark:bg-white dark:hover:bg-gray-200"}`}
                      >
                        {isLoading ? (
                          <span className="flex h-7 w-7 items-center justify-center" aria-hidden="true">
                            <Square className="h-3 w-3" fill="currentColor" />
                          </span>
                        ) : (
                          <Send size={20} />
                        )}
                      </motion.button>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </form>
          </motion.div>
          
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className={`flex flex-col h-full mx-auto relative overflow-hidden transition-all duration-300 ${!hasActiveChat ? "hidden" : ""} ${activeArtifact ? "w-full px-2" : "w-full max-w-4xl xl:max-w-5xl px-2 sm:px-4"}`}
      >
        {selectedMessageForSources && (
          <SourcesModal
            msg={selectedMessageForSources}
            onClose={() => setSelectedMessageForSources(null)}
          />
        )}
        {topControlsJsx}

        <div 
          ref={chatScrollContainerRef}
          onScroll={handleScroll}
          onWheel={() => {
            if (scrollAnimationRef.current) {
              userInterruptedScrollRef.current = true;
            }
          }}
          onTouchMove={() => {
            if (scrollAnimationRef.current) {
              userInterruptedScrollRef.current = true;
            }
          }}
          className={`flex-1 overflow-y-auto p-4 md:p-8 space-y-6 scrollbar-hide relative ${isGracefulScrolling ? "is-graceful-scrolling" : ""}`}
        >
          {messages.map((msg, index) => (
            <motion.div
              initial={{ opacity: 0, y: 15, scale: 0.98, transformOrigin: msg.role === "user" ? "bottom right" : "bottom left" }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              key={msg.id || `${msg.role}-${index}`}
              className={`w-full min-w-0 max-w-4xl xl:max-w-5xl mx-auto flex graceful-message-item ${msg.role === "user" ? "justify-end" : "justify-start"} ${chatFontSize === "small" ? "[&_.prose]:text-sm" : chatFontSize === "large" ? "[&_.prose]:text-lg" : "[&_.prose]:text-base"}`}
            >
              {msg.role === "user" ? (
                editingIndex === index ? (
                  <div className="w-full max-w-lg bg-white dark:bg-[#1E1E1E] border border-gray-300 dark:border-[#3A3A3A] rounded-2xl p-3 shadow-lg flex flex-col gap-2">
                    <textarea
                      value={editInputText}
                      onChange={(e) => setEditInputText(e.target.value)}
                      className="w-full bg-transparent text-gray-900 dark:text-white outline-none resize-none text-sm p-1 font-sans leading-relaxed"
                      rows={3}
                      autoFocus
                    />
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => setEditingIndex(null)}
                        className="px-3.5 py-1.5 rounded-xl text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-[#2A2A2A] transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => {
                          if (!editInputText.trim()) return;
                          setEditingIndex(null);
                          
                          // Truncate messages to include only up to the edited message
                          const baseMessages = messages.slice(0, index);
                          
                          // Append the edited user message
                          const curVers = msg.versions || [msg.content];
                          const newVers = [...curVers, editInputText];
                          const newIdx = newVers.length - 1;
                          
                          const editedMsg = { 
                            ...msg, 
                            content: editInputText, 
                            versions: newVers, 
                            activeVersionIndex: newIdx 
                          };
                          
                          const newMessagesWithEdit = [...baseMessages, editedMsg];
                          setMessages(newMessagesWithEdit);
                          
                          // We cannot just call handleSend() because it uses the old closure `messages`.
                          // We need to trigger the generation with the updated message array.
                          // Fortunately, since we just updated the state, we can write a small async IIFE here
                          // or rely on a new effect. But the easiest way is to call the API directly here
                          // with the `newMessagesWithEdit` array, similar to `handleRegenerate`.
                          
                          const sendEdited = async () => {
                            armCompletionChime();
                            setIsLoading(true);
                            abortControllerRef.current = new AbortController();
                            let startTime = Date.now();
                            const assistantMsg = {
                              role: "assistant" as const,
                              content: "",
                              isStreaming: true,
                              statusLogs: [],
                              thoughtTime: 0,
                              modelName: selectedModel,
                            };
                            setMessages([...newMessagesWithEdit, assistantMsg]);
                            
                            const timerInterval = setInterval(() => {
                              setMessages((prev) => {
                                const newM = [...prev];
                                const last = newM[newM.length - 1];
                                if (last && last.role === "assistant" && last.isStreaming) {
                                  newM[newM.length - 1] = { ...last, thoughtTime: Math.floor((Date.now() - startTime) / 1000) };
                                }
                                return newM;
                              });
                            }, 1000);

                            try {
                              const response = await fetch("/api/chat", {
                                method: "POST",
                                headers: await authenticatedJsonHeaders(),
                                signal: abortControllerRef.current.signal,
                                body: JSON.stringify({
                                  messages: prepareStudioMessages(compactMessagesForTransport(newMessagesWithEdit)),
                                  model: "Auto",
                                  systemPrompt: systemPrompt,
                                  reasoningEffort,

                                  attachments: getMessageAttachments(editedMsg),
                                  conversationId: agentSessionIdRef.current,
                                  userId: userId,
                                  userEmail: userEmail,
                                  isWebSearch: isWebSearch,
                                }),
                              });
                              
                              if (!response.body) throw new Error("No response body");
                              const reader = response.body.getReader();
                              const decoder = new TextDecoder();
                              let done = false;
                              let buffer = "";
                              let streamingContent = "";
                              let currentPhase: ResponsePhase = "thinking";
                              let currentEffortInfo: EffortInfo | undefined;
                              let currentEffortRecovery: string | undefined;
                              let currentLogs: any[] = [];
                              let currentSources: string[] = [];
                              let currentWebSearch: any = undefined;
                              let currentMedia: MediaPayload | undefined = undefined;
                              let currentSearchIntent: any = undefined;
                              let fallbackModelName: string | undefined = undefined;

                              while (!done) {
                                const { value, done: readerDone } = await reader.read();
                                done = readerDone;
                                if (value) {
                                  buffer += decoder.decode(value, { stream: true });
                                  const lines = buffer.split("\n");
                                  buffer = lines.pop() || "";
                                  for (const line of lines) {
                                    if (line.startsWith("data: ") && line.trim() !== "data: [DONE]") {
                                      try {
                                        const data = JSON.parse(line.slice(6));
                                        currentPhase = responsePhaseForEvent(data, currentPhase);
                                        if (data.type === "effort") currentEffortInfo = data;
                                        if (data.type === "effort_recovery") currentEffortRecovery = data.message;
                                        if (data.type === "status") currentLogs = [...currentLogs, { action: data.action, query: data.query }];
                                        else if (data.type === "sources") currentSources = mergeSourceUrls(currentSources, data.sources);
                                        else if (data.type === "webSearch") {
                                          currentWebSearch = mergeWebSearchData(currentWebSearch, data);
                                          currentSources = mergeSourceUrls(currentSources, sourceUrlsFromWebSearch(data));
                                        }
                                        else if (data.type === "media") currentMedia = mergeMediaPayload(currentMedia, data);
                                        else if (data.type === "media_status") currentLogs = [...currentLogs, { action: data.label || "Web image update", query: data.reason || "" }];
                                        else if (data.type === "searchIntent") currentSearchIntent = { webSearchIntent: data.webSearchIntent, webImageIntent: data.webImageIntent };
                                        else if (data.type === "text") streamingContent += data.content;
                                        else if (data.type === "reset") streamingContent = "";
                                        else if (data.type === "model_fallback") fallbackModelName = data.uiName;
                                        else if (data.type === "model_runtime") {
                                          fallbackModelName = data.uiName || fallbackModelName;
                                        }
                                       else if (data.type === "agent_plan") {
                                         currentLogs = [...currentLogs, { action: "Planning the work", query: "" }];
                                       } else if (data.type === "agent_status") {
                                          const progress = visibleProgressLogs([{ action: data.label || "Reviewing the request" }]);
                                          currentLogs = [...currentLogs, ...progress.map((log) => ({ action: log.action || "Reviewing the request", query: log.query || "" }))];
                                        } else if (data.type === "agent_result") currentLogs = [...currentLogs, agentResultLog(data)];

                                      } catch (e) {}
                                    }
                                  }
                                        setMessages((prev) => {
                                          const newM = [...prev];
                                          const last = newM[newM.length - 1];
                                          if (last && last.role === "assistant") {
                                            newM[newM.length - 1] = {
                                              ...last,
                                              content: streamingContent,
                                              statusLogs: currentLogs,
                                              responsePhase: currentPhase,
                                              effortInfo: currentEffortInfo,
                                              effortRecovery: currentEffortRecovery,
                                              sources: currentSources,
                                              webSearch: currentWebSearch,
                                              media: currentMedia,
                                              searchIntent: currentSearchIntent,
                                              modelName: fallbackModelName || last.modelName,
                                            };
                                          }
                                          return newM;
                                        });
                                }
                              }
                              setMessages((prev) => {
                                const next = [...prev];
                                const last = next[next.length - 1];
                                if (last?.role === "assistant") {
                                  next[next.length - 1] = {
                                    ...last,
                                    content: streamingContent,
                                    statusLogs: currentLogs,
                                    responsePhase: currentPhase,
                                    effortInfo: currentEffortInfo,
                                    effortRecovery: currentEffortRecovery,
                                    sources: currentSources,
                                    webSearch: currentWebSearch,
                                    media: currentMedia,
                                    searchIntent: currentSearchIntent,
                                    modelName: fallbackModelName || last.modelName,
                                  };
                                }
                                return next;
                              });
                              announceGenerationComplete();
                            } catch (error: any) {
                              disarmCompletionChime();
                              console.error(error);
                              setMessages((prev) => {
                                const next = [...prev];
                                const last = next[next.length - 1];
                                if (last?.role === "assistant") {
                                  next[next.length - 1] = {
                                    ...last,
                                    content: friendlyRequestError(error),
                                    isStreaming: false,
                                  };
                                }
                                return next;
                              });
                            } finally {
                              clearInterval(timerInterval);
                              setIsLoading(false);
                              setMessages((prev) => {
                                const newM = [...prev];
                                const last = newM[newM.length - 1];
                                if (last && last.role === "assistant") {
                                  newM[newM.length - 1] = { ...last, isStreaming: false };
                                }
                                return newM;
                              });
                            }
                          };
                          sendEdited();
                        }}
                        className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-gray-900 text-white dark:bg-white dark:text-black hover:opacity-90 shadow-sm transition-all active:scale-95"
                      >
                        Save & Submit
                      </button>
                    </div>
                  </div>
                ) : (() => {
                  let userContentText = msg.content || "";
                  let userAttachmentsList = msg.attachments || [];

                  if (userContentText.includes("[ATTACHMENTS_JSON:")) {
                    const attMatch = userContentText.match(/\[ATTACHMENTS_JSON:\s*(\[[\s\S]*?\])\s*\]/);
                    if (attMatch) {
                      try {
                        const parsedAtts = JSON.parse(attMatch[1]);
                        if (parsedAtts && Array.isArray(parsedAtts) && userAttachmentsList.length === 0) {
                          userAttachmentsList = parsedAtts;
                        }
                      } catch (e) {
                        console.error("Failed to parse user ATTACHMENTS_JSON:", e);
                      }
                      userContentText = userContentText.replace(attMatch[0], "").trim();
                    }
                  }

                  return (
                    <div className={`flex flex-col gap-2 group ${messageStyle === "modern" ? "w-full max-w-full items-stretch border-l-2 border-gray-300 pl-4 dark:border-[#4A4A4E]" : "max-w-[80%] items-end"}`}>
                      {userAttachmentsList?.[0] && (
                        <UserMessageAttachment
                          attachment={userAttachmentsList[0]}
                          onClick={() => setPreviewAttachment(userAttachmentsList[0])}
                        />
                      )}
                      {userContentText && (
                        <UserPromptBubble
                          content={userContentText}
                          modern={messageStyle === "modern"}
                          fontSize={chatFontSize as "small" | "medium" | "large"}
                          onActivate={() => setMobileActiveMessageIndex((prev) => (prev === index ? null : index))}
                        />
                      )}
                      <div className={`flex items-center gap-1.5 transition-opacity mt-1 ${mobileActiveMessageIndex === index ? "opacity-100" : "opacity-0 sm:group-hover:opacity-100"}`}>
                      {msg.versions && msg.versions.length > 1 && (
                        <div className="flex items-center gap-1 bg-gray-100 dark:bg-[#222] px-2 py-0.5 rounded-full border border-gray-200 dark:border-[#333] text-xs">
                          <button
                            onClick={() => {
                              const cur = msg.activeVersionIndex ?? 0;
                              if (cur > 0) {
                                const prevContent = msg.versions![cur - 1];
                                setMessages((prev) =>
                                  prev.map((m, i) =>
                                    i === index
                                      ? { ...m, content: prevContent, activeVersionIndex: cur - 1 }
                                      : m,
                                  ),
                                );
                              }
                            }}
                            disabled={(msg.activeVersionIndex ?? 0) <= 0}
                            className="hover:text-gray-900 dark:hover:text-white disabled:opacity-30 p-0.5"
                          >
                            <ChevronLeft size={12} />
                          </button>
                          <span className="font-mono text-[10px] text-gray-600 dark:text-gray-300">
                            {(msg.activeVersionIndex ?? 0) + 1} / {msg.versions.length}
                          </span>
                          <button
                            onClick={() => {
                              const cur = msg.activeVersionIndex ?? 0;
                              if (cur < msg.versions!.length - 1) {
                                const nextContent = msg.versions![cur + 1];
                                setMessages((prev) =>
                                  prev.map((m, i) =>
                                    i === index
                                      ? { ...m, content: nextContent, activeVersionIndex: cur + 1 }
                                      : m,
                                  ),
                                );
                              }
                            }}
                            disabled={(msg.activeVersionIndex ?? 0) >= (msg.versions.length - 1)}
                            className="hover:text-gray-900 dark:hover:text-white disabled:opacity-30 p-0.5"
                          >
                            <ChevronRight size={12} />
                          </button>
                        </div>
                      )}
                      <button
                        onClick={() => {
                          setEditingIndex(index);
                          setEditInputText(msg.content);
                        }}
                        className="flex items-center justify-center p-1.5 text-gray-400 hover:bg-gray-200 dark:hover:bg-[#3A3A3A] rounded hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                        title="Edit prompt"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(msg.content).catch((err) => console.error("Clipboard error:", err));
                          setCopiedIndex(index);
                          setTimeout(() => setCopiedIndex(null), 2000);
                        }}
                        className="flex items-center justify-center p-1.5 text-gray-400 hover:bg-gray-200 dark:hover:bg-[#3A3A3A] rounded hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                        title="Copy prompt"
                      >
                        {copiedIndex === index ? (
                          <Check size={13} className="text-green-500" />
                        ) : (
                          <Copy size={13} />
                        )}
                      </button>
                    </div>
                  </div>
                );
              })()
              ) : (
                <div className="w-full min-w-0 flex flex-col items-start max-w-[100%]">
                  {msg.isImageGenerating ? (
                    <ImageGenerationLoader modelName={msg.modelName} />
                  ) : (
                    <AssistantMessageContent userEmail={userEmail}
                      msg={msg}
                      index={index}
                      previousUserContent={messages[index - 1]?.role === "user" ? messages[index - 1].content : ""}
                      loadingStage={loadingStage}
                      isWebSearch={isWebSearch}
                      setSelectedMessageForSources={setSelectedMessageForSources}
                      setActiveArtifact={setActiveArtifact}
                      imageReplacementsRef={imageReplacementsRef}
                      setMessages={setMessages}
                      supabase={supabase}
                      conversationId={conversationId || undefined}
                      markdownComponents={markdownComponents}
                      setPreviewAttachment={setPreviewAttachment}
                    />
                  )}

                  {!isLoading && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex items-center gap-2 mt-4 text-gray-500 dark:text-gray-400"
                    >
                      <motion.button
                        whileTap={{ scale: 0.9 }}
                        onClick={() => handleCopy(msg.content, index)}
                        className="p-1.5 hover:bg-gray-200 dark:hover:bg-[#3A3A3A] rounded transition-colors"
                        title="Copy text"
                      >
                        {copiedIndex === index ? (
                          <Check size={16} className="text-green-500" />
                        ) : (
                          <Copy size={16} />
                        )}
                      </motion.button>
                      <motion.button
                        whileTap={{ scale: 0.9 }}
                        onClick={() => handleRegenerate(index)}
                        className="p-1.5 hover:bg-gray-200 dark:hover:bg-[#3A3A3A] rounded transition-colors"
                        title="Regenerate"
                      >
                        <RefreshCcw size={16} />
                      </motion.button>
                      <motion.button
                        whileTap={{ scale: 0.9 }}
                        onClick={() => toggleFeedback(index, "up")}
                        className={`p-1.5 rounded transition-colors ${feedbackState[index] === "up" ? "bg-gray-200 dark:bg-[#3A3A3A] text-blue-500" : "hover:bg-gray-200 dark:hover:bg-[#3A3A3A]"}`}
                        title="Good response"
                      >
                        <ThumbsUp
                          size={16}
                          className={
                            feedbackState[index] === "up"
                              ? "fill-blue-500 text-blue-500"
                              : ""
                          }
                        />
                      </motion.button>
                      <motion.button
                        whileTap={{ scale: 0.9 }}
                        onClick={() => toggleFeedback(index, "down")}
                        className={`p-1.5 rounded transition-colors ${feedbackState[index] === "down" ? "bg-gray-200 dark:bg-[#3A3A3A] text-red-500" : "hover:bg-gray-200 dark:hover:bg-[#3A3A3A]"}`}
                        title="Bad response"
                      >
                        <ThumbsDown
                          size={16}
                          className={
                            feedbackState[index] === "down"
                              ? "fill-red-500 text-red-500"
                              : ""
                          }
                        />
                      </motion.button>
                    </motion.div>
                  )}
                </div>
              )}
            </motion.div>
          ))}
          {isLoading &&
            (!messages[messages.length - 1] ||
              messages[messages.length - 1].role !== "assistant") && (
              <DynamicLoader
                stage={loadingStage}
                webSearchEnabled={isWebSearch}
                isGeneratingImage={isGeneratingImage}
                prompt={
                  messages[messages.length - 1]?.role === "user"
                    ? messages[messages.length - 1]?.content
                    : messages.length > 1
                    ? messages[messages.length - 2]?.content
                    : ""
                }
                statusLogs={
                  messages[messages.length - 1]?.role === "assistant"
                    ? messages[messages.length - 1]?.statusLogs
                    : undefined
                }
              />
            )}
          <div ref={messagesEndRef} className="h-20" />
        </div>

        <div className="shrink-0 p-4 bg-gradient-to-t from-gray-50 via-gray-50 dark:from-[#1E1E1E] dark:via-[#1E1E1E] to-transparent pt-10 relative z-20">
          <AnimatePresence>
            {userHasScrolledUp && (
              <motion.button
                initial={{ opacity: 0, scale: 0.8, x: "-50%", y: 8 }}
                animate={{ opacity: 1, scale: 1, x: "-50%", y: 0 }}
                exit={{ opacity: 0, scale: 0.8, x: "-50%", y: 8 }}
                whileHover={{ scale: 1.06 }}
                whileTap={{ scale: 0.94 }}
                onClick={() => {
                  setUserHasScrolledUp(false);
                  fluidScrollToBottom(true, { duration: 900, animateWave: true });
                }}
                className="absolute left-1/2 top-1 z-40 flex items-center justify-center rounded-full border border-gray-300 bg-white p-2.5 text-gray-800 shadow-xl transition-colors hover:bg-gray-100 dark:border-[#4A4A4A] dark:bg-[#27272A] dark:text-white dark:hover:bg-[#333]"
                title="Scroll to latest message"
                aria-label="Scroll to latest message"
              >
                <ChevronDown size={18} aria-hidden="true" />
              </motion.button>
            )}
          </AnimatePresence>
          <div className="max-w-4xl xl:max-w-5xl mx-auto relative shadow-xl rounded-2xl">
            <div className="absolute inset-0 bg-white dark:bg-[#2A2A2A] rounded-2xl border border-gray-200 dark:border-[#3A3A3A]"></div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!isVoiceModeActive) handleSend();
              }}
              className="relative flex flex-col p-2"
            >
              {attachments.length > 0 && (
                <div className="px-4 py-2 border-b border-gray-200 dark:border-[#3A3A3A] mb-2">
                  <AttachmentChip />
                </div>
              )}
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onPaste={handlePaste}
                onKeyDown={(e) => {
                  if (isVoiceModeActive) return;
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={isRateLimited ? "Rate limit reached for this model." : isVoiceModeActive ? "Listening…" : "Message Assistant..."}
                aria-label={isVoiceModeActive ? "Live voice transcript" : "Message Assistant"}
                className="w-full bg-transparent text-gray-900 dark:text-gray-100 placeholder-gray-500 px-4 pt-4 pb-2 max-h-[200px] min-h-[60px] resize-none focus:outline-none disabled:opacity-50"
                rows={1}
                readOnly={isVoiceModeActive}
                disabled={isLoading || isRateLimited}
              />
              <div className="flex justify-between items-center px-2 pb-2 pt-1">
                <div className="flex gap-2">
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/quicktime,application/pdf,text/plain,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="p-2 rounded-xl text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-[#3A3A3A] transition-colors"
                    title="Upload photo or video"
                  >
                    <Plus size={20} />
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  {thinkingEffortSelectorJsx}
                  <VoiceAgent
                    active={isVoiceModeActive}
                    onVoiceModeChange={setIsVoiceModeActive}
                    userEmail={userEmail}
                    setSessionUsage={setSessionUsage}
                    conversationMessages={messages}
                    conversationId={conversationId}
                    onPartialTranscript={handleVoicePartialTranscript}
                    onTranscript={handleVoiceTranscript}
                    onVisualRequest={handleVoiceVisualRequest}
                    onResponseUpdate={handleVoiceResponseUpdate}
                    onTurnComplete={handleVoiceTurnComplete}
                  />
                  <AnimatePresence>
                    {((input.trim() && !isVoiceModeActive) || attachments.length > 0 || isLoading) && (
                      <motion.button
                        initial={{ opacity: 0, scale: 0.5, x: 10 }}
                        animate={{ opacity: 1, scale: 1, x: 0 }}
                        exit={{ opacity: 0, scale: 0.5, x: 10 }}
                        whileHover={{ y: -1 }}
                        whileTap={{ scale: 0.96 }}
                        transition={{ type: "spring", stiffness: 420, damping: 28 }}
                        type={isLoading ? "button" : "submit"}
                        disabled={isRateLimited}
                        aria-label={isLoading ? "Stop generation" : "Send message"}
                        title={isLoading ? "Stop generation" : "Send message"}
                        onClick={
                          isLoading
                            ? (e) => {
                                e.preventDefault();
                                stopActiveGeneration();
                              }
                            : undefined
                        }
                        className={`relative flex h-12 w-12 shrink-0 items-center justify-center rounded-xl p-0 transition-colors ${
                          isLoading
                            ? "cursor-pointer bg-[#202023] text-white shadow-sm hover:bg-black dark:bg-[#3A3A3A] dark:hover:bg-[#4A4A4E]"
                            : "bg-gray-900 text-white shadow-sm hover:bg-black dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
                        }`}
                      >
                        {isLoading ? (
                          <span className="flex h-7 w-7 items-center justify-center" aria-hidden="true">
                            <Square
                              className="h-3 w-3"
                              fill="currentColor"
                            />
                          </span>
                        ) : (
                          <Send size={20} />
                        )}
                      </motion.button>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </form>
          </div>

          
        </div>
      </motion.div>
    </div>

    <AnimatePresence>
      {activeArtifact && (
        <>
          <div
            onMouseDown={() => setIsResizingPane(true)}
            className="w-1.5 hover:w-2 hover:bg-blue-500/50 cursor-col-resize z-40 transition-all flex items-center justify-center group relative -ml-[1px]"
          >
            <div className="h-10 w-1 rounded-full bg-gray-300 dark:bg-gray-600 group-hover:bg-white transition-colors" />
          </div>
          <div
            ref={artifactPaneRef}
            style={{ width: `${artifactWidth}%` }}
            className={`h-full z-30 ease-in-out ${!isResizingPane ? "transition-all duration-300" : ""}`}
          >
            <ArtifactCanvas
              artifact={activeArtifact}
              onClose={() => setActiveArtifact(null)}
              onArtifactChange={(updatedArtifact) => {
                setActiveArtifact(updatedArtifact);
                const updatedData = updatedArtifact.presentationData;
                if (!updatedData) return;
                const artifactPattern = /```(?:gamma-presentation|gamma|presentation|json)?\s*\{[\s\S]*?"slides"\s*:[\s\S]*?```/i;
                const targetIndex = messages.findLastIndex((message) => message.role === "assistant"
                  && artifactPattern.test(message.content) && message.content.includes(updatedData.title));
                if (targetIndex < 0) return;
                const target = messages[targetIndex];
                const content = target.content.replace(artifactPattern, () => `\`\`\`gamma-presentation\n${JSON.stringify(updatedData)}\n\`\`\``);
                setMessages((previous) => previous.map((message, index) => index === targetIndex && message === target ? { ...message, content } : message));
                if (target.id && !isIncognito) {
                  void supabase.from("messages").update({ content }).eq("id", target.id)
                    .then(({ error }) => { if (error) console.warn("Artifact edits could not be saved", error.message); });
                }
              }}
              theme={theme}
            />
          </div>
        </>
      )}
    </AnimatePresence>

    {previewAttachment && (
      <FilePreviewModal
        attachment={previewAttachment}
        onClose={() => setPreviewAttachment(null)}
      />
    )}

    {preferenceModal.isOpen && (
      <StudioPreferenceModal
        initialTopic={preferenceModal.topic}
        initialType={preferenceModal.type}
        onClose={() => setPreferenceModal({ ...preferenceModal, isOpen: false })}
        onConfirm={handleConfirmStudioOptions}
      />
    )}

    {isDragging && (
      <div className="absolute inset-0 z-[100] bg-black/5 dark:bg-white/5 backdrop-blur-[2px] border-2 border-dashed border-gray-400 dark:border-gray-500 flex flex-col items-center justify-center pointer-events-none">
        <div className="bg-white dark:bg-[#1E1E1E] p-6 rounded-2xl shadow-2xl flex flex-col items-center gap-4 border border-gray-200 dark:border-[#3A3A3A]">
          <div className="p-4 bg-gray-100 dark:bg-[#2A2A2A] rounded-full">
            <Upload className="w-8 h-8 text-gray-700 dark:text-gray-300" />
          </div>
          <p className="text-lg font-semibold text-gray-900 dark:text-white">
            Drop file to attach
          </p>
        </div>
      </div>
    )}
  </div>
);

}
