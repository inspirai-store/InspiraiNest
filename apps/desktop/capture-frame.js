(() => {
  'use strict';
  const frame=document.querySelector('#record-frame');
  if(!frame || new URLSearchParams(location.search).has('compact'))return;
  window.captureFramePage=page=>frame.contentWindow.postMessage({capturePage:page},'*');
  addEventListener('message',async event=>{
    if(event.source!==frame.contentWindow || !event.data?.captureRequest)return;
    const {id,action,input}=event.data.captureRequest;
    if(typeof id!=='string')return;
    try {
      let value;
      if(action==='status')value={...await window.library.status(),theme:document.documentElement.dataset.theme||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')};
      else if(action==='request')value=await window.library.capture(input);
      else if(action==='navigate'){if(!['library','tasks','settings','nodes'].includes(input))throw new Error('页面无效');window.dispatchEvent(new CustomEvent('capture:navigate',{detail:input}));value={};}
      else throw new Error('不支持的操作');
      frame.contentWindow.postMessage({captureResponse:{id,value}},'*');
    }catch(error){frame.contentWindow.postMessage({captureResponse:{id,error:String(error.message)}},'*');}
  });
})();
