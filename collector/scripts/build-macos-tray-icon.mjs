import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

// A monochrome home and sprout; macOS applies the menu-bar appearance to its alpha.
const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"><g fill="none" stroke="#000" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10 12 3l9 7M5 9v12h14V9M12 18v-6"/><path d="M12 15c-4 0-5-2-5-4 3 0 5 1 5 4Zm0-2c0-3 2-5 5-5 0 3-2 5-5 5Z"/></g></svg>`);
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../desktop');
for (const [size, suffix, density] of [[16, '', 72], [32, '@2x', 144]]) {
  const png = await sharp(svg).resize(size, size).withMetadata({ density }).png().toBuffer();
  fs.writeFileSync(path.join(desktop, `trayTemplate${suffix}.png`), png);
}
