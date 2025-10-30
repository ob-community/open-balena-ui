type RuntimeEnv = Record<string, string | boolean | undefined>;

const importMetaEnv: RuntimeEnv =
  typeof import.meta !== 'undefined' && typeof import.meta.env !== 'undefined' ? (import.meta.env as RuntimeEnv) : {};

const readEnv = (key: string): string | undefined => {
  const value = importMetaEnv[key];
  return typeof value === 'string' ? value : undefined;
};

export default {
  REACT_APP_OPEN_BALENA_POSTGREST_URL: readEnv('REACT_APP_OPEN_BALENA_POSTGREST_URL'),
  REACT_APP_OPEN_BALENA_REMOTE_URL: readEnv('REACT_APP_OPEN_BALENA_REMOTE_URL'),
  REACT_APP_OPEN_BALENA_API_URL: readEnv('REACT_APP_OPEN_BALENA_API_URL'),
  REACT_APP_OPEN_BALENA_API_VERSION: readEnv('REACT_APP_OPEN_BALENA_API_VERSION'),
  REACT_APP_BANNER_IMAGE: readEnv('REACT_APP_BANNER_IMAGE'),
  REACT_APP_OPEN_BALENA_UI_URL: readEnv('REACT_APP_OPEN_BALENA_UI_URL'),
};
