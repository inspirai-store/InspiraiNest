const status=document.querySelector('#status'),connect=document.querySelector('#connect'),disconnect=document.querySelector('#disconnect'),code=document.querySelector('#code');
function render(result){status.textContent=result.error||result.title||'';if(result.error)return;connect.hidden=!!result.connected;disconnect.hidden=!result.connected;code.parentElement.hidden=!!result.connected;}
async function send(type){connect.disabled=disconnect.disabled=true;try{render(await chrome.runtime.sendMessage({type,code:code.value}));}catch(e){status.textContent=e.message;}finally{connect.disabled=disconnect.disabled=false;}}
connect.onclick=()=>send('connect');disconnect.onclick=()=>send('disconnect');send('status');
