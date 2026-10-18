import {extension as lab} from './agent-lab/worker/extension.mjs';
import {extension as writing} from './writing/worker/extension.mjs';
import {processCollection} from './ai-assistant/worker/collection.mjs';
import {createWorkerRegistry} from '../packages/plugin-sdk/worker.mjs';
const ai={id:'ai-assistant',matches:task=>task.pluginId==='ai-assistant'||task.pluginId===undefined&&task.purpose!=='core-capture',run:context=>processCollection(context.config,context.task,context.available,context.signal,context.onProgress,context)};
export const workerRegistry=createWorkerRegistry([lab,writing,ai]);
