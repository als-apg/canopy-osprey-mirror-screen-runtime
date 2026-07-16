import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // The @slaclab SDK packages are TEMPORARILY link:ed from a sibling checkout
  // (see pnpm-workspace.yaml). Two consequences until the SDK publishes:
  //  - dedupe pins every react/react-dom import to this repo's single copy;
  //  - @slaclab/canopy-shell would otherwise resolve @carbon/react from the
  //    SDK checkout's node_modules (bundling a second Carbon wired to a
  //    second React), so it is aliased to this app's copy.
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
