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
  checkError: (error: { status?: number }) => {
    const status = error.status;
    if (status === 504 || status === 403) {
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
