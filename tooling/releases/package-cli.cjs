const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
module.exports=async context=>{
 const platform=context.electronPlatformName,arch={0:'386',1:'amd64',2:'arm',3:'arm64'}[context.arch];
 if(!arch)throw Error('Unsupported CLI package architecture');
 const darwin=platform==='darwin',payload=path.join(context.appOutDir,...(darwin?[context.packager.appInfo.productFilename+'.app','Contents','Resources','app']:['resources','app']));
 const file=path.join(payload,'bin',platform==='win32'?'lingnest.exe':'lingnest');fs.mkdirSync(path.dirname(file),{recursive:true});
 const result=spawnSync('go',['build','-trimpath','-ldflags','-X main.version='+context.packager.appInfo.version,'-o',file,'.'],{cwd:path.resolve(__dirname,'../../apps/cli'),env:{...process.env,GOOS:platform==='win32'?'windows':platform,GOARCH:arch,CGO_ENABLED:'0'},stdio:'inherit'});
 if(result.status!==0)throw Error('Bundled library CLI build failed'+(result.error?': '+result.error.message:''));
};
