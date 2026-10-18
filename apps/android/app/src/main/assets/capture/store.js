(() => {
  'use strict';
  const opened = new Promise((resolve,reject) => {
    const request=indexedDB.open('inspirainest-capture-v1',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('items',{keyPath:'id'});
    request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error);
  });
  async function operation(mode,work) {
    const db=await opened;
    return new Promise((resolve,reject)=>{const tx=db.transaction('items',mode),request=work(tx.objectStore('items'));let result;
      request.onsuccess=()=>{result=request.result;}; tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error || new Error('本机保存被中断'));});
  }
  function mutate(work){return operation('readwrite',store=>{const read=store.getAll();read.addEventListener('success',()=>{try{for(const item of work(read.result))store.put(item);}catch(error){store.transaction.abort();}});return read;});}
  window.captureStore={mutate,get:id=>operation('readonly',store=>store.get(id)),all:()=>operation('readonly',store=>store.getAll()),put:item=>operation('readwrite',store=>store.put(item)),remove:id=>operation('readwrite',store=>store.delete(id))};
})();
