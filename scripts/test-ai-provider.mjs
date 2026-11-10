import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

function fixture({ events, status = 200 } = {}) {
  const requests = [];
  const transport = { request(options, callback) {
    const req = new EventEmitter();
    req.write = body => requests.push({ ...options, body: JSON.parse(body) });
    req.destroy = () => { req.destroyed = true; response.destroy(new Error('aborted')); };
    const response = new PassThrough(); response.statusCode = status;
    req.end = () => queueMicrotask(() => {
      callback(response);
      response.end(status >= 400 ? 'permission denied' : (events || [
        { type: 'response.output_text.delta', delta: 'Hello 世界' }, { type: 'response.completed' },
      ]).map(e => `data: ${JSON.stringify(e)}\n\n`).join(''));
    });
    return req;
  } };
  function load(file) {
    const module = { exports: {} };
    const code = ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`)(name => {
      if (name === 'https' || name === 'http') return transport;
      if (name === '../shared/ai-models') return load('../src/shared/ai-models.ts');
      throw new Error(name);
    }, module, module.exports);
    return module.exports;
  }
  return { api: load('../src/main/ai-provider.ts'), requests };
}
const config = { provider: 'openai', defaultModel: 'gpt-6.1-terra', openaiApiKey: 'test-key' };
const collect = async gen => { let text = ''; for await (const chunk of gen) text += chunk; return text; };
for (const model of ['gpt-6.1-terra', 'gpt-6.1-sol', 'gpt-6-luna', 'gpt-6-astra']) {
  test(`${model}: first question and follow-up use Responses with history`, async () => {
    const { api, requests } = fixture();
    assert.equal(await collect(api.streamAI({ ...config, defaultModel: model }, { prompt: 'first' })), 'Hello 世界');
    const messages = [{ role: 'user', content: 'first' }, { role: 'assistant', content: 'old chat' }, { role: 'user', content: 'follow-up' }];
    await collect(api.streamAIChat({ ...config, defaultModel: model }, { messages, systemPrompt: 'instructions' }));
    assert.equal(requests.length, 2);
    for (const request of requests) {
      assert.equal(request.path, '/v1/responses'); assert.equal(request.body.model, model);
      assert.equal(request.body.stream, true); assert.equal(request.body.store, false);
      assert.equal('temperature' in request.body, false);
    }
    assert.deepEqual(requests[1].body.input, messages);
    assert.equal(requests[1].body.instructions, 'instructions');
  });
}
test('removed extension routes reject without sending any requests', async () => {
  const { api, requests } = fixture();
  for (const model of ['anthropic-claude-sonnet', 'claude-opus-4', 'gemini-gemini-2.5-pro', 'ollama-llama3', 'lm-studio-local']) {
    await assert.rejects(collect(api.streamAI(config, { model, prompt: 'private' })), /removed/);
  }
  assert.equal(requests.length, 0);
});
test('HTTP permission failure has no retry or fallback', async () => {
  const { api, requests } = fixture({ status: 403 });
  await assert.rejects(collect(api.streamAI(config, { prompt: 'test' })), /403/);
  assert.equal(requests.length, 1);
});
for (const event of [{ type: 'error', message: 'denied' }, { type: 'response.failed', response: { error: { message: 'denied' } } }, { type: 'response.incomplete' }]) {
  test(`Responses ${event.type} propagates`, async () => {
    const { api } = fixture({ events: [event] });
    await assert.rejects(collect(api.streamAI(config, { prompt: 'test' })), /denied|incomplete/);
  });
}
test('Custom keeps its address, model and URL option', async () => {
  const { api, requests } = fixture({ events: [] });
  await collect(api.streamAI({ ...config, provider: 'openai-compatible', defaultModel: 'openai-compatible-private', openaiCompatibleBaseUrl: 'http://private.test/api', openaiCompatibleApiKey: 'custom', openaiCompatibleAppendV1: false }, { prompt: 'test' }));
  assert.equal(requests[0].hostname, 'private.test'); assert.equal(requests[0].path, '/api/chat/completions');
  assert.equal(requests[0].body.model, 'private'); assert.equal(requests[0].headers.Authorization, 'Bearer custom');
});
