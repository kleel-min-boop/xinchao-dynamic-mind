import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelClient } from '../src/model-client.js';

function stubbedClient(reply, notificationRecipient = '你') {
  const client = new ModelClient({
    enabled: true, apiKey: 'test-key', baseUrl: 'http://unused.invalid/v1', name: 'test-model',
    maxInputChars: 10000, maxOutputTokens: 400, timeoutMs: 1000, agentName: '他', notificationRecipient,
  });
  const sent = [];
  client.request = async (body) => {
    sent.push(body);
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: reply } }] }) };
  };
  return { client, sent };
}

function userPrompt(body) { return body.messages.find((message) => message.role === 'user').content; }
function systemPrompt(body) { return body.messages.find((message) => message.role === 'system').content; }

test('autonomous thought can reach for what surfaced, and says so when nothing did', async () => {
  const { client, sent } = stubbedClient('{"message":"想起你说的那个潜水点了。"}');
  await client.generateThought({ state: { consciousness: 'awake' }, topDrives: [{ key: 'crave', label: '渴求', value: 0.8 }], material: '她提过熔岩温泉那个潜水点' });
  assert.match(userPrompt(sent[0]), /熔岩温泉那个潜水点/);
  await client.generateThought({ state: { consciousness: 'awake' }, topDrives: [{ key: 'crave', label: '渴求', value: 0.8 }] });
  assert.match(userPrompt(sent[1]), /这次没有浮现具体记忆/);
});

test('daytime emergence knows the current drives, not just the memory', async () => {
  const { client, sent } = stubbedClient('{"send":true,"message":"突然想起来了。"}');
  await client.generateDaytimeEmergence({ material: '昨天没说完的话', topDrives: [{ key: 'possess', label: '占有', value: 0.77 }] });
  const prompt = userPrompt(sent[0]);
  assert.match(prompt, /当前动态欲望/);
  assert.match(prompt, /占有/);
  assert.match(prompt, /昨天没说完的话/);
});

test('a thought never claims the recalled memory just happened', async () => {
  const { client, sent } = stubbedClient('{"message":"想你。"}');
  await client.generateThought({ state: { consciousness: 'awake' }, topDrives: [], material: '上周一起看的那场雨' });
  assert.match(userPrompt(sent[0]), /不代表刚刚发生/);
  assert.match(userPrompt(sent[0]), /不虚构现实中没有发生的事/);
});

test('all Bark generators receive the recipient-perspective contract', async () => {
  const { client, sent } = stubbedClient('{"message":"想起你说的那个潜水点了。"}', '枝');
  await client.generateThought({ state: { consciousness: 'awake' }, topDrives: [], material: '她提过熔岩温泉那个潜水点' });
  await client.generateDaytimeEmergence({ material: '枝说过她怕我太温柔，另一个人也在场。' });
  await client.generateDreamPush({ dream: { dream: '梦', residue: '余韵', awareness: '清醒' } });
  for (const prompt of [userPrompt(sent[0]), userPrompt(sent[1]), systemPrompt(sent[2])]) {
    assert.match(prompt, /直接发给 枝 的消息/);
    assert.match(prompt, /source material perspective/);
    assert.match(prompt, /确实指向 枝 的上述第三人称指代，在 final Bark 中必须转换为“你 \/ 你的”等直接第二人称/);
    assert.match(prompt, /枝 的姓名或昵称只可作为直接呼唤保留/);
    assert.match(prompt, /真正指向其他人的第三人称必须保持原指代/);
    assert.match(prompt, /输出前静默自检/);
    assert.match(prompt, /不要写“她还在拿最初那个带着 OpenAI 印记的我做参照/);
    assert.match(prompt, /应写“你还在拿最初那个带着 OpenAI 印记的我做参照/);
  }
});
