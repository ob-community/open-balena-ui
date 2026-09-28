import assert from 'node:assert/strict';
import test from 'node:test';
import { hasSupervisorServiceTable, queuedOsUpdateMode, relationshipId } from './deviceServicePresentation';

test('relationshipId reads scalar and expanded OData relationships', () => {
  assert.equal(relationshipId(12), 12);
  assert.equal(relationshipId({ id: 13 }), 13);
  assert.equal(relationshipId([{ __id: 14 }]), 14);
  assert.equal(relationshipId(null), undefined);
});

test('Supervisor service table starts at Supervisor 18.2.0', () => {
  assert.equal(hasSupervisorServiceTable('18.1.5'), false);
  assert.equal(hasSupervisorServiceTable('18.2.0'), true);
  assert.equal(hasSupervisorServiceTable('v19.2.1'), true);
  assert.equal(hasSupervisorServiceTable('unknown'), false);
});

test('queued Host OS update mode changes at Supervisor 19', () => {
  assert.equal(queuedOsUpdateMode('18.2.2'), 'cloudlink');
  assert.equal(queuedOsUpdateMode('v19.0.0'), 'supervisor');
  assert.equal(queuedOsUpdateMode(undefined), 'unknown');
});
