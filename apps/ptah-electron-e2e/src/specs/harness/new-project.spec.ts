import { test, expect } from '../../support/fixtures';
import type { UiDriver } from '../../support/ui-driver';

/**
 * New Project flow (TASK_2026_263) — Setup Hub intake -> `harness:start-new-project`
 * -> `harness:open-workflow` broadcast -> harness-builder surface, including the
 * two defects context.md called out as recurring: AskUserQuestion cards never
 * rendering on the harness surface (§A — `hasSurfaceQuestionTargets`, fixed
 * TASK_2026_263) and the workflow dropping on navigation/reload (§C — root-provided
 * `HarnessWorkflowService` + `localStorage` rehydrate).
 *
 * All five scenarios drive the flow with mocked RPC + pushed renderer messages
 * (see `UiDriver`) rather than a real backend/SDK — same technique as
 * `harness-builder.spec.ts` and `streaming-message-handlers.spec.ts`.
 *
 * `openNewProjectWorkflow()` is shared by tests 2-5 rather than chaining them
 * as literal follow-on steps of one another: `electronApp` is a per-test
 * fixture (`fixtures.ts`), so every `test()` gets a fresh Electron process —
 * there is no cross-test app state to continue from. Each test re-runs the
 * same "open the workflow" setup and then does its own thing from there.
 */

const SEED_PROMPT_MARKER = 'AGENT_INSTRUCTIONS::';

/** Valid UUID v4s (`isWireUuid`/`isUuidV4String` in `permission.parsers.ts` require this shape). */
const SESSION_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const QUESTION_ID = '5b6a7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d';

/** `HarnessWorkflowService.HARNESS_WORKFLOW_STORAGE_KEY` (harness-workflow.service.ts). */
const HARNESS_WORKFLOW_STORAGE_KEY = 'ptah.harness.workflow.v1';

const AUDIENCE_LABELS = {
  b2b: 'B2B',
  b2c: 'B2C',
  internal: 'Internal tool',
  unsure: 'Not sure',
} as const;

const STACK_LABELS = {
  recommend: 'Recommend for me',
  'angular-nestjs': 'Angular + NestJS',
  'react-nestjs': 'React + NestJS',
  other: 'Other',
} as const;

interface Intake {
  what: string;
  audience: keyof typeof AUDIENCE_LABELS;
  stack: keyof typeof STACK_LABELS;
  constraints?: string;
  stackOther?: string;
}

/**
 * Mirrors `formatIntakeSummary`
 * (`libs/frontend/harness-builder/src/lib/services/new-project-intake.ts`) so
 * the test can assert the transcript renders the user's own words rather
 * than the seed prompt, without importing frontend implementation code into
 * the e2e project (this app has no path mapping for it).
 */
function expectedIntakeSummaryLines(intake: Intake): string[] {
  const stackLabel =
    intake.stack === 'other' && intake.stackOther?.trim()
      ? intake.stackOther.trim()
      : STACK_LABELS[intake.stack];
  const lines = [
    intake.what,
    `Who it's for: ${AUDIENCE_LABELS[intake.audience]}`,
    `Stack: ${stackLabel}`,
  ];
  if (intake.constraints?.trim()) {
    lines.push(`Must-haves: ${intake.constraints.trim()}`);
  }
  return lines;
}

/**
 * Skips the intake modal (covered by its own tests below) and drives the
 * flow the way the backend does: mock the RPC, then push the
 * `harness:open-workflow` broadcast it makes on success. Waits for the
 * resulting `chat:start` call and returns its `tabId` so callers can push
 * further `chat:chunk` / `ask-user-question:request` events addressed to
 * this workflow's surface.
 */
async function openNewProjectWorkflow(
  ui: UiDriver,
  intake: Intake,
  seedPrompt: string,
): Promise<{ tabId: string }> {
  await ui.mockRpc({
    'harness:start-new-project': { success: true },
    'chat:start': { success: true },
  });
  await ui.pushEvent({
    type: 'harness:open-workflow',
    payload: { mode: 'new-project', seedPrompt, intake },
  });

  await expect(ui.page.locator('ptah-harness-builder-view')).toBeVisible();

  const startCall = await ui.waitForObservedCall('chat:start');
  const params = startCall.params as {
    tabId: string;
    prompt: string;
    surfaceMode: boolean;
  };
  expect(params.surfaceMode).toBe(true);
  expect(params.prompt).toBe(seedPrompt);

  return { tabId: params.tabId };
}

// `SetupHubComponent` reads `presets().length` unguarded in five template
// spots (setup-hub.component.ts:772/783/785/799/803) with no `?? []` — a
// real backend always resolves `harness:load-presets` to `{ presets: [] }`
// (never bare `{}`), but `UiDriver`'s unmocked-method fallback returns the
// merged empty-defaults object, which has no `presets` key. That undefined
// signal throws on every change-detection pass from then on (see the "found
// bug" note in the final report), silently freezing the REST of this
// component's reactive bindings — including, several change-detection cycles
// later, the New Project intake modal's disabled-state and its audience/stack
// chip lists, which is what this file actually tests. Mock it everywhere so
// these tests exercise intake behavior, not that unrelated defect.
test.beforeEach(async ({ ui }) => {
  await ui.mockRpc({ 'harness:load-presets': { presets: [] } });
});

