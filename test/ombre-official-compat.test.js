import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BlackBox, renderBoxList } from '../src/black-box.js';
import { OmbreClient, parseGrowBucketIds, parseGrowReceipt } from '../src/ombre-client.js';

const summary = '2条|新2合0 batch:g_123456abcdef\n📝中文标题\n📝abcdef123456';
const success = parseGrowReceipt(summary);
function client(post) {
  const c = new OmbreClient({ writeEnabled: true });
  c.stateless = true;
  c.post = post;
  return c;
}
async function box() {
  const dir = await mkdtemp(join(tmpdir(), 'ombre-compat-'));
  return new BlackBox(join(dir, 'black-box.json'));
}

test('new titles, even hex-looking titles, never become bucket IDs', () => {
  assert.deepEqual(parseGrowBucketIds(summary), []);
  assert.deepEqual(success, { status: 'completed', total: 2, saved: 2, bucketIds: [], batchId: 'g_123456abcdef' });
  assert.deepEqual(parseGrowBucketIds('📎abcdef123456\n📝123456abcdef'), ['abcdef123456']);
});

test('official shortpath and reused official response remain recognizable', () => {
  const short = '短内容已按 hold 路径保存为单条记忆，没有拆分。\n新建 → abcdef123456 | 生活 V0.5/A0.3';
  assert.equal(parseGrowReceipt(short).status, 'completed');
  assert.deepEqual(parseGrowReceipt(short).bucketIds, ['abcdef123456']);
  assert.equal(parseGrowReceipt('✅ 已识别为刚才 grow 的重试；未重复写入。\n' + summary).status, 'completed');
});

test('partial, zero, pending and unknown responses are not complete success', () => {
  assert.equal(parseGrowReceipt('2条|新1合0 batch:g_123456abcdef\n📝title\n⚠️').status, 'partial');
  for (const value of ['1条|新0合0 batch:g_123456abcdef\n⚠️', '⏳ 相同的 grow 仍在后台处理中', 'API error', '0条|新0合0 batch:g_123456abcdef']) {
    assert.equal(parseGrowReceipt(value).status, 'uncertain');
  }
});

test('held output uses only official grow arguments and a 120s write deadline', async () => {
  let called;
  const c = client(async (payload, body, timeout) => {
    called = { payload, timeout };
    return { result: { content: [{ type: 'text', text: summary }] } };
  });
  assert.deepEqual(await c.storeHeldOutput({ content: ' 长内容保持原文 ' }), success);
  assert.deepEqual(called.payload.params, { name: 'grow', arguments: { content: '长内容保持原文' } });
  assert.equal(called.timeout, 120000);
  c.config.writeEnabled = false;
  await assert.rejects(c.storeHeldOutput({ content: 'x' }), /ombre_write_disabled/);
});

test('writes never replay HTTP errors, lost responses, timeouts or MCP errors', async () => {
  for (const failure of ['HTTP 400', 'HTTP 401', 'HTTP 404', 'TimeoutError', 'connection lost', 'mcp_error', 'rpc_error']) {
    let count = 0;
    const c = client(async () => {
      count++;
      if (failure === 'mcp_error') return { result: { isError: true, content: [] } };
      if (failure === 'rpc_error') return { error: { code: -32602 } };
      throw new Error(failure);
    });
    await assert.rejects(c.call('grow', { content: 'fixture' }));
    assert.equal(count, 1);
  }
});

test('reads retain their safe session-refresh retry and 15s deadline', async () => {
  let count = 0;
  const c = client(async (payload, _, timeout) => {
    if (payload.method !== 'tools/call') return {};
    assert.equal(timeout, 15000);
    if (++count === 1) throw new Error('Ombre MCP failed: HTTP 404');
    return { result: { content: [] } };
  });
  await c.call('breath_advanced');
  assert.equal(count, 2);
});

test('dream hold no longer sends fusion-only auto/source fields', async () => {
  const calls = [];
  const c = client(async (payload) => { calls.push(payload.params); return { result: { content: [] } }; });
  await c.storeDream({ dream: 'fixture', residue: 'fixture', awareness: 'fixture' });
  assert.deepEqual(Object.keys(calls[0].arguments).sort(), ['content', 'importance', 'tags']);
});

test('completed long write without ID is persisted, duplicates and restart do not resend', async () => {
  const b = await box(), item = await b.put({ text: 'fictional protocol fixture' });
  let calls = 0;
  const write = async () => { calls++; return success; };
  assert.equal((await b.keep(item.id, write)).status, 'completed');
  assert.equal((await b.read(item.id)).kept.bucketId, null);
  assert.equal((await b.keep(item.id, write)).reused, true);
  assert.equal((await new BlackBox(b.store.path).keep(item.id, write)).reused, true);
  assert.equal(calls, 1);
});

test('concurrent keep calls cannot send two writes for the same item', async () => {
  const b = await box(), item = await b.put({ text: 'fixture' });
  let calls = 0, release;
  const barrier = new Promise((r) => { release = r; });
  const first = b.keep(item.id, async () => { calls++; await barrier; return success; });
  // Queue behind the first claim, not behind its remote response.
  await b.store.update((state) => state);
  const duplicate = await b.keep(item.id, async () => { calls++; return success; });
  assert.equal(duplicate.status, 'uncertain');
  release(); await first;
  assert.equal(calls, 1);
});

test('lost response, partial success, and crash after claim stay fenced across restart', async () => {
  for (const outcome of ['lost', 'partial', 'crash']) {
    const b = await box(), item = await b.put({ text: 'fixture' });
    if (outcome === 'crash') {
      await b.store.update((state) => { state.items[0].keepWrite = { status: 'pending' }; return state; });
    } else {
      await b.keep(item.id, async () => {
        if (outcome === 'lost') throw new Error('response lost after server wrote');
        return { ...success, status: 'partial', saved: 1 };
      });
    }
    let calls = 0;
    const receipt = await new BlackBox(b.store.path).keep(item.id, async () => { calls++; return success; });
    assert.notEqual(receipt.status, 'completed');
    assert.equal(calls, 0);
    assert.equal((await b.read(item.id)).kept, null);
    assert.match(renderBoxList(await b.list()), /待核验/);
    const audit = JSON.parse(await readFile(b.store.path)).audit;
    assert.ok(audit.every((entry) => !('text' in entry)));
  }
});
