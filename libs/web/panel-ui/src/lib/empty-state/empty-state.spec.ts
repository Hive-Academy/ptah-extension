import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { EmptyState } from './empty-state';

/**
 * The `/40` opacity B13's axe pass measured at 3.2:1 on real text.
 *
 * ⚠️ ASSEMBLED RATHER THAN WRITTEN AS A LITERAL, matching the member specs. It
 * keeps this file readable to any token sweep that greps for the raw class,
 * including one added to `panel-ui` later — a spec proving a class's ABSENCE
 * must not itself register as an occurrence of it.
 */
const LOW_CONTRAST_TEXT = ['text', 'base-content/40'].join('-');

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
 * information the message does not.
 *
 * ⚠️ THE HINT NO LONGER TAKES `/60` EITHER. B13 closed F-1 by moving it from
 * `/40` to `/60`; `/60` then measured **4.42:1 on `operator-member-light`** in
 * the first light-theme axe pass this repository ever ran — a fix that was
 * correct in the theme it was measured in and insufficient in the other one.
 * Text now takes `text-base-content-muted`, whose value is chosen per theme by
 * `--bcm` in `apps/ptah-landing-page/tailwind.config.js` and re-measured by
 * `apps/ptah-landing-page/src/app/base-content-muted.spec.ts`.
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

  it('🔴 renders the hint on the muted TOKEN, never an alpha — it is body text and WCAG AA applies', () => {
    const fixture = render((host) => {
      host.hint = 'A sentence a member is meant to read.';
    });

    const paragraphs = Array.from<HTMLElement>(
      fixture.nativeElement.querySelectorAll('p'),
    );
    const hint = paragraphs[paragraphs.length - 1];

    expect(hint.className).toContain('text-base-content-muted');
    // Any alpha, not just `/40`. `/60` was the previous answer here and it is
    // the one that measures 4.42:1 on `operator-member-light`.
    expect(hint.className).not.toMatch(/text-base-content\/\d+/);
  });

  it('🔴 keeps /40 off every TEXT-BEARING ELEMENT, while the decorative icon may keep it', () => {
    // 🔴 SCOPED TO TEXT-BEARING ELEMENTS, NOT TO `<p>` AND NOT TO THE FILE.
    //
    // ⚠️ THE PREVIOUS VERSION OF THIS ASSERTION LOOKED ONLY AT `<p>`, WHICH IS
    // THE SAME SHAPE OF GAP AS F-1 ITSELF. It happened to cover both text nodes
    // this component renders TODAY; it would not have covered a `<span>`, a
    // `<h3>`, or a `<dd>` added later, and the one place text is added is
    // exactly here. The rule §2 states is about TEXT, so the sweep is about
    // text.
    //
    // ⚠️ A BLANKET FILE-WIDE `not.toContain('/40')` WOULD BE WRONG AND WOULD
    // FAIL ON CORRECT CODE — the `aria-hidden` glyph at the top of this
    // template legitimately carries `/40`. It conveys nothing the message does
    // not, so no contrast ratio applies to it. That is the distinction B13 drew
    // in prose and did not enforce, and this is the enforcement.
    const fixture = render((host) => {
      host.hint = 'A sentence a member is meant to read.';
    });

    const offenders = textBearing(fixture.nativeElement as HTMLElement)
      .filter((element) => element.className.includes(LOW_CONTRAST_TEXT))
      .map((element) => `${element.tagName}: ${element.textContent?.trim()}`);

    expect(offenders).toEqual([]);
  });

  it('🔴 the decorative icon KEEPS /40, and is excluded because it is aria-hidden', () => {
    // Anti-vacuity in the other direction: the sweep above must be excluding
    // something real. If the icon ever loses `aria-hidden` it becomes content,
    // and the assertion above SHOULD start failing on it.
    const fixture = render();
    const icon = (fixture.nativeElement as HTMLElement).querySelector(
      'lucide-angular',
    );

    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    expect(icon?.className).toContain(LOW_CONTRAST_TEXT);
  });

  it('🔴 the text-bearing walk finds the message AND the hint — not an empty set', () => {
    // The `toEqual([])` above passes over an empty set. B10's NFR-S3 assertion
    // was true-because-empty until it was made to fail; this is the guard
    // against the same shape here.
    const fixture = render((host) => {
      host.message = 'No packs are available to you yet.';
      host.hint = 'A sentence a member is meant to read.';
    });

    const found = textBearing(fixture.nativeElement as HTMLElement).map(
      (element) => element.textContent?.trim(),
    );

    expect(found).toContain('No packs are available to you yet.');
    expect(found).toContain('A sentence a member is meant to read.');
  });

  it('🔴 an element carrying /40 on real text WOULD be caught', () => {
    // 🔴 THE WALK, PROVEN ABLE TO FAIL. Every assertion above is a negative,
    // and a negative over a walk nobody has seen produce a hit is worth very
    // little. This builds the exact defect F-1 was — muted text at `/40` — out
    // of a detached node and confirms the sweep reports it.
    const host = document.createElement('div');
    const bad = document.createElement('p');
    bad.className = `text-xs ${LOW_CONTRAST_TEXT}`;
    bad.textContent = 'A hint at 3.2:1.';
    host.appendChild(bad);

    expect(textBearing(host).map((element) => element.className)).toContain(
      `text-xs ${LOW_CONTRAST_TEXT}`,
    );
  });
});

/**
 * Every element owning a non-whitespace DIRECT text child, excluding
 * `aria-hidden` subtrees and `<svg>` internals.
 *
 * ⚠️ 🔴 "DIRECT" IS WHAT MAKES IT MEAN ANYTHING. Every ancestor of a text node
 * carries that text in its `textContent`, so a walk keyed on `textContent`
 * marks the entire tree text-bearing — and the contrast assertion collapses
 * into the file-wide rule that fails on the legal decorative icon. Keyed on
 * direct children it selects the element that actually paints the glyphs, which
 * is the one whose colour class WCAG measures.
 */
function textBearing(root: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];

  const walk = (element: Element): void => {
    if (element.getAttribute('aria-hidden') === 'true') return;
    if (element.tagName.toLowerCase() === 'svg') return;

    const ownsText = Array.from(element.childNodes).some(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
    );
    if (ownsText && element instanceof HTMLElement) out.push(element);

    for (const child of Array.from(element.children)) walk(child);
  };

  walk(root);
  return out;
}
