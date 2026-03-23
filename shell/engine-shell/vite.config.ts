import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const shellRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(shellRoot, '../..');

export default defineConfig({
  server: {
    fs: {
      allow: [repoRoot],
    },
  },
  plugins: [
    react(),
    {
      name: 'copy-legacy-workspace',
      async closeBundle() {
        const outputRoot = path.join(shellRoot, 'dist');
        const legacySource = path.join(shellRoot, 'web');
        const legacyTarget = path.join(outputRoot, 'web');
        await mkdir(outputRoot, { recursive: true });
        await cp(legacySource, legacyTarget, { recursive: true });
      },
    },
  ],
});
