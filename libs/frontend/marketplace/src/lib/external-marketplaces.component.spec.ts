import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AppStateManager, ClaudeRpcService } from '@ptah-extension/core';
import type {
  ExternalInstallPlan,
  ExternalInstallResult,
  ExternalLocalItem,
  ExternalPluginListing,
  KeptItem,
  WorkspaceInfo,
} from '@ptah-extension/shared';
import { makeLibraryAgreementFixtures } from '@ptah-extension/shared/testing';
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

  /** The open folder the consent dialog's MCP scope field reads. */
  const workspaceInfo = signal<WorkspaceInfo | null>(null);

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
    workspaceInfo.set({ name: 'my-app', path: '/work/my-app', type: 'folder' });
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
      providers: [
        { provide: ClaudeRpcService, useValue: rpcMock },
        { provide: AppStateManager, useValue: { workspaceInfo } },
      ],
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
      const text = (dialog?.textContent ?? '').replace(/\s+/g, ' ');
      expect(text).not.toContain('NOT register or run');
      expect(text).toContain(
        'Ptah adds these servers to the scope you choose below. Review each command before you continue.',
      );
    });

    describe('MCP server scope on the consented call', () => {
      const servers = [
        {
          name: 'binlog',
          command: 'dotnet',
          args: ['dnx'],
          commandLine: 'dotnet dnx',
        },
      ];
      const withServers = (): void =>
        setResponder('plugins:install-external', () =>
          installCalls().length > 1
            ? ok({
                status: 'installed',
                result: {
                  pluginId: PLUGIN_ID,
                  displayName: '.NET Test',
                  installedVersion: '1.2.0',
                  filesWritten: 1,
                  skippedBinaryFiles: [],
                  collisions: [],
                },
              })
            : ok({
                status: 'consent-required',
                reason: 'not-yet-approved',
                plan: makePlan({ mcpServers: servers }),
              }),
        );
      const pickAllWorkspaces = (): void => {
        Array.from(
          query('[data-testid="external-consent-mcp-scope"]')?.querySelectorAll(
            'label',
          ) ?? [],
        )
          .find((el) => el.textContent?.includes('All workspaces'))
          ?.querySelector<HTMLInputElement>('input[type="radio"]')
          ?.click();
        fixture.detectChanges();
      };

      it('sends the default workspace scope with the token, never on the plan call', async () => {
        withServers();
        await createAndBrowse();
        await clickInstall();
        await clickConfirm();

        expect('mcpScope' in (installCalls()[0].params as object)).toBe(false);
        expect(installCalls()[1].params).toEqual({
          source: SOURCE,
          plugin: 'dotnet-test',
          consentToken: 'token-v1',
          mcpScope: 'workspace',
        });
      });

      it('sends global only after the user picks All workspaces', async () => {
        withServers();
        await createAndBrowse();
        await clickInstall();
        pickAllWorkspaces();
        await clickConfirm();

        expect(installCalls()[1].params).toMatchObject({ mcpScope: 'global' });
      });

      it('with no folder open still installs the files and omits mcpScope', async () => {
        workspaceInfo.set(null);
        withServers();
        await createAndBrowse();
        await clickInstall();
        const confirm = query<HTMLButtonElement>(
          '[data-testid="external-consent-confirm"]',
        );
        expect(confirm?.disabled).toBe(false);
        await clickConfirm();

        expect('mcpScope' in (installCalls()[1].params as object)).toBe(false);
        expect(component.pendingPlan()).toBeNull();
      });
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
      expect(component.consentFailed()).toBe(false);
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

      expect(component.consentFailed()).toBe(true);
      expect(component.pendingPlan()).not.toBeNull();
      expect(query('[data-testid="external-consent"]')).toBeTruthy();
      expect(component.lastInstall()).toBeNull();
    });

    describe('failure text never reaches the dialog (D40, P3 L3)', () => {
      /** An absolute local path that must never be rendered. */
      const SENTINEL = 'C:\\Users\\secret\\x';

      const consentAfter = (second: () => unknown): void => {
        setResponder('plugins:install-external', () =>
          installCalls().length > 1
            ? second()
            : ok({
                status: 'consent-required',
                reason: 'not-yet-approved',
                plan: makePlan(),
              }),
        );
      };

      const expectFixedCopyOnly = (): void => {
        const dialog = query('[data-testid="external-consent"]');
        expect(dialog).toBeTruthy();
        const text = dialog?.textContent ?? '';
        expect(text).toContain('Install failed.');
        expect(text.replace(/\s+/g, ' ')).toContain(
          'Check the files listed in the install report, then retry.',
        );
        expect(text).not.toContain(SENTINEL);
        expect(text).not.toContain('secret');
        expect(text).not.toContain('EACCES');
        expect(
          query<HTMLButtonElement>(
            '[data-testid="external-consent-confirm"]',
          )?.textContent?.trim(),
        ).toBe('Retry install');
      };

      it('for a failed RPC envelope', async () => {
        consentAfter(() =>
          fail(`EACCES: permission denied, open '${SENTINEL}\\SKILL.md'`),
        );
        await createAndBrowse();
        await clickInstall();
        await clickConfirm();

        expectFixedCopyOnly();
      });

      it('for a thrown error', async () => {
        consentAfter(() => {
          throw new Error(
            `ENOSPC: no space left on device, write '${SENTINEL}'`,
          );
        });
        await createAndBrowse();
        await clickInstall();
        await clickConfirm();

        expectFixedCopyOnly();
        expect(component.consentFailed()).toBe(true);
      });
    });

    describe('local items and the kept-items repair route', () => {
      /** Acme Toolkit items, named from the shared agreement fixture. */
      const acme = () =>
        makeLibraryAgreementFixtures().shadowedSkill.plugins.find(
          (plugin) => plugin.source === 'external',
        );
      const localItems = (): ExternalLocalItem[] => [
        {
          approvalId: 'a-architect',
          target: 'claude',
          relPath: `.claude/agents/${acme()?.agentNames?.[0]}.md`,
          family: 'external',
          kind: 'unowned',
        },
        {
          approvalId: 'a-deploy',
          target: 'claude',
          relPath: '.claude/commands/deploy.md',
          family: 'external',
          kind: 'unreadable',
        },
      ];
      const agentKept: KeptItem = {
        approvalId: 'pa-1',
        family: 'plugin-agent',
        target: 'claude',
        relPath: '.claude/agents/release-manager.md',
        reason: 'owned-edited',
      };
      const installedResult = (): ExternalInstallResult => ({
        pluginId: PLUGIN_ID,
        displayName: acme()?.name ?? 'missing-fixture',
        installedVersion: '1.2.0',
        filesWritten: 4,
        skippedBinaryFiles: [],
        collisions: [],
        kept: [
          {
            approvalId: 'a-deploy',
            family: 'external',
            target: 'claude',
            relPath: '.claude/commands/deploy.md',
            reason: 'unreadable',
          },
          agentKept,
        ],
        libraryPass: 'updated',
      });
      const planResponse = () =>
        ok({
          status: 'consent-required',
          reason: 'not-yet-approved',
          plan: makePlan({ localItems: localItems() }),
        });
      const rows = (): HTMLElement[] =>
        Array.from(
          host.querySelectorAll<HTMLElement>(
            '[data-testid="external-consent-local-row"]',
          ),
        );

      it('sends the per-item decisions keyed by approvalId on confirm', async () => {
        setResponder('plugins:install-external', () =>
          installCalls().length > 1
            ? ok({ status: 'installed', result: installedResult() })
            : planResponse(),
        );
        await createAndBrowse();
        await clickInstall();

        rows()[0]
          .querySelector<HTMLButtonElement>('[data-testid="replace-segment"]')
          ?.click();
        fixture.detectChanges();
        await clickConfirm();

        expect(installCalls()[1].params).toEqual({
          source: SOURCE,
          plugin: 'dotnet-test',
          consentToken: 'token-v1',
          localItemDecisions: { 'a-architect': 'replace', 'a-deploy': 'keep' },
        });
        expect(component.pendingPlan()).toBeNull();
      });

      it('keeps the dialog open with "Retry install" and the choices after a failed confirm', async () => {
        setResponder('plugins:install-external', () =>
          installCalls().length > 1
            ? fail(
                'Could not write .claude/agents/architect.md (permission denied).',
              )
            : planResponse(),
        );
        await createAndBrowse();
        await clickInstall();
        rows()[0]
          .querySelector<HTMLButtonElement>('[data-testid="replace-segment"]')
          ?.click();
        fixture.detectChanges();
        await clickConfirm();

        const dialog = query('[data-testid="external-consent"]');
        expect(dialog).toBeTruthy();
        expect(dialog?.textContent).toContain('Install failed.');
        const confirm = query<HTMLButtonElement>(
          '[data-testid="external-consent-confirm"]',
        );
        expect(confirm?.textContent?.trim()).toBe('Retry install');
        expect(component.lastInstall()).toBeNull();

        // Retry re-sends the same choices.
        await clickConfirm();
        expect(installCalls()[2].params).toEqual(installCalls()[1].params);
      });

      it('"Review and replace…" opens the prompt bound to its family and replaces through the RPC', async () => {
        setResponder('plugins:replace-kept-items', () =>
          ok({ replaced: [agentKept], kept: [], libraryPass: 'updated' }),
        );
        await createComponent();
        component.lastInstall.set(installedResult());
        fixture.detectChanges();

        const review = query<HTMLButtonElement>(
          'ptah-external-install-report button[data-family="plugin-agent"]',
        );
        expect(review).toBeTruthy();
        review?.click();
        fixture.detectChanges();

        const prompt = query('[data-testid="kept-items-repair"]');
        expect(prompt?.getAttribute('data-family')).toBe('plugin-agent');
        const promptRows = Array.from(
          prompt?.querySelectorAll<HTMLElement>(
            '[data-testid="kept-item-row"]',
          ) ?? [],
        );
        expect(promptRows.map((row) => row.dataset['path'])).toEqual([
          '.claude/agents/release-manager.md',
        ]);

        promptRows[0]
          .querySelector<HTMLButtonElement>('[data-testid="replace-segment"]')
          ?.click();
        fixture.detectChanges();
        query<HTMLButtonElement>(
          '[data-testid="kept-items-repair-confirm"]',
        )?.click();
        await settle();

        const replaceCall = calls.find(
          (c) => c.method === 'plugins:replace-kept-items',
        );
        expect(replaceCall?.params).toEqual({
          decisions: { 'pa-1': 'replace' },
        });
        // The replaced item leaves the report; the external one stays.
        expect(
          component.lastInstall()?.kept?.map((item) => item.approvalId),
        ).toEqual(['a-deploy']);

        query<HTMLButtonElement>(
          '[data-testid="kept-items-repair-done"]',
        )?.click();
        fixture.detectChanges();
        expect(query('[data-testid="kept-items-repair"]')).toBeNull();
        expect(component.repairRequest()).toBeNull();
      });
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
