import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  ProvidersSettingsStateService, type ProvidersOrchestration, type ProvidersSettingsCommit, type ProvidersSettingsSection,
} from '@ptah-extension/core';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';
import { CursorCredentialPopoverComponent } from './cursor-credential-popover.component';

type Flags = Pick<ProvidersOrchestration, 'cursorApiKeyStored' | 'cursorApiKeyEnvSet' | 'cursorApiKeyConfigured'>;
const ready = <T,>(data: T): ProvidersSettingsSection<T> => ({ status: 'ready', data, error: null });
const idle: ProvidersSettingsCommit = { status: 'idle', saved: [], unsaved: [], unconfirmed: [], refreshFailed: false, message: null };
const CONTEXT = { scopeKey: 'workspace', activePath: '/ws' };
const KEY = 'crsr_e2e_secret_value';

class StateStub {
  readonly commit = signal<ProvidersSettingsCommit>(idle);
  readonly orchestration = signal<ProvidersSettingsSection<Flags>>(
    ready({ cursorApiKeyStored: false, cursorApiKeyEnvSet: false, cursorApiKeyConfigured: false }));
  readonly contextNow = signal<typeof CONTEXT | null>(CONTEXT);
  readonly reviewContext = jest.fn(() => this.contextNow());
  /** The commit status the next write settles to (the state reads `cursorApiKeyStored` back). */
  outcome: ProvidersSettingsCommit['status'] = 'saved';
  readonly saveCursorCredential = jest.fn(async (apiKey: string, _context: unknown) => {
    if (this.outcome === 'saved') {
      const stored = !!apiKey.trim();
      this.orchestration.update((section) => ready({ ...(section.data as Flags), cursorApiKeyStored: stored, cursorApiKeyConfigured: stored }));
    }
    this.commit.set({ ...idle, status: this.outcome, unsaved: this.outcome === 'failed' ? ['Cursor credential'] : [] });
    return true;
  });
}

