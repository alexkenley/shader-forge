export type SessiondHealth = {
  ok: boolean;
  service: string;
  now: string;
  capabilities: string[];
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

export type SessionTerminalOpen = {
  terminalId: string;
  shell: string;
  cwd: string;
  cols: number;
  rows: number;
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

export async function listSessions() {
  const payload = await requestJson<{ sessions: EngineSession[] }>('/api/sessions');
  return payload.sessions;
}

export async function createSession(name = 'shell-workspace') {
  const payload = await requestJson<{ session: EngineSession }>('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  return payload.session;
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

  eventSource.addEventListener('terminal.output', outputHandler as EventListener);
  eventSource.addEventListener('terminal.exit', exitHandler as EventListener);

  return () => {
    eventSource.removeEventListener('terminal.output', outputHandler as EventListener);
    eventSource.removeEventListener('terminal.exit', exitHandler as EventListener);
    eventSource.close();
  };
}
