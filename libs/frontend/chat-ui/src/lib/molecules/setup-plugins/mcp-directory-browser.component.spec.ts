/**
 * McpDirectoryBrowserComponent — the Installed tab's removal surface.
 *
 * Four axes, all of them regressions the previous version could not see:
 *
 *   - **A refused removal is reported.** `uninstallServer` read the RPC result
 *     with a bare `if (result.isSuccess())` and had no `else`, so a refusal
 *     cleared the spinner, reloaded an identical list, and told the user
 *     nothing at all. That was the reported bug.
 *   - **A `removal: 'none'` row offers no button.** Every row used to get a
 *     Remove button, including the ones no removal path can act on.
 *   - **A `removal: 'direct'` row asks first.** Ptah did not write that config
 *     entry, so the first click names the file and the SECOND one is what
 *     calls through with `force: true`.
 *   - **Two origins sharing one key stay two rows.** Grouping keyed on
 *     `serverKey` alone collapsed a disk install and a session connector onto
 *     one row with one button that acted on the wrong one.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import type { InstalledMcpServer } from '@ptah-extension/shared';
import { McpDirectoryBrowserComponent } from './mcp-directory-browser.component';

/**
 * Minimal stand-in for the core `RpcResult` shape: `isSuccess()`, `.data`,
 * `.error`. Mirrors the real class's truthiness rule (success AND data !==
 * undefined) — same idiom as `plugin-browser-modal.component.spec.ts`.
 */
function ok<T>(data: T) {
  return {
    success: true,
    data,
    error: undefined as string | undefined,
    isSuccess: (): boolean => data !== undefined,
  };
}

/** A refused call: not a thrown error, just a result that is not a success. */
function fail(error: string) {
  return {
    success: false,
    data: undefined,
    error,
    isSuccess: (): boolean => false,
  };
}

function server(over: Partial<InstalledMcpServer> = {}): InstalledMcpServer {
  return {
    serverKey: 'github',
    target: 'claude',
    configPath: 'C:\\Users\\dev\\.mcp.json',
    config: { type: 'stdio', command: 'npx', args: ['-y', 'github-mcp'] },
    managedByPtah: true,
    origin: 'harness-config',
    removal: 'ptah-managed',
    originLabel: 'Harness config',
    ...over,
  };
}

interface RpcCall {
  method: string;
  params: unknown;
}

