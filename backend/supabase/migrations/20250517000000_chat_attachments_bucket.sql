-- Storage bucket for chat photo/video attachments
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-attachments',
  'chat-attachments',
  true,
  20971520,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'video/x-msvideo'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Allow anyone to read (public bucket) and uploads from the app
DROP POLICY IF EXISTS "Public read chat attachments" ON storage.objects;
DROP POLICY IF EXISTS "Allow uploads to chat attachments" ON storage.objects;
DROP POLICY IF EXISTS "Allow update own chat attachments" ON storage.objects;

CREATE POLICY "Public read chat attachments"
ON storage.objects FOR SELECT
USING (bucket_id = 'chat-attachments');

CREATE POLICY "Allow uploads to chat attachments"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'chat-attachments');

CREATE POLICY "Allow update own chat attachments"
ON storage.objects FOR UPDATE
USING (bucket_id = 'chat-attachments');
