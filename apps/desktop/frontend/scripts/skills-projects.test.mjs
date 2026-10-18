import test from 'node:test';import assert from 'node:assert/strict';import {projectPaths} from '../../../../plugins/ai-assistant/web/skills/projects.ts';
test('目录表单保留Windows分隔符与含空格路径并去重',()=>{assert.deepEqual(projectPaths(['C:\\Users\\Alex\\My Project','/Users/alex/My Project','/Users/alex/My Project']),['C:\\Users\\Alex\\My Project','/Users/alex/My Project']);});
test('配置允许清空项目，拒绝控制字符与超过十个目录',()=>{assert.deepEqual(projectPaths([]),[]);assert.throws(()=>projectPaths(['/project\0bad']),/无效/);assert.throws(()=>projectPaths(Array.from({length:11},(_,i)=>'/project/'+i)),/无效/);});
