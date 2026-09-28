BEGIN;
ALTER TABLE public.provider_connections DROP CONSTRAINT IF EXISTS provider_connections_provider_id_check;
ALTER TABLE public.provider_connections ADD CONSTRAINT provider_connections_provider_id_check
  CHECK (provider_id IN ('openai','anthropic','google','groq','mistral','openrouter','elevenlabs','deepgram','cartesia','custom'));
CREATE TABLE IF NOT EXISTS public.voice_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  config jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(config) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.voice_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.voice_preferences FROM anon, authenticated;
GRANT ALL ON public.voice_preferences TO service_role;
COMMIT;
