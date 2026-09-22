import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from 'node:crypto';
import { backendUrl } from "@/lib/backend";
import { fetchWithRetry, publicServiceError } from "@/lib/reliability";
import { REPORT_GENERATION_DIRECTIVE, VISUAL_GENERATION_DIRECTIVE } from '@/lib/design/generation-prompt';
import { isWebArtifactCreationRequest, WEB_GENERATION_DIRECTIVE } from '@/lib/web-generation';
import { analysisMayBenefitFromChart, ANALYSIS_VISUAL_DIRECTIVE } from '@/lib/analysis-visuals';
import { compactVoiceHistory, VOICE_CONVERSATION_POLICY } from '@/lib/voice-conversation';

type AgentStreamEvent = {
  type: string;
  content?: string;
  name?: string;
  sources?: Array<{ url: string }>;
  query?: string;
  results?: unknown;
  images?: unknown;
  fullText?: string;
  message?: string;
  uiName?: string;
  modelId?: string;
  platform?: string;
  attempt?: number;
  reason?: string;
  agentId?: string;
  isSynthesizer?: boolean;
  intent?: string;
  agents?: Array<{ id: string; role: string; label: string }>;
  role?: string;
  status?: string;
  label?: string;
  summary?: string;
  confidence?: number;
  findingCount?: number;
  sourceCount?: number;
  placement?: 'lead' | 'inline';
  requested?: 'auto' | 'low' | 'medium' | 'high';
  effective?: 'low' | 'medium' | 'high';
  agentCount?: number;
  searchMode?: string;
  simple?: boolean;
};

// Legacy API preferences remain compatible; the text UI uses Auto. These
// preferences never restrict the backend's configured fallback providers.
const VISIBLE_TEXT_MODELS: Record<string, string | null> = {
  "Auto": null,
  "Gemini 1.5 Flash": "gemini-2.5-flash",
  "NVIDIA Nemotron 70B": "nvidia/nemotron-3-super-120b-a12b",
  "NVIDIA Llama 3.1 70B": "meta/llama-3.1-70b-instruct",
  "NVIDIA Mistral NeMo": "mistralai/mistral-large-3-675b-instruct-2512",
  "DeepSeek V3.2": "deepseek-v3.2",
  "GPT-OSS 120B": "openai/gpt-oss-120b",
  "GPT-OSS 20B": "openai/gpt-oss-20b",
};

const CHART_GENERATION_DIRECTIVE = `
Native chart output contract:
- This is a quantitative chart request, not an image-generation request. Never call image generation and never return a screenshot or web image of a chart.
- Give a concise interpretation, then return exactly one fenced chart JSON block.
- Honor every requested chart type, category order, axis label, axis scale, title, annotation, palette, background, density, label treatment, and visual theme.
- Supported fields include type, title, subtitle, xLabel, yLabel, bars/points/series and style. style may contain background, surface, text, muted, grid, palette, fontFamily, showValues, roundedBars, lineWidth, and pointSize. yTicks may contain explicit {value,label} entries for named levels or custom scales. note and source may explain subjective or illustrative data.
- Keep data editable and numeric. If the values are illustrative, fictional, subjective, or fan-made, label that clearly in subtitle or note. Search first for current factual data and never invent a source.`;

