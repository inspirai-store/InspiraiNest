export function createCaptureWindowController({window,exiting=()=>false}) {
  const ready=window.webContents.isLoading()
    ? new Promise(resolve=>window.webContents.once('did-finish-load',resolve))
    : Promise.resolve();
  window.on('close',event=>{if(!exiting()){event.preventDefault();window.hide();}});
  return {
    async open({taskId}={}) {
      if(taskId!==undefined&&!/^[a-f0-9-]{36}$/i.test(taskId))throw Error('采集任务编号无效');
      await ready;
      if(exiting()||window.isDestroyed())return;
      window.webContents.send('capture-window:navigate','/capture?data=local'+(taskId?'&task='+encodeURIComponent(taskId):''));
      if(window.isMinimized())window.restore();
      window.show();window.focus();
    },
  };
}
