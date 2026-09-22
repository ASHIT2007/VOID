import type { ChatMessage } from '@freellmapi/shared/types.js';
import crypto from 'crypto';
import { estimateContentTokens } from '../lib/content.js';

// ── Types ───────────────────────────────────────────────────────────────

export interface PendingConfirmation {
  toolName: string;
  args: Record<string, unknown>;
  requestId: string;
}

export interface Source {
  index: number;
  url: string;
  title: string;
  snippet: string;
}

export interface AgentSession {
  id: string;
  messages: ChatMessage[];
  createdAt: number;
  lastActiveAt: number;
  pendingConfirmation: PendingConfirmation | null;
  sources: Source[];
}

// ── In-memory session store ─────────────────────────────────────────────
const sessionStore = new Map<string, AgentSession>();

/** Create a new agent session (or use a supplied ID). */
export function createSession(id?: string): AgentSession {
  const sessionId = id || crypto.randomUUID();
  const session: AgentSession = {
    id: sessionId,
    messages: [],
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    pendingConfirmation: null,
    sources: [],
  };
  sessionStore.set(sessionId, session);
  return session;
}

/** Retrieve a session (returns undefined if not found). */
export function getSession(id: string): AgentSession | undefined {
  const session = sessionStore.get(id);
  if (session) {
    session.lastActiveAt = Date.now();
  }
  return session;
}

/** Release transient extraction sessions immediately after their result is saved. */
export function deleteSession(id: string): void {
  sessionStore.delete(id);
}

/** Append a message to the session history. */
export function addMessage(id: string, message: ChatMessage): void {
  const session = getSession(id);
  if (session) {
    session.messages.push(message);
    session.lastActiveAt = Date.now();
  }
}

/** Return all messages for a session. */
export function getMessages(id: string): ChatMessage[] {
  const session = getSession(id);
  return session ? session.messages : [];
}

/** Set a pending confirmation (pauses the agent loop). */
export function setConfirmation(id: string, confirmation: PendingConfirmation): void {
  const session = getSession(id);
  if (session) {
    session.pendingConfirmation = confirmation;
    session.lastActiveAt = Date.now();
  }
}

/** Clear the pending confirmation. */
export function clearConfirmation(id: string): void {
  const session = getSession(id);
  if (session) {
    session.pendingConfirmation = null;
    session.lastActiveAt = Date.now();
  }
}

/** Track a retrieved source for citation verification. */
export function addSource(id: string, source: Source): void {
  const session = getSession(id);
  if (session) {
    session.sources.push(source);
    session.lastActiveAt = Date.now();
  }
}

/** Return all sources for a session. */
export function getSources(id: string): Source[] {
  const session = getSession(id);
  return session ? session.sources : [];
}

/**
 * Prune older messages to stay within a token budget.
 * Keeps the system prompt (index 0) and the most-recent messages
 * that fit within `maxTokens` (estimated as chars/4).
 */
export function pruneMessages(id: string, maxTokens: number): void {
  const session = getSession(id);
  if (!session || session.messages.length <= 1) return;

  const estimateTokens = estimateContentTokens;

  const systemPrompt = session.messages[0];
  let tokens = estimateTokens(systemPrompt.content);

  const recentMessages: ChatMessage[] = [];

  // Walk backwards, keeping messages until the budget runs out.
  for (let i = session.messages.length - 1; i >= 1; i--) {
    const msg = session.messages[i];
    let msgTokens = estimateTokens(msg.content);
    if (msg.tool_calls) {
      msgTokens += Math.ceil(JSON.stringify(msg.tool_calls).length / 4);
    }

    if (tokens + msgTokens > maxTokens && recentMessages.length > 0) {
      break;
    }
    tokens += msgTokens;
    recentMessages.unshift(msg);
  }

  session.messages = [systemPrompt, ...recentMessages];
  session.lastActiveAt = Date.now();
}

/** Remove sessions that haven't been touched in `maxAgeMs`. */
export function cleanupStaleSessions(maxAgeMs: number): void {
  const now = Date.now();
  for (const [id, session] of sessionStore.entries()) {
    if (now - session.lastActiveAt > maxAgeMs) {
      sessionStore.delete(id);
    }
  }
}

// Auto-cleanup every 30 minutes.
setInterval(() => cleanupStaleSessions(30 * 60 * 1000), 30 * 60 * 1000);
