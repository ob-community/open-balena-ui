type RuntimeEnvValue = string | boolean | undefined;
type RuntimeEnv = Record<string, RuntimeEnvValue>;

declare global {
  // eslint-disable-next-line no-var
  var __OBUI_ENV__: RuntimeEnv | undefined;
  interface Window {
    __OBUI_ENV__?: RuntimeEnv;
  }
}

const readRuntimeEnv = (): RuntimeEnv => {
  if (typeof globalThis === 'undefined') {
    return {};
  }

  const candidate = (globalThis as { __OBUI_ENV__?: RuntimeEnv }).__OBUI_ENV__;
  if (!candidate || typeof candidate !== 'object') {
    return {};
  }

  return candidate;
};

const importMetaEnv: RuntimeEnv =
  typeof import.meta !== 'undefined' && typeof import.meta.env !== 'undefined' ? (import.meta.env as RuntimeEnv) : {};

const readEnv = (key: string): string | undefined => {
  const metaValue = importMetaEnv[key];
  if (typeof metaValue === 'string' && metaValue.length > 0) {
    return metaValue;
  }

  const runtimeValue = readRuntimeEnv()[key];
  return typeof runtimeValue === 'string' && runtimeValue.length > 0 ? runtimeValue : undefined;
};

const env = {
  get REACT_APP_OPEN_BALENA_POSTGREST_URL() {
    return readEnv('REACT_APP_OPEN_BALENA_POSTGREST_URL');
  },
  get REACT_APP_OPEN_BALENA_REMOTE_URL() {
    return readEnv('REACT_APP_OPEN_BALENA_REMOTE_URL');
  },
  get REACT_APP_OPEN_BALENA_API_URL() {
    return readEnv('REACT_APP_OPEN_BALENA_API_URL');
  },
  get REACT_APP_OPEN_BALENA_API_VERSION() {
    return readEnv('REACT_APP_OPEN_BALENA_API_VERSION');
  },
  get REACT_APP_BANNER_IMAGE() {
    return readEnv('REACT_APP_BANNER_IMAGE');
  },
  get REACT_APP_OPEN_BALENA_UI_URL() {
    return readEnv('REACT_APP_OPEN_BALENA_UI_URL');
  },
};

export default env;
