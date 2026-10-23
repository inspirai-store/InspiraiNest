"""Stage the targeted increment over the actual installed bundle, retaining later creation work."""
from pathlib import Path
import json,os,re,shutil,subprocess,hashlib
root=Path(__file__).resolve().parents[2]
qa=Path('/Users/alexxiong/Documents/InspiraiNest/design-review/update-channels-031')
base=Path('/Applications/灵藏.app/Contents/Resources/app');dst=qa/'source'
frontend=qa.parent/'creation-outline-expanded/release-frontend'
if dst.exists():raise RuntimeError('Staging already exists; never overwrite a review build')
for folder in ['src','desktop']:
 shutil.copytree(base/folder,dst/folder,ignore=shutil.ignore_patterns('node_modules','dist'),symlinks=True)
shutil.copy2(base/'package.json',dst/'package.json')
shutil.copytree(frontend,dst/'desktop/frontend',dirs_exist_ok=True,symlinks=True,ignore=shutil.ignore_patterns('node_modules','dist'))
for p,target in [(dst/'node_modules',base/'node_modules'),(dst/'desktop/frontend/node_modules',frontend/'node_modules')]:
 if p.is_symlink():p.unlink()
 p.symlink_to(target.resolve(),target_is_directory=True)
for rel in ['index.html', 'download.html', 'agent-manager.js', 'skill-manager.js', 'skill-market-install.js', 'capture/index.html', 'capture/capture.js']:
 target=dst/'public'/rel;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(root/'apps/web/public'/rel,target)
mapping=json.loads((root/'tooling/layout-map.json').read_text())
reverse={v:k.removeprefix('collector/') for k,v in mapping.items() if k.startswith('collector/')}
reverse.update({**{'packages/core/node/'+n+'.mjs':'src/'+n+'.mjs' for n in ['capabilities','capability-probe','task-diagnostics']},**{'packages/core/web/diagnostics/'+n:'desktop/frontend/src/diagnostics/'+n for n in ['NodeCapabilities.tsx','TaskExecution.tsx','TaskExecution.module.css','task-client.ts','ExecutionRecords.tsx']},'packages/core/server/task-diagnostics.mjs':'src/task-diagnostics-service.mjs','packages/core/web/shared/update-safety.ts':'desktop/frontend/src/shared/update-safety.ts','apps/desktop/update-safety.mjs':'desktop/update-safety.mjs','services/api/modules/desktop-releases.mjs':'src/desktop-releases.mjs'})
changed=[]
def flatten(name):
 rel=reverse[name];text=(root/name).read_text();parent=Path(name).parent
 def replace(m):
  origin=m.group(1)
  if not origin.startswith('.'):return m.group(0)
  canonical=os.path.normpath(str(parent/origin));mapped=next((reverse.get(canonical+ext) for ext in ['', '.ts','.tsx','.mjs','.css'] if reverse.get(canonical+ext)),None)
  if mapped is None:raise RuntimeError((name,origin,canonical))
  imp=os.path.relpath(mapped,Path(rel).parent);imp=imp if imp.startswith('.') else './'+imp
  if not origin.endswith(('.ts','.tsx','.mjs','.css')):imp=re.sub(r'\.(tsx|ts)$','',imp)
  return m.group(0).replace(origin,imp)
 return rel,re.sub(r"(?:from|import)\s*['\"]([^'\"]+)['\"]",replace,text)
def replace_file(name):
 rel,text=flatten(name);p=dst/rel;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text);changed.append(rel)
def ch(file,a,b):
 p=dst/file;s=p.read_text();assert a in s,(file,a[:80]);p.write_text(s.replace(a,b));
 if file not in changed:changed.append(file)
