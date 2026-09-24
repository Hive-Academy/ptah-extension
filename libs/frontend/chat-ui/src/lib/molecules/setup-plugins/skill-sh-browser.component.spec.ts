/**
 * SkillShBrowserComponent — the narrowed skills.sh discovery view (plan C11,
 * C13 "Community").
 *
 *   - **No tab strip.** The Installed view moved to the marketplace's
 *     Installed page; nothing here may switch views any more.
 *   - **Results are catalog cards.** Popular, search and recommended entries
 *     render as `ptah-catalog-card` list items inside `ptah-catalog-grid`,
 *     with a monogram tile, the source repo (and install count when present)
 *     as meta, and an Installed badge from the browser's own
 *     `skillsSh:listInstalled` read.
 *   - **The install path is unchanged.** `skillsSh:install` with
 *     `{ source, skillId }`, then a re-read of the installed list, then
 *     `skillInstalled`; a refusal surfaces its error text.
 *   - **Remove and search are unchanged.** Remove sends `skillsSh:uninstall`
 *     with `{ name: skillId }` and clears the badge after the re-read; search
 *     sends one `skillsSh:search` after the 300ms debounce.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import type { InstalledSkill, SkillShEntry } from '@ptah-extension/shared';
import { SkillShBrowserComponent } from './skill-sh-browser.component';

/** Minimal stand-in for the core `RpcResult` (`isSuccess()` + `.data`). */
function ok<T>(data: T) {
  return {
    success: true,
    data,
    error: undefined as string | undefined,
    isSuccess: (): boolean => data !== undefined,
  };
}

function entry(over: Partial<SkillShEntry> = {}): SkillShEntry {
  return {
    source: 'vercel-labs/skills',
    skillId: 'find-skills',
    name: 'Find Skills',
    description: 'Discover skills for your stack.',
    installs: 12_345,
    isInstalled: false,
    ...over,
  };
}

function installed(name: string): InstalledSkill {
  return {
    name,
    description: '',
    source: 'vercel-labs/skills',
    path: `C:\\Users\\dev\\.ptah\\plugins\\skills\\${name}`,
    scope: 'global',
    agents: [],
  };
}

interface RpcCall {
  method: string;
  params: unknown;
}

