import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)), 'server-only': fileURLToPath(new URL('./__tests__/server-only.ts', import.meta.url)) } },
  test: { include: ['frontend/__tests__/**/*.test.ts'], environment: 'node', restoreMocks: true, clearMocks: true },
});
