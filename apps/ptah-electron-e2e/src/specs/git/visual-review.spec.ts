import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { test as realTest, expect } from '../../support/real-rpc-fixtures';
import { test as mockedTest } from '../../support/fixtures';
import { THREE_HUNK_FILE } from '../../support/git-scratch-repo';
import type { ScratchRepo } from '../../support/git-scratch-repo';
import { gitDiffFileMock } from '../../support/git-diff-mock';
import {
  openFileInShell,
  spotEditor,
  spotEditorContent,
} from '../../support/spot-editor';
import { setTheme, type AxeTheme } from '../../support/axe';
import type { UiDriver } from '../../support/ui-driver';
import {
  prepareCanvasWithSessions,
  sessionRowButton,
  type SessionFixture,
} from '../../support/perf-session-fixture';

/**
 * Cutover visual review capture (TASK_2026_576, review of every mounted git
 * surface). Not an assertion suite: each step is wrapped so one missing state
 * never hides the next one, every surface is screenshot in dark and light at a
 * wide (1280x800) and a narrow (480x800) window, and layout metrics plus the
 * keyboard-focus pass are written next to the PNGs as JSON. Output goes to
 * `.ptah/specs/TASK_2026_576_e16a/screenshots/cutover/`.
 *
 * Real RPC against a real scratch repository wherever the backend can produce
 * the state (changes, branch review, spot editor, commit hook log and failure,
 * history, stashes, worktrees, a real merge conflict); mocked RPC only for the
 * states a real repo cannot reach (PR panel ok, history unavailable, diff load
 * failure, the chat change-set card).
 *
 * Pierre reads the theme at mount, so each theme gets its own launch and the
 * theme is set BEFORE the git panel first opens.
 */

const OUT = path.resolve(
  process.cwd(),
  '../../.ptah/specs/TASK_2026_576_e16a/screenshots/cutover',
);
const LONG_PATH =
  'packages/very-long-directory-name/another-extremely-long-segment/components/an-incredibly-long-component-filename-that-overflows.component.ts';
const WIDE = { width: 1280, height: 800 };
const NARROW = { width: 480, height: 800 };

interface Metric {
  name: string;
  viewport: string;
  docScrollWidth: number;
  docClientWidth: number;
  shellRect: { x: number; y: number; width: number; height: number } | null;
  clipped: string[];
}

class Capture {
  public readonly issues: string[] = [];
  public readonly metrics: Metric[] = [];
  public readonly focus: unknown[] = [];

  public constructor(
    private readonly theme: AxeTheme,
    private readonly tag: string,
    private readonly app: ElectronApplication,
    private readonly page: Page,
  ) {
    fs.mkdirSync(OUT, { recursive: true });
  }

  public async step(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (error) {
      const text = `${name}: ${String(error).slice(0, 400)}`;
      this.issues.push(text);
      console.log(`[visual-review] STEP FAILED ${text}`);
    }
  }

