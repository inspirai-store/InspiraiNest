import test from 'node:test';
import assert from 'node:assert/strict';
import { DesktopLoginItem } from '../desktop/login-item.mjs';

test('Windows registers only the fixed installed executable and startup flag', () => {
  let item = { openAtLogin: false, launchItems: [] }, call, query;
  const app = { isPackaged: true, getLoginItemSettings(value) { query = value; return item; }, setLoginItemSettings(value) { call = value; item = { openAtLogin: false, launchItems: value.openAtLogin ? [{name:value.name,path:value.path,args:[],scope:'user',enabled:value.enabled!==false}] : [] }; } };
  const login = new DesktopLoginItem({ app, platform: 'win32', executable: 'C:/Program Files/InspiraiNest.exe' });
  login.configure(true); assert.deepEqual(call, { openAtLogin: true, path: 'C:/Program Files/InspiraiNest.exe', args: ['--startup'], name: 'InspiraiNest' });
  assert.equal(login.snapshot().enabled, true); assert.equal(login.snapshot().registered, true); assert.equal(query.path, '"C:/Program Files/InspiraiNest.exe"'); login.configure(false, { explicit: true }); assert.equal(login.snapshot().registered, false);
  assert.equal(call.enabled, false); assert.equal('path' in login.snapshot(), false);
});
test('OS disabling an existing login item is respected until the user explicitly enables it', () => {
  let calls = 0, item = { openAtLogin: false, executableWillLaunchAtLogin: true, launchItems:[{name:'InspiraiNest',path:process.execPath,scope:'user',args:[],enabled:false},{name:'Other',path:process.execPath,scope:'user',args:[],enabled:true}] };
  const app = { isPackaged: true, getLoginItemSettings: () => item, setLoginItemSettings() { calls++; item.launchItems[0].enabled = true; } };
  const login = new DesktopLoginItem({ app, platform: 'win32' }); login.configure(true); assert.equal(calls, 0); assert.equal(login.snapshot().status, 'disabled-by-system');
  login.configure(true, { explicit: true }); assert.equal(calls, 1); assert.equal(login.snapshot().enabled, true);
});
test('macOS approval and unsupported development builds are reported accurately', () => {
  let status = 'not-registered';
  const app = { isPackaged: true, getLoginItemSettings: () => ({ openAtLogin: false, status }), setLoginItemSettings: () => { status = 'requires-approval'; } };
  const login = new DesktopLoginItem({ app, platform: 'darwin' }); login.configure(true); assert.equal(login.snapshot().enabled, false); assert.equal(login.snapshot().status, 'requires-approval');
  const dev = new DesktopLoginItem({ app: { isPackaged: false }, platform: 'win32' }); assert.throws(() => dev.configure(true), /安装版/);
});
