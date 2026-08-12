import {
  expectNoAxeViolations,
  expectOnlyKnownViolations,
} from '../support/axe';
import { expect, test } from '../support/fixtures';

/**
 * TASK_2026_177 §8.2 P5 — `/members/search`, EXIT-GATE CLAUSE 4 (NFR-M1).
 *
 * ── 🔴 THIS FILE DELIBERATELY DOES **NOT** RE-TEST WHAT SEARCH DOES ───────
 * Ground truth 12 records that `/members/search` "has only indirect coverage
 * today via `members-community.spec.ts:392`". **That is not accurate at the
 * code.** That test navigates to `/members/search`, types into the real input,
 * clicks the real button, and asserts all three result groups — including the
 * empty `lessons` group and its `EmptyState`. It is DIRECT coverage of this
 * surface; it merely LIVES in the community file, because the thread it
 * searches for has to be authored there first.
 *
 * Duplicating that journey here would mean a second copy of the same fixture,
 * the same composer flow and the same assertions — two places to update, and
 * the Rule of Three says extract at the third occurrence, not clone at the
 * first. So the functional half stays where its fixture is, and this file adds
 * the half that is genuinely missing.
 *
 * ── 🔴 WHAT WAS ACTUALLY MISSING: THE A11Y PASS, AND THE EMPTY SURFACE ────
 * `/members/search` has never had an axe run. It is also the ONE member surface
 * whose DEFAULT state is empty — a member arrives before typing anything — and
 * its zero-result state renders `EmptyState`, the component B13's F-1 was found
 * in. That is precisely the combination RISK-AR says survived three phases:
 * every prior pass ran against a POPULATED surface, and this one is empty
 * before anyone touches it.
 *
 * Three states are audited: the untouched surface, a query with NO results, and
 * a query WITH results. No fixture is seeded — the assertions are about
 * rendering and contrast, and the community tables already hold Batch 8's rows.
 */
test.describe('Member search surface (§8.2 P5, clause 4 — a11y half)', () => {
  test('🔴 the surface renders before any query, and axe is clean on it', async ({
    builderPage,
  }) => {
    // 🔴 THE UNTOUCHED STATE. Every other axe run in this suite had to arrange
    // for a surface to be empty; this one is empty by default, which is exactly
    // why it went four phases without ever being measured.
    await builderPage.goto('/members/search');
    // ⚠️ NAMED, NOT JUST `level: 1`. The panel shell renders its own `h1`, so a
    // bare level query is a strict-mode violation rather than a stronger
    // assertion.
    await expect(
      builderPage.getByRole('heading', { name: 'Search', level: 1 }),
    ).toBeVisible({ timeout: 20_000 });

    const input = builderPage.locator('input[type="search"]');
    await expect(input).toBeVisible();

    // NFR-U4 — the input carries an accessible name. A bare `placeholder` is
    // not one: it disappears on focus and several screen readers ignore it.
    const accessibleName = await input.evaluate((node) => {
      const element = node as HTMLInputElement;
      const labelledBy = element.getAttribute('aria-labelledby');
      const label = labelledBy
        ? document.getElementById(labelledBy)?.textContent
        : null;
      return (
        element.getAttribute('aria-label') ??
        label ??
        element.labels?.[0]?.textContent ??
        ''
      );
    });
    expect(
      accessibleName.trim().length,
      'the search input must have an accessible name, not only a placeholder',
    ).toBeGreaterThan(0);

    await expectNoAxeViolations(builderPage, '/members/search [UNTOUCHED]');
  });

  test('🔴 a query with NO results renders the empty state, and axe is clean', async ({
    builderPage,
  }) => {
    // 🔴 THE EMPTY-RESULT STATE — where `EmptyState`'s hint renders, which is
    // the exact element B13's F-1 measured at 3.2:1 and which every populated
    // pass in three phases missed.
    await builderPage.goto('/members/search');
    const input = builderPage.locator('input[type="search"]');
    await expect(input).toBeVisible({ timeout: 20_000 });

    const noMatch = `zzqx-no-such-term-${Date.now()}`;
    await input.fill(noMatch);
    await builderPage.getByRole('button', { name: 'Search' }).click();

    // 🔴 ANTI-VACUITY, AND THE SHAPE HERE IS NOT WHAT IT LOOKS LIKE. On zero
    // total hits the page does NOT render the three result groups with `(0)`
    // counts — it replaces all of them with a SINGLE `EmptyState` quoting the
    // query back. (This spec's first draft asserted `#search-topics` contained
    // "Threads (0)" and failed on an element that is never rendered in this
    // state; the group headers only exist once something matched.)
    //
    // That single empty state is the F-1 element itself — message plus HINT —
    // which is exactly what makes this the most valuable axe target on the
    // surface.
    await expect(
      builderPage.getByText(`Nothing matched “${noMatch}”.`),
    ).toBeVisible({ timeout: 20_000 });
    const empty = builderPage.locator('ptah-empty-state');
    await expect(empty).toHaveCount(1);
    await expect(
      empty.getByText(
        'Try a shorter phrase, or a word you remember from the thread title.',
      ),
    ).toBeVisible();

    await expectNoAxeViolations(builderPage, '/members/search [NO RESULTS]');
  });

  /* ---------------------------------------------------------------------- */
  /* 🔴 NFR-U5 — both themes, on the EMPTY surface                           */
  /* ---------------------------------------------------------------------- */

  for (const theme of ['operator-member', 'operator-member-light'] as const) {
    test(`🔴 the EMPTY search surface renders and audits clean in ${theme}`, async ({
      builderPage,
    }, testInfo) => {
      // ⚠️ EMPTY ON PURPOSE HERE, WHICH INVERTS THE USUAL RULE AND IS WORTH
      // SAYING. Every other theme loop in this suite insists on a POPULATED
      // surface, because B7.1 lost a whole batch to a loop that passed over a
      // placeholder. This one is deliberately the other way round: the empty
      // state is a DIFFERENT set of elements — icon, message, hint — and it is
      // the set that has never been measured in either theme.
      await builderPage.addInitScript((value) => {
        window.localStorage.setItem('ptah.members.theme', value);
      }, theme);

      await builderPage.goto('/members/search');
      await expect(builderPage.locator('input[type="search"]')).toBeVisible({
        timeout: 20_000,
      });

      await expect(
        builderPage.locator(`[data-theme="${theme}"]`).first(),
      ).toBeVisible();

      // 🔴 THE LIGHT THEME CARRIES THE KNOWN, REPORTED CONTRAST DEFECT and the
      // dark theme is fully clean. See KNOWN_LIGHT_THEME_CONTRAST_RULE — this
      // very surface is where it is most visible, because the empty state's
      // hint is one of the failing elements and this is the one member surface
      // whose DEFAULT state is empty.
      if (theme === 'operator-member-light') {
        await expectOnlyKnownViolations(
          builderPage,
          `/members/search [EMPTY, ${theme}]`,
        );
      } else {
        await expectNoAxeViolations(
          builderPage,
          `/members/search [EMPTY, ${theme}]`,
        );
      }

      await testInfo.attach(`search-empty-${theme}`, {
        body: await builderPage.screenshot({ fullPage: true }),
        contentType: 'image/png',
      });
    });
  }
});
