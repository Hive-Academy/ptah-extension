import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import type {
  ExternalInstallPlan,
  ExternalPluginListing,
} from '@ptah-extension/shared';
import { ExternalMarketplacesComponent } from './external-marketplaces.component';

/**
 * Minimal stand-in for the core `RpcResult` shape consumed by the surface:
 * `isSuccess()`, `.data`, `.error`. Mirrors the real class's truthiness rule
 * (success AND data !== undefined).
 */
function ok<T>(data: T) {
  return {
    success: true,
    data,
    error: undefined as string | undefined,
    isSuccess(): boolean {
      return data !== undefined;
    },
  };
}

function fail(error: string) {
  return {
    success: false,
    data: undefined,
    error,
    isSuccess(): boolean {
      return false;
    },
  };
}

interface RpcCall {
  method: string;
  params: unknown;
}

const SOURCE = 'dotnet/skills';
const PLUGIN_ID = 'external:dotnet/skills/dotnet-test';

function makeListing(
  overrides: Partial<ExternalPluginListing> = {},
): ExternalPluginListing {
  return {
    id: PLUGIN_ID,
    name: 'dotnet-test',
    description: 'Run and debug .NET tests',
    source: SOURCE,
    path: 'skills/dotnet-test',
    version: '1.2.0',
    installed: false,
    ...overrides,
  };
}

function makePlan(
  overrides: Partial<ExternalInstallPlan> = {},
): ExternalInstallPlan {
  return {
    pluginId: PLUGIN_ID,
    source: SOURCE,
    plugin: 'dotnet-test',
    displayName: '.NET Test',
    version: '1.2.0',
    skills: ['dotnet-test'],
    fileCount: 4,
    totalBytes: 1024,
    scriptFiles: [],
    skippedBinaryFiles: [],
    mcpServers: [],
    collisions: [],
    consentToken: 'token-v1',
    ...overrides,
  };
}

