import test from 'node:test';import assert from 'node:assert/strict';
import {SettingsClient} from '../src/settings/client.ts';
const snapshot=(revision,themeMode='light')=>({revision,themeMode,resolvedTheme:themeMode,closeBehavior:'tray',launchAtLogin:false,loginItem:{supported:false,status:'unsupported'},loginError:null});
test('较晚返回的设置读取不会覆盖系统主题事件',async()=>{
 let publish,resolve;const pending=new Promise(r=>resolve=r),values=[];
 const client=new SettingsClient({get:()=>pending,update:async()=>snapshot(3),onChanged:callback=>{publish=callback;return()=>{};}},value=>values.push(value));
 const loading=client.load();publish(snapshot(2,'dark'));resolve(snapshot(1));await loading;
 assert.deepEqual(values.map(x=>x.revision),[2]);client.dispose();
});
test('设置订阅卸载后拒绝迟到保存响应',async()=>{
 let resolve,removed=false;const values=[];const client=new SettingsClient({get:async()=>snapshot(1),update:()=>new Promise(r=>resolve=r),onChanged:()=>()=>removed=true},v=>values.push(v));
 await client.load();const saving=client.update({themeMode:'dark'});client.dispose();resolve(snapshot(2,'dark'));await saving;
 assert.equal(removed,true);assert.deepEqual(values.map(x=>x.revision),[1]);
});

test('设置保存失败保留最后确认状态并允许再次重试',async()=>{
 const values=[];let attempt=0;const client=new SettingsClient({get:async()=>snapshot(1),update:async()=>{if(attempt++===0)throw Error('save failed');return snapshot(2,'dark');},onChanged:()=>()=>{}},v=>values.push(v));
 await client.load();await assert.rejects(client.update({themeMode:'dark'}));assert.deepEqual(values.map(x=>x.revision),[1]);await client.update({themeMode:'dark'});assert.deepEqual(values.map(x=>x.revision),[1,2]);client.dispose();
});
