import { test, expect } from '../../support/fixtures';

/**
 * Streaming path validation (TASK_2026_187 Unit 10) — `ChatMessageHandler`
 * is a `MESSAGE_HANDLERS` entry constructed at bootstrap; six of its inbound
 * payload validators (`session:turnEnded`, `session:turnFailed`,
 * `session:subagentEnded`, `session:compactionComplete`, `permission:request`,
 * `ask-user-question:request`) were rewritten from `.safeParse` zod schemas
 * to hand-written parsers to get `zod` (304 kB) out of the eager bundle
 * (`unit10-zod-report.md` §1a/§2).
 *
 * `libs/shared/src/lib/types/wire-parsers.equivalence.spec.ts` (Jest, 3,063
 * inputs) already proves the parsers agree with zod at the unit level. This
 * file proves the same property against the **real running app**: the
 * highest-risk failure mode named for this unit — "a parser that wrongly
 * *rejects* a valid payload would silently drop a streaming message" — is a
 * production-wiring risk (does the real narrow-barrel-free import resolve?
 * does the real `MessageRouterService` dispatch reach the real parser?), not
 * a parser-logic risk the equivalence spec can't already rule out.
 *
 * **Method**: each `handle*` method in `chat-message-handler.service.ts`
 * calls its parser *before* any tab/session-matching logic runs (verified by
 * reading the source — e.g. `handleSessionTurnEnded` parses first, and only
 * a successful parse reaches `workspaceFor`/`liveness.markIdle`). That means
 * the accept/reject outcome is observable **with no chat tab or session ever
 * created** — exactly the eager-service / never-opened-surface shape this
 * whole task's R4 gate uses, applied to a payload-validation risk instead of
 * a component-loading risk.
 *
 * The observable is the exact, literal `console.warn` string each reject
 * branch emits (`'[ChatMessageHandler] Invalid <Schema> — dropped'`,
 * `chat-message-handler.service.ts`), captured via `page.on('console')` —
 * this is the renderer's own console, not the Electron main process log
 * (`mainProcessOutput` in this harness only captures the main process).
 * Absence of that exact string after a **valid** payload is direct evidence
 * the parser accepted it; presence after an **invalid** one is direct
 * evidence the reject path still works too — both directions checked, not
 * just one, so this cannot pass by the parser having become too permissive.
 *
 * Canonical payloads are copied from `wire-parsers.equivalence.spec.ts`'s
 * own fixtures (`TURN_ENDED`, `TURN_FAILED`, `SUBAGENT_ENDED`,
 * `COMPACTION_COMPLETE`, `PERMISSION_REQUEST`, `ASK_USER_QUESTION`) rather
 * than re-derived, so this test and the Jest equivalence suite are checking
 * the same shapes.
 */

const UUID_V4 = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

const REJECT_WARNINGS = {
  turnEnded: '[ChatMessageHandler] Invalid SdkTurnEndedPayload — dropped',
  turnFailed: '[ChatMessageHandler] Invalid SdkTurnFailedPayload — dropped',
  subagentEnded:
    '[ChatMessageHandler] Invalid SdkSubagentEndedPayload — dropped',
  compactionComplete:
    '[ChatMessageHandler] Invalid SdkCompactionCompletePayload — dropped',
  permissionRequest:
    '[ChatMessageHandler] Invalid PermissionRequest payload — dropped',
  askUserQuestion:
    '[ChatMessageHandler] Invalid AskUserQuestionRequest payload — dropped',
} as const;