files=['apps/desktop/updater.mjs','apps/desktop/update-safety.mjs','apps/desktop/remote-update.mjs','packages/core/shared/execution-policy.mjs','packages/core/shared/desktop-release.mjs','packages/core/node/task-routing.mjs','packages/core/node/task-diagnostics.mjs','packages/core/node/capabilities.mjs','packages/core/node/capability-probe.mjs','packages/core/node/device-metadata.mjs','packages/core/node/lingnest-tools.mjs','packages/core/server/task-diagnostics.mjs','services/api/modules/client-update-service.mjs','services/api/modules/client-download.mjs','services/api/modules/desktop-releases.mjs','plugins/ai-assistant/server/agent-catalog.mjs','plugins/ai-assistant/server/agent-service.mjs','plugins/ai-assistant/server/skill-service.mjs','plugins/ai-assistant/server/skill-package.mjs','plugins/writing/server/writing.mjs','plugins/writing/server/selection-writing.mjs','packages/core/server/records.mjs']
files+=['packages/core/web/updates/'+f for f in ['client.ts','UpdatesContent.tsx','UpdatesContent.module.css','remote-client.ts','RemoteUpdatesContent.tsx']]
files+=['packages/core/web/shared/update-safety.ts','packages/core/web/diagnostics/NodeCapabilities.tsx','packages/core/web/content/TaskCreate.tsx','packages/core/web/records/RecordDialogs.tsx','packages/core/web/records/RecordsProvider.tsx','packages/core/web/records/data/service.ts','plugins/ai-assistant/web/skills/SkillVerification.tsx','plugins/ai-assistant/web/skills/SkillVersionDetail.tsx','plugins/writing/web/selection-writing/WritingPanel.tsx']
for f in files:
 if f not in ['packages/core/web/records/RecordsProvider.tsx','packages/core/web/records/data/service.ts','packages/core/server/records.mjs']:replace_file(f)
