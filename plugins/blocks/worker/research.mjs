import fs from 'node:fs';
import path from 'node:path';
import {atomicJson,hash,requireValue} from '../../../packages/core/node/common.mjs';
import {processCollection} from '../../ai-assistant/api/collection.mjs';
import {researchInstructions} from '../protocol/research.mjs';
export async function processResearch(context){
 const {config,task,prepareWorkspace}=context;
 if(!task.blockResearchSnapshot)return processCollection(config,task,context.available,context.signal,context.onProgress,context);
 const root=path.join(prepareWorkspace(task,path.resolve(config.dataDir)),'.blocks-research');fs.mkdirSync(root,{recursive:true,mode:0o700});
 const stamp=path.join(root,'input.sha256'),digest=hash(JSON.stringify(task.blockResearchSnapshot));
 requireValue(!fs.existsSync(stamp)||fs.readFileSync(stamp,'utf8')===digest,'研究输入已变化');
 fs.writeFileSync(stamp,digest,{mode:0o600});atomicJson(path.join(root,'input.json'),task.blockResearchSnapshot);
 return processCollection({...config,instructions:[config.instructions,researchInstructions()].filter(Boolean).join('\n')},task,context.available,context.signal,context.onProgress,context);
}
