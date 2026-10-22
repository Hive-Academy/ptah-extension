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

  describe('top-layer promotion', () => {
    const proto = HTMLElement.prototype;
    let previousShow: PropertyDescriptor | undefined;

    async function showToast(): Promise<HTMLElement> {
      await feedback.save({ label: 'voice', scope: 'app', write: settlesTo({ status: 'saved' }), undo: null });
      fixture.detectChanges();
      // A second pass runs the effect once the view query sees the new region.
      fixture.detectChanges();
      return query('settings-toast-region') as HTMLElement;
    }

    beforeEach(() => {
      previousShow = Object.getOwnPropertyDescriptor(proto, 'showPopover');
      // jsdom may not know :popover-open; report a closed popover.
      const realMatches = Element.prototype.matches;
      jest
        .spyOn(Element.prototype, 'matches')
        .mockImplementation(function (this: Element, selector: string) {
          return selector === ':popover-open' ? false : realMatches.call(this, selector);
        });
    });

    afterEach(() => {
      jest.restoreAllMocks();
      if (previousShow) Object.defineProperty(proto, 'showPopover', previousShow);
      else Reflect.deleteProperty(proto, 'showPopover');
    });

    it('promotes the region with showPopover and keeps no in-page display override', async () => {
      const shown: HTMLElement[] = [];
      Object.defineProperty(proto, 'showPopover', {
        configurable: true,
        value(this: HTMLElement) {
          shown.push(this);
        },
      });
      const region = await showToast();
      expect(shown).toContain(region);
      expect(shown.every((el) => el === region)).toBe(true);
      expect(region.style.display).toBe('');
    });

    it('stays visible in the page layer when the Popover API is missing', async () => {
      Reflect.deleteProperty(proto, 'showPopover');
      const region = await showToast();
      expect(region.style.display).toBe('block');
    });

    it('stays visible in the page layer when showPopover throws', async () => {
      Object.defineProperty(proto, 'showPopover', {
        configurable: true,
        value() {
          throw new DOMException('not connected', 'InvalidStateError');
        },
      });
      const region = await showToast();
      expect(region.style.display).toBe('block');
    });
  });

  describe('restacking after another overlay opens', () => {
    let previousShow: PropertyDescriptor | undefined;
    let previousHide: PropertyDescriptor | undefined;
    let show: jest.Mock;
    let hide: jest.Mock;
    let overlay: HTMLElement;

    function toggle(target: HTMLElement, newState = 'open'): void {
      const event = new Event('toggle'); // Non-bubbling, as in Chromium.
      Object.defineProperty(event, 'newState', { value: newState });
      target.dispatchEvent(event);
    }

    async function showToast(): Promise<HTMLElement> {
      await feedback.save({ label: 'voice', scope: 'app', write: settlesTo({ status: 'saved' }), undo: null });
      fixture.detectChanges();
      fixture.detectChanges();
      show.mockClear();
      hide.mockClear();
      return query('settings-toast-region') as HTMLElement;
    }

    beforeEach(() => {
      previousShow = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'showPopover');
      previousHide = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'hidePopover');
      const opened = new WeakSet<HTMLElement>();
      show = jest.fn(function (this: HTMLElement) { opened.add(this); });
      hide = jest.fn(function (this: HTMLElement) { opened.delete(this); });
      Object.defineProperty(HTMLElement.prototype, 'showPopover', { configurable: true, value: show });
      Object.defineProperty(HTMLElement.prototype, 'hidePopover', { configurable: true, value: hide });
      const realMatches = Element.prototype.matches;
      jest.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
        return selector === ':popover-open'
          ? this instanceof HTMLElement && opened.has(this)
          : realMatches.call(this, selector);
      });
      overlay = document.createElement('div');
      overlay.setAttribute('popover', 'manual');
      document.body.appendChild(overlay);
    });

    afterEach(() => {
      overlay.remove();
      jest.restoreAllMocks();
      if (previousShow) Object.defineProperty(HTMLElement.prototype, 'showPopover', previousShow);
      else Reflect.deleteProperty(HTMLElement.prototype, 'showPopover');
      if (previousHide) Object.defineProperty(HTMLElement.prototype, 'hidePopover', previousHide);
      else Reflect.deleteProperty(HTMLElement.prototype, 'hidePopover');
    });

    it('captures open toggles and coalesces them into a microtask restack', async () => {
      await showToast();
      toggle(overlay);
      toggle(overlay);
      expect(show).not.toHaveBeenCalled();
      await Promise.resolve();
      expect(hide).toHaveBeenCalledTimes(1);
      expect(show).toHaveBeenCalledTimes(1);
      expect(hide.mock.invocationCallOrder[0]).toBeLessThan(show.mock.invocationCallOrder[0]);
    });

    it('ignores its own toggle, closed toggles, and ordinary details toggles', async () => {
      const region = await showToast();
      toggle(region);
      toggle(overlay, 'closed');
      overlay.removeAttribute('popover');
      toggle(overlay);
      await Promise.resolve();
      expect(show).not.toHaveBeenCalled();
    });

    it('does nothing without a visible page toast, including inline mode', async () => {
      toggle(overlay);
      await Promise.resolve();
      expect(show).not.toHaveBeenCalled();
      fixture.componentRef.setInput('inline', true);
      await showToast();
      toggle(overlay);
      await Promise.resolve();
      expect(show).not.toHaveBeenCalled();
    });

    it('does not resurrect a toast dismissed before the microtask', async () => {
      await showToast();
      toggle(overlay);
      feedback.dismiss();
      await Promise.resolve();
      expect(show).not.toHaveBeenCalled();
    });

    it('raises above dialog openings without adding autofocus or moving focus', async () => {
      const region = await showToast();
      const dialog = document.createElement('dialog');
      const input = document.createElement('input');
      dialog.appendChild(input);
      document.body.appendChild(dialog);
      try {
        input.focus();
        toggle(dialog);
        await Promise.resolve();
        expect(show).toHaveBeenCalledTimes(1);
        expect(document.activeElement).toBe(input);
        expect(region.querySelector('[autofocus]')).toBeNull();
      } finally {
        dialog.remove();
      }
    });

    it('removes its capture listener and cancels a queued raise on destroy', async () => {
      await showToast();
      const remove = jest.spyOn(document, 'removeEventListener');
      toggle(overlay);
      fixture.destroy();
      await Promise.resolve();
      expect(remove).toHaveBeenCalledWith('toggle', expect.any(Function), true);
      toggle(overlay);
      await Promise.resolve();
      expect(show).not.toHaveBeenCalled();
    });
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
