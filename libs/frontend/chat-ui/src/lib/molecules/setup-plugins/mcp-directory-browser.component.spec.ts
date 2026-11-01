/**
 * McpDirectoryBrowserComponent — the MCP Registry discovery view.
 *
 * After plan C11 the view only browses and installs; the installed list and
 * its removal paths belong to the marketplace (their behaviour is covered by
 * `installed-mcp-groups.spec.ts` and the marketplace removal specs). Axes:
 *
 *   - **No tab strip, no Installed view.** Nothing here removes a server.
 *   - **Results are catalog cards** inside `ptah-catalog-grid`, each a list
 *     item, with the "Installed" badge from the view's own `listInstalled`.
 *   - **A listing's name never earns a vendor mark**: only an allowlisted
 *     namespace or a catalogue URL does; everything else is a monogram.
 *   - **The install path**: one `mcpDirectory:install` call from a storefront
 *     panel under the card, now carrying the chosen `scope`.
 *   - **Install scope (design-spec §2, decision #15)**: the shared scope field
 *     sits above the targets; This workspace (default) checks the four
 *     project-file targets and disables the three home targets with a
 *     "Global only" badge; an explicit All workspaces checks all seven; each
 *     home target remembers its choice across switches; with no folder open
 *     nothing is selected and the install stays disabled.
 *
 * `AppStateManager` is a stub whose writable `workspaceInfo` is the open
 * folder (`null` = none).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AppStateManager, ClaudeRpcService } from '@ptah-extension/core';
import {
  MCP_DIRECTORY_CALL_FAILURE_COPY,
  MCP_INSTALL_RESULT_COPY,
  type InstalledMcpServer,
  type McpInstallTarget,
  type McpRegistryEntry,
  type WorkspaceInfo,
} from '@ptah-extension/shared';
import {
  MCP_INSTALL_DEFERRED_NOTICE,
  McpDirectoryBrowserComponent,
} from './mcp-directory-browser.component';

/**
 * Minimal stand-in for the core `RpcResult` shape: `isSuccess()`, `.data`,
 * `.error`. Mirrors the real class's truthiness rule (success AND data !==
 * undefined) — same idiom as `plugin-catalog-panel.component.spec.ts`.
 */
function ok<T>(data: T) {
  return {
    success: true,
    data,
    error: undefined as string | undefined,
    isSuccess: (): boolean => data !== undefined,
  };
}

/**
 * A refused call: not a thrown error, just a result that is not a success.
 * `errorCode` marks a deliberate `RpcUserError` (fixed host copy); without it
 * the text is a host exception's.
 */
function fail(error: string, errorCode?: string) {
  return {
    success: false,
    data: undefined,
    error,
    errorCode,
    isSuccess: (): boolean => false,
  };
}

function entry(over: Partial<McpRegistryEntry> = {}): McpRegistryEntry {
  return {
    name: 'io.github.acme/weather',
    description: 'Forecasts for any city',
    repository: { url: 'https://github.com/acme/weather', id: 'acme/weather' },
    version_detail: {
      version: '1.2.0',
      packages: [{ registry_name: 'npm', name: '@acme/weather-mcp' }],
      transports: [{ type: 'stdio' }],
    },
    ...over,
  };
}

function installed(serverKey: string): InstalledMcpServer {
  return {
    serverKey,
    target: 'claude',
    configPath: 'C:\\Users\\dev\\.mcp.json',
    config: { type: 'stdio', command: 'npx', args: ['-y', serverKey] },
    managedByPtah: true,
    origin: 'harness-config',
    removal: 'ptah-managed',
    originLabel: 'Harness config',
  };
}

interface RpcCall {
  method: string;
  params: unknown;
}

const WORKSPACE: WorkspaceInfo = {
  name: 'acme-app',
  path: '/home/dev/acme-app',
  type: 'workspace',
};

const WORKSPACE_TARGETS: McpInstallTarget[] = [
  'vscode',
  'claude',
  'cursor',
  'opencode',
];

const ALL_SEVEN: McpInstallTarget[] = [
  'vscode',
  'claude',
  'cursor',
  'copilot',
  'codex',
  'antigravity',
  'opencode',
];

