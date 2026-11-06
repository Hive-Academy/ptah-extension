/**
 * Tree-sitter utility process entry, bundled by ptah-electron's
 * `build-tree-sitter-worker` target as `tree-sitter-worker.mjs` (beside
 * `main.mjs`, so `wasm-bundle-dir` finds the same `wasm/` directory) and
 * forked by `ElectronTreeSitterWorkerFactory`.
 *
 * It owns one `TreeSitterEngine` and answers parse and query requests, so
 * web-tree-sitter's synchronous WASM work never blocks the Electron main
 * thread. Logs are forwarded to the host as `log` messages.
 */
// Must stay the first import: the transport guard runs before the engine.
import { treeSitterWorkerParentPort as port } from './tree-sitter-worker.parent-port';
import { TreeSitterEngine } from '../tree-sitter-engine';
import type { TreeSitterWorkerOutbound } from './tree-sitter-worker.protocol';
import {
  TreeSitterWorkerRuntime,
  createForwardingLogger,
} from './tree-sitter-worker-runtime';

const post = (message: TreeSitterWorkerOutbound): void =>
  port.postMessage(message);
const logger = createForwardingLogger(post);
const runtime = new TreeSitterWorkerRuntime(new TreeSitterEngine(logger), post);

port.on('message', (event) => {
  runtime.handle(event.data).catch((error: unknown) => {
    // `handle` turns every failure into a result; this is the last resort.
    logger.error(
      'tree-sitter worker failed to handle a request',
      error instanceof Error ? error : new Error(String(error)),
    );
  });
});
