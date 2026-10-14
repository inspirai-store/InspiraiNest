import test from 'node:test';
import assert from 'node:assert/strict';
import {dependencyNames,skillPolicy,skillAgents,skillSystems} from '../src/skills/policy.ts';
const policy=()=>({agents:[...skillAgents],systems:[...skillSystems],capabilities:['web.archive'],requirements:{commands:['python3'],env:['API_KEY'],mcp:[],pythonModules:[],browser:true}});
test('依赖标签输入去重并支持逗号和换行，变量仅接受名称',()=>{
 assert.deepEqual(dependencyNames('python3，node\npython3'),['python3','node']);assert.throws(()=>dependencyNames('API_KEY=secret'),/无效/);
});
test('发布策略保留全部五种Agent和三种系统及依赖，空范围不可提交',()=>{
 assert.deepEqual(skillPolicy(policy()),policy());const empty=policy();empty.agents=[];assert.throws(()=>skillPolicy(empty),/Agent/);const invalid=policy();invalid.requirements.commands=['../../run'];assert.throws(()=>skillPolicy(invalid),/无效/);
});
