import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
const sharp=createRequire(import.meta.url)('sharp');
const dir='/Users/alexxiong/Documents/InspiraiNest/design-review/desktop-refactor/stage-06-account-v1';
const checks=[];
for(const [theme,id] of [['light','5REPk'],['dark','oSICt']]){
 const scene=`account-load-error-1240-${theme}`;
 const a=JSON.parse(await fs.readFile(`${dir}/evidence/native-${scene}.json`));
 for(const [name,actual,expected] of [
  ['账号读取错误',a.regions.find(x=>x.name==='账号读取错误'),{x:520,y:189,w:696,h:607}],
  ['重新加载',a.buttons.find(x=>x.label==='重新加载'),{x:829.5,y:518,w:77,h:36}],
 ]){
  if(!actual)throw Error(`Missing ${name}`);
  const delta=['x','y','w','h'].map(k=>actual[k]-expected[k]);
  checks.push({scene,name,actual,expected,delta,passed:delta.every(x=>Math.abs(x)<=1)});
 }
 const proto=`${dir}/prototype-2x/${id}.png`;
 const {data,info}=await sharp(`${dir}/evidence/native-${scene}.png`).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const size=await sharp(proto).metadata();
 if(size.width!==info.width||size.height!==info.height)throw Error('Viewport mismatch');
 for(let i=3;i<data.length;i+=4)data[i]=Math.round(data[i]*.5);
 await sharp(proto).composite([{input:data,raw:info}]).toFile(`${dir}/evidence/overlay-${scene}.png`);
}
const failed=JSON.parse(await fs.readFile(`${dir}/evidence/native-account-load-retry-error-1240-dark.json`));
const recovered=JSON.parse(await fs.readFile(`${dir}/evidence/native-account-load-recovered-1240-dark.json`));
await fs.writeFile(`${dir}/evidence/account-read-error-checks.json`,JSON.stringify({scope:'Two error panel and retry button bounds; native retry failure and successful recovery focus; no full raster parity',checks,failedRetryFocus:failed.focused,recoveredFocus:recovered.focused,overlay:{alpha:.5,resized:false},passed:checks.every(x=>x.passed)},null,2));
console.log({checks:checks.length,passed:checks.every(x=>x.passed),failedRetryFocus:failed.focused,recoveredFocus:recovered.focused});
