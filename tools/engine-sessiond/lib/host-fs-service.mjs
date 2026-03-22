import fs from 'node:fs/promises';
import path from 'node:path';

function normalizeAbsolutePath(inputPath) {
  const requested = typeof inputPath === 'string' && inputPath.trim() ? inputPath.trim() : '/';
  return path.resolve(requested);
}

export async function listHostDirectory(inputPath = '/') {
  const resolvedPath = normalizeAbsolutePath(inputPath);
  const stat = await fs.stat(resolvedPath);
  if (!stat.isDirectory()) {
    throw new Error(`Path is not a directory: ${resolvedPath}`);
  }

  const entries = await fs.readdir(resolvedPath, { withFileTypes: true });
  const records = await Promise.all(
    entries
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(async (entry) => {
        const entryPath = path.join(resolvedPath, entry.name);
        const entryStat = await fs.stat(entryPath);
        return {
          name: entry.name,
          path: entryPath,
          kind: entry.isDirectory() ? 'directory' : 'file',
          size: entry.isDirectory() ? 0 : entryStat.size,
          modifiedAt: entryStat.mtime.toISOString(),
        };
      }),
  );

  return {
    path: resolvedPath,
    entries: records,
  };
}
