import fs from 'node:fs';
import path from 'node:path';

export function browserData(root, entries) {
  const documents = {};
  const imagePattern = /\.(png|jpe?g|webp|gif|avif)$/i;
  const textPattern = /\.(md|markdown|txt)$/i;
  function collect(directory, relative, role) {
    const absolute = path.join(root, directory, relative);
    if (fs.lstatSync(absolute).isSymbolicLink()) return [];
    if (fs.statSync(absolute).isDirectory()) {
      return fs.readdirSync(absolute).sort().flatMap(name => collect(directory, `${relative}/${name}`, role));
    }
    const filePath = `${directory}/${relative}`;
    if (textPattern.test(relative)) documents[filePath] = fs.readFileSync(absolute, 'utf8');
    return [{ path: filePath, name: path.basename(relative), role, bytes: fs.statSync(absolute).size }];
  }
  const browserEntries = entries.map(entry => {
    const files = [...new Map(entry.files.flatMap(file => collect(entry.directory, file.path, file.role)).map(file => [file.path, file])).values()];
    const images = files.filter(file => imagePattern.test(file.path));
    const thumbnail = images.find(file => /frame_003|screenshot_0360|img_001/.test(file.name)) ?? images[0];
    return { ...entry, files, thumbnail: thumbnail?.path ?? null };
  });
  // A classic script can load beside file:// HTML without a local HTTP server.
  return `window.LIBRARY_DATA = ${JSON.stringify({ entries: browserEntries, documents }).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029')};\n`;
}
