import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
    // Run tests sequentially to avoid SQLite conflicts
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
  resolve: {
    // Support TypeScript path aliases
    extensions: ['.ts', '.js'],
  },
  esbuild: {
    target: 'es2022',
  },
});
