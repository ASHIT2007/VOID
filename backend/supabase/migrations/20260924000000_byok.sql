BEGIN;

CREATE TABLE public.provider_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_id text NOT NULL CHECK (provider_id IN ('openai','anthropic','google','groq','mistral','openrouter','custom')),
  display_name text NOT NULL,
  encrypted_api_key text NOT NULL,
  key_iv text NOT NULL,
  key_auth_tag text NOT NULL,
  key_fingerprint text NOT NULL,
  masked_key text NOT NULL,
  base_url text,
  status text NOT NULL DEFAULT 'connected',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_validated_at timestamptz
);
CREATE INDEX provider_connections_owner ON public.provider_connections(user_id);

CREATE TABLE public.provider_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.provider_connections(id) ON DELETE CASCADE,
  provider_id text NOT NULL,
  model_id text NOT NULL,
  display_name text NOT NULL,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  context_window integer,
  enabled boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'unknown',
  last_discovered_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(connection_id, model_id)
);
CREATE INDEX provider_models_connection ON public.provider_models(connection_id);

CREATE TABLE public.routing_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  default_mode text NOT NULL DEFAULT 'AUTO' CHECK (default_mode IN ('AUTO','FAST','DEEP','CREATIVE','EFFICIENT','MANUAL')),
  preferred_model_id uuid REFERENCES public.provider_models(id) ON DELETE SET NULL,
  image_model_id uuid REFERENCES public.provider_models(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.routing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid,
  model_id uuid REFERENCES public.provider_models(id) ON DELETE SET NULL,
  provider_id text,
  routing_mode text NOT NULL DEFAULT 'AUTO',
  fallback_count integer NOT NULL DEFAULT 0,
  latency_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX routing_events_owner_time ON public.routing_events(user_id, created_at DESC);

CREATE TABLE public.model_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  model_id uuid REFERENCES public.provider_models(id) ON DELETE SET NULL,
  provider_id text NOT NULL,
  input_tokens integer,
  output_tokens integer,
  token_count_estimated boolean NOT NULL DEFAULT false,
  estimated_cost_usd numeric,
  latency_ms integer,
  routing_mode text NOT NULL DEFAULT 'AUTO',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX model_usage_owner_time ON public.model_usage(user_id, created_at DESC);

-- Credentials are accessed solely through the authenticated application server.
-- No browser role can select ciphertext or insert arbitrary connection records.
ALTER TABLE public.provider_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.routing_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.routing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.provider_connections, public.provider_models, public.routing_preferences, public.routing_events, public.model_usage FROM anon, authenticated;
GRANT ALL ON public.provider_connections, public.provider_models, public.routing_preferences, public.routing_events, public.model_usage TO service_role;

COMMIT;
