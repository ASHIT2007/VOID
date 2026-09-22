import { NextRequest, NextResponse } from "next/server";
import { backendUrl } from "@/lib/backend";

export async function GET(req: NextRequest) {
  try {
    const response = await fetch(backendUrl("/api/tts"), {
      cache: "no-store",
      signal: req.signal,
    });
    return new NextResponse(response.body, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("content-type") || "application/json",
        "Cache-Control": response.headers.get("cache-control") || "no-store",
      },
    });
  } catch (error: unknown) {
    console.error("Voice list proxy error:", error);
    return NextResponse.json(
      { error: { message: error instanceof Error ? error.message : "Failed to load voices." } },
      { status: 502 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const response = await fetch(backendUrl("/api/tts"), {
      method: "POST",
      headers: { "Content-Type": req.headers.get("content-type") || "application/json" },
      body,
      signal: req.signal,
    });

    const headers = new Headers();
    const contentType = response.headers.get("content-type");
    const voiceText = response.headers.get("x-voice-text");
    const cacheControl = response.headers.get("cache-control");

    if (contentType) headers.set("Content-Type", contentType);
    if (voiceText) headers.set("X-Voice-Text", voiceText);
    if (cacheControl) headers.set("Cache-Control", cacheControl);

    return new NextResponse(response.body, {
      status: response.status,
      headers,
    });
  } catch (error: unknown) {
    console.error("TTS proxy error:", error);
    return NextResponse.json(
      { error: { message: error instanceof Error ? error.message : "Failed to reach backend TTS service." } },
      { status: 502 }
    );
  }
}
