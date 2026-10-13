/**
 * Dashboard section order (plan-limits-live-fix).
 *
 * "Provider accounts & plan limits" is its own section directly under the
 * Tribunal banner and above Session Analytics. It reads `PlanLimitsStore`,
 * not session analytics, so it must never be nested back inside the
 * analytics card (where it sat below the analytics date-range selector).
 *
 * Read from the template source, like `dashboard-grid.scroll-owner.spec.ts`,
 * so the order is pinned without mounting every card's RPC loads.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const COMPONENTS = join(
  process.cwd(),
  'libs/frontend/dashboard/src/lib/components',
);
const GRID_TEMPLATE = join(
  COMPONENTS,
  'dashboard-grid/dashboard-grid.component.html',
);
const ANALYTICS_TEMPLATE = join(
  COMPONENTS,
  'analytics-card/analytics-card.component.html',
);

describe('dashboard-grid section order', () => {
  it('reads the real templates', () => {
    expect(existsSync(GRID_TEMPLATE)).toBe(true);
    expect(existsSync(ANALYTICS_TEMPLATE)).toBe(true);
  });

  it('places the plan-limits section after the Tribunal banner and before Session Analytics', () => {
    const html = readFileSync(GRID_TEMPLATE, 'utf8');
    const tribunal = html.indexOf('aria-label="Convene a Tribunal"');
    const limits = html.indexOf('<ptah-provider-account-card');
    const analytics = html.indexOf('<ptah-analytics-card');

    expect(tribunal).toBeGreaterThan(-1);
    expect(limits).toBeGreaterThan(tribunal);
    expect(analytics).toBeGreaterThan(limits);
  });

  it('no longer nests the plan-limits section inside the analytics card', () => {
    const html = readFileSync(ANALYTICS_TEMPLATE, 'utf8');

    expect(html).not.toContain('ptah-provider-account-card');
  });
});
