import { test, expect } from '../../support/fixtures';

interface ScheduledJobFixture {
  id: string;
  name: string;
  cronExpr: string;
  timezone: string;
  prompt: string;
  workspaceRoot: string | null;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  lastRunAt: number | null;
  nextRunAt: number | null;
}

function makeJob(
  id: string,
  enabled: boolean,
  overrides: Partial<ScheduledJobFixture> = {},
): ScheduledJobFixture {
  return {
    id,
    name: 'job ' + id,
    cronExpr: '*/5 * * * *',
    timezone: 'UTC',
    prompt: 'do something ' + id,
    workspaceRoot: null,
    enabled,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    lastRunAt: null,
    nextRunAt: 1_700_000_300_000,
    ...overrides,
  };
}

test.describe('Thoth — Cron tab', () => {
  test('empty state', async ({ ui }) => {
    await ui.mockRpc({ 'cron:list': { jobs: [] } });

    await ui.openTab('cron');

    const page = ui.page;

    await expect(
      page.locator('[data-testid="cron-empty-state"]'),
    ).toBeVisible();
    await expect(page.locator('[data-testid="cron-stat-total"]')).toHaveText(
      '0',
    );
  });

  test('table renders jobs', async ({ ui }) => {
    await ui.mockRpc({
      'cron:list': {
        jobs: [makeJob('j1', true), makeJob('j2', false)],
      },
    });

    await ui.openTab('cron');

    const page = ui.page;

    await expect(page.locator('[data-testid="cron-job-row"]')).toHaveCount(2);
    await expect(page.locator('[data-testid="cron-stat-total"]')).toHaveText(
      '2',
    );
    await expect(page.locator('[data-testid="cron-stat-enabled"]')).toHaveText(
      '1',
    );
    await expect(page.locator('[data-testid="cron-stat-disabled"]')).toHaveText(
      '1',
    );
  });

  test('create job', async ({ ui }) => {
    const created = makeJob('j-new', true, { name: 'Nightly build' });

    await ui.mockRpc({
      'cron:list': { jobs: [] },
      'cron:create': { job: created },
    });

    await ui.openTab('cron');

    const page = ui.page;

    await expect(
      page.locator('[data-testid="cron-empty-state"]'),
    ).toBeVisible();

    await page.locator('[data-testid="cron-new-job-btn"]').click();
    await expect(page.locator('[data-testid="cron-form"]')).toBeVisible();

    await page.locator('[data-testid="cron-form-name"]').fill('Nightly build');
    await page.locator('[data-testid="cron-form-expr"]').fill('*/5 * * * *');
    await page
      .locator('[data-testid="cron-form-prompt"]')
      .fill('run the nightly build');

    await expect(
      page.locator('[data-testid="cron-form-submit"]'),
    ).toBeEnabled();
    await page.locator('[data-testid="cron-form-submit"]').click();

    await expect(page.locator('[data-testid="cron-form"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="cron-job-row"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="cron-stat-total"]')).toHaveText(
      '1',
    );
  });
});
