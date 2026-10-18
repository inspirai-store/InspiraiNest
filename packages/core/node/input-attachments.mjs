import yauzl from 'yauzl';
import { requireValue } from './common.mjs';

export const INPUT_FILE_LIMIT = 32 * 1024 * 1024;
export const INPUT_TOTAL_LIMIT = 128 * 1024 * 1024;
export const documentExtensions = { 'text/plain':'txt', 'text/markdown':'md', 'application/pdf':'pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'docx' };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function decodeInputText(bytes) {
  if (bytes[0] === 255 && bytes[1] === 254) return new TextDecoder('utf-16le',{fatal:true}).decode(bytes.subarray(2));
  if (bytes[0] === 254 && bytes[1] === 255) return new TextDecoder('utf-16be',{fatal:true}).decode(bytes.subarray(2));
  requireValue(!bytes.includes(0), 'Text file contains binary data', 415);
  try { return new TextDecoder('utf-8',{fatal:true}).decode(bytes); }
  catch { return new TextDecoder('gb18030',{fatal:true}).decode(bytes); }
}

// Inspect the OOXML package without extracting paths or running embedded content.
export function readDocxXml(bytes) {
  return new Promise((resolve,reject) => {
    yauzl.fromBuffer(bytes,{lazyEntries:true,validateEntrySizes:true},(error,zip) => {
      if(error) return reject(Object.assign(new Error('Invalid DOCX package'),{status:415}));
      let xml,types=false,count=0,total=0,finished=false;
      const finish=(error,value) => {if(finished)return;finished=true;zip.close();error?reject(error):resolve(value);};
      zip.on('error',error=>finish(Object.assign(error,{status:415})));
      zip.on('end',()=>finish(!types||!xml?Object.assign(new Error('File is not a Word DOCX document'),{status:415}):null,xml));
      zip.on('entry',entry=>{
        if(++count>10000 || (total+=entry.uncompressedSize)>256*1024*1024 || entry.generalPurposeBitFlag&1) return finish(Object.assign(new Error('DOCX is encrypted or exceeds processing limits'),{status:415}));
        if(entry.fileName==='[Content_Types].xml')types=true;
        if(entry.fileName!=='word/document.xml'){zip.readEntry();return;}
        if(entry.uncompressedSize>16*1024*1024)return finish(Object.assign(new Error('DOCX body exceeds processing limits'),{status:415}));
        zip.openReadStream(entry,(error,stream)=>{
          if(error)return finish(Object.assign(error,{status:415}));
          const chunks=[];let size=0;
          stream.on('data',chunk=>{size+=chunk.length;if(size>16*1024*1024){stream.destroy();finish(Object.assign(new Error('DOCX body exceeds processing limits'),{status:415}));}else chunks.push(chunk);});
          stream.on('error',error=>finish(Object.assign(error,{status:415})));
          stream.on('end',()=>{if(finished)return;xml=Buffer.concat(chunks).toString('utf8');if(!/<(?:\w+:)?document\b/.test(xml))return finish(Object.assign(new Error('Invalid DOCX body'),{status:415}));zip.readEntry();});
        });
      });zip.readEntry();
    });
  });
}

export async function validDocument(bytes,mime) {
  try {
    if(mime==='application/pdf')return bytes.subarray(0,1024).includes(Buffer.from('%PDF-'));
    if(mime===Object.keys(documentExtensions)[3]) {
      // Intake keeps recognizable encrypted/damaged Word originals; parsing decides whether to pause.
      const encrypted = bytes.subarray(0,8).equals(Buffer.from('d0cf11e0a1b11ae1','hex')) && bytes.includes(Buffer.from('EncryptedPackage','utf16le')) && bytes.includes(Buffer.from('EncryptionInfo','utf16le'));
      return encrypted || bytes.subarray(0,2).toString() === 'PK' && bytes.includes(Buffer.from('[Content_Types].xml')) && bytes.includes(Buffer.from('word/document.xml'));
    }
    const value=decodeInputText(bytes);
    return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
  } catch { return false; }
}

export async function resolveInputAttachments(store,input=[]) {
  requireValue(Array.isArray(input)&&input.length<=20,'At most 20 input files');
  const result=[];let total=0;const ids=new Set();
  for(const item of input){
    requireValue(item&&uuid.test(item.id)&&typeof item.sha256==='string'&&/^[a-f0-9]{64}$/.test(item.sha256)&&typeof item.name==='string'&&item.name.trim()&&item.name.length<=200&&!/[\u0000-\u001f]/.test(item.name),'Invalid input attachment');
    const attachmentId=item.id.toLowerCase();requireValue(!ids.has(attachmentId),'Duplicate input attachment ID');ids.add(attachmentId);
    const media=await store.get('record-media',item.sha256);requireValue(media,'Input file has not been uploaded',409);
    requireValue(media.bytes>0&&media.bytes<=INPUT_FILE_LIMIT,'Input file exceeds 32 MiB',413);
    total+=media.bytes;requireValue(total<=INPUT_TOTAL_LIMIT,'Input files exceed 128 MiB',413);
    result.push({id:attachmentId,name:item.name,sha256:media.id,mime:media.mime,bytes:media.bytes});
  }
  return result;
}

export const inputReferences = files => files.map(({id,name,sha256})=>({id,name,sha256}));
