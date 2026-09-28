BEGIN;

ALTER TABLE public.provider_connections DROP CONSTRAINT IF EXISTS provider_connections_provider_id_check;
ALTER TABLE public.provider_connections ADD CONSTRAINT provider_connections_provider_id_check
  CHECK (provider_id IN ('openai','anthropic','google','groq','mistral','openrouter','elevenlabs','custom'));

ALTER TABLE public.provider_connections
  ADD COLUMN IF NOT EXISTS capability_usage jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.routing_preferences
  ADD COLUMN IF NOT EXISTS fallback_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS voice_connection_id uuid REFERENCES public.provider_connections(id) ON DELETE SET NULL;

COMMIT;
