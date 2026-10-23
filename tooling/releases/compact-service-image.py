from pathlib import Path
import subprocess,json,tarfile,datetime,argparse,tempfile
parser=argparse.ArgumentParser(description='Compact a staged service image while retaining every registered desktop, Android and reader download. Keep the source image as the archive of unregistered builds.');parser.add_argument('--source-image',required=True);parser.add_argument('--target-image',required=True);parser.add_argument('--output-dir');args=parser.parse_args();source=args.source_image;target=args.target_image;assert source!=target,'Source archive and compact image must have different references';q=Path(args.output_dir) if args.output_dir else Path(tempfile.mkdtemp(prefix='lingnest-release-image-'));q.mkdir(parents=True,exist_ok=True);assert not any(q.iterdir()),'Output directory must be empty'
meta=json.loads(subprocess.check_output(['docker','image','inspect',source]))[0];cfg=meta['Config'];assert not cfg.get('Healthcheck') and not cfg.get('StopSignal') and not cfg.get('Shell'),'Preserve additional runtime instructions explicitly'
js='''const fs=require('node:fs'),path=require('node:path'),dir='/app/releases',keep=new Set(['android-release.json','worker-release.json','reader-release.json','macos-update.json','desktop-release.json']);const walk=x=>{if(!x||typeof x!=='object')return;if(typeof x.filename==='string')keep.add(x.filename);for(const v of Object.values(x))walk(v);};for(const f of [...keep])walk(JSON.parse(fs.readFileSync(path.join(dir,f),'utf8')));for(const f of [...keep])if(fs.existsSync(path.join(dir,f+'.blockmap')))keep.add(f+'.blockmap');const files=fs.readdirSync(dir).filter(f=>fs.statSync(path.join(dir,f)).isFile()),inode=f=>{const s=fs.statSync(path.join(dir,f));return s.dev+':'+s.ino;},inodes=new Set([...keep].map(inode));for(const f of files)if(inodes.has(inode(f)))keep.add(f);console.log(JSON.stringify({files:[...keep].sort(),bytes:[...keep].reduce((n,f)=>n+fs.statSync(path.join(dir,f)).size,0),allFileCount:files.length}));'''
inv=json.loads(subprocess.check_output(['docker','run','--rm','--platform','linux/amd64','--entrypoint','node',source,'-e',js]));allowed=set(inv['files']);assert len(allowed)>20 and all('/' not in n and n not in ['.','..'] for n in allowed)
container=subprocess.check_output(['docker','create','--platform','linux/amd64',source],text=True).strip();archive=q/'rootfs.tar';retained=0;excluded=0
try:
 p=subprocess.Popen(['docker','export',container],stdout=subprocess.PIPE)
 with tarfile.open(fileobj=p.stdout,mode='r|') as inp,tarfile.open(archive,'w') as out:
  for info in inp:
   name=info.name.removeprefix('./').lstrip('/')
   if name.startswith('app/releases/') and name[len('app/releases/'):] not in allowed:excluded+=1;continue
   if info.islnk():
    link=info.linkname.removeprefix('./').lstrip('/')
    assert not link.startswith('app/releases/') or link[len('app/releases/'):] in allowed,'Retained hardlink target must remain present'
   out.addfile(info,inp.extractfile(info) if info.isfile() else None);retained+=1
 assert p.wait()==0
finally:subprocess.run(['docker','rm',container],check=True,stdout=subprocess.DEVNULL)
changes=[]
for key,instruction in [('Cmd','CMD'),('Entrypoint','ENTRYPOINT')]:
 if cfg.get(key) is not None:changes.append(instruction+' '+json.dumps(cfg[key]))
for key,instruction in [('WorkingDir','WORKDIR'),('User','USER')]:
 if cfg.get(key):changes.append(instruction+' '+cfg[key])
for value in cfg.get('Env',[]):
 key,val=value.split('=',1);changes.append('ENV '+key+'='+json.dumps(val))
for key,val in (cfg.get('Labels') or {}).items():changes.append('LABEL '+key+'='+json.dumps(val))
for port in cfg.get('ExposedPorts') or {}:changes.append('EXPOSE '+port)
if cfg.get('Volumes'):changes.append('VOLUME '+json.dumps(list(cfg['Volumes'])))
assert not cfg.get('OnBuild')
args=['docker','import','--platform','linux/amd64']
for change in changes:args+=['--change',change]
subprocess.run(args+[str(archive),target],check=True)
new=json.loads(subprocess.check_output(['docker','image','inspect',target]))[0]
for key in ['Cmd','Entrypoint','Env','WorkingDir','User','Labels','ExposedPorts','Volumes','Healthcheck','StopSignal','Shell']:
 assert (cfg.get(key) or None)==(new['Config'].get(key) or None),('Runtime configuration changed',key)
result={'at':datetime.datetime.now().astimezone().isoformat(),'sourceImage':source,'sourceImageId':meta['Id'],'archivalSourceImageRetained':True,'targetImage':target,'targetImageId':new['Id'],'registeredReleaseFiles':inv['files'],'registeredReleaseBytes':inv['bytes'],'sourceReleaseFileCount':inv['allFileCount'],'excludedUnregisteredReleaseEntries':excluded,'rootfsEntriesRetained':retained,'runtimeConfigurationUnchanged':True,'imageBytesBefore':meta['Size'],'imageBytesAfter':new['Size']};(q/'receipt.json').write_text(json.dumps(result,indent=2));print(json.dumps({k:v for k,v in result.items() if k!='registeredReleaseFiles'}))
