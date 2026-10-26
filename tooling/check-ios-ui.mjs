import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
export const root=fileURLToPath(new URL('../',import.meta.url));
export const retired=['App/CaptureView.swift','App/LibraryReaderView.swift','App/PairingScannerView.swift','App/ArchiveAttachmentsView.swift','App/DraftReviewView.swift','CaptureAssets'];
export function verifyIOSUI(directory=path.join(root,'apps/ios')){
 for(const file of retired)if(fs.existsSync(path.join(directory,file)))throw Error('Retired iPhone/iPad UI: '+file);
 const entry=fs.readFileSync(path.join(directory,'App/PersonalLibraryApp.swift'),'utf8');
 if(!entry.includes('NativeLibraryRoot()')||entry.includes('TabView('))throw Error('iPhone/iPad production root must use NativeLibraryRoot');
 for(const name of fs.readdirSync(path.join(directory,'App')).filter(n=>n.endsWith('.swift'))){
  const source=fs.readFileSync(path.join(directory,'App',name),'utf8');
  if(/(?:struct\s+(?:CaptureView|LibraryReaderView)|class\s+(?:CaptureController|ReaderModel)\s*:)/.test(source))throw Error('Retired iPhone/iPad UI copied into '+name);
 }
 const config=fs.readFileSync(path.join(directory,'project.yml'),'utf8');
 if(!config.includes('Enforce native UI generation')||config.includes('- path: CaptureAssets'))throw Error('iOS build must enforce the native UI baseline');
 const info=fs.readFileSync(path.join(directory,'Config/App-Info.plist'),'utf8');
 if(!info.includes('<key>InspiraiNestUIBaseline</key><string>native-v1</string>'))throw Error('iOS artifact must identify the native UI baseline');
 for(const file of ['NativeLibraryRoot.swift','NativeRecordListView.swift','NativeReaderView.swift','LearningView.swift'])if(!fs.existsSync(path.join(directory,'App',file)))throw Error('Native UI source missing: '+file);
}
if(process.argv[1]===fileURLToPath(import.meta.url)){verifyIOSUI();console.log('iPhone/iPad native UI baseline enforced; legacy UI is not buildable.');}
