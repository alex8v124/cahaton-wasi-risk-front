import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'pwa-icon.svg'],
      manifest: {
        name: 'WASI-RISK AI · Nodux Sentinel',
        short_name: 'WASI-RISK',
        description:
          'Auditoría pre-desembolso MYPE al 100% para Caja Trujillo — Terminal Móvil Campo y Consola Riesgos SBS',
        theme_color: '#0F172A',
        background_color: '#F8FAFC',
        display: 'standalone',
        start_url: '/campo',
        scope: '/',
        lang: 'es-PE',
        icons: [
          {
            src: '/pwa-icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.pathname.includes('/sunat/') ||
              url.pathname.includes('/golden-cases') ||
              url.pathname.includes('/health'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'wasi-vps-api-cache',
              expiration: {
                maxEntries: 60,
                maxAgeSeconds: 60 * 60 * 24 * 7,
              },
              networkTimeoutSeconds: 3,
            },
          },
        ],
      },
    }),
  ],
  build: {
    target: 'es2022',
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/preact')) return 'preact';
          if (id.includes('node_modules/zod')) return 'zod';
        },
      },
    },
  },
});
