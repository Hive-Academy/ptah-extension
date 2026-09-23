# Batches - TASK_2026_533

Total tasks: 63 | Batches: 29 | Complete: 2/29

Wave A (Batches 1, 2, 3) is IN_PROGRESS together: they are a parallel group on
three different Nx projects.

Revision 2 (2026-09-23): the architect resolved D-1, D-2 and D-2b in
implementation-plan.md (C13, C14, revised D6/C5/C8/C12, R7). Batches 4-25 were
re-derived to match; Batches 1-3 were running and are unchanged. Old Batch 7 is
re-split into 7a/7b/7c/7d. No batch waits on a design decision any more.

## Decomposition defaults (recorded, not re-asked)

- Batch size: at most 12 files (orchestrator instruction), one lib per batch where
  possible, at most 3 Nx projects. Component + spec count as two files.
- Parallelism: batches in the same parallel group write disjoint files. When two
  parallel batches touch the SAME Nx project, run each executor with
  `isolation: "worktree"` (or run them one after the other). A shared working tree
  makes `lint`/`typecheck` of that project see the sibling's half-written files.
- Deep-link caller migration (chat) moves from plan B2 to Batch 18 (after the
  route switch-over). See defect D-3.
- A1/A2/A3/R6 checks are pulled forward to Batches 2 and 3; A4 is the first task of
  Batch 4; A5 is the first task of the coverage work in Batch 8.
- Mark system and shared discovery pieces live in `@ptah-extension/ui` per C13/C14:
  one renderer `ptah-mark-svg`, `ptah-brand-mark`, `ptah-monogram-tile`,
  `brand-slugs.ts` (`resolveBrandSlug`, `KNOWN_SERVER_BRANDS`, `CLI_TARGET_BRANDS`,
  `PROVIDER_BRAND_SLUGS`), and `ptah-catalog-card` / `ptah-catalog-grid` /
  `ptah-storefront-panel`. No `onDark` input anywhere: the dark variant is chosen in
  CSS from `data-theme-mode` (`theme.service.ts:184-194`, `index.html:64-66`,
  `styles.css:110-113`). There is no marketplace-local brand resolver.
- `normalizeServerKey` and `normalizeServerUrl` (renamed `normalizeMcpServerUrl`
  per C14) move to `libs/shared/src/lib/utils/mcp-server-identity.ts` in Batch 7a,
  scheduled after Batch 1 because Batch 1 also edits `libs/shared`.
- R7 bundle gate: one baseline of initial-chunk sizes is captured from `origin/main`
  (temporary worktree, `npx nx build ptah-extension-webview`) at the start of
  Batch 7c and pasted in its report. Batches 7c, 7d, 17, 24 and 25 compare against
  it: `BRAND_MARKS` absent from the initial chunk; only the renderer, monogram,
  catalog pieces and `PROVIDER_BRAND_ART` may add bytes.
- C13 net-line rule (Batches 20-24): no over-cap file may grow; the Registry and
  skills.sh browsers end ≤700 lines; `git diff --numstat` per file in every
  report; every existing `data-testid` kept; view-specific markup that does not fit
  the shared card goes into a NEW sibling file (≤700 lines), never the parent.
- Batch 3 deviations (accepted, binding on later batches): skill kinds are
  `'ptah-plugin' | 'community-skill' | 'marketplace-plugin'` exported as
  `MarketplaceSkillKind` from `data/skill-ref.ts` (Batches 16, 17 use it);
  `MarketplaceLayout` takes `DestroyRef` in its constructor and exposes
  `observe(host)` (Batch 12 provides it with
  `useFactory: () => new MarketplaceLayout(inject(DestroyRef))`); no `NgZone.run`.
- Batch 2 deviations (accepted, binding on later batches): retired ids
  `connectors` and `skills` now parse as real pages; `openMarketplace` does NOT
  store the route — the shell records it on `NavigationEnd` (Batch 12); the
  sub-path is dropped when `navigateToSurface` falls back to another surface.
- Batch 1 facts for Batch 4: monogram slugs `klaviyo`, `zernio`, `context7`,
  `google-people`; `huggingface` chosen over `hugging-face` (see Task 4.2).
- Commit convention (from `git log`): Conventional Commits,
  `<type>(<scope>): batch N - <description>`.
- Every executor: no stubs, no TODO, no `[innerHTML]`, `catch (error: unknown)`,
  OnPush + `inject()` + signals + standalone, theme tokens only (plan C8 hex map),
  behaviour/RPCs/functional spec assertions preserved on every restyle.

## External coordination (TASK_2026_540, branch feat/task-540-global-config-menu)

Agreed 2026-09-23:

