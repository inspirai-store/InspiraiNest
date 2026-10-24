import {isExecutionAgent} from '../shared/execution-policy.mjs';
import {capabilityBlock} from './capabilities.mjs';
import { workerAuthorized } from './device-metadata.mjs';

export const nodeFailureCodes = new Set(['AGENT_NETWORK', 'AGENT_START', 'AGENT_PERMISSION', 'AGENT_TIMEOUT', 'AGENT_EXIT', 'AGENT_MODEL', 'AGENT_LOGIN', 'AGENT_RESULT', 'AGENT_ENVIRONMENT']);

export function supportsWritingTask(task, device) {
  if (!task.writingSessionId) return true;
  const skill = task.writingSnapshot?.skill;
  const version = task.writingSnapshot?.protocolVersion || skill?.version || 1;
  if (Array.isArray(device.writingSkills)) return device.writingSkills.some(s => s.version === version && s.hash === skill?.hash);
  return version === 1 && device.writingProtocol === 1;
}

// A specified computer is preferred on the first attempt. Once it cannot finish,
// route to another authorized computer without changing submission identity.
export function canRunTask(task, device) {
  if(task.preferredAgent && !isExecutionAgent(task.preferredAgent)) return false;
  if(task.purpose==='codex-trial')return workerAuthorized(device) && device.id===task.trial?.deviceId && device.trialEnvironment?.protocol===1 && device.agents?.includes('codex');
  return workerAuthorized(device) && !capabilityBlock(task,device) && Boolean(device.agents?.some(isExecutionAgent))
    && (task.pluginId!=='blocks'||device.blocksProtocol===1)
    && (task.purpose!=='selection-writing'||device.selectionWritingProtocol===1)
    && (!task.recordId || device.recordProtocol === 1)
    && supportsWritingTask(task, device)
    && (!task.inputAttachments?.length || device.inputAttachmentProtocol === 1)
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
