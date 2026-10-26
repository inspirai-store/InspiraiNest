const encoder=new TextEncoder();
const crcTable=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc(bytes:Uint8Array){let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function concat(chunks:Uint8Array[]){const bytes=new Uint8Array(chunks.reduce((n,c)=>n+c.length,0));let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;}
export function zipFiles(files:{name:string;bytes:Uint8Array}[]){
 const local:Uint8Array[]=[],central:Uint8Array[]=[],names=new Set<string>();let offset=0;
 for(const file of files){if(!file.name||/^[\\/]|^[a-z]:|[\x00-\x1f]/i.test(file.name)||file.name.split(/[\\/]/).some(p=>p==='..'||p==='.'||!p)||names.has(file.name.toLowerCase()))throw Error('导出文件路径无效或重复');names.add(file.name.toLowerCase());const name=encoder.encode(file.name),checksum=crc(file.bytes),head=new Uint8Array(30+name.length),h=new DataView(head.buffer);h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x800,true);h.setUint16(12,33,true);h.setUint32(14,checksum,true);h.setUint32(18,file.bytes.length,true);h.setUint32(22,file.bytes.length,true);h.setUint16(26,name.length,true);head.set(name,30);local.push(head,file.bytes);
  const entry=new Uint8Array(46+name.length),v=new DataView(entry.buffer);v.setUint32(0,0x02014b50,true);v.setUint16(4,20,true);v.setUint16(6,20,true);v.setUint16(8,0x800,true);v.setUint16(14,33,true);v.setUint32(16,checksum,true);v.setUint32(20,file.bytes.length,true);v.setUint32(24,file.bytes.length,true);v.setUint16(28,name.length,true);v.setUint32(42,offset,true);entry.set(name,46);central.push(entry);offset+=head.length+file.bytes.length;
 }
 const directory=concat(central),end=new Uint8Array(22),v=new DataView(end.buffer);v.setUint32(0,0x06054b50,true);v.setUint16(8,files.length,true);v.setUint16(10,files.length,true);v.setUint32(12,directory.length,true);v.setUint32(16,offset,true);return concat([...local,directory,end]);
}
