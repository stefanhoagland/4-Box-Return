import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    // In development the API comes from the server (cd server && npm run dev).
    proxy: { '/api': 'http://localhost:8080', '/healthz': 'http://localhost:8080' },
  },
});
