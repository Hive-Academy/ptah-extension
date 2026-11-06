/**
 * Runs tree-sitter parsing in its own utilityProcess: web-tree-sitter's
 * WASM parse and query work is synchronous, and CPU profiles of four
 * streaming sessions showed single queries holding the main loop for
 * 0.35-2.4 s (`.ptah/specs/main-loop-sync-blocks/fix-8.md`).
 *
 * Must run BEFORE `registerWorkspaceIntelligenceServices`, which resolves
 * the parser singleton. `build-tree-sitter-worker` puts
 * `tree-sitter-worker.mjs` beside `main.mjs`; a build without it (a partial
 * dev build) keeps parsing in-process rather than failing every parse.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { DependencyContainer } from 'tsyringe';
import type { Logger } from '@ptah-extension/vscode-core';
import { WORKSPACE_INTELLIGENCE_TOKENS } from '@ptah-extension/workspace-intelligence';
import { ElectronTreeSitterWorkerFactory } from '../services/platform/electron-tree-sitter-worker-factory';

export const TREE_SITTER_WORKER_FILE = 'tree-sitter-worker.mjs';

export function registerElectronTreeSitterWorker(
  container: DependencyContainer,
  logger: Pick<Logger, 'info' | 'warn'>,
  bundleDir: string = defaultBundleDir(),
): void {
  const workerPath = path.join(bundleDir, TREE_SITTER_WORKER_FILE);
  if (!fs.existsSync(workerPath)) {
    logger.warn(
      '[Electron DI] tree-sitter worker bundle not found; parsing stays on the main thread',
      { workerPath },
    );
    return;
  }
  container.register(WORKSPACE_INTELLIGENCE_TOKENS.TREE_SITTER_WORKER_FACTORY, {
    useValue: new ElectronTreeSitterWorkerFactory(workerPath),
  });
  logger.info('[Electron DI] tree-sitter parsing runs in a utilityProcess', {
    workerPath,
  });
}

/** Same resolution as the embedder and search worker paths in phase 2. */
function defaultBundleDir(): string {
  const dirname: unknown = Reflect.get(globalThis, '__dirname');
  return typeof dirname === 'string' ? dirname : path.join(os.homedir(), '.ptah');
}
