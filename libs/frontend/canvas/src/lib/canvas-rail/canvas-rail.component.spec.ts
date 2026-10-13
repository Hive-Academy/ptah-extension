import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { CompactRailDensity, CompactRailState } from '@ptah-extension/chat-ui';
import type { CanvasTile } from '../canvas.store';
import { DEFAULT_TILE_WIDTH } from '../canvas-layout-intent';
import { RUNNING_CAP_MESSAGE } from '../canvas-running-cap';
import { CanvasRailCardComponent } from './canvas-rail-card.component';
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
  readonly focusRequested = output<string>(); readonly railState = output<CompactRailState>();
  readonly staleAction = output<string>(); readonly lanesRequested = output<string>();
}

const tile = (tabId: string, order: number): CanvasTile => ({ tabId, order, width: DEFAULT_TILE_WIDTH, rowBreakBefore: false });

describe('CanvasRailComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [CanvasRailComponent] });
    TestBed.overrideComponent(CanvasRailComponent, { remove: { imports: [CanvasRailCardComponent] }, add: { imports: [CardStub] } });
  });
  function mount(tiles: readonly CanvasTile[] = []) {
    const fixture = TestBed.createComponent(CanvasRailComponent);
    fixture.componentRef.setInput('tiles', tiles); fixture.detectChanges(); return fixture;
  }
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
});
