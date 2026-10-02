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

  it('renders a labelled note naming the parent, branch and worktree', () => {
    const el: HTMLElement = mount('Planner').nativeElement;
    const note = el.querySelector('[role="note"]');

    expect(note).not.toBeNull();
    expect(note?.getAttribute('aria-label')).toBe('Agent-started session');
    const text = note?.textContent ?? '';
    expect(text).toContain('Started by "Planner"');
    expect(text).toContain('Via ptah_session_start');
    expect(text).toContain('feat/child');
    expect(text).toContain('/ws/.worktrees/child');
    expect(text).toContain('You can type here.');
  });

  it('names the parent once, not again in the paragraph', () => {
    const el: HTMLElement = mount('Planner').nativeElement;
    const occurrences = (el.textContent ?? '').split('Started by').length - 1;
    expect(occurrences).toBe(1);
  });

  it('shows the policy inline on wide panels and behind a closed disclosure on narrow ones', () => {
    const el: HTMLElement = mount('Planner').nativeElement;
    const inline = el.querySelector('[data-test="agent-origin-policy-inline"]');
    const disclosure: HTMLDetailsElement | null = el.querySelector(
      '[data-test="agent-origin-policy-disclosure"]',
    );

    expect(inline?.classList).toContain('hidden');
    expect(inline?.classList).toContain('sm:inline');
    expect(inline?.textContent).toContain('Runs unattended');
    expect(disclosure?.tagName).toBe('DETAILS');
    expect(disclosure?.classList).toContain('sm:hidden');
    expect(disclosure?.open).toBe(false);
    expect(disclosure?.querySelector('summary')?.textContent).toContain(
      'How this session runs',
    );
    expect(disclosure?.textContent).toContain('Runs unattended');
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

    button?.click();
    expect(emitted).toEqual(['parent-tab']);
  });

  it('says the parent tab is closed and offers no action when it is gone', () => {
    const el: HTMLElement = mount(null).nativeElement;

    expect(el.textContent).toContain('an agent session whose tab is closed');
    expect(
      el.querySelector('[data-test="agent-origin-open-parent"]'),
    ).toBeNull();
  });
});
