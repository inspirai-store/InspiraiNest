import test from 'node:test';
import assert from 'node:assert/strict';
import { agentEnvironment, execute } from '../src/agents.mjs';

test('spawned agents cannot inherit deployment and pairing credentials', async () => {
  const env = agentEnvironment({ ...process.env, COLLECTOR_MASTER_KEY: 'fixture-admin',
    COLLECTOR_PAIR_KEY: 'fixture-pair', OSS_ACCESS_KEY_SECRET: 'fixture-oss', MYSQL_URL: 'fixture-db',
    GH_TOKEN: 'fixture-github', CSC_KEY_PASSWORD: 'fixture-signing', APPLE_ID: 'fixture-apple',
    LIBRARY_SIGNING_PASSWORD: 'fixture-android', SAFE_AGENT_TEST: 'visible' });
  const result = await execute(process.execPath, ['-e', `console.log(JSON.stringify({
    safe: process.env.SAFE_AGENT_TEST,
    leaked: ['COLLECTOR_MASTER_KEY','COLLECTOR_PAIR_KEY','OSS_ACCESS_KEY_SECRET','MYSQL_URL',
      'GH_TOKEN','CSC_KEY_PASSWORD','APPLE_ID','LIBRARY_SIGNING_PASSWORD'].filter(k => process.env[k])
  }))`], { env });
  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.tail), { safe: 'visible', leaked: [] });
});
