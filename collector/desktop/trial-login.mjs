import {probeTrialEnvironment} from '../src/codex-trial-worker.mjs';
import {requireValue} from '../src/common.mjs';
// Keep the legacy IPC name without creating a second account or launching a login window.
export async function trialLoginAction(config,action) {
 requireValue(config.server && config.deviceId,'请先登录当前资料库');
 if(action==='status')return probeTrialEnvironment(config);
 requireValue(action==='login','操作无效');
 return {manageAgent:true,path:'/settings/agents'};
}