1. TASK_2026_540 merges to `main` FIRST; this branch rebases onto it before its final merge.
2. 540 replaces the Thoth/Setup/Marketplace/Settings tabs in `electron-shell.component.ts` with one dropdown menu. Its "Marketplace" item opens the bare `marketplace` root, which the restore redirect (Task 17.1) handles.
3. 540 replaces the per-workspace `_viewSlices` for those four surfaces with one GLOBAL, generic per-surface slot in `AppStateManager`. After the rebase, `marketplaceRoute: MarketplaceRoute | null` (added per-workspace in Batch 2) moves into 540's global Marketplace slot, and the per-workspace specs (`app-state.service.spec.ts`, `workspace-coordinator.service.spec.ts:511-540`) become global-state specs — Batch 18b.
4. OPEN (answer pending from 540's architect): with the Electron Marketplace tab gone, if 540's menu button does not show the active surface, Batch 12 must render the breadcrumb header (without the back button) in Electron too. Batch 12 must not start its header task until the orchestrator relays the answer.

Open item for the architect (from Batch 2, pinned by `surface-router.service.spec.ts:683-697`): a bare `/marketplace` navigation (Electron menu/tab, `setCurrentView('marketplace')`) while a detail is open (`/marketplace/servers/claude-user:sentry`) closes the detail and keeps the list instance, because only the PAGE is remembered. Consistent with D2 "detail ids dropped", but user-visible; with 540's menu opening the bare root this path becomes common. Decision needed before Batch 17 (keep, or remember the detail ref too).

## Plan validation

Status: PASSED WITH RISKS

Assumptions:

- A1 `RouterOutlet` re-created inside a `@switch` branch re-activates the current child route — VERIFIED PASS in Batch 3 (Task 3.3 probe, 5/5).
- A2 A `RedirectFunction` runs in an injection context and can `inject(AppStateManager)` — VERIFIED PASS in Batch 2 (Task 2.3; spec `surface-router.service.spec.ts:625-647`).
- A3 `navigateByUrl('/marketplace')` while on `/marketplace/servers` redirects to the remembered route and reuses the active components — VERIFIED PASS in Batch 2 (Task 2.3; result `navigated`, zero re-creations). Caveat: an open detail closes (see External coordination, open item).
- A4 svgo 4 custom-plugin shape `{ name, fn: () => ({ element: { enter } }) }` — unverified; checked in Task 4.1 before the manifest is filled.
- A5 Which CLIs receive OAuth/Smithery session overrides (`mcpServersOverride` consumers found in `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`, `session-query-executor.service.ts`) — unverified; checked in Task 8.3 before `coverage.ts` renders anything other than "Ptah sessions".
- R6 The router percent-encodes `/` inside a single `:skillRef` segment — VERIFIED PASS in Batch 3 (Task 3.2 probe, 4/4); no base64url fallback.
- `ui` has `"sideEffects": false` (`libs/frontend/ui/package.json:11`), so `BRAND_MARKS` stays out of the eager bundle when only lazy code references it — verified by the R7 comparison (Batches 7c, 7d, 17, 24, 25).
- `scripts/` is outside the VSIX (`apps/ptah-extension-vscode/.vscodeignore`), so `scripts/brand-icons.manifest.json` may name AI vendors — verified in Task 4.3.
- Tailwind content globs cover libs through `createGlobPatternsForDependencies` (`apps/ptah-extension-webview/tailwind.config.js:6-9`) — verified.

| Risk                                                                                                                                                                                                    | Severity | Mitigation                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R7 Eager-bundle leak of brand artwork through `ProviderMarkComponent` (eager chat settings) and `PluginCatalogPanelComponent` (eager dashboard)                                                         | HIGH     | Card takes the mark as a slot (Task 7d.1); plugin cards use `ptah-monogram-tile`; `ProviderMark` reads only `PROVIDER_BRAND_ART` (Task 7c.1); initial-chunk comparison in Batches 7c, 7d, 17, 24, 25. |
| D-3 Chat callers migrated before the route tree exists would hit `app.routes.ts:156` `'**' → chat`                                                                                                      | HIGH     | Caller migration moved to Batch 18 (after Batch 17).                                                                                                                                                  |
| `ProviderMarkComponent` convergence could change chat settings rendering                                                                                                                                | MEDIUM   | Selector and inputs frozen; `provider-setup-wizard.component.spec.ts:1025` and the chat project's tests run in Batch 7c.                                                                              |
| Same-project parallel batches share one working tree                                                                                                                                                    | MEDIUM   | Worktree isolation for same-project parallel groups (see defaults).                                                                                                                                   |
| Six restyled views already exceed the 700-line soft cap (smithery 1544, plugin-catalog-panel 1186, external-marketplaces 961, oauth-surface 921, mcp-directory-browser 881, skill-sh-browser 742)       | MEDIUM   | C13 net-line rule in Batches 20-24 (numstat per file; Registry and skills.sh end ≤700).                                                                                                               |
| Ptah Plugins restyle applies everywhere, including the dashboard picker (D-2b)                                                                                                                          | MEDIUM   | Task 24.1: 2-column layout in the `max-w-2xl` dialog with no overflow, one new `ptah-catalog-card` assertion in `skill-selection-card.spec.ts`, dashboard in the verification command.                |
| Electron e2e depends on `external-plugin-*`, `external-install`, `external-installed-*`, `external-consent*`, `marketplace-source`, `marketplace-add` test ids (`external-marketplace.spec.ts:100-485`) | MEDIUM   | Task 21.1 keeps every `data-testid`; Batch 21 runs the Electron marketplace spec.                                                                                                                     |
| Intermediate commit between Batches 17 and 18: chat deep links still write the old slice and land on overview/remembered route                                                                          | LOW      | Feature branch only; Batch 18 follows immediately.                                                                                                                                                    |
| `removalFixCommand` quoting puts a broken command on the clipboard (R4)                                                                                                                                 | MEDIUM   | Task 1.2 quoting spec (whitespace, metacharacters, omit when unquotable).                                                                                                                             |
| Env/header values reach the webview (R3)                                                                                                                                                                | MEDIUM   | `ConfigSummary` type carries keys only (Task 8.1); Task 13.3 spec asserts no value renders. Backend redaction out of scope.                                                                           |
| Brand vendoring needs network access to jsDelivr at the pinned SHA                                                                                                                                      | MEDIUM   | Task 4.2 aborts non-zero and writes nothing on any fetch failure; no placeholder table may be committed.                                                                                              |
| Hub spec assertions have no migration destination in the plan (`marketplace-hub.component.spec.ts:157-253`)                                                                                             | MEDIUM   | Assigned to Task 5.1 (connector rows, newest session, degrade) and Task 17.1 (one surface mounted, zero RPC when unselected).                                                                         |
| Overview adds two reads (R5)                                                                                                                                                                            | LOW      | Accepted; Task 14.1 RPC-set spec pins the exact list.                                                                                                                                                 |

Edge cases:

- Blocked row with no fix command (claude.ai connector rows) — badge shows reason, no copy button — Task 9.2, Task 8.1
- External plugin id with `/` and `:` in `:skillRef` — Task 3.2 (verified), Task 17.1
- Unknown / malformed ref → "Not found" with link back — Tasks 13.3, 15.2, 16.3
- Tier flip while a detail is open keeps the selection — Task 3.3 (verified), Task 13.1
- No `ResizeObserver` (jsdom) → fallback tier — Task 3.3
- `direct` removal without confirmation is refused — Task 5.1, Task 13.3
- `removeMany` partial failure never aborts — Task 5.1, Task 13.1
- Smithery `error` without a throw = "no key" state, not a failure — Task 6.1, Task 15.1
- Poll timers cleared on shell destroy — Task 6.1
- Nav badges never trigger a load — Task 12.2
- `/` shortcut never fires inside input/textarea/select/contenteditable — Task 12.1
- Compact tier at 400px with no horizontal scroll — Task 12.1, Task 25.2
- Light-surface logo (Sentry, DaVinci) visible on dark themes; dark variant switches with `data-theme-mode` — Task 4.2, Task 7b.2
- Missing slug → deterministic monogram — Task 7b.1
- Registry names like `io.github.user/server` resolve on the last `/` segment — Task 7b.3
- Missing `onDark` artwork on a dark theme shows `art` — Task 7b.2
- Workspace switch reloads non-idle slices and keeps per-workspace remembered route — Task 2.2, Task 5.1

## Parallel groups (run order)

| Wave | Batches                    | Notes                                                                                                                                            |
| ---- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| A    | 1 ∥ 2 ∥ 3                  | Running. Different projects (shared/backend/chat-ui, core, marketplace).                                                                         |
| B    | 4 ∥ 5 ∥ 7a ∥ 7d            | All after 1. 4 and 7d are ui (worktree); 5 and 7a both touch marketplace (worktree; 7a edits `mcp-connector-rows.ts`, 5 only imports it).        |
| C    | 6 ∥ 7b                     | 6 after 7a. 7b after 4, 7a, 7d (shares `native/index.ts` with 7d).                                                                               |
| D    | 7c ∥ 8 ∥ 12                | 7c after 7b (ui). 8 after 1, 3, 7b. 12 after 2, 3, 5, 6. 8 ∥ 12 marketplace → worktree.                                                          |
| E    | 9                          | After 8 (and 7b). CLI lanes x3.                                                                                                                  |
| F    | 10 ∥ 11                    | After 9 (11 also after 7d). Same project → worktree.                                                                                             |
| G    | 13 ∥ 15 ∥ 16, then 14      | 13 after 5, 6, 8, 9, 10; 15 after 6, 8, 11, 7d; 16 after 5, 9, 11; 14 after 13, 11. Same project → worktree.                                     |
| H    | 17, then 18 ∥ 19, then 18b | 17 after 12-16. 18 (core, chat) ∥ 19 (electron e2e). 18b after 18 once TASK_2026_540 is on `main` and the branch is rebased (or folded into 18). |
| I    | 20 ∥ 21 ∥ 22 ∥ 23 ∥ 24     | After 17 and 7d. 20 ∥ 21 marketplace → worktree; 22 ∥ 23 ∥ 24 chat-ui → worktree.                                                                |
| J    | 25                         | After everything. Reviewer: visual-reviewer (parity).                                                                                            |

## Batch 1: Contracts (C2) — COMPLETE (commit 6acdafbd0)

- Recommended executor: backend-developer
- Fallback executor: frontend-developer
- Execution mode: sequential
- Rationale: one data contract flowing shared → backend producer → chat-ui grouping; the quoting rule is backend logic.
- Tasks: 3 | Depends on: none
- Verification: `npx nx run-many -t lint,typecheck,test -p @ptah-extension/shared @ptah-extension/cli-agent-runtime @ptah-extension/chat-ui`

### Task 1.1: Add `removalFixCommand` and `brandSlug` to shared contracts — COMPLETE

- Files: `D:\projects\ptah-extension\libs\shared\src\lib\types\mcp-directory.types.ts`, `D:\projects\ptah-extension\libs\shared\src\lib\connectors\ptah-connectors.catalog.ts`, `D:\projects\ptah-extension\libs\shared\src\lib\connectors\ptah-connectors.catalog.spec.ts`
- Plan reference: implementation-plan.md:241-254, :47
- Pattern to follow: `mcp-directory.types.ts:264-294` (optional removal fields); `ptah-connectors.catalog.ts:66-100` (interface)
- Quality requirements: `InstalledMcpServer.removalFixCommand?: string` (optional on the wire); `PtahConnector.brandSlug: string` REQUIRED on all 63 entries, kebab-case.
- Validation notes: slugs must be real theSVG slugs where one exists — probe `https://cdn.jsdelivr.net/gh/glincker/thesvg@20c10d8dd10bbce6de90101f50599d5686061cfa/public/icons/<slug>/default.svg`; a brand with no theSVG entry still gets its kebab-case name (Batch 4 lists it as monogram). Spec: every entry has a kebab-case `brandSlug`, no duplicates across entries that are different brands.
- Implementation details: interface fields plus data; spec iterates `PTAH_CONNECTORS`.

### Task 1.2: Backend emits a shell-safe `removalFixCommand` — COMPLETE

- Depends on: Task 1.1
- Files: `D:\projects\ptah-extension\libs\backend\cli-agent-runtime\src\lib\mcp-directory\mcp-install.service.ts`, `D:\projects\ptah-extension\libs\backend\cli-agent-runtime\src\lib\mcp-directory\mcp-install.service.spec.ts`
- Plan reference: implementation-plan.md:37, :248, :252-253
- Pattern to follow: `mcp-install.service.ts:304-326`, `:526-538` (existing `flag` logic that composes the prose)
- Quality requirements: `claude mcp remove <key>` plus ` --scope user` for user scope; same flag logic as the prose; key with whitespace or shell metacharacters is double-quoted; command omitted when a safe quote is impossible (e.g. key contains `"` or a newline).
- Validation notes: R4. Spec extends `:124-131`: user scope, project scope, key needing quotes, unquotable key → field absent. Prose `removalBlockedReason` unchanged.
- Implementation details: one pure helper for quoting inside the service file (or beside it), used by both producer sites.

### Task 1.3: Carry `removalFixCommand` through installed-server grouping — COMPLETE

- Depends on: Task 1.1
- Files: `D:\projects\ptah-extension\libs\frontend\chat-ui\src\lib\molecules\setup-plugins\installed-mcp-groups.ts`, `D:\projects\ptah-extension\libs\frontend\chat-ui\src\lib\molecules\setup-plugins\installed-mcp-groups.spec.ts`
- Plan reference: implementation-plan.md:246, :248
- Pattern to follow: `installed-mcp-groups.ts:14-30,72-90` (how the head row's removal fields are copied)
- Quality requirements: `InstalledServerGroup.removalFixCommand?` copied from the group head; absent when the head lacks it.
- Validation notes: spec covers present and absent.
- Implementation details: one field on the group type and one assignment.

### Batch 1 verification

- All 7 files exist and contain the work; the verification command passes (output tailed)
- Reviewer: code-logic-reviewer (quoting logic is behavioural risk R4)
- Pre-commit fix (returned to the Batch 1 executor, not applied by team-leader): `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\connectors-surface.component.spec.ts:65-78` builds a `PtahConnector` literal without the now-required `brandSlug`; jest (isolatedModules) and `typecheck` (specs excluded) both miss it. Add `brandSlug` to the fixture and rerun `npx nx test @ptah-extension/marketplace`. The file is committed with Batch 1.
- Edge cases: unquotable key, connector rows without a command

## Batch 2: Core navigation API, additive (C1 minus DELETE and caller migration) — IN_PROGRESS

- Recommended executor: frontend-developer
- Fallback executor: CLI lane x1 (single self-contained prompt)
- Execution mode: sequential
- Rationale: route model, router service and app-state are coupled; the A2/A3 probes need all three.
- Tasks: 3 | Depends on: none
- Verification: `npx nx run-many -t lint,typecheck,test -p @ptah-extension/core` then `npx nx run-many -t typecheck -p @ptah-extension/chat @ptah-extension/marketplace`

### Task 2.1: `MarketplaceRoute` model and mappers — IMPLEMENTED

- Files: `D:\projects\ptah-extension\libs\frontend\core\src\lib\marketplace\marketplace-route.ts`, `D:\projects\ptah-extension\libs\frontend\core\src\lib\marketplace\marketplace-route.spec.ts`, `D:\projects\ptah-extension\libs\frontend\core\src\index.ts`
- Plan reference: implementation-plan.md:113-148 (D2 table at :131-143)
- Pattern to follow: `libs/frontend/core/src/lib/marketplace/marketplace-section.ts:15-19` (pure, no Angular)
- Quality requirements: `MarketplaceServerSource`, `MarketplaceSkillSource`, `MarketplaceRoute` union; `marketplaceRouteCommands` and total `marketplaceRouteFromSegments` (detail ids dropped, unknown → null); exhaustive `switch`.
- Validation notes: spec walks the D2 table row by row, including the retired ids from `marketplace-state.service.spec.ts:99-120` (→ null → overview). Old exports (`encodeMarketplaceTarget`, `parseMarketplaceTarget`, types) STAY exported until Batch 18.
- Implementation details: add named exports to `core/src/index.ts` next to `:6-13`.

### Task 2.2: `navigateToSurface(id, subPath)` and AppStateManager route memory — IMPLEMENTED

- Depends on: Task 2.1
- Files: `D:\projects\ptah-extension\libs\frontend\core\src\lib\routing\surface-router.service.ts`, `D:\projects\ptah-extension\libs\frontend\core\src\lib\routing\surface-router.service.spec.ts`, `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\app-state.service.ts`, `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\app-state.service.spec.ts`
- Plan reference: implementation-plan.md:123-128, :221-235
- Pattern to follow: `surface-router.service.ts:114-141` (four results, never rejects); `app-state.service.ts:206-229,518-524,859-865` (slice field + computed + setter); `:419-428` (`requestSurface`); guard `:754-758`
- Quality requirements: `createUrlTree(['/', id, ...subPath])`; `already-there` compares serialized trees; `requestSurface(surface, subPath?)`; `marketplaceRoute` computed, `rememberMarketplaceRoute`, `openMarketplace(route)` honouring `canSwitchViews`.
- Validation notes: ADD the new `marketplaceRoute` slice field beside `marketplaceActiveProvider` — the old field and setter stay until Batch 18 because `marketplace-state.service.ts:47,95,119` still reads them. Specs: sub-path `navigated` / `already-there` / `failed`; per-workspace isolation of `marketplaceRoute` mirroring `app-state.service.spec.ts:880-967`.
- Implementation details: default `subPath = []` keeps every existing caller unchanged.

### Task 2.3: Probe A2 and A3 with a real router — IMPLEMENTED

- Depends on: Task 2.2
- Files: `D:\projects\ptah-extension\libs\frontend\core\src\lib\routing\surface-router.service.spec.ts` (same file as 2.2; new `describe`)
- Plan reference: implementation-plan.md:110 (A2), :147 (A3)
- Pattern to follow: existing router setup in `surface-router.service.spec.ts`
- Quality requirements: a test route tree `marketplace` → `''` with a `RedirectFunction` that calls `inject(AppStateManager)` and returns `/marketplace/<marketplaceRouteCommands(remembered)>`; asserts `/marketplace` → `/marketplace/servers/smithery` after `rememberMarketplaceRoute({page:'servers',source:'smithery'})` (A2); navigating `/marketplace` while on `/marketplace/servers` keeps the same component instance and returns `navigated` or `already-there` (A3).
- Validation notes: if either probe fails, STOP and report — Batch 17's redirect design depends on it (BLOCKER for the architect).
- Implementation details: real `provideRouter` in TestBed, trivial test components declared in the spec.

### Batch 2 verification

- Files exist; old API still exported; verification command passes
- A2 and A3 results stated explicitly in the report
- Reviewer: code-logic-reviewer (router result semantics, guard)

## Batch 3: Ref codecs and layout tier (C5 part) — COMPLETE

- Recommended executor: frontend-developer
- Fallback executor: CLI lanes x2 (codecs / layout)
- Execution mode: sequential
- Rationale: small pure units with no dependency on other batches; they carry the A1 and R6 probes, which must resolve before any page is designed around them.
- Tasks: 3 | Depends on: none
- Verification: `npx nx run-many -t lint,typecheck,test -p @ptah-extension/marketplace`

### Task 3.1: `server-ref` codec — COMPLETE

- Files: `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\data\server-ref.ts`, `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\data\server-ref.spec.ts`
- Plan reference: implementation-plan.md:103, :302
- Pattern to follow: `libs/frontend/core/src/lib/marketplace/marketplace-section.ts` (pure total functions)
- Quality requirements: `${origin}:${serverKey}`, split at the FIRST `:`; unknown origin or empty key → null.
- Validation notes: keys containing `:` round-trip; all `McpServerOrigin` values covered.
- Implementation details: encode/decode pair, table-driven spec.

### Task 3.2: `skill-ref` codec plus R6 router probe — COMPLETE

- Files: `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\data\skill-ref.ts`, `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\data\skill-ref.spec.ts`
- Plan reference: implementation-plan.md:103, :302, :624 (R6)
- Pattern to follow: Task 3.1
- Quality requirements: `${kind}:${id}` for the three skill kinds; `external:<owner>/<repo>/<plugin>` ids keep colons and slashes in the tail.
- Validation notes: R6 probe — navigate with commands `['skills', ref]` where ref contains `/`, assert a single segment is matched and the decoded param equals the input. If it fails, switch the tail to base64url (plan R6 fallback) and say so.
- Implementation details: pure codec plus one RouterTestingHarness spec block.

### Task 3.3: `MarketplaceLayout` tier signal plus A1 probe — COMPLETE

- Files: `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\layout\marketplace-layout.ts`, `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\layout\marketplace-layout.spec.ts`
- Plan reference: implementation-plan.md:150-165 (D3), :318, :110 (A1)
- Pattern to follow: `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:324-360` (ResizeObserver + fallback)
- Quality requirements: `marketplaceTierForWidth` (compact < 900, regular 900-1399, wide ≥ 1400); `MarketplaceLayout` class observes an element handed in, exposes `width`/`tier`, disconnects on destroy.
- Validation notes: stub-ResizeObserver spec and no-ResizeObserver fallback spec. A1 probe: a test host with `@switch (tier)` holding a `<router-outlet>` in each branch; with a child route active, flipping the tier must show the routed component in the new branch. If A1 fails, STOP and report (BLOCKER for C7 detail placement).
- Implementation details: pure function + small injectable-free class.

### Batch 3 verification

- Files exist; verification passes; A1 and R6 outcomes stated in the report
- Reviewer: code-logic-reviewer

## Batch 4: Brand-icon vendoring pipeline (C12) — PENDING

- Recommended executor: frontend-developer
- Fallback executor: devops-engineer
- Execution mode: sequential
- Rationale: one script whose output shape the next batches compile against; needs network and judgement on rejected icons.
- Tasks: 3 | Depends on: Batch 1
- Verification: `npm run vendor:brand-icons` twice then `git diff --exit-code -- libs/frontend/ui/src/lib/native/brand-mark/brand-marks.generated.ts`; `npx nx run-many -t lint,typecheck -p @ptah-extension/ui`

### Task 4.1: Script skeleton and A4 probe — PENDING

- Files: `D:\projects\ptah-extension\scripts\vendor-brand-icons.mjs`, `D:\projects\ptah-extension\package.json`, `D:\projects\ptah-extension\package-lock.json`
- Plan reference: implementation-plan.md D6 (:209-236), C12 (:497-515)
- Pattern to follow: other `scripts/*.mjs` (Node ESM, built-in `fetch`)
- Quality requirements: pinned SHA `20c10d8dd10bbce6de90101f50599d5686061cfa`; svgo preset per D6; custom plugin extracts `MarkArtwork`-compatible records `{ viewBox, kind:'fill', paths:[{ d, fill|null, fillRule?, opacity? }] }`; rejection rules; `surface` computed at 3:1 against `#1a1a20`; sorted keys, precision 2; 300 KB budget; any fetch/HTTP failure → non-zero exit, nothing written.
- Validation notes: A4 — run on `github` (dark variant, 1024 viewBox) and assert the path bounding box lies inside the viewBox before continuing. `svgo@^4.1.0` added as a devDependency and a `vendor:brand-icons` script.
- Implementation details: `npm install -D svgo@^4.1.0` updates the lockfile.

### Task 4.2: Manifest and generated table (incl. mono and `PROVIDER_BRAND_ART`) — PENDING

- Depends on: Task 4.1
- Files: `D:\projects\ptah-extension\scripts\brand-icons.manifest.json`, `D:\projects\ptah-extension\libs\frontend\ui\src\lib\native\brand-mark\brand-marks.generated.ts`, `D:\projects\ptah-extension\libs\frontend\ui\src\lib\native\brand-mark\mark-artwork.ts` (type only)
- Plan reference: implementation-plan.md D6 (:218-236), C12, C14 (:594-596), plan B3 row (:709)
- Pattern to follow: `libs/frontend/ui/src/lib/native/provider-mark/provider-marks.data.ts:1-32` (header, data-only TS)
- Quality requirements: every catalogue `brandSlug` from Task 1.1, the known-server slugs, the CLI slugs (R1 real marks) and the provider slugs; `mono` variant fetched for `anthropic` and `claude`; header with SHA, date, source URL, MIT notice, nominative-use trademark note; exports `BRAND_MARKS`, `BrandMarkRecord`, `MONOGRAM_SLUGS`, and a SEPARATE const `PROVIDER_BRAND_ART` holding only the `mono` (else `art`) artwork of the `PROVIDER_BRAND_SLUGS` entries (`anthropic`, `claude`), so the eager `ProviderMarkComponent` never references the full table (R7).
- Validation notes: `github`, `vercel`, `openai` have `onDark`; `sentry`, `davinci-resolve` are `surface:'light'`; `anthropic`/`claude` have `mono`; ≤300 KB; byte-identical rerun. Rejection report goes in the batch report (for the PR description). From Batch 1: catalogue slugs with NO theSVG entry go to `MONOGRAM_SLUGS` — `klaviyo`, `zernio`, `context7`, `google-people`; `huggingface` was chosen over theSVG's colour `hugging-face` (keep `huggingface`; if its artwork is rejected, fall back per D6); non-trivial slugs to fetch: `apollodotio`, `mongodb`, `cloudflare-workers`, `gmail`; several entries share one slug (atlassian, asana, exa, hubspot, gmail, google-calendar, google-drive, google-docs, google-sheets) — fetch each slug once.
- Implementation details: generated file is prettier-formatted and exempt from the 700-line cap. The artwork type it emits must match `MarkArtwork` defined in Task 7b.1 — define `MarkArtwork` in the generated file's import target agreed as `libs/frontend/ui/src/lib/native/brand-mark/mark-artwork.ts` (created here, 1 extra file, type only).

### Task 4.3: Scanner and packaging check — PENDING

- Depends on: Task 4.2
- Files: none new (verification only)
- Plan reference: implementation-plan.md:10, C12 quality requirements
- Pattern to follow: `apps/ptah-extension-vscode/.vscodeignore`
- Quality requirements: no `.svg` added anywhere; no AI-vendor token in any new non-JS file that enters the VSIX; `scripts/` confirmed outside the package.
- Validation notes: report the `git status --short` of the batch and the grep proving no `.svg` was added.
- Implementation details: evidence only.

### Batch 4 verification

- Determinism check passes; ≤300 KB; A4 outcome stated; `PROVIDER_BRAND_ART` present and small
- Reviewer: code-logic-reviewer (rejection rules, failure behaviour)

## Batch 5: `MarketplaceInventoryStore` (C3) — PENDING

- Recommended executor: frontend-developer
- Fallback executor: none (spec migration needs judgement)
- Execution mode: sequential
- Rationale: logic lifted from an 834-line component plus a 591-line spec migration; one coherent unit.
- Tasks: 1 | Depends on: Batch 1
- Verification: `npx nx run-many -t lint,typecheck,test -p @ptah-extension/marketplace`

### Task 5.1: Inventory store with per-slice state and removal — PENDING

- Files: `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\data\marketplace-inventory.store.ts`, `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\data\marketplace-inventory.store.spec.ts`
- Plan reference: implementation-plan.md D4, C3
- Pattern to follow: `connected-surface.component.ts:281-690` (slices, allSettled, generation guard), `:763-801` (removal RPCs/messages); `marketplace-hub.component.ts:80-98,162-171` (connector rows, newest session, cache clear); import `mcp-connector-rows.ts` (do NOT edit it — Batch 7a owns that file)
- Quality requirements: slices `installed`/`plugins`/`community`/`marketplaces`, each `idle|loading|ready|error`, `ensure()` only from idle, `reload()`, `retry()`; `removeServer(group,{confirmedDirect})`, `removeCommunitySkill`, `removeMarketplacePlugin`, `removeMany` (sequential, per-item outcome); `notifyContentChanged()` reloads only non-idle slices and clears the command cache; `WorkspaceScopeService.generation` effect; `newestSessionStatus`.
- Follow-up from Batch 1 review (moderate, not blocking): the type does not tie `removalFixCommand` to `removal: 'none'`; the store (and `provider-row`, Task 8.1) must read `removalFixCommand` ONLY on blocked rows and ignore it elsewhere — pin with a spec.
- Validation notes: migrate EVERY behavioural assertion of `connected-surface.component.spec.ts` AND hub spec `marketplace-hub.component.spec.ts:157-237` (connector rows from newest session, no removal for connector rows, degrade with no session). New: `direct` without confirmation rejected; `removeMany` partial failure; generation bump reloads; idle slices never load from reads.
- Implementation details: `@Injectable()` (no `providedIn`), provided by the shell in Batch 12.

### Batch 5 verification

- Store and spec exist; migrated assertions listed in the report against their source spec lines
- Reviewer: code-logic-reviewer (failure isolation, stale generations, removal safety)

## Batch 6: `ConnectorLinksStore` (C4) — PENDING

- Recommended executor: frontend-developer
- Fallback executor: none
- Execution mode: sequential
- Rationale: poll lifecycle and per-kind routing lifted from a 740-line component with an 897-line spec.
- Tasks: 1 | Depends on: Batch 7a (shared `normalizeMcpServerUrl`)
- Verification: `npx nx run-many -t lint,typecheck,test -p @ptah-extension/marketplace`

### Task 6.1: Connector links store — PENDING

- Files: `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\data\connector-links.store.ts`, `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\data\connector-links.store.spec.ts`
- Plan reference: implementation-plan.md C4, C14 shared normalizers (:597)
- Pattern to follow: `connectors-surface.component.ts:68-90` (poll constants), `:236-300` (merge), `:383-470,590-656` (connect/poll), `:658-720` (load and partial failure)
- Quality requirements: `ensure`/`reload`, `links`, `connect`/`authorize`/`disconnect`, Smithery install/setup/poll (3 s, 5 min), `busyIds`, `pollingIds`, `actionError`, `statusFor(group)`, date lookups; `oauth-app` connect returns `{kind:'needs-setup'}`. URL normalisation imported from `@ptah-extension/shared` (`normalizeMcpServerUrl`), no local copy.
- Validation notes: migrate every assertion of `connectors-surface.component.spec.ts` (merge table, per-kind routing, fake-timer poll, destroy clears timers, `managedByPtah` withholds disconnect). Smithery `error` without throw = no-key state. No duplicate `connectOAuth` for a busy id.
- Implementation details: `@Injectable()`; `DestroyRef` clears timers.

### Batch 6 verification

- Reviewer: code-logic-reviewer (timers, races, partial failure)

## Batch 7a: Shared MCP server identity normalizers (C14 part) — PENDING

- Recommended executor: frontend-developer
- Fallback executor: CLI lane x1 (mechanical move)
- Execution mode: sequential
- Rationale: a behaviour-preserving move into shared; must follow Batch 1, which also edits `libs/shared`.
- Tasks: 1 | Depends on: Batch 1
- Verification: `npx nx run-many -t lint,typecheck,test -p @ptah-extension/shared @ptah-extension/marketplace`

### Task 7a.1: Move `normalizeServerKey` and `normalizeServerUrl` to shared — PENDING

- Files: `D:\projects\ptah-extension\libs\shared\src\lib\utils\mcp-server-identity.ts`, `D:\projects\ptah-extension\libs\shared\src\lib\utils\mcp-server-identity.spec.ts`, `D:\projects\ptah-extension\libs\shared\src\lib\utils\index.ts`, `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\mcp-connector-rows.ts`
- Plan reference: implementation-plan.md C14 (:597, :611, :613-614)
- Pattern to follow: `mcp-connector-rows.ts:34-40`, `connectors-surface.component.ts:79-90`
- Quality requirements: bodies moved unchanged; exported as `normalizeServerKey` and `normalizeMcpServerUrl` from the shared utils barrel; `mcp-connector-rows.ts` imports from `@ptah-extension/shared` and its local copy is deleted.
- Validation notes: spec carries over the existing normalizer cases (find them in the current marketplace specs). `connectors-surface.component.ts` keeps its private copy until Batch 17 deletes the file — do not edit it.
- Implementation details: named export in `utils/index.ts`.

### Batch 7a verification

- Reviewer: code-style-reviewer (barrel, no duplicate left in live code)

## Batch 7b: Mark renderer, brand mark, monogram, brand slugs (C14 part) — PENDING

- Recommended executor: frontend-developer
- Fallback executor: none
- Execution mode: sequential
- Rationale: renderer → monogram → brand mark → resolver are layered in one folder and share `native/index.ts`.
- Tasks: 3 | Depends on: Batches 4, 7a, 7d
- Verification: `npx nx run-many -t lint,typecheck,test -p @ptah-extension/ui`

### Task 7b.1: `MarkSvgComponent` and `MonogramTileComponent` — PENDING

- Files: `D:\projects\ptah-extension\libs\frontend\ui\src\lib\native\brand-mark\mark-svg.component.ts` (+`.spec.ts`), `D:\projects\ptah-extension\libs\frontend\ui\src\lib\native\brand-mark\monogram-tile.component.ts` (+`.spec.ts`)
- Plan reference: implementation-plan.md C14 (:572-576), D6 tile and monogram rules
- Pattern to follow: `libs/frontend/ui/src/lib/native/provider-mark/provider-mark.component.ts:42-111` (binding-only SVG)
- Quality requirements: `ptah-mark-svg` inputs `art: MarkArtwork`, `paint: 'brand'|'mono'`; mono paints `currentColor` fills and `stroke="currentColor"` for `kind:'stroke'`; only `[attr.*]` bindings. `ptah-monogram-tile`: FNV-1a tint, first grapheme, `text-base-content`, NO import of `BRAND_MARKS`.
- Validation notes: specs — brand vs mono paint, fill vs stroke kind; deterministic tint; no `innerHTML`.
- Implementation details: `MarkArtwork` type from `mark-artwork.ts` (Task 4.2).

### Task 7b.2: `BrandMarkComponent` — PENDING

- Depends on: Task 7b.1
- Files: `D:\projects\ptah-extension\libs\frontend\ui\src\lib\native\brand-mark\brand-mark.component.ts` (+`.spec.ts`)
- Plan reference: implementation-plan.md D6 runtime (:219-224), C14 (:575, :605)
- Pattern to follow: `apps/ptah-extension-webview/src/styles.css:110-113` (`[data-theme-mode]` selector)
- Quality requirements: inputs `brandSlug: string|null`, `label`, `size: 'sm'|'md'|'lg'` — NO `onDark` input and no injection; when `onDark` artwork exists both artworks render and `:host-context([data-theme-mode='dark'])` shows `onDark`, otherwise `art`; `surface:'light'` → white tile with `border-base-300`; unknown slug → `ptah-monogram-tile`; `aria-hidden`.
- Validation notes: spec sets `data-theme-mode` on `document.documentElement`; light tile; monogram fallback; missing `onDark` shows `art`.
- Implementation details: renders through `ptah-mark-svg`.

### Task 7b.3: `brand-slugs.ts` and barrels — PENDING

- Depends on: Task 7b.2
- Files: `D:\projects\ptah-extension\libs\frontend\ui\src\lib\native\brand-mark\brand-slugs.ts` (+`.spec.ts`), `D:\projects\ptah-extension\libs\frontend\ui\src\lib\native\brand-mark\index.ts`, `D:\projects\ptah-extension\libs\frontend\ui\src\lib\native\index.ts`
- Plan reference: implementation-plan.md C14 (:578-586, :594, :607), D6 icon set (:226-233)
- Pattern to follow: `provider-marks.data.ts` (table is the allowlist)
- Quality requirements: `KNOWN_SERVER_BRANDS`, `CLI_TARGET_BRANDS` (R1; `opencode` → hand-authored artwork), `PROVIDER_BRAND_SLUGS = { anthropic: 'anthropic', 'claude-cli': 'claude' }`, `resolveBrandSlug({ serverKey, serverUrl? })` in the C14 order (URL match via `normalizeMcpServerUrl` → normalized key = catalogue id → alias → same two checks on the last `/` segment → null).
- Validation notes: resolver order table incl. the brief's 12 rows (sentry, firecrawl, shopify-dev-mcp→shopify, node_repl→nodedotjs, chrome-devtools→google-chrome, sequential-thinking→null) and an `io.github.user/server` name; catalogue `brandSlug` cross-check against `BRAND_MARKS` + `MONOGRAM_SLUGS`; `dependency-boundaries.spec.ts` stays green.
- Implementation details: `native/index.ts` gains `export * from './brand-mark';` next to the Task 7d.1 line.

### Batch 7b verification

- 10 files present; ui lint/typecheck/test green; no `@ptah-extension/core` import
- Reviewer: code-logic-reviewer (resolver order, dark switch, fallback)

## Batch 7c: `ProviderMarkComponent` convergence (C14 part) — PENDING

- Recommended executor: frontend-developer
- Fallback executor: none
- Execution mode: sequential
- Rationale: eager chat-settings component moved onto the shared renderer; needs the R7 baseline and comparison.
- Tasks: 2 | Depends on: Batch 7b
- Verification: `npx nx run-many -t lint,typecheck,test -p @ptah-extension/ui @ptah-extension/chat`; `npx nx build ptah-extension-webview` + initial-chunk comparison (R7)

### Task 7c.1: Render provider marks through `ptah-mark-svg` — PENDING

- Files: `D:\projects\ptah-extension\libs\frontend\ui\src\lib\native\provider-mark\provider-mark.component.ts`, `...\provider-mark\provider-mark.component.spec.ts`, `...\provider-mark\provider-marks.data.ts`, `...\provider-mark\provider-marks.data.spec.ts` (all under `D:\projects\ptah-extension\libs\frontend\ui\src\lib\native\`)
- Plan reference: implementation-plan.md C14 (:587-596, :608-609), R1 follow-through (:743)
- Pattern to follow: `provider-mark.component.ts:52-58` (resolution rule), `provider-marks.data.ts:22-24` (one-record edit)
- Quality requirements: selector and inputs (`providerId`, `fallback`) unchanged; template is `<ptah-mark-svg paint="mono">`; resolution `PROVIDER_BRAND_SLUGS` → `PROVIDER_BRAND_ART` (never `BRAND_MARKS`) → `PROVIDER_MARKS` stroke artwork → lucide fallback; the lucide pins at `provider-marks.data.ts:105-106` removed; remaining records re-typed to `MarkArtwork` (`kind:'stroke'`); licensing doc comment `:27-32` updated to cite R1.
- Validation notes: existing specs updated only where anthropic/claude-cli now render vendored artwork; `libs/frontend/chat/.../provider-setup-wizard.component.spec.ts:1025` and `provider-connection-card` consumers stay green.
- Implementation details: no new inputs.

### Task 7c.2: R7 baseline and comparison — PENDING

- Depends on: Task 7c.1
- Files: none (evidence)
- Plan reference: implementation-plan.md:734, R7 (:746-752)
- Pattern to follow: `npx nx build ptah-extension-webview` stats output
- Quality requirements: baseline from `origin/main` in a temporary worktree (removed afterwards); after-build on the branch; table of initial chunks before/after; `BRAND_MARKS` absent from the initial chunk.
- Validation notes: this baseline is reused by Batches 7d, 17, 24, 25 — paste it in the report.
- Implementation details: evidence only; no git operations beyond `git worktree add/remove`.

### Batch 7c verification

- Reviewer: code-logic-reviewer (resolution order, eager-bundle evidence)

## Batch 7d: Catalog card, grid and storefront panel (C13 shared pieces) — PENDING

- Recommended executor: frontend-developer
- Fallback executor: CLI lanes x3 (one component each; team-leader adds the barrel lines)
- Execution mode: sequential
- Rationale: three presentational ui components with no dependency on the mark system (the mark is a slot); shares `native/index.ts` with Batch 7b, so it lands first.
- Tasks: 2 | Depends on: Batch 1 (none technically; scheduled in Wave B)
- Verification: `npx nx run-many -t lint,typecheck,test -p @ptah-extension/ui`

### Task 7d.1: `CatalogCardComponent` — PENDING

- Files: `D:\projects\ptah-extension\libs\frontend\ui\src\lib\native\catalog-card\catalog-card.component.ts` (+`.spec.ts`), `D:\projects\ptah-extension\libs\frontend\ui\src\lib\native\catalog-card\index.ts`, `D:\projects\ptah-extension\libs\frontend\ui\src\lib\native\index.ts`
- Plan reference: implementation-plan.md C13 (:521-533)
- Pattern to follow: `libs/frontend/ui/src/lib/native/card/`; prototype `variant-2-storefront.html` card markup
- Quality requirements: inputs `title` (required), `description|null` (2-line clamp, 1 line in compact container), `meta` (≤3, joined with `·`), `badge|null` (`label` + `tone`, text always present), `headingLevel: 2|3|4` (default 3), `interactive` (default false); output `activated` only when interactive via a stretched title `<button>` (no nested interactive element); slots `[card-mark]`, `[card-status]`, `[card-actions]`, `[card-expansion]`; NO mark/brand inputs and no `BRAND_MARKS` import; `<article aria-labelledby>`, `bg-base-200 border border-base-300 rounded-xl`, hover lift disabled under reduced motion, `focus-within` ring.
- Validation notes: spec — slots render, clamp, `activated` only when interactive, no nested interactive element, no `innerHTML`.
- Implementation details: `native/index.ts` gains `export * from './catalog-card';`.

### Task 7d.2: `CatalogGridComponent` and `StorefrontPanelComponent` — PENDING

- Depends on: Task 7d.1
- Files: `D:\projects\ptah-extension\libs\frontend\ui\src\lib\native\catalog-card\catalog-grid.component.ts` (+`.spec.ts`), `D:\projects\ptah-extension\libs\frontend\ui\src\lib\native\catalog-card\storefront-panel.component.ts` (+`.spec.ts`)
- Plan reference: implementation-plan.md C13 (:534-535)
- Pattern to follow: `apps/ptah-extension-webview/src/styles.css:1560-1592` (native `@container`)
- Quality requirements: grid owns `container: ptah-catalog / inline-size`; 1/2/3/4 columns at <480/480-799/800-1199/≥1200; `role="list"`, items `role="listitem"`; `col-span-full` children span the row; card compact density keys off `@container ptah-catalog`. Panel inputs `title`, `subtitle|null`, `headingLevel`; slots `[panel-mark]`, body, `[panel-footer]`.
- Validation notes: spec asserts container rule and roles; panel slots.
- Implementation details: both exported from `catalog-card/index.ts`.

### Batch 7d verification

- 8 files; ui green; R7 comparison deferred to 7c (the pieces are not consumed eagerly until Batch 24)
- Reviewer: code-style-reviewer (a11y structure, token use)

## Batch 8: View-model mappers (C5 remainder) — PENDING

- Recommended executor: frontend-developer
- Fallback executor: CLI lanes x2 (filtering / attention+coverage) after Task 8.1 lands
- Execution mode: sequential
- Rationale: `provider-row` feeds filtering, attention and coverage.
- Tasks: 3 | Depends on: Batches 1, 3, 7b
- Verification: `npx nx run-many -t lint,typecheck,test -p @ptah-extension/marketplace`

### Task 8.1: `provider-row` mapper with masked config — PENDING

- Files: `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\data\provider-row.ts`, `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\data\provider-row.spec.ts`
- Plan reference: implementation-plan.md C5 (:333 brand revision), `provider-row` responsibilities
- Pattern to follow: `installed-mcp-groups.ts:32-45` (`TARGET_LABELS`), `mcp-install.service.ts:95-101` (origin labels)
- Quality requirements: `brand` from `resolveBrandSlug({ serverKey, serverUrl })` imported from `@ptah-extension/ui` (no local resolver); status precedence session → OAuth → Smithery → `configured`, never `connected` without a live source; removal `uninstall|disconnect|confirm-direct|blocked{reason,fixCommand?}|manage-link`; `ConfigSummary` has no field that could hold an env/header value.
- Validation notes: R3. Unknown status → `unknown` with raw text. Spec includes a type-level assertion (`// @ts-expect-error` on assigning a value field).
- Implementation details: pure.

### Task 8.2: `provider-filtering` — PENDING

- Depends on: Task 8.1
- Files: `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\data\provider-filtering.ts`, `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\data\provider-filtering.spec.ts`
- Plan reference: implementation-plan.md C5 `provider-filtering`
- Pattern to follow: Task 8.1
- Quality requirements: search, origin, target, status filters; sort by name/origin/status; stable.
- Validation notes: table-driven spec.
- Implementation details: pure.

### Task 8.3: `attention` and `coverage` (A5 first) — PENDING

- Depends on: Task 8.1
- Files: `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\data\attention.ts`, `...\data\attention.spec.ts`, `...\data\coverage.ts`, `...\data\coverage.spec.ts` (under `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\`)
- Plan reference: implementation-plan.md C5 `attention`/`coverage`, A5 (:731)
- Pattern to follow: `harness/harness-health.model.ts:100-111`
- Quality requirements: attention only from the four listed sources (no "expires in N days"); coverage columns in `TARGET_LABELS` order, cells `configured|declared-by-cli|session-override|none`.
- Validation notes: A5 — read the `mcpServersOverride` consumers in `libs/backend/agent-sdk/src/lib/helpers/` and state which CLIs receive overrides; render only the merged "Ptah sessions" cell unless evidence says otherwise.
- Implementation details: pure.

### Batch 8 verification

- A5 outcome stated with file:line
- Reviewer: code-logic-reviewer (status honesty, masking)

## Batch 9: Marketplace UI kit I — row primitives (C8 part) — PENDING

- Recommended executor: CLI lanes x3 (one per task)
- Fallback executor: frontend-developer (sequential)
- Execution mode: parallel
- Rationale: six new presentational components, disjoint files, no barrel or registry edit (marketplace ui components are not exported), each describable in one prompt.
- Tasks: 3 | Depends on: Batches 7b, 8
- Verification: `npx nx run-many -t lint,typecheck,test -p @ptah-extension/marketplace` (team-leader runs once after all lanes)

### Task 9.1: `StatusPillComponent` + `TargetMarksComponent` — PENDING

- Files: `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\ui\status-pill.component.ts` (+`.spec.ts`), `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\ui\target-marks.component.ts` (+`.spec.ts`)
- Plan reference: implementation-plan.md C8 (`StatusPill`, `TargetMarks`)
- Pattern to follow: `libs/frontend/ui/src/lib/native/brand-mark/brand-mark.component.ts` (Batch 7b)
- Quality requirements: icon + text (never colour alone); overlapping CLI marks via `ptah-brand-mark` + `CLI_TARGET_BRANDS` from `@ptah-extension/ui`, sr-only label list; no theme input.
- Validation notes: unknown status renders neutral with raw text.
- Implementation details: inputs/outputs only.

### Task 9.2: `CopyCommandButtonComponent` + `RemovalLockBadgeComponent` — PENDING

- Files: `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\ui\copy-command-button.component.ts` (+`.spec.ts`), `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\ui\removal-lock-badge.component.ts` (+`.spec.ts`)
- Plan reference: implementation-plan.md C8 (`RemovalLockBadge`, `CopyCommandButton`)
- Pattern to follow: `oauth-surface.component.ts:616-637` (clipboard + select fallback); `libs/frontend/ui/src/lib/native/popover/native-popover.component.ts:116-159`
- Quality requirements: lock button `aria-label="Removal blocked — details"` opens `NativePopover` with reason, `<code>` command and copy button; "Copied" live region.
- Validation notes: no command → no copy button; clipboard rejection → select fallback (spec).
- Implementation details: never a paragraph in the action column.

### Task 9.3: `BulkActionBarComponent` + `DockedInspectorComponent` — PENDING

- Files: `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\ui\bulk-action-bar.component.ts` (+`.spec.ts`), `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\ui\docked-inspector.component.ts` (+`.spec.ts`)
- Plan reference: implementation-plan.md C8 (`BulkActionBar`, `DockedInspector`)
- Pattern to follow: `libs/frontend/ui/src/lib/native/drawer/native-drawer.component.ts` (header/body slots)
- Quality requirements: `role="region" aria-label="Bulk actions"`, `aria-live="polite"` count; `<aside aria-labelledby>` with close button and scroll body, one `ng-content`, no focus steal on content change.
- Validation notes: bulk results summary (N removed, M failed with reasons) rendered from an input.
- Implementation details: presentational.

### Batch 9 verification

- 12 files present; data components have loading/empty/error; no `innerHTML`
- Reviewer: code-style-reviewer (consistency across three lanes)

## Batch 10: Marketplace UI kit II — lists and overview widgets — PENDING

- Recommended executor: CLI lanes x3 (one per task)
- Fallback executor: frontend-developer (sequential)
- Execution mode: parallel
- Rationale: six independent presentational components consuming Batch 9 primitives; disjoint files, no shared registry.
- Tasks: 3 | Depends on: Batch 9
- Verification: `npx nx run-many -t lint,typecheck,test -p @ptah-extension/marketplace`

### Task 10.1: `ProviderTableComponent` + `ProviderCardListComponent` — PENDING

- Files: `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\ui\provider-table.component.ts` (+`.spec.ts`), `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\ui\provider-card-list.component.ts` (+`.spec.ts`)
- Plan reference: implementation-plan.md C8 (`ProviderTable`, `ProviderCardList`), C7 failure behaviour
- Pattern to follow: prototype `variant-1-command-center.html` table, `v1-overview-720.png` cards
- Quality requirements: `<th scope="col">`, `aria-sort`, row checkbox `aria-label="Select <name>"`, active-row styling; blocked and `manage-link` rows not selectable (disabled checkbox with explanatory label); compact `<ul role="list">`.
- Validation notes: no "Last used" column (dropped).
- Implementation details: emits selection, sort, open, remove.

### Task 10.2: `ProviderFiltersComponent` + `StatCardComponent` — PENDING

- Files: `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\ui\provider-filters.component.ts` (+`.spec.ts`), `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\ui\stat-card.component.ts` (+`.spec.ts`)
- Plan reference: implementation-plan.md C8 (`ProviderFilters`, `StatCard`)
- Pattern to follow: `libs/frontend/ui/src/lib/native/dropdown/native-dropdown.component.ts:118-174`
- Quality requirements: search input, origin `role="radiogroup"`, target/status dropdowns; stat card `tabular-nums`, skeleton, Retry output; no sparkline (dropped).
- Validation notes: filters are not navigation.
- Implementation details: presentational.

### Task 10.3: `NeedsAttentionComponent` + `CoverageMatrixComponent` — PENDING

- Files: `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\ui\needs-attention.component.ts` (+`.spec.ts`), `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\ui\coverage-matrix.component.ts` (+`.spec.ts`)
- Plan reference: implementation-plan.md C8 (`NeedsAttention`, `CoverageMatrix`)
- Pattern to follow: `v3-overview-1440.png`
- Quality requirements: items with icon, title, detail, "Review" `routerLink`; `<table>` with `<caption>`, check/dash icons with sr-only text, merged "Ptah sessions" cell.
- Validation notes: empty state when nothing needs attention.
- Implementation details: consumes `attention.ts` / `coverage.ts` models.

### Batch 10 verification

- Reviewer: code-style-reviewer

## Batch 11: Marketplace UI kit III — storefront — PENDING

- Recommended executor: frontend-developer
- Fallback executor: none
- Execution mode: sequential
- Rationale: FeaturedConnectors and CategoryBento compose the ui catalog card and brand mark; source band is small.
- Tasks: 2 | Depends on: Batches 7b, 7d, 9
- Verification: `npx nx run-many -t lint,typecheck,test -p @ptah-extension/marketplace`

### Task 11.1: `SourceBandComponent` + `StorefrontHeroComponent` — PENDING

- Files: `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\ui\source-band.component.ts` (+`.spec.ts`), `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\ui\storefront-hero.component.ts` (+`.spec.ts`)
- Plan reference: implementation-plan.md C8 (`StorefrontHero`, `SourceBand`), quality requirements (hex map, hero gradient)
- Pattern to follow: `screenshots/v2-overview-1440.png`
- Quality requirements: gold eyebrow `text-secondary` used sparingly; hero gradient `from-base-200 via-base-100 to-primary/10`; stack tiles from real counts; "Synced to" CLI marks via `ptah-brand-mark`.
- Validation notes: no ⌘K global search, no "My Stack" tab (dropped).
- Implementation details: presentational.

### Task 11.2: `FeaturedConnectorsComponent` + `CategoryBentoComponent` — PENDING

- Depends on: Task 11.1
- Files: `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\ui\featured-connectors.component.ts` (+`.spec.ts`), `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\ui\category-bento.component.ts` (+`.spec.ts`)
- Plan reference: implementation-plan.md C8 (:429-430: no separate `ConnectorCardComponent`)
- Pattern to follow: `ptah-catalog-grid` / `ptah-catalog-card` (Batch 7d)
- Quality requirements: featured renders `ptah-catalog-card`s with a projected `ptah-brand-mark`, status pill and action slot content supplied through inputs/outputs; bento shows category label, count and sample brand marks and emits category → `?category=`.
- Validation notes: `actionError`, busy and polling states surface through the card's `[card-status]` slot.
- Implementation details: presentational; no `ConnectorCardComponent` is created.

### Batch 11 verification

- Reviewer: code-style-reviewer

## Batch 12: Shell, nav and status bar (C6) — PENDING

- Recommended executor: frontend-developer
- Fallback executor: none
- Execution mode: sequential
- Rationale: shell provides stores and layout that nav and status bar read.
- Tasks: 2 | Depends on: Batches 2, 3, 5, 6
- PENDING DECISION (External coordination item 4): whether the Electron host also renders the breadcrumb header (no back button). Task 12.1 implements the header rule the orchestrator relays; until then the plan C6 rule (no header in Electron) stands and the batch should not be launched.
- Verification: `npx nx run-many -t lint,typecheck,test -p @ptah-extension/marketplace`

### Task 12.1: `MarketplaceShellComponent` — PENDING

- Files: `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\shell\marketplace-shell.component.ts`, `...\shell\marketplace-shell.component.html`, `...\shell\marketplace-shell.component.spec.ts` (all under `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\`)
- Plan reference: implementation-plan.md C6
- Pattern to follow: `marketplace-hub.component.ts:158-160` (`goBack`); `app-shell.component.html:30-49` (outlet wrapper)
- Quality requirements: provides inventory store, links store, and `{ provide: MarketplaceLayout, useFactory: () => new MarketplaceLayout(inject(DestroyRef)) }` and calls `layout.observe(hostElement)` (Batch 3 deviation); header only when `!isElectron` (back button, mark, breadcrumb); `<main>` scroll owner with `container: ptah-mp-content / inline-size`; records remembered route on `NavigationEnd`; `/` focuses page search except inside editable fields; `data-testid="marketplace-shell"`.
- Validation notes: spec — header present/absent per host; mounting the shell alone fires 0 RPC (spy); `/` handling; remembered route written; 400px compact render without horizontal overflow; migrate hub spec "keeps the Marketplace heading"/`goBack` assertions.
- Implementation details: pages own their `h1`.

### Task 12.2: `MarketplaceNavComponent` + `MarketplaceStatusBarComponent` — PENDING

- Depends on: Task 12.1
- Files: `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\shell\marketplace-nav.component.ts` (+`.spec.ts`), `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\shell\marketplace-status-bar.component.ts` (+`.spec.ts`, added — the plan lists none)
- Plan reference: implementation-plan.md C6 nav/status bar
- Pattern to follow: `screenshots/v1-overview-720.png` (rail), `v3-overview-1440.png` (footer)
- Quality requirements: 56 px rail at compact with `aria-label` + `title`; 240 px sidebar with counts at regular+; two groups; `routerLinkActive` + `ariaCurrentWhenActive="page"`; counts only from `ready` slices.
- Validation notes: spec asserts no `ensure()` is called by nav or status bar.
- Implementation details: transitions ≤200 ms, disabled under reduced motion.

### Batch 12 verification

- Acceptance (from Batch 3 review): the shell's tier must follow a real `ResizeObserver` report with no manual change detection — the shell spec resizes the host across 900 and 1400 and asserts rail/sidebar flips using `fixture.autoDetectChanges()` / zoneless scheduling, never an explicit `detectChanges()` after the resize (the `no NgZone.run` decision is otherwise unproven). Real-host proof is Task 25.1.
- Reviewer: code-logic-reviewer (zero-RPC rule, keyboard scope)

## Batch 13: Installed servers list and server detail (C7 part) — PENDING

- Recommended executor: frontend-developer
- Fallback executor: none
- Execution mode: sequential
- Rationale: list view owns the detail placement the detail component renders into.
- Tasks: 3 | Depends on: Batches 5, 6, 8, 9, 10
- Verification: `npx nx run-many -t lint,typecheck,test -p @ptah-extension/marketplace`

### Task 13.1: `ProviderListViewComponent` — PENDING

- Files: `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\pages\servers\provider-list-view.component.ts` (+`.html`, +`.spec.ts`)
- Plan reference: implementation-plan.md C7 `ProviderListView`
- Pattern to follow: `libs/frontend/ui/src/lib/shared/keyboard-navigation.service.ts:65-241`; `native-drawer.component.ts`; Batch 3 A1 probe spec
- Quality requirements: filters; table (regular+) or cards (compact); selection + bulk bar; ↑/↓/Enter; detail placement overlay drawer vs docked inspector by tier, open ⇔ active child has `serverRef` (router state, not outlet events); close navigates to the list route; groups by origin at wide.
- Validation notes: tier flip keeps the selection (A1 verified); bulk partial-failure spec; drawer traps focus, docked does not steal it.
- Implementation details: page-local filter/sort/selection signals.

### Task 13.2: `InstalledServersPageComponent` — PENDING

- Depends on: Task 13.1
- Files: `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\pages\servers\installed-servers-page.component.ts` (+`.spec.ts`)
- Plan reference: implementation-plan.md C7 `InstalledServersPage`
- Pattern to follow: Task 13.1
- Quality requirements: ensures `installed` + links only; origin filter chips (filters, not navigation); page `h1`.
- Validation notes: RPC-set spec: exactly `listInstalled` + link reads.
- Implementation details: thin page over the list view.

### Task 13.3: `ServerDetailComponent` — PENDING

- Depends on: Task 13.1
- Files: `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\pages\servers\server-detail.component.ts` (+`.html`, +`.spec.ts`)
- Plan reference: implementation-plan.md C7 `ServerDetail`
- Pattern to follow: `mcp-directory-browser.component.ts:380-425` (inline direct confirm); `native-tab-group.component.ts:136-151`
- Quality requirements: `ptah-brand-mark` header, badges, lock banner with copy command; tabs Overview/Targets/Config (no Tools tab); env/header KEYS with masked values; Uninstall/Disconnect with inline `direct` confirm listing config paths; Reconnect via `authorize`.
- Validation notes: unknown ref → "Not found" + link back; spec asserts no env/header value text in the DOM.
- Implementation details: frame-agnostic (drawer or docked).

### Batch 13 verification

- Reviewer: code-logic-reviewer (removal confirm, masking, selection across tiers)

## Batch 14: Overview and server source host (C7 part) — PENDING

- Recommended executor: frontend-developer
- Fallback executor: none
- Execution mode: sequential
- Rationale: Overview composes the Batch 13 list view.
- Tasks: 2 | Depends on: Batches 11, 13
- Verification: `npx nx run-many -t lint,typecheck,test -p @ptah-extension/marketplace`

### Task 14.1: `OverviewPageComponent` — PENDING

- Files: `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\pages\overview\overview-page.component.ts` (+`.html`, +`.spec.ts`)
- Plan reference: implementation-plan.md C7 `OverviewPage`, performance requirements (Overview RPC list)
- Pattern to follow: `screenshots/v1-overview-1440.png`, `v3-overview-1440.png`
- Quality requirements: header with Refresh + "Add connection"; 4 KPI cards from real sources; needs-attention and matrix at regular+ only; provider list; ensures exactly the listed slices, links and `harness.refresh()` if `health()===null`.
- Validation notes: RPC-set spec pins the plan's Overview list (R5); per-slice error isolation; no activity timeline/sparklines.
- Implementation details: pure mappers only, no RPC shapes in the page.

### Task 14.2: `ServerSourceHostComponent` — PENDING

- Files: `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\pages\servers\server-source-host.component.ts` (+`.spec.ts`)
- Plan reference: implementation-plan.md C7 `ServerSourceHost`
- Pattern to follow: `apps-section.component.ts:60-95` (one surface per source)
- Quality requirements: input `source`; storefront band at wide, compact band otherwise; exactly one of `ptah-smithery-surface` / `ptah-mcp-directory-browser` (no `connectorServers` binding) / `ptah-oauth-surface`; outputs → `notifyContentChanged()`.
- Validation notes: spec asserts exactly one surface mounted per source.
- Implementation details: bound through route `data` in Batch 17.

### Batch 14 verification

- Reviewer: code-logic-reviewer

## Batch 15: Connectors pages (C9 part) — PENDING

- Recommended executor: frontend-developer
- Fallback executor: none
- Execution mode: sequential
- Rationale: detail placement (drawer vs full page) is owned by the page.
- Tasks: 2 | Depends on: Batches 6, 7d, 8, 11
- Verification: `npx nx run-many -t lint,typecheck,test -p @ptah-extension/marketplace`

### Task 15.1: `ConnectorsPageComponent` — PENDING

- Files: `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\pages\connectors\connectors-page.component.ts` (+`.html`, +`.spec.ts`)
- Plan reference: implementation-plan.md C9 `ConnectorsPage`
- Pattern to follow: `connectors-surface.component.html` (current grid); `screenshots/v2-overview-1440.png`
- Quality requirements: ensures links only; search + `?category=`; `ptah-catalog-grid` of `ptah-catalog-card` (projected `ptah-brand-mark`, category and kind-hint meta, status pill, primary action); wide: hero, featured (first 6 not-connected `oauth-dcr` in catalogue order), bento, grid; Smithery no-key → "Add a Smithery key" link to `servers/smithery`.
- Validation notes: RPC-set spec (link reads only); featured-rule spec.
- Implementation details: card actions call the links store.

### Task 15.2: `ConnectorDetailComponent` — PENDING

- Depends on: Task 15.1
- Files: `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\pages\connectors\connector-detail.component.ts` (+`.html`, +`.spec.ts`)
- Plan reference: implementation-plan.md C9 `ConnectorDetail`
- Pattern to follow: `connectors-surface.component.ts:454-462` (embedded OAuth form), `oauth-surface.component.ts:478-503` (public signals)
- Quality requirements: brand header, description, category, kind hint, status, server URL, `docsUrl`, `verifiedAt`, actions; `oauth-app` numbered steps with `{redirectUrl}` substituted, embedded `<ptah-oauth-surface>` prefilled after first render; drawer at compact/regular, full page at wide with focus moved to `h1`.
- Validation notes: prefill spec; unknown id → "Not found".
- Implementation details: relies only on OAuthSurface public signals (frozen by C13).

### Batch 15 verification

- Reviewer: code-logic-reviewer

## Batch 16: Skills pages (C9 part) — PENDING

- Recommended executor: frontend-developer
- Fallback executor: none
- Execution mode: sequential
- Rationale: installed list owns the detail placement.
- Tasks: 3 | Depends on: Batches 5, 9, 11
- Verification: `npx nx run-many -t lint,typecheck,test -p @ptah-extension/marketplace`

### Task 16.1: `SkillsSectionHeaderComponent` + `SkillSourceHostComponent` — PENDING

- Files: `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\pages\skills\skills-section-header.component.ts` (+`.spec.ts`, added), `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\pages\skills\skill-source-host.component.ts` (+`.spec.ts`)
- Plan reference: implementation-plan.md C9 `SkillsSectionHeader`, `SkillSourceHost`
- Pattern to follow: `skills-section.component.ts:129-143` (`saved` → clearCache + `harness.refresh({refresh:true})`)
- Quality requirements: `{enabledCount}/{pluginTotal}` + `<ptah-harness-health-badge>`; host mounts exactly one of plugin panel / skill-sh browser / external marketplaces; outputs → `notifyContentChanged()`.
- Validation notes: "no tab strip" assertion for the skills.sh browser belongs to Batch 23, not here.
- Implementation details: route `data` → `source` input.

### Task 16.2: `InstalledSkillsPageComponent` — PENDING

- Files: `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\pages\skills\installed-skills-page.component.ts` (+`.spec.ts`)
- Plan reference: implementation-plan.md C9 `InstalledSkillsPage`
- Pattern to follow: Task 13.1 placement rule (drawer / docked inspector)
- Quality requirements: ensures `plugins`, `community`, `marketplaces` only; three grouped lists with Manage/Uninstall/version; detail links built with `MarketplaceSkillKind` from `data/skill-ref.ts` (`'ptah-plugin' | 'community-skill' | 'marketplace-plugin'`, Batch 3 deviation).
- Validation notes: RPC-set spec; per-slice error isolation.
- Implementation details: uses `DockedInspectorComponent` + `NativeDrawerComponent` directly.

### Task 16.3: `SkillDetailComponent` — PENDING

- Depends on: Task 16.2
- Files: `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\pages\skills\skill-detail.component.ts` (+`.spec.ts`)
- Plan reference: implementation-plan.md C9 `SkillDetail`
- Pattern to follow: Task 13.3
- Quality requirements: name, description, source, version, path, skill/command counts, harness targets summary, actions; decodes `:skillRef` with `skill-ref.ts` (`MarketplaceSkillKind`).
- Validation notes: external id with `/` decodes (R6 verified); unknown ref → "Not found".
- Implementation details: frame-agnostic.

### Batch 16 verification

- Reviewer: code-logic-reviewer

## Batch 17: Route switch-over and old marketplace removal (C10 part) — PENDING

- Recommended executor: frontend-developer
- Fallback executor: none
- Execution mode: sequential
- Rationale: route table, barrel and deletions must land together or the app loses its marketplace.
- Tasks: 4 | Depends on: Batches 12, 13, 14, 15, 16; architect decision on the open "bare /marketplace closes an open detail" item (External coordination)
- Verification: `npx nx run-many -t lint,typecheck,test -p @ptah-extension/marketplace ptah-extension-webview @ptah-extension/dashboard` then `npx nx build ptah-extension-webview` + R7 initial-chunk comparison

### Task 17.1: `MARKETPLACE_ROUTES` — PENDING

- Files: `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\routes\marketplace.routes.ts`, `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\routes\marketplace.routes.spec.ts`
- Plan reference: implementation-plan.md D1 tree, C10
- Pattern to follow: `app.routes.ts:62-71` (component-less `children: []`); A2 probe from Task 2.3
- Quality requirements: the D1 tree exactly; `restoreMarketplaceRoute` redirect; `'**'` → overview; sources as static paths with `data.source`.
- Validation notes: spec — all 14 routes resolve; redirect restore; `**`; ref decoding incl. an external id with `/` using `MarketplaceSkillKind` (`'ptah-plugin' | 'community-skill' | 'marketplace-plugin'`, Batch 3 deviation); each source mounts exactly one surface (migrates hub spec `:296-340`); unselected route fires zero RPC (migrates hub spec `:239-253`).
- Implementation details: shell is the `''` component with the three providers.

### Task 17.2: Barrel rewrite and doc comments — PENDING

- Depends on: Task 17.1
- Files: `D:\projects\ptah-extension\libs\frontend\marketplace\src\index.ts`, `D:\projects\ptah-extension\libs\frontend\marketplace\src\services.ts`, `D:\projects\ptah-extension\libs\frontend\marketplace\src\harness.ts`, `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\harness\harness-health.store.ts` (doc comment only)
- Plan reference: implementation-plan.md C10 barrel
- Pattern to follow: `CONVENTIONS.md:42-52`
- Quality requirements: exports `MARKETPLACE_ROUTES`, `HarnessHealthBadgeComponent`, harness model exports now at `index.ts:24-40`; ≤150 lines; named exports; stale `MarketplaceHubComponent` mentions at `harness.ts:6`, `services.ts:7-15`, `harness-health.store.ts:52` rewritten (D-7).
- Validation notes: `dashboard/.../harness-card.spec.ts:29` still compiles; eager barrels' export lists unchanged.
- Implementation details: no re-export of pages or stores.

### Task 17.3: App route switch and deletions — PENDING

- Depends on: Task 17.2
- Files: `D:\projects\ptah-extension\apps\ptah-extension-webview\src\app\app.routes.ts`; DELETE under `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\`: `marketplace-hub.component.ts`, `marketplace-hub.component.html`, `marketplace-hub.component.spec.ts`, `marketplace-state.service.ts`, `marketplace-state.service.spec.ts`, `sections.registry.ts`, `apps-section.component.ts`, `skills-section.component.ts`, `connected-surface.component.ts`, `connected-surface.component.spec.ts`, `connectors-surface.component.ts`, `connectors-surface.component.html`, `connectors-surface.component.spec.ts`
- Plan reference: implementation-plan.md C10 DELETE list
- Pattern to follow: `app.routes.ts:124-133`
- Quality requirements: `loadChildren` → `MARKETPLACE_ROUTES`, `SURFACE_ACTIVE` provider kept. Deleting `connectors-surface.component.ts` removes the last local URL-normaliser copy (C14).
- Validation notes: before deleting, confirm (grep) every assertion of the deleted specs has a new home (Batches 5, 6, 12, 17.1); list any that do not and why.
- Implementation details: `mcp-connector-rows.ts` stays (store uses it).

### Task 17.4: R7 bundle check — PENDING

- Depends on: Task 17.3
- Files: none (evidence)
- Plan reference: implementation-plan.md:734, R7
- Pattern to follow: Task 7c.2 baseline
- Quality requirements: initial (eager) chunks vs the Batch 7c baseline; `BRAND_MARKS` only in lazy marketplace chunk(s).
- Validation notes: table before/after in the report.
- Implementation details: evidence only.

### Batch 17 verification

- Reviewer: code-style-reviewer (barrel, boundaries, dead code) and code-logic-reviewer (route matching)

## Batch 18: Core API removal and chat deep-link migration (C1 DELETE + callers) — PENDING

- Recommended executor: frontend-developer
- Fallback executor: CLI lane x1
- Execution mode: sequential
- Rationale: removing the old slice field breaks the callers; both edits land together.
- Tasks: 2 | Depends on: Batch 17
- Coordination: if TASK_2026_540 is already on `main` and this branch has been rebased before Batch 18 starts, fold Batch 18b's move into Task 18.2 (the old per-workspace field is removed and `marketplaceRoute` lands directly in 540's global slot) and mark 18b COMPLETE as merged into 18. Otherwise run 18 as written and 18b after the rebase.
- Verification: `npx nx run-many -t lint,typecheck,test -p @ptah-extension/core @ptah-extension/chat` then `npx nx run-many -t typecheck -p @ptah-extension/marketplace`

### Task 18.1: Migrate chat callers to `openMarketplace` — PENDING

- Files: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\mcp-status-chip.component.ts`, `...\molecules\mcp-status-chip.component.spec.ts`, `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\setup-plugins\chat-empty-state.component.ts`, `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\workspace-coordinator.service.ts`, `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\workspace-coordinator.service.spec.ts`
- Plan reference: implementation-plan.md D2, C1 integration points
- Pattern to follow: D2 table rows `apps:connectors`, `apps:smithery`, `skills:ptah-plugins`
- Quality requirements: `mcp-status-chip.component.ts:387-392` → `openMarketplace(source==='smithery' ? {page:'servers',source:'smithery'} : {page:'connectors'})`; `chat-empty-state.component.ts:277-282` → `openMarketplace({page:'skills',source:'ptah-plugins'})`; coordinator comment `:153` and spec `:511-540` rewritten to `marketplaceRoute` with the same per-workspace assertions.
- Validation notes: spec asserts `openMarketplace` arguments (`mcp-status-chip.component.spec.ts:298,348,362`).
- Implementation details: remove the `encodeMarketplaceTarget` imports.

### Task 18.2: Remove the old core API — PENDING

- Depends on: Task 18.1
- Files: `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\app-state.service.ts`, `...\app-state.service.spec.ts`, `D:\projects\ptah-extension\libs\frontend\core\src\index.ts`; DELETE `D:\projects\ptah-extension\libs\frontend\core\src\lib\marketplace\marketplace-section.ts`, `...\marketplace-section.spec.ts`
- Plan reference: implementation-plan.md D2 effect, C1 DELETE, C10
- Pattern to follow: Task 2.2
- Quality requirements: `marketplaceActiveProvider` field, computed and setter gone; old exports gone; slice doc comment `:206` updated.
- Validation notes: repo-wide grep for `marketplaceActiveProvider|encodeMarketplaceTarget|parseMarketplaceTarget|MarketplaceSection` returns nothing outside `.ptah/`.
- Implementation details: none beyond removal.

### Batch 18 verification

- Reviewer: code-logic-reviewer (deep links, per-workspace memory)

## Batch 18b: Move `marketplaceRoute` into TASK_2026_540's global Marketplace slot — PENDING

- Recommended executor: frontend-developer
- Fallback executor: none
- Execution mode: sequential
- Rationale: the rebase onto 540 changes where surface memory lives; the move and the spec rewrites land together.
- Tasks: 1 | Depends on: Batch 18; TASK_2026_540 merged to `main`; team-leader has rebased this branch onto `main` (git is the team-leader's; the executor does not run git)
- Verification: `npx nx run-many -t lint,typecheck,test -p @ptah-extension/core @ptah-extension/chat @ptah-extension/marketplace`

### Task 18b.1: Global Marketplace route memory — PENDING

- Files: `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\app-state.service.ts`, `...\app-state.service.spec.ts`, `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\workspace-coordinator.service.spec.ts`; the marketplace shell/routes only if 540's slot API changes the call sites of `rememberMarketplaceRoute` / `marketplaceRoute`
- Plan reference: External coordination items 1-3; implementation-plan.md D2 (`marketplaceRoute`)
- Pattern to follow: 540's generic per-surface slot in `AppStateManager` (as merged on `main`)
- Quality requirements: `marketplaceRoute: MarketplaceRoute | null` stored in the global Marketplace slot, not the per-workspace `ViewSlice`; `marketplaceRoute`/`rememberMarketplaceRoute`/`openMarketplace` signatures unchanged for callers; the per-workspace specs (Batch 2 additions, `workspace-coordinator.service.spec.ts:511-540`) rewritten as global-state specs; no leftover per-workspace field.
- Validation notes: the restore redirect (Task 17.1) still restores the remembered page after a workspace switch — now the same page for every workspace; state that behaviour change in the report.
- Implementation details: replace in place; no compatibility shim.

### Batch 18b verification

- Reviewer: code-logic-reviewer (state ownership after the rebase)

## Batch 19: Electron e2e and tour migration (C10 part) — PENDING

- Recommended executor: senior-tester
- Fallback executor: frontend-developer
- Execution mode: sequential
- Rationale: test and showcase code only; needs the built app.
- Tasks: 1 | Depends on: Batch 17 (parallel with Batch 18)
- Verification: `npx nx run-many -t lint,typecheck -p ptah-electron-e2e` then the project's e2e target restricted to `src/specs/marketplace`

### Task 19.1: Migrate selectors to the routed shell — PENDING

- Files: `D:\projects\ptah-extension\apps\ptah-electron-e2e\src\specs\marketplace\marketplace.spec.ts`, `D:\projects\ptah-extension\apps\ptah-electron-e2e\src\specs\marketplace\external-marketplace.spec.ts`, `D:\projects\ptah-extension\apps\ptah-electron-e2e\src\showcase\marketplace-tour.scene.ts`
- Plan reference: implementation-plan.md C10 (e2e migration)
- Pattern to follow: current specs `marketplace.spec.ts:26-55`, `external-marketplace.spec.ts:98-103`, scene `:85-140`
- Quality requirements: `ptah-marketplace-shell` / `data-testid="marketplace-shell"`, nav links, page `h1`; same scenarios, no deleted assertions; the `external-*`/`marketplace-source`/`marketplace-add` test ids stay the contract Batch 21 must keep.
- Validation notes: Electron has no shell header (global tab bar is chrome).
- Implementation details: test code only.

### Batch 19 verification

- Reviewer: code-style-reviewer

## Batch 20: Smithery view restyle (C13) — PENDING

- Recommended executor: frontend-developer
- Fallback executor: none
- Execution mode: sequential
- Rationale: 1544-line component; restyle replaces per-server markup with shared ui pieces without touching the key-gated flow.
- Tasks: 1 | Depends on: Batches 7b, 7d, 17
- Verification: `npx nx run-many -t lint,typecheck,test -p @ptah-extension/marketplace`; `git diff --numstat` for every touched file

### Task 20.1: Smithery list to `CatalogGrid`/`CatalogCard`, gate and setup to `StorefrontPanel` — PENDING

- Files: `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\smithery-surface.component.ts`, `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\smithery-surface.component.spec.ts`; optionally one NEW sibling presentational file (+spec) for Smithery-only markup that does not fit the card
- Plan reference: implementation-plan.md C13 table row "Smithery" (:540), spec-migration rule (:547-552), net-line rule (:553-557)
- Pattern to follow: `ptah-catalog-card` / `ptah-storefront-panel` (Batch 7d)
- Quality requirements: server list (`:409`) → `ptah-catalog-grid` of `ptah-catalog-card` (projected `ptah-brand-mark` via `resolveBrandSlug`, else monogram; `useCount`, verified, `bySmithery` as meta/badge; Install or Installed action); key gate and per-server config/setup → `ptah-storefront-panel` (setup form in a `col-span-full` expansion); category chips stay filters; inputs/outputs (`:752-757`) and RPCs unchanged; file does not grow; every `data-testid` kept.
- Validation notes: only selector-level spec edits, each listed with its reason; new assertions: items inside `ptah-catalog-grid`/`ptah-catalog-card`, no `innerHTML`.
- Implementation details: presentation only; a behaviour-preserving split is out of scope.

### Batch 20 verification

- Numstat shows no growth; reviewer: code-logic-reviewer (behaviour preserved); visual parity in Batch 25

## Batch 21: External marketplaces and Custom URL restyle (C13) — PENDING

- Recommended executor: frontend-developer
- Fallback executor: none
- Execution mode: sequential
- Rationale: plugin row and installed row are children of the external marketplaces view; Custom URL is a single panel form in the same language.
- Tasks: 2 | Depends on: Batches 7b, 7d, 15, 17, 19 (Electron spec migrated first)
- Verification: `npx nx run-many -t lint,typecheck,test -p @ptah-extension/marketplace`; Electron `external-marketplace.spec.ts`; `git diff --numstat`

### Task 21.1: External marketplaces rows to `CatalogCard`s — PENDING

- Files: `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\external-marketplaces.component.ts`, `...\external-marketplaces.component.spec.ts`, `...\external-plugin-row.component.ts`, `...\external-plugin-row.component.spec.ts`, `...\external-installed-row.component.ts` (all under `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\`)
- Plan reference: implementation-plan.md C13 row "Marketplaces" (:545), rules (:547-557)
- Pattern to follow: `ptah-catalog-card`, `ptah-storefront-panel`
- Quality requirements: plugin rows → `ptah-catalog-card` (monogram, `owner/repo` and version meta, Install action); installed rows → card with installed-version badge and Uninstall; marketplace sources and "add marketplace" form → `ptah-storefront-panel`; `external-consent-dialog.component.ts` NOT modified; every `data-testid` kept (`external-plugin-*`, `external-install`, `external-installed-*`, `external-consent*`, `marketplace-source`, `marketplace-add`); no file grows.
- Validation notes: Electron `external-marketplace.spec.ts:100-485` green.
- Implementation details: presentation only.

### Task 21.2: Custom URL (OAuth surface) as one `StorefrontPanel` — PENDING

- Files: `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\oauth-surface.component.ts`, `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\oauth-surface.component.spec.ts`
- Plan reference: implementation-plan.md C13 row "Custom URL" (:542)
- Pattern to follow: `ptah-storefront-panel`
- Quality requirements: whole form in one panel with grouped fields and the Advanced disclosure inside; suggestions list (`:270`) → compact row of interactive `ptah-catalog-card`s (activated = pick suggestion); connected-servers list (`:337`) → cards with `resolveBrandSlug({serverUrl})` mark, status badge, Disconnect; public signals `urlInput`/`nameInput`/`advancedOpen`/`redirectUri` (`:478-503`) and inputs/outputs frozen; no growth.
- Validation notes: Batch 15 prefill spec stays green (run it).
- Implementation details: presentation only.

### Batch 21 verification

- Numstat; Electron marketplace spec green; reviewer: code-logic-reviewer

## Batch 22: MCP Registry browser — narrow and restyle (C11 + C13) — PENDING

- Recommended executor: frontend-developer
- Fallback executor: none
- Execution mode: sequential
- Rationale: narrowing and restyle edit the same file; narrowing lands first inside this batch.
- Tasks: 1 | Depends on: Batches 7b, 7d, 17
- Verification: `npx nx run-many -t lint,typecheck,test -p @ptah-extension/chat-ui` then `npx nx run-many -t typecheck -p @ptah-extension/marketplace @ptah-extension/chat`; `git diff --numstat`

### Task 22.1: Remove Installed view; results to `CatalogCard`s — PENDING

- Files: `D:\projects\ptah-extension\libs\frontend\chat-ui\src\lib\molecules\setup-plugins\mcp-directory-browser.component.ts`, `...\mcp-directory-browser.component.spec.ts`
- Plan reference: implementation-plan.md C11, C13 row "MCP Registry" (:541)
- Pattern to follow: `mcp-directory-browser.component.ts:54-71,292-430,459-480`
- Quality requirements: FIRST delete Installed view, tab strip, removal/confirm state and `connectorServers` input; keep browse, detail, install and its own `listInstalled` read for "Installed" badges; results → `ptah-catalog-card`s (projected `ptah-brand-mark` via `resolveBrandSlug`, else monogram; version/transport meta; Installed badge); detail and install → `ptah-storefront-panel` expansion; file ENDS ≤700 lines; every `data-testid` kept.
- Validation notes: imports only `@ptah-extension/ui` / `@ptah-extension/shared` for this (never marketplace or chat); spec asserts no tab strip and items inside `ptah-catalog-grid`.
- Implementation details: presentation + removal of dead code only.

### Batch 22 verification

- Line count ≤700 reported; reviewer: code-logic-reviewer (install path unchanged)

## Batch 23: skills.sh browser — narrow and restyle (C11 + C13) — PENDING

- Recommended executor: frontend-developer
- Fallback executor: none
- Execution mode: sequential
- Rationale: same file for narrowing and restyle.
- Tasks: 1 | Depends on: Batches 7d, 17
- Verification: `npx nx run-many -t lint,typecheck,test -p @ptah-extension/chat-ui` then `npx nx run-many -t typecheck -p @ptah-extension/marketplace`; `git diff --numstat`

### Task 23.1: Remove Installed view; results to `CatalogCard`s — PENDING

- Files: `D:\projects\ptah-extension\libs\frontend\chat-ui\src\lib\molecules\setup-plugins\skill-sh-browser.component.ts`, `...\skill-sh-browser.component.spec.ts`
- Plan reference: implementation-plan.md C11, C13 row "Community" (:544)
- Pattern to follow: `skill-sh-browser.component.ts:54-71,306,402-407,425`
- Quality requirements: FIRST delete Installed view and tab strip; keep browse, install, installed badges; cards with `ptah-monogram-tile`, source repo meta, install count when present, Installed badge, Install action; file ENDS ≤700 lines; every `data-testid` kept.
- Validation notes: spec asserts no tab strip; `skill-source-host.component.spec.ts` (Batch 16) still green.
- Implementation details: presentation + dead-code removal.

### Batch 23 verification

- Line count ≤700 reported; reviewer: code-logic-reviewer

## Batch 24: Ptah plugins panel restyle, everywhere (C13, D-2b) — PENDING

- Recommended executor: frontend-developer
- Fallback executor: none
- Execution mode: sequential
- Rationale: 1186-line shared component also rendered by the eager dashboard picker; carries the dashboard check and an R7 comparison.
- Tasks: 2 | Depends on: Batch 7d (runs in Wave I)
- Verification: `npx nx run-many -t lint,typecheck,test -p @ptah-extension/chat-ui @ptah-extension/dashboard`; `npx nx build ptah-extension-webview` + R7 initial-chunk comparison; `git diff --numstat`

### Task 24.1: Plugin groups to `CatalogGrid`/`CatalogCard` — PENDING

- Files: `D:\projects\ptah-extension\libs\frontend\chat-ui\src\lib\molecules\setup-plugins\plugin-catalog-panel.component.ts`, `...\plugin-catalog-panel.component.spec.ts`
- Plan reference: implementation-plan.md C13 row "Ptah Plugins" (:543), D-2b (:745)
- Pattern to follow: `ptah-catalog-grid` / `ptah-catalog-card` (Batch 7d)
- Quality requirements: plugin groups (`:357-368`) → one `ptah-catalog-grid` per group, a card per plugin with `ptah-monogram-tile` (never `ptah-brand-mark`, R7), skill/command count meta, enable toggle in `[card-actions]`, Enabled badge; skill candidates (`:259`) keep a list inside `[card-expansion]`; NO `variant` input; `saved` output and `PluginCatalogService` use unchanged; no growth; every `data-testid` kept.
- Validation notes: only selector-level spec edits, each listed.
- Implementation details: presentation only.

### Task 24.2: Dashboard picker check — PENDING

- Depends on: Task 24.1
- Files: `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\skill-selection-card\skill-selection-card.spec.ts` (one added assertion); `skill-selection-card.component.ts` only if review finds a dialog-width token adjustment is needed
- Plan reference: implementation-plan.md C13 (:543, :552), D-2b (:745)
- Pattern to follow: `skill-selection-card.spec.ts:240-255`
- Quality requirements: existing assertions unmodified; new assertion that the dialog body renders `ptah-catalog-card` items; layout check inside `modal-box max-w-2xl`: `ptah-catalog-grid` resolves to 2 columns and there is no horizontal overflow (spec or a stated manual measurement at 1100).
- Validation notes: R7 — `BRAND_MARKS` absent from the initial chunk after this batch (compare with the Batch 7c baseline).
- Implementation details: none beyond the check.

### Batch 24 verification

- Dashboard spec green; R7 table; reviewer: code-logic-reviewer

## Batch 25: Webview e2e scenarios and visual parity (B10) — PENDING

- Recommended executor: senior-tester, then visual-reviewer
- Fallback executor: frontend-developer for the fixtures
- Execution mode: sequential
- Rationale: tests and screenshots only, after every UI batch.
- Tasks: 3 | Depends on: Batches 17-24
- Verification: `npx nx run-many -t lint,typecheck -p @ptah-extension/webview-e2e-harness` then `npx nx run @ptah-extension/webview-e2e-harness:e2e`; final R7 comparison

### Task 25.1: Marketplace scenarios — PENDING

- Files: under `D:\projects\ptah-extension\libs\frontend\webview-e2e-harness\src\lib\scenarios\marketplace\`: `marketplace.fixtures.ts`, `marketplace-routes.e2e.spec.ts`, `marketplace-servers.e2e.spec.ts`
- Plan reference: implementation-plan.md plan B10 row
- Pattern to follow: `libs/frontend/webview-e2e-harness/src/lib/scenarios/thoth/skills-lane-pickers.e2e.spec.ts:250-345`
- Quality requirements: `rpc:response` fixtures reproducing `prototype-brief.md:42-69`; routes, D2 deep links, blocked popover + copy, drawer focus trap, keyboard ↑/↓/Enter/`/`/Esc.
- Validation notes: both hosts (`isElectron` true/false).
- Implementation details: test code only.

### Task 25.2: Parity screenshots — PENDING

- Depends on: Task 25.1
- Files: `D:\projects\ptah-extension\libs\frontend\webview-e2e-harness\src\lib\scenarios\marketplace\marketplace-visual.e2e.spec.ts`; output PNGs in `D:\projects\ptah-extension\.ptah\specs\TASK_2026_533_marketplace_redesign\screenshots\angular\`
- Plan reference: implementation-plan.md plan B10 row, C13 verification seam (:563)
- Pattern to follow: Task 25.1
- Quality requirements: `[data-testid=marketplace-shell]` at 720/1100/1750 in both hosts (Electron viewport adjusted until shell width matches); one `anubis-light` capture at 1100; all six discovery views at 720/1100/1750 for card-level parity with `variant-2-storefront.html`; the dashboard skill-picker dialog at 1100; 400 px compact capture without horizontal scroll.
- Validation notes: visual-reviewer compares with the eight prototype screenshots and records accepted deviations (dropped widgets) vs defects.
- Implementation details: none beyond capture.

### Task 25.3: Final R7 comparison — PENDING

- Depends on: Task 25.1
- Files: none (evidence)
- Plan reference: implementation-plan.md:734, R7
- Pattern to follow: Task 7c.2
- Quality requirements: final initial-chunk table vs the Batch 7c baseline; `BRAND_MARKS` absent from the initial chunk; only renderer, monogram, catalog pieces and `PROVIDER_BRAND_ART` added.
- Validation notes: attach to the batch report.
- Implementation details: evidence only.

### Batch 25 verification

- Real-host tier check (from Batch 3 review): in a real host build, resize the container across 900 and 1400 WITHOUT any manual change detection and assert the tier flips (rail ↔ sidebar, drawer ↔ docked detail). Belongs in `marketplace-routes.e2e.spec.ts` (Task 25.1).
- Reviewer: visual-reviewer (rendered interface parity), after senior-tester's run is green
