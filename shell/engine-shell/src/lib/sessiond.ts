export type SessiondHealth = {
  ok: boolean;
  service: string;
  now: string;
  capabilities: string[];
};

export type PlatformInfo = {
  platform: string;
  isWSL: boolean;
  homePath: string;
  defaultBrowsePath: string;
  windowsMounts: string[];
};

export type EngineSession = {
  id: string;
  name: string;
  rootPath: string;
  createdAt: string;
  updatedAt: string;
};

export type SessionFileEntry = {
  name: string;
  path: string;
  kind: 'file' | 'directory';
  size: number;
  modifiedAt: string;
};

export type SessionFileList = {
  session: EngineSession;
  path: string;
  entries: SessionFileEntry[];
};

export type SessionFileRead = {
  session: EngineSession;
  path: string;
  size: number;
  modifiedAt: string;
  content: string;
};

export type HostDirectoryList = {
  path: string;
  entries: SessionFileEntry[];
};

export type GitFileEntry = {
  status: string;
  path: string;
};

export type GitStatus = {
  rootPath: string;
  branch: string;
  staged: GitFileEntry[];
  unstaged: GitFileEntry[];
  untracked: GitFileEntry[];
  notARepo: boolean;
};

export type SessionTerminalOpen = {
  terminalId: string;
  shell: string;
  cwd: string;
  cols: number;
  rows: number;
};

export type RuntimeStatus = {
  state: 'stopped' | 'running';
  scene: string | null;
  pid: number | null;
  startedAt: string | null;
  executablePath: string | null;
};

export type BuildStatus = {
  state: 'idle' | 'running' | 'succeeded' | 'failed' | 'stopped';
  target: string | null;
  config: string | null;
  buildDir: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  command: string | null;
  exitCode: number | null;
  error: string | null;
};

export type SessiondTerminalEvent =
  | {
      type: 'terminal.output';
      data: {
        terminalId: string;
        data: string;
      };
    }
  | {
      type: 'terminal.exit';
      data: {
        terminalId: string;
        exitCode: number;
        signal?: number;
      };
    }
  | {
      type: 'runtime.log';
      data: {
        stream: 'stdout' | 'stderr';
        data: string;
      };
    }
  | {
      type: 'runtime.exit';
      data: {
        scene: string;
        exitCode: number | null;
        signal: number | null;
        executablePath: string;
      };
    }
  | {
      type: 'runtime.status';
      data: RuntimeStatus;
    }
  | {
      type: 'runtime.started';
      data: RuntimeStatus;
    }
  | {
      type: 'build.log';
      data: {
        stream: 'stdout' | 'stderr';
        data: string;
      };
    }
  | {
      type: 'build.status';
      data: BuildStatus;
    }
  | {
      type: 'build.started';
      data: BuildStatus;
    }
  | {
      type: 'build.completed';
      data: BuildStatus;
    };

const DEFAULT_SESSIOND_BASE_URL = 'http://127.0.0.1:41741';

export function getSessiondBaseUrl() {
  return import.meta.env.VITE_SESSIOND_BASE_URL || DEFAULT_SESSIOND_BASE_URL;
}

async function requestJson<T>(pathname: string, options: RequestInit = {}) {
  const response = await fetch(new URL(pathname, getSessiondBaseUrl()), {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });

  const payload = (await response.json()) as T | { error?: string };
  if (!response.ok) {
    const message =
      typeof payload === 'object' && payload && 'error' in payload && payload.error
        ? String(payload.error)
        : `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload as T;
}

export async function fetchSessiondHealth() {
  return requestJson<SessiondHealth>('/health');
}

export async function fetchPlatformInfo() {
  return requestJson<PlatformInfo>('/api/platform');
}

export async function listSessions() {
  const payload = await requestJson<{ sessions: EngineSession[] }>('/api/sessions');
  return payload.sessions;
}

export async function createSession(options: { name?: string; rootPath?: string } = {}) {
  const payload = await requestJson<{ session: EngineSession }>('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({
      ...(options.name ? { name: options.name } : {}),
      ...(options.rootPath ? { rootPath: options.rootPath } : {}),
    }),
  });
  return payload.session;
}

export async function updateSession(
  sessionId: string,
  options: { name?: string; rootPath?: string } = {},
) {
  const payload = await requestJson<{ session: EngineSession }>(
    `/api/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        ...(options.name ? { name: options.name } : {}),
        ...(options.rootPath ? { rootPath: options.rootPath } : {}),
      }),
    },
  );
  return payload.session;
}

