# Fix round 2 — frontend

## Item status

1. **Fixed** — `fetchGitInfo()` uses a fetch generation token; only the latest fetch clears `isLoading`.
   - Source: `libs/frontend/git-ui/src/lib/services/git-status.service.ts:328`
   - Test: `does not clear isLoading when a stale fetch settles while a newer fetch is pending` (`libs/frontend/git-ui/src/lib/services/git-status.service.spec.ts:306`)

2. **Fixed** — `choose()` restores focus to the caret only when the menu item was activated from the open menu by keyboard (or when focus was inside the menu); never moves focus on a primary-button or mouse click.
   - Source: `libs/frontend/git-ui/src/lib/open-in/open-in-button.component.ts:197`
   - Tests: `does not move focus to the caret when the primary button is clicked` (`libs/frontend/git-ui/src/lib/open-in/open-in-button.component.spec.ts:234`), `does not restore focus to the caret on mouse click of a menu item` (`libs/frontend/git-ui/src/lib/open-in/open-in-button.component.spec.ts:248`)

3. **Fixed** — `confirmDrop` linkedSignal resets when the active workspace, popover open state, or stash entries change; confirmation is keyed by entry commit hash rather than positional index.
   - Source: `libs/frontend/git-ui/src/lib/stash/stash-popover.component.ts:93`, `libs/frontend/git-ui/src/lib/stash/stash-popover.component.ts:193`
   - Tests: `resets drop confirmation when the stash entries change` (`libs/frontend/git-ui/src/lib/stash/stash-popover.component.spec.ts:147`), `resets drop confirmation when the active workspace changes` (`libs/frontend/git-ui/src/lib/stash/stash-popover.component.spec.ts:164`)

4. **Fixed** — `select()` and `loadListFor()` early returns do not leave `filesLoading` / `listLoading` stuck true; the loading flag is cleared in `finally` (and on collapse) when no newer request owns it.
   - Source: `libs/frontend/git-ui/src/lib/services/git-stash.service.ts:163`, `libs/frontend/git-ui/src/lib/services/git-stash.service.ts:184`, `libs/frontend/git-ui/src/lib/services/git-stash.service.ts:226`
   - Test: `clears filesLoading when an in-flight stashShow is collapsed` (`libs/frontend/git-ui/src/lib/services/git-stash.service.spec.ts:380`)

5. **Fixed** — `mutate()` does not overwrite a real list-reload failure with `STASH_LIST_CHANGED_ERROR`.
   - Source: `libs/frontend/git-ui/src/lib/services/git-stash.service.ts:307`
   - Test: `preserves a real list-reload failure instead of overwriting with STASH_LIST_CHANGED_ERROR` (`libs/frontend/git-ui/src/lib/services/git-stash.service.spec.ts:409`)
   - Scope: this proves the directly awaited reload failure is preserved. It does not cover a mutation reload later superseded by a newer failed reload; that remaining defect is recorded in the final frontend logic review and fixed by the subsequent PR-review pass.

6. **Fixed** — a failed mutation that invalidated in-flight list reads triggers a recovery reload while preserving the mutation's error outcome.
   - Source: `libs/frontend/git-ui/src/lib/services/git-stash.service.ts:314`
   - Test: `triggers a recovery list reload when a mutation fails and restores the mutation error` (`libs/frontend/git-ui/src/lib/services/git-stash.service.spec.ts:427`)
   - Scope: this proves the recovery reload applies and the mutation error is restored in that named scenario. It does not prove a superseded recovery reload cannot overwrite a newer reload failure; that remaining defect is recorded in the final frontend logic review and fixed by the subsequent PR-review pass.

7. **Fixed** — concurrent `openFileDiff` calls use a per-call token so only the latest clicked file request opens and activates a diff tab.
   - Source: `libs/frontend/git-ui/src/lib/services/git-stash.service.ts:358`
   - Test: `only opens the latest clicked file diff when concurrent openFileDiff requests resolve out of order` (`libs/frontend/git-ui/src/lib/services/git-stash.service.spec.ts:457`)

## Verification

`npx nx run @ptah-extension/git-ui:test --skip-nx-cache`

```text
Test Suites: 27 passed, 27 total
Tests:       414 passed, 414 total
Snapshots:   0 total
Time:        28.267 s
Ran all test suites.
NX   Successfully ran target test for project @ptah-extension/git-ui
```

`npx nx run @ptah-extension/git-ui:lint`

```text
✖ 1 problem (0 errors, 1 warning)
NX   Successfully ran target lint for project @ptah-extension/git-ui
```

The warning is the pre-existing `diff-view.component.ts` max-lines warning.

`npx nx run @ptah-extension/git-ui:typecheck`

```text
NX   Successfully ran target typecheck for project @ptah-extension/git-ui
```
