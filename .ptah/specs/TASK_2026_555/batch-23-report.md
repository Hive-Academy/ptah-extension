# Batch 23 report: scope badge with field name (D16)

Executor: Providers owner (in-process frontend-developer).

- Worktree `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign`, on top of bb4502d59. Nothing committed.
- No git stash / restore / checkout / reset / clean.
- No `libs/frontend/ui`, `core`, `shared` or backend edits.
- `ProviderSetupWizardComponent` is untouched: it is absent from `git diff HEAD --stat`.

Paths are relative to `libs/frontend/chat/src/lib/settings/providers/`, unless prefixed with `HARNESS/`
(`libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/`). `SR` is `setting-scope-row.component.ts` and `PS` is
`providers-settings.component.ts`.

## Files

| Status | File | Lines | Role |
|---|---|---|---|
| MODIFIED | `setting-scope-row.component.ts` | 292 | Template rewritten as badge + popover; selector, inputs and outputs kept; new `shortFieldName` input |
| MODIFIED | `setting-scope-row.component.spec.ts` | — | Rewritten for the badge / popover contract |
| MODIFIED | `providers-settings.component.ts` | 685 | Passes `shortFieldName`; badges in one row; group row and dead override wiring removed; "Save provider to…" bridge; D6 clear copy |
| MODIFIED | `providers-settings.component.spec.ts` | — | Parent specs: badges, D6 clear review, "Save provider to…"; unused `groupScope` stub dropped |
| MODIFIED | `provider-connection-card.component.spec.ts` | — | 2 specs re-pointed from the old strip to the badge (test-only, outside the list) |
| MODIFIED | `provider-consumer-assignments.component.spec.ts` | — | 1 spec re-pointed (test-only, outside the list) |
| MODIFIED | `HARNESS/settings-reachability.table.ts` | — | #16/#17/#18 re-pointed; RUX-5 and RUX-6 added; count 85 → 87 |
| MODIFIED | `HARNESS/settings-drawer.reach.ts` | — | `openScopeBadge` helper (keeps the table under the `max-lines` limit) |
| MODIFIED | `HARNESS/settings-visual.e2e.spec.ts` | — | D16 `data-field` check and the new scope-popover capture |

## Acceptance → file:line → spec