test.describe('New Project flow — intake (TASK_2026_263)', () => {
  test('intake form submits harness:start-new-project with the exact intake payload', async ({
    ui,
  }) => {
    await ui.mockRpc({ 'harness:start-new-project': { success: true } });
    await ui.goto('setup-hub');

    await ui.page.locator('[data-testid="new-project-start"]').click();
    await expect(
      ui.page.locator('[data-testid="new-project-intake"]'),
    ).toBeVisible();

    const startButton = ui.page.locator('[data-testid="intake-start"]');
    // "What are you building?" is the one required field — nothing else
    // filled in yet.
    await expect(startButton).toBeDisabled();

    await ui.page.locator('[data-testid="intake-audience-b2b"]').click();
    await ui.page
      .locator('[data-testid="intake-stack-angular-nestjs"]')
      .click();
    // Audience + stack picked, but "what" is still empty.
    await expect(startButton).toBeDisabled();

    await ui.page
      .locator('[data-testid="intake-what"]')
      .fill('A scheduling tool for physiotherapy clinics.');
    await ui.page
      .locator('[data-testid="intake-constraints"]')
      .fill('Must run on-premise; launch in 6 weeks.');
    await expect(startButton).toBeEnabled();

    await startButton.click();

    const call = await ui.waitForObservedCall('harness:start-new-project');
    expect(call.params).toEqual({
      intake: {
        what: 'A scheduling tool for physiotherapy clinics.',
        audience: 'b2b',
        stack: 'angular-nestjs',
        constraints: 'Must run on-premise; launch in 6 weeks.',
      },
    });
  });

  test('the "other" stack chip requires its own free-text field before intake-start enables', async ({
    ui,
  }) => {
    await ui.goto('setup-hub');
    await ui.page.locator('[data-testid="new-project-start"]').click();

    const startButton = ui.page.locator('[data-testid="intake-start"]');
    await ui.page
      .locator('[data-testid="intake-what"]')
      .fill('An inventory tracker.');
    // Default stack is 'recommend' — no free text required, so this alone enables it.
    await expect(startButton).toBeEnabled();

    // The chip and its conditional text input share the same testid
    // (setup-hub.component.ts:1007/1020) — disambiguate by tag.
    await ui.page.locator('button[data-testid="intake-stack-other"]').click();
    await expect(startButton).toBeDisabled();

    await ui.page
      .locator('input[data-testid="intake-stack-other"]')
      .fill('Ruby on Rails');
    await expect(startButton).toBeEnabled();
  });
});

test.describe('New Project flow — workflow + surface (TASK_2026_263)', () => {
  test('opening the workflow renders the intake summary as the first bubble (not the raw seed prompt) and starts chat in surface mode', async ({
    ui,
  }) => {
    const intake: Intake = {
      what: 'A scheduling tool for physiotherapy clinics.',
      audience: 'b2b',
      stack: 'angular-nestjs',
      constraints: 'Must run on-premise; launch in 6 weeks.',
    };
    const seedPrompt = `${SEED_PROMPT_MARKER} run ddd-architecture then nx-workspace-architect for: ${intake.what}`;

    const { tabId } = await openNewProjectWorkflow(ui, intake, seedPrompt);
    expect(tabId).toBeTruthy();

    const transcriptText = await ui.page
      .locator('ptah-harness-builder-view [role="log"]')
      .innerText();
    for (const line of expectedIntakeSummaryLines(intake)) {
      expect(transcriptText).toContain(line);
    }
    // The agent's instruction block must never leak into the transcript —
    // this was the "hardcoded" symptom context.md §B described.
    expect(transcriptText).not.toContain(SEED_PROMPT_MARKER);
  });

  test('AskUserQuestion renders as a card on the workflow surface and the answer reaches the main process', async ({
    ui,
  }) => {
    const intake: Intake = {
      what: 'A booking app for yoga studios.',
      audience: 'b2c',
      stack: 'recommend',
    };
    const seedPrompt = `${SEED_PROMPT_MARKER} discovery for: ${intake.what}`;
    const { tabId } = await openNewProjectWorkflow(ui, intake, seedPrompt);

    // Bind the surface to a real session id the way the SDK's first stream
    // event would — StreamRouter.routeQuestionPrompt resolves the question
    // below to this surface via that binding (StreamRouter.interactiveSurfacesForSession).
    await ui.pushEvent({
      type: 'chat:chunk',
      payload: {
        tabId,
        sessionId: SESSION_ID,
        surfaceMode: true,
        event: {
          id: 'evt-1',
          eventType: 'message_start',
          timestamp: Date.now(),
          sessionId: SESSION_ID,
          messageId: 'msg-1',
          role: 'assistant',
        },
      },
    });

    await ui.pushEvent({
      type: 'ask-user-question:request',
      payload: {
        id: QUESTION_ID,
        toolName: 'AskUserQuestion',
        questions: [
          {
            question: 'Which audience segment should we design for first?',
            header: 'Audience',
            options: [
              { label: 'B2B', description: 'Business customers' },
              { label: 'B2C', description: 'Individual consumers' },
            ],
            multiSelect: false,
          },
        ],
        toolUseId: 'tu-1',
        timestamp: Date.now(),
        timeoutAt: 0,
        sessionId: SESSION_ID,
        tabId,
        surfaceMode: true,
      },
    });

    const card = ui.page.locator(
      'ptah-harness-builder-view ptah-question-card',
    );
    await expect(card).toBeVisible();

    await card.locator('label', { hasText: 'B2C' }).click();
    await card.getByRole('button', { name: 'Submit' }).click();

    const response = await ui.waitForObservedMessage(
      'ask-user-question:response',
    );
    expect(response.payload).toEqual({
      id: QUESTION_ID,
      answers: {
        'Which audience segment should we design for first?': 'B2C',
      },
    });
  });
});

