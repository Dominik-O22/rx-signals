import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // v4 unit 1: factories are ported in the next commit.
    exclude: ['test/*factor*.test.ts', 'test/testing-documentation.test.ts'],
  },
});
