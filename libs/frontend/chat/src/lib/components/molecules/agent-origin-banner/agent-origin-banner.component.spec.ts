import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { TabAgentOrigin } from '@ptah-extension/chat-types';
import { AgentOriginBannerComponent } from './agent-origin-banner.component';

const ORIGIN: TabAgentOrigin = {
  parentTabId: 'parent-tab',
  parentSessionId: null,
  label: 'Child',
  branch: 'feat/child',
  worktreePath: '/ws/.worktrees/child',
  startedAt: 1,
};

function mount(
  parentTitle: string | null,
): ComponentFixture<AgentOriginBannerComponent> {
  TestBed.configureTestingModule({ imports: [AgentOriginBannerComponent] });
  const fixture = TestBed.createComponent(AgentOriginBannerComponent);
  fixture.componentRef.setInput('origin', ORIGIN);
  fixture.componentRef.setInput('parentTitle', parentTitle);
  fixture.detectChanges();
  return fixture;
}

describe('AgentOriginBannerComponent (TASK_2026_584)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('renders a labelled, collapsed hint with the parent and branch', () => {
    const el: HTMLElement = mount('Planner').nativeElement;
    const note = el.querySelector('[role="note"]');
    const toggle: HTMLButtonElement | null = el.querySelector(
      '[data-test="agent-origin-toggle"]',
    );

    expect(note).not.toBeNull();
    expect(note?.getAttribute('aria-label')).toBe('Agent-started session');
    const text = note?.textContent ?? '';
    expect(text).toContain('Started by "Planner"');
    expect(text).toContain('feat/child');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    // No reference to a details element that is not rendered.
    expect(toggle?.hasAttribute('aria-controls')).toBe(false);
    expect(toggle?.getAttribute('aria-label')).toBe('Show session details');
    expect(el.querySelector('[data-test="agent-origin-details"]')).toBeNull();
  });

  it('names the parent once, not again in the paragraph', () => {
    const el: HTMLElement = mount('Planner').nativeElement;
    const occurrences = (el.textContent ?? '').split('Started by').length - 1;
    expect(occurrences).toBe(1);
  });

  it('expands and collapses the session details', () => {
    const fixture = mount('Planner');
    const toggle: HTMLButtonElement = fixture.nativeElement.querySelector(
      '[data-test="agent-origin-toggle"]',
    );

    toggle.click();
    fixture.detectChanges();

    const details: HTMLElement | null = fixture.nativeElement.querySelector(
      '[data-test="agent-origin-details"]',
    );
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toMatch(/^agent-origin-details-\d+$/);
    expect(details?.id).toBe(toggle.getAttribute('aria-controls'));
    expect(toggle.getAttribute('aria-label')).toBe('Hide session details');
    expect(details?.textContent).toContain('Via ptah_session_start');
    expect(details?.textContent).toContain('feat/child');
    expect(details?.textContent).toContain('/ws/.worktrees/child');
    expect(details?.textContent).toContain('You can type here.');
    expect(details?.textContent).toContain('Runs unattended');

    toggle.click();
    fixture.detectChanges();

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(
      fixture.nativeElement.querySelector('[data-test="agent-origin-details"]'),
    ).toBeNull();
  });

  it('collapses again when the reused instance gets another origin', () => {
    const fixture = mount('Planner');
    const toggle: HTMLButtonElement = fixture.nativeElement.querySelector(
      '[data-test="agent-origin-toggle"]',
    );
    toggle.click();
    fixture.detectChanges();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    fixture.componentRef.setInput('origin', { ...ORIGIN, branch: 'feat/other' });
    fixture.detectChanges();

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(
      fixture.nativeElement.querySelector('[data-test="agent-origin-details"]'),
    ).toBeNull();
  });

  it('"Open parent" is a labelled, keyboard-reachable button that emits the parent tab id', () => {
    const fixture = mount('Planner');
    const emitted: string[] = [];
    fixture.componentInstance.openParent.subscribe((id) => emitted.push(id));

    const button: HTMLButtonElement | null =
      fixture.nativeElement.querySelector(
        '[data-test="agent-origin-open-parent"]',
      );
    expect(button?.tagName).toBe('BUTTON');
    expect(button?.type).toBe('button');
    expect(button?.getAttribute('aria-label')).toBe(
      'Open parent session Planner',
    );
    expect(button?.tabIndex).toBe(0);

    // A canvas tile focuses its own tab on click; the switch must not bubble.
    const tileClick = jest.fn();
    fixture.nativeElement.addEventListener('click', tileClick);
    button?.click();
    expect(emitted).toEqual(['parent-tab']);
    expect(tileClick).not.toHaveBeenCalled();
  });

  it('says the parent tab is closed and offers no action when it is gone', () => {
    const el: HTMLElement = mount(null).nativeElement;

    expect(el.textContent).toContain('an agent session whose tab is closed');
    expect(
      el.querySelector('[data-test="agent-origin-open-parent"]'),
    ).toBeNull();
  });
});
