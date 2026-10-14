import {TextInput} from '../components/FormControls';
import {ModuleContent,ModuleHeader} from '../components/ModuleLayout';
import {useEffect,useRef,useState} from 'react';
import {useLocation,useNavigate} from 'react-router-dom';
import {KeyRound,Loader,LogIn,LogOut,Monitor,X} from 'lucide-react';
import {Action} from '../components/Controls';
import {StatePanel} from '../components/AsyncState';
import {Modal} from '../components/Overlays';
import {AccountClient} from './client';
import type {AccountState} from './client';
import styles from './AccountContent.module.css';
export function AccountContent(){
 const location=useLocation(),navigate=useNavigate(),focusOnRead=location.state?.settingsFocus==='content';
 const [state,setState]=useState<AccountState>({connection:null,phase:'loading',error:null});
 const client=useRef<AccountClient|null>(null),form=useRef<HTMLFormElement>(null),root=useRef<HTMLDivElement>(null);
 const [server,setServer]=useState(''),[name,setName]=useState(''),[key,setKey]=useState(''),[factor,setFactor]=useState(''),[mode,setMode]=useState<'otp'|'recovery'>('otp'),[verify,setVerify]=useState(false),[invoker,setInvoker]=useState<HTMLButtonElement|null>(null);
 useEffect(()=>{const bridge=window.library;if(!bridge?.pair||!bridge.cancelLogin||!bridge.logout){setState({connection:null,phase:'idle',error:{message:'账号接口不可用'}});return;}
  let operationActive=false,initialRead=true;let previousConnection:AccountState["connection"]=null;
  const owner=new AccountClient({status:()=>bridge.status(),pair:input=>bridge.pair!(input),cancelLogin:()=>bridge.cancelLogin!(),logout:()=>bridge.logout!(),onChanged:callback=>bridge.onChanged?.(()=>callback())??(()=>{})},next=>{if(['signing-in','cancelling','signing-out'].includes(next.phase))operationActive=true;const completed=operationActive&&next.phase==='idle';if(completed)operationActive=false;const arrived=initialRead&&next.phase==='idle';if(arrived)initialRead=false;const focusArrival=arrived&&focusOnRead;setState(next);if(completed||focusArrival)requestAnimationFrame(()=>requestAnimationFrame(()=>{const selector=next.connection?.paired?'button':focusArrival?'input:not(:disabled),button:not(:disabled)':next.error?.code==='mfa_required'||next.error?.code==='mfa_invalid'?'[name=factor]':'input[type=password]';root.current?.querySelector<HTMLElement>(selector)?.focus({preventScroll:true});}));if(next.connection!==previousConnection){previousConnection=next.connection;if(next.connection?.server)setServer(next.connection.server);}if(next.connection?.paired){setKey('');setFactor('');setMode('otp');setVerify(false);setInvoker(null);}if(next.error?.code==='mfa_required'||next.error?.code==='mfa_invalid'){setVerify(true);requestAnimationFrame(()=>form.current?.querySelector<HTMLInputElement>('[name=factor]')?.focus());}});
  client.current=owner;void owner.load();return()=>{owner.dispose();if(client.current===owner)client.current=null;};
 },[]);
 const busy=state.phase!=='idle'||!client.current,paired=state.connection?.paired,readError=state.phase==='idle'&&state.connection===null&&state.error;
 const reload=async()=>{await client.current?.load();requestAnimationFrame(()=>requestAnimationFrame(()=>root.current?.querySelector<HTMLElement>('input:not(:disabled),button:not(:disabled)')?.focus({preventScroll:true})));};
 const submit=()=>{if(busy)return;void client.current?.login({server,name,key,...(verify?(mode==='otp'?{otp:factor}:{recoveryCode:factor}):{})});};
 return <ModuleContent ref={root} className={styles.content} data-region="账号内容"><ModuleHeader title="账号" height={29} data-region="内容标题"/>
 {state.phase==='loading'?<div aria-busy="true" className={styles.loading}/>:readError?<StatePanel kind="error" title={client.current?'账号读取失败':'账号接口不可用'} action={client.current?'重试':undefined} region="账号读取错误" onAction={()=>void reload()}/>:paired?<><div className={styles.field}><strong>资料库地址</strong><p>{state.connection!.server}</p></div><div className={styles.field}><strong>设备标识</strong><p>{state.connection!.deviceId??''}</p></div><div className={styles.actions}><Action icon={Monitor} disabled={busy} onClick={()=>navigate('/settings/account/devices'+location.search,{state:{settingsFocus:'content'}})}>授权设备</Action><Action icon={LogOut} disabled={busy} onClick={e=>setInvoker(e.currentTarget)}>退出登录</Action></div></>:<form ref={form} className={styles.form} onSubmit={e=>{e.preventDefault();submit();}}><fieldset disabled={busy} className={styles.fields}>
 <label className={styles.field}><strong>资料库地址</strong><TextInput type="url" required value={server} onChange={e=>setServer(e.target.value)} autoComplete="url"/></label>
 <label className={styles.field}><strong>设备名称</strong><TextInput required maxLength={100} value={name} onChange={e=>setName(e.target.value)} autoComplete="off"/></label>
 <label className={styles.field}><strong>登录密码或配对码</strong><TextInput type="password" required maxLength={200} value={key} onChange={e=>setKey(e.target.value)} placeholder="登录密码或配对码" autoComplete="current-password"/></label>
 {verify&&<label className={styles.field}><strong>{mode==='otp'?'验证码':'恢复码'}</strong><TextInput name="factor" required value={factor} onChange={e=>setFactor(e.target.value)} inputMode={mode==='otp'?'numeric':'text'} autoComplete="one-time-code" placeholder={mode==='otp'?'验证码':'恢复码'}/></label>}
 </fieldset><div className={styles.actions}><Action type="submit" kind="primary" icon={busy?Loader:LogIn} disabled={busy}>{busy?'登录中':'登录'}</Action>{verify&&!busy&&<Action className={styles.factorToggle} kind="ghost" icon={KeyRound} onClick={()=>{setFactor('');setMode(mode==='otp'?'recovery':'otp');requestAnimationFrame(()=>form.current?.querySelector<HTMLInputElement>('[name=factor]')?.focus());}}>{mode==='otp'?'使用恢复码':'使用验证码'}</Action>}{state.phase==='signing-in'&&<Action icon={X} onClick={()=>{void client.current?.cancel();setKey('');setFactor('');}}>取消</Action>}</div></form>}
 {state.error&&!readError&&<p role="alert" className={styles.error}>{state.error.message}</p>}
 {invoker&&<Modal title="退出登录" region="退出登录对话框" className={styles.dialog} invoker={invoker} close={()=>setInvoker(null)} focusCancel footer={<><Action data-initial-cancel onClick={()=>setInvoker(null)}>取消</Action><Action kind="primary" icon={LogOut} onClick={()=>{setInvoker(null);setKey('');setFactor('');void client.current?.logout();}}>退出登录</Action></>}><p>退出当前资料空间<span className={styles.questionMark}>？</span></p></Modal>}
 </ModuleContent>;
}
