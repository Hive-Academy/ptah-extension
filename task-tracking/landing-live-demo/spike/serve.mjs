import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, brotliCompressSync, constants as zlibConstants } from 'node:zlib';

const spike = dirname(fileURLToPath(import.meta.url));
const root = resolve(spike, '../../..');
const build = join(root, 'dist/apps/ptah-extension-webview/browser');
const localFonts = join(root, 'libs/frontend/webview-e2e-harness/src/lib/fonts/gstatic');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.wasm': 'application/wasm' };

function safeFile(base, path) {
  const file = resolve(base, '.' + path);
  if (file !== base && !file.startsWith(base + sep)) return null;
  return file;
}
function rewriteIndex(html) {
  return html
    .replace(/<meta\b[^>]*http-equiv=["']Content-Security-Policy(?:-Report-Only)?["'][^>]*>/gi, '')
    .replace(/<head([^>]*)>/i, '<head$1>\n<script src="/replay/replay-bridge.js" data-scenario="/replay/scenarios/chat-tool-call.json"></script>');
}
async function filesUnder(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await filesUnder(p));
    else if (e.isFile()) out.push(p);
  }
  return out;
}
export async function measure() {
  const files = (await filesUnder(build)).filter((p) => /\.(js|css)$/.test(p) && !p.endsWith('.map'));
  const totals = { raw: 0, gzip: 0, brotli: 0, files: [] };
  for (const p of files) {
    const bytes = await readFile(p);
    const entry = { path: '/' + relative(build, p).replaceAll('\\', '/'), raw: bytes.length, gzip: gzipSync(bytes).length, brotli: brotliCompressSync(bytes, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 4 } }).length };
    totals.files.push(entry);
    totals.raw += entry.raw; totals.gzip += entry.gzip; totals.brotli += entry.brotli;
  }
  return totals;
}
export async function startServer(port = 4873) {
  const size = await measure();
  const server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const font = pathname.startsWith('/replay/font/');
      const replay = pathname.startsWith('/replay/') && !font;
      const base = font ? localFonts : replay ? spike : build;
      const rel = font ? pathname.slice('/replay/font'.length) : replay ? pathname.slice('/replay'.length) : pathname;
      const file = safeFile(base, rel === '/' ? '/index.html' : rel);
      if (!file || (await stat(file)).isDirectory()) { res.writeHead(404); res.end(); return; }
      let body = await readFile(file);
      if (!replay && rel === '/') body = Buffer.from(rewriteIndex(body.toString('utf8')));
      if (!replay && !font && extname(file) === '.css') {
        body = Buffer.from(body.toString('utf8').replaceAll('https://fonts.gstatic.com/', '/replay/font/'));
      }
      res.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream', 'content-length': body.length, 'cache-control': 'no-store' });
      res.end(body);
    } catch (error) { res.writeHead(error?.code === 'ENOENT' ? 404 : 500); res.end(String(error?.message || error)); }
  });
  await new Promise((resolveListen) => server.listen(port, '127.0.0.1', resolveListen));
  const address = server.address();
  return { server, url: `http://127.0.0.1:${address.port}/`, size, close: () => new Promise((resolveClose) => server.close(resolveClose)) };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] || process.env.PORT || 4873);
  const service = await startServer(port);
  console.log(`PtahCode replay: ${service.url}`);
  console.log(`JS + CSS transfer size (${service.size.files.length} files): raw=${service.size.raw} gzip=${service.size.gzip} brotli=${service.size.brotli}`);
}
