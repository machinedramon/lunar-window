import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the same build works on GitHub Pages under any repository name.
  base: './',
  server: { port: 5700, strictPort: true },
  preview: { port: 5700, strictPort: true },
  worker: { format: 'es' },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
