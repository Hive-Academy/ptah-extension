# Code Logic Review — `TASK_2026_524_mkpl`

## Summary

| Metric              | Value                   |
| ------------------- | ----------------------- |
| Overall score       | 7/10                    |
| Assessment          | APPROVED                |
| Blocking issues     | 0                       |
| Serious issues      | 0                       |
| Moderate issues     | 1                       |
| Failure modes found | 2 (1 moderate, 1 minor) |

Scope reviewed: `libs/frontend/core/src/lib/marketplace/**`,
`libs/frontend/core/src/lib/services/plugin-catalog.service.ts`, the
marketplace-section export of `libs/frontend/core/src/index.ts`,
`libs/frontend/chat-ui/**`, `chat-empty-state.component.ts`,
`mcp-status-chip.component.ts`, `chat/src/lib/components/index.ts`,
`libs/frontend/marketplace/**`, `dashboard/.../skill-selection-card/**`,
`apps/ptah-electron-e2e/src/specs/marketplace/**`,
`apps/ptah-electron-e2e/src/showcase/marketplace-tour.*`. Every file in this
list was read in full (not diff-only) for `connected-surface.component.ts`,
`marketplace-state.service.ts`, `marketplace-hub.component.{ts,html}`,
`apps-section.component.ts`, `skills-section.component.ts`,
`plugin-catalog-panel.component.ts`, `marketplace-section.ts`,
`mcp-status-chip.component.ts`, `chat-empty-state.component.ts`,
`skill-selection-card.component.ts`; the rest were read via the batch reports
plus targeted greps for leftover references, `as any`/`@ts-ignore`, and
deleted-symbol usage.

## Verification performed

- `npx nx run-many -t test -p @ptah-extension/marketplace @ptah-extension/chat-ui @ptah-extension/chat @ptah-extension/core @ptah-extension/dashboard --skip-nx-cache`
  — header confirmed: `Running target test for 5 projects` /
  `Successfully ran target test for 5 projects` on a clean re-run.
  One earlier parallel run showed `connectors-surface.component.spec.ts ›
Smithery setup poll › gives up after five minutes` failing on a 5000ms jest
  timeout; re-run alone it passes (15.5s, 279/279). That spec is outside this
  task's file list (`connectors-surface.component.ts` was explicitly "left
  alone" per the plan) and the failure is a fake-timer/real-timer race under
  worker contention, not a regression from this change — flagging as a
  pre-existing flake, not a task defect.
- `npx nx run-many -t lint -p` the same five projects — `Successfully ran
target lint for 5 projects`, 0 errors.
- `grep` for `PluginBrowserModalComponent`, `PluginStatusWidgetComponent`,
  `ptah-plugin-browser-modal`, `ptah-plugin-status-widget`,
  `PluginsSurfaceComponent`, `ptah-plugins-surface`, `MARKETPLACE_PROVIDERS`,
  `ComingSoonPlaceholderComponent` across `libs` and `apps` — zero code,
  template or barrel references remain; five prose hits survive, all past
  tense except one (see Moderate/minor issues).
- `grep` for `as any`, `@ts-ignore`, `eslint-disable` in every touched file —
  zero new occurrences; the two pre-existing `eslint-disable` hits are in
  files outside this task's diff.

## Five logic questions

### 1. How does this fail silently?

- `ConnectedSurfaceComponent.decorateAppStatuses` (`connected-surface.component.ts:587-631`)
  swallows every Smithery/OAuth status-read failure into "no badge" — by
  design, and correctly scoped: it never touches a group's `state`, so a
  decoration failure cannot be mistaken for a load failure. This is
  intentional silent degradation and matches the plan.
- `MarketplaceHubComponent.loadInstalledServerKeys` (`marketplace-hub.component.ts:120-136`)
  silently keeps the previous key set on any failure. This is also
  deliberate (documented rationale: an empty set would resurrect duplicate
  rows) and the MCP Registry surface reports its own failure independently,
  so the user is not left uninformed.
- Nothing in the reviewed scope catches an error and reports success to the
  caller; every genuine RPC failure surfaces as `state: 'error'` with a
  message and a Retry (`connected-surface.component.ts:444-578`).

