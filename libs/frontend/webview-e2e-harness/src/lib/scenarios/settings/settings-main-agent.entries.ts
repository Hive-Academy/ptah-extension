/**
 * Gate G entry for the Main agent section's action (Batch 25 carry-forward, added in Batch 28). It clicks "Reassign",
 * as a user does, and asserts where it lands. Kept apart from the table, which is at its `max-lines` budget;
 * `REACHABILITY_TABLE` spreads it in and `EXPECTED_CAPABILITY_COUNT` counts it.
 */
import { expect } from '@playwright/test';
import type { ReachabilityEntry } from './settings-reachability.table';
import { closeMainAgentPopover, mainAgentModelInput, openMainAgentPopover, visibleEnabled } from './settings-drawer.reach';

export const MAIN_AGENT_ENTRIES: readonly ReachabilityEntry[] = [
  { id: 'RM-1', capability: 'Main agent: "Reassign" opens the Main Agent popover (provider, model, effort)', status: 'restored',
    reach: async (page) => {
      const popover = await openMainAgentPopover(page);
      await visibleEnabled(popover.locator('[data-testid="main-agent-provider"]'));
      await visibleEnabled(mainAgentModelInput(popover));
      await expect(popover.locator('[data-testid="main-agent-effort"] button')).toHaveCount(6);
      await closeMainAgentPopover(page);
    } },
];
