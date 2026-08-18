/**
 * Write-failure reporting and manifest consistency (required coverage item 9,
 * edge case E21).
 *
 * Technique: a hand-written `IHarnessTarget` stub, not a real disk conflict.
 * The task brief's preferred technique (seed a manifest entry for
 * `.claude/commands/foo.md`, then place a directory at that path so the copy
 * fails) depends on `fs.copyFile`'s behaviour when the destination is an
 * existing directory, which is not reliably EPERM/EISDIR across Node/Windows
 * versions in a way a unit test should assert on. The reconciler's invariant
 * under test — "a failed write is never recorded as if it succeeded" — lives
 * entirely in `HarnessReconcilerService.mergeEntries`/`reconcileTarget`, not
 * in `ClaudeTarget` or the copy engine, so a stub `IHarnessTarget` isolates
 * exactly that invariant deterministically, which is the fallback the task
 * brief explicitly allows.
 *
 * Source-under-test: `HarnessReconcilerService.reconcileTarget` /
 * `mergeEntries`.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  HarnessTargetHealth,
  HarnessTargetId,
} from '@ptah-extension/shared';
import { createStaticSourceResolver } from '../sources/plugin-config-source-resolver';
import { HarnessManifestBuilder } from '../manifest/harness-manifest.builder';
import { HarnessReconcilerService } from './harness-reconciler.service';
import {
  ManagedManifestStore,
  managedEntry,
  ManagedManifest,
} from '../manifest-store/managed-manifest';
import {
  HarnessApplyResult,
  IHarnessTarget,
} from '../targets/harness-target.port';
import { HarnessDesiredState } from '../manifest/desired-state.types';
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

/**
 * A target whose plan always proposes two new writes and whose apply always
 * fails one of them. Disk is never touched — the point is to exercise the
 * reconciler's bookkeeping, not the copy engine.
 */
class PartialFailureTarget implements IHarnessTarget {
  readonly id: HarnessTargetId = 'claude';
  readonly facets = {
    skills: 'supported',
    commands: 'supported',
    agents: 'unsupported',
    mcp: 'supported',
  } as const;

  async detect(): Promise<boolean> {
    return true;
  }

  preflightKeys(): ReadonlyMap<string, string> {
    return new Map();
  }

  plan(
    _desired: HarnessDesiredState,
    _workspaceRoot: string,
    manifest: ManagedManifest,
  ) {
    return {
      target: this.id,
      writes: [
        {
          relPath: 'ok-entry',
          kind: 'skill' as const,
          source: '/src/ok',
          hash: 'hash-ok',
          isDirectory: true,
          reason: 'create' as const,
          overwritesLocalEdit: false,
        },
        {
          relPath: 'bad-entry',
          kind: 'skill' as const,
          source: '/src/bad',
          hash: 'hash-bad',
          isDirectory: true,
          reason: 'create' as const,
          overwritesLocalEdit: false,
        },
      ],
      removals: [],
      foreign: [],
      blocked: [],
      collisions: [],
      migrations: [],
      adopted: [],
      baseEntries: { ...manifest.entries },
      unchanged: 0,
      expected: 2,
    };
  }

  async apply(): Promise<HarnessApplyResult> {
    return {
      written: { 'ok-entry': managedEntry('hash-ok', '/src/ok', 'skill') },
      removed: [],
      writeFailed: [{ relPath: 'bad-entry', reason: 'simulated failure' }],
      overwrittenLocalEdit: [],
    };
  }

  async verify(): Promise<HarnessTargetHealth> {
    throw new Error('verify() is not exercised by this test');
  }
}

describe('HarnessReconcilerService — write failure reporting and manifest consistency', () => {
  let ws: string;

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'harness-sync-recon-'));
  });

  afterEach(() => {
    rmSync(ws, { recursive: true, force: true });
  });

  it('[E21] a failed write is reported in writeFailed AND is never recorded in the persisted manifest, while the other entry writes normally', async () => {
    const logger = makeFakeLogger();
    const store = new ManagedManifestStore((message, detail) =>
      logger.warn(message, detail),
    );
    const sourceState: HarnessSourceState = {
      layout: {
        skillsRoot: join(ws, 'unused-skills'),
        commandsRoot: join(ws, 'unused-commands'),
        agentsRoot: join(ws, 'unused-agents'),
      },
      overlayPluginPaths: [],
      disabledSkillIds: [],
      disabledPluginIds: [],
    };
    const reconciler = new HarnessReconcilerService(
      logger as unknown as Logger,
      new HarnessManifestBuilder(),
      store,
      createStaticSourceResolver(sourceState),
      [new PartialFailureTarget()],
    );

    const health = await reconciler.reconcile(ws, {
      mode: 'full',
      reason: 'test',
    });

    expect(health.targets[0]?.writeFailed).toEqual([
      { relPath: 'bad-entry', reason: 'simulated failure' },
    ]);

    const persisted = new ManagedManifestStore().load(ws, 'claude');
    expect(persisted.entries['ok-entry']).toEqual(
      managedEntry('hash-ok', '/src/ok', 'skill'),
    );
    // The load-bearing assertion: the reconciler's merge must never promote a
    // failed write into ownership, even though it was part of the same plan.
    expect(persisted.entries['bad-entry']).toBeUndefined();
  });
});
