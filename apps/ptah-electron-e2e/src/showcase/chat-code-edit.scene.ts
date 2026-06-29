import { test } from './_harness/showcase-fixtures';
import type { Director } from './_harness/director';
import type { Locator, Page } from '@playwright/test';

/**
 * P6.1 / P1.1 — "Fix / edit code in a single chat" (global Chat surface).
 *
 * The workflow money-shot: a real agent answers a question about THIS codebase
 * with genuine `file:line` references, then applies a small, safe edit and
 * renders the diff inline — no copy-paste, no browser round-trip. This is the
 * beat-for-beat of P1.1's "ask → answer with references → edit inline → see the
 * diff" arc, reused as P6.1's "fix end-to-end" use case. See
 * `docs/video-content-plan.md` (P1.1 beat-by-beat) for the narrative.
 *
 * Like every file in this folder this is a SCENE, not a test — it asserts
 * almost nothing and is tuned for how it reads on camera. Two real agent turns
 * run against the live authenticated workspace, so the footage is genuine.
 *
 * Prereqs (the launcher assumes these):
 * - `nx serve ptah-electron` has been run once so the default profile is
 *   authenticated and a real workspace is restored.
 * - No other Ptah instance is running (single-instance lock).
 * - The local docker backend is up — the agent answers against the real repo.
 *
 * Selector note: the only shell-navigation touch is `goToChat()`. Everything
 * else (`ptah-chat-input`, send / stop buttons) targets the chat surface itself
 * and is shared with the reference Canvas scene, so it stays in lock-step with
 * the app's stable test ids.
 */

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

