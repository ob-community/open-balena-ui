import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { DeviceOsUpdateProgress } from '../ui/DeviceOsUpdateProgress';

const render = (stage: string, progress?: unknown) =>
  renderToString(
    React.createElement(DeviceOsUpdateProgress, {
      device: { 'id': 1, 'provisioning state': stage, 'provisioning progress': progress },
    }),
  ).replace(/<!-- -->/g, '');

test('OS progress renders the reported stage and exact percentage, including zero and completion', () => {
  for (const [stage, progress] of [
    ['Preparing OS update', 0],
    ['Preparing OS update', 25],
    ['Running OS update', 50],
    ['Patching supervisor update', 90],
    ['Running supervisor update', 95],
    ['Update successful, rebooting', 100],
    ['Update successful pending reboot.', 100],
  ] as const) {
    const html = render(stage, progress);
    assert.match(html, /Host OS update/);
    assert.ok(html.includes(`${stage} (${progress}%)`));
    assert.ok(html.includes(`aria-valuenow="${progress}"`));
    assert.match(html, /aria-valuemin="0"/);
    assert.match(html, /aria-valuemax="100"/);
    assert.match(html, /Stage-based progress, not image download percentage/);
  }
});

test('OS progress is indeterminate when an active update has no valid percentage', () => {
  for (const progress of [undefined, null, 'invalid', -1, 101]) {
    const html = render('Running OS update', progress);
    assert.match(html, /role="progressbar"/);
    assert.match(html, /Running OS update/);
    assert.doesNotMatch(html, /aria-valuenow|Running OS update \(/);
  }
});

test('OS update failure at 100% is an error rather than a successful completion', () => {
  const html = render('OS update failed', 100);
  assert.match(html, /OS update failed \(100%\)/);
  assert.match(html, /MuiAlert-colorError/);
  assert.match(html, /MuiLinearProgress-colorError/);
  assert.doesNotMatch(html, /MuiAlert-colorSuccess/);
  assert.doesNotMatch(render('OS update failed'), /role="progressbar"/);
});

test('initial provisioning and missing updater reports do not render OS update progress', () => {
  for (const stage of ['post-provisioning', 'configuring', '', 'Downloading']) {
    assert.equal(render(stage, 50), '');
  }
});
