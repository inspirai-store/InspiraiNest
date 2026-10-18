(() => {
  'use strict';
  const pending=new Map();
  window.captureReply = response => {const handlers=pending.get(response.id);if(!handlers)return;pending.delete(response.id);clearTimeout(handlers.timer);clearInterval(handlers.retry);response.error ? handlers.reject(new Error(response.error)) : handlers.resolve(response.value);};
  function native(action,input) {
    if(window.captureHost)return window.captureHost(action,input);
    return new Promise((resolve,reject)=>{const id=crypto.randomUUID(),timer=setTimeout(()=>{clearInterval(pending.get(id)?.retry);pending.delete(id);reject(new Error('请求超时，内容已保存在本机，可重试'));},130000),handlers={resolve,reject,timer};pending.set(id,handlers);
      const message={id,action,input};
      if(window.CaptureNative)window.CaptureNative.postMessage(JSON.stringify(message));
      else if(window.webkit?.messageHandlers?.capture)window.webkit.messageHandlers.capture.postMessage(message);
      else if(window.parent!==window){window.parent.postMessage({captureRequest:message},'*');if(action==='status')handlers.retry=setInterval(()=>window.parent.postMessage({captureRequest:message},'*'),250);}
      else {clearTimeout(timer);pending.delete(id);reject(new Error('请在客户端中打开记录功能'));}
    });
  }
  addEventListener('message',event=>{if(event.source===window.parent && event.data?.captureResponse)window.captureReply(event.data.captureResponse);if(event.source===window.parent && event.data?.capturePage)window.captureNavigate?.(event.data.capturePage);});
  window.captureBridge={call:native,base64:async blob=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);}),blob:(base64,mime)=>{const binary=atob(base64),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return new Blob([bytes],{type:mime});}};
})();
