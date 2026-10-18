(() => {
  const bridge=window.captureBridge;
  const request=async(route,method='GET',json)=>{const response=await bridge.call('request',{route,method,...(json===undefined?{}:{json})});if(response.status>=400)throw new Error(response.json?.error || '请求失败');return response.json;};
  const center=window.createProcessingCenter({root:document.querySelector('#processing'),request,onNew:()=>bridge.call('navigate','share'),onOpenTask:id=>bridge.call('navigate','task:'+id),onOpenSource:(id)=>bridge.call('navigate','task:'+id),onDepth:deep=>{document.querySelector('#navigation').hidden=deep;}});
  let requested=new URLSearchParams(location.search).get('task');
  window.captureBack=()=>center.back();
  async function refresh(){if(document.hidden)return;try{const status=await bridge.call('status');document.body.dataset.theme=status.theme;document.querySelector('#processing').dataset.theme=status.theme;await center.refresh();if(requested && center.open(requested))requested=null;}catch{}}
  document.querySelectorAll('[data-native]').forEach(button=>button.onclick=()=>bridge.call('navigate',button.dataset.native));
  refresh();setInterval(refresh,5000);addEventListener('pageshow',refresh);
})();
