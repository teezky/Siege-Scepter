import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.test.ts'],
    // Integration tests share one database; keep them sequential.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000
  }
});
