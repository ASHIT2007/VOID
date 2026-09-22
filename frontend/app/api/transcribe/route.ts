import { NextRequest, NextResponse } from "next/server";
import { backendUrl, getBackendUrl } from "@/lib/backend";

export async function GET(req: NextRequest) {
  try {
    const response = await fetch(backendUrl("/api/transcribe"), {
      cache: "no-store",
      signal: req.signal,
    });

    const contentType = response.headers.get("content-type") || "application/json";
    if (response.ok && contentType.includes("application/json")) {
      const data = await response.json() as { proxy?: boolean; token?: string; expiresIn?: number };
      if (data.proxy) {
        const socketUrl = `${getBackendUrl().replace(/^http/i, "ws")}/api/voice-stream`;
        return NextResponse.json({ socketUrl }, { headers: { "Cache-Control": "no-store" } });
      }
      return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
    }

    return new NextResponse(response.body, {
      status: response.status,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
      },
    });
  } catch (error: unknown) {
    console.error("Live transcription token proxy error:", error);
    return NextResponse.json(
      { error: { message: error instanceof Error ? error.message : "Failed to start live transcription." } },
      { status: 502 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const response = await fetch(backendUrl("/api/transcribe"), {
      method: "POST",
      body: formData,
      signal: req.signal,
    });

    return new NextResponse(response.body, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("content-type") || "application/json",
      },
    });
  } catch (error: unknown) {
    console.error("Transcribe proxy error:", error);
    return NextResponse.json(
      { error: { message: error instanceof Error ? error.message : "Failed to reach backend transcription service." } },
      { status: 502 }
    );
  }
}
