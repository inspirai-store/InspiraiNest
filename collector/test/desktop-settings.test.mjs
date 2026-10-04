import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { DesktopSettings } from '../desktop/settings.mjs';
import { DesktopLoginItem } from '../desktop/login-item.mjs';

class Theme extends EventEmitter {
  themeSource = 'system'; systemDark = false;
  get shouldUseDarkColors() { return this.themeSource === 'dark' || this.themeSource === 'system' && this.systemDark; }
}
test('desktop preferences persist independently of resolved system theme', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-settings-')), file=path.join(root,'settings.json'), nativeTheme=new Theme();
  const settings=new DesktopSettings({file,nativeTheme});
  assert.equal(settings.snapshot().themeMode,'system'); assert.equal(settings.snapshot().closeBehavior,'tray');
  assert.equal(settings.snapshot().migrationNeeded,true);
  settings.update({themeMode:'dark',closeBehavior:'quit'}); settings.dispose();
  const restored=new DesktopSettings({file,nativeTheme}); assert.equal(restored.snapshot().migrationNeeded,false);
  assert.equal(restored.snapshot().themeMode,'dark'); assert.equal(restored.snapshot().closeBehavior,'quit');
  restored.update({themeMode:'system'}); let changed; restored.once('changed',s=>changed=s);
  nativeTheme.systemDark=true; nativeTheme.emit('updated'); assert.equal(changed.resolvedTheme,'dark');
  assert.equal(JSON.parse(fs.readFileSync(file)).themeMode,'system');
  restored.update({themeMode:'light'}); nativeTheme.emit('updated'); assert.equal(restored.snapshot().resolvedTheme,'light');
  restored.dispose(); assert.equal(nativeTheme.listenerCount('updated'),0);
});
test('preference updates reject unsupported fields and preserve saved values on write failure', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-settings-invalid-')), file=path.join(root,'settings.json');
  const settings=new DesktopSettings({file,nativeTheme:new Theme()}); settings.update({themeMode:'dark'});
  for (const patch of [null,[],{themeMode:'auto'},{closeBehavior:'kill'},{path:'/tmp/other'},{token:'secret'},{themeMode:null},{launchAtLogin:'yes'},{args:['--anything']}]) assert.throws(()=>settings.update(patch),/设置内容无效/);
  const bad=new DesktopSettings({file:root,nativeTheme:new Theme()}); assert.throws(()=>bad.update({themeMode:'light'}),/设置未保存/);
  assert.equal(bad.snapshot().themeMode,'system'); assert.equal(bad.snapshot().migrationNeeded,true);
  settings.dispose();bad.dispose();
});
test('login preference migrates, persists a disable, and rolls back OS registration on save failure', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-login-')), file=path.join(root,'settings.json');
  fs.writeFileSync(file,JSON.stringify({version:1,themeMode:'dark',closeBehavior:'quit'}));
  const loginItem=new DesktopLoginItem({app:{isPackaged:true},platform:'win32',test:true});
  const settings=new DesktopSettings({file,nativeTheme:new Theme(),loginItem});
  assert.equal(settings.snapshot().launchAtLogin,true); assert.equal(settings.snapshot().themeMode,'dark');
  settings.update({launchAtLogin:false});settings.dispose();
  const restored=new DesktopSettings({file,nativeTheme:new Theme(),loginItem});assert.equal(restored.snapshot().launchAtLogin,false);assert.equal(loginItem.snapshot().enabled,false);
  const bad=new DesktopSettings({file:root,nativeTheme:new Theme(),loginItem});bad.value.launchAtLogin=false;loginItem.configure(false);
  assert.throws(()=>bad.update({launchAtLogin:true}),/设置未保存/);assert.equal(loginItem.snapshot().enabled,false);
  restored.dispose();bad.dispose();
});
