import fs from 'node:fs/promises';import {createRequire} from 'node:module';
const sharp=createRequire(import.meta.url)('sharp');
const dir='/Users/alexxiong/Documents/InspiraiNest/design-review/desktop-refactor/stage-06-account-v1';
const checks=[];
for(const [theme,id] of [['light','23sYr'],['dark','ShTBJ']]){
 const scene=`account-loading-1240-${theme}`,bounds=[],colors=[];
 for(const file of [`${dir}/evidence/native-${scene}.png`,`${dir}/prototype-2x/${id}.png`]){
  const {data,info}=await sharp(file).removeAlpha().raw().toBuffer({resolveWithObject:true});
  const at=(x,y)=>Array.from(data.subarray((y*info.width+x)*info.channels,(y*info.width+x)*info.channels+3));
  const fill=at(1400,400);colors.push(fill);
  let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
  for(let y=360;y<470;y++)for(let x=1020;x<2450;x++)if(at(x,y).every((v,i)=>v===fill[i])){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}
  if(!Number.isFinite(left))throw Error('Loading pixels absent');
  bounds.push([left/2,top/2,(right+1)/2,(bottom+1)/2]);
 }
 const delta=bounds[0].map((v,i)=>v-bounds[1][i]);
 checks.push({scene,actual:bounds[0],prototype:bounds[1],delta,fillRgb:colors,passed:delta.every(v=>Math.abs(v)<=1)});
 const {data,info}=await sharp(`${dir}/evidence/native-${scene}.png`).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const meta=await sharp(`${dir}/prototype-2x/${id}.png`).metadata();if(meta.width!==info.width||meta.height!==info.height)throw Error('Viewport mismatch');
 for(let i=3;i<data.length;i+=4)data[i]=Math.round(data[i]*.5);
 await sharp(`${dir}/prototype-2x/${id}.png`).composite([{input:data,raw:info}]).toFile(`${dir}/evidence/overlay-${scene}.png`);
}
await fs.writeFile(`${dir}/evidence/account-loading-checks.json`,JSON.stringify({scope:'Loading placeholder exact-fill exterior bounds only; rounded-edge AA and fill RGB reported separately; no full raster parity',checks,overlay:{alpha:.5,resized:false},passed:checks.every(x=>x.passed)},null,2));console.log(checks);