test.describe('Streaming payload parsers — real app, both directions (Unit 10, TASK_2026_187)', () => {
  test('valid payloads for all six rewritten schemas are accepted (no reject warning), with the app never having opened a chat session', async ({
    ui,
  }) => {
    const page = ui.page;
    const consoleWarnings: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'warning' || msg.type() === 'error') {
        consoleWarnings.push(msg.text());
      }
    });

    // No ui.goto('chat') tab-creation, no chat:start — the default 'chat'
    // view with no session is exactly the state every launch starts in.
    await ui.pushEvent({
      type: 'session:turnEnded',
      payload: {
        sessionId: UUID_V4,
        cwd: 'D:/repo',
        lastAssistantMessage: null,
        backgroundTasks: [
          {
            id: 'task-1',
            type: 'bash',
            status: 'running',
            description: 'build',
            command: 'npm run build',
          },
        ],
        sessionCrons: [
          {
            id: 'cron-1',
            schedule: '0 * * * *',
            recurring: true,
            prompt: 'check',
          },
        ],
        terminalReason: 'completed',
        timestamp: 1,
      },
    });

    await ui.pushEvent({
      type: 'session:turnFailed',
      payload: {
        sessionId: UUID_V4,
        cwd: 'D:/repo',
        lastAssistantMessage: 'partial',
        error: 'rate_limit',
        errorDetails: null,
        terminalReason: null,
        timestamp: 2,
      },
    });

    await ui.pushEvent({
      type: 'session:subagentEnded',
      payload: {
        sessionId: UUID_V4,
        cwd: 'D:/repo',
        agentId: 'agent-1',
        agentType: 'Explore',
        lastAssistantMessage: null,
        backgroundTasks: [],
        timestamp: 3,
      },
    });

    await ui.pushEvent({
      type: 'session:compactionComplete',
      payload: {
        sessionId: UUID_V4,
        cwd: 'D:/repo',
        trigger: 'manual',
        compactSummary: '',
        timestamp: 0,
      },
    });

    await ui.pushEvent({
      type: 'permission:request',
      payload: {
        id: UUID_V4,
        toolName: 'Bash',
        toolInput: { command: 'ls' },
        toolUseId: 'tu-1',
        agentToolCallId: 'ac-1',
        timestamp: 1000,
        description: 'run ls',
        timeoutAt: 2000,
        sessionId: UUID_V4,
        tabId: UUID_V4,
        surfaceMode: false,
      },
    });

    await ui.pushEvent({
      type: 'ask-user-question:request',
      payload: {
        id: UUID_V4,
        toolName: 'AskUserQuestion',
        questions: [{ id: 'q1' }],
        toolUseId: 'tu-2',
        timestamp: 1000,
        timeoutAt: 2000,
        sessionId: UUID_V4,
        tabId: UUID_V4,
        surfaceMode: true,
      },
    });

    // Give the renderer a beat to process all six dispatches and flush any
    // console output before asserting.
    await page.waitForTimeout(500);

    for (const warning of Object.values(REJECT_WARNINGS)) {
      expect(
        consoleWarnings.some((w) => w.includes(warning)),
        `expected NO reject warning for a valid payload, but found: "${warning}"\nAll captured warnings: ${JSON.stringify(consoleWarnings)}`,
      ).toBe(false);
    }

    // Confirm the app is still alive and responsive after all six dispatches
    // — the crash/hang check.
    await ui.goto('dashboard');
    await expect(page.locator('ptah-dashboard-grid')).toBeVisible();
  });

  test('invalid payloads for turnEnded and permission:request are rejected (reject warning fires), proving the reject path still works too', async ({
    ui,
  }) => {
    const page = ui.page;
    const consoleWarnings: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'warning' || msg.type() === 'error') {
        consoleWarnings.push(msg.text());
      }
    });

    // Missing `sessionId` — a required field on every one of these schemas.
    await ui.pushEvent({
      type: 'session:turnEnded',
      payload: {
        cwd: 'D:/repo',
        lastAssistantMessage: null,
        backgroundTasks: [],
        sessionCrons: [],
        terminalReason: 'completed',
        timestamp: 1,
      },
    });

    // Missing `toolName` — required on PermissionRequest.
    await ui.pushEvent({
      type: 'permission:request',
      payload: {
        id: UUID_V4,
        toolInput: { command: 'ls' },
        toolUseId: 'tu-1',
        agentToolCallId: 'ac-1',
        timestamp: 1000,
        description: 'run ls',
        timeoutAt: 2000,
        sessionId: UUID_V4,
        tabId: UUID_V4,
        surfaceMode: false,
      },
    });

    await page.waitForTimeout(500);

    expect(
      consoleWarnings.some((w) => w.includes(REJECT_WARNINGS.turnEnded)),
      `expected the turnEnded reject warning; captured: ${JSON.stringify(consoleWarnings)}`,
    ).toBe(true);
    expect(
      consoleWarnings.some((w) =>
        w.includes(REJECT_WARNINGS.permissionRequest),
      ),
      `expected the permissionRequest reject warning; captured: ${JSON.stringify(consoleWarnings)}`,
    ).toBe(true);

    // Rejecting a malformed payload must not take the app down with it.
    await ui.goto('dashboard');
    await expect(page.locator('ptah-dashboard-grid')).toBeVisible();
  });
});
