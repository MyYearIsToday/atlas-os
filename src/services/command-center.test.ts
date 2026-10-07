import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { classifyFailure, readSignal, pipelineSchema, financeSchema, missionCounts, attentionMissions, isAwaitingApproval } from './command-center';

test('only an explicit disabled response is disabled', () => {
  assert.equal(classifyFailure(503, { reason: 'Atlas pipeline is not enabled' }), 'DISABLED');
  assert.equal(classifyFailure(503, { reason: 'Internal error' }), 'UNAVAILABLE');
  assert.equal(classifyFailure(401, {}), 'RESTRICTED');
  assert.equal(classifyFailure(403, {}), 'RESTRICTED');
  assert.equal(classifyFailure(404, { reason: 'Workforce is not enabled' }), 'DISABLED');
});
test('unreachable or malformed data does not become zero or healthy', async () => {
  const broken = await readSignal('/api/atlas/pipeline', pipelineSchema, '', async () => { throw new Error('offline'); });
  assert.equal(broken.state, 'UNAVAILABLE');
  assert.equal(broken.data, undefined);
  const malformed = await readSignal('/api/atlas/pipeline', pipelineSchema, '', async () => new Response('{}'));
  assert.equal(malformed.state, 'UNAVAILABLE');
});
test('recorded revenue is independent of invoice amounts', () => {
  const finance = financeSchema.parse({ receivedRevenue: { totals: {}, paymentCount: 0 }, notRevenue: { PREPARED: { count: 1, amount: { USD: '9000.00' } } }, invoices: { items: [], nextCursor: null } });
  assert.deepEqual(finance.receivedRevenue.totals, {});
  assert.equal(finance.receivedRevenue.paymentCount, 0);
});
test('mission counts use records, not demo estimates', () => {
  assert.deepEqual(missionCounts([{ taskId: 'x', title: 'Review', status: 'Waiting Approval', approvalRequired: 'Human' }]), { Pending: 0, 'Waiting Approval': 1, 'In Progress': 0, Completed: 0, Failed: 0, Blocked: 0 });
});
test('real backend shape: a Pending approval-required mission is awaiting approval and needs attention', () => {
  const real = { taskId: 'real-1', title: 'Approve outreach', status: 'Pending', approvalRequired: 'Approval Required' };
  assert.equal(isAwaitingApproval(real), true);
  assert.deepEqual(missionCounts([real]), { Pending: 0, 'Waiting Approval': 1, 'In Progress': 0, Completed: 0, Failed: 0, Blocked: 0 });
  assert.deepEqual(attentionMissions([real]).map((m) => m.taskId), ['real-1']);
  const ceo = { taskId: 'ceo-1', title: 'CEO sign-off', status: 'Pending', approvalRequired: 'CEO Only' };
  assert.equal(missionCounts([real, ceo])['Waiting Approval'], 2);
  // Not awaiting: an Auto mission that is simply Pending, and a completed approval-required mission.
  const auto = { taskId: 'auto-1', title: 'Internal summary', status: 'Pending', approvalRequired: 'Auto' };
  const done = { taskId: 'done-1', title: 'Approved earlier', status: 'Completed', approvalRequired: 'Approval Required' };
  assert.equal(isAwaitingApproval(auto) || isAwaitingApproval(done), false);
  assert.equal(missionCounts([auto, done]).Pending, 1);
  assert.deepEqual(attentionMissions([auto, done]), []);
});
test('read adapter is GET only and sends no shared secret', async () => {
  const result = await readSignal('/api/atlas/pipeline', pipelineSchema, '', async (_url, options) => {
    assert.equal(options?.method, 'GET');
    assert.equal(options?.headers, undefined);
    return new Response(JSON.stringify({ reason: 'Atlas pipeline is not enabled' }), { status: 503 });
  });
  assert.equal(result.state, 'DISABLED');
});
