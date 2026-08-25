/**
 * `HarnessHealthRpcService` — the reconciler's RPC surface (Batch 4).
 *
 * The behaviours worth pinning are the ones a reader would not guess from the
 * method names: the cache is keyed on the WORKSPACE, `health` inspects while
 * `reconcile` repairs, removal is bounded by confirmation, and the
 * `harness:healthChanged` push is edge-triggered so a per-session preflight
 * does not become a per-session webview message.
 */

import 'reflect-metadata';
import type { DependencyContainer } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import type {
  HarnessBlockedRepairService,
  HarnessPropagationService,
  HarnessReconcilerService,
} from '@ptah-extension/harness-sync';
import { MESSAGE_TYPES, type HarnessHealth } from '@ptah-extension/shared';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { HarnessHealthRpcService } from './harness-health-rpc.service';

const WS = 'D:/ws/alpha';

function health(overrides: Partial<HarnessHealth> = {}): HarnessHealth {
  return {
    workspaceRoot: WS,
    generatedAt: '2026-08-18T00:00:00.000Z',
    mode: 'full',
    reason: 'spec',
    sources: 'ok',
    collisions: [],
    targets: [
      {
        target: 'claude',
        detected: true,
        facets: {
          skills: 'supported',
          commands: 'supported',
          agents: 'unsupported',
          mcp: 'supported',
        },
        expected: 3,
        found: 3,
        missing: [],
        foreign: [],
        writeFailed: [],
        overwrittenLocalEdit: [],
        removed: [],
        durationMs: 4,
      },
    ],
    ...overrides,
  };
}

interface Harness {
  service: HarnessHealthRpcService;
  reconciler: {
    getLastHealth: jest.Mock;
    onHealth: jest.Mock;
    remove: jest.Mock;
    verify: jest.Mock;
  };
  propagation: { propagate: jest.Mock };
  repairService: { repair: jest.Mock };
  broadcast: jest.Mock;
  /** Fires the reconciler's health stream, as a completed pass would. */
  emitHealth: (report: HarnessHealth) => void;
  setWorkspaceRoot: (root: string | undefined) => void;
}

function build(options: { withMessenger?: boolean } = {}): Harness {
  const listeners: Array<(h: HarnessHealth) => void> = [];
  const reconciler = {
    getLastHealth: jest.fn().mockReturnValue(null),
    onHealth: jest.fn((listener: (h: HarnessHealth) => void) => {
      listeners.push(listener);
      return () => undefined;
    }),
    remove: jest.fn(),
    verify: jest.fn().mockResolvedValue(health()),
  };
  const propagation = { propagate: jest.fn().mockResolvedValue(health()) };
  const repairService = {
    repair: jest.fn().mockResolvedValue({
      paths: [],
      repaired: 0,
      health: null,
    }),
  };
  const broadcast = jest.fn().mockResolvedValue(undefined);

  let workspaceRoot: string | undefined = WS;
  const workspaceProvider = {
    getWorkspaceRoot: () => workspaceRoot,
  } as unknown as IWorkspaceProvider;

  const container = {
    resolve: jest.fn((token: symbol) => {
      if (token === TOKENS.WEBVIEW_MANAGER && options.withMessenger !== false) {
        return { broadcastMessage: broadcast };
      }
      throw new Error('unregistered token');
    }),
  } as unknown as DependencyContainer;

  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;

  const service = new HarnessHealthRpcService(
    logger,
    reconciler as unknown as HarnessReconcilerService,
    propagation as unknown as HarnessPropagationService,
    repairService as unknown as HarnessBlockedRepairService,
    workspaceProvider,
    container,
  );

  return {
    service,
    reconciler,
    propagation,
    repairService,
    broadcast,
    emitHealth: (report) => listeners.forEach((l) => l(report)),
    setWorkspaceRoot: (root) => {
      workspaceRoot = root;
    },
  };
}

