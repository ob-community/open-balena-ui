import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import type { ReactElement } from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import ts from 'typescript';
import * as builtInRemoteAccess from '../lib/builtInRemoteAccess';
import * as remoteAccessUi from '../lib/remoteAccessUi';

type Element = ReactElement<Record<string, any>>;

const elements = (value: unknown): Element[] => {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const element = value as Element;
  return [element, ...elements(element.props.children)];
};

const loadComponent = (filename: string, modules: Record<string, unknown>, globals = {}) => {
  const source = readFileSync(path.join(__dirname, filename), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  });
  const exports: Record<string, any> = {};
  vm.runInNewContext(outputText, {
    exports,
    require: (name: string) => {
      if (name === 'react/jsx-runtime') return jsxRuntime;
      assert.ok(name in modules, `Unexpected import: ${name}`);
      return modules[name];
    },
    ...globals,
  });
  return exports;
};

const targets: builtInRemoteAccess.RemoteTarget[] = [
  { id: 'host', label: 'Host OS', target: 'host' },
  { id: 'app', label: 'app', target: 'container', container: 'balena_supervisor', containerKind: 'service' },
  { id: 'worker', label: 'worker', target: 'container', container: 'balena_supervisor', containerKind: 'supervisor' },
];

const transferHarness = (globals = {}) => {
  const state: unknown[] = [];
  let cursor = 0;
  const ref = { current: undefined };
  const react = {
    useState: (initial: unknown) => {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      return [state[index], (value: unknown) => (state[index] = value)];
    },
    useRef: () => ref,
    useEffect: () => {},
  };
  const { RemoteFileTransfer } = loadComponent(
    path.join('..', 'ui', 'RemoteFileTransfer.tsx'),
    {
      'react': react,
      '@mui/icons-material/Download': { default: 'DownloadIcon', __esModule: true },
      '@mui/icons-material/Upload': { default: 'UploadIcon', __esModule: true },
      '@mui/material': Object.fromEntries(
        ['Alert', 'Box', 'Button', 'LinearProgress', 'Stack', 'Tab', 'Tabs', 'TextField', 'Typography'].map((name) => [
          name,
          name,
        ]),
      ),
      '../lib/builtInRemoteAccess': builtInRemoteAccess,
      '../lib/remoteAccessUi': remoteAccessUi,
      './RemoteTargetSelect': { RemoteTargetSelect: 'RemoteTargetSelect' },
    },
    { AbortController, DOMException, TransformStream, Response, URL, ...globals },
  );
  const render = (available = targets, token = 'test-token') => {
    cursor = 0;
    const tree = elements(RemoteFileTransfer({ token, deviceUuid: 'device-uuid', targets: available }));
    const find = (type: string, predicate: (props: Record<string, any>) => boolean = () => true) => {
      const element = tree.find((element) => element.type === type && predicate(element.props));
      assert.ok(element, `Missing ${type}`);
      return element.props;
    };
    return {
      tree,
      select: find('RemoteTargetSelect'),
      tabs: find('Tabs'),
      path: find('TextField'),
      action: find('Button', ({ variant }) => variant === 'contained'),
      file: tree.find((element) => element.type === 'input')?.props,
    };
  };
  return { render };
};

test('upload and download remember independent targets without changing shared selector ordering or presentation', () => {
  const { render } = transferHarness();
  let view = render();
  assert.equal(view.select.value, 'host');
  assert.equal(view.select.targets, targets);
  view.select.onChange('app');
  view = render();
  assert.equal(view.select.value, 'app');
  assert.equal(view.select.label, 'Upload to');
  view.tabs.onChange(null, 'download');
  view = render();
  assert.equal(view.select.value, 'host');
  assert.equal(view.select.label, 'Download from');
  view.select.onChange('worker');
  view.tabs.onChange(null, 'upload');
  view = render();
  assert.equal(view.select.value, 'app');
  view.tabs.onChange(null, 'download');
  assert.equal(render().select.value, 'worker');
});

test('a missing upload target remains invalid without clearing or invalidating the download target', () => {
  const { render } = transferHarness();
  let view = render();
  view.select.onChange('app');
  view.path.onChange({ target: { value: '/upload.bin' } });
  view.file!.onChange({ target: { files: [{ name: 'upload.bin', size: 3 }] } });
  assert.equal(render().action.disabled, false);
  const available = targets.filter(({ id }) => id !== 'app');
  view = render(available);
  assert.equal(view.select.value, '');
  assert.equal(view.action.disabled, true);
  assert.ok(view.tree.some((element) => element.type === 'Alert' && element.props.severity === 'warning'));
  view.tabs.onChange(null, 'download');
  view = render(available);
  assert.equal(view.select.value, 'host');
  view.path.onChange({ target: { value: '/download.bin' } });
  assert.equal(render(available).action.disabled, false);
  assert.equal(render(available, '').action.disabled, true);
  view.path.onChange({ target: { value: 'relative.bin' } });
  assert.equal(render(available).action.disabled, true);
  view.tabs.onChange(null, 'upload');
  assert.equal(render().select.value, 'app', 'the original selection returns if its target is running again');
});

