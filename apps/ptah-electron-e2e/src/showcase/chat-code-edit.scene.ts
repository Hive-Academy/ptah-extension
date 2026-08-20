import { test } from './_harness/showcase-fixtures';
import type { Director } from './_harness/director';
import type { Locator, Page } from '@playwright/test';

/**
 * P6.1 / P1.1 — "Fix / edit code in a single chat" (a single Canvas tile).
 *
 * The workflow money-shot: a real agent answers a question about THIS codebase
 * with genuine `file:line` references, then applies a small, safe edit and
 * renders the diff inline — no copy-paste, no browser round-trip. This is the
 * beat-for-beat of P1.1's "ask → answer with references → edit inline → see the
 * diff" arc, reused as P6.1's "fix end-to-end" use case. See
 * `docs/video-content-plan.md` (P1.1 beat-by-beat) for the narrative.
 *
 * The Electron app has a single chat surface: the Orchestra Canvas. There is no
 * separate global "Chat" tab — a single canvas tile IS the single-chat
 * experience, so this scene opens exactly one tile and drives the whole
 * ask → edit arc inside it. (The multi-tile flagship is `canvas-orchestra`.)
 *
 * Like every file in this folder this is a SCENE, not a test — it asserts
 * almost nothing and is tuned for how it reads on camera. Two real agent turns
 * run against the live authenticated workspace, so the footage is genuine.
 *
 * AUDIO-FIRST: the voiceover script lives in `scripts/chat-code-edit.json`
 * and is narrated by `narrate.mjs` BEFORE capture. Each `director.say(i)`
 * speaks line i, holding for the REAL clip duration (durations.json) so
 * narration, captions and footage stay locked — no estimated holds, no silent
 * gaps. Element-targeted says + spotlight/hover auto-emit `shots.json`,
 * punching the camera onto each subject as the VO names it.
 *
 * Prereqs (the launcher assumes these):
 * - `nx serve ptah-electron` has been run once so the default profile is
 *   authenticated and a real workspace is restored.
 * - No other Ptah instance is running (single-instance lock).
 * - The local docker backend is up — the agent answers against the real repo.
 *
 * Selector note: the only shell-navigation touch is `goToCanvas()` + the tile
 * we open in `openSingleTile()`. Everything else (`ptah-chat-input`, send / stop
 * buttons, stats, model selector) is scoped to that one tile and shared with the
 * reference Canvas scene, so it stays in lock-step with the app's stable ids.
 */

/** Header label for the tile this scene creates (also used for cleanup). */
const TILE_LABEL = 'code-edit';

/**
 * Turn 1 — a workspace-awareness question. Phrased to nudge the agent toward
 * concrete `file:line` citations so the answer is visibly grounded in the real
 * repo (not generic LLM knowledge). Override via `PTAH_SHOWCASE_CHAT_PROMPT`.
 */
const ASK_PROMPT =
  process.env['PTAH_SHOWCASE_CHAT_PROMPT'] ??
  'Where is RPC method-prefix authorization enforced in this codebase? ' +
    'Answer concisely with file:line references to the exact guard.';

/**
 * Turn 2 — a small, strictly non-destructive follow-up: document, don't change
 * behavior. Asking for the diff makes the inline-edit payoff visible on screen.
 * Override via `PTAH_SHOWCASE_EDIT_PROMPT`.
 */
const EDIT_PROMPT =
  process.env['PTAH_SHOWCASE_EDIT_PROMPT'] ??
  'Add a concise JSDoc comment to that function explaining what it guards ' +
    'against — documentation only, no behavior change — then show me the diff.';

/** Resilient send of a prompt into a tile's chat input + click its send button. */
async function sendChatPrompt(
  director: Director,
  tile: Locator,
  prompt: string,
): Promise<void> {
  const textarea = tile
    .locator('ptah-chat-input textarea[role="combobox"]')
    .first();
  await textarea.waitFor({ state: 'visible' });
  await director.type(textarea, prompt);
  await director.click(tile.locator('[data-testid="chat-send-btn"]').first());
}

/** True if a locator is present and visible (never throws). */
async function visible(loc: Locator): Promise<boolean> {
  return loc
    .first()
    .isVisible()
    .catch(() => false);
}