describe('mcp directory browser — installed removal', () => {
  let calls: RpcCall[];
  let responders: Map<string, () => unknown>;

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

  /** Mount with `servers` installed, already switched to the Installed tab. */
  const mountInstalled = async (
    servers: InstalledMcpServer[],
    connectors: InstalledMcpServer[] = [],
  ): Promise<ComponentFixture<McpDirectoryBrowserComponent>> => {
    setResponder('mcpDirectory:listInstalled', () => ok({ servers }));
    const fixture = TestBed.createComponent(McpDirectoryBrowserComponent);
    fixture.componentRef.setInput('connectorServers', connectors);
    await settle(fixture);
    fixture.componentInstance.activeView.set('installed');
    fixture.detectChanges();
    return fixture;
  };

  const host = (fixture: ComponentFixture<unknown>): HTMLElement =>
    fixture.nativeElement as HTMLElement;

  const rows = (fixture: ComponentFixture<unknown>): HTMLElement[] =>
    Array.from(host(fixture).querySelectorAll('[data-testid="installed-row"]'));

  const clickRemove = async (
    fixture: ComponentFixture<unknown>,
    index = 0,
  ): Promise<void> => {
    const row = rows(fixture)[index];
    row
      ?.querySelector<HTMLButtonElement>('[data-testid="remove-button"]')
      ?.click();
    await settle(fixture);
  };

  const errorText = (fixture: ComponentFixture<unknown>): string =>
    host(fixture)
      .querySelector('[data-testid="mcp-error"]')
      ?.textContent?.trim() ?? '';

  const uninstallCalls = (): RpcCall[] =>
    calls.filter((c) => c.method === 'mcpDirectory:uninstall');

  beforeEach(() => {
    calls = [];
    responders = new Map();
    rpcMock.call.mockClear();
    // The Browse tab loads on init and is irrelevant to every test here.
    setResponder('mcpDirectory:getPopular', () => ok({ servers: [] }));
    setResponder('mcpDirectory:listInstalled', () => ok({ servers: [] }));
    TestBed.configureTestingModule({
      providers: [{ provide: ClaudeRpcService, useValue: rpcMock }],
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  it('reports the reason when the backend refuses a removal', async () => {
    const fixture = await mountInstalled([server()]);
    setResponder('mcpDirectory:uninstall', () =>
      fail('github is pinned by a workspace policy'),
    );

    await clickRemove(fixture);

    expect(errorText(fixture)).toContain(
      'github is pinned by a workspace policy',
    );
  });

  it('reports per-target failures even when the call itself succeeded', async () => {
    const fixture = await mountInstalled([server()]);
    setResponder('mcpDirectory:uninstall', () =>
      ok({
        results: [
          {
            target: 'claude',
            success: false,
            configPath: 'C:\\Users\\dev\\.mcp.json',
            error: 'file is read-only',
          },
        ],
      }),
    );

    await clickRemove(fixture);

    expect(errorText(fixture)).toContain('file is read-only');
  });

  it('offers no Remove button for a row nothing can act on, and explains why', async () => {
    const fixture = await mountInstalled([
      server({
        serverKey: 'notion',
        origin: 'claude-connector',
        originLabel: 'claude.ai connector',
        removal: 'none',
        removalBlockedReason: 'Manage this connector at claude.ai/settings.',
        target: undefined,
      }),
    ]);

    const row = rows(fixture)[0];
    expect(row.querySelector('[data-testid="remove-button"]')).toBeNull();
    expect(
      row.querySelector('[data-testid="removal-blocked"]')?.textContent,
    ).toContain('Manage this connector at claude.ai/settings.');
  });

  it('asks for confirmation naming the config file before forcing a direct removal', async () => {
    const fixture = await mountInstalled([
      server({
        serverKey: 'local-tool',
        origin: 'claude-user',
        originLabel: '~/.claude.json',
        removal: 'direct',
        managedByPtah: false,
        configPath: 'C:\\Users\\dev\\.claude.json',
      }),
    ]);
    setResponder('mcpDirectory:uninstall', () =>
      ok({
        results: [
          {
            target: 'claude',
            success: true,
            configPath: 'C:\\Users\\dev\\.claude.json',
          },
        ],
      }),
    );

    // First click arms the confirm step and calls nothing.
    await clickRemove(fixture);
    expect(uninstallCalls()).toHaveLength(0);
    const confirm = rows(fixture)[0].querySelector(
      '[data-testid="remove-confirm"]',
    );
    expect(confirm).not.toBeNull();
    expect(
      confirm?.querySelector('[data-testid="confirm-config-path"]')
        ?.textContent,
    ).toContain('.claude.json');

    // Second click is the one that goes through, and it forces.
    rows(fixture)[0]
      .querySelector<HTMLButtonElement>('[data-testid="confirm-remove"]')
      ?.click();
    await settle(fixture);

    expect(uninstallCalls()).toHaveLength(1);
    expect(uninstallCalls()[0].params).toMatchObject({
      serverKey: 'local-tool',
      force: true,
    });
  });

  it('does not force a ptah-managed removal, and needs no confirmation', async () => {
    const fixture = await mountInstalled([server()]);
    setResponder('mcpDirectory:uninstall', () =>
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

    await clickRemove(fixture);

    expect(uninstallCalls()).toHaveLength(1);
    expect(uninstallCalls()[0].params).not.toHaveProperty('force');
    expect(errorText(fixture)).toBe('');
  });

  it('routes a smithery row to uninstallSmithery and surfaces its refusal', async () => {
    const fixture = await mountInstalled([
      server({
        serverKey: 'exa',
        origin: 'smithery',
        originLabel: 'Smithery',
        removal: 'smithery',
        target: undefined,
      }),
    ]);
    setResponder('mcpDirectory:uninstallSmithery', () =>
      ok({ success: false, error: 'Smithery session expired' }),
    );

    await clickRemove(fixture);

    expect(
      calls.some((c) => c.method === 'mcpDirectory:uninstallSmithery'),
    ).toBe(true);
    expect(uninstallCalls()).toHaveLength(0);
    expect(errorText(fixture)).toContain('Smithery session expired');
  });

  it('routes an oauth row to disconnectOAuth', async () => {
    const fixture = await mountInstalled([
      server({
        serverKey: 'linear',
        origin: 'oauth',
        originLabel: 'Connected app',
        removal: 'oauth',
        target: undefined,
      }),
    ]);
    setResponder('mcpDirectory:disconnectOAuth', () => ok({ success: true }));

    await clickRemove(fixture);

    const disconnect = calls.filter(
      (c) => c.method === 'mcpDirectory:disconnectOAuth',
    );
    expect(disconnect).toHaveLength(1);
    expect(disconnect[0].params).toEqual({ serverKey: 'linear' });
  });

  it('keeps two origins sharing one server key as two separate rows', async () => {
    const fixture = await mountInstalled(
      [server({ serverKey: 'github', origin: 'harness-config' })],
      [
        server({
          serverKey: 'github',
          origin: 'claude-connector',
          originLabel: 'claude.ai connector',
          removal: 'none',
          removalBlockedReason: 'Manage this connector at claude.ai/settings.',
          target: undefined,
        }),
      ],
    );

    expect(rows(fixture)).toHaveLength(2);
    expect(fixture.componentInstance.installedCount()).toBe(2);
    // Only the harness-config row is actionable; the connector row is labelled.
    expect(
      host(fixture).querySelectorAll('[data-testid="remove-button"]'),
    ).toHaveLength(1);
    expect(
      host(fixture).querySelector('[data-testid="origin-label"]')?.textContent,
    ).toContain('claude.ai connector');
  });
});
