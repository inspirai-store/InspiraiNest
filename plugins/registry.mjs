import {definition as blocks} from './blocks/server/definition.mjs';
import {definition as writing} from './writing/server/definition.mjs';
import {definition as lab} from './agent-lab/server/definition.mjs';
import {definition as ai} from './ai-assistant/server/definition.mjs';
import {definition as learning} from './learning/server/definition.mjs';
export const definitions = [writing,lab,ai,blocks,learning];
