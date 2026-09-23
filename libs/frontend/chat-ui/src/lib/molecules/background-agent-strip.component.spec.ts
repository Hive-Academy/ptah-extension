import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  BackgroundAgentStripComponent,
  formatAgentElapsed,
  formatAgentTokens,
  type BackgroundAgentStripEntry,
} from './background-agent-strip.component';

function entry(
  overrides: Partial<BackgroundAgentStripEntry> & { id: string },
): BackgroundAgentStripEntry {
  return {
    name: overrides.id,
    origin: 'foreground',
    status: 'running',
    steerable: false,
    stoppable: false,
    canBackground: false,
    canViewTranscript: false,
    ...overrides,
  };
}

describe('formatAgentElapsed', () => {
  it.each([
    [undefined, null],
    [-1, null],
    [400, '<1s'],
    [58_000, '58s'],
    [134_000, '2m 14s'],
    [120_000, '2m'],
    [3_780_000, '1h 03m'],
  ])('formats %p as %p', (ms, expected) => {
    expect(formatAgentElapsed(ms)).toBe(expected);
  });
});

describe('formatAgentTokens', () => {
  it.each([
    [undefined, null],
    [0, null],
    [850, '850 tok'],
    [1_000, '1k tok'],
    [1_240, '1.2k tok'],
    [41_300, '41k tok'],
    [1_320_000, '1.3M tok'],
  ])('formats %p as %p', (tokens, expected) => {
    expect(formatAgentTokens(tokens)).toBe(expected);
  });
});

