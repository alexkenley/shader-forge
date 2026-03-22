import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function normalizeAbsolutePath(inputPath) {
  const requested = typeof inputPath === 'string' && inputPath.trim() ? inputPath.trim() : '/';
  return path.resolve(requested);
}

function detectPlatformInfo() {
  const isWSL = process.platform === 'linux' && (
    os.release().toLowerCase().includes('microsoft') ||
    os.release().toLowerCase().includes('wsl')
  );
  const homePath = os.homedir();
  let defaultBrowsePath = homePath;
  let windowsMounts = [];

  if (isWSL) {
    // Detect available Windows drive mounts under /mnt/
    try {
      const mntEntries = fsSync.readdirSync('/mnt', { withFileTypes: true });
      windowsMounts = mntEntries
        .filter((e) => e.isDirectory() && /^[a-z]$/.test(e.name))
        .map((e) => `/mnt/${e.name}`);
    } catch {
      // /mnt may not be accessible
    }
    // Try to detect the Windows user home directory
    // Check USERPROFILE (passed through by WSL) first, then scan /mnt/c/Users/
    const userProfile = process.env.USERPROFILE || '';
    const wslUserProfile = userProfile.replace(/^([A-Za-z]):\\/, (_, drive) => `/mnt/${drive.toLowerCase()}/`).replace(/\\/g, '/');
    const wslUser = process.env.LOGNAME || process.env.USER || '';
    const candidates = [
      wslUserProfile,
      `/mnt/c/Users/${wslUser}`,
    ];
    // Also check for non-system user dirs in /mnt/c/Users/
    try {
      const userDirs = fsSync.readdirSync('/mnt/c/Users', { withFileTypes: true });
      for (const dir of userDirs) {
        if (dir.isDirectory() && !['All Users', 'Default', 'Default User', 'Public'].includes(dir.name)) {
          candidates.push(`/mnt/c/Users/${dir.name}`);
        }
      }
    } catch {
      // /mnt/c/Users may not be accessible
    }
    for (const candidate of candidates) {
      if (!candidate) continue;
      try {
        fsSync.statSync(candidate);
        defaultBrowsePath = candidate;
        break;
      } catch {
        // Try next candidate
      }
    }
    if (defaultBrowsePath === homePath && windowsMounts.length) {
      defaultBrowsePath = windowsMounts[0];
    }
  }

  return {
    platform: process.platform,
    isWSL,
    homePath,
    defaultBrowsePath,
    windowsMounts,
  };
}

let cachedPlatformInfo = null;

export function getPlatformInfo() {
  if (!cachedPlatformInfo) {
    cachedPlatformInfo = detectPlatformInfo();
  }
  return cachedPlatformInfo;
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
