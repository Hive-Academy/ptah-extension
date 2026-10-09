import { ApplicationRef, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  ProvidersSettingsStateService,
  type ProvidersCliModels,
  type ProvidersCliTest,
  type ProvidersOrchestration,
  type ProvidersSettingsCommit,
  type ProvidersSettingsSection,
} from '@ptah-extension/core';
import { PROVIDER_MODELS_LOADER } from '@ptah-extension/ui';
import type {
  CliDetectionResult,
  PtahCliSummary,
} from '@ptah-extension/shared';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';
import {
  CLI_INSTALL_GUIDES,
  CliOrchestrationMatrixComponent,
} from './cli-orchestration-matrix.component';
import { isDisabledControl } from '../feedback/busy-disabled.testing';

const ready = <T>(data: T): ProvidersSettingsSection<T> => ({
  status: 'ready',
  data,
  error: null,
});
const unloaded = <T>(): ProvidersSettingsSection<T> => ({
  status: 'unloaded',
  data: null,
  error: null,
});
const idle: ProvidersSettingsCommit = {
  status: 'idle',
  saved: [],
  unsaved: [],
  unconfirmed: [],
  refreshFailed: false,
  message: null,
};
const CONTEXT = { scopeKey: 'workspace', activePath: '/ws' };

const detected = (
  cli: CliDetectionResult['cli'],
  installed: boolean,
  extra: Partial<CliDetectionResult> = {},
): CliDetectionResult => ({ cli, installed, messagingMode: 'none', ...extra });

/** The prototype data set (BRIEF), minus the quota state (D11). */
const ORCHESTRATION: ProvidersOrchestration = {
  detectedClis: [
    detected('codex', true, { version: '1.4.0' }),
    detected('copilot', true, { version: '0.9.2' }),
    detected('cursor', false),
    detected('antigravity', true, { version: '2.1.0' }),
    detected('opencode', true, { version: '0.6.0' }),
    detected('pi', false),
    detected('ptah-cli', true, { ptahCliId: 'glm-1', ptahCliName: 'Glm' }),
  ],
  disabledClis: ['copilot'],
  preferredAgentOrder: ['codex', 'antigravity', 'glm-1', 'copilot'],
  maxConcurrentAgents: 3,
  copilotAutoApprove: false,
  codexModel: 'gpt-5.5-codex',
  copilotModel: '',
  cursorModel: '',
  antigravityModel: 'claude-sonnet-4-6',
  opencodeModel: 'opencode/nemotron-3-ultra-free',
  piModel: '',
  codexReasoningEffort: 'medium',
  copilotReasoningEffort: '',
  piReasoningEffort: '',
  cursorApiKeyConfigured: false,
  cursorApiKeyStored: false,
  cursorApiKeyEnvSet: false,
};
const GLM: PtahCliSummary = {
  id: 'glm-1',
  name: 'Glm',
  providerName: 'Ollama Cloud',
  providerId: 'ollama-cloud',
  hasApiKey: true,
  hasStoredKey: true,
  status: 'available',
  enabled: true,
  modelCount: 12,
};
const MODELS: ProvidersCliModels = {
  'glm-1': {
    selectedModel: 'glm-5.3:cloud',
    tierMappings: { sonnet: 'glm-5.3', opus: 'glm-4.7', haiku: 'glm-4.5' },
  },
};

class StateStub {
  readonly commit = signal<ProvidersSettingsCommit>(idle);
  readonly orchestration = signal<
    ProvidersSettingsSection<ProvidersOrchestration>
  >(ready(ORCHESTRATION));
  readonly cliAgents = signal<ProvidersSettingsSection<PtahCliSummary[]>>(
    ready([GLM]),
  );
  readonly cliModels = signal<ProvidersSettingsSection<ProvidersCliModels>>(
    ready(MODELS),
  );
  readonly cliTest =
    signal<ProvidersSettingsSection<ProvidersCliTest>>(unloaded());
  readonly scopes = signal<
    ProvidersSettingsSection<{ activePath: string; entries: unknown[] }>
  >(ready({ activePath: '/ws', entries: [] }));
  readonly delegatedModelOptions = signal(
    ready({
      codex: [],
      copilot: [],
      cursor: [],
      antigravity: [],
      opencode: [],
      pi: [],
    }),
  );
  readonly refreshDelegatedModelOptions = jest.fn(async () => undefined);
  // Read by the Batch 32 modals (always mounted, closed).
  readonly connections = signal(ready([]));
  readonly externalAuth = signal({
    status: 'unloaded',
    data: null,
    error: null,
  });
  readonly tiers = signal({ status: 'unloaded', data: null, error: null });
  readonly refreshTiers = jest.fn(async (_params: unknown) => undefined);
  readonly reviewContext = jest.fn(() =>
    this.scopes().status === 'ready' ? CONTEXT : null,
  );
  readonly saveSettings = jest.fn(
    async (_patch: unknown, _context: unknown) => {
      this.commit.set({ ...idle, status: 'saved' });
      return true;
    },
  );
  /** Resolves with the result `ptahCli:testConnection` would have produced. */
  testResult: ProvidersCliTest = {
    id: 'glm-1',
    success: true,
    latencyMs: 112,
    reason: null,
  };
  readonly testCliConnection = jest.fn(async (_id: string) => {
    this.cliTest.set(ready(this.testResult));
  });
  readonly clearCliTest = jest.fn((_id: string) => undefined);
  readonly cliDetection = signal<
    ProvidersSettingsSection<CliDetectionResult[]>
  >(ready([]));
  /** What the next re-detect does to the state; by default nothing changes (the CLI is still missing). */
  onRedetect: () => void = () => undefined;
  readonly redetectClis = jest.fn(async (): Promise<boolean> => {
    this.onRedetect();
    return this.cliDetection().status === 'ready';
  });
}