| Acceptance | Implementation | Spec |
|---|---|---|
| Badge renders **nothing** when inherited | `SR:208`: no badge unless `hasOverride()`. `'mixed'` is the only exception; see deviation 2. | `SR.spec` "inherited values render nothing" (5 cases: every scope, including global-only and `null`); `PS.spec` "shows one badge per overridden field… nothing for the inherited ones (RUX-6)" |
| `data-testid="scope-badge"` with a non-empty `data-field` | `SR:77` `[attr.data-field]="fieldName()"`. Every consumer passes a non-empty name. The visual spec asserts it for every rendered badge (`HARNESS/settings-visual.e2e.spec.ts:99-104`). | `SR.spec` "names the field and the scope…"; `PS.spec` (`data-field` list); consumer-assignments spec (`data-field` truthy); harness #17 and RUX-6 |
| Badge text "{short} · {Workspace\|App}"; popover header names the field (D16) | `SR:200-217` builds the text. `SR:142` `shortFieldName = input<string\|null>(null)` falls back to `fieldName`. `SR:86` is the header (`scope-popover-title`) with the full name. | `SR.spec` "Effort · Workspace", "Provider · App", fallback, header; harness #17 (`toContainText('Effort · Workspace')`) and `openScopeBadge` (header text) |
| `PS` passes `shortFieldName` | `PS:127`: Model / Effort, with full names "Main agent model" / "Reasoning effort". `PS:137`: Authentication / Provider, with full names "Main agent authentication" / "Main agent provider". | `PS.spec` (`data-field` values and badge texts) |
| Popover on `NativePopoverComponent`, transparent backdrop | `SR:75`: `placement="bottom-start"`, `[hasBackdrop]="true"`, `backdropClass="transparent"`. Esc and backdrop close it; focus returns to the badge (the component's own focus restore). | `SR.spec` "opens from the badge…"; harness RUX-6 (Esc closes, badge focused) |
| Popover: Global / App / Workspace layers with the active layer highlighted, then the existing actions | `SR:96-103` layers (`aria-current` on the winning layer, `bg-primary/10 border-primary/30` highlight). `SR:219-236`: only layers that can hold the value, with "In use" / "Used after clear" notes. `SR:111-125`: Clear override / Use global value / Copy global value, with the same testids and `btn btn-ghost btn-sm min-h-9` plus focus outline. `SR:262`: each action closes the popover, then emits. | `SR.spec` "popover" block (7 cases), including global-only (no actions), busy host (badge kept, actions disabled, reason shown), and the accessibility block |
| Selector, inputs and outputs unchanged | Same selector. All 16 inputs kept; `shortFieldName` added. All 4 outputs kept. `defaultLabel` (`SR:166`) and `overrideRequested` (`SR:187`) stay in the API with a doc note: an inherited value renders no control, so neither is used by the template. | typecheck of every consumer (card, consumer assignments, CLI config, PS) |
| Colour on badge / icon only; text `text-base-content` (deviation 6) | `SR:200-217`: workspace uses `border-secondary/40 bg-secondary/10` with a `text-secondary` Folder icon; app uses `border-info/40 bg-info/10` with a `text-info` Cpu icon. Badge text is `text-base-content`, following `connection-drawer/overview-tab.component.ts:161`. | `SR.spec` "puts colour on the border, fill and icon only…" |
| D6: clearing `authMethod` / `anthropicProviderId` / `provider.*` keeps review-then-confirm with "ends running chat sessions" and no Undo | **Added.** The existing review had no session copy. `PS:210-212` shows "Clearing this override ends running chat sessions. It cannot be undone from here." when `clearEndsSessions(key)` (`PS:663`) holds. Those are exactly the keys whose clear runs `sdkAdapter.reset()` (`config-scope-rpc.handlers.ts:120-145`). The write still waits for "Confirm clear override", and no Undo is offered. | `PS.spec` "clearing %s is reviewed with 'ends running chat sessions' before it runs, with no Undo (D6)" (a `provider.*` key and `anthropicProviderId`; `clearScopeOverride` not called before confirm, called with `nearest` after) |
| RUX-6: five scope rows → badges | `PS:122-143`:<br>- the four field rows sit in one `flex-wrap` row (`main-scope-badges`);<br>- the fifth, the disabled "Main agent configuration" group row (it never had `hasOverride`, so it would render nothing), and its `mainGroupKeys` computed are removed.<br>The card's scope-free source strip is unchanged (Batch 24). | harness RUX-6 (`:855`); `PS.spec` |
| RUX-5: workspace save target not hidden behind an override link | See deviation 1: "Save provider to…" (`PS:95-101`) opens the existing provider review, whose Save-to lists `writeScopes('authMethod')` (`This workspace` included when a workspace is open). Model and effort already had Save-to lists from `writeScopes`. | `PS.spec` "'Save provider to…' reviews the current provider with every write scope…" and "…absent when only one write scope exists"; harness RUX-5 (`:843`) |
| Harness: re-point the scope entries | `HARNESS/settings-reachability.table.ts`:<br>- #16 (`:396`) now reaches the Save-to list through "Save provider to…".<br>- #17 (`:406`) is the D16 badge.<br>- #18 (`:416`) is badge → popover → Clear override → the page's confirm/cancel (not confirmed).<br>- RUX-5 `:843` and RUX-6 `:855` are `restored`.<br>- `EXPECTED_CAPABILITY_COUNT` 85 → 87 (`:964`).<br>- `BASELINE_PRESENT_IDS` untouched.<br>`HARNESS/settings-drawer.reach.ts:119` adds `openScopeBadge`. | Gate G below |

## Write-path trace (control → state method → RPC → store key / scope → runtime reader)

This batch adds **no new write**. The badge only emits intents, and every write it leads to is an existing one, reached
through the existing confirm step:

1. **Badge → Clear override → Confirm clear override.**
   - Chain: `SR` `clearRequested` → `PS reviewClear(key)` → review panel (D6 copy for auth/provider keys) → `PS clearOverride()`
     → `state.clearScopeOverride(key, 'nearest', ctx)` (`providers-settings-state.service.ts:600`) → `config:clearScopeOverride {key,
     target:'nearest'}` (`config-scope-rpc.handlers.ts:101`) → `scopeResolver.clearOverride(key, appScopable)`.
   - Store: removes the winning override layer of `key`. That is the workspace entry in the workspace's `.ptah` settings, or
     the App layer in `~/.ptah/settings.json`. For the page's four keys (`authMethod`, `anthropicProviderId`,
     `provider.<authKey>.selectedModel`, `provider.<authKey>.reasoningEffort`) the handler then runs `sdkAdapter.reset()`
     and invalidates the auth-status cache, which ends running chat sessions.
   - Read-back: `config:getScopes {keys:[key]}`.
   - Readers:
     - the scope resolver on the next auth / model / effort resolution (`active-provider-resolver.ts`);
     - the model and effort reads.
