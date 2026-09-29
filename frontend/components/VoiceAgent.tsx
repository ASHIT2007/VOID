"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MicOff } from "lucide-react";
import VoiceWaveIcon from "./VoiceWaveIcon";
import VoidVisualizer, { VoiceVisualState } from "./VoidVisualizer";
import { DEFAULT_VOICE_CONFIG, type VoiceConfig } from '@/lib/voice-config';
import { startNativeVoice, type NativeSession, type NativeVoiceHandle } from '@/lib/voice-native';
import { supabase } from "@/lib/supabase";
import { normalizeVoiceTranscript } from "@/lib/voice-transcript";
import { inferSpeechLanguage, detectSpeechLanguage, normalizeSpeechLanguage, deepgramSpeechLanguage } from "@/lib/voice-language";
import { compactVoiceHistory } from "@/lib/voice-conversation";
import { StreamingSpeechQueue } from "@/lib/voice-stream";
import { playSpeechAudio } from "@/lib/voice-audio";
import { isVoiceExitCommand, isVoiceStopCommand } from "@/lib/voice-commands";
import { workspaceStreamEvent } from '@/lib/workspace/device-store';

/**
 * VOID Voice Orb UI Tuning Parameters
 * - size: High-DPI canvas size; the shader keeps transparent breathing room around the sphere.
 * - spacingAboveTextarea: Clear space between the orb canvas and the prompt surface.
 */
const VOICE_ORB_CONFIG = {
  size: 200,
  spacingAboveTextarea: 24,
};

const VOICE_KEYTERMS = [
  "Void",
  "swordsman",
  "swordsmen",
  "Seven Ninja Swordsmen of the Mist",
  "Kirigakure",
  "Naruto",
];

type VoiceState = VoiceVisualState;
type InteractionMode = "auto" | "push";
type TransportMode = "deepgram" | "browser" | "upload" | null;
type ConversationMessage = { role: "user" | "assistant" | "system"; content: string };
type VoiceUsage = Record<string, { queries?: number; generated?: number; total?: number } | undefined>;
type VoiceResponseMeta = {
  statusLogs?: { action: string; query: string }[];
  sources?: string[];
  webSearch?: {
    query: string;
    results: { title: string; url: string; content?: string }[];
    images?: string[];
  };
  searchIntent?: { webSearchIntent: string; webImageIntent: string };
  modelName?: string;
};
type DeepgramMessage = {
  type?: string;
  is_final?: boolean;
  speech_final?: boolean;
  channel?: { alternatives?: Array<{ transcript?: string; confidence?: number }> };
};

type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onspeechstart: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type BrowserSpeechRecognitionEvent = {
  resultIndex?: number;
  results: ArrayLike<ArrayLike<{ transcript: string; confidence?: number }> & { isFinal?: boolean }>;
};

type BrowserSpeechActivity = {
  active: boolean;
  startedAt: number;
  boundaryAt: number;
  seed: number;
  intensity: number;
};

interface VoiceAgentProps {
  userEmail?: string | null;
  active?: boolean;
  onVoiceModeChange?: (active: boolean) => void;
  onPartialTranscript?: (text: string) => void;
  onTranscript?: (text: string) => void;
  onVisualRequest?: (text: string) => boolean;
  onAudioStart?: (aiText: string) => void;
  onAudioEnd?: () => void;
  onResponseUpdate?: (assistantText: string, complete: boolean, meta?: VoiceResponseMeta) => void;
  onTurnComplete?: (userText: string, assistantText: string) => void;
  conversationMessages?: ConversationMessage[];
  conversationId?: string | null;
  setSessionUsage?: React.Dispatch<React.SetStateAction<VoiceUsage>>;
}

const ALLOWED_TRANSITIONS: Record<VoiceState, VoiceState[]> = {
  idle: ["listening", "reconnecting", "error", "speaking"],
  listening: ["processing", "thinking", "speaking", "reconnecting", "error", "idle"],
  processing: ["thinking", "listening", "speaking", "reconnecting", "error", "idle"],
  thinking: ["speaking", "listening", "reconnecting", "error", "idle"],
  speaking: ["listening", "reconnecting", "error", "idle"],
  reconnecting: ["listening", "speaking", "error", "idle"],
  error: ["idle", "listening", "reconnecting", "speaking"],
};

const STATUS_LABEL: Record<VoiceState, string> = {
  idle: "Ready",
  listening: "Listening",
  processing: "Heard you",
  thinking: "Thinking",
  speaking: "Speaking",
  reconnecting: "Reconnecting",
  error: "Try again",
};

let globalActiveInstanceId: number | null = null;
let instanceCounter = 0;

function cleanTextForSpeech(text: string): string {
  return text
    .replace(/\\?&lt;br\s*\/?&gt;/gi, " ")
    .replace(/\\?<br\s*\/?>/gi, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]+\)/gi, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/gi, "$1")
    .replace(/\[(?:\d+[\s,;-]*)+\]/g, "")
    .replace(/https?:\/\/[^\s]+/gi, "")
    .replace(/#*\s*(references|sources)\b[\s\S]*/gi, "")
    .replace(/^\s*\|.*\|\s*$/gm, " ")
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, "")
    .replace(/^#+\s+/gm, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/[*#_~`>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelyPlaybackEcho(transcript: string, spokenText: string): boolean {
  const normalize = (value: string) => value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const heard = normalize(transcript);
  const spoken = normalize(spokenText);
  if (!heard || !spoken) return false;
  if (heard.length >= 4 && spoken.includes(heard)) return true;
  const heardWords = heard.split(" ").filter((word) => word.length > 1);
  if (heardWords.length < 3) return false;
  const spokenWords = new Set(spoken.split(" "));
  const overlap = heardWords.filter((word) => spokenWords.has(word)).length / heardWords.length;
  return overlap >= 0.78;
}

function compactConversation(messages: ConversationMessage[] = []): ConversationMessage[] {
  return compactVoiceHistory(messages);
}

