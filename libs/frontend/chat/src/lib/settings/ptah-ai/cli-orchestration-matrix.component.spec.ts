import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  ProvidersSettingsStateService, type ProvidersCliModels, type ProvidersCliTest, type ProvidersOrchestration,
  type ProvidersSettingsCommit, type ProvidersSettingsSection,
} from '@ptah-extension/core';
import { PROVIDER_MODELS_LOADER } from '@ptah-extension/ui';
import type { CliDetectionResult, PtahCliSummary } from '@ptah-extension/shared';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';
import { CLI_INSTALL_GUIDES, CliOrchestrationMatrixComponent } from './cli-orchestration-matrix.component';

const ready = <T,>(data: T): ProvidersSettingsSection<T> => ({ status: 'ready', data, error: null });
const unloaded = <T,>(): ProvidersSettingsSection<T> => ({ status: 'unloaded', data: null, error: null });
const idle: ProvidersSettingsCommit = { status: 'idle', saved: [], unsaved: [], unconfirmed: [], refreshFailed: false, message: null };
const CONTEXT = { scopeKey: 'workspace', activePath: '/ws' };

const detected = (cli: CliDetectionResult['cli'], installed: boolean, extra: Partial<CliDetectionResult> = {}): CliDetectionResult =>
  ({ cli, installed, messagingMode: 'none', ...extra });

/** The prototype data set (BRIEF), minus the quota state (D11). */
const ORCHESTRATION: ProvidersOrchestration = {
  detectedClis: [
    detected('codex', true, { version: '1.4.0' }), detected('copilot', true, { version: '0.9.2' }), detected('cursor', false),
    detected('antigravity', true, { version: '2.1.0' }), detected('opencode', true, { version: '0.6.0' }), detected('pi', false),
    detected('ptah-cli', true, { ptahCliId: 'glm-1', ptahCliName: 'Glm' }),
  ],
  disabledClis: ['copilot'], preferredAgentOrder: ['codex', 'antigravity', 'glm-1', 'copilot'], maxConcurrentAgents: 3,
  copilotAutoApprove: false,
  codexModel: 'gpt-5.5-codex', copilotModel: '', cursorModel: '', antigravityModel: 'claude-sonnet-4-6',
  opencodeModel: 'opencode/nemotron-3-ultra-free', piModel: '',
  codexReasoningEffort: 'medium', copilotReasoningEffort: '', piReasoningEffort: '',
  cursorApiKeyConfigured: false, cursorApiKeyStored: false, cursorApiKeyEnvSet: false,
};
const GLM: PtahCliSummary = {
  id: 'glm-1', name: 'Glm', providerName: 'Ollama Cloud', providerId: 'ollama-cloud',
  hasApiKey: true, hasStoredKey: true, status: 'available', enabled: true, modelCount: 12,
};
const MODELS: ProvidersCliModels = { 'glm-1': { selectedModel: 'glm-5.3:cloud', tierMappings: { sonnet: 'glm-5.3', opus: 'glm-4.7', haiku: 'glm-4.5' } } };

class StateStub {
  readonly commit = signal<ProvidersSettingsCommit>(idle);
  readonly orchestration = signal<ProvidersSettingsSection<ProvidersOrchestration>>(ready(ORCHESTRATION));
  readonly cliAgents = signal<ProvidersSettingsSection<PtahCliSummary[]>>(ready([GLM]));
  readonly cliModels = signal<ProvidersSettingsSection<ProvidersCliModels>>(ready(MODELS));
  readonly cliTest = signal<ProvidersSettingsSection<ProvidersCliTest>>(unloaded());
  readonly scopes = signal<ProvidersSettingsSection<{ activePath: string; entries: unknown[] }>>(ready({ activePath: '/ws', entries: [] }));
  readonly delegatedModelOptions = signal(ready({ codex: [], copilot: [], cursor: [], antigravity: [], opencode: [], pi: [] }));
  readonly refreshDelegatedModelOptions = jest.fn(async () => undefined);
  readonly reviewContext = jest.fn(() => (this.scopes().status === 'ready' ? CONTEXT : null));
  readonly saveSettings = jest.fn(async (_patch: unknown, _context: unknown) => {
    this.commit.set({ ...idle, status: 'saved' });
    return true;
  });
  /** Resolves with the result `ptahCli:testConnection` would have produced. */
  testResult: ProvidersCliTest = { id: 'glm-1', success: true, latencyMs: 112, reason: null };
  readonly testCliConnection = jest.fn(async (_id: string) => { this.cliTest.set(ready(this.testResult)); });
}

