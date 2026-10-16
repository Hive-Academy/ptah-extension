import { test, expect } from '../../support/fixtures';
import type { UiDriver } from '../../support/ui-driver';

/**
 * Workflow-tab prompt routing (TASK_2026_317).
 *
 * `new-project.spec.ts` covers a question after the SDK binds its session id.
 * These scenarios cover the earlier question addressed only to the new
 * workflow tab's correlation id and isolation from a different chat tab.
 *
 * Test 1 leaves a canvas tile open, so there is a stranger's tile for a
 * misrouted card. Test 2 covers the third defect in the same task — a
 * stale private view mirror inside the old `WebviewNavigationService` made
 * "Resume New Project" report success and navigate nowhere. That service is
 * deleted (TASK_2026_524 batch 1) and the Router is now the single owner of
 * the surface, so the mirror cannot come back; this test stays as the
 * regression gate on the behaviour.
 *
 * DELIBERATELY NOT COVERED HERE: the second defect, `NoActivityWatchdog`
 * aborting a turn parked on `canUseTool`. Its trigger is a 180 s silence and
 * this project's per-test timeout is 60 s (`playwright.config.ts`), so an
 * honest e2e for it would have to fake the clock inside the main process —
 * which tests the fake, not the watchdog. It is pinned by
 * `no-activity-watchdog.spec.ts` (`hold` / `release` / `isHeld`) and by
 * `sdk-query-options-builder.spec.ts`, where the `canUseTool` wrapper's
 * hold/finally-release is asserted directly.
 *
 * Same mocked-RPC + pushed-renderer-message technique as `new-project.spec.ts`
 * and `harness-builder.spec.ts` — no real backend or SDK.
 */

const SEED_PROMPT = 'AGENT_INSTRUCTIONS:: discovery for: a route-planning app.';

const INTAKE = {
  what: 'A route-planning app for delivery drivers.',
  audience: 'b2b',
  stack: 'recommend',
} as const;

/** A real SDK session id — deliberately NEVER bound in these specs. */
const UNRELATED_SESSION_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

const QUESTION_ID = '1f3a5c7e-9b2d-4e6f-8a1c-3d5e7f9a1b3c';

/**
 * The `chat:start` this workflow makes, identified by its seed prompt rather
 * than by being the most recent call. Test 1 opens a canvas tile first, and
 * `UiDriver.waitForObservedCall` returns the LAST call as soon as ANY exists —
 * so a tile that starts a chat of its own would satisfy it and hand back the
 * wrong `tabId`.
 */
async function waitForWorkflowStart(
  ui: UiDriver,
  timeoutMs = 10_000,
): Promise<{ tabId: string; prompt: string }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const calls = await ui.getObservedCalls('chat:start');
    const workflowCall = calls
      .map((c) => c.params as { tabId: string; prompt: string })
      .find((p) => p?.prompt?.includes(SEED_PROMPT));
    if (workflowCall) return workflowCall;
    if (Date.now() > deadline) {
      throw new Error(
        `[TASK_2026_317] No workflow chat:start within ${timeoutMs}ms ` +
          `(saw ${calls.length} chat:start call(s))`,
      );
    }
    await ui.page.waitForTimeout(50);
  }
}

/** Opens the New Project workflow and returns its correlation id. */
async function openWorkflow(ui: UiDriver): Promise<string> {
  await ui.mockRpc({
    'harness:start-new-project': {
      success: true,
      seedPrompt: SEED_PROMPT,
      intake: INTAKE,
      plugins: {
        enabledBundled: [],
        missingExternal: [],
        availableSkillIds: [],
      },
    },
    'chat:start': { success: true },
  });
  await ui.pushEvent({
    type: 'harness:open-workflow',
    payload: { mode: 'new-project', seedPrompt: SEED_PROMPT, intake: INTAKE },
  });

  await expect(ui.page.locator('ptah-harness-builder-view')).toBeVisible();

  const { tabId } = await waitForWorkflowStart(ui);
  expect(tabId).toBeTruthy();
  await expect(
    ui.page.locator(
      `ptah-harness-builder-view ptah-chat-transcript[data-tab-id="${tabId}"]`,
    ),
  ).toBeVisible();
  return tabId;
}

// `SetupHubComponent` reads `presets().length` unguarded — see the note in
// `new-project.spec.ts`. Mock it so these tests exercise routing, not that.
test.beforeEach(async ({ ui }) => {
  await ui.mockRpc({ 'harness:load-presets': { presets: [] } });
});

