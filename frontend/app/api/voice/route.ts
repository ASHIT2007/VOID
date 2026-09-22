import { NextRequest, NextResponse } from "next/server";

// Helper to strip URLs from text to save tokens and prevent reading out loud
function stripUrls(text: string) {
  return text.replace(/(https?:\/\/[^\s]+)/g, "");
}

import { GoogleGenAI } from "@google/genai";

function createWavHeader() {
  const sampleRate = 24000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);

  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);

  function writeString(offset: number, string: string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 0xFFFFFFFF, true); // Unknown size
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, 0xFFFFFFFF, true); // Unknown data size

  return new Uint8Array(buffer);
}

// GET: Streaming Native Gemini Audio
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const aiText = searchParams.get("text");

  if (!aiText) {
    return NextResponse.json({ error: "Missing text" }, { status: 400 });
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Voice generation requires GEMINI_API_KEY or GOOGLE_API_KEY" }, { status: 503 });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    
    const responseStream = await ai.models.generateContentStream({
      model: "gemini-2.5-flash-preview-tts",
      contents: aiText,
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Fenrir" } } }
      }
    });

    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue(createWavHeader());
        try {
          for await (const chunk of responseStream) {
            if (chunk.candidates && chunk.candidates[0]?.content?.parts) {
              for (const part of chunk.candidates[0].content.parts) {
                if (part.inlineData && part.inlineData.data) {
                  const binaryString = atob(part.inlineData.data);
                  const len = binaryString.length;
                  const bytes = new Uint8Array(len);
                  for (let i = 0; i < len; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                  }
                  controller.enqueue(bytes);
                }
              }
            }
          }
        } catch (e) {
          console.error("Gemini stream error:", e);
        } finally {
          controller.close();
        }
      }
    });

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "audio/wav",
        "Cache-Control": "no-store",
        "Transfer-Encoding": "chunked"
      }
    });

  } catch (e) {
    console.error("Gemini Native TTS error:", e);
    return NextResponse.json({ error: "Native TTS network error" }, { status: 504 });
  }
}

// POST: Tavily RAG + Groq LLM Generation
export async function POST(req: NextRequest) {
  try {
    const { text } = await req.json();

    if (!text || !text.trim()) {
      return NextResponse.json({ error: "Missing text" }, { status: 400 });
    }

    let systemPrompt = "Your name is Void. You are a highly intelligent, concise, and helpful AI voice assistant. Keep responses SHORT (1-3 sentences max) since they will be spoken aloud. Be natural and conversational. Never read out raw URLs.";

    // ── Fast Edge Cache for Common Voice Queries ──
    const cleanText = text.trim().toLowerCase().replace(/[^\w\s]/g, "");
    const VOICE_CACHE: Record<string, string> = {
      "hi": "Hello! I am Void, your AI voice assistant. How can I help you today?",
      "hello": "Hello there! How can I assist you today?",
      "hey": "Hey! How can I help you today?",
      "who are you": "I am Void, your advanced AI voice assistant. I can help with research, questions, and problem solving.",
      "what can you do": "I can search the web, answer your questions, generate images, write code, and analyze documents.",
      "who created you": "I am Void, an intelligent AI assistant designed to give fast and accurate answers.",
      "what is your name": "My name is Void. Great to talk to you!",
      "help": "You can ask me any question or tell me what task you would like to solve."
    };

    if (VOICE_CACHE[cleanText]) {
      console.log(`⚡ [Voice Cache Hit] Returning instant response for "${cleanText}"`);
      return NextResponse.json({ text: VOICE_CACHE[cleanText] }, {
        headers: { "Cache-Control": "public, max-age=86400, s-maxage=86400" }
      });
    }

    // ── Step 1: Optional Tavily Search (RAG) ──
    const isExplicitSearch = /search|google|lookup|find on web|find online|latest news|current standings|weather|today|2026/i.test(text);
    const tavilyKey = process.env.TAVILY_API_KEY;
    if (tavilyKey && isExplicitSearch) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000); // 2s max timeout
        
        const tavilyRes = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: tavilyKey,
            query: text,
            search_depth: "basic",
            include_answer: false,
            max_results: 3
          }),
          signal: controller.signal
        });
        clearTimeout(timeout);

        if (tavilyRes.ok) {
          const tavilyData = await tavilyRes.json();
          if (tavilyData && tavilyData.results && tavilyData.results.length > 0) {
            const searchContext = tavilyData.results
              .map((r: any) => stripUrls(r.content))
              .join("\n\n");
            systemPrompt = `Your name is Void. You are a concise voice assistant. Use the following real-time web search context to answer the user's query accurately. Keep responses SHORT (1-2 sentences max).\n\nContext:\n${searchContext}`;
          }
        }
      } catch (e) {
        console.warn("Tavily search skipped or timed out:", e);
      }
    }

    // ── Step 2: Groq LLM Generation (Ultra Fast 8B Instant) ──
    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) {
      return NextResponse.json({ error: "GROQ_API_KEY not configured" }, { status: 500 });
    }

    const llmRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${groqKey}`
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: text }
        ],
        temperature: 0.7,
        max_tokens: 200,
        stream: false
      })
    });

    if (!llmRes.ok) {
      const errBody = await llmRes.text();
      console.warn("Groq API rate-limited or failed in voice route. Attempting Pollinations AI fallback...", llmRes.status);
      const pollRes = await fetch("https://text.pollinations.ai/openai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "openai",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: text }
          ],
          temperature: 0.7
        })
      });
      if (pollRes.ok) {
        const pollData = await pollRes.json();
        const textOut = pollData.choices?.[0]?.message?.content;
        if (textOut) return NextResponse.json({ text: textOut });
      }
      return NextResponse.json({ error: "LLM request failed: " + llmRes.statusText }, { status: 502 });
    }

    const llmData = await llmRes.json();
    const aiText = llmData.choices?.[0]?.message?.content;
    
    if (!aiText) {
      return NextResponse.json({ error: "No content from LLM" }, { status: 502 });
    }

    // Return just the text. The frontend will immediately trigger a GET to /api/voice?text=... to stream the audio natively.
    return NextResponse.json({ text: aiText });

  } catch (err: any) {
    console.error("Voice API Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
