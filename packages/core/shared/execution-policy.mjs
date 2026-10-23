// Historical identifiers remain readable; only this list may receive new work.
export const executionAgents = Object.freeze(['codex']);
export const isExecutionAgent = agent => executionAgents.includes(agent);
export function assertExecutionAgent(agent) {
  if (!agent || isExecutionAgent(agent)) return;
  throw Object.assign(new Error(agent === 'codebuddy' ? 'CodeBuddy 执行方式已停用，请改用 Codex；原任务和成果保留' : '执行方式不受支持'), { status: 409, code: 'AGENT_DISABLED' });
}
export const activeExecutionAgents = agents => (agents || []).filter(isExecutionAgent);