function semanticallyComplete(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length < 2) return false;
  if (/[.!?]["')\]]?$/.test(normalized)) return true;
  return !/\b(?:and|but|because|so|or|then|also|like|um|uh|well|actually|basically|maybe|if|when|that|which|to)$/.test(normalized);
}

function recorderMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  return ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"]
    .find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function createAndStartRecorder(
  stream: MediaStream,
  timeslice = 200,
  onData?: (event: BlobEvent) => void,
  onStop?: () => void,
): MediaRecorder {
  const mimeCandidates = [
    recorderMimeType(),
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
    "",
  ].filter((type, idx, arr) => arr.indexOf(type) === idx);

  let lastError: unknown = null;
  for (const mime of mimeCandidates) {
    try {
      if (mime && typeof MediaRecorder !== "undefined" && !MediaRecorder.isTypeSupported(mime)) {
        continue;
      }
      const options = mime ? { mimeType: mime } : undefined;
      const rec = new MediaRecorder(stream, options);
      if (onData) rec.ondataavailable = onData;
      if (onStop) rec.onstop = onStop;
      rec.start(timeslice);
      return rec;
    } catch (err) {
      lastError = err;
    }
  }

  try {
    const plainRec = new MediaRecorder(stream);
    if (onData) plainRec.ondataavailable = onData;
    if (onStop) plainRec.onstop = onStop;
    plainRec.start();
    return plainRec;
  } catch (err) {
    throw lastError || err;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

function browserVoiceFor(text: string, contextLanguage?: string): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis?.getVoices?.() || [];
  if (!voices.length) return undefined;
  const requestedLanguage = inferSpeechLanguage(
    text,
    contextLanguage || navigator.language || "en",
  );
  const naturalName = /(?:natural|neural|aria|jenny|sonia|samantha|serena|google uk|google us|microsoft.*online)/i;
  const roboticName = /(?:espeak|festival|compact|desktop)/i;
  const languageMatches = voices.filter((voice) => {
    const language = voice.lang.toLowerCase();
    return language === requestedLanguage || language.startsWith(`${requestedLanguage}-`);
  });
  // Do not force a regional-language utterance through an unrelated English voice.
  const candidates = languageMatches;
  return [...candidates].sort((left, right) => {
    const score = (voice: SpeechSynthesisVoice) => {
      const language = voice.lang.toLowerCase();
      return (language === requestedLanguage || language.startsWith(`${requestedLanguage}-`) ? 10 : 0)
        + (contextLanguage && language === contextLanguage.toLowerCase() ? 20 : 0)
        + (naturalName.test(voice.name) ? 7 : 0)
        + (voice.localService ? 3 : 0)
        + (voice.default ? 1 : 0)
        - (roboticName.test(voice.name) ? 5 : 0);
    };
    return score(right) - score(left);
  })[0];
}

function browserProsody(text: string): { rate: number; pitch: number; volume: number; intensity: number } {
  const calm = /\b(?:sorry|understand|take your time|no worries|glad to help)\b/i.test(text);
  const upbeat = /[!]|\b(?:great|good news|absolutely|perfect|nice)\b/i.test(text);
  const question = /\?\s*$/.test(text);
  return {
    rate: calm ? 0.9 : text.length > 150 ? 0.93 : upbeat ? 0.97 : 0.95,
    pitch: calm ? 0.97 : question ? 1.035 : upbeat ? 1.025 : 1,
    volume: 0.96,
    intensity: calm ? 0.82 : upbeat ? 1.12 : question ? 1.04 : 1,
  };
}

function playVoiceTransitionSound(context: AudioContext, transition: "enter" | "exit") {
  if (context.state === "closed") return;
  const startAt = context.currentTime + 0.012;
  const notes = transition === "enter"
    ? [{ frequency: 392, offset: 0 }, { frequency: 523.25, offset: 0.075 }]
    : [{ frequency: 523.25, offset: 0 }, { frequency: 349.23, offset: 0.075 }];

  for (const [index, note] of notes.entries()) {
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    const noteStart = startAt + note.offset;
    const noteEnd = noteStart + 0.15;
    oscillator.type = index === 0 ? "sine" : "triangle";
    oscillator.frequency.setValueAtTime(note.frequency, noteStart);
    envelope.gain.setValueAtTime(0.0001, noteStart);
    envelope.gain.exponentialRampToValueAtTime(index === 0 ? 0.045 : 0.035, noteStart + 0.018);
    envelope.gain.exponentialRampToValueAtTime(0.0001, noteEnd);
    oscillator.connect(envelope);
    envelope.connect(context.destination);
    oscillator.start(noteStart);
    oscillator.stop(noteEnd + 0.01);
    oscillator.addEventListener("ended", () => {
      oscillator.disconnect();
      envelope.disconnect();
    }, { once: true });
  }
}

export default function VoiceAgent({
  active,
  onVoiceModeChange,
  onPartialTranscript,
  onTranscript,
  onVisualRequest,
  onAudioStart,
  onAudioEnd,
  onResponseUpdate,
  onTurnComplete,
  conversationMessages = [],
  conversationId,
  setSessionUsage,
}: VoiceAgentProps) {
  const [state, setState] = useState<VoiceState>("idle");
  const [showVisualizer, setShowVisualizer] = useState(false);
  const [interactionMode] = useState<InteractionMode>("auto");
  const [muted, setMuted] = useState(false);
  const [partialTranscript, setPartialTranscript] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const conversationLanguageRef = useRef('');
  const voiceConfigRef = useRef<VoiceConfig>(DEFAULT_VOICE_CONFIG);
  const nativeVoiceRef = useRef<NativeVoiceHandle | null>(null);
  const voiceStartupRef = useRef<AbortController | null>(null);
  const speechQueueRef = useRef<StreamingSpeechQueue | null>(null);
  const [instanceId] = useState(() => ++instanceCounter);
  const mountedRef = useRef(true);
  const stateRef = useRef<VoiceState>("idle");
  const isUserSpeakingRef = useRef(false);
  const lastSpeechDetectedAtRef = useRef(0);
  const showVisualizerRef = useRef(false);
  const modeRef = useRef<InteractionMode>("auto");
  const mutedRef = useRef(false);

  const setUserSpeaking = useCallback((speaking: boolean) => {
    isUserSpeakingRef.current = speaking;
    if (speaking) lastSpeechDetectedAtRef.current = Date.now();
  }, []);

  const visualAgentState: VoiceVisualState = useMemo(() => {
    if (muted) return "idle";
    if (state === "speaking") return "speaking";
    if (state === "thinking" || state === "processing") return "thinking";
    if (state === "listening") return "listening";
    return "idle";
  }, [state, muted]);
  const historyRef = useRef<ConversationMessage[]>(compactConversation(conversationMessages));
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputAnalyserRef = useRef<AnalyserNode | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const uploadChunksRef = useRef<BlobPart[]>([]);
  const socketRef = useRef<WebSocket | null>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const transportModeRef = useRef<TransportMode>(null);
  const intentionalTransportStopRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endpointTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallbackVadTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bargeInTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const noiseFloorRef = useRef(0.025);
  const providerSpeechStartedAtRef = useRef(0);
  const providerSpeechPeakRef = useRef(0);
  const fallbackBargeInStartedAtRef = useRef(0);
  const playbackStartedAtRef = useRef(0);
  const finalSegmentsRef = useRef<string[]>([]);
  const confidenceRef = useRef<number[]>([]);
  const lastSubmittedRef = useRef({ text: "", at: 0 });
  const pttReleasePendingRef = useRef(false);
  const llmAbortRef = useRef<AbortController | null>(null);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsAudioUrlRef = useRef<string | null>(null);
  const turnIdRef = useRef(0);
  const responseTextRef = useRef("");
  const deepgramUnavailableRef = useRef(false);
  const previousSpeechTextRef = useRef("");
  const browserSpeechActivityRef = useRef<BrowserSpeechActivity>({
    active: false,
    startedAt: 0,
    boundaryAt: 0,
    seed: 0,
    intensity: 1,
  });
  const speechStartedRef = useRef(false);
  const priorAssistantSpeechRef = useRef("");

  const startTransportRef = useRef<() => Promise<void>>(async () => {});
  const resumeListeningRef = useRef<() => void>(() => {});
  const closeVisualizerRef = useRef<() => void>(() => {});
  const startPushToTalkRef = useRef<() => void>(() => {});
  const finishPushToTalkRef = useRef<() => void>(() => {});

  useEffect(() => {
    historyRef.current = compactConversation(conversationMessages);
  }, [conversationMessages]);

  useEffect(() => {
    showVisualizerRef.current = showVisualizer;
    onVoiceModeChange?.(showVisualizer);
  }, [showVisualizer, onVoiceModeChange]);

  useEffect(() => {
    onPartialTranscript?.(partialTranscript);
  }, [onPartialTranscript, partialTranscript]);

  const transition = useCallback((next: VoiceState) => {
    if (!mountedRef.current) return;
    const current = stateRef.current;
    if (current !== next && !ALLOWED_TRANSITIONS[current].includes(next)) {
      console.warn(`[voice] ignored invalid transition ${current} -> ${next}`);
      return;
    }
    stateRef.current = next;
    setState(next);
  }, []);

  const getInputVolume = useCallback(() => {
    const analyser = inputAnalyserRef.current;
    if (!analyser) return 0;
    const samples = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(samples);
    let energy = 0;
    for (const sample of samples) {
      const centered = (sample - 128) / 128;
      energy += centered * centered;
    }
    return Math.min(1, Math.sqrt(energy / samples.length) * 4.2);
  }, []);

  const getOutputVolume = useCallback(() => {
    if (nativeVoiceRef.current) return nativeVoiceRef.current.getOutputVolume();
    // The Web Speech API deliberately does not expose its audio stream to an
    // AnalyserNode. Drive the visualizer from smooth syllable/boundary motion
    // so local, quota-free speech remains visibly expressive.
    const activity = browserSpeechActivityRef.current;
    if (!activity.active) return 0;
    const now = performance.now();
    const elapsed = Math.max(0, (now - activity.startedAt) / 1000);
    const boundaryAccent = Math.exp(-Math.max(0, now - activity.boundaryAt) / 150) * 0.22;
    const syllables = Math.pow(Math.abs(Math.sin(elapsed * 10.7 + activity.seed)), 1.35);
    const phrasing = 0.5 + 0.5 * Math.sin(elapsed * 2.15 + activity.seed * 0.37);
    return Math.min(0.94, (0.16 + syllables * (0.34 + phrasing * 0.16) + boundaryAccent) * activity.intensity);
  }, []);

  const ensureAudioContext = useCallback(async () => {
    if (!audioContextRef.current) {
      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) throw new Error("Audio is not supported in this browser");
      audioContextRef.current = new AudioContextClass();
    }
    if (audioContextRef.current.state === "suspended") await audioContextRef.current.resume();
    return audioContextRef.current;
  }, []);

  const ensureMicrophone = useCallback(async (forceFresh = false) => {
    const current = micStreamRef.current;
    const tracks = current?.getAudioTracks() || [];
    const isLive = current && current.active && tracks.length > 0 && tracks.every((track) => track.readyState === "live");
    if (!forceFresh && isLive && current) {
      tracks.forEach((track) => { track.enabled = !mutedRef.current; });
      return current;
    }

    if (current) {
      try { current.getTracks().forEach((track) => track.stop()); } catch {}
      micStreamRef.current = null;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    micStreamRef.current = stream;
    const context = await ensureAudioContext();
    try { micSourceRef.current?.disconnect(); } catch {}
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.42;
    source.connect(analyser);
    micSourceRef.current = source;
    inputAnalyserRef.current = analyser;
    return stream;
  }, [ensureAudioContext]);

  const completePlayback = useCallback((turnId: number) => {
    if (turnId !== turnIdRef.current) return;
    if (speechStartedRef.current) onAudioEnd?.();
    speechStartedRef.current = false;
    playbackStartedAtRef.current = 0;
    providerSpeechStartedAtRef.current = 0;
    providerSpeechPeakRef.current = 0;
    setUserSpeaking(false);
    setPartialTranscript("");
    resumeListeningRef.current();
  }, [onAudioEnd, setUserSpeaking]);

  const stopAudioOutput = useCallback((notify = true) => {
    speechQueueRef.current?.cancel();
    speechQueueRef.current = null;
    previousSpeechTextRef.current = "";
    browserSpeechActivityRef.current.active = false;
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      ttsAudioRef.current.removeAttribute("src");
      ttsAudioRef.current.load();
      ttsAudioRef.current = null;
    }
    if (ttsAudioUrlRef.current) {
      URL.revokeObjectURL(ttsAudioUrlRef.current);
      ttsAudioUrlRef.current = null;
    }
    window.speechSynthesis?.cancel();
    if (notify && speechStartedRef.current) onAudioEnd?.();
    speechStartedRef.current = false;
    playbackStartedAtRef.current = 0;
    providerSpeechStartedAtRef.current = 0;
    providerSpeechPeakRef.current = 0;
    setUserSpeaking(false);
  }, [onAudioEnd, setUserSpeaking]);

  const cancelActiveTurn = useCallback((notify = true) => {
    turnIdRef.current += 1;
    llmAbortRef.current?.abort();
    llmAbortRef.current = null;
    stopAudioOutput(notify);
  }, [stopAudioOutput]);

  const speakWithBrowser = useCallback((text: string, turnId: number, finish = true, signal?: AbortSignal): Promise<void> => {
    const spokenText = cleanTextForSpeech(text);
    if (turnId !== turnIdRef.current || !spokenText || signal?.aborted) return Promise.resolve();
    const language = conversationLanguageRef.current || navigator.language;
    const voice = (voiceConfigRef.current.ttsVoice ? window.speechSynthesis?.getVoices().find(item => item.voiceURI === voiceConfigRef.current.ttsVoice) : undefined) || browserVoiceFor(spokenText, language);
    if (!voice || !("speechSynthesis" in window)) {
      const message = 'A native voice for this language is unavailable. Connect a multilingual voice provider in Settings.';
      if (!finish) return Promise.reject(new Error(message));
      completePlayback(turnId); setErrorMessage(message); return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(spokenText);
      utterance.voice = voice; utterance.lang = voice.lang;
      const prosody = browserProsody(spokenText);
      utterance.rate = prosody.rate; utterance.pitch = prosody.pitch; utterance.volume = prosody.volume;
      const seed = [...spokenText].reduce((value, character) => (value * 31 + character.charCodeAt(0)) % 997, 17) / 97;
      const cleanup = () => { signal?.removeEventListener('abort', interrupted); utterance.onend = null; utterance.onerror = null; };
      const interrupted = () => { cleanup(); window.speechSynthesis.cancel(); reject(new DOMException('Speech interrupted', 'AbortError')); };
      signal?.addEventListener('abort', interrupted, { once: true });
      utterance.onstart = () => {
        if (turnId !== turnIdRef.current) return;
        browserSpeechActivityRef.current = { active: true, startedAt: performance.now(), boundaryAt: performance.now(), seed, intensity: prosody.intensity };
        previousSpeechTextRef.current = `${previousSpeechTextRef.current} ${spokenText}`.slice(-1200);
        if (!speechStartedRef.current) { speechStartedRef.current = true; playbackStartedAtRef.current = Date.now(); onAudioStart?.(spokenText); }
        transition('speaking');
      };
      utterance.onboundary = () => { if (turnId === turnIdRef.current) browserSpeechActivityRef.current.boundaryAt = performance.now(); };
      utterance.onend = () => { cleanup(); browserSpeechActivityRef.current.active = false; if (finish) completePlayback(turnId); resolve(); };
      utterance.onerror = () => { cleanup(); browserSpeechActivityRef.current.active = false; if (finish) { completePlayback(turnId); resolve(); } else reject(new Error('Native voice playback failed')); };
      window.speechSynthesis.speak(utterance);
    });
  }, [completePlayback, onAudioStart, transition]);

  const prepareSpeech = useCallback(async (text: string, turnId: number, signal: AbortSignal): Promise<() => Promise<void>> => {
    const spokenText = cleanTextForSpeech(text);
    if (!spokenText) return async () => {};
    if (voiceConfigRef.current.ttsProvider === 'browser') return () => speakWithBrowser(spokenText, turnId, false, signal);
    const previousText = priorAssistantSpeechRef.current;
    priorAssistantSpeechRef.current = `${previousText} ${spokenText}`.slice(-1200);
    let response: Response;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      response = await fetch('/api/tts', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { 'x-void-user-token': session.access_token } : {}) },
        body: JSON.stringify({ text: spokenText, previousText, language: inferSpeechLanguage(spokenText, conversationLanguageRef.current || navigator.language || 'en') }), signal,
      });
      if (!response.ok || !response.headers.get('content-type')?.startsWith('audio/')) { const failure = await response.json().catch(() => ({})); throw new Error(typeof failure.error === 'string' ? failure.error : 'Your selected speech provider is unavailable. Check Voice Agent settings.'); }
    } catch (error) {
      if (signal.aborted || isAbortError(error)) throw error;
      throw error;
    }
    return async () => {
      if (signal.aborted || turnId !== turnIdRef.current) return;
      const audio = new Audio(); audio.preload = 'auto'; ttsAudioRef.current = audio;
      let started = false;
      audio.onplaying = () => {
        if (signal.aborted || turnId !== turnIdRef.current) return;
        if (started) return;
        started = true;
        browserSpeechActivityRef.current = { active: true, startedAt: performance.now(), boundaryAt: performance.now(), seed: 0.37, intensity: 1 };
        previousSpeechTextRef.current = `${previousSpeechTextRef.current} ${spokenText}`.slice(-1200);
        if (!speechStartedRef.current) { speechStartedRef.current = true; playbackStartedAtRef.current = Date.now(); onAudioStart?.(spokenText); }
        transition('speaking');
      };
      try {
        await playSpeechAudio(response, audio, signal, url => { ttsAudioUrlRef.current = url; });
      } catch (error) {
        if (signal.aborted || turnId !== turnIdRef.current || isAbortError(error)) return;
        audio.pause();
        throw error;
      } finally {
        audio.onplaying = null; audio.pause(); audio.removeAttribute('src'); audio.load();
        if (ttsAudioRef.current === audio) { ttsAudioRef.current = null; ttsAudioUrlRef.current = null; browserSpeechActivityRef.current.active = false; }
      }
    };
  }, [onAudioStart, speakWithBrowser, transition]);

  const makeSpeechQueue = useCallback((turnId: number) => new StreamingSpeechQueue(
    (text, signal) => prepareSpeech(text, turnId, signal),
    () => completePlayback(turnId),
    error => { if (turnId === turnIdRef.current) { completePlayback(turnId); setErrorMessage(error instanceof Error ? error.message : 'Voice playback interrupted'); } },
  ), [completePlayback, prepareSpeech]);

  const recordUsage = useCallback(() => {
    if (!setSessionUsage) return;
    setSessionUsage((previous) => {
      const newTotal = (previous?.voice_agent?.queries || 0) + 1;
      supabase.auth.getUser().then(({ data: { user } }) => {
        if (user) {
          supabase.from("profiles").update({ queries_voice: newTotal }).eq("id", user.id)
            .then(undefined, (error) => console.error("Voice usage update error:", error));
        }
      }).catch((error) => console.error("Voice usage user lookup error:", error));
      return { ...previous, voice_agent: { ...previous?.voice_agent, queries: newTotal } };
    });
  }, [setSessionUsage]);

  const submitVoiceTurn = useCallback(async (rawText: string) => {
    const recentContext = historyRef.current.slice(-4).map((message) => message.content).join(" ");
    const text = normalizeVoiceTranscript(rawText, recentContext);
    if (!text) {
      resumeListeningRef.current();
      return;
    }
    if (isVoiceExitCommand(text)) {
      closeVisualizerRef.current();
      return;
    }
    if (isVoiceStopCommand(text)) {
      cancelActiveTurn(true);
      resumeListeningRef.current();
      return;
    }
    const duplicate = lastSubmittedRef.current.text.toLowerCase() === text.toLowerCase()
      && Date.now() - lastSubmittedRef.current.at < 1600;
    if (duplicate) return;
    lastSubmittedRef.current = { text, at: Date.now() };
    const detectedLanguage = detectSpeechLanguage(text);
    if (detectedLanguage) conversationLanguageRef.current = detectedLanguage;

    cancelActiveTurn(false);
    const turnId = turnIdRef.current;
    responseTextRef.current = "";
    setPartialTranscript("");
    setErrorMessage(null);
    transition("processing");

    if (onVisualRequest?.(text)) {
      recordUsage();
      speakWithBrowser("Okay… I’ll create that image in the chat.", turnId);
      return;
    }

    onTranscript?.(text);
    recordUsage();

    const controller = new AbortController();
    llmAbortRef.current = controller;
    priorAssistantSpeechRef.current = historyRef.current.filter((message) => message.role === "assistant").at(-1)?.content || "";
    const requestHistory = compactVoiceHistory([...historyRef.current, { role: "user" as const, content: text }]);
    speechQueueRef.current = makeSpeechQueue(turnId);

    try {
      const requestPayload = {
        messages: requestHistory,
        model: "Auto",
        mode: "normal",
        reasoningEffort: "auto",
        isWebSearch: true,
        isVoice: true,
        voiceLanguage: conversationLanguageRef.current,
        conversationId: conversationId || `voice-${instanceId}`,
      };
      const { data: { session: voiceSession } } = await supabase.auth.getSession();
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(voiceSession?.access_token ? { 'x-void-user-token': voiceSession.access_token } : {}) },
        body: JSON.stringify(requestPayload),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const failure = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(failure?.error || `Assistant returned ${response.status}`);
      }
      if (turnId !== turnIdRef.current) return;
      transition("thinking");

      let fullResponse = "";
      let sseBuffer = "";
      const decoder = new TextDecoder();
      let responseMeta: VoiceResponseMeta = { statusLogs: [], sources: [] };

      const processSseLine = (line: string) => {
        if (!line.startsWith("data: ") || line.trim() === "data: [DONE]") return;
        const event = JSON.parse(line.slice(6)) as {
          type?: string;
          content?: string;
          message?: string;
          error?: string;
          action?: string;
          query?: string;
          sources?: unknown;
          results?: unknown;
          images?: unknown;
          webSearchIntent?: string;
          webImageIntent?: string;
          uiName?: string;
          fullText?: string;
        };
        workspaceStreamEvent(event);
        if (event.type === "error") throw new Error(event.message || event.error || "Voice response failed");
        if (event.type === "reset" || event.type === "response_reset") {
          stopAudioOutput(true);
          speechQueueRef.current = makeSpeechQueue(turnId);
          fullResponse = "";
          onResponseUpdate?.("", false, responseMeta);
          return;
        }
        if (event.type === "status" && event.action) {
          responseMeta = {
            ...responseMeta,
            statusLogs: [...(responseMeta.statusLogs || []), { action: event.action, query: event.query || "" }],
          };
          onResponseUpdate?.(fullResponse, false, responseMeta);
          return;
        }
        if (event.type === "sources" && Array.isArray(event.sources)) {
          const incoming = event.sources.flatMap((source) => {
            if (typeof source === "string") return [source];
            if (source && typeof source === "object" && "url" in source && typeof source.url === "string") return [source.url];
            return [];
          });
          responseMeta = { ...responseMeta, sources: [...new Set([...(responseMeta.sources || []), ...incoming])] };
          onResponseUpdate?.(fullResponse, false, responseMeta);
          return;
        }
        if (event.type === "webSearch" && Array.isArray(event.results)) {
          const incoming = event.results.flatMap((result) => {
            if (!result || typeof result !== "object") return [];
            const candidate = result as { title?: unknown; url?: unknown; content?: unknown };
            if (typeof candidate.title !== "string" || typeof candidate.url !== "string") return [];
            return [{
              title: candidate.title,
              url: candidate.url,
              ...(typeof candidate.content === "string" ? { content: candidate.content } : {}),
            }];
          });
          const previous = responseMeta.webSearch;
          const merged = [...(previous?.results || []), ...incoming]
            .filter((result, index, all) => all.findIndex((candidate) => candidate.url === result.url) === index);
          const images = Array.isArray(event.images)
            ? event.images.filter((image): image is string => typeof image === "string")
            : previous?.images;
          responseMeta = {
            ...responseMeta,
            webSearch: { query: event.query || previous?.query || "", results: merged, images },
          };
          onResponseUpdate?.(fullResponse, false, responseMeta);
          return;
        }
        if (event.type === "searchIntent") {
          responseMeta = {
            ...responseMeta,
            searchIntent: {
              webSearchIntent: event.webSearchIntent || "",
              webImageIntent: event.webImageIntent || "",
            },
          };
          return;
        }
        if ((event.type === "model_fallback" || event.type === "model_runtime") && event.uiName) {
          responseMeta = { ...responseMeta, modelName: event.uiName };
          return;
        }
        if (event.type !== "text" && event.type !== "text_delta") return;
        if (!event.content) return;
        fullResponse += event.content;
        speechQueueRef.current?.push(event.content);
        responseTextRef.current = fullResponse;
        onResponseUpdate?.(fullResponse, false, responseMeta);
      };

      const reader = response.body.getReader();
      while (true) {
        const { value, done } = await reader.read();
        sseBuffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const lines = sseBuffer.split(/\r?\n/);
        sseBuffer = lines.pop() || "";
        for (const line of lines) processSseLine(line);
        if (done) break;
      }
      if (sseBuffer.trim()) processSseLine(sseBuffer.trim());
      if (turnId !== turnIdRef.current) return;

      const spokenResponse = cleanTextForSpeech(fullResponse);
      if (!spokenResponse) throw new Error("The assistant returned an empty response");

      const completedHistory = compactVoiceHistory([...requestHistory, { role: "assistant" as const, content: spokenResponse }]);
      historyRef.current = completedHistory;
      if (onResponseUpdate) onResponseUpdate(fullResponse.trim(), true, responseMeta);
      else onTurnComplete?.(text, fullResponse.trim());
      speechQueueRef.current?.finish();
    } catch (error: unknown) {
      if (turnId !== turnIdRef.current || isAbortError(error)) return;
      stopAudioOutput(true);
      console.error("Voice response error:", error);
      setErrorMessage(error instanceof Error ? error.message.slice(0, 180) : "Connection interrupted");
      transition("error");
      speakWithBrowser("I hit a connection problem. You can keep talking or type instead.", turnId);
    } finally {
      if (llmAbortRef.current === controller) llmAbortRef.current = null;
    }
  }, [cancelActiveTurn, conversationId, makeSpeechQueue, stopAudioOutput, instanceId, onResponseUpdate, onTranscript, onTurnComplete, onVisualRequest, recordUsage, speakWithBrowser, transition]);

  const finalizeTranscript = useCallback(() => {
    if (endpointTimerRef.current) clearTimeout(endpointTimerRef.current);
    endpointTimerRef.current = null;
    const text = finalSegmentsRef.current.join(" ").replace(/\s+/g, " ").trim();
    const confidences = confidenceRef.current;
    finalSegmentsRef.current = [];
    confidenceRef.current = [];
    setPartialTranscript("");
    if (modeRef.current === "push") {
      intentionalTransportStopRef.current = true;
      recorderRef.current?.stop();
      socketRef.current?.close(1000, "push-to-talk complete");
      recognitionRef.current?.stop();
      transportModeRef.current = null;
    }
    if (!text) {
      setUserSpeaking(false);
      resumeListeningRef.current();
      return;
    }
    const confidence = confidences.length
      ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
      : 1;
    if (confidence > 0 && confidence < 0.52) {
      cancelActiveTurn(false);
      const turnId = turnIdRef.current;
      setUserSpeaking(false);
      setErrorMessage("Please repeat that");
      transition("error");
      speakWithBrowser("Sorry, could you repeat that?", turnId);
      return;
    }
    setUserSpeaking(false);
    void submitVoiceTurn(text);
  }, [cancelActiveTurn, setUserSpeaking, speakWithBrowser, submitVoiceTurn, transition]);

  const scheduleEndpoint = useCallback((text: string, forced = false) => {
    if (endpointTimerRef.current) clearTimeout(endpointTimerRef.current);
    const delay = forced ? 40 : semanticallyComplete(text) ? 320 : 700;
    endpointTimerRef.current = setTimeout(finalizeTranscript, delay);
  }, [finalizeTranscript]);

  const interruptForSpeech = useCallback(() => {
    if (nativeVoiceRef.current) { nativeVoiceRef.current.interrupt(); return; }
    const current = stateRef.current;
    if (current !== "speaking" && current !== "thinking" && current !== "processing") return;
    cancelActiveTurn(true);
    finalSegmentsRef.current = [];
    confidenceRef.current = [];
    providerSpeechStartedAtRef.current = 0;
    providerSpeechPeakRef.current = 0;
    setUserSpeaking(false);
    setErrorMessage(null);
    transition("listening");
  }, [cancelActiveTurn, setUserSpeaking, transition]);

  const isCredibleBargeIn = useCallback((transcript: string, confidence: number | undefined, isFinal: boolean) => {
    const current = stateRef.current;
    if (!["speaking", "thinking", "processing"].includes(current)) return true;
    if (current === "speaking" && isLikelyPlaybackEcho(transcript, previousSpeechTextRef.current)) return false;

    const now = Date.now();
    const words = transcript.trim().split(/\s+/).filter(Boolean).length;
    const inputPeak = Math.max(providerSpeechPeakRef.current, getInputVolume());
    const outputLevel = current === "speaking" ? getOutputVolume() : 0;
    const minimumLevel = current === "speaking" ? 0.028 : 0.025;
    const adaptiveThreshold = Math.max(
      minimumLevel,
      noiseFloorRef.current * 1.25 + 0.004,
      Math.min(0.065, 0.022 + outputLevel * 0.025),
    );
    const providerAge = providerSpeechStartedAtRef.current
      ? now - providerSpeechStartedAtRef.current
      : 0;
    const afterPlaybackGuard = current !== "speaking"
      || !playbackStartedAtRef.current
      || now - playbackStartedAtRef.current >= 70;
    const enoughSpeech = isFinal
      ? words >= 1 && transcript.trim().length >= 2
      : words >= 1 && transcript.trim().length >= 3;
    const confidenceOkay = !isFinal || confidence === undefined || confidence >= 0.28;

    return afterPlaybackGuard
      && providerAge >= 20
      && inputPeak >= adaptiveThreshold
      && enoughSpeech
      && confidenceOkay;
  }, [getInputVolume, getOutputVolume]);

  const handleDeepgramMessage = useCallback((payload: DeepgramMessage) => {
    if (payload?.type === "SpeechStarted") {
      if (endpointTimerRef.current) clearTimeout(endpointTimerRef.current);
      const now = Date.now();
      const inputLevel = getInputVolume();
      providerSpeechStartedAtRef.current = now;
      providerSpeechPeakRef.current = inputLevel;
      const current = stateRef.current;
      const playbackReady = current !== "speaking" || !playbackStartedAtRef.current || now - playbackStartedAtRef.current >= 70;
      if (["speaking", "thinking", "processing"].includes(current)
        && playbackReady
        && inputLevel >= Math.max(0.028, noiseFloorRef.current * 1.25 + 0.004)) {
        // Provider VAD has already confirmed a new human voice. Stop output at
        // speech onset instead of waiting for a complete transcript.
        interruptForSpeech();
        providerSpeechStartedAtRef.current = now;
        providerSpeechPeakRef.current = inputLevel;
      }
      setUserSpeaking(true);
      return;
    }
    if (payload?.type === "UtteranceEnd") {
      setUserSpeaking(false);
      if (["speaking", "thinking", "processing"].includes(stateRef.current)) {
        providerSpeechStartedAtRef.current = 0;
        providerSpeechPeakRef.current = 0;
        finalSegmentsRef.current = [];
        confidenceRef.current = [];
        setPartialTranscript("");
        return;
      }
      scheduleEndpoint(finalSegmentsRef.current.join(" "), true);
      return;
    }
    if (payload?.type !== "Results") return;
    const alternative = payload.channel?.alternatives?.[0];
    const recentContext = historyRef.current.slice(-4).map((message) => message.content).join(" ");
    const transcript = normalizeVoiceTranscript(String(alternative?.transcript || ""), recentContext);
    if (!transcript) return;
    if (isVoiceExitCommand(transcript)) {
      finalSegmentsRef.current = [];
      confidenceRef.current = [];
      setPartialTranscript("");
      setUserSpeaking(false);
      closeVisualizerRef.current();
      return;
    }
    if (isVoiceStopCommand(transcript)) {
      if (["speaking", "thinking", "processing"].includes(stateRef.current)) interruptForSpeech();
      finalSegmentsRef.current = [];
      confidenceRef.current = [];
      setPartialTranscript("");
      setUserSpeaking(false);
      return;
    }
    if (!["speaking", "thinking", "processing"].includes(stateRef.current)) {
      setUserSpeaking(true);
    }
    const confidence = typeof alternative?.confidence === "number" ? alternative.confidence : undefined;
    if (["speaking", "thinking", "processing"].includes(stateRef.current)) {
      providerSpeechPeakRef.current = Math.max(providerSpeechPeakRef.current, getInputVolume());
      if (!isCredibleBargeIn(transcript, confidence, Boolean(payload.is_final))) return;
      interruptForSpeech();
      setUserSpeaking(true);
    }

    if (payload.is_final) {
      const previous = finalSegmentsRef.current.at(-1);
      if (previous !== transcript) finalSegmentsRef.current.push(transcript);
      if (typeof alternative?.confidence === "number") confidenceRef.current.push(alternative.confidence);
    }
    const visible = [...finalSegmentsRef.current, ...(payload.is_final ? [] : [transcript])].join(" ").trim();
    setPartialTranscript(visible);
    if (payload.speech_final) scheduleEndpoint(visible);
  }, [getInputVolume, interruptForSpeech, isCredibleBargeIn, scheduleEndpoint, setUserSpeaking]);

  const stopRecorder = useCallback(() => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder && recorder.state !== "inactive") {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      try { recorder.stop(); } catch {}
    }
  }, []);

  const stopTransport = useCallback((intentional = true) => {
    intentionalTransportStopRef.current = intentional;
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    if (endpointTimerRef.current) clearTimeout(endpointTimerRef.current);
    if (fallbackVadTimerRef.current) clearInterval(fallbackVadTimerRef.current);
    reconnectTimerRef.current = null;
    endpointTimerRef.current = null;
    fallbackVadTimerRef.current = null;
    stopRecorder();
    if (socketRef.current) {
      const socket = socketRef.current;
      socketRef.current = null;
      try { socket.close(1000, "voice transport stopped"); } catch {}
    }
    if (recognitionRef.current) {
      const recognition = recognitionRef.current;
      recognitionRef.current = null;
      recognition.onend = null;
      try { recognition.abort(); } catch {}
    }
    transportModeRef.current = null;
    providerSpeechStartedAtRef.current = 0;
    providerSpeechPeakRef.current = 0;
    fallbackBargeInStartedAtRef.current = 0;
  }, [stopRecorder]);

  const startUploadFallback = useCallback(async () => {
    const stream = await ensureMicrophone();
    stopRecorder();
    if (!showVisualizerRef.current || voiceStartupRef.current?.signal.aborted) return;
    uploadChunksRef.current = [];
    let userSpoke = false;
    let silenceSince = 0;
    let noiseFloor = 0.025;
    let noiseSamples = 0;
    let shouldUpload = true;

    let recorder: MediaRecorder;
    try {
      recorder = createAndStartRecorder(
        stream,
        250,
        (event) => {
          if (event.data.size) uploadChunksRef.current.push(event.data);
        },
        async () => {
          if (fallbackVadTimerRef.current) clearInterval(fallbackVadTimerRef.current);
          fallbackVadTimerRef.current = null;
          if (!shouldUpload || !userSpoke || !uploadChunksRef.current.length) return;
          transition("processing");
          const blob = new Blob(uploadChunksRef.current, { type: recorder.mimeType || "audio/webm" });
          const form = new FormData();
          form.append("audio", blob, recorder.mimeType.includes("ogg") ? "audio.ogg" : "audio.webm");
          try {
            const { data: { session: transcriptionSession } } = await supabase.auth.getSession();
            const response = await fetch("/api/transcribe", { method: "POST", body: form,
              headers: transcriptionSession?.access_token ? { 'x-void-user-token': transcriptionSession.access_token } : {}, signal: voiceStartupRef.current?.signal });
            const data = await response.json() as { text?: string; language?: string; error?: string };
            if (!response.ok) throw new Error(data.error || `Transcription returned ${response.status}`);
            if (!showVisualizerRef.current || voiceStartupRef.current?.signal.aborted) return;
            if (normalizeSpeechLanguage(data.language)
              && (!conversationLanguageRef.current || (data.text || '').trim().split(/\s+/).length > 2)) {
              conversationLanguageRef.current = normalizeSpeechLanguage(data.language)!;
            }
            if (data.text?.trim()) void submitVoiceTurn(data.text);
            else resumeListeningRef.current();
          } catch (error) {
            if (!showVisualizerRef.current || voiceStartupRef.current?.signal.aborted) return;
            micStreamRef.current?.getTracks().forEach(track => track.stop());
            setErrorMessage(error instanceof Error ? error.message : 'Transcription failed. Check Voice Agent settings.');
            transition("error");
          }
        }
      );
      recorderRef.current = recorder;
      transportModeRef.current = "upload";
    } catch (recorderError) {
      console.error("Upload fallback recorder failed:", recorderError);
      setErrorMessage("Microphone not supported");
      transition("error");
      return;
    }
    fallbackVadTimerRef.current = setInterval(() => {
      if (recorder.state !== "recording") return;
      if (stateRef.current !== "listening") {
        shouldUpload = false;
        recorder.stop();
        return;
      }
      const volume = getInputVolume();
      if (!userSpoke && noiseSamples < 20) {
        noiseFloor = (noiseFloor * noiseSamples + volume) / (noiseSamples + 1);
        noiseSamples += 1;
      }
      const speechThreshold = Math.max(0.075, noiseFloor + 0.055);
      if (volume >= speechThreshold) {
        userSpoke = true;
        silenceSince = 0;
        setUserSpeaking(true);
      } else if (userSpoke) {
        if (!silenceSince) silenceSince = Date.now();
        if (Date.now() - silenceSince > 850) {
          setUserSpeaking(false);
          recorder.stop();
        }
      }
    }, 80);
  }, [ensureMicrophone, getInputVolume, setUserSpeaking, stopRecorder, submitVoiceTurn, transition]);

  const startBrowserFallback = useCallback(async () => {
    const SpeechRecognitionClass = (window as typeof window & {
      SpeechRecognition?: new () => BrowserSpeechRecognition;
      webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
    }).SpeechRecognition || (window as typeof window & {
      webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
    }).webkitSpeechRecognition;

    if (!SpeechRecognitionClass) {
      throw new Error('Browser speech recognition is unavailable here. Select Deepgram or Whisper in Voice Agent settings.');
    }
    const recognition = new SpeechRecognitionClass();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = conversationLanguageRef.current || navigator.language || 'en-IN';
    recognitionRef.current = recognition;
    transportModeRef.current = "browser";
    recognition.onspeechstart = () => {
      const now = Date.now();
      const current = stateRef.current;
      providerSpeechStartedAtRef.current = now;
      providerSpeechPeakRef.current = getInputVolume();
      setUserSpeaking(true);
      const playbackReady = current !== "speaking"
        || !playbackStartedAtRef.current
        || now - playbackStartedAtRef.current >= 70;
      if (["thinking", "processing"].includes(current) && playbackReady) {
        interruptForSpeech();
        providerSpeechStartedAtRef.current = now;
      }
    };
    recognition.onresult = (event) => {
      let interim = "";
      const newFinals: string[] = [];
      const newConfidences: number[] = [];
      const resultIndex = Math.max(0, event.resultIndex || 0);
      for (let index = resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const alternative = result[0];
        const recentContext = historyRef.current.slice(-4).map((message) => message.content).join(" ");
        const transcript = normalizeVoiceTranscript(alternative?.transcript || "", recentContext);
        if (!transcript) continue;
        if (result.isFinal) {
          newFinals.push(transcript);
          if (typeof alternative.confidence === "number") newConfidences.push(alternative.confidence);
        } else interim += `${transcript} `;
      }
      let visible = [...finalSegmentsRef.current, ...newFinals, interim.trim()].filter(Boolean).join(" ");
      if (visible) setUserSpeaking(true);
      if (visible && isVoiceExitCommand(visible)) {
        finalSegmentsRef.current = [];
        confidenceRef.current = [];
        setPartialTranscript("");
        setUserSpeaking(false);
        closeVisualizerRef.current();
        return;
      }
      if (visible && isVoiceStopCommand(visible)) {
        if (["speaking", "thinking", "processing"].includes(stateRef.current)) interruptForSpeech();
        finalSegmentsRef.current = [];
        confidenceRef.current = [];
        setPartialTranscript("");
        setUserSpeaking(false);
        return;
      }
      if (visible && ["speaking", "thinking", "processing"].includes(stateRef.current)) {
        if (stateRef.current === "speaking" && isLikelyPlaybackEcho(visible, previousSpeechTextRef.current)) return;
        // Browser SpeechRecognition only reports after it has already heard speech.
        if (!providerSpeechStartedAtRef.current) providerSpeechStartedAtRef.current = Date.now() - 400;
        providerSpeechPeakRef.current = Math.max(providerSpeechPeakRef.current, getInputVolume());
        const confidence = newConfidences.length
          ? newConfidences.reduce((sum, value) => sum + value, 0) / newConfidences.length
          : undefined;
        if (!isCredibleBargeIn(visible, confidence, newFinals.length > 0)) return;
        interruptForSpeech();
        setUserSpeaking(true);
      }
      for (const transcript of newFinals) {
        if (finalSegmentsRef.current.at(-1) !== transcript) finalSegmentsRef.current.push(transcript);
      }
      confidenceRef.current.push(...newConfidences);
      visible = [...finalSegmentsRef.current, interim.trim()].filter(Boolean).join(" ");
      setPartialTranscript(visible);
      if (newFinals.length) scheduleEndpoint(visible, modeRef.current === "push" && pttReleasePendingRef.current);
    };
    recognition.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setErrorMessage("Microphone permission needed");
        transition("error");
      }
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      if (!showVisualizerRef.current || mutedRef.current || intentionalTransportStopRef.current) return;
      if (modeRef.current === "auto") {
        reconnectTimerRef.current = setTimeout(() => void startTransportRef.current(), 220);
      }
    };
    recognition.start();
  }, [getInputVolume, interruptForSpeech, isCredibleBargeIn, scheduleEndpoint, setUserSpeaking, startUploadFallback, transition]);

  const startDeepgram = useCallback(async () => {
    const stream = await ensureMicrophone();
    const { data: { session: transcriptionSession } } = await supabase.auth.getSession();
    const tokenResponse = await fetch("/api/transcribe", { cache: "no-store",
      headers: transcriptionSession?.access_token ? { 'x-void-user-token': transcriptionSession.access_token } : {} });
    const tokenData = await tokenResponse.json() as { token?: string; error?: string };
    if (!tokenResponse.ok) throw new Error(tokenData.error || `Live transcription returned ${tokenResponse.status}`);
    if (!tokenData.token) throw new Error("Live transcription connection missing");
    if (!showVisualizerRef.current || voiceStartupRef.current?.signal.aborted) return;

    const params = new URLSearchParams({
      model: "nova-3",
      language: deepgramSpeechLanguage('auto', conversationLanguageRef.current),
      punctuate: "true",
      smart_format: "true",
      interim_results: "true",
      vad_events: "true",
      endpointing: "300",
      utterance_end_ms: "1000",
    });
    VOICE_KEYTERMS.forEach((keyterm) => params.append("keyterm", keyterm));
    const liveUrl = new URL("wss://api.deepgram.com/v1/listen");
    params.forEach((value, key) => liveUrl.searchParams.append(key, value));
    const socket = new WebSocket(liveUrl, ["bearer", tokenData.token]);
    socket.binaryType = "arraybuffer";
    socketRef.current = socket;
    transportModeRef.current = "deepgram";

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Live transcription connection timed out")), 7000);
      socket.onopen = () => {
        clearTimeout(timeout);
        reconnectAttemptsRef.current = 0;
        intentionalTransportStopRef.current = false;
        try {
          stopRecorder();
          const recorder = createAndStartRecorder(
            stream,
            180,
            (event) => {
              if (event.data.size && socket.readyState === WebSocket.OPEN) socket.send(event.data);
              if (pttReleasePendingRef.current && socket.readyState === WebSocket.OPEN) {
                pttReleasePendingRef.current = false;
                socket.send(JSON.stringify({ type: "Finalize" }));
              }
            }
          );
          recorderRef.current = recorder;
          transition("listening");
          resolve();
        } catch (recorderError) {
          console.warn("Could not start MediaRecorder for live transcription:", recorderError);
          deepgramUnavailableRef.current = true;
          try { socket.close(); } catch {}
          reject(recorderError instanceof Error ? recorderError : new Error("MediaRecorder failed to start"));
        }
      };
      socket.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("Live transcription socket failed"));
      };
      socket.onmessage = (event) => {
        try { handleDeepgramMessage(JSON.parse(String(event.data))); } catch (error) {
          console.warn("Ignored malformed transcription event:", error);
        }
      };
      socket.onclose = () => {
        clearTimeout(timeout);
        if (socketRef.current === socket) socketRef.current = null;
        stopRecorder();
        if (intentionalTransportStopRef.current || !showVisualizerRef.current || mutedRef.current || modeRef.current === "push") return;
        reconnectAttemptsRef.current += 1;
        if (reconnectAttemptsRef.current <= 2) {
          transition("reconnecting");
          reconnectTimerRef.current = setTimeout(() => void startTransportRef.current(), 350 * 2 ** (reconnectAttemptsRef.current - 1));
        } else {
          micStreamRef.current?.getTracks().forEach(track => track.stop());
          setErrorMessage('Deepgram disconnected. Restart voice or choose another transcription provider.'); transition('error');
        }
      };
    });
  }, [ensureMicrophone, handleDeepgramMessage, stopRecorder, transition]);

  const startTransport = useCallback(async () => {
    if (!showVisualizerRef.current || mutedRef.current || voiceConfigRef.current.mode === 'native') return;
    if (socketRef.current?.readyState === WebSocket.OPEN || recognitionRef.current || recorderRef.current?.state === "recording") {
      transition("listening");
      return;
    }
    intentionalTransportStopRef.current = false;
    try {
      if (voiceConfigRef.current.sttProvider === 'browser') await startBrowserFallback();
      else if (voiceConfigRef.current.sttProvider === 'deepgram') await startDeepgram();
      else await startUploadFallback();
    } catch (error) {
      stopRecorder();
      deepgramUnavailableRef.current = true;
      const failedSocket = socketRef.current;
      socketRef.current = null;
      if (failedSocket) {
        failedSocket.onclose = null;
        try { failedSocket.close(); } catch {}
      }
      micStreamRef.current?.getTracks().forEach(track => track.stop());
      setErrorMessage(error instanceof Error ? error.message : 'Your selected transcription provider is unavailable.');
      transition('error');
    }
  }, [startBrowserFallback, startDeepgram, startUploadFallback, stopRecorder, transition]);

  useEffect(() => {
    startTransportRef.current = startTransport;
  }, [startTransport]);

  const resumeListening = useCallback(() => {
    if (nativeVoiceRef.current) { transition(mutedRef.current ? 'idle' : 'listening'); return; }
    if (!showVisualizerRef.current || mutedRef.current) {
      transition("idle");
      return;
    }
    setErrorMessage(null);
    if (modeRef.current === "push") {
      transition("idle");
      return;
    }
    transition("listening");
    const transport = transportModeRef.current;
    const active = transport === "deepgram" && socketRef.current?.readyState === WebSocket.OPEN
      || transport === "browser" && Boolean(recognitionRef.current)
      || transport === "upload" && recorderRef.current?.state === "recording";
    if (!active) void startTransportRef.current();
  }, [transition]);

  useEffect(() => {
    resumeListeningRef.current = resumeListening;
  }, [resumeListening]);

  const startSession = useCallback(async () => {
    cancelActiveTurn(true); stopTransport(true);
    nativeVoiceRef.current?.stop(); nativeVoiceRef.current = null;
    globalActiveInstanceId = instanceId;
    setShowVisualizer(true);
    showVisualizerRef.current = true;
    setErrorMessage(null);
    deepgramUnavailableRef.current = false;
    transition("reconnecting");
    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorMessage("Microphone unavailable");
      transition("error");
      return false;
    }
    mutedRef.current = false;
    setMuted(false);
    voiceStartupRef.current?.abort();
    const startup = new AbortController(); voiceStartupRef.current = startup;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch('/api/voice/session', { method: 'POST', headers: { 'x-void-user-token': session?.access_token || '' }, signal: startup.signal });
      const settings = await response.json();
      if (!response.ok) throw new Error(settings.error || 'Could not start your BYOK voice session.');
      if (startup.signal.aborted || !showVisualizerRef.current) return false;
      voiceConfigRef.current = settings.config;
      // Initialize browser speech only for the explicitly selected browser voice.
      window.speechSynthesis?.resume();
      window.speechSynthesis?.getVoices();
      const audioContext = await ensureAudioContext();
      playVoiceTransitionSound(audioContext, "enter");
      const microphone = await ensureMicrophone();
      if (startup.signal.aborted || !showVisualizerRef.current) { microphone.getTracks().forEach(track => track.stop()); return false; }
      if (settings.config.mode === 'native') {
        nativeVoiceRef.current = await startNativeVoice(settings as NativeSession, microphone, audioContext, startup.signal, {
          state: next => { if (next === 'speaking' && stateRef.current !== 'speaking') onAudioStart?.(''); if (next === 'listening' && stateRef.current === 'speaking') onAudioEnd?.(); transition(next); },
          user: text => { setPartialTranscript(''); onTranscript?.(text); },
          assistant: (text, complete) => onResponseUpdate?.(text, complete, { modelName: settings.config.nativeModel }),
          turn: (userText, assistantText) => { if (!onResponseUpdate) onTurnComplete?.(userText, assistantText); recordUsage(); },
          error: message => { micStreamRef.current?.getTracks().forEach(track => track.stop()); setErrorMessage(message); transition('error'); },
        });
        return true;
      }
      transition(interactionMode === "auto" ? "reconnecting" : "idle");
      if (interactionMode === "auto") await startTransportRef.current();
      return stateRef.current !== 'error';
    } catch (error) {
      if (startup.signal.aborted) return false;
      micStreamRef.current?.getTracks().forEach(track => track.stop());
      setErrorMessage(error instanceof Error ? error.message : 'Could not start voice. Check microphone access and Voice Agent settings.');
      transition("error");
      return false;
    }
  }, [cancelActiveTurn, stopTransport, ensureAudioContext, ensureMicrophone, instanceId, interactionMode, transition, onTranscript, onResponseUpdate, onTurnComplete, onAudioStart, onAudioEnd, recordUsage]);

  const closeVisualizer = useCallback(() => {
    voiceStartupRef.current?.abort(); voiceStartupRef.current = null;
    nativeVoiceRef.current?.stop(); nativeVoiceRef.current = null;
    const wasOpen = showVisualizerRef.current;
    cancelActiveTurn(true);
    stopTransport(true);
    if (bargeInTimerRef.current) clearInterval(bargeInTimerRef.current);
    bargeInTimerRef.current = null;
    try { micSourceRef.current?.disconnect(); } catch {}
    micSourceRef.current = null;
    inputAnalyserRef.current = null;
    micStreamRef.current?.getTracks().forEach((track) => track.stop());
    micStreamRef.current = null;
    setPartialTranscript("");
    setErrorMessage(null);
    setShowVisualizer(false);
    showVisualizerRef.current = false;
    transition("idle");
    if (globalActiveInstanceId === instanceId) globalActiveInstanceId = null;
    if (wasOpen && mountedRef.current) {
      void ensureAudioContext()
        .then((context) => playVoiceTransitionSound(context, "exit"))
        .catch(() => {});
    }
  }, [cancelActiveTurn, ensureAudioContext, instanceId, stopTransport, transition]);

  useEffect(() => {
    closeVisualizerRef.current = closeVisualizer;
  }, [closeVisualizer]);

  useEffect(() => {
    if (active && !showVisualizerRef.current) {
      void startSession();
    } else if (active === false && showVisualizerRef.current) {
      closeVisualizer();
    }
  }, [active, startSession, closeVisualizer]);

  const toggleMute = useCallback(() => {
    if (nativeVoiceRef.current) {
      if (stateRef.current === 'speaking' || stateRef.current === 'thinking') { nativeVoiceRef.current.interrupt(); return; }
      const next = !mutedRef.current; mutedRef.current = next; setMuted(next);
      micStreamRef.current?.getAudioTracks().forEach(track => { track.enabled = !next; }); transition(next ? 'idle' : 'listening'); return;
    }
    if (stateRef.current === "speaking" || stateRef.current === "thinking" || stateRef.current === "processing") {
      interruptForSpeech();
      return;
    }
    const nextMuted = !mutedRef.current;
    mutedRef.current = nextMuted;
    setMuted(nextMuted);
    micStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !nextMuted; });
    if (nextMuted) {
      stopTransport(true);
      transition("idle");
    } else {
      transition("reconnecting");
      void startTransportRef.current();
    }
  }, [interruptForSpeech, stopTransport, transition]);

  const startPushToTalk = useCallback(() => {
    if (modeRef.current !== "push" || !showVisualizerRef.current) return;
    pttReleasePendingRef.current = false;
    finalSegmentsRef.current = [];
    confidenceRef.current = [];
    cancelActiveTurn(true);
    transition("listening");
    void startTransportRef.current();
  }, [cancelActiveTurn, transition]);

  const finishPushToTalk = useCallback(() => {
    if (modeRef.current !== "push") return;
    pttReleasePendingRef.current = true;
    const transport = transportModeRef.current;
    if (transport === "deepgram") {
      try { recorderRef.current?.requestData(); } catch {}
      setTimeout(() => {
        if (socketRef.current?.readyState === WebSocket.OPEN && pttReleasePendingRef.current) {
          pttReleasePendingRef.current = false;
          socketRef.current.send(JSON.stringify({ type: "Finalize" }));
        }
      }, 100);
    } else if (transport === "browser") {
      try { recognitionRef.current?.stop(); } catch {}
      scheduleEndpoint(finalSegmentsRef.current.join(" "), true);
    } else if (transport === "upload" && recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
  }, [scheduleEndpoint]);

  useEffect(() => {
    startPushToTalkRef.current = startPushToTalk;
    finishPushToTalkRef.current = finishPushToTalk;
  }, [finishPushToTalk, startPushToTalk]);

  useEffect(() => {
    modeRef.current = interactionMode;
  }, [interactionMode]);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    if (!showVisualizer) return;
    bargeInTimerRef.current = setInterval(() => {
      if (voiceConfigRef.current.mode === 'native') return; // Realtime providers handle acoustic VAD and interruptions.
      const inputLevel = getInputVolume();
      const current = stateRef.current;
      if (["idle", "listening", "reconnecting"].includes(current) && inputLevel < 0.22) {
        const rate = inputLevel > noiseFloorRef.current ? 0.018 : 0.055;
        noiseFloorRef.current += (Math.max(0.015, inputLevel) - noiseFloorRef.current) * rate;
      }
      if (["speaking", "thinking", "processing"].includes(current) && providerSpeechStartedAtRef.current) {
        providerSpeechPeakRef.current = Math.max(providerSpeechPeakRef.current, inputLevel);
      }
      if (["speaking", "thinking", "processing"].includes(current) && transportModeRef.current === "upload") {
        const outputLevel = current === "speaking" ? getOutputVolume() : 0;
        const threshold = Math.max(
          0.045,
          noiseFloorRef.current * 1.35 + 0.006,
          Math.min(0.09, 0.026 + outputLevel * 0.035),
        );
        if (inputLevel >= threshold) {
          if (!fallbackBargeInStartedAtRef.current) fallbackBargeInStartedAtRef.current = Date.now();
          const playbackIsReady = current !== "speaking"
            || !playbackStartedAtRef.current
            || Date.now() - playbackStartedAtRef.current >= 70;
          if (playbackIsReady && Date.now() - fallbackBargeInStartedAtRef.current >= 70) {
            fallbackBargeInStartedAtRef.current = 0;
            interruptForSpeech();
            setUserSpeaking(true);
            void startTransportRef.current();
          }
        } else {
          fallbackBargeInStartedAtRef.current = 0;
        }
      } else {
        fallbackBargeInStartedAtRef.current = 0;
      }
      if (isUserSpeakingRef.current && current === "listening") {
        if (Date.now() - lastSpeechDetectedAtRef.current > 850 && inputLevel < Math.max(0.10, noiseFloorRef.current * 2.2)) {
          setUserSpeaking(false);
        }
      }
    }, 60);
    return () => {
      if (bargeInTimerRef.current) clearInterval(bargeInTimerRef.current);
      bargeInTimerRef.current = null;
    };
  }, [getInputVolume, getOutputVolume, interruptForSpeech, setUserSpeaking, showVisualizer]);

  useEffect(() => {
    const stopAll = () => {
      if (globalActiveInstanceId === instanceId) closeVisualizerRef.current();
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.code !== "ControlRight" || event.repeat || modeRef.current !== "push") return;
      if (globalActiveInstanceId !== null && globalActiveInstanceId !== instanceId) return;
      if (!showVisualizerRef.current) void startSession().then((started) => {
        if (started) startPushToTalkRef.current();
      });
      else startPushToTalkRef.current();
    };
    const keyUp = (event: KeyboardEvent) => {
      if (event.code === "ControlRight") finishPushToTalkRef.current();
    };
    window.addEventListener("STOP_ALL_VOICE_AGENTS", stopAll as EventListener);
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    return () => {
      window.removeEventListener("STOP_ALL_VOICE_AGENTS", stopAll as EventListener);
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
    };
  }, [instanceId, startSession]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      closeVisualizerRef.current();
      audioContextRef.current?.close().catch(() => {});
    };
  }, []);

  const openVoiceMode = () => {
    if (globalActiveInstanceId !== null && globalActiveInstanceId !== instanceId) {
      window.dispatchEvent(new CustomEvent("STOP_ALL_VOICE_AGENTS"));
    }
    void startSession();
  };

  const primaryLabel = interactionMode === "push"
    ? "Hold to talk"
    : state === "speaking" || state === "thinking" || state === "processing"
      ? "Interrupt"
      : muted
        ? "Unmute microphone"
        : "Mute microphone";

  const statusLabel = muted ? "Muted" : interactionMode === "push" && state === "idle" ? "Hold to talk" : STATUS_LABEL[state];

  return (
    <>
      {showVisualizer && errorMessage && <p role="status" className="fixed right-4 top-4 z-[70] max-w-[min(300px,calc(100vw-2rem))] rounded-xl border border-gray-200 bg-white px-4 py-3 text-xs leading-relaxed text-gray-600 shadow-lg dark:border-white/10 dark:bg-[#202020] dark:text-gray-300">{errorMessage}</p>}
      <div className="relative flex items-center">
        <button
          type="button"
          onClick={state === 'error' ? openVoiceMode : showVisualizer ? toggleMute : openVoiceMode}
          className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-black/10 bg-white text-black shadow-none hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500/50"
          title={state === 'error' ? 'Retry voice connection' : !showVisualizer ? "Start Void voice" : primaryLabel}
          aria-label={state === 'error' ? 'Retry voice connection' : !showVisualizer ? "Start Void voice" : primaryLabel}
        >
          {showVisualizer && muted ? (
            <MicOff className="h-5 w-5" />
          ) : (
            <VoiceWaveIcon />
          )}
        </button>
      </div>

      <AnimatePresence>
        {showVisualizer && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.28, ease: "easeOut" }}
            style={{
              bottom: `calc(100% + ${VOICE_ORB_CONFIG.spacingAboveTextarea}px)`,
              width: VOICE_ORB_CONFIG.size,
              height: VOICE_ORB_CONFIG.size,
            }}
            className="pointer-events-auto absolute left-1/2 -translate-x-1/2 z-30 flex items-center justify-center select-none"
          >
            <motion.button
              type="button"
              whileHover={{ scale: 1.06 }}
              whileTap={{ scale: 0.94 }}
              onClick={closeVisualizer}
              className="pointer-events-auto relative flex h-full w-full cursor-pointer items-center justify-center border-0 bg-transparent p-0 focus-visible:outline-none focus-visible:opacity-80"
              title="Click to stop voice mode"
              aria-label="Stop Void voice"
            >
              <VoidVisualizer
                size={VOICE_ORB_CONFIG.size}
                agentState={visualAgentState}
                getInputVolume={getInputVolume}
                getOutputVolume={getOutputVolume}
                className="h-full w-full"
              />
            </motion.button>
            <span
              className="sr-only"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {errorMessage || statusLabel}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
