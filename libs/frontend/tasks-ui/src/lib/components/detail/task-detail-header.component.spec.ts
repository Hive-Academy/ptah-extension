import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  CARRIER_FILE,
  CONTEXT_FILE,
  type TaskSpecDetail,
  type TaskStatus,
} from '@ptah-extension/shared';
import { TaskDetailHeaderComponent } from './task-detail-header.component';

function makeDetail(overrides: Partial<TaskSpecDetail> = {}): TaskSpecDetail {
  return {
    id: 'TASK_2026_871_0d04',
    folderName: 'TASK_2026_871_0d04',
    status: 'backlog',
    type: 'FEATURE',
    title: 'Revamp the Tasks UI',
    dependsOn: [],
    labels: [],
    duplicates: [],
    relatesTo: [],
    created: null,
    updated: null,
    frontmatterValid: true,
    validationIssues: [],
    body: '',
    artifacts: [CARRIER_FILE, CONTEXT_FILE],
    ...overrides,
  };
}

describe('TaskDetailHeaderComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [TaskDetailHeaderComponent] });
  });

  function render(
    detail: TaskSpecDetail | null,
    inputs: { busy?: boolean; starting?: boolean; folderHint?: string } = {},
  ) {
    const fixture = TestBed.createComponent(TaskDetailHeaderComponent);
    fixture.componentRef.setInput('detail', detail);
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const at = (id: string) =>
      host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    return { fixture, host, at };
  }

  it('shows Back, the breadcrumb, title, badges and the folder path', () => {
    const { at, host } = render(makeDetail());
    expect(at('task-detail-back')?.textContent).toContain('Board');
    expect(at('task-detail-breadcrumb')?.textContent).toContain(
      '.ptah / specs / TASK_2026_871_0d04',
    );
    expect(host.querySelector('h2')?.textContent).toContain(
      'Revamp the Tasks UI',
    );
    expect(at('task-detail-status')?.textContent).toContain('Backlog');
    expect(host.textContent).toContain('FEATURE');
    expect(at('task-detail-path')?.textContent?.trim()).toBe(
      '.ptah/specs/TASK_2026_871_0d04/',
    );
  });

  it('moves focus to Back when the page opens', () => {
    const { at } = render(makeDetail());
    TestBed.inject(ApplicationRef).tick();
    expect(document.activeElement).toBe(at('task-detail-back'));
  });

  it('emits back, and the card payloads for Start and a new status', () => {
    const { fixture, at, host } = render(makeDetail());
    const events: unknown[] = [];
    fixture.componentInstance.back.subscribe(() => events.push('back'));
    fixture.componentInstance.startTask.subscribe((r) => events.push(r));
    fixture.componentInstance.statusChange.subscribe((c) => events.push(c));

    at('task-detail-back')?.click();
    at('task-detail-start')?.click();
    host.querySelector<HTMLElement>('[data-status="in_progress"]')?.click();

    expect(events).toEqual([
      'back',
      { taskId: 'TASK_2026_871_0d04', isolate: false },
      { taskId: 'TASK_2026_871_0d04', status: 'in_progress' },
    ]);
  });

  it('does not emit a status change for the current status', () => {
    const { fixture, host } = render(makeDetail());
    const changes: unknown[] = [];
    fixture.componentInstance.statusChange.subscribe((c) => changes.push(c));
    const current = host.querySelector<HTMLElement>('[data-status="backlog"]');
    expect(current?.getAttribute('aria-current')).toBe('true');
    current?.click();
    expect(changes).toEqual([]);
  });

  it.each<TaskStatus>(['in_progress', 'in_review', 'done', 'cancelled'])(
    'offers Start only where the card does (not for %s)',
    (status) => {
      const { at } = render(makeDetail({ status }));
      expect(at('task-detail-start')).toBeNull();
      expect(at('task-detail-status-trigger')).not.toBeNull();
    },
  );

  it('disables Start while launching and the menu while a write runs', () => {
    const { at } = render(makeDetail({ status: 'blocked' }), {
      busy: true,
      starting: true,
    });
    expect(at('task-detail-start')?.hasAttribute('disabled')).toBe(true);
    // The trigger stays focusable during a write; it is aria-disabled.
    const trigger = at('task-detail-status-trigger');
    expect(trigger?.hasAttribute('disabled')).toBe(false);
    expect(trigger?.getAttribute('aria-disabled')).toBe('true');
  });

  describe('keyboard access (visual review N2, N3)', () => {
    const FOCUS_RING = [
      'focus-visible:outline',
      'focus-visible:outline-2',
      'focus-visible:outline-base-content',
    ];

    /** Natively tabbable, not removed by tabindex, and not display:none. */
    function tabbable(root: HTMLElement): HTMLElement[] {
      return Array.from(
        root.querySelectorAll<HTMLElement>(
          'button, a[href], input, select, textarea, summary, [tabindex]',
        ),
      ).filter(
        (el) =>
          el.getAttribute('tabindex') !== '-1' &&
          !el.hasAttribute('disabled') &&
          !el.closest('.hidden'),
      );
    }

    function menuItems(host: HTMLElement): HTMLElement[] {
      return Array.from(
        host.querySelectorAll<HTMLElement>(
          '[data-testid="task-detail-status-menu"] [role="menuitem"]',
        ),
      );
    }

    function key(target: HTMLElement, name: string): void {
      target.dispatchEvent(
        new KeyboardEvent('keydown', { key: name, bubbles: true }),
      );
    }

    function openWithClick(
      fixture: ReturnType<typeof render>['fixture'],
      trigger: HTMLElement,
    ): void {
      trigger.click();
      fixture.detectChanges();
      TestBed.inject(ApplicationRef).tick();
    }

    it('gives Back, Start, the trigger and every menu item a focus ring', () => {
      const { at, host } = render(makeDetail());
      const targets = [
        at('task-detail-back'),
        at('task-detail-start'),
        at('task-detail-status-trigger'),
        ...menuItems(host),
      ];
      expect(menuItems(host)).toHaveLength(6);
      for (const el of targets) {
        expect(el).not.toBeNull();
        for (const cls of FOCUS_RING) expect(el?.classList).toContain(cls);
      }
      // Buttons take the shared outward offset; menu items draw it inward so
      // the menu's padding does not clip it.
      for (const el of targets.slice(0, 3)) {
        expect(el?.classList).toContain('focus-visible:outline-offset-2');
        expect(el?.classList).not.toContain('focus-visible:-outline-offset-2');
      }
      for (const item of menuItems(host)) {
        expect(item.classList).toContain('focus-visible:-outline-offset-2');
        expect(item.classList).not.toContain('focus-visible:outline-offset-2');
      }
    });

    it('stays closed when a status write starts and finishes', () => {
      const { fixture, at } = render(makeDetail());
      const trigger = at('task-detail-status-trigger') as HTMLElement;
      const menu = at('task-detail-status-menu') as HTMLElement;
      openWithClick(fixture, trigger);
      expect(trigger.getAttribute('aria-expanded')).toBe('true');

      fixture.componentRef.setInput('busy', true);
      fixture.detectChanges();
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      fixture.componentRef.setInput('busy', false);
      fixture.detectChanges();

      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      expect(menu.classList).toContain('hidden');
    });

    it('lets Escape bubble while the menu is hidden', () => {
      const { fixture, at, host } = render(makeDetail());
      const trigger = at('task-detail-status-trigger') as HTMLElement;
      const bubbled: string[] = [];
      const listener = (e: KeyboardEvent) => bubbled.push(e.key);
      document.addEventListener('keydown', listener);
      try {
        // Never opened.
        key(trigger, 'Escape');
        // Opened, then hidden by a status write.
        openWithClick(fixture, trigger);
        fixture.componentRef.setInput('busy', true);
        fixture.detectChanges();
        key(menuItems(host)[0], 'Escape');
        // Open and visible: consumed.
        fixture.componentRef.setInput('busy', false);
        fixture.detectChanges();
        openWithClick(fixture, trigger);
        key(menuItems(host)[0], 'Escape');
      } finally {
        document.removeEventListener('keydown', listener);
      }
      expect(bubbled).toEqual(['Escape', 'Escape']);
    });

    it('moves focus to Back with the focus ring forced visible', () => {
      // The render hook can already run inside the first detectChanges, so
      // the spy goes on before render.
      const focus = jest.spyOn(HTMLElement.prototype, 'focus');
      try {
        const { at } = render(makeDetail());
        TestBed.inject(ApplicationRef).tick();
        const back = at('task-detail-back');
        const call = focus.mock.contexts.findIndex((el) => el === back);
        expect(call).toBeGreaterThanOrEqual(0);
        expect(focus.mock.calls[call]).toEqual([{ focusVisible: true }]);
      } finally {
        focus.mockRestore();
      }
    });

    it('makes Change status a single Tab stop, open or closed', () => {
      const { fixture, at, host } = render(makeDetail());
      const trigger = at('task-detail-status-trigger') as HTMLElement;
      const named = (root: HTMLElement) =>
        tabbable(root).filter(
          (el) =>
            el.textContent?.includes('Change status') ||
            el.getAttribute('aria-label') === 'Change status',
        );
      expect(named(host)).toEqual([trigger]);

      openWithClick(fixture, trigger);
      expect(named(host)).toEqual([trigger]);
      // Items are focusable by script (roving), never extra Tab stops.
      for (const item of menuItems(host)) {
        expect(item.getAttribute('tabindex')).toBe('-1');
      }
    });

    it('announces a menu button whose aria-expanded follows the menu', () => {
      const { fixture, at } = render(makeDetail());
      const trigger = at('task-detail-status-trigger') as HTMLElement;
      const menu = at('task-detail-status-menu') as HTMLElement;
      expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
      expect(trigger.getAttribute('aria-controls')).toBe(menu.id);
      expect(menu.getAttribute('role')).toBe('menu');
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      expect(menu.classList).toContain('hidden');

      openWithClick(fixture, trigger);
      expect(trigger.getAttribute('aria-expanded')).toBe('true');
      expect(menu.classList).not.toContain('hidden');

      openWithClick(fixture, trigger);
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      expect(menu.classList).toContain('hidden');
    });

    it('opens onto the first item and moves with the arrow keys', () => {
      const { fixture, at, host } = render(makeDetail());
      const trigger = at('task-detail-status-trigger') as HTMLElement;
      openWithClick(fixture, trigger);
      const items = menuItems(host);
      expect(document.activeElement).toBe(items[0]);

      key(items[0], 'ArrowDown');
      expect(document.activeElement).toBe(items[1]);
      key(items[1], 'End');
      expect(document.activeElement).toBe(items[items.length - 1]);
      key(items[items.length - 1], 'ArrowDown');
      expect(document.activeElement).toBe(items[0]);
      key(items[0], 'ArrowUp');
      expect(document.activeElement).toBe(items[items.length - 1]);
    });

    it('opens onto the last item with ArrowUp on the trigger', () => {
      const { fixture, at, host } = render(makeDetail());
      const trigger = at('task-detail-status-trigger') as HTMLElement;
      key(trigger, 'ArrowUp');
      fixture.detectChanges();
      TestBed.inject(ApplicationRef).tick();
      const items = menuItems(host);
      expect(trigger.getAttribute('aria-expanded')).toBe('true');
      expect(document.activeElement).toBe(items[items.length - 1]);
    });

    it('closes on Escape and returns focus to the trigger', () => {
      const { fixture, at, host } = render(makeDetail());
      const trigger = at('task-detail-status-trigger') as HTMLElement;
      openWithClick(fixture, trigger);
      const item = menuItems(host)[2];
      item.focus();

      key(item, 'Escape');
      fixture.detectChanges();

      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(trigger);
    });

    it('keeps focus on the trigger through the write a keyboard pick starts', () => {
      const { fixture, at, host } = render(makeDetail());
      const changes: unknown[] = [];
      fixture.componentInstance.statusChange.subscribe((c) => changes.push(c));
      const trigger = at('task-detail-status-trigger') as HTMLButtonElement;
      key(trigger, 'ArrowDown');
      fixture.detectChanges();
      TestBed.inject(ApplicationRef).tick();
      const done = host.querySelector<HTMLElement>('[data-status="done"]');
      done?.focus();
      // Enter or Space on a native button fires its click.
      done?.click();
      fixture.detectChanges();
      expect(changes).toEqual([
        { taskId: 'TASK_2026_871_0d04', status: 'done' },
      ]);
      expect(document.activeElement).toBe(trigger);

      // The host starts the write.
      fixture.componentRef.setInput('busy', true);
      fixture.detectChanges();
      expect(trigger.disabled).toBe(false);
      expect(trigger.getAttribute('aria-disabled')).toBe('true');
      expect(document.activeElement).toBe(trigger);

      // Enter / Space (click) and ArrowDown do not open the menu meanwhile.
      trigger.click();
      key(trigger, 'ArrowDown');
      fixture.detectChanges();
      TestBed.inject(ApplicationRef).tick();
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(trigger);

      fixture.componentRef.setInput('busy', false);
      fixture.detectChanges();
      expect(trigger.hasAttribute('aria-disabled')).toBe(false);
      expect(document.activeElement).toBe(trigger);
    });

    it('closes after a pick and gives focus back to the trigger', () => {
      const { fixture, at, host } = render(makeDetail());
      const changes: unknown[] = [];
      fixture.componentInstance.statusChange.subscribe((c) => changes.push(c));
      const trigger = at('task-detail-status-trigger') as HTMLElement;
      openWithClick(fixture, trigger);

      host.querySelector<HTMLElement>('[data-status="done"]')?.click();
      fixture.detectChanges();

      expect(changes).toEqual([
        { taskId: 'TASK_2026_871_0d04', status: 'done' },
      ]);
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(trigger);
    });

    it('closes when focus leaves the trigger and menu', () => {
      const { fixture, at } = render(makeDetail());
      const trigger = at('task-detail-status-trigger') as HTMLElement;
      openWithClick(fixture, trigger);

      at('task-detail-back')?.focus();
      fixture.detectChanges();

      expect(trigger.getAttribute('aria-expanded')).toBe('false');
    });
  });

  it('keeps Back and the folder hint while the detail loads', () => {
    const { at } = render(null, { folderHint: 'TASK_2026_871_0d04' });
    expect(at('task-detail-back')).not.toBeNull();
    expect(at('task-detail-breadcrumb')?.textContent).toContain(
      'TASK_2026_871_0d04',
    );
    expect(at('task-detail-start')).toBeNull();
    expect(at('task-detail-status-trigger')).toBeNull();
  });
});