2. **Badge → Use global value → Confirm.**
   - The same chain with `target:'all-above-global'` → `scopeResolver.clearMoreSpecific(key, 'global')`.
   - It removes both the workspace and App layers, with the same reset for these keys.
   - The write only counts if `resolvesFrom === 'global'` (`providers-settings-state.service.ts:616-620`).
3. **"Save provider to…" → pick a Save-to target → Use for main agent.** This is the existing activation, unchanged.
   - Chain: `PS beginActivation(driverId)` → `PS activate()` (`PS:671`) → `state.activateConnection(id, target, ctx)` →
     `auth:saveSettings {authMethod, anthropicProviderId?, applyTo: target}`.
   - Store: `authMethod` (and `anthropicProviderId` for third-party) at the chosen scope.
   - Reader: `active-provider-resolver.ts`.
   - Ends live sessions (SDK reset, plan §3 row 1). The review's copy is unchanged here; Batch 26 owns the popover copy.
4. **Copy global value** (`copyGlobalRequested`): no consumer on this page wires it. That is unchanged.

## Verification

1. `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat @ptah-extension/core @ptah-extension/ui
   @ptah-extension/webview-e2e-harness ptah-extension-webview --parallel=2` exited 0 ("Successfully ran targets typecheck, test,
   lint for 5 projects"). This is the final run on the final tree. Log: `%TEMP%\b23-verify.log`.
   - Tests: core 1083/1083; ui 610/610; chat 1859 passed + 2 skipped (1861); ptah-extension-webview 224/224.
   - Lint: 0 errors. Warnings core 11, chat 31, harness 41, the same as Batch 22.
   - An earlier run showed chat 33 (two `no-non-null-assertion` warnings in my new parent spec), since fixed. The
     `provider-connection-card.component.ts` `max-lines` warning (715) is pre-existing, and Batch 24 rewrites that file.
2. **Gate G.** `npx nx build ptah-extension-webview` exited 0 (`%TEMP%\b23-gateg-build.log`).
   - The initial total is 3.49 MB (715.37 kB transfer), up about 1.5 kB for the popover import. The 3.5 MB error budget is
     met, but the headroom is now about 13 kB. Batch 26 (popover) and 27 (modal) should watch it.
   - `settings-reachability.e2e.spec.ts --reporter=list --repeat-each=3` gave **27 passed** (1.5m), exit 0. Log:
     `%TEMP%\b23-gateG.log`, the final build's run.
   - An identical earlier run on the pre-placement build also gave 27/27.
   - Nothing else built `dist/` meanwhile.
3. **Captures.**
   - **First run: 4 failed** (log overwritten by the later runs).
     - Failing tests: all four `baseline smoke — both tabs (…)`.
     - Error: `expect(received).toBeGreaterThan(expected)` at the new badge-count check. `count()` ran before the scopes read
       landed; the page itself was correct (the capture shows "Effort · Workspace").
     - Fix: wait for the first badge to be visible, then check every badge's `data-field` (`settings-visual.e2e.spec.ts:99-104`).
   - **Final:** `settings-visual.e2e.spec.ts --reporter=list --repeat-each=3` gave **12 passed** (42.5s), exit 0
     (`%TEMP%\b23-visual.log`).
   - New `current-scope-popover-{vscode,electron}-{anubis,anubis-light}-1024x768.png`. The `current-providers-*` and
     `current-orchestration-*` captures were refreshed.
   - `git status --short -- .ptah/specs/TASK_2026_555/screenshots/angular/baseline-*` is **empty**.

## Capture comparison (vs `prototypes/final/index.html:147-155` badges, `:882-912` popover, `:1390-1402` placement; `assets/app.css:302-331`)

- **Badge.**
  - **Matches:** a small rounded badge with a secondary (gold) tint for Workspace. The info tint is used for App.
  - **Differences:**
    - The text names the field: "Effort · Workspace", not "Workspace override". This is D16, a deliberate plan departure
      (plan :620-622).
    - The text is `text-base-content`, not `text-secondary` (deviation 6).
    - It carries a folder icon.
    - It is ~24 px tall, not the prototype's 10 px type, for the WCAG 2.2 target size.
  - **Placement:** the badge sits on its own row under the effort control in the main-agent card. The prototype puts
    badges in the Main Agent node header, which arrives with the routing map / popover (Batches 25-26).
- **Popover** (all four captures):
  - **Matches:** a header with the field name and a bottom border; Global / Desktop app / Workspace rows with the active
    layer highlighted (primary-tinted fill and border); a separator, then "Clear override". It is anchored at the badge's
    left edge (prototype `left = rect.left`). In Electron, where there is no room below, Floating UI flips it above the
    badge. Nothing is clipped in any capture.
  - **Differences:**
    - Rows show "In use" / "Used after clear" rather than per-layer values: the scope DTO carries only the winning layer
      and the fallback preview. The preview sentence ("Will use … from Global.") carries the value.
    - The active row's text is base-content (deviation 6).
    - The prototype's "Use global default" shows only when an App layer sits between (`hasIntermediateAppLayer`), as the
      old strip did.
    - There is no ✕ button: Esc and the transparent backdrop close it, and focus returns to the badge.
- **Page effect:** the main-agent card lost its five stacked rows (RUX-6).
  - Before: the "Mixed sources" group row, three "From Global · All Ptah apps" + "Override for this workspace" rows, and
    one Workspace row with Clear override.
  - After: one "Effort · Workspace" badge. The card is about 110 px shorter in the 1024×768 captures.
- **Orchestration tab:** the Ptah CLI config's per-CLI "From Global" strips are gone. Those keys are global-only and
  inherited (`rpc-auth.types.ts:345-369`), so nothing false is shown. Background-role rows with an unknown source now
  show "{field} · Mixed sources" badges (deviation 2).

## Deviations and open points

1. **"Save provider to…" bridge (D14), `PS:95-101`.**
   - Why: the old strip's "Override for this workspace" on the Provider / Authentication rows was the only way to save the
     *current* main provider at another scope. The active card offers only Change main provider and Manage.
   - What the plan's rule changes: with "nothing when inherited", that link cannot render.
   - What replaces it: a visible button that opens the existing provider review, whose Save-to lists `writeScopes('authMethod')`.
   - Model and effort already had Save-to lists, so their override shortcuts were removed together with `overrideMainValue`.
   - The button goes when Batch 26's Main Agent popover (with Save-to) replaces this block.
2. **`'mixed'` stays visible** as a neutral "{field} · Mixed sources" badge.
   - Why: the design-spec defines inherited (nothing) and overridden (badge), but not mixed.
   - The old contract used `'mixed'` for "source unknown", so that no scope is guessed (consumer assignments `:126-129`,
     a TASK_2026_523 decision).
   - Hiding it would drop that statement. Showing a guessed scope is forbidden.
   - It appears only on the Orchestration background-role rows (lane / timeout keys with no scope entry). Batch 35
     (roles restyle) may revisit it.
3. **Placement `bottom-start`, not design-spec §3.2's `bottom-end`.**
   - The prototype anchors at the badge's left edge.
   - batches.md Batch 26 names "Batch 23 popover usage (…, `placement="bottom-start"`)".
4. **D6 copy added to the clear review.** The existing review did not say that it ends sessions, although the host
   resets the SDK for every key on this page.
5. **Specs outside the file list.** The card spec and the consumer-assignments spec pinned the old strip's testids and
   copy, so they were re-pointed (test-only).
   - The card's `scope` inputs are unused by the page (Batch 24 rewrites the card).
   - `ptah-cli-config.component.ts` needed no change.
6. **The VS Code host lists the "Desktop app" layer and target.** This comes from `writeScopes` passing the key's
   `supportedTargets`, which includes `app`. It is pre-existing: the Save-to lists showed "Desktop app" in VS Code before
   this batch. It is recorded for the Gate V 28 review, not changed here (state service, core).
7. **Bundle headroom** is now about 13 kB under the 3.5 MB error budget.
