import fs from 'node:fs';
import path from 'node:path';
import {atomicJson,readJson,requireValue,hash,id,safePath,contained} from '../../../packages/core/node/common.mjs';
import {prepareRecordInput,recordPrompt,preserveRecordOriginal} from '../../../packages/core/node/record-input.mjs';
import {prepareTaskInput,taskInputPrompt,verifyInputCoverage} from '../../../packages/core/node/task-input.mjs';
import {packageEntry} from '../../../packages/core/node/archive.mjs';
import {nodeFailureCodes} from '../../../packages/core/node/task-routing.mjs';
import {watchCollectionSteps} from '../../../packages/core/node/collection-steps.mjs';
import {errorDetails} from '../../../packages/core/node/worker-events.mjs';
import {agentOrder,runAgent,execute,unavailableBeforeWork,describeAgentFailure} from './agents.mjs';
import {taskSkillSnapshots} from './skill-runtime.mjs';
import {fixedSkillProfiles} from '../server/skill-inventory.mjs';
export async function processCollection(config, task, available, signal, onProgress, {api,prepareWorkspace,taskPrompt,extensions=[]}) {
  const dataDir = path.resolve(config.dataDir);
  const workspace = prepareWorkspace(task,dataDir);
  await prepareRecordInput(config,task,workspace,signal);
  await prepareTaskInput(config,task,workspace,signal);
  const skillSnapshots = await taskSkillSnapshots(task, workspace, (...args) => api(config, ...args));
  const checkpoint = path.join(workspace, 'collector-result.json');
  const progress = async (state, message, agent, diagnostic) => {
    onProgress({ state, message, agent, ...(diagnostic ? { diagnostic } : {}) });
    const result = await api(config, `/api/tasks/${task.id}/progress`, 'POST', { state, message, agent,
      ...(state === 'waiting_action' && nodeFailureCodes.has(diagnostic?.code) ? { failureCode: diagnostic.code } : {}),
      executionSkills: skillSnapshots.filter(s => s.agent === agent).map(({path,...s}) => s) }, task.assignmentId);
    if (result.state === 'queued' && result.deviceId === null) onProgress({ state: 'queued', message: '本机无法完成，任务已转交其他工作节点；本机文件保留', agent });
    return result;
  };
  if (fs.existsSync(checkpoint) && readJson(checkpoint).status !== 'ready') {
    fs.renameSync(checkpoint, path.join(workspace, `collector-result.${id()}.json`));
  }
  let chosen = task.agent;
  if (!fs.existsSync(checkpoint)) {
    for (const name of agentOrder(config, task, available)) {
      chosen = name;
      await progress('running', `使用 ${name} 采集；本机保留中间成果`, name);
      const instructions = [...extensions.map(extension=>extension.collectionInstructions?.(task)), config.instructions, config.agents?.[name]?.instructions, ...skillSnapshots.filter(s => s.agent === name).map(s => `本任务必须使用固定技能 ${s.path}/SKILL.md，版本 ${s.versionId}，包哈希 ${s.hash}；先读取该文件，不使用其他目录中的同名版本。`)].filter(Boolean).join('\n');
      const stopSteps = watchCollectionSteps(workspace, step => onProgress({ state: 'running', agent: name, ...step }), error => onProgress({ state: 'running', agent: name,
        message: error.code === 'STEP_ENCODING' ? '采集程序的阶段记录存在乱码，请改用 UTF-8 写入；执行继续，上传前再次校验' : '采集进度文件暂时不可读，执行仍在继续', diagnostic: { code: error.code === 'STEP_ENCODING' ? 'STEP_ENCODING' : 'STEP_LOG_READ', details: errorDetails(error) } }));
      let result;
      try { const profiles=await fixedSkillProfiles(config.agents || {},skillSnapshots.filter(s=>s.agent===name),workspace); result = await runAgent(name, profiles, { cwd: workspace, prompt: taskPrompt(task, instructions) + recordPrompt(task) + taskInputPrompt(task), signal, timeoutMs: config.taskTimeoutMs || 60 * 60 * 1000 }); }
      finally { stopSteps(); }
      if (result.aborted) return;
      if (result.permissionBlocked) { await progress('waiting_action', `${name} 的非交互权限不足，已停止执行。请在本机客户端配置权限后继续。`, name, { code: 'AGENT_PERMISSION', details: { agent: name } }); return; }
      // Only failure to start can fall back automatically. Do not repeat a partially executed task on another agent.
      if (unavailableBeforeWork(result)) { await progress('running', `${name} 启动不可用，尝试已配置的候选 Agent`, name, { code: 'AGENT_START', details: { agent: name, exitCode: result.code, spawnError: result.spawnError || null } }); continue; }
      if (result.timedOut) { await progress('waiting_action', '采集程序执行超时，成果已保留。请展开执行详情检查后继续。', name, { code: 'AGENT_TIMEOUT', details: { timeoutMs: config.taskTimeoutMs || 60 * 60 * 1000 } }); return; }
      if (result.code !== 0) { const diagnostic = describeAgentFailure(name, result); await progress('waiting_action', diagnostic.message, name, diagnostic); return; }
      break;
    }
  }
  if (!fs.existsSync(checkpoint)) { await progress('waiting_action', '采集程序未生成结果文件，请检查本机程序配置、权限或执行详情。', chosen, { code: 'AGENT_RESULT', details: { expectedFile: 'collector-result.json' } }); return; }
  const result = readJson(checkpoint);
  if (result.status === 'waiting_action') { await progress('waiting_action', String(result.message || '需要本机操作').slice(0, 1000), chosen,
    result.category === 'environment' && !task.inputAttachments?.length ? { code: 'AGENT_ENVIRONMENT', details: { source: '采集程序上报的本机环境问题' } } : undefined); return; }
  requireValue(result.status === 'ready', 'Invalid Agent result');
  safePath(result.entry);
  const entryRoot = fs.realpathSync(path.join(workspace, result.entry));
  requireValue(contained(fs.realpathSync(workspace), entryRoot), 'Result outside task workspace');
  preserveRecordOriginal(task,entryRoot);
  try { verifyInputCoverage(task,workspace,entryRoot); }
  catch(error) {
    fs.renameSync(checkpoint,path.join(workspace,`collector-result.${id()}.json`));
    await progress('waiting_action',`附件解析未完成，原件和已有成果已保留。${error.status ? error.message : '请补齐逐文件正文与解析清单后继续原任务。'}`.slice(0,1000),chosen); return;
  }
  if(task.recordSnapshot || task.inputAttachments?.length){const build=await execute(process.execPath,['scripts/catalog.mjs','build'],{cwd:workspace});requireValue(build.code===0,'Result indexes could not be rebuilt');}
  onProgress({ state: 'validating', message: '正在校验本机资料与文件清单', agent: chosen });
  const check = await execute(process.execPath, ['scripts/catalog.mjs', 'check'], { cwd: workspace });
  requireValue(check.code === 0, 'Catalog validation failed; inspect local entry and rebuild its indexes');
  let bundle;
  try { bundle = packageEntry(entryRoot); }
  catch (error) {
    if (error.code !== 'ARCHIVE_ENCODING') throw error;
    const fields = { title: '标题', summary: '摘要', coverage_note: '采集说明', tags: '标签' };
    await progress('waiting_action', `本机资料的${fields[error.field] || '文字'}含乱码，已在上传前拦截。请修复 source.json 后继续原任务；视频和转录保留本机。`, chosen,
      { code: 'ARCHIVE_ENCODING', details: { field: error.field, file: path.join(result.entry, 'source.json'), message: '中文已被问号或替换字符破坏，需要从原始内容恢复，单纯更改读取编码不能还原' } });
    return;
  }
  requireValue(typeof bundle.meta.collected_at === 'string' && bundle.meta.collected_at.includes('T'), 'New collections require second-resolution timestamps');
  await progress('uploading', '轻量资料校验通过，正在上传', chosen);
  for(const extension of extensions)await extension.afterCollect?.({config,task,workspace,api});
  await api(config, `/api/tasks/${task.id}/result`, 'POST', bundle, task.assignmentId);
  atomicJson(path.join(workspace, '..', 'uploaded.json'), { entry: result.entry, digest: hash(JSON.stringify(bundle)) });
  onProgress({ state: task.autoArchive === false ? 'awaiting_review' : 'completed', message: task.autoArchive === false ? '轻量包已上传，等待远端确认归档' : '归档上传完成；原媒体保留本机', agent: chosen });
}
