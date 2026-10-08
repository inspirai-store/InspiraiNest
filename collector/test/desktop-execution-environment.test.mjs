import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { desktopExecutionEnvironment } from '../desktop/execution-environment.mjs';
import { execute } from '../src/agents.mjs';
import { scanSkillInventory } from '../src/skill-inventory.mjs';

test('Mac GUI worker discovers all five CLIs from the user shell with a restricted launch PATH', { skip: process.platform !== 'darwin' }, async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lingnest-cli-path-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const bin = path.join(home, 'tools with spaces'); fs.mkdirSync(bin);
  const names = ['codex', 'codebuddy', 'claude', 'gemini', 'opencode'];
  for (const name of names) fs.writeFileSync(path.join(bin, name), '#!/bin/sh\nprintf "fixture 1.0\\n"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(home, '.zshrc'), 'export PATH=' + JSON.stringify(bin) + ':$PATH\nexport NEVER_IMPORT_FROM_SHELL=fixture\n');
  const original = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: home, ZDOTDIR: home, SHELL: '/bin/zsh', COLLECTOR_ELECTRON_NODE: '1' };
  assert.equal((await execute('codex', ['--version'], { env: original })).spawnError, 'ENOENT');
  const env = await desktopExecutionEnvironment(original);
  assert.equal(env.NEVER_IMPORT_FROM_SHELL, undefined);
  assert.equal(original.PATH, '/usr/bin:/bin:/usr/sbin:/sbin');
  for (const name of names) assert.equal((await execute(name, ['--version'], { env })).code, 0);
  const { inventory } = await scanSkillInventory({}, { cwd: home, home, env, nativeCodex: async () => null });
  assert.deepEqual(inventory.agents.map(a => [a.name, a.installed, a.probeState]), names.map(name => [name, true, 'available']));
});

test('shell PATH recovery strips service credentials and ignores banner output and exported values', async () => {
  const source = { PATH: '/custom:/usr/bin', SHELL: '/bin/zsh', COLLECTOR_ELECTRON_NODE: '1', OSS_ACCESS_KEY_SECRET: 'fixture-secret', ELECTRON_RUN_AS_NODE: '1' };
  const env = await desktopExecutionEnvironment(source, { platform: 'darwin', execute: async (_shell, _args, options) => {
    assert.equal(options.env.OSS_ACCESS_KEY_SECRET, undefined);
    assert.equal(options.env.ELECTRON_RUN_AS_NODE, undefined);
    assert.equal(options.timeout, 5000);
    return { stdout: 'banner\n\0LINGNEST_EXECUTION_PATH\0/tools:/usr/bin:relative::/tools\0\nSECRET=never-import' };
  } });
  assert.equal(env.PATH, '/custom:/usr/bin:/tools');
  assert.equal(env.OSS_ACCESS_KEY_SECRET, 'fixture-secret'); // Existing Worker environment stays authoritative.
  assert.equal(env.SECRET, undefined);
});

test('shell failure, timeout or malformed output preserves the existing worker environment', async () => {
  const source = { PATH: '/explicit', SHELL: '/bin/zsh', COLLECTOR_ELECTRON_NODE: '1' };
  for (const execute of [async () => { throw Error('timeout'); }, async () => ({ stdout: 'unrelated startup output' }), async () => ({ stdout: '\0LINGNEST_EXECUTION_PATH\0/tools\n/unsafe\0' })])
    assert.deepEqual(await desktopExecutionEnvironment(source, { platform: 'darwin', execute }), source);
  for (const platform of ['linux', 'win32']) assert.deepEqual(await desktopExecutionEnvironment(source, { platform, execute: () => { throw Error('must not run shell'); } }), source);
});
