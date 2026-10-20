import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ATTENTION_ACTION_DISPATCHER, NotificationService, type AttentionItem } from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat';
import { By } from '@angular/platform-browser';
import type { CompactRailDensity, CompactRailState } from '@ptah-extension/chat-ui';
import type { CanvasTile } from '../canvas.store';
import { railWidthPx } from '../canvas-board-mode';
import { DEFAULT_TILE_WIDTH } from '../canvas-layout-intent';
import { RUNNING_CAP_MESSAGE } from '../canvas-running-cap';
import {
  CanvasRailCardComponent,
  SPLIT_ALREADY_FOCUSED_REASON,
  SPLIT_NEEDS_TWO_SESSIONS_REASON,
} from './canvas-rail-card.component';
import { CanvasRailComponent } from './canvas-rail.component';

@Component({
  // Match the real component's native list-item host.
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'li[ptah-canvas-rail-card]', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-tab-id]': 'tabId()', 'data-rail-card': '' },
  template: `@if (collapsed()) {
    <div aria-hidden="true" style="display: none"><button class="rc-select">Hidden</button></div>
    <button type="button">Select</button>
  } @else { <button class="rc-select">Select</button> }`,
})
class CardStub {
  readonly tabId = input.required<string>(); readonly density = input<CompactRailDensity>('comfortable');
  readonly collapsed = input(false); readonly index = input(1); readonly focused = input(false);
  readonly holdText = input(false); readonly state = input<CompactRailState>('idle');
  readonly attentionItems = input<readonly AttentionItem[]>([]);
  readonly submittingKeys = input<ReadonlySet<string>>(new Set());
  readonly blockedKeys = input<ReadonlySet<string>>(new Set());
  readonly attentionAction = output<{item: AttentionItem; actionId: string}>();
  readonly otherRequests = output<void>();
  readonly focusRequested = output<string>(); readonly railState = output<CompactRailState>();
  readonly staleAction = output<string>(); readonly lanesRequested = output<string>();
  readonly canMoveUp = input(false); readonly canMoveDown = input(false);
  readonly splitDisabledReason = input<string | null>(null);
  readonly openBesideRequested = output<string>(); readonly moveUpRequested = output<string>();
  readonly moveDownRequested = output<string>();
}

const tile = (tabId: string, order: number): CanvasTile => ({ tabId, order, width: DEFAULT_TILE_WIDTH, rowBreakBefore: false });

