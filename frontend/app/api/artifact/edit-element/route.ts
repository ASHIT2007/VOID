import { NextRequest, NextResponse } from "next/server";

type EditableKind = "title" | "subtitle" | "body" | "bullet" | "image" | "label";

type Provider = {
  url: string;
  key?: string;
  model: string;
};

const ALLOWED_KINDS = new Set<EditableKind>(["title", "subtitle", "body", "bullet", "image", "label"]);

function clean(value: unknown, limit: number) {
  return typeof value === "string" ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, limit) : "";
}

function parseValue(raw: string): string | null {
  const candidates = [raw, raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/)?.[1]].filter(Boolean) as string[];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as { value?: unknown };
      const value = clean(parsed.value, 4000);
      if (value) return value;
    } catch {
      // Try the next safe JSON extraction.
    }
  }
  return null;
}

function localFallback(value: string, instruction: string, kind: EditableKind) {
  const command = instruction.toLowerCase();
  if (kind === "image") return `${value.replace(/[.\s]+$/, "")}. ${instruction.replace(/[.\s]+$/, "")}. Preserve the exact subject and context; no text or unrelated objects.`;
  if (/short|concise|one line/.test(command)) {
    const words = value.split(/\s+/);
    const limit = Math.max(6, Math.ceil(words.length * 0.62));
    return `${words.slice(0, limit).join(" ").replace(/[,;:]$/, "")}${words.length > limit ? "…" : ""}`;
  }
  if (/punch|strong|active/.test(command)) return value.replace(/\b(very|really|quite|just|actually|basically)\b\s*/gi, "").replace(/\s{2,}/g, " ").trim();
  if (/clear|simple|plain/.test(command)) return value.replace(/\s*[;—]\s*/g, ". ").replace(/\s{2,}/g, " ").trim();
  return value;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const instruction = clean(body.instruction, 500);
    const value = clean(body.value, 4000);
    const kind = clean(body.kind, 30) as EditableKind;
    const context = typeof body.context === "object" && body.context ? body.context : {};
    if (!instruction || !value || !ALLOWED_KINDS.has(kind)) return NextResponse.json({ error: "Invalid scoped edit" }, { status: 400 });

    const providers: Provider[] = [
      { url: "https://integrate.api.nvidia.com/v1/chat/completions", key: process.env.NVIDIA_API_KEY, model: "meta/llama-3.1-70b-instruct" },
      { url: "https://api.groq.com/openai/v1/chat/completions", key: process.env.GROQ_API_KEY, model: "llama-3.3-70b-versatile" },
      { url: process.env.FREELLM_API_URL || "http://127.0.0.1:3001/v1/chat/completions", key: process.env.FREELLM_API_KEY, model: "openai/gpt-oss-20b" },
    ].filter((provider) => Boolean(provider.key));

    const system = `You edit exactly one addressable element in a visual document. Return only JSON: {"value":"edited value"}. Obey the instruction without changing facts, adding claims, or referring to any other element. Preserve names, numbers, citations, and meaning unless the instruction explicitly targets them. Keep the result appropriate for a ${kind}.`;
    const user = JSON.stringify({ instruction, currentValue: value, readOnlyDocumentContext: context });

    for (const provider of providers) {
      try {
        const response = await fetch(provider.url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.key}` },
          body: JSON.stringify({ model: provider.model, messages: [{ role: "system", content: system }, { role: "user", content: user }], temperature: 0.2, max_tokens: 700 }),
          signal: AbortSignal.timeout(18_000),
        });
        if (!response.ok) continue;
        const result = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
        const edited = parseValue(result.choices?.[0]?.message?.content || "");
        if (edited) return NextResponse.json({ value: edited, mode: "model" }, { headers: { "Cache-Control": "no-store" } });
      } catch {
        // Keep the original safe and try another configured provider.
      }
    }

    return NextResponse.json({ value: localFallback(value, instruction, kind), mode: "local" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Unable to edit element" }, { status: 500 });
  }
}

