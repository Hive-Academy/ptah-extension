import * as fs from 'fs';
import * as path from 'path';
import type { Page, TestInfo } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * The axe helper for the Electron e2e suite (TASK_2026_576 Batch 59).
 *
 * Pattern: `apps/ptah-landing-page-e2e/src/support/axe.ts` (same violation
 * shape, same "message carries the whole list" rule). The difference is the
 * transport. The landing-page helper hands a Playwright `Page` to
 * `@axe-core/playwright`'s `AxeBuilder`; here the page is an Electron
 * renderer, so the helper injects axe-core's own browser bundle with
 * `page.evaluate` and runs it in place. `evaluate` goes through the DevTools
 * protocol, so it is not subject to the renderer's CSP the way an injected
 * `<script>` tag would be, and nothing is fetched over the network.
 *
 * Policy (Batch 59 quality requirement):
 *  - a CRITICAL or SERIOUS violation fails the spec, in both themes;
 *  - MODERATE and MINOR violations are reported (console + a test attachment)
 *    and never fail it, so they stay visible without turning the gate into
 *    one people learn to ignore.
 *
 * Themes: the app switches theme through `ThemeService`, whose effect writes
 * `data-theme` and `data-theme-mode` on `<html>`. Only `anubis` (dark) and
 * `anubis-light` are compiled into the eager stylesheet, so those are the two
 * this helper drives; setting the same two attributes the service emits keeps
 * the spec pointed at the surface rather than at the settings UI.
 */

export type AxeTheme = 'dark' | 'light';

export interface AxeViolation {
  id: string;
  impact: string | null;
  /** The failing selectors: the field that makes a failure actionable. */
  targets: string[];
  /** axe's own explanation of the first failing node. */
  summary: string;
  /** Per failing node: the selector and axe's explanation of that node. */
  nodes: { target: string; summary: string }[];
}

/** Impacts that fail a spec. Everything else is reported only. */
const BLOCKING_IMPACTS: ReadonlySet<string> = new Set(['critical', 'serious']);

const THEME_ATTRIBUTES: Readonly<
  Record<AxeTheme, { theme: string; mode: string }>
> = {
  dark: { theme: 'anubis', mode: 'dark' },
  light: { theme: 'anubis-light', mode: 'light' },
};

let axeSource: string | null = null;

function loadAxeSource(): string {
  if (axeSource === null) {
    axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
  }
  return axeSource;
}

/** Switch the renderer to `theme` the way `ThemeService` does, and settle. */
export async function setTheme(page: Page, theme: AxeTheme): Promise<void> {
  const { theme: name, mode } = THEME_ATTRIBUTES[theme];
  await page.evaluate(
    ({ name, mode }) => {
      document.body.removeAttribute('data-vscode-theme-kind');
      document.documentElement.setAttribute('data-theme', name);
      document.documentElement.setAttribute('data-theme-mode', mode);

      // Surfaces that follow `ThemeService.isDarkMode()` (the CodeMirror
      // editor, the Pierre diff options) never see a bare attribute flip.
      // Drive the real service through the first component that injects it
      // (dev build only: `ng` is the Angular debug context).
      const angular = (
        window as unknown as {
          ng?: { getComponent(element: Element): unknown };
        }
      ).ng;
      if (!angular) return;
      for (const element of Array.from(document.querySelectorAll('*'))) {
        if (!element.tagName.includes('-')) continue;
        let component: unknown;
        try {
          component = angular.getComponent(element);
        } catch {
          continue;
        }
        const service = (
          component as { theme?: { setTheme?: (theme: string) => void } } | null
        )?.theme;
        if (typeof service?.setTheme === 'function') {
          service.setTheme(name);
          return;
        }
      }
    },
    { name, mode },
  );
  // Style recalculation has to land before axe reads computed colours.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

/**
 * Runs axe over `include` (a CSS selector, default the whole `body`) and
 * returns every violation, flattened. Shadow DOM is traversed by axe itself,
 * so Pierre's `<diffs-container>` content is covered.
 */
export async function runAxe(
  page: Page,
  include = 'body',
): Promise<AxeViolation[]> {
  await page.evaluate(loadAxeSource());
  return page.evaluate(async (selector) => {
    const axe = (
      window as unknown as {
        axe: {
          run: (
            context: unknown,
            options: unknown,
          ) => Promise<{
            violations: {
              id: string;
              impact?: string | null;
              nodes: { target: unknown[]; failureSummary?: string }[];
            }[];
          }>;
        };
      }
    ).axe;
    const results = await axe.run(
      { include: [[selector]] },
      { resultTypes: ['violations'] },
    );
    return results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact ?? null,
      targets: violation.nodes.flatMap((node) =>
        node.target.map((target) => String(target)),
      ),
      summary: violation.nodes[0]?.failureSummary ?? '',
      nodes: violation.nodes.map((node) => ({
        target: node.target.map((target) => String(target)).join(' '),
        summary: (node.failureSummary ?? '').replace(/\s+/g, ' ').trim(),
      })),
    }));
  }, include);
}

