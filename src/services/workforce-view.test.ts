import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { appendWorkforceMissionPage } from './workforce-client';
import { configurationState, durationMs, formatRate, missionLens, missionMetrics, type WorkforceMission } from './workforce-view';

const mission = (over: Partial<WorkforceMission>): WorkforceMission => ({
  taskId: 't', title: 'Task', status: 'Pending', approvalRequired: 'Auto', ...over,
});

test('awaiting approval is not also counted as queued', () => {
  const rows = [
    mission({ taskId: 'a', status: 'Pending', approvalRequired: 'Approval Required' }),
    mission({ taskId: 'b', status: 'Pending', approvalRequired: 'Auto' }),
    mission({ taskId: 'c', status: 'In Progress', approvalRequired: 'Auto' }),
    mission({ taskId: 'd', status: 'Completed', approvalRequired: 'Auto', createdAt: '2026-10-01T00:00:00.000Z', completedAt: '2026-10-01T01:00:00.000Z' }),
    mission({ taskId: 'e', status: 'Failed', approvalRequired: 'Auto' }),
    mission({ taskId: 'f', status: 'Blocked', approvalRequired: 'Auto' }),
    mission({ taskId: 'g', status: 'Mystery', approvalRequired: 'Auto' }),
  ];
  assert.equal(missionLens(rows[0]), 'approval');
  const metrics = missionMetrics(rows);
  assert.ok(metrics);
  assert.equal(metrics.approval, 1);
  assert.equal(metrics.queued, 1);
  assert.equal(metrics.active, 1);
  assert.equal(metrics.completed, 1);
  assert.equal(metrics.failed, 1);
  assert.equal(metrics.blocked, 1);
  assert.equal(metrics.other, 1);
  assert.equal(metrics.successRate, 0.5);
  assert.equal(metrics.successDenominator, 2);
  assert.equal(metrics.averageDurationMs, 3_600_000);
  assert.equal(metrics.durationSample, 1);
});

test('success rate and duration stay unavailable without a real sample', () => {
  const metrics = missionMetrics([mission({ status: 'Pending' })]);
  assert.equal(metrics?.successRate, null);
  assert.equal(formatRate(metrics?.successRate ?? null), 'Unavailable');
  assert.equal(metrics?.averageDurationMs, null);
  assert.equal(missionMetrics(null), null);
  assert.equal(durationMs(mission({ status: 'Completed', createdAt: '2026-10-02T00:00:00.000Z', completedAt: '2026-10-01T00:00:00.000Z' })), null);
});

test('employee configuration is not reported as working', () => {
  assert.equal(configurationState({ employee: 'scout', enabled: true, source: 'dynamic', providerId: 'openrouter', model: 'm', fallback: 'f' }).label, 'Configured');
  assert.equal(configurationState({ employee: 'future_falconfx_worker', enabled: false, source: 'disabled', providerId: 'openrouter', model: null, fallback: null }).label, 'Disabled');
  assert.equal(configurationState({ employee: 'coding_engineer', enabled: true, source: 'static-fallback', providerId: 'nvidia', model: 'ultra', fallback: 'ultra' }).badge, 'DEGRADED');
});

test('mission pages append without duplicate task ids and retain the server cursor', () => {
  const first = { items: [mission({ taskId: 'a' }), mission({ taskId: 'b' })], nextCursor: 'cursor-1' };
  const next = { items: [mission({ taskId: 'b', title: 'stale duplicate' }), mission({ taskId: 'c' })], nextCursor: null };
  const merged = appendWorkforceMissionPage(first, next);
  assert.deepEqual(merged.items.map((item) => item.taskId), ['a', 'b', 'c']);
  assert.equal(merged.items[1].title, 'Task');
  assert.equal(merged.nextCursor, null);
});
