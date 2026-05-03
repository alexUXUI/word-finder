import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    exclude: ['node_modules', 'tests/bench/**'],
    environment: 'node',
    globals: false,
    reporters: ['verbose'],
    testTimeout: 5_000,
  },
});
