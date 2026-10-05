import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
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

function createView() {
  const fixture = TestBed.createComponent(StatsViewHostComponent);
  const state = fixture.debugElement.injector.get(StatsTileExpansionState);
  return { fixture, state };
}

describe('StatsTileExpansionState', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [StatsViewHostComponent] });
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
