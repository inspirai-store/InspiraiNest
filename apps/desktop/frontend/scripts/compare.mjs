import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const first = path.join(root, 'design-review/desktop-refactor/stage-01-prototype-v1');
const second = path.join(root, 'design-review/desktop-refactor/stage-02-skeleton-v1');
const manifest = JSON.parse(await fs.readFile(path.join(first, 'stage-manifest.json'), 'utf8'));
await fs.mkdir(path.join(second, 'overlay'), { recursive: true });
await fs.mkdir(path.join(second, 'difference'), { recursive: true });
const checks = [];
for (const frame of manifest.screens.filter(s => s.name !== 'controls-states')) {
  const reference = await sharp(path.join(first, frame.image)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const actual = await sharp(path.join(second, 'implementation', frame.name + '.png')).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (reference.info.width !== actual.info.width || reference.info.height !== actual.info.height) throw new Error('Viewport mismatch: ' + frame.name);
  const overlay = Buffer.alloc(reference.data.length), difference = Buffer.alloc(reference.data.length);
  let changedPixels = 0, absoluteError = 0;
  for (let pixel = 0; pixel < reference.data.length / 3; pixel++) {
    let delta = 0;
    for (let channel = 0; channel < 3; channel++) {
      const i = pixel * 3 + channel, d = Math.abs(reference.data[i] - actual.data[i]);
      overlay[i] = Math.round((reference.data[i] + actual.data[i]) / 2);
      difference[i] = Math.min(255, d * 4);
      absoluteError += d; delta = Math.max(delta, d);
    }
    if (delta > 24) changedPixels++;
  }
  const raw = { width: frame.width, height: frame.height, channels: 3 };
  await sharp(overlay, { raw }).png().toFile(path.join(second, 'overlay', frame.name + '.png'));
  await sharp(difference, { raw }).png().toFile(path.join(second, 'difference', frame.name + '.png'));
  checks.push({ name: frame.name, changedPixelPercent: changedPixels / (frame.width * frame.height) * 100, meanAbsoluteChannelError: absoluteError / reference.data.length });
}
await fs.writeFile(path.join(second, 'pixel-checks.json'), JSON.stringify({ overlay: '50% prototype + 50% implementation', difference: 'absolute RGB difference amplified 4x', threshold: 24, note: 'Pixel metrics include text antialiasing; structural acceptance uses measured regions separately.', screens: checks }, null, 2) + '\n');
console.log(JSON.stringify(checks, null, 2));
