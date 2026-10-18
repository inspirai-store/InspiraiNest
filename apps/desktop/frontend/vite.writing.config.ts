import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
export default defineConfig({plugins:[react()],base:'./',define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{outDir:'dist-writing',lib:{entry:path.resolve('../../../plugins/writing/web/writing/mobile.tsx'),name:'LingnestWriting',formats:['iife'],fileName:()=> 'writing.js',cssFileName:'writing'}}});
