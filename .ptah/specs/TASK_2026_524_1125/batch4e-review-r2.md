# Batch 4e cross-side review, round 2 — APPROVE

## Round-1 defect

**Resolved.** The Thoth rail invokes `selectTab` only on tab clicks (`libs/frontend/thoth-shell/src/lib/components/thoth-shell.component.ts:145`); `selectTab` now passes `{ replaceUrl: true }` (`:390-395`). The core router forwards that flag to `navigateByUrl` (`libs/frontend/core/src/lib/routing/surface-router.service.ts:128-151,242-259`). A switch from `/thoth/memory` to Skills therefore replaces the current history entry, as D6 requires.

## Cross-side checks

- Existing two-argument and default callers retain the single-argument `navigateByUrl(tree)` call (`surface-router.service.ts:257-259`). The added `replaceUrl: false` case also uses that path.
- The `navigated` / `already-there` / `cancelled` mapping still uses the same pre-navigation target comparison and post-navigation URL (`surface-router.service.ts:246-263`); the replace flag only changes the Router extras.
- The Thoth routed click spec checks `SpyLocation.urlChanges` for exactly `replace: /thoth/skills` (`thoth-shell.component.spec.ts:327-357`), which distinguishes replacement from a push. Core specs also exercise Back to `/settings` after replacement and Back to the preceding tab after a default push (`surface-router.service.spec.ts:417-465`).
- Initial Thoth entry goes through `AppStateManager.requestSurface` and the default `navigateToSurface` call (`app-state.service.ts:601,1061`), so it pushes. `selectTab` has no initialization call; its sole production call is the rail click (`thoth-shell.component.ts:145,390`). Route settlement and remount update the tab signal without navigating (`:288-314`).

No round-2 defects found. Review was static as requested; tests and builds were not run.
