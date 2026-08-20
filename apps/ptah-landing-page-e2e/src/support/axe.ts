import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/**
 * The ONE axe helper for this suite (Task 15.10, F-I, NFR-U3/U4/U5).
 *
 * ── 🔴 IT COMES FROM THE DEV DEPENDENCY NOW, NOT FROM A CDN ────────────────
 * B10 and B13 each wrote their own loader that `addScriptTag`'d axe 4.10.2 from
 * a public package CDN, and each recorded the same reason: `@axe-core/playwright`
 * was not installed and installing it would rewrite `package.json` while other
 * processes wrote to this repository. **That has been false since it was added
 * at `package.json`'s `^4.12.1`**, and both copies still asserted it in comments
 * — the carried-forward item was closed by installation and left open by usage.
 * Both copies are deleted; this is what replaced them, and no spec in this suite
 * fetches axe over the network any more.
 *
 * Three things the dependency buys that the CDN version could not:
 *   • **The a11y gate no longer depends on network reachability.** A CI runner
 *     without egress to that CDN failed the `loaded` assertion, which reads as
 *     an a11y failure and is not one.
 *   • **The version is pinned by the lockfile**, so a new axe release cannot
 *     turn a green suite red overnight without a diff anyone can see.
 *   • **`AxeBuilder` walks IFRAMES properly** via `runPartialRecursive`, which
 *     the hand-rolled `page.evaluate` could not do at all.
 *
 * ── 🔴 THE VIOLATION SHAPE IS THE LIVE SPEC'S, DELIBERATELY ────────────────
 * The two deleted copies disagreed: `members-courses.spec.ts` reported
 * `nodes: number` and `members-live.spec.ts` reported `targets: string[]` plus
 * `summary`. The live one is kept because it is the one that made B13's F-1
 * DIAGNOSABLE — a failure saying "three things are wrong somewhere on the page"
 * costs a re-run with an ad-hoc probe before anyone can act on it, and two of
 * B13's three real findings were located from `targets`.
 */
export interface AxeViolation {
  id: string;
  impact: string | null;
  /** The failing selectors — the field that makes a failure actionable. */
  targets: string[];
  /** axe's own explanation of the first failing node. */
  summary: string;
}

/**
 * B10's scope, KEPT VERBATIM, AND KEEPING IT IS A RECORDED DECISION RATHER THAN
 * AN ACCIDENT.
 *
 * `include: body` — the page's own DOM.
 * `exclude: iframe` — in the activated replay/lesson states the page embeds
 * YouTube's player, whose internals are not this repository's to fix. An
 * unscoped run would report them on every run forever, and an a11y gate that
 * always fails is one people learn to ignore.
 */
const INCLUDE = 'body';
const EXCLUDE = 'iframe';

/** Runs axe over the page's own DOM and returns the violations, flattened. */
export async function runAxe(page: Page): Promise<AxeViolation[]> {
  const results = await new AxeBuilder({ page })
    .include(INCLUDE)
    .exclude(EXCLUDE)
    .analyze();

  return results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact ?? null,
    targets: violation.nodes.flatMap((node) =>
      node.target.map((target) => String(target)),
    ),
    summary: violation.nodes[0]?.failureSummary ?? '',
  }));
}

/**
 * Asserts a surface is clean, naming the URL and the violations on failure.
 *
 * ⚠️ THE MESSAGE CARRIES THE WHOLE VIOLATION LIST. `toEqual([])` alone prints a
 * diff of objects with no indication of WHICH surface produced them, and these
 * helpers are called in loops over several URLs.
 */
export async function expectNoAxeViolations(
  page: Page,
  label: string,
): Promise<void> {
  const violations = await runAxe(page);
  expect(
    violations,
    `${label}: ${JSON.stringify(violations, null, 2)}`,
  ).toEqual([]);
}

