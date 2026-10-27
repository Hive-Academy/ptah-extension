import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PreviousSessionsDialogService } from '../../../services/session-list/previous-sessions-dialog.service';
import { PreviousSessionsLoadStateComponent } from './previous-sessions-load-state.component';

describe('PreviousSessionsLoadStateComponent', () => {
  let fixture: ComponentFixture<PreviousSessionsLoadStateComponent>;
  let close: jest.Mock<void, []>;

  const SKELETON = '[data-testid="previous-sessions-load-skeleton"]';
  const ROW = '[data-testid="previous-sessions-skeleton-row"]';

  function render(state: 'loading' | 'error'): HTMLElement {
    fixture.componentRef.setInput('state', state);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function description(root: HTMLElement): string {
    const panel = root.querySelector('[role="dialog"]');
    const id = panel?.getAttribute('aria-describedby') ?? '';
    return (
      root
        .querySelector(`#${id}`)
        ?.textContent?.replace(/\s+/g, ' ')
        .trim() ?? ''
    );
  }

  beforeEach(async () => {
    close = jest.fn<void, []>();
    await TestBed.configureTestingModule({
      imports: [PreviousSessionsLoadStateComponent],
      providers: [
        { provide: PreviousSessionsDialogService, useValue: { close } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(PreviousSessionsLoadStateComponent);
  });

  afterEach(() => fixture.destroy());

  describe('loading', () => {
    it('shows four shimmer rows in a busy status region instead of a spinner', () => {
      const root = render('loading');

      const region = root.querySelector(SKELETON);
      expect(region?.getAttribute('role')).toBe('status');
      expect(region?.getAttribute('aria-busy')).toBe('true');
      const rows = root.querySelectorAll(ROW);
      expect(rows).toHaveLength(4);
      rows.forEach((row) => {
        expect(row.getAttribute('aria-hidden')).toBe('true');
        expect(row.classList).toContain('psl-shimmer');
      });
      expect(root.querySelector('.loading-spinner')).toBeNull();
    });

    it('keeps the loading copy as the dialog description, for screen readers', () => {
      const root = render('loading');

      expect(description(root)).toBe('Loading previous sessions...');
      const message = root.querySelector('#psl-message');
      expect(message?.classList).toContain('sr-only');
      expect(message?.closest(SKELETON)).not.toBeNull();
    });

    it('staggers the rows so the shimmer reads as a list', () => {
      const root = render('loading');

      const delays = Array.from(root.querySelectorAll<HTMLElement>(ROW)).map(
        (row) => row.style.animationDelay,
      );
      expect(new Set(delays).size).toBe(4);
    });
  });

  describe('error', () => {
    it('keeps the error copy and shows no skeleton', () => {
      const root = render('error');

      expect(description(root)).toBe(
        'Previous sessions could not load. Close this and reload the window to try again.',
      );
      expect(root.querySelector(SKELETON)).toBeNull();
      expect(root.querySelectorAll(ROW)).toHaveLength(0);
    });
  });

  it('closes through the dialog service on Close and on Escape', () => {
    const root = render('loading');

    root
      .querySelector<HTMLButtonElement>(
        '[data-testid="previous-sessions-load-close"]',
      )
      ?.click();
    expect(close).toHaveBeenCalledTimes(1);

    const escape = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    root
      .querySelector('[data-testid="previous-sessions-load-state"]')
      ?.dispatchEvent(escape);
    expect(close).toHaveBeenCalledTimes(2);
    expect(escape.defaultPrevented).toBe(true);
  });
});