describe('BackgroundAgentStripComponent', () => {
  let fixture: ComponentFixture<BackgroundAgentStripComponent>;

  const query = <T extends Element = HTMLElement>(sel: string): T | null =>
    fixture.nativeElement.querySelector(sel);
  const queryAll = (sel: string): HTMLElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll(sel));

  /** Required element lookup — fails the test with the selector when absent. */
  function el<T extends Element = HTMLElement>(
    sel: string,
    root: ParentNode = fixture.nativeElement,
  ): T {
    const found = root.querySelector<T>(sel);
    if (!found) throw new Error(`Expected element for selector ${sel}`);
    return found;
  }
  const text = (sel: string): string =>
    (el(sel).textContent ?? '').replace(/\s+/g, ' ').trim();

  function render(entries: readonly BackgroundAgentStripEntry[]): void {
    fixture.componentRef.setInput('entries', entries);
    fixture.detectChanges();
  }

  function expand(): void {
    el<HTMLButtonElement>('[data-test="agent-strip-toggle"]').click();
    fixture.detectChanges();
  }

  function openMenu(id: string): HTMLElement {
    const row = el(`[data-agent-id="${id}"]`);
    el<HTMLButtonElement>(
      '[data-test="agent-strip-menu-trigger"]',
      row,
    ).click();
    fixture.detectChanges();
    return row;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BackgroundAgentStripComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(BackgroundAgentStripComponent);
  });

  it('renders nothing when there are no entries', () => {
    render([]);
    expect(query('[data-test="agent-strip-toggle"]')).toBeNull();
  });

  describe('summary row', () => {
    // TASK_2026_533: the strip lists a DIFFERENT population from the session
    // AGENTS chip (the backend's lifetime count of unique subagents). It must
    // name the population it shows instead of calling every entry an agent.
    it('labels five completed background entries as five background', () => {
      render(
        ['a', 'b', 'c', 'd', 'e'].map((id) =>
          entry({ id, origin: 'background', status: 'completed' }),
        ),
      );
      expect(text('[data-test="agent-strip-summary"]')).toBe(
        '5 background · 5 done',
      );
    });

    it('labels both populations explicitly for mixed entries', () => {
      render([
        entry({ id: 'a', origin: 'background', status: 'background' }),
        entry({ id: 'b', origin: 'background', status: 'completed' }),
        entry({ id: 'c', origin: 'background', status: 'completed' }),
        entry({ id: 'd', origin: 'foreground', status: 'running' }),
        entry({ id: 'e', origin: 'foreground', status: 'running' }),
      ]);
      expect(text('[data-test="agent-strip-summary"]')).toBe(
        '3 background · 2 foreground · 3 running · 2 done',
      );
    });

    it('labels foreground-only entries as foreground', () => {
      render([
        entry({ id: 'a', status: 'running' }),
        entry({ id: 'b', status: 'running' }),
      ]);
      expect(text('[data-test="agent-strip-summary"]')).toBe(
        '2 foreground · 2 running',
      );
    });

    it('includes completed, failed and stopped counts when present', () => {
      render([
        entry({ id: 'a', origin: 'background', status: 'completed' }),
        entry({ id: 'b', origin: 'background', status: 'error' }),
        entry({ id: 'c', origin: 'background', status: 'stopped' }),
      ]);
      expect(text('[data-test="agent-strip-summary"]')).toBe(
        '3 background · 1 done · 1 failed · 1 stopped',
      );
    });
  });

  describe('expand / collapse', () => {
    it('is collapsed by default and toggles the list with aria-expanded', () => {
      render([entry({ id: 'a' })]);
      const toggle = el<HTMLButtonElement>('[data-test="agent-strip-toggle"]');
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(query('[data-test="agent-strip-list"]')).toBeNull();

      expand();
      const list = el('[data-test="agent-strip-list"]');
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(list.getAttribute('role')).toBe('list');
      expect(toggle.getAttribute('aria-controls')).toBe(list.id);
      expect(queryAll('[role="listitem"]')).toHaveLength(1);

      expand();
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(query('[data-test="agent-strip-list"]')).toBeNull();
    });

    it('comes back collapsed after the list empties', () => {
      render([entry({ id: 'a' })]);
      expand();
      render([]);
      render([entry({ id: 'b' })]);
      expect(query('[data-test="agent-strip-list"]')).toBeNull();
    });
  });

  describe('rows', () => {
    it('renders name, hint and a status line with elapsed time and tokens', () => {
      render([
        entry({
          id: 'a',
          name: 'software-architect',
          hint: 'reviewer',
          description: 'Bash',
          durationMs: 134_000,
          totalTokens: 41_000,
        }),
      ]);
      expand();
      expect(text('[data-test="agent-strip-name"]')).toBe(
        'software-architect · reviewer',
      );
      expect(text('[data-test="agent-strip-status-line"]')).toBe(
        'Bash · 2m 14s · 41k tok',
      );
    });

    it('falls back to the status label when there is no description', () => {
      render([entry({ id: 'a', status: 'completed' })]);
      expand();
      expect(text('[data-test="agent-strip-status-line"]')).toBe('Completed');
    });

    it('emits focusAgent when the name/summary area is clicked', () => {
      const spy = jest.fn();
      fixture.componentInstance.focusAgent.subscribe(spy);
      render([entry({ id: 'a' })]);
      expand();
      el<HTMLButtonElement>('[data-test="agent-strip-focus"]').click();
      expect(spy).toHaveBeenCalledWith('a');
    });

    it('offers no menu when no action applies', () => {
      render([entry({ id: 'a', status: 'completed' })]);
      expand();
      expect(query('[data-test="agent-strip-menu-trigger"]')).toBeNull();
    });
  });

  describe('actions menu', () => {
    const actionable = entry({
      id: 'a',
      name: 'tester',
      steerable: true,
      stoppable: true,
      canBackground: true,
      canViewTranscript: true,
    });

    it('lists only the actions the capability flags allow', () => {
      render([
        entry({ id: 'b', status: 'background', canViewTranscript: true }),
      ]);
      expand();
      const row = openMenu('b');
      expect(
        row.querySelector('[data-test="agent-menu-transcript"]'),
      ).not.toBeNull();
      expect(row.querySelector('[data-test="agent-menu-steer"]')).toBeNull();
      expect(
        row.querySelector('[data-test="agent-menu-background"]'),
      ).toBeNull();
      expect(row.querySelector('[data-test="agent-menu-stop"]')).toBeNull();
    });

    it('does not announce the action panel as a listbox', () => {
      render([actionable]);
      expand();
      const row = openMenu('a');
      const panel = el('.dropdown-panel', row);
      expect(panel.hasAttribute('role')).toBe(false);
      expect(
        el('[data-test="agent-strip-menu-trigger"]', row).hasAttribute(
          'aria-haspopup',
        ),
      ).toBe(false);
    });

    it.each([
      ['agent-menu-transcript', 'viewTranscript'],
      ['agent-menu-background', 'sendToBackground'],
      ['agent-menu-stop', 'stop'],
    ] as const)('%s emits %s and closes the menu', (testId, outputName) => {
      const spy = jest.fn();
      fixture.componentInstance[outputName].subscribe(spy);
      render([actionable]);
      expand();
      const row = openMenu('a');
      const trigger = el('[data-test="agent-strip-menu-trigger"]', row);
      expect(trigger.getAttribute('aria-expanded')).toBe('true');

      el<HTMLButtonElement>(`[data-test="${testId}"]`, row).click();
      fixture.detectChanges();

      expect(spy).toHaveBeenCalledWith('a');
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
    });

    it('Steer opens the inline steer input and emits the submitted text', () => {
      const spy = jest.fn();
      fixture.componentInstance.steer.subscribe(spy);
      render([actionable]);
      expand();
      const row = openMenu('a');
      el<HTMLButtonElement>('[data-test="agent-menu-steer"]', row).click();
      fixture.detectChanges();

      const input = el<HTMLInputElement>('ptah-agent-steer-input input');
      expect(input.getAttribute('placeholder')).toBe('Steer tester…');
      input.value = 'focus on the flaky test';
      input.dispatchEvent(new Event('input'));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

      expect(spy).toHaveBeenCalledWith({
        id: 'a',
        text: 'focus on the flaky test',
      });
    });

    it('disables the steer input while its request is pending', () => {
      render([actionable]);
      expand();
      el<HTMLButtonElement>(
        '[data-test="agent-menu-steer"]',
        openMenu('a'),
      ).click();
      fixture.componentRef.setInput('pendingSteerId', 'a');
      fixture.detectChanges();
      expect(
        el<HTMLInputElement>('ptah-agent-steer-input input').disabled,
      ).toBe(true);
    });
  });
});
