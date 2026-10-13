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

const tabState = signal<CompactRailState>('idle');

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
