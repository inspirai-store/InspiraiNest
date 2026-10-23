// Only fixed messages enter diagnostic sync. Private prompts, replies and documents stay local.
export function creationFailure(error,stage){
 const text=String(error?.message||''),code=String(error?.code||'');
 if(error?.name==='AbortError')return {code:'CREATION_CANCELLED',message:'创作执行已停止，已有文稿保留'};
 if(/auth|login|登录|unauthorized/i.test(text)||error?.status===401)return {code:'CREATION_AUTH_REQUIRED',message:'创作执行工具需要登录或重新授权'};
 if(/permission|denied|权限/i.test(text)||error?.status===403)return {code:'AGENT_PERMISSION',message:'创作执行命令被权限检查拒绝'};
 if(/timeout|超时/i.test(text+code))return {code:'AGENT_TIMEOUT',message:'创作执行超时，已有成果保留'};
 if(/ENOTFOUND|EHOSTUNREACH|ECONN|NETWORK/.test(text+code))return {code:'CREATION_NETWORK',message:'创作执行连接失败，已有成果保留'};
 if(/ENOENT/.test(text+code))return {code:'CREATION_DEPENDENCY',message:'创作执行程序缺失'};
 if(stage==='saving')return {code:'CREATION_UPLOAD',message:'创作结果尚未确认保存，本机检查点保留'};
 return {code:'CREATION_FAILED',message:'创作执行失败，原因待确认'};
}
