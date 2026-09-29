import { signal, type WritableSignal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  ProvidersSettingsStateService,
  type ProvidersSettingsCommit,
} from '@ptah-extension/core';
import { SettingsSaveFeedbackService } from './settings-save-feedback.service';
import { SettingsToastComponent } from './settings-toast.component';

const EMPTY: ProvidersSettingsCommit = {
  status: 'idle',
  saved: [],
  unsaved: [],
  unconfirmed: [],
  refreshFailed: false,
  message: null,
};

describe('SettingsToastComponent', () => {
  let commit: WritableSignal<ProvidersSettingsCommit>;
  let feedback: SettingsSaveFeedbackService;
  let fixture: ComponentFixture<SettingsToastComponent>;

  const query = (testId: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

  function settlesTo(outcome: Partial<ProvidersSettingsCommit>): jest.Mock<Promise<boolean>> {
    return jest.fn(async () => {
      commit.set({ ...EMPTY, ...outcome });
      return true;
    });
  }

  beforeEach(() => {
    commit = signal<ProvidersSettingsCommit>(EMPTY);
    TestBed.configureTestingModule({
      imports: [SettingsToastComponent],
      providers: [
        SettingsSaveFeedbackService,
        { provide: ProvidersSettingsStateService, useValue: { commit } },
      ],
    });
    feedback = TestBed.inject(SettingsSaveFeedbackService);
    fixture = TestBed.createComponent(SettingsToastComponent);
    fixture.detectChanges();
  });

  afterEach(() => TestBed.resetTestingModule());

  it('renders nothing without a toast', () => {
    expect(query('settings-toast')).toBeNull();
  });

  it('renders a success as role="status" (polite) with an Undo that performs the undo write', async () => {
    const undo = settlesTo({ status: 'saved', saved: ['model'] });
    await feedback.save({
      label: 'main agent model',
      scope: 'workspace',
      write: settlesTo({ status: 'saved', saved: ['model'] }),
      undo,
    });
    fixture.detectChanges();

    const toast = query('settings-toast');
    expect(toast?.getAttribute('role')).toBe('status');
    expect(toast?.getAttribute('aria-live')).toBe('polite');
    expect(toast?.textContent).toContain('Saved main agent model to This workspace.');

    const undoClick = jest.spyOn(feedback, 'undo');
    query('settings-toast-undo')?.click();
    // whenStable() would wait out the 8 s auto-dismiss timer; await the Undo itself.
    await undoClick.mock.results[0]?.value;
    fixture.detectChanges();

    expect(undo).toHaveBeenCalledTimes(1);
    expect(query('settings-toast-undo')).toBeNull();
  });

  it('renders a failure as role="alert" with no Undo', async () => {
    await feedback.save({
      label: 'effort',
      scope: 'global',
      write: settlesTo({ status: 'failed', unsaved: ['effort'] }),
      undo: jest.fn().mockResolvedValue(true),
    });
    fixture.detectChanges();

    const toast = query('settings-toast');
    expect(toast?.getAttribute('role')).toBe('alert');
    expect(toast?.textContent).toContain('Could not save effort. Not saved: effort.');
    expect(query('settings-toast-undo')).toBeNull();
  });

  it('disables Undo while a save is in flight', async () => {
    await feedback.save({
      label: 'effort',
      scope: 'global',
      write: settlesTo({ status: 'saved' }),
      undo: jest.fn().mockResolvedValue(true),
    });
    commit.set({ ...EMPTY, status: 'saving' });
    fixture.detectChanges();

    expect((query('settings-toast-undo') as HTMLButtonElement).disabled).toBe(true);
  });

  it('the dismiss button removes the toast', async () => {
    await feedback.save({
      label: 'effort',
      scope: 'app',
      write: settlesTo({ status: 'saved' }),
      undo: null,
    });
    fixture.detectChanges();

    const dismiss = query('settings-toast-dismiss');
    expect(dismiss?.getAttribute('aria-label')).toBe('Dismiss notification');
    dismiss?.click();
    fixture.detectChanges();

    expect(query('settings-toast')).toBeNull();
  });
});
