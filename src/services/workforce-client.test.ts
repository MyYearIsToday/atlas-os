import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { loadWorkforceMissionPage } from './workforce-client';

test('mission page reads use the opaque server cursor and keep empty pages distinct from failures', async () => {
  let requested = '';
  const result = await loadWorkforceMissionPage('https://atlas.example/', 'opaque/+cursor=', async (input, init) => {
    requested = String(input);
    assert.equal(init?.method, 'GET');
    return new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  assert.equal(requested, 'https://atlas.example/api/atlas/autonomy/missions?limit=100&cursor=opaque%2F%2Bcursor%3D');
  assert.equal(result.state, 'EMPTY');
  assert.deepEqual(result.data, { items: [], nextCursor: null });
});