test.describe('New Project flow — persistence (TASK_2026_263)', () => {
  test('the workflow survives navigating away and back, and the Setup Hub offers Resume instead of starting a second run', async ({
    ui,
  }) => {
    const intake: Intake = {
      what: 'A CRM for boutique law firms.',
      audience: 'internal',
      stack: 'react-nestjs',
    };
    const seedPrompt = `${SEED_PROMPT_MARKER} discovery for: ${intake.what}`;
    await openNewProjectWorkflow(ui, intake, seedPrompt);

    await ui.goto('dashboard');
    await expect(ui.page.locator('ptah-dashboard-grid')).toBeVisible();

    await ui.goto('harness-builder');
    await expect(ui.page.locator('ptah-harness-builder-view')).toBeVisible();
    const transcriptText = await ui.page
      .locator('ptah-harness-builder-view [role="log"]')
      .innerText();
    expect(transcriptText).toContain(intake.what);

    // The view was destroyed and recreated by the navigation round trip;
    // only a duplicate `chat:start` would prove the transcript is a replay of
    // a second agent session rather than the same one kept alive.
    expect(await ui.getObservedCalls('chat:start')).toHaveLength(1);

    await ui.goto('setup-hub');
    await expect(
      ui.page.locator('[data-testid="new-project-resume"]'),
    ).toBeVisible();
    await expect(
      ui.page.locator('[data-testid="new-project-start"]'),
    ).toHaveCount(0);
  });

  test('a page reload rehydrates the transcript and resumed-note from localStorage plus chat:resume history', async ({
    ui,
  }) => {
    const intake: Intake = {
      what: 'A telehealth intake portal.',
      audience: 'b2c',
      stack: 'recommend',
    };
    const seedPrompt = `${SEED_PROMPT_MARKER} discovery for: ${intake.what}`;
    const { tabId } = await openNewProjectWorkflow(ui, intake, seedPrompt);

    // Bind a real session id so the persisted record carries one, and
    // `rehydrate()` on reload takes the `chat:resume` replay path
    // (`HarnessWorkflowService.replaySessionHistory`) rather than skipping it.
    await ui.pushEvent({
      type: 'chat:chunk',
      payload: {
        tabId,
        sessionId: SESSION_ID,
        surfaceMode: true,
        event: {
          id: 'evt-1',
          eventType: 'message_start',
          timestamp: Date.now(),
          sessionId: SESSION_ID,
          messageId: 'msg-1',
          role: 'assistant',
        },
      },
    });

    // The persistence effect (`HarnessWorkflowService` constructor) writes
    // to localStorage asynchronously off the pushEvent call — wait for the
    // session id to land before reloading, or the record could still show
    // `sessionId: null`.
    await ui.page.waitForFunction((key) => {
      const raw = localStorage.getItem(key);
      if (!raw) return false;
      try {
        return (
          (JSON.parse(raw) as { sessionId: string | null }).sessionId !== null
        );
      } catch {
        return false;
      }
    }, HARNESS_WORKFLOW_STORAGE_KEY);

    await ui.mockRpc({
      'chat:resume': {
        success: true,
        events: [
          {
            id: 'evt-history-1',
            eventType: 'message_start',
            timestamp: 1,
            sessionId: SESSION_ID,
            messageId: 'msg-history-1',
            role: 'assistant',
          },
        ],
      },
    });

    // Reload the renderer only — same Electron process/main-process mocks,
    // fresh Angular injector (mirrors what a real F5 does; ui.prepare() is
    // the same reload path the `ui` fixture uses for the initial boot).
    await ui.prepare();
    await ui.goto('harness-builder');

    await expect(
      ui.page.locator('[data-testid="workflow-resumed-note"]'),
    ).toBeVisible();
    const transcriptText = await ui.page
      .locator('ptah-harness-builder-view [role="log"]')
      .innerText();
    expect(transcriptText).toContain(intake.what);
  });
});
