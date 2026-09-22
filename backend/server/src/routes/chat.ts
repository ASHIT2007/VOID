import { Router } from 'express';
import type { Request, Response } from 'express';
import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

export const chatRouter = Router();

const VOID_SYSTEM_PROMPT = `You are Void, a helpful, fast, highly conversational, and intuitive AI assistant. You are communicating with the user via text-to-speech, so your outputs must be optimized for spoken audio. When asked your name, identity, or to introduce yourself, begin with exactly: "I'm Void, a helpful AI assistant." Never introduce yourself as ChatGPT or as a provider model.

CORE RULES:
1. EXTREME CONCISION: Keep responses to 1-3 short sentences. Get straight to the point.
2. NO FORMATTING: Never use bolding, asterisks, markdown, bullet points, or numbered lists. Use natural spoken transitions instead.
3. CONTEXTUAL AWARENESS: You have access to the conversation history. If the user asks a short follow-up like "Why?", "Tell me more", or "Who is he?", immediately resolve the context from the previous turns.
4. CONVERSATIONAL TONE: Speak naturally and warmly without sounding like a corporate robot. Do not pad answers with filler words or repeated acknowledgements.
5. NO PREFACING: Do not say "As an AI..." or "Based on the previous message...". Just answer the question directly.`;

type VoiceChatMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string };

const sessions = new Map<string, VoiceChatMessage[]>();
const MAX_HISTORY_LENGTH = 8;

function getSessionId(userId: unknown): string {
  return typeof userId === 'string' && userId.trim() ? userId.trim() : 'default';
}

function getLlamaClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.LLAMA_API_KEY || process.env.GROQ_API_KEY || 'dummy_key',
    baseURL: process.env.LLAMA_BASE_URL || 'https://api.groq.com/openai/v1',
  });
}

chatRouter.post('/', async (req: Request, res: Response) => {
  const { userId, sttText } = req.body as { userId?: unknown; sttText?: unknown };

  if (typeof sttText !== 'string' || sttText.trim().length < 2) {
    res.status(200).json({ error: 'Audio too short or empty' });
    return;
  }

  const sessionId = getSessionId(userId);
  const history: VoiceChatMessage[] = [...(sessions.get(sessionId) ?? []), { role: 'user', content: sttText }];
  const trimmedHistory = history.slice(-MAX_HISTORY_LENGTH);

  try {
    const response = await getLlamaClient().chat.completions.create({
      model: process.env.VOID_CHAT_MODEL || 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: VOID_SYSTEM_PROMPT },
        ...trimmedHistory,
      ] satisfies ChatCompletionMessageParam[],
      temperature: 0.7,
    });

    const text = response.choices[0]?.message?.content ?? '';
    const assistantMessage: VoiceChatMessage = { role: 'assistant', content: text };
    sessions.set(sessionId, [...trimmedHistory, assistantMessage].slice(-MAX_HISTORY_LENGTH));
    res.status(200).json({ text });
  } catch (error) {
    console.error('Void chat API error:', error);
    res.status(500).json({ error: 'Failed to generate response' });
  }
});
