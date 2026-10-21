import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';
import pkg from './package.json';

export default defineConfig({
  // Relative base so the build works from any folder or static host.
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    preact(),
    VitePWA({
      // "prompt": a new version waits for the writer to reload, never mid-sentence.
      registerType: 'prompt',
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // The API, pictures and link-preview pages come from the server, never from the app shell.
        navigateFallbackDenylist: [/^\/api\//, /^\/media\//, /^\/[se]\//],
        runtimeCaching: [
          {
            // Published pictures never change (their address is their content hash).
            urlPattern: ({ url }) => url.pathname.startsWith('/media/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'storyteller-media',
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 60 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Storyteller',
        short_name: 'Storyteller',
        description: 'A private, offline writing app for dialog-driven stories.',
        theme_color: '#5b3df5',
        background_color: '#f7f6fb',
        display: 'standalone',
        start_url: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: {
    // `npm run dev:all` runs the Community server on :8787 next to Vite.
    proxy: Object.fromEntries(['/api', '/media', '/s/', '/e/'].map((p) => [p, 'http://127.0.0.1:8787'])),
  },
  test: {
    include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
    testTimeout: 20_000,
  },
});
