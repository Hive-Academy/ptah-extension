/**
 * PluginLocalItemsService - the local-item steps the plugin RPCs delegate to.
 *
 * The RPC-level behaviour (plan, confirm, save) is covered end to end through
 * `plugin-rpc.handlers.spec.ts`, which builds this service over its mocks.
 * These cases pin the pieces that are easiest to break in isolation: the
 * plan/kept mapping, the apply-failure fallback and the pure helpers.
 */
import 'reflect-metadata';

// The apply service is passed in as a mock below; its module is stubbed so
// this suite does not load agent-generation's tree-sitter graph (ESM wasm).
jest.mock('./install-local-items.service', () => ({
  InstallLocalItemsService: class InstallLocalItemsServiceStub {},
}));

import type { Logger, SentryService } from '@ptah-extension/vscode-core';
import type { PluginLoaderService } from '@ptah-extension/agent-sdk';
import type { ExternalLocalItem, PluginInfo } from '@ptah-extension/shared';
import { createMockLogger } from '@ptah-extension/shared/testing';
import {
  PluginLocalItemsService,
  newlyEnabledPluginIds,
  sourceRefFor,
} from './plugin-local-items.service';
import type { InstallLocalItemsService } from './install-local-items.service';
import type { MarketplaceLocalItemsService } from './marketplace-local-items.service';

const ROOT = '/repo';

function item(
  approvalId: string,
  kind: ExternalLocalItem['kind'],
): ExternalLocalItem {
  return {
    approvalId,
    family: 'external',
    kind,
    target: 'claude',
    relPath: `skills/${approvalId}`,
  } as ExternalLocalItem;
}

function makeService() {
  const logger = createMockLogger();
  const sentry = { captureException: jest.fn() };
  const pluginLoader = {
    getAvailablePlugins: jest.fn().mockReturnValue([]),
    getPluginSourceDescriptors: jest.fn().mockReturnValue({}),
  };
  const installer = {
    planItemSlugs: jest.fn().mockReturnValue(null),
    attachLocalItems: jest.fn(),
  };
  const localItems = {
    planLocalItems: jest.fn().mockResolvedValue([]),
    keptReport: jest.fn().mockResolvedValue([]),
  };
  const install = {
    apply: jest
      .fn()
      .mockResolvedValue({ replaced: [], kept: [], unknown: [] }),
  };
  const service = new PluginLocalItemsService(
    logger as unknown as Logger,
    sentry as unknown as SentryService,
    pluginLoader as unknown as PluginLoaderService,
    installer as unknown as ConstructorParameters<
      typeof PluginLocalItemsService
    >[3],
    localItems as unknown as MarketplaceLocalItemsService,
    install as unknown as InstallLocalItemsService,
  );
  return { service, logger, sentry, installer, localItems, install };
}

describe('PluginLocalItemsService', () => {
  describe('applyPlanDecisions', () => {
    it('reports every unchosen item kept with its kind reason', async () => {
      const { service, install } = makeService();
      const items = [
        item('a', 'unowned'),
        item('b', 'unreadable'),
        item('c', 'agent-source'),
        item('d', 'owned-edited'),
        item('e', 'library-clone'),
      ];

      const report = await service.applyPlanDecisions(ROOT, items, {});

      expect(install.apply).not.toHaveBeenCalled();
      expect(report.replaced).toEqual([]);
      expect(report.kept.map((kept) => kept.reason)).toEqual([
        'unowned',
        'unreadable',
        'shadowed',
        'owned-edited',
        'owned-edited',
      ]);
    });

    it('applies only the plan ids chosen for replace; a lapsed id is changed-since-approval', async () => {
      const { service, install } = makeService();
      const items = [item('a', 'owned-edited'), item('b', 'owned-edited')];
      install.apply.mockResolvedValue({
        replaced: [
          {
            approvalId: 'a',
            family: 'external',
            relPath: 'skills/a',
            reason: 'owned-edited',
          },
        ],
        kept: [],
        unknown: ['b'],
      });

      const report = await service.applyPlanDecisions(ROOT, items, {
        a: 'replace',
        b: 'replace',
        foreign: 'replace',
      });

      expect(install.apply).toHaveBeenCalledWith({
        family: 'external',
        harnessRoot: ROOT,
        approvalIds: ['a', 'b'],
      });
      expect(report.replaced).toEqual([items[0]]);
      expect(report.kept).toEqual([
        expect.objectContaining({
          approvalId: 'b',
          reason: 'changed-since-approval',
        }),
      ]);
    });

    it('keeps every item when the apply throws, and reports the error', async () => {
      const { service, install, logger, sentry } = makeService();
      install.apply.mockRejectedValue(new Error('boom'));

      const report = await service.applyPlanDecisions(
        ROOT,
        [item('a', 'unowned')],
        { a: 'replace' },
      );

      expect(report.replaced).toEqual([]);
      expect(report.kept).toEqual([
        expect.objectContaining({ approvalId: 'a', reason: 'unowned' }),
      ]);
      expect(logger.error).toHaveBeenCalled();
      expect(sentry.captureException).toHaveBeenCalled();
    });
  });

  describe('planForInstall', () => {
    it('lists nothing without a harness root', async () => {
      const { service, localItems } = makeService();

      const items = await service.planForInstall(undefined, {
        consentToken: 't',
        pluginId: 'p',
        skills: [],
      } as unknown as Parameters<typeof service.planForInstall>[1]);

      expect(items).toEqual([]);
      expect(localItems.planLocalItems).not.toHaveBeenCalled();
    });
  });

  describe('keptForSave', () => {
    it('asks for no report when the save turned nothing on', async () => {
      const { service, localItems } = makeService();

      const kept = await service.keptForSave({
        harnessRoot: ROOT,
        previous: { enabledPluginIds: ['a'] },
        enabledPluginIds: ['a'],
        disabledPluginIds: undefined,
        health: null,
      });

      expect(kept).toEqual([]);
      expect(localItems.keptReport).not.toHaveBeenCalled();
    });
  });

  describe('newlyEnabledPluginIds', () => {
    it('returns new enables and ids taken off the denylist, once each', () => {
      expect(
        newlyEnabledPluginIds(
          { enabledPluginIds: ['a'], disabledPluginIds: ['h1', 'h2'] },
          ['a', 'b', 'b'],
          ['h2'],
        ),
      ).toEqual(['b', 'h1']);
    });

    it('ignores the denylist when the save preserved it', () => {
      expect(
        newlyEnabledPluginIds(
          { enabledPluginIds: [], disabledPluginIds: ['h1'] },
          [],
          undefined,
        ),
      ).toEqual([]);
    });
  });

  describe('sourceRefFor', () => {
    const plugin = { id: 'demo' } as PluginInfo;

    it('matches a described ref shape', () => {
      expect(sourceRefFor(plugin, [{ sourceRef: 'harness:demo' }])).toBe(
        'harness:demo',
      );
    });

    it('falls back to ptah:<id>', () => {
      expect(sourceRefFor(plugin, [{ sourceRef: 'other' }])).toBe('ptah:demo');
    });
  });
});