test('transfers route to their own selected containers and disable controls while active', async () => {
  const uploads: { url: string; file?: unknown; xhr: any }[] = [];
  const downloads: string[] = [];
  const file = { name: 'upload.bin', size: 3 };
  class Xhr {
    status = 200;
    upload = {};
    onload?: () => void;
    open(_method: string, url: string) {
      uploads.push({ url, xhr: this });
    }
    setRequestHeader() {}
    send(body: unknown) {
      uploads[uploads.length - 1].file = body;
    }
    abort() {}
  }
  const { render } = transferHarness({
    XMLHttpRequest: Xhr,
    showSaveFilePicker: async () => ({ createWritable: async () => new WritableStream() }),
    fetch: async (url: string) => {
      downloads.push(url);
      return new Response(new Uint8Array([1, 2, 3]));
    },
  });
  let view = render();
  view.select.onChange('app');
  view.path.onChange({ target: { value: '/upload.bin' } });
  view.file!.onChange({ target: { files: [file] } });
  view.tabs.onChange(null, 'download');
  view = render();
  view.select.onChange('worker');
  view.path.onChange({ target: { value: '/download.bin' } });
  view.tabs.onChange(null, 'upload');
  view = render();
  view.action.onClick();
  assert.equal(
    uploads[0].url,
    builtInRemoteAccess.remoteTransferUrl('upload', 'device-uuid', '/upload.bin', 'balena_supervisor', 'service'),
  );
  assert.equal(uploads[0].file, file);
  view = render();
  assert.equal(view.select.disabled, true);
  assert.equal(view.path.disabled, true);
  assert.equal(view.action.disabled, true);
  assert.ok(view.tree.filter((element) => element.type === 'Tab').every(({ props }) => props.disabled));
  uploads[0].xhr.onload();
  await new Promise<void>((resolve) => setImmediate(resolve));
  view = render();
  assert.equal(view.select.disabled, false);
  view.tabs.onChange(null, 'download');
  render().action.onClick();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(downloads, [
    builtInRemoteAccess.remoteTransferUrl(
      'download',
      'device-uuid',
      '/download.bin',
      'balena_supervisor',
      'supervisor',
    ),
  ]);
  assert.equal(render().action.disabled, false);
});

test('the dashboard fullscreen button follows the selected legacy integration, not gateway availability', () => {
  for (const enabled of [false, true]) {
    for (const remoteUrl of [undefined, '', 'https://legacy.example.test']) {
      const names = [
        'DeviceConnect',
        'DeviceLogs',
        'DeviceServices',
        'ControlsWidget',
        'UsageWidget',
        'ConfigVarsWidget',
        'EnvVarsWidget',
        'ServiceVarsWidget',
        'TagsWidget',
        'DeviceConnectButton',
        'SummaryWidget',
      ];
      const paths = [
        '../../ui/DeviceConnect',
        '../../ui/DeviceLogs',
        '../../ui/DeviceServices',
        './controlsWidget',
        './usageWidget',
        './configVarsWidget',
        './envVarsWidget',
        './serviceVarsWidget',
        './tagsWidget',
        '../../ui/DeviceConnectButton',
        './summaryWidget',
      ];
      const modules = Object.fromEntries(
        paths.map((name, index) => [name, { default: names[index], __esModule: true }]),
      );
      const { default: DashboardLayout } = loadComponent(
        path.join('..', 'dashboards', 'device', 'dashboardLayout.tsx'),
        {
          ...modules,
          'react': {},
          '@mui/material': {
            Box: 'Box',
            Card: 'Card',
            useTheme: () => ({ palette: { mode: 'dark', common: { white: '#fff' } } }),
          },
          '@mui/material/styles': { alpha: (color: string) => color },
          'react-admin': {
            useRecordContext: () => ({ id: 1 }),
            Title: 'Title',
            TabbedShowLayout: { Tab: 'Tab' },
          },
          '@mui/icons-material': { OpenInFull: 'OpenInFull' },
          '../../lib/reactAppEnv': {
            __esModule: true,
            default: {
              REACT_APP_OPEN_BALENA_REMOTE_URL: remoteUrl,
              REACT_APP_OPEN_BALENA_BUILT_IN_REMOTE_ENABLED: enabled,
            },
          },
          '../../ui/DeviceLogSelection': { DeviceLogSelectionProvider: 'DeviceLogSelectionProvider' },
        },
      );
      assert.equal(
        elements(DashboardLayout()).some((element) => element.type === 'DeviceConnectButton'),
        !!remoteUrl,
        `remote URL=${remoteUrl}, gateway enabled=${enabled}`,
      );
    }
  }
});
