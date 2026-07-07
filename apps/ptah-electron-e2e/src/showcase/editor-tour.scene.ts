import { test } from './_harness/showcase-fixtures';
import type { Director } from './_harness/director';
import type { Locator, Page } from '@playwright/test';
import { prewarmEditor } from './_harness/prewarm';

/**
 * SHOWCASE — "A real editor, built in" (Monaco + terminal tour).
 *
 * Shows Ptah's integrated editor surface as a marketing beat: the file-tree
 * explorer, a real file opened into Monaco, smooth code scrolling, and the
 * integrated xterm.js terminal panel. This is a SCENE, not a test — it asserts
 * almost nothing, runs NO agents, and is tuned for camera: eased pointer
 * travel, lower-third captions, spotlights, and generous dwell.
 *
 * AUDIO-FIRST: the voiceover script lives in `scripts/editor-tour.json` and is
 * narrated by `narrate.mjs` BEFORE capture. Each `director.say(i)` speaks line
 * i, holding for the REAL clip duration (durations.json) so narration, captions
 * and footage stay locked — no estimated holds, no silent gaps. Element-
 * targeted says + spotlight/hover auto-emit `shots.json`, punching the camera
 * onto each subject as the VO names it.
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

  // PRE-WARM (kept — trimmed lead-in, before the first beat): the editor panel's
  // Monaco host is the worst mid-scene stall (~31s first-mount). Force it to
  // mount now — open the panel, open a leaf file, then close the panel — so the
  // mid-body `openAFile` (which opens the REAL subject file) hits a warm Monaco
  // and no longer freezes the frame between beats. The navigation below only
  // re-opens the panel; it does NOT open a file, so this prewarm of the Monaco
  // runtime stays load-bearing. Silent + fully guarded (see prewarm.ts).
  await prewarmEditor(page).catch(() => undefined);

  // Navigate + settle BEFORE the first beat: open the editor panel (the subject
  // surface) so the hook lands on it instead of the stale restored surface.
  // Trimmed by render-all's lead-in trim, so the panel toggle never airs.
  const panel = await openEditorPanel(page, director);
  await director.dismissDialogs();
  await director.hold();

  // HOOK — fire immediately so the video opens on a question, not dead air.
  await director.say(0);

  // WARMUP — one line of context before the tour starts.
  await director.say(1);

  if (!(await isVisible(panel))) {
    // Nothing mounted — bail gracefully with a closing beat rather than throw.
    await director.say(2);
    return;
  }

  // The file-tree explorer.
  const fileTree = page
    .locator('ptah-file-tree [role="tree"][aria-label="File Explorer"]')
    .or(page.locator('ptah-file-tree'))
    .first();
  if (await isVisible(fileTree)) {
    await director.say(3, {
      target: fileTree,
      during: async () => {
        await director.hover(fileTree, 700);
        await director.spotlight(fileTree, 1800);
      },
    });
  }

  // Open a real file into Monaco while the narration plays over the clicks.
  let opened = false;
  await director.say(4, {
    during: async () => {
      opened = await openAFile(page, director);
    },
  });

  if (opened) {
    const monacoHost = page.locator('[data-testid="editor-monaco"]').first();
    await director.say(5, {
      target: monacoHost,
      during: async () => {
        await director.spotlight(monacoHost, 1800);
      },
    });

    // Scroll through the code so the camera reveals real content.
    const scroller = page
      .locator('[data-testid="editor-monaco"] .monaco-scrollable-element')
      .or(monacoHost)
      .first();
    await director.say(6, {
      during: async () => {
        await director.scrollThrough(scroller, {
          steps: 6,
          dwellMs: 650,
          andBack: true,
        });
      },
    });
  } else {
    // File-tree fetch raced or the workspace had no reachable leaf — show what
    // is visible and continue.
    await director.say(7, {
      during: async () => {
        await director.scrollThrough(fileTree, { steps: 4, dwellMs: 600 });
      },
    });
  }

  // Reveal the integrated terminal (xterm.js) via the toolbar toggle.
  const terminalToggle = page
    .locator('[data-testid="editor-terminal-toggle"]')
    .first();
  if (await isVisible(terminalToggle)) {
    await director.say(8, {
      target: terminalToggle,
      during: async () => {
        await director.spotlight(terminalToggle, 1200);
        await director.click(terminalToggle);
        await director.hold(900);
      },
    });

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

      await director.say(9, {
        target: terminalPanel,
        during: async () => {
          await director.hover(terminalPanel, 600);
          await director.spotlight(terminalPanel, 2000);
        },
      });
    }
  }

  await director.say(10, { breathMs: 950 });
});
