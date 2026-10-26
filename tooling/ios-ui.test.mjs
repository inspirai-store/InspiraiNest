import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {verifyIOSUI,root,retired} from './check-ios-ui.mjs';
test('iPhone/iPad production sources use only the native baseline',()=>verifyIOSUI());
test('restored or staged old iOS UI blocks future builds',t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ios-ui-policy-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));for(const relative of retired){const file=path.join(dir,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'retired');assert.throws(()=>verifyIOSUI(dir),/Retired iPhone\/iPad UI/);fs.unlinkSync(file);}});
test('mobile staging never regenerates old iOS workbench assets',()=>{for(const name of ['stage-capture.mjs','stage-writing.mjs'])assert.doesNotMatch(fs.readFileSync(path.join(root,'collector/scripts',name),'utf8'),/mobile\/ios\/CaptureAssets/);});
