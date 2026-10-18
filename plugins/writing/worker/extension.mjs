import {processWriting} from './selection-writing-worker.mjs';
import {processWritingTask} from './writing-worker.mjs';
import {fastWritingRound} from '../protocol/writing-protocol.mjs';
export const extension={id:'writing',matches:task=>task.purpose==='selection-writing'||!!task.writingSessionId,
 run:context=>context.task.purpose==='selection-writing'?processWriting(context.config,context.task,context.available,context.signal,context.onProgress,context.api):processWritingTask({...context,workspace:context.prepareWorkspace(context.task,context.config.dataDir,{planning:fastWritingRound(context.task)})})};
