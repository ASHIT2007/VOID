import { Router } from 'express';
import type { Request, Response } from 'express';
import { tavily } from '@tavily/core';

export const voiceRouter = Router();

const VOICE_MODEL = 'llama-3.3-70b-versatile';

function buildSystemPrompt(webContext?: string): string {
  return [
    'You are Void, a helpful AI assistant. When asked your name, identity, or to introduce yourself, begin with exactly: "I\'m Void, a helpful AI assistant." Never introduce yourself as ChatGPT or as a provider model.',
    'Keep responses under 2 sentences.',
    webContext ? `Use this web context for factual user questions:\n${webContext}` : '',
  ].filter(Boolean).join('\n');
}

function enforceVoiceIdentity(aiText: string): string {
  return aiText.replace(/<think>[\s\S]*?<\/think>\s*/gi, '').trim();
}

async function getGroqVoiceResponse(text: string, systemPrompt: string): Promise<string> {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    throw new Error('GROQ_API_KEY not configured');
  }

  const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${groqKey}`,
    },
    body: JSON.stringify({
      model: VOICE_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Voice transcript: ${JSON.stringify(text)}`,
        },
      ],
      temperature: 0,
      max_tokens: 150,
    }),
  });

  if (!groqResponse.ok) {
    throw new Error(`Groq API Error: ${await groqResponse.text()}`);
  }

  const groqData = await groqResponse.json() as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const aiText = groqData.choices?.[0]?.message?.content;
  if (!aiText) {
    throw new Error('No content returned from Groq');
  }
  return enforceVoiceIdentity(aiText);
}

voiceRouter.post(['/', ''], async (req: Request, res: Response) => {
  const { text } = req.body as { text?: string };
  if (!text) {
    res.status(400).json({ error: { message: 'Missing "text" field' } });
    return;
  }

  try {
    let webContext = '';
    const tavilyKey = process.env.TAVILY_API_KEY;
    if (tavilyKey) {
      try {
        const tvly = tavily({ apiKey: tavilyKey });
        const searchResponse = await tvly.search(text, { searchDepth: 'basic', maxResults: 3 });
        if (searchResponse?.results?.length) {
          webContext = searchResponse.results.map(result => result.content).join('\n\n');
        }
      } catch (err) {
        console.warn('Tavily search failed:', err);
      }
    }

    const textToSpeak = await getGroqVoiceResponse(text, buildSystemPrompt(webContext));

    const elevenlabsKey = process.env.ELEVENLABS_API_KEY;
    if (!elevenlabsKey) {
      res.status(500).json({ error: { message: 'ELEVENLABS_API_KEY not configured' } });
      return;
    }

    const voiceId = 'EXAVITQu4vr4xnSDxMaL'; // Sarah (True Free Tier Default)
    console.log('[TTS] Sending Groq voice response to ElevenLabs...');

    const elResponse = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'xi-api-key': elevenlabsKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: textToSpeak,
        model_id: 'eleven_multilingual_v2',
      }),
    });

    if (!elResponse.ok || !elResponse.body) {
      throw new Error(`ElevenLabs API Error: ${await elResponse.text()}`);
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('X-Voice-Text', encodeURIComponent(textToSpeak));

    const reader = elResponse.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
    } catch (err) {
      console.error('ElevenLabs stream error:', err);
      res.end();
    }
  } catch (error: any) {
    console.error('Voice Route Error:', error);
    res.status(500).json({ error: { message: error.message || 'Internal Server Error' } });
  }
});
