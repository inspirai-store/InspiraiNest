(() => {
 if(!window.CaptureNative)return;
 const button=document.createElement('button');button.type='button';button.className='processing-shortcut';button.hidden=true;button.onclick=()=>window.captureBridge.call('navigate','tasks');document.querySelector('.capture-space').prepend(button);
 async function refresh(){if(document.hidden)return;try{const status=await captureBridge.call('status');if(!status.paired){button.hidden=true;return;}const response=await captureBridge.call('request',{route:'/api/processing-center',method:'GET'});if(response.status!==200)return;const counts=response.json.counts;button.hidden=!(counts.attention+counts.results);button.textContent=`${counts.attention} 项待办 · ${counts.results} 项新结果  ›`;}catch{}}
 refresh();setInterval(refresh,15000);
})();
