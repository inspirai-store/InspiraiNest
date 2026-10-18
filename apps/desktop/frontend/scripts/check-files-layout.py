import json
from pathlib import Path
r=Path(__file__).resolve().parents[4]/'design-review/desktop-refactor/stage-05-records-v1/files-evidence'
ref=json.loads((r/'prototype-reference.json').read_text());frames=json.loads((r/'render-checks.json').read_text())['frames']
ids=['kr5UK','auT39','LAv0f','6xXJx','TPpai','iPuTz','Ce2rM','C43Q4','HtEFB','m2inO']
keys=['files-editor-1240-light','files-editor-1240-dark','files-reader-1240-light','files-reader-1240-dark','files-selected-1240-light','files-selected-1240-dark','files-editor-900-light','files-editor-900-dark','files-editor-740-light','files-editor-740-dark']
roots=dict(zip(keys,ids));checks=[];missing=[]
for f in frames:
 root=next(n for n in ref['roots'] if n['id']==roots[f['name']]);names={};bounds={}
 def namewalk(n):
  names[n['id']]=n.get('name')
  for c in n.get('children',[]):
   if isinstance(c,dict):namewalk(c)
 def walk(n,x=0,y=0,top=False):
  x+=0 if top else n.get('x',0);y+=0 if top else n.get('y',0)
  name=names.get(n['id'])
  if name and name not in bounds:bounds[name]={k:v for k,v in zip(['x','y','width','height'],[x,y,n['width'],n['height']])}
  for c in n.get('children',[]):
   if isinstance(c,dict):walk(c,x,y)
 namewalk(root);walk(next(t['layout'] for t in ref['layouts'] if t['id']==root['id']),top=True)
 for a in f['regions']:
  # Legacy generic and image-only capture labels are superseded by explicit card/control regions.
  if a['name'] in ['文中文件块','imageRemove']:continue
  alias={'图文阅读':'记录编辑器','原始内容':'记录输入区','视频预览':'文中视频卡片','文件预览入口':'文中PDF卡片'}.get(a['name'],a['name']);b=bounds.get(alias)
  if b is None:missing.append({'frame':f['name'],'name':a['name']});continue
  delta=max(abs(a[k]-b[k]) for k in ['x','y','width','height']);checks.append({'frame':f['name'],'name':alias,'expected':b,'actual':a,'delta':delta,'passed':delta<=1})
failures=[c for c in checks if not c['passed']];passed=not failures and not missing
(r/'layout-checks.json').write_text(json.dumps({'passed':passed,'count':len(checks),'failures':failures,'missing':missing,'checks':checks},ensure_ascii=False,indent=2))
print(json.dumps({'count':len(checks),'failures':failures,'missing':missing},ensure_ascii=False))
raise SystemExit(0 if passed else 1)
