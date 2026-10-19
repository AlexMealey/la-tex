import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // pdf.js and CodeMirror are large; this is a local app, so one big bundle is fine.
  build: { chunkSizeWarningLimit: 2000 },
  server: {
    // `npm run dev` talks to a server running on :8080 (e.g. the Docker container).
    proxy: { '/api': 'http://localhost:8080' },
  },
});
