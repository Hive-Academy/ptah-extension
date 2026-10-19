# Code Logic Review, Phase 1 (1A, 1B, 1C) - TASK_2026_702_594d

Review family: Anthropic (reviewer) / codex (implementer)

Scope read in full: `setup-status.store.ts` and spec, deleted widget (read from HEAD), `project-setup-card.component.ts`, `chat-empty-state.component.ts`, `aurora-effect.component.ts`, `native-popover.component.ts` (anchor path) and spec diff, packaging diffs, `aurora-notices.txt` (byte-identical to prototype), `PluginCatalogService`, `WorkspaceScopeService`, `setup-rpc.handlers.ts` (launch). Batches 2A/2B ignored. No checks were run, per instruction. Visual and CPU claims below are unverified without a browser and are marked so.

## Summary

| Metric | Value |
| --- | --- |
| Score | 5.5/10 |
| Verdict | REVISE |
| Blocking | 0 |
| Serious | 4 |
| Moderate | 7 |
| Minor | 4 |

The count/truth model is right in shape (Project scan uncounted, null while unknown, workspace-keyed snapshot, request-id plus scope-key stale guard). The defects are in when the truth is refreshed, how loading and error states are worded, and one layering problem in the single-chat Aurora.

## Serious

### S1. Readiness goes stale after the wizard finishes; "Ready" is never reached without a workspace switch
- Evidence: `setup-status.store.ts:44-53` (refresh only on scope-key change), `:95-108` (refresh once, right after `setup-wizard:launch` resolves), `project-setup-card.component.ts:44-49` (no mount-time refresh). `setup-rpc.handlers.ts:237-262` shows `setup-wizard:launch` only opens the wizard webview and returns; it does not wait for completion.
- Scenario: user clicks Configure, the wizard opens, the refresh in `finally` reads "not configured", the user completes the wizard, returns to the start screen. The card still says "Not configured" and "1 of 2 ready" (or less) until a workspace switch or reload. The old widget re-fetched on every mount (`setup-status-widget.component.ts` `ngOnInit`), so this is a regression the move to a root store introduced, and the Ready strip (decision #8) becomes effectively unreachable after the first setup.
- Required change: re-read status whenever the card (re)mounts or the surface becomes visible again (card `ngOnInit` calling a deduped `refresh()`, plus `visibilitychange`/window focus), with in-flight dedupe so N mounts cost one request. Add a spec: mount, status flips host-side, remount, count updates.

### S2. Constructor effect tracks catalog signals: duplicate status reads and spurious state resets
- Evidence: `setup-status.store.ts:45-52`. `this.catalog.ensureLoaded()` synchronously reads `isLoaded()` (and through it `_snapshot`) (`plugin-catalog.service.ts` `ensureLoaded`/`current`), and `refresh()` reads `scope.scopeKey()`. Those sync reads run inside the effect, so the effect also depends on the catalog snapshot.
- Scenario: first mount triggers catalog load; when its snapshot lands (and on every Retry, which calls `catalog.refresh()`), the effect re-runs: it clears `error`, `launchError`, `workspaceNotOpen` and fires a second `setup-status:get-status`. Visible effects: an error alert disappears while its cause remains, `isLoading` flips true again (see M1), and a duplicate 10s RPC per catalog load.
- Why the spec misses it: `setup-status.store.spec.ts:13` mocks `ensureLoaded` as a bare `jest.fn()` that reads no signal.
- Required change: wrap the body after `this.scope.scopeKey()` in `untracked(...)` (or call `ensureLoaded`/`refresh` inside `untracked`). Add a spec using the real `PluginCatalogService` (or a mock whose `ensureLoaded` reads `loaded()`), asserting exactly one `setup-status:get-status` call after a catalog snapshot change.

### S3. Ready strip drops the Skills action ("Open Library"); decision #8 says it keeps all actions
- Evidence: `project-setup-card.component.ts:11-17` (strip has Run setup, Generate agents, Project guidance only) versus `decisions.md` #8 and plan line "Preserve ... route ... and Ready strip". `openLibrary()` (`:48`) is reachable only from the expanded card. The spec test "keeps all actions in the Ready strip" asserts three buttons, so it encodes the omission.
- Impact: once both rows are ready, the user has no route to the Skills library from the start screen (parity row "Open Marketplace Skills goes to the skills source").
- Required change: add Open Library to the strip (and fix the spec). If the omission is intended, record it as a decision and amend #8.

### S4. Single-chat brand Aurora paints over the Get ready card and prompt suggestions (contrast)
- Evidence: `aurora-effect.component.ts:20-26` (host `position:absolute`, `z-index:0`, 300px tall in `brand`), `chat-empty-state.component.ts:55-57` (only the hero text block gets `relative z-10`; hero is roughly 130px tall), `:75-81` (card and suggestions are non-positioned siblings below).
- Scenario: a positioned `z-index:0` element paints above non-positioned in-flow content, so the lower ~170px of the Aurora overlays the card and the first suggestions with gold at .14 opacity. It is pointer-inert, but it tints card text and lowers contrast on the surface the design spec requires to meet 4.5:1 (`design-spec.md:50-56`). The card uses `surface-3` but the Aurora sits above it, not behind. Unverified visually; the layering rule is certain.
- Required change: put Aurora behind everything: `relative isolate` on the scroll container with the Aurora host at `z-index:-1`, or give `.tab-content-animated` and the footer `relative z-10`. Constrain the brand variant to the hero box (`height` equal to hero, or `overflow:hidden` on the hero wrapper). Add a visual/contrast check for single-chat dark and light.

## Moderate

- M1. Ready/Get-ready layout flips on every refresh. `setup-status.store.ts:28,32-33`: `isLoading` forces `agentsReady` to null even when a confirmed same-scope `status()` exists, so `allReady` collapses the strip into the expanded "Checking readiness" card on each refresh (post-wizard, retry, S2 duplicate). Required: stale-while-revalidate (null only when no same-scope snapshot exists).
- M2. Misleading wording for non-loading unknowns. `project-setup-card.component.ts:21,24,25`: with `workspaceNotOpen()`, a status error or a catalog error, `agentsReady`/`skillsReady` are null so the badge reads "Checking readiness" and rows read "Checking" indefinitely, with no spinner, beside an alert or an "Open a folder" line. Required: distinguish loading from unavailable ("Readiness unavailable", "Open a folder to check").
- M3. Generation actions enabled with no workspace. `project-setup-card.component.ts:28`: Generate agents and Project guidance are only disabled by `launching()`, while Run setup is also disabled by `workspaceNotOpen()`. The old widget hid all actions in that state. Click yields "Could not open generation" (`setup-status.store.ts:117-120`). Required: also disable on `workspaceNotOpen()`.
- M4. `openFolder` failure reuses the status `error` signal. `setup-status.store.ts:89,91` set `error`, so the card shows "Could not check setup. Please try again." with a Retry that re-reads status and never retries the folder open; the message is never cleared on the next successful action. Required: a separate fixed-copy signal (or reuse `launchError`) and clear it on the next success.
- M5. Popover external anchor is not defended against removal. `native-popover.component.ts:221-224`: `anchor()` is read once at open. If the hero/footer button was destroyed (empty board becomes populated when a tile is created, rail collapse re-render) the element is detached and floating-ui positions at 0,0; if neither anchor nor projected trigger exists the method returns silently, leaving a backdrop with an unpositioned, unfocused panel. Default projected-trigger behaviour is unchanged (default spec added, good). Required: `const a = this.anchor(); const trigger = a?.isConnected ? a : this.triggerRef()?.nativeElement;`, surface (dev-mode log plus visible fallback) when neither resolves, and add a disconnected-anchor spec.
- M6. Aurora animation cost and edge exposure (unverified, needs browser). `aurora-effect.component.ts:44-66`: the animated `::after` sits inside `.lights` carrying `filter: blur(10px)`, a radial `mask-image` and `mix-blend-mode: screen`; animating its transform forces the blur and mask to re-evaluate each frame over a 570px-high full-width area, so "only transform/opacity in perpetuity" does not imply compositor-only cost. Also `translateX(-25%..25%)` on an `inset:0` pseudo exposes an empty 25% strip at one edge, at the corner where the mask is strongest. Required: widen the pseudo (`inset: 0 -25%`), and take a CPU/GPU sample with the effect visible before sign-off (task says review CPU).
- M7. Capability dropped without a decision: last-updated relative time ("3 days ago") and singular/plural agent count from the old widget (`setup-status-widget` template, `formatRelativeTime`) are gone; `project-setup-card.component.ts:25` renders `{{ agentCount }} agents configured` (so "1 agents"). Required: restore pluralisation and either keep `lastUpdated` or record the removal in `decisions.md`.

## Minor

- `launchError` (`setup-status.store.ts:98,113`) is cleared only by the next launch or a workspace change; it persists across a successful refresh/retry and shows in the Ready strip (`card:32`).
- Launch buttons lost the loading spinner the old Configure/Update button had; `launching()` only disables.
- Spec gaps: no `workspaceNotOpen` path, no stale-response test on the failure branch (`store.ts:74`), no test that a late response after a switch cannot clear `pendingKey`/`isLoading` for the new scope, no mount-refresh test (S1), no real-catalog test (S2).
- Aurora `afterNextRender` callback registers `onDestroy` inside the render hook (`aurora-effect.component.ts:94-108`): works, but a component destroyed between creation and first render registers nothing, which is also nothing to leak. No action needed; noted for completeness.

## Required change: degradation-audit finding at `setup-status.store.ts:73`

Use a suppression comment, do not add logging. The catch already publishes a fixed, user-visible error with a Retry (`:75-76`; rendered at `card:30`), and the repo convention is exactly that (`libs/frontend/chat/.../session-organization-editor.component.ts:702`, `settings-save-feedback.service.ts:102`). Logging the caught object would reintroduce the backend-text exposure that decision "keep backend error details out of the card" removed. Add as the first line of the catch body, in the audited form:

```
// degradation-audit: reported - the failure is published on error() as fixed copy beside a Retry button; the thrown detail is withheld so backend text never reaches the card. The stale-scope early return is intentional: a newer read owns the state.
```

Apply the same marker to the other three catches (`:90`, `:102`, `:121`) if the audit begins flagging them, for consistency.

## Five logic questions

1. Silent failure: stale Agents truth after the wizard (S1); openFolder failure mislabelled as a status error (M4); a missing/removed popover anchor returns without a signal (M5).
2. Unexpected user action: Generate agents with no workspace (M3); re-opening the start screen after setup (S1); Retry while a catalog load completes (S2).
3. Wrong answer from valid data: a user with only opt-out (user-authored) skills reads "No skills enabled" because `hasEnabledPlugins` counts `enabledPluginIds` only (`plugin-catalog.service.ts` docs say opt-out plugins are live without appearing there). This matches the old warning, so parity holds, but the new "N of 2 ready" count now promotes it to a headline number; worth a decision.
4. Dependency failure: status RPC failure/timeout and `WORKSPACE_NOT_OPEN` handled with safe copy and the scope/id stale guard is correct; catalog failure suppresses the count correctly via `catalog.error()` (`store.ts:30`). Wording gaps in M2.
5. Missing from requirements: refresh policy for the root store; handling of anchor removal; Aurora stacking against sibling content.

## Parity inventory (setup/single-chat rows)

| Item | Status |
| --- | --- |
| Skills warning only after catalog load; Open Library route | PARTIAL: route missing in Ready strip (S3) |
| Setup explanation and badges | COMPLETE per design-spec.md:125 (moved to wizard) |
| Agent status, Configure/Update, retry, no-workspace | PARTIAL: lastUpdated and pluralisation dropped (M7); wording (M2) |
| Wizard launch (shared by Agents and Project scan) | COMPLETE |
| Generate agents / Project guidance, independent-start, failure copy | COMPLETE; enabled without workspace (M3) |
| Open Folder | COMPLETE; error reuse (M4) |
| Single-chat gating by `showProjectSetup`, logo, suggestions, footer | COMPLETE |
| Count honesty (Project scan uncounted, null while unknown) | COMPLETE |
| Ready strip keeps all actions (decision #8) | PARTIAL (S3) |

## Aurora and packaging checklist

- CSS-only: yes, no WebGL/JS animation. Reduced motion: static via media query and class, live updates via `matchMedia` listener (`aurora:89-100`). Paused when hidden/offscreen/`visible=false` and resumed by class removal. One observer and two listeners released on destroy. `aria-hidden` and `pointer-events:none` present. Single-chat low opacity .14 present; layering issue S4.
- Notice: `aurora-notices.txt` is identical to the prototype and contains the full MIT text and Omnedia copyright. VS Code and Electron `project.json` assets and `electron-builder.yml` `extraResources` mirror `brand-icons-notices.txt` exactly; the name does not match the `NOTICE*` exclusion and `apps/ptah-extension-vscode/.vscodeignore` has no `.txt` exclusion. Release-time package inspection remains open (as recorded).

## Verdict

- Recommendation: REVISE
- Confidence: MEDIUM-HIGH (S2 and S4 are derived from framework semantics, not run; M6 needs a browser)
- Top risk: the readiness card shows stale "Not configured" after setup completes because nothing refreshes the root store except a workspace switch (S1).
- Required before approval: S1, S2, S3, S4, the degradation-audit suppression, and M5; M1-M4 and M7 should ride along since they touch the same files; M6 needs a CPU/visual check.

## Re-review after fix round

Scope read in full: `setup-status.store.ts` and spec, `project-setup-card.component.ts` and spec, `chat-empty-state.component.ts` (hero template) and spec assertions, `aurora-effect.component.ts`, `native-popover.component.ts` open path and the detached-anchor spec. No checks were run, per instruction; visual claims are derived from CSS semantics.

Verdict: **APPROVED** (0 Blocking, 0 Serious, 1 Moderate new, 2 Minor new). Residual items are follow-ups, not gates.

### Findings status

| Finding | Status | Evidence |
| --- | --- | --- |
| S1 stale readiness | FIXED | Real signals, no timer: card `ngOnInit` refresh plus `visibilitychange` and window `focus` listeners, removed in `ngOnDestroy` (`card.ts` ngOnInit/onVisible); in-flight dedupe per scope key (`store.ts:60-68`). Remount and listener-cleanup specs exist (`card.spec.ts` "refreshes on mount...", "updates the count when a card remounts..."). Caveat: the remount spec mocks the store, so host-side flip is simulated; the real dedupe is covered in the store spec. |
| S2 effect tracks catalog | FIXED | Effect reads only `scopeKey()` then runs reset, `ensureLoaded` and `refresh` inside `untracked` (`store.ts:46-56`). Spec is a real tracking test: the mocked `ensureLoaded` reads `loaded()` synchronously (`store.spec.ts:13`), and the test flips `loaded`, flushes effects and asserts no extra `get-status` call, then Retry adds exactly one. Not mocked away; it would fail if the body were tracked. |
| S3 Ready strip action | FIXED | Strip has Open Library, Run setup, Generate agents, Project guidance (`card.ts:12-18`); spec asserts all four and clicks each with the right call args. |
| S4 Aurora overlap | FIXED | Aurora lives inside the hero `relative isolate overflow-hidden` wrapper, the card and suggestions are siblings outside it (`empty-state.ts:54-90`); brand host is `z-index:-1; height:100%` inside the isolated context, so it paints under the hero content and cannot reach the card. Host also has `overflow:hidden`. Structural specs in both themes. Contrast/CPU still unmeasured (needs browser). |
| M1 layout flip | FIXED | `status()` keeps the same-scope snapshot while a read is pending (`store.ts:33-37`); spec "keeps confirmed readiness while refreshing". |
| M2 unknown wording | FIXED | Three distinct states (`card.ts:22-26`), spec covers. |
| M3 no-workspace generation | FIXED | Both generation buttons disabled on `workspaceNotOpen` (strip not applicable: `allReady` implies a workspace). |
| M4 folder error | FIXED | Separate `folderError`, fixed copy, cleared on next attempt (`store.ts:102-110`), spec. |
| M5 detached anchor | FIXED | Connected anchor, else projected trigger, else visible+focused fallback with dev diagnostic (`popover.ts:220-232`); spec covers detached anchor to trigger. See N3 (the third branch is untested). |
| M6 Aurora edge/animation | PARTIAL | Blur moved to the moving pseudo layer, mask static, as asked; but see N1 (loop discontinuity). |
| M7 plural / last-updated | FIXED | Plural fixed; removal of last-updated is user-approved in decisions #17. |
| Minor: launch error persistence, spinner, spec gaps | FIXED | `store.ts:78,118-124`; spinner on the three wizard buttons; no-workspace, stale-failure, dedupe, remount specs added. |
| Degradation audit | FIXED | `store.ts:89` is the exact requested first-line comment, no logging added, backend text still withheld. |
| Spec weakening in follow-up | NONE FOUND | Stale-workspace spec still asserts `isConfigured` is not true after the old response lands; safe-failure spec still asserts the fixed copy and no `secret`; retry spec asserts `initialCalls` unchanged on catalog change and `+1` on Retry. The follow-up only added `await store.refresh()` to settle the constructor's deduped initial read first, which fixes a real test-ordering artifact (the one-shot mock was being consumed by the initial request) rather than loosening an expectation. |

### New defects introduced by the fixes

**N1 (Moderate). Aurora loop is not seamless and the shifted layer can expose its edge.** `aurora-effect.component.ts:57-61,76-79`. The `::after` layer is 150% of `.lights` wide (`inset: 0 -25%`) and animates `translateX(-25%)` to `translateX(25%)` of its own width (about 37.5% of the host) with `linear infinite` and no `alternate`. Every 60 s it snaps from the end position back to the start, a visible jump in the moving stripe pattern, and at the extremes the layer's left or right edge sits 12.5% inside the host, so the effect is a hard edge rather than continuous light (the static `.lights` background underneath hides a blank gap but not the discontinuity). The board variant has its opaque mask at the right edge, where this is most visible; the brand variant is masked and at 14% opacity so it is faint. Fix: animate `background-position` by exactly one gradient tile (as ngx-aurora does) or use `animation-direction: alternate`, and size the layer so travel never exposes an edge. Unverified visually.

**N2 (Minor). Remaining catches carry no audit marker.** `store.ts:105,121,139,146` (`openFolder`, `launchWizard`, `launchGeneration` catches) publish fixed copy so they are correct, but will be flagged if the degradation audit later scans them; the review's own optional note applied the same marker. Add if the audit flags them.

**N3 (Minor). The all-anchors-detached fallback is untested.** `popover.ts:223-228` (no connected anchor and no connected trigger: unpositioned, visible, focused, emits `opened`) has no spec; only the detached-anchor to trigger path is covered (`popover.spec.ts:117`).

### Open items

1. N1 Aurora animation loop discontinuity (Moderate, follow-up; needs a browser to judge severity).
2. N2/N3 optional hardening (Minor).
3. Still unmeasured per the fix report: dark/light contrast and Aurora CPU/GPU cost; the orchestrator's scoped check run remains the evidence for green specs.
