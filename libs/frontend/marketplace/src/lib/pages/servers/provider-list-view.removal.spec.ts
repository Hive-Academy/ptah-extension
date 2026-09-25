/**
 * ProviderListViewComponent removal specs (plan C7, Task 13.1): single and
 * bulk removal, the `direct` confirmation (re-derived live, never replayed
 * from open time), the bulk-vs-single race, the bulk summary, and the empty
 * states. Harness: `provider-list-view.testing.ts`.
 */

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { groupInstalledServers } from '@ptah-extension/chat-ui';

import {
  removalIdOf,
  type InventoryRemovalOutcome,
  type InventoryRemovalRef,
  type InventoryRemovalResult,
} from '../../data/marketplace-inventory.store';
import type { MarketplaceTier } from '../../layout/marketplace-layout';
import { bulkRemovalResult } from './provider-list-view.component';
import {
  ListViewPage,
  TEST_REF as REF,
  TEST_SERVERS,
  configureListViewTestBed,
  createInventoryStub,
  readySlice,
  testServer,
  type InventoryStub,
} from './provider-list-view.testing';

describe('ProviderListViewComponent — removal', () => {
  let inventory: InventoryStub;
  let page: ListViewPage;
  let removeServer: jest.SpyInstance;
  let removeMany: jest.SpyInstance<
    Promise<readonly InventoryRemovalResult[]>,
    [readonly InventoryRemovalRef[]]
  >;

  beforeEach(() => {
    inventory = createInventoryStub();
    removeServer = jest.spyOn(inventory, 'removeServer');
    removeMany = jest.spyOn(inventory, 'removeMany');
    configureListViewTestBed(inventory, signal<MarketplaceTier>('regular'));
    page = new ListViewPage();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  const removedIds = (call = 0): string[] =>
    removeMany.mock.calls[call][0].map(removalIdOf);

  const outcomes = (
    refs: readonly InventoryRemovalRef[],
    failAt: number,
  ): InventoryRemovalResult[] =>
    refs.map((ref, index) => ({
      id: removalIdOf(ref),
      ref,
      outcome:
        index === failAt
          ? { status: 'failed' as const, message: 'Permission denied' }
          : { status: 'removed' as const },
    }));

  it('removes a Ptah-managed row directly', async () => {
    await page.mount();
    page.removeButtonOf(REF.firecrawl)?.click();
    await page.settle();

    expect(removeServer).toHaveBeenCalledTimes(1);
    const [group, options] = removeServer.mock.calls[0];
    expect(group.serverKey).toBe('firecrawl');
    expect(options).toEqual({ confirmedDirect: false });
  });

  it('asks before removing a direct row, naming its config file', async () => {
    await page.mount();
    page.removeButtonOf(REF.linear)?.click();
    await page.settle();

    expect(removeServer).not.toHaveBeenCalled();
    expect(
      page
        .qa('[data-testid="direct-removal-path"]')
        .map((p) => p.textContent?.trim()),
    ).toEqual(['C:\\Users\\me\\.cursor\\mcp.json']);

    await page.click('direct-removal-confirm-button');
    expect(removeServer).toHaveBeenCalledWith(
      expect.objectContaining({ serverKey: 'linear' }),
      { confirmedDirect: true },
    );
  });

  it('cancels the confirmation with Cancel or Esc without removing', async () => {
    await page.mount();
    page.removeButtonOf(REF.linear)?.click();
    await page.settle();
    await page.click('direct-removal-cancel');
    expect(page.byTestId('direct-removal-confirm')).toBeNull();

    page.removeButtonOf(REF.linear)?.click();
    await page.settle();
    const confirm = page.byTestId('direct-removal-confirm');
    if (!confirm) throw new Error('no confirmation');
    await page.key(confirm, 'Escape');
    expect(page.byTestId('direct-removal-confirm')).toBeNull();
    expect(removeServer).not.toHaveBeenCalled();
  });

  it('shows a failed single removal inline', async () => {
    removeServer.mockResolvedValueOnce({
      status: 'failed',
      message: 'Config file is read-only.',
    } satisfies InventoryRemovalOutcome);
    await page.mount();
    page.removeButtonOf(REF.firecrawl)?.click();
    await page.settle();

    expect(page.byTestId('provider-list-notice')?.textContent).toContain(
      'Config file is read-only.',
    );
  });

  it('summarises a partial bulk failure and keeps only the failed selection', async () => {
    removeMany.mockImplementationOnce(async (refs) => outcomes(refs, 1));
    await page.mount();
    await page.check(REF.firecrawl);
    await page.check(REF.nodeRepl);
    await page.click('bulk-action');

    expect(removeMany).toHaveBeenCalledTimes(1);
    expect(page.byTestId('bulk-result-summary')?.textContent).toContain(
      '1 removed, 1 failed',
    );
    expect(page.byTestId('bulk-failures')?.textContent).toContain(
      'Permission denied',
    );
    const [removedRef, failedRef] = removedIds();
    expect(page.checkboxOf(removedRef)?.checked).toBe(false);
    expect(page.checkboxOf(failedRef)?.checked).toBe(true);
  });

  it('disables every queued row for the whole bulk run, so a single Remove cannot race it', async () => {
    let finish: (results: InventoryRemovalResult[]) => void = () => undefined;
    removeMany.mockImplementationOnce(
      (refs) =>
        new Promise((resolve) => {
          finish = resolve;
          // The store marks only the row it is on right now.
          inventory.pendingIds.set(new Set([removalIdOf(refs[0])]));
        }),
    );
    await page.mount();
    await page.check(REF.firecrawl);
    await page.check(REF.nodeRepl);
    await page.click('bulk-action');

    // node_repl is queued behind firecrawl: its button is disabled too.
    const queued = page.removeButtonOf(REF.nodeRepl);
    expect(queued?.disabled).toBe(true);
    expect(page.removeButtonOf(REF.firecrawl)?.disabled).toBe(true);
    expect(page.removeButtonOf(REF.linear)?.disabled).toBe(false);
    queued?.click();
    await page.settle();
    expect(removeServer).not.toHaveBeenCalled();

    const refs = removeMany.mock.calls[0][0];
    inventory.pendingIds.set(new Set());
    finish(outcomes(refs, -1));
    await page.settle();

    expect(removeServer).not.toHaveBeenCalled();
    expect(page.byTestId('bulk-result-summary')?.textContent?.trim()).toBe(
      '2 removed',
    );
    expect(page.removeButtonOf(REF.nodeRepl)?.disabled).toBe(false);
  });

  it('confirms a bulk run that includes a direct row before removing anything', async () => {
    await page.mount();
    await page.check(REF.firecrawl);
    await page.check(REF.linear);
    await page.click('bulk-action');

    expect(removeMany).not.toHaveBeenCalled();
    expect(page.byTestId('direct-removal-confirm')?.textContent).toContain(
      '1 of the 2 selected',
    );

    await page.click('direct-removal-confirm-button');
    const refs = removeMany.mock.calls[0][0];
    expect(
      refs.map((ref) => (ref.kind === 'server' ? ref.confirmedDirect : null)),
    ).toEqual([true, true]);
  });

  it('re-derives an open bulk confirmation when a filter changes, and removes only what it shows', async () => {
    await page.mount();
    await page.check(REF.firecrawl);
    await page.check(REF.nodeRepl);
    await page.check(REF.linear);
    await page.click('bulk-action');
    expect(page.byTestId('direct-removal-confirm')?.textContent).toContain(
      '1 of the 3 selected',
    );

    // Hide the two managed rows while the confirmation is open.
    await page.typeSearch('linear');
    expect(page.byTestId('direct-removal-confirm')?.textContent).toContain(
      '1 of the 1 selected',
    );

    await page.click('direct-removal-confirm-button');
    expect(removedIds()).toEqual([REF.linear]);
  });

  it('drops an open bulk confirmation whose direct rows a filter hid', async () => {
    await page.mount();
    await page.check(REF.firecrawl);
    await page.check(REF.linear);
    await page.click('bulk-action');

    await page.typeSearch('firecrawl');
    expect(page.byTestId('direct-removal-confirm')).toBeNull();
    expect(removeMany).not.toHaveBeenCalled();

    await page.click('bulk-action');
    expect(removedIds()).toEqual([REF.firecrawl]);
  });

  it('never bulk-removes a selected row that a filter hides', async () => {
    await page.mount();
    await page.check(REF.firecrawl);
    await page.check(REF.nodeRepl);
    await page.typeSearch('firecrawl');

    expect(page.byTestId('bulk-count')?.textContent?.trim()).toBe('1 selected');
    await page.click('bulk-action');
    expect(removedIds()).toEqual([REF.firecrawl]);
  });

  it('offers "Clear filters" when filters hide every row', async () => {
    await page.mount();
    await page.typeSearch('no-such-server');

    const action = page.byTestId('provider-table-empty-action');
    expect(action?.textContent?.trim()).toBe('Clear filters');
    await page.click('provider-table-empty-action');
    expect(page.qa('[data-list-rows] [data-ref]')).toHaveLength(
      TEST_SERVERS.length,
    );
  });

  it('links an empty inventory to the connectors page', async () => {
    inventory.installed.set(readySlice([]));
    await page.mount();
    expect(
      page.byTestId('provider-table-empty-action')?.textContent?.trim(),
    ).toBe('Browse connectors');
    await page.click('provider-table-empty-action');
    expect(page.url()).toBe('/marketplace/connectors');
  });

  it('bulkRemovalResult counts removals and lists failures, refusals and vanished rows', () => {
    const result = (
      serverKey: string,
      outcome: InventoryRemovalOutcome,
    ): InventoryRemovalResult => {
      const [group] = groupInstalledServers([testServer(serverKey)]);
      const ref: InventoryRemovalRef = { kind: 'server', group };
      return { id: removalIdOf(ref), ref, outcome };
    };
    const [gone] = [{ title: 'gone' }] as never[];

    expect(
      bulkRemovalResult(
        [
          result('a', { status: 'removed' }),
          result('b', { status: 'failed', message: 'denied' }),
          result('c', {
            status: 'refused',
            reason: 'in-progress',
            message: 'busy',
          }),
        ],
        [gone],
      ),
    ).toEqual({
      removed: 1,
      failed: [
        { name: 'b', reason: 'denied' },
        { name: 'c', reason: 'busy' },
        { name: 'gone', reason: 'It is no longer installed.' },
      ],
    });
  });
});