const VOICE_GENERATION_DIRECTIVE = VOICE_CONVERSATION_POLICY;

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      function sendEvent(data: Record<string, unknown>) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {}
      }

      try {
        heartbeat = setInterval(() => {
          try { controller.enqueue(encoder.encode(": keep-alive\n\n")); } catch {}
        }, 15_000);
        const body = await req.json();
        const { messages, mode, model, reasoningEffort: requestedReasoningEffort, attachments = [], conversationId, isWebSearch, isVoice } = body;
        
        const rawLatestMessage = messages[messages.length - 1]?.content || "";
        const authoredRequest = rawLatestMessage.split('\n\nArtifact requirements:')[0];
        const contextBoundary = authoredRequest.indexOf('\n\nTopic context from the latest relevant conversation turn:');
        const latestMessage = contextBoundary >= 0 ? authoredRequest.slice(0, contextBoundary) : authoredRequest;
        const topicContext = contextBoundary >= 0 ? authoredRequest.slice(contextBoundary).slice(0, 22000) : '';
        const visualArtifactRequest = /\b(?:make|create|generate|design|prepare|build|draft|produce|want|need)\b[\s\S]*\b(?:presentations?|powerpoints?|pptx?|slides|posters?|infographics?|visual roadmaps?|study sheets?|flyers?)\b/i.test(latestMessage);
        const reportArtifactRequest = /\b(?:make|create|generate|write|prepare|build|draft|produce|compose|want|need)\b[\s\S]*\b(?:report|research report|executive report|document|white paper|briefing document)\b/i.test(latestMessage);
        const webArtifactRequest = isWebArtifactCreationRequest(latestMessage);
        const chartRequest = /\b(?:chart|graph|plot|data visualization|visualise|visualize)\b/i.test(latestMessage)
          && /\b(?:make|create|generate|build|draw|plot|show|compare|visualise|visualize)\b/i.test(latestMessage);
        const conversationContext = isVoice
          ? JSON.stringify(compactVoiceHistory((Array.isArray(messages) ? messages : []).slice(0, -1)))
          : JSON.stringify((Array.isArray(messages) ? messages : []).slice(-7, -1)
          .filter((item: { role?: string; content?: unknown }) => item.role === 'user' || item.role === 'assistant')
          .map((item: { role: string; content?: unknown }) => ({ role: item.role, content: String(item.content || '').slice(0, 2800) }))).slice(0, 22000);
        // Resolve depth and team size together in the backend. Never turn legacy toggles
        // into forced searches or let model selection override the conversation slider.
        const reasoningEffort = ["auto", "low", "medium", "high"].includes(requestedReasoningEffort)
          ? requestedReasoningEffort : "auto";
        // High-effort web work is the UI's deep-research path. Preserve an
        // explicit mode while also making the existing effort control actually
        // reach the backend orchestrator instead of silently running normal.
        const agentMode = mode === 'deep_research' || (reasoningEffort === 'high' && isWebSearch !== false)
          ? 'deep_research' : 'normal';

        const isVisibleModel = !model || Object.prototype.hasOwnProperty.call(VISIBLE_TEXT_MODELS, model);
        const actualModelId = model && isVisibleModel ? VISIBLE_TEXT_MODELS[model] || undefined : undefined;
        if (!isVisibleModel) {
          throw new Error(`The selected model "${model}" is not available in the model picker.`);
        }
        console.log(`[Next.js route.ts] Received UI model: ${model} -> mapped to actualModelId: ${actualModelId}`);

        // 1. Forward the request to the new Smart Express Agent Backend
        // This replaces the old hardcoded Groq/Gemini calls and the "dumb" forced web searches.
        const agentRes = await fetchWithRetry(backendUrl("/api/agent/chat"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: req.signal,
          body: JSON.stringify({
            // Each submitted turn starts fresh; the bounded transcript is context,
            // so timed-out drafts and earlier topics cannot leak from server memory.
            sessionId: `${conversationId || 'chat'}:${randomUUID()}`,
            message: latestMessage,
            conversationContext,
            topicContext,
            artifactInstructions: isVoice
              ? VOICE_GENERATION_DIRECTIVE
              : reportArtifactRequest
              ? REPORT_GENERATION_DIRECTIVE
              : visualArtifactRequest
                ? VISUAL_GENERATION_DIRECTIVE
                : webArtifactRequest
                  ? WEB_GENERATION_DIRECTIVE
                : chartRequest
                  ? CHART_GENERATION_DIRECTIVE
                : analysisMayBenefitFromChart(latestMessage)
                  ? ANALYSIS_VISUAL_DIRECTIVE
                  : undefined,
            model: actualModelId,
            mode: agentMode,
            reasoningEffort,
            isVoice: Boolean(isVoice),
            attachments: Array.isArray(attachments) ? attachments : [],
            // Auto and pinned models may fail over to any enabled backend
            // route. The preferred model is tried first; it is not a brittle
            // allowlist that prevents healthy providers from rescuing a turn.
            maxAgents: isVoice ? 1 : 4,
          })
        }, {
          attempts: 5,
          baseDelayMs: 300,
          maxDelayMs: 2_500,
          connectTimeoutMs: 10_000,
          onRetry: (attempt, reason) => console.warn(`[chat] Backend retry ${attempt}: ${reason}`),
        });

        if (!agentRes.ok) {
          throw new Error(`Failed to connect to the Express backend at ${backendUrl("")}. Is it running?`);
        }

        if (!agentRes.body) {
          throw new Error("No response body from agent.");
        }

        const reader = agentRes.body.getReader();
        const decoder = new TextDecoder();
        let accumulatedText = "";
        let pendingChunk = "";
        let receivedError = false;
        let receivedDone = false;

        while (true) {
          const { done, value } = await reader.read();
          pendingChunk += done ? decoder.decode() + '\n\n' : decoder.decode(value, { stream: true });
          const lines = pendingChunk.split(/\r?\n\r?\n/);
          
          // Keep the last partial chunk in the buffer
          pendingChunk = lines.pop() || "";

          for (const chunk of lines) {
            if (!chunk.trim()) continue;

            // Parse Express Agent's standard SSE format:
            // event: text_delta
            // data: {"type": "text_delta", "content": "..."}
            
            const eventData = chunk.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
            if (!eventData || eventData === '[DONE]') continue;

            try {
              const data = JSON.parse(eventData) as AgentStreamEvent;

              // Translate Express Agent events to Next.js UI expected events
              if (data.type === 'text_delta') {
                accumulatedText += data.content || "";
                sendEvent({ type: 'text', content: data.content });
              }
              else if (data.type === 'response_reset') {
                accumulatedText = "";
                sendEvent({ type: 'reset' });
              }
              else if (data.type === 'effort') {
                sendEvent(data);
                sendEvent({
                  type: 'searchIntent',
                  webSearchIntent: data.searchMode === 'off' ? 'Disabled for attachment analysis' : data.searchMode === 'advanced' ? 'Advanced when needed' : 'Adaptive',
                  webImageIntent: isVoice ? 'Disabled for voice' : data.searchMode === 'off' ? 'Disabled for attachment analysis' : 'When relevant',
                });
              }
              else if (data.type === 'effort_recovery') {
                sendEvent(data);
              }
              else if (data.type === 'thinking') {
                sendEvent({ type: 'phase', phase: 'thinking' });
              }
              else if (data.type === 'tool_call') {
                sendEvent({ type: 'phase', phase: 'thinking' });
                sendEvent({ type: 'status', action: 'Using tool', query: data.name });
              }
              else if (data.type === 'tool_result') {
                sendEvent({ type: 'phase', phase: 'thinking' });
              }
              else if (data.type === 'sources') {
                sendEvent({ type: 'sources', sources: (data.sources || []).map((source) => source.url) });
              }
              else if (data.type === 'webSearch') {
                sendEvent({ type: 'webSearch', query: data.query, results: data.results, images: isVoice ? [] : data.images });
                // Treat the search result payload itself as source evidence.
                // Some providers emit webSearch without a separate sources
                // event; normal chat must still render its Sources pill.
                if (!isVoice && Array.isArray(data.results)) {
                  const resultSources = data.results
                    .map((result) => result && typeof result === 'object' ? (result as { url?: unknown }).url : undefined)
                    .filter((url): url is string => typeof url === 'string' && /^https?:\/\//i.test(url));
                  if (resultSources.length > 0) sendEvent({ type: 'sources', sources: resultSources });
                }
              }
              else if (data.type === 'model_fallback') {
                sendEvent({ type: 'model_fallback', uiName: data.uiName });
              }
              else if (data.type === 'model_runtime') {
                sendEvent({
                  type: 'model_runtime',
                  uiName: data.uiName,
                  modelId: data.modelId,
                  platform: data.platform,
                  attempt: data.attempt,
                  reason: data.reason,
                  agentId: data.agentId,
                  isSynthesizer: data.isSynthesizer,
                });
              }
              else if (data.type === 'agent_plan') {
                sendEvent({ type: 'agent_plan', intent: data.intent, agents: data.agents });
              }
              else if (data.type === 'agent_status') {
                sendEvent({ type: 'agent_status', agentId: data.agentId, role: data.role, status: data.status, label: data.label });
              }
              else if (data.type === 'agent_result') {
                sendEvent({
                  type: 'agent_result',
                  agentId: data.agentId,
                  role: data.role,
                  label: data.label,
                  status: data.status,
                  summary: data.summary,
                  confidence: data.confidence,
                  findingCount: data.findingCount,
                  sourceCount: data.sourceCount,
                });
              }
              else if (data.type === 'media_status') {
                sendEvent({ type: 'media_status', status: data.status, label: data.label, reason: data.reason });
              }
              else if (data.type === 'media') {
                if (!isVoice) sendEvent({ type: 'media', query: data.query, placement: data.placement, images: data.images });
              }
              else if (data.type === 'planning') {
                sendEvent({ type: 'phase', phase: 'thinking' });
                sendEvent({ type: 'status', action: 'Planning research', query: '' });
              }
              else if (data.type === 'searching') {
                sendEvent({ type: 'phase', phase: 'thinking' });
                sendEvent({ type: 'status', action: 'Searching web', query: data.query || '' });
              }
              else if (data.type === 'reading') {
                sendEvent({ type: 'phase', phase: 'thinking' });
                sendEvent({ type: 'status', action: 'Reading source', query: data.query || '' });
              }
              else if (data.type === 'synthesizing') {
                sendEvent({ type: 'phase', phase: 'thinking' });
                sendEvent({ type: 'status', action: 'Synthesizing sources', query: '' });
              }
              else if (data.type === 'report') {
                if (data.content) {
                  sendEvent({ type: 'text', content: data.content });
                  accumulatedText += data.content;
                }
                sendEvent({ type: 'sources', sources: (data.sources || []).map((source) => source.url) });
              }
              else if (data.type === 'done') {
                receivedDone = true;
                if (data.fullText && data.fullText !== accumulatedText) {
                  if (data.fullText.startsWith(accumulatedText)) {
                    sendEvent({ type: 'text', content: data.fullText.slice(accumulatedText.length) });
                    accumulatedText = data.fullText;
                  } else if (!accumulatedText.endsWith(data.fullText)) {
                    sendEvent({ type: 'reset' });
                    sendEvent({ type: 'text', content: data.fullText });
                    accumulatedText = data.fullText;
                  }
                }
              }
              else if (data.type === 'error') {
                receivedError = true;
                sendEvent({ type: 'error', error: data.message });
              }
            } catch (err) {
              console.warn("Failed to parse agent chunk:", err);
            }
          }
          if (done) break;
        }

        if (!receivedError && (!receivedDone || !accumulatedText.trim())) {
          sendEvent({ type: 'error', error: 'The answer did not finish. Please retry.' });
        }
        sendEvent({ type: 'done' });
        controller.close();

      } catch (error: unknown) {
        console.error("Chat API error:", error);
        sendEvent({ type: 'error', error: publicServiceError(error) });
        try { controller.close(); } catch {}
      } finally {
        if (heartbeat) clearInterval(heartbeat);
      }
    }
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
