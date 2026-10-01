import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  ProvidersSettingsStateService, type ProvidersOrchestration, type ProvidersSettingsCommit, type ProvidersSettingsSection,
} from '@ptah-extension/core';
import { SAVE_REFUSED_MESSAGE, SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';
import { CopilotAutoApproveToggleComponent } from './copilot-auto-approve-toggle.component';

type Orchestration = Pick<ProvidersOrchestration, 'copilotAutoApprove'>;
const ready = <T,>(data: T): ProvidersSettingsSection<T> => ({ status: 'ready', data, error: null });
const idle: ProvidersSettingsCommit = { status: 'idle', saved: [], unsaved: [], unconfirmed: [], refreshFailed: false, message: null };
const CONTEXT = { scopeKey: 'workspace', activePath: '/ws' };

/**
 * Stands in for the state service. `saveSettings` settles a commit the way `ProvidersCommitService.run` does: the
 * host value changes only for a written save, then the orchestration section is re-read (or fails to be).
 */
class StateStub {
  readonly commit = signal<ProvidersSettingsCommit>(idle);
  readonly orchestration = signal<ProvidersSettingsSection<Orchestration>>(ready({ copilotAutoApprove: false }));
  readonly reviewContext = jest.fn(() => CONTEXT);
  /** The host's stored value. */
  host = false;
  /** What the next write does: `saved`, `rejected` (nothing written), `unconfirmed` (threw), `refused` (in flight). */
  next: 'saved' | 'rejected' | 'unconfirmed' | 'refused' = 'saved';
  /** Whether the re-read after a write (and `refreshOrchestration`) succeeds. */
  readable = true;
  readonly saveSettings = jest.fn(async (patch: { orchestration?: Orchestration }, _context: unknown) => {
    if (this.next === 'refused') return false;
    const value = patch.orchestration?.copilotAutoApprove;
    if (this.next === 'saved' && value !== undefined) this.host = value;
    // An unconfirmed write may have landed: the host flips it here to prove the toggle never trusts the value.
    if (this.next === 'unconfirmed' && value !== undefined) this.host = value;
    this.reread();
    const status = this.next === 'saved' ? 'saved' : this.next === 'rejected' ? 'failed' : 'unconfirmed';
    this.commit.set({ ...idle, status, unsaved: status === 'failed' ? ['agentOrchestration.copilotAutoApprove'] : [],
      unconfirmed: status === 'unconfirmed' ? ['agentOrchestration.copilotAutoApprove'] : [] });
    return true;
  });
  readonly refreshOrchestration = jest.fn(async () => this.reread());
  private reread(): void {
    this.orchestration.set(this.readable
      ? ready({ copilotAutoApprove: this.host })
      : { status: 'error', data: null, error: 'Could not load this section. Retry.' });
  }
}

describe('CopilotAutoApproveToggleComponent (moved from AgentOrchestrationConfigComponent)', () => {
  let fixture: ComponentFixture<CopilotAutoApproveToggleComponent>;
  let state: StateStub;
  let feedback: SettingsSaveFeedbackService;
  const el = () => fixture.nativeElement as HTMLElement;
  const toggle = () => el().querySelector<HTMLInputElement>('[data-testid="copilot-auto-approve"]');
  const error = () => el().querySelector('[data-testid="copilot-auto-approve-error"]')?.textContent?.trim() ?? null;
  const recheck = () => el().querySelector<HTMLButtonElement>('[data-testid="copilot-auto-approve-recheck"]');
  async function flush() { for (let i = 0; i < 8; i += 1) await Promise.resolve(); fixture.detectChanges(); }

  beforeEach(() => {
    state = new StateStub();
    TestBed.configureTestingModule({
      imports: [CopilotAutoApproveToggleComponent],
      providers: [{ provide: ProvidersSettingsStateService, useValue: state }, SettingsSaveFeedbackService],
    });
    feedback = TestBed.inject(SettingsSaveFeedbackService);
    fixture = TestBed.createComponent(CopilotAutoApproveToggleComponent);
    fixture.detectChanges();
  });
  afterEach(() => { feedback.dismiss(); TestBed.resetTestingModule(); });

  it('binds the toggle to the saved value and writes the flipped value through saveSettings, with Undo', async () => {
    expect(toggle()?.checked).toBe(false);
    expect(toggle()?.getAttribute('aria-label')).toBe('Auto-approve Copilot tool calls');
    toggle()?.click();
    await flush();
    expect(state.saveSettings).toHaveBeenCalledWith({ orchestration: { copilotAutoApprove: true } }, CONTEXT);
    expect(toggle()?.checked).toBe(true);
    expect(error()).toBeNull();
    expect(feedback.toast()).toEqual({ tone: 'status', message: 'Saved Copilot auto-approve to All Ptah apps.', canUndo: true });
    await feedback.undo();
    await flush();
    expect(state.saveSettings).toHaveBeenLastCalledWith({ orchestration: { copilotAutoApprove: false } }, CONTEXT);
    expect(toggle()?.checked).toBe(false);
  });

  it('keeps showing the saved value while the write runs, and is disabled meanwhile', async () => {
    let release: (value: boolean) => void = () => undefined;
    state.saveSettings.mockImplementationOnce(() => new Promise<boolean>((resolve) => { release = resolve; }));
    toggle()?.click();
    fixture.detectChanges();
    expect(toggle()?.checked).toBe(false);
    expect(toggle()?.disabled).toBe(true);
    state.commit.set({ ...idle, status: 'failed', unsaved: ['agentOrchestration.copilotAutoApprove'] });
    release(true);
    await flush();
    expect(toggle()?.disabled).toBe(false);
  });

  it('shows the re-read value and says it is unchanged when nothing was written (D15)', async () => {
    state.next = 'rejected';
    toggle()?.click();
    await flush();
    expect(toggle()?.checked).toBe(false);
    expect(error()).toBe('Could not save Copilot auto-approve. The saved setting is unchanged.');
    expect(toggle()?.disabled).toBe(false);
    expect(feedback.toast()?.tone).toBe('alert');
    expect(feedback.toast()?.message).not.toContain('Saved');
  });

  it('shows no value and takes no writes when the outcome is unknown, until a re-read succeeds', async () => {
    state.next = 'unconfirmed';
    toggle()?.click();
    await flush();
    expect(toggle()?.indeterminate).toBe(true);
    expect(toggle()?.disabled).toBe(true);
    expect(error()).toContain('Could not confirm whether Copilot auto-approve was saved');
    // A write attempt while unconfirmed is ignored.
    state.saveSettings.mockClear();
    await fixture.componentInstance.toggle({ target: toggle() } as unknown as Event);
    expect(state.saveSettings).not.toHaveBeenCalled();
    // The re-read fails: still unconfirmed.
    state.readable = false;
    recheck()?.click();
    await flush();
    expect(toggle()?.disabled).toBe(true);
    expect(recheck()).not.toBeNull();
    // The re-read succeeds: the read value is shown and writes are taken again.
    state.readable = true;
    recheck()?.click();
    await flush();
    expect(toggle()?.indeterminate).toBe(false);
    expect(toggle()?.checked).toBe(true);
    expect(toggle()?.disabled).toBe(false);
    expect(error()).toBeNull();
    expect(recheck()).toBeNull();
  });

  it('treats a write whose re-read failed as unconfirmed, never as saved', async () => {
    state.readable = false;
    toggle()?.click();
    await flush();
    expect(toggle()?.indeterminate).toBe(true);
    expect(error()).toContain('Could not confirm');
    expect(el().querySelector('[data-testid="copilot-auto-approve-unloaded"]')).toBeNull();
  });

  it('treats a save command that threw as unconfirmed (it may have written)', async () => {
    state.saveSettings.mockImplementationOnce(async () => { throw new Error('broken'); });
    toggle()?.click();
    await flush();
    expect(toggle()?.indeterminate).toBe(true);
    expect(error()).toContain('Could not confirm');
    expect(feedback.toast()?.message).toBe('Could not confirm whether Copilot auto-approve was saved.');
  });

  it('says so and changes nothing when another save is in flight', async () => {
    state.next = 'refused';
    state.commit.set({ ...idle, status: 'saving' });
    fixture.detectChanges();
    // The global save gate disables it; a programmatic change is refused by the feedback service.
    expect(toggle()?.disabled).toBe(true);
    state.commit.set(idle);
    fixture.detectChanges();
    toggle()?.click();
    await flush();
    expect(feedback.toast()).toEqual({ tone: 'alert', message: SAVE_REFUSED_MESSAGE, canUndo: false });
    expect(toggle()?.checked).toBe(false);
    expect(error()).toBeNull();
  });

  it('offers a re-read when the saved value has not loaded', async () => {
    state.orchestration.set({ status: 'error', data: null, error: 'Could not load this section. Retry.' });
    fixture.detectChanges();
    expect(toggle()?.disabled).toBe(true);
    expect(el().querySelector('[data-testid="copilot-auto-approve-unloaded"]')).not.toBeNull();
    recheck()?.click();
    await flush();
    expect(state.refreshOrchestration).toHaveBeenCalled();
    expect(toggle()?.disabled).toBe(false);
  });
});
