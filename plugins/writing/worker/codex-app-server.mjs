import {EventEmitter} from 'node:events';
import readline from 'node:readline';
import spawn from 'cross-spawn';
import {resolveAgentProfile,commandEnvironment} from '../../ai-assistant/api/agents.mjs';
import {agentEnvironment} from '../../ai-assistant/api/agents.mjs';

/** One local app-server transport. Credentials remain owned by Codex. */
export class CodexAppServer extends EventEmitter {
  constructor({profile={command:'codex'},env=process.env,spawnProcess=spawn}={}){super();this.profile=resolveAgentProfile('codex',profile);this.env=env;this.spawnProcess=spawnProcess;this.pending=new Map();this.sequence=0;}
  async start(){
    if(this.ready)return this.ready;
    this.ready=(async()=>{
      const env=commandEnvironment(this.profile,agentEnvironment(this.env));
      delete env.COLLECTOR_CONFIG;delete env.BLOG_TOKEN;delete env.BLOG_CONFIG;
      this.process=this.spawnProcess(this.profile.command,['app-server','--listen','stdio://'],{stdio:['pipe','pipe','pipe'],env,windowsHide:true});
      this.process.on('error',error=>this.fail(error));this.process.on('exit',()=>this.fail(new Error('Codex 会话进程已退出')));
      this.process.stderr.on('data',()=>{});
      this.lines=readline.createInterface({input:this.process.stdout});this.lines.on('line',line=>{let msg;try{msg=JSON.parse(line);}catch{return;}
        if(msg.id!==undefined&&this.pending.has(msg.id)&&!msg.method){const p=this.pending.get(msg.id);this.pending.delete(msg.id);clearTimeout(p.timer);msg.error?p.reject(new Error(msg.error.message||'Codex 请求失败')):p.resolve(msg.result);}
        else if(msg.method&&msg.id!==undefined){
          // These workflows use application APIs for writes. No terminal or
          // filesystem approval is silently accepted on the user's behalf.
          const result=msg.method==='item/permissions/requestApproval'?{permissions:{},scope:'turn'}:msg.method==='item/tool/requestUserInput'?{answers:{}}:msg.method==='mcpServer/elicitation/request'?{action:'decline',content:null}:{decision:'decline'};
          this.send({id:msg.id,result});
        } else if(msg.method)this.emit('notification',msg);
      });
      await this.request('initialize',{clientInfo:{name:'inspirainest_creation',title:'灵藏',version:'1.0.0'}});this.send({method:'initialized'});
    })().catch(error=>{this.ready=null;throw error;});
    return this.ready;
  }
  send(value){if(!this.process?.stdin.writable)throw Error('Codex 未连接');this.process.stdin.write(JSON.stringify(value)+'\n');}
  request(method,params={}){return new Promise((resolve,reject)=>{const id=++this.sequence,timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Codex 请求超时：'+method));},30000);this.pending.set(id,{resolve,reject,timer});try{this.send({id,method,params});}catch(e){clearTimeout(timer);this.pending.delete(id);reject(e);}});}
  fail(error){this.ready=null;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();this.emit('disconnected',error);}
  async account(){await this.start();return this.request('account/read',{refreshToken:false});}
  async login(){await this.start();return this.request('account/login/start',{type:'chatgpt'});}
  async cancelLogin(loginId){await this.start();return this.request('account/login/cancel',{loginId});}
  async turn(threadId,text,{schema,signal,onDelta=()=>{}}={}){
    await this.start();if(signal?.aborted)throw new Error('已停止');
    return new Promise((resolve,reject)=>{
      let turnId,output='',finalOutput='',lastMessage='',done=false;
      const cleanup=()=>{this.off('notification',listen);this.off('disconnected',disconnect);signal?.removeEventListener('abort',abort);};
      const finish=(error,result)=>{if(done)return;done=true;cleanup();error?reject(error):resolve(result);};
      const disconnect=error=>finish(error);
      const abort=()=>{if(turnId)void this.request('turn/interrupt',{threadId,turnId}).catch(()=>{});finish(new Error('已停止'));};
      const listen=msg=>{const p=msg.params||{};if(p.threadId!==threadId)return;
        if(msg.method==='item/agentMessage/delta'){output+=p.delta||'';onDelta(p.delta||'');}
        if(msg.method==='item/completed'&&p.item?.type==='agentMessage'){lastMessage=p.item.text||'';if(p.item.phase==='final_answer')finalOutput=lastMessage;}
        if(msg.method==='turn/completed'){const t=p.turn;finish(t?.status==='completed'?null:new Error(t?.error?.message||'Codex 轮次'+(t?.status||'失败')),finalOutput||lastMessage||output);}
      };
      this.on('notification',listen);this.on('disconnected',disconnect);signal?.addEventListener('abort',abort,{once:true});
      this.request('turn/start',{threadId,input:[{type:'text',text}],...(schema?{outputSchema:schema}:{})}).then(result=>{turnId=result.turn.id;if(signal?.aborted)abort();}).catch(e=>finish(e));
    });
  }
  close(){this.lines?.close();this.process?.kill();this.fail(new Error('Codex 连接已关闭'));}
}

// Decode only complete characters from a streaming JSON string field.
export function streamedReply(json){
  const m=/"reply"\s*:\s*"/.exec(json);if(!m)return '';
  let raw='';for(let i=m.index+m[0].length;i<json.length;i++){
    const c=json[i];if(c==='"')break;
    if(c==='\\'){const next=json[i+1];if(!next)break;if(next==='u'){if(!/^[a-f0-9]{4}$/i.test(json.slice(i+2,i+6)))break;raw+=json.slice(i,i+6);i+=5;}else{raw+=json.slice(i,i+2);i++;}}
    else raw+=c;
  }
  try{return JSON.parse('"'+raw+'"');}catch{return '';}
}
