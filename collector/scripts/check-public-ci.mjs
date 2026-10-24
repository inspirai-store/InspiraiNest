import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const directory = fileURLToPath(new URL('../../.github/workflows/', import.meta.url));
for (const file of fs.readdirSync(directory).filter(name => /\.ya?ml$/.test(name))) {
  const source = fs.readFileSync(path.join(directory, file), 'utf8');
  const workflow = yaml.load(source);
  if (['collector-release.yml','collector-publish-macos.yml','desktop-channel-package.yml','desktop-publish.yml'].includes(file)) {
    const events=Object.keys(workflow.on);
    if (events.some(event=>!['workflow_dispatch',...(file==='desktop-publish.yml'?['workflow_call']:[])].includes(event)) || !events.includes('workflow_dispatch')) throw new Error('Release must originate from manual dispatch');
    for (const job of Object.values(workflow.jobs)) {
      const reusable = job.uses === './.github/workflows/desktop-publish.yml';
      if ((!reusable && job.environment !== 'signed-release') || !job.if?.includes("github.ref == 'refs/heads/main'") || !job.if?.includes("vars.ENABLE_SIGNED_RELEASE == 'true'")) throw new Error('Release job lacks explicit enablement, branch or environment guard');
      if (file==='desktop-publish.yml' && !job.if.includes("github.event_name == 'workflow_dispatch'")) throw new Error('Reusable publisher must reject non-manual events');
      const writer = reusable || (file==='desktop-publish.yml' && job===workflow.jobs.synchronize);
      if (job.permissions && Object.entries(job.permissions).some(([key,value])=>value==='write' && !(writer && key==='contents'))) throw new Error('Only the public synchronizer may write Release contents');
      for (const step of job.steps || []) if (step.uses?.startsWith('actions/checkout@') && step.with?.['persist-credentials']!==false) throw new Error('Release checkout credentials must not persist');
    }
    if (workflow.permissions?.contents !== 'read' || /pull_request_target|workflow_run|id-token:\s*write/i.test(source)) throw new Error('Release default permissions must remain read-only');
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
console.log('CI boundaries checked: regular workflows are unprivileged; formal releases require manual main-branch enablement; only the synchronizer can write Release assets.');
