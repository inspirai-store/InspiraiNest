"""Publish only desktop distribution files on the trusted release runner.
No user volumes are mounted by QA/prepull pods; production credentials stay in
existing Kubernetes Secret references. Backups contain hashes, never user text.
"""
import argparse,copy,datetime,json,os,pathlib,shutil,subprocess,tempfile,time,urllib.request
parser=argparse.ArgumentParser();parser.add_argument('mode',choices=['inspect','deploy']);parser.add_argument('--work',required=True);args=parser.parse_args()
work=pathlib.Path(args.work).resolve();work.mkdir(parents=True,exist_ok=True);private=work/'private';private.mkdir(exist_ok=True,mode=0o700);os.chmod(private,0o700)
repo=pathlib.Path(__file__).resolve().parents[2];kube=['kubectl','--context','aliyun','-n','inspirai'];registry='yunizeni-registry.cn-shenzhen.cr.aliyuncs.com';deployment='library-collector'
def run(cmd,body=None,timeout=600,capture=True):
 return subprocess.run(cmd,input=body,capture_output=capture,text=True,check=True,timeout=timeout).stdout if capture else subprocess.run(cmd,input=body,text=True,check=True,timeout=timeout)
def obj(cmd,body=None):return json.loads(run(cmd,body))
def save(path,value,secret=False):
 path.write_text(json.dumps(value,indent=2)+'\n');os.chmod(path,0o600 if secret else 0o644)
def public():return json.load(urllib.request.urlopen('https://library.inspirai.store/client-release.json',timeout=30))
def live():
 pods=obj(kube+['get','pods','-l','app=library-collector','-o','json'])['items'];pods=[p for p in pods if not p['metadata'].get('deletionTimestamp')and p['status'].get('phase')=='Running'and all(c['ready']for c in p['status'].get('containerStatuses',[]))];assert len(pods)==1,'Require one healthy production pod';return pods[0]
def snapshot(pod):return obj(kube+['exec','-i',pod,'--','node','--input-type=module','-'],(repo/'tooling/releases/snapshot-release-state.mjs').read_text())
if args.mode=='inspect':
 dep=obj(kube+['get','deployment',deployment,'-o','json']);pod=live();assert dep['status']['readyReplicas']==1
 image=dep['spec']['template']['spec']['containers'][0]['image'];assert '@sha256:'in image,'Production base must be immutable'
 script="const fs=require('node:fs'),p=require('node:path'),dir=process.env.COLLECTOR_RELEASE_DIR;const names=['android-release.json','worker-release.json','reader-release.json','macos-update.json','desktop-release.json'];console.log(JSON.stringify(Object.fromEntries(names.map(n=>[n,JSON.parse(fs.readFileSync(p.join(dir,n),'utf8'))]))));"
 manifests=obj(kube+['exec',pod['metadata']['name'],'--','node','-e',script]);(work/'base').mkdir(exist_ok=True)
 for name,value in manifests.items():save(work/'base'/name,value)
 save(private/'deployment-before.json',dep,True);save(work/'public-before.json',public());save(work/'deployment-context.json',{'image':image,'node':pod['spec']['nodeName'],'pod':pod['metadata']['name'],'podUid':pod['metadata']['uid'],'deploymentUid':dep['metadata']['uid']});print('Production base and public manifests captured; no mutation.');raise SystemExit(0)
