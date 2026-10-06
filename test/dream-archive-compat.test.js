import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { archiveRecordedDream } from '../src/dream-archive.js';
import { StateStore } from '../src/state-store.js';
import { OmbreClient, parseDreamReceipt } from '../src/ombre-client.js';

const receipt = '新建→abcdef123456 生活\n梦境归档：dont_surface=True';
test('dream receipt uses the exact returned ID, never a notice/title guess', () => {
  assert.equal(parseDreamReceipt('通知 123456abcdef\n' + receipt), 'abcdef123456');
  for (const text of ['新建→abcdef123456', receipt.replace('新建', '合并'),
    receipt.replace('True', 'False'), receipt + '\n新建→123456abcdef 生活',
    receipt.replace('abcdef123456', 'abcdef123456aa'), '标题abcdef123456\n梦境归档：dont_surface=True']) {
    assert.throws(() => parseDreamReceipt(text), /uncertain/);
  }
});
test('explicit dream write is one hold, no trace; switch-off sends nothing', async () => {
  const c = new OmbreClient({ writeEnabled: true }); c.stateless = true;
  const calls = [];
  c.post = async (payload, _, timeout) => {
    calls.push(payload.params); assert.equal(timeout, 120000);
    return { result: { content: [{ type: 'text', text: receipt }] } };
  };
  assert.equal(await c.storeDream({ dream: 'fictional', residue: '', awareness: '' }), 'abcdef123456');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].arguments.dream_archive, true);
  c.config.writeEnabled = false;
  assert.equal(await c.storeDream({}), null); assert.equal(calls.length, 1);
});
test('dream material fallback uses automatic mode so dont_surface is respected', async () => {
  const c = new OmbreClient({ breathMaxResults: 3, breathMaxTokens: 1000 }); c.stateless = true;
  c.post = async (payload) => {
    assert.equal(payload.params.arguments.mode, 'automatic');
    return { result: { content: [] } };
  };
  await c.recentMaterialWithRefs();
});
async function fixture() {
  const path = join(await mkdtemp(join(tmpdir(), 'dream-archive-')), 'state.json');
  const store = new StateStore(path, () => ({ recentDreams: [
    { id: 'new', dream: 'fictional', ombreBucketId: null },
    { id: 'old', dream: 'historical fixture', ombreBucketId: '123456abcdef' }
  ], drives: { untouched: 0.3 } }));
  await store.read();
  return store;
}
test('durable claim precedes RPC; concurrent and restarted callers never resend', async () => {
  const store = await fixture(), update = (_, fn) => store.update(fn);
  let calls = 0, release, started;
  const wait = new Promise((r) => { release = r; });
  const sent = new Promise((r) => { started = r; });
  const first = archiveRecordedDream('new', update, async () => {
    calls++; assert.equal((await store.read()).recentDreams[0].ombreArchive.status, 'pending');
    started(); await wait; return 'abcdef123456';
  });
  await sent;
  assert.equal((await archiveRecordedDream('new', update, async () => { calls++; })).reused, true);
  release(); assert.equal((await first).status, 'completed');
  const restarted = new StateStore(store.path, () => { throw new Error('must not reset'); });
  assert.equal((await archiveRecordedDream('new', (_, fn) => restarted.update(fn), async () => { calls++; })).reused, true);
  assert.equal(calls, 1);
  const state = await restarted.read();
  assert.equal(state.recentDreams[0].ombreBucketId, 'abcdef123456');
  assert.deepEqual(state.recentDreams[1], { id: 'old', dream: 'historical fixture', ombreBucketId: '123456abcdef' });
  assert.deepEqual(state.drives, { untouched: 0.3 });
});
test('lost response, malformed/partial result or crash stays fenced; old/missing dreams not written', async () => {
  for (const outcome of ['lost', 'partial', 'crash']) {
    const store = await fixture(), update = (_, fn) => store.update(fn);
    if (outcome === 'crash') await store.update((s) => { s.recentDreams[0].ombreArchive = { status: 'pending' }; return s; });
    else {
      const result = await archiveRecordedDream('new', update, async () => {
        if (outcome === 'lost') throw new Error('timeout after possible write');
        return null;
      });
      assert.equal(result.status, 'uncertain');
    }
    const restarted = new StateStore(store.path, () => null);
    let calls = 0;
    for (const id of ['new', 'old', 'missing']) {
      assert.equal((await archiveRecordedDream(id, (_, fn) => restarted.update(fn), async () => { calls++; })).reused, true);
    }
    assert.equal(calls, 0);
  }
});
