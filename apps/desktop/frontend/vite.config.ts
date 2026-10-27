import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import {learningVisualAssets} from '../../../plugins/learning/visuals/assets.mjs';

export default defineConfig({
  plugins: [react(),learningVisualAssets()],
  base: './',
  server: { port: 5176, strictPort: true },
  preview: { port: 4176, strictPort: true },
});
