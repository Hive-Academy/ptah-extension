import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  StatsTileExpansionState,
  statsTileKey,
} from './stats-tile-expansion.state';

/** Stands in for a chat view: one expansion instance per view. */
@Component({
  selector: 'ptah-test-stats-view',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [StatsTileExpansionState],
})
class StatsViewHostComponent {}

@Component({
  selector: 'ptah-test-rendered-stats',
  template: `<button [attr.aria-expanded]="expansion.isOpen(expansion.sessionKey(this, sessionId()), 'tile')"
    (click)="toggle()">Tile</button>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [StatsTileExpansionState],
})
class RenderedStatsHostComponent {
  readonly sessionId = signal<string | null>(null);
  readonly expansion = inject(StatsTileExpansionState);

  toggle(): void {
    this.expansion.toggle(this.expansion.sessionKey(this, this.sessionId()), 'tile');
  }
}

function createView() {
  const fixture = TestBed.createComponent(StatsViewHostComponent);
  const state = fixture.debugElement.injector.get(StatsTileExpansionState);
  return { fixture, state };
}

describe('StatsTileExpansionState', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [StatsViewHostComponent, RenderedStatsHostComponent] });
  });

  it('keys by session id plus tile id', () => {
    expect(statsTileKey('s1', 'plan:claude#account:a:five_hour')).toBe(
      's1::plan:claude#account:a:five_hour',
    );
  });

  it('is not provided in root', () => {
    expect(() => TestBed.inject(StatsTileExpansionState)).toThrow(
      /No provider/,
    );
  });

  it('starts every tile closed and toggles one tile at a time', () => {
    const { state } = createView();
    expect(state.isOpen('s1', 'lane:codex:review')).toBe(false);
    state.toggle('s1', 'lane:codex:review');
    expect(state.isOpen('s1', 'lane:codex:review')).toBe(true);
    expect(state.isOpen('s1', 'lanes-subtotal')).toBe(false);
    state.toggle('s1', 'lane:codex:review');
    expect(state.isOpen('s1', 'lane:codex:review')).toBe(false);
  });

  it('keeps sessions apart within one view, and keeps earlier sessions', () => {
    const { state } = createView();
    state.setOpen('s1', 'plan:o:five_hour', true);
    expect(state.isOpen('s2', 'plan:o:five_hour')).toBe(false);
    state.setOpen('s2', 'plan:o:five_hour', true);
    state.setOpen('s2', 'plan:o:five_hour', false);
    expect(state.isOpen('s1', 'plan:o:five_hour')).toBe(true);
  });

  it('migrates an open tile when a null-ID host receives its session ID', () => {
    const { state } = createView();
    const host = {};
    const pendingKey = state.sessionKey(host, null);
    state.setOpen(pendingKey, 'plan:o:weekly', true);

    expect(state.sessionKey(host, 'session-a')).toBe('session-a');
    expect(state.isOpen('session-a', 'plan:o:weekly')).toBe(true);
    state.setOpen('session-a', 'plan:o:weekly', true);
    expect(state.isOpen(pendingKey, 'plan:o:weekly')).toBe(false);
  });

  it('renders an open pending tile after an ID arrives without writing during change detection', () => {
    const fixture = TestBed.createComponent(RenderedStatsHostComponent);
    const button = (): HTMLButtonElement => fixture.nativeElement.querySelector('button');
    fixture.detectChanges();
    button().click();
    fixture.detectChanges();
    expect(button().getAttribute('aria-expanded')).toBe('true');

    fixture.componentInstance.sessionId.set('session-a');
    expect(() => fixture.detectChanges()).not.toThrow();
    expect(button().getAttribute('aria-expanded')).toBe('true');

    fixture.componentInstance.sessionId.set('session-b');
    expect(() => fixture.detectChanges()).not.toThrow();
    expect(button().getAttribute('aria-expanded')).toBe('false');

    fixture.componentInstance.sessionId.set('session-a');
    fixture.detectChanges();
    button().click();
    fixture.detectChanges();
    expect(button().getAttribute('aria-expanded')).toBe('false');
  });

  it('does not carry open tiles from one real session to another', () => {
    const { state } = createView();
    const host = {};
    state.setOpen(state.sessionKey(host, 'session-a'), 'lane:codex:review', true);

    expect(state.sessionKey(host, 'session-b')).toBe('session-b');
    expect(state.isOpen('session-b', 'lane:codex:review')).toBe(false);
    expect(state.isOpen('session-a', 'lane:codex:review')).toBe(true);
  });

  it('does not share pending tiles between two null-ID hosts in one view', () => {
    const { state } = createView();
    const firstKey = state.sessionKey({}, null);
    const secondHost = {};
    const secondKey = state.sessionKey(secondHost, null);
    state.setOpen(firstKey, 'plan:o:weekly', true);

    expect(secondKey).not.toBe(firstKey);
    expect(state.isOpen(secondKey, 'plan:o:weekly')).toBe(false);
    expect(state.sessionKey(secondHost, 'session-b')).toBe('session-b');
    expect(state.isOpen('session-b', 'plan:o:weekly')).toBe(false);
  });

  it('is reactive in a computed', () => {
    const { state } = createView();
    const open = computed(() => state.isOpen('s1', 'lanes-subtotal'));
    expect(open()).toBe(false);
    state.setOpen('s1', 'lanes-subtotal', true);
    expect(open()).toBe(true);
  });

  it('F57: an opened lane tile and plan tile stay open across pushes and re-renders', () => {
    const { fixture, state } = createView();
    state.setOpen('s1', 'lane:codex:review', true);
    state.setOpen('s1', 'plan:o:weekly', true);
    // A push or usage delta rebuilds the view model with the same stable ids;
    // nothing in that path touches the state, and re-rendering does not either.
    fixture.detectChanges();
    fixture.detectChanges();
    state.setOpen('s1', 'plan:o:weekly', true);
    expect(state.isOpen('s1', 'lane:codex:review')).toBe(true);
    expect(state.isOpen('s1', 'plan:o:weekly')).toBe(true);
  });

  it('F73: 200+ entries in another view leave this view untouched; destroying a view releases its state', () => {
    const view1 = createView();
    const view2 = createView();
    expect(view1.state).not.toBe(view2.state);

    view1.state.setOpen('s1', 'lane:codex:review', true);
    for (let index = 0; index < 250; index += 1) {
      view2.state.setOpen(`s${index}`, `plan:o:w${index}`, true);
    }
    expect(view1.state.isOpen('s1', 'lane:codex:review')).toBe(true);
    expect(view1.state.isOpen('s0', 'plan:o:w0')).toBe(false);
    // No cap and no eviction: the first of 250 entries is still there.
    expect(view2.state.isOpen('s0', 'plan:o:w0')).toBe(true);
    expect(view2.state.isOpen('s249', 'plan:o:w249')).toBe(true);

    view1.fixture.destroy();
    const view3 = createView();
    expect(view3.state).not.toBe(view1.state);
    expect(view3.state.isOpen('s1', 'lane:codex:review')).toBe(false);
  });
});
