import {LearningPage} from './learning/web/LearningPage';
import {BlocksPage} from './blocks/web/BlocksPage';
import {Bot,Puzzle} from 'lucide-react';
import type {PluginView} from '../packages/plugin-sdk/views';
import './writing/web/register';
import {WritingProvider} from './writing/web/selection-writing/WritingProvider';
import {WritingPage} from './writing/web/writing/WritingPage';
import {AgentsContent} from './ai-assistant/web/agents/AgentsContent';
import {SkillsContent} from './ai-assistant/web/skills/SkillsContent';
import {TrialLogin} from './agent-lab/web/TrialLogin';
export const webPlugins:PluginView[]=[
 {id:'learning',routes:[{path:'/learning',Component:LearningPage},{path:'/learning/:goalId',Component:LearningPage}]},
 {id:'blocks',routes:['/blocks','/blocks/new','/blocks/plans/:planId','/blocks/:blockId'].map(path=>({path,Component:BlocksPage}))},
 {id:'ai-assistant',settings:[{id:'agents',path:'agents/:agentNodeId',label:'Agent',icon:Bot,Component:AgentsContent},{id:'skills',path:'skills/:skillNodeId',label:'技能',icon:Puzzle,Component:SkillsContent}]},
 {id:'writing',Provider:WritingProvider,routes:[{path:'/writing',Component:WritingPage},{path:'/writing/new',Component:WritingPage},{path:'/writing/:id',Component:WritingPage}]},
 {id:'agent-lab',generalSettings:window.worker?[TrialLogin]:[]}
];
