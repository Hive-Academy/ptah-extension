/**
 * Gate G entries for the routing map's three node actions (Batch 25 carry-forward, added in Batch 28). Each one
 * clicks the node's footer action, as a user does, and asserts where it lands. Kept apart from the table, which is
 * at its `max-lines` budget; `REACHABILITY_TABLE` spreads them in and `EXPECTED_CAPABILITY_COUNT` counts them.
 */
import { expect, type Page } from '@playwright/test';
import type { ReachabilityEntry } from './settings-reachability.table';
import { closeMainAgentPopover, mainAgentModelInput, openMainAgentPopover, providersTab, visibleEnabled } from './settings-drawer.reach';

/** Providers tab, then a routing-map node's footer action (`routing-node-action`). */
async function activateNode(page: Page, node: 'background-roles' | 'cli-agents'): Promise<void> {
  await providersTab(page);
  const action = page.locator(`[data-testid="routing-node-${node}"] [data-testid="routing-node-action"]`);
  await visibleEnabled(action);
  await action.click();
  await expect(page.getByRole('button', { name: 'Agent Orchestration', exact: true })).toHaveClass(/tab-active/);
}

export const ROUTING_MAP_ENTRIES: readonly ReachabilityEntry[] = [
  { id: 'RM-1', capability: 'Routing map: Main Agent "Reassign" opens the Main Agent popover (provider, model, effort)', status: 'restored',
    reach: async (page) => {
      const popover = await openMainAgentPopover(page);
      await visibleEnabled(popover.locator('[data-testid="main-agent-provider"]'));
      await visibleEnabled(mainAgentModelInput(popover));
      await expect(popover.locator('[data-testid="main-agent-effort"] button')).toHaveCount(6);
      await closeMainAgentPopover(page);
    } },
  { id: 'RM-2', capability: 'Routing map: Background roles "Inspect" lands on Orchestration, background roles focused', status: 'restored',
    reach: async (page) => {
      await activateNode(page, 'background-roles');
      const region = page.locator('[data-focus="background-models"]');
      await expect(region).toBeVisible();
      await expect(region).toBeFocused();
    } },
  { id: 'RM-3', capability: 'Routing map: CLI agents "Manage matrix" lands on Orchestration, CLI agents shown', status: 'restored',
    reach: async (page) => {
      await activateNode(page, 'cli-agents');
      const heading = page.locator('[data-focus="cli-agents"]');
      await expect(heading).toBeVisible();
      await expect(heading).toBeFocused();
    } },
];
