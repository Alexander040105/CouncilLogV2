import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',          // user chooses when to reload — never swap mid-typing
      includeAssets: ['favicon-32.png', 'apple-touch-icon.png', 'theme-init.js'],
      manifest: {
        name: 'CounciLog',
        short_name: 'CounciLog',
        description: 'Duty logs, papers routing, and project checklists for student councils.',
        theme_color: '#27146e',
        background_color: '#27146e',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell only — hashed /assets are already immutable-cached by
        // vercel.json; precaching them here makes first offline launch work.
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        navigateFallback: '/index.html',
        // Never touch authenticated traffic — API + Supabase always go to
        // the network. (Their responses carry Cache-Control: no-store.)
        navigateFallbackDenylist: [/^\/api\//, /^\/auth\//],
        runtimeCaching: [],            // explicit: nothing is runtime-cached
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: { port: 5173 },
  build: {
    rollupOptions: {
      output: {
        // Vendor code changes at npm-upgrade cadence, app code every deploy —
        // separate chunks so /assets/* stays immutable-cacheable (vercel.json)
        // and repeat visits skip re-downloading framework code entirely.
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-query': ['@tanstack/react-query'],
          'vendor-supabase': ['@supabase/supabase-js'],
          'vendor-icons': ['lucide-react'],
        },
      },
    },
  },
});
