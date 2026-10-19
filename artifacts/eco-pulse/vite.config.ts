import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

const rawPort = process.env.PORT ?? '5173';

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH ?? '/';
const host = process.env.HOST ?? (process.env.REPL_ID ? '0.0.0.0' : '127.0.0.1');

export default defineConfig({
  base: basePath,
  envDir: path.resolve(import.meta.dirname, '..', '..'),
  plugins: [
    react(),
    tailwindcss({ optimize: false }),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Divide el vendor del código de la app para mejorar el caché y evitar
        // un único chunk >500 kB. Clerk y React son los pesos dominantes.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@clerk')) return 'clerk';
          if (id.includes('react-dom') || id.includes('/react/') || id.includes('scheduler') || id.includes('react/jsx-runtime')) return 'react-vendor';
          if (id.includes('@tanstack')) return 'query';
          if (id.includes('@radix-ui')) return 'radix';
          if (id.includes('lucide-react')) return 'icons';
          // Let Rollup place shared dependencies automatically. A forced catch-all
          // vendor chunk creates a circular dependency with react-vendor.
          return undefined;
        },
      },
    },
  },
  server: {
    port,
    strictPort: true,
    host,
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host,
    allowedHosts: true,
  },
});
