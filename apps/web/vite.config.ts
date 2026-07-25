import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite over a meta-framework, deliberately.
 *
 * Both surfaces this app ships — the ranked-mock player and the admin console —
 * sit entirely behind authentication, so there is no SEO argument for SSR. The
 * exam player is pure client state driven by a server-authoritative deadline
 * (FR-ATT-06), and a server render of a paper would be a second place question
 * content could leak from. What actually matters here is build reliability
 * during a live test window (FR-ATT-20 freezes deploys, so the last build
 * before a freeze has to be right) and a fast local loop.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    // React must be a single instance; a duplicated copy silently breaks
    // context, which is how the attempt store reaches the player tree.
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    // @platform/domain is a linked workspace package published as TypeScript
    // source. Pre-bundling it would freeze a stale copy into the dev cache and
    // hide engine changes behind a server restart.
    exclude: ['@platform/domain'],
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          // The maths engine is the single largest dependency and is bundled
          // locally rather than fetched from a CDN (FR-MTH-05). Splitting it
          // keeps it out of the critical path for the admin shell.
          katex: ['katex'],
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
