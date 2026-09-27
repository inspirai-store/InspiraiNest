import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const collector=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.join(collector,'brand/ui-icons');
const android=path.join(collector,'mobile/android/app/src/main');
const names=['library','collect','person','bookmark','scan','update'];
const write=(file,data)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,data);};
const manifest=[];
for(const name of names){
 const input=path.join(source,name+'-source.png');
 const metadata=await sharp(input).metadata();
 if(!metadata.hasAlpha)throw new Error(name+': generated source must have alpha');
 const trimmed=await sharp(input).trim({threshold:5}).png().toBuffer();
 const variants={};
 for(const size of [24,32,48,64,96,128,192]){
  const inner=Math.round(size*.88),pad=Math.floor((size-inner)/2);
  const artwork=await sharp(trimmed).resize(inner,inner,{fit:'contain',background:'#00000000',kernel:'lanczos3'}).png().toBuffer();
  const output=await sharp({create:{width:size,height:size,channels:4,background:'#00000000'}}).composite([{input:artwork,left:pad,top:pad}]).png({compressionLevel:9}).toBuffer();
  write(path.join(source,'export',`${name}-${size}.png`),output);variants[size]=output.length;
  if(size===128){write(path.join(android,'res/drawable-nodpi',`ic_brand_${name}.png`),output);write(path.join(android,'assets/mobile/icons',name+'.png'),output);}
 }
 manifest.push({name,source:name+'-source.png',sourceSize:[metadata.width,metadata.height],hasAlpha:metadata.hasAlpha,variants});
}
write(path.join(source,'manifest.json'),JSON.stringify({sizes:[24,32,48,64,96,128,192],runtimeSize:128,assets:manifest},null,2));
console.log(JSON.stringify(manifest.map(({name,variants})=>({name,runtimeBytes:variants[128]}))));
