# Batches 4 and 7 report

## Files changed

- `libs/frontend/chat/src/lib/services/display-window/display-window-sync.service.ts` and `.spec.ts`: keep a stack of bound display sources. The Command Center binding takes focus while its page is mounted; its cleanup restores the chat source. One `DisplayWindowSync` still owns the one Electron window.
- `libs/frontend/command-center/src/lib/components/command-center-page.component.ts`: bind the page's shared `DisplayDockState` and computed `liveTarget().tabId` to that sync service on Electron, releasing it on destroy.
- `libs/frontend/command-center/src/lib/components/command-rail-display.component.ts` and `.spec.ts`: pass file items to the existing shared panel, map file keys back to dock selections, and expose Dock/Detach through `DisplayWindowSync`.
- `libs/frontend/chat/src/lib/components/templates/display-window/display-window.component.spec.ts`: assert the child passes file metadata and active selection into the shared panel without reading file content itself.

Batch 2/3 already added file metadata to the detached wire and shared panel. `DisplayFileViewerComponent` fetches with `file:viewContent` or `file:viewBinary` when the active item is mounted; `DisplayPanelComponent` mounts that viewer only for its active key. The child keeps sending selection and attach actions to the main renderer.

## Focus binding

The Command Center page binds its computed `liveTarget().tabId`, which follows the selected child when that child has an open chat tab and otherwise uses the root session tab. The most recently mounted source wins. When Command Center exits, its cleanup restores the existing chat source. Voice child sessions retain their display-only behavior.

## Specs

- `display-window.component.spec.ts`: metadata and selected file forwarded to the shared panel; no child-level content read.
- `command-rail-display.component.spec.ts`: file item mounted in the shared panel, file selection written to the dock, and Detach delegated to the existing window sync.
- `display-window-sync.service.spec.ts`: Command Center source takes the single window, routes selection to its dock, follows focused session changes, and restores chat binding.

## Decisions

- Reused the existing rail display component and panel because the page already mounts that panel and shares a dock with the Live embed; adding file input and the existing sync control is reversible.
- Kept focus ownership in `DisplayWindowSync` as an ordered binding stack because ChatView and Command Center can coexist while a route is active. Cleanup restores the prior binding without a second manager. This is reversible.

## Verification and Electron review risks

No Nx, Jest, build, serve or e2e command was run, as instructed. `ptah_get_diagnostics` was requested for all changed TypeScript files, but TypeScript checking remained unavailable after 45 seconds; it reported all six files unchecked. No rendered Electron window was available in this sandbox, so the visual review must check PDF iframe rendering under the Electron CSP, image sizing, and whether the Command Center's Dock/Detach header fits the rail at narrow widths. The detached spec verifies metadata forwarding, while the existing panel/viewer code enforces active-only fetch; the full Electron content path still needs review.