# Preserve the source-specific permissions, extraction and newer creation runtime already in the bundle.
ch('src/agents.mjs',"import {rankExecutionAgents}","import {isExecutionAgent,assertExecutionAgent} from './execution-policy.mjs';\nimport {rankExecutionAgents}")
ch('src/agents.mjs',"  codebuddy: { enabled: false, command: 'codebuddy', args: ['-p', '--output-format', 'stream-json', '--verbose'] },\n",'')
ch('src/agents.mjs','  if (task.agent) return',"  if(task.agent&&!isExecutionAgent(task.agent)||task.preferredAgent&&!isExecutionAgent(task.preferredAgent))return [];\n  if (task.agent) return")
ch('src/agents.mjs',"config.fallbackAgents || ['codebuddy']","config.fallbackAgents || []")
ch('src/agents.mjs','.filter(name => available[name]?.available)', '.filter(name => isExecutionAgent(name)&&available[name]?.available)')
ch('src/agents.mjs','export async function runAgent(name, profiles,', 'export async function runAgent(name, profiles,')
p=dst/'src/agents.mjs';s=p.read_text();start=s.index('export async function runAgent(');body=s.index('\n',start);s=s[:body+1]+'  assertExecutionAgent(name);\n'+s[body+1:];p.write_text(s)
ch('src/worker.mjs',"fallbackAgents: ['codebuddy']",'fallbackAgents: []')
p=dst/'src/records.mjs';s="import {assertExecutionAgent} from './execution-policy.mjs';\n"+p.read_text();s=re.sub(r"requireValue\(!input\.agent\s*\|\|\s*\['codex',\s*'codebuddy'\]\.includes\(input\.agent\),\s*'[^']*'\);",'assertExecutionAgent(input.agent);',s);p.write_text(s);changed.append('src/records.mjs')
# Only apply host deltas; do not replace the newer creation store observer or outline dispatcher.
p=dst/'src/server.mjs';s=p.read_text();s="import {assertExecutionAgent,activeExecutionAgents,isExecutionAgent} from './execution-policy.mjs';\n"+s
s=re.sub(r"requireValue\(!input\.agent\s*\|\|\s*\['codex',\s*'codebuddy'\]\.includes\(input\.agent\),\s*'[^']*'\);",'assertExecutionAgent(input.agent);',s)
s=s.replace('agents: [...new Set(input.agents)]','agents: [...new Set(activeExecutionAgents(input.agents))]')
modern=(root/'services/api/server.mjs').read_text();start=modern.index("        if (['queued','failed','waiting_action'].includes(candidate.state)");end=modern.index("        if (!['assigned', 'running']",start)
s=s.replace("for (const candidate of await store.list('task')) {\n", "for (const candidate of await store.list('task')) {\n"+modern[start:end],1)
s=s.replace('approve|reassign|supplement)', 'approve|reassign|supplement|use-codex)');s=s.replace("['retry', 'cancel', 'reassign', 'supplement'].includes(action)","['retry', 'cancel', 'reassign', 'supplement','use-codex'].includes(action)")
start=modern.index("            if(action==='use-codex')");end=modern.index("            if (action === 'reassign')",start);s=s.replace("            if (action === 'reassign')",modern[start:end]+"            if (action === 'reassign')",1);p.write_text(s);changed.append('src/server.mjs')
# Target the current main process, retaining browser extension and independent capture windows.
ch('desktop/main.mjs',"import { DesktopUpdater }", "import {createUpdatePreparation} from './update-safety.mjs';\nimport { DesktopUpdater }")
ch('desktop/main.mjs','let owner, captureBrowser, updates,','let updatePreparation;\nlet owner, captureBrowser, updates,')
ch('desktop/main.mjs',"download: () => updates.download(), install: () => updates.install(),", "download: input=>updates.download(input), install:()=>updates.install(),setChannel:input=>updates.setChannel(input),notes:()=>updates.notes(),records:()=>updates.records(),")
ch('desktop/main.mjs',"async event => { trusted(event); if (event.sender !== main?.webContents) throw new Error('请在主窗口管理客户端更新'); return fn();", "async (event,input)=>{trusted(event);if(event.sender!==main?.webContents)throw new Error('请在主窗口管理客户端更新');return fn(input);")
ch('desktop/main.mjs','manager: { snapshot: () => manager.snapshot(), control:',"stateFile:path.join(app.getPath('userData'),'desktop-updates.json'),releaseNotes:JSON.parse(fs.readFileSync(new URL('./release-notes.json',import.meta.url),'utf8')), manager: { snapshot: () => manager.snapshot(), control:")
ch('desktop/main.mjs','beforeInstall:()=>remoteUpdates?.beforeInstall()', 'beforePrepare:()=>updatePreparation.prepare(),beforeInstall:()=>remoteUpdates?.beforeInstall()')
ch('desktop/main.mjs','main = makeWindow(); popover = makeWindow(true);',"main = makeWindow(); popover = makeWindow(true);updatePreparation=createUpdatePreparation({ipcMain,windows:()=>BrowserWindow.getAllWindows().filter(w=>[main,popover].includes(w)||w.webContents.getURL().includes('/desktop/frontend/dist/'))});")
ch('desktop/main.mjs','updates?.dispose(); settings?.dispose();','updates?.dispose();updatePreparation?.dispose(); settings?.dispose();')
ch('desktop/preload.cjs',"download: () => invoke('updates:download'),", "download:input=>invoke('updates:download',input),setChannel:input=>invoke('updates:setChannel',input),notes:()=>invoke('updates:notes'),records:()=>invoke('updates:records'),")
p=dst/'desktop/preload.cjs';s=p.read_text();tail=(root/'apps/desktop/preload.cjs').read_text().split('const updateGuards=new Set();')[1];p.write_text(s+'\nconst updateGuards=new Set();'+tail)
ch('desktop/owner-client.mjs',"['retry', 'cancel', 'approve', 'reassign','supplement'].includes(action)","['retry', 'cancel', 'approve', 'reassign','supplement','use-codex'].includes(action)")
# Keep the richer capture result/evidence UI; apply only the retirement action deltas.
for name in ['model.ts','TasksPage.tsx']:
 rel='desktop/frontend/src/tasks/'+name
 if name=='model.ts':
  ch(rel,"'retry'|'cancel'|'approve'|'reassign'","'retry'|'cancel'|'approve'|'reassign'|'use-codex'")
  ch(rel,"actions.push('retry');","actions.push(task.preferredAgent==='codebuddy'||task.agent==='codebuddy'?'use-codex':'retry');")
 else:
  ch(rel,"allowed.includes('retry')?","allowed.includes('use-codex')?'改用 Codex':allowed.includes('retry')?")
  ch(rel,"confirmation?.action==='approve'?'确认归档':","confirmation?.action==='use-codex'?'改用 Codex':confirmation?.action==='approve'?'确认归档':")
  ch(rel,"const question=confirmation?.action==='approve'?","const question=confirmation?.action==='use-codex'?`将「${confirmation.title}」改用 Codex 继续，保留原任务和成果？`:confirmation?.action==='approve'?")
  ch(rel,"primary==='确认归档'?'approve':'retry'","primary==='确认归档'?'approve':primary==='改用 Codex'?'use-codex':'retry'")
