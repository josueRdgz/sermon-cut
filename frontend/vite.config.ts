import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Dev server proxies /api to the local FastAPI backend so the frontend can use
// same-origin relative URLs during browser development.
// When launched via `tauri dev`, the desktop host starts FastAPI itself and the
// UI talks to http://127.0.0.1:<port> (see prepareApiBaseUrl).
export default defineConfig({
  plugins: [react()],
  // Prevent Vite from obscuring Rust errors when used under `tauri dev`.
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // Ignore the Rust project; Cargo handles rebuilds.
      ignored: ['**/src-tauri/**'],
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
});
