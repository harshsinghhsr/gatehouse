import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In Docker the API is another container; on the host it is localhost.
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    strictPort: true,
    // Mirrors the nginx rule in the production image, so /api behaves identically in both.
    proxy: { '/api': { target: apiTarget, rewrite: (path) => path.replace(/^\/api/, '') } },
  },
  build: { outDir: 'dist', sourcemap: true },
});
