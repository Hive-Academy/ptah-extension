import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { EmptyState } from './empty-state';

/**
 * EmptyState's contrast regression guard.
 *
 * 🔴 THIS SPEC EXISTS BECAUSE BATCH 13's AXE PASS FOUND A REAL WCAG AA FAILURE
 * HERE, AND NOTHING IN THE TREE COULD SEE IT. The hint paragraph shipped as
 * `text-xs text-base-content/40`, which axe measured on `/members/live/request`
 * at **3.2:1** (`#656b79` on `#151c27`, 12px, normal weight) against the 4.5:1
 * body-text floor.
 *
 * ⚠️ IT WAS INVISIBLE FOR THREE REASONS AT ONCE, WHICH IS WHY THE GUARD IS HERE
 * RATHER THAN IN A CONSUMER:
 *   1. The Task 4.7 token lint rule is scoped to `libs/web/members/**`. This
 *      file is in `libs/web/panel-ui/**` and no lint rule reads it.
 *   2. Batch 10's six `not.toContain('text-base-content/40')` assertions all run
 *      against a CONSUMER's rendered HTML, and every one of those surfaces was
 *      populated in its fixture — so the empty state never rendered and the
 *      assertion passed vacuously.
 *   3. `panel-ui` had no spec for this component at all.
 *
 * `panel-theme-spec.md` §2 rules `base-content/40` legal ONLY for glanceable
 * metadata. The DECORATIVE ICON keeps it — it is `aria-hidden` and carries no
 * information the message does not. A hint is a sentence a member is meant to
 * read, so it takes `/60`, which §2 measures as passing.
 */
@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EmptyState],
  template: `<ptah-empty-state [message]="message" [hint]="hint" />`,
})
class HostComponent {
  public message = 'Nothing here yet.';
  public hint: string | null = null;
}

function render(setup: (host: HostComponent) => void = () => undefined) {
  const fixture = TestBed.createComponent(HostComponent);
  setup(fixture.componentInstance);
  fixture.detectChanges();
  return fixture;
}

describe('EmptyState', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [HostComponent] });
  });

  it('renders the message', () => {
    const fixture = render((host) => {
      host.message = 'No requests yet.';
    });

    expect(fixture.nativeElement.textContent).toContain('No requests yet.');
  });

  it('omits the hint paragraph entirely when no hint is supplied', () => {
    // The `@if` matters: an empty <p> would still occupy the gap and would give
    // axe an element to measure with no text in it.
    expect(render().nativeElement.querySelectorAll('p').length).toBe(1);
  });

  it('renders the hint when supplied', () => {
    const fixture = render((host) => {
      host.hint = 'Live sessions are announced in the community.';
    });

    expect(fixture.nativeElement.textContent).toContain(
      'Live sessions are announced in the community.',
    );
  });

  it('🔴 renders the hint at /60, never /40 — it is body text and WCAG AA applies', () => {
    const fixture = render((host) => {
      host.hint = 'A sentence a member is meant to read.';
    });

    const paragraphs = Array.from<HTMLElement>(
      fixture.nativeElement.querySelectorAll('p'),
    );
    const hint = paragraphs[paragraphs.length - 1];

    expect(hint.className).toContain('text-base-content/60');
    expect(hint.className).not.toContain('text-base-content/40');
  });

  it('🔴 keeps /40 off every TEXT node, while the decorative icon may keep it', () => {
    // Scoped to <p> deliberately. The icon is `aria-hidden` and is a graphic,
    // not text — axe does not measure it and §2 does not forbid it there.
    const fixture = render((host) => {
      host.hint = 'A sentence a member is meant to read.';
    });

    const textClasses = Array.from<HTMLElement>(
      fixture.nativeElement.querySelectorAll('p'),
    )
      .map((p) => p.className)
      .join(' ');

    expect(textClasses).not.toContain('text-base-content/40');
  });
});
