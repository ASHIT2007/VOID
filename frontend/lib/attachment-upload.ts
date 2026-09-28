/** Store attachments behind the deployment's authenticated API, never a public bucket. */
export async function uploadAttachment(file: Blob, name: string): Promise<string> {
  const form = new FormData();
  form.append('file', file, name);
  const response = await fetch('/api/attachments', { method: 'POST', body: form });
  const result = await response.json();
  if (!response.ok || typeof result.url !== 'string') throw new Error(result.error || 'Attachment upload failed.');
  return result.url;
}
