"use client";

import React from "react";
import { AgentState, Orb } from "./ui/orb";

const VOID_ORB_COLORS: [string, string] = ["#141414", "#e5e5e5"];

export type VoiceVisualState =
  | "idle"
  | "listening"
  | "processing"
  | "thinking"
  | "speaking"
  | "reconnecting"
  | "error";

interface VoidVisualizerProps {
  agentState: VoiceVisualState;
  getInputVolume?: () => number;
  getOutputVolume?: () => number;
  className?: string;
  size?: number;
  compact?: boolean;
}

export default function VoidVisualizer({
  agentState,
  getInputVolume,
  getOutputVolume,
  className = "",
  size,
  compact = false,
}: VoidVisualizerProps) {
  const mappedAgentState = React.useMemo<AgentState>(() => {
    if (agentState === "listening") return "listening";
    if (agentState === "speaking") return "talking";
    if (agentState === "processing" || agentState === "thinking") return "thinking";
    return null;
  }, [agentState]);

  const sizeStyle = size ? { width: size, height: size } : undefined;

  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden bg-transparent ${className}`}
      style={sizeStyle}
    >
      <div
        className={`relative aspect-square ${
          size
            ? "h-full w-full"
            : compact
              ? "w-14 h-14"
              : "w-[min(82vw,28rem)] sm:w-[min(68vw,32rem)]"
        }`}
      >
        <Orb
          agentState={mappedAgentState}
          // ElevenLabs' manual mode reads the supplied live volume getters.
          // Its auto mode is a synthetic demo animation rather than mic/TTS data.
          volumeMode="manual"
          getInputVolume={getInputVolume}
          getOutputVolume={getOutputVolume}
          colors={VOID_ORB_COLORS}
          seed={23}
          className="h-full w-full"
        />
      </div>
    </div>
  );
}
