/**
 * ProviderListViewComponent specs (plan C7, Task 13.1) — tiers, detail
 * placement, focus and keyboard. Removal lives in
 * `provider-list-view.removal.spec.ts`.
 *
 * Mounted inside a routed page stub with the detail as the `:serverRef`
 * child (`provider-list-view.testing.ts`). Stores and layout are stubs
 * (Revision 3 D-4.3: a stubbed store sets `newestSessionStatus` directly);
 * the specs flip the tier.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ChangeDetectionStrategy,
  Component,
  signal,
  type WritableSignal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';

import type { MarketplaceTier } from '../../layout/marketplace-layout';
import { ProviderListViewComponent } from './provider-list-view.component';
import {
  ListViewPage,
  TEST_REF as REF,
  configureListViewTestBed,
  createInventoryStub,
  type InventoryStub,
} from './provider-list-view.testing';

/** A page that puts its own content inside the list view. */
@Component({
  selector: 'ptah-test-projecting-page',
  standalone: true,
  imports: [ProviderListViewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ptah-provider-list-view>
    <button type="button" data-testid="projected-control">Toggle</button>
  </ptah-provider-list-view>`,
})
class ProjectingPageComponent {}

describe('ProviderListViewComponent', () => {
  let tier: WritableSignal<MarketplaceTier>;
  let inventory: InventoryStub;
  let page: ListViewPage;

  beforeEach(() => {
    tier = signal<MarketplaceTier>('regular');
    inventory = createInventoryStub();
    configureListViewTestBed(inventory, tier);
    page = new ListViewPage();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  const flip = async (next: MarketplaceTier): Promise<void> => {
    tier.set(next);
    await page.settle();
  };

  const detailIn = (frame: 'native-drawer-panel' | 'docked-inspector') =>
    page.q(`[data-testid="${frame}"] [data-testid="detail-stub"]`)
      ?.textContent ?? null;

  describe('presentation by tier', () => {
    it('swaps table and cards by tier and keeps the selection across flips', async () => {
      await page.mount();
      await page.check(REF.firecrawl);
      expect(page.byTestId('provider-table')).not.toBeNull();
      expect(page.byTestId('bulk-count')?.textContent?.trim()).toBe(
        '1 selected',
      );

      await flip('compact');
      expect(page.byTestId('provider-table')).toBeNull();
      expect(page.byTestId('provider-cards')).not.toBeNull();
      expect(page.checkboxOf(REF.firecrawl)?.checked).toBe(true);
      await flip('wide');
      expect(page.checkboxOf(REF.firecrawl)?.checked).toBe(true);
      expect(page.byTestId('bulk-count')?.textContent?.trim()).toBe(
        '1 selected',
      );
    });

    it('groups rows by origin with counted headers at wide only', async () => {
      await page.mount();
      expect(page.byTestId('provider-group-heading')).toBeNull();

      await flip('wide');
      expect(
        page
          .qa('[data-testid="provider-group-heading"]')
          .map((h) => h.firstChild?.textContent?.trim()),
      ).toEqual(['Config file', 'Claude CLI', 'Smithery']);
      expect(
        page
          .qa('[data-testid="provider-group-count"]')
          .map((c) => c.textContent?.trim()),
      ).toEqual(['3', '1', '1']);
    });

    it('shows the loading state while the slice is idle or loading', async () => {
      inventory.installed.set({ state: 'idle', data: [] });
      await page.mount();
      expect(page.byTestId('provider-table-loading')).not.toBeNull();
    });

    it('shows the load error with a Retry that retries the slice', async () => {
      const retry = jest.spyOn(inventory, 'retry');
      inventory.installed.set({ state: 'error', data: [], error: 'boom' });
      await page.mount();
      expect(page.byTestId('provider-table-error')?.textContent).toContain(
        'boom',
      );

      await page.click('provider-table-retry');
      expect(retry).toHaveBeenCalledWith('installed');
    });
  });

  describe('detail placement', () => {
    it('opens the detail route from a row, in the drawer below wide', async () => {
      await page.mount();
      page.openButtonOf(REF.firecrawl)?.click();
      await page.settle();

      expect(page.url()).toBe(`/marketplace/servers/${REF.firecrawl}`);
      expect(detailIn('native-drawer-panel')).toBe(REF.firecrawl);
      expect(page.byTestId('docked-inspector')).toBeNull();
    });

    it('derives open from router state: a URL opens it, the list URL closes it', async () => {
      await page.mount(`/marketplace/servers/${REF.exa}`);
      expect(page.byTestId('detail-stub')?.textContent).toBe(REF.exa);

      await page.navigate('/marketplace/servers');
      expect(page.byTestId('detail-stub')).toBeNull();
      expect(page.byTestId('native-drawer-panel')).toBeNull();
    });

    it('docks the detail at wide and moves it between frames without navigating', async () => {
      await page.mount(`/marketplace/servers/${REF.firecrawl}`);
      await flip('wide');
      expect(page.byTestId('native-drawer-panel')).toBeNull();
      expect(detailIn('docked-inspector')).toBe(REF.firecrawl);

      await flip('regular');
      expect(detailIn('native-drawer-panel')).toBe(REF.firecrawl);
      expect(page.url()).toBe(`/marketplace/servers/${REF.firecrawl}`);
    });

    it.each([
      ['regular', 'native-drawer-close'],
      ['wide', 'docked-inspector-close'],
    ] as const)('closes to the list route at %s (%s)', async (at, close) => {
      tier.set(at);
      await page.mount(`/marketplace/servers/${REF.firecrawl}`);
      await page.click(close);

      expect(page.url()).toBe('/marketplace/servers');
      expect(page.byTestId('detail-stub')).toBeNull();
    });

    it('traps focus in the drawer: focus moves into the panel on open', async () => {
      await page.mount();
      page.openButtonOf(REF.firecrawl)?.focus();
      page.openButtonOf(REF.firecrawl)?.click();
      await page.settle();

      const panel = page.byTestId('native-drawer-panel');
      expect(panel?.contains(document.activeElement)).toBe(true);
    });

    it('does not steal focus in the docked frame', async () => {
      tier.set('wide');
      await page.mount();
      const open = page.openButtonOf(REF.firecrawl);
      open?.focus();
      open?.click();
      await page.settle();

      expect(page.byTestId('docked-inspector')).not.toBeNull();
      expect(document.activeElement).toBe(page.openButtonOf(REF.firecrawl));

      // Selecting another row keeps focus on that row, not the pane.
      const next = page.openButtonOf(REF.nodeRepl);
      next?.focus();
      next?.click();
      await page.settle();
      expect(page.byTestId('detail-stub')?.textContent).toBe(REF.nodeRepl);
      expect(document.activeElement).toBe(page.openButtonOf(REF.nodeRepl));
    });
  });

  describe('keyboard', () => {
    const activeRefs = (): (string | null)[] =>
      page
        .qa('[data-list-rows] [data-ref][data-active="true"]')
        .map((el) => el.getAttribute('data-ref'));

    it('↓ activates the first row, then the next, and focuses it', async () => {
      await page.mount();
      const order = page
        .qa('[data-list-rows] [data-ref]')
        .map((el) => el.getAttribute('data-ref') ?? '');
      const start = page.checkboxOf(order[0]);
      if (!start) throw new Error('no first row');

      await page.key(start, 'ArrowDown');
      expect(activeRefs()).toEqual([order[0]]);

      await page.key(document.activeElement ?? start, 'ArrowDown');
      expect(activeRefs()).toEqual([order[1]]);
      expect(document.activeElement).toBe(page.openButtonOf(order[1]));

      await page.key(document.activeElement ?? start, 'ArrowUp');
      expect(activeRefs()).toEqual([order[0]]);

      await page.key(document.activeElement ?? start, 'End');
      expect(activeRefs()).toEqual([order[order.length - 1]]);
    });

    it('Enter on a row control opens the active row', async () => {
      await page.mount();
      const box = page.checkboxOf(REF.firecrawl);
      if (!box) throw new Error('no checkbox');
      await page.key(box, 'ArrowDown');
      const active = activeRefs()[0] ?? '';

      await page.key(page.checkboxOf(active) ?? box, 'Enter');
      expect(page.url()).toBe(`/marketplace/servers/${active}`);
    });

    it('ignores arrows typed in the search field', async () => {
      await page.mount();
      const search = page.q<HTMLInputElement>('input[type="search"]');
      if (!search) throw new Error('no search');
      await page.key(search, 'ArrowDown');
      expect(activeRefs()).toEqual([]);
    });

    it('Esc closes the docked detail and returns focus to the active row', async () => {
      tier.set('wide');
      await page.mount();
      page.openButtonOf(REF.sentry)?.click();
      await page.settle();
      const button = page.byTestId('detail-stub-button');
      if (!button) throw new Error('no detail');
      button.focus();

      await page.key(button, 'Escape');
      await page.settle();

      expect(page.url()).toBe('/marketplace/servers');
      expect(document.activeElement).toBe(page.openButtonOf(REF.sentry));
    });

    it('Esc with a pending confirmation and the docked detail open cancels the confirmation first, then closes the detail', async () => {
      tier.set('wide');
      await page.mount();
      page.openButtonOf(REF.firecrawl)?.click();
      await page.settle();
      page.removeButtonOf(REF.linear)?.click();
      await page.settle();
      const confirm = page.byTestId('direct-removal-confirm');
      if (!confirm) throw new Error('no confirmation');

      await page.key(confirm, 'Escape');
      expect(page.byTestId('direct-removal-confirm')).toBeNull();
      expect(page.byTestId('docked-inspector')).not.toBeNull();
      expect(page.url()).toBe(`/marketplace/servers/${REF.firecrawl}`);

      await page.key(page.rowOf(REF.linear) ?? confirm, 'Escape');
      await page.settle();
      expect(page.url()).toBe('/marketplace/servers');
      expect(page.byTestId('docked-inspector')).toBeNull();
      expect(document.activeElement).toBe(page.openButtonOf(REF.firecrawl));
    });

    it('Esc inside the drawer closes it through the drawer', async () => {
      await page.mount(`/marketplace/servers/${REF.firecrawl}`);
      const panel = page.byTestId('native-drawer-panel');
      if (!panel) throw new Error('no drawer');

      await page.key(panel, 'Escape');
      expect(page.url()).toBe('/marketplace/servers');
    });
  });

  describe('projected content', () => {
    const mountProjecting = async (): Promise<HTMLElement> => {
      const fixture = TestBed.createComponent(ProjectingPageComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      return fixture.nativeElement as HTMLElement;
    };

    it.each(['regular', 'wide'] as const)(
      'renders the page content in the list column under the rows, outside the row keyboard region (%s)',
      async (at) => {
        tier.set(at);
        const root = await mountProjecting();
        const projected = root.querySelector(
          '[data-testid="projected-control"]',
        );

        expect(
          projected?.closest('[data-testid="provider-list"]'),
        ).not.toBeNull();
        expect(projected?.closest('[data-list-rows]')).toBeNull();
        const rows = root.querySelector('[data-testid="provider-list-rows"]');
        expect(
          rows !== null &&
            projected !== null &&
            (rows.compareDocumentPosition(projected) &
              Node.DOCUMENT_POSITION_FOLLOWING) !==
              0,
        ).toBe(true);
      },
    );

    it('does not treat arrows on projected content as row navigation', async () => {
      const root = await mountProjecting();
      const projected = root.querySelector<HTMLElement>(
        '[data-testid="projected-control"]',
      );
      if (!projected) throw new Error('no projected control');
      const event = new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        bubbles: true,
        cancelable: true,
      });
      projected.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
      expect(root.querySelector('[data-active="true"]')).toBeNull();
    });
  });

  it('does not use innerHTML in its template or source', () => {
    for (const file of [
      'provider-list-view.component.ts',
      'provider-list-view.component.html',
    ]) {
      expect(readFileSync(join(__dirname, file), 'utf8')).not.toMatch(
        /innerHTML/i,
      );
    }
  });
});
