"use client";

import React, { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

export type TaskBucket = "text-gen" | "web-search" | "image-gen";

type ProgressLog = { action?: string; query?: string };

export interface DynamicLoaderProps {
  stage?: string;
  webSearchEnabled?: boolean;
  isGeneratingImage?: boolean;
  prompt?: string;
  customGerund?: string;
  statusLogs?: ProgressLog[];
  sources?: unknown[];
}

const STALL_AFTER_MS = 18_000;

function stageLabel(stage: string, log?: ProgressLog, isGeneratingImage = false): string {
  if (isGeneratingImage || stage === "painting") return "Creating your image";

  const action = `${log?.action || ""} ${log?.query || ""}`.toLowerCase();
  if (action.includes("synthesiz") || action.includes("writing") || action.includes("finalizing")) return "Writing the response";
  if (action.includes("fact check") || action.includes("verif")) return "Checking the details";
  if (action.includes("reading source") || action.includes("web_fetch")) return "Reading the strongest sources";
  if (action.includes("web_search") || action.includes("searching web") || action.includes("news_search")) return "Searching the web";
  if (action.includes("image") && action.includes("search")) return "Finding relevant images";
  if (action.includes("image") && action.includes("verif")) return "Checking image relevance";
  if (action.includes("image") && action.includes("planning")) return "Choosing relevant images";
  if (action.includes("planning") || /agents? assigned/.test(action)) return "Planning the work";
  if (action.includes("researcher") || action.includes("research")) return "Researching sources";
  if (action.includes("analyst")) return "Reviewing the request";
  if (action.includes("reasoning")) return "Understanding your request";
  if (action.includes("tool")) return "Working with the available tools";
  if (stage === "searching" || action.includes("search")) return "Searching the web";
  if (stage === "generating") return "Writing the response";
  return "Working on it";
}

export function ProgressMark() {
  const orbitPaths = [
    { x: [0, 0, 4.4, -4.4, 0, 0], y: [0, -5, 2.5, 2.5, -5, 0] },
    { x: [0, 4.4, -4.4, 0, 4.4, 0], y: [0, 2.5, 2.5, -5, 2.5, 0] },
    { x: [0, -4.4, 0, 4.4, -4.4, 0], y: [0, 2.5, -5, 2.5, 2.5, 0] },
  ];

  return (
    <span
      className="relative flex h-4 w-4 shrink-0 items-center justify-center"
      aria-hidden="true"
    >
      {orbitPaths.map((path, index) => (
        <motion.span
          key={index}
          className="absolute h-1.5 w-1.5 rounded-full bg-gray-900 dark:bg-white"
          style={{ left: "50%", top: "50%", marginLeft: "-3px", marginTop: "-3px" }}
          animate={{ x: path.x, y: path.y, scale: [0.74, 1, 1, 1, 1, 0.74] }}
          transition={{ duration: 2.55, repeat: Infinity, ease: "easeInOut", times: [0, 0.18, 0.4, 0.62, 0.82, 1] }}
        />
      ))}
    </span>
  );
}

function logSignature(logs?: ProgressLog[]): string {
  const latest = logs && logs.length > 0 ? logs[logs.length - 1] : undefined;
  return `${latest?.action || ""}|${latest?.query || ""}`;
}

function DelayAwareLabel({ label }: { label: string }) {
  const [isStalled, setIsStalled] = useState(false);

  useEffect(() => {
    setIsStalled(false);
    const timer = window.setTimeout(() => {
      setIsStalled(true);
    }, STALL_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [label]);

  const currentLabel = isStalled
    ? "Still working — this is taking a little longer than usual"
    : label;

  return (
    <>
      <span className="sr-only" aria-live="polite" aria-atomic="true">{currentLabel}</span>
      <div className="relative h-5 w-[min(20rem,calc(100vw-7rem))] overflow-hidden" aria-hidden="true">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={currentLabel}
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -3 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="absolute inset-x-0 whitespace-nowrap overflow-hidden text-ellipsis text-[15px] font-medium leading-5 text-gray-700 dark:text-gray-200"
          >
            {currentLabel}
          </motion.span>
        </AnimatePresence>
      </div>
    </>
  );
}

export function ImageGenerationLoader() {
  return (
    <div className="w-full py-3">
      <span className="block w-full max-w-lg mx-auto aspect-square md:aspect-video rounded-2xl bg-gray-200 dark:bg-[#2A2A2A] border border-gray-100 dark:border-[#333]" />
    </div>
  );
}

export function DynamicLoader({
  stage = "thinking",
  isGeneratingImage = false,
  customGerund,
  statusLogs,
}: DynamicLoaderProps) {
  const signature = logSignature(statusLogs);
  const lastLog = statusLogs && statusLogs.length > 0 ? statusLogs[statusLogs.length - 1] : undefined;
  const baseLabel = useMemo(
    () => customGerund?.trim() || stageLabel(stage, lastLog, isGeneratingImage),
    [customGerund, isGeneratingImage, lastLog, stage],
  );
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className="w-full mb-4 pl-1"
    >
      <div className="inline-flex max-w-full items-center gap-2.5 py-1">
        <ProgressMark />
        <DelayAwareLabel key={`${signature}|${stage}|${isGeneratingImage}`} label={baseLabel} />
      </div>
    </motion.div>
  );
}

export default DynamicLoader;
