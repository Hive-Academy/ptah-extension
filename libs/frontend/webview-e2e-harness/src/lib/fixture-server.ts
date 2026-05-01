import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { createReadStream, statSync, existsSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AddressInfo } from 'node:net';

const HERE = dirname(fileURLToPath(import.meta.url));

export interface FixtureServerOptions {
  /**
   * TCP port to bind to. Defaults to 0 (OS-assigned ephemeral).
   */
  readonly port?: number;

  /**
   * Absolute path to the directory whose contents are served at `/`. If
   * omitted, the harness probes
   * `<repo>/dist/apps/ptah-extension-webview/browser` and
   * `<repo>/dist/apps/ptah-extension-webview` and falls back to a minimal
   * inline `index.html` fixture if neither exists.
   */
  readonly rootDir?: string;
}

export interface FixtureServerHandle {
  /** Base URL including scheme + port, no trailing slash. */
  readonly url: string;
  /** Absolute filesystem path that is being served (or `null` for inline fallback). */
  readonly rootDir: string | null;
  /** Stop the server. Resolves once the underlying socket is fully closed. */
  close(): Promise<void>;
}

const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
};

const FALLBACK_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Ptah Webview E2E Fixture</title>
</head>
<body>
<div id="ptah-e2e-fixture-root" data-state="ready">
  Ptah webview E2E fixture host. The Angular SPA build was not found at
  <code>dist/apps/ptah-extension-webview</code>; the harness is serving
  this minimal placeholder so test authors can still install the
  postMessage bridge and exercise scenario builders that don't require
  the live SPA.
</div>
</body>
</html>
`;

function resolveRoot(explicit?: string): string | null {
  if (explicit && existsSync(explicit)) {
    return explicit;
  }
  // Walk up from this file's compiled location to find a repo root that
  // contains `dist/apps/ptah-extension-webview`. The harness lives at
  // `libs/frontend/webview-e2e-harness/src/lib/`.
  const here = resolve(HERE);
  let cursor = here;
  for (let i = 0; i < 8; i++) {
    const candidateA = join(
      cursor,
      'dist',
      'apps',
      'ptah-extension-webview',
      'browser',
    );
    if (existsSync(candidateA)) {
      return candidateA;
    }
    const candidateB = join(cursor, 'dist', 'apps', 'ptah-extension-webview');
    if (existsSync(candidateB)) {
      return candidateB;
    }
    const parent = resolve(cursor, '..');
    if (parent === cursor) {
      break;
    }
    cursor = parent;
  }
  return null;
}

function safeJoin(rootDir: string, urlPath: string): string | null {
  // Strip query string + decode + normalize, then ensure the resolved path
  // is still inside `rootDir` (no `..` escapes).
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const target = normalize(join(rootDir, decoded));
  const rooted = resolve(rootDir);
  const resolvedTarget = resolve(target);
  if (resolvedTarget !== rooted && !resolvedTarget.startsWith(rooted + sep)) {
    return null;
  }
  return resolvedTarget;
}

/**
 * Pipe a file to the response and tear the read stream down if the client
 * disconnects mid-flight, so an aborted request never leaks an open fd.
 */
function streamFile(
  filePath: string,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  const stream = createReadStream(filePath);
  const cleanup = (): void => {
    stream.destroy();
  };
  req.on('close', cleanup);
  stream.on('error', cleanup);
  stream.pipe(res);
}

/**
 * Start a static fixture HTTP server that serves the webview build output
 * (or an inline placeholder if the build is missing). The server binds to
 * loopback (`127.0.0.1`) only.
 */
export async function startFixtureServer(
  options: FixtureServerOptions = {},
): Promise<FixtureServerHandle> {
  const rootDir = resolveRoot(options.rootDir);

  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    const urlPath = req.url ?? '/';

    if (rootDir === null) {
      // Inline fallback: serve placeholder for `/` and 404 for everything
      // else. Tests that don't need the SPA can still exercise the bridge.
      if (urlPath === '/' || urlPath === '/index.html') {
        res.writeHead(200, { 'content-type': MIME['.html'] });
        res.end(FALLBACK_HTML);
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    const requested = urlPath === '/' ? '/index.html' : urlPath;
    const filePath = safeJoin(rootDir, requested);
    if (!filePath) {
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end('Forbidden');
      return;
    }

    let stat;
    try {
      stat = statSync(filePath);
    } catch {
      // SPA fallback: route to index.html for any not-found path so that
      // Angular client routing works in tests.
      const indexPath = safeJoin(rootDir, '/index.html');
      if (indexPath && existsSync(indexPath)) {
        res.writeHead(200, { 'content-type': MIME['.html'] });
        streamFile(indexPath, req, res);
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    if (stat.isDirectory()) {
      const indexCandidate = join(filePath, 'index.html');
      if (existsSync(indexCandidate)) {
        res.writeHead(200, { 'content-type': MIME['.html'] });
        streamFile(indexCandidate, req, res);
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    const contentType =
      MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
    res.writeHead(200, {
      'content-type': contentType,
      'cache-control': 'no-store',
    });
    streamFile(filePath, req, res);
  };

  const server: Server = createServer(handler);

  await new Promise<void>((resolveListen, rejectListen) => {
    const onError = (err: Error): void => {
      server.off('listening', onListening);
      rejectListen(err);
    };
    const onListening = (): void => {
      server.off('error', onError);
      resolveListen();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(options.port ?? 0, '127.0.0.1');
  });

  const address = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${address.port}`;

  return {
    url,
    rootDir,
    close(): Promise<void> {
      return new Promise((resolveClose, rejectClose) => {
        server.close((err) => {
          if (err) {
            rejectClose(err);
          } else {
            resolveClose();
          }
        });
      });
    },
  };
}
