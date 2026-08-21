'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  inferAgentProvider,
  isAgentProvider,
  providerPreset
} = loadTs('src/shared/agentProvider.ts');
const {
  buildSpawnCommand,
  decodeProviderModel,
  encodeProviderModel,
  modelProvidersForAgent,
  modelsForProvider
} = loadTs('src/renderer/src/store/config.ts');

const autoConfig = { defaultCommand: 'claude', autoMode: true };

test('Kimi is a first-class inferred provider with autonomous defaults', () => {
  assert.equal(isAgentProvider('kimi'), true);
  assert.equal(inferAgentProvider('kimi --auto'), 'kimi');
  const preset = providerPreset('kimi');
  assert.equal(preset.defaultCommand, 'kimi');
  // `--auto` was asserted here for as long as the preset carried it, and both
  // were wrong: kimi-cli answers `No such option: --auto` and exits, so this test
  // was pinning the flag that killed every auto-mode kimi spawn. Verified against
  // the installed binary.
  assert.equal(preset.autoFlag, '--auto-approve');
  assert.equal(preset.supportsModel, true);
  // Kimi has no hooks, but it does not need them: routed mail arrives as a
  // terminal work order typed into its live TUI. See test/kimi-inbox.test.cjs.
  assert.equal(preset.canReceiveInbox, true);
  assert.equal(preset.initialPromptFlag, '--prompt');
  assert.equal(preset.positionalInitialPrompt, undefined);
});

test('Grok is a first-class inferred provider with hooks, resume, and always-approve', () => {
  assert.equal(isAgentProvider('grok'), true);
  assert.equal(inferAgentProvider('/Users/test/.local/bin/grok --model grok-4.5'), 'grok');
  const preset = providerPreset('grok');
  assert.equal(preset.defaultCommand, 'grok');
  assert.equal(preset.autoFlag, '--permission-mode bypassPermissions');
  assert.equal(preset.supportsModel, true);
  assert.equal(preset.canReceiveInbox, true);
  assert.equal(preset.hookBridge, 'grok');
  assert.equal(preset.positionalInitialPrompt, true);
  assert.equal(preset.resumeFlag, '--resume');
});

test('provider commands use matching models and equivalent bypass modes', () => {
  assert.equal(
    buildSpawnCommand(autoConfig, 'claude-sonnet-5', 'claude'),
    'claude --model claude-sonnet-5 --permission-mode bypassPermissions'
  );
  assert.equal(
    buildSpawnCommand(autoConfig, 'gpt-5.6-sol', 'codex'),
    'codex --model gpt-5.6-sol --dangerously-bypass-approvals-and-sandbox'
  );
  assert.equal(
    buildSpawnCommand(autoConfig, 'grok-4.5', 'grok'),
    'grok --model grok-4.5 --permission-mode bypassPermissions'
  );
  assert.equal(
    buildSpawnCommand(autoConfig, 'kimi-code/k3', 'kimi'),
    'kimi --model kimi-code/k3 --auto-approve'
  );
});

test('model picker options stay provider-specific', () => {
  assert.equal(
    modelsForProvider('claude').find((model) => model.id === 'claude-opus-5')?.label,
    'Opus 5 · 1M'
  );
  assert.deepEqual(
    modelsForProvider('codex').map((model) => model.id),
    [undefined, 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']
  );
  assert.deepEqual(
    modelsForProvider('grok').map((model) => model.id),
    [undefined, 'grok-4.6', 'grok-4.5']
  );
  assert.deepEqual(
    modelsForProvider('kimi').map((model) => model.id),
    [
      undefined,
      'kimi-code/k3',
      'kimi-code/kimi-for-coding',
      'kimi-code/kimi-for-coding-highspeed'
    ]
  );
  assert.deepEqual(modelsForProvider('custom'), []);
});

test('Command Center model choices round-trip provider and model', () => {
  const encoded = encodeProviderModel('antigravity', 'Gemini 3.1 Pro (High)');
  assert.deepEqual(
    decodeProviderModel(encoded),
    { provider: 'antigravity', model: 'Gemini 3.1 Pro (High)' }
  );
  assert.deepEqual(
    decodeProviderModel(encodeProviderModel('kimi')),
    { provider: 'kimi', model: undefined }
  );
  assert.equal(decodeProviderModel('unknown:model'), null);
});

test('God only sees providers that can drain hive inbox messages', () => {
  // God-eligible = supportsModel && canReceiveInbox. Copilot is excluded (print
  // mode exits per turn, so there is no live terminal to hand work to) and custom
  // is excluded (no model picker). Kimi joined the list once it was established
  // that it needs no hooks to be handed a terminal work order.
  assert.deepEqual(
    modelProvidersForAgent(true).map((preset) => preset.id),
    ['claude', 'codex', 'grok', 'kimi', 'antigravity', 'qwen', 'opencode', 'crush', 'pi']
  );
  assert.deepEqual(
    modelProvidersForAgent(false).map((preset) => preset.id),
    ['claude', 'codex', 'grok', 'kimi', 'antigravity', 'qwen', 'opencode', 'crush', 'pi', 'copilot']
  );
});