test.describe('Surface workflow question routing (TASK_2026_317)', () => {
  test('a question carrying only the correlation id renders on the workflow surface, not on an open canvas tile', async ({
    ui,
  }) => {
    // Give the bug somewhere to go wrong. Without an open tile, "the card
    // landed on a stranger's tile" has no stranger and the test would pass
    // against the broken build too.
    await ui.goto('chat');
    await ui.page.locator('[data-testid="canvas-new-session-anchor"]').click();
    await ui.page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(
      ui.page.locator('ptah-canvas-rail [data-rail-card]'),
    ).toHaveCount(1);

    const correlationId = await openWorkflow(ui);

    // The unbound case: no `chat:chunk` has arrived, so no real session id is
    // bound to this surface. The backend puts the correlation id on BOTH
    // fields, which is the whole defect.
    await ui.pushEvent({
      type: 'ask-user-question:request',
      payload: {
        id: QUESTION_ID,
        toolName: 'AskUserQuestion',
        questions: [
          {
            question: 'Which platform should we target first?',
            header: 'Platform',
            options: [
              { label: 'Web', description: 'Browser first' },
              { label: 'Mobile', description: 'iOS and Android first' },
            ],
            multiSelect: false,
          },
        ],
        toolUseId: 'tu-317',
        timestamp: Date.now(),
        timeoutAt: 0,
        sessionId: correlationId,
        tabId: correlationId,
        surfaceMode: false,
      },
    });

    const card = ui.page.locator(
      'ptah-harness-builder-view ptah-question-card',
    );
    await expect(card).toBeVisible();

    // The load-bearing assertion. One card exists in the whole app and it is
    // the one inside the workflow panel — so the canvas tile's "show it on the
    // active tile" fallback stood down rather than painting a second copy on
    // an unrelated session.
    await expect(ui.page.locator('ptah-question-card')).toHaveCount(1);

    await card.locator('label', { hasText: 'Mobile' }).click();
    await card.getByRole('button', { name: 'Submit' }).click();

    const response = await ui.waitForObservedMessage(
      'ask-user-question:response',
    );
    expect(response.payload).toEqual({
      id: QUESTION_ID,
      answers: { 'Which platform should we target first?': 'Mobile' },
    });
  });

  test('a question for a session this surface never claimed does not steal the workflow panel', async ({
    ui,
  }) => {
    await ui.goto('chat');
    await ui.page.locator('[data-testid="canvas-new-session-anchor"]').click();
    await ui.page.getByRole('button', { name: 'Create', exact: true }).click();
    const foreignTabId = await ui.page
      .locator('ptah-canvas-rail [data-rail-card]')
      .first()
      .getAttribute('data-tab-id');
    if (!foreignTabId) throw new Error('Canvas tab has no data-tab-id');
    // A session:id-resolved message updates TabState, but the stream router
    // learns the session-to-conversation binding from a stream event.
    await ui.pushEvent({
      type: 'chat:chunk',
      payload: {
        tabId: foreignTabId,
        sessionId: UNRELATED_SESSION_ID,
        surfaceMode: false,
        event: {
          id: 'evt-foreign-1',
          eventType: 'message_start',
          timestamp: Date.now(),
          sessionId: UNRELATED_SESSION_ID,
          messageId: 'msg-foreign-1',
          role: 'assistant',
        },
      },
    });
    await ui.pushEvent({
      type: 'session:id-resolved',
      payload: { tabId: foreignTabId, realSessionId: UNRELATED_SESSION_ID },
    });
    const correlationId = await openWorkflow(ui);
    expect(correlationId).not.toBe(UNRELATED_SESSION_ID);

    await ui.pushEvent({
      type: 'ask-user-question:request',
      payload: {
        id: QUESTION_ID,
        toolName: 'AskUserQuestion',
        questions: [
          {
            question: 'Unrelated session question',
            header: 'Other',
            options: [
              { label: 'A', description: 'first' },
              { label: 'B', description: 'second' },
            ],
            multiSelect: false,
          },
        ],
        toolUseId: 'tu-other',
        timestamp: Date.now(),
        timeoutAt: 0,
        sessionId: UNRELATED_SESSION_ID,
        tabId: foreignTabId,
        surfaceMode: false,
      },
    });

    // The foreign SDK session is bound to another normal chat tab, so its
    // question must stay off the workflow tab and remain available there.
    await expect(
      ui.page.locator('ptah-harness-builder-view ptah-question-card'),
    ).toHaveCount(0);
    await ui.goto('chat');
    await ui.page
      .locator(
        `ptah-canvas-rail [data-rail-card][data-tab-id="${foreignTabId}"]`,
      )
      .click();
    await expect(
      ui.page.locator(
        `ptah-chat-view:has(ptah-chat-transcript[data-tab-id="${foreignTabId}"]) ptah-question-card`,
      ),
    ).toBeVisible();
  });
});

test.describe('New Project resume navigation (TASK_2026_317)', () => {
  test('Resume New Project actually navigates back to the workflow after a direct view switch', async ({
    ui,
  }) => {
    const tabId = await openWorkflow(ui);

    // `UiDriver.goto` pushes a `switchView` message. That path used to leave
    // the old navigation service's private view mirror stale, so its later
    // `navigateToView` short-circuited against a view the app had already
    // left. `switchView` still works exactly the same way over the wire —
    // only its receiver changed (TASK_2026_524 batch 1).
    await ui.goto('setup-hub');

    const resume = ui.page.locator('[data-testid="new-project-resume"]');
    await expect(resume).toBeVisible();
    await resume.click();

    await expect(
      ui.page.locator(
        `ptah-harness-builder-view ptah-chat-transcript[data-tab-id="${tabId}"]`,
      ),
    ).toBeVisible();

    // Resuming must re-enter the SAME run. A second `chat:start` would mean
    // the click started a new agent session instead of navigating back.
    const starts = await ui.getObservedCalls('chat:start');
    expect(
      starts.filter((c) => (c.params as { tabId?: string })?.tabId === tabId),
    ).toHaveLength(1);
  });
});
