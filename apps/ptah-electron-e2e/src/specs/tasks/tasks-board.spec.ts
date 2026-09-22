import { test, expect } from '../../support/fixtures';

/**
 * Tasks board — a lazy ROUTE (`app.routes.ts`, `loadComponent:
 * import('@ptah-extension/tasks-ui')`). TASK_2026_187 Batch 4 first deferred
 * it behind the `TASKS_VIEW_COMPONENT` token (batch-4-report.md §2);
 * TASK_2026_524 batch 1 replaced that with the route. This proves the
 * deferred surface actually resolves and the Kanban populates from real
 * data, not just that the outlet mounts.
 */
test.describe('Tasks board (lazy chunk, TASK_2026_187)', () => {
  test('board loads and the Kanban populates', async ({ ui }) => {
    await ui.mockRpc({
      'tasks:board': {
        columns: {
          backlog: [
            {
              id: 'TASK_2026_999',
              folderName: 'TASK_2026_999',
              status: 'backlog',
              type: 'FEATURE',
              title: 'E2E fixture task',
              dependsOn: [],
              labels: [],
            },
          ],
          in_progress: [],
          in_review: [],
          blocked: [],
          done: [],
          cancelled: [],
        },
        excluded: [],
        excludedCount: 0,
        specsDirExists: true,
      },
    });

    await ui.goto('tasks');

    const page = ui.page;

    // The board itself resolved from the lazy chunk (proves the loader
    // settled, not stuck on the @else spinner).
    await expect(page.locator('ptah-tasks-view')).toBeVisible();

    // The Kanban actually populated from the mocked RPC data, not just an
    // empty shell.
    await expect(
      page.locator('[data-testid="task-column-count"]').first(),
    ).toContainText('1');
  });
});
