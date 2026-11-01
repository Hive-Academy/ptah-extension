#!/usr/bin/env node
import { createReadStream, existsSync, realpathSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCliFlags } from './live-demo-cli.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = resolve(HERE, '../..');
const DEFAULT_ROOT = 'dist/ptah-landing-page/browser';

export const MIME_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
});

export function resolveSafeFilePath(rootDir, urlPathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) {
    return null;
  }
  const rooted = resolve(rootDir);
  const candidate = resolve(
    rooted,
    '.' + (decoded.startsWith('/') ? decoded : '/' + decoded),
  );
  if (candidate !== rooted && !candidate.startsWith(rooted + sep)) {
    return null;
  }
  if (existsSync(rooted) && existsSync(candidate)) {
    try {
      const realRoot = realpathSync(rooted);
      const realCandidate = realpathSync(candidate);
      if (
        realCandidate !== realRoot &&
        !realCandidate.startsWith(realRoot + sep)
      ) {
        return null;
      }
    } catch {
      return null;
    }
  }
  return candidate;
}

function sendNotFound(res) {
  res.writeHead(404, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end('Not Found');
}

function streamStaticFile(filePath, req, res) {
  let fileStat;
  try {
    fileStat = statSync(filePath);
  } catch {
    sendNotFound(res);
    return;
  }

  let targetFile = filePath;
  if (fileStat.isDirectory()) {
    targetFile = join(filePath, 'index.html');
    try {
      fileStat = statSync(targetFile);
      if (!fileStat.isFile()) {
        sendNotFound(res);
        return;
      }
    } catch {
      sendNotFound(res);
      return;
    }
  } else if (!fileStat.isFile()) {
    sendNotFound(res);
    return;
  }

  const ext = extname(targetFile).toLowerCase();
  const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
  res.writeHead(200, {
    'content-type': contentType,
    'content-length': fileStat.size,
    'cache-control': 'no-store',
  });

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  const stream = createReadStream(targetFile);
  const cleanup = () => stream.destroy();
  req.on('close', cleanup);
  stream.on('error', () => {
    cleanup();
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    }
    res.end();
  });
  stream.pipe(res);
}

export async function start(options = {}) {
  const normalized =
    typeof options === 'number'
      ? { port: options }
      : typeof options === 'string'
        ? { root: options }
        : options;

  const rootDir = resolve(
    WORKSPACE_ROOT,
    normalized.root ?? normalized.rootDir ?? DEFAULT_ROOT,
  );
  const port = Number(normalized.port ?? 0);
  const host = normalized.host ?? '127.0.0.1';

  if (!existsSync(rootDir)) {
    throw new Error(`Static root directory does not exist: ${rootDir}`);
  }

  const server = createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Method Not Allowed');
      return;
    }

    let pathname;
    try {
      pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    } catch {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Bad Request');
      return;
    }

    const safePath = resolveSafeFilePath(rootDir, pathname);
    if (!safePath) {
      sendNotFound(res);
      return;
    }

    streamStaticFile(safePath, req, res);
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(port, host, () => {
      server.off('error', rejectListen);
      resolveListen();
    });
  });

  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;
  const url = `http://${host}:${actualPort}`;

  return {
    server,
    url,
    port: actualPort,
    rootDir,
    close: () =>
      new Promise((resolveClose, rejectClose) => {
        server.close((err) => (err ? rejectClose(err) : resolveClose()));
      }),
  };
}

export function parseArgs(argv = process.argv.slice(2)) {
  return parseCliFlags(argv, {
    defaults: {
      root: DEFAULT_ROOT,
      port: Number(process.env.PORT || 4873),
    },
    flags: {
      '--root': (opts, nextVal) => {
        opts.root = nextVal();
      },
      '--port': (opts, nextVal) => {
        opts.port = Number(nextVal());
      },
    },
    onPositional: (opts, arg) => {
      if (/^\d+$/.test(arg)) {
        opts.port = Number(arg);
        return true;
      }
      return false;
    },
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const handle = await start(opts);
    console.log(
      `[live-demo-static-server] Serving ${handle.rootDir} at ${handle.url}/`,
    );
    const shutdown = async () => {
      await handle.close();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    console.error(
      `[live-demo-static-server] ERROR: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}
