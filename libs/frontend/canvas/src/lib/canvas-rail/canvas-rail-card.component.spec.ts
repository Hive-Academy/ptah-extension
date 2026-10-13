import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  CompactSessionCardComponent,
  SESSION_CARD_ACTIONS,
  TabManagerService,
} from '@ptah-extension/chat';
import {
  COMPACT_RAIL_CARD_HEIGHT,
  type CompactRailDensity,
  type CompactRailState,
} from '@ptah-extension/chat-ui';
import { CanvasStore } from '../canvas.store';
import { CanvasDetailService } from '../canvas-detail/canvas-detail.service';
import { CanvasRailCardComponent } from './canvas-rail-card.component';
import { focusRailSelectButton } from './canvas-rail-keyboard';

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
    <button type="button" (click)="lanesRequested.emit()">+1</button>`,
})
class CardStub {
  readonly actions = inject(SESSION_CARD_ACTIONS, { optional: true });
  readonly tab = input.required<unknown>();
  readonly variant = input('rail');
  readonly density = input<CompactRailDensity>('comfortable');
  readonly focused = input(false);
  readonly holdText = input(false);
  readonly expandToFull = output<void>();
  readonly railState = output<CompactRailState>();
  readonly staleAction = output<void>();
  readonly lanesRequested = output<void>();
  constructor() {
    effect(() => this.railState.emit(tabState()));
  }
}

describe('CanvasRailCardComponent', () => {
  const focusTile = jest.fn();
  const open = jest.fn();
  beforeEach(() => {
    jest.clearAllMocks();
    tabState.set('idle');
    TestBed.configureTestingModule({
      imports: [CanvasRailCardComponent],
      providers: [
        {
          provide: TabManagerService,
          useValue: {
            findTabByIdAcrossWorkspaces: () => ({
              tab: { id: 'a', title: 'Alpha' },
            }),
          },
        },
        { provide: CanvasStore, useValue: { focusTile } },
        { provide: CanvasDetailService, useValue: { open } },
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

  it('forwards a stale action and announces it; Enter focuses the session', () => {
    const fixture = mount();
    const stale = jest.fn();
    fixture.componentInstance.staleAction.subscribe(stale);
    (
      fixture.debugElement.children[0].componentInstance as CardStub
    ).staleAction.emit();
    fixture.detectChanges();
    expect(stale).toHaveBeenCalledWith('a');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'This request has changed',
    );
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
});
