import {createDiagnosticOutbox} from '../../packages/core/node/task-diagnostics.mjs';
// The bridge reports confirmed ownership transitions; it never reads page text.
export function bindBrowserDiagnostics(browser,manager){
  const listener=event=>{
    const state=manager.snapshot(),task=[state.current,state.lastTask].find(t=>t?.id===event.taskId&&t.attemptId);
    if(!task)return;
    const config=manager.configuration();
    try{createDiagnosticOutbox(manager.dataDir,{deviceId:config.deviceId,token:config.token,runId:state.runId}).record(task,{...event,diagnostic:{code:event.code,details:{sessionId:event.sessionId}}});}catch{}
  };
  browser.on('execution-event',listener);return ()=>browser.off('execution-event',listener);
}
