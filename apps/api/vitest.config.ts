import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@retro/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)) },
  },
  test: {
    include: ['test/**/*.spec.ts', 'src/**/*.spec.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
