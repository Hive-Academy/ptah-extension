# Batch 3 Report - TASK_2026_540_0940

## Files changed

- `libs/frontend/chat/src/lib/components/molecules/global-config-menu.component.ts` (created).
- `libs/frontend/chat/src/lib/components/molecules/global-config-menu.component.spec.ts` (created).
- `.ptah/specs/TASK_2026_540_0940/batch-3-report.md` (created).

## Task 3.1

- Component lines 23-27: `ptah-global-config-menu`, standalone, OnPush, NativeDropdownComponent and LucideAngularModule.
- Lines 28-85: bottom-end dropdown, null panel role, Configuration accessible name, aria-expanded, stable data-test hooks, trigger/item highlights, Escape and arrow handlers. The closed output closes and restores trigger focus; opened focuses the first item.
- Lines 88-110: injected AppStateManager, local open signal, settled configuration signal, and the four ordered items with the required labels, title and icons.
- Lines 112-148: toggle/close/focus handlers; arrow keys prevent scrolling and wrap in both directions. A late opened event cannot move focus after closing.
- Lines 150-159: selection closes and restores focus, conditionally dismisses the Thoth hint, then calls only `setCurrentView(id)` for navigation.
- Lucide export confirmed by grep before implementation: `node_modules/lucide-angular/icons/lucide-icons.d.ts:1351` exports `SlidersHorizontal` from `./sliders-horizontal`; its declaration is `LucideIconData` in `icons/sliders-horizontal.d.ts:13`.
- Core names confirmed in `app-state.service.ts`: `ConfigurationSurfaceId:57`, `CONFIGURATION_SURFACE_IDS:62`, `openConfigurationSurface:596`, `thothFirstRunDismissed:638`, `setCurrentView:902`, `dismissThothFirstRun:1021`. The service barrel re-exports app-state and the core barrel re-exports services.
- Batch 4 must add `import { GlobalConfigMenuComponent } from '../molecules/global-config-menu.component';` to `electron-shell.component.ts`, add it to component imports, and mount `<ptah-global-config-menu />`. This follows the sibling-molecule relative import in `app-shell.component.ts:36`. No barrel change is required.

## Task 3.2

The spec uses the real dropdown and an AppStateManager useValue stub with writable signals. `openMenu()` explicitly fires `DebugElement.triggerEventHandler('opened')`.

Cases (16 tests, including the four-case parameterized test):

- Line 82: renders exactly four action buttons in the required order.
- Line 100: names the trigger Configuration and reflects click toggles in aria-expanded.
- Line 114: focuses the first item when the dropdown emits opened.
- Line 119: selects %s, closes, and refocuses the trigger before navigation (thoth, setup-hub, marketplace, settings).
- Line 142: dismisses the Thoth hint once and before setCurrentView (asserts invocation call order).
- Line 157: does not dismiss an already dismissed Thoth hint.
- Line 166: closes on Escape and refocuses the trigger.
- Line 175: roves with ArrowDown and ArrowUp, prevents scrolling, and wraps both ends.
- Line 194: closes and refocuses the trigger when the dropdown emits closed.
- Line 203: closes on a backdrop click and refocuses the trigger.
- Line 212: updates aria-current and item and trigger highlights from the settled surface signal.
- Line 234: closes when navigation is a no-op and preserves the settled active indication.
- Line 248: delegates a re-click on the active Thoth surface after dismissing its hint.

## Risks and edge cases

- Navigation gating remains owned by AppStateManager. A no-op call closes the menu and retains the settled indication; the component never predicts a successful navigation.
- Re-selecting the active Thoth surface still dismisses the first-run hint before the navigation call.
- Focus is restored on item selection, Escape, closed output and backdrop click. Native buttons retain Enter/Space activation.
- Floating UI positioning and Electron/macOS titlebar interaction require the later shell integration/manual checks; jsdom explicitly emits opened as prescribed.
- No core, shell, barrel or other existing file was edited. Batch 1 and Batch 2 changes remain untouched. Review acceptance belongs to the orchestrator's review lanes.

## Verification

Command: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat`

**PASS** — exit code 0; all three targets succeeded with 0/3 cache hits. The test target includes the untouched `workspace-coordinator.service.spec.ts`.

Tailed output:

```text
 NX   Running targets typecheck, test, lint for project @ptah-extension/chat:

- @ptah-extension/chat

√  nx run @ptah-extension/chat:typecheck
√  nx run @ptah-extension/chat:test
√  nx run @ptah-extension/chat:lint

 NX   Successfully ran targets typecheck, test, lint for project @ptah-extension/chat

Output of 3 successful tasks were not shown. Run with --verbose or --output-style=static to see it.

View logs and investigate cache misses at https://nx.app/runs/nScvVsv23W

  Run duration:      1m 22s
  Cache:             0/3 hit (0%)
  Critical path:     1m 11s (1 task)
  Recoverable time:  10.8s (13% of the run)

  Recommendations:
    - Speed up or split the longest tasks on the critical path:
        @ptah-extension/chat:test    1m 11s
VERIFICATION_EXIT_CODE=0
```

Prettier was applied only to the two new TypeScript files before verification. No verification rerun was needed.

## Open issues

none
