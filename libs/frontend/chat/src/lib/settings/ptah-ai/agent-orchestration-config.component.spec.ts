import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  ProvidersSettingsStateService, type ProvidersOrchestration, type ProvidersSettingsCommit, type ProvidersSettingsPatch,
  type ProvidersSettingsSection,
} from '@ptah-extension/core';
import type { CliDetectionResult, PtahCliSummary } from '@ptah-extension/shared';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';
import { AgentOrchestrationConfigComponent } from './agent-orchestration-config.component';

const ready = <T,>(data: T): ProvidersSettingsSection<T> => ({ status: 'ready', data, error: null });
const unloaded = <T,>(): ProvidersSettingsSection<T> => ({ status: 'unloaded', data: null, error: null });
const idle: ProvidersSettingsCommit = { status: 'idle', saved: [], unsaved: [], unconfirmed: [], refreshFailed: false, message: null };
const CONTEXT = { scopeKey: 'workspace', activePath: '/ws' };
const HOST_ERROR = 'EACCES: permission denied, open /home/user/.config/settings.json';

const detected = (cli: CliDetectionResult['cli'], installed: boolean, extra: Partial<CliDetectionResult> = {}): CliDetectionResult =>
  ({ cli, installed, messagingMode: 'none', ...extra });

/** The prototype data set (BRIEF): 4 ranked agents, OpenCode unranked, Copilot off, Cursor and Pi not installed. */
const ORCHESTRATION = {
  detectedClis: [
    detected('codex', true, { version: '1.4.0' }), detected('copilot', true), detected('cursor', false),
    detected('antigravity', true), detected('opencode', true), detected('pi', false),
    detected('ptah-cli', true, { ptahCliId: 'glm-1', ptahCliName: 'Glm' }),
  ],
  disabledClis: ['copilot'], preferredAgentOrder: ['codex', 'antigravity', 'glm-1', 'copilot'], maxConcurrentAgents: 3,
  copilotAutoApprove: false,
  codexModel: '', copilotModel: '', cursorModel: '', antigravityModel: '', opencodeModel: '', piModel: '',
  codexReasoningEffort: '', copilotReasoningEffort: '', piReasoningEffort: '',
  cursorApiKeyConfigured: false, cursorApiKeyStored: false, cursorApiKeyEnvSet: false,
} as ProvidersOrchestration;
const GLM: PtahCliSummary = {
  id: 'glm-1', name: 'Glm', providerName: 'Ollama Cloud', providerId: 'ollama-cloud',
  hasApiKey: true, hasStoredKey: true, status: 'available', enabled: true, modelCount: 12,
};

/** The shared state: `saveSettings` applies the patch and records a `saved` commit, like a confirmed read-back. */
class StateStub {
  readonly commit = signal<ProvidersSettingsCommit>(idle);
  readonly orchestration = signal<ProvidersSettingsSection<ProvidersOrchestration>>(ready(ORCHESTRATION));
  readonly cliAgents = signal<ProvidersSettingsSection<PtahCliSummary[]>>(ready([GLM]));
  readonly cliDetection = signal<ProvidersSettingsSection<CliDetectionResult[]>>(unloaded());
  readonly scopes = signal<ProvidersSettingsSection<{ activePath: string; entries: unknown[] }>>(ready({ activePath: '/ws', entries: [] }));
  readonly reviewContext = jest.fn(() => (this.scopes().status === 'ready' ? CONTEXT : null));
  /** `false` makes the next writes fail without changing the saved values. */
  persist = true;
  readonly saveSettings = jest.fn(async (patch: ProvidersSettingsPatch, _context: unknown) => {
    if (!this.persist) {
      this.commit.set({ ...idle, status: 'failed', unsaved: ['Orchestration policy'], message: 'Nothing was saved.' });
      return true;
    }
    const data = this.orchestration().data;
    if (data) this.orchestration.set(ready({ ...data, ...patch.orchestration } as ProvidersOrchestration));
    this.commit.set({ ...idle, status: 'saved', saved: ['Orchestration policy'] });
    return true;
  });
  readonly redetectClis = jest.fn(async () => { this.cliDetection.set(ready([])); });
}