describe('SkillShBrowserComponent', () => {
  let calls: RpcCall[];
  let responders: Map<string, () => unknown>;

  const rpcMock = {
    call: jest.fn((method: string, params: unknown) => {
      calls.push({ method, params });
      const factory = responders.get(method);
      return Promise.resolve(factory ? factory() : ok(undefined));
    }),
  };

  const settle = async (fixture: ComponentFixture<unknown>): Promise<void> => {
    fixture.detectChanges();
    for (let pass = 0; pass < 3; pass += 1) {
      await fixture.whenStable();
      fixture.detectChanges();
    }
  };

  const mount = async (
    popular: SkillShEntry[],
    installedNames: string[] = [],
    recommended: SkillShEntry[] = [],
  ): Promise<ComponentFixture<SkillShBrowserComponent>> => {
    responders.set('skillsSh:getPopular', () => ok({ skills: popular }));
    responders.set('skillsSh:listInstalled', () =>
      ok({ skills: installedNames.map(installed) }),
    );
    responders.set('skillsSh:detectRecommended', () =>
      ok({
        detectedTechnologies: { frameworks: [], languages: [], tools: [] },
        recommendedSkills: recommended,
      }),
    );
    const fixture = TestBed.createComponent(SkillShBrowserComponent);
    await settle(fixture);
    return fixture;
  };

  const host = (fixture: ComponentFixture<unknown>): HTMLElement =>
    fixture.nativeElement as HTMLElement;

  const cards = (fixture: ComponentFixture<unknown>): HTMLElement[] =>
    Array.from(
      host(fixture).querySelectorAll('ptah-catalog-grid ptah-catalog-card'),
    );

  const button = (card: HTMLElement, label: string): HTMLButtonElement => {
    const found = card.querySelector<HTMLButtonElement>(
      `button[aria-label="${label}"]`,
    );
    if (!found) throw new Error(`no "${label}" button in card`);
    return found;
  };

  beforeEach(() => {
    calls = [];
    responders = new Map();
    rpcMock.call.mockClear();
    TestBed.configureTestingModule({
      imports: [SkillShBrowserComponent],
      providers: [{ provide: ClaudeRpcService, useValue: rpcMock }],
    });
  });

  it('renders no tab strip and no Installed view', async () => {
    const fixture = await mount([entry()], ['find-skills']);
    const root = host(fixture);

    expect(root.querySelector('.tabs, [role="tablist"], [role="tab"]')).toBe(
      null,
    );
    const labels = Array.from(root.querySelectorAll('button')).map((b) =>
      (b.textContent ?? '').trim(),
    );
    expect(labels).not.toContain('Browse');
    expect(labels.some((label) => label.startsWith('Installed ('))).toBe(false);
    expect(root.textContent).not.toContain('Installed Skills');
  });

  it('renders popular results as catalog cards inside the catalog grid', async () => {
    const fixture = await mount([
      entry(),
      entry({ skillId: 'remotion', name: 'Remotion', installs: 0 }),
    ]);

    const rendered = cards(fixture);
    expect(rendered).toHaveLength(2);
    for (const card of rendered) {
      expect(card.getAttribute('role')).toBe('listitem');
      expect(card.querySelector('ptah-monogram-tile')).not.toBe(null);
      expect(card.querySelector('ptah-brand-mark')).toBe(null);
    }

    const meta = (card: HTMLElement): string =>
      card
        .querySelector('[data-testid="catalog-card-meta"]')
        ?.textContent?.trim() ?? '';
    expect(meta(rendered[0])).toBe('vercel-labs/skills · 12.3K installs');
    expect(meta(rendered[1])).toBe('vercel-labs/skills');
    expect(rendered[0].textContent).toContain('Find Skills');
    expect(rendered[0].textContent).toContain(
      'Discover skills for your stack.',
    );
  });

  it('badges an installed result and offers Remove instead of Install', async () => {
    const fixture = await mount(
      [entry(), entry({ skillId: 'remotion', name: 'Remotion' })],
      ['find-skills'],
    );
    const [first, second] = cards(fixture);

    const badge = first.querySelector('[data-testid="catalog-card-badge"]');
    expect(badge?.textContent?.trim()).toBe('Installed');
    expect(button(first, 'Remove Find Skills')).toBeTruthy();
    expect(
      first.querySelector('button[aria-label="Install Find Skills"]'),
    ).toBe(null);

    expect(second.querySelector('[data-testid="catalog-card-badge"]')).toBe(
      null,
    );
    expect(button(second, 'Install Remotion')).toBeTruthy();
  });

  it('shows card skeletons in the grid while popular skills load', async () => {
    responders.set(
      'skillsSh:getPopular',
      () => new Promise(() => undefined) as unknown,
    );
    const fixture = TestBed.createComponent(SkillShBrowserComponent);
    fixture.detectChanges();

    const skeletons = host(fixture).querySelectorAll(
      'ptah-catalog-grid ptah-catalog-card-skeleton[role="listitem"]',
    );
    expect(skeletons.length).toBeGreaterThan(0);
    expect(cards(fixture)).toHaveLength(0);
  });

  it('renders recommendations as catalog cards in their own grid', async () => {
    const fixture = await mount(
      [entry()],
      [],
      [entry({ source: 'acme/skills', skillId: 'nx', name: 'Nx' })],
    );

    const grids = host(fixture).querySelectorAll('ptah-catalog-grid');
    expect(grids).toHaveLength(2);
    expect(grids[0].textContent).toContain('Nx');
    expect(host(fixture).textContent).toContain('Recommended for your project');
  });

  it('installs through skillsSh:install, re-reads the list and emits', async () => {
    const fixture = await mount([entry()]);
    const emitted: SkillShEntry[] = [];
    fixture.componentInstance.skillInstalled.subscribe((s) => emitted.push(s));

    responders.set('skillsSh:install', () => ok({ success: true }));
    responders.set('skillsSh:listInstalled', () =>
      ok({ skills: [installed('find-skills')] }),
    );
    calls = [];

    button(cards(fixture)[0], 'Install Find Skills').click();
    await settle(fixture);

    expect(calls[0]).toEqual({
      method: 'skillsSh:install',
      params: { source: 'vercel-labs/skills', skillId: 'find-skills' },
    });
    expect(calls.map((c) => c.method)).toContain('skillsSh:listInstalled');
    expect(emitted).toHaveLength(1);
    expect(emitted[0].skillId).toBe('find-skills');
    const badge = cards(fixture)[0].querySelector(
      '[data-testid="catalog-card-badge"]',
    );
    expect(badge?.textContent?.trim()).toBe('Installed');
  });

  it('reports a refused install with its error text', async () => {
    const fixture = await mount([entry()]);
    responders.set('skillsSh:install', () =>
      ok({ success: false, error: 'npx exited with code 1' }),
    );

    button(cards(fixture)[0], 'Install Find Skills').click();
    await settle(fixture);

    expect(
      host(fixture).querySelector('[role="alert"]')?.textContent,
    ).toContain('npx exited with code 1');
  });

  describe('Remove on an installed result card', () => {
    const badgeOf = (fixture: ComponentFixture<unknown>): Element | null =>
      cards(fixture)[0].querySelector('[data-testid="catalog-card-badge"]');

    it('uninstalls by skillId, emits, and clears the badge after the re-read', async () => {
      const fixture = await mount([entry()], ['find-skills']);
      const emitted: string[] = [];
      fixture.componentInstance.skillUninstalled.subscribe((n) =>
        emitted.push(n),
      );
      expect(badgeOf(fixture)?.textContent?.trim()).toBe('Installed');

      responders.set('skillsSh:uninstall', () => ok({ success: true }));
      responders.set('skillsSh:listInstalled', () => ok({ skills: [] }));
      calls = [];

      button(cards(fixture)[0], 'Remove Find Skills').click();
      await settle(fixture);

      expect(calls[0]).toEqual({
        method: 'skillsSh:uninstall',
        params: { name: 'find-skills' },
      });
      expect(calls.map((c) => c.method)).toContain('skillsSh:listInstalled');
      expect(emitted).toEqual(['find-skills']);
      expect(badgeOf(fixture)).toBe(null);
      expect(button(cards(fixture)[0], 'Install Find Skills')).toBeTruthy();
    });

    it('reports a refused uninstall with its error text and keeps the badge', async () => {
      const fixture = await mount([entry()], ['find-skills']);
      const emitted: string[] = [];
      fixture.componentInstance.skillUninstalled.subscribe((n) =>
        emitted.push(n),
      );
      responders.set('skillsSh:uninstall', () =>
        ok({ success: false, error: 'skill is locked' }),
      );

      button(cards(fixture)[0], 'Remove Find Skills').click();
      await settle(fixture);

      expect(
        host(fixture).querySelector('[role="alert"]')?.textContent,
      ).toContain('skill is locked');
      expect(emitted).toEqual([]);
      expect(badgeOf(fixture)?.textContent?.trim()).toBe('Installed');
    });

    it('reports a failed uninstall call as "Uninstall failed"', async () => {
      const fixture = await mount([entry()], ['find-skills']);
      responders.set('skillsSh:uninstall', () =>
        Promise.reject(new Error('transport closed')),
      );

      button(cards(fixture)[0], 'Remove Find Skills').click();
      await settle(fixture);

      expect(
        host(fixture).querySelector('[role="alert"]')?.textContent,
      ).toContain('Uninstall failed');
    });
  });

  describe('debounced search', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    const type = (fixture: ComponentFixture<unknown>, value: string): void => {
      const field = host(fixture).querySelector<HTMLInputElement>(
        'input[type="search"]',
      );
      if (!field) throw new Error('no search field');
      field.value = value;
      field.dispatchEvent(new Event('input'));
    };

    const searchCalls = (): RpcCall[] =>
      calls.filter((c) => c.method === 'skillsSh:search');

    it('sends one search after the debounce and renders the results as cards', async () => {
      const fixture = await mount([entry()]);
      responders.set('skillsSh:search', () =>
        ok({
          skills: [
            entry({ source: 'acme/skills', skillId: 'nx', name: 'Nx' }),
            entry({ source: 'acme/skills', skillId: 'jest', name: 'Jest' }),
          ],
        }),
      );

      jest.useFakeTimers();
      type(fixture, 'n');
      type(fixture, 'nx');
      jest.advanceTimersByTime(299);
      expect(searchCalls()).toHaveLength(0);
      jest.advanceTimersByTime(1);
      jest.useRealTimers();
      await settle(fixture);

      expect(searchCalls()).toEqual([
        { method: 'skillsSh:search', params: { query: 'nx' } },
      ]);
      const rendered = cards(fixture);
      expect(rendered.map((c) => c.getAttribute('role'))).toEqual([
        'listitem',
        'listitem',
      ]);
      expect(rendered[0].textContent).toContain('Nx');
      expect(rendered[1].textContent).toContain('Jest');
      expect(host(fixture).textContent).toContain('Search Results');
    });

    it('returns to popular skills when the query is cleared', async () => {
      const fixture = await mount([entry()]);
      responders.set('skillsSh:search', () =>
        ok({ skills: [entry({ skillId: 'nx', name: 'Nx' })] }),
      );

      jest.useFakeTimers();
      type(fixture, 'nx');
      jest.advanceTimersByTime(300);
      jest.useRealTimers();
      await settle(fixture);
      expect(cards(fixture)[0].textContent).toContain('Nx');

      calls = [];
      type(fixture, '');
      await settle(fixture);

      expect(searchCalls()).toHaveLength(0);
      const rendered = cards(fixture);
      expect(rendered).toHaveLength(1);
      expect(rendered[0].textContent).toContain('Find Skills');
      expect(host(fixture).textContent).toContain('Popular Skills');
    });
  });

  it('does not use innerHTML in its template or source', () => {
    expect(
      readFileSync(join(__dirname, 'skill-sh-browser.component.ts'), 'utf8'),
    ).not.toMatch(/innerHTML/i);
  });
});
