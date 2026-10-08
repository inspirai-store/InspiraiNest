import {crc32} from 'node:zlib';
export function zip(files){
 let offset=0;const parts=[],central=[];
 for(const [name,text,mode=0o100644] of files){
  const filename=Buffer.from(name),body=Buffer.from(text),crc=crc32(body),header=Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt32LE(crc,14);header.writeUInt32LE(body.length,18);header.writeUInt32LE(body.length,22);header.writeUInt16LE(filename.length,26);
  parts.push(header,filename,body);
  const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(0x314,4);entry.writeUInt16LE(20,6);entry.writeUInt32LE(crc,16);entry.writeUInt32LE(body.length,20);entry.writeUInt32LE(body.length,24);entry.writeUInt16LE(filename.length,28);entry.writeUInt32LE((mode<<16)>>>0,38);entry.writeUInt32LE(offset,42);
  central.push(entry,filename);offset+=header.length+filename.length+body.length;
 }
 const entries=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(entries.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...parts,entries,end]);
}
export const files=[['SKILL.md','---\nname: fixture-market\ndescription: 测试市场技能\n---\nRead [script](scripts/extract.mjs).\n'],['scripts/extract.mjs','// No side effects\n',0o100755],['LICENSE','MIT']];
