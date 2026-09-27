import fs from 'node:fs';
if (process.argv.includes('--version')) { console.log('waiting-fixture 1.0'); process.exit(); }
for await (const _ of process.stdin) { /* consume only synthetic prompt */ }
fs.writeFileSync('collector-result.json', JSON.stringify({ status: 'waiting_action', message: '合成验收：请补齐本机测试工具后，在远端点继续。' }));
