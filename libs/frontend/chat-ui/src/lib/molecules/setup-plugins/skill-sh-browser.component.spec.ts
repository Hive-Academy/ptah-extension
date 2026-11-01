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
 *   - **Install asks for the scope first (design-spec §2).** Install opens a
 *     storefront panel under the card with the shared scope field; This
 *     workspace is the default, the primary button reads "Install to this
 *     workspace" / "Install to all workspaces", and the install sends
 *     `{ source, skillId, scope }`, then re-reads the installed list and
 *     emits `skillInstalled`. With no folder open nothing is selected and the
 *     button stays disabled until the user picks All workspaces. A refusal
 *     (including a rolled-back install) surfaces its error text and keeps the
 *     panel open.
 *   - **Installed cards show their scope badge** ("This workspace" / "All
 *     workspaces").
 *   - **Remove and search are unchanged.** Remove sends `skillsSh:uninstall`
 *     with `{ name: skillId }` and clears the badge after the re-read; search
 *     sends one `skillsSh:search` after the 300ms debounce.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AppStateManager, ClaudeRpcService } from '@ptah-extension/core';
import type {
  CapabilityScope,
  InstalledSkill,
  SkillShEntry,
  WorkspaceInfo,
} from '@ptah-extension/shared';
import { MARKETPLACE_RPC_TIMEOUTS } from './marketplace-rpc-timeouts';
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

function installed(
  name: string,
  scope: CapabilityScope = 'global',
): InstalledSkill {
  return {
    name,
    description: '',
    source: 'vercel-labs/skills',
    path: `C:\\Users\\dev\\.ptah\\plugins\\skills\\${name}`,
    scope,
    agents: [],
  };
}

const WORKSPACE: WorkspaceInfo = {
  name: 'acme-app',
  path: '/home/dev/acme-app',
  type: 'workspace',
};

interface RpcCall {
  method: string;
  params: unknown;
}