/** Resilient send of a prompt into the global chat input + click send. */
async function sendChatPrompt(
  page: Page,
  director: Director,
  prompt: string,
): Promise<void> {
  const textarea = page
    .locator('ptah-chat-input textarea[role="combobox"]')
    .first();
  await textarea.waitFor({ state: 'visible' });
  await director.type(textarea, prompt);
  await director.click(page.locator('[data-testid="chat-send-btn"]').first());
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
 * so a sparse turn never stalls the scene — and all of it is read-only.
 */
async function exploreTransparency(
  page: Page,
  director: Director,
): Promise<void> {
  // Pan the conversation history so the camera sweeps the whole turn — text,
  // tool calls, and the rendered diff.
  const transcript = page.locator('[data-testid="chat-tool-output"]').first();
  if (await visible(transcript)) {
    await director.caption('Scroll back through the whole turn.');
    await director.scrollThrough(transcript, {
      steps: 6,
      dwellMs: 700,
      andBack: true,
    });
    await director.caption();
  }

  // Spotlight the per-message stats (tokens / cost / time) on the latest
  // assistant bubble — the heart of the "every turn is transparent" message.
  const assistantBubble = page
    .locator('ptah-message-bubble .chat-start')
    .last();
  const stats = assistantBubble.locator('ptah-session-stats-summary').first();
  if (await visible(stats)) {
    await director.caption('Tokens, cost, and time — on every single turn.');
    await director.spotlight(stats, 2000);
    await director.caption();
  }

  // Hover the per-message "Branch conversation" affordance — fork from any
  // point without losing the thread.
  const branch = assistantBubble
    .locator('[aria-label="Branch conversation from this message"]')
    .first();
  if (await visible(branch)) {
    await director.caption(
      'Branch from any message to explore an alternative.',
    );
    await director.hover(branch, 1100);
    await director.caption();
  }

  // Hover "Copy message" — one click to take the answer with you.
  const copy = assistantBubble.locator('[aria-label="Copy message"]').first();
  if (await visible(copy)) {
    await director.hover(copy, 900);
  }
}

/**
 * Open the per-session Agents panel via its vertical toggle tab, dwell so the
 * spawned-agent list is on camera, then close it again. Non-destructive:
 * toggling the panel never touches a running agent. Guards every step.
 */
async function showAgentsPanel(page: Page, director: Director): Promise<void> {
  const toggle = page.locator('[aria-label="Toggle Agents panel"]').first();
  if (!(await visible(toggle))) return;

  await director.caption('Every sub-agent it spawned is right here.');
  await director.click(toggle);
  await director.hold(1400);

  const panel = page.locator('ptah-agent-monitor-panel').first();
  if (await visible(panel)) {
    await director.spotlight(panel, 1600);
  }
  await director.caption();

  // Close it again — prefer the panel's own close affordance, fall back to the
  // toggle tab. Either way the agents keep running untouched.
  const closeBtn = page.locator('[title="Close panel"]').first();
  if (await visible(closeBtn)) {
    await director.click(closeBtn);
  } else if (await visible(toggle)) {
    await director.click(toggle);
  }
  await director.hold(700);
}

/**
 * Navigate to the global Chat surface. Try a few resilient affordances so the
 * scene survives minor nav-chrome changes; the `Chat` nav tab is the primary.
 */
async function goToChat(page: Page, director: Director): Promise<void> {
  const candidates: Locator[] = [
    page.getByRole('tab', { name: 'Chat' }),
    page.getByRole('button', { name: 'Chat' }),
    page.locator('[title="Chat"]'),
    page.locator('[aria-label="Chat"]'),
  ];
  for (const c of candidates) {
    if (
      await c
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      await director.click(c.first());
      break;
    }
  }
  // The chat input proves we landed on (or already had) the chat surface.
  await page
    .locator('ptah-chat-input textarea[role="combobox"]')
    .first()
    .waitFor({ state: 'visible' });
}

test('P6.1 — fix / edit code in a single chat', async ({ page, director }) => {
  // Clear any blocking startup modal (license / trial-ended dialog) before we
  // start filming — the persistent authed profile always shows it on launch.
  await director.dismissDialogs();

  await director.caption('Stop copy-pasting code into a chatbot.');
  await director.hold(1600);
  await director.caption();

  // Land on the global Chat surface, then clear any modal that the navigation
  // may have surfaced.
  await goToChat(page, director);
  await director.dismissDialogs();
  await director.hold();

  // Turn 1 — ask about the real codebase and prove workspace awareness.
  await director.caption('Ask about your own codebase…');
  await director.hold(900);
  await director.caption();

  await sendChatPrompt(page, director, ASK_PROMPT);
  await director.waitForAgentTurn();

  // Hold on the grounded answer so the file:line citations are readable.
  await director.caption('Real answers — with file:line references.');
  await director.hold(3200);
  await director.caption();

  // Pan back through the grounded answer so the citations + reasoning read on
  // camera before we ask for the edit.
  const firstAnswer = page.locator('[data-testid="chat-tool-output"]').first();
  if (await visible(firstAnswer)) {
    await director.scrollThrough(firstAnswer, {
      steps: 4,
      dwellMs: 650,
      andBack: true,
    });
  }

  // Turn 2 — a small, safe edit. Documentation only, no behavior change.
  await director.caption('Now ask it to make the change…');
  await director.hold(900);
  await director.caption();

  await sendChatPrompt(page, director, EDIT_PROMPT);
  await director.waitForAgentTurn();

  // Hold on the rendered diff — the inline edit is the payoff frame.
  await director.caption('It edits the file and shows you the diff.');
  await director.hold(3600);
  await director.caption();

  // ── Transparency coda ─────────────────────────────────────────────────────
  // The edit landed. Now show WHY you can trust it: every turn is transparent —
  // cost, tokens, tools, the agents it ran, all visible. Everything below is
  // read-only; we never undo the edit or touch a running agent.

  await director.caption('Every turn is transparent — nothing is hidden.');
  await director.hold(1400);
  await director.caption();

  // Pan the history, spotlight per-message stats, hover Branch + Copy.
  await exploreTransparency(page, director);

  // Open the Agents panel to reveal the sub-agents behind the work, then close.
  await showAgentsPanel(page, director);

  // Spotlight the model selector — you always know (and control) which model
  // answered. Targeted via the trigger button inside the model selector.
  const modelBtn = page.locator('ptah-model-selector button[trigger]').first();
  if (await visible(modelBtn)) {
    await director.caption('And you always know which model is answering.');
    await director.spotlight(modelBtn, 1800);
    await director.caption();
  }

  await director.caption('No copy-paste. It sees your code, edits your files.');
  await director.hold(2600);
  await director.caption();
});