  public async resize(size: { width: number; height: number }): Promise<void> {
    await this.app.evaluate(({ BrowserWindow }, s) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win) return;
      win.setMinimumSize(300, 300);
      win.setSize(s.width, s.height);
    }, size);
    await this.page.waitForTimeout(700);
    // Shrinking the window clamps the dock to its minimum and never grows it
    // back, so restore the dock width the capture expects.
    if (size.width >= WIDE.width) await this.dock(640);
  }

  public async windowSize(): Promise<number[] | undefined> {
    return this.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.getContentSize(),
    );
  }

  public file(name: string): string {
    return path.join(OUT, `${this.theme}-${name}.png`);
  }

  public async shot(name: string, target?: Locator): Promise<void> {
    if (target) {
      await target.screenshot({ path: this.file(name) });
    } else {
      await this.page.screenshot({ path: this.file(name) });
    }
  }

  /** Set the git dock width (px) through the shell's own layout service. */
  public async dock(width: number): Promise<void> {
    await this.page.evaluate((w) => {
      const host = document.querySelector('ptah-electron-shell');
      const ng = (
        window as unknown as {
          ng?: { getComponent(el: Element): unknown };
        }
      ).ng;
      const comp = host && ng ? ng.getComponent(host) : null;
      (
        comp as {
          layout?: { setEditorPanelWidth(width: number): void };
        } | null
      )?.layout?.setEditorPanelWidth(w);
    }, width);
    await this.page.waitForTimeout(900);
  }

  /** Dock screenshot at a wide (640 px) and a narrow (320 px) dock + metrics. */
  public async both(name: string): Promise<void> {
    for (const [label, width] of [
      ['wide', 640],
      ['narrow', 320],
      ['min', 300],
    ] as const) {
      await this.dock(width);
      await this.shot(`${name}-${label}`);
      this.metrics.push(await this.measure(`${name}-${label}`));
    }
    await this.dock(640);
  }

  public async measure(name: string): Promise<Metric> {
    const data = await this.page.evaluate(() => {
      const shell = document.querySelector('ptah-review-shell');
      const rect = shell?.getBoundingClientRect() ?? null;
      const clipped: string[] = [];
      if (shell && rect) {
        for (const el of Array.from(shell.querySelectorAll('*'))) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          const cs = getComputedStyle(el);
          if (cs.visibility === 'hidden' || cs.display === 'none') continue;
          if (r.right > rect.right + 1 || r.left < rect.left - 1) {
            const label =
              el.getAttribute('data-testid') ??
              el.getAttribute('aria-label') ??
              el.tagName.toLowerCase();
            clipped.push(
              `${label}[${Math.round(r.left)}..${Math.round(r.right)}]`,
            );
          }
        }
      }
      return {
        docScrollWidth: document.documentElement.scrollWidth,
        docClientWidth: document.documentElement.clientWidth,
        shellRect: rect
          ? {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            }
          : null,
        clipped: clipped.slice(0, 12),
      };
    });
    const size = (await this.windowSize()) ?? [];
    return { name, viewport: size.join('x'), ...data };
  }

  /** Tab through the shell recording the computed focus indicator per stop. */
  public async focusPass(
    label: string,
    first: Locator,
    stops: number,
  ): Promise<void> {
    await first.focus();
    for (let i = 0; i < stops; i++) {
      const info = await this.page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          label: (
            el.getAttribute('aria-label') ??
            el.getAttribute('data-testid') ??
            el.textContent ??
            ''
          )
            .trim()
            .slice(0, 50),
          focusVisible: el.matches(':focus-visible'),
          outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`,
          boxShadow: cs.boxShadow.slice(0, 160),
          rect: [
            Math.round(r.x),
            Math.round(r.y),
            Math.round(r.width),
            Math.round(r.height),
          ],
        };
      });
      this.focus.push({ surface: label, stop: i, ...info });
      if (info) {
        const [x, y, w, h] = info.rect;
        const clip = {
          x: Math.max(0, x - 24),
          y: Math.max(0, y - 16),
          width: Math.min(w + 48, WIDE.width),
          height: Math.min(h + 32, 160),
        };
        await this.page.screenshot({
          path: this.file(`focus-${label}-${String(i).padStart(2, '0')}`),
          clip,
        });
      }
      await this.page.keyboard.press('Tab');
    }
  }

  public finish(): void {
    fs.writeFileSync(
      path.join(OUT, `${this.theme}-${this.tag}-metrics.json`),
      JSON.stringify(
        { issues: this.issues, metrics: this.metrics, focus: this.focus },
        null,
        2,
      ),
    );
  }
}

function configureIdentity(repo: ScratchRepo): void {
  repo.git('config', 'user.name', 'Ptah E2E');
  repo.git('config', 'user.email', 'e2e@ptah.invalid');
  repo.git('config', 'commit.gpgsign', 'false');
}

function installPreCommitHook(
  repo: ScratchRepo,
  body: readonly string[],
): void {
  const hooksDir = path.join(repo.root, '.git', 'ptah-e2e-hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  const hookPath = path.join(hooksDir, 'pre-commit');
  fs.writeFileSync(hookPath, ['#!/bin/sh', ...body, ''].join('\n'), {
    encoding: 'utf8',
  });
  fs.chmodSync(hookPath, 0o755);
  repo.git('config', 'core.hooksPath', hooksDir.replace(/\\/g, '/'));
}

function lines(count: number, tag: string): string {
  const out: string[] = [];
  for (let i = 1; i <= count; i++) out.push(`export const ${tag}${i} = ${i};`);
  return out.join('\n') + '\n';
}

/** A repo with a branch, a baseline commit on it, and a varied working tree. */
function seedRichRepo(repo: ScratchRepo): void {
  configureIdentity(repo);
  repo.git('checkout', '-b', 'feature/review');
  repo.write('docs/old.md', '# Old docs\n\nThis file goes away.\n');
  repo.write('lib/util.ts', lines(12, 'util'));
  repo.write('README.md', '# Ptah E2E\n\nFirst line.\nSecond line.\n');
  repo.write(LONG_PATH, lines(40, 'long'));
  repo.git('add', 'docs', 'lib', 'README.md', 'packages');
  repo.git(
    'commit',
    '-m',
    'chore: add docs, helpers and a long-path component',
  );

  // Working tree: modified (long path, 2 hunks), deleted, renamed (staged),
  // staged modification, untracked (plain and awkward name).
  const longLines = lines(40, 'long').split('\n');
  longLines[4] = 'export const long5 = 5000; // CHANGED';
  longLines[34] = 'export const long35 = 35000; // CHANGED';
  repo.write(LONG_PATH, longLines.join('\n'));
  fs.rmSync(path.join(repo.root, 'docs/old.md'));
  fs.mkdirSync(path.join(repo.root, 'lib/helpers'), { recursive: true });
  repo.git('mv', 'lib/util.ts', 'lib/helpers/util.ts');
  repo.write('README.md', '# Ptah E2E\n\nFirst line, edited.\nSecond line.\n');
  repo.git('add', 'README.md');
  repo.write('src/new-file.ts', lines(8, 'added'));
  repo.write('src/naïve name (copy).ts', lines(3, 'weird'));
}

/** Fail loudly when no ThemeService received the switch (see openGit). */
async function assertThemeService(page: Page, dark: boolean): Promise<void> {
  const seen = await page.evaluate(() => {
    const ng = (
      window as unknown as {
        ng?: { getComponent(el: Element): unknown };
      }
    ).ng;
    if (!ng) return null;
    for (const el of Array.from(document.querySelectorAll('*'))) {
      if (!el.tagName.includes('-')) continue;
      let comp: unknown;
      try {
        comp = ng.getComponent(el);
      } catch {
        continue;
      }
      const svc = (
        comp as { theme?: { isDarkMode?: () => boolean } } | null
      )?.theme;
      if (typeof svc?.isDarkMode === 'function') return svc.isDarkMode();
    }
    return null;
  });
  if (seen !== dark) {
    throw new Error(
      `ThemeService did not switch to ${dark ? 'dark' : 'light'} (saw ${String(seen)})`,
    );
  }
}

async function openGit(ui: UiDriver, theme: AxeTheme): Promise<void> {
  await ui.goto('git');
  // setTheme reaches the app's ThemeService only through a mounted component
  // that injects it (the review canvas), so wait for one before flipping, then
  // prove the service really switched. Pierre reads the theme at mount, so the
  // rail is remounted afterwards.
  await ui.page
    .locator('ptah-review-canvas')
    .first()
    .waitFor({ state: 'attached', timeout: 60_000 });
  await ui.page.waitForTimeout(500);
  await setTheme(ui.page, theme);
  await assertThemeService(ui.page, theme === 'dark');
  await ui.page
    .getByRole('button', { name: 'Toggle Git panel' })
    .first()
    .click();
  await expect(ui.page.locator('ptah-review-shell')).toHaveCount(0);
  await ui.goto('git');
  await ui.page.waitForTimeout(500);
}

async function waitSettled(page: Page, ms = 800): Promise<void> {
  await page.mouse.move(2, 2);
  await page.waitForTimeout(ms);
}

async function typeAtEnd(page: Page, text: string): Promise<void> {
  await spotEditorContent(page).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(text);
}

for (const theme of ['dark', 'light'] as const) {
  realTest.describe(`cutover visual review, real repo, ${theme}`, () => {
    realTest.setTimeout(900_000);

    realTest(
      `all surfaces ${theme}`,
      async ({ ui, rpcBridge, repo, electronApp }) => {
        void rpcBridge;
        const page = ui.page;
        const cap = new Capture(theme, 'real', electronApp, page);
        seedRichRepo(repo);
        await cap.resize(WIDE);
        await openGit(ui, theme);

        // ---------------- shell + Changes canvas ----------------
        await cap.step('changes', async () => {
          await expect(ui.reviewFileSection(THREE_HUNK_FILE)).toBeVisible({
            timeout: 60_000,
          });
          await expect(ui.hunkHost(0).first()).toBeVisible({ timeout: 60_000 });
          await waitSettled(page, 1500);
          await cap.both('changes');
          await cap.shot('changes-shell', ui.reviewShell());
          await cap.resize(NARROW);
          await cap.shot('app-window-480');
          await cap.resize(WIDE);
        });

        // Narrow dock defaults to Unified; a Split press must win over it.
        await cap.step('split-override', async () => {
          await cap.dock(320);
          await page.locator('[data-testid="layout-split"]').click();
          await waitSettled(page, 1500);
          await cap.shot('changes-split-override-narrow');
          await cap.dock(640);
          await cap.shot('changes-split-override-wide');
          await page.locator('[data-testid="layout-unified"]').click();
          await waitSettled(page, 800);
        });

        // File-section header open-in caret: visible and ringed at every dock.
        await cap.step('header-caret', async () => {
          for (const width of [640, 320, 300]) {
            await cap.dock(width);
            const section = ui.reviewFileSection(THREE_HUNK_FILE);
            await section.scrollIntoViewIfNeeded();
            const caret = section.locator(
              'ptah-open-in-button button[aria-label="Choose where to open"]',
            );
            await caret.focus();
            await page.keyboard.press('Shift+Tab');
            await page.keyboard.press('Tab');
            const info = await caret.evaluate((el) => {
              const r = el.getBoundingClientRect();
              const list = document
                .querySelector('[data-testid="review-canvas-list"]')
                ?.getBoundingClientRect();
              const cs = getComputedStyle(el);
              return {
                right: Math.round(r.right),
                width: Math.round(r.width),
                listRight: list ? Math.round(list.right) : null,
                focused: document.activeElement === el,
                outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`,
              };
            });
            cap.focus.push({ surface: 'header-caret', stop: width, ...info });
            await cap.shot(`header-caret-${width}`);
          }
          await cap.dock(640);
        });

        // Comment composer inputs: focus ring (V-4) at the narrow dock.
        await cap.step('comment-composer', async () => {
          await cap.dock(320);
          const list = page.locator('[data-testid="review-canvas-list"]');
          await list.evaluate((el) => {
            el.scrollTop = 0;
          });
          await waitSettled(page, 800);
          const section = ui.reviewFileSection(THREE_HUNK_FILE);
          await expect(section).toBeAttached({ timeout: 30_000 });
          await section.scrollIntoViewIfNeeded();
          await section
            .locator('[data-testid="file-section-comment"]')
            .click({ timeout: 15_000 });
          const composer = page.locator('[data-testid="comment-composer"]');
          await expect(composer).toBeVisible({ timeout: 15_000 });
          await composer.scrollIntoViewIfNeeded();
          await cap.shot('comment-composer-narrow');
          await cap.focusPass(
            'comment',
            composer.locator('[data-testid="comment-from"]'),
            3,
          );
          await composer.locator('[data-testid="comment-cancel"]').click();
          await cap.dock(640);
        });

        await cap.step('changes-scrolled', async () => {
          const list = page.locator('[data-testid="review-canvas-list"]');
          await list.evaluate((el) => {
            el.scrollTop = el.scrollHeight;
          });
          await waitSettled(page, 1200);
          await cap.shot('changes-scrolled');
          await list.evaluate((el) => {
            el.scrollTop = 0;
          });
        });

        await cap.step('collapsed-file', async () => {
          const section = ui.reviewFileSection(LONG_PATH);
          await section.locator('[data-testid="file-section-toggle"]').click();
          await waitSettled(page);
          await cap.shot('changes-collapsed-file');
          await section.locator('[data-testid="file-section-toggle"]').click();
        });

        await cap.step('hover-hunk', async () => {
          await ui.hunkHost(0).first().hover();
          await page.waitForTimeout(300);
          await cap.shot('changes-hunk-hover');
          await page.mouse.move(2, 2);
        });

        await cap.step('focus-pass', async () => {
          await cap.focusPass('changes', ui.reviewTab('Changes'), 12);
        });

        // ---------------- branch review ----------------
        await cap.step('branch-review', async () => {
          await page.locator('[data-testid="comparison-trigger"]').click();
          await page.waitForTimeout(300);
          await cap.shot('comparison-menu');
          await page
            .locator('[data-testid="comparison-option-branch"]')
            .click();
          await page.waitForTimeout(2500);
          await cap.shot('branch-review-picker');
          await page.keyboard.press('Escape');
          await waitSettled(page, 2500);
          await cap.both('branch-review');
          await page.locator('[data-testid="comparison-trigger"]').click();
          await page
            .locator('[data-testid="comparison-option-worktree"]')
            .click();
          await waitSettled(page, 1500);
        });

        // ---------------- spot editor ----------------
        await cap.step('spot-editor-readonly', async () => {
          await openFileInShell(page, THREE_HUNK_FILE, 12, {
            workspaceRoot: repo.root,
          });
          await expect(
            spotEditor(page).locator('[data-testid="spot-editor-ro"]'),
          ).toBeVisible({ timeout: 30_000 });
          await waitSettled(page, 1000);
          await cap.both('spot-editor-readonly');
          await spotEditor(page)
            .locator('[data-testid="spot-editor-back"]')
            .click();
          await expect(spotEditor(page)).toHaveCount(0);
        });

        await cap.step('spot-editor-editable', async () => {
          const section = ui.reviewFileSection(THREE_HUNK_FILE);
          await section.locator('[data-testid="file-section-edit"]').click();
          await expect(spotEditorContent(page)).toHaveAttribute(
            'contenteditable',
            'true',
            { timeout: 30_000 },
          );
          await waitSettled(page, 800);
          await cap.shot('spot-editor-editable-clean');
          await typeAtEnd(page, '// PTAH_VISUAL_REVIEW edit');
          await expect(
            spotEditor(page).locator('[data-testid="spot-editor-save"]'),
          ).toBeEnabled();
          await cap.both('spot-editor-dirty');
          await cap.focusPass(
            'spot',
            spotEditor(page).locator('[data-testid="spot-editor-back"]'),
            5,
          );
        });

        await cap.step('spot-editor-conflict', async () => {
          fs.writeFileSync(
            path.join(repo.root, THREE_HUNK_FILE),
            'export const changedElsewhere = true;\n',
            'utf8',
          );
          await spotEditor(page)
            .locator('[data-testid="spot-editor-save"]')
            .click();
          const dialog = page.getByRole('alertdialog');
          await expect(dialog).toBeVisible({ timeout: 15_000 });
          await page.waitForTimeout(500);
          await cap.both('spot-editor-conflict-dialog');
          await dialog.locator('[data-testid="git-confirm-cancel"]').click();
          await expect(dialog).toHaveCount(0);
          await page.waitForTimeout(400);
          await cap.shot('spot-editor-stale');
          await spotEditor(page)
            .locator('[data-testid="spot-editor-save"]')
            .click();
          await expect(dialog).toBeVisible();
          await dialog.locator('[data-testid="git-confirm-confirm"]').click();
          await expect(
            spotEditor(page).locator('[data-testid="spot-editor-stale"]'),
          ).toHaveCount(0, { timeout: 15_000 });
          await spotEditor(page)
            .locator('[data-testid="spot-editor-back"]')
            .click();
          await expect(spotEditor(page)).toHaveCount(0);
        });

        // ---------------- Commit tab ----------------
        await cap.step('commit-idle', async () => {
          await ui.reviewTab(/^Commit/).click();
          await expect(
            page.locator('[data-testid="commit-composer"]'),
          ).toBeVisible({ timeout: 30_000 });
          await waitSettled(page, 800);
          await cap.both('commit-idle');
          await page
            .locator('[data-testid="commit-message"]')
            .fill(
              'feat(review): scale the long-path component and rename the util helpers so the subject line is long enough to wrap in a narrow dock\n\nBody line one explains why.',
            );
          await page.waitForTimeout(300);
          await cap.both('commit-message-filled');
          await cap.focusPass(
            'commit',
            page.locator('[data-testid="commit-message"]'),
            5,
          );
        });

        await cap.step('commit-failure', async () => {
          installPreCommitHook(repo, [
            'echo "pre-commit: running lint on 3 files"',
            'echo "src/calc.ts:12:5 error  no-unused-vars  value10 is defined but never used"',
            'echo "packages/very-long-directory-name/another-extremely-long-segment/components/an-incredibly-long-component-filename-that-overflows.component.ts:35:1 error very long path in hook output"',
            'exit 1',
          ]);
          await page.locator('[data-testid="commit-submit"]').click();
          await expect(
            page.locator('[data-testid="commit-failure"]'),
          ).toBeVisible({ timeout: 60_000 });
          await waitSettled(page, 600);
          await cap.both('commit-failure');
        });

        await cap.step('commit-running-and-success', async () => {
          installPreCommitHook(repo, [
            'echo "pre-commit: step 1 of 3 (format)"',
            'sleep 3',
            'echo "pre-commit: step 2 of 3 (lint)"',
            'sleep 3',
            'echo "pre-commit: step 3 of 3 (types)"',
            'sleep 1',
            'exit 0',
          ]);
          await page.locator('[data-testid="commit-submit"]').click();
          await expect(
            page.locator('[data-testid="commit-hook-output"]'),
          ).toBeVisible({ timeout: 60_000 });
          await page.waitForTimeout(2500);
          await cap.shot('commit-running-wide');
          await cap.dock(320);
          await cap.shot('commit-running-narrow');
          await cap.dock(640);
          await expect(
            page.locator('[data-testid="commit-success"]'),
          ).toBeVisible({ timeout: 60_000 });
          await waitSettled(page, 600);
          await cap.both('commit-success');
        });

        await cap.step('commit-nothing-staged', async () => {
          await waitSettled(page, 1500);
          await cap.shot('commit-nothing-staged');
        });

        // ---------------- History ----------------
        await cap.step('history', async () => {
          await ui.reviewTab('History').click();
          await expect(
            page.locator('[data-testid="history-timeline"]'),
          ).toBeVisible({ timeout: 30_000 });
          await waitSettled(page, 1500);
          await cap.both('history-commits');
        });

        await cap.step('history-stash', async () => {
          repo.write(THREE_HUNK_FILE, lines(30, 'stashed'));
          repo.git('stash', 'push', '-u', '-m', 'WIP: visual review stash');
          await page.waitForTimeout(2500);
          const toggle = page.locator('[data-testid="history-stashes-toggle"]');
          if (await toggle.count()) {
            const expanded = await toggle.getAttribute('aria-expanded');
            if (expanded === 'false') await toggle.click();
          }
          await waitSettled(page, 1200);
          await cap.both('history-stashes');
          const entry = page
            .locator('[data-testid="history-stash-entry"]')
            .first();
          if (await entry.count()) {
            await entry.hover();
            await page.waitForTimeout(300);
            await cap.shot('history-stash-hover');
          }
          await page.mouse.move(2, 2);
          await cap.focusPass(
            'history',
            page.locator('[data-testid="history-heading"]').first(),
            6,
          );
        });

        // ---------------- Changes empty ----------------
        await cap.step('changes-empty', async () => {
          await ui.reviewTab(/^Changes/).click();
          await waitSettled(page, 1500);
          await cap.both('changes-empty');
        });

        // ---------------- Task tab ----------------
        await cap.step('task', async () => {
          const wt = path.join(
            os.tmpdir(),
            `ptah-vr-wt-${theme}-${Date.now()}`,
          );
          repo.git('worktree', 'add', '-b', 'agent/visual-review-task', wt);
          await ui.reviewTab('Task').click();
          await expect(
            page.locator('[data-testid="task-worktree-view"]'),
          ).toBeVisible({ timeout: 30_000 });
          await page.waitForTimeout(3000);
          await cap.both('task');
          const toggle = page.locator(
            '[data-testid="task-worktree-add-toggle"]',
          );
          if (await toggle.count()) {
            await toggle.click();
            await page.waitForTimeout(400);
            await cap.both('task-add-form');
            await toggle.click();
          }
          await cap.focusPass(
            'task',
            page.locator('[data-testid="task-worktree-view"] button').first(),
            8,
          );
        });

        // ---------------- Conflict banner (real merge conflict) ----------------
        await cap.step('conflict-banner', async () => {
          repo.git('checkout', '-b', 'conflict-side');
          repo.write(
            'README.md',
            '# Ptah E2E\n\nFirst line, from the other side.\nSecond line.\n',
          );
          repo.write('lib/helpers/util.ts', lines(12, 'sideutil'));
          repo.git('add', '.');
          repo.git('commit', '-m', 'side: edit readme and util');
          repo.git('checkout', 'feature/review');
          repo.write(
            'README.md',
            '# Ptah E2E\n\nFirst line, from our side.\nSecond line.\n',
          );
          repo.write('lib/helpers/util.ts', lines(12, 'ourutil'));
          repo.git('add', '.');
          repo.git('commit', '-m', 'ours: edit readme and util');
          try {
            repo.git('merge', 'conflict-side');
          } catch {
            // The conflict is the point.
          }
          await ui.reviewTab(/^Changes/).click();
          const banner = page.locator('[data-testid="conflict-banner"]');
          await expect(banner).toBeVisible({ timeout: 45_000 });
          await waitSettled(page, 1500);
          await cap.both('conflict-banner-changes');
          await cap.shot('conflict-banner-only', banner);
          await cap.focusPass(
            'conflict',
            banner.locator('button, a').first(),
            6,
          );
          await ui.reviewTab(/^Commit/).click();
          await waitSettled(page, 1200);
          await cap.both('conflict-commit-blocked');
          await ui.reviewTab('History').click();
          await waitSettled(page, 1200);
          await cap.shot('conflict-history');
        });

        cap.finish();
        console.log(
          `[visual-review] ${theme} done, issues: ${JSON.stringify(cap.issues)}`,
        );
      },
    );
  });

  // -------------------------------------------------------------------------
  // Mocked states a real repo cannot produce.
  // -------------------------------------------------------------------------
  mockedTest.describe(`cutover visual review, mocked states, ${theme}`, () => {
    mockedTest.setTimeout(300_000);

    const WORKSPACE = 'C:\\ptah-e2e-ws';
    const BRANCH = {
      branch:
        'feat/task-2026-576-with-a-rather-long-branch-name-for-truncation',
      upstream: 'origin/feat/task-2026-576-with-a-rather-long-branch-name',
      ahead: 12,
      behind: 3,
    };
    const worktrees = {
      worktrees: [
        {
          path: WORKSPACE,
          branch: BRANCH.branch,
          head: 'abc1234',
          isMain: true,
          isBare: false,
        },
        {
          path: `${WORKSPACE}\\.claude-worktrees\\agent-task-with-an-extremely-long-folder-name-that-must-truncate-gracefully`,
          branch: 'agent/task',
          head: 'def5678',
          isMain: false,
          isBare: false,
        },
        {
          path: `${WORKSPACE}\\.claude-worktrees\\detached`,
          branch: null,
          head: '9999999',
          isMain: false,
          isBare: false,
        },
      ],
    };

    mockedTest(
      `task PR ok, task PR quiet, history unavailable, diff error ${theme}`,
      async ({ ui, electronApp }) => {
        const page = ui.page;
        const cap = new Capture(theme, 'mocked', electronApp, page);
        await cap.resize(WIDE);
        await ui.mockRpc({
          'git:info': { isGitRepo: true, branch: BRANCH, files: [] },
          'git:worktrees': worktrees,
          'git:prStatus': {
            status: 'ok',
            pr: {
              number: 576,
              title:
                'Review canvas, spot editor and commit composer with a very long pull request title that should truncate',
              state: 'OPEN',
              isDraft: false,
              reviewDecision: 'CHANGES_REQUESTED',
              url: 'https://github.com/Hive-Academy/ptah-extension/pull/576',
              headRefName: 'feat/task-2026-576',
            },
            checks: { passing: 4, failing: 1, pending: 2, total: 7 },
          },
          'git:stashList': { success: true, entries: [], count: 0 },
        });
        await openGit(ui, theme);
        await ui.pushEvent({
          type: 'git:status-update',
          payload: { branch: BRANCH, files: [], isGitRepo: true },
        });

        await cap.step('mock-changes-empty', async () => {
          await waitSettled(page, 1200);
          await cap.both('mock-changes-empty');
        });

        await cap.step('mock-task-pr-ok', async () => {
          await ui.reviewTab('Task').click();
          await expect(
            page.locator('[data-testid="task-pr-open"]'),
          ).toBeVisible({
            timeout: 30_000,
          });
          await waitSettled(page, 800);
          await cap.both('task-pr-ok');
          await cap.focusPass(
            'mtask',
            page.locator('[data-testid="task-worktree-view"] button').first(),
            8,
          );
        });

        await cap.step('mock-task-pr-quiet', async () => {
          await ui.mockRpc({
            'git:prStatus': { status: 'unavailable', reason: 'gh-missing' },
          });
          await ui.reviewTab('Changes').click();
          await ui.reviewTab('Task').click();
          await expect(
            page.locator('[data-testid="task-pr-unavailable"]'),
          ).toBeVisible({ timeout: 30_000 });
          await waitSettled(page, 800);
          await cap.both('task-pr-quiet');
        });

        await cap.step('mock-history-unavailable', async () => {
          await ui.mockRpc({
            'git:log': { status: 'unavailable', reason: 'not-a-repo' },
          });
          await ui.reviewTab('History').click();
          await waitSettled(page, 1500);
          await cap.both('history-unavailable');
        });

        await cap.step('mock-history-empty', async () => {
          await ui.mockRpc({
            'git:log': {
              status: 'ok',
              mode: 'recent',
              base: null,
              branch: 'main',
              commits: [],
              truncated: false,
            },
          });
          await ui.reviewTab('Changes').click();
          await ui.reviewTab('History').click();
          await waitSettled(page, 1500);
          await cap.both('history-empty');
        });

        await cap.step('mock-diff-error', async () => {
          const files = ['src/ok.ts', 'src/broken.ts', 'src/ok2.ts'];
          const diffByPath: Record<string, unknown> = {};
          for (const f of [files[0], files[2]]) {
            diffByPath[f] = gitDiffFileMock({
              path: f,
              comparison: 'worktree',
              original: 'a\nb\nc\nd\ne\n',
              modified: 'a\nb\nCHANGED\nd\ne\n',
              snapshotToken: `vr-${f}`,
            });
          }
          await ui.mockRpc({
            'git:diffFile': `(params) => (${JSON.stringify(diffByPath)})[params.path]`,
          });
          await ui.pushEvent({
            type: 'git:status-update',
            payload: {
              branch: BRANCH,
              files: files.map((p) => ({
                path: p,
                status: 'M',
                staged: false,
                isDirectory: false,
              })),
              isGitRepo: true,
            },
          });
          await ui.reviewTab(/^Changes/).click();
          await waitSettled(page, 2500);
          await cap.both('changes-diff-error');
        });

        cap.finish();
        console.log(
          `[visual-review] mocked ${theme} done, issues: ${JSON.stringify(cap.issues)}`,
        );
      },
    );

    mockedTest(
      `chat change-set card ${theme}`,
      async ({ mainWindow, ui, electronApp }) => {
        const cap = new Capture(theme, 'card', electronApp, ui.page);
        await cap.resize(WIDE);
        const id = randomUUID();
        const base = Date.now() - 60_000;
        const events: SessionFixture['events'] = [];
        let seq = 0;
        const push = (
          timestamp: number,
          event: Record<string, unknown>,
        ): void => {
          events.push({
            id: `${id}-${seq++}`,
            timestamp,
            sessionId: id,
            source: 'history',
            ...event,
          } as SessionFixture['events'][number]);
        };
        push(base, {
          eventType: 'message_start',
          messageId: 'u0',
          role: 'user',
        });
        push(base + 1, {
          eventType: 'text_delta',
          messageId: 'u0',
          blockIndex: 0,
          delta: 'VR_USER rename the helpers',
        });
        push(base + 1000, {
          eventType: 'message_start',
          messageId: 'a0',
          role: 'assistant',
        });
        push(base + 1001, {
          eventType: 'text_delta',
          messageId: 'a0',
          blockIndex: 0,
          delta: 'VR_ASSISTANT done',
        });
        push(base + 1002, {
          eventType: 'message_complete',
          messageId: 'a0',
          stopReason: 'end_turn',
          tokenUsage: { input: 1, output: 1 },
        });
        const session: SessionFixture = {
          id,
          name: `VR card session ${theme}`,
          marker: 'VR_ASSISTANT',
          events,
          actualCount: events.length,
          paging: {
            tail: { events: [], olderCursor: null, resumableSubagents: [] },
            olderPages: {},
          },
        } as SessionFixture;
        const changeSet = {
          sessionId: id,
          workspaceRoot: WORKSPACE,
          turnStartedAt: base + 500,
          turnEndedAt: base + 5000,
          files: [
            {
              path: 'src/helpers.ts',
              status: 'M',
              additions: 12,
              deletions: 3,
            },
            {
              path: 'src/helpers.spec.ts',
              status: 'A',
              additions: 40,
              deletions: 0,
            },
            {
              path: 'docs/removed.md',
              status: 'D',
              additions: 0,
              deletions: 22,
            },
            {
              path: 'src/new-name.ts',
              originalPath: 'src/old-name.ts',
              status: 'R',
              additions: 1,
              deletions: 1,
            },
            {
              path: LONG_PATH,
              status: 'M',
              additions: 1234,
              deletions: 567,
            },
          ],
          truncatedCount: 0,
          totals: { files: 5, additions: 1287, deletions: 593 },
          countsUnavailable: false,
        };
        await ui.mockRpc({
          'git:turnChangeSets': { changeSets: [changeSet] },
          'git:info': {
            isGitRepo: true,
            branch: { branch: 'main', upstream: null, ahead: 0, behind: 0 },
            files: [
              { path: 'src/helpers.ts', status: 'M', staged: false },
              { path: 'src/helpers.spec.ts', status: '??', staged: false },
              { path: 'docs/removed.md', status: 'D', staged: false },
              { path: 'src/new-name.ts', status: 'R', staged: false },
              { path: LONG_PATH, status: 'M', staged: false },
            ],
          },
        });
        await setTheme(ui.page, theme);
        await prepareCanvasWithSessions(ui, [session], {
          supportsPaging: false,
        });
        await cap.step('card', async () => {
          await sessionRowButton(mainWindow, session.name).click();
          const card = mainWindow.locator('[data-testid="change-set-card"]');
          await expect(card).toBeVisible({ timeout: 30_000 });
          await waitSettled(mainWindow, 800);
          await cap.shot('chat-card-window');
          await cap.shot('chat-card', card);
          await card.locator('button').nth(1).focus();
          await mainWindow.keyboard.press('Tab');
          await cap.shot('chat-card-focus-row', card);
          await card.locator('[data-testid="change-set-review"]').focus();
          await mainWindow.keyboard.press('Shift+Tab');
          await mainWindow.keyboard.press('Tab');
          await cap.shot('chat-card-focus-review', card);
          await mainWindow.keyboard.press('Enter');
          await mainWindow.waitForTimeout(1500);
          await cap.shot('chat-card-after-review-click');
        });
        cap.finish();
        console.log(
          `[visual-review] card ${theme} done, issues: ${JSON.stringify(cap.issues)}`,
        );
      },
    );
  });
}
