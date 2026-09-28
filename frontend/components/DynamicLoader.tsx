"use client";

import React, { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { progressLabel, type ProgressLog } from "../lib/chat-progress";

export type TaskBucket = "text-gen" | "web-search" | "image-gen";

export interface DynamicLoaderProps {
  stage?: string;
  webSearchEnabled?: boolean;
  isGeneratingImage?: boolean;
  prompt?: string;
  customGerund?: string;
  statusLogs?: Partial<ProgressLog>[];
  sources?: unknown[];
}

const STALL_AFTER_MS = 18_000;

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

function logSignature(logs?: Partial<ProgressLog>[]): string {
  const latest = logs && logs.length > 0 ? logs[logs.length - 1] : undefined;
  return `${latest?.action || ""}|${latest?.query || ""}|${latest?.state || ""}`;
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
    ? `${label} (taking longer than usual)`
    : label;

  return (
    <>
      <span className="sr-only" aria-live="polite" aria-atomic="true">{currentLabel}</span>
      <div className="min-w-0 max-w-[min(34rem,calc(100vw-7rem))]" aria-hidden="true">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={currentLabel}
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -3 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="block whitespace-normal break-words text-[15px] font-medium leading-5 text-gray-700 dark:text-gray-200"
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
  prompt = "",
  customGerund,
  statusLogs,
}: DynamicLoaderProps) {
  const signature = logSignature(statusLogs);
  const baseLabel = useMemo(
    () => customGerund?.trim() || progressLabel({ stage, prompt, logs: statusLogs, isGeneratingImage }),
    [customGerund, isGeneratingImage, prompt, statusLogs, stage],
  );
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className="w-full mb-4 pl-1"
    >
      <div className="inline-flex max-w-full items-start gap-2.5 py-1">
        <ProgressMark />
        <DelayAwareLabel key={`${signature}|${stage}|${isGeneratingImage}`} label={baseLabel} />
      </div>
    </motion.div>
  );
}

export default DynamicLoader;
