import {build} from 'esbuild';
import {repositoryRoot} from '../../tooling/layout.mjs';
import path from 'node:path';
await build({entryPoints:[path.join(repositoryRoot,'packages/core/node/capture-cli.mjs')],outfile:path.join(repositoryRoot,'resources/capture-runtime/capture-cli.mjs'),bundle:true,platform:'node',format:'esm',target:'node22',external:['canvas'],banner:{js:"import {createRequire as __createRequire} from 'node:module'; const require = __createRequire(import.meta.url);"}});
