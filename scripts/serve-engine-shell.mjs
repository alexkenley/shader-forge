import path from 'node:path';
import { repoRootFromScript, startStaticFileServer } from './lib/harness-utils.mjs';

const repoRoot = repoRootFromScript(import.meta.url);
const shellRoot = path.join(repoRoot, 'shell', 'engine-shell', 'web');
const configuredPort = Number(process.env.PORT || '4173');

const server = await startStaticFileServer({
  rootDir: shellRoot,
  host: '127.0.0.1',
  port: Number.isFinite(configuredPort) ? configuredPort : 4173,
});

console.log(`Engine shell dev server running at ${server.baseUrl}`);
console.log(`Serving static shell assets from ${server.rootDir}`);

const shutdown = async () => {
  await server.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