describe('SkillShBrowserComponent', () => {
  let calls: RpcCall[];
  let responders: Map<string, () => unknown>;
  let workspaceInfo: ReturnType<typeof signal<WorkspaceInfo | null>>;

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

  const confirmButton = (
    fixture: ComponentFixture<unknown>,
  ): HTMLButtonElement | null =>
    host(fixture).querySelector<HTMLButtonElement>(
      '[data-testid="skill-install-confirm"]',
    );

  const scopeRadio = (
    fixture: ComponentFixture<unknown>,
    value: CapabilityScope,
  ): HTMLInputElement => {
    const radio = host(fixture).querySelector<HTMLInputElement>(
      `ptah-install-scope-field input[type="radio"][value="${value}"]`,
    );
    if (!radio) throw new Error(`no "${value}" scope radio`);
    return radio;
  };

  /** Open the first card's install panel and press its primary button. */
  const installVia = async (
    fixture: ComponentFixture<unknown>,
  ): Promise<void> => {
    const install = button(cards(fixture)[0], 'Install Find Skills');
    install.click();
    await settle(fixture);
    const confirm = confirmButton(fixture);
    if (!confirm) throw new Error('no install panel');
    confirm.click();
  };

  beforeEach(() => {
    calls = [];
    responders = new Map();
    rpcMock.call.mockClear();
    workspaceInfo = signal<WorkspaceInfo | null>(WORKSPACE);
    TestBed.configureTestingModule({
      imports: [SkillShBrowserComponent],
      providers: [
        { provide: ClaudeRpcService, useValue: rpcMock },
        {
          provide: AppStateManager,
          useValue: { workspaceInfo: workspaceInfo.asReadonly() },
        },
      ],
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

    await installVia(fixture);
    await settle(fixture);

    expect(calls[0]).toEqual({
      method: 'skillsSh:install',
      params: {
        source: 'vercel-labs/skills',
        skillId: 'find-skills',
        scope: 'workspace',
      },
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

    await installVia(fixture);
    await settle(fixture);

    expect(
      host(fixture).querySelector('[role="alert"]')?.textContent,
    ).toContain('npx exited with code 1');
  });

  // Regression: the install ran on the RPC default of 30s while a real
  // `npx skills add` (a full GitHub clone) takes 11–46s, so the webview gave up
  // on installs the backend went on to complete.
  it('gives skillsSh:install the marketplace install budget, not the 30s default', async () => {
    const fixture = await mount([entry()]);
    responders.set('skillsSh:install', () => ok({ success: true }));

    await installVia(fixture);
    await settle(fixture);

    const installCall = rpcMock.call.mock.calls.find(
      ([method]) => method === 'skillsSh:install',
    ) as unknown[] | undefined;
    expect(installCall?.[2]).toEqual({
      timeout: MARKETPLACE_RPC_TIMEOUTS.SKILL_INSTALL_MS,
    });
    expect(MARKETPLACE_RPC_TIMEOUTS.SKILL_INSTALL_MS).toBeGreaterThan(120_000);
  });

  it('reports an install that fails at the RPC layer instead of going quiet', async () => {
    const fixture = await mount([entry()]);
    responders.set('skillsSh:install', () => ({
      success: false,
      data: undefined,
      error: 'RPC timeout: skillsSh:install',
      isSuccess: (): boolean => false,
    }));

    await installVia(fixture);
    await settle(fixture);

    expect(
      host(fixture).querySelector('[role="alert"]')?.textContent,
    ).toContain('RPC timeout: skillsSh:install');
  });

  describe('install scope panel', () => {
    it('opens a storefront panel with the scope field, This workspace by default', async () => {
      const fixture = await mount([entry()]);
      calls = [];
      const install = button(cards(fixture)[0], 'Install Find Skills');

      install.click();
      await settle(fixture);

      expect(calls).toEqual([]);
      expect(install.getAttribute('aria-expanded')).toBe('true');
      expect(install.textContent?.trim()).toBe('Cancel');
      const panel = host(fixture).querySelector<HTMLElement>(
        'ptah-catalog-grid [role="listitem"].col-span-full ptah-storefront-panel',
      );
      expect(panel?.textContent).toContain('Install Find Skills');
      expect(panel?.querySelector('legend')?.textContent?.trim()).toBe(
        'Install to',
      );
      expect(scopeRadio(fixture, 'workspace').checked).toBe(true);
      expect(
        host(fixture).querySelector('[data-testid="install-scope-help"]')
          ?.textContent,
      ).toContain('Only acme-app will get this skill.');
      expect(confirmButton(fixture)?.textContent?.trim()).toBe(
        'Install to this workspace',
      );
      expect(confirmButton(fixture)?.disabled).toBe(false);

      install.click();
      await settle(fixture);
      expect(host(fixture).querySelector('ptah-storefront-panel')).toBeNull();
    });

    it('installs for all workspaces only after the user picks All workspaces', async () => {
      const fixture = await mount([entry()]);
      responders.set('skillsSh:install', () =>
        ok({ success: true, scope: 'global' }),
      );
      responders.set('skillsSh:listInstalled', () =>
        ok({ skills: [installed('find-skills', 'global')] }),
      );
      button(cards(fixture)[0], 'Install Find Skills').click();
      await settle(fixture);

      scopeRadio(fixture, 'global').click();
      await settle(fixture);
      expect(confirmButton(fixture)?.textContent?.trim()).toBe(
        'Install to all workspaces',
      );
      calls = [];
      confirmButton(fixture)?.click();
      await settle(fixture);

      expect(calls[0]).toEqual({
        method: 'skillsSh:install',
        params: {
          source: 'vercel-labs/skills',
          skillId: 'find-skills',
          scope: 'global',
        },
      });
      expect(host(fixture).querySelector('ptah-storefront-panel')).toBeNull();
      expect(
        cards(fixture)[0]
          .querySelector('[data-testid="skill-scope-badge"]')
          ?.textContent?.trim(),
      ).toBe('All workspaces');
    });

    it('with no folder open selects nothing and keeps the install disabled', async () => {
      workspaceInfo.set(null);
      const fixture = await mount([entry()]);
      responders.set('skillsSh:install', () => ok({ success: true }));
      button(cards(fixture)[0], 'Install Find Skills').click();
      await settle(fixture);

      expect(scopeRadio(fixture, 'workspace').disabled).toBe(true);
      expect(scopeRadio(fixture, 'workspace').checked).toBe(false);
      expect(scopeRadio(fixture, 'global').checked).toBe(false);
      expect(confirmButton(fixture)?.disabled).toBe(true);
      expect(
        host(fixture).querySelector(
          '[data-testid="install-scope-help"][role="status"]',
        )?.textContent,
      ).toContain('Open a folder to install into a workspace');

      calls = [];
      confirmButton(fixture)?.click();
      await settle(fixture);
      expect(calls.map((c) => c.method)).not.toContain('skillsSh:install');

      scopeRadio(fixture, 'global').click();
      await settle(fixture);
      expect(confirmButton(fixture)?.disabled).toBe(false);
      expect(confirmButton(fixture)?.textContent?.trim()).toBe(
        'Install to all workspaces',
      );
    });

    it('sends no workspace install once the folder closes under an open panel', async () => {
      const fixture = await mount([entry()]);
      button(cards(fixture)[0], 'Install Find Skills').click();
      await settle(fixture);

      workspaceInfo.set(null);
      await settle(fixture);

      expect(confirmButton(fixture)?.disabled).toBe(true);
      calls = [];
      await fixture.componentInstance.installSkill(entry());
      expect(calls).toEqual([]);
    });

    it('shows a rolled-back install failure and keeps the panel open', async () => {
      const fixture = await mount([entry()]);
      const emitted: SkillShEntry[] = [];
      fixture.componentInstance.skillInstalled.subscribe((s) =>
        emitted.push(s),
      );
      responders.set('skillsSh:install', () =>
        ok({
          success: false,
          error: 'Could not install Find Skills. Nothing was changed.',
        }),
      );

      await installVia(fixture);
      await settle(fixture);

      expect(
        host(fixture).querySelector('[role="alert"]')?.textContent,
      ).toContain('Could not install Find Skills. Nothing was changed.');
      expect(host(fixture).querySelector('ptah-storefront-panel')).not.toBe(
        null,
      );
      expect(confirmButton(fixture)?.disabled).toBe(false);
      expect(emitted).toEqual([]);
      expect(
        cards(fixture)[0].querySelector('[data-testid="catalog-card-badge"]'),
      ).toBe(null);
    });

    it('opens the panel only under the grid whose card was pressed', async () => {
      const fixture = await mount([entry()], [], [entry()]);
      const [recommended] = cards(fixture);

      button(recommended, 'Install Find Skills').click();
      await settle(fixture);

      const panels = host(fixture).querySelectorAll('ptah-storefront-panel');
      expect(panels).toHaveLength(1);
      const grids = host(fixture).querySelectorAll('ptah-catalog-grid');
      expect(grids[0].contains(panels[0])).toBe(true);
    });
  });

  it('badges an installed card with its scope', async () => {
    const fixture = await mount(
      [entry(), entry({ skillId: 'remotion', name: 'Remotion' })],
      [],
    );
    responders.set('skillsSh:listInstalled', () =>
      ok({
        skills: [
          installed('find-skills', 'workspace'),
          installed('remotion', 'global'),
        ],
      }),
    );
    fixture.componentRef.setInput('refreshTrigger', 1);
    await settle(fixture);

    const badges = cards(fixture).map((card) =>
      card.querySelector('[data-testid="skill-scope-badge"]'),
    );
    expect(badges[0]?.textContent?.trim()).toBe('This workspace');
    expect(badges[0]?.classList.contains('border-warning')).toBe(false);
    expect(badges[1]?.textContent?.trim()).toBe('All workspaces');
    expect(badges[1]?.classList.contains('border-warning')).toBe(true);
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
