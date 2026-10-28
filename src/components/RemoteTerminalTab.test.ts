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
const targets: builtInRemoteAccess.RemoteTarget[] = [
  { id: 'host', label: 'Host OS', target: 'host' },
  {
    id: 'reserved-app',
    label: 'App balena_supervisor',
    target: 'container',
    container: 'balena_supervisor',
    containerKind: 'service',
  },
  {
    id: 'supervisor',
    label: 'Supervisor core',
    target: 'container',
    container: 'balena_supervisor',
    containerKind: 'supervisor',
  },
];

const terminalHarness = () => {
  const hooks: any[] = [];
  const effects: (() => void)[] = [];
  let cursor = 0;
  let dirty = false;
  let focusCount = 0;
  let fitCount = 0;
  let nextFrame = 0;
  const frames = new Map<number, () => void>();
  const react = {
    useState: (initial: unknown) => {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = initial;
      return [
        hooks[index],
        (value: unknown) => {
          if (!Object.is(hooks[index], value)) dirty = true;
          hooks[index] = value;
        },
      ];
    },
    useRef: (initial: unknown) => {
      const index = cursor++;
      if (!(index in hooks))
        hooks[index] = { current: initial === null ? { clientWidth: 800, clientHeight: 600 } : initial };
      return hooks[index];
    },
    useCallback: (callback: unknown, dependencies: unknown[]) => {
      const index = cursor++;
      if (!(index in hooks) || dependencies.some((value, i) => !Object.is(value, hooks[index].dependencies[i])))
        hooks[index] = { callback, dependencies };
      return hooks[index].callback;
    },
    useEffect: (effect: () => (() => void) | undefined, dependencies: unknown[]) => {
      const index = cursor++;
      if (!(index in hooks) || dependencies.some((value, i) => !Object.is(value, hooks[index].dependencies[i]))) {
        const previous = hooks[index];
        hooks[index] = { dependencies };
        effects.push(() => {
          previous?.cleanup?.();
          hooks[index].cleanup = effect();
        });
      }
    },
  };
  class Terminal {
    cols = 80;
    rows = 24;
    loadAddon() {}
    open() {}
    onData() {
      return { dispose() {} };
    }
    onResize() {
      return { dispose() {} };
    }
    reset() {}
    write() {}
    writeln() {}
    focus() {
      focusCount++;
    }
    dispose() {}
  }
  const sockets: Socket[] = [];
  class Socket {
    static OPEN = 1;
    readyState = 1;
    onopen?: () => void;
    onmessage?: (event: { data: string }) => void;
    onerror?: () => void;
    onclose?: () => void;
    messages: Record<string, unknown>[] = [];
    constructor() {
      sockets.push(this);
    }
    send(data: string) {
      this.messages.push(JSON.parse(data));
    }
    close() {
      this.readyState = 3;
    }
    receive(type: string) {
      this.onmessage?.({ data: JSON.stringify({ v: 1, type, channel: 1 }) });
    }
  }
  const source = readFileSync(path.join(__dirname, '..', 'ui', 'RemoteTerminalTab.tsx'), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  });
  const modules: Record<string, unknown> = {
    'react': react,
    'react/jsx-runtime': jsxRuntime,
    '@xterm/xterm': { Terminal },
    '@xterm/addon-fit': {
      FitAddon: class {
        fit() {
          fitCount++;
        }
      },
    },
    '@xterm/xterm/css/xterm.css': {},
    '@mui/material': Object.fromEntries(['Alert', 'Box', 'Button', 'Stack', 'Typography'].map((name) => [name, name])),
    '../lib/builtInRemoteAccess': builtInRemoteAccess,
    '../lib/remoteAccessUi': remoteAccessUi,
    './RemoteTargetSelect': { RemoteTargetSelect: 'RemoteTargetSelect' },
  };
  const exports: Record<string, any> = {};
  vm.runInNewContext(outputText, {
    exports,
    require: (name: string) => {
      assert.ok(name in modules, `Unexpected import: ${name}`);
      return modules[name];
    },
    AbortController,
    requestAnimationFrame: (callback: () => void) => {
      const id = ++nextFrame;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    WebSocket: Socket,
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
    fetch: async () => Response.json({ version: 1, ticket: 'test-ticket' }),
  });
  // The URL helper runs in this module's realm rather than the mocked component's realm.
  const originalWindow = globalThis.window;
  globalThis.window = { location: { protocol: 'https:', host: 'example.test' } } as Window & typeof globalThis;
  const statuses: { status: string; label: string }[] = [];
  const onStatus = (status: string, label: string) => {
    statuses.push({ status, label });
  };
  const render = (available = targets, token = 'test-token', active = false, expanded = false) => {
    let tree: Element[] = [];
    do {
      dirty = false;
      cursor = 0;
      tree = elements(
        exports.RemoteTerminalTab({
          active,
          expanded,
          token,
          deviceUuid: 'a'.repeat(32),
          targets: available,
          onStatus,
        }),
      );
      while (effects.length) effects.shift()!();
    } while (dirty);
    const find = (type: string) => tree.find((element) => element.type === type)?.props;
    return { select: find('RemoteTargetSelect'), action: find('Button'), tree };
  };
  const start = async () => {
    render().action!.onClick();
    await new Promise<void>((resolve) => setImmediate(resolve));
    const socket = sockets[sockets.length - 1];
    socket.onopen?.();
    socket.receive('ready');
    socket.receive('opened');
    render();
    return socket;
  };
  return {
    render,
    start,
    sockets,
    statuses,
    lastStatus: () => statuses[statuses.length - 1],
    focusCount: () => focusCount,
    fitCount: () => fitCount,
    flushFrames: () => {
      for (const [id, callback] of frames) {
        frames.delete(id);
        callback();
      }
    },
    restore: () => {
      globalThis.window = originalWindow;
    },
  };
};