describe('ExternalMarketplacesComponent', () => {
  let fixture: ComponentFixture<ExternalMarketplacesComponent>;
  let component: ExternalMarketplacesComponent;
  let host: HTMLElement;
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
        return Promise.resolve(fail(`No responder for ${method}`));
      }
      return Promise.resolve(factory());
    }),
  };

  const methodsCalled = (): string[] => calls.map((c) => c.method);
  const installCalls = (): RpcCall[] =>
    calls.filter((c) => c.method === 'plugins:install-external');

  const settle = async (): Promise<void> => {
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const createComponent = async (): Promise<void> => {
    fixture = TestBed.createComponent(ExternalMarketplacesComponent);
    component = fixture.componentInstance;
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await settle();
  };

  /** Mount, then expand the one registered marketplace so plugin rows render. */
  const createAndBrowse = async (): Promise<void> => {
    await createComponent();
    await component.refreshBrowse(SOURCE);
    fixture.detectChanges();
  };

  const query = <T extends HTMLElement>(selector: string): T | null =>
    host.querySelector<T>(selector);

  beforeEach(() => {
    calls = [];
    responders = new Map();
    rpcMock.call.mockClear();

    setResponder('plugins:list-marketplaces', () =>
      ok({
        marketplaces: [
          {
            source: SOURCE,
            name: '.NET Agent Skills',
            pluginCount: 12,
            addedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        suggestions: [],
        installed: [],
      }),
    );

    TestBed.configureTestingModule({
      imports: [ExternalMarketplacesComponent],
      providers: [{ provide: ClaudeRpcService, useValue: rpcMock }],
    });
  });

  // ── Listing / suggestions ───────────────────────────────────────────────────

  describe('registered marketplaces', () => {
    it('loads marketplaces and suggestions on mount', async () => {
      setResponder('plugins:list-marketplaces', () =>
        ok({
          marketplaces: [
            {
              source: SOURCE,
              name: '.NET Agent Skills',
              pluginCount: 12,
              addedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
          suggestions: [
            {
              source: 'acme/plugins',
              name: 'Acme Plugins',
              description: 'Community pack',
            },
          ],
          installed: [],
        }),
      );
      await createComponent();

      expect(methodsCalled()).toContain('plugins:list-marketplaces');
      expect(component.marketplaces().length).toBe(1);
      expect(host.textContent).toContain('.NET Agent Skills');
      expect(host.textContent).toContain(SOURCE);
      expect(host.textContent).toContain('12');
      // Suggestions come from the backend, never hardcoded here.
      expect(host.textContent).toContain('Acme Plugins');
    });

    it('renders no suggestion chips when the backend offers none', async () => {
      await createComponent();

      expect(component.suggestions()).toEqual([]);
      expect(host.textContent).not.toContain('Suggested');
    });

    it('adds a suggestion in one click using its source', async () => {
      setResponder('plugins:list-marketplaces', () =>
        ok({
          marketplaces: [],
          suggestions: [
            {
              source: 'acme/plugins',
              name: 'Acme Plugins',
              description: 'Community pack',
            },
          ],
          installed: [],
        }),
      );
      setResponder('plugins:add-marketplace', () =>
        ok({
          marketplace: {
            source: 'acme/plugins',
            name: 'Acme Plugins',
            pluginCount: 3,
            addedAt: '2026-01-01T00:00:00.000Z',
          },
        }),
      );
      await createComponent();

      await component.addSuggestion({
        source: 'acme/plugins',
        name: 'Acme Plugins',
        description: 'Community pack',
      });

      const addCall = calls.find((c) => c.method === 'plugins:add-marketplace');
      expect(addCall?.params).toEqual({ source: 'acme/plugins' });
    });

    it('surfaces a list failure with a retry affordance', async () => {
      setResponder('plugins:list-marketplaces', () => fail('network down'));
      await createComponent();

      expect(component.loadError()).toBe('network down');
      expect(host.textContent).toContain('network down');
    });
  });

  // ── Add form validation ─────────────────────────────────────────────────────

  describe('add marketplace', () => {
    const typeSource = (value: string): void => {
      const input = query<HTMLInputElement>(
        '[data-testid="marketplace-source"]',
      );
      expect(input).toBeTruthy();
      if (!input) return;
      input.value = value;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };

    const addButton = (): HTMLButtonElement | null =>
      query<HTMLButtonElement>('[data-testid="marketplace-add"]');

    it('keeps Add disabled for input that is not owner/repo', async () => {
      await createComponent();

      // Empty is not yet valid.
      expect(addButton()?.disabled).toBe(true);

      for (const invalid of [
        'dotnet',
        'dotnet/',
        '/skills',
        'dotnet/skills/extra',
        'dotnet skills',
        'https://github.com/dotnet/skills',
        'dotnet/sk!lls',
      ]) {
        typeSource(invalid);
        expect(component.isSourceValid()).toBe(false);
        expect(addButton()?.disabled).toBe(true);
      }

      expect(methodsCalled()).not.toContain('plugins:add-marketplace');
    });

    it('enables Add for a well-formed owner/repo and sends it verbatim', async () => {
      setResponder('plugins:add-marketplace', () =>
        ok({
          marketplace: {
            source: SOURCE,
            name: '.NET Agent Skills',
            pluginCount: 12,
            addedAt: '2026-01-01T00:00:00.000Z',
          },
        }),
      );
      await createComponent();

      typeSource(SOURCE);
      expect(component.isSourceValid()).toBe(true);
      expect(addButton()?.disabled).toBe(false);

      await component.addMarketplace();
      await settle();

      const addCall = calls.find((c) => c.method === 'plugins:add-marketplace');
      expect(addCall?.params).toEqual({ source: SOURCE });
      // Cleared on success, and the list is re-read.
      expect(component.sourceInput()).toBe('');
      expect(
        calls.filter((c) => c.method === 'plugins:list-marketplaces').length,
      ).toBe(2);
    });

    it('shows the backend error and keeps the typed value on failure', async () => {
      setResponder('plugins:add-marketplace', () =>
        fail('no .claude-plugin/marketplace.json in dotnet/skills'),
      );
      await createComponent();

      typeSource(SOURCE);
      await component.addMarketplace();
      fixture.detectChanges();

      expect(component.addError()).toBe(
        'no .claude-plugin/marketplace.json in dotnet/skills',
      );
      expect(host.textContent).toContain('marketplace.json');
      expect(component.sourceInput()).toBe(SOURCE);
    });
  });

  // ── Remove ──────────────────────────────────────────────────────────────────

  describe('remove marketplace', () => {
    it('confirms first, states that installed plugins survive, then deregisters', async () => {
      setResponder('plugins:remove-marketplace', () => ok({ removed: true }));
      await createComponent();

      component.requestRemove(component.marketplaces()[0]);
      fixture.detectChanges();

      expect(host.textContent).toContain('NOT');
      expect(host.textContent).toContain('uninstalled');
      expect(methodsCalled()).not.toContain('plugins:remove-marketplace');

      await component.removeMarketplace(component.marketplaces()[0]);
      await settle();

      const removeCall = calls.find(
        (c) => c.method === 'plugins:remove-marketplace',
      );
      expect(removeCall?.params).toEqual({ source: SOURCE });
    });
  });

  // ── Browse ──────────────────────────────────────────────────────────────────

  describe('browse', () => {
    it('renders each listing under its verbatim plugin id testid', async () => {
      setResponder('plugins:browse-marketplace', () =>
        ok({
          marketplace: {
            source: SOURCE,
            name: '.NET Agent Skills',
            pluginCount: 1,
            addedAt: '2026-01-01T00:00:00.000Z',
          },
          plugins: [makeListing()],
          fromCache: false,
        }),
      );
      await createAndBrowse();

      const browseCall = calls.find(
        (c) => c.method === 'plugins:browse-marketplace',
      );
      expect(browseCall?.params).toEqual({ source: SOURCE });
      expect(
        query(`[data-testid="external-plugin-${PLUGIN_ID}"]`),
      ).toBeTruthy();
      expect(host.textContent).toContain('dotnet-test');
      expect(host.textContent).toContain('Run and debug .NET tests');
      expect(host.textContent).toContain('1.2.0');
    });

    it('shows an Installed state with an Uninstall action for installed plugins', async () => {
      setResponder('plugins:browse-marketplace', () =>
        ok({
          marketplace: {
            source: SOURCE,
            name: '.NET Agent Skills',
            pluginCount: 1,
            addedAt: '2026-01-01T00:00:00.000Z',
          },
          plugins: [
            makeListing({ installed: true, installedVersion: '1.1.0' }),
          ],
          fromCache: true,
        }),
      );
      setResponder('plugins:uninstall-external', () =>
        ok({ pluginId: PLUGIN_ID, removed: true }),
      );
      await createAndBrowse();

      expect(host.textContent).toContain('Installed');
      expect(host.textContent).toContain('Uninstall');
      // An advertised version newer than the installed one is called out.
      expect(host.textContent).toContain('1.2.0 available');

      await component.uninstall(component.listings()[0]);
      await settle();

      const uninstallCall = calls.find(
        (c) => c.method === 'plugins:uninstall-external',
      );
      expect(uninstallCall?.params).toEqual({ pluginId: PLUGIN_ID });
    });

    it('surfaces a browse failure in-view', async () => {
      setResponder('plugins:browse-marketplace', () => fail('upstream 404'));
      await createAndBrowse();

      expect(component.browseError()).toBe('upstream 404');
      expect(component.listings()).toEqual([]);
      expect(host.textContent).toContain('upstream 404');
    });
  });

  // ── The two-call install protocol ───────────────────────────────────────────

  describe('two-call install', () => {
    const browseOk = (plugins: ExternalPluginListing[]) =>
      ok({
        marketplace: {
          source: SOURCE,
          name: '.NET Agent Skills',
          pluginCount: plugins.length,
          addedAt: '2026-01-01T00:00:00.000Z',
        },
        plugins,
        fromCache: false,
      });

    beforeEach(() => {
      setResponder('plugins:browse-marketplace', () =>
        browseOk([makeListing()]),
      );
    });

    const clickInstall = async (): Promise<void> => {
      const button = query<HTMLButtonElement>(
        '[data-testid="external-install"]',
      );
      expect(button).toBeTruthy();
      button?.click();
      await settle();
    };

    const clickConfirm = async (): Promise<void> => {
      const button = query<HTMLButtonElement>(
        '[data-testid="external-consent-confirm"]',
      );
      expect(button).toBeTruthy();
      button?.click();
      await settle();
    };

    it('1. Install issues ONE call with no consentToken and installs nothing', async () => {
      setResponder('plugins:install-external', () =>
        ok({
          status: 'consent-required',
          reason: 'not-yet-approved',
          plan: makePlan(),
        }),
      );
      await createAndBrowse();

      await clickInstall();

      expect(installCalls().length).toBe(1);
      const params = installCalls()[0].params as Record<string, unknown>;
      expect(params).toEqual({ source: SOURCE, plugin: 'dotnet-test' });
      // The key is absent, not merely undefined — a tokenless call by contract.
      expect(Object.keys(params).sort()).toEqual(['plugin', 'source']);
      expect('consentToken' in params).toBe(false);

      // Nothing was installed: only a plan is held, and no report was produced.
      expect(component.pendingPlan()).not.toBeNull();
      expect(component.lastInstall()).toBeNull();
    });

    it('2. the consent dialog renders the plan mcpServers commandLine verbatim', async () => {
      const commandLine =
        'dotnet dnx Microsoft.AITools.BinlogMcp --yes --prerelease';
      setResponder('plugins:install-external', () =>
        ok({
          status: 'consent-required',
          reason: 'not-yet-approved',
          plan: makePlan({
            mcpServers: [
              {
                name: 'binlog',
                command: 'dotnet',
                args: [
                  'dnx',
                  'Microsoft.AITools.BinlogMcp',
                  '--yes',
                  '--prerelease',
                ],
                commandLine,
              },
            ],
          }),
        }),
      );
      await createAndBrowse();

      await clickInstall();

      const dialog = query('[data-testid="external-consent"]');
      expect(dialog).toBeTruthy();
      const codes = Array.from(dialog?.querySelectorAll('code') ?? []).map(
        (el) => el.textContent,
      );
      expect(codes).toContain(commandLine);
      expect(dialog?.textContent).toContain('NOT register or run');
    });

    it('3. Confirm issues a SECOND call carrying exactly the plan consentToken', async () => {
      setResponder('plugins:install-external', () => {
        // First (tokenless) call → plan. Second (token) call → installed.
        const isSecond = installCalls().length > 1;
        return isSecond
          ? ok({
              status: 'installed',
              result: {
                pluginId: PLUGIN_ID,
                displayName: '.NET Test',
                installedVersion: '1.2.0',
                filesWritten: 4,
                skippedBinaryFiles: ['assets/logo.png'],
                collisions: [
                  { skillName: 'dotnet-test', shadowedBy: 'ptah-core' },
                ],
              },
            })
          : ok({
              status: 'consent-required',
              reason: 'not-yet-approved',
              plan: makePlan(),
            });
      });
      setResponder('plugins:browse-marketplace', () =>
        browseOk([makeListing({ installed: true, installedVersion: '1.2.0' })]),
      );
      await createAndBrowse();

      await clickInstall();
      await clickConfirm();

      expect(installCalls().length).toBe(2);
      expect(installCalls()[1].params).toEqual({
        source: SOURCE,
        plugin: 'dotnet-test',
        consentToken: 'token-v1',
      });

      // Dialog closes and the browse list is re-read so `installed` is authoritative.
      expect(component.pendingPlan()).toBeNull();
      expect(query('[data-testid="external-consent"]')).toBeNull();
      expect(
        calls.filter((c) => c.method === 'plugins:browse-marketplace').length,
      ).toBe(2);
      expect(component.listings()[0].installed).toBe(true);

      // Post-install disclosures are reported, not swallowed.
      expect(host.textContent).toContain('assets/logo.png');
      expect(host.textContent).toContain('ptah-core');
    });

    it('4. Cancel issues NO second call and leaves nothing installed', async () => {
      setResponder('plugins:install-external', () =>
        ok({
          status: 'consent-required',
          reason: 'not-yet-approved',
          plan: makePlan(),
        }),
      );
      await createAndBrowse();

      await clickInstall();
      expect(installCalls().length).toBe(1);

      component.cancelInstall();
      fixture.detectChanges();

      expect(installCalls().length).toBe(1);
      expect(component.pendingPlan()).toBeNull();
      expect(component.lastInstall()).toBeNull();
      expect(query('[data-testid="external-consent"]')).toBeNull();
    });

    it('5. a stale token answered with consent-required re-renders the NEW plan', async () => {
      const v2Plan = makePlan({
        version: '2.0.0',
        consentToken: 'token-v2',
        skills: ['dotnet-test', 'dotnet-trace'],
      });
      setResponder('plugins:install-external', () => {
        const n = installCalls().length;
        if (n === 1) {
          return ok({
            status: 'consent-required',
            reason: 'not-yet-approved',
            plan: makePlan(),
          });
        }
        if (n === 2) {
          // A token WAS presented and did not validate — the backend reports
          // that as `approval-expired` whether the plan TTL lapsed, the host
          // restarted, or upstream content moved.
          return ok({
            status: 'consent-required',
            reason: 'approval-expired',
            plan: v2Plan,
          });
        }
        return ok({
          status: 'installed',
          result: {
            pluginId: PLUGIN_ID,
            displayName: '.NET Test',
            installedVersion: '2.0.0',
            filesWritten: 6,
            skippedBinaryFiles: [],
            collisions: [],
          },
        });
      });
      await createAndBrowse();

      await clickInstall();
      await clickConfirm();

      // Re-consent, not an exception and not a dismissal.
      expect(component.pendingPlan()?.consentToken).toBe('token-v2');
      expect(component.pendingPlan()?.version).toBe('2.0.0');
      const dialog = query('[data-testid="external-consent"]');
      expect(dialog).toBeTruthy();
      expect(dialog?.textContent).toContain('2.0.0');
      expect(dialog?.textContent).toContain('dotnet-trace');
      // The re-approval banner explains itself, and it does NOT claim upstream
      // changed: `approval-expired` covers a lapsed TTL, a host restart that
      // lost the pending plan, AND changed content, so the only honest copy is
      // that the earlier approval no longer counts.
      expect(component.pendingReason()).toBe('approval-expired');
      expect(dialog?.textContent).toContain('no longer valid');
      // Being asked again is the protocol working, not a failure — so nothing
      // renders in the error slot.
      expect(component.consentError()).toBeNull();
      expect(component.lastInstall()).toBeNull();

      // Confirming the fresh plan carries the NEW token, never the stale one.
      await clickConfirm();

      expect(installCalls().length).toBe(3);
      expect(installCalls()[2].params).toEqual({
        source: SOURCE,
        plugin: 'dotnet-test',
        consentToken: 'token-v2',
      });
      expect(component.pendingPlan()).toBeNull();
    });

    it('reports a failed authorized call inside the dialog without installing', async () => {
      setResponder('plugins:install-external', () => {
        const isSecond = installCalls().length > 1;
        return isSecond
          ? fail('consent token expired')
          : ok({
              status: 'consent-required',
              reason: 'not-yet-approved',
              plan: makePlan(),
            });
      });
      await createAndBrowse();

      await clickInstall();
      await clickConfirm();

      expect(component.consentError()).toBe('consent token expired');
      expect(component.pendingPlan()).not.toBeNull();
      expect(query('[data-testid="external-consent"]')).toBeTruthy();
      expect(component.lastInstall()).toBeNull();
    });

    it('surfaces a failed plan request on the row and opens no dialog', async () => {
      setResponder('plugins:install-external', () => fail('rate limited'));
      await createAndBrowse();

      await clickInstall();

      expect(component.pendingPlan()).toBeNull();
      expect(query('[data-testid="external-consent"]')).toBeNull();
      expect(component.browseError()).toBe('rate limited');
    });
  });
});
