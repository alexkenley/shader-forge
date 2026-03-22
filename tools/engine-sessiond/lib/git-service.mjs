import { spawnSync } from 'node:child_process';

function runGit(args, cwd) {
  return spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
  });
}

function normalizeGitPath(rawPath) {
  return String(rawPath || '').trim();
}

function normalizeGitEntry(status, rawPath) {
  return {
    status: String(status || '?').trim() || '?',
    path: normalizeGitPath(rawPath),
  };
}

function parseGitStatus(stdout, rootPath) {
  const lines = String(stdout || '')
    .split(/\r?\n/)
    .filter(Boolean);

  const branchLine = lines.find((line) => line.startsWith('## ')) || '';
  const branch = branchLine ? branchLine.slice(3).trim() : '';
  const staged = [];
  const unstaged = [];
  const untracked = [];

  for (const line of lines) {
    if (line.startsWith('## ')) {
      continue;
    }

    if (line.startsWith('?? ')) {
      untracked.push(normalizeGitEntry('?', line.slice(3)));
      continue;
    }

    const x = line[0] || ' ';
    const y = line[1] || ' ';
    const rawPath = line.slice(3);

    if (x !== ' ' && x !== '?') {
      staged.push(normalizeGitEntry(x, rawPath));
    }
    if (y !== ' ' && y !== '?') {
      unstaged.push(normalizeGitEntry(y, rawPath));
    }
  }

  return {
    rootPath,
    branch,
    staged,
    unstaged,
    untracked,
    notARepo: false,
  };
}

export function readGitStatus(rootPath) {
  const probe = runGit(['rev-parse', '--is-inside-work-tree'], rootPath);
  if (probe.status !== 0 || !String(probe.stdout || '').includes('true')) {
    return {
      rootPath,
      branch: '',
      staged: [],
      unstaged: [],
      untracked: [],
      notARepo: true,
    };
  }

  const status = runGit(['status', '--porcelain=v1', '-b'], rootPath);
  if (status.status !== 0) {
    throw new Error(String(status.stderr || status.stdout || 'Failed to read git status.').trim());
  }

  return parseGitStatus(status.stdout, rootPath);
}

export function initGitRepository(rootPath) {
  let result = runGit(['init', '-b', 'main'], rootPath);
  if (result.status !== 0) {
    result = runGit(['init'], rootPath);
  }
  if (result.status !== 0) {
    throw new Error(String(result.stderr || result.stdout || 'Failed to initialize git repository.').trim());
  }

  return readGitStatus(rootPath);
}
