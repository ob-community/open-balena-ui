interface NodeRequestInit extends RequestInit {
  insecureHTTPParser?: boolean;
}
import type { JwtPayload } from 'jwt-decode';
import { jwtDecode } from 'jwt-decode';
import type { AuthProvider } from 'react-admin';
import environment from '../lib/reactAppEnv';

interface LoginParams {
  username: string;
  password: string;
}

interface OpenBalenaJwtPayload extends JwtPayload {
  permissions?: string[];
  id?: number;
  username?: string;
  [key: string]: unknown;
}

export interface OpenBalenaSession {
  jwt: string | null;
  object: OpenBalenaJwtPayload;
}

export interface OpenBalenaAuthProvider extends AuthProvider {
  getSession: () => OpenBalenaSession;
}

const saveToken = (token: string): void => {
  localStorage.setItem('auth', token);
};

const readToken = (): string | null => localStorage.getItem('auth');

const decodeToken = (token: string | null): OpenBalenaJwtPayload => {
  if (!token) {
    return {};
  }

  return jwtDecode<OpenBalenaJwtPayload>(token);
};

const getUsername = async (token: string, payload: OpenBalenaJwtPayload): Promise<string> => {
  if (typeof payload.username === 'string' && payload.username.trim()) {
    return payload.username;
  }

  const response = await fetch('/admin-db/actions/access-context', {
    headers: new Headers({ Authorization: `Bearer ${token}` }),
  });
  if (!response.ok) {
    throw new Error(`Unable to load the authenticated user identity (HTTP ${response.status}).`);
  }

  const context = (await response.json()) as { username?: unknown };
  if (typeof context.username !== 'string' || !context.username.trim()) {
    throw new Error('The authenticated user record does not have a username.');
  }
  return context.username;
};

const authProvider: OpenBalenaAuthProvider = {
  login: async ({ username, password }: LoginParams) => {
    const requestInit: NodeRequestInit = {
      method: 'POST',
      body: JSON.stringify({ username, password }),
      headers: new Headers({ 'Content-Type': 'application/json' }),
      insecureHTTPParser: true,
    };

    const response = await fetch(`${environment.REACT_APP_OPEN_BALENA_API_URL}/login_`, requestInit);

    if (response.status < 200 || response.status >= 300) {
      throw new Error(response.statusText);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Unexpected empty response body');
    }

    const streamData = await reader.read();
    if (!streamData.value) {
      throw new Error('Authentication response missing token');
    }

    const token = new TextDecoder().decode(streamData.value);
    saveToken(token);
  },
  checkAuth: () => {
    return readToken() ? Promise.resolve() : Promise.reject();
  },
  getPermissions: () => {
    const jwt = readToken();
    return jwt ? Promise.resolve(decodeToken(jwt).permissions) : Promise.reject();
  },
  getIdentity: async () => {
    const jwt = readToken();
    if (!jwt) {
      return Promise.reject();
    }
    const payload = decodeToken(jwt);
    const id = Number(payload.id ?? payload.sub);
    if (!Number.isInteger(id) || id <= 0) {
      return Promise.reject(new Error('Authenticated token does not identify a user.'));
    }
    return {
      id,
      fullName: await getUsername(jwt, payload),
    };
  },
  checkError: (error: { status?: number; body?: { code?: string } }) => {
    const status = error.status;
    if (status === 401 || status === 504 || (status === 403 && error.body?.code !== 'ADMIN_DB_FORBIDDEN')) {
      localStorage.removeItem('auth');
      return Promise.reject();
    }
    return Promise.resolve();
  },
  logout: () => {
    localStorage.removeItem('auth');
    return Promise.resolve();
  },
  getSession: () => {
    const jwt = readToken();
    return { jwt, object: decodeToken(jwt) };
  },
};

export default authProvider;
