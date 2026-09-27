import fs from 'node:fs/promises';
import path from 'node:path';
import { hash, requireValue } from './common.mjs';
import { validateArchive } from './archive.mjs';

export function libraryBrowser({ dataDir, storage }) {
  const pending = new Map();
  const root = path.join(dataDir, 'browser-cache');
  async function prepare(archive) {
    if (pending.has(archive.id)) return pending.get(archive.id);
    const job = (async () => {
      const folder = path.join(root, archive.id);
      try { return JSON.parse(await fs.readFile(path.join(folder, 'index.json'), 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      const buffer = await storage.get(archive.key);
      requireValue(hash(buffer) === archive.id, 'Archive checksum mismatch', 500);
      const bundle = validateArchive(JSON.parse(buffer));
      const directory = `files/${archive.id}`;
      const documents = {};
      const files = [];
      for (const file of bundle.files) {
        const bytes = Buffer.from(file.body, 'base64');
        const target = path.join(folder, 'files', file.path);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, bytes, { mode: 0o600 });
        const filePath = `${directory}/${file.path}`;
        files.push({ path: filePath, name: path.posix.basename(file.path), role: file.role, bytes: file.bytes, sha256: file.sha256 });
        if (/\.(md|markdown|txt|srt|vtt)$/i.test(file.path)) documents[filePath] = bytes.toString('utf8');
      }
      const images = files.filter(f => /\.(png|jpe?g|webp|gif|avif)$/i.test(f.path));
      const thumbnail = images.find(f => /cover|frame_003|screenshot_0360|img_001/i.test(f.name)) || images[0];
      const result = { entry: { ...bundle.meta, directory, files, thumbnail: thumbnail?.path || null, archiveId: archive.id, omitted: bundle.omitted || [] }, documents };
      await fs.writeFile(path.join(folder, 'index.json.tmp'), JSON.stringify(result), { mode: 0o600 });
      await fs.rename(path.join(folder, 'index.json.tmp'), path.join(folder, 'index.json'));
      return result;
    })();
    pending.set(archive.id, job);
    try { return await job; } finally { pending.delete(archive.id); }
  }
  async function file(archive, relative) {
    const index = await prepare(archive);
    requireValue(index.entry.files.some(f => f.path === `files/${archive.id}/${relative}`), 'File not found', 404);
    return fs.readFile(path.join(root, archive.id, 'files', relative));
  }
  return { prepare, file };
}
