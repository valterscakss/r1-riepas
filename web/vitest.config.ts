import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    // Integration tests share one test database; run files one at a time.
    fileParallelism: false,
    setupFiles: ['tests/setup.ts'],
    testTimeout: 20000,
  },
});
