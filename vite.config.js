import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Configure proxy so frontend dev server forwards API calls to Spring Boot (default 8080)
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8082',
        changeOrigin: true,
        secure: false,
      },
      '/auth': {
        target: 'http://localhost:8082',
        changeOrigin: true,
        secure: false,
      }
    }
  }
});
