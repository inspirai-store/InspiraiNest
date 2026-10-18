import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../design-review/desktop-refactor');
const types = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.json': 'application/json; charset=utf-8', '.md': 'text/plain; charset=utf-8' };
http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const file = path.resolve(directory, '.' + pathname);
    if (!file.startsWith(directory + path.sep)) { response.writeHead(403).end(); return; }
    const content = await fs.readFile(file);
    response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(content);
  } catch { response.writeHead(404).end('Not found'); }
}).listen(5177, '127.0.0.1', () => console.log('http://127.0.0.1:5177/stage-02-skeleton-v1/review.html'));
