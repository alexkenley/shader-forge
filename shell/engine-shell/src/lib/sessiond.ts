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
