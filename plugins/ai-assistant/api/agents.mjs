// Public execution contract for official plugins declaring an ai-assistant dependency.
export {execute,agentExecution,agentOrder,runAgent,unavailableBeforeWork,describeAgentFailure} from '../worker/agents.mjs';

export {agentEnvironment} from '../worker/agents.mjs';

export {resolveAgentProfile,commandEnvironment} from '../worker/agent-paths.mjs';