describe('CursorCredentialPopoverComponent', () => {
  let fixture: ComponentFixture<CursorCredentialPopoverComponent>;
  let state: StateStub;
  let feedback: SettingsSaveFeedbackService;
  const el = () => fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement = HTMLElement>(id: string) => el().querySelector(`[data-testid="${id}"]`) as T | null;
  const keyInput = () => q<HTMLInputElement>('cursor-credential-key');
  async function flush() { for (let i = 0; i < 8; i += 1) await Promise.resolve(); fixture.detectChanges(); }
  function typeKey(value: string) {
    const input = keyInput();
    if (!input) throw new Error('no key field');
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  beforeEach(() => {
    state = new StateStub();
    TestBed.configureTestingModule({
      imports: [CursorCredentialPopoverComponent],
      providers: [{ provide: ProvidersSettingsStateService, useValue: state }, SettingsSaveFeedbackService],
    });
    feedback = TestBed.inject(SettingsSaveFeedbackService);
    fixture = TestBed.createComponent(CursorCredentialPopoverComponent);
    fixture.detectChanges();
  });
  afterEach(() => { feedback.dismiss(); TestBed.resetTestingModule(); });

  it('is a titled dialog with the help copy and the stored-key status from cursorApiKeyStored (#64)', () => {
    expect(q('cursor-credential-popover')?.getAttribute('role')).toBe('dialog');
    expect(el().textContent).toContain('Cursor credentials');
    expect(q('cursor-credential-help')?.textContent).toContain('cursor.com → Dashboard → Integrations');
    expect(q('cursor-credential-status')?.textContent?.trim()).toBe('Not set');
    expect(q('cursor-credential-remove')).toBeNull();
    // The env var alone counts as "configured" but never as a stored key.
    state.orchestration.set(ready({ cursorApiKeyStored: false, cursorApiKeyEnvSet: true, cursorApiKeyConfigured: true }));
    fixture.detectChanges();
    expect(q('cursor-credential-status')?.textContent?.trim()).toBe('Not set');
    state.orchestration.set(ready({ cursorApiKeyStored: true, cursorApiKeyEnvSet: false, cursorApiKeyConfigured: true }));
    fixture.detectChanges();
    expect(q('cursor-credential-status')?.textContent?.trim()).toBe('Set');
    expect(q('cursor-credential-remove')).not.toBeNull();
  });

  it('shows the 551 note only when CURSOR_API_KEY is set', () => {
    expect(q('cursor-credential-env-note')).toBeNull();
    state.orchestration.set(ready({ cursorApiKeyStored: true, cursorApiKeyEnvSet: true, cursorApiKeyConfigured: true }));
    fixture.detectChanges();
    expect(q('cursor-credential-env-note')?.textContent?.trim())
      .toBe('CURSOR_API_KEY is set in the environment and takes precedence over the stored key.');
  });

  it('says the status is not loaded instead of guessing', () => {
    state.orchestration.set({ status: 'error', data: null, error: 'Could not load this section. Retry.' });
    fixture.detectChanges();
    expect(q('cursor-credential-status')?.textContent?.trim()).toBe('Not loaded');
  });

  it('masks the key with show/hide (#49)', () => {
    typeKey(KEY);
    expect(keyInput()?.type).toBe('password');
    const toggle = q<HTMLButtonElement>('cursor-credential-toggle-visibility');
    expect(toggle?.getAttribute('aria-label')).toBe('Show API key');
    toggle?.click();
    fixture.detectChanges();
    expect(keyInput()?.type).toBe('text');
    expect(toggle?.getAttribute('aria-pressed')).toBe('true');
    expect(toggle?.getAttribute('aria-label')).toBe('Hide API key');
  });

  it('saves the key through saveCursorCredential, then clears and re-masks the field', async () => {
    expect(q<HTMLButtonElement>('cursor-credential-save')?.getAttribute('aria-disabled')).toBe('true');
    typeKey(KEY);
    expect(q<HTMLButtonElement>('cursor-credential-save')?.hasAttribute('aria-disabled')).toBe(false);
    q<HTMLButtonElement>('cursor-credential-toggle-visibility')?.click();
    q<HTMLButtonElement>('cursor-credential-save')?.click();
    await flush();
    expect(state.saveCursorCredential).toHaveBeenCalledWith(KEY, CONTEXT);
    // M4: stored is not verified (no Cursor check exists; accepted deviation, Gate V 36 decision 3).
    expect(q('cursor-credential-outcome')?.textContent?.trim()).toBe('Key stored, not verified.');
    // M3: also announced through the page toast, which outlives this popover.
    expect(feedback.toast()).toEqual({ tone: 'status', message: 'Key stored, not verified.', canUndo: false });
    expect(q('cursor-credential-status')?.textContent?.trim()).toBe('Set');
    expect(keyInput()?.value).toBe('');
    expect(keyInput()?.type).toBe('password');
  });

  it('keeps the typed key and never says "saved" when the store did not confirm it (D15)', async () => {
    state.outcome = 'failed';
    typeKey(KEY);
    q<HTMLButtonElement>('cursor-credential-save')?.click();
    await flush();
    const outcome = q('cursor-credential-outcome');
    expect(outcome?.getAttribute('role')).toBe('alert');
    expect(outcome?.textContent).toContain('The key was not saved.');
    expect(outcome?.textContent).not.toContain('Key stored');
    expect(feedback.toast()?.tone).toBe('alert');
    expect(feedback.toast()?.message).toContain('The key was not saved.');
    expect(keyInput()?.value).toBe(KEY);
    state.outcome = 'unconfirmed';
    q<HTMLButtonElement>('cursor-credential-save')?.click();
    await flush();
    expect(q('cursor-credential-outcome')?.textContent).toContain('Could not confirm the change');
  });

  it('removes the stored key after a confirm, through saveCursorCredential(\'\')', async () => {
    state.orchestration.set(ready({ cursorApiKeyStored: true, cursorApiKeyEnvSet: true, cursorApiKeyConfigured: true }));
    fixture.detectChanges();
    q<HTMLButtonElement>('cursor-credential-remove')?.click();
    fixture.detectChanges();
    expect(state.saveCursorCredential).not.toHaveBeenCalled();
    expect(q('cursor-credential-remove-confirm')?.textContent).toContain('Cursor keeps using CURSOR_API_KEY');
    q<HTMLButtonElement>('cursor-credential-remove-confirm-button')?.click();
    await flush();
    expect(state.saveCursorCredential).toHaveBeenCalledWith('', CONTEXT);
    expect(q('cursor-credential-outcome')?.textContent?.trim()).toBe('Stored key removed.');
    expect(q('cursor-credential-status')?.textContent?.trim()).toBe('Not set');
    expect(q('cursor-credential-remove-confirm')).toBeNull();
  });

  it('55c (final review M-3): a refused removal says the key was not removed, never "not saved", and the key stays stored', async () => {
    state.orchestration.set(ready({ cursorApiKeyStored: true, cursorApiKeyEnvSet: false, cursorApiKeyConfigured: true }));
    state.outcome = 'failed';
    fixture.detectChanges();
    const statusBefore = q('cursor-credential-status')?.textContent?.trim();
    q<HTMLButtonElement>('cursor-credential-remove')?.click();
    fixture.detectChanges();
    q<HTMLButtonElement>('cursor-credential-remove-confirm-button')?.click();
    await flush();
    const outcome = q('cursor-credential-outcome');
    expect(outcome?.getAttribute('role')).toBe('alert');
    expect(outcome?.textContent?.trim()).toBe('The stored key was not removed.');
    expect(outcome?.textContent).not.toContain('not saved');
    expect(outcome?.textContent).not.toContain('Could not remove the Cursor API key');
    expect(feedback.toast()?.message).toBe('The stored key was not removed.');
    expect(q('cursor-credential-status')?.textContent?.trim()).toBe(statusBefore);
    expect(state.orchestration().data?.cursorApiKeyStored).toBe(true);
    expect(q('cursor-credential-remove-confirm')).not.toBeNull();
  });

  it('M3: the confirmation survives the popover being destroyed mid-save (the row moved groups)', async () => {
    let release: (value: boolean) => void = () => undefined;
    state.saveCursorCredential.mockImplementationOnce(async () => {
      state.commit.set({ ...idle, status: 'saving' });
      const done = await new Promise<boolean>((resolve) => { release = resolve; });
      state.orchestration.update((section) => ready({ ...(section.data as Flags), cursorApiKeyStored: true, cursorApiKeyConfigured: true }));
      state.commit.set({ ...idle, status: 'saved' });
      return done;
    });
    typeKey(KEY);
    q<HTMLButtonElement>('cursor-credential-save')?.click();
    fixture.detectChanges();
    fixture.destroy();
    release(true);
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    expect(feedback.toast()).toEqual({ tone: 'status', message: 'Key stored, not verified.', canUndo: false });
  });

  it('writes nothing while the settings scopes are not loaded', async () => {
    state.contextNow.set(null);
    typeKey(KEY);
    q<HTMLButtonElement>('cursor-credential-save')?.click();
    await flush();
    expect(state.saveCursorCredential).not.toHaveBeenCalled();
    expect(q('cursor-credential-outcome')?.textContent).toContain('Settings are still loading');
  });

  it('D3 / N3: while any save runs the controls are aria-disabled and the field read-only, never natively disabled', async () => {
    typeKey(KEY);
    state.commit.set({ ...idle, status: 'saving' });
    fixture.detectChanges();
    const save = q<HTMLButtonElement>('cursor-credential-save');
    expect(save?.getAttribute('aria-disabled')).toBe('true');
    expect(save?.disabled).toBe(false);
    expect(keyInput()?.readOnly).toBe(true);
    expect(keyInput()?.disabled).toBe(false);
    save?.click();
    await flush();
    expect(state.saveCursorCredential).not.toHaveBeenCalled();
  });

  describe('N3 (Gate V 36 re-check 2): focus never drops to body', () => {
    function render() { TestBed.tick(); fixture.detectChanges(); }

    it('Save keeps focus while it runs; a failed save puts focus on the key field', async () => {
      state.outcome = 'failed';
      let release: () => void = () => undefined;
      state.saveCursorCredential.mockImplementationOnce(async () => {
        state.commit.set({ ...idle, status: 'saving' });
        await new Promise<void>((resolve) => { release = resolve; });
        state.commit.set({ ...idle, status: 'failed', unsaved: ['Cursor credential'] });
        return true;
      });
      typeKey(KEY);
      const save = q<HTMLButtonElement>('cursor-credential-save');
      save?.focus();
      save?.click();
      fixture.detectChanges();
      expect(save?.getAttribute('aria-disabled')).toBe('true');
      expect(document.activeElement).toBe(save);
      release();
      await flush();
      render();
      expect(q('cursor-credential-outcome')?.textContent).toContain('The key was not saved.');
      expect(document.activeElement).toBe(keyInput());
    });

    it('a saved key puts focus on the (cleared) key field', async () => {
      typeKey(KEY);
      q<HTMLButtonElement>('cursor-credential-save')?.click();
      await flush();
      render();
      expect(document.activeElement).toBe(keyInput());
    });

    it('Remove moves focus to the confirm\'s Cancel; Cancel returns it to "Remove stored key"', () => {
      state.orchestration.set(ready({ cursorApiKeyStored: true, cursorApiKeyEnvSet: false, cursorApiKeyConfigured: true }));
      fixture.detectChanges();
      q<HTMLButtonElement>('cursor-credential-remove')?.click();
      render();
      expect(document.activeElement).toBe(q('cursor-credential-remove-cancel'));
      q<HTMLButtonElement>('cursor-credential-remove-cancel')?.click();
      render();
      expect(document.activeElement).toBe(q('cursor-credential-remove'));
    });

    it('a failed removal keeps the confirm and focus on "Remove key"; a removal that lands focuses the key field', async () => {
      state.orchestration.set(ready({ cursorApiKeyStored: true, cursorApiKeyEnvSet: false, cursorApiKeyConfigured: true }));
      fixture.detectChanges();
      q<HTMLButtonElement>('cursor-credential-remove')?.click();
      render();
      state.outcome = 'failed';
      const confirm = q<HTMLButtonElement>('cursor-credential-remove-confirm-button');
      confirm?.focus();
      confirm?.click();
      await flush();
      render();
      expect(q('cursor-credential-remove-confirm')).not.toBeNull();
      expect(document.activeElement).toBe(confirm);
      state.outcome = 'saved';
      confirm?.click();
      await flush();
      render();
      expect(q('cursor-credential-remove-confirm')).toBeNull();
      expect(document.activeElement).toBe(keyInput());
    });
  });

  it('drops the typed key when it is destroyed', () => {
    typeKey(KEY);
    // The destroy hook itself, observed through the bound field (the key signal is not public).
    fixture.componentInstance.ngOnDestroy();
    fixture.detectChanges();
    expect(keyInput()?.value).toBe('');
  });

  it('closes from its Close button', () => {
    let closed = 0;
    fixture.componentInstance.closed.subscribe(() => { closed += 1; });
    (el().querySelector('button[aria-label="Close"]') as HTMLButtonElement).click();
    expect(closed).toBe(1);
  });
});
