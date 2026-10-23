import {CodexAppServer} from '../../plugins/writing/worker/codex-app-server.mjs';
import {desktopExecutionEnvironment} from './execution-environment.mjs';
import {creationRoute} from '../../packages/core/node/creation-contract.mjs';
import {captureRequest} from './capture-client.mjs';
export class DesktopCreation {
  constructor({owner,configuration,openExternal}){this.owner=owner;this.configuration=configuration;this.openExternal=openExternal;}
  async runtime(){if(!this.codex)this.codex=new CodexAppServer({env:await desktopExecutionEnvironment({...process.env,COLLECTOR_ELECTRON_NODE:'1'}),profile:{command:this.configuration().agents?.codex?.command||'codex'}});return this.codex;}
  async account(){return (await this.runtime()).account();}
  async login(){const result=await (await this.runtime()).login();const url=new URL(result.authUrl);if(url.protocol!=='https:'||!['chatgpt.com','auth.openai.com'].includes(url.hostname))throw Error('Codex 返回的登录地址无效');await this.openExternal(url.href);return {loginId:result.loginId};}
  async cancel(input){return (await this.runtime()).cancelLogin(input.loginId);}
  request(input){if(!creationRoute(input?.route,input?.method||'GET'))throw Error('创作接口无效');return captureRequest(this.owner,input);}
  close(){this.codex?.close();}
}
