import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

// Real Postgres engine with minimal Supabase auth/storage contracts, no external account.
const db = new PGlite();
try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA storage;
    CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb DEFAULT '{}');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE TABLE storage.buckets(id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql AS $$ SELECT string_to_array($1, '/') $$;
    GRANT USAGE ON SCHEMA public, auth, storage TO anon, authenticated, service_role;
    GRANT ALL ON storage.objects TO anon, authenticated;
  `);
  for (const name of ['20250517000000_chat_attachments_bucket.sql', '20260923000000_application_schema_and_rls.sql']) {
    await db.exec(await readFile(new URL(`../backend/supabase/migrations/${name}`, import.meta.url), 'utf8'));
  }
  // Re-running must not drop data or duplicate policies/triggers.
  const migration = await readFile(new URL('../backend/supabase/migrations/20260923000000_application_schema_and_rls.sql', import.meta.url), 'utf8');
  await db.exec(migration);
  for (const name of ['20260924000000_byok.sql', '20260924010000_provider_orchestration.sql', '20260928000000_voice_agent.sql']) {
    await db.exec(await readFile(new URL(`../backend/supabase/migrations/${name}`, import.meta.url), 'utf8'));
  }
  const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222';
  await db.query('INSERT INTO auth.users(id,email) VALUES ($1,$2),($3,$4)', [a, 'a@example.com', b, 'b@example.com']);
  await db.exec('SET ROLE service_role');
  const connection = (await db.query(`INSERT INTO public.provider_connections
    (user_id,provider_id,display_name,encrypted_api_key,key_iv,key_auth_tag,key_fingerprint,masked_key)
    VALUES ($1,'openai','Test connection','ciphertext','iv','tag','fingerprint','masked') RETURNING id`, [a])).rows[0].id;
  const model = (await db.query(`INSERT INTO public.provider_models(connection_id,provider_id,model_id,display_name)
    VALUES ($1,'openai','test-model','Test model') RETURNING id`, [connection])).rows[0].id;
  await db.query('INSERT INTO public.routing_preferences(user_id,preferred_model_id) VALUES ($1,$2)', [a, model]);
  await db.query('INSERT INTO public.voice_preferences(user_id,config) VALUES ($1,$2)', [a, JSON.stringify({ mode: 'modular', brainModelId: model, sttProvider: 'browser', ttsProvider: 'browser' })]);
  assert.equal((await db.query('SELECT config FROM public.voice_preferences WHERE user_id=$1', [a])).rows[0].config.brainModelId, model);
  await db.query("INSERT INTO public.routing_events(user_id,model_id,provider_id) VALUES ($1,$2,'openai')", [a, model]);
  await db.query("INSERT INTO public.model_usage(user_id,model_id,provider_id) VALUES ($1,$2,'openai')", [a, model]);
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`SET ROLE ${role}`);
    for (const table of ['provider_connections', 'provider_models', 'routing_preferences', 'routing_events', 'model_usage', 'voice_preferences']) {
      await assert.rejects(db.query(`SELECT * FROM public.${table}`), /permission denied/, `${role} must not read ${table}`);
      await assert.rejects(db.query(`DELETE FROM public.${table}`), /permission denied/, `${role} must not mutate ${table}`);
    }
  }
  await db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub = '${a}'`);
  assert.equal((await db.query('SELECT * FROM public.profiles')).rows.length, 1);
  const folder = (await db.query('INSERT INTO public.folders(user_id,name) VALUES ($1,$2) RETURNING id', [a, 'Private'])).rows[0].id;
  const conv = (await db.query('INSERT INTO public.conversations(user_id,title,folder_id) VALUES ($1,$2,$3) RETURNING id', [a, 'Private', folder])).rows[0].id;
  await db.query('INSERT INTO public.messages(conversation_id,role,content) VALUES ($1,$2,$3)', [conv, 'user', 'private text']);
  await db.query('INSERT INTO public.snippets(user_id,title,code) VALUES ($1,$2,$3)', [a, 'Private', 'secret']);
  await db.query('INSERT INTO storage.objects(bucket_id,name) VALUES ($1,$2)', ['chat-attachments', `${a}/photo.png`]);
  await db.exec(`SET request.jwt.claim.sub = '${b}'`);
  for (const table of ['conversations', 'messages', 'folders', 'snippets']) assert.equal((await db.query(`SELECT * FROM public.${table}`)).rows.length, 0, table);
  assert.equal((await db.query('SELECT * FROM storage.objects')).rows.length, 0);
  await assert.rejects(db.query('INSERT INTO public.messages(conversation_id,role,content) VALUES ($1,$2,$3)', [conv, 'user', 'attack']));
  await assert.rejects(db.query('INSERT INTO public.conversations(user_id,folder_id) VALUES ($1,$2)', [b, folder]));
  await assert.rejects(db.query('INSERT INTO storage.objects(bucket_id,name) VALUES ($1,$2)', ['chat-attachments', `${a}/attack.png`]));
  assert.equal((await db.query('UPDATE public.messages SET content=$1 WHERE conversation_id=$2 RETURNING id', ['attack', conv])).rows.length, 0);
  await db.exec('RESET ROLE; SET ROLE anon; SET request.jwt.claim.sub = \'\'');
  await assert.rejects(db.query('SELECT * FROM public.profiles'));
  await assert.rejects(db.query("INSERT INTO storage.objects(bucket_id,name) VALUES ('chat-attachments','anonymous/file')"));
  await db.exec(`RESET ROLE; SET ROLE authenticated; SET request.jwt.claim.sub = '${a}'`);
  await db.query('DELETE FROM public.conversations WHERE id=$1', [conv]);
  assert.equal((await db.query('SELECT * FROM public.messages')).rows.length, 0);
  await db.exec('SET ROLE service_role');
  await db.query('DELETE FROM public.provider_connections WHERE id=$1', [connection]);
  assert.equal((await db.query('SELECT * FROM public.provider_models')).rows.length, 0);
  assert.equal((await db.query('SELECT preferred_model_id FROM public.routing_preferences')).rows[0].preferred_model_id, null);
  console.log('Database migrations, profile trigger, owner access, cross-user/anonymous denial, BYOK browser-role denial, service-role access, and cascade checks passed.');
} finally { await db.close(); }