describe('CliOrchestrationMatrixComponent', () => {
  let fixture: ComponentFixture<CliOrchestrationMatrixComponent>;
  let state: StateStub;
  let feedback: SettingsSaveFeedbackService;
  const element = () => fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement = HTMLElement>(selector: string) =>
    element().querySelector(selector) as T | null;
  const row = (id: string) => q(`[data-testid="cli-matrix-row-${id}"]`);
  const rowIds = (selector: string) =>
    Array.from(
      element().querySelectorAll(
        `${selector} tr[data-testid^="cli-matrix-row-"]`,
      ),
    ).map((node) =>
      node.getAttribute('data-testid')?.replace('cli-matrix-row-', ''),
    );
  const statusOf = (id: string) =>
    row(id)
      ?.querySelector('[data-testid="cli-matrix-status"]')
      ?.textContent?.trim();
  async function flush() {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    fixture.detectChanges();
  }
  function check(id: string, checked: boolean) {
    const input = q<HTMLInputElement>(
      `[data-testid="cli-matrix-toggle-${id}"]`,
    );
    if (!input) throw new Error(`No toggle for ${id}`);
    input.checked = checked;
    input.dispatchEvent(new Event('change'));
  }
  /** Decision 1: the Uninstalled group starts collapsed; most cases look inside it. */
  function expandUninstalled() {
    q<HTMLButtonElement>(
      '[data-testid="cli-matrix-uninstalled-toggle"]',
    )?.click();
    fixture.detectChanges();
  }
  /** V36-7: Edit and Delete live in the row's "More actions" popover. */
  function more(id: string) {
    q<HTMLButtonElement>(`[data-testid="cli-matrix-more-${id}"]`)?.click();
    fixture.detectChanges();
  }
  /** Runs afterNextRender callbacks (focus moves). */
  function render() {
    TestBed.inject(ApplicationRef).tick();
    fixture.detectChanges();
  }

  beforeAll(() => {
    // jsdom has no <dialog> API; the Batch 32 modals use showModal()/close().
    HTMLDialogElement.prototype.showModal ??= function (
      this: HTMLDialogElement,
    ) {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
  });

  beforeEach(() => {
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      writable: true,
      configurable: true,
      value: jest.fn(),
    });
    state = new StateStub();
    TestBed.configureTestingModule({
      imports: [CliOrchestrationMatrixComponent],
      providers: [
        { provide: ProvidersSettingsStateService, useValue: state },
        {
          provide: PROVIDER_MODELS_LOADER,
          useValue: {
            listModels: jest.fn(async () => ({ models: [], totalCount: 0 })),
          },
        },
        SettingsSaveFeedbackService,
      ],
    });
    feedback = TestBed.inject(SettingsSaveFeedbackService);
    fixture = TestBed.createComponent(CliOrchestrationMatrixComponent);
    fixture.detectChanges();
    expandUninstalled();
  });
  afterEach(() => {
    feedback.dismiss();
    TestBed.resetTestingModule();
  });

  describe('structure (prototype section 2, design-spec §3.5)', () => {
    it('is a table-xs with the prototype columns', () => {
      const table = q('[data-testid="cli-matrix"]');
      expect(table?.tagName).toBe('TABLE');
      expect(table?.className).toContain('table-xs');
      expect(
        Array.from(table?.querySelectorAll('thead th') ?? []).map((th) =>
          th.textContent?.trim(),
        ),
      ).toEqual([
        'On',
        'Agent / Instance',
        'Status',
        'Provider',
        'Model',
        'Effort',
        'Permissions & Safety',
        'Actions',
      ]);
      expect(q('#cli-matrix-heading')?.textContent).toContain(
        'CLI Agents & Custom Instances Matrix',
      );
    });

    it('lists installed rows by preferred order, then the Uninstalled group (#71)', () => {
      expect(
        rowIds('tbody:not([data-testid="cli-matrix-uninstalled"])'),
      ).toEqual(['codex', 'antigravity', 'glm-1', 'copilot', 'opencode']);
      expect(rowIds('[data-testid="cli-matrix-uninstalled"]')).toEqual([
        'cursor',
        'pi',
      ]);
      expect(
        q('[data-testid="cli-matrix-uninstalled"] th')?.textContent,
      ).toContain('Uninstalled CLI agents');
    });

    it('Batch 54.1: an uninstalled CLI toggle stays natively disabled; an installed one only goes aria-disabled while busy', () => {
      const cursor = q<HTMLInputElement>(
        '[data-testid="cli-matrix-toggle-cursor"]',
      );
      const codex = q<HTMLInputElement>(
        '[data-testid="cli-matrix-toggle-codex"]',
      );
      expect(cursor?.disabled).toBe(true);
      expect(codex?.disabled).toBe(false);
      expect(codex?.getAttribute('aria-disabled')).toBeNull();
    });

    it('omits the Uninstalled group when every CLI is installed', () => {
      state.orchestration.set(
        ready({ ...ORCHESTRATION, detectedClis: [detected('codex', true)] }),
      );
      fixture.detectChanges();
      expect(q('[data-testid="cli-matrix-uninstalled"]')).toBeNull();
    });

    it('shows an empty state with no installed CLI and no instance, and a loading one before any read', () => {
      state.orchestration.set(
        ready({ ...ORCHESTRATION, detectedClis: [detected('pi', false)] }),
      );
      state.cliAgents.set(ready([]));
      fixture.detectChanges();
      expect(q('[data-testid="cli-matrix-empty"]')?.textContent).toContain(
        'No CLI agent is installed',
      );
      state.orchestration.set(unloaded());
      state.cliAgents.set(unloaded());
      fixture.detectChanges();
      expect(q('[data-testid="cli-matrix-empty"]')?.textContent).toContain(
        'Loading CLI agents',
      );
      expect(q('[data-testid="cli-matrix"]')?.getAttribute('aria-busy')).toBe(
        'true',
      );
    });

    it('uses a surface row ladder and keeps the table-xs density', () => {
      expect(q('[data-testid="cli-matrix"]')?.className).toContain('table-xs');
      expect(q('[data-testid="cli-matrix"]')?.className).not.toContain('py-3');
      for (const id of ['copilot', 'cursor', 'pi']) {
        expect(row(id)?.className).toContain('surface-2');
        expect(row(id)?.getAttribute('data-dimmed')).toBe('true');
      }
      for (const id of ['codex', 'glm-1'])
        expect(row(id)?.getAttribute('data-dimmed')).toBeNull();
      expect(row('glm-1')?.className).toContain('surface-2');
      state.cliAgents.set(ready([{ ...GLM, enabled: false }]));
      fixture.detectChanges();
      expect(row('glm-1')?.className).toContain('surface-2');
    });

    it('has one Add, and Tiers / More (Edit, Delete) on instance rows only (Batch 32, V36-7); Credentials only on Cursor', () => {
      const labels = Array.from(element().querySelectorAll('button')).map(
        (button) => button.textContent?.trim() ?? '',
      );
      expect(
        labels.filter((label) => label === 'Add Ptah CLI Instance'),
      ).toHaveLength(1);
      expect(labels.filter((label) => label === 'Tiers')).toHaveLength(1);
      expect(q('[data-testid="cli-matrix-edit-glm-1"]')).toBeNull();
      more('glm-1');
      expect(
        q('[data-testid="cli-matrix-edit-glm-1"]')?.textContent?.trim(),
      ).toBe('Edit name or key');
      expect(
        row('glm-1')?.querySelector('[data-testid="cli-matrix-tiers-glm-1"]'),
      ).not.toBeNull();
      expect(
        row('codex')?.querySelector('[data-testid^="cli-matrix-tiers-"]'),
      ).toBeNull();
      expect(labels.filter((label) => label === 'Credentials')).toHaveLength(1);
    });

    it('opens the add modal empty, the edit modal on the instance, and the tier modal for it', () => {
      const dialogOpen = (testid: string) =>
        q(`[data-testid="${testid}"]`)?.closest('dialog')?.hasAttribute('open');
      q<HTMLButtonElement>('[data-testid="cli-matrix-add"]')?.click();
      fixture.detectChanges();
      expect(dialogOpen('add-cli-instance-modal')).toBe(true);
      expect(
        q('[data-testid="add-cli-instance-modal"]')?.textContent,
      ).toContain('Add Ptah CLI Agent Instance');
      q<HTMLButtonElement>(
        '[data-testid="add-cli-instance-modal"] button[aria-label="Close"]',
      )?.click();
      fixture.detectChanges();
      expect(dialogOpen('add-cli-instance-modal')).toBe(false);
      more('glm-1');
      q<HTMLButtonElement>('[data-testid="cli-matrix-edit-glm-1"]')?.click();
      fixture.detectChanges();
      expect(
        q('[data-testid="add-cli-instance-modal"]')?.textContent,
      ).toContain('Edit Glm');
      expect(
        q<HTMLInputElement>('[data-testid="add-cli-instance-name"]')?.value,
      ).toBe('Glm');
      q<HTMLButtonElement>(
        '[data-testid="add-cli-instance-modal"] button[aria-label="Close"]',
      )?.click();
      q<HTMLButtonElement>('[data-testid="cli-matrix-tiers-glm-1"]')?.click();
      fixture.detectChanges();
      expect(dialogOpen('cli-tier-mapping-modal')).toBe(true);
      expect(
        q('[data-testid="cli-tier-mapping-modal"]')?.textContent,
      ).toContain('Glm Tier Model Mapping');
      expect(state.refreshTiers).toHaveBeenCalledWith({
        providerId: 'ollama-cloud',
        scope: 'cliAgent',
      });
    });

    it('shows an Add row when there is no Ptah CLI instance yet', () => {
      expect(q('[data-testid="cli-matrix-no-instances"]')).toBeNull();
      state.cliAgents.set(ready([]));
      fixture.detectChanges();
      expect(
        q('[data-testid="cli-matrix-no-instances"]')?.textContent,
      ).toContain('No Ptah CLI instance yet.');
    });
  });

  describe('cells', () => {
    it('shows only detection states for system CLIs (D11) and the instance status with its last latency (#43)', () => {
      expect(statusOf('codex')).toBe('Ready');
      expect(statusOf('copilot')).toBe('Disabled');
      expect(statusOf('pi')).toBe('Not installed');
      expect(statusOf('cursor')).toBe('Needs API key');
      expect(statusOf('glm-1')).toBe('Ready');
      expect(element().textContent?.toLowerCase()).not.toContain('quota');
      state.cliTest.set(
        ready({ id: 'glm-1', success: true, latencyMs: 112, reason: null }),
      );
      fixture.detectChanges();
      expect(statusOf('glm-1')).toBe('Ready (112ms)');
    });

    it('shows the instance key status and tier badges (#44, #54) and its Ptah CLI badge', () => {
      const subline = row('glm-1')?.querySelector(
        '[data-testid="cli-matrix-instance-subline"]',
      );
      expect(
        subline
          ?.querySelector('[data-testid="cli-matrix-key-status"]')
          ?.textContent?.trim(),
      ).toBe('Key set');
      expect(
        Array.from(subline?.querySelectorAll('[data-tier]') ?? []).map((node) =>
          node.textContent?.trim(),
        ),
      ).toEqual(['Sonnet: glm-5.3', 'Opus: glm-4.7', 'Haiku: glm-4.5']);
      expect(row('glm-1')?.textContent).toContain('Ptah CLI');
    });

    it('shows versions, providers and the CLI defaults', () => {
      expect(row('codex')?.textContent).toContain('v1.4.0');
      expect(row('codex')?.textContent).toContain('OpenAI Codex');
      expect(row('opencode')?.textContent).toContain('opencode');
      expect(row('pi')?.textContent).toContain('None');
      expect(
        q('[data-testid="cli-matrix-effort-antigravity"]')?.textContent?.trim(),
      ).toBe('default');
      expect(
        q('[data-testid="cli-matrix-effort-glm-1"]')?.textContent?.trim(),
      ).toBe('default');
    });

    it('makes model and effort cells buttons only on enabled, installed rows', () => {
      expect(q('[data-testid="cli-matrix-model-codex"]')?.tagName).toBe(
        'BUTTON',
      );
      expect(
        q('[data-testid="cli-matrix-effort-codex"]')?.textContent?.trim(),
      ).toBe('medium');
      expect(
        q('[data-testid="cli-matrix-model-glm-1"]')?.textContent?.trim(),
      ).toBe('glm-5.3:cloud');
      // Disabled (Copilot) and not installed (Pi): plain text.
      expect(q('[data-testid="cli-matrix-model-copilot"]')).toBeNull();
      expect(row('copilot')?.textContent).toContain('provider default');
      expect(q('[data-testid="cli-matrix-model-pi"]')).toBeNull();
      expect(row('pi')?.querySelectorAll('td')[4]?.textContent?.trim()).toBe(
        '—',
      );
    });

    it('keeps badge and status text base-content; colour sits on dots and badge fills (deviation 6)', () => {
      const permission = row('codex')?.querySelector(
        '[data-testid="cli-matrix-permission"]',
      );
      expect(permission?.textContent?.trim()).toBe('Full auto');
      expect(permission?.className).toContain('text-base-content');
      expect(permission?.className).toContain('bg-warning/10');
      expect(
        row('codex')?.querySelector('[data-testid="cli-matrix-status"]')
          ?.className,
      ).toContain('text-base-content');
      expect(
        row('codex')?.querySelector(
          '[data-testid="cli-matrix-status"] .bg-success',
        ),
      ).not.toBeNull();
      expect(
        row('copilot')
          ?.querySelector('[data-testid="cli-matrix-permission"]')
          ?.textContent?.trim(),
      ).toBe('Auto-approve: Off');
    });
  });

  describe('popovers', () => {
    it('opens the model popover from the cell (one click) and closes it', async () => {
      q<HTMLButtonElement>('[data-testid="cli-matrix-model-codex"]')?.click();
      fixture.detectChanges();
      await flush();
      const panel = q('[data-testid="cli-matrix-popover"]');
      expect(panel?.getAttribute('data-field')).toBe('model');
      expect(panel?.getAttribute('data-row')).toBe('codex');
      expect(
        q('[data-testid="cli-matrix-model-codex"]')?.getAttribute(
          'aria-expanded',
        ),
      ).toBe('true');
      (
        panel?.querySelector('button[aria-label="Close"]') as HTMLButtonElement
      ).click();
      fixture.detectChanges();
      expect(q('[data-testid="cli-matrix-popover"]')).toBeNull();
    });

    it('saves an effort in two clicks: cell, then value (RUX-8)', async () => {
      q<HTMLButtonElement>('[data-testid="cli-matrix-effort-codex"]')?.click();
      fixture.detectChanges();
      q<HTMLButtonElement>(
        '[data-testid="cli-matrix-popover"] [data-effort="high"]',
      )?.click();
      await flush();
      expect(state.saveSettings).toHaveBeenCalledTimes(1);
      expect(state.saveSettings).toHaveBeenCalledWith(
        { orchestration: { codexReasoningEffort: 'high' } },
        CONTEXT,
      );
      expect(q('[data-testid="cli-matrix-popover"]')).toBeNull();
    });

    it('Batch 55b F3: while a cell save runs, Esc closes the popover and focus returns to the cell (aria-disabled, not native)', async () => {
      document.body.appendChild(fixture.nativeElement);
      try {
        let release: (saved: boolean) => void = () => undefined;
        state.saveSettings.mockImplementationOnce(() => {
          state.commit.set({ ...idle, status: 'saving' });
          return new Promise<boolean>((resolve) => {
            release = (saved) => {
              state.commit.set({ ...idle, status: 'saved' });
              resolve(saved);
            };
          });
        });
        const trigger = q<HTMLButtonElement>(
          '[data-testid="cli-matrix-effort-codex"]',
        );
        trigger?.focus();
        trigger?.click();
        fixture.detectChanges();
        await flush();
        const high = q<HTMLButtonElement>(
          '[data-testid="cli-matrix-popover"] [data-effort="high"]',
        );
        high?.focus();
        high?.click();
        await flush();
        expect(feedback.saving()).toBe(true);
        expect(trigger?.disabled).toBe(false);
        expect(trigger?.getAttribute('aria-disabled')).toBe('true');
        expect(document.activeElement).toBe(high);
        high?.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Escape',
            bubbles: true,
            cancelable: true,
          }),
        );
        fixture.detectChanges();
        await flush();
        expect(q('[data-testid="cli-matrix-popover"]')).toBeNull();
        expect(document.activeElement).toBe(trigger);
        release(true);
        await flush();
        expect(trigger?.getAttribute('aria-disabled')).toBeNull();
      } finally {
        fixture.nativeElement.remove();
      }
    });

    it("shows each CLI's permission note in its ℹ popover (#70)", () => {
      q<HTMLButtonElement>(
        '[data-testid="cli-matrix-permission-info-pi"]',
      )?.click();
      fixture.detectChanges();
      const popover = q('[data-testid="cli-permission-popover"]');
      expect(popover?.textContent).toContain('Pi permissions');
      expect(popover?.textContent).toContain(
        'No approval gate and no MCP support',
      );
    });

    it('keeps Cursor actionable in the Uninstalled group: Credentials opens its popover (#64, Batch 31)', () => {
      const credentials = q<HTMLButtonElement>(
        '[data-testid="cli-matrix-credentials-cursor"]',
      );
      expect(
        credentials?.closest('[data-testid="cli-matrix-uninstalled"]'),
      ).not.toBeNull();
      expect(
        row('cursor')?.querySelector(
          '[data-testid="cli-matrix-install-cursor"]',
        ),
      ).not.toBeNull();
      credentials?.click();
      fixture.detectChanges();
      expect(q('[data-testid="cursor-credential-popover"]')).not.toBeNull();
      expect(credentials?.getAttribute('aria-expanded')).toBe('true');
    });

    it('offers Credentials on an installed Cursor row too, and on no other row', () => {
      state.orchestration.set(
        ready({
          ...ORCHESTRATION,
          detectedClis: [
            detected('cursor', true, { version: 'sdk' }),
            detected('codex', true),
          ],
        }),
      );
      fixture.detectChanges();
      expect(
        q(
          'tbody:not([data-testid="cli-matrix-uninstalled"]) [data-testid="cli-matrix-credentials-cursor"]',
        ),
      ).not.toBeNull();
      expect(
        element().querySelectorAll('[data-testid^="cli-matrix-credentials-"]'),
      ).toHaveLength(1);
    });

    it("shows Copilot's auto-approve toggle in its permission popover only (moved from the policy section)", () => {
      q<HTMLButtonElement>(
        '[data-testid="cli-matrix-permission-info-copilot"]',
      )?.click();
      fixture.detectChanges();
      const popover = q('[data-testid="cli-permission-popover"]');
      expect(popover?.textContent).toContain('Copilot permissions');
      expect(
        popover?.querySelector('[data-testid="copilot-auto-approve"]'),
      ).not.toBeNull();
      q<HTMLButtonElement>(
        '[data-testid="cli-matrix-permission-info-codex"]',
      )?.click();
      fixture.detectChanges();
      expect(
        q(
          '[data-testid="cli-permission-popover"] [data-testid="copilot-auto-approve"]',
        ),
      ).toBeNull();
    });

    it('opens one popover at a time', () => {
      q<HTMLButtonElement>(
        '[data-testid="cli-matrix-permission-info-codex"]',
      )?.click();
      fixture.detectChanges();
      q<HTMLButtonElement>('[data-testid="cli-matrix-install-pi"]')?.click();
      fixture.detectChanges();
      expect(q('[data-testid="cli-permission-popover"]')).toBeNull();
      expect(q('[data-testid="cli-install-popover"]')?.textContent).toContain(
        'npm install -g @earendil-works/pi-coding-agent',
      );
    });

    describe('install guide Re-detect', () => {
      function openPiGuide() {
        q<HTMLButtonElement>('[data-testid="cli-matrix-install-pi"]')?.click();
        fixture.detectChanges();
      }
      const note = () =>
        q('[data-testid="cli-install-redetect-note"]')?.textContent?.trim();

      it('closes the guide and focuses the row once the CLI is found', async () => {
        state.onRedetect = () =>
          state.orchestration.set(
            ready({
              ...ORCHESTRATION,
              detectedClis: ORCHESTRATION.detectedClis.map((cli) =>
                cli.cli === 'pi'
                  ? detected('pi', true, { version: '0.80.3' })
                  : cli,
              ),
            }),
          );
        openPiGuide();
        q<HTMLButtonElement>(
          '[data-testid="cli-install-redetect-pi"]',
        )?.click();
        await flush();
        render();
        expect(state.redetectClis).toHaveBeenCalledTimes(1);
        expect(q('[data-testid="cli-install-popover"]')).toBeNull();
        expect(rowIds('[data-testid="cli-matrix-uninstalled"]')).not.toContain(
          'pi',
        );
        expect(document.activeElement?.getAttribute('data-testid')).toBe(
          'cli-matrix-toggle-pi',
        );
      });

      it('says the CLI is still missing when detection does not find it', async () => {
        openPiGuide();
        q<HTMLButtonElement>(
          '[data-testid="cli-install-redetect-pi"]',
        )?.click();
        await flush();
        expect(q('[data-testid="cli-install-popover"]')).not.toBeNull();
        expect(note()).toBe(
          'Still not found. Check the step above, then try again.',
        );
      });

      it('says detection failed when the re-read fails', async () => {
        state.onRedetect = () =>
          state.cliDetection.set({
            status: 'error',
            data: null,
            error: 'Could not load this section. Retry.',
          });
        openPiGuide();
        q<HTMLButtonElement>(
          '[data-testid="cli-install-redetect-pi"]',
        )?.click();
        await flush();
        expect(note()).toBe('Detection failed. Try again.');
      });

      it('decides on its own detection result, not the shared section an overlapping re-detect replaced', async () => {
        // This call failed, but a later policy-bar re-detect already left the shared section ready.
        state.redetectClis.mockResolvedValueOnce(false);
        openPiGuide();
        q<HTMLButtonElement>(
          '[data-testid="cli-install-redetect-pi"]',
        )?.click();
        await flush();
        expect(state.cliDetection().status).toBe('ready');
        expect(note()).toBe('Detection failed. Try again.');
      });
    });

    it('has install copy for every system CLI, Codex and Copilot as before (#77)', () => {
      expect(CLI_INSTALL_GUIDES.codex.command).toBe(
        'npm install -g @openai/codex',
      );
      expect(CLI_INSTALL_GUIDES.copilot.command).toBe(
        'npm install -g @github/copilot',
      );
      for (const guide of Object.values(CLI_INSTALL_GUIDES))
        expect(guide.note).toContain('Re-detect');
      q<HTMLButtonElement>(
        '[data-testid="cli-matrix-install-cursor"]',
      )?.click();
      fixture.detectChanges();
      expect(q('[data-testid="cli-install-popover"] code')).toBeNull();
      expect(q('[data-testid="cli-install-popover"]')?.textContent).toContain(
        'CURSOR_API_KEY',
      );
    });
  });

  describe('writes (every write is state.saveSettings through the feedback service)', () => {
    it('switches a system CLI off through disabledClis, with Undo', async () => {
      check('codex', false);
      await flush();
      expect(state.saveSettings).toHaveBeenCalledWith(
        { orchestration: { disabledClis: ['copilot', 'codex'] } },
        CONTEXT,
      );
      expect(feedback.toast()).toEqual({
        tone: 'status',
        message: 'Saved Codex off to All Ptah apps.',
        canUndo: true,
      });
      await feedback.undo();
      expect(state.saveSettings).toHaveBeenLastCalledWith(
        { orchestration: { disabledClis: ['copilot'] } },
        CONTEXT,
      );
    });

    it('switches a system CLI on by removing it from disabledClis', async () => {
      check('copilot', true);
      await flush();
      expect(state.saveSettings).toHaveBeenCalledWith(
        { orchestration: { disabledClis: [] } },
        CONTEXT,
      );
    });

    it('switches an instance through ptahCli:update.enabled, with Undo', async () => {
      check('glm-1', false);
      await flush();
      expect(state.saveSettings).toHaveBeenCalledWith(
        {
          cli: [{ action: 'update', params: { id: 'glm-1', enabled: false } }],
        },
        CONTEXT,
      );
      await feedback.undo();
      expect(state.saveSettings).toHaveBeenLastCalledWith(
        { cli: [{ action: 'update', params: { id: 'glm-1', enabled: true } }] },
        CONTEXT,
      );
    });

    it('keeps the checkbox on the saved value until the read-back moves it', async () => {
      check('codex', false);
      expect(
        q<HTMLInputElement>('[data-testid="cli-matrix-toggle-codex"]')?.checked,
      ).toBe(true);
      await flush();
    });

    it('disables uninstalled toggles, and every toggle while a save runs or the scopes are not loaded', () => {
      expect(
        isDisabledControl(
          q<HTMLInputElement>('[data-testid="cli-matrix-toggle-pi"]'),
        ),
      ).toBe(true);
      expect(
        q<HTMLInputElement>('[data-testid="cli-matrix-toggle-pi"]')?.checked,
      ).toBe(false);
      state.commit.set({ ...idle, status: 'saving' });
      fixture.detectChanges();
      expect(
        isDisabledControl(
          q<HTMLInputElement>('[data-testid="cli-matrix-toggle-codex"]'),
        ),
      ).toBe(true);
      state.commit.set(idle);
      state.scopes.set({ status: 'loading', data: null, error: null });
      fixture.detectChanges();
      expect(
        isDisabledControl(
          q<HTMLInputElement>('[data-testid="cli-matrix-toggle-glm-1"]'),
        ),
      ).toBe(true);
    });

    it('deletes an instance after the inline confirm, with no Undo', async () => {
      more('glm-1');
      q<HTMLButtonElement>('[data-testid="cli-matrix-delete-glm-1"]')?.click();
      fixture.detectChanges();
      expect(state.saveSettings).not.toHaveBeenCalled();
      expect(row('glm-1')?.textContent).toContain('Delete Glm?');
      q<HTMLButtonElement>('button[aria-label="Confirm delete Glm"]')?.click();
      await flush();
      expect(state.saveSettings).toHaveBeenCalledWith(
        { cli: [{ action: 'delete', params: { id: 'glm-1' } }] },
        CONTEXT,
      );
      expect(feedback.toast()?.canUndo).toBe(false);
    });

    it('cancels a delete without writing; focus moves to the confirm, then back to More', () => {
      more('glm-1');
      q<HTMLButtonElement>('[data-testid="cli-matrix-delete-glm-1"]')?.click();
      render();
      const cancel = Array.from(
        row('glm-1')?.querySelectorAll('button') ?? [],
      ).find((button) => button.textContent?.trim() === 'Cancel');
      expect(document.activeElement).toBe(cancel);
      cancel?.click();
      render();
      expect(q('[data-testid="cli-matrix-more-glm-1"]')).not.toBeNull();
      expect(document.activeElement).toBe(
        q('[data-testid="cli-matrix-more-glm-1"]'),
      );
      expect(state.saveSettings).not.toHaveBeenCalled();
    });

    it('M2: a refused delete keeps the confirm even when commit() still says an earlier save landed', async () => {
      state.commit.set({ ...idle, status: 'saved' });
      state.saveSettings.mockImplementationOnce(async () => false);
      more('glm-1');
      q<HTMLButtonElement>('[data-testid="cli-matrix-delete-glm-1"]')?.click();
      fixture.detectChanges();
      q<HTMLButtonElement>('button[aria-label="Confirm delete Glm"]')?.click();
      await flush();
      expect(row('glm-1')?.textContent).toContain('Delete Glm?');
    });

    it('Minor 4: Undo of a system on/off restores only that CLI, against the list as it is at Undo time', async () => {
      check('codex', false);
      await flush();
      // Another path disables opencode meanwhile; Undo must keep that change.
      state.orchestration.set(
        ready({
          ...ORCHESTRATION,
          disabledClis: ['copilot', 'codex', 'opencode'],
        }),
      );
      await feedback.undo();
      expect(state.saveSettings).toHaveBeenLastCalledWith(
        { orchestration: { disabledClis: ['copilot', 'opencode'] } },
        CONTEXT,
      );
    });
  });

  describe('Gate V 36 layout (V36-1/-2/-7, decision 1)', () => {
    it('decision 1: the Uninstalled group starts collapsed behind a keyboard disclosure with its count', () => {
      const fresh = TestBed.createComponent(CliOrchestrationMatrixComponent);
      fresh.detectChanges();
      const host = fresh.nativeElement as HTMLElement;
      const toggle = host.querySelector<HTMLButtonElement>(
        '[data-testid="cli-matrix-uninstalled-toggle"]',
      );
      expect(toggle?.tagName).toBe('BUTTON');
      expect(toggle?.getAttribute('aria-expanded')).toBe('false');
      expect(toggle?.textContent?.trim()).toBe('Uninstalled CLI agents (2)');
      expect(
        host.querySelectorAll(
          '[data-testid="cli-matrix-uninstalled"] tr[data-testid^="cli-matrix-row-"]',
        ),
      ).toHaveLength(0);
      toggle?.click();
      fresh.detectChanges();
      expect(toggle?.getAttribute('aria-expanded')).toBe('true');
      expect(
        host.querySelectorAll(
          '[data-testid="cli-matrix-uninstalled"] tr[data-testid^="cli-matrix-row-"]',
        ),
      ).toHaveLength(2);
      toggle?.click();
      fresh.detectChanges();
      expect(toggle?.getAttribute('aria-expanded')).toBe('false');
      fresh.destroy();
    });

    it('decision 1: a popover whose row moves into the collapsed group keeps that group open', () => {
      expandUninstalled();
      expect(
        q('[data-testid="cli-matrix-uninstalled-toggle"]')?.getAttribute(
          'aria-expanded',
        ),
      ).toBe('false');
      state.orchestration.set(
        ready({
          ...ORCHESTRATION,
          detectedClis: [
            ...ORCHESTRATION.detectedClis.filter((cli) => cli.cli !== 'cursor'),
            detected('cursor', true, { version: 'sdk' }),
          ],
          cursorApiKeyStored: true,
          cursorApiKeyConfigured: true,
        }),
      );
      fixture.detectChanges();
      q<HTMLButtonElement>(
        '[data-testid="cli-matrix-credentials-cursor"]',
      )?.click();
      fixture.detectChanges();
      // The key is removed: Cursor moves back into the (collapsed) Uninstalled group with its popover open.
      state.orchestration.set(ready(ORCHESTRATION));
      fixture.detectChanges();
      expect(
        q(
          '[data-testid="cli-matrix-uninstalled"] [data-testid="cursor-credential-popover"]',
        ),
      ).not.toBeNull();
    });

    it("M3: after the Cursor row moves groups, closing its credentials returns focus to the moved row's trigger", () => {
      q<HTMLButtonElement>(
        '[data-testid="cli-matrix-credentials-cursor"]',
      )?.click();
      fixture.detectChanges();
      state.orchestration.set(
        ready({
          ...ORCHESTRATION,
          detectedClis: [
            ...ORCHESTRATION.detectedClis.filter((cli) => cli.cli !== 'cursor'),
            detected('cursor', true, { version: 'sdk' }),
          ],
          cursorApiKeyStored: true,
          cursorApiKeyConfigured: true,
        }),
      );
      fixture.detectChanges();
      const moved = q<HTMLButtonElement>(
        'tbody:not([data-testid="cli-matrix-uninstalled"]) [data-testid="cli-matrix-credentials-cursor"]',
      );
      expect(moved).not.toBeNull();
      q<HTMLButtonElement>(
        '[data-testid="cursor-credential-popover"] button[aria-label="Close"]',
      )?.click();
      render();
      expect(document.activeElement).toBe(moved);
    });

    it("re-check N-2: a removed key moves the row into the collapsed group; closing focuses that group's disclosure, not body", () => {
      expandUninstalled();
      state.orchestration.set(
        ready({
          ...ORCHESTRATION,
          detectedClis: [
            ...ORCHESTRATION.detectedClis.filter((cli) => cli.cli !== 'cursor'),
            detected('cursor', true, { version: 'sdk' }),
          ],
          cursorApiKeyStored: true,
          cursorApiKeyConfigured: true,
        }),
      );
      fixture.detectChanges();
      q<HTMLButtonElement>(
        '[data-testid="cli-matrix-credentials-cursor"]',
      )?.click();
      fixture.detectChanges();
      state.orchestration.set(ready(ORCHESTRATION));
      fixture.detectChanges();
      q<HTMLButtonElement>(
        '[data-testid="cursor-credential-popover"] button[aria-label="Close"]',
      )?.click();
      render();
      const toggle = q<HTMLButtonElement>(
        '[data-testid="cli-matrix-uninstalled-toggle"]',
      );
      expect(toggle?.getAttribute('aria-expanded')).toBe('false');
      expect(q('[data-testid="cli-matrix-credentials-cursor"]')).toBeNull();
      expect(document.activeElement).toBe(toggle);
    });

    it('Batch 36c.i: the On box is the centred-tick "cli-check" (about 18 px), primary, not daisyUI\'s low-tick checkbox-xs', () => {
      const box = q<HTMLInputElement>(
        '[data-testid="cli-matrix-toggle-codex"]',
      );
      const classes = box?.className.split(/\s+/) ?? [];
      expect(classes).toEqual(
        expect.arrayContaining(['cli-check', 'checkbox', 'checkbox-primary']),
      );
      expect(classes).not.toContain('checkbox-xs');
    });

    it('V36-7: narrow actions move Tiers and Test into More actions', () => {
      const actions = q<HTMLButtonElement>(
        '[data-testid="cli-matrix-tiers-glm-1"]',
      )?.parentElement;
      expect(actions?.className).toContain('flex-nowrap');
      expect(actions?.className).toContain('whitespace-nowrap');
      expect(
        actions?.querySelector('[data-testid="cli-matrix-test-glm-1"]'),
      ).not.toBeNull();
      const trigger = q<HTMLButtonElement>(
        '[data-testid="cli-matrix-more-glm-1"]',
      );
      expect(trigger?.getAttribute('aria-label')).toBe('More actions for Glm');
      expect(trigger?.getAttribute('aria-expanded')).toBe('false');
      more('glm-1');
      expect(trigger?.getAttribute('aria-expanded')).toBe('true');
      expect(
        q('[data-testid="cli-matrix-more-menu"]')?.getAttribute('aria-label'),
      ).toBe('More actions for Glm');
      const tiers = q<HTMLButtonElement>(
        '[data-testid="cli-matrix-more-tiers-glm-1"]',
      );
      const test = q<HTMLButtonElement>(
        '[data-testid="cli-matrix-more-test-glm-1"]',
      );
      expect(tiers?.getAttribute('aria-label')).toBe('Tiers for Glm');
      expect(test?.getAttribute('aria-label')).toBe('Test Glm');
      // Visual re-check N1: the items stack in a column inside the panel (the actions line is whitespace-nowrap).
      const menuClasses =
        q('[data-testid="cli-matrix-more-menu"]')?.className.split(/\s+/) ?? [];
      expect(menuClasses).toEqual(
        expect.arrayContaining(['flex', 'flex-col', 'w-40']),
      );
      for (const item of Array.from(
        q('[data-testid="cli-matrix-more-menu"]')?.querySelectorAll('button') ??
          [],
      )) {
        expect(item.className.split(/\s+/)).toContain('w-full');
      }
      q<HTMLButtonElement>('[data-testid="cli-matrix-edit-glm-1"]')?.click();
      fixture.detectChanges();
      expect(q('[data-testid="cli-matrix-more-menu"]')).toBeNull();
      expect(
        q('[data-testid="add-cli-instance-modal"]')
          ?.closest('dialog')
          ?.hasAttribute('open'),
      ).toBe(true);
      more('glm-1');
      q<HTMLButtonElement>(
        '[data-testid="cli-matrix-more-test-glm-1"]',
      )?.click();
      expect(state.testCliConnection).toHaveBeenCalledWith('glm-1');
    });

    it('fold round 2: narrow layout shows one tier summary badge with the full list as title and spoken text', () => {
      const summary = row('glm-1')?.querySelector(
        '[data-testid="cli-matrix-tier-summary"]',
      ) as HTMLElement;
      expect(summary.className).toContain('cli-narrow-only');
      expect(summary.getAttribute('title')).toBe(
        'Sonnet: glm-5.3, Opus: glm-4.7, Haiku: glm-4.5',
      );
      expect(summary.textContent?.trim()).toBe(
        '3 tier models: Sonnet: glm-5.3, Opus: glm-4.7, Haiku: glm-4.5',
      );
      expect(summary.querySelector('.sr-only')).not.toBeNull();
      for (const badge of Array.from(
        row('glm-1')?.querySelectorAll('[data-tier]') ?? [],
      ))
        expect(badge.className).toContain('cli-wide-only');
      state.cliModels.set(
        ready({
          'glm-1': { selectedModel: '', tierMappings: { sonnet: 'glm-5.3' } },
        }),
      );
      fixture.detectChanges();
      expect(
        row('glm-1')?.querySelector('[data-testid="cli-matrix-tier-summary"]')
          ?.firstChild?.textContent,
      ).toBe('1 tier model');
    });

    it('fold round 2: the narrow status and provider stay on one line with an accessible provider name', () => {
      const inline = row('codex')?.querySelector(
        '[data-testid="cli-matrix-narrow-inline"]',
      ) as HTMLElement;
      expect(inline.className).toContain('flex-nowrap');
      const provider = inline.querySelector(
        ':scope > span:last-child',
      ) as HTMLElement;
      expect(provider.getAttribute('title')).toBe('OpenAI Codex');
      expect(provider.textContent?.trim()).toBe('Provider: OpenAI Codex');
    });

    it('V36-2: helper text is 12 px: subtitle, version, provider subline', () => {
      expect(
        Array.from(
          element().querySelectorAll(
            '[data-testid="settings-cli-matrix"] span',
          ),
        ).find((span) =>
          span.textContent?.includes('Click model or effort cells'),
        )?.className,
      ).toContain('text-xs');
      const version = Array.from(
        row('codex')?.querySelectorAll('span') ?? [],
      ).find((span) => span.textContent?.trim() === 'v1.4.0');
      expect(version?.className).toContain('text-xs');
      expect(
        row('codex')?.querySelector(
          '[data-testid="cli-matrix-narrow-inline"] > span:last-child',
        )?.className,
      ).toContain('text-xs');
      expect(element().innerHTML).not.toContain('text-[10px]');
    });
  });

  describe('Test (#52, RUX-11)', () => {
    it('tests the instance and shows the latency inline', async () => {
      q<HTMLButtonElement>('[data-testid="cli-matrix-test-glm-1"]')?.click();
      await flush();
      expect(state.testCliConnection).toHaveBeenCalledWith('glm-1');
      expect(
        row('glm-1')
          ?.querySelector('[data-testid="cli-matrix-test-result"]')
          ?.textContent?.trim(),
      ).toBe('Test passed in 112ms.');
    });

    it("M1: a failure is a fixed sentence, followed only by the state's own fixed reason", async () => {
      state.testResult = {
        id: 'glm-1',
        success: false,
        latencyMs: null,
        reason: null,
      };
      q<HTMLButtonElement>('[data-testid="cli-matrix-test-glm-1"]')?.click();
      await flush();
      const result = () =>
        row('glm-1')?.querySelector('[data-testid="cli-matrix-test-result"]');
      expect(result()?.textContent?.trim()).toBe('The connection test failed.');
      expect(result()?.getAttribute('role')).toBe('alert');
      expect(statusOf('glm-1')).toBe('Ready');
      state.testResult = {
        id: 'glm-1',
        success: false,
        latencyMs: null,
        reason: 'The provider did not respond.',
      };
      q<HTMLButtonElement>('[data-testid="cli-matrix-test-glm-1"]')?.click();
      await flush();
      expect(result()?.textContent?.trim()).toBe(
        'The connection test failed. The provider did not respond.',
      );
    });

    it('S1: a failed or timed-out run never shows the earlier pass, and nothing shows while it runs', async () => {
      q<HTMLButtonElement>('[data-testid="cli-matrix-test-glm-1"]')?.click();
      await flush();
      expect(row('glm-1')?.textContent).toContain('Test passed in 112ms.');
      let fail: () => void = () => undefined;
      state.testCliConnection.mockImplementationOnce(async () => {
        // The real state drops the previous result when a run starts.
        state.cliTest.set({ status: 'loading', data: null, error: null });
        await new Promise<void>((resolve) => {
          fail = resolve;
        });
        state.cliTest.set({
          status: 'error',
          data: null,
          error: 'Could not load this section. Retry.',
        });
      });
      q<HTMLButtonElement>('[data-testid="cli-matrix-test-glm-1"]')?.click();
      fixture.detectChanges();
      expect(
        row('glm-1')?.querySelector('[data-testid="cli-matrix-test-result"]'),
      ).toBeNull();
      expect(statusOf('glm-1')).toBe('Ready');
      fail();
      await flush();
      expect(
        row('glm-1')
          ?.querySelector('[data-testid="cli-matrix-test-result"]')
          ?.textContent?.trim(),
      ).toBe('The test could not run. Try again.');
      expect(row('glm-1')?.textContent).not.toContain('Test passed');
    });

    it('V36-2: the Test result line is 12 px (text-xs)', async () => {
      q<HTMLButtonElement>('[data-testid="cli-matrix-test-glm-1"]')?.click();
      await flush();
      expect(
        row('glm-1')?.querySelector('[data-testid="cli-matrix-test-result"]')
          ?.className,
      ).toContain('text-xs');
    });

    it('says when the test itself could not run', async () => {
      state.testCliConnection.mockImplementationOnce(async () => {
        state.cliTest.set({
          status: 'error',
          data: null,
          error: 'Could not load this section. Retry.',
        });
      });
      q<HTMLButtonElement>('[data-testid="cli-matrix-test-glm-1"]')?.click();
      await flush();
      expect(
        row('glm-1')?.querySelector('[data-testid="cli-matrix-test-result"]')
          ?.textContent,
      ).toContain('could not run');
    });

    it("M4 / Minor 2: a create runs the new instance's Test; from the empty-state button focus moves to its first action", async () => {
      state.cliAgents.set(ready([]));
      fixture.detectChanges();
      Array.from(
        q('[data-testid="cli-matrix-no-instances"]')?.querySelectorAll(
          'button',
        ) ?? [],
      )[0]?.click();
      fixture.detectChanges();
      state.cliAgents.set(ready([{ ...GLM, id: 'kimi-9', name: 'Kimi' }]));
      state.cliModels.set(
        ready({ 'kimi-9': { selectedModel: '', tierMappings: {} } }),
      );
      fixture.debugElement
        .query((node) => node.name === 'ptah-add-cli-instance-modal')
        ?.triggerEventHandler('created', 'kimi');
      fixture.debugElement
        .query((node) => node.name === 'ptah-add-cli-instance-modal')
        ?.triggerEventHandler('closed');
      render();
      expect(state.testCliConnection).toHaveBeenCalledWith('kimi-9');
      expect(document.activeElement).toBe(
        q('[data-testid="cli-matrix-tiers-kimi-9"]'),
      );
    });

    it('re-check N-1: a create the refreshed list does not hold runs no Test and says so in a fixed toast', () => {
      fixture.debugElement
        .query((node) => node.name === 'ptah-add-cli-instance-modal')
        ?.triggerEventHandler('created', 'Kimi');
      expect(state.testCliConnection).not.toHaveBeenCalled();
      expect(feedback.toast()).toEqual({
        tone: 'alert',
        canUndo: false,
        message:
          'Created Kimi. Its connection test did not start. Use Test on its row once it shows.',
      });
    });

    it('renders no Test for system CLIs (D11)', () => {
      expect(
        row('codex')?.querySelector('[data-testid^="cli-matrix-test-"]'),
      ).toBeNull();
      expect(row('codex')?.querySelectorAll('td')[7]?.textContent?.trim()).toBe(
        '',
      );
    });
  });

  describe('Batch 52: live-shaped values', () => {
    beforeEach(() => {
      state.orchestration.set(
        ready({
          ...ORCHESTRATION,
          detectedClis: ORCHESTRATION.detectedClis.map((cli) =>
            cli.cli === 'codex'
              ? { ...cli, version: 'codex-cli 0.155.1' }
              : cli.cli === 'copilot'
                ? { ...cli, version: 'GitHub Copilot CLI 1.0.83.' }
                : cli.cli === 'opencode'
                  ? { ...cli, version: 'opencode v2.0.12' }
                  : cli,
          ),
          antigravityModel: 'claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)',
        }),
      );
      fixture.detectChanges();
    });

    it("52.1: the version beside the name is the normalised token, on the name's line, with the CLI line as its title", () => {
      const version = (id: string) =>
        row(id)?.querySelector('[data-testid="cli-matrix-version"]');
      expect(version('codex')?.textContent?.trim()).toBe('v0.155.1');
      expect(version('codex')?.getAttribute('title')).toBe('codex-cli 0.155.1');
      expect(version('copilot')?.textContent?.trim()).toBe('v1.0.83');
      expect(version('opencode')?.textContent?.trim()).toBe('v2.0.12');
      expect(version('codex')?.className).toContain('truncate');
      expect(version('codex')?.parentElement?.className).toContain(
        'flex-nowrap',
      );
      expect(row('codex')?.textContent).not.toContain('vcodex');
    });

    it('52.2: the model cell shows the model id once (at most two lines), with the display name in its title', () => {
      const cell = q<HTMLButtonElement>(
        '[data-testid="cli-matrix-model-antigravity"]',
      );
      expect(cell?.querySelector('span')?.textContent?.trim()).toBe(
        'claude-sonnet-4-6',
      );
      expect(cell?.querySelector('span')?.className).toContain('line-clamp-2');
      expect(cell?.getAttribute('title')).toBe(
        'claude-sonnet-4-6 (Claude Sonnet 4.6 (Thinking))',
      );
      expect(cell?.getAttribute('aria-label')).toBe(
        'Antigravity model: claude-sonnet-4-6. Change',
      );
    });
  });
});
