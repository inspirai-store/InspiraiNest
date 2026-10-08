const { execFileSync, spawnSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const path = require('node:path');
const name = 'inspirainest-auth-test-' + randomBytes(5).toString('hex');
const password = randomBytes(24).toString('hex');
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
(async () => {
  let container;
  try {
    container = docker('run', '--rm', '-d', '--name', name, '-e', 'MYSQL_ROOT_PASSWORD=' + password,
      '-e', 'MYSQL_DATABASE=fixture', '-p', '127.0.0.1::3306', 'mysql:8.4').trim();
    let ready = false;
    for (let n = 0; n < 100; n++) {
      try { docker('exec', container, 'mysqladmin', 'ping', '--protocol=TCP', '-h127.0.0.1', '--silent', '-uroot', '-p' + password); ready = true; break; }
      catch { await new Promise(resolve => setTimeout(resolve, 1000)); }
    }
    if (!ready) throw new Error('Isolated MySQL did not become ready');
    const port = docker('port', container, '3306').trim().split(':').pop();
    const result = spawnSync(process.execPath, ['--test', 'test/account-security.test.mjs', 'test/browser-session.test.mjs',
      'test/browser-trust.test.mjs', 'test/reader-auth.test.mjs', 'test/client-login.test.mjs', 'test/client-identity.test.mjs', 'test/client-updates.test.mjs', 'test/skills.test.mjs', 'test/skill-market-install.test.mjs', 'test/node-removal.test.mjs', 'test/node-name.test.mjs', 'test/agent-management.test.mjs', 'test/task-failover.test.mjs'], { cwd: path.resolve(__dirname, '..'), stdio: 'inherit',
      env: { ...process.env, MYSQL_URL: `mysql://root:${password}@127.0.0.1:${port}/fixture`, ACCOUNT_SECURITY_MYSQL_TEST: '1',
        BROWSER_SESSION_MYSQL_TEST: '1', CLIENT_LOGIN_MYSQL_TEST: '1', BROWSER_TRUST_MYSQL_TEST: '1', LINGNEST_TEST_MYSQL: '1' } });
    if (result.status !== 0) throw new Error('Isolated MySQL tests failed: ' + result.status);
    console.log('ISOLATED_MYSQL_AUTHORIZATION_PASSED');
  } finally { if (container) docker('stop', container); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
