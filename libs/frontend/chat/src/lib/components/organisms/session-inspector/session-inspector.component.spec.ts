import { NgTemplateOutlet } from '@angular/common';
import { encapsulateStyle } from '@angular/compiler';
import { Component, NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TabManagerService } from '@ptah-extension/chat-state';
import type { SessionStatsInputs } from '@ptah-extension/chat-ui';
import {
  SessionInspectorStore,
  type SessionInspectorModel,
} from '../../../services/session-inspector';
import { SessionInspectorComponent } from './session-inspector.component';

const emptyStats: SessionStatsInputs = {
  sessionId: null,
  snapshot: null,
  liveModelStats: null,
  compactionCount: 0,
  limits: null,
  budget: null,
  context: {
    hasLive: false,
    known: false,
    percent: null,
    label: '—',
    usedTokens: null,
  },
  limitSummary: {
    state: 'none',
    text: null,
    extra: 0,
    source: null,
    fullText: null,
  },
};
const emptyModel: SessionInspectorModel = {
  tabId: 'one',
  sessionId: null,
  orchestrator: {
    model: null,
    state: { kind: 'idle' },
    contextPercent: null,
    contextWindow: null,
    tokens: null,
    cost: null,
    turns: null,
    requests: [],
  },
  agents: { status: 'unknown', data: null },
  requests: [],
  needsYouCount: 0,
};

@Component({
  standalone: true,
  imports: [SessionInspectorComponent],
  template: `<ptah-session-inspector
    tabId="one"
    presentation="embedded"
    [sessionTitle]="title"
    sessionStatus="running"
  />`,
})
class ControlsHost {
  title = '';
}

