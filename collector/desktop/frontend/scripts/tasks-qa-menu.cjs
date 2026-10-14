// Test configuration through native menu actions, never renderer event injection.
const {Menu}=require('electron');
exports.install=(window,control)=>{
 let theme='light';
 const route=()=>{const url=new URL(window.webContents.getURL());url.hash='/tasks/demo?data=local&theme='+theme;return url.href;};
 const scene=async mode=>{await control.reset(mode);window.setContentSize(1240,820);await window.loadURL(route());window.webContents.reloadIgnoringCache();};
 const modes=['review','completed','loading','empty','list-error','preview-error','action-error'];
 Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'Task QA',submenu:[{label:'保存当前客户端截图',accelerator:'CmdOrCtrl+Alt+S',click:()=>void require('./tasks-layout-audit.cjs').capture(window)},...[[0,'A'],[1,'R'],[2,'W'],[3,'F']].map(([index,key])=>({label:'查看任务 '+(index+1),accelerator:'CmdOrCtrl+Alt+'+key,click:()=>{const url=new URL(route());url.hash='/tasks/'+control.taskIds[index]+'?data=local&theme='+theme;void window.loadURL(url.href);}})),...modes.map((mode,i)=>({label:mode,accelerator:'CmdOrCtrl+Alt+'+(i+1),click:()=>void scene(mode)})),...[[8,900,740],[9,740,740],[0,1240,820]].map(([key,w,h])=>({label:w+'px',accelerator:'CmdOrCtrl+Alt+'+key,click:()=>window.setContentSize(w,h)})),...[[5,'light'],[6,'dark']].map(([key,next])=>({label:next,accelerator:'CmdOrCtrl+Shift+'+key,click:()=>{theme=next;void window.loadURL(route());}}))]}]));
};
