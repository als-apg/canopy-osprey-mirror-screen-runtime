import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The @slaclab SDK packages are TEMPORARILY link:ed from a sibling checkout
  // (see pnpm-workspace.yaml); dedupe keeps them on this repo's single React
  // copy instead of the SDK checkout's own.
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  test: {
    environment: 'jsdom',
  },
});
