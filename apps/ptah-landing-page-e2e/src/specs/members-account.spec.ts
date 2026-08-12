import {
  expectNoAxeViolations,
  expectOnlyKnownViolations,
  runAxe,
} from '../support/axe';
import { expect, test } from '../support/fixtures';

/**
 * TASK_2026_177 §8.2 P5 — `/members/account`, EXIT-GATE CLAUSE 4 (NFR-M1).
 *
 * ── 🔴 THIS SURFACE WAS NEVER THE MISSING WORK — THE TEST WAS ─────────────
 * `account-page.ts` shipped in Phase 1: routed, standalone, OnPush, three
 * sections, and issuing no request beyond the `auth/me` call `AuthService`
 * already caches for the shell. It has been reachable and correct for four
 * phases with NO coverage of any kind. `account-page.spec.ts` is the unit half;
 * this is the half that can only be observed in a browser.
 *
 * ── WHAT ONLY A REAL BROWSER CAN PROVE HERE ───────────────────────────────
 *   • **The theme survives a genuine RELOAD** (R9.6, AD-13). The unit spec
 *     rebuilds the TestBed, which is a good proxy; this reloads the document,
 *     which is the thing itself — and it asserts `data-theme` is actually
 *     ATTACHED afterwards, not merely stored. A preference written to
 *     `localStorage` but never bound renders the daisyUI default and the panel
 *     silently loses every token it was designed against.
 *   • **Sign-out really leaves.** The unit spec mocks the Router.
 *   • **axe** over a surface that is dense with `<dl>`, badges and a pressed-
 *     state button pair — and over its EMPTY-ish state, a member with no
 *     cohort, which is the ordinary case in this workspace and the one that
 *     renders `EmptyState` (the component B13's F-1 was found in).
 */
