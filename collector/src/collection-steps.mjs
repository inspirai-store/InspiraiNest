import fs from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { unreadableText, collectionStageNames } from './text-encoding.mjs';

const stages = new Set(['fetching', 'transcribing', 'analyzing', 'archiving']);
// Optional, explicit Agent progress protocol. Ordinary stdout is not a progress API.
export function watchCollectionSteps(workspace, report, diagnose = () => {}) {
  const file = path.join(workspace, 'collector-events.jsonl');
  let offset = fs.existsSync(file) ? fs.statSync(file).size : 0, pending = '', lastError;
  let decoder = new StringDecoder('utf8');
  const read = () => {
    let fd;
    try {
      if (!fs.existsSync(file)) return;
      if (fs.lstatSync(file).isSymbolicLink()) throw Object.assign(new Error('采集进度文件不能指向目录之外'), { code: 'STEP_LOG_PATH' });
      fd = fs.openSync(file, 'r');
      const size = fs.fstatSync(fd).size;
      if (size < offset) { offset = 0; pending = ''; decoder = new StringDecoder('utf8'); }
      if (size - offset > 65536) { offset = size - 65536; pending = ''; decoder = new StringDecoder('utf8'); }
      const buffer = Buffer.alloc(Math.min(65536, size - offset));
      const length = fs.readSync(fd, buffer, 0, buffer.length, offset); offset += length;
      const lines = (pending + decoder.write(buffer.subarray(0, length))).split('\n');
      pending = lines.pop().slice(-4000);
      for (const line of lines) {
        try {
          const entry = JSON.parse(line.replace(/^\uFEFF/, ''));
          if (!stages.has(entry.stage) || !['info', 'warn'].includes(entry.level || 'info') || typeof entry.message !== 'string') continue;
          if (unreadableText(entry.message)) {
            if (lastError !== 'STEP_ENCODING') {
              lastError = 'STEP_ENCODING';
              diagnose(Object.assign(new Error('采集程序写入的阶段记录含乱码，请使用 UTF-8 写入'), { code: 'STEP_ENCODING', stage: entry.stage }));
            }
            report({ logStage: entry.stage, level: 'warn', message: `${collectionStageNames[entry.stage]}阶段的说明文字编码异常，请查看系统问题；原始记录保留本机` });
            continue;
          }
          report({ logStage: entry.stage, level: entry.level || 'info', message: entry.message.slice(0, 500) });
        } catch { /* Incomplete / malformed progress is never treated as task failure. */ }
      }
    } catch (error) { if (lastError !== error.code) { lastError = error.code; diagnose(error); } }
    finally { if (fd !== undefined) fs.closeSync(fd); }
  };
  const timer = setInterval(read, 1000);
  return () => { clearInterval(timer); read(); };
}