describe('AgentOrchestrationConfigComponent (policy bar, Batch 33)', () => {
  let fixture: ComponentFixture<AgentOrchestrationConfigComponent>;
  let state: StateStub;
  let feedback: SettingsSaveFeedbackService;
  const element = () => fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement = HTMLElement>(selector: string) => element().querySelector(selector) as T | null;
  const slider = () => q<HTMLInputElement>('#agent-max-concurrent');
  const value = () => q('[data-testid="policy-max-concurrent-value"]')?.textContent?.trim();
  const chips = () => Array.from(element().querySelectorAll('[data-testid^="policy-order-chip-"]'))
    .map((chip) => chip.getAttribute('data-testid')?.replace('policy-order-chip-', ''));
  const button = (testid: string) => q<HTMLButtonElement>(`[data-testid="${testid}"]`);
  const popover = () => q('[data-testid="policy-order-popover"]');
  const rows = () => Array.from(element().querySelectorAll('[data-testid^="policy-order-row-"]'))
    .map((row) => row.getAttribute('data-testid')?.replace('policy-order-row-', ''));
  async function flush() { for (let i = 0; i < 8; i += 1) await Promise.resolve(); fixture.detectChanges(); }
  async function openOrder() {
    button('policy-order-edit')?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    if (!popover()) throw new Error('Order popover did not open');
  }
  /**
   * The next write stays in flight (commit `saving`, as the real state reports it) until the returned function is
   * called; it then applies the patch like the default stub.
   */
  function deferNextSave(): (saved: boolean) => void {
    let finish: (saved: boolean) => void = () => undefined;
    state.saveSettings.mockImplementationOnce((patch) => {
      state.commit.set({ ...idle, status: 'saving' });
      return new Promise<boolean>((resolve) => {
        finish = (saved) => {
          const data = state.orchestration().data;
          if (data) state.orchestration.set(ready({ ...data, ...patch.orchestration } as ProvidersOrchestration));
          state.commit.set({ ...idle, status: 'saved', saved: ['Orchestration policy'] });
          resolve(saved);
        };
      });
    });
    return (saved) => finish(saved);
  }
  function slide(to: number, event: 'input' | 'change') {
    const input = slider();
    if (!input) throw new Error('No slider');
    input.value = String(to);
    input.dispatchEvent(new Event(event));
  }

  beforeEach(() => {
    state = new StateStub();
    // No ClaudeRpcService is provided: the bar has no private RPC path left.
    TestBed.configureTestingModule({
      imports: [AgentOrchestrationConfigComponent],
      providers: [{ provide: ProvidersSettingsStateService, useValue: state }, SettingsSaveFeedbackService],
    });
    feedback = TestBed.inject(SettingsSaveFeedbackService);
    fixture = TestBed.createComponent(AgentOrchestrationConfigComponent);
    fixture.detectChanges();
  });
  afterEach(() => { feedback.dismiss(); TestBed.resetTestingModule(); });

  describe('structure (design-spec §1.2 item 2, deviation 5, RUX-9)', () => {
    it('is one policy bar with the slider, the order chips and Re-detect', () => {
      const bar = q('[data-testid="orchestration-policy-bar"]');
      expect(bar).not.toBeNull();
      expect(bar?.querySelector('#agent-max-concurrent')).not.toBeNull();
      expect(bar?.querySelector('[data-testid="policy-order"]')).not.toBeNull();
      expect(bar?.querySelector('[data-testid="policy-order-edit"]')?.className).toContain('h-6');
      expect(button('policy-redetect')?.getAttribute('aria-label')).toBe('Re-detect CLI agents');
      expect(button('policy-redetect')?.textContent).toContain('Re-detect CLIs');
    });

    it('keeps none of the old body: no Copilot toggle, no CLI cards, no "Manage … in Providers" repeats (RUX-9)', () => {
      const text = element().textContent ?? '';
      expect(q('[data-testid="copilot-auto-approve"]')).toBeNull();
      expect(text).not.toMatch(/Manage .* in Providers/);
      expect(text).not.toMatch(/codex automatic approval/i);
      expect(text).not.toContain('System CLIs');
      expect(text).not.toContain('Headless agents');
      expect(element().querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    });

    it('shows the order as compact read-only chips with no move buttons on the bar (deviation 5: no grip, no drag)', () => {
      const bar = q('[data-testid="orchestration-policy-bar"]');
      expect(bar?.querySelectorAll('[data-testid^="policy-order-up-"], [data-testid^="policy-order-down-"]')).toHaveLength(0);
      expect(Array.from(q('[data-testid="policy-order"]')?.children ?? []).map((node) => node.textContent?.trim()))
        .toEqual(['1. Codex', '→', '2. Antigravity', '→', '3. Glm', '→', '4. Copilot', '→', '5. OpenCode']);
      expect(element().innerHTML).not.toMatch(/grip/i);
      expect(element().querySelector('[draggable="true"]')).toBeNull();
      expect(element().querySelector('.cursor-grab')).toBeNull();
    });

    it('names the whole order on the trigger (the chips may clip in a narrow box)', () => {
      const trigger = button('policy-order-edit');
      expect(trigger?.getAttribute('aria-label'))
        .toBe('Preferred order: 1. Codex, 2. Antigravity, 3. Glm, 4. Copilot (off), 5. OpenCode. Edit order');
      expect(trigger?.getAttribute('aria-haspopup')).toBe('dialog');
      expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    });
  });

  describe('max concurrent agents (#74, plan §3 row 891)', () => {
    it('is a 1-20 range showing the saved value', () => {
      expect(slider()?.min).toBe('1');
      expect(slider()?.max).toBe('20');
      expect(slider()?.valueAsNumber).toBe(3);
      expect(value()).toBe('3');
      expect(q('label[for="agent-max-concurrent"]')?.textContent).toContain('Max Concurrent');
    });

    it('shows the live value while dragging and saves nothing until release', () => {
      slide(7, 'input');
      fixture.detectChanges();
      expect(value()).toBe('7');
      expect(slider()?.getAttribute('aria-valuetext')).toBe('7 agents at once');
      expect(state.saveSettings).not.toHaveBeenCalled();
    });

    it('saves on release through the state, with a toast and an Undo that writes the previous value', async () => {
      slide(7, 'input');
      slide(7, 'change');
      await flush();
      expect(state.saveSettings).toHaveBeenCalledWith({ orchestration: { maxConcurrentAgents: 7 } }, CONTEXT);
      expect(value()).toBe('7');
      expect(feedback.toast()).toEqual({ tone: 'status', message: 'Saved max concurrent agents to All Ptah apps.', canUndo: true });
      await feedback.undo();
      await flush();
      expect(state.saveSettings).toHaveBeenLastCalledWith({ orchestration: { maxConcurrentAgents: 3 } }, CONTEXT);
      expect(value()).toBe('3');
    });

    it('D15: a failed save shows the saved value again and an alert, never "Saved"', async () => {
      state.persist = false;
      slide(9, 'input');
      slide(9, 'change');
      await flush();
      expect(value()).toBe('3');
      expect(slider()?.valueAsNumber).toBe(3);
      expect(feedback.toast()?.tone).toBe('alert');
      expect(feedback.toast()?.message).toContain('Could not save max concurrent agents.');
    });

    it('writes nothing when released on the saved value or before the state is read', async () => {
      slide(3, 'change');
      await flush();
      expect(state.saveSettings).not.toHaveBeenCalled();
      state.orchestration.set(unloaded());
      fixture.detectChanges();
      expect(value()).toBe('—');
      expect(slider()?.disabled).toBe(true);
    });
  });

  describe('preferred order popover (#73, plan §3 row 892)', () => {
    it('opens a dialog listing the installed agents in the matrix order, with 24 px ▲/▼ per row', async () => {
      await openOrder();
      expect(popover()?.getAttribute('role')).toBe('dialog');
      expect(button('policy-order-edit')?.getAttribute('aria-expanded')).toBe('true');
      expect(rows()).toEqual(['codex', 'antigravity', 'glm-1', 'copilot', 'opencode']);
      expect(q('[data-testid="policy-order-row-copilot"]')?.textContent).toContain('off');
      const up = button('policy-order-up-antigravity');
      expect(up?.getAttribute('aria-label')).toBe('Move Antigravity up');
      expect(button('policy-order-down-antigravity')?.getAttribute('aria-label')).toBe('Move Antigravity down');
      for (const size of ['h-6', 'min-h-6', 'w-6']) expect(up?.className).toContain(size);
    });

    it('disables ▲ on the first row and ▼ on the last', async () => {
      await openOrder();
      expect(button('policy-order-up-codex')?.disabled).toBe(true);
      expect(button('policy-order-down-codex')?.disabled).toBe(false);
      expect(button('policy-order-up-opencode')?.disabled).toBe(false);
      expect(button('policy-order-down-opencode')?.disabled).toBe(true);
    });

    it('moves an agent down, then up, writing the whole order each time, with Undo', async () => {
      await openOrder();
      button('policy-order-down-codex')?.click();
      await flush();
      expect(state.saveSettings).toHaveBeenLastCalledWith(
        { orchestration: { preferredAgentOrder: ['antigravity', 'codex', 'glm-1', 'copilot', 'opencode'] } }, CONTEXT);
      expect(rows()).toEqual(['antigravity', 'codex', 'glm-1', 'copilot', 'opencode']);
      expect(chips()).toEqual(['antigravity', 'codex', 'glm-1', 'copilot', 'opencode']);
      expect(feedback.toast()?.message).toBe('Saved preferred agent order to All Ptah apps.');
      button('policy-order-up-opencode')?.click();
      await flush();
      expect(state.saveSettings).toHaveBeenLastCalledWith(
        { orchestration: { preferredAgentOrder: ['antigravity', 'codex', 'glm-1', 'opencode', 'copilot'] } }, CONTEXT);
      await feedback.undo();
      await flush();
      expect(state.saveSettings).toHaveBeenLastCalledWith(
        { orchestration: { preferredAgentOrder: ['antigravity', 'codex', 'glm-1', 'copilot', 'opencode'] } }, CONTEXT);
      expect(q('[data-testid="policy-order-error"]')).toBeNull();
    });

    it('keeps focus on the moved row: the button used, or its other one at the end', async () => {
      await openOrder();
      button('policy-order-down-glm-1')?.click();
      await flush();
      TestBed.tick();
      expect(document.activeElement).toBe(button('policy-order-down-glm-1'));
      button('policy-order-down-glm-1')?.click();
      await flush();
      TestBed.tick();
      expect(rows()).toEqual(['codex', 'antigravity', 'copilot', 'opencode', 'glm-1']);
      expect(document.activeElement).toBe(button('policy-order-up-glm-1'));
    });

    it('D15: a failed move keeps the saved order and shows a fixed sentence, never the host text', async () => {
      state.persist = false;
      state.saveSettings.mockImplementation(async () => {
        state.commit.set({ ...idle, status: 'failed', unsaved: ['Orchestration policy'], message: HOST_ERROR });
        return true;
      });
      await openOrder();
      button('policy-order-down-codex')?.click();
      await flush();
      expect(rows()).toEqual(['codex', 'antigravity', 'glm-1', 'copilot', 'opencode']);
      expect(q('[data-testid="policy-order-error"]')?.textContent?.trim())
        .toBe('Could not save the preferred order. The order shown is the saved one.');
      expect(popover()?.textContent).not.toContain('EACCES');
      expect(feedback.toast()?.tone).toBe('alert');
    });

    it('m-1: a refused move shows its own sentence even when commit() still says an earlier save was "saved"', async () => {
      state.commit.set({ ...idle, status: 'saved', saved: ['Orchestration policy'] });
      state.saveSettings.mockImplementationOnce(async () => false);
      await openOrder();
      button('policy-order-down-codex')?.click();
      await flush();
      expect(state.commit().status).toBe('saved');
      expect(rows()).toEqual(['codex', 'antigravity', 'glm-1', 'copilot', 'opencode']);
      expect(q('[data-testid="policy-order-error"]')?.textContent?.trim())
        .toBe('Could not save the preferred order. The order shown is the saved one.');
      expect(feedback.toast()).toEqual({ tone: 'alert', message: 'Another change is still saving.', canUndo: false });
    });

    it('m-1: a write that throws shows the popover sentence too', async () => {
      state.commit.set({ ...idle, status: 'saved', saved: ['Orchestration policy'] });
      state.saveSettings.mockImplementationOnce(async () => { throw new Error(HOST_ERROR); });
      await openOrder();
      button('policy-order-down-codex')?.click();
      await flush();
      expect(q('[data-testid="policy-order-error"]')?.textContent?.trim())
        .toBe('Could not save the preferred order. The order shown is the saved one.');
      expect(popover()?.textContent).not.toContain('EACCES');
    });

    it('V36-8: the popover is titled by a non-heading element (no skipped heading level)', async () => {
      await openOrder();
      const title = q('#policy-order-title');
      expect(title?.tagName).toBe('P');
      expect(title?.textContent?.trim()).toBe('Preferred order');
      expect(popover()?.getAttribute('aria-labelledby')).toBe('policy-order-title');
      expect(popover()?.querySelector('h1, h2, h3, h4, h5, h6')).toBeNull();
    });

    it('V36-2: helper text is at least 12 px (text-xs); no 10 or 11 px text outside the btn-xs label', async () => {
      await openOrder();
      const small = Array.from(element().querySelectorAll<HTMLElement>('[class*="text-[10px]"], [class*="text-[11px]"]'))
        .filter((node) => !node.classList.contains('btn'));
      expect(small).toHaveLength(0);
      expect(q('[data-testid="policy-order"]')?.className).toContain('text-xs');
    });

    it('closes on Escape and returns focus to the trigger', async () => {
      const trigger = button('policy-order-edit');
      trigger?.focus();
      await openOrder();
      popover()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await flush();
      expect(popover()).toBeNull();
      expect(trigger?.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(trigger);
    });

    it('cannot reorder until both the policy and the instances are read (an order from one would drop the other)', async () => {
      state.cliAgents.set(unloaded());
      fixture.detectChanges();
      expect(chips()).toEqual(['codex', 'antigravity', 'copilot', 'opencode']);
      await openOrder();
      const down = button('policy-order-down-codex');
      expect(down?.getAttribute('aria-disabled')).toBe('true');
      down?.click();
      await flush();
      expect(state.saveSettings).not.toHaveBeenCalled();
    });

    it('cannot reorder while a save runs (D3): the buttons are aria-disabled and ignore clicks, not natively disabled', async () => {
      await openOrder();
      expect(button('policy-order-down-codex')?.hasAttribute('aria-disabled')).toBe(false);
      const finish = deferNextSave();
      button('policy-order-down-codex')?.click();
      await flush();
      expect(state.saveSettings).toHaveBeenCalledTimes(1);
      const down = button('policy-order-down-antigravity');
      expect(down?.getAttribute('aria-disabled')).toBe('true');
      // Native `disabled` only marks the ends; a disabled focused button would drop focus to the page (Batch 36).
      expect(down?.disabled).toBe(false);
      down?.click();
      await flush();
      expect(state.saveSettings).toHaveBeenCalledTimes(1);
      finish(true);
      await flush();
      expect(button('policy-order-down-antigravity')?.hasAttribute('aria-disabled')).toBe(false);
    });

    it('keeps focus on the button used while the save runs, and Esc then closes and returns focus to the trigger', async () => {
      const trigger = button('policy-order-edit');
      trigger?.focus();
      await openOrder();
      const finish = deferNextSave();
      const down = button('policy-order-down-codex');
      down?.focus();
      down?.click();
      await flush();
      // Saving: the button is aria-disabled, still focusable, and keeps focus.
      expect(down?.getAttribute('aria-disabled')).toBe('true');
      expect(document.activeElement).toBe(down);
      popover()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await flush();
      expect(popover()).toBeNull();
      expect(document.activeElement).toBe(trigger);
      // The save finishing later neither reopens the popover nor takes focus from the trigger.
      finish(true);
      await flush();
      TestBed.tick();
      expect(popover()).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });

    it('says so when no agent is installed', () => {
      state.orchestration.set(ready({ ...ORCHESTRATION, detectedClis: [detected('pi', false)] }));
      state.cliAgents.set(ready([]));
      fixture.detectChanges();
      expect(q('[data-testid="policy-order-empty"]')?.textContent?.trim()).toBe('No CLI agent installed yet.');
      expect(button('policy-order-edit')).toBeNull();
    });
  });

  describe('Re-detect (#72)', () => {
    it('re-detects through the state and announces completion', async () => {
      button('policy-redetect')?.click();
      await flush();
      expect(state.redetectClis).toHaveBeenCalledTimes(1);
      expect(q('[role="status"]')?.textContent?.trim()).toBe('CLI agents re-detected.');
      expect(q('[data-testid="policy-redetect-error"]')).toBeNull();
    });

    it('is disabled with a spinner while detection runs', () => {
      state.cliDetection.set({ status: 'loading', data: null, error: null });
      fixture.detectChanges();
      expect(button('policy-redetect')?.disabled).toBe(true);
      expect(button('policy-redetect')?.textContent).toContain('Detecting…');
    });

    it.each([
      ['a failed detection', async (s: StateStub) => { s.cliDetection.set({ status: 'error', data: null, error: HOST_ERROR }); }],
      ['a thrown command', async () => { throw new Error(HOST_ERROR); }],
    ])('shows a fixed sentence after %s, never the host text', async (_label, run) => {
      state.redetectClis.mockImplementation(() => run(state));
      button('policy-redetect')?.click();
      await flush();
      expect(q('[data-testid="policy-redetect-error"]')?.textContent?.trim())
        .toBe('Could not re-detect CLI agents. Your saved settings have not changed.');
      expect(element().textContent).not.toContain('EACCES');
      expect(button('policy-redetect')?.disabled).toBe(false);
    });
  });
});
