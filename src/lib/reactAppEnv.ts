type RuntimeEnvValue = string | boolean | undefined;
type RuntimeEnv = Record<string, RuntimeEnvValue>;

declare const __OBUI_BUILD_ENV__: RuntimeEnv | undefined;

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

const buildEnv: RuntimeEnv = typeof __OBUI_BUILD_ENV__ === 'undefined' ? {} : __OBUI_BUILD_ENV__;

const readEnv = (key: string, allowEmptyRuntime = false): string | undefined => {
  const runtimeValue = readRuntimeEnv()[key];
  if (typeof runtimeValue === 'string' && (allowEmptyRuntime || runtimeValue.length > 0)) {
    return runtimeValue;
  }

  const buildValue = buildEnv[key];
  if (typeof buildValue === 'string' && buildValue.length > 0) {
    return buildValue;
  }
  return undefined;
};

const env = {
  get REACT_APP_OPEN_BALENA_REMOTE_URL() {
    return readEnv('REACT_APP_OPEN_BALENA_REMOTE_URL', true);
  },
  get REACT_APP_OPEN_BALENA_BUILT_IN_REMOTE_ENABLED() {
    return readEnv('REACT_APP_OPEN_BALENA_BUILT_IN_REMOTE_ENABLED') === 'true';
  },
  get REACT_APP_OPEN_BALENA_API_URL() {
    return readEnv('REACT_APP_OPEN_BALENA_API_URL');
  },
  get REACT_APP_OPEN_BALENA_API_VERSION() {
    return readEnv('REACT_APP_OPEN_BALENA_API_VERSION');
  },
  get REACT_APP_OPEN_BALENA_ODATA_VERSION() {
    return readEnv('REACT_APP_OPEN_BALENA_ODATA_VERSION');
  },
  get REACT_APP_BANNER_IMAGE() {
    return readEnv('REACT_APP_BANNER_IMAGE');
  },
  get REACT_APP_OPEN_BALENA_UI_URL() {
    return readEnv('REACT_APP_OPEN_BALENA_UI_URL');
  },
  get REACT_APP_OPEN_BALENA_UI_VERSION() {
    return readEnv('REACT_APP_OPEN_BALENA_UI_VERSION');
  },
};

export default env;
