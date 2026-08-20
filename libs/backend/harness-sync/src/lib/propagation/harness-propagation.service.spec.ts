/**
 * `HarnessPropagationService` — the ONE call every "something changed upstream"
 * trigger makes (TASK_2026_278 Batch 3).
 *
 * The invariant under test is an ORDER, not a call count: the reconciler's
 * desired state IS `~/.ptah/user`, so a refresh that ran AFTER the reconcile
 * would propagate the previous state and report success. Every assertion here
 * is written against `invocationCallOrder` for that reason.
 */

import type { HarnessHealth } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import { HarnessPropagationService } from './harness-propagation.service';
import type { HarnessReconcilerService } from '../reconciler/harness-reconciler.service';
import type { IUserLayerRefresher } from '../sources/user-layer-refresher.port';

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function makeHealth(reason: string): HarnessHealth {
  return {
    workspaceRoot: '/ws',
    generatedAt: '2026-01-01T00:00:00.000Z',
    mode: 'full',
    reason,
    sources: 'ok',
    targets: [],
    collisions: [],
  };
}

interface Harness {
  service: HarnessPropagationService;
  reconcile: jest.Mock;
  refresh: jest.Mock;
  logger: Logger;
}

function buildHarness(
  overrides: { reconcile?: jest.Mock; refresh?: jest.Mock } = {},
): Harness {
  const reconcile =
    overrides.reconcile ??
    jest
      .fn()
      .mockImplementation(async (_cwd: string, options: { reason: string }) =>
        makeHealth(options.reason),
      );
  const refresh = overrides.refresh ?? jest.fn().mockResolvedValue(undefined);
  const logger = makeLogger();
  const service = new HarnessPropagationService(
    logger,
    { reconcile } as unknown as HarnessReconcilerService,
    { refresh } as unknown as IUserLayerRefresher,
  );
  return { service, reconcile, refresh, logger };
}

describe('HarnessPropagationService', () => {
  it('refreshes the user layer BEFORE reconciling', async () => {
    const h = buildHarness();

    await h.service.propagate('/ws', 'skill-repropagation:agent');

    expect(h.refresh).toHaveBeenCalledWith('/ws');
    expect(h.refresh.mock.invocationCallOrder[0]).toBeLessThan(
      h.reconcile.mock.invocationCallOrder[0],
    );
  });

  it('reconciles in full mode and carries the caller reason through', async () => {
    const h = buildHarness();

    const health = await h.service.propagate('/ws', 'harness:create-skill');

    expect(h.reconcile).toHaveBeenCalledWith('/ws', {
      mode: 'full',
      reason: 'harness:create-skill',
    });
    expect(health?.reason).toBe('harness:create-skill');
  });

  it('skips the refresh only when the caller says the sources cannot have changed', async () => {
    const h = buildHarness();

    await h.service.propagate('/ws', 'plugins:save-config', {
      skipUserLayerRefresh: true,
    });

    expect(h.refresh).not.toHaveBeenCalled();
    expect(h.reconcile).toHaveBeenCalledTimes(1);
  });

  it('still reconciles when the refresh throws', async () => {
    // A stale user layer degrades propagation to "reconcile what we already
    // had", which still heals every target that drifted for another reason.
    const refresh = jest.fn().mockRejectedValue(new Error('EPERM'));
    const h = buildHarness({ refresh });

    const health = await h.service.propagate(
      '/ws',
      'plugins:uninstall-external',
    );

    expect(health).not.toBeNull();
    expect(h.reconcile).toHaveBeenCalledTimes(1);
    expect(h.logger.warn).toHaveBeenCalled();
  });

  it('returns null instead of throwing when the reconcile fails', async () => {
    const reconcile = jest.fn().mockRejectedValue(new Error('EBUSY'));
    const h = buildHarness({ reconcile });

    await expect(h.service.propagate('/ws', 'boot')).resolves.toBeNull();
    expect(h.logger.warn).toHaveBeenCalled();
  });

  it.each([undefined, '', '   '])(
    'does nothing at all when there is no workspace (%p)',
    async (cwd) => {
      const h = buildHarness();

      const health = await h.service.propagate(cwd, 'activation');

      expect(health).toBeNull();
      expect(h.refresh).not.toHaveBeenCalled();
      expect(h.reconcile).not.toHaveBeenCalled();
    },
  );

  it('forwards downloadPending so an empty layer reads as pending, not missing', async () => {
    const h = buildHarness();

    await h.service.propagate('/ws', 'activation', { downloadPending: true });

    expect(h.reconcile).toHaveBeenCalledWith('/ws', {
      mode: 'full',
      reason: 'activation',
      downloadPending: true,
    });
  });
});
