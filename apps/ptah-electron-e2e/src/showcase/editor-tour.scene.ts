import { test } from './_harness/showcase-fixtures';
import type { Director } from './_harness/director';
import type { Locator, Page } from '@playwright/test';

/**
 * SHOWCASE — "A real editor, built in" (Monaco + terminal tour).
 *
 * Shows Ptah's integrated editor surface as a marketing beat: the file-tree
 * explorer, a real file opened into Monaco, smooth code scrolling, and the
 * integrated xterm.js terminal panel. This is a SCENE, not a test — it asserts
 * almost nothing, runs NO agents, and is tuned for camera: eased pointer
 * travel, lower-third captions, spotlights, and generous dwell.
 *
 * Captions double as the VOICEOVER SCRIPT (`narrate.mjs --source beats`), so
 * they are written as spoken prose and caption-only beats hold via `voHold`
 * (~65ms/char) so narration finishes before the next beat. Element-targeted
 * captions + spotlight/hover auto-emit `shots.json`, punching the camera onto
 * each subject as the VO names it.
 *
 * Strictly NON-DESTRUCTIVE: it toggles the panel, expands the tree, OPENS and
 * SCROLLS a file, and reveals (but does not type into) the terminal. It never
 * edits, saves, or runs a command — opening and scrolling only.
 *
 * Prereqs (the launcher assumes these):
 * - `nx serve ptah-electron` has been run once so the default profile is
 *   authenticated and a real workspace with files is restored.
 * - No other Ptah instance is running (single-instance lock).
 *
 * The editor is a TOGGLE, not a nav tab: `button[aria-label="Toggle Editor
 * panel"]` mounts `ptah-editor-panel` lazily, and its file-tree fetch can race
 * — every interaction below is guarded and degrades gracefully.
 *
 * Override which file to open via `PTAH_SHOWCASE_EDITOR_FILE` (a substring
 * matched against file-tree node labels, e.g. "package.json" or "main.ts").
 * When unset (or not found) the tour opens the first leaf file it can reach.
 */

const PREFERRED_FILE = process.env['PTAH_SHOWCASE_EDITOR_FILE'] ?? '';

/**
 * Hold long enough for the narration of `text` to finish before the next beat
 * starts (~65ms/char + settle), minus time already spent in interactions that
 * run between this beat and the next. Captions double as the VO script
 * (`narrate.mjs --source beats`), so this prevents audio overlap.
 */
function voHold(text: string, alreadySpentMs = 0): number {
  return Math.max(600, Math.round(text.length * 65) + 500 - alreadySpentMs);
}

async function isVisible(loc: Locator): Promise<boolean> {
  return loc
    .first()
    .isVisible()
    .catch(() => false);
}

/** Open the editor panel via the toggle (if not already mounted) and wait. */
async function openEditorPanel(
  page: Page,
  director: Director,
): Promise<Locator> {
  const panel = page.locator('ptah-editor-panel').first();
  if (!(await isVisible(panel))) {
    const toggle = page
      .getByRole('button', { name: 'Toggle Editor panel' })
      .or(page.locator('[aria-label="Toggle Editor panel"]'))
      .first();
    if (await isVisible(toggle)) {
      await director.click(toggle);
    }
  }
  // The panel mounts lazily; give the file-tree fetch room to settle.
  await panel
    .waitFor({ state: 'visible', timeout: 20_000 })
    .catch(() => undefined);
  return panel;
}

/**
 * Open a real file into Monaco. Directory nodes carry `aria-expanded`; file
 * (leaf) nodes do not. We expand a directory or two to surface leaves, prefer a
 * node matching `PREFERRED_FILE`, else take the first reachable leaf. Returns
 * true if a file was opened (Monaco mounted).
 */
async function openAFile(page: Page, director: Director): Promise<boolean> {
  const leafNodes = page.locator(
    '[data-testid="editor-file-node"]:not([aria-expanded])',
  );
  const dirNodes = page.locator(
    '[data-testid="editor-file-node"][aria-expanded="false"]',
  );

  // Preferred file by label substring (it may already be visible at root).
  if (PREFERRED_FILE) {
    const preferred = leafNodes.filter({ hasText: PREFERRED_FILE }).first();
    if (await isVisible(preferred)) {
      await director.click(preferred);
      return monacoMounted(page);
    }
  }

  // Try an already-visible leaf first.
  if ((await leafNodes.count()) > 0 && (await isVisible(leafNodes.first()))) {
    await director.click(leafNodes.first());
    if (await monacoMounted(page)) return true;
  }

  // Otherwise expand up to a couple of directories to reveal leaves.
  for (let depth = 0; depth < 3; depth++) {
    const dir = dirNodes.first();
    if (!(await isVisible(dir))) break;
    await director.click(dir);
    await director.hold(700);

    const preferred = PREFERRED_FILE
      ? leafNodes.filter({ hasText: PREFERRED_FILE }).first()
      : leafNodes.first();
    const target = (await isVisible(preferred)) ? preferred : leafNodes.first();
    if (await isVisible(target)) {
      await director.click(target);
      if (await monacoMounted(page)) return true;
    }
  }

  return false;
}

