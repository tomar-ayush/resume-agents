const test = require('node:test');
const assert = require('node:assert/strict');

const { buildCallbackPayload, shouldTreatModalCloseAsSuccess } = require('../linkedin');

test('buildCallbackPayload uses generic completed state for compatibility', () => {
  const payload = buildCallbackPayload({
    state: 'linkedin_completed',
    token: 'abc123',
    task_id: 'task-1',
    task_type: 'linkedin',
  });

  assert.deepEqual(payload, {
    state: 'completed',
    status: 'completed',
    token: 'abc123',
    task_id: 'task-1',
    task_type: 'linkedin',
    agent_state: 'linkedin_completed',
  });
});

test('shouldTreatModalCloseAsSuccess is true when the profile moves to pending', () => {
  assert.equal(shouldTreatModalCloseAsSuccess({ state: 'pending' }), true);
  assert.equal(shouldTreatModalCloseAsSuccess({ state: 'already_connected' }), true);
  assert.equal(shouldTreatModalCloseAsSuccess({ state: 'connectable_via_more' }), false);
});
