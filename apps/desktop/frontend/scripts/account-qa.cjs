// Local synthetic account credentials only; production OwnerClient REST and persistence.
const {ipcMain,Menu,MenuItem}=require('electron');
exports.install=async({window,owner,server,store,hash,masterKey,profile})=>{
 const {logoutOwnerSession,pairOwnerSession}=await import('../../account-session.mjs');
 const creator=(await store.list('device')).find(d=>d.role==='owner'&&!d.revokedAt);
 if(!creator)throw Error('QA owner missing');
 if(process.env.ACCOUNT_QA_MFA==='1'){
  const existing=await store.get('setting','account-security-v1');if(existing?.credentialChangedAt||existing?.totp)throw Error('MFA QA requires a fresh isolated service');
  await owner.api('/api/security/credential','POST',{key:masterKey,newKey:'account-qa-password',confirmKey:'account-qa-password'});
  const setup=await owner.api('/api/security/totp/setup','POST',{key:'account-qa-password'});
  const OTPAuth=await import('otpauth');const totp=new OTPAuth.TOTP({issuer:'InspiraiNest',label:'Library owner',secret:setup.secret,algorithm:'SHA1',digits:6,period:30});
  const confirmed=await owner.api('/api/security/totp/confirm','POST',{key:'account-qa-password',otp:totp.generate()});
  // Disposable synthetic credentials for native UI entry; never production identity.
  const fs=require('node:fs'),path=require('node:path');fs.writeFileSync(path.join(profile,'account-mfa-ui-fixture.json'),JSON.stringify({server,recoveryCode:confirmed.recoveryCodes[0],scope:'fresh disposable local QA service only'}),{mode:0o600});
 }
 const {WorkerManager}=await import('../../manager.mjs');const {atomicJson}=await import('../../../../packages/core/node/common.mjs');const path=require('node:path');const configFile=path.join(profile,'account-worker.json');atomicJson(configFile,{server,dataDir:path.join(profile,'account-worker-data')});const manager=new WorkerManager(configFile);owner.workerServer=()=>manager.configuration().server;
 const targets=new Map([[server,{store,creator}]]);let secondService=null;
 if(process.env.ACCOUNT_QA_SESSION==='1'){
  const {createService}=await import('../../../../services/api/server.mjs');const {api}=await import('../../../../services/worker/worker.mjs');const {secret}=await import('../../../../packages/core/node/common.mjs');const keyB=secret();secondService=createService({pluginProfile:'legacy',dataDir:path.join(profile,'account-b'),masterKey:keyB});await new Promise(resolve=>secondService.server.listen(0,'127.0.0.1',resolve));const serverB='http://127.0.0.1:'+secondService.server.address().port;const pairedB=await api({server:serverB},'/api/pair','POST',{key:keyB,name:'Account QA B'});await require('./library-qa-fixtures.cjs').seedLibrary((config,route,method,body)=>api({...config,token:pairedB.token},route,method,route==='/api/archives'&&method==='POST'?{...body,meta:{...body.meta,title:'空间 B · '+body.meta.title}}:body),serverB,secondService.store);targets.set(serverB,{store:secondService.store,creator:pairedB.device});require('node:fs').writeFileSync(path.join(profile,'account-services.json'),JSON.stringify({A:server,B:serverB,scope:'two disposable local QA services'}));
 }
 const originalSave=owner.saveCredential.bind(owner);
 owner.encryption={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value),decryptString:value=>value.toString()};
 let controller=null,delayNextPair=0,delayNextStatus=0,failStatus=false;owner.readStatusForQA=async()=>{const delay=delayNextStatus;delayNextStatus=0;if(delay)await new Promise(resolve=>setTimeout(resolve,delay));if(failStatus)throw Error("Isolated account status failure");return owner.status();};
 const renew=target=>target.store.put('pairing',{id:hash('desktop-qa-login'),creatorId:target.creator.id,expiresAt:new Date(Date.now()+60000).toISOString(),usedAt:null});
 owner.saveCredential=input=>{if(controller?.signal.aborted)throw Error('登录已取消');return originalSave(input);};
 const trusted=event=>{if(event.sender!==window.webContents)throw Error('Invalid QA sender');};
 const changed=()=>window.webContents.send('records-qa:changed',owner.status());
 ipcMain.handle('account-qa:pair',async(event,input)=>{trusted(event);if(controller)return {loginError:{message:'登录正在进行'}};const current=new AbortController();controller=current;try{const target=targets.get(input.server);if(!target)throw Error('QA只允许隔离服务');await renew(target);const delay=delayNextPair;delayNextPair=0;if(delay)await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,delay);current.signal.addEventListener('abort',()=>{clearTimeout(timer);reject(Error('登录已取消'));},{once:true});});await pairOwnerSession({input,owner,manager,controller:current,current:()=>controller===current&&!current.signal.aborted,publish:()=>changed()});const result=owner.status();if(current.signal.aborted)throw Error('登录已取消');return result;}catch(error){return {loginError:{message:current.signal.aborted?'登录已取消':error.message,code:error.code,status:error.status}};}finally{if(controller===current)controller=null;}});
 ipcMain.handle('account-qa:cancel',event=>{trusted(event);controller?.abort();return true;});
 ipcMain.handle('account-qa:logout',event=>{trusted(event);return logoutOwnerSession({owner,cancelLogin:()=>controller?.abort(),publish:()=>changed()});});
 const menu=Menu.getApplicationMenu()||new Menu();menu.append(new MenuItem({label:'Account QA',submenu:[{label:'账号页面',accelerator:'CmdOrCtrl+Alt+Shift+A',click:()=>{const url=new URL(window.webContents.getURL());url.hash='/settings/account?data=local&theme=light';void window.loadURL(url.href);}},{label:'账号加载中',accelerator:'CmdOrCtrl+Alt+Shift+G',click:()=>{delayNextStatus=15000;window.webContents.reloadIgnoringCache();}},{label:'账号读取失败',accelerator:'CmdOrCtrl+Alt+Shift+F',click:()=>{failStatus=true;window.webContents.reloadIgnoringCache();}},{label:'恢复账号读取',accelerator:'CmdOrCtrl+Alt+Shift+R',click:()=>{failStatus=false;}},{label:'下次登录延迟',accelerator:'CmdOrCtrl+Alt+Shift+9',click:()=>{delayNextPair=15000;}}]}));Menu.setApplicationMenu(menu);
 return()=>{controller?.abort();void secondService?.close();};
};
