import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Force react and @carbon/react to this app's single copy; the @slaclab SDK
  // packages otherwise pull their own, bundling a second React/Carbon.
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@carbon/react': fileURLToPath(new URL('./node_modules/@carbon/react', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
  },
});
