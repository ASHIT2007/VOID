import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_VOICE_CONFIG, type VoiceConfig } from '../lib/voice-config';
import { POST as session } from '../app/api/voice/session/route';
import { GET as settings, PUT as saveSettings } from '../app/api/voice/settings/route';
import { POST as speak } from '../app/api/tts/route';
import { GET as liveTranscription, POST as transcribe } from '../app/api/transcribe/route';

const state = vi.hoisted(() => ({ owner: 'user-a' as string | null, config: {} as Record<string, unknown>, connections: [] as Record<string, unknown>[], queries: [] as Array<{ table: string; filters: Record<string, unknown> }>, saved: null as unknown, missingStorage: false }));
vi.mock('../lib/deployment-access', () => ({ requireDeploymentAccess: () => null }));
vi.mock('../lib/ai/server', () => ({
  authenticatedUser: async () => state.owner,
  openKey: (row: Record<string, unknown>) => `user-key-${row.provider_id}`,
  loadByokContext: async () => ({ models: [{ id: 'brain-a', enabled: true, capabilities: { text: true, streaming: true } }] }),
  serviceDb: () => ({ from: (table: string) => {
    const filters: Record<string, unknown> = {}; state.queries.push({ table, filters });
    const result = async () => table === 'voice_preferences'
      ? { data: { config: state.config }, error: state.missingStorage ? new Error('missing table') : null }
      : { data: state.connections.find(row => Object.entries(filters).every(([key, value]) => row[key] === value)), error: null };
    const query = { select: () => query, eq: (key: string, value: unknown) => { filters[key] = value; return query; }, maybeSingle: result, single: result,
      upsert: async (value: unknown) => { state.saved = value; return { error: null }; } };
    return query;
  } }),
}));
const fetchMock = vi.fn();
const request = (path: string, body?: unknown) => new Request(`http://localhost/api/${path}`, { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }) });
function config(values: Partial<VoiceConfig> = {}) { state.config = { ...DEFAULT_VOICE_CONFIG, brainModelId: 'brain-a', ...values }; }
function connection(provider: string, user = 'user-a', extra = {}) { state.connections.push({ id: `connection-${provider}`, user_id: user, provider_id: provider, enabled: true, status: 'connected', ...extra }); }
function native(provider: 'openai' | 'google' = 'openai') { config({ mode: 'native', nativeProvider: provider, nativeConnectionId: `connection-${provider}`, nativeModel: provider === 'google' ? 'gemini-3.8-live' : 'gpt-realtime-2.1', nativeVoice: provider === 'google' ? 'Kore' : 'marin' }); connection(provider); }
beforeEach(() => {
  state.owner = 'user-a'; state.connections = []; state.queries = []; state.saved = null; state.missingStorage = false; config();
  fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock);
  for (const name of ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GROQ_API_KEY', 'DEEPGRAM_API_KEY', 'ELEVENLABS_API_KEY', 'CARTESIA_API_KEY']) vi.stubEnv(name, 'DO-NOT-USE-DEPLOYMENT-KEY');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('BYOK voice ownership and saved configuration', () => {
  it('requires authentication before reading settings or contacting a provider', async () => {
    state.owner = null; expect((await session(request('voice/session'))).status).toBe(401); expect(fetchMock).not.toHaveBeenCalled(); expect(state.queries).toHaveLength(0);
  });
  it('persists only normalized preferences under the verified user', async () => {
    const response = await saveSettings(request('voice/settings', { config: { ...state.config, apiKey: 'injected', user_id: 'user-b' } }));
    expect(response.status).toBe(200); expect(state.saved).toEqual({ user_id: 'user-a', config: state.config, updated_at: expect.any(String) });
    const read = await settings(new Request('http://localhost/api/voice/settings'));
    expect((await read.json()).config).toEqual(state.config); expect(read.headers.get('cache-control')).toBe('no-store');
    expect(state.queries.at(-1)?.filters).toEqual({ user_id: 'user-a' });
  });
  it('does not silently ignore unavailable storage', async () => {
    state.missingStorage = true; const response = await session(request('voice/session')); expect(response.status).toBe(503); expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([{ user_id: 'user-b' }, { enabled: false }, { status: 'authentication_error' }, { capability_usage: { voice: false } }])('rejects an inaccessible connection %j without environment fallback', async extra => {
    native(); Object.assign(state.connections[0], extra);
    const response = await session(request('voice/session')); expect(response.status).toBe(422); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('requires a real connected brain even when deployment keys exist', async () => {
    config({ brainModelId: 'not-owned' }); expect((await session(request('voice/session'))).status).toBe(422); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('starts browser speech with a connected brain without requesting provider audio', async () => {
    const response = await session(request('voice/session')); expect(response.status).toBe(200); expect(await response.json()).toEqual({ config: state.config }); expect(fetchMock).not.toHaveBeenCalled();
  });
});
describe('native temporary credentials', () => {
  it('mints constrained OpenAI credentials using only the owner key', async () => {
    native(); fetchMock.mockResolvedValue(Response.json({ value: 'temporary-openai', expires_at: 123 }));
    const response = await session(request('voice/session')); expect(response.status).toBe(200);
    expect((await response.json()).token).toBe('temporary-openai');
    const [url, init] = fetchMock.mock.calls[0]; expect(url).toBe('https://api.openai.com/v1/realtime/client_secrets'); expect(init.headers.Authorization).toBe('Bearer user-key-openai');
    const body = JSON.parse(init.body); expect(body.expires_after.seconds).toBe(60); expect(body.session.audio.output.voice).toBe('marin'); expect(body.session.instructions).toContain('Hinglish');
    expect(JSON.stringify(init)).not.toContain('DO-NOT-USE');
  });
  it('mints single-use Gemini credentials constrained to the selected model and voice', async () => {
    native('google'); fetchMock.mockResolvedValue(Response.json({ name: 'auth_tokens/temporary' }));
    const response = await session(request('voice/session')); const result = await response.json(); expect(result.token).toBe('auth_tokens/temporary'); expect(JSON.stringify(result)).not.toContain('user-key');
    const [url, init] = fetchMock.mock.calls[0]; expect(url).toContain('/v1beta/auth_tokens'); expect(init.headers['x-goog-api-key']).toBe('user-key-google');
    const body = JSON.parse(init.body); expect(body.uses).toBe(1); expect(body.liveConnectConstraints.model).toBe('models/gemini-3.8-live'); expect(body.liveConnectConstraints.config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Kore');
  });
  it('redacts upstream errors and never retries using another credential', async () => {
    native(); fetchMock.mockResolvedValue(new Response('user-key-openai secret details', { status: 403 }));
    const response = await session(request('voice/session')); expect(response.status).toBe(502); expect(await response.text()).not.toContain('user-key'); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
describe('modular audio providers', () => {
  it.each(['openai', 'cartesia', 'elevenlabs'] as const)('streams %s speech with the saved connection and voice', async provider => {
    config({ ttsProvider: provider, ttsConnectionId: `connection-${provider}`, ttsVoice: provider === 'openai' ? 'marin' : 'voice-123' }); connection(provider);
    fetchMock.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'audio/mpeg' } }));
    const response = await speak(request('tts', { text: 'नमस्ते, how are you?', voiceId: 'untrusted-override' }));
    expect(response.status).toBe(200); expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);
    const [url, init] = fetchMock.mock.calls[0]; expect(JSON.stringify(init.headers)).toContain(`user-key-${provider}`); expect(JSON.stringify(init)).not.toContain('DO-NOT-USE');
    if (provider === 'elevenlabs') expect(url).toContain('/voice-123/stream'); else expect(JSON.parse(init.body).voice).toBe(state.config.ttsVoice);
    expect(JSON.stringify(init)).not.toContain('untrusted-override');
  });
  it.each(['openai', 'groq'] as const)('uses %s Whisper with automatic language detection', async provider => {
    config({ sttProvider: provider, sttConnectionId: `connection-${provider}` }); connection(provider); fetchMock.mockResolvedValue(Response.json({ text: 'कल meeting है' }));
    const form = new FormData(); form.set('audio', new File(['audio'], 'speech.webm', { type: 'audio/webm' })); form.set('language', 'en');
    const response = await transcribe(new Request('http://localhost/api/transcribe', { method: 'POST', body: form }));
    expect(await response.json()).toEqual({ text: 'कल meeting है' }); const init = fetchMock.mock.calls[0][1]; expect(init.headers.Authorization).toBe(`Bearer user-key-${provider}`); expect(init.body.has('language')).toBe(false);
    expect(init.body.get('model')).toBe(provider === 'groq' ? 'whisper-large-v3-turbo' : 'whisper-1');
  });
  it('gives the browser only a short-lived Deepgram token', async () => {
    config({ sttProvider: 'deepgram', sttConnectionId: 'connection-deepgram' }); connection('deepgram'); fetchMock.mockResolvedValue(Response.json({ access_token: 'temporary-dg', expires_in: 60 }));
    const response = await liveTranscription(new Request('http://localhost/api/transcribe')); expect(await response.json()).toEqual({ token: 'temporary-dg', expiresIn: 60 });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Token user-key-deepgram');
  });
  it('rejects missing speech keys instead of using personal environment keys', async () => {
    config({ ttsProvider: 'openai', ttsConnectionId: '', ttsVoice: 'marin' }); const response = await speak(request('tts', { text: 'Hello' })); expect(response.status).toBe(422); expect(fetchMock).not.toHaveBeenCalled();
  });
});
