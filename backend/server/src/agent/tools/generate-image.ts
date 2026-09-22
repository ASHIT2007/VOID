import { registerTool } from '../tool-registry.js';

registerTool('generate_image', {
  type: 'function',
  function: {
    name: 'generate_image',
    description: 'Generate a real image through the configured image provider (OpenAI when configured). Use for requested illustrations and image creation. For posters or presentations, create the structured gamma-presentation artifact with imagePrompt briefs; the visual editor generates and saves needed visuals.',
    parameters: { type: 'object', properties: { prompt: { type: 'string', description: 'The complete image brief, including subject and any exact wording.' } }, required: ['prompt'] },
  },
}, async (args) => {
  const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
  if (!prompt) return { content: 'An image brief is required.', error: 'missing_prompt' };
  try {
    const origin = process.env.FRONTEND_URL || 'http://127.0.0.1:3000';
    const response = await fetch(new URL('/api/generate-image', origin), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, model: 'Auto' }), signal: AbortSignal.timeout(160_000),
    });
    const result = await response.json() as { url?: string; imageUrl?: string; modelUsed?: string; error?: string; code?: string };
    const url = result.url || result.imageUrl;
    if (!response.ok || !url) return { content: result.error || 'Image generation did not return an image.', error: result.code || 'generation_failed' };
    return { content: `Generated with ${result.modelUsed || 'the configured provider'}. Display this actual returned image: ![Generated image](${url})`,
      images: [{ url, title: prompt, attribution: result.modelUsed || 'Generated image' }] };
  } catch {
    return { content: 'Image generation could not finish. No image was created.', error: 'generation_unavailable' };
  }
}, { requiresConfirmation: false, readOnly: false, category: 'action' });
