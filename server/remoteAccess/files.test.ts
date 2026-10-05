import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { Client, Server } from 'ssh2';
import { containerFilePath, containerRoot } from './files';
import { generateEd25519SshKey } from './keys';

const root = '/proc/42/root';
const filesystem = (entries: Record<string, string | null>, files: string[] = []) => {
  const calls: string[] = [];
  return {
    calls,
    lstat: async (value: string) => {
      calls.push(value);
      const key = value.slice(root.length);
      if (!(key in entries)) throw Object.assign(new Error('No such file'), { code: 2 });
      return {
        isSymbolicLink: () => typeof entries[key] === 'string',
        isDirectory: () => entries[key] === null && !files.includes(key),
      };
    },
    readlink: async (value: string) => {
      const target = entries[value.slice(root.length)];
      assert.equal(typeof target, 'string');
      return target!;
    },
  };
};

test('container paths address the process mount namespace, including new upload leaves', async () => {
  const fs = filesystem({ '/tmp': null, '/tmp/existing': null, '/tmp/link': '/tmp/existing/' }, ['/tmp/existing']);
  assert.equal(await containerFilePath(fs, root, '/tmp/existing'), `${root}/tmp/existing`);
  assert.equal(await containerFilePath(fs, root, '/tmp/new'), `${root}/tmp/new`);
  assert.equal(await containerFilePath(fs, root, '/'), `${root}/`);
  await assert.rejects(containerFilePath(fs, root, '/missing/new'), /No such file/);
  await assert.rejects(containerFilePath(fs, root, '/tmp/new/'), /No such file/);
  await assert.rejects(containerFilePath(fs, root, '/tmp/existing/'), /not a directory/);
  await assert.rejects(containerFilePath(fs, root, '/tmp/existing/child'), /not a directory/);
  await assert.rejects(containerFilePath(fs, root, '/tmp/link'), /not a directory/);
  assert.equal(await containerFilePath(fs, root, '/tmp/'), `${root}/tmp/`);
  await assert.rejects(containerFilePath(fs, root, '/tmp/../file'), /normalized/);
});

test('absolute and relative container symlinks stay relative to the container root', async () => {
  const fs = filesystem({
    '/mnt': null,
    '/mnt/absolute': '/data',
    '/mnt/relative': '../data',
    '/data': null,
    '/data/file': null,
    '/escape': '../../../../data',
  });
  for (const value of ['/mnt/absolute/file', '/mnt/relative/file', '/escape/file'])
    assert.equal(await containerFilePath(fs, root, value), `${root}/data/file`);
  assert.ok(fs.calls.every((value) => value.startsWith(`${root}/`)));
});

test('container resolution reports symlink loops, permission failures and cancellation', async () => {
  await assert.rejects(containerFilePath(filesystem({ '/loop': '/loop' }), root, '/loop'), /too many symbolic links/);
  const denied = {
    ...filesystem({}),
    lstat: async () => {
      throw Object.assign(new Error('Permission denied'), { code: 3 });
    },
  };
  await assert.rejects(containerFilePath(denied, root, '/file'), /Permission denied/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(containerFilePath(filesystem({}), root, '/file', controller.signal), /aborted/i);
});

test('container inspection uses the shared selector and rejects stopped, invalid, failed or unresponsive containers', async (t) => {
  const key = generateEd25519SshKey();
  const server = new Server({ hostKeys: [key.privateKey] });
  const client = new Client();
  let output = '42\n';
  let stderr = '';
  let code = 0;
  let hang = false;
  const commands: string[] = [];
  server.on('connection', (connection) => {
    connection.on('error', (error: Error) => t.diagnostic(`SSH fixture: ${error.message}`));
    connection.on('authentication', (context) => context.accept());
    connection.on('ready', () =>
      connection.on('session', (accept) => {
        accept().on('exec', (acceptCommand, _reject, info) => {
          commands.push(info.command);
          const stream = acceptCommand();
          if (hang) return;
          stream.write(output);
          stream.stderr.write(stderr);
          stream.exit(code);
          stream.end();
        });
      }),
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    client.end();
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });
  client.connect({
    host: '127.0.0.1',
    port: (server.address() as AddressInfo).port,
    username: 'test',
    password: 'test',
  });
  await once(client, 'ready');
  assert.equal(await containerRoot(client, 'ugcontainer'), root);
  assert.match(commands[0], /label=io.balena.service-name=ugcontainer/);
  assert.match(commands[0], /inspect --format '\{\{\.State\.Pid\}\}' "\$cid"$/);
  assert.equal(await containerRoot(client, 'balena_supervisor'), root);
  assert.match(commands[1], /name=\^\/balena_supervisor\$/);
  assert.doesNotMatch(commands[1], /label=|service-name=core/);
  assert.equal(await containerRoot(client, 'core'), root);
  assert.match(commands[2], /label=io\.balena\.service-name=core /);
  assert.doesNotMatch(commands[2], /balena_supervisor/);
  assert.throws(() => containerRoot(client, 'bad;id'), /Invalid container/);
  for (const value of ['0\n', 'not-a-pid', '42\n99', '9007199254740992']) {
    output = value;
    await assert.rejects(containerRoot(client, 'ugcontainer'), /invalid process ID/);
  }
  code = 1;
  stderr = 'Service container is not running.';
  await assert.rejects(containerRoot(client, 'ugcontainer'), /not running/);
  code = 0;
  stderr = '';
  output = 'x'.repeat(4097);
  await assert.rejects(containerRoot(client, 'ugcontainer'), /excessive output/);
  hang = true;
  await assert.rejects(containerRoot(client, 'ugcontainer', undefined, 50), /timed out/);
  const controller = new AbortController();
  const pending = containerRoot(client, 'ugcontainer', controller.signal);
  controller.abort();
  await assert.rejects(pending, /cancelled/);
});