/**
 * Where Batch 68 keeps its evidence: one JSON, one markdown summary and one
 * screenshot per theme for every audited surface. Resolved from this file so
 * it holds from any working directory.
 */
const EVIDENCE_DIR = path.resolve(
  __dirname,
  '../../../../.ptah/specs/TASK_2026_576_e16a/screenshots/axe',
);

export interface AxeAuditOptions {
  /** CSS selector axe is limited to (default the whole `body`). */
  include?: string;
  /**
   * Runs after the theme switched and before axe reads the page. Surfaces that
   * read the theme at mount (Pierre diffs) re-mount here so the audit sees the
   * theme's own rendering, not the previous theme's.
   */
  remount?: (theme: AxeTheme) => Promise<void>;
  /** Write the JSON, markdown and per-theme screenshots under the evidence dir. */
  evidence?: boolean;
}

function writeEvidence(label: string, audits: AxeAuditResult[]): void {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(EVIDENCE_DIR, `${label}.json`),
    JSON.stringify(audits, null, 2),
  );
  const lines = [`# axe: ${label}`, ''];
  for (const audit of audits) {
    lines.push(
      `## ${audit.theme}`,
      '',
      `- critical/serious: ${audit.blocking.length}`,
      `- moderate/minor (reported only): ${audit.reported.length}`,
      `- screenshot: ${label}-${audit.theme}.png`,
    );
    for (const v of [...audit.blocking, ...audit.reported]) {
      lines.push(
        `- ${v.id} (${v.impact}): ${v.targets.slice(0, 5).join(' | ')}`,
      );
    }
    lines.push('');
  }
  fs.writeFileSync(path.join(EVIDENCE_DIR, `${label}.md`), lines.join('\n'));
}

export interface AxeAuditResult {
  readonly theme: AxeTheme;
  readonly blocking: AxeViolation[];
  readonly reported: AxeViolation[];
}

/**
 * Audits `include` in dark then light, fails on critical/serious violations
 * (message names the theme and carries the whole list), and reports the rest.
 * The page is left in the light theme; callers that continue should call
 * {@link setTheme} again.
 */
export async function expectNoBlockingViolationsInBothThemes(
  page: Page,
  label: string,
  testInfo: TestInfo,
  includeOrOptions: string | AxeAuditOptions = 'body',
): Promise<AxeAuditResult[]> {
  const options: AxeAuditOptions =
    typeof includeOrOptions === 'string'
      ? { include: includeOrOptions }
      : includeOrOptions;
  const include = options.include ?? 'body';
  const audits: AxeAuditResult[] = [];
  // Audit the surface at rest: a pointer left over the last-clicked control
  // would otherwise audit its hover colours in one run and not the next.
  await page.mouse.move(2, 2);
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme);
    if (options.remount) {
      await options.remount(theme);
      await setTheme(page, theme);
    }
    const violations = await runAxe(page, include);
    if (options.evidence) {
      fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
      await page.screenshot({
        path: path.join(EVIDENCE_DIR, `${label}-${theme}.png`),
      });
    }
    const blocking = violations.filter((v) =>
      BLOCKING_IMPACTS.has(v.impact ?? ''),
    );
    const reported = violations.filter(
      (v) => !BLOCKING_IMPACTS.has(v.impact ?? ''),
    );
    audits.push({ theme, blocking, reported });

    const summary =
      `[axe] ${label} / ${theme}: ${blocking.length} critical/serious, ` +
      `${reported.length} other` +
      (reported.length > 0
        ? ` (${reported.map((v) => `${v.id}:${v.impact}`).join(', ')})`
        : '');
    console.log(summary);
    await testInfo.attach(`axe-${label}-${theme}.json`, {
      body: JSON.stringify({ blocking, reported }, null, 2),
      contentType: 'application/json',
    });
  }

  if (options.evidence) writeEvidence(label, audits);

  // Assert after BOTH themes were measured, so one failing run reports the
  // dark and the light findings together instead of hiding the second behind
  // the first.
  const failures = audits.filter((audit) => audit.blocking.length > 0);
  expect(
    failures.map((audit) => ({
      theme: audit.theme,
      violations: audit.blocking,
    })),
    `${label} has critical/serious a11y violations: ${JSON.stringify(
      failures,
      null,
      2,
    )}`,
  ).toEqual([]);
  return audits;
}
