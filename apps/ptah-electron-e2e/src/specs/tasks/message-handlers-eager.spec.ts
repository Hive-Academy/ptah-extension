import { test, expect } from '../../support/fixtures';
import type { UiDriver } from '../../support/ui-driver';

/**
 * R4 gate (TASK_2026_187 Batch 4) — sibling to
 * `specs/thoth/message-handlers-eager.spec.ts` (Batch 3), same pattern,
 * for the two Batch 4 `MESSAGE_HANDLERS` services: `TasksStore`
 * (`@ptah-extension/tasks-ui/services`) and `HarnessWorkflowMessageHandler`
 * (`@ptah-extension/harness-builder/services`). Both must stay constructed
 * and receiving at bootstrap now that `TasksViewComponent` /
 * `HarnessBuilderViewComponent` / `SetupHubComponent` are behind
 * `LazyViewService.resolveWhen` loaders instead of static imports.
 *
 * `apps/ptah-extension-webview/src/app/unit5-message-routing.spec.ts`
 * (Jest, developer's own artifact — batch-4-report.md §8) proves this at the
 * `MessageRouterService` unit level. This file proves the same property
 * against the real Electron renderer, with neither the tasks board nor the
 * harness builder ever having been opened.
 *
 * The harness test needs no mount-race workaround Batch 3's
 * `thoth/message-handlers-eager.spec.ts` needed — its effect is a direct,
 * immediate consequence of the push itself (a `navigateToView` call fired
 * from inside `handleMessage`), not something a later independent mount-time
 * refresh could race or clobber.
 *
 * `TasksStore` used to be proved the same way — push with nothing mounted,
 * watch a `tasks:board` RPC fire. It no longer can be, and the reason is a
 * deliberate product change rather than a regression: `TasksStore` is now
 * SURFACE-GATED (tasks-ui guideline 9). A push that arrives with no Tasks
 * surface mounted is dropped on purpose, because a full `.ptah/specs` scan
 * to repaint a board nobody is looking at is pure waste and the surface
 * re-fetches on mount anyway. So the two tests below split that proof in
 * half: the gate itself, and the registration behind it.
 *
 * The registration half survives the board being open, because opening the
 * board cannot supply the registration. `MESSAGE_HANDLERS` is a root
 * multi-provider read once by `MessageRouterService`'s constructor at
 * bootstrap; `TasksViewComponent` registers no handler of its own and the
 * lazy chunk cannot add one to an injector that is already built. If the
 * narrow-barrel swap had dropped `TasksStore` from `app.config.ts`, no
 * amount of opening the board would route a `tasks:changed` push to it.
 */

/** How many `tasks:board` round trips the renderer has made so far. */
async function boardCallCount(ui: UiDriver): Promise<number> {
  return (await ui.getObservedCalls('tasks:board')).length;
}

test.describe('Tasks / Harness MESSAGE_HANDLERS — eager while unopened (R4, TASK_2026_187)', () => {
  test('TasksStore: a tasks:changed push buys no board scan while the board has never been opened', async ({
    ui,
  }) => {
    // No ui.goto('tasks') anywhere in this test — 'chat' is the default view
    // for the whole test; TasksViewComponent is never created, so nothing
    // could render a board this push refreshed.
    const before = await boardCallCount(ui);

    await ui.pushEvent({ type: 'tasks:changed', payload: {} });

    // A negative held over a window rather than checked once: the dropped
    // path is synchronous, so a scan that was going to happen would already
    // be on the wire well inside this.
    await ui.page.waitForTimeout(1_500);
    expect(await boardCallCount(ui)).toBe(before);
  });

  test('TasksStore: tasks:changed refreshes the open board, through a registration the lazy chunk never supplies', async ({
    ui,
  }) => {
    await ui.goto('tasks');
    await expect(ui.page.locator('ptah-tasks-view')).toBeVisible();

    // The surface's own mount fetch. Waited out first so the assertion below
    // is about the PUSH and not about this.
    await ui.waitForObservedCall('tasks:board');
    const afterMount = await boardCallCount(ui);

    await ui.pushEvent({
      type: 'tasks:changed',
      // No workspaceRoot — takes the unconditional "refresh active,
      // best-effort" branch of `handleMessage`, asserting message delivery
      // itself rather than incidentally asserting workspace-matching logic.
      payload: {},
    });

    // handleMessage -> refreshActiveFromPush() -> a second, distinct
    // `tasks:board` round trip. Only the bootstrap `MESSAGE_HANDLERS`
    // registration can produce it — see the header.
    await expect
      .poll(() => boardCallCount(ui), { timeout: 10_000 })
      .toBeGreaterThan(afterMount);
  });

  test('HarnessWorkflowMessageHandler: harness:open-workflow navigates to the harness builder with it never opened', async ({
    ui,
  }) => {
    const page = ui.page;

    // Confirm we start somewhere that is NOT the harness builder — the
    // negative half of the proof below.
    await expect(page.locator('ptah-harness-builder-view')).toHaveCount(0);

    // Push while still on 'chat' — the harness builder has never been
    // opened, by any means, at this point in the test.
    await ui.pushEvent({
      type: 'harness:open-workflow',
      payload: { mode: 'new-project' },
    });

    // handleOpenWorkflow() calls navigation.navigateToView('harness-builder')
    // as a direct, synchronous-dispatch consequence of the push
    // (harness-workflow-message.handler.ts:53-60) — the app navigates
    // itself, with no ui.goto/pushEvent(switchView) call anywhere in this
    // test. If the registration were broken, nothing would ever appear here.
    await expect(page.locator('ptah-harness-builder-view')).toBeVisible();
  });
});