plan=json.loads((work/'publication-plan.json').read_text());assert plan['changed'],'No distribution change: skip deployment'
context=json.loads((work/'deployment-context.json').read_text());before=json.loads((private/'deployment-before.json').read_text());current=obj(kube+['get','deployment',deployment,'-o','json']);assert current['spec']==before['spec']and current['metadata']['uid']==context['deploymentUid'],'Deployment changed; re-plan publication';assert public()==json.loads((work/'public-before.json').read_text()),'Public release changed; re-plan'
base=context['image'].replace('yunizeni-registry-vpc.','yunizeni-registry.');identifier=f"{os.environ['GITHUB_RUN_ID']}-{os.environ['GITHUB_RUN_ATTEMPT']}";assert all(c.isdigit()or c=='-'for c in identifier)
tag=f"{registry}/yunizeni/library-collector:prod-desktop-{plan['version']}-{identifier}"
authdir=pathlib.Path(tempfile.mkdtemp(prefix='desktop-registry-',dir=private));docker=['docker','--config',str(authdir)]
# Keep the user's Docker configuration and registry login untouched.
host=run(['docker','context','inspect','--format','{{.Endpoints.docker.Host}}']).strip();docker[1:1]=['--host',host]
prepull=f'desktop-prepull-{identifier}';applied=False;prepull_uid=None;target=None
try:
 auth=obj(['aliyun','cr','GetAuthorizationToken','--profile','faxiang','--RegionId','cn-shenzhen','--InstanceId','cri-mbk2riie5kvhn92w']);run(docker+['login',registry,'--username',auth['TempUsername'],'--password-stdin'],auth['AuthorizationToken']+'\n');del auth
 run(docker+['pull',base],capture=False)
 contextdir=work/'image';contextdir.mkdir(exist_ok=True);shutil.copytree(work/'overlay',contextdir/'release',dirs_exist_ok=True);(contextdir/'Dockerfile').write_text('FROM '+base+'\nCOPY release/ /app/releases/\n')
 run(docker+['build','--platform','linux/amd64','-t',tag,str(contextdir)],capture=False)
 oldmeta=obj(docker+['image','inspect',base])[0];meta=obj(docker+['image','inspect',tag])[0];assert oldmeta['Config']==meta['Config'],'Runtime configuration must remain byte-equivalent'
 helper=(repo/'tooling/releases/desktop-publication.mjs').read_text().replace("from 'js-yaml'","from 'file:///app/node_modules/js-yaml/index.js'").replace("from '../../packages/core/shared/desktop-release.mjs'","from 'file:///app/packages/core/shared/desktop-release.mjs'")
 import base64
 qa="""import http from 'node:http';import fs from 'node:fs';import{clientDownload}from'/app/services/api/modules/client-download.mjs';const{verifyPublic}=await import('data:text/javascript;base64,'+process.env.QA_HELPER);const input=JSON.parse(process.env.QA_INPUT),h=clientDownload({releaseDir:process.env.COLLECTOR_RELEASE_DIR});const s=http.createServer(async(q,r)=>{if(q.url==='/download'){r.end(fs.readFileSync('/app/apps/web/public/download.html'));return;}if(!await h(q,r,new URL(q.url,'http://local').pathname)){r.writeHead(404);r.end();}});await new Promise(r=>s.listen(0,'127.0.0.1',r));try{const base='http://127.0.0.1:'+s.address().port;const fetcher=(url,opts)=>fetch(base+new URL(url).pathname,opts);const result=await verifyPublic(input.plan,{fetcher,before:input.before});console.log(JSON.stringify(result));}finally{s.close();}"""
 qa_env={**os.environ,'QA_INPUT':json.dumps({'plan':plan,'before':json.loads((work/'public-before.json').read_text())}),'QA_HELPER':base64.b64encode(helper.encode()).decode()}
 subprocess.run(docker+['run','--rm','-i','--platform','linux/amd64','--entrypoint','node','-e','QA_INPUT','-e','QA_HELPER',tag,'--input-type=module','-'],input=qa,env=qa_env,text=True,check=True,timeout=600)
 stats=obj(['kubectl','--context','aliyun','get','--raw',f"/api/v1/nodes/{context['node']}/proxy/stats/summary"]);assert stats['node']['fs']['availableBytes']>2*meta['Size']+2*1024**3,'Insufficient node space; compact/archive before publication'
 run(docker+['push',tag],capture=False);meta=obj(docker+['image','inspect',tag])[0];digest=next(x.split('@')[1]for x in meta['RepoDigests']if x.startswith(registry+'/'));target=tag.replace('yunizeni-registry.','yunizeni-registry-vpc.')+'@'+digest
 pod={'apiVersion':'v1','kind':'Pod','metadata':{'name':prepull,'namespace':'inspirai'},'spec':{'automountServiceAccountToken':False,'nodeSelector':{'kubernetes.io/hostname':context['node']},'restartPolicy':'Never','containers':[{'name':'prepull','image':target,'imagePullPolicy':'Always','command':['node','-e','process.exit(0)'],'securityContext':{'runAsNonRoot':True,'runAsUser':1000,'allowPrivilegeEscalation':False,'readOnlyRootFilesystem':True,'capabilities':{'drop':['ALL']}},'resources':{'requests':{'cpu':'10m','memory':'32Mi'},'limits':{'cpu':'100m','memory':'64Mi'}}}]}}
 created=obj(kube+['create','-f','-','-o','json'],json.dumps(pod));prepull_uid=created['metadata']['uid']
 for _ in range(60):
  ready=obj(kube+['get','pod',prepull,'-o','json']);phase=ready['status']['phase'];assert phase!='Failed','Prepull failed'
  if phase=='Succeeded':break
  time.sleep(5)
 else:raise RuntimeError('Prepull timed out; production unchanged')
 for _ in range(21):
  original=snapshot(live()['metadata']['name'])
  if not original['active']:break
  print('Active collection/creation tasks: waiting without restarting nodes.',flush=True);time.sleep(30)
 else:raise RuntimeError('Tasks still active: leave packages staged and retry publication later')
 save(private/'state-before.json',original,True);current=obj(kube+['get','deployment',deployment,'-o','json']);assert current['spec']==before['spec'];assert public()==json.loads((work/'public-before.json').read_text())
 patch=[{'op':'test','path':'/metadata/resourceVersion','value':current['metadata']['resourceVersion']},{'op':'test','path':'/spec/template/spec/containers/0/image','value':context['image']},{'op':'replace','path':'/spec/strategy','value':{'type':'RollingUpdate','rollingUpdate':{'maxSurge':1,'maxUnavailable':0}}},{'op':'replace','path':'/spec/template/spec/containers/0/image','value':target}]
 run(kube+['patch','deployment',deployment,'--type=json','-p',json.dumps(patch)]);applied=True
 run(kube+['rollout','status','deployment/'+deployment,'--timeout=300s'],capture=False);actual=live();assert actual['spec']['containers'][0]['image']==target
 after=snapshot(actual['metadata']['name']);save(private/'state-after.json',after,True);after_hash={(r['kind'],r['id']):r['sha256']for r in after['fingerprints']};assert all(after_hash.get((r['kind'],r['id']))==r['sha256']for r in original['fingerprints']),'Protected content changed during publication; inspect private fingerprints'
 auth_hash={r['id']:r['sha256']for r in after['deviceAuth']};assert all(auth_hash.get(r['id'])==r['sha256']for r in original['deviceAuth']),'Device authorization changed'
 save(work/'deployment-receipt.json',{'image':target,'previousImage':context['image'],'pod':actual['metadata']['name'],'protectedRecordsUnchanged':len(original['fingerprints']),'deviceAuthorizationUnchanged':True,'runtimeConfigurationUnchanged':True});print('Desktop distribution deployed; protected content and authorizations unchanged.')
except Exception:
 if applied:
  now=obj(kube+['get','deployment',deployment,'-o','json']);assert now['spec']['template']['spec']['containers'][0]['image']==target,'Concurrent change: do not overwrite it'
  run(kube+['patch','deployment',deployment,'--type=json','-p',json.dumps([{'op':'test','path':'/metadata/resourceVersion','value':now['metadata']['resourceVersion']},{'op':'replace','path':'/spec/template/spec/containers/0/image','value':context['image']}])]);run(kube+['rollout','status','deployment/'+deployment,'--timeout=300s'],capture=False)
 raise
finally:
 if applied:
  now=obj(kube+['get','deployment',deployment,'-o','json']);run(kube+['patch','deployment',deployment,'--type=json','-p',json.dumps([{'op':'test','path':'/metadata/resourceVersion','value':now['metadata']['resourceVersion']},{'op':'replace','path':'/spec/strategy','value':before['spec']['strategy']}])])
 if prepull_uid:
  pod=obj(kube+['get','pod',prepull,'-o','json']);assert pod['metadata']['uid']==prepull_uid;run(kube+['delete','pod',prepull,'--wait=false'])
 shutil.rmtree(authdir)
