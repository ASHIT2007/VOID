const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // ── Test KV Edge Cache Endpoint ──
    if (request.method === "GET" && url.pathname.includes("kv-test")) {
      let visitCount = 1;
      let kvStatus = "Not Bound";

      if (env.KV) {
        try {
          const countStr = await env.KV.get("test_counter");
          visitCount = (parseInt(countStr || "0", 10)) + 1;
          await env.KV.put("test_counter", visitCount.toString());
          kvStatus = "Active & Reading/Writing (VOID_CACHE)";
        } catch (error: unknown) {
          kvStatus = "Error: " + errorMessage(error);
        }
      }

      return new Response(JSON.stringify({
        status: "success",
        message: "🎉 Cloudflare KV Edge Cache is Working!",
        visitCount,
        kvStatus,
        timestamp: new Date().toISOString()
      }, null, 2), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ── Generic KV Cache API for VOID App Integration ──
    if (url.pathname.includes("kv-cache")) {
      if (!env.KV) {
        return new Response(JSON.stringify({ error: "KV binding not found" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      if (request.method === "GET") {
        const key = url.searchParams.get("key");
        if (!key) {
          return new Response(JSON.stringify({ error: "Key parameter missing" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        const val = await env.KV.get(key);
        return new Response(JSON.stringify({ found: !!val, value: val }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      if (request.method === "POST") {
        try {
          const body = await request.json() as { key?: string; value?: unknown; ttl?: number };
          const { key, value, ttl } = body;
          if (!key || !value) {
            return new Response(JSON.stringify({ error: "key and value required" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }
          await env.KV.put(key, typeof value === "string" ? value : JSON.stringify(value), {
            expirationTtl: ttl || 86400 // default 24h expiration
          });
          return new Response(JSON.stringify({ success: true, key }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        } catch (error: unknown) {
          return new Response(JSON.stringify({ error: errorMessage(error) }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
      }
    }

    // ── Cloudflare Vectorize Memory API for VOID App ──
    if (url.pathname.includes("vector-memory")) {
      if (!env.VECTOR_INDEX || !env.AI) {
        return new Response(JSON.stringify({ error: "VECTOR_INDEX or AI binding missing" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      if (request.method === "POST") {
        try {
          const body = await request.json() as { text?: string; id?: string };
          const { text, id } = body;
          if (!text) {
            return new Response(JSON.stringify({ error: "text is required" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          // Generate 384-dimension vector embedding using BGE model
          const embeddingRes = await env.AI.run("@cf/baai/bge-small-en-v1.5", {
            text: [text]
          });
          if (!("data" in embeddingRes) || !embeddingRes.data?.[0]) throw new Error("Embedding model returned no vector");
          const vector = embeddingRes.data[0];

          const memId = id || `mem_${Date.now()}`;
          await env.VECTOR_INDEX.insert([
            {
              id: memId,
              values: vector,
              metadata: { text, createdAt: new Date().toISOString() }
            }
          ]);

          return new Response(JSON.stringify({ success: true, memoryId: memId, text }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        } catch (error: unknown) {
          return new Response(JSON.stringify({ error: errorMessage(error) }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
      }

      if (request.method === "GET") {
        const query = url.searchParams.get("query");
        if (!query) {
          return new Response(JSON.stringify({ error: "query parameter required" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        try {
          const embeddingRes = await env.AI.run("@cf/baai/bge-small-en-v1.5", {
            text: [query]
          });
          if (!("data" in embeddingRes) || !embeddingRes.data?.[0]) throw new Error("Embedding model returned no vector");
          const queryVector = embeddingRes.data[0];

          const matches = await env.VECTOR_INDEX.query(queryVector, { topK: 3, returnMetadata: true });

          return new Response(JSON.stringify({
            query,
            matches: matches.matches || []
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        } catch (error: unknown) {
          return new Response(JSON.stringify({ error: errorMessage(error) }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
      }
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    try {
      const formData = await request.formData();
      const prompt = formData.get("prompt");
      const strengthStr = formData.get("strength");
      const imageFile = formData.get("image") as File;
      const mode = formData.get("mode");

      if (!prompt || typeof prompt !== "string") {
        return new Response(JSON.stringify({ error: "Prompt is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!imageFile) {
        return new Response(JSON.stringify({ error: "Image file is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Workers AI accepts base64 directly. Avoid expanding each byte into a
      // JavaScript number array, which multiplies memory usage and can push
      // larger source images over the Worker's memory limit.
      const arrayBuffer = await imageFile.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      if (uint8Array.byteLength === 0 || uint8Array.byteLength > 10 * 1024 * 1024) {
        return new Response(JSON.stringify({ error: "Image must be between 1 byte and 10 MB" }), {
          status: 413,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      let binary = "";
      const chunkSize = 0x8000;
      for (let offset = 0; offset < uint8Array.length; offset += chunkSize) {
        binary += String.fromCharCode(...uint8Array.subarray(offset, offset + chunkSize));
      }
      const imageBase64 = btoa(binary);

      if (mode === "vision") {
        // Run a much faster vision model to avoid Cloudflare 30s timeout
        const visionPrompt = `Describe this image, but incorporate this user edit: "${prompt}". Make it a single, descriptive sentence.`;
        
        const response = await env.AI.run(
          "@cf/unum/uform-gen2-qwen-500m",
          {
            prompt: visionPrompt,
            image: Array.from(uint8Array)
          }
        );
        
        return new Response(JSON.stringify({ enhancedPrompt: response.description || "" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Default Image-to-Image mode
      const strength = strengthStr ? parseFloat(strengthStr as string) : 0.65;
      const response = await env.AI.run(
        "@cf/runwayml/stable-diffusion-v1-5-img2img",
        {
          prompt: prompt,
          image_b64: imageBase64,
          strength: strength,
          guidance: 7.5,
          num_steps: 20,
        }
      );

      // Return the image stream
      return new Response(response, {
        headers: {
          ...corsHeaders,
          "Content-Type": "image/jpeg",
        },
      });
    } catch (error: unknown) {
      console.error(error);
      return new Response(JSON.stringify({ error: errorMessage(error) || "Internal Server Error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  },
} satisfies ExportedHandler<Env>;
