import { signal, type WritableSignal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  ProvidersSettingsStateService,
  type ProvidersSettingsCommit,
} from '@ptah-extension/core';
import { SettingsSaveFeedbackService } from './settings-save-feedback.service';
import { SettingsToastComponent } from './settings-toast.component';
import { isDisabledControl } from './busy-disabled.testing';

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

  it('disables Undo while a save is in flight, keeping it focusable (aria-disabled)', async () => {
    await feedback.save({
      label: 'effort',
      scope: 'global',
      write: settlesTo({ status: 'saved' }),
      undo: jest.fn().mockResolvedValue(true),
    });
    commit.set({ ...EMPTY, status: 'saving' });
    fixture.detectChanges();

    expect(isDisabledControl(query('settings-toast-undo'))).toBe(true);
    expect((query('settings-toast-undo') as HTMLButtonElement).disabled).toBe(false);
  });

  describe('inline (Batch 55b CS-1, the drawer Models & Tiers tab)', () => {
    beforeEach(() => {
      fixture.componentRef.setInput('inline', true);
      fixture.detectChanges();
    });

    it('renders the same toast in the flow of the panel, with -inline test ids and no page region', async () => {
      const undo = jest.fn().mockResolvedValue(true);
      await feedback.save({ label: 'opus tier model', scope: 'global', write: settlesTo({ status: 'saved' }), undo });
      fixture.detectChanges();
      expect(query('settings-toast-region')).toBeNull();
      expect(query('settings-toast')).toBeNull();
      const toast = query('settings-toast-inline');
      expect(toast?.getAttribute('role')).toBe('status');
      expect(toast?.className).not.toContain('shadow-lg');
      expect(toast?.closest('.fixed')).toBeNull();
      expect(query('settings-toast-inline-message')?.textContent).toBe('Saved opus tier model to All Ptah apps.');
      query('settings-toast-inline-undo')?.click();
      await Promise.resolve();
      expect(undo).toHaveBeenCalledTimes(1);
    });

    it('a failure is role="alert" with no Undo, and Dismiss removes it', async () => {
      await feedback.save({ label: 'opus tier model', scope: 'global', write: settlesTo({ status: 'failed' }), undo: null });
      fixture.detectChanges();
      expect(query('settings-toast-inline')?.getAttribute('role')).toBe('alert');
      expect(query('settings-toast-inline-undo')).toBeNull();
      query('settings-toast-inline-dismiss')?.click();
      fixture.detectChanges();
      expect(query('settings-toast-inline')).toBeNull();
    });
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

  describe('placement over an open drawer (Batch 49b)', () => {
    const LIFT = '[body:has(ptah-native-drawer_[role=dialog])_&]:bottom-28';
    /** The CSS selector Tailwind emits for {@link LIFT}, minus the toast's own class. */
    const LIFT_CONDITION = 'body:has(ptah-native-drawer [role=dialog])';

    async function showToast(): Promise<HTMLElement | null> {
      await feedback.save({
        label: 'voice',
        scope: 'app',
        write: settlesTo({ status: 'saved' }),
        undo: null,
      });
      fixture.detectChanges();
      return query('settings-toast-region');
    }

    it('sits at bottom-6 and carries the lift above a drawer footer', async () => {
      const region = await showToast();

      expect(region?.classList.contains('bottom-6')).toBe(true);
      expect(region?.classList.contains(LIFT)).toBe(true);
      expect(region?.querySelector('[data-testid="settings-toast"]')?.getAttribute('role')).toBe('status');
    });

    it('lifts only while a drawer panel is rendered, not for a closed drawer host', () => {
      const drawer = document.createElement('ptah-native-drawer');
      document.body.appendChild(drawer);
      try {
        expect(document.querySelector(LIFT_CONDITION)).toBeNull();

        const panel = document.createElement('div');
        panel.setAttribute('role', 'dialog');
        drawer.appendChild(panel);
        expect(document.querySelector(LIFT_CONDITION)).toBe(document.body);
      } finally {
        drawer.remove();
      }
    });
  });
});