describe('CanvasRailComponent', () => {
  const dispatchOutcome = jest.fn().mockResolvedValue({ kind: 'completed' });
  beforeEach(() => {
    dispatchOutcome.mockReset().mockResolvedValue({ kind: 'completed' });
    TestBed.configureTestingModule({ imports: [CanvasRailComponent], providers: [
      { provide: TabManagerService, useValue: { findTabByIdAcrossWorkspaces: (id: string) => ({ tab: { claudeSessionId: id === 'a' ? 'session-a' : null } }) } },
      { provide: ATTENTION_ACTION_DISPATCHER, useValue: { dispatchOutcome } },
    ] });
    TestBed.overrideComponent(CanvasRailComponent, { remove: { imports: [CanvasRailCardComponent] }, add: { imports: [CardStub] } });
  });
  function mount(tiles: readonly CanvasTile[] = []) {
    const fixture = TestBed.createComponent(CanvasRailComponent);
    fixture.componentRef.setInput('tiles', tiles); fixture.detectChanges(); return fixture;
  }
  it('projects local requests and dispatches the authoritative action', async () => {
    const notifications = TestBed.inject(NotificationService);
    const request: AttentionItem = {
      key: 'permission:one', generation: 1, kind: 'permission', source: 'chat',
      workspacePath: '/local', workspaceName: 'local', sessionId: 'session-a',
      severity: 'warning', title: 'Permission required', sessionTitle: 'Alpha', detail: 'Tool: Bash',
      actions: [{ id: 'allow', label: 'Allow' }, { id: 'deny', label: 'Deny' }], actionable: true, soundEligible: false,
    };
    notifications.upsert(request);
    const fixture = mount([tile('a', 1)]);
    fixture.componentRef.setInput('workspacePath', '/local'); fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('[data-testid="rail-needs-you"]')?.textContent).toContain('Alpha');
    dispatchOutcome.mockImplementationOnce(async () => {
      notifications.resolve(request.key, request.generation);
      return { kind: 'completed' };
    });
    (host.querySelector('[data-attention-key] button') as HTMLButtonElement).click();
    expect(dispatchOutcome).toHaveBeenCalledWith(request.key, request.generation, 'allow');
    await fixture.whenStable();
    notifications.resolve(request.key, request.generation); fixture.detectChanges();
    expect(host.querySelector('[data-testid="rail-needs-you"]')).toBeNull();
  });
  const request = (key: string, overrides: Partial<AttentionItem> = {}): AttentionItem => ({
    key, generation: 1, kind: 'permission', source: 'chat', workspacePath: '/local',
    workspaceName: 'local', sessionId: 'session-a', severity: 'warning',
    title: 'Permission required', detail: 'Tool: Bash', actionable: true, soundEligible: false,
    actions: [{ id: 'allow', label: 'Allow' }, { id: 'deny', label: 'Deny' }, { id: 'open', label: 'Show in canvas' }],
    ...overrides,
  });
  it('uses unavailable identity and promotes Show in canvas when Allow is disabled', () => {
    TestBed.inject(NotificationService).upsert(request('disabled', { actions: [
      { id: 'allow', label: 'Allow', disabledReason: 'Already decided' },
      { id: 'open', label: 'Show in canvas' },
    ] }));
    const fixture = mount([tile('a', 0)]);
    fixture.componentRef.setInput('workspacePath', '/local'); fixture.detectChanges();
    const row = (fixture.nativeElement as HTMLElement).querySelector('[data-attention-key]')!;
    expect(row.textContent).toContain('Session unavailable');
    expect(row.textContent).toContain('Permission required');
    const buttons = row.querySelectorAll<HTMLButtonElement>('button');
    expect(buttons[0].disabled).toBe(true);
    expect(buttons[0].classList).not.toContain('btn-primary');
    expect(buttons[1].classList).toContain('btn-primary');
  });
  it('opens overflow idempotently and reports a missing bell', () => {
    const notifications = TestBed.inject(NotificationService);
    for (let index = 0; index < 4; index++) notifications.upsert(request(`overflow:${index}`));
    const fixture = mount([tile('a', 0)]);
    fixture.componentRef.setInput('workspacePath', '/local'); fixture.detectChanges();
    const overflow = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-testid="rail-needs-you"] > button')!;
    overflow.click(); fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Notifications are unavailable.');
    const bell = document.createElement('button');
    bell.dataset['testid'] = 'notification-center-bell';
    bell.setAttribute('aria-expanded', 'false');
    const clicked = jest.fn(() => bell.setAttribute('aria-expanded', 'true'));
    bell.addEventListener('click', clicked);
    document.body.appendChild(bell);
    try {
      overflow.click(); overflow.click();
      expect(clicked).toHaveBeenCalledTimes(1);
    } finally { bell.remove(); }
  });
  it.each([
    [{ kind: 'stale' }, 'Request changed. Open the current request.'],
    [{ kind: 'unavailable', reason: 'No handler' }, 'No handler'],
  ])('disables %s actions and clears their status when the generation changes', async (outcome, message) => {
    const notifications = TestBed.inject(NotificationService);
    notifications.upsert(request('stale'));
    dispatchOutcome.mockResolvedValueOnce(outcome);
    const fixture = mount([tile('a', 0)]);
    fixture.componentRef.setInput('workspacePath', '/local'); fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    host.querySelector<HTMLButtonElement>('[data-attention-key] button')!.click();
    await fixture.whenStable(); fixture.detectChanges();
    expect(host.querySelectorAll<HTMLButtonElement>('[data-attention-key] button:disabled')).toHaveLength(3);
    expect(stubs(fixture)[0].blockedKeys().has('stale')).toBe(true);
    host.querySelector<HTMLButtonElement>('[data-attention-key] button')!.click();
    expect(dispatchOutcome).toHaveBeenCalledTimes(1);
    notifications.upsert(request('stale', { generation: 2 })); fixture.detectChanges();
    expect(host.textContent).not.toContain(message);
    expect(host.querySelector<HTMLButtonElement>('[data-attention-key] button')?.disabled).toBe(false);
  });
  it('prefers tab id and assigns a session fallback to only the first tile', () => {
    const notifications = TestBed.inject(NotificationService);
    notifications.upsert(request('direct', { tabId: 'b' }));
    const fixture = mount([tile('a', 0), tile('b', 1)]);
    fixture.componentRef.setInput('workspacePath', '/local'); fixture.detectChanges();
    expect(stubs(fixture).map(card => card.attentionItems().map(item => item.key))).toEqual([[], ['direct']]);
    notifications.upsert(request('fallback', { tabId: 'missing' })); fixture.detectChanges();
    expect(stubs(fixture).map(card => card.attentionItems().map(item => item.key))).toEqual([['fallback'], ['direct']]);
  });
  it('renders a list in stable order and counts state chips on one line', () => {
    const fixture = mount([tile('b', 2), tile('a', 1)]);
    fixture.componentRef.setInput('states', new Map([['a', 'needs'], ['b', 'running']])); fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('ul[role="list"]')).not.toBeNull();
    expect([...host.querySelectorAll('[data-tab-id]')].map(el => el.getAttribute('data-tab-id'))).toEqual(['a', 'b']);
    expect(host.querySelector('.rail-chips')?.className).toContain('whitespace-nowrap');
    expect(host.textContent).toContain('1 needs you');
    fixture.componentRef.setInput('states', new Map([['a', 'done'], ['b', 'error']])); fixture.detectChanges();
    expect([...host.querySelectorAll('[data-tab-id]')].map(el => el.getAttribute('data-tab-id'))).toEqual(['a', 'b']);
  });
  it('keeps a capped New session focusable and refuses its click', () => {
    const fixture = mount([tile('a', 1)]); const emit = jest.fn(); fixture.componentInstance.newSession.subscribe(emit);
    fixture.componentRef.setInput('canStart', false); fixture.detectChanges();
    const button = (fixture.nativeElement as HTMLElement).querySelector('footer button')!;
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('aria-describedby')).toBe('rail-new-session-reason');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(RUNNING_CAP_MESSAGE);
    (button as HTMLButtonElement).click(); expect(emit).not.toHaveBeenCalled();
    fixture.componentRef.setInput('canAdd', false); fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('The board holds 20 sessions. Close one to add another.');
  });
  it('emits the actual secondary footer button as the popover anchor', () => {
    const fixture = mount();
    const emitted = jest.fn();
    fixture.componentInstance.newSession.subscribe(emitted);
    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-testid="canvas-footer-new-session"]')!;
    expect(button.classList).toContain('btn-outline');
    button.click();
    expect(emitted).toHaveBeenCalledWith(button);
  });
  it('opens Previous sessions in both footer forms even when New session is capped', () => {
    const fixture = mount();
    const requested = jest.fn();
    fixture.componentInstance.previousSessionsRequested.subscribe(requested);
    fixture.componentRef.setInput('canStart', false);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const footer = host.querySelector('footer')!;
    const previous = host.querySelector<HTMLButtonElement>('[data-previous-sessions-trigger]')!;
    expect(footer.classList.contains('min-h-[120px]')).toBe(true);
    expect(footer.classList.contains('h-[120px]')).toBe(false);
    expect(host.querySelector('#rail-new-session-reason')?.textContent?.trim()).toBeTruthy();
    expect(previous.previousElementSibling?.textContent).toContain('New session');
    expect(previous.textContent).toContain('Previous sessions');
    expect(previous.getAttribute('aria-haspopup')).toBe('dialog');
    expect(previous.getAttribute('aria-expanded')).toBe('false');
    // Design 2.1: lucide History icon (not a text glyph) and the ghost + hairline class string.
    const icon = previous.querySelector('lucide-angular');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    expect(icon?.querySelector('svg')).not.toBeNull();
    expect(icon?.classList).toContain('w-3.5');
    expect(icon?.classList).toContain('h-3.5');
    expect(previous.textContent).not.toContain('◷');
    for (const cls of ['gap-1.5', 'font-medium', 'min-h-[30px]', 'border-[color:var(--surface-border-strong)]', 'hover:!bg-surface-2', 'hover:!border-[color:var(--surface-border-strong)]', '[&[aria-expanded=true]]:!bg-surface-3']) {
      expect(previous.classList).toContain(cls);
    }
    expect(previous.classList).not.toContain('border-base-content/10');
    previous.click();
    expect(requested).toHaveBeenCalledTimes(1);
    fixture.componentRef.setInput('previousSessionsOpen', true);
    fixture.componentRef.setInput('collapsed', true);
    fixture.detectChanges();
    expect(footer.classList.contains('h-[82px]')).toBe(true);
    expect(previous.getAttribute('aria-label')).toBe('Previous sessions');
    expect(previous.getAttribute('title')).toBe('Previous sessions');
    expect(previous.textContent?.trim()).toBe('');
    expect(previous.querySelector('lucide-angular svg')).not.toBeNull();
    expect(previous.getAttribute('aria-expanded')).toBe('true');
    expect(previous.getAttribute('aria-controls')).toBe('previous-sessions-dialog');
    expect(host.querySelector('#rail-new-session-reason')?.classList.contains('sr-only')).toBe(true);
    previous.click();
    expect(requested).toHaveBeenCalledTimes(2);
  });
  it('collapse toggle: aria-expanded follows the visible state and a click emits', () => {
    const fixture = mount([tile('a', 1)]); const emit = jest.fn(); fixture.componentInstance.collapseToggled.subscribe(emit);
    const host = fixture.nativeElement as HTMLElement;
    const toggle = () => host.querySelector('[data-testid="rail-collapse-toggle"]') as HTMLButtonElement;
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(toggle().getAttribute('aria-label')).toBe('Collapse rail');
    expect(toggle().getAttribute('aria-disabled')).toBeNull();
    expect(toggle().hasAttribute('title')).toBe(false);
    toggle().click(); expect(emit).toHaveBeenCalledTimes(1);
    fixture.componentRef.setInput('collapsed', true); fixture.detectChanges();
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(toggle().getAttribute('aria-label')).toBe('Expand rail');
    toggle().click(); expect(emit).toHaveBeenCalledTimes(2);
  });
  it('collapse toggle: auto-collapsed it stays focusable, explains why and refuses its click', () => {
    const fixture = mount([tile('a', 1)]); const emit = jest.fn(); fixture.componentInstance.collapseToggled.subscribe(emit);
    fixture.componentRef.setInput('collapsed', true); fixture.componentRef.setInput('autoCollapsed', true); fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const toggle = host.querySelector('[data-testid="rail-collapse-toggle"]') as HTMLButtonElement;
    expect(toggle.disabled).toBe(false);
    expect(toggle.getAttribute('aria-disabled')).toBe('true');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('title')).toBe('Widen the canvas to expand the Rail');
    expect(toggle.getAttribute('aria-describedby')).toBe('rail-collapse-reason');
    expect(host.querySelector('#rail-collapse-reason')?.textContent?.trim()).toBe('Widen the canvas to expand the Rail');
    toggle.focus(); expect(document.activeElement).toBe(toggle);
    toggle.click(); expect(emit).not.toHaveBeenCalled();
  });
  it('toggles density, hides it when collapsed, and shows the large-list hint', () => {
    const fixture = mount(Array.from({ length: 12 }, (_, i) => tile(String(i), i)));
    const host = fixture.nativeElement as HTMLElement;
    const density = host.querySelector<HTMLButtonElement>('[aria-label="Dense cards"]')!;
    expect(density.getAttribute('aria-pressed')).toBe('false');
    expect(density.getAttribute('aria-describedby')).toBe('rail-density-hint');
    fixture.componentRef.setInput('collapsed', true); fixture.detectChanges();
    expect(host.querySelector('[aria-label="Dense cards"]')).toBeNull();
  });
  it('shows the zero state and permits New session', () => {
    const fixture = mount(); const emit = jest.fn(); fixture.componentInstance.newSession.subscribe(emit);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('No sessions yet');
    (fixture.nativeElement as HTMLElement).querySelector('footer button')!.dispatchEvent(new MouseEvent('click'));
    expect(emit).toHaveBeenCalledTimes(1);
  });
  it('shows a compact zero state in the collapsed 56 px rail and keeps its words for screen readers', () => {
    const fixture = mount();
    const host = fixture.nativeElement as HTMLElement;
    const empty = () => host.querySelector('[data-testid="rail-empty"]') as HTMLElement;
    expect(empty().textContent?.trim()).toBe('No sessions yet');
    expect(empty().querySelector('.sr-only')).toBeNull();
    fixture.componentRef.setInput('collapsed', true); fixture.detectChanges();
    const visible = empty().querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(visible.textContent?.trim()).toBe('—');
    expect(empty().querySelector('.sr-only')?.textContent?.trim()).toBe('No sessions yet');
    expect(empty().classList).not.toContain('px-3');
  });
  it('gives the collapse toggle at least a 24 x 24 px target in both rail widths (WCAG 2.5.8)', () => {
    const fixture = mount([tile('a', 1)]);
    const host = fixture.nativeElement as HTMLElement;
    const toggle = () => host.querySelector('[data-testid="rail-collapse-toggle"]') as HTMLButtonElement;
    for (const collapsed of [false, true]) {
      fixture.componentRef.setInput('collapsed', collapsed); fixture.detectChanges();
      expect(toggle().classList).toContain('min-w-6');
      expect(toggle().classList).toContain('min-h-6');
    }
  });
  it('moves DOM focus through collapsed cards with repeated ArrowDown and ArrowUp', () => {
    const fixture = mount([tile('a', 0), tile('b', 1), tile('c', 2)]);
    fixture.componentRef.setInput('collapsed', true);
    fixture.componentRef.setInput('surfaceActive', true);
    fixture.detectChanges();
    const cards = [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('[data-rail-card]')];
    const visible = (index: number) => cards[index].querySelector<HTMLButtonElement>('button:not(.rc-select)') as HTMLButtonElement;
    visible(0).focus();
    for (const [key, index] of [['ArrowDown', 1], ['ArrowDown', 2], ['ArrowUp', 1], ['ArrowUp', 0]] as const) {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      expect(document.activeElement).toBe(visible(index));
    }
  });
  const stubs = (fixture: ReturnType<typeof mount>) =>
    fixture.debugElement.queryAll(By.directive(CardStub)).map((debug) => debug.componentInstance as CardStub);
  it('forwards openBeside, moveUp and moveDown payloads from the card unchanged (payload forwarding, Rail side)', () => {
    const fixture = mount([tile('a', 0), tile('b', 1), tile('c', 2)]);
    const rail = fixture.componentInstance;
    const beside = jest.fn(); const up = jest.fn(); const down = jest.fn();
    rail.openBesideRequested.subscribe(beside); rail.moveUpRequested.subscribe(up); rail.moveDownRequested.subscribe(down);
    const [, middle] = stubs(fixture);
    middle.openBesideRequested.emit('b'); middle.moveUpRequested.emit('b'); middle.moveDownRequested.emit('b');
    expect(beside.mock.calls).toEqual([['b']]);
    expect(up.mock.calls).toEqual([['b']]);
    expect(down.mock.calls).toEqual([['b']]);
  });
  it('computes Move up/down from the sorted ids: first card no Move up, last no Move down', () => {
    const fixture = mount([tile('c', 2), tile('a', 0), tile('b', 1)]);
    const cards = stubs(fixture);
    expect(cards.map((card) => card.tabId())).toEqual(['a', 'b', 'c']);
    expect(cards.map((card) => [card.canMoveUp(), card.canMoveDown()])).toEqual([[false, true], [true, true], [true, false]]);
    fixture.componentRef.setInput('tiles', [tile('a', 0)]); fixture.detectChanges();
    expect(stubs(fixture).map((card) => [card.canMoveUp(), card.canMoveDown()])).toEqual([[false, false]]);
  });
  it('passes the board reason to every card, else the focused-pane reason to the focused card only (B6)', () => {
    const fixture = mount([tile('a', 0), tile('b', 1), tile('c', 2)]);
    expect(stubs(fixture).map((card) => card.splitDisabledReason())).toEqual([null, null, null]);
    fixture.componentRef.setInput('focusedTabId', 'b'); fixture.detectChanges();
    expect(stubs(fixture).map((card) => card.splitDisabledReason())).toEqual([null, 'This session is already in the focused pane', null]);
    expect(SPLIT_ALREADY_FOCUSED_REASON).toBe('This session is already in the focused pane');
    fixture.componentRef.setInput('splitDisabledReason', SPLIT_NEEDS_TWO_SESSIONS_REASON); fixture.detectChanges();
    expect(stubs(fixture).map((card) => card.splitDisabledReason())).toEqual(Array(3).fill('Open another session first to split'));
    // A focused id that is not on this board (stale or another workspace) is never a reason.
    fixture.componentRef.setInput('splitDisabledReason', null);
    fixture.componentRef.setInput('focusedTabId', 'gone'); fixture.detectChanges();
    expect(stubs(fixture).map((card) => card.splitDisabledReason())).toEqual([null, null, null]);
  });
  it('drops the horizontal list padding and the scrollbar gutter only in the collapsed 56 px rail', () => {
    const fixture = mount([tile('a', 0)]);
    const host = fixture.nativeElement as HTMLElement;
    const list = host.querySelector('ul[role="list"]') as HTMLElement;
    const scroller = host.querySelector('.overflow-y-auto') as HTMLElement;
    expect(list.classList).toContain('p-2');
    expect(scroller.classList).not.toContain('rail-scroll-collapsed');
    fixture.componentRef.setInput('collapsed', true); fixture.detectChanges();
    expect(host.querySelector('aside')?.classList).toContain('w-[56px]');
    expect(list.classList).not.toContain('p-2');
    expect(list.classList).toContain('py-2');
    expect(scroller.classList).toContain('rail-scroll-collapsed');
  });
  it('keeps plain arrows with handleCanvasRailKeydown and leaves Alt+Shift arrows to the card', () => {
    const fixture = mount([tile('a', 0), tile('b', 1), tile('c', 2)]);
    fixture.componentRef.setInput('collapsed', true); fixture.detectChanges();
    const focus = jest.fn(); fixture.componentInstance.focusRequested.subscribe(focus);
    const cards = [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('[data-rail-card]')];
    const visible = (index: number) => cards[index].querySelector<HTMLButtonElement>('button:not(.rc-select)') as HTMLButtonElement;
    visible(1).focus();
    const alt = new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, shiftKey: true, bubbles: true, cancelable: true });
    visible(1).dispatchEvent(alt);
    expect(alt.defaultPrevented).toBe(false);
    expect(focus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(visible(1));
    visible(1).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(focus).toHaveBeenCalledWith('c');
    expect(document.activeElement).toBe(visible(2));
  });
  it.each([
    [false, 'xl'],
    [false, 'lg'],
    [false, 'md'],
    [false, 'sm'],
    [true, 'lg'],
    [true, 'sm'],
  ] as const)('renders the width railWidthPx gives (collapsed %p, band %p)', (collapsed, band) => {
    const fixture = mount([tile('a', 1)]);
    fixture.componentRef.setInput('collapsed', collapsed);
    fixture.componentRef.setInput('band', band);
    fixture.detectChanges();
    const aside = (fixture.nativeElement as HTMLElement).querySelector('aside[aria-label="Sessions"]')!;
    const widths = [...aside.classList].filter((name) => /^w-\[\d+px\]$/.test(name));
    expect(widths).toEqual([`w-[${railWidthPx(collapsed, band)}px]`]);
  });
});
