import { requireDeploymentAccess } from '@/lib/deployment-access';
import { serviceDb } from '@/lib/ai/server';
import { parseVoiceConfig } from '@/lib/voice-config';
import { loadVoiceConfig, validateVoiceConfig, voiceError, voiceOwner, VOICE_HEADERS } from '@/lib/ai/voice-server';
export async function GET(request: Request) {
  const denied = requireDeploymentAccess(request); if (denied) return denied;
  try { return Response.json({ config: await loadVoiceConfig(await voiceOwner(request)) }, { headers: VOICE_HEADERS }); } catch (error) { return voiceError(error); }
}
export async function PUT(request: Request) {
  const denied = requireDeploymentAccess(request); if (denied) return denied;
  try {
    const userId = await voiceOwner(request), config = parseVoiceConfig((await request.json()).config);
    await validateVoiceConfig(userId, config);
    const { error } = await serviceDb().from('voice_preferences').upsert({ user_id: userId, config, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) throw error;
    return Response.json({ config }, { headers: VOICE_HEADERS });
  } catch (error) { return voiceError(error); }
}
