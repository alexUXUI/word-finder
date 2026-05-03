import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/bench/**/*.test.ts'],
    environment: 'node',
    globals: false,
    reporters: ['verbose'],
    testTimeout: 600_000,
    hookTimeout: 120_000,
  },
});
