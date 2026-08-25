import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import {
  REACTION_TYPES,
  type ReactionCounts,
  type ReactionType,
} from '@ptah-contracts/community';

import { ReactionBar } from './reaction-bar';

const ZERO: ReactionCounts = {
  like: 0,
  insightful: 0,
  celebrate: 0,
  thanks: 0,
};

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactionBar],
  template: `<ptah-reaction-bar
    [counts]="counts()"
    [mine]="mine()"
    [disabled]="disabled()"
    (toggled)="emitted.push($event)"
  />`,
})
class HostComponent {
  public readonly counts = signal<ReactionCounts>(ZERO);
  public readonly mine = signal<readonly ReactionType[]>([]);
  public readonly disabled = signal(false);
  public readonly emitted: ReactionType[] = [];
}

function render() {
  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  return fixture;
}

function buttons(fixture: ReturnType<typeof render>): HTMLButtonElement[] {
  return Array.from(fixture.nativeElement.querySelectorAll('button'));
}

describe('ReactionBar', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [HostComponent] });
  });

  it('renders exactly the four types in REACTION_TYPES, in order (R1.4.3)', () => {
    // Iterated from the contract tuple, not written out — so a fifth wire value
    // cannot appear on the server without this bar growing a button too.
    const labels = buttons(render()).map((b) => b.textContent?.trim());

    expect(labels).toHaveLength(REACTION_TYPES.length);
    expect(labels[0]).toContain('Like');
    expect(labels[1]).toContain('Insightful');
    expect(labels[2]).toContain('Celebrate');
    expect(labels[3]).toContain('Thanks');
  });

  it('EMITS ONCE PER CLICK, with the type pressed', () => {
    // The bar holds no state: the page owns optimism and reconciles from the
    // PUT response. A bar that also kept an optimistic copy would give one post
    // two sources of truth.
    const fixture = render();
    buttons(fixture)[1].click();

    expect(fixture.componentInstance.emitted).toEqual(['insightful']);
  });

  it("emits again on a second click — toggling off is the caller's decision", () => {
    const fixture = render();
    buttons(fixture)[0].click();
    buttons(fixture)[0].click();

    expect(fixture.componentInstance.emitted).toEqual(['like', 'like']);
  });

  it('hides a zero count but shows a non-zero one', () => {
    const fixture = render();
    expect(buttons(fixture)[0].textContent).not.toMatch(/\d/);

    fixture.componentInstance.counts.set({ ...ZERO, like: 3 });
    fixture.detectChanges();

    expect(buttons(fixture)[0].textContent).toContain('3');
  });

  it('marks the types the member applied with aria-pressed (R1.4.2)', () => {
    const fixture = render();
    fixture.componentInstance.mine.set(['celebrate']);
    fixture.detectChanges();

    const pressed = buttons(fixture).map((b) => b.getAttribute('aria-pressed'));
    expect(pressed).toEqual(['false', 'false', 'true', 'false']);
  });

  it('gives each button an action-describing accessible label', () => {
    // "Insightful 2" tells a screen-reader user nothing about what pressing it
    // does, and nothing about whether they already reacted.
    const fixture = render();
    fixture.componentInstance.counts.set({ ...ZERO, insightful: 2 });
    fixture.componentInstance.mine.set(['insightful']);
    fixture.detectChanges();

    expect(buttons(fixture)[1].getAttribute('aria-label')).toBe(
      'Remove your Insightful reaction (2)',
    );
    expect(buttons(fixture)[0].getAttribute('aria-label')).toBe(
      'Add a Like reaction',
    );
  });

  it('disables every button while a toggle is in flight or the topic is locked', () => {
    const fixture = render();
    fixture.componentInstance.disabled.set(true);
    fixture.detectChanges();

    expect(buttons(fixture).every((b) => b.disabled)).toBe(true);

    buttons(fixture)[0].click();
    expect(fixture.componentInstance.emitted).toEqual([]);
  });
});
