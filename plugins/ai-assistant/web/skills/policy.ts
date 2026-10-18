export const skillAgents=['codex','codebuddy','claude','gemini','opencode'] as const;
export const skillSystems=['darwin','win32','linux'] as const;
export type SkillAgent=typeof skillAgents[number];
export type SkillSystem=typeof skillSystems[number];
export type SkillRequirements={commands:string[];env:string[];mcp:string[];pythonModules:string[];browser:boolean};
export type SkillPolicy={agents:SkillAgent[];systems:SkillSystem[];capabilities:string[];requirements:SkillRequirements};
export function dependencyNames(input:string|string[]):string[]{
 const values=Array.isArray(input)?input:input.split(/[\s,，]+/);
 const names=[...new Set(values.map(value=>value.trim()).filter(Boolean))];
 if(names.length>30||names.some(value=>! /^[\w.-]{1,100}$/.test(value)))throw Error('依赖名称无效');
 return names;
}
export function capabilityNames(input:string|string[]):string[]{
 const names=dependencyNames(input);
 if(names.some(value=>!/^[a-z][a-z0-9.-]{1,99}$/.test(value)))throw Error('能力标签无效');
 return names;
}
export function skillPolicy(input:SkillPolicy):SkillPolicy{
 if(!input.agents.length||input.agents.some(agent=>!skillAgents.includes(agent)))throw Error('请选择适用 Agent');
 if(!input.systems.length||input.systems.some(system=>!skillSystems.includes(system)))throw Error('请选择适用系统');
 if(input.capabilities.length>30||input.capabilities.some(value=>!/^[a-z][a-z0-9.-]{1,99}$/.test(value)))throw Error('能力标签无效');
 return {agents:[...new Set(input.agents)],systems:[...new Set(input.systems)],capabilities:capabilityNames(input.capabilities),requirements:{commands:dependencyNames(input.requirements.commands),env:dependencyNames(input.requirements.env),mcp:dependencyNames(input.requirements.mcp),pythonModules:dependencyNames(input.requirements.pythonModules),browser:input.requirements.browser}};
}

export function inventoryRequirements(value:unknown):SkillRequirements{
 const source=value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
 const read=(key:string)=>{const items=source[key]??[];if(!Array.isArray(items)||items.some(item=>typeof item!=='string'))throw Error('依赖声明无效');return dependencyNames(items as string[]);};
 if(source.browser!==undefined&&typeof source.browser!=='boolean')throw Error('浏览器依赖无效');
 return {commands:read('commands'),env:read('env'),mcp:read('mcp'),pythonModules:read('pythonModules'),browser:source.browser===true};
}