### 2. What user action produces unexpected behaviour?

Removing a row from the Connected view while it is the active section fires
**two** overlapping reloads of all four groups instead of one targeted
reload — see Moderate issue below. The user sees no incorrect data in the
common case (both reads return the same post-removal state), but the group
flips through `LOADING` twice and the surface issues roughly double the RPC
traffic the plan's own performance budget allows ("at most `4 + 1 +
n(oauth)` reads per load", `implementation-plan.md:577`).

### 3. What input data produces a wrong answer?

None found that survives to the rendered row. `parseMarketplaceTarget` is
exhaustively tested against the seven retired ids, `null`, `''`,
`'apps:'`, `'apps:nonsense'`, and cross-section source mismatches
(`marketplace-section.ts:108-122`), and degrades safely in every case.
`groupInstalledServers`/`toConnectorRows` re-derivation
(`connected-surface.component.ts:457-470`) means a connector already present
in `listInstalled` cannot double-render, which was the one place duplicate
rows were plausible.

### 4. What happens when a dependency fails?

Each of the four Connected groups fails independently under
`Promise.allSettled` (`connected-surface.component.ts:418-425`), with its
own Retry that re-runs only that group's loader (`:427-442`). A failed
removal sets an inline error on the row's group without a Retry button (the
Retry only renders for `state === 'error'`, not for a removal error on an
otherwise `ready` group — `:180,243` template branches), matching the plan's
"leave the row in place" requirement. `PluginCatalogPanelComponent`'s
skill-selection read is isolated from the catalogue read exactly as the
modal was (`plugin-catalog-panel.component.ts:1085-1113`; catalogue failure
never calls `clearSkillSelection()`, `:1162-1173`).

### 5. What is missing that the requirements never mentioned?

- No request-sequencing / epoch guard on the four `load*` methods in
  `ConnectedSurfaceComponent` (only `decorateAppStatuses` has one, via the
  `this.appGroups() !== groups` check at `:629`). Two overlapping loads of
  the same group have no way to detect which response is newer; see Moderate
  issue.
- `hasEnabledPlugins()` (used to suppress the "Skills Not Configured"
  warning at `chat-empty-state.component.ts:253`) is unchanged and, per
  `plugin-catalog.service.ts`, still reads only
  `config()?.enabledPluginIds.length` — a workspace whose only live plugins
  are opt-out (harness/skills.sh) will show `enabledCount() > 0` in the
  Connected view and the Skills header while the chat warning still says
  "Skills Not Configured". This is a pre-existing gap (flagged independently
  by both B1a and B3's own reports) that this task did not introduce and
  `context.md`/the plan do not ask B2 to fix, so it is not attributed as a
  new defect, but it is a real, currently-reachable inconsistency across two
  surfaces this same task touched.

## Failure modes

### Double reload / unguarded race after a Connected-view removal

- Trigger: user removes any row in the Connected view (`connected-surface.component.ts:671-697`)
  while the Connected section is the one mounted.
- Symptom: the affected group flashes to `loading` twice; the surface issues
  a second full four-group `Promise.allSettled` load on top of the
  single-group `retry()` the removal already triggered, with no ordering
  guarantee between the two.
- Evidence:
  - `remove()` calls `this.retry(groupId)` (a single-group reload) and then
    `this.contentChanged.emit()` in the same synchronous block
    (`connected-surface.component.ts:688-690`).
  - The hub's `onContentChanged()` handles `contentChanged` by calling
    `this.state.notifyContentChanged()` (`marketplace-hub.component.ts:168-171`),
    which bumps `MarketplaceStateService.refreshTrigger`
    (`marketplace-state.service.ts:105-107`).
  - `ConnectedSurfaceComponent`'s own `refreshEffect` is subscribed to that
    same `refreshTrigger` input and calls `void this.loadAll()` — a full
    four-group reload — on every bump after the first
    (`connected-surface.component.ts:406-410`).
  - None of `loadApps`/`loadPlugins`/`loadCommunity`/`loadMarketplaces`
    (`:444-578`) checks whether a newer call has superseded it before
    calling `.set(...)` on its load/rows signals — unlike
    `decorateAppStatuses`, which explicitly guards with
    `if (this.appGroups() !== groups) return;` (`:629`). Two concurrent
    `loadApps()` runs will each independently reset state to `LOADING` and
    then unconditionally overwrite it with whatever they receive, in
    whichever order the two `mcpDirectory:listInstalled` calls happen to
    resolve.
- Current handling: none — the redundant call is not deduplicated,
  coalesced, or cancelled, and no test in
  `connected-surface.component.spec.ts` exercises the retry-plus-refresh
  interaction (its `refreshTrigger` case at `:553` only checks the reload
  path in isolation).
- Recommendation: either (a) have `remove()`'s success path emit
  `contentChanged` and rely solely on the hub's `refreshTrigger` bump
  (dropping the direct `this.retry(groupId)` call), or (b) give each
  `load*` an increasing request token and ignore a response whose token is
  stale, the same pattern `decorateAppStatuses` already uses. Either removes
  the duplicate RPC burst and the unguarded race window.

### Stale present-tense doc comment naming deleted components

- Trigger: none — this is a static-text defect, not a runtime one.
- Symptom: a future reader of `plugin-catalog.service.ts` is told
  `PluginStatusWidgetComponent` and `PluginBrowserModalComponent` "fetch"
  the shared config, both in the present tense, though both were deleted in
  this same task (batch B4).
- Evidence: `plugin-catalog.service.ts:22-23`. This file is explicitly
  in-scope for this review (it is named in the task's own file list), and
  B4's own report (`batch-b4-report.md:212-217`) flags it as "the one
  genuinely misleading leftover" it could not fix because `core` was outside
  B4's batch ownership.
- Current handling: left as-is; no batch claimed ownership of this file
  after B1a landed `enabledPlugins`.
- Recommendation: a one-line follow-up swapping the two names for
  `SkillsSectionComponent`'s header and `PluginCatalogPanelComponent`, as
  B4 itself recommends.

## Blocking issues

None found.

## Serious issues

None found.

## Moderate and minor issues

- Moderate: double reload / unguarded race after a Connected-view removal —
  `connected-surface.component.ts:406-410,685-690`,
  `marketplace-hub.component.ts:168-171`. See Failure modes above.
- Minor: stale present-tense doc comment — `plugin-catalog.service.ts:22-23`.
- Minor (pre-existing, not introduced here): `hasEnabledPlugins()` can
  disagree with `enabledCount()`/`enabledPlugins()` for opt-out-only
  workspaces, visible now that both the chat warning and the new Connected
  view/Skills header render off the same catalogue —
  `plugin-catalog.service.ts` (`hasEnabledPlugins`, unchanged this task),
  `chat-empty-state.component.ts:253`. Flagged by B1a and B3's own reports;
  out of this task's stated scope to fix.

## Data flow

1. `AppStateManager.marketplaceActiveProvider` (string) — OK, unchanged
   storage key, new grammar owned entirely by `parseMarketplaceTarget`.
2. `MarketplaceStateService.activeSection`/`activeSource` — OK, `computed`
   over app state, never snapshotted, verified total over every malformed
   input (spec + my own read of `marketplace-section.ts:108-122`).
3. Deep link adoption (`chat` → `core.encodeMarketplaceTarget` →
   `appState.setMarketplaceActiveProvider` → `MarketplaceStateService`'s
   constructor `effect` → `consumeDeepLink()`) — OK, converges in at most two
   effect passes by construction (the normalized write has no `:`), no
   observed loop.
4. `MarketplaceHubComponent` → one section composer → one mounted surface —
   OK, `@switch`/`@if` guarantees at most one surface mounted, matching the
   "unselected section/chip fires zero RPC" rule; verified by reading
   `marketplace-hub.component.html` and both section composers directly.
5. `ConnectedSurfaceComponent` four-group load — OK for correctness, GAP for
   reload sequencing on removal (see Moderate issue). Status decoration is
   correctly isolated from row/group state.
6. Removal → `contentChanged` → `commandDiscovery.clearCache()` +
   `notifyContentChanged()` → `refreshTrigger` → every mounted surface
   reloads — OK as a mechanism, but the Connected surface's own direct
   `retry()` plus this fan-out is the redundant double path above.
7. `PluginCatalogPanelComponent` load/save ordering — OK, verified
   byte-for-byte against the modal's documented load-bearing ordering
   (skill-selection read outside/before the catalogue `try`; catalogue
   failure never clears the skill selection; `saveConfiguration` awaits
   `catalog.refresh()` before emitting `saved`).

## Requirements fulfilment

| Requirement                                                  | Status   | Gap                                                                                                                                                                  |
| ------------------------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC1 — three sections, no tile grid                           | COMPLETE | Verified in `marketplace-hub.component.html`; overview grid and `backToOverview` are gone.                                                                           |
| AC2 — Connected section lists everything with working remove | COMPLETE | All four groups wired to real RPCs with per-kind removal routing; see Moderate issue for a reload inefficiency, not a missing-action gap.                            |
| AC3 — Ptah plugin catalog inline, no modal remains           | COMPLETE | `PluginBrowserModalComponent` deleted repo-wide; `PluginCatalogPanelComponent` hosted by both the Skills section and the dashboard card.                             |
| AC4 — chat welcome screen has no tab bar/widget/modal        | COMPLETE | Verified in `chat-empty-state.component.ts`; tab bar, Ptah Skills card, widget and modal are all removed.                                                            |
| AC5 — old persisted provider id opens Connected              | COMPLETE | `parseMarketplaceTarget` degrades every retired id and unparsable value to `connected`, verified by direct read of the total function and its doc-cited test matrix. |
| AC6 — mcp-status-chip opens a valid section                  | COMPLETE | `navigateToMarketplace` now writes `encodeMarketplaceTarget('apps', source)`; verified in `mcp-status-chip.component.ts:388-393`.                                    |
| AC7 — lint, module-boundary lint, five projects' tests pass  | COMPLETE | Reran both `test` and `lint` for the five projects myself; both green (one flaky, out-of-scope spec observed on a parallel run, passed in isolation).                |

Implicit requirements not addressed: none identified beyond the two issues
above, both of which are either non-blocking (the reload race) or explicitly
pre-existing and out of this task's stated scope (the `hasEnabledPlugins`
drift).

## Edge cases

| Case                                                          | Handled | How                                                              | Concern                              |
| ------------------------------------------------------------- | ------- | ---------------------------------------------------------------- | ------------------------------------ |
| Retired persisted id (`connectors`, `official-mcp`, …)        | YES     | `parseMarketplaceTarget` degrades to `connected`                 | None                                 |
| `null` / `''` / `'apps:'` / `'apps:nonsense'` persisted value | YES     | Same total function                                              | None                                 |
| Deep link arrives while hub already mounted                   | YES     | Constructor `effect` on `MarketplaceStateService`                | None                                 |
| One Connected group's RPC fails, others succeed               | YES     | Independent `state` per group under `Promise.allSettled`         | None                                 |
| Connector row also present in `listInstalled`                 | YES     | Re-derived via `toConnectorRows` against this surface's own read | None                                 |
| `removal: 'none'` row                                         | YES     | Renders `removalBlockedReason`, no remove button                 | None                                 |
| Removal while another removal is pending                      | YES     | `pendingId()` guard in `remove()` returns early                  | None                                 |
| Removal success while Connected section is active             | PARTIAL | `retry(groupId)` + `contentChanged` fan-out both reload          | Redundant, racy — see Moderate issue |
| Opt-out-only workspace's "configured skills" signal           | NO      | `hasEnabledPlugins()` unchanged                                  | Pre-existing, not this task's scope  |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: a Connected-view removal issues a redundant, unguarded second
  reload of all four groups (`connected-surface.component.ts:406-410` vs.
  `:685-690`), which wastes RPC budget and leaves a real (if narrow) race
  window with no request-sequencing guard, unlike the pattern already used
  for status decoration in the same file.
- What a robust implementation would add: a request-epoch guard on the four
  `load*` methods (matching `decorateAppStatuses`'s own pattern), or drop
  the direct `retry()` call in `remove()` and rely solely on the
  `refreshTrigger` fan-out already wired for every other surface.