export async function deleteSession(sessionId: string) {
  return requestJson<{ ok: boolean }>(`/api/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  });
}

export async function listFiles(sessionId: string, relativePath = '.') {
  const query = new URL('/api/files/list', getSessiondBaseUrl());
  query.searchParams.set('sessionId', sessionId);
  query.searchParams.set('path', relativePath);
  return requestJson<SessionFileList>(`${query.pathname}${query.search}`);
}

export async function readFile(sessionId: string, relativePath: string) {
  const query = new URL('/api/files/read', getSessiondBaseUrl());
  query.searchParams.set('sessionId', sessionId);
  query.searchParams.set('path', relativePath);
  return requestJson<SessionFileRead>(`${query.pathname}${query.search}`);
}

export async function listHostDirectories(targetPath = '/') {
  const query = new URL('/api/hostfs/list', getSessiondBaseUrl());
  query.searchParams.set('path', targetPath);
  return requestJson<HostDirectoryList>(`${query.pathname}${query.search}`);
}

export async function fetchGitStatus(sessionId: string) {
  const query = new URL('/api/git/status', getSessiondBaseUrl());
  query.searchParams.set('sessionId', sessionId);
  return requestJson<GitStatus>(`${query.pathname}${query.search}`);
}

export async function initGitRepository(sessionId: string) {
  return requestJson<GitStatus>('/api/git/init', {
    method: 'POST',
    body: JSON.stringify({ sessionId }),
  });
}

export async function openTerminal(payload: {
  sessionId?: string;
  cwd?: string;
  shell?: string;
  cols?: number;
  rows?: number;
}) {
  return requestJson<SessionTerminalOpen>('/api/terminals', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function writeTerminalInput(terminalId: string, input: string) {
  return requestJson<{ ok: boolean }>(`/api/terminals/${encodeURIComponent(terminalId)}/input`, {
    method: 'POST',
    body: JSON.stringify({ input }),
  });
}

export async function resizeTerminal(terminalId: string, cols: number, rows: number) {
  return requestJson<{ terminalId: string; cols: number; rows: number }>(
    `/api/terminals/${encodeURIComponent(terminalId)}/resize`,
    {
      method: 'POST',
      body: JSON.stringify({ cols, rows }),
    },
  );
}

export async function closeTerminal(terminalId: string) {
  return requestJson<{ ok: boolean }>(`/api/terminals/${encodeURIComponent(terminalId)}`, {
    method: 'DELETE',
  });
}

export async function fetchRuntimeStatus() {
  return requestJson<RuntimeStatus>('/api/runtime/status');
}

export async function startRuntime(scene = 'sandbox') {
  return requestJson<RuntimeStatus>('/api/runtime/start', {
    method: 'POST',
    body: JSON.stringify({ scene }),
  });
}

export async function stopRuntime() {
  return requestJson<RuntimeStatus>('/api/runtime/stop', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function restartRuntime(scene = 'sandbox') {
  return requestJson<RuntimeStatus>('/api/runtime/restart', {
    method: 'POST',
    body: JSON.stringify({ scene }),
  });
}

export async function fetchBuildStatus() {
  return requestJson<BuildStatus>('/api/build/status');
}

export async function startRuntimeBuild(config = 'Debug', buildDir?: string) {
  return requestJson<BuildStatus>('/api/build/runtime', {
    method: 'POST',
    body: JSON.stringify({
      config,
      ...(buildDir ? { buildDir } : {}),
    }),
  });
}

export async function stopBuild() {
  return requestJson<BuildStatus>('/api/build/stop', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function subscribeSessiondEvents(onEvent: (event: SessiondTerminalEvent) => void) {
  const eventSource = new EventSource(new URL('/api/events', getSessiondBaseUrl()).toString());
  const outputHandler = (message: MessageEvent<string>) => {
    onEvent({
      type: 'terminal.output',
      data: JSON.parse(message.data) as Extract<SessiondTerminalEvent, { type: 'terminal.output' }>['data'],
    });
  };
  const exitHandler = (message: MessageEvent<string>) => {
    onEvent({
      type: 'terminal.exit',
      data: JSON.parse(message.data) as Extract<SessiondTerminalEvent, { type: 'terminal.exit' }>['data'],
    });
  };
  const runtimeLogHandler = (message: MessageEvent<string>) => {
    onEvent({
      type: 'runtime.log',
      data: JSON.parse(message.data) as Extract<SessiondTerminalEvent, { type: 'runtime.log' }>['data'],
    });
  };
  const runtimeExitHandler = (message: MessageEvent<string>) => {
    onEvent({
      type: 'runtime.exit',
      data: JSON.parse(message.data) as Extract<SessiondTerminalEvent, { type: 'runtime.exit' }>['data'],
    });
  };
  const runtimeStatusHandler = (message: MessageEvent<string>) => {
    onEvent({
      type: 'runtime.status',
      data: JSON.parse(message.data) as Extract<SessiondTerminalEvent, { type: 'runtime.status' }>['data'],
    });
  };
  const runtimeStartedHandler = (message: MessageEvent<string>) => {
    onEvent({
      type: 'runtime.started',
      data: JSON.parse(message.data) as Extract<SessiondTerminalEvent, { type: 'runtime.started' }>['data'],
    });
  };
  const buildLogHandler = (message: MessageEvent<string>) => {
    onEvent({
      type: 'build.log',
      data: JSON.parse(message.data) as Extract<SessiondTerminalEvent, { type: 'build.log' }>['data'],
    });
  };
  const buildStatusHandler = (message: MessageEvent<string>) => {
    onEvent({
      type: 'build.status',
      data: JSON.parse(message.data) as Extract<SessiondTerminalEvent, { type: 'build.status' }>['data'],
    });
  };
  const buildStartedHandler = (message: MessageEvent<string>) => {
    onEvent({
      type: 'build.started',
      data: JSON.parse(message.data) as Extract<SessiondTerminalEvent, { type: 'build.started' }>['data'],
    });
  };
  const buildCompletedHandler = (message: MessageEvent<string>) => {
    onEvent({
      type: 'build.completed',
      data: JSON.parse(message.data) as Extract<SessiondTerminalEvent, { type: 'build.completed' }>['data'],
    });
  };

  eventSource.addEventListener('terminal.output', outputHandler as EventListener);
  eventSource.addEventListener('terminal.exit', exitHandler as EventListener);
  eventSource.addEventListener('runtime.log', runtimeLogHandler as EventListener);
  eventSource.addEventListener('runtime.exit', runtimeExitHandler as EventListener);
  eventSource.addEventListener('runtime.status', runtimeStatusHandler as EventListener);
  eventSource.addEventListener('runtime.started', runtimeStartedHandler as EventListener);
  eventSource.addEventListener('build.log', buildLogHandler as EventListener);
  eventSource.addEventListener('build.status', buildStatusHandler as EventListener);
  eventSource.addEventListener('build.started', buildStartedHandler as EventListener);
  eventSource.addEventListener('build.completed', buildCompletedHandler as EventListener);

  return () => {
    eventSource.removeEventListener('terminal.output', outputHandler as EventListener);
    eventSource.removeEventListener('terminal.exit', exitHandler as EventListener);
    eventSource.removeEventListener('runtime.log', runtimeLogHandler as EventListener);
    eventSource.removeEventListener('runtime.exit', runtimeExitHandler as EventListener);
    eventSource.removeEventListener('runtime.status', runtimeStatusHandler as EventListener);
    eventSource.removeEventListener('runtime.started', runtimeStartedHandler as EventListener);
    eventSource.removeEventListener('build.log', buildLogHandler as EventListener);
    eventSource.removeEventListener('build.status', buildStatusHandler as EventListener);
    eventSource.removeEventListener('build.started', buildStartedHandler as EventListener);
    eventSource.removeEventListener('build.completed', buildCompletedHandler as EventListener);
    eventSource.close();
  };
}
