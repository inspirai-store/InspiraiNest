import {defineConfig} from 'vite';import react from '@vitejs/plugin-react';import {learningVisualAssets} from '../../plugins/learning/visuals/assets.mjs';
export default defineConfig({plugins:[react(),learningVisualAssets()],base:'/workbench/',build:{outDir:'dist'},server:{host:'127.0.0.1',port:5177,proxy:{'/api':'http://127.0.0.1:4317','/device-identity.js':'http://127.0.0.1:4317'}}});
