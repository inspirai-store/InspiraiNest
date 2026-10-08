import { workerAuthorized } from './device-metadata.mjs';

export const nodeFailureCodes = new Set(['AGENT_START', 'AGENT_PERMISSION', 'AGENT_TIMEOUT', 'AGENT_EXIT', 'AGENT_MODEL', 'AGENT_LOGIN', 'AGENT_RESULT', 'AGENT_ENVIRONMENT']);

// A specified computer is preferred on the first attempt. Once it cannot finish,
// route to another authorized computer without changing submission identity.
export function canRunTask(task, device) {
  return workerAuthorized(device) && Boolean(device.agents?.length)
    && (task.type === 'auto' ? Boolean(device.capabilities?.length) : device.capabilities?.includes(task.type))
    && (!task.preferredAgent || device.agents.includes(task.preferredAgent))
    && !(task.failedDeviceIds || []).includes(device.id)
    && (!task.preferredDeviceId || task.failedDeviceIds?.length || task.preferredDeviceId === device.id);
}

export function releaseTask(task, reason, message, at) {
  const failedDeviceIds = [...new Set([...(task.failedDeviceIds || []), task.deviceId].filter(Boolean))];
  return { ...task, failedDeviceIds, deviceId: null, agent: null, selectedSkills: [], executionSkills: [], environmentDigest: null, assignmentId: null,
    failover: { reason, message, fromDeviceId: task.deviceId, at } };
}
