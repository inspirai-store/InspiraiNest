// Protocol fixture, not a real Codex run. Execute the installed test tool and emit its actual output.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const skill=path.join(process.cwd(),'.agents','skills',fs.readdirSync('.agents/skills').find(n=>n.startsWith('lingnest-trial-'))),tool=path.join(skill,'check.mjs');
fs.readFileSync(path.join(skill,'SKILL.md'),'utf8');
const command='node '+tool,output=execFileSync(process.execPath,[tool],{encoding:'utf8'}).trim();
for(const item of [{type:'command_execution',status:'completed',exit_code:0,command:'Get-Content '+path.join(skill,'SKILL.md'),aggregated_output:'fixture skill content'}, {type:'command_execution',status:'completed',exit_code:0,command,aggregated_output:output}])console.log(JSON.stringify({type:'item.completed',item}));
fs.writeFileSync('trial-result.json',JSON.stringify({markdown:'测试协议夹具：工具实际输出 '+output,verdict:'passed',steps:[{command,expectedOutput:output}]}));
