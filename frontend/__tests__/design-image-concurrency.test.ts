import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: 'test-user' }, access_token: 'test-token' } } }) } } }));
import { requestDesignImage, type DesignImageRequest } from '@/lib/design/design-image-client';
afterEach(() => vi.unstubAllGlobals());

it('bounds image calls to two, shares identical requests and releases capacity after failure', async () => {
  const finish: Array<(response: Response) => void> = [];
  let active = 0, peak = 0;
  const fetchMock = vi.fn(() => {
    active++; peak = Math.max(peak, active);
    return new Promise<Response>(resolve => finish.push(response => { active--; resolve(response); }));
  });
  vi.stubGlobal('fetch', fetchMock);
  const brief: DesignImageRequest = { subject: 'Snow leopard', prompt: 'Snow leopard in mountains', grounding: 'Snow leopard habitat', source: 'auto', quality: 'medium', format: 'presentation', seed: 1 };
  const first = requestDesignImage(brief), duplicate = requestDesignImage(brief);
  const second = requestDesignImage({ ...brief, seed: 2 }).catch(error => error.message);
  const third = requestDesignImage({ ...brief, seed: 3 });
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  finish[1](new Response(JSON.stringify({ error: 'Image model problem' }), { status: 503 }));
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  const image = { url: '/api/generated-image/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png', modelUsed: 'User model', generated: true };
  finish[0](new Response(JSON.stringify(image))); finish[2](new Response(JSON.stringify(image)));
  expect(await first).toEqual(image); expect(await duplicate).toEqual(image);
  expect(await second).toBe('Image model problem'); expect(await third).toEqual(image); expect(peak).toBe(2);
});
