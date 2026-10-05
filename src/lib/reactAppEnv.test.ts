import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

type Values = Record<string, string | boolean | undefined>;
type Environment = typeof import('./reactAppEnv').default;

const loadEnvironment = (build: Values, runtime?: Values): Environment => {
  const source = readFileSync(path.join(__dirname, 'reactAppEnv.ts'), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  });
  const exports: { default?: Environment } = {};
  vm.runInNewContext(outputText, { exports, __OBUI_BUILD_ENV__: build, __OBUI_ENV__: runtime });
  return exports.default!;
};

test('an explicitly empty runtime remote URL overrides a legacy build URL', () => {
  const build = { REACT_APP_OPEN_BALENA_REMOTE_URL: 'https://legacy.example.test' };
  assert.equal(loadEnvironment(build, { REACT_APP_OPEN_BALENA_REMOTE_URL: '' }).REACT_APP_OPEN_BALENA_REMOTE_URL, '');
  assert.equal(loadEnvironment(build, {}).REACT_APP_OPEN_BALENA_REMOTE_URL, build.REACT_APP_OPEN_BALENA_REMOTE_URL);
  assert.equal(loadEnvironment(build).REACT_APP_OPEN_BALENA_REMOTE_URL, build.REACT_APP_OPEN_BALENA_REMOTE_URL);
  assert.equal(
    loadEnvironment(build, { REACT_APP_OPEN_BALENA_REMOTE_URL: 'https://runtime.example.test' })
      .REACT_APP_OPEN_BALENA_REMOTE_URL,
    'https://runtime.example.test',
  );
});

test('empty overrides only apply to the remote URL and other settings retain build fallbacks', () => {
  const build = {
    REACT_APP_OPEN_BALENA_REMOTE_URL: 'https://legacy.example.test',
    REACT_APP_OPEN_BALENA_API_URL: 'https://api.example.test',
    REACT_APP_OPEN_BALENA_BUILT_IN_REMOTE_ENABLED: 'true',
    REACT_APP_BANNER_IMAGE: 'banner.png',
  };
  const env = loadEnvironment(build, {
    REACT_APP_OPEN_BALENA_REMOTE_URL: '',
    REACT_APP_OPEN_BALENA_API_URL: '',
    REACT_APP_OPEN_BALENA_BUILT_IN_REMOTE_ENABLED: '',
    REACT_APP_BANNER_IMAGE: '',
  });
  assert.equal(env.REACT_APP_OPEN_BALENA_REMOTE_URL, '');
  assert.equal(env.REACT_APP_OPEN_BALENA_API_URL, build.REACT_APP_OPEN_BALENA_API_URL);
  assert.equal(env.REACT_APP_OPEN_BALENA_BUILT_IN_REMOTE_ENABLED, true);
  assert.equal(env.REACT_APP_BANNER_IMAGE, build.REACT_APP_BANNER_IMAGE);
  assert.equal(
    loadEnvironment(build, { REACT_APP_OPEN_BALENA_BUILT_IN_REMOTE_ENABLED: 'false' })
      .REACT_APP_OPEN_BALENA_BUILT_IN_REMOTE_ENABLED,
    false,
  );
});
