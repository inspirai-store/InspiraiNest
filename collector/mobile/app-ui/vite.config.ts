import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  base: './',
  plugins: [tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  build: {
    outDir: '../android/app/src/main/assets/mobile-next',
    emptyOutDir: true,
    assetsDir: '',
    rollupOptions: { output: { entryFileNames: 'mobile.js', assetFileNames: 'mobile.[ext]' } },
  },
});
