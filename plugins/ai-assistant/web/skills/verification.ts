import type {SkillVersion} from './versions.ts';
import type {SkillOperationInput} from './operations.ts';
export function verificationInput(version:SkillVersion,deviceId:string,agent:'codex'|'codebuddy',sample:string,expectedText:string,requestId:string):SkillOperationInput{
 if(!version.policy.agents.includes(agent))throw Error('版本不支持此 Agent');
 let url:URL;try{url=new URL(sample);}catch{throw Error('公开样本链接无效');}
 if(url.protocol!=='https:'||url.hostname!=='mp.weixin.qq.com'||url.username||url.password)throw Error('请填写公开微信文章链接');
 if(expectedText.trim().length<20||expectedText.length>1000)throw Error('预期正文须为 20—1000 字符');
 return {action:'verify',deviceId,versionId:version.id,agent,sample:url.href,expectedText,requestId};
}
