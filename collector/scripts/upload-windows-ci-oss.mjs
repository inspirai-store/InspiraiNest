import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..'), dist = path.resolve(root, '../artifacts/desktop');
const required = name => { assert.ok(process.env[name], `Missing ${name}`); return process.env[name]; };
const sha = (bytes, kind = 'sha256', format = 'hex') => createHash(kind).update(bytes).digest(format);
function gh(args) {
  const result = spawnSync('gh', args, { encoding: 'utf8', timeout: 30000, windowsHide: true });
  assert.equal(result.status, 0, 'GitHub verification failed'); return JSON.parse(result.stdout);
}
async function validate() {
  const commit = process.env.WINDOWS_SOURCE_COMMIT || required('GITHUB_SHA');
  let run = process.env.WINDOWS_CI_RUN;
  if (!run) {
    const runs = gh(['api', `repos/${required('GITHUB_REPOSITORY')}/actions/workflows/collector-build.yml/runs?branch=main&head_sha=${commit}&status=success&per_page=30`]).workflow_runs;
    run = String(runs.find(item => item.head_sha === commit && item.head_repository.full_name === process.env.GITHUB_REPOSITORY)?.id || '');
    assert.ok(run, 'Run normal main-branch CI successfully for this exact commit before a formal release');
  }
  assert.match(run, /^[0-9]+$/); assert.match(commit, /^[a-f0-9]{40}$/);
  const repository = required('GITHUB_REPOSITORY'), info = gh(['api', `repos/${repository}/actions/runs/${run}`]);
  assert.equal(info.head_branch, 'main'); assert.equal(info.head_sha, commit); assert.equal(info.conclusion, 'success');
  assert.equal(info.path, '.github/workflows/collector-build.yml'); assert.equal(info.head_repository.full_name, repository);
  const ancestry = spawnSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], { windowsHide: true });
  assert.equal(ancestry.status, 0, 'CI source must belong to reviewed main history');
  const source = spawnSync('git', ['show', commit + ':collector/package.json'], { encoding: 'utf8', windowsHide: true });
  assert.equal(source.status, 0); const version = JSON.parse(source.stdout).version;
  assert.equal(version, JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version);
  const artifacts = gh(['api', `repos/${repository}/actions/runs/${run}/artifacts`]).artifacts;
  const artifact = artifacts.find(a => a.name === 'InspiraiNest-Windows-x64' && !a.expired);
  assert.ok(artifact); assert.match(artifact.digest, /^sha256:[a-f0-9]{64}$/);
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, 'ci-source.json'), JSON.stringify({ version, commit, sourceCI: run, artifactId: artifact.id, artifactDigest: artifact.digest }));
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `source_run=${run}\nsource_commit=${commit}\n`);
  console.log('Verified main-branch Windows CI source and artifact identity.');
}
async function upload() {
  const { default: OSS } = await import('ali-oss'), { default: yaml } = await import('js-yaml');
  const input = JSON.parse(fs.readFileSync(path.join(dist, 'ci-source.json'))), name = `InspiraiNest-v${input.version}-Windows-x64.exe`;
  assert.match(input.version, /^\d+\.\d+\.\d+$/); assert.match(input.commit, /^[a-f0-9]{40}$/);
  const bytes = fs.readFileSync(path.join(dist, name)); assert.equal(bytes.subarray(0, 2).toString(), 'MZ');
  assert.equal(fs.readFileSync(path.join(dist, name + '.sha256'), 'utf8').trim(), sha(bytes));
  const feed = yaml.load(fs.readFileSync(path.join(dist, 'latest.yml'), 'utf8')), file = feed.files.find(f => f.url === name);
  assert.equal(feed.version, input.version); assert.equal(file.size, bytes.length); assert.equal(file.sha512, sha(bytes, 'sha512', 'base64'));
  const run = required('OSS_RELEASE_RUN_ID'); assert.match(run, /^\d+-\d+$/);
  const prefix = `releases/windows/v${input.version}/${run}`, client = new OSS({ region: required('OSS_RELEASE_REGION'), bucket: required('OSS_RELEASE_BUCKET'), accessKeyId: required('OSS_RELEASE_ACCESS_KEY_ID'), accessKeySecret: required('OSS_RELEASE_ACCESS_KEY_SECRET'), secure: true, timeout: 300000 });
  const assets = [];
  async function put(key, body, digest, size) {
    try { await client.put(key, body, { headers: { 'x-oss-forbid-overwrite': 'true', 'x-oss-object-acl': 'private' }, meta: { sha256: digest } }); }
    catch (error) { if (error.code !== 'FileAlreadyExists') throw error; }
    const result = await client.getStream(key), hash = createHash('sha256'); let count = 0;
    for await (const chunk of result.stream) { count += chunk.length; hash.update(chunk); }
    assert.equal(count, size); assert.equal(hash.digest('hex'), digest); console.log('Verified private Windows release object: ' + key);
  }
  for (const filename of [name, name + '.sha256', name + '.blockmap', 'latest.yml']) {
    const file = path.join(dist, filename), b = fs.readFileSync(file), asset = { name: filename, key: prefix + '/' + filename, size: b.length, sha256: sha(b) };
    assert.ok(asset.size > 0); await put(asset.key, file, asset.sha256, asset.size); assets.push(asset);
  }
  const receipt = Buffer.from(JSON.stringify({ ...input, run, assets }, null, 2) + '\n');
  await put(prefix + '/release.json', receipt, sha(receipt), receipt.length);
}
try {
  if (process.argv[2] === 'validate') await validate(); else if (process.argv[2] === 'upload') await upload(); else throw new Error('Specify validate or upload');
} catch (error) {
  // OSS exceptions can include signed request headers. Return a bounded diagnostic.
  console.error(`Windows CI relay failed: ${error.code || error.name}`); process.exitCode = 1;
}
