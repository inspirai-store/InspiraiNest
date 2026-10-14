const path=require('node:path'),crypto=require('node:crypto');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
exports.seed=async({profile,configuration,api,portable=false})=>{
 if(!path.basename(profile).startsWith('inspirainest-formal-settings-'))throw Error('isolated profile required');
 const items=[['网页归档','codex','user'],['文章摘要','codebuddy','project']].map(([name,agent,scope])=>({id:hash(configuration.deviceId+':'+name),name,agent,scope,description:'保存网页正文、图片与来源信息，生成中文摘要。',hash:null,portable:false,loadState:'loaded',enabled:true,directory:'C:\\QA\\skills\\'+agent,requirements:{},dependencies:{state:'unknown',missing:[],unknown:['依赖未声明']},sharedWith:[]}));
 let packageData=null;
 if(portable){packageData=await exports.createPackage(profile);items[0]={...items[0],hash:packageData.bundle.hash,portable:true,directory:packageData.directory,realDirectory:packageData.directory};}
 await api(configuration,'/api/skills/environment','POST',{schemaVersion:1,snapshotId:hash(configuration.deviceId+':skills-inventory-v1'),digest:hash(JSON.stringify(items)),scannedAt:new Date().toISOString(),page:0,final:true,platform:'win32',agents:['codex','codebuddy'].map(name=>({name,installed:true,version:'1.0.0',probeState:'available',executionEnabled:true})),items,projects:['C:\\QA\\projects\\library']});
 return {items,packageData};
};

exports.createPackage=async(profile)=>{
 if(!path.basename(profile).startsWith('inspirainest-formal-settings-'))throw Error('isolated profile required');
 const fs=require('node:fs'),directory=path.join(profile,'skill-packages','web-archive');fs.mkdirSync(directory,{recursive:true});
 fs.writeFileSync(path.join(directory,'SKILL.md'),'---\nname: web-archive\ndescription: 保存网页正文、图片与来源信息\nversion: 1.0.0\n---\n\n读取网页正文并生成中文摘要。\n');
 const {packageSkill}=await import('../../../src/skill-package.mjs');return {directory,bundle:packageSkill(directory)};
};