ch('desktop/frontend/src/capture/CapturePage.tsx','<option value="codebuddy">CodeBuddy</option>','')
ch('desktop/frontend/src/nodes/NodesContent.tsx','.agents?.map(',".agents?.filter(value=>value!=='codebuddy').map(")
p=dst/'desktop/frontend/tsconfig.json';j=json.loads(p.read_text());j['compilerOptions']['allowJs']=True;p.write_text(json.dumps(j,indent=2)+'\n')
p=dst/'desktop/frontend/src/records/data/service.ts';s=p.read_text().replace('  invalidateSession() {','  async flushLocal(){await this.queue;}\n  invalidateSession() {');p.write_text(s)
p=dst/'desktop/frontend/src/records/RecordsProvider.tsx';s="import {registerUpdateGuard} from '../shared/update-safety';\n"+p.read_text();needle=' const taskCount=query.data?.taskCount??0;';assert needle in s;s=s.replace(needle," useEffect(()=>registerUpdateGuard(async()=>{if(mediaStatus!=='idle')throw Error('请先完成录音');if(optimisticDraft.current)await saveDraft(optimisticDraft.current);else if(draftStatus==='error')throw Error('草稿未保存');await service.flushLocal();}),[service,mediaStatus,draftStatus,session]);\n"+needle);p.write_text(s)
# Recoverable current split-editor contents are explicitly acknowledged before any restart.
p=dst/'desktop/frontend/src/creation/CreationWorkbench.tsx';s=p.read_text();s="import {registerUpdateGuard} from '../shared/update-safety';\n"+s;needle=' const change=(next:Draft)=>';assert needle in s;s=s.replace(needle," useEffect(()=>registerUpdateGuard(()=>{if(!selected.current)return;const c=current.current;for(const [kind,value,dirty] of [['draft',c.draft,c.dirty],['workflow-draft',c.workflow,c.workflowDirty]] as const){if(dirty){const k=key(kind),v=JSON.stringify(value);localStorage.setItem(k,v);if(localStorage.getItem(k)!==v)throw Error('文稿恢复副本未保存');}}}),[]);\n"+needle);p.write_text(s)
for file in ['package.json','desktop/package.json']:
 p=dst/file;data=json.loads(p.read_text());data['version']='0.2.31';p.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
shutil.copy2(root/'apps/desktop/release-notes.json',dst/'desktop/release-notes.json');changed.append('desktop/release-notes.json')
(qa/'staging.json').write_text(json.dumps({'version':'0.2.31','baseVersion':'0.2.30','changedModules':sorted(set(changed)),'retainedCreationWorkerSha256':hashlib.sha256((dst/'src/creation-worker.mjs').read_bytes()).hexdigest()},ensure_ascii=False,indent=2)+'\n')
print('Staged 0.2.31 over installed 0.2.30; later creation runtime and capture evidence preserved')
