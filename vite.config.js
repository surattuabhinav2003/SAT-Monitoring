import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    strictPort: false, // if 5180 is busy, Vite picks the next free port
    open: true,
    proxy: {
      // Forward API calls to the Express backend so the browser sees a single
      // origin in dev (no CORS preflight, no absolute URLs in the code).
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
