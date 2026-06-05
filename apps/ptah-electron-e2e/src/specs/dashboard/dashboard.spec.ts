import { test, expect } from '../../support/fixtures';

test.describe('Dashboard', () => {
  test('status cards render', async ({ ui }) => {
    await ui.mockRpc({
      'memory:stats': {
        core: 4,
        recall: 2,
        archival: 1,
        codeIndex: 120,
        lastCuratedAt: 1_700_000_000_000,
      },
      'skillSynthesis:listCandidates': { candidates: [] },
    });

    await ui.goto('dashboard');

    const page = ui.page;

    await expect(page.locator('[data-testid="dashboard-grid"]')).toBeVisible();

    const memoryCard = page.locator(
      '[data-testid="dashboard-status-card"][data-pillar="memory"]',
    );
    await expect(memoryCard).toBeVisible();

    await expect(
      memoryCard.locator('[data-testid="dashboard-status-card-value"]'),
    ).toContainText('7');
  });
});