/**
 * 🔴 THE ONE KNOWN, REPORTED, UNFIXED A11Y DEFECT IN THIS REPOSITORY.
 *
 * ── WHAT IT IS ────────────────────────────────────────────────────────────
 * `text-base-content/60` fails WCAG AA in the **LIGHT member theme**, measured
 * by axe at **4.42:1 against the required 4.5:1** — `#747477` on `#faf9f7`,
 * 14px, normal weight. The arithmetic confirms the source exactly:
 * `operator-member-light` sets `base-content: #1a1c22` on `base-100: #faf9f7`
 * (`apps/ptah-landing-page/tailwind.config.js`), and compositing that at 60%
 * gives `#747477`. It is a NEAR MISS, which is why nobody has ever seen it.
 *
 * ── 🔴 WHY IT SURVIVED FOUR PHASES ────────────────────────────────────────
 * **Every axe pass before this batch ran in the DARK theme only.** B10's and
 * B13's helpers never set `ptah.members.theme`, so every measurement was taken
 * against `operator-member`, where `/60` passes comfortably. Exit-gate clause 3
 * asks for "both themes", and this is the first run that actually did it.
 *
 * It is the same defect class as B13's F-1 and it lands on F-1's own element:
 * `EmptyState`'s hint (`.max-w-sm`) is in the failing set. B13 fixed F-1 by
 * moving `/40` to `/60` — and `/60` is what fails here. **The fix was correct
 * for the theme it was measured in and insufficient for the other one.**
 *
 * ── 🔴 WHY THIS BATCH REPORTS IT RATHER THAN FIXING IT (RK-1) ─────────────
 * Every one of the ~21 failing elements is using the CORRECT semantic token.
 * `panel-theme-spec.md` §2 rules `base-content/60` the safe muted-text token;
 * the elements obey the spec and **the spec is what is wrong for this theme**.
 * Rewriting 21 call sites would encode the defect as a workaround. The real fix
 * is one of two token changes — darken light `base-content` (`#1a1c22` →
 * ~`#15171c`), or raise the muted token to `/70` (`#5d5e62`, which clears AA
 * comfortably) — and both live in `apps/ptah-landing-page/tailwind.config.js`
 * and the design-system spec, which this batch does not own and which the ADMIN
 * panel shares.
 *
 * ── ⚠️ THIS ALLOWANCE IS A QUARANTINE, NOT A WAIVER ───────────────────────
 * It permits EXACTLY this one rule id, in the LIGHT theme only. The dark theme
 * is asserted completely clean. Any additional rule, on any surface, in either
 * theme, still fails. **Delete this constant and its call sites the moment the
 * token is fixed** — {@link expectOnlyKnownViolations} fails loudly if the
 * defect stops occurring, so it cannot rot into a permanent exemption.
 */
export const KNOWN_LIGHT_THEME_CONTRAST_RULE = 'color-contrast';

/**
 * Asserts the ONLY violations present are the known, quarantined one.
 *
 * ⚠️ 🔴 IT ALSO FAILS IF THE KNOWN DEFECT IS ABSENT. An allowance that passes
 * when the defect is fixed is an allowance nobody ever removes — the exemption
 * outlives the bug and quietly widens the gate for the next one. This makes
 * fixing the token a change that BREAKS this file, which is what forces the
 * quarantine to be deleted in the same commit.
 */
export async function expectOnlyKnownViolations(
  page: Page,
  label: string,
): Promise<void> {
  const violations = await runAxe(page);
  const ids = [...new Set(violations.map((violation) => violation.id))].sort();

  expect(
    ids,
    `${label}: unexpected a11y violations beyond the known light-theme contrast defect — ${JSON.stringify(
      violations,
      null,
      2,
    )}`,
  ).toEqual([KNOWN_LIGHT_THEME_CONTRAST_RULE]);
}

/**
 * 🔴 RUNS AXE OVER A SURFACE **TWICE** — POPULATED AND EMPTY (RISK-AR).
 *
 * ⚠️ 🔴 THIS IS THE ENTIRE REASON THIS FILE EXISTS AS SOMETHING MORE THAN A
 * DEPENDENCY SWAP, AND IT IS THE LESSON OF B13's F-1.
 *
 * F-1 was a REAL 3.2:1 WCAG AA failure on a SHIPPING component: `EmptyState`'s
 * hint paragraph rendered at `text-base-content/40`. It survived THREE PHASES of
 * axe passes. Not because the passes were weak — because every one of them ran
 * against a surface its fixture had POPULATED, and `EmptyState` only renders
 * when a surface is empty. The component was, in axe's view, never on the page.
 *
 * An empty surface is not a degenerate case of a populated one. It renders
 * DIFFERENT ELEMENTS: the empty state, its icon, its hint, the "nothing here"
 * copy, and often a call to action — all of them text a member has to read, none
 * of them present in the screenshot anyone reviewed.
 *
 * `emptyIt` is a callback rather than a flag because emptying a surface is
 * surface-specific: some are emptied by tearing down fixtures, some by a filter
 * that matches nothing, some by pointing at a second identity that owns no rows.
 * The helper does not guess.
 *
 * ⚠️ IT ASSERTS THE SURFACE IS ACTUALLY EMPTY BEFORE MEASURING IT. Without
 * that, an `emptyIt` that silently failed to empty anything would run the
 * populated pass twice and report a clean sweep — which is precisely the
 * true-because-nothing-rendered failure this helper exists to prevent, wearing
 * the opposite disguise.
 */
export async function auditPopulatedAndEmpty(
  page: Page,
  options: {
    /** For failure messages. */
    readonly label: string;
    /** Navigate to and settle the POPULATED surface. */
    readonly populate: () => Promise<void>;
    /** Make the same surface EMPTY and settle it. */
    readonly emptyIt: () => Promise<void>;
    /** A selector present only when the surface has content. */
    readonly populatedMarker: string;
    /** A selector present only when the surface is empty. */
    readonly emptyMarker: string;
  },
): Promise<void> {
  await options.populate();
  await expect(page.locator(options.populatedMarker).first()).toBeVisible({
    timeout: 20_000,
  });
  await expectNoAxeViolations(page, `${options.label} [POPULATED]`);

  await options.emptyIt();
  // 🔴 Anti-vacuity. See the docblock: a failed `emptyIt` must not read as a
  // clean empty-state pass.
  await expect(page.locator(options.emptyMarker).first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator(options.populatedMarker)).toHaveCount(0);
  await expectNoAxeViolations(page, `${options.label} [EMPTY]`);
}
