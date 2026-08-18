/**
 * Reconciler behaviour when the user-layer sources are absent (required
 * coverage item 2, edge cases E2/E3).
 *
 * Source-under-test: `HarnessReconcilerService` + `ClaudeTarget`, wired
 * directly (no tsyringe container — see the CLAUDE.md test-construction rule
 * for this task).
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Logger } from '@ptah-extension/vscode-core';
import { ClaudeTarget } from '../targets/claude-target';
import { createStaticSourceResolver } from '../sources/plugin-config-source-resolver';
import { HarnessManifestBuilder } from '../manifest/harness-manifest.builder';
import { HarnessReconcilerService } from './harness-reconciler.service';
import { ManagedManifestStore } from '../manifest-store/managed-manifest';
import { HarnessSourceState } from '../sources/harness-source.port';

interface FakeLogger {
  debug: jest.Mock;
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
}

function makeFakeLogger(): FakeLogger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function buildReconciler(
  sourceState: HarnessSourceState,
): HarnessReconcilerService {
  const logger = makeFakeLogger();
  const store = new ManagedManifestStore((message, detail) =>
    logger.warn(message, detail),
  );
  const resolver = createStaticSourceResolver(sourceState);
  return new HarnessReconcilerService(
    logger as unknown as Logger,
    new HarnessManifestBuilder(),
    store,
    resolver,
    [new ClaudeTarget(store)],
  );
}

describe('HarnessReconcilerService — missing sources', () => {
  let ws: string;
  let sourcesRoot: string;

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'harness-sync-recon-'));
    sourcesRoot = mkdtempSync(join(tmpdir(), 'harness-sync-src-'));
  });

  afterEach(() => {
    rmSync(ws, { recursive: true, force: true });
    rmSync(sourcesRoot, { recursive: true, force: true });
  });

  function missingLayout(): HarnessSourceState {
    return {
      // Neither directory is ever created under sourcesRoot.
      layout: {
        skillsRoot: join(sourcesRoot, 'skills'),
        commandsRoot: join(sourcesRoot, 'commands'),
        agentsRoot: join(sourcesRoot, 'agents'),
      },
      overlayPluginPaths: [],
      disabledSkillIds: [],
      disabledPluginIds: [],
    };
  }

  it('[E2] resolves rather than throwing, and reports sources-missing with zero expected entries for the target', async () => {
    const reconciler = buildReconciler(missingLayout());

    const health = await reconciler.reconcile(ws, {
      mode: 'full',
      reason: 'test',
    });

    expect(health.sources).toBe('sources-missing');
    expect(health.targets).toHaveLength(1);
    expect(health.targets[0]?.expected).toBe(0);
    expect(health.targets[0]?.writeFailed).toEqual([]);
  });

  it('[E3] reports pending-download instead of sources-missing when a download is known to be in flight', async () => {
    const reconciler = buildReconciler(missingLayout());

    const health = await reconciler.reconcile(ws, {
      mode: 'full',
      reason: 'test',
      downloadPending: true,
    });

    expect(health.sources).toBe('pending-download');
    expect(health.targets[0]?.expected).toBe(0);
  });

  it('[E2] a preflight pass over missing sources also resolves cleanly with zero expected entries', async () => {
    const reconciler = buildReconciler(missingLayout());

    const health = await reconciler.reconcile(ws, {
      mode: 'preflight',
      reason: 'test',
    });

    expect(health.sources).toBe('sources-missing');
    expect(health.targets[0]?.expected).toBe(0);
  });
});
