import { Component, input, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  WorkspaceVitalsStore,
  type ActivityVitals,
  type GitVitals,
  type VitalsLoad,
  type WorkspaceReadiness,
} from '@ptah-extension/chat';
import type { StagedStep } from '@ptah-extension/chat-ui';
import { LoggingService, VSCodeService } from '@ptah-extension/core';
import { AuroraEffectComponent } from '@ptah-extension/ui';
import { CanvasEmptyBoardComponent, LOAD_STEPS_MAX_MS } from './canvas-empty-board.component';
import { FIRST_SESSION_CAPTION, OPEN_TODAY_CAPTION, QUIET_CAPTION } from './canvas-empty-board.view';

@Component({ selector: 'ptah-aurora-effect', standalone: true, template: '' })
class AuroraStub {
  readonly variant = input('board');
  readonly visible = input(true);
}

const LOADING = { status: 'loading' } as const;

/** Lets the awaited readiness call and its catch run. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function activity(sessionCount: number | null, tokens: number, costUsd: number | null): VitalsLoad<ActivityVitals> {
  return {
    status: 'ready',
    value: {
      activity: { metric: 'tokens', days: [{ date: '2026-10-25', value: 3 }], today: '2026-10-26' },
      totals: { tokens, costUsd },
      sessionCount,
    },
  };
}

function readiness(partial: Partial<WorkspaceReadiness> = {}): WorkspaceReadiness {
  return {
    checks: [
      { id: 'skills', label: 'Skills', ready: false },
      { id: 'scan', label: 'Project scan', ready: true },
      { id: 'agents', label: 'Agents', ready: true },
    ],
    action: { id: 'open-library', label: 'Open Library' },
    allReady: false,
    unavailable: false,
    ...partial,
  };
}

function mount() {
  const git = signal<VitalsLoad<GitVitals>>(LOADING);
  const activity90 = signal<VitalsLoad<ActivityVitals>>(LOADING);
  const isLoaded = signal(false);
  const previousSessionCount = signal<number | null>(null);
  const ready = signal<WorkspaceReadiness>(readiness());
  const loadSteps = signal<readonly StagedStep[]>([
    { id: 'git', label: 'Git status', state: 'active' },
    { id: 'usage', label: 'Usage history', state: 'active' },
  ]);
  const vitals = {
    bind: jest.fn(),
    git,
    activity90,
    isLoaded,
    previousSessionCount,
    readiness: ready,
    loadSteps,
    runReadinessAction: jest.fn().mockResolvedValue(undefined),
    retryReadiness: jest.fn().mockResolvedValue(undefined),
  };
  const logger = { warn: jest.fn() };
  TestBed.configureTestingModule({
    imports: [CanvasEmptyBoardComponent],
    providers: [
      { provide: VSCodeService, useValue: { isElectron: true } },
      { provide: LoggingService, useValue: logger },
    ],
  });
  // Replaces the component-level provider too.
  TestBed.overrideProvider(WorkspaceVitalsStore, { useValue: vitals });
  TestBed.overrideComponent(CanvasEmptyBoardComponent, {
    remove: { imports: [AuroraEffectComponent] },
    add: { imports: [AuroraStub] },
  });
  const fixture = TestBed.createComponent(CanvasEmptyBoardComponent);
  fixture.componentRef.setInput('workspacePath', 'D:\\projects\\ptah-extension');
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;
  const find = <T extends Element = HTMLElement>(selector: string) => host.querySelector<T>(selector);
  return { fixture, host, find, vitals, logger, git, activity90, isLoaded, previousSessionCount, ready };
}

describe('CanvasEmptyBoardComponent', () => {
  it('binds the store once to its workspace', () => {
    const { vitals } = mount();
    expect(vitals.bind).toHaveBeenCalledTimes(1);
    expect(vitals.bind.mock.calls[0][0].workspacePath()).toBe('D:\\projects\\ptah-extension');
  });

  it('is a scrolling main landmark named by the workspace heading, in the app font', () => {
    const { find } = mount();
    const main = find('[data-testid="canvas-rail-empty-board"]')!;
    expect(main.tagName).toBe('MAIN');
    expect(main.classList).toContain('overflow-y-auto');
    expect(main.classList).toContain('min-h-0');
    expect(main.getAttribute('aria-labelledby')).toBe('canvas-rail-empty-board-title');
    const heading = find('#canvas-rail-empty-board-title')!;
    expect(heading.tagName).toBe('H1');
    expect(heading.textContent?.trim()).toBe('ptah-extension');
    expect(heading.className).not.toContain('font-display');
    expect(find('[data-testid="canvas-rail-empty-board-content"]')?.parentElement).toBe(main);
  });

  it('shows branch and changed files once git answered', () => {
    const { fixture, find, git } = mount();
    const line = () => find('[data-testid="canvas-empty-board-workspace"]')!.textContent!.replace(/\s+/g, ' ');
    expect(line()).not.toContain('changed');
    git.set({ status: 'ready', value: { branch: 'main', changedFileCount: 14 } });
    fixture.detectChanges();
    expect(line()).toContain('main');
    expect(line()).toContain('14 changed');
  });

  it('loading: staged steps stand in for the numerals and New session stays usable', () => {
    const { fixture, find } = mount();
    const requested = jest.fn();
    fixture.componentInstance.newSessionRequested.subscribe(requested);
    expect(find('ptah-staged-steps')).not.toBeNull();
    expect(find('[data-testid="canvas-empty-board-numerals"]')).toBeNull();
    expect(find('[data-testid="canvas-empty-board-activity"]')?.getAttribute('aria-busy')).toBe('true');
    const trigger = find<HTMLButtonElement>('[data-testid="canvas-hero-new-session"]')!;
    expect(trigger.getAttribute('aria-disabled')).toBeNull();
    expect(trigger.classList).not.toContain('ptah-empty-board__new--blocked');
    trigger.click();
    expect(requested).toHaveBeenCalledWith(trigger);
  });

  it('returning: the grid says today is open beside three stacked numerals', () => {
    const { fixture, find, host, activity90, isLoaded } = mount();
    activity90.set(activity(41, 3_200_000, 27.1));
    isLoaded.set(true);
    fixture.detectChanges();
    expect(find('ptah-staged-steps')).toBeNull();
    expect(find('[data-testid="canvas-empty-board-activity"]')?.textContent).toContain(OPEN_TODAY_CAPTION);
    const cells = Array.from(host.querySelectorAll('[data-testid="canvas-empty-board-numerals"] ptah-stat-cell'));
    expect(cells.map((cell) => cell.getAttribute('aria-label'))).toEqual(['sessions', 'tokens', 'spend']);
    expect(cells.map((cell) => cell.querySelector('ptah-stat-value')?.textContent?.trim())).toEqual(['41', '3.2M', '$27.10']);
    expect(find('ptah-stat-row')?.getAttribute('data-layout')).toBe('stack');
  });

  it('first run: the Day 1 field and no numerals', () => {
    const { fixture, find, activity90, isLoaded, previousSessionCount } = mount();
    activity90.set({ status: 'empty' });
    previousSessionCount.set(0);
    isLoaded.set(true);
    fixture.detectChanges();
    expect(find('ptah-activity-grid')?.getAttribute('data-mode')).toBe('day-one');
    expect(find('[data-testid="canvas-empty-board-activity"]')?.textContent).toContain(FIRST_SESSION_CAPTION);
    expect(find('[data-testid="canvas-empty-board-numerals"]')).toBeNull();
    expect(find('[data-testid="canvas-empty-board-history"]')).toBeNull();
  });

  it('no usage facts: no Day 1 field until the session count is known', () => {
    const { fixture, find, activity90, isLoaded, previousSessionCount } = mount();
    activity90.set({ status: 'empty' });
    isLoaded.set(true);
    fixture.detectChanges();
    const activityZone = () => find('[data-testid="canvas-empty-board-activity"]')!;
    expect(find('ptah-activity-grid')?.getAttribute('data-mode')).toBe('history');
    expect(activityZone().getAttribute('aria-busy')).toBe('true');
    expect(activityZone().textContent).not.toContain('Day 1');
    previousSessionCount.set(3);
    fixture.detectChanges();
    expect(find('ptah-activity-grid')?.getAttribute('data-mode')).toBe('history');
    expect(activityZone().textContent).toContain(QUIET_CAPTION);
    expect(activityZone().getAttribute('aria-busy')).toBeNull();
  });

  it('a git status that never settles holds the staged steps only for a bounded time', () => {
    jest.useFakeTimers();
    try {
      const { fixture, find, activity90 } = mount();
      activity90.set(activity(2, 1_500, null));
      fixture.detectChanges();
      expect(find('ptah-staged-steps')).not.toBeNull();
      jest.advanceTimersByTime(LOAD_STEPS_MAX_MS);
      fixture.detectChanges();
      expect(find('ptah-staged-steps')).toBeNull();
      const values = Array.from(fixture.nativeElement.querySelectorAll('ptah-stat-value')).map(
        (value) => (value as HTMLElement).textContent?.trim(),
      );
      expect(values.slice(0, 2)).toEqual(['2', '1.5K']);
      // The branch line stays hidden while git is unknown.
      expect(find('[data-testid="canvas-empty-board-workspace"]')?.textContent).not.toContain('changed');
      fixture.destroy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('runs the readiness link and hides the ring once setup is complete', async () => {
    const { fixture, find, vitals, ready } = mount();
    const link = find<HTMLButtonElement>('[data-testid="canvas-empty-board-readiness"] button')!;
    expect(link.textContent).toContain('Open Library');
    link.click();
    // Not `whenStable()`: the hero's bounded load wait is a pending timer.
    await settle();
    expect(vitals.runReadinessAction).toHaveBeenCalledWith('open-library');
    ready.set(readiness({ allReady: true, action: null }));
    fixture.detectChanges();
    expect(find('ptah-readiness-ring')).toBeNull();
  });

  it('logs a failed readiness action instead of throwing', async () => {
    const { fixture, find, vitals, logger } = mount();
    vitals.runReadinessAction.mockRejectedValueOnce(new Error('launch failed'));
    find<HTMLButtonElement>('[data-testid="canvas-empty-board-readiness"] button')!.click();
    // Not `whenStable()`: the hero's bounded load wait is a pending timer.
    await settle();
    expect(logger.warn).toHaveBeenCalledWith('CanvasEmptyBoard', 'Readiness action failed', expect.any(Error));
  });

  it('unavailable readiness: an alert with Retry replaces the ring', () => {
    const { fixture, find, vitals, ready } = mount();
    ready.set(readiness({ unavailable: true }));
    fixture.detectChanges();
    expect(find('ptah-readiness-ring')).toBeNull();
    const alert = find('[data-testid="canvas-empty-board-readiness-error"]')!;
    expect(alert.getAttribute('role')).toBe('alert');
    alert.querySelector<HTMLButtonElement>('button')!.click();
    expect(vitals.retryReadiness).toHaveBeenCalledTimes(1);
  });

  it('hides the history link only once the list confirms no previous sessions', () => {
    const { fixture, find, previousSessionCount } = mount();
    const opened = jest.fn();
    fixture.componentInstance.previousSessionsRequested.subscribe(opened);
    expect(find('[data-testid="canvas-empty-board-history"]')?.textContent?.trim()).toBe('Previous sessions');
    previousSessionCount.set(0);
    fixture.detectChanges();
    expect(find('[data-testid="canvas-empty-board-history"]')).toBeNull();
    previousSessionCount.set(41);
    fixture.detectChanges();
    const link = find<HTMLButtonElement>('[data-testid="canvas-empty-board-history"]')!;
    expect(link.textContent?.trim()).toBe('41 previous sessions');
    link.click();
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it('at the running cap the aria-disabled trigger keeps its reason and does not emit', () => {
    const { fixture, find } = mount();
    const requested = jest.fn();
    fixture.componentInstance.newSessionRequested.subscribe(requested);
    fixture.componentRef.setInput('newSessionBlockReason', 'Too many sessions are running.');
    fixture.detectChanges();
    const trigger = find<HTMLButtonElement>('[data-testid="canvas-hero-new-session"]')!;
    expect(trigger.getAttribute('aria-disabled')).toBe('true');
    expect(trigger.disabled).toBe(false);
    // Visibly blocked, not only announced as blocked.
    expect(trigger.classList).toContain('ptah-empty-board__new--blocked');
    expect(trigger.getAttribute('aria-describedby')).toBe('canvas-rail-empty-board-reason');
    expect(find('#canvas-rail-empty-board-reason')?.textContent).toContain('Too many sessions are running.');
    trigger.click();
    expect(requested).not.toHaveBeenCalled();
    fixture.componentRef.setInput('newSessionBlockReason', null);
    fixture.detectChanges();
    expect(trigger.classList).not.toContain('ptah-empty-board__new--blocked');
    expect(trigger.getAttribute('aria-disabled')).toBeNull();
    trigger.click();
    expect(requested).toHaveBeenCalledTimes(1);
  });

  it('renders one notice above the hero, with its severity, and emits its key', () => {
    const { fixture, find, host } = mount();
    const dismissed = jest.fn();
    fixture.componentInstance.noticeDismissed.subscribe(dismissed);
    fixture.componentRef.setInput('notice', { kind: 'write-failure', text: 'Layout could not be saved.', key: 'save:1' });
    fixture.detectChanges();
    const notice = find('[data-testid="canvas-board-notice"]')!;
    expect(notice.getAttribute('role')).toBe('alert');
    expect(notice.compareDocumentPosition(find('#canvas-rail-empty-board-title')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    notice.querySelector<HTMLButtonElement>('button')!.click();
    expect(dismissed).toHaveBeenCalledWith('save:1');
    fixture.componentRef.setInput('notice', { kind: 'cap', text: 'Cap', key: 'cap:2' });
    fixture.detectChanges();
    expect(host.querySelectorAll('[data-testid="canvas-board-notice"]')).toHaveLength(1);
    expect(find('[data-testid="canvas-board-notice"]')?.getAttribute('role')).toBe('status');
  });

  it('shows no Ctrl N hint: no renderer keybinding exists for it (A5)', () => {
    const { host } = mount();
    expect(host.querySelector('kbd')).toBeNull();
    expect(host.textContent).not.toMatch(/Ctrl/);
  });
});
