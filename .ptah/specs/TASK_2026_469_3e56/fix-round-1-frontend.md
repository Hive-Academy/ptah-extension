+# Fix round 1 — frontend

## Item status

1. **Fixed** — sync actions capture the initiating workspace and only publish/refresh while it remains active.  
   Source: `libs/frontend/git-ui/src/lib/git-dock/git-dock-header.component.ts:250`  
   Test: `does not publish or refresh a sync result after the workspace changes` (`git-dock-header.component.spec.ts:243`)

2. **Fixed** — `fetchGitInfo()` uses `try/catch/finally`; loading always clears and `refresh()` does not reject.  
   Source: `libs/frontend/git-ui/src/lib/services/git-status.service.ts:326`  
   Tests: `keeps refresh best-effort and clears loading when git:info rejects` (`git-status.service.spec.ts:278`); `clears loading when a refresh becomes stale after a workspace switch` (`git-status.service.spec.ts:289`)

3. **Fixed** — successful stash mutations return their Git outcome even when reconciliation rejects, and surface the requested completed-but-refresh-failed error after all refreshes settle.  
   Source: `libs/frontend/git-ui/src/lib/services/git-stash.service.ts:227`  
   Test: `returns a successful mutation when reconciliation rejects` (`git-stash.service.spec.ts:191`)

4. **Fixed** — stash-list responses are ordered by per-workspace generation; mutations invalidate older list reads; identity-mismatch failures reload the list.  
   Source: `libs/frontend/git-ui/src/lib/services/git-stash.service.ts:110`  
   Tests: `keeps the latest same-workspace stash list response` (`git-stash.service.spec.ts:111`); `invalidates a pre-mutation list response before reconciling` (`git-stash.service.spec.ts:350`); `reloads the list when the backend detects a shifted stash index` (`git-stash.service.spec.ts:209`)

5. **Fixed** — stash show/apply/pop/drop carry `expectedHash`; historical refs use the full hash; selection and interaction generations are rechecked after both awaits; busy state disables entries and files.  
   Source: `libs/frontend/git-ui/src/lib/services/git-stash.service.ts:200`, `libs/frontend/git-ui/src/lib/services/git-stash.service.ts:252`, `libs/frontend/git-ui/src/lib/services/git-stash.service.ts:307`, `libs/frontend/git-ui/src/lib/stash/stash-popover.component.ts:78`  
   Tests: `opens a stash file as a historical parent-vs-stash diff tab` (`git-stash.service.spec.ts:224`); `does not open a diff when the stash selection changes during ref resolution` (`git-stash.service.spec.ts:290`); `does not open a diff when a mutation starts during ref resolution` (`git-stash.service.spec.ts:321`); `disables entry and file actions while a mutation is busy` (`stash-popover.component.spec.ts:115`)

6. **Fixed** — historical tabs use the stash message plus the first seven hash characters, independent of positional stash indices.  
   Source: `libs/frontend/git-ui/src/lib/services/git-stash.service.ts:400`  
   Test: `opens a stash file as a historical parent-vs-stash diff tab` (`git-stash.service.spec.ts:224`)

7. **Fixed** — a generation guard prevents late `settings:get` from replacing a newer choice, and `choose()` restores caret focus.  
   Source: `libs/frontend/git-ui/src/lib/open-in/open-in-button.component.ts:201`, `libs/frontend/git-ui/src/lib/open-in/open-in-button.component.ts:216`  
   Test: `keeps a user choice made while settings:get is in flight and restores caret focus` (`open-in-button.component.spec.ts:202`)

8. **Fixed** — drop confirmation is a `linkedSignal` reset by `isOpen`; the effect only loads the list.  
   Source: `libs/frontend/git-ui/src/lib/stash/stash-popover.component.ts:191`  
   Test: `resets drop confirmation when the popover open state changes` (`stash-popover.component.spec.ts:125`)

9. **Fixed** — Apply, Pop, Drop, and confirm Drop expose contextual stash-ref labels.  
   Source: `libs/frontend/git-ui/src/lib/stash/stash-popover.component.ts:105`, `libs/frontend/git-ui/src/lib/stash/stash-popover.component.ts:123`, `libs/frontend/git-ui/src/lib/stash/stash-popover.component.ts:133`, `libs/frontend/git-ui/src/lib/stash/stash-popover.component.ts:143`  
   Test: `adds contextual labels to stash actions` (`stash-popover.component.spec.ts:100`)

10. **Fixed** — zero-count Pull/Push controls announce plain “Pull”/“Push”.  
    Source: `libs/frontend/git-ui/src/lib/git-dock/git-dock-header.component.ts:163`, `libs/frontend/git-ui/src/lib/git-dock/git-dock-header.component.ts:183`  
    Test: `always shows Pull and Push, with the counts moved off the branch button` (`git-dock-header.component.spec.ts:183`)

Owner decisions preserved: `GitStashService` was not exported from `src/index.ts`, and the caret remains visible with one target.

## Verification

`npx nx run @ptah-extension/git-ui:test --skip-nx-cache`

```text
Test Suites: 27 passed, 27 total
Tests:       405 passed, 405 total
Snapshots:   0 total
Time:        24.751 s
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
