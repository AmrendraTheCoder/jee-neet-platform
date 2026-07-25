import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/test/**/*.test.ts'],
    environment: 'node',
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      include: ['packages/domain/src/**/*.ts'],
      // The scoring path is the product's central claim. Coverage below this
      // is a build failure, not a warning.
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 80,
        statements: 85,
      },
    },
  },
});
