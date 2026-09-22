"use client";

import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy, FileText } from "lucide-react";
import { useSmoothTypewriter, completePartialMarkdown } from "./ChatInterface.helpers";

const WRITING_TYPES: Record<string, string> = {
  poem: "Poem",
  poetry: "Poem",
  lyrics: "Lyrics",
  lyric: "Lyrics",
  song: "Lyrics",
  rap: "Rap Verse",
  story: "Story",
  speech: "Speech",
  essay: "Essay",
  email: "Email",
  message: "Message",
  caption: "Caption",
  "social-post": "Social Post",
  social: "Social Post",
  letter: "Letter",
  screenplay: "Script",
  script: "Script",
  announcement: "Announcement",
  proposal: "Proposal",
  writing: "Writing",
  prose: "Writing",
};

function normalizedWritingType(value?: string | null): string | null {
  if (!value) return null;
  const key = value.trim().toLowerCase().replace(/[\s_]+/g, "-");
  return WRITING_TYPES[key] || null;
}

export function normalizeWritingSpacing(content: string, label?: string | null): string {
  const normalized = content.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
  const writingType = normalizedWritingType(label) || inferWritingType(normalized);
  const lines = normalized.split("\n");
  const blankLines = lines.filter((line) => !line.trim()).length;
  const overSpaced = blankLines >= 3 && blankLines / Math.max(lines.length, 1) >= 0.28;
  if (!overSpaced || !["Lyrics", "Rap Verse"].includes(writingType || "")) {
    return normalized.replace(/\n{3,}/g, "\n\n");
  }

  const sectionLine = /^\s*(?:\[(?:verse|chorus|bridge|hook|intro|outro|pre-chorus)[^\]]*\]|(?:verse|chorus|bridge|hook|intro|outro|pre-chorus)\s*\d*\s*:?)\s*$/i;
  const compacted: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim()) {
      compacted.push(line);
      continue;
    }
    const next = lines.slice(index + 1).find((candidate) => candidate.trim());
    if (next && sectionLine.test(next) && compacted.at(-1)?.trim()) compacted.push("");
  }
  return compacted.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function inferWritingType(content: string, hint?: string | null): string | null {
  const hinted = normalizedWritingType(hint);
  if (hinted) return hinted;

  const text = content.trim();
  if (!text) return null;
  if (/^\s*(?:subject:|to:|from:)\s*.+/im.test(text) || /^\s*(?:dear|hello|hi)\s+[^\n,]+,/i.test(text)) return "Email";
  if (/^\s*\[(?:verse|chorus|bridge|hook|intro|outro|pre-chorus)[^\]]*\]/im.test(text)) return "Lyrics";
  if (/^\s*(?:verse|chorus|bridge|hook|intro|outro)\s*\d*\s*:?\s*$/im.test(text)) return "Lyrics";
  if (/^\s*(?:INT\.|EXT\.|FADE IN:)|^[A-Z][A-Z .'-]{2,24}:\s+/m.test(text)) return "Script";
  if (/^\s*(?:caption|announcement|proposal|message|speech|essay|story|poem|lyrics)\s*:/i.test(text)) {
    return normalizedWritingType(text.match(/^\s*([a-z-]+)/i)?.[1]) || "Writing";
  }
  return null;
}

export default function WritingBlock({
  label,
  content,
  isStreaming = false,
  revealEnabled = true,
  animatePlayback = isStreaming,
}: {
  label?: string;
  content: string;
  isStreaming?: boolean;
  revealEnabled?: boolean;
  animatePlayback?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const displayLabel = normalizedWritingType(label) || inferWritingType(content) || "Writing";

  const trimmed = normalizeWritingSpacing(content, displayLabel);
  const displayedContent = useSmoothTypewriter(trimmed, Boolean(isStreaming), revealEnabled, Boolean(animatePlayback));
  const isActivelyTyping = revealEnabled && (Boolean(isStreaming) || displayedContent.length < trimmed.length);
  const safeText = isActivelyTyping ? completePartialMarkdown(displayedContent) : displayedContent;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(trimmed);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch (error) {
      console.error("Could not copy writing block", error);
    }
  };

  return (
    <section className="group my-5 overflow-hidden rounded-xl border border-gray-200 bg-[#fcfcfb] transition-colors hover:border-gray-300 dark:border-[#373737] dark:bg-[#202020] dark:hover:border-[#4A4A4A]">
      <header className="flex min-h-11 items-center justify-between border-b border-gray-200 bg-[#f5f5f3] px-3.5 py-2 dark:border-[#373737] dark:bg-[#272727]">
        <span className="inline-flex min-w-0 items-center gap-2 text-xs font-semibold tracking-wide text-gray-600 dark:text-gray-300">
          <FileText size={14} aria-hidden="true" />
          <span className="truncate">{displayLabel}</span>
          {isActivelyTyping ? <span className="text-gray-400">Writing…</span> : null}
        </span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-[#353535] dark:hover:text-white"
          aria-label={copied ? "Copied" : `Copy ${displayLabel.toLowerCase()}`}
          title={copied ? "Copied" : "Copy"}
        >
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </header>

      <div className="select-text px-5 py-6 text-[15px] leading-7 text-gray-900 sm:px-7 sm:py-7 sm:text-[16px] dark:text-gray-100 relative">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            p: ({ children }) => <p className="mb-2.5 whitespace-pre-wrap last:mb-0">{children}</p>,
            h1: ({ children }) => <h2 className="mb-4 text-xl font-semibold tracking-tight">{children}</h2>,
            h2: ({ children }) => <h3 className="mb-3 mt-6 text-lg font-semibold tracking-tight first:mt-0">{children}</h3>,
            h3: ({ children }) => <h4 className="mb-2 mt-5 font-semibold first:mt-0">{children}</h4>,
            ul: ({ children }) => <ul className="mb-4 ml-5 list-disc space-y-1">{children}</ul>,
            ol: ({ children }) => <ol className="mb-4 ml-5 list-decimal space-y-1">{children}</ol>,
            blockquote: ({ children }) => <blockquote className="my-4 border-l-2 border-gray-300 pl-4 text-gray-700 dark:border-gray-600 dark:text-gray-300">{children}</blockquote>,
            code: ({ children }) => <code className="rounded bg-gray-200 px-1 py-0.5 font-mono text-[0.9em] dark:bg-[#333]">{children}</code>,
          }}
        >
          {safeText}
        </ReactMarkdown>
        {isActivelyTyping && (
          <span
            className="inline-block w-px h-[1.05em] ml-1 bg-current opacity-50 align-middle"
            aria-hidden="true"
          />
        )}
      </div>
    </section>
  );
}
