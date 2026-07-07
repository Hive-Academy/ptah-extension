import { test } from './_harness/browser-fixtures';
import type { Director } from './_harness/director';
import type { Locator, Page } from '@playwright/test';

/**
 * SHOWCASE — "Landing page tour" (a narrated scroll-through of ptah.live).
 *
 * The web sibling of the Electron product tours: instead of filming the desktop
 * app, this scene drives a headless Chromium context (see
 * `_harness/browser-fixtures.ts`) through the LIVE marketing site and narrates
 * it section by section — hook, Ptah positioning, the problem, the live demo,
 * the three product pillars (Remembers / Learns and scales / Always on), the
 * provider strip, the comparison, the also-available note, and the final
 * download call to action.
 *
 * AUDIO-FIRST: the voiceover script lives in `scripts/landing-page-tour.json`
 * and is narrated by `narrate.mjs` BEFORE capture. Each `director.say(i)` speaks
 * line i, holding for the REAL clip duration (durations.json) so narration,
 * captions and footage stay locked. Element-targeted says + spotlight/hover
 * auto-emit `shots.json`, punching the virtual camera onto each section as the
 * VO reaches it.
 *
 * STRICTLY READ-ONLY: it navigates, scrolls, hovers and spotlights. It NEVER
 * submits a form and NEVER clicks an outbound / checkout / download link — every
 * call to action is only hovered and spotlighted. The scene asserts nothing; it
 * is tuned for how it looks on camera.
 *
 * No local backend or auth is required — it films a public web page. Safe to run
 * alongside an Electron capture batch (different browser, zero LLM cost).
 */

/** The site under tour. Override for a staging deploy via env. */
const SITE_URL =
  process.env['PTAH_SHOWCASE_LANDING_URL'] ?? 'https://ptah.live';

/** Height of the fixed top navbar — sections are scrolled to just below it. */
const NAV_OFFSET = 96;

async function isVisible(loc: Locator): Promise<boolean> {
  return loc
    .first()
    .isVisible()
    .catch(() => false);
}

/** Smoothly scroll a located element to just below the fixed navbar, then settle. */
async function scrollToLoc(
  page: Page,
  loc: Locator,
  margin = NAV_OFFSET,
): Promise<void> {
  if (!(await isVisible(loc))) return;
  await loc
    .first()
    .evaluate((el, m) => {
      const y = el.getBoundingClientRect().top + window.scrollY - m;
      window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
    }, margin)
    .catch(() => undefined);
  // The scroll is an inter-beat gap (< ~900ms), which render-all passes through
  // at 1x — so the reveal plays smoothly under the narration seam.
  await page.waitForTimeout(700);
}

/** Scroll a section (by id) into view below the navbar. */
async function gotoSection(page: Page, id: string): Promise<void> {
  await scrollToLoc(page, page.locator(id));
}

/**
 * A section heading or (fallback) any element containing `name`, scoped to a
 * selector. Reliable camera target that also survives copy tweaks.
 */
function titleLoc(page: Page, scope: string, name: string): Locator {
  const within = page.locator(scope);
  return within
    .getByRole('heading', { name, exact: false })
    .or(within.getByText(name, { exact: false }))
    .first();
}

/** Guarded hover + spotlight (NEVER clicks). No-op when the target is absent. */
async function punch(
  director: Director,
  loc: Locator,
  dwellMs = 650,
  spotMs = 1400,
): Promise<void> {
  if (!(await isVisible(loc))) return;
  await director.hover(loc.first(), dwellMs).catch(() => undefined);
  await director.spotlight(loc.first(), spotMs).catch(() => undefined);
}

/** Best-effort dismissal of a cookie / consent banner (none observed, defensive). */
async function dismissConsent(page: Page, director: Director): Promise<void> {
  const labels = ['Accept', 'Accept all', 'Got it', 'I agree', 'Agree', 'OK'];
  for (const label of labels) {
    const btn = page.getByRole('button', { name: label, exact: false }).first();
    if (await isVisible(btn)) {
      await btn.click({ timeout: 3000 }).catch(() => undefined);
      await director.hold(250);
      return;
    }
  }
}