describe('CliOrchestrationMatrixComponent', () => {
  let fixture: ComponentFixture<CliOrchestrationMatrixComponent>;
  let state: StateStub;
  let feedback: SettingsSaveFeedbackService;
  const element = () => fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement = HTMLElement>(selector: string) => element().querySelector(selector) as T | null;
  const row = (id: string) => q(`[data-testid="cli-matrix-row-${id}"]`);
  const rowIds = (selector: string) => Array.from(element().querySelectorAll(`${selector} tr[data-testid^="cli-matrix-row-"]`))
    .map((node) => node.getAttribute('data-testid')?.replace('cli-matrix-row-', ''));
  const statusOf = (id: string) => row(id)?.querySelector('[data-testid="cli-matrix-status"]')?.textContent?.trim();
  async function flush() { for (let i = 0; i < 8; i += 1) await Promise.resolve(); fixture.detectChanges(); }
  function check(id: string, checked: boolean) {
    const input = q<HTMLInputElement>(`[data-testid="cli-matrix-toggle-${id}"]`);
    if (!input) throw new Error(`No toggle for ${id}`);
    input.checked = checked;
    input.dispatchEvent(new Event('change'));
  }

  beforeEach(() => {
    Object.defineProperty(Element.prototype, 'scrollIntoView', { writable: true, configurable: true, value: jest.fn() });
    state = new StateStub();
    TestBed.configureTestingModule({
      imports: [CliOrchestrationMatrixComponent],
      providers: [
        { provide: ProvidersSettingsStateService, useValue: state },
        { provide: PROVIDER_MODELS_LOADER, useValue: { listModels: jest.fn(async () => ({ models: [], totalCount: 0 })) } },
        SettingsSaveFeedbackService,
      ],
    });
    feedback = TestBed.inject(SettingsSaveFeedbackService);
    fixture = TestBed.createComponent(CliOrchestrationMatrixComponent);
    fixture.detectChanges();
  });
  afterEach(() => { feedback.dismiss(); TestBed.resetTestingModule(); });

  describe('structure (prototype section 2, design-spec §3.5)', () => {
    it('is a table-xs with the prototype columns', () => {
      const table = q('[data-testid="cli-matrix"]');
      expect(table?.tagName).toBe('TABLE');
      expect(table?.className).toContain('table-xs');
      expect(Array.from(table?.querySelectorAll('thead th') ?? []).map((th) => th.textContent?.trim()))
        .toEqual(['On', 'Agent / Instance', 'Status', 'Provider', 'Model', 'Effort', 'Permissions & Safety', 'Actions']);
      expect(q('#cli-matrix-heading')?.textContent).toContain('CLI Agents & Custom Instances Matrix');
    });

    it('lists installed rows by preferred order, then the Uninstalled group (#71)', () => {
      expect(rowIds('tbody:not([data-testid="cli-matrix-uninstalled"])')).toEqual(['codex', 'antigravity', 'glm-1', 'copilot', 'opencode']);
      expect(rowIds('[data-testid="cli-matrix-uninstalled"]')).toEqual(['cursor', 'pi']);
      expect(q('[data-testid="cli-matrix-uninstalled"] th')?.textContent).toContain('Uninstalled CLI agents');
    });

    it('omits the Uninstalled group when every CLI is installed', () => {
      state.orchestration.set(ready({ ...ORCHESTRATION, detectedClis: [detected('codex', true)] }));
      fixture.detectChanges();
      expect(q('[data-testid="cli-matrix-uninstalled"]')).toBeNull();
    });

    it('shows an empty state with no installed CLI and no instance, and a loading one before any read', () => {
      state.orchestration.set(ready({ ...ORCHESTRATION, detectedClis: [detected('pi', false)] }));
      state.cliAgents.set(ready([]));
      fixture.detectChanges();
      expect(q('[data-testid="cli-matrix-empty"]')?.textContent).toContain('No CLI agent is installed');
      state.orchestration.set(unloaded());
      state.cliAgents.set(unloaded());
      fixture.detectChanges();
      expect(q('[data-testid="cli-matrix-empty"]')?.textContent).toContain('Loading CLI agents');
      expect(q('[data-testid="cli-matrix"]')?.getAttribute('aria-busy')).toBe('true');
    });

    it('shades disabled and uninstalled rows and keeps the table-xs density (Visual rounds 1-2, V30-4; V30-3 reverted)', () => {
      expect(q('[data-testid="cli-matrix"]')?.className).toContain('table-xs');
      expect(q('[data-testid="cli-matrix"]')?.className).not.toContain('py-3');
      for (const id of ['copilot', 'cursor', 'pi']) {
        expect(row(id)?.className).toContain('bg-base-300/50');
        expect(row(id)?.getAttribute('data-dimmed')).toBe('true');
      }
      for (const id of ['codex', 'glm-1']) expect(row(id)?.getAttribute('data-dimmed')).toBeNull();
      expect(row('glm-1')?.className).toContain('bg-primary/5');
      state.cliAgents.set(ready([{ ...GLM, enabled: false }]));
      fixture.detectChanges();
      expect(row('glm-1')?.className).toContain('bg-base-300/50');
      expect(row('glm-1')?.className).not.toContain('bg-primary/5');
    });

    it('renders no Add, Tiers, Edit or Credentials control before their batches (no dead controls)', () => {
      const labels = Array.from(element().querySelectorAll('button')).map((button) => button.textContent?.trim() ?? '');
      for (const name of ['Add Ptah CLI Instance', 'Tiers', 'Edit', 'Credentials']) expect(labels).not.toContain(name);
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
      state.cliTest.set(ready({ id: 'glm-1', success: true, latencyMs: 112, reason: null }));
      fixture.detectChanges();
      expect(statusOf('glm-1')).toBe('Ready (112ms)');
    });

    it('shows the instance key status and tier badges (#44, #54) and its Ptah CLI badge', () => {
      const subline = row('glm-1')?.querySelector('[data-testid="cli-matrix-instance-subline"]');
      expect(subline?.querySelector('[data-testid="cli-matrix-key-status"]')?.textContent?.trim()).toBe('Key set');
      expect(Array.from(subline?.querySelectorAll('[data-tier]') ?? []).map((node) => node.textContent?.trim()))
        .toEqual(['Sonnet: glm-5.3', 'Opus: glm-4.7', 'Haiku: glm-4.5']);
      expect(row('glm-1')?.textContent).toContain('Ptah CLI');
    });

    it('shows versions, providers and the CLI defaults', () => {
      expect(row('codex')?.textContent).toContain('v1.4.0');
      expect(row('codex')?.textContent).toContain('OpenAI Codex');
      expect(row('opencode')?.textContent).toContain('opencode');
      expect(row('pi')?.textContent).toContain('None');
      expect(q('[data-testid="cli-matrix-effort-antigravity"]')).toBeNull();
      expect(row('antigravity')?.textContent).toContain('n/a');
      expect(row('glm-1')?.textContent).toContain('mapped');
    });

    it('makes model and effort cells buttons only on enabled, installed rows', () => {
      expect(q('[data-testid="cli-matrix-model-codex"]')?.tagName).toBe('BUTTON');
      expect(q('[data-testid="cli-matrix-effort-codex"]')?.textContent?.trim()).toBe('medium');
      expect(q('[data-testid="cli-matrix-model-glm-1"]')?.textContent?.trim()).toBe('glm-5.3:cloud');
      // Disabled (Copilot) and not installed (Pi): plain text.
      expect(q('[data-testid="cli-matrix-model-copilot"]')).toBeNull();
      expect(row('copilot')?.textContent).toContain('provider default');
      expect(q('[data-testid="cli-matrix-model-pi"]')).toBeNull();
      expect(row('pi')?.querySelectorAll('td')[4]?.textContent?.trim()).toBe('—');
    });

    it('keeps badge and status text base-content; colour sits on dots and badge fills (deviation 6)', () => {
      const permission = row('codex')?.querySelector('[data-testid="cli-matrix-permission"]');
      expect(permission?.textContent?.trim()).toBe('Full auto');
      expect(permission?.className).toContain('text-base-content');
      expect(permission?.className).toContain('bg-warning/10');
      expect(row('codex')?.querySelector('[data-testid="cli-matrix-status"]')?.className).toContain('text-base-content');
      expect(row('codex')?.querySelector('[data-testid="cli-matrix-status"] .bg-success')).not.toBeNull();
      expect(row('copilot')?.querySelector('[data-testid="cli-matrix-permission"]')?.textContent?.trim()).toBe('Auto-approve: Off');
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
      expect(q('[data-testid="cli-matrix-model-codex"]')?.getAttribute('aria-expanded')).toBe('true');
      (panel?.querySelector('button[aria-label="Close"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(q('[data-testid="cli-matrix-popover"]')).toBeNull();
    });

    it('saves an effort in two clicks: cell, then value (RUX-8)', async () => {
      q<HTMLButtonElement>('[data-testid="cli-matrix-effort-codex"]')?.click();
      fixture.detectChanges();
      q<HTMLButtonElement>('[data-testid="cli-matrix-popover"] [data-effort="high"]')?.click();
      await flush();
      expect(state.saveSettings).toHaveBeenCalledTimes(1);
      expect(state.saveSettings).toHaveBeenCalledWith({ orchestration: { codexReasoningEffort: 'high' } }, CONTEXT);
      expect(q('[data-testid="cli-matrix-popover"]')).toBeNull();
    });

    it('shows each CLI\'s permission note in its ℹ popover (#70)', () => {
      q<HTMLButtonElement>('[data-testid="cli-matrix-permission-info-pi"]')?.click();
      fixture.detectChanges();
      const popover = q('[data-testid="cli-permission-popover"]');
      expect(popover?.textContent).toContain('Pi permissions');
      expect(popover?.textContent).toContain('No approval gate and no MCP support');
    });

    it('opens one popover at a time', () => {
      q<HTMLButtonElement>('[data-testid="cli-matrix-permission-info-codex"]')?.click();
      fixture.detectChanges();
      q<HTMLButtonElement>('[data-testid="cli-matrix-install-pi"]')?.click();
      fixture.detectChanges();
      expect(q('[data-testid="cli-permission-popover"]')).toBeNull();
      expect(q('[data-testid="cli-install-popover"]')?.textContent).toContain('npm install -g @earendil-works/pi-coding-agent');
    });

    it('has install copy for every system CLI, Codex and Copilot as before (#77)', () => {
      expect(CLI_INSTALL_GUIDES.codex.command).toBe('npm install -g @openai/codex');
      expect(CLI_INSTALL_GUIDES.copilot.command).toBe('npm install -g @github/copilot');
      for (const guide of Object.values(CLI_INSTALL_GUIDES)) expect(guide.note).toContain('Re-detect');
      q<HTMLButtonElement>('[data-testid="cli-matrix-install-cursor"]')?.click();
      fixture.detectChanges();
      expect(q('[data-testid="cli-install-popover"] code')).toBeNull();
      expect(q('[data-testid="cli-install-popover"]')?.textContent).toContain('CURSOR_API_KEY');
    });
  });

  describe('writes (every write is state.saveSettings through the feedback service)', () => {
    it('switches a system CLI off through disabledClis, with Undo', async () => {
      check('codex', false);
      await flush();
      expect(state.saveSettings).toHaveBeenCalledWith({ orchestration: { disabledClis: ['copilot', 'codex'] } }, CONTEXT);
      expect(feedback.toast()).toEqual({ tone: 'status', message: 'Saved Codex off to All Ptah apps.', canUndo: true });
      await feedback.undo();
      expect(state.saveSettings).toHaveBeenLastCalledWith({ orchestration: { disabledClis: ['copilot'] } }, CONTEXT);
    });

    it('switches a system CLI on by removing it from disabledClis', async () => {
      check('copilot', true);
      await flush();
      expect(state.saveSettings).toHaveBeenCalledWith({ orchestration: { disabledClis: [] } }, CONTEXT);
    });

    it('switches an instance through ptahCli:update.enabled, with Undo', async () => {
      check('glm-1', false);
      await flush();
      expect(state.saveSettings).toHaveBeenCalledWith({ cli: [{ action: 'update', params: { id: 'glm-1', enabled: false } }] }, CONTEXT);
      await feedback.undo();
      expect(state.saveSettings).toHaveBeenLastCalledWith({ cli: [{ action: 'update', params: { id: 'glm-1', enabled: true } }] }, CONTEXT);
    });

    it('keeps the checkbox on the saved value until the read-back moves it', async () => {
      check('codex', false);
      expect(q<HTMLInputElement>('[data-testid="cli-matrix-toggle-codex"]')?.checked).toBe(true);
      await flush();
    });

    it('disables uninstalled toggles, and every toggle while a save runs or the scopes are not loaded', () => {
      expect(q<HTMLInputElement>('[data-testid="cli-matrix-toggle-pi"]')?.disabled).toBe(true);
      expect(q<HTMLInputElement>('[data-testid="cli-matrix-toggle-pi"]')?.checked).toBe(false);
      state.commit.set({ ...idle, status: 'saving' });
      fixture.detectChanges();
      expect(q<HTMLInputElement>('[data-testid="cli-matrix-toggle-codex"]')?.disabled).toBe(true);
      state.commit.set(idle);
      state.scopes.set({ status: 'loading', data: null, error: null });
      fixture.detectChanges();
      expect(q<HTMLInputElement>('[data-testid="cli-matrix-toggle-glm-1"]')?.disabled).toBe(true);
    });

    it('deletes an instance after the inline confirm, with no Undo', async () => {
      q<HTMLButtonElement>('[data-testid="cli-matrix-delete-glm-1"]')?.click();
      fixture.detectChanges();
      expect(state.saveSettings).not.toHaveBeenCalled();
      expect(row('glm-1')?.textContent).toContain('Delete Glm?');
      q<HTMLButtonElement>('button[aria-label="Confirm delete Glm"]')?.click();
      await flush();
      expect(state.saveSettings).toHaveBeenCalledWith({ cli: [{ action: 'delete', params: { id: 'glm-1' } }] }, CONTEXT);
      expect(feedback.toast()?.canUndo).toBe(false);
    });

    it('cancels a delete without writing', () => {
      q<HTMLButtonElement>('[data-testid="cli-matrix-delete-glm-1"]')?.click();
      fixture.detectChanges();
      Array.from(row('glm-1')?.querySelectorAll('button') ?? []).find((button) => button.textContent?.trim() === 'Cancel')?.click();
      fixture.detectChanges();
      expect(q('[data-testid="cli-matrix-delete-glm-1"]')).not.toBeNull();
      expect(state.saveSettings).not.toHaveBeenCalled();
    });
  });

  describe('Test (#52, RUX-11)', () => {
    it('tests the instance and shows the latency inline', async () => {
      q<HTMLButtonElement>('[data-testid="cli-matrix-test-glm-1"]')?.click();
      await flush();
      expect(state.testCliConnection).toHaveBeenCalledWith('glm-1');
      expect(row('glm-1')?.querySelector('[data-testid="cli-matrix-test-result"]')?.textContent?.trim()).toBe('Test passed in 112ms.');
    });

    it('shows the host\'s failure reason inline as an alert', async () => {
      state.testResult = { id: 'glm-1', success: false, latencyMs: null, reason: 'Invalid API key.' };
      q<HTMLButtonElement>('[data-testid="cli-matrix-test-glm-1"]')?.click();
      await flush();
      const result = row('glm-1')?.querySelector('[data-testid="cli-matrix-test-result"]');
      expect(result?.textContent?.trim()).toBe('Test failed: Invalid API key.');
      expect(result?.getAttribute('role')).toBe('alert');
      expect(statusOf('glm-1')).toBe('Ready');
    });

    it('says when the test itself could not run', async () => {
      state.testCliConnection.mockImplementationOnce(async () => {
        state.cliTest.set({ status: 'error', data: null, error: 'Could not load this section. Retry.' });
      });
      q<HTMLButtonElement>('[data-testid="cli-matrix-test-glm-1"]')?.click();
      await flush();
      expect(row('glm-1')?.querySelector('[data-testid="cli-matrix-test-result"]')?.textContent).toContain('could not run');
    });

    it('renders no Test for system CLIs (D11)', () => {
      expect(row('codex')?.querySelector('[data-testid^="cli-matrix-test-"]')).toBeNull();
      expect(row('codex')?.querySelectorAll('td')[7]?.textContent?.trim()).toBe('');
    });
  });
});
