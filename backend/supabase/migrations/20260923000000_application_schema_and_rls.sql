-- Apply in a staging project first and back up existing data. This migration
-- replaces policies on VOID's five tables; it does not delete application rows.
BEGIN;

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  full_name text DEFAULT '',
  avatar_url text,
  default_model text DEFAULT 'Auto',
  system_prompt text DEFAULT '',
  tokens_llama3_3_pro bigint NOT NULL DEFAULT 0,
  tokens_llama3_1_fast bigint NOT NULL DEFAULT 0,
  images_flux_v1 bigint NOT NULL DEFAULT 0,
  queries_voice bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS full_name text DEFAULT '';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS default_model text DEFAULT 'Auto';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS system_prompt text DEFAULT '';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS tokens_llama3_3_pro bigint NOT NULL DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS tokens_llama3_1_fast bigint NOT NULL DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS images_flux_v1 bigint NOT NULL DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS queries_voice bigint NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'New chat',
  folder_id uuid REFERENCES public.folders(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS folder_id uuid REFERENCES public.folders(id) ON DELETE SET NULL;
CREATE TABLE IF NOT EXISTS public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.snippets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  language text NOT NULL DEFAULT 'text',
  code text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS void_conversations_owner ON public.conversations(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS void_messages_conversation ON public.messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS void_folders_owner ON public.folders(user_id);
CREATE INDEX IF NOT EXISTS void_snippets_owner ON public.snippets(user_id);
CREATE INDEX IF NOT EXISTS void_conversations_folder ON public.conversations(folder_id);

DO $$
DECLARE item record;
BEGIN
  FOR item IN SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN ('profiles','folders','conversations','messages','snippets')
  LOOP EXECUTE format('DROP POLICY %I ON public.%I', item.policyname, item.tablename); END LOOP;
END $$;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snippets ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.profiles, public.folders, public.conversations, public.messages, public.snippets FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles, public.folders, public.conversations, public.messages, public.snippets TO authenticated;

CREATE POLICY void_profiles_owner ON public.profiles FOR ALL TO authenticated
  USING (id = (SELECT auth.uid())) WITH CHECK (id = (SELECT auth.uid()));
CREATE POLICY void_folders_owner ON public.folders FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY void_snippets_owner ON public.snippets FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY void_conversations_owner ON public.conversations FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()) AND (folder_id IS NULL OR EXISTS (
    SELECT 1 FROM public.folders f WHERE f.id = folder_id AND f.user_id = (SELECT auth.uid())
  )));
CREATE POLICY void_messages_owner ON public.messages FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND c.user_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND c.user_id = (SELECT auth.uid())));

CREATE OR REPLACE FUNCTION public.void_create_profile() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.profiles(id, email, full_name)
  VALUES (NEW.id, NEW.email, coalesce(NEW.raw_user_meta_data->>'full_name', '')) ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.void_create_profile() FROM PUBLIC;
DROP TRIGGER IF EXISTS void_auth_user_profile ON auth.users;
CREATE TRIGGER void_auth_user_profile AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.void_create_profile();
INSERT INTO public.profiles(id, email) SELECT id, email FROM auth.users ON CONFLICT (id) DO NOTHING;

-- New web attachments use the authenticated local API. Lock down the old bucket
-- too: previously issued public URLs stop working and must be migrated by owners.
UPDATE storage.buckets SET public = false WHERE id = 'chat-attachments';
DROP POLICY IF EXISTS "Public read chat attachments" ON storage.objects;
DROP POLICY IF EXISTS "Allow uploads to chat attachments" ON storage.objects;
DROP POLICY IF EXISTS "Allow update own chat attachments" ON storage.objects;
DROP POLICY IF EXISTS void_attachment_owner ON storage.objects;
DROP POLICY IF EXISTS void_attachment_boundary ON storage.objects;
CREATE POLICY void_attachment_owner ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'chat-attachments' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text)
  WITH CHECK (bucket_id = 'chat-attachments' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);
-- Restrictive guard prevents an unrelated permissive policy from reopening this bucket.
CREATE POLICY void_attachment_boundary ON storage.objects AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (bucket_id <> 'chat-attachments' OR (storage.foldername(name))[1] = (SELECT auth.uid())::text)
  WITH CHECK (bucket_id <> 'chat-attachments' OR (storage.foldername(name))[1] = (SELECT auth.uid())::text);
COMMIT;
