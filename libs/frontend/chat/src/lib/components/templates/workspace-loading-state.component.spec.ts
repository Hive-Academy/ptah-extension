import { ComponentFixture, TestBed } from '@angular/core/testing';
import { VSCodeService } from '@ptah-extension/core';
import {
  SLOW_HINT_MS,
  WorkspaceLoadingStateComponent,
} from './workspace-loading-state.component';

describe('WorkspaceLoadingStateComponent', () => {
  let fixture: ComponentFixture<WorkspaceLoadingStateComponent>;

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  /** Renders, then lets the after-render hook fill the status line. */
  function render(name: string | null): void {
    fixture.componentRef.setInput('workspaceName', name);
    fixture.detectChanges();
    fixture.detectChanges();
  }

  function label(): string {
    return (
      host().querySelector('[data-testid="workspace-loading-label"]')
        ?.textContent ?? ''
    );
  }

  beforeEach(async () => {
    jest.useFakeTimers();
    await TestBed.configureTestingModule({
      imports: [WorkspaceLoadingStateComponent],
      providers: [
        {
          provide: VSCodeService,
          useValue: { getPtahIconUri: () => 'ptah-icon.png' },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(WorkspaceLoadingStateComponent);
  });

  afterEach(() => {
    fixture.destroy();
    jest.useRealTimers();
  });

  it('is a polite status region whose busy flag sits on the skeleton only', () => {
    render(null);
    expect(host().getAttribute('role')).toBe('status');
    expect(host().hasAttribute('aria-busy')).toBe(false);
    expect(
      host().querySelector('.ptah-loading__stage')?.getAttribute('aria-busy'),
    ).toBe('true');
  });

  it('fills the status line after the first render, so it is announced as a change', () => {
    // The fixture runs the after-render hook and re-renders in one call, so
    // record the DOM writes: the line must be written empty, then changed.
    const observer = new MutationObserver(() => undefined);
    observer.observe(host(), {
      subtree: true,
      childList: true,
      characterData: true,
      characterDataOldValue: true,
    });
    fixture.componentRef.setInput('workspaceName', 'ptah-extension');
    fixture.detectChanges();
    const changes = observer
      .takeRecords()
      .filter(
        (record) =>
          record.type === 'characterData' &&
          record.target.parentElement?.dataset['testid'] ===
            'workspace-loading-label',
      );
    observer.disconnect();

    expect(changes.length).toBeGreaterThan(0);
    expect(changes[0].oldValue?.trim()).toBe('');
    expect(label()).toContain('Opening ptah-extension');
  });

  it('shows a calm hint once the host is slow, and not before', () => {
    render('ptah-extension');
    jest.advanceTimersByTime(SLOW_HINT_MS - 1);
    fixture.detectChanges();
    expect(host().querySelector('[data-testid="workspace-loading-slow"]')).toBeNull();

    jest.advanceTimersByTime(1);
    fixture.detectChanges();
    const hint = host().querySelector('[data-testid="workspace-loading-slow"]');
    expect(hint?.textContent).toContain('Still opening');
    expect(hint?.closest('[aria-hidden="true"], [aria-busy="true"]')).toBeNull();
  });

  it('drops the slow-hint timer when it is destroyed', () => {
    render(null);
    expect(jest.getTimerCount()).toBe(1);
    fixture.destroy();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('paints the workspace skeleton when the pending name is known', () => {
    render('ptah-extension');

    expect(label()).toContain('Opening ptah-extension');
    expect(
      host()
        .querySelector('[data-testid="workspace-loading-name"]')
        ?.textContent?.trim(),
    ).toBe('ptah-extension');
    expect(host().querySelector('ptah-activity-grid')).not.toBeNull();

    const steps = Array.from(
      host().querySelectorAll('.ptah-staged-steps__row'),
    );
    expect(steps.map((row) => row.getAttribute('data-state'))).toEqual([
      'pending',
      'pending',
      'pending',
    ]);
    expect(steps.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Git status'),
      expect.stringContaining('Scanning files'),
      expect.stringContaining('Usage history'),
    ]);
    expect(host().querySelector('[data-testid="workspace-loading-medallion"]')).toBeNull();
  });

  it('keeps New session visible but aria-disabled', () => {
    render('ptah-extension');
    const button = host().querySelector<HTMLButtonElement>(
      '[data-testid="workspace-loading-new-session"]',
    );
    expect(button?.textContent).toContain('New session');
    expect(button?.getAttribute('aria-disabled')).toBe('true');
  });

  it('hides the decorative skeleton from assistive technology', () => {
    render('ptah-extension');
    expect(
      host().querySelector('.ptah-loading__zone')?.getAttribute('aria-hidden'),
    ).toBe('true');
    expect(
      host().querySelector('.ptah-loading__title')?.getAttribute('aria-hidden'),
    ).toBe('true');
  });

  it('paints the medallion and a shimmer without a name', () => {
    render(null);

    const medallion = host().querySelector<HTMLImageElement>(
      '[data-testid="workspace-loading-medallion"]',
    );
    expect(medallion?.getAttribute('src')).toBe('ptah-icon.png');
    expect(host().querySelector('.ptah-loading__bar--medallion')).not.toBeNull();
    expect(label()).toContain('Loading workspace');
    expect(host().querySelector('ptah-staged-steps')).toBeNull();
    expect(
      host().querySelector('[data-testid="workspace-loading-new-session"]'),
    ).toBeNull();
  });
});
