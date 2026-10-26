import {processMatching} from './blocks/worker/matching.mjs';
import {extension as lab} from './agent-lab/worker/extension.mjs';
import {extension as writing} from './writing/worker/extension.mjs';
import {processCollection} from './ai-assistant/worker/collection.mjs';
import {createWorkerRegistry} from '../packages/plugin-sdk/worker.mjs';
import {processLearning} from './learning/worker/assist.mjs';
const ai={id:'ai-assistant',matches:task=>task.pluginId==='ai-assistant'||task.pluginId===undefined&&task.purpose!=='core-capture',run:context=>processCollection(context.config,context.task,context.available,context.signal,context.onProgress,context)};
export const workerRegistry=createWorkerRegistry([lab,writing,{id:'learning',matches:task=>task.pluginId==='learning',run:processLearning},{id:'blocks',matches:task=>task.pluginId==='blocks',run:context=>context.task.purpose==='blocks-match'?processMatching(context):processCollection(context.config,context.task,context.available,context.signal,context.onProgress,context)},ai]);
