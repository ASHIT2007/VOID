import { GoogleGenAI } from "npm:@google/genai@2.3.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MULTIMODAL_MODEL = "gemini-2.0-flash";
const TEXT_MODEL = "gemini-2.0-flash";
const INLINE_MAX_BYTES = 8 * 1024 * 1024;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function inferMimeType(fileName?: string, mimeType?: string): string {
  if (mimeType && mimeType !== "application/octet-stream") return mimeType;
  const ext = fileName?.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    avi: "video/x-msvideo",
    mkv: "video/x-matroska",
    pdf: "application/pdf",
  };
  return (ext && map[ext]) || "application/octet-stream";
}

function isVideoMime(mime: string): boolean {
  return mime.startsWith("video/");
}

async function loadFileBytes(
  fileBase64?: string | null,
  fileUrl?: string | null,
): Promise<Uint8Array | null> {
  if (fileBase64) {
    const binary = atob(fileBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  if (fileUrl) {
    const cleanUrl = fileUrl.split("?")[0];
    const res = await fetch(fileUrl);
    if (!res.ok) {
      const fallback = await fetch(cleanUrl);
      if (!fallback.ok) {
        throw new Error(
          `Could not download the uploaded file (${res.status}). Check storage bucket permissions.`,
        );
      }
      return new Uint8Array(await fallback.arrayBuffer());
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  return null;
}

async function waitForFileActive(
  ai: GoogleGenAI,
  name: string,
): Promise<{ uri: string; mimeType?: string }> {
  const maxAttempts = 30;
  for (let i = 0; i < maxAttempts; i++) {
    const info = await ai.files.get({ name });
    if (info.state === "ACTIVE") {
      return { uri: info.uri!, mimeType: info.mimeType };
    }
    if (info.state === "FAILED") {
      throw new Error("Gemini could not process this video file.");
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Timed out while processing the video. Try a shorter clip.");
}

async function buildMediaPart(
  ai: GoogleGenAI,
  opts: {
    fileBase64?: string | null;
    fileUrl?: string | null;
    mimeType?: string;
    fileName?: string;
  },
) {
  const bytes = await loadFileBytes(opts.fileBase64, opts.fileUrl);
  if (!bytes || bytes.length === 0) return null;

  const mimeType = inferMimeType(opts.fileName, opts.mimeType);
  const useFileApi = isVideoMime(mimeType) || bytes.length > INLINE_MAX_BYTES;

  if (useFileApi) {
    const blob = new Blob([bytes], { type: mimeType });
    const file = new File([blob], opts.fileName || "attachment", {
      type: mimeType,
    });
    const uploaded = await ai.files.upload({
      file,
      config: { mimeType },
    });
    const active = await waitForFileActive(ai, uploaded.name!);
    return {
      fileData: {
        fileUri: active.uri,
        mimeType: active.mimeType || mimeType,
      },
    };
  }

  return {
    inlineData: {
      data: bytesToBase64(bytes),
      mimeType,
    },
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not set in the Edge Function environment.");
    }

    const body = await req.json();
    const {
      messages,
      fileUrl,
      mimeType,
      fileBase64,
      fileName,
    } = body;

    if (!messages || !Array.isArray(messages)) {
      return new Response(
        JSON.stringify({ error: "Invalid request. Expected 'messages' array." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const ai = new GoogleGenAI({ apiKey });

    let validMessages = messages;
    const firstUserIndex = messages.findIndex((m: { role: string }) =>
      m.role === "user"
    );
    if (firstUserIndex !== -1) {
      validMessages = messages.slice(firstUserIndex);
    }

    const formattedMessages = validMessages.map((m: { role: string; content: string }) => ({
      role: m.role === "assistant" ? "model" : m.role,
      parts: [{ text: m.content || "" }],
    }));

    const hasAttachment = Boolean(fileBase64 || fileUrl);
    if (hasAttachment) {
      const lastIdx = formattedMessages.length - 1;
      if (lastIdx >= 0 && formattedMessages[lastIdx].role === "user") {
        const mediaPart = await buildMediaPart(ai, {
          fileBase64,
          fileUrl,
          mimeType,
          fileName,
        });

        if (mediaPart) {
          const parts = formattedMessages[lastIdx].parts;
          const userText = (parts[0]?.text || "").trim();
          if (!userText || userText.startsWith("[Attached:")) {
            parts[0] = {
              text:
                "Analyze this attachment in detail. If it is a video, summarize what happens scene by scene. If it is an image, describe everything you see.",
            };
          }
          formattedMessages[lastIdx].parts = [...parts, mediaPart];
        }
      }
    }

    const response = await ai.models.generateContent({
      model: hasAttachment ? MULTIMODAL_MODEL : TEXT_MODEL,
      contents: formattedMessages,
    });

    const text =
      response.text ??
      response.candidates?.[0]?.content?.parts
        ?.map((p: { text?: string }) => p.text)
        .filter(Boolean)
        .join("\n") ??
      "I could not generate a response for this attachment.";

    return new Response(JSON.stringify({ content: text }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Function error:", error);
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
