import assert from 'node:assert/strict';
import test from 'node:test';
import { runReleaseDelete } from './releaseDeleteFlow';

const recorder = () => {
  const calls: string[] = [];
  return {
    calls,
    notifySuccess: () => calls.push('success'),
    notifyFailure: (message: string) => calls.push(`failure: ${message}`),
  };
};

test('a successful delete reports success and runs every follow-up step in order', async () => {
  const { calls, notifySuccess, notifyFailure } = recorder();
  const redirects: Array<[string, string]> = [];

  const ok = await runReleaseDelete({
    performDelete: async () => calls.push('delete'),
    notifySuccess,
    notifyFailure,
    afterSuccess: [
      () => calls.push('unselect'),
      () => calls.push('refresh'),
      () => {
        redirects.push(['list', 'release']);
        calls.push('redirect');
      },
    ],
  });

  assert.equal(ok, true);
  assert.deepEqual(calls, ['delete', 'success', 'unselect', 'refresh', 'redirect']);
  assert.deepEqual(redirects, [['list', 'release']]);
});

test('a failed delete reports only the failure and runs no follow-up steps', async () => {
  const { calls, notifySuccess, notifyFailure } = recorder();

  const ok = await runReleaseDelete({
    performDelete: async () => {
      throw new Error('Request failed with status code 400');
    },
    notifySuccess,
    notifyFailure,
    afterSuccess: [() => calls.push('refresh')],
  });

  assert.equal(ok, false);
  assert.deepEqual(calls, ['failure: Request failed with status code 400']);
});

test('a follow-up step that throws after a successful delete is not reported as a failed delete', async (t) => {
  const { calls, notifySuccess, notifyFailure } = recorder();
  t.mock.method(console, 'error', () => undefined);

  const ok = await runReleaseDelete({
    performDelete: async () => calls.push('delete'),
    notifySuccess,
    notifyFailure,
    afterSuccess: [
      () => {
        // What react-admin's redirect('list') threw without a resource name.
        throw new Error('Cannot create a link without a resource. You must provide the resource name.');
      },
      () => calls.push('refresh'),
    ],
  });

  assert.equal(ok, true);
  assert.deepEqual(calls, ['delete', 'success', 'refresh']);
});
