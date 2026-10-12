import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4173,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        // In development: localhost:3000
        // In Docker: api:3000 (service name)
        target: process.env.API_TARGET || 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  },
});