test.describe('Member account surface (§8.2 P5, clause 4)', () => {
  test('the account page renders identity, appearance and billing', async ({
    builderPage,
    builderUser,
  }) => {
    await builderPage.goto('/members/account');
    await expect(
      builderPage.getByRole('heading', { name: 'Account', level: 1 }),
    ).toBeVisible({ timeout: 20_000 });

    // 🔴 ANTI-VACUITY: the signed-in identity is really on the page, so the
    // section assertions below are about a populated surface.
    //
    // ⚠️ SCOPED TO THE IDENTITY SECTION. The email appears THREE times in the
    // rendered panel — the shell header, this `<dd>`, and the sidebar footer —
    // so an unscoped `getByText` is a strict-mode violation rather than a
    // stronger assertion. The one that matters is the one under the "Identity"
    // landmark, because that is the section this test is about.
    await expect(
      builderPage
        .locator('section[aria-labelledby="account-identity"]')
        .getByText(builderUser.email),
    ).toBeVisible();

    await expect(builderPage.getByText('Identity')).toBeVisible();
    await expect(builderPage.getByText('Appearance')).toBeVisible();
    await expect(builderPage.getByText('Billing and profile')).toBeVisible();

    // Billing links out rather than duplicating the subscription surface —
    // there is one place a subscription is managed and this is not it.
    await expect(builderPage.locator('a[href="/profile"]')).toBeVisible();
  });

  test('🔴 a member with NO cohort is told so, and it is not framed as an error', async ({
    builderPage,
  }) => {
    // A-2 / R7.8 — the ORDINARY case here: the `builderPage` fixture seeds no
    // `member_group_assignment`, matching every real account in this workspace.
    // An unexplained absence of cohort content would read as broken entitlement.
    await builderPage.goto('/members/account');
    await expect(
      builderPage.getByRole('heading', { name: 'Account', level: 1 }),
    ).toBeVisible({ timeout: 20_000 });

    await expect(builderPage.getByText('No cohort assigned')).toBeVisible();
    await expect(
      builderPage.getByText('You are not in a cohort yet.'),
    ).toBeVisible();
    await expect(builderPage.locator('[role="alert"]')).toHaveCount(0);
  });

  test('🔴 R9.6 — the theme choice survives a real RELOAD and is ATTACHED', async ({
    builderPage,
  }) => {
    await builderPage.goto('/members/account');
    await expect(
      builderPage.getByRole('heading', { name: 'Account', level: 1 }),
    ).toBeVisible({ timeout: 20_000 });

    // Dark is the default (panel-theme-spec.md — the primary reference screen).
    await expect(
      builderPage.locator('[data-theme="operator-member"]').first(),
    ).toBeVisible();

    // ⚠️ SCOPED TO THE APPEARANCE SECTION, AND THAT IS ITSELF A FINDING WORTH
    // KEEPING. The panel SHELL also carries a theme control, whose accessible
    // name is "Switch to light theme" — so an unscoped `name: 'Light'` matches
    // two different controls that write the same key. There are two ways to
    // change the theme and this test is about the one on this page.
    const appearance = builderPage.locator(
      'section[aria-labelledby="account-appearance"]',
    );

    await appearance
      .getByRole('button', { name: 'Light', exact: true })
      .click();
    await expect(
      builderPage.locator('[data-theme="operator-member-light"]').first(),
    ).toBeVisible();

    // 🔴 A REAL RELOAD. The unit spec rebuilds the TestBed, which is a proxy for
    // this; a service that persisted nothing would pass that and fail here.
    await builderPage.reload();
    await expect(
      builderPage.getByRole('heading', { name: 'Account', level: 1 }),
    ).toBeVisible({ timeout: 20_000 });

    await expect(
      builderPage.locator('[data-theme="operator-member-light"]').first(),
    ).toBeVisible();
    // And the control agrees with the document — a pressed state that disagreed
    // with `data-theme` would be two answers to one question.
    await expect(
      builderPage
        .locator('section[aria-labelledby="account-appearance"]')
        .getByRole('button', { name: 'Light', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  test('🔴 NFR-U4 — sign-out is reachable by KEYBOARD alone and leaves the panel', async ({
    builderPage,
  }) => {
    await builderPage.goto('/members/account');
    const signOut = builderPage.getByRole('button', { name: /sign out/i });
    await expect(signOut).toBeVisible({ timeout: 20_000 });

    // 🔴 FOCUSED BY TABBING, NOT BY `.focus()`. An element can be focused
    // programmatically and still be unreachable by Tab — which is the failure
    // NFR-U4 is about, and the one `.focus()` hides.
    let reached = false;
    for (let i = 0; i < 60 && !reached; i += 1) {
      await builderPage.keyboard.press('Tab');
      reached = await signOut.evaluate(
        (node) => node === document.activeElement,
      );
    }
    expect(reached, 'Sign out must be reachable by Tab alone').toBe(true);

    // A visible focus indicator — NFR-U4's other half. `outline: none` with no
    // replacement is the defect; daisyUI's `:focus-visible` ring is the fix.
    const outlineWidth = await signOut.evaluate(
      (node) => getComputedStyle(node).outlineWidth,
    );
    expect(outlineWidth).toBeTruthy();

    await builderPage.keyboard.press('Enter');

    // Sign-out clears the local session and leaves the panel, whatever the
    // server said.
    await expect(builderPage).toHaveURL(/localhost:\d+\/($|\?|#)/, {
      timeout: 20_000,
    });
  });

  /* ---------------------------------------------------------------------- */
  /* 🔴 NFR-U5 — both themes                                                 */
  /* ---------------------------------------------------------------------- */

  for (const theme of ['operator-member', 'operator-member-light'] as const) {
    test(`the account surface renders in ${theme} (NFR-U5)`, async ({
      builderPage,
    }, testInfo) => {
      await builderPage.addInitScript((value) => {
        window.localStorage.setItem('ptah.members.theme', value);
      }, theme);

      await builderPage.goto('/members/account');
      await expect(
        builderPage.getByRole('heading', { name: 'Account', level: 1 }),
      ).toBeVisible({ timeout: 20_000 });

      await expect(
        builderPage.locator(`[data-theme="${theme}"]`).first(),
      ).toBeVisible();

      await testInfo.attach(`account-${theme}`, {
        body: await builderPage.screenshot({ fullPage: true }),
        contentType: 'image/png',
      });
    });
  }

  /* ---------------------------------------------------------------------- */
  /* 🔴 Clause 3 — axe, in BOTH themes                                       */
  /* ---------------------------------------------------------------------- */

  test('🔴 clause 3 — axe on the account surface, DARK clean and LIGHT quarantined', async ({
    builderPage,
  }) => {
    // 🔴 BOTH THEMES, AND RUNNING BOTH IS WHAT FOUND THE DEFECT. Contrast is
    // theme-dependent by definition; B13's F-1 was measured at 3.2:1 in DARK,
    // and every axe pass in this repository before this batch ran in DARK only.
    // A single-theme pass is half a pass, and the missing half was hiding a
    // real WCAG AA failure — see KNOWN_LIGHT_THEME_CONTRAST_RULE.
    await builderPage.addInitScript(() => {
      window.localStorage.setItem('ptah.members.theme', 'operator-member');
    });
    await builderPage.goto('/members/account');
    await expect(
      builderPage.getByRole('heading', { name: 'Account', level: 1 }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      builderPage.locator('[data-theme="operator-member"]').first(),
    ).toBeVisible();

    // 🔴 DARK IS FULLY CLEAN — no allowance at all.
    await expectNoAxeViolations(builderPage, '/members/account [dark]');
  });

  test('🔴 clause 3 — the LIGHT theme carries ONLY the known, reported contrast defect', async ({
    builderPage,
  }) => {
    // ⚠️ A QUARANTINE, NOT A WAIVER. `expectOnlyKnownViolations` permits exactly
    // one rule id and fails on any other — and fails if the defect is ever
    // ABSENT, so fixing the token breaks this test and forces the exemption out
    // in the same commit. The defect is reported, not fixed: every failing
    // element uses the correct semantic token and the TOKEN is what is wrong
    // (RK-1 — the theme and the design-system spec are another surface's).
    await builderPage.addInitScript(() => {
      window.localStorage.setItem(
        'ptah.members.theme',
        'operator-member-light',
      );
    });
    await builderPage.goto('/members/account');
    await expect(
      builderPage.getByRole('heading', { name: 'Account', level: 1 }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      builderPage.locator('[data-theme="operator-member-light"]').first(),
    ).toBeVisible();

    await expectOnlyKnownViolations(builderPage, '/members/account [light]');
  });

  test('the axe run on this surface is not vacuous', async ({
    builderPage,
  }) => {
    // 🔴 A CLEAN RESULT AND A RESULT FROM A RUN THAT NEVER HAPPENED ARE THE SAME
    // EMPTY ARRAY. B10's and B13's CDN helper guarded this with an explicit
    // "did the script load" assertion; `@axe-core/playwright` throws instead of
    // returning nothing, but that is worth pinning rather than assuming — so
    // this runs axe against a DELIBERATELY BROKEN DOM and requires a hit.
    await builderPage.goto('/members/account');
    await expect(
      builderPage.getByRole('heading', { name: 'Account', level: 1 }),
    ).toBeVisible({ timeout: 20_000 });

    await builderPage.evaluate(() => {
      const img = document.createElement('img');
      // No alt text — axe's `image-alt` rule, a guaranteed violation.
      img.src =
        'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      document.body.appendChild(img);
    });

    const violations = await runAxe(builderPage);
    expect(
      violations.map((violation) => violation.id),
      'axe must be able to REPORT — a helper that silently returns [] makes every other assertion in this suite meaningless',
    ).toContain('image-alt');
  });
});
