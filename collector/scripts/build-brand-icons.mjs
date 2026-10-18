import {collectorRoot,collectorPath} from '../../tooling/layout.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = collectorRoot;
const repo = path.resolve(root, '..');
const source = collectorPath( 'brand', 'inspiration-nook-source.png');
const icon = size => sharp(source).resize(size, size).png().toBuffer();
const write = (target, data) => {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, data);
};

const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = await Promise.all(sizes.map(icon));
const directory = Buffer.alloc(6 + sizes.length * 16);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(sizes.length, 4);
let offset = directory.length;
images.forEach((data, index) => {
  const entry = 6 + index * 16;
  directory[entry] = sizes[index] === 256 ? 0 : sizes[index];
  directory[entry + 1] = sizes[index] === 256 ? 0 : sizes[index];
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(data.length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += data.length;
});
write(collectorPath( 'desktop', 'icon.ico'), Buffer.concat([directory, ...images]));
write(collectorPath( 'desktop', 'icon.png'), await icon(512));
write(collectorPath( 'desktop', 'tray.png'), images[3]);
write(collectorPath( 'public', 'brand-icon.png'), images[5]);
write(path.join(repo, 'assets', 'brand-icon.png'), images[5]);
const android = await sharp({ create: { width: 512, height: 512, channels: 4, background: '#f7f6f3' } })
  .composite([{ input: await icon(440), left: 36, top: 36 }]).png().toBuffer();
write(collectorPath( 'mobile', 'android', 'app', 'src', 'main', 'res', 'drawable-nodpi', 'ic_inspiration_nook.png'), android);
const ios = await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#f7f6f3' } })
  .composite([{ input: await icon(880), left: 72, top: 72 }]).flatten().png().toBuffer();
write(collectorPath( 'mobile', 'ios', 'Assets.xcassets', 'AppIcon.appiconset', 'icon-1024.png'), ios);
