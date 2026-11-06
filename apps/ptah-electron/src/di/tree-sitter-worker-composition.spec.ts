/**
 * registerElectronTreeSitterWorker — registers the utilityProcess factory
 * only when the built `tree-sitter-worker.mjs` exists, so a partial build
 * keeps parsing in-process instead of failing every parse; the factory forks
 * that path under a named service.
 */
import 'reflect-metadata';

jest.mock('electron', () => {
  const utilityProcess = { fork: jest.fn() };
  return { __esModule: true, utilityProcess, default: { utilityProcess } };
});

// The real barrel loads web-tree-sitter's `import.meta` resolver, which
// Jest's CJS runtime cannot parse; only the token is needed here.
jest.mock('@ptah-extension/workspace-intelligence', () => ({
  WORKSPACE_INTELLIGENCE_TOKENS: {
    TREE_SITTER_WORKER_FACTORY: Symbol.for('PtahTreeSitterWorkerFactory'),
  },
}));

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import electron from 'electron';
import { container as rootContainer } from 'tsyringe';
import { WORKSPACE_INTELLIGENCE_TOKENS } from '@ptah-extension/workspace-intelligence';
import {
  TREE_SITTER_WORKER_FILE,
  registerElectronTreeSitterWorker,
} from './tree-sitter-worker-composition';
import { ElectronTreeSitterWorkerFactory } from '../services/platform/electron-tree-sitter-worker-factory';

const fork = jest.mocked(electron.utilityProcess.fork);
const TOKEN = WORKSPACE_INTELLIGENCE_TOKENS.TREE_SITTER_WORKER_FACTORY;

describe('registerElectronTreeSitterWorker', () => {
  let bundleDir: string;
  let logger: { info: jest.Mock; warn: jest.Mock };

  beforeEach(() => {
    bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-ts-worker-'));
    logger = { info: jest.fn(), warn: jest.fn() };
    fork.mockReset();
  });

  afterEach(() => {
    fs.rmSync(bundleDir, { recursive: true, force: true });
  });

  it('registers a factory that forks the bundled worker when it exists', () => {
    const workerPath = path.join(bundleDir, TREE_SITTER_WORKER_FILE);
    fs.writeFileSync(workerPath, '');
    const container = rootContainer.createChildContainer();

    registerElectronTreeSitterWorker(container, logger, bundleDir);

    const factory = container.resolve<ElectronTreeSitterWorkerFactory>(TOKEN);
    expect(factory).toBeInstanceOf(ElectronTreeSitterWorkerFactory);
    const child = { postMessage: jest.fn(), on: jest.fn(), kill: jest.fn() };
    // A structural stand-in for Electron's UtilityProcess.
    fork.mockReturnValue(Object.assign(Object.create(null), child));
    factory.spawn();
    expect(fork).toHaveBeenCalledWith(workerPath, [], {
      serviceName: 'ptah-tree-sitter',
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('leaves the factory unregistered and warns when the bundle is missing', () => {
    const container = rootContainer.createChildContainer();

    registerElectronTreeSitterWorker(container, logger, bundleDir);

    expect(container.isRegistered(TOKEN, true)).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('tree-sitter worker bundle not found'),
      { workerPath: path.join(bundleDir, TREE_SITTER_WORKER_FILE) },
    );
  });
});
