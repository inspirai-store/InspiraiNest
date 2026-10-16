import fs from 'node:fs';
if(process.argv.includes('--version')){console.log('writing-regression-agent 1.0');process.exit();}
let prompt='';for await(const chunk of process.stdin)prompt+=chunk;
const input=JSON.parse(prompt.split('\n').find(line=>line.startsWith('{"operation":')));
fs.writeFileSync('received-prompt.txt',prompt,{mode:0o600});
if(input.instructions.includes('失败回归')){console.error('synthetic agent failure');process.exit(1);}
await new Promise(resolve=>setTimeout(resolve,input.instructions.includes('慢速回归')?12000:250));
fs.writeFileSync('writing-result.json',JSON.stringify({protocol:1,text:input.operation==='translate'?'A clear and focused writing experience.':input.operation==='shorten'?'写作更专注，操作更顺手。':'写作时保持专注，处理内容更高效。\n保留原有数据与排版。'}),{mode:0o600});
console.log(JSON.stringify({type:'result',result:'disposable writing regression completed'}));
