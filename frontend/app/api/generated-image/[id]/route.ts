import { NextResponse } from "next/server";
import { readGeneratedImage, storeGeneratedImage, MAX_STORED_IMAGE_BYTES } from "@/lib/generated-image-store";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const image = await readGeneratedImage(id);
    return new Response(new Uint8Array(image.bytes), {
      headers: {
        "Content-Type": image.mimeType,
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Length": String(image.bytes.length),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Generated image not found" }, { status: 404 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const dataUrl = typeof body?.dataUrl === "string" ? body.dataUrl : "";
    if (dataUrl.length > Math.ceil(MAX_STORED_IMAGE_BYTES * 1.4)) {
      return NextResponse.json({ error: "Image is too large" }, { status: 413 });
    }
    const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/=]+)$/i);
    if (!match) return NextResponse.json({ error: "A valid image data URL is required" }, { status: 400 });
    const stored = await storeGeneratedImage(Buffer.from(match[2], "base64"), match[1]);
    return NextResponse.json({ url: `/api/generated-image/${stored.id}` });
  } catch {
    return NextResponse.json({ error: "Could not store generated image" }, { status: 500 });
  }
}
