import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { AttentionItem } from '@ptah-extension/core';
import { By } from '@angular/platform-browser';
import {
  CompactSessionCardComponent,
  SESSION_CARD_ACTIONS,
  SessionOrganizerService,
  SessionRowActionsService,
  TabManagerService,
} from '@ptah-extension/chat';
import {
  COMPACT_RAIL_CARD_HEIGHT,
  CompactRailCardComponent,
  type CompactLaneSummary,
  type CompactRailDensity,
  type CompactRailState,
  type CompactSessionSummary,
} from '@ptah-extension/chat-ui';
import { NativePopoverComponent } from '@ptah-extension/ui';
import { SessionId } from '@ptah-extension/shared';
import { CanvasStore } from '../canvas.store';
import { CanvasDetailService } from '../canvas-detail/canvas-detail.service';
import {
  CanvasRailCardComponent,
  SPLIT_ALREADY_FOCUSED_REASON,
  SPLIT_NEEDS_TWO_SESSIONS_REASON,
} from './canvas-rail-card.component';
import { focusRailSelectButton } from './canvas-rail-keyboard';

// jsdom has no layout or ResizeObserver: position the menu at the origin.
jest.mock('@floating-ui/dom', () => ({
  ...jest.requireActual('@floating-ui/dom'),
  computePosition: jest.fn(async () => ({ x: 0, y: 0 })),
  autoUpdate: jest.fn(() => () => undefined),
}));

