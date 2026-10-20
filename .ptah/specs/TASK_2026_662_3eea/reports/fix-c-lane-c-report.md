# Phase C fix round — Lane C

## Files changed or deleted

- `apps/ptah-electron/src/services/tray/tray.service.ts` — removed keepalive and Skills tray pause behavior; retained memory pause, tooltip, and unconditional Quit assertion.
- `apps/ptah-electron/src/services/tray/tray.service.spec.ts` — updated tray behavior coverage for the memory-only menu, tooltip, watcher, and R10 Quit item.
- `apps/ptah-electron/src/main.ts` — simplified tray setup and last-window quit delegation.
- `apps/ptah-electron/src/main.quit-path.spec.ts` — covers non-darwin quit and darwin stay behavior.
- `apps/ptah-electron-e2e/src/specs/tray-keepalive.spec.ts` — deleted retired keepalive e2e suite.
- `apps/ptah-electron-e2e/src/specs/tray-icon-packaging.spec.ts` — kept the icon path packaging assertion and removed the keepalive failure scenario.
- `apps/ptah-electron-e2e/src/support/tray-home.ts` — removed the unused `seedTrayKeepalive` export.
- `libs/frontend/webview-e2e-harness/src/lib/scenarios/vscode-shell/vscode-host.ts` — replaced stale host-config comment reference.
- `libs/frontend/webview-e2e-harness/src/lib/scenarios/vscode-shell/config-menu-absent.e2e.spec.ts` — replaced stale scenario comment reference.
- `libs/frontend/webview-e2e-harness/src/lib/scenarios/marketplace/marketplace.fixtures.ts` — replaced stale host and RPC pattern comment references.
- `libs/frontend/webview-e2e-harness/src/lib/scenarios/marketplace/marketplace-routes.e2e.spec.ts` — replaced stale scenario comment reference.
- `libs/frontend/webview-e2e-harness/src/lib/scenarios/marketplace/lock-popover-stacking.e2e.spec.ts` — replaced stale RPC pattern comment reference.
- `libs/frontend/webview-e2e-harness/src/lib/scenarios/boot/boot-progress.e2e.spec.ts` — replaced stale host-config comment reference.
- `apps/ptah-electron-e2e/src/showcase/scripts/skills-tour.json` — replaced retired pipeline narration with six Library lines.
- `apps/ptah-electron-e2e/src/showcase/skills-tour.scene.ts` — updated the scene header to match the narration.
- `apps/ptah-electron-e2e/src/showcase/thoth-tour.scene.ts` — replaced retired Skills hero selectors with current Library selectors.
- `apps/ptah-electron-e2e/src/showcase/scripts/thoth-tour.json` — made the Skills beat describe the Library.

## Preserve check

The tray template still contains **Pause memory** and **Quit Ptah**; `trayTooltip` still reports memory pause. `assertQuitItemPresent` still rejects a missing, disabled, or inert Quit item before mounting the menu. The unit spec retains those R10 assertions. The last-window handler quits on non-darwin and leaves darwin running. No other `apps/ptah-electron` file had a hit in the requested retired-symbol search. `clones-view`, `clones-row`, `clones-empty`, `skills-pause-switch`, and `skills-telemetry-switch` were verified in current component templates, so the Skills scene row selector was retained.

## New Skills narration

1. The Library brings your skills, agents, and commands together.
2. Use Pause Skills to control when skills are available.
3. Skill telemetry has its own switch.
4. Browse the Library entries below.
5. Each card shows invocations and a success rate from task reviews, or No grade when there is no grade yet.
6. Your Library is ready when you need it.

## Decisions

- **Keep `clones-row` in the scene.** The current Library template defines it, alongside `clones-view` and `clones-empty`. Switching to a card selector would lose the verified row target. Reversible.
- **Use `boot-progress.e2e.spec.ts` for RPC responder comment links and `marketplace.fixtures.ts` for the VS Code host-config link.** The boot spec defines `installRpcAutoResponder`; the marketplace fixture defines the VS Code host shape. Neither comment points at itself. Reversible.
- **Keep the tray icon packaging path check.** It independently verifies the icon asset path and does not require the retired keepalive behavior. Reversible.

## Could not do

Tests, typechecks, lint, builds, e2e, and Electron launches were intentionally not run, as directed. The orchestrator owns verification. No other work was blocked.
