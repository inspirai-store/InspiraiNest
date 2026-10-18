/** Publish the existing public Worker snapshot to owned desktop windows once per change. */
export function createWorkerStatePublisher(windows) {
 let previous='';
 return state=>{
  const payload=JSON.stringify(state);if(payload===previous)return;previous=payload;
  for(const window of windows())if(window&&!window.isDestroyed())window.webContents.send('worker:changed',state);
 };
}
