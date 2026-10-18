import http from 'node:http';
import fs from 'node:fs';
const routes = new Map([['/privacy', '/pages/privacy.html'], ['/support', '/pages/support.html']]);
http.createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/healthz') { res.writeHead(200); return res.end('ok'); }
  const file = routes.get(path);
  if (!file || !['GET', 'HEAD'].includes(req.method)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'" });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}).listen(4318, '0.0.0.0');