test('connected shell label survives picker removal, restoration and label changes until disconnect; new sessions capture new targets', async (t) => {
  const harness = terminalHarness();
  t.after(harness.restore);
  harness.render().select!.onChange('reserved-app');
  const socket = await harness.start();
  assert.deepEqual(harness.lastStatus(), { status: 'connected', label: 'App balena_supervisor' });
  assert.equal(socket.messages.find(({ type }) => type === 'open')?.containerKind, 'service');
  harness.render([targets[0], targets[2]]);
  assert.deepEqual(harness.lastStatus(), { status: 'connected', label: 'App balena_supervisor' });
  harness.render(
    targets.map((target) => (target.id === 'reserved-app' ? { ...target, label: 'Changed picker label' } : target)),
  );
  assert.deepEqual(harness.lastStatus(), { status: 'connected', label: 'App balena_supervisor' });
  harness.render();
  assert.deepEqual(harness.lastStatus(), { status: 'connected', label: 'App balena_supervisor' });
  socket.receive('exit');
  harness.render([targets[0], targets[2]]);
  assert.deepEqual(harness.lastStatus(), { status: 'disconnected', label: 'Host OS' });
  harness.render().select!.onChange('supervisor');
  const next = await harness.start();
  assert.deepEqual(harness.lastStatus(), { status: 'connected', label: 'Supervisor core' });
  assert.equal(next.messages.find(({ type }) => type === 'open')?.containerKind, 'supervisor');
  harness.render(targets, 'changed-token');
  assert.deepEqual(harness.lastStatus(), { status: 'disconnected', label: 'Supervisor core' });
});

test('expanding and collapsing refits and focuses only the active connected console without reconnecting', async (t) => {
  const harness = terminalHarness();
  t.after(harness.restore);
  await harness.start();
  harness.render(targets, 'test-token', true);
  harness.flushFrames();
  const initialFocus = harness.focusCount();
  const initialFit = harness.fitCount();
  assert.equal(initialFocus, 1);
  for (const [index, expanded] of [true, false].entries()) {
    harness.render(targets, 'test-token', true, expanded);
    assert.equal(harness.focusCount(), initialFocus + index, 'focus waits for the updated layout');
    harness.flushFrames();
    assert.equal(harness.focusCount(), initialFocus + index + 1);
    assert.equal(harness.fitCount(), initialFit + index + 1);
    assert.equal(harness.sockets.length, 1);
  }
  harness.render(targets, 'test-token', false, true);
  harness.flushFrames();
  assert.equal(harness.focusCount(), initialFocus + 2, 'hidden consoles must not steal focus');
  harness.render(targets, 'test-token', true, true);
  harness.sockets[0].receive('exit');
  harness.render(targets, 'test-token', true, true);
  harness.flushFrames();
  assert.equal(harness.focusCount(), initialFocus + 2, 'disconnected consoles must not steal focus');
});

test('terminal host reserves outer spacing and a bottom buffer rather than padding counted by FitAddon', (t) => {
  const harness = terminalHarness();
  t.after(harness.restore);
  const host = harness.render().tree.find(({ props }) => props.ref)?.props;
  assert.ok(host);
  assert.equal(host.sx.inset, '12px');
  assert.equal(host.sx.bottom, 'calc(12px + 1em)');
  assert.equal(host.sx.fontSize, 13);
  assert.equal(host.sx.p, undefined);
  assert.equal(host.sx.padding, undefined);
});