describe('mcp directory browser — registry discovery', () => {
  let calls: RpcCall[];
  let responders: Map<string, () => unknown>;
  let workspaceInfo: ReturnType<typeof signal<WorkspaceInfo | null>>;

  const setResponder = (method: string, factory: () => unknown): void => {
    responders.set(method, factory);
  };

  const rpcMock = {
    call: jest.fn((method: string, params: unknown) => {
      calls.push({ method, params });
      const factory = responders.get(method);
      if (!factory) {
        return Promise.resolve(ok(undefined));
      }
      return Promise.resolve(factory());
    }),
  };

  /** Drain the ngOnInit loads and render the result. */
  const settle = async (fixture: ComponentFixture<unknown>): Promise<void> => {
    fixture.detectChanges();
    for (let pass = 0; pass < 3; pass += 1) {
      await fixture.whenStable();
      fixture.detectChanges();
    }
  };

  /** Mount with `popular` as the registry's popular list. */
  const mount = async (
    popular: McpRegistryEntry[],
    installedServers: InstalledMcpServer[] = [],
  ): Promise<ComponentFixture<McpDirectoryBrowserComponent>> => {
    setResponder('mcpDirectory:getPopular', () => ok({ servers: popular }));
    setResponder('mcpDirectory:listInstalled', () =>
      ok({ servers: installedServers }),
    );
    const fixture = TestBed.createComponent(McpDirectoryBrowserComponent);
    await settle(fixture);
    return fixture;
  };

  const host = (fixture: ComponentFixture<unknown>): HTMLElement =>
    fixture.nativeElement as HTMLElement;

  const cards = (fixture: ComponentFixture<unknown>): HTMLElement[] =>
    Array.from(host(fixture).querySelectorAll('ptah-catalog-card'));

  const errorText = (fixture: ComponentFixture<unknown>): string =>
    host(fixture)
      .querySelector('[data-testid="mcp-error"]')
      ?.textContent?.trim() ?? '';

  const clickInstall = async (
    fixture: ComponentFixture<unknown>,
    index = 0,
  ): Promise<void> => {
    const card = cards(fixture)[index];
    card?.querySelector<HTMLButtonElement>('[card-actions] button')?.click();
    await settle(fixture);
  };

  const clickConfirm = async (
    fixture: ComponentFixture<unknown>,
  ): Promise<void> => {
    host(fixture)
      .querySelector<HTMLButtonElement>(
        'ptah-storefront-panel [panel-footer] button',
      )
      ?.click();
    await settle(fixture);
  };

  const installCalls = (): RpcCall[] =>
    calls.filter((c) => c.method === 'mcpDirectory:install');

  beforeEach(() => {
    calls = [];
    responders = new Map();
    rpcMock.call.mockClear();
    workspaceInfo = signal<WorkspaceInfo | null>(WORKSPACE);
    TestBed.configureTestingModule({
      providers: [
        { provide: ClaudeRpcService, useValue: rpcMock },
        {
          provide: AppStateManager,
          useValue: { workspaceInfo: workspaceInfo.asReadonly() },
        },
      ],
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  it('renders no tab strip and no Installed view', async () => {
    const fixture = await mount([entry()], [installed('weather')]);

    expect(host(fixture).querySelector('.tabs, [role="tab"]')).toBeNull();
    expect(
      host(fixture).querySelector('[data-testid="installed-row"]'),
    ).toBeNull();
    expect(host(fixture).textContent).not.toMatch(/Installed \(\d+\)/);
  });

  it('renders each result as a catalog card list item inside the catalog grid', async () => {
    const fixture = await mount([
      entry(),
      entry({ name: 'io.github.acme/tides', repository: undefined }),
    ]);

    const grid = host(fixture).querySelector('ptah-catalog-grid');
    expect(grid).not.toBeNull();
    expect(cards(fixture)).toHaveLength(2);
    for (const card of cards(fixture)) {
      expect(card.closest('ptah-catalog-grid')).toBe(grid);
      expect(card.getAttribute('role')).toBe('listitem');
    }

    const first = cards(fixture)[0];
    expect(
      first.querySelector('[data-testid="catalog-card"] h3')?.textContent,
    ).toContain('weather');
    expect(
      first.querySelector('[data-testid="catalog-card-meta"]')?.textContent,
    ).toContain('v1.2.0 · stdio · acme/weather');
  });

  it('shows card-shaped skeletons inside the grid while the popular list loads', async () => {
    setResponder('mcpDirectory:getPopular', () => new Promise(() => undefined));
    const fixture = TestBed.createComponent(McpDirectoryBrowserComponent);
    fixture.detectChanges();

    const skeletons = host(fixture).querySelectorAll(
      'ptah-catalog-grid ptah-catalog-card-skeleton[role="listitem"]',
    );
    expect(skeletons.length).toBeGreaterThan(0);
    expect(cards(fixture)).toHaveLength(0);
  });

  it('badges a result as Installed from its own listInstalled read', async () => {
    const fixture = await mount(
      [entry(), entry({ name: 'io.github.acme/tides' })],
      [installed('weather')],
    );

    const badges = cards(fixture).map(
      (card) =>
        card
          .querySelector('[data-testid="catalog-card-badge"]')
          ?.textContent?.trim() ?? null,
    );
    expect(badges).toEqual(['Installed', null]);
    expect(calls.some((c) => c.method === 'mcpDirectory:listInstalled')).toBe(
      true,
    );
  });

  it('shows the coded copy when the installed list could not be read', async () => {
    setResponder('mcpDirectory:getPopular', () => ok({ servers: [entry()] }));
    setResponder('mcpDirectory:listInstalled', () =>
      ok({
        servers: [],
        code: 'intent-unreadable',
        error: MCP_DIRECTORY_CALL_FAILURE_COPY['intent-unreadable'],
      }),
    );
    const fixture = TestBed.createComponent(McpDirectoryBrowserComponent);
    await settle(fixture);

    expect(errorText(fixture)).toBe(
      MCP_DIRECTORY_CALL_FAILURE_COPY['intent-unreadable'],
    );
  });

  it('gives a vendor mark only to an allowlisted namespace, a monogram otherwise', async () => {
    const fixture = await mount([
      entry({ name: 'io.github.getsentry/sentry' }),
      entry({ name: 'attacker/github' }),
    ]);

    const [sentry, lookalike] = cards(fixture);
    expect(sentry.querySelector('[card-mark] ptah-brand-mark')).not.toBeNull();
    expect(lookalike.querySelector('ptah-brand-mark')).toBeNull();
    expect(
      lookalike.querySelector('ptah-monogram-tile[card-mark]'),
    ).not.toBeNull();
  });

  it('installs from the storefront panel into this workspace by default', async () => {
    const fixture = await mount([entry()]);
    const emitted: unknown[] = [];
    fixture.componentInstance.serverInstalled.subscribe((e) => emitted.push(e));
    setResponder('mcpDirectory:install', () =>
      ok({
        results: [
          {
            target: 'claude',
            success: true,
            configPath: 'C:\\Users\\dev\\.mcp.json',
          },
        ],
      }),
    );

    await clickInstall(fixture);

    const panel = host(fixture).querySelector('ptah-storefront-panel');
    expect(panel).not.toBeNull();
    const row = panel?.closest('[role="listitem"]');
    expect(row?.classList.contains('col-span-full')).toBe(true);
    expect(row?.closest('ptah-catalog-grid')).not.toBeNull();

    const listInstalledBefore = calls.filter(
      (c) => c.method === 'mcpDirectory:listInstalled',
    ).length;
    await clickConfirm(fixture);

    expect(installCalls()).toHaveLength(1);
    expect(installCalls()[0].params).toEqual({
      serverName: 'io.github.acme/weather',
      serverKey: 'weather',
      config: {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@acme/weather-mcp'],
      },
      targets: WORKSPACE_TARGETS,
      scope: 'workspace',
    });
    expect(emitted).toEqual([
      { serverName: 'io.github.acme/weather', targets: ['claude'] },
    ]);
    expect(
      calls.filter((c) => c.method === 'mcpDirectory:listInstalled').length,
    ).toBe(listInstalledBefore + 1);
    expect(host(fixture).querySelector('ptah-storefront-panel')).toBeNull();
  });

  it('fetches details before installing a result that carries none', async () => {
    const bare = entry({ version_detail: undefined });
    setResponder('mcpDirectory:getDetails', () => ok(entry()));
    const fixture = await mount([bare]);

    await clickInstall(fixture);

    const details = calls.filter((c) => c.method === 'mcpDirectory:getDetails');
    expect(details).toHaveLength(1);
    expect(details[0].params).toEqual({ name: 'io.github.acme/weather' });
    expect(
      host(fixture).querySelector(
        'ptah-storefront-panel [panel-footer] button',
      ),
    ).not.toBeNull();
  });

  it('reports the reason when the backend deliberately refuses an install', async () => {
    const fixture = await mount([entry()]);
    setResponder('mcpDirectory:install', () =>
      fail('workspace policy blocks new servers', 'INVALID_PARAMS'),
    );

    await clickInstall(fixture);
    await clickConfirm(fixture);

    expect(errorText(fixture)).toContain('workspace policy blocks new servers');
  });

  describe('host error text never reaches the alert (Phase D review L6)', () => {
    const SECRET = 'SECRET-SENTINEL-sk-live-9876';

    it('renders fixed per-code copy, not a result error string', async () => {
      const fixture = await mount([entry()]);
      setResponder('mcpDirectory:install', () =>
        ok({
          results: [
            {
              target: 'claude',
              success: false,
              configPath: '',
              code: 'reconcile-failed',
              error: `EACCES /home/dev/.mcp.json ${SECRET}`,
            },
            {
              target: 'cursor',
              success: false,
              configPath: '',
              error: `raw ${SECRET}`,
            },
          ],
        }),
      );

      await clickInstall(fixture);
      await clickConfirm(fixture);

      const text = errorText(fixture);
      expect(text).not.toContain(SECRET);
      expect(text).toContain(MCP_INSTALL_RESULT_COPY['reconcile-failed']);
      expect(text).toContain(MCP_INSTALL_RESULT_COPY['install-failed']);
      expect(host(fixture).textContent).not.toContain(SECRET);
    });

    it('renders fixed copy for an RPC error that is not a deliberate refusal', async () => {
      const fixture = await mount([entry()]);
      setResponder('mcpDirectory:install', () =>
        fail(`TypeError at /opt/app/main.js token=${SECRET}`),
      );

      await clickInstall(fixture);
      await clickConfirm(fixture);

      expect(errorText(fixture)).toBe(
        'Could not install "io.github.acme/weather".',
      );
      expect(host(fixture).textContent).not.toContain(SECRET);
    });
  });

  describe('install scope', () => {
    const panel = (fixture: ComponentFixture<unknown>): HTMLElement =>
      host(fixture).querySelector<HTMLElement>('ptah-storefront-panel')!;

    const scopeRadio = (
      fixture: ComponentFixture<unknown>,
      label: 'This workspace' | 'All workspaces',
    ): HTMLInputElement =>
      Array.from(
        panel(fixture).querySelectorAll<HTMLInputElement>(
          'ptah-install-scope-field input[type=radio]',
        ),
      ).find((radio) => radio.closest('label')?.textContent?.trim() === label)!;

    const targetBoxes = (
      fixture: ComponentFixture<unknown>,
    ): Map<string, HTMLInputElement> =>
      new Map(
        Array.from(
          panel(fixture).querySelectorAll<HTMLInputElement>(
            'input[type=checkbox]',
          ),
        ).map((box) => [
          box.closest('label')?.querySelector('span')?.textContent?.trim() ??
            '',
          box,
        ]),
      );

    const checkedLabels = (fixture: ComponentFixture<unknown>): string[] =>
      Array.from(targetBoxes(fixture))
        .filter(([, box]) => box.checked)
        .map(([label]) => label);

    const confirmButton = (
      fixture: ComponentFixture<unknown>,
    ): HTMLButtonElement =>
      panel(fixture).querySelector<HTMLButtonElement>('[panel-footer] button')!;

    const choose = async (
      fixture: ComponentFixture<unknown>,
      label: 'This workspace' | 'All workspaces',
    ): Promise<void> => {
      scopeRadio(fixture, label).click();
      await settle(fixture);
    };

    const toggle = async (
      fixture: ComponentFixture<unknown>,
      label: string,
    ): Promise<void> => {
      targetBoxes(fixture).get(label)?.click();
      await settle(fixture);
    };

    const installOk = (): void =>
      setResponder('mcpDirectory:install', () =>
        ok({
          results: [
            { target: 'claude', success: true, configPath: '.mcp.json' },
          ],
        }),
      );

    it('puts the scope field above the targets fieldset', async () => {
      const fixture = await mount([entry()]);
      await clickInstall(fixture);

      const fieldsets = Array.from(
        panel(fixture).querySelectorAll('fieldset'),
      ).map((set) => set.querySelector('legend')?.textContent?.trim());
      expect(fieldsets).toEqual(['Install for', 'Install to']);
      expect(scopeRadio(fixture, 'This workspace').checked).toBe(true);
    });

    it('This workspace checks the workspace targets and locks the home targets as Global only', async () => {
      const fixture = await mount([entry()]);
      await clickInstall(fixture);

      expect(checkedLabels(fixture)).toEqual([
        'VS Code',
        'Claude Code',
        'Cursor',
        'OpenCode',
      ]);
      for (const label of ['Copilot CLI', 'Codex CLI', 'Antigravity CLI']) {
        const box = targetBoxes(fixture).get(label)!;
        expect(box.disabled).toBe(true);
        expect(box.checked).toBe(false);
        expect(box.closest('label')?.textContent).toContain('Global only');
      }
      expect(
        targetBoxes(fixture).get('Cursor')?.closest('label')?.textContent,
      ).not.toContain('Global only');
      expect(confirmButton(fixture).textContent).toContain('Install to 4');
    });

    it('an explicit All workspaces keeps the seven-target preselection and sends scope global', async () => {
      const fixture = await mount([entry()]);
      installOk();
      await clickInstall(fixture);

      await choose(fixture, 'All workspaces');
      expect(checkedLabels(fixture)).toHaveLength(7);
      expect(
        Array.from(targetBoxes(fixture).values()).some((box) => box.disabled),
      ).toBe(false);
      expect(panel(fixture).textContent).not.toContain('Global only');

      await clickConfirm(fixture);
      expect(installCalls()[0].params).toMatchObject({
        targets: ALL_SEVEN,
        scope: 'global',
      });
    });

    it('remembers each home target and the workspace choices across scope switches', async () => {
      const fixture = await mount([entry()]);
      installOk();
      await clickInstall(fixture);

      await toggle(fixture, 'Cursor');
      await choose(fixture, 'All workspaces');
      await toggle(fixture, 'Codex CLI');
      await choose(fixture, 'This workspace');

      expect(checkedLabels(fixture)).toEqual([
        'VS Code',
        'Claude Code',
        'OpenCode',
      ]);

      await choose(fixture, 'All workspaces');
      expect(checkedLabels(fixture)).toEqual([
        'VS Code',
        'Claude Code',
        'Copilot CLI',
        'Antigravity CLI',
        'OpenCode',
      ]);

      await clickConfirm(fixture);
      expect(installCalls()[0].params).toMatchObject({
        targets: ['vscode', 'claude', 'copilot', 'antigravity', 'opencode'],
        scope: 'global',
      });
    });

    it('with no folder open: nothing is selected and install stays disabled until All workspaces', async () => {
      workspaceInfo.set(null);
      const fixture = await mount([entry()]);
      installOk();
      await clickInstall(fixture);

      expect(scopeRadio(fixture, 'This workspace').disabled).toBe(true);
      expect(scopeRadio(fixture, 'This workspace').checked).toBe(false);
      expect(scopeRadio(fixture, 'All workspaces').checked).toBe(false);
      expect(
        panel(fixture).querySelector('[role="status"]')?.textContent,
      ).toContain('Open a folder to install into a workspace');
      expect(confirmButton(fixture).disabled).toBe(true);

      await clickConfirm(fixture);
      expect(installCalls()).toHaveLength(0);

      await choose(fixture, 'All workspaces');
      expect(confirmButton(fixture).disabled).toBe(false);
      await clickConfirm(fixture);
      expect(installCalls()[0].params).toMatchObject({
        targets: ALL_SEVEN,
        scope: 'global',
      });
    });

    it('with no folder open, a deferred global install shows the saved notice, not a failure', async () => {
      workspaceInfo.set(null);
      const fixture = await mount([entry()]);
      setResponder('mcpDirectory:install', () =>
        ok({
          scope: 'global',
          results: ['claude', 'codex'].map((target) => ({
            target,
            success: false,
            configPath: '',
            deferred: true,
            code: 'deferred-no-workspace',
            error: MCP_INSTALL_RESULT_COPY['deferred-no-workspace'],
          })),
        }),
      );
      await clickInstall(fixture);
      await choose(fixture, 'All workspaces');
      await clickConfirm(fixture);

      const notice = host(fixture).querySelector('[data-testid="mcp-notice"]');
      expect(notice?.textContent?.trim()).toBe(MCP_INSTALL_DEFERRED_NOTICE);
      expect(notice?.closest('[role="status"]')).not.toBeNull();
      expect(errorText(fixture)).toBe('');
      expect(host(fixture).querySelector('ptah-storefront-panel')).toBeNull();
    });

    it('drops a remembered workspace choice when the folder closes mid-panel', async () => {
      const fixture = await mount([entry()]);
      await clickInstall(fixture);
      expect(confirmButton(fixture).disabled).toBe(false);

      workspaceInfo.set(null);
      await settle(fixture);

      expect(scopeRadio(fixture, 'This workspace').checked).toBe(false);
      expect(confirmButton(fixture).disabled).toBe(true);
    });
  });

  it('does not use innerHTML in the component source', () => {
    const source = readFileSync(
      join(__dirname, 'mcp-directory-browser.component.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/innerHTML/i);
  });
});
