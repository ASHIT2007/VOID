export type ResponsePhase = "thinking" | "generating";

export function responsePhaseForEvent(event: { type?: string; phase?: string }, current: ResponsePhase): ResponsePhase {
  if (event.type === "text") return "generating";
  if (event.type === "reset") return "thinking";
  if (event.type === "model_route") return "thinking";
  if (event.type === "phase" && (event.phase === "thinking" || event.phase === "generating")) return event.phase;
  return current;
}