test('SHOWCASE — landing page tour (ptah.live)', async ({ page, director }) => {
  // ── Navigate + settle BEFORE the first beat ────────────────────────────────
  // Everything until the hook is trimmed by render-all's lead-in trim, so the
  // load / settle never airs and the hook opens on a fully-painted hero.
  await page.goto(SITE_URL, { waitUntil: 'networkidle', timeout: 90_000 });
  await dismissConsent(page, director);
  // Let the hero's entrance animation resolve and web fonts settle.
  await page
    .getByRole('heading', { name: 'It Remembers. It Learns. It Ships.' })
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 })
    .catch(() => undefined);
  await director.hold(2500);
  // Overlays (cursor / caption / spotlight) must be (re)installed AFTER the
  // navigation — a full page load wipes the pre-installed ones.
  await director.installOverlays();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'auto' }));
  await director.hold(600);

  // ── HERO ───────────────────────────────────────────────────────────────────
  const heroOverlay = page.locator('ptah-hero-content-overlay');
  const heroHeadline = page
    .getByRole('heading', { name: 'It Remembers. It Learns. It Ships.' })
    .first();
  const heroDownload = heroOverlay
    .getByRole('link', { name: 'Download Ptah' })
    .first();
  const heroWatch = heroOverlay
    .getByRole('link', { name: 'Watch it work' })
    .first();

  // HOOK — open on a question over the full-frame hero (establishing shot).
  await director.say(0);
  await director.say(1);

  // Ptah positioning — punch onto the headline, then the sub-promise.
  await director.say(2, { target: heroHeadline });
  await director.say(3, {
    target: heroHeadline,
    during: async () => {
      // Hover the calls to action (NEVER click — they route to /download).
      await punch(director, heroDownload, 600, 1200);
      if (await isVisible(heroWatch)) {
        await director.hover(heroWatch, 600).catch(() => undefined);
      }
    },
  });

  // ── S2 PROBLEM — "the new hire nobody onboarded" ────────────────────────────
  const problem = '#the-onboarding-problem';
  await gotoSection(page, problem);
  await director.say(4, { target: titleLoc(page, problem, 'New Hire') });
  await director.say(5, {
    target: titleLoc(page, problem, 'New Hire'),
    during: async () => {
      await punch(
        director,
        page.locator(problem).getByText('starting cold', { exact: false }),
        600,
        1600,
      );
    },
  });

  // ── S3 DEMO — "one desktop app, real sessions" ─────────────────────────────
  const demo = '#demo';
  await gotoSection(page, demo);
  await director.say(6, {
    target: titleLoc(page, demo, 'Real Sessions'),
    during: async () => {
      await scrollToLoc(page, page.locator(demo).locator('img, video, canvas'));
    },
  });

  // ── S4 PILLAR 1 — memory ────────────────────────────────────────────────────
  const memory = '#memory-intelligence';
  await gotoSection(page, memory);
  await director.say(7, {
    target: titleLoc(page, memory, 'Remembers Your Codebase'),
  });
  await director.say(8, {
    target: titleLoc(page, memory, 'Remembers Your Codebase'),
    during: async () => {
      await punch(
        director,
        page.locator(memory).getByText('memories indexed', { exact: false }),
        600,
        1600,
      );
    },
  });
  await director.say(9, {
    during: async () => {
      await punch(
        director,
        titleLoc(page, memory, 'Persistent Memory'),
        400,
        1100,
      );
      await punch(
        director,
        titleLoc(page, memory, 'Codebase Indexing'),
        400,
        1100,
      );
      await punch(
        director,
        titleLoc(page, memory, 'Hybrid Symbol Search'),
        400,
        1100,
      );
    },
  });

  // ── S5 PILLAR 2 — skills + orchestration ────────────────────────────────────
  const skills = '#skills-orchestration';
  await gotoSection(page, skills);
  await director.say(10, {
    target: titleLoc(page, skills, 'Multiplies Itself'),
  });

  const skillsCurator = titleLoc(page, skills, 'Skills Curator');
  await scrollToLoc(page, skillsCurator);
  await director.say(11, {
    target: skillsCurator,
    during: async () => punch(director, skillsCurator),
  });

  const subAgents = titleLoc(page, skills, 'Sub-Agent Orchestration');
  await scrollToLoc(page, subAgents);
  await director.say(12, {
    target: subAgents,
    during: async () => punch(director, subAgents),
  });

  const canvas = titleLoc(page, skills, 'Orchestra Canvas');
  await scrollToLoc(page, canvas);
  await director.say(13, {
    target: canvas,
    during: async () => punch(director, canvas),
  });

  // ── S6 PILLAR 3 — always on ─────────────────────────────────────────────────
  const alwaysOn = '#always-on';
  await gotoSection(page, alwaysOn);
  await director.say(14, {
    target: titleLoc(page, alwaysOn, 'Works While You Sleep'),
  });

  const cron = titleLoc(page, alwaysOn, 'Cron Scheduler');
  await scrollToLoc(page, cron);
  await director.say(15, {
    target: cron,
    during: async () => punch(director, cron),
  });

  const gateways = titleLoc(page, alwaysOn, 'Messaging Gateways');
  await scrollToLoc(page, gateways);
  await director.say(16, {
    target: gateways,
    during: async () => punch(director, gateways),
  });

  const approval = titleLoc(page, alwaysOn, 'Approval Relay');
  await scrollToLoc(page, approval);
  await director.say(17, {
    target: approval,
    during: async () => punch(director, approval),
  });

  // ── S7 PROVIDERS — bring any model ──────────────────────────────────────────
  const providers = '#providers';
  await gotoSection(page, providers);
  await director.say(18, {
    target: titleLoc(page, providers, 'Bring Any Model'),
    during: async () => {
      await punch(
        director,
        page.locator(providers).locator('img, svg').first(),
        600,
        1400,
      );
    },
  });

  // ── S8 COMPARISON — the Ptah difference ─────────────────────────────────────
  const comparison = '#comparison';
  await gotoSection(page, comparison);
  await director.say(19, {
    target: titleLoc(page, comparison, "Ptah Doesn't"),
  });
  await director.say(20, {
    target: titleLoc(page, comparison, 'Ptah Desktop'),
    during: async () => {
      await punch(
        director,
        titleLoc(page, comparison, 'Ptah Desktop'),
        500,
        1800,
      );
    },
  });

  // ── S9 ALSO AVAILABLE — editor + CLI ────────────────────────────────────────
  const alsoAvailable = '#also-available';
  await gotoSection(page, alsoAvailable);
  await director.say(21, {
    target: titleLoc(page, alsoAvailable, 'Editor or a Terminal'),
  });

  // ── S10 FINAL CTA — download ────────────────────────────────────────────────
  const cta = '#cta';
  await gotoSection(page, cta);
  const ctaHeading = page
    .locator(cta)
    .getByRole('heading', { name: 'Download Ptah' })
    .first();
  const ctaDownload = page
    .locator(cta)
    .getByRole('link', { name: 'Download Ptah' })
    .first();
  await director.say(22, {
    target: ctaHeading,
    during: async () => {
      // Hover the download CTA only — NEVER click (routes to /download).
      if (await isVisible(ctaDownload)) {
        await director.hover(ctaDownload, 700).catch(() => undefined);
        await director.spotlight(ctaDownload, 1600).catch(() => undefined);
      }
    },
  });
  await director.say(23, {
    target: ctaHeading,
    breathMs: 950,
    during: async () => {
      if (await isVisible(ctaDownload)) {
        await director.spotlight(ctaDownload, 1800).catch(() => undefined);
      }
    },
  });
});