describe('HarnessHealthRpcService', () => {
  describe('harness:health', () => {
    it('serves the cached report when it belongs to this workspace', async () => {
      const h = build();
      h.reconciler.getLastHealth.mockReturnValue(health());

      const result = await h.service.health({});

      expect(result.cached).toBe(true);
      expect(result.summary.level).toBe('ok');
      expect(h.propagation.propagate).not.toHaveBeenCalled();
    });

    it('ignores a cached report from a DIFFERENT workspace', async () => {
      // The reconciler is one singleton per host and its cache holds whichever
      // workspace ran last; a second window must not read the first's health.
      const h = build();
      h.reconciler.getLastHealth.mockReturnValue(
        health({ workspaceRoot: 'D:/ws/beta' }),
      );

      const result = await h.service.health({});

      expect(result.cached).toBe(false);
      expect(h.reconciler.verify).toHaveBeenCalled();
    });

    it('VERIFIES rather than reconciling — asking must not change the answer', async () => {
      // `reconcile({ mode: 'preflight' })` would look equivalent and is not:
      // preflight falls through to a full apply on drift, and it takes the
      // workspace lock. A polling badge must do neither.
      const h = build();

      await h.service.health({});

      expect(h.reconciler.verify).toHaveBeenCalledWith(WS, 'harness:health');
      expect(h.propagation.propagate).not.toHaveBeenCalled();
    });

    it('honours refresh: true even when a matching cache exists', async () => {
      const h = build();
      h.reconciler.getLastHealth.mockReturnValue(health());

      const result = await h.service.health({ refresh: true });

      expect(result.cached).toBe(false);
      expect(h.reconciler.verify).toHaveBeenCalled();
    });

    it('reports unknown with no workspace open, without touching the reconciler', async () => {
      const h = build();
      h.setWorkspaceRoot(undefined);

      const result = await h.service.health({});

      expect(result.health).toBeNull();
      expect(result.summary.level).toBe('unknown');
      expect(h.reconciler.verify).not.toHaveBeenCalled();
      expect(h.propagation.propagate).not.toHaveBeenCalled();
    });
  });

  describe('harness:reconcile', () => {
    it('defaults to a FULL pass through propagation, refreshing the user layer', async () => {
      const h = build();

      await h.service.reconcile({});

      expect(h.propagation.propagate).toHaveBeenCalledWith(
        WS,
        'harness:reconcile',
        { mode: 'full' },
      );
    });

    it('passes a target restriction through', async () => {
      const h = build();

      await h.service.reconcile({ targets: ['codex', 'cursor'] });

      expect(h.propagation.propagate).toHaveBeenCalledWith(
        WS,
        'harness:reconcile',
        { mode: 'full', targets: ['codex', 'cursor'] },
      );
    });

    it('drops an empty target list rather than reconciling nothing', async () => {
      const h = build();

      await h.service.reconcile({ targets: [] });

      expect(h.propagation.propagate).toHaveBeenCalledWith(
        WS,
        'harness:reconcile',
        { mode: 'full' },
      );
    });
  });

  describe('harness:remove', () => {
    it('removes and totals what went away', async () => {
      const h = build();
      h.reconciler.remove.mockResolvedValue(
        health({
          targets: [
            {
              ...health().targets[0],
              expected: 0,
              found: 0,
              removed: ['.claude/skills/foo', '.claude/commands/bar.md'],
            },
          ],
        }),
      );

      const result = await h.service.remove({ confirm: true });

      expect(h.reconciler.remove).toHaveBeenCalledWith(WS);
      expect(result.removed).toBe(2);
    });

    it('refuses without confirmation, even though the schema should have caught it', async () => {
      const h = build();

      await expect(
        h.service.remove({ confirm: false as unknown as true }),
      ).rejects.toThrow(/confirm/);
      expect(h.reconciler.remove).not.toHaveBeenCalled();
    });

    it('does nothing when no workspace is open', async () => {
      const h = build();
      h.setWorkspaceRoot(undefined);

      const result = await h.service.remove({ confirm: true });

      expect(result.removed).toBe(0);
      expect(h.reconciler.remove).not.toHaveBeenCalled();
    });
  });

  describe('harness:repairBlocked', () => {
    it('hands the consent set straight through, unfiltered and unreordered', async () => {
      const h = build();
      const paths = [
        { target: 'claude' as const, relPath: '.claude/skills/alpha' },
        { target: 'codex' as const, relPath: '.agents/skills/beta' },
      ];

      await h.service.repairBlocked({ paths });

      // The service must not second-guess the selection: the blocked-set gate
      // lives in `HarnessBlockedRepairService`, in the lib that owns the disk,
      // and a second copy of that rule here is how the two would drift.
      expect(h.repairService.repair).toHaveBeenCalledWith(WS, paths);
    });

    it('reports the per-path outcomes and the quarantine destination back to the caller', async () => {
      const h = build();
      h.repairService.repair.mockResolvedValue({
        paths: [
          {
            target: 'claude',
            relPath: '.claude/skills/alpha',
            outcome: 'repaired',
            quarantinePath:
              'D:/ws/alpha/.claude/skills/.ptah-quarantine/alpha-1',
          },
        ],
        repaired: 1,
        health: health(),
      });

      const result = await h.service.repairBlocked({
        paths: [{ target: 'claude', relPath: '.claude/skills/alpha' }],
      });

      expect(result.repaired).toBe(1);
      expect(result.paths[0].quarantinePath).toBe(
        'D:/ws/alpha/.claude/skills/.ptah-quarantine/alpha-1',
      );
      expect(result.summary.level).toBe('ok');
    });

    it('summarises a null health as unknown rather than inventing a clean report', async () => {
      const h = build();

      const result = await h.service.repairBlocked({ paths: [] });

      expect(result.health).toBeNull();
      expect(result.summary.level).toBe('unknown');
      expect(result.repaired).toBe(0);
    });

    it('never reaches the repair service with no workspace open', async () => {
      const h = build();
      h.setWorkspaceRoot(undefined);

      const result = await h.service.repairBlocked({
        paths: [{ target: 'claude', relPath: '.claude/skills/alpha' }],
      });

      expect(h.repairService.repair).not.toHaveBeenCalled();
      expect(result).toEqual(
        expect.objectContaining({ paths: [], repaired: 0, health: null }),
      );
    });
  });

  describe('harness:healthChanged push', () => {
    it('broadcasts the first completed pass', () => {
      const h = build();

      h.emitHealth(health());

      expect(h.broadcast).toHaveBeenCalledWith(
        MESSAGE_TYPES.HARNESS_HEALTH_CHANGED,
        expect.objectContaining({
          summary: expect.objectContaining({ level: 'ok' }),
        }),
      );
    });

    it('does NOT re-broadcast a pass whose summary is identical', () => {
      // A preflight runs on every session start. Without edge-triggering this
      // is one webview message per session for a badge that did not move.
      const h = build();

      h.emitHealth(health());
      h.emitHealth(
        health({ reason: 'other', generatedAt: '2026-08-18T01:00:00.000Z' }),
      );

      expect(h.broadcast).toHaveBeenCalledTimes(1);
    });

    it('broadcasts again once the summary actually changes', () => {
      const h = build();

      h.emitHealth(health());
      h.emitHealth(
        health({
          targets: [
            {
              ...health().targets[0],
              found: 2,
              missing: ['.claude/skills/foo'],
            },
          ],
        }),
      );

      expect(h.broadcast).toHaveBeenCalledTimes(2);
      const [, payload] = h.broadcast.mock.calls[1];
      expect((payload as { summary: { level: string } }).summary.level).toBe(
        'degraded',
      );
    });

    it('re-broadcasts on a workspace switch even when both are equally healthy', () => {
      const h = build();

      h.emitHealth(health());
      h.emitHealth(health({ workspaceRoot: 'D:/ws/beta' }));

      expect(h.broadcast).toHaveBeenCalledTimes(2);
    });

    it('is a silent no-op on a headless host with no webview', () => {
      const h = build({ withMessenger: false });

      expect(() => h.emitHealth(health())).not.toThrow();
      expect(h.broadcast).not.toHaveBeenCalled();
    });
  });
});