/** Wait for the Monaco editor host + instance to mount. */
async function monacoMounted(page: Page): Promise<boolean> {
  const monacoHost = page.locator('[data-testid="editor-monaco"]').first();
  const monacoInstance = page.locator('.monaco-editor').first();
  await monacoHost
    .waitFor({ state: 'visible', timeout: 8_000 })
    .catch(() => undefined);
  await monacoInstance
    .waitFor({ state: 'visible', timeout: 8_000 })
    .catch(() => undefined);
  return isVisible(monacoInstance);
}

test('SHOWCASE — editor tour (Monaco + terminal)', async ({
  page,
  director,
}) => {
  await director.dismissDialogs();

  // HOOK — fire immediately so the video opens on a question, not dead air.
  const HOOK =
    'Your AI agents write code all day. But where do you actually read it?';
  await director.caption(HOOK);
  await director.hold(voHold(HOOK));
  await director.caption();

  // WARMUP — one line of context before the tour starts.
  const WARMUP =
    'This is Ptah — an AI coding workspace. And it ships with a real editor, built right in. Let me show you.';
  await director.caption(WARMUP);
  await director.hold(voHold(WARMUP));
  await director.caption();

  const panel = await openEditorPanel(page, director);
  await director.dismissDialogs();
  await director.hold();

  if (!(await isVisible(panel))) {
    // Nothing mounted — bail gracefully with a closing beat rather than throw.
    const FALLBACK =
      'Monaco, the file tree, and an integrated terminal — all together in one place.';
    await director.caption(FALLBACK);
    await director.hold(voHold(FALLBACK));
    await director.caption();
    return;
  }

  // The file-tree explorer.
  const fileTree = page
    .locator('ptah-file-tree [role="tree"][aria-label="File Explorer"]')
    .or(page.locator('ptah-file-tree'))
    .first();
  if (await isVisible(fileTree)) {
    const TREE =
      'Here is your whole project, in a file tree you already know how to use.';
    await director.caption(TREE, fileTree);
    await director.hover(fileTree, 700);
    await director.spotlight(fileTree, 1800);
    // hover(700) + spotlight(1800 + 180 settle) already spent ~2.7s of VO time.
    await director.hold(voHold(TREE, 2680));
    await director.caption();
  }

  // Open a real file into Monaco. The openAFile expand/click loop covers the
  // narration, so the caption plays fully during it (no explicit voHold needed).
  await director.caption('Click any file, and it opens straight into Monaco.');
  const opened = await openAFile(page, director);
  await director.caption();

  if (opened) {
    const monacoHost = page.locator('[data-testid="editor-monaco"]').first();
    const MONACO =
      'Monaco is the same engine that powers VS Code — so this is not a preview pane. It is the real thing.';
    await director.caption(MONACO, monacoHost);
    // Hold covers the VO, minus the spotlight (1800 + 180 settle) that follows.
    await director.hold(voHold(MONACO, 1980));
    await director.spotlight(monacoHost, 1800);
    await director.caption();

    // Scroll through the code so the camera reveals real content. The scroll
    // (6 steps × 650ms × down-and-back) outlasts the narration, so the caption
    // plays fully during it (no explicit voHold needed).
    const scroller = page
      .locator('[data-testid="editor-monaco"] .monaco-scrollable-element')
      .or(monacoHost)
      .first();
    await director.caption(
      'Real source, real highlighting — right where your agents do their work.',
    );
    await director.scrollThrough(scroller, {
      steps: 6,
      dwellMs: 650,
      andBack: true,
    });
    await director.caption();
  } else {
    // File-tree fetch raced or the workspace had no reachable leaf — show what
    // is visible and continue. The scroll covers the narration.
    await director.caption('Browse your whole workspace, right from the tree.');
    await director.scrollThrough(fileTree, { steps: 4, dwellMs: 600 });
    await director.caption();
  }

  // Reveal the integrated terminal (xterm.js) via the toolbar toggle.
  const terminalToggle = page
    .locator('[data-testid="editor-terminal-toggle"]')
    .first();
  if (await isVisible(terminalToggle)) {
    // The spotlight + click + reveal cover the narration, so the caption plays
    // fully during them (no explicit voHold needed).
    await director.caption(
      'Need to run something? There is a full terminal built in too.',
      terminalToggle,
    );
    await director.spotlight(terminalToggle, 1200);
    await director.click(terminalToggle);
    await director.hold(900);
    await director.caption();

    const terminalPanel = page.locator('ptah-terminal-panel').first();
    if (await isVisible(terminalPanel)) {
      // Open a fresh terminal tab so xterm renders (non-destructive — we never
      // type a command into it).
      const newTerminal = page
        .getByRole('button', { name: 'New Terminal' })
        .or(page.locator('[aria-label="New Terminal"]'))
        .or(page.locator('[title="New Terminal"]'))
        .first();
      if (await isVisible(newTerminal)) {
        await director.click(newTerminal);
        await director.hold(1200);
      }

      const SHELL =
        'A real shell, living right beside your code — no window-hopping, no context lost.';
      await director.caption(SHELL, terminalPanel);
      await director.hover(terminalPanel, 600);
      await director.spotlight(terminalPanel, 2000);
      // hover(600) + spotlight(2000 + 180 settle) already spent ~2.8s of VO time.
      await director.hold(voHold(SHELL, 2780));
      await director.caption();
    }
  }

  const OUTRO =
    'Read it, browse it, run it — your code and your agents, finally in one place. That is Ptah.';
  await director.caption(OUTRO);
  await director.hold(voHold(OUTRO) + 600);
  await director.caption();
});