const tabState = signal<CompactRailState>('idle');
/** Hover may repaint, never resize: these properties cannot move layout. */
const PAINT_ONLY = ['background-color', 'border-color', 'box-shadow', 'color'];
// jest-preset-angular strips component styles, so read the inline CSS source.
const hoverRules = () =>
  [
    ...readFileSync(
      join(__dirname, 'canvas-rail-card.component.ts'),
      'utf8',
    ).matchAll(/([^{}]*)\{([^{}]*)\}/g),
  ]
    .map(([, selector, body]) => ({
      selector: selector.replace(/\/\*[\s\S]*?\*\//g, '').trim(),
      props: body
        .split(';')
        .map((part) => part.split(':')[0].trim())
        .filter(Boolean),
    }))
    .filter((rule) => rule.selector.includes(':hover'));

@Component({
  selector: 'ptah-compact-session-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<button
      class="rc-select"
      type="button"
      (click)="expandToFull.emit()"
    >
      Select
    </button>
    <button type="button" (click)="actions?.openLane('orchestrator')">
      Lane
    </button>
    <button
      type="button"
      class="rc-action rc-lane-overflow"
      (click)="lanesRequested.emit()"
    >
      +2 more
    </button>`,
})
class CardStub {
  readonly actions = inject(SESSION_CARD_ACTIONS, { optional: true });
  readonly tab = input.required<unknown>();
  readonly variant = input('rail');
  readonly density = input<CompactRailDensity>('comfortable');
  readonly focused = input(false);
  readonly holdText = input(false);
  readonly reserveActionCorner = input(false);
  readonly expandToFull = output<void>();
  readonly railState = output<CompactRailState>();
  readonly staleAction = output<void>();
  readonly lanesRequested = output<void>();
  constructor() {
    effect(() => this.railState.emit(tabState()));
  }
}

/** Five running lanes: three rows plus two in the overflow. */
const FIVE_LANES: CompactLaneSummary = {
  rows: [0, 1, 2].map((i) => ({
    id: `lane-${i}`,
    name: `Lane ${i}`,
    kind: 'cli' as const,
    status: 'running' as const,
    startedAt: 1,
    endedAt: null,
  })),
  moreCount: 2,
  total: 5,
  counts: { running: 5, waiting: 0, error: 0, done: 0, stopped: 0 },
};
const RAIL_SUMMARY: CompactSessionSummary = {
  status: {
    text: 'Running',
    icon: '●',
    tone: 'live',
    sessionColor: '#123456',
    workspaceLabel: 'work',
  },
  marks: [],
  content: {
    kind: 'prose',
    text: 'Working now',
    format: 'plain',
    additionalPromptCount: 0,
    actionable: false,
  },
  metrics: {
    model: 'sonnet',
    tokens: 42,
    cost: 0.01,
    agentCount: 0,
    compactionCount: 0,
  },
};

/**
 * Stands in for the smart chat wrapper only (its store injections), with the
 * same host classes and rail bindings, and renders the REAL presentational
 * `ptah-compact-rail-card` from chat-ui, so the N6(b) case sees the real
 * lane overflow control.
 */
@Component({
  selector: 'ptah-compact-session-card',
  standalone: true,
  imports: [CompactRailCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full min-h-0 overflow-hidden' },
  template: `<ptah-compact-rail-card
    title="Alpha"
    [summary]="summary"
    [lanes]="lanes"
    [density]="density()"
    [focused]="focused()"
    [innerTabbable]="focused()"
    [holdText]="holdText()"
    [reserveActionCorner]="reserveActionCorner()"
    (selectRequested)="expandToFull.emit()"
    (moreLanes)="lanesRequested.emit()"
  />`,
})
class RealRailCardHost {
  readonly summary = RAIL_SUMMARY;
  readonly lanes = FIVE_LANES;
  readonly tab = input.required<unknown>();
  readonly variant = input('rail');
  readonly density = input<CompactRailDensity>('comfortable');
  readonly focused = input(false);
  readonly holdText = input(false);
  readonly reserveActionCorner = input(false);
  readonly expandToFull = output<void>();
  readonly railState = output<CompactRailState>();
  readonly staleAction = output<void>();
  readonly lanesRequested = output<void>();
}

describe('CanvasRailCardComponent', () => {
  const focusTile = jest.fn();
  const open = jest.fn();
  const sessionId = SessionId.create();
  const available = signal(false);
  let loaded = false;
  const rowFor = jest.fn(() => loaded ? { id: sessionId } : null);
  const organizeOpen = jest.fn((_id: typeof sessionId, _restore: () => void) => undefined);
  const organizeClose = jest.fn(() => {
    const restore = organizeOpen.mock.calls.at(-1)?.[1];
    afterNextRender(() => restore?.(), { injector: TestBed.inject(Injector) });
  });
  const openForSession = jest.fn(async (_id: typeof sessionId, _name: string, _restore: () => void) => 'opened');
  const rename = jest.fn().mockResolvedValue('renamed');
  let persisted = true;
  let workflow: 'harness-configure' | undefined;
  beforeEach(() => {
    jest.clearAllMocks();
    workflow = undefined;
    persisted = true;
    loaded = false;
    available.set(false);
    tabState.set('idle');
    TestBed.configureTestingModule({
      imports: [CanvasRailCardComponent],
      providers: [
        {
          provide: TabManagerService,
          useValue: {
            findTabByIdAcrossWorkspaces: () => ({
              tab: { id: 'a', title: 'Alpha', claudeSessionId: persisted ? sessionId : null, workflow },
            }),
          },
        },
        { provide: CanvasStore, useValue: { focusTile } },
        { provide: CanvasDetailService, useValue: { open } },
        { provide: SessionOrganizerService, useValue: { available, rowFor, open: organizeOpen, openForSession, close: organizeClose } },
        { provide: SessionRowActionsService, useValue: { rename } },
      ],
    });
    TestBed.overrideComponent(CanvasRailCardComponent, {
      remove: { imports: [CompactSessionCardComponent] },
      add: { imports: [CardStub] },
    });
  });

  function mount() {
    const fixture = TestBed.createComponent(CanvasRailCardComponent);
    fixture.componentRef.setInput('tabId', 'a');
    fixture.detectChanges();
    return fixture;
  }
  it('shows the pending chip and emits the inline action without selecting the session', () => {
    const fixture = mount();
    const item: AttentionItem = {
      key: 'question:one', generation: 1, kind: 'question', source: 'chat', workspacePath: '/local',
      workspaceName: 'local', sessionId, severity: 'info', title: 'Question needs an answer',
      detail: 'Which approach?', actions: [{ id: 'answer', label: 'Answer' }], actionable: true, soundEligible: false,
    };
    const emitted = jest.fn(); fixture.componentInstance.attentionAction.subscribe(emitted);
    fixture.componentRef.setInput('attentionItems', [item]); fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.dataset['attentionExtra']).toBe('88');
    expect(host.style.height).toBe(`${COMPACT_RAIL_CARD_HEIGHT.comfortable + 88}px`);
    expect(host.querySelector('[data-testid="rail-card-needs-you"]')?.textContent).toContain('Needs you');
    const frame = host.querySelector('[data-testid="rail-attention-frame"]') as HTMLElement;
    expect(frame).not.toBeNull();
    expect(frame.contains(host.querySelector('ptah-compact-session-card'))).toBe(true);
    expect(frame.contains(host.querySelector('[data-testid="rail-card-needs-you"]'))).toBe(true);
    expect([...frame.classList]).toEqual(expect.arrayContaining(['rounded-lg', 'border', 'bg-base-200']));
    (host.querySelector('[data-testid="rail-card-needs-you"] button') as HTMLButtonElement).click();
    expect(emitted).toHaveBeenCalledWith({ item, actionId: 'answer' });
    expect(focusTile).not.toHaveBeenCalled();
  });
  it('reports the larger attention height once and clears it when collapsed', () => {
    const fixture = mount();
    const item: AttentionItem = {
      key: 'permission:height', generation: 1, kind: 'permission', source: 'chat', workspacePath: '/local',
      workspaceName: 'local', sessionId, severity: 'warning', title: 'Permission required',
      actions: [{ id: 'allow', label: 'Allow' }, { id: 'deny', label: 'Deny' }, { id: 'open', label: 'Show in canvas' }],
      actionable: true, soundEligible: false,
    };
    const host = fixture.nativeElement as HTMLElement;
    expect(host.dataset['attentionExtra']).toBe('0');
    fixture.componentRef.setInput('attentionItems', [item]); fixture.detectChanges();
    expect(host.dataset['attentionExtra']).toBe('136');
    expect(host.style.height).toBe(`${COMPACT_RAIL_CARD_HEIGHT.comfortable + 136}px`);
    fixture.componentRef.setInput('collapsed', true); fixture.detectChanges();
    expect(host.dataset['attentionExtra']).toBe('0');
    expect(host.style.height).toBe('56px');
  });
  it('promotes the enabled decision, then Show in canvas when the decision is disabled', () => {
    const fixture = mount();
    const item: AttentionItem = {
      key: 'permission:card', generation: 1, kind: 'permission', source: 'chat', workspacePath: '/local',
      workspaceName: 'local', sessionId, severity: 'warning', title: 'Permission required',
      actions: [{ id: 'allow', label: 'Allow' }, { id: 'open', label: 'Show in canvas' }],
      actionable: true, soundEligible: false,
    };
    fixture.componentRef.setInput('attentionItems', [item]); fixture.detectChanges();
    const buttons = () => (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('[data-testid="rail-card-needs-you"] button');
    expect(buttons()[0].classList).toContain('btn-primary');
    expect(buttons()[0].classList).not.toContain('btn-ghost');
    fixture.componentRef.setInput('attentionItems', [{ ...item, actions: [
      { id: 'allow', label: 'Allow', disabledReason: 'Already decided' },
      { id: 'open', label: 'Show in canvas' },
    ] }]); fixture.detectChanges();
    expect(buttons()[0].disabled).toBe(true);
    expect(buttons()[0].classList).not.toContain('btn-primary');
    expect(buttons()[0].classList).toContain('btn-ghost');
    expect(buttons()[1].classList).toContain('btn-primary');
    expect(buttons()[1].classList).not.toContain('btn-ghost');
    fixture.componentRef.setInput('submittingKeys', new Set([item.key])); fixture.detectChanges();
    expect([...buttons()].every(button => button.disabled)).toBe(true);
    fixture.componentRef.setInput('submittingKeys', new Set());
    fixture.componentRef.setInput('blockedKeys', new Set([item.key])); fixture.detectChanges();
    expect([...buttons()].every(button => button.disabled)).toBe(true);
  });

  it('shows the workflow badge on an expanded tagged card only', () => {
    workflow = 'harness-configure';
    const fixture = mount();
    const host = fixture.nativeElement as HTMLElement;
    const badge = host.querySelector('ptah-workflow-badge');
    expect(badge?.textContent?.trim()).toBe('Workflow: Configure Harness');
    expect(badge?.querySelector('.sr-only')?.textContent?.trim()).toBe(
      'Workflow:',
    );
    expect(host.classList).toContain('flex-col');
    expect(host.style.height).toBe(
      `${COMPACT_RAIL_CARD_HEIGHT.comfortable + 20}px`,
    );
    expect(badge?.classList).not.toContain('absolute');
    expect(badge?.nextElementSibling?.tagName.toLowerCase()).toBe(
      'ptah-compact-session-card',
    );

    fixture.componentRef.setInput('collapsed', true);
    fixture.detectChanges();
    expect(host.querySelector('ptah-workflow-badge')).toBeNull();
    expect(host.classList).not.toContain('flex-col');
    expect(host.querySelector('button.rail-collapsed')?.classList).toContain(
      'h-14',
    );
    expect(host.style.height).toBe('56px');
  });

  it('keeps an untagged expanded card badge free', () => {
    const fixture = mount();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('ptah-workflow-badge')).toBeNull();
    expect(host.classList).not.toContain('flex-col');
    expect(host.style.height).toBe(`${COMPACT_RAIL_CARD_HEIGHT.comfortable}px`);
    expect(host.querySelector('ptah-compact-session-card')).not.toBeNull();
  });

  it('does not focus on selection or an inner button click, but focuses on a plain host click', () => {
    const fixture = mount();
    const host = fixture.nativeElement as HTMLElement;
    const selection = window.getSelection();
    const text = document.createTextNode('Alpha');
    host.append(text);
    selection?.selectAllChildren(host);
    host.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(focusTile).not.toHaveBeenCalled();
    selection?.removeAllRanges();
    host
      .querySelectorAll('button')[1]
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(focusTile).not.toHaveBeenCalled();
    host.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(focusTile).toHaveBeenCalledWith('a');
  });

  it('resolves the wrapper self-provider from the child and routes a lane to detail.open (A2)', () => {
    const fixture = mount();
    expect(fixture.debugElement.children[0].componentInstance.actions).toBe(
      fixture.componentInstance,
    );
    (fixture.nativeElement as HTMLElement)
      .querySelectorAll('button')[1]
      .click();
    expect(open).toHaveBeenCalledWith('a', 'orchestrator');
  });

  it('forwards repeated stale actions and rerenders the live notice; Enter focuses the session', async () => {
    const fixture = mount();
    const live = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[aria-live="polite"]')!;
    const stale = jest.fn();
    fixture.componentInstance.staleAction.subscribe(stale);
    (
      fixture.debugElement.children[0].componentInstance as CardStub
    ).staleAction.emit();
    fixture.detectChanges();
    expect(stale).toHaveBeenCalledWith('a');
    expect(live.textContent).toBe('');
    await settle();
    fixture.detectChanges();
    expect(live.textContent).toBe('This request has changed. Open the current request.');
    (
      fixture.debugElement.children[0].componentInstance as CardStub
    ).staleAction.emit();
    fixture.detectChanges();
    expect(live.textContent).toBe('');
    await settle();
    fixture.detectChanges();
    expect(live.textContent).toBe('This request has changed. Open the current request.');
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    (fixture.nativeElement as HTMLElement).dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(focusTile).toHaveBeenCalledWith('a');
  });

  it('forwards +N to lanes while leaving lane choice alone and sizes by density', () => {
    const fixture = mount();
    const lanes = jest.fn();
    fixture.componentInstance.lanesRequested.subscribe(lanes);
    expect((fixture.nativeElement as HTMLElement).style.height).toBe(
      `${COMPACT_RAIL_CARD_HEIGHT.comfortable}px`,
    );
    fixture.componentRef.setInput('density', 'dense');
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).style.height).toBe(
      `${COMPACT_RAIL_CARD_HEIGHT.dense}px`,
    );
    (fixture.nativeElement as HTMLElement)
      .querySelectorAll('button')[2]
      .click();
    expect(lanes).toHaveBeenCalledWith('a');
    expect(open).not.toHaveBeenCalled();
  });

  it('makes the host a pointer listitem whose keyboard equivalent is a button', () => {
    const fixture = mount();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.getAttribute('role')).toBe('listitem');
    expect(host.classList.contains('cursor-pointer')).toBe(true);
    expect(host.querySelector('button.rc-select')).not.toBeNull();
  });

  it('gives the collapsed button a paint-only hover and keeps its 56px height', () => {
    const fixture = mount();
    fixture.componentRef.setInput('collapsed', true);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const collapsed = host.querySelector<HTMLButtonElement>(
      'button.rail-collapsed',
    );
    expect(collapsed?.classList.contains('h-14')).toBe(true);
    expect(host.style.height).toBe('56px');
    const rules = hoverRules();
    expect(rules.map((rule) => rule.selector)).toEqual([
      '.rail-collapsed:hover',
    ]);
    for (const rule of rules) {
      for (const prop of rule.props) expect(PAINT_ONLY).toContain(prop);
    }
    collapsed?.click();
    expect(focusTile).toHaveBeenCalledTimes(1);
    expect(focusTile).toHaveBeenCalledWith('a');
  });

  it('announces focus on a collapsed card only when focused', () => {
    const fixture = mount();
    fixture.componentRef.setInput('collapsed', true);
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector(
      'button.rail-collapsed',
    ) as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).not.toContain('in focus');
    fixture.componentRef.setInput('focused', true);
    fixture.detectChanges();
    expect(button.getAttribute('aria-label')).toContain('in focus');
  });

  it('keeps focusRailSelectButton reaching the select and collapsed buttons', () => {
    const fixture = mount();
    const host = fixture.nativeElement as HTMLElement;
    focusRailSelectButton(host);
    expect(document.activeElement?.classList.contains('rc-select')).toBe(true);
    fixture.componentRef.setInput('collapsed', true);
    fixture.componentRef.setInput('focused', true);
    fixture.detectChanges();
    focusRailSelectButton(host);
    expect(document.activeElement?.classList.contains('rail-collapsed')).toBe(
      true,
    );
  });

  it('keeps the state producer mounted while collapsed and updates the dot', () => {
    const fixture = mount();
    fixture.componentRef.setInput('collapsed', true);
    fixture.detectChanges();
    const emitted = jest.fn();
    fixture.componentInstance.railState.subscribe(emitted);
    const card = fixture.nativeElement.querySelector(
      'ptah-compact-session-card',
    ) as HTMLElement;
    expect(card.style.display).toBe('none');
    tabState.set('needs');
    fixture.detectChanges();
    expect(emitted).toHaveBeenCalledWith('needs');
    fixture.componentRef.setInput('state', 'needs');
    fixture.detectChanges();
    expect(fixture.nativeElement.getAttribute('data-state')).toBe('needs');
    expect(
      fixture.nativeElement.querySelector('button span')?.getAttribute('style'),
    ).toContain('var(--rail-state-ink)');
  });
  const trigger = (host: HTMLElement) =>
    host.querySelector<HTMLButtonElement>(
      'button[aria-label="Session actions"][aria-haspopup="menu"]',
    ) as HTMLButtonElement;
  const item = (host: HTMLElement, action: string) =>
    host.querySelector<HTMLButtonElement>(
      `[data-action="${action}"]`,
    ) as HTMLButtonElement;
  const settle = () => new Promise((resolve) => setTimeout(resolve));

  async function openMenu(fixture: ReturnType<typeof mount>) {
    const host = fixture.nativeElement as HTMLElement;
    trigger(host).focus();
    trigger(host).click();
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();
    expect(host.querySelector('[role="menu"]')).not.toBeNull();
    return host;
  }

  it('shows Rename but no Delete or Organize on hosts without organization', async () => {
    const fixture = mount();
    const host = await openMenu(fixture);
    expect(item(host, 'rename').textContent).toContain('Rename');
    expect(item(host, 'rename').getAttribute('aria-haspopup')).toBe('dialog');
    expect(host.querySelector('[data-action="organize"]')).toBeNull();
    expect(host.querySelector('[data-action="delete"]')).toBeNull();
    expect([...host.querySelectorAll('[role="menuitem"]')].map((node) => node.getAttribute('data-action'))).toEqual(['open-beside', 'rename', 'move-up', 'move-down']);
  });

  it('keeps draft Rename and Organize focusable with the save reason', async () => {
    persisted = false;
    available.set(true);
    const fixture = mount();
    const host = await openMenu(fixture);
    for (const action of ['rename', 'organize']) {
      expect(item(host, action).getAttribute('aria-disabled')).toBe('true');
      expect(item(host, action).textContent).toContain('Send a first message to save this session.');
      item(host, action).click();
    }
    expect(host.querySelector('[role="menu"]')).not.toBeNull();
    expect(organizeOpen).not.toHaveBeenCalled();
    expect(openForSession).not.toHaveBeenCalled();
  });

  it('opens Rename after the menu closes, saves on Enter, and restores trigger focus', async () => {
    const fixture = mount();
    const host = await openMenu(fixture);
    item(host, 'rename').click();
    fixture.detectChanges();
    expect(host.querySelector('[role="menu"]')).toBeNull();
    await settle();
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Session name"]')!;
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
    input.value = 'Renamed';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    keydown(input, 'Enter');
    await settle();
    fixture.detectChanges();
    expect(rename).toHaveBeenCalledWith(sessionId, 'Alpha', 'Renamed');
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    await settle();
    expect(document.activeElement).toBe(trigger(host));
  });

  it('cancels Rename on Escape without saving', async () => {
    const fixture = mount();
    const host = await openMenu(fixture);
    item(host, 'rename').click();
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Session name"]')!;
    keydown(input, 'Escape');
    fixture.detectChanges();
    await settle();
    expect(rename).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger(host));
  });

  it('cycles Tab inside Rename and ignores composition Enter', async () => {
    const fixture = mount();
    const host = await openMenu(fixture);
    item(host, 'rename').click();
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();
    const input = host.querySelector<HTMLInputElement>('[role="dialog"] input')!;
    const buttons = host.querySelectorAll<HTMLButtonElement>('[role="dialog"] button');
    input.focus();
    expect(keydown(input, 'Tab', { shiftKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(buttons[1]);
    expect(keydown(buttons[1], 'Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input);
    document.body.focus();
    input.blur();
    expect(keydown(document.body, 'Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input);
    input.blur();
    expect(keydown(document.body, 'Tab', { shiftKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(buttons[1]);
    keydown(input, 'Enter', { isComposing: true });
    expect(rename).not.toHaveBeenCalled();
  });

  it('uses the specified Rename geometry and a single input focus treatment', async () => {
    const fixture = mount();
    const host = await openMenu(fixture);
    item(host, 'rename').click();
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();
    const panel = host.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(panel.classList).toContain('w-72');
    // FU-12: never wider than the viewport minus the 8 px shift padding per side,
    // and placed below the trigger so shift can move it along x into view.
    expect(panel.classList).toContain('max-w-[calc(100vw-1rem)]');
    expect(panel.classList).toContain('p-4');
    expect(panel.closest('ptah-native-popover')?.className).toContain('[&>.popover-panel]:p-0');
    const renamePopover = fixture.debugElement
      .queryAll(By.directive(NativePopoverComponent))
      .map((node) => node.componentInstance as NativePopoverComponent)
      .find((popover) => popover.isOpen());
    expect(renamePopover?.placement()).toBe('bottom-end');
    expect(panel.querySelector('h3')?.classList).toContain('text-base-content-muted');
    expect(panel.querySelector('input')?.classList).toContain('input-sm');
    // One 2 px ring over the 1 px border in the theme-measured focus ink
    // (styles.css maps the --s utility to >= 3:1 inks in light themes); no
    // separate primary border colour on focus, so no double outline.
    const inputClasses = [...(panel.querySelector('input')?.classList ?? [])];
    expect(inputClasses).toEqual(
      expect.arrayContaining([
        'focus-visible:outline',
        'focus-visible:outline-2',
        'focus-visible:outline-offset-[-1px]',
        'focus-visible:outline-[oklch(var(--s))]',
      ]),
    );
    expect(inputClasses.some((name) => name.startsWith('focus:border-'))).toBe(false);
    // Equal-width actions: two equal grid columns, not flex-1 (border skew).
    const actionRow = panel.querySelector('button')?.parentElement;
    expect([...(actionRow?.classList ?? [])]).toEqual(
      expect.arrayContaining(['grid', 'grid-cols-2']),
    );
    expect([...panel.querySelectorAll('button')].every((button) => button.classList.contains('w-full') && !button.classList.contains('flex-1'))).toBe(true);
  });

  it('raises the actions cell above later page content only while a panel is open', async () => {
    const fixture = mount();
    const host = fixture.nativeElement as HTMLElement;
    const cell = () => host.querySelector('[data-rail-actions]') as HTMLElement;
    expect(cell().classList).toContain('z-10');
    expect(cell().classList).not.toContain('z-50');
    await openMenu(fixture);
    expect(cell().classList).toContain('z-50');
    expect(cell().classList).not.toContain('z-10');
    item(host, 'rename').click();
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    expect(cell().classList).toContain('z-50');
    host.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')[0].click();
    fixture.detectChanges();
    expect(cell().classList).toContain('z-10');
    expect(cell().classList).not.toContain('z-50');
  });

  describe('Rename in flight (M4, D74)', () => {
    let resolveRename: (result: string) => void = () => undefined;

    beforeEach(() => {
      rename.mockImplementation(
        () =>
          new Promise<string>((resolve) => {
            resolveRename = resolve;
          }),
      );
    });
    afterEach(() => rename.mockResolvedValue('renamed'));

    async function openRename(fixture: ReturnType<typeof mount>) {
      const host = await openMenu(fixture);
      item(host, 'rename').click();
      fixture.detectChanges();
      await settle();
      fixture.detectChanges();
      await settle();
      fixture.detectChanges();
      const input = host.querySelector<HTMLInputElement>('input[aria-label="Session name"]')!;
      expect(document.activeElement).toBe(input);
      input.value = 'Renamed';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return { host, input };
    }
    const saveButton = (host: HTMLElement) =>
      [...host.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
        (button) => button.textContent?.trim() === 'Save',
      ) as HTMLButtonElement;
    const cancelButton = (host: HTMLElement) =>
      [...host.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
        (button) => button.textContent?.trim() === 'Cancel',
      ) as HTMLButtonElement;

    async function finish(fixture: ReturnType<typeof mount>) {
      resolveRename('renamed');
      await settle();
      fixture.detectChanges();
      await settle();
    }

    it('sends one rename for two Enters before it resolves', async () => {
      const fixture = mount();
      const { input } = await openRename(fixture);
      keydown(input, 'Enter');
      keydown(input, 'Enter');
      expect(rename).toHaveBeenCalledTimes(1);
      await finish(fixture);
      expect(rename).toHaveBeenCalledTimes(1);
    });

    it('sends one rename for Enter then Save', async () => {
      const fixture = mount();
      const { host, input } = await openRename(fixture);
      const save = saveButton(host);
      keydown(input, 'Enter');
      save.click();
      expect(rename).toHaveBeenCalledTimes(1);
      expect(rename).toHaveBeenCalledWith(sessionId, 'Alpha', 'Renamed');
      await finish(fixture);
    });

    it('makes the field read-only and disables Save while pending', async () => {
      const fixture = mount();
      const { host, input } = await openRename(fixture);
      expect(input.readOnly).toBe(false);
      expect(saveButton(host).disabled).toBe(false);
      keydown(input, 'Enter');
      fixture.detectChanges();
      expect(input.readOnly).toBe(true);
      expect(saveButton(host).disabled).toBe(true);
      // Cancel stays available.
      expect(cancelButton(host).disabled).toBe(false);
      await finish(fixture);
    });

    it('closes the popover and focuses the trigger once the rename resolves', async () => {
      const fixture = mount();
      const { host, input } = await openRename(fixture);
      keydown(input, 'Enter');
      fixture.detectChanges();
      await settle();
      expect(host.querySelector('[role="dialog"]')).not.toBeNull();
      await finish(fixture);
      expect(host.querySelector('[role="dialog"]')).toBeNull();
      expect(document.activeElement).toBe(trigger(host));
    });

    it('does not move focus when the rename resolves after a Cancel', async () => {
      const fixture = mount();
      const { host, input } = await openRename(fixture);
      keydown(input, 'Enter');
      cancelButton(host).click();
      fixture.detectChanges();
      await settle();
      expect(host.querySelector('[role="dialog"]')).toBeNull();
      const elsewhere = document.createElement('button');
      document.body.appendChild(elsewhere);
      elsewhere.focus();

      await finish(fixture);

      expect(document.activeElement).toBe(elsewhere);
      elsewhere.remove();
    });

    it('keeps a reopened Rename focused when the previous request fails', async () => {
      const fixture = mount();
      const first = await openRename(fixture);
      keydown(first.input, 'Enter');
      cancelButton(first.host).click();
      fixture.detectChanges();
      await settle();
      const second = await openRename(fixture);
      resolveRename('failed');
      await settle();
      fixture.detectChanges();
      expect(second.host.querySelector('[role="dialog"]')).not.toBeNull();
      expect(document.activeElement).toBe(second.input);
      expect(fixture.componentInstance.renaming()).toBe(false);
      expect(fixture.componentInstance.renameError()).toBe('');
    });

    it('keeps a failed rename draft and announces its inline error', async () => {
      const fixture = mount();
      const { host, input } = await openRename(fixture);
      const live = host.querySelector<HTMLElement>('[aria-live="polite"]')!;
      keydown(input, 'Enter');
      resolveRename('failed');
      await Promise.resolve();
      fixture.detectChanges();
      expect(live.textContent).toBe('');
      await settle();
      fixture.detectChanges();
      expect(host.querySelector('[role="dialog"]')).not.toBeNull();
      expect(input.value).toBe('Renamed');
      expect(input.getAttribute('aria-describedby')).toBe('rail-rename-error-a');
      expect(host.querySelector('#rail-rename-error-a')?.textContent).toBe("Couldn't rename. Try again.");
      expect(live.textContent).toBe("Couldn't rename. Try again.");
      keydown(input, 'Enter');
      resolveRename('failed');
      await Promise.resolve();
      fixture.detectChanges();
      expect(live.textContent).toBe('');
      await settle();
      fixture.detectChanges();
      expect(live.textContent).toBe("Couldn't rename. Try again.");
      input.value = 'New draft';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      fixture.detectChanges();
      expect(fixture.componentInstance.renameError()).toBe('');
      expect(input.getAttribute('aria-describedby')).toBeNull();
    });

    it('returns focus to the input after Save fails in the current Rename dialog', async () => {
      const fixture = mount();
      const { host, input } = await openRename(fixture);
      const save = saveButton(host);
      save.focus();
      save.click();
      fixture.detectChanges();
      expect(save.disabled).toBe(true);
      input.blur();
      resolveRename('failed');
      await settle();
      fixture.detectChanges();
      expect(document.activeElement).toBe(input);
      expect(input.value).toBe('Renamed');
    });

    it('lets a second rename through after the first resolves', async () => {
      const fixture = mount();
      const { input } = await openRename(fixture);
      keydown(input, 'Enter');
      await finish(fixture);
      expect(rename).toHaveBeenCalledTimes(1);

      const again = await openRename(fixture);
      expect(again.input.readOnly).toBe(false);
      keydown(again.input, 'Enter');
      expect(rename).toHaveBeenCalledTimes(2);
      await finish(fixture);
    });
  });

  it('opens Organize for a loaded row and restores the menu trigger after editor close render (D30)', async () => {
    available.set(true);
    loaded = true;
    const fixture = mount();
    const host = await openMenu(fixture);
    expect(item(host, 'organize').getAttribute('aria-haspopup')).toBe('dialog');
    item(host, 'organize').click();
    fixture.detectChanges();
    expect(organizeOpen).toHaveBeenCalledWith(sessionId, expect.any(Function));
    expect(openForSession).not.toHaveBeenCalled();
    const editorClose = document.createElement('button');
    host.append(editorClose);
    editorClose.focus();
    TestBed.inject(SessionOrganizerService).close();
    editorClose.focus();
    fixture.detectChanges();
    await settle();
    expect(document.activeElement).toBe(trigger(host));
    editorClose.remove();
  });

  it('falls back to the select button when Organize closes after its trigger disconnects', async () => {
    available.set(true);
    loaded = true;
    const fixture = mount();
    const host = await openMenu(fixture);
    item(host, 'organize').click();
    fixture.detectChanges();
    trigger(host).remove();
    TestBed.inject(SessionOrganizerService).close();
    fixture.detectChanges();
    await settle();
    expect(document.activeElement).toBe(host.querySelector('.rc-select'));
  });

  it('loads an excluded persisted card and announces only a failed read', async () => {
    available.set(true);
    openForSession.mockResolvedValueOnce('failed');
    const fixture = mount();
    const host = await openMenu(fixture);
    const live = host.querySelector<HTMLElement>('[aria-live="polite"]')!;
    item(host, 'organize').click();
    await settle();
    await settle();
    fixture.detectChanges();
    expect(openForSession).toHaveBeenCalledWith(sessionId, 'Alpha', expect.any(Function));
    expect(live.textContent).toBe("Could not load this session's organization.");
    openForSession.mockResolvedValueOnce('failed');
    await openMenu(fixture);
    item(host, 'organize').click();
    fixture.detectChanges();
    expect(live.textContent).toBe('');
    await settle();
    await settle();
    fixture.detectChanges();
    expect(live.textContent).toBe("Could not load this session's organization.");
  });

  it.each(['cancelled', 'unavailable'])('does not announce or move focus for %s Organize result', async (result) => {
    available.set(true);
    openForSession.mockResolvedValueOnce(result);
    const fixture = mount();
    const host = await openMenu(fixture);
    item(host, 'organize').click();
    const focusedAfterClick = document.activeElement;
    await settle();
    fixture.detectChanges();
    expect(fixture.componentInstance.announcement()).toBe('');
    expect(document.activeElement).toBe(focusedAfterClick);
  });

  function keydown(
    target: Element,
    key: string,
    init: KeyboardEventInit = {},
  ): KeyboardEvent {
    const event = new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
      ...init,
    });
    target.dispatchEvent(event);
    return event;
  }

  it('emits the tab id from Open beside, Move up and Move down (payload forwarding, card side)', async () => {
    const fixture = mount();
    fixture.componentRef.setInput('canMoveUp', true);
    fixture.componentRef.setInput('canMoveDown', true);
    fixture.detectChanges();
    const card = fixture.componentInstance;
    const beside = jest.fn();
    const up = jest.fn();
    const down = jest.fn();
    card.openBesideRequested.subscribe(beside);
    card.moveUpRequested.subscribe(up);
    card.moveDownRequested.subscribe(down);
    for (const [action, spy] of [
      ['open-beside', beside],
      ['move-up', up],
      ['move-down', down],
    ] as const) {
      const host = await openMenu(fixture);
      expect(trigger(host).getAttribute('aria-expanded')).toBe('true');
      item(host, action).click();
      fixture.detectChanges();
      expect(spy).toHaveBeenCalledWith('a');
      expect(host.querySelector('[role="menu"]')).toBeNull();
      expect(document.activeElement).toBe(trigger(host));
    }
    expect([beside, up, down].map((spy) => spy.mock.calls.length)).toEqual([
      1, 1, 1,
    ]);
    expect(focusTile).not.toHaveBeenCalled();
  });

  it.each([SPLIT_NEEDS_TWO_SESSIONS_REASON, SPLIT_ALREADY_FOCUSED_REASON])(
    'shows the disabled reason "%s" and does not emit Open beside',
    async (reason) => {
      expect([
        'Open another session first to split',
        'This session is already in the focused pane',
      ]).toContain(reason);
      const fixture = mount();
      fixture.componentRef.setInput('splitDisabledReason', reason);
      fixture.detectChanges();
      const beside = jest.fn();
      fixture.componentInstance.openBesideRequested.subscribe(beside);
      const host = await openMenu(fixture);
      const openBeside = item(host, 'open-beside');
      expect(openBeside.getAttribute('role')).toBe('menuitem');
      expect(openBeside.getAttribute('aria-disabled')).toBe('true');
      const describedBy = openBeside.getAttribute('aria-describedby');
      expect(
        host.querySelector(`[id="${describedBy}"]`)?.textContent?.trim(),
      ).toBe(reason);
      expect(openBeside.textContent).toContain(reason);
      expect(openBeside.querySelector('span[aria-hidden="true"]')?.classList).toContain('truncate');
      expect(openBeside.querySelector('span[aria-hidden="true"]')?.getAttribute('title')).toBe(reason);
      openBeside.click();
      fixture.detectChanges();
      expect(beside).not.toHaveBeenCalled();
      expect(host.querySelector('[role="menu"]')).not.toBeNull();
    },
  );

  it('enables Open beside without a reason (a stale id is never a disabled reason)', async () => {
    const fixture = mount();
    const host = await openMenu(fixture);
    const openBeside = item(host, 'open-beside');
    expect(openBeside.getAttribute('aria-disabled')).toBeNull();
    expect(openBeside.getAttribute('aria-describedby')).toBeNull();
  });

  it('does not select the session from a trigger, menu or backdrop click', async () => {
    const fixture = mount();
    const host = fixture.nativeElement as HTMLElement;
    expect(trigger(host).closest('ptah-compact-session-card')).toBeNull();
    expect(trigger(host).closest('.rc-select, .rc-lane-overflow')).toBeNull();
    host
      .querySelector('[data-rail-actions]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await openMenu(fixture);
    host
      .querySelector('[role="menu"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    item(host, 'move-up').click();
    expect(focusTile).not.toHaveBeenCalled();
    host
      .querySelector('div.fixed.inset-0')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(focusTile).not.toHaveBeenCalled();
  });

  it('closes the menu on Escape and returns focus to the trigger', async () => {
    const fixture = mount();
    fixture.componentRef.setInput('canMoveDown', true);
    fixture.detectChanges();
    const host = await openMenu(fixture);
    expect(document.activeElement).toBe(item(host, 'open-beside'));
    keydown(item(host, 'open-beside'), 'ArrowDown');
    expect(document.activeElement).toBe(item(host, 'rename'));
    const escape = keydown(item(host, 'rename'), 'Escape');
    fixture.detectChanges();
    expect(escape.defaultPrevented).toBe(true);
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(trigger(host).getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger(host));
  });

  it('ignores a late opened after the menu closed (no focus pulled into the menu)', async () => {
    const fixture = mount();
    const host = await openMenu(fixture);
    // Closed in the card, not yet re-rendered: the items are still in the DOM.
    fixture.componentInstance.closeMenu();
    expect(document.activeElement).toBe(trigger(host));
    expect(item(host, 'open-beside')).not.toBeNull();
    fixture.debugElement
      .query(By.directive(NativePopoverComponent))
      .componentInstance.opened.emit();
    expect(document.activeElement).toBe(trigger(host));
  });

  it('puts the collapsed select first and the trigger second in Tab order, only on the roving card', () => {
    const fixture = mount();
    fixture.componentRef.setInput('collapsed', true);
    fixture.componentRef.setInput('focused', true);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const select = host.querySelector<HTMLButtonElement>(
      'button.rail-collapsed',
    ) as HTMLButtonElement;
    const tabbable = () =>
      [...host.querySelectorAll<HTMLButtonElement>('button')].filter(
        (button) =>
          !button.closest('[aria-hidden="true"]') && button.tabIndex === 0,
      );
    expect(tabbable()).toEqual([select, trigger(host)]);
    fixture.componentRef.setInput('focused', false);
    fixture.detectChanges();
    expect(tabbable()).toEqual([]);
    expect(select.tabIndex).toBe(-1);
    expect(trigger(host).tabIndex).toBe(-1);
  });

  it('forwards Alt+Shift+ArrowUp/Down from the select button and stops at the first and last card', () => {
    const fixture = mount();
    const host = fixture.nativeElement as HTMLElement;
    const card = fixture.componentInstance;
    const up = jest.fn();
    const down = jest.fn();
    card.moveUpRequested.subscribe(up);
    card.moveDownRequested.subscribe(down);
    const alt = { altKey: true, shiftKey: true };
    // The visible select button: the expanded .rc-select or the collapsed one.
    const select = () =>
      [
        ...host.querySelectorAll<HTMLElement>('.rc-select, .rail-collapsed'),
      ].find(
        (button) => !button.closest('[aria-hidden="true"]'),
      ) as HTMLElement;
    // A single card is both first and last: no move either way.
    expect(keydown(select(), 'ArrowUp', alt).defaultPrevented).toBe(false);
    expect(keydown(select(), 'ArrowDown', alt).defaultPrevented).toBe(false);
    expect(up).not.toHaveBeenCalled();
    expect(down).not.toHaveBeenCalled();
    fixture.componentRef.setInput('canMoveUp', true);
    fixture.componentRef.setInput('canMoveDown', true);
    fixture.detectChanges();
    expect(keydown(select(), 'ArrowUp', alt).defaultPrevented).toBe(true);
    expect(up).toHaveBeenCalledWith('a');
    fixture.componentRef.setInput('collapsed', true);
    fixture.componentRef.setInput('focused', true);
    fixture.detectChanges();
    expect(select().classList).toContain('rail-collapsed');
    expect(keydown(select(), 'ArrowDown', alt).defaultPrevented).toBe(true);
    expect(down).toHaveBeenCalledWith('a');
    // The trigger is not the select button; it never reorders.
    keydown(trigger(host), 'ArrowDown', alt);
    expect(down).toHaveBeenCalledTimes(1);
    expect(up).toHaveBeenCalledTimes(1);
  });

  it('leaves plain arrows alone (no move, not prevented)', () => {
    const fixture = mount();
    fixture.componentRef.setInput('canMoveUp', true);
    fixture.componentRef.setInput('canMoveDown', true);
    fixture.detectChanges();
    const up = jest.fn();
    const down = jest.fn();
    fixture.componentInstance.moveUpRequested.subscribe(up);
    fixture.componentInstance.moveDownRequested.subscribe(down);
    const select = (fixture.nativeElement as HTMLElement).querySelector(
      '.rc-select',
    ) as HTMLElement;
    expect(keydown(select, 'ArrowUp').defaultPrevented).toBe(false);
    expect(
      keydown(select, 'ArrowDown', { shiftKey: true }).defaultPrevented,
    ).toBe(false);
    expect(
      keydown(select, 'ArrowDown', { altKey: true }).defaultPrevented,
    ).toBe(false);
    expect(up).not.toHaveBeenCalled();
    expect(down).not.toHaveBeenCalled();
  });

  it('keeps 176/96/56 px heights with a full-width card, the trigger in its corner and +N more still fitting (N6b)', () => {
    expect(COMPACT_RAIL_CARD_HEIGHT).toEqual({ comfortable: 176, dense: 96 });
    // The real chat-ui compact card, not CardStub: its own overflow control.
    TestBed.overrideComponent(CanvasRailCardComponent, {
      remove: { imports: [CardStub] },
      add: { imports: [RealRailCardHost] },
    });
    const fixture = mount();
    fixture.componentRef.setInput('focused', true);
    const host = fixture.nativeElement as HTMLElement;
    // Comfortable renders "+N more" for the lanes beyond the three rows;
    // dense has no rows and renders "+N" for all lanes.
    const expected = { comfortable: '+2 more', dense: '+5' } as const;
    for (const density of ['comfortable', 'dense'] as const) {
      fixture.componentRef.setInput('density', density);
      fixture.detectChanges();
      expect(host.style.height).toBe(`${COMPACT_RAIL_CARD_HEIGHT[density]}px`);
      const card = host.querySelector(
        'ptah-compact-session-card',
      ) as HTMLElement;
      const railCard = card.querySelector('ptah-compact-rail-card');
      expect(railCard?.classList.contains('rc-dense')).toBe(
        density === 'dense',
      );
      // The focused card carries the focused frame (decision row 111).
      expect(railCard?.classList.contains('rc-focused')).toBe(true);
      const corner = host.querySelector('[data-rail-actions]') as HTMLElement;
      // No gutter: the card is the only in-flow child and takes the full li.
      expect(host.classList.contains('flex')).toBe(true);
      expect(host.classList.contains('relative')).toBe(true);
      expect([...card.classList]).toEqual(
        expect.arrayContaining(['flex-1', 'min-w-0']),
      );
      expect(
        [...host.children].filter(
          (child) =>
            !child.classList.contains('absolute') &&
            !child.classList.contains('sr-only'),
        ),
      ).toEqual([card]);
      // The trigger sits in the card frame's top-right corner, 6 px inside it,
      // above the card's content layer, with no width taken from the row.
      expect([...corner.classList]).toEqual(
        expect.arrayContaining(['absolute', 'right-1.5', 'top-1.5', 'z-10']),
      );
      for (const gutterClass of ['w-7', 'w-6', 'shrink-0', 'pt-1']) {
        expect(corner.classList).not.toContain(gutterClass);
      }
      expect(corner.parentElement).toBe(host);
      expect(corner.contains(trigger(host))).toBe(true);
      expect([...trigger(host).classList]).toEqual(
        expect.arrayContaining(['h-6', 'w-6']),
      );
      // Never nested in the select button or any other interactive element,
      // and outside the card's overflow-hidden box, so its ring is not clipped.
      expect(card.contains(trigger(host))).toBe(false);
      expect(
        trigger(host).parentElement?.closest('button, a, [role="button"]'),
      ).toBeNull();
      // The title line under the corner reserves the trigger's width.
      expect(railCard?.classList.contains('rc-corner-reserved')).toBe(true);
      const title = railCard?.querySelector('.rc-body > .rc-title');
      expect(title?.querySelector('.rc-pill')).not.toBeNull();
      // The real overflow control: the lanes button of this density.
      const overflow = [
        ...card.querySelectorAll<HTMLButtonElement>('.rc-lanes button'),
      ].find((button) => button.textContent?.trim().startsWith('+'));
      expect(overflow?.textContent?.trim()).toBe(expected[density]);
      expect(overflow?.classList).toContain('rc-action');
      expect(overflow?.classList.contains('rc-lane-overflow')).toBe(
        density === 'comfortable',
      );
      expect(overflow?.tabIndex).toBe(0);
      expect(corner.contains(overflow as HTMLElement)).toBe(false);
      // It closes its lane line, below the title line, so the corner trigger
      // never sits over it.
      expect(overflow?.parentElement?.classList).toContain('rc-line');
      expect(overflow?.parentElement?.lastElementChild).toBe(overflow);
      expect(title?.contains(overflow as HTMLElement)).toBe(false);
    }
    // jsdom has no layout, so the pixel fit at the narrowest (sm, 272 px)
    // rail is not measured here; it stays with the Electron visual re-check
    // (decisions row 102). Budget: aside border 1, scrollbar gutter 8, list
    // padding 16, card padding 14 + 10 and border 2 leave a 221 px lane line
    // for "Lanes" (about 30 px) and the overflow button (min 39 px; "+99
    // more" about 50 px); the corner trigger costs only the title line 22 px.
    fixture.componentRef.setInput('focused', false);
    fixture.detectChanges();
    expect(
      host
        .querySelector('ptah-compact-rail-card')
        ?.classList.contains('rc-focused'),
    ).toBe(false);
    fixture.componentRef.setInput('collapsed', true);
    fixture.detectChanges();
    expect(host.style.height).toBe('56px');
    const select = host.querySelector('button.rail-collapsed') as HTMLElement;
    const cell = host.querySelector('[data-rail-actions]') as HTMLElement;
    expect([...select.classList]).toEqual(
      expect.arrayContaining(['w-8', 'shrink-0', 'h-14']),
    );
    expect([...cell.classList]).toEqual(
      expect.arrayContaining(['w-6', 'shrink-0']),
    );
    for (const overlay of ['absolute', 'z-10', 'w-7']) {
      expect(cell.classList).not.toContain(overlay);
    }
    expect(select.nextElementSibling).toBe(cell);
    expect(trigger(host).classList).toContain('h-14');
  });
});