describe('SessionInspectorComponent motion styles', () => {
  const source = readFileSync(join(__dirname, 'session-inspector.component.ts'), 'utf8');
  const css = source.match(/styles: `([\s\S]*?)`,\r?\n\}\)/)?.[1] ?? '';

  it('uses shared preset keyframes for the stats switch', () => {
    expect(css).toContain('animation: ptahMotionEnter var(--ptah-motion-switch)');
    expect(css).toContain('animation: ptahMotionLeave var(--ptah-motion-out)');
    expect(css).not.toMatch(/inspectorStats(Rise|Leave|FadeIn|FadeOut)/);
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('scopes transform-only glass entrance and cut exit to the root ancestor', () => {
    const compiled = encapsulateStyle(css, 'test');
    expect(compiled).toMatch(/\[data-glass='on'\]\s+\[_nghost-test\]\s+\.inspector-stats-enter/);
    expect(compiled).toMatch(/\[data-glass='on'\]\s+\[_nghost-test\]\s+\.inspector-stats-leave/);
    expect(compiled).toMatch(/\[data-glass='on'\]\[data-motion-style='fade'\]\s+\[_nghost-test\]\s+\.inspector-stats-enter/);
    expect(compiled).toMatch(/\[data-glass='on'\]\[data-motion-style='scale'\]\s+\[_nghost-test\]\s+\.inspector-stats-enter/);
    expect(css).toContain('animation-name: ptahMotionEnterGlass');
    expect(css).toMatch(/\.inspector-stats-leave\s*\{\s*animation: none;\s*display: none;/);
  });
});

describe('SessionInspectorComponent presentation', () => {
  const model = signal(emptyModel);
  beforeEach(() => {
    model.set(emptyModel);
    TestBed.configureTestingModule({
      imports: [SessionInspectorComponent],
      providers: [
        { provide: SessionInspectorStore, useValue: { modelFor: () => model } },
        {
          provide: TabManagerService,
          useValue: { findTabByIdAcrossWorkspaces: () => null },
        },
      ],
    }).overrideComponent(SessionInspectorComponent, {
      set: { imports: [NgTemplateOutlet], schemas: [NO_ERRORS_SCHEMA] },
    });
  });
  afterEach(() => TestBed.resetTestingModule());

  function create(stats: SessionStatsInputs | null = emptyStats) {
    const fixture = TestBed.createComponent(SessionInspectorComponent);
    fixture.componentRef.setInput('tabId', 'one');
    fixture.componentRef.setInput('presentation', 'rail');
    fixture.componentRef.setInput('stats', stats);
    fixture.detectChanges();
    return fixture;
  }

  it('passes uncached input tokens to the Orchestrator and preserves missing data', () => {
    TestBed.overrideComponent(SessionInspectorComponent, {
      set: { template: '<span data-testid="input">{{ sessionTokens()?.input ?? "—" }}</span>' },
    });
    const snapshot: NonNullable<SessionStatsInputs['snapshot']> = {
      sessionId: 'one',
      model: 'test-model',
      totalCost: 0,
      knownCost: 0,
      tokenCount: 650,
      tokens: { input: 100, output: 50, cacheRead: 200, cacheCreation: 300 },
      messageCount: 0,
      agentSessionCount: 0,
      status: 'ok',
      pricingCoverage: 'full',
      scope: 'session',
      revision: 1,
    };
    const fixture = create({ ...emptyStats, snapshot });
    const input = () => (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="input"]',
    )?.textContent?.trim();
    expect(input()).toBe('100');
    fixture.componentRef.setInput('stats', emptyStats);
    fixture.detectChanges();
    expect(input()).toBe('—');
  });

  it('renders only expand when no session stats are available', () => {
    model.set({ ...emptyModel, needsYouCount: 2 });
    const fixture = create(null);
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelectorAll('button')).toHaveLength(1);
    expect(element.querySelector('[data-inspector-expand]')).not.toBeNull();
    expect(element.textContent).not.toContain('Run');
    expect(element.textContent).not.toContain('Ctx');
  });

  it.each(['near', 'at'] as const)(
    'shows the %s limit warning on expand and context with the full accessible description',
    (state) => {
      const fixture = create();
      const fullText = 'Codex plan limit warning (+2 more)';
      fixture.componentRef.setInput('limitSummary', {
        state,
        text: 'Codex plan limit warning',
        extra: 2,
        source: 'lane',
        fullText,
      });
      fixture.detectChanges();
      const element: HTMLElement = fixture.nativeElement;
      const buttons = element.querySelectorAll('button');
      for (const button of [buttons[0], buttons[1]]) {
        expect(button.getAttribute('aria-label')).toContain(fullText);
        expect(button.getAttribute('title')).toContain(fullText);
        const warning = button.querySelector('[aria-hidden="true"]');
        expect(warning?.textContent?.trim()).toBe('!');
        expect(
          warning?.classList.contains(
            state === 'at' ? 'text-state-err' : 'text-state-need',
          ),
        ).toBe(true);
      }
      expect(buttons[2].getAttribute('aria-label')).not.toContain(fullText);
      fixture.componentRef.setInput('limitSummary', emptyStats.limitSummary);
      fixture.detectChanges();
      expect(element.querySelector('[aria-hidden="true"]')).toBeNull();
      expect(buttons[0].getAttribute('aria-label')).toBe(
        'Expand session details',
      );
      expect(buttons[1].getAttribute('aria-label')).toBe('Context unavailable');
    },
  );

  it('uses the stats limit summary when the host supplies no separate summary', () => {
    const fixture = create({
      ...emptyStats,
      limitSummary: {
        state: 'at',
        text: 'At limit',
        extra: 0,
        source: 'session',
        fullText: 'At limit',
      },
    });
    const element: HTMLElement = fixture.nativeElement;
    expect(
      element
        .querySelector('[data-inspector-expand]')
        ?.getAttribute('aria-label'),
    ).toBe('Expand session details; At limit');
    expect(element.querySelectorAll('.text-state-err')).toHaveLength(2);
  });

  it('renders unknown fields as labeled dashes, omitting absent time and todos', () => {
    const fixture = create();
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('aside')?.classList.contains('w-14')).toBe(
      true,
    );
    for (const field of ['Context', 'Tokens', 'Cost']) {
      const tile = element.querySelector(`[aria-label="${field} unavailable"]`);
      expect(tile?.textContent).toContain('—');
      expect(tile?.getAttribute('title')).toBe(`${field} unavailable`);
    }
    expect(element.textContent).not.toContain('Time');
    expect(element.textContent).not.toContain('Todo');
    expect(element.querySelectorAll('button')).toHaveLength(4);
  });

  it('emits expansion targets and exposes the attention count', () => {
    model.set({
      ...emptyModel,
      needsYouCount: 2,
      agents: { status: 'ready', data: { rows: [], active: 3, finished: 0 } },
    });
    const fixture = create();
    const requests: (string | undefined)[] = [];
    fixture.componentInstance.expandRequested.subscribe((value) =>
      requests.push(value),
    );
    const buttons = (
      fixture.nativeElement as HTMLElement
    ).querySelectorAll<HTMLButtonElement>('button');
    buttons[0].click();
    buttons[1].click();
    expect(requests).toEqual([undefined, 'session']);
    const aggregate = fixture.nativeElement.querySelector('[aria-label="Running agents: 3; 2 need you"]');
    expect(aggregate?.textContent).toContain('2!');
    // A bare span ignores aria-label; the role makes assistive tech announce it.
    expect(aggregate?.getAttribute('role')).toBe('img');
    expect(fixture.nativeElement.textContent).not.toContain('Run');
  });

  it('focuses the requested section on expansion and the expand control on collapse', () => {
    const fixture = create();
    const element: HTMLElement = fixture.nativeElement;
    document.body.appendChild(element);
    fixture.componentRef.setInput('stats', emptyStats);
    fixture.componentRef.setInput('focusSection', 'agents');
    fixture.componentRef.setInput('presentation', 'docked');
    fixture.detectChanges();
    expect(document.activeElement?.getAttribute('data-inspector-section')).toBe(
      'agents',
    );
    fixture.componentRef.setInput('presentation', 'rail');
    fixture.detectChanges();
    expect(document.activeElement).toBe(
      element.querySelector('[data-inspector-expand]'),
    );
    element.remove();
  });

  it('renders wrapped identity and preserves every expanded section', () => {
    const fixture = create();
    fixture.componentRef.setInput('presentation', 'docked');
    fixture.componentRef.setInput('sessionTitle', 'Full session title');
    fixture.componentRef.setInput('sessionStatus', 'idle');
    fixture.componentRef.setInput('workflow', 'Review');
    fixture.componentRef.setInput('branch', 'feature/test');
    fixture.componentRef.setInput('stats', emptyStats);
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('h2')?.textContent?.trim()).toBe(
      'Full session title',
    );
    expect(element.textContent).toContain('feature/test');
    for (const section of [
      'session-stats',
      'agents-section',
      'task-section',
      'todos-section',
      'git-section',
    ]) {
      expect(element.querySelector(`ptah-inspector-${section}`)).not.toBeNull();
    }
    const close = jest.fn();
    fixture.componentInstance.closeRequested.subscribe(close);
    element.querySelector<HTMLButtonElement>('[data-inspector-close]')?.click();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('crossfades stats only when the session changes', () => {
    jest.useFakeTimers();
    try {
      const first = { ...emptyStats, sessionId: 'session-a' };
      const fixture = create(first);
      fixture.componentRef.setInput('presentation', 'docked');
      fixture.detectChanges();
      const stats = () => fixture.nativeElement.querySelectorAll('ptah-inspector-session-stats');
      expect(stats()).toHaveLength(1);
      expect(stats()[0].classList.contains('inspector-stats-enter')).toBe(false);

      fixture.componentRef.setInput('stats', { ...first, compactionCount: 1 });
      fixture.detectChanges();
      expect(stats()).toHaveLength(1);
      expect(stats()[0].classList.contains('inspector-stats-enter')).toBe(false);

      fixture.componentRef.setInput('tabId', 'another-tab');
      fixture.detectChanges();
      expect(stats()).toHaveLength(1);
      expect(stats()[0].classList.contains('inspector-stats-enter')).toBe(false);

      fixture.componentRef.setInput('stats', { ...first, sessionId: 'session-b' });
      fixture.detectChanges();
      expect(stats()).toHaveLength(2);
      expect(stats()[0].classList.contains('inspector-stats-leave')).toBe(true);
      expect(stats()[0].getAttribute('aria-hidden')).toBe('true');
      expect(stats()[1].classList.contains('inspector-stats-enter')).toBe(true);

      jest.advanceTimersByTime(420);
      fixture.detectChanges();
      expect(stats()).toHaveLength(1);
      expect(stats()[0].classList.contains('inspector-stats-enter')).toBe(false);
      fixture.componentRef.setInput('stats', { ...first, sessionId: 'session-b', compactionCount: 2 });
      fixture.detectChanges();
      expect(stats()).toHaveLength(1);
      expect(stats()[0].classList.contains('inspector-stats-enter')).toBe(false);
      fixture.destroy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not animate when the same session returns after null stats', () => {
    jest.useFakeTimers();
    try {
      const first = { ...emptyStats, sessionId: 'session-a' };
      const fixture = create(first);
      fixture.componentRef.setInput('presentation', 'docked');
      fixture.detectChanges();
      fixture.componentRef.setInput('stats', null);
      fixture.detectChanges();
      fixture.componentRef.setInput('stats', first);
      fixture.detectChanges();
      const stats = fixture.nativeElement.querySelectorAll('ptah-inspector-session-stats');
      expect(stats).toHaveLength(1);
      expect(stats[0].classList.contains('inspector-stats-enter')).toBe(false);
      fixture.destroy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('animates A to null to B and reads the current switch token', () => {
    jest.useFakeTimers();
    try {
      const first = { ...emptyStats, sessionId: 'session-a' };
      const fixture = create(first);
      fixture.componentRef.setInput('presentation', 'docked');
      fixture.detectChanges();
      const stats = () => fixture.nativeElement.querySelectorAll('ptah-inspector-session-stats');

      fixture.componentRef.setInput('stats', null);
      fixture.detectChanges();
      expect(stats()).toHaveLength(0);

      fixture.componentRef.setInput('stats', { ...first, sessionId: 'session-b' });
      fixture.detectChanges();
      expect(stats()).toHaveLength(2);
      expect(stats()[0].classList.contains('inspector-stats-leave')).toBe(true);
      expect(stats()[1].classList.contains('inspector-stats-enter')).toBe(true);

      fixture.nativeElement.style.setProperty('--ptah-motion-switch', '0.7s');
      fixture.componentRef.setInput('stats', { ...first, sessionId: 'session-c' });
      fixture.detectChanges();
      expect(stats()).toHaveLength(2);
      jest.advanceTimersByTime(739);
      fixture.detectChanges();
      expect(stats()).toHaveLength(2);
      jest.advanceTimersByTime(1);
      fixture.detectChanges();
      expect(stats()).toHaveLength(1);
      fixture.destroy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps only the collapse control at the right of the title row, with no separate bar, and the status under the title', () => {
    const fixture = TestBed.createComponent(ControlsHost);
    fixture.componentInstance.title = 'A very long session title';
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    const headers = element.querySelectorAll('header');
    expect(headers).toHaveLength(1);
    const [identity, controls] = Array.from(headers[0].children);
    expect(identity.classList).toContain('min-w-0');
    expect(identity.classList).toContain('flex-1');
    expect(identity.querySelector('h2')?.textContent?.trim()).toBe('A very long session title');
    expect(identity.querySelector('p')?.textContent?.trim()).toBe('running');
    expect(controls.classList).toContain('shrink-0');
    const labels = Array.from(controls.querySelectorAll('button')).map(
      (b) => b.getAttribute('aria-label') ?? b.textContent?.trim(),
    );
    // Session actions live in the session card menu: the title row has only the collapse.
    expect(labels).toEqual(['Compact session details']);
    expect(controls.lastElementChild?.hasAttribute('data-inspector-close')).toBe(true);
  });

  it('names the collapse by presentation and never shows a close-session X in the sheet', () => {
    const fixture = create();
    fixture.componentRef.setInput('presentation', 'sheet');
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('h2')).toBeNull();
    expect(
      element.querySelector('[data-inspector-close]')?.getAttribute('aria-label'),
    ).toBe('Close session details');
    // The sheet's collapse uses the same panel icon as the dock, not an X that reads as Close session.
    expect(element.querySelector('[data-inspector-close] lucide-angular')).not.toBeNull();
    expect('XIcon' in fixture.componentInstance).toBe(false);
    const host = TestBed.createComponent(ControlsHost);
    host.detectChanges();
    expect(host.nativeElement.querySelector('h2')).toBeNull();
  });
});
