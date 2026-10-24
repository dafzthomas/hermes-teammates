import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  root: 'mobile',
  plugins: [react()],
  build: { outDir: '../dist/mobile', emptyOutDir: true },
  server: { host: '127.0.0.1' },
});
