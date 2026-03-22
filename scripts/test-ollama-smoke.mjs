import assert from 'node:assert/strict';
import {
  canReachOllama,
  collectOllamaBaseUrlCandidates,
  parseOllamaHarnessOptions,
  requestJsonNoAuth,
  resolveOllamaHarness,
} from './lib/harness-utils.mjs';

const options = parseOllamaHarnessOptions(process.argv.slice(2));

if (options.listCandidates) {
  const candidates = collectOllamaBaseUrlCandidates(options);
  console.log('Ollama harness candidates:');
  for (const candidate of candidates) {
    try {
      const models = await canReachOllama(candidate);
      console.log(`- ${candidate} -> reachable (${models.length} models)`);
    } catch (error) {
      console.log(`- ${candidate} -> unreachable (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  process.exit(0);
}

const harness = await resolveOllamaHarness(options);

try {
  const response = await requestJsonNoAuth(`${harness.baseUrl}/v1/chat/completions`, 'POST', {
    model: harness.model,
    temperature: 0,
    messages: [
      { role: 'system', content: 'You are a terse harness model.' },
      { role: 'user', content: 'Reply with the single word ready.' },
    ],
  }, 30_000);

  const content = response?.choices?.[0]?.message?.content;
  assert.equal(typeof content, 'string', 'Ollama chat completion did not return assistant text.');
  assert.ok(content.trim().length > 0, 'Ollama chat completion returned empty content.');

  console.log('Ollama smoke passed.');
  console.log(`- Base URL: ${harness.baseUrl}`);
  console.log(`- Model: ${harness.model}`);
  console.log(`- Installed models seen: ${harness.models.length}`);
  console.log(`- Response preview: ${content.trim().slice(0, 120)}`);
} finally {
  await harness.close();
}

