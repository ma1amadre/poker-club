import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  // GitHub Pages отдаёт сайт из подпути /poker-club/ — путь задаёт CI через BASE_PATH.
  base: process.env.BASE_PATH ?? '/',
  resolve: {
    alias: {
      // Чистая доменная логика живёт рядом с Edge Functions (Deno), чтобы сервер и клиент
      // считали очки, деньги и ачивки одним и тем же кодом.
      '@domain': fileURLToPath(new URL('./supabase/functions/_shared/domain', import.meta.url)),
    },
  },
  server: {
    // На Windows «localhost» у vite может забиндиться только на ::1 — явный IPv4.
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'supabase/functions/_shared/**/*.test.ts'],
  },
});
