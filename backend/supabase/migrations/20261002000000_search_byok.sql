BEGIN;

CREATE TABLE IF NOT EXISTS public.search_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_id text NOT NULL CHECK (provider_id IN ('tavily', 'brave')),
  display_name text NOT NULL,
  encrypted_api_key text NOT NULL,
  key_iv text NOT NULL,
  key_auth_tag text NOT NULL,
  key_fingerprint text NOT NULL,
  masked_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_validated_at timestamptz,
  UNIQUE (user_id, provider_id, key_fingerprint)
);
CREATE INDEX IF NOT EXISTS search_connections_owner ON public.search_connections(user_id);
ALTER TABLE public.search_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.search_connections FROM anon, authenticated;
GRANT ALL ON public.search_connections TO service_role;

COMMIT;
