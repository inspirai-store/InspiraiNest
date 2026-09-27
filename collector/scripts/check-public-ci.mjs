import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const directory = fileURLToPath(new URL('../../.github/workflows/', import.meta.url));
for (const file of fs.readdirSync(directory).filter(name => /\.ya?ml$/.test(name))) {
  const source = fs.readFileSync(path.join(directory, file), 'utf8');
  const workflow = yaml.load(source);
  if (file === 'collector-release.yml') {
    if (Object.keys(workflow.on).join() !== 'workflow_dispatch') throw new Error('Release must be manual only');
    for (const job of Object.values(workflow.jobs)) {
      if (job.environment !== 'signed-release' || !job.if?.includes("github.ref == 'refs/heads/master'") || !job.if?.includes("vars.ENABLE_SIGNED_RELEASE == 'true'")) throw new Error('Release job lacks explicit enablement, branch or environment guard');
    }
    continue;
  }
  if (/secrets\s*(?:\.|\[)|contents:\s*write|id-token:\s*write|pull_request_target|workflow_run|self-hosted/i.test(source)) throw new Error(`Privileged capability in public CI: ${file}`);
  if (workflow.permissions?.contents !== 'read') throw new Error(`Public CI must use read-only contents: ${file}`);
  if (Object.values(workflow.permissions).some(value => !['read', 'none'].includes(value))) throw new Error(`Public workflow requests write permissions: ${file}`);
  for (const job of Object.values(workflow.jobs)) {
    if (job.permissions && (typeof job.permissions !== 'object' || Object.values(job.permissions).some(value => !['read', 'none'].includes(value)))) throw new Error(`Public job requests write permissions: ${file}`);
    if (job.environment) throw new Error(`Environment credentials must not be accessible: ${file}`);
    for (const step of job.steps || []) {
      if (step.uses?.startsWith('actions/checkout@') && step.with?.['persist-credentials'] !== false) throw new Error(`Checkout credentials must not persist: ${file}`);
    }
  }
}
console.log('CI boundaries checked: public workflows have no signing/release capabilities.');