/**
 * Reveal the transparency surfaces hanging off an assistant message: pan the
 * transcript, spotlight the per-message stats strip, then hover the
 * "Branch conversation" and "Copy message" affordances. Every beat is guarded
 * so a sparse turn never stalls the scene — and all of it is read-only. Scoped
 * to the single tile so restored canvas tiles never shift the targets.
 */
async function exploreTransparency(
  director: Director,
  tile: Locator,
): Promise<void> {
  // Pan the conversation history so the camera sweeps the whole turn — text,
  // tool calls, and the rendered diff.
  const transcript = tile.locator('[data-testid="chat-tool-output"]').first();
  if (await visible(transcript)) {
    // scrollThrough (6 steps × 700ms, down and back) plays under the VO.
    await director.say(0, {
      target: transcript,
      during: async () => {
        await director.scrollThrough(transcript, {
          steps: 6,
          dwellMs: 700,
          andBack: true,
        });
      },
    });
  }

  // Spotlight the per-message stats (tokens / cost / time) on the latest
  // assistant bubble — the heart of the "every turn is transparent" message.
  const assistantBubble = tile
    .locator('ptah-message-bubble .chat-start')
    .last();
  const stats = assistantBubble.locator('ptah-session-stats-summary').first();
  if (await visible(stats)) {
    await director.say(1, {
      target: stats,
      during: async () => {
        await director.spotlight(stats, 2000);
      },
    });
  }

  // Hover the per-message "Branch conversation" affordance — fork from any
  // point without losing the thread.
  const branch = assistantBubble
    .locator('[aria-label="Branch conversation from this message"]')
    .first();
  if (await visible(branch)) {
    await director.say(2, {
      target: branch,
      during: async () => {
        await director.hover(branch, 1100);
      },
    });
  }

  // Hover "Copy message" — one click to take the answer with you.
  const copy = assistantBubble.locator('[aria-label="Copy message"]').first();
  if (await visible(copy)) {
    await director.hover(copy, 900);
  }
}

/**
 * Surface the agents behind the work via the tile's own agent indicator — the
 * pulsing status pill that reveals the sub-agents this turn spawned. Guarded so
 * a turn that ran no sub-agents never stalls the scene. Strictly read-only.
 */
async function showTileAgents(
  director: Director,
  tile: Locator,
): Promise<void> {
  const indicator = tile.locator('ptah-tile-agent-indicator button').first();
  if (!(await visible(indicator))) return;

  // Narration plays while the indicator is spotlit + hovered — the mini panel
  // (if the tile expands one) rides along under the VO.
  await director.say(3, {
    target: indicator,
    during: async () => {
      await director.spotlight(indicator, 1600);
      await director.hover(indicator, 1100);
    },
  });
}

async function goToCanvas(page: Page, director: Director): Promise<void> {
  // The Canvas (grid) layout is the Electron chat surface. Try a few resilient
  // selectors so the scene survives minor nav-chrome changes.
  const candidates: Locator[] = [
    page.getByRole('tab', { name: 'Canvas' }),
    page.getByRole('button', { name: 'Canvas' }),
    page.locator('[title="Orchestra Canvas"]'),
    page.locator('[title="Canvas"]'),
    page.locator('[aria-label="Canvas"]'),
  ];
  for (const c of candidates) {
    if (await visible(c)) {
      await director.click(c.first());
      break;
    }
  }
  await page
    .locator('[data-testid="canvas-grid"]')
    .waitFor({ state: 'visible' });
}

/**
 * Close tiles left behind by previous captures whose header matches our own
 * label. Canvas state persists in the profile, so each run's tile survives into
 * the next — cluttering the frame and eventually hitting the 9-tile cap, which
 * makes tile creation fail. Only touches OUR artifacts; other tiles are left
 * alone. Runs before the hook beat, so the lead-in trim keeps it out of the cut.
 */
