import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const run=process.env.MACOS_CI_RUN,commit=process.env.MACOS_SOURCE_COMMIT,repo=process.env.GITHUB_REPOSITORY;
assert.match(run??'',/^\d+$/);assert.match(commit??'',/^[a-f0-9]{40}$/);assert.equal(repo,'inspirai-store/InspiraiNest');
function gh(path){const result=spawnSync('gh',['api',path],{encoding:'utf8',timeout:30000});assert.equal(result.status,0,'GitHub source verification failed');return JSON.parse(result.stdout);}
const info=gh(`repos/${repo}/actions/runs/${run}`);
assert.equal(info.head_branch,'main');assert.equal(info.head_sha,commit);assert.equal(info.head_repository.full_name,repo);assert.equal(info.conclusion,'success');assert.equal(info.path,'.github/workflows/collector-release.yml');
assert.equal(spawnSync('git',['merge-base','--is-ancestor',commit,'HEAD']).status,0);
const source=spawnSync('git',['show',commit+':collector/package.json'],{encoding:'utf8'});assert.equal(source.status,0);
const version=JSON.parse(source.stdout).version;assert.equal(version,JSON.parse(fs.readFileSync('collector/package.json')).version);
const jobs=gh(`repos/${repo}/actions/runs/${run}/jobs`).jobs;
const signed=jobs.find(job=>job.name==='signed-macos');assert.equal(signed?.conclusion,'success');
assert.equal(signed.steps.find(step=>step.name==='Verify signatures, both architectures and update metadata')?.conclusion,'success');
const artifacts=gh(`repos/${repo}/actions/runs/${run}/artifacts`).artifacts;
const artifact=artifacts.find(item=>item.name===`InspiraiNest-macOS-local-${run}`&&!item.expired);assert.ok(artifact);assert.match(artifact.digest,/^sha256:[a-f0-9]{64}$/);
fs.writeFileSync('macos-ci-source.json',JSON.stringify({version,commit,run,artifactId:artifact.id,artifactDigest:artifact.digest},null,2));
console.log('Verified successful main-branch macOS signing, notarization and retained artifact.');
