# Visual fix report — TASK_2026_687_615f

| Finding | Change (file:line) | Spec | Jest result |
| --- | --- | --- | --- |
| F-1: tab labels clip at 900–963 px | `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:112,115,169` — prevent label wrapping and use icon-only tabs through 1023 px; keep seven tab labels and accessible names. | `electron-shell.command-center-tab.spec.ts` checks seven labels, accessible names, no-wrap class and breakpoint. | 4 passed |
| F-2: toast covers app chrome | `libs/frontend/command-center/src/lib/components/command-center-page.component.ts:237` — anchor absolute toast inside the relative stage column, below the page header and outside the dock. | `command-center-page.component.spec.ts` checks stage placement and dock exclusion. | Included in 29 command-center tests passed |
| F-3: light-theme card contrast | `libs/frontend/harness-builder/src/lib/components/setup-hub.component.ts:741,779,797,816,834` — use base-content for card icon and both CTA labels, and base-content focus outlines on both cards. | `setup-hub.component.spec.ts` checks Command Center icon, CTA and focus tokens. | 12 passed |
| F-4: pending card below fold | `libs/frontend/command-center/src/lib/components/command-center-page.component.ts:90,181,511` — show a stacked-width question cue near the top with a jump to the card; retain one-time automatic scroll. | `command-center-page.component.spec.ts` checks cue and jump scroll. | Included in 29 command-center tests passed |
| F-5: mic recovery below fold | `libs/frontend/command-center/src/lib/components/command-center-page.component.ts:144` — show mic-denied recovery in the page header at every width, with no additional live role; the dock HUD keeps its live status. | `command-center-page.component.spec.ts` checks header recovery and settings action. | Included in 29 command-center tests passed |
| F-6: detached root plate | `libs/frontend/command-center/src/lib/scene/command-scene-renderer.ts:232` — draw the root leader once its plate edge is more than 24 px beyond the sphere radius. | `command-scene-renderer.spec.ts` checks a crowded root plate draws a leader. | Included in 29 command-center tests passed |

Focused Jest: 3 suites, 45 tests passed (`command-center` 29, `chat` 4, `harness-builder` 12). The scoped `ptah_get_diagnostics` check timed out twice and returned no TypeScript results. Browser visual measurements were not rerun in this lane.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Hide tab labels through 1023 px. | Keep 899 px; raise to 1023 px. | Review reports clipping from 900 to about 963 px; 1024 gives margin while preserving labels at 1100 px. | Yes, one media query. |
| Use a top cue for stacked pending cards. | Reorder the rail; add a jump cue. | Existing one-time scroll still left cards below the fold; cue keeps stage and rail layout intact. | Yes. |
| Put mic-denial action in the header. | Move the full HUD; add a compact header recovery. | Review found the dock recovery below the fold at 1100 and 1440 px; the header is visible and the HUD owns the live announcement. | Yes. |
| Tighten the root leader threshold. | Move labels inward; draw a leader sooner. | Crowded 900 px plate is displaced by nearby nodes; rendering a leader preserves collision avoidance. | Yes. |