async function closeStaleTiles(page: Page, director: Director): Promise<void> {
  for (let i = 0; i < 9; i++) {
    const stale = page
      .locator('[data-testid="canvas-tile"]')
      .filter({
        has: page.locator('.tile-header span', { hasText: TILE_LABEL }),
      })
      .first();
    if (!(await visible(stale))) return;
    const close = stale.locator('[title="Close tile"]').first();
    if (!(await visible(close))) return;
    await close.click({ timeout: 5_000 }).catch(() => undefined);
    await director.hold(400);
  }
}

/**
 * Open exactly one canvas tile and return its locator. The "add tile" affordance
 * depends on whether the canvas is empty: the FAB ("Add new session tile") when
 * tiles exist, the empty-state CTA otherwise.
 */
async function openSingleTile(
  page: Page,
  director: Director,
): Promise<Locator> {
  const tiles = page.locator('[data-testid="canvas-tile"]');
  const startCount = await tiles.count();

  const fab = page.locator('[title="Add new session tile"]').first();
  if (await visible(fab)) {
    await director.click(fab);
  } else {
    await director.click(
      page.getByRole('button', { name: 'Create new session' }).first(),
    );
  }

  const nameInput = page.locator('input[placeholder*="session name" i]').last();
  await director.type(nameInput, TILE_LABEL);
  await director.click(
    page.getByRole('button', { name: 'Create', exact: true }),
  );

  const tile = tiles.nth(startCount);
  await tile.waitFor({ state: 'visible' });
  await tile
    .locator('ptah-chat-input textarea[role="combobox"]')
    .first()
    .waitFor({ state: 'visible' });
  return tile;
}

test('P6.1 — fix / edit code in a single chat', async ({ page, director }) => {
  // Navigate + set up BEFORE the first beat: land on the Canvas and open a
  // single tile (the subject surface) so the hook airs over a live chat rather
  // than the stale restored boot surface. Everything until the hook is trimmed
  // by render-all's lead-in trim, so this setup never airs. This scene appends
  // its two real turns into that one tile's conversation.
  await goToCanvas(page, director);
  await closeStaleTiles(page, director);
  const tile = await openSingleTile(page, director);
  await director.hold();

  // HOOK — fire immediately so the video opens on a question, not dead air.
  await director.say(4);

  // WARMUP — one line of context before the workflow starts.
  await director.say(5);

  // Turn 1 — ask about the real codebase and prove workspace awareness.
  await director.say(6);

  // The send + agent turn run under the VO.
  await director.say(7, {
    during: async () => {
      await sendChatPrompt(director, tile, ASK_PROMPT);
      await director.waitForAgentTurn(tile);
    },
  });

  // Hold on the grounded answer so the file:line citations are readable.
  await director.say(8);

  // Pan back through the grounded answer so the citations + reasoning read on
  // camera before we ask for the edit.
  const firstAnswer = tile.locator('[data-testid="chat-tool-output"]').first();
  if (await visible(firstAnswer)) {
    await director.scrollThrough(firstAnswer, {
      steps: 4,
      dwellMs: 650,
      andBack: true,
    });
  }

  // Turn 2 — a small, safe edit. Documentation only, no behavior change.
  await director.say(9);

  // The send + agent turn run under the VO.
  await director.say(10, {
    during: async () => {
      await sendChatPrompt(director, tile, EDIT_PROMPT);
      await director.waitForAgentTurn(tile);
    },
  });

  // Hold on the rendered diff — the inline edit is the payoff frame.
  await director.say(11);

  // ── Transparency coda ─────────────────────────────────────────────────────
  // The edit landed. Now show WHY you can trust it: every turn is transparent —
  // cost, tokens, tools, the agents it ran, all visible. Everything below is
  // read-only; we never undo the edit or touch a running agent.

  await director.say(12);

  // Pan the history, spotlight per-message stats, hover Branch + Copy.
  await exploreTransparency(director, tile);

  // Surface the sub-agents behind the work via the tile's agent indicator.
  await showTileAgents(director, tile);

  // Spotlight the model selector — you always know (and control) which model
  // answered. Targeted via the trigger button inside the model selector.
  const modelBtn = tile.locator('ptah-model-selector button[trigger]').first();
  if (await visible(modelBtn)) {
    await director.say(13, {
      target: modelBtn,
      during: async () => {
        await director.spotlight(modelBtn, 1800);
      },
    });
  }

  await director.say(14);
});
