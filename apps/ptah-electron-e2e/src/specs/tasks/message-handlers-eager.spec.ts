import { test, expect } from '../../support/fixtures';

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
 * Neither test below needs the mount-race workaround Batch 3's
 * `thoth/message-handlers-eager.spec.ts` needed — both effects are direct,
 * immediate consequences of the push itself (an RPC call fired from inside
 * `handleMessage`, and a `navigateToView` call fired from inside
 * `handleMessage`), not something a later independent mount-time refresh
 * could race or clobber.
 */
test.describe('Tasks / Harness MESSAGE_HANDLERS — eager while unopened (R4, TASK_2026_187)', () => {
  test('TasksStore: tasks:changed triggers a board refresh with the tasks board never opened', async ({
    ui,
  }) => {
    // No ui.goto('tasks') anywhere in this test — 'chat' is the default view
    // for the whole test; TasksViewComponent is never created.
    await ui.pushEvent({
      type: 'tasks:changed',
      // No workspaceRoot — takes the unconditional "refresh active,
      // best-effort" branch (tasks-store.service.ts:894-900), asserting
      // message delivery itself rather than incidentally asserting
      // workspace-matching logic.
      payload: {},
    });

    // refreshActiveFromPush() -> fetchBoard() -> a real `tasks:board` RPC
    // call. Firing with zero UI mounted is direct proof `TasksStore` is
    // alive, registered through the narrow barrel, and processed the push.
    const observed = await ui.waitForObservedCall('tasks:board');
    expect(observed.method).toBe('tasks:board');
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
