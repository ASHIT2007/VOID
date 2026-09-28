const NOTE_ENVELOPE_FLOOR = 0.0001;

type BrowserWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

export type CompletionNotificationPayload = {
  prompt?: string;
  answer?: string;
  onClick?: () => void;
};

export type CompletionChimeController = {
  prime: (prompt?: string) => Promise<void>;
  play: (payload?: CompletionNotificationPayload) => Promise<void>;
  notify: (payload?: CompletionNotificationPayload) => Promise<void>;
  destroy: () => Promise<void>;
};

/**
 * Strips markdown, image embeds, code blocks, and metadata from generated content
 * to produce a clean, readable snippet suitable for OS desktop notifications.
 */
export function cleanNotificationText(raw: string, maxLength = 200): string {
  if (!raw) return "";
  let text = raw;

  // Remove internal metadata tags
  text = text.replace(/\[META_JSON:[\s\S]*?\]/g, "");
  text = text.replace(/\[GENERATE_IMAGE:[\s\S]*?\]/g, "");

  // Remove markdown images: ![alt](url) -> alt (or empty)
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");

  // Format code blocks cleanly
  text = text.replace(/```[\s\S]*?```/g, (match) => {
    const lines = match.split("\n").slice(1, -1).join(" ").trim();
    return lines ? `[Code: ${lines.slice(0, 35)}...]` : "[Code]";
  });

  // Remove inline markdown formatting
  text = text.replace(/`([^`]+)`/g, "$1");
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  text = text.replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, "$1");
  text = text.replace(/^#+\s+/gm, "");
  text = text.replace(/^>\s+/gm, "");

  // Collapse whitespace
  text = text.replace(/\s+/g, " ").trim();

  if (text.length > maxLength) {
    return text.slice(0, maxLength - 1).trim() + "…";
  }
  return text;
}

export function cleanPromptText(raw: string, maxLength = 80): string {
  if (!raw) return "";
  let text = raw.replace(/\s+/g, " ").trim();
  if (text.length > maxLength) {
    return text.slice(0, maxLength - 1).trim() + "…";
  }
  return text;
}

/**
 * Requests browser notification permission during a user gesture (e.g. prompt submission).
 */
export async function requestNotificationPermission(): Promise<NotificationPermission | null> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return null;
  }
  if (Notification.permission === "default") {
    try {
      return await Notification.requestPermission();
    } catch {
      return null;
    }
  }
  return Notification.permission;
}

/**
 * Fires a native OS desktop notification with the user prompt and answer preview.
 */
export function showCompletionNotification(payload: CompletionNotificationPayload = {}): Notification | null {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return null;
  }
  if (Notification.permission !== "granted") {
    return null;
  }

  const promptPreview = cleanPromptText(payload.prompt || "");
  const answerPreview = cleanNotificationText(payload.answer || "");

  const title = promptPreview
    ? `Response Ready • ${promptPreview}`
    : "Generation Complete • VOID";

  const body = answerPreview
    ? (promptPreview ? `${promptPreview}\n\n${answerPreview}` : answerPreview)
    : (promptPreview ? `Finished generating response for "${promptPreview}".` : "Your response is ready.");

  try {
    const notification = new Notification(title, {
      body,
      icon: "/favicon.ico",
      tag: "void-generation-complete",
    });

    notification.onclick = () => {
      try {
        window.focus();
      } catch {}
      payload.onClick?.();
      notification.close();
    };

    return notification;
  } catch (error) {
    console.warn("[Notification] Could not display system notification:", error);
    return null;
  }
}

/**
 * Manages background tab completion notifications.
 * Prioritizes native OS system notifications with prompt & answer preview.
 * Falls back to a subtle, modern micro-ping only if notifications are unavailable.
 */
export function createCompletionChime(): CompletionChimeController {
  let context: AudioContext | null = null;
  let primedPrompt: string | undefined;

  const getContext = () => {
    if (context && context.state !== "closed") return context;
    if (typeof window === "undefined") return null;

    const AudioContextConstructor = window.AudioContext
      || (window as BrowserWindow).webkitAudioContext;
    if (!AudioContextConstructor) return null;

    context = new AudioContextConstructor();
    return context;
  };

  const prime = async (prompt?: string) => {
    if (prompt) primedPrompt = prompt;

    // Request notification permission during the user's submit click/interaction
    void requestNotificationPermission();

    const audioContext = getContext();
    if (audioContext?.state === "suspended") {
      await audioContext.resume();
    }
  };

  const playSubtleFallbackTone = async () => {
    const audioContext = getContext();
    if (!audioContext) return;
    if (audioContext.state === "suspended") await audioContext.resume();

    // A modern, subtle 140ms soft ping (replaces the long 2.4s convenience store chime)
    const startAt = audioContext.currentTime + 0.02;
    const oscillator = audioContext.createOscillator();
    const envelope = audioContext.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(587.33, startAt); // D5
    oscillator.frequency.exponentialRampToValueAtTime(880, startAt + 0.04); // A5

    envelope.gain.setValueAtTime(NOTE_ENVELOPE_FLOOR, startAt);
    envelope.gain.exponentialRampToValueAtTime(0.035, startAt + 0.02);
    envelope.gain.exponentialRampToValueAtTime(NOTE_ENVELOPE_FLOOR, startAt + 0.14);

    oscillator.connect(envelope);
    envelope.connect(audioContext.destination);

    oscillator.start(startAt);
    oscillator.stop(startAt + 0.15);

    window.setTimeout(() => {
      oscillator.disconnect();
      envelope.disconnect();
    }, 200);
  };

  const notify = async (payload?: CompletionNotificationPayload) => {
    const effectivePrompt = payload?.prompt || primedPrompt;
    const effectivePayload: CompletionNotificationPayload = {
      ...payload,
      prompt: effectivePrompt,
    };

    // Try native system notification first
    const notification = showCompletionNotification(effectivePayload);
    if (notification) {
      // OS system notification displayed and plays the OS's native alert sound
      return;
    }

    // If notifications are blocked or unsupported, play subtle fallback tone
    await playSubtleFallbackTone().catch(() => {});
  };

  const destroy = async () => {
    if (context && context.state !== "closed") await context.close();
    context = null;
    primedPrompt = undefined;
  };

  return {
    prime,
    play: notify,
    notify,
    destroy,
  };
}
