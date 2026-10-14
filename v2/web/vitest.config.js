import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Separate from vite.config.js so tests don't load the PWA/tailwind plugins.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{js,jsx}'],
    setupFiles: ['./vitest.setup.js'],
    // supabase.js calls createClient() at module load — placeholder values
    // keep imports working; nothing makes a network call in tests.
    env: {
      VITE_API_URL: 'http://localhost:8000/api/v1',
      VITE_SUPABASE_URL: 'https://test.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
    },
  },
});
