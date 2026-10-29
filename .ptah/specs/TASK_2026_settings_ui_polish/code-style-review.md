# Code Style Review (final round) — `TASK_2026_settings_ui_polish`

## Summary

| Metric          | Value    |
| --------------- | -------- |
| Overall score   | 8/10     |
| Assessment      | APPROVED |
| Blocking issues | 0        |
| Serious issues  | 0        |
| Minor issues    | 5        |
| Files reviewed  | 39 modified/deleted + 3 new (read in full: main-agent-section component + spec, settings-main-agent.entries.ts, surface-section component + spec; diffs for the rest) |

Scope examined: `git diff main`, the untracked files, and the deletions. `_tmp-*` files and `.ptah/specs/` ignored. Greps over the diff for `as any`, `@ts-ignore`, `as unknown as`, `eslint-disable`, `btn-xs`, `text-[10px]`/`text-[11px]` found only negative test assertions (`not.toContain('btn-xs')` and similar). Grep for "routing map", `RoutingMap`, "manage matrix" in `libs/frontend` and `apps/ptah-electron-e2e/src` finds no live code or stale comments. The only remaining mention is a deliberate history note in the count comment (`settings-reachability.table.ts:1736`). `libs/backend` and `libs/shared` are untouched, and no RPC, state service, store or save/undo change is in the diff. The one new read-only computed (`usedByLabels`) was user-approved earlier. I did not run checks.

## Five style questions

1. What breaks in six months? Test ids keep Routing-map names on a component that no longer is one (`routing-node-title`, `routing-node-status`, `routing-main-provider`, and others, `main-agent-section.component.ts:58-96`). The harness and specs depend on them, so the names will outlive the concept and a later rename costs a coordinated edit across the specs and entries. The cause is the "keep every data-testid" scope rule, so this is acceptable and documented only by implication.
2. What would a new team member misread? `has-[[role=dialog]]:z-30` is applied on both the `<section>` (`surface-section.component.ts:39`) and the host, which also gets `relative` (`:21`). The comments explain each, but a reader will wonder why two lifts exist. Also, the "Batch 28 / 28b / 52.6" comments in the new component and spec refer to history that no longer exists in this tree.
3. Maintenance cost? `PILL`/`DOT` maps plus `routeStatus` are small and tested. The new component is one compact file (157 lines) and its spec is thorough. Low cost.
4. Inconsistencies with the repo? The new files (`main-agent-section.component.ts`, its spec, `settings-main-agent.entries.ts`) have multi-name imports and long template lines that do not look Prettier-formatted (for example the imports at `main-agent-section.component.ts:4-6`, the template lines at `:61-64`, and the stub at `main-agent-section.component.spec.ts:14-24`). Siblings such as `providers-settings.component.ts` are formatted. lint-staged will normalise this on commit, so this is only a note. Naming follows convention (`*.component.ts`, `*.entries.ts`, `ptah-` selector, `output()`, `inject()`, `input()`, `@ptah-extension/*` aliases only).
5. What would I do differently? I would drop the section-level `has-[[role=dialog]]:z-30` if it is inert without a positioned section (see minor 1). I would also rename `nodeDot` to `titleDot` or inline it, since "node" is a Routing-map term.

## Blocking issues

None.

## Serious issues

None.

## Minor issues

1. `libs/frontend/ui/src/lib/surfaces/surface-section.component.ts:39` — the section's `z-30` has no `relative`, so it only takes effect if `surface-1`/`surface-2` or the glass role already position the element. The host class at `:21` is the one that provably works. Verify that the section-level class is needed, and if it is not, remove it and the matching assertion at `surface-section.component.spec.ts` (the `classList.contains('has-[[role=dialog]]:z-30')` line). This is the only shared-lib churn that might be redundant.
2. `main-agent-section.component.ts:57,137` — `nodeDot`/`main().tone` is the "node" naming left over from the removed `RoutingMapNode`. It is still used, so it is not dead code, only a stale name. `MainAgentTone` and `routeStatus` are exported but used only by this file and its spec. `routeStatus` is exported for the spec, which is fine; `MainAgentTone` could stay unexported.
3. `main-agent-section.component.ts:25-28,54,81` and `main-agent-section.component.spec.ts` ("Batch 28", "Batch 28b", "Batch 52.6", "prototype") — comments cite batches of the previous task generation. The surrounding repo does this widely (`settings-reachability.table.ts`), so it matches the local style, but several comments restate the template instead of giving a reason.
4. `main-agent-section.component.ts:115-121` — the `main` computed derives `state`, `tone`, `model`, `provider`, `status` and `footer` in one block. It works, but the loading, error and ready states are re-derived with a different expression from `routeStatus` (`route.status === 'error' ? ... : route.status === 'ready' && route.data`). Folding both onto one state discriminator would avoid two parallel branch sets.
5. `providers-settings.component.ts:888-898` — `usedByLabels` plus the `noLabels` constant exist only to feed one optional input. This is fine and user-approved. The read-only computed holds no state and does not touch services. Note only that `noLabels` is a public-looking field on the page; `private`/module const would suit it better.

## File-by-file

### `providers/main-agent-section.component.ts`
Score 8/10 — 0 B, 0 S, 3 M. Standalone, OnPush, `inject`, `output`, `computed`. Imports through aliases only. No `any` and no casts. Projection slots (`main-agent-badges`, `main-agent-popover`) are documented in the class comment. See minors 2-4.

### `providers/main-agent-section.component.spec.ts`
Score 8/10 — 0 B, 0 S, 0 M. It covers the status pill truth table (`routeStatus`, `it.each`), the model resolution variants, the not-ready and not-set states, the Reassign stretch and click, and the loading and error states. The assertions check behaviour (text, role, emitted output) and not only classes. A few class assertions (`after:inset-0`, `break-words`) are pinned by the design on purpose.

### `libs/frontend/ui/.../surface-section.component.ts` and spec
Score 8/10 — 0 B, 0 S, 1 M. The change is minimal and well typed: a new exported union `SurfaceSectionGlass`, a `glassSurface` `input()` defaulting to `'content'`, and a bound `data-glass-surface` attribute. All current consumers are inside the Settings tree, so the default changes no other surface. The spec covers the default and the `chrome` role. See minor 1.

### `providers/providers-settings.component.ts` (+ spec)
Score 8/10. The routing-map import and usage are gone, the Main agent is its own section, and the comments were retargeted ("Connect provider", "Main agent block"). No dead computed or CSS from the removed tiles was found. `CONTROL` and `retryControl` moved off `btn-xs`/`min-h-*` to `btn-sm`, as requested.

### Deleted: `routing-map*.ts`, `routing-map-node*.ts`, `settings-routing-map.entries.ts`
Clean removal. No remaining imports, barrel exports, selectors or harness references. `RM-1` is retained in `settings-main-agent.entries.ts` with the same capability, and `EXPECTED_CAPABILITY_COUNT` is 138 with an explanatory comment (`settings-reachability.table.ts:1736-1739`).

### `webview-e2e-harness/.../settings-main-agent.entries.ts`
Score 9/10. Small, typed to `ReachabilityEntry`, and reuses the `settings-drawer.reach` helpers. The header explains why it is separate from the table (`max-lines` budget). One entry only, so it adds no needless abstraction.

### Remaining Settings components (advanced, license, toast, cli matrix, orchestration, ptah-ai, popover, catalog modal, connection card, settings.component)
Score 8/10 each, presentation-only. Class swaps (`btn-xs` to `btn-sm`, `text-xs` floor, `tile` roles, `glassSurface="chrome"`), template restructuring, and comment retargets. No logic, RPC, store or save/undo changes in the diff. Test ids, aria labels and tab ids are preserved (the `orchestration` tab id is unchanged).

## Pattern compliance

| Repository rule or nearby convention | Status | Evidence |
| --- | --- | --- |
| Public alias imports only (`@ptah-extension/*`) | PASS | `main-agent-section.component.ts:3,5`; entries file uses relative imports within the same harness folder |
| Module boundaries / no `eslint-disable` | PASS | none in the diff |
| Standalone + OnPush + `input()/output()/inject()` | PASS | `main-agent-section.component.ts`, `surface-section.component.ts:17-31` |
| No `any` / `@ts-ignore` / `as unknown as` | PASS | diff grep clean |
| No `btn-xs`, `text-[10px]`, `text-[11px]` in production code | PASS | only negative test assertions |
| Filename conventions (kebab-case + role suffix) | PASS | `main-agent-section.component.ts`, `settings-main-agent.entries.ts` |
| Test ids, aria labels and tab ids preserved | PASS | `routing-node-*` kept; `orchestration` unchanged |
| No dead code left from removed nodes | PASS | grep clean; minor naming leftover only (`nodeDot`) |
| Presentation-only scope (no backend/RPC/state/store/save/undo) | PASS | `libs/backend`, `libs/shared` untouched; the only logic addition is the read-only `usedByLabels` computed (approved) |
| Shared ui lib change minimal and typed | PASS | `surface-section.component.ts:10-35` |
| Formatter conformity of new files | NOT_APPLICABLE | owned by lint-staged/Prettier; new files likely need a format pass |
| Typed RPC contract (`rpc.types.ts`) | NOT_APPLICABLE | not touched |

## Maintenance debt

- Introduced: one component (`MainAgentSectionComponent`), one shared-ui input, one read-only computed, one harness entries file.
- Retired: four Routing-map component and spec files, one harness entries file, two reachability entries (RM-2/RM-3), the "Browse catalog" and "Connect another" tiles, and the associated hero variant code.
- Net: down. About 1,340 lines removed against about 660 added.

## Verdict

- Recommendation: APPROVE
- Confidence: MEDIUM-HIGH (static review only; no checks run by me, and the visual and logic reviews are separate)
- Key concern: the duplicated `has-[[role=dialog]]:z-30` lift in `SurfaceSectionComponent` (section and host) should be confirmed necessary, since the section-level one may be inert without `relative`.
- What a 10/10 version would do differently: run Prettier over the three new files; drop or justify the section-level z-30; rename `nodeDot`/Routing-map-era test ids only if the e2e gates are migrated in the same change; unexport `MainAgentTone`; trim batch-history comments that restate the template.

---

# Follow-up round (after the final round)

Earlier findings 1, 2 and 5 are closed (1 and 5 by your explanation, 2 by the `mainDot` rename and unexport). Static review only; no checks run.

## Summary

| Metric        | Value    |
| ------------- | -------- |
| Score         | 7.5/10   |
| Assessment    | APPROVED |
| Blocking      | 0        |
| Serious       | 1        |
| Minor         | 3        |

## Serious

### Duplicated style constants and tone map between the matrix and the new instances component

- File: `ptah-ai/ptah-cli-instances.component.ts:39-62` vs `ptah-ai/cli-orchestration-matrix.component.ts:130-147`
- Problem: `DOT` is a verbatim copy (same keys and values, same `CliMatrixStatus['tone']` key type). `FOCUS` and `ACTION` are copied, and `CELL` has drifted already (`max-w-full` vs `max-w-[13rem]`, `:62` vs `:146`). Two parallel `FOCUS` strings will diverge on the next focus-ring tweak.
- Tradeoff: I would normally leave two similar things apart until a third use. This is the same tone map and focus ring, in the same folder, copied during a split. The matrix is 1305 lines (down from 1570), so the next change here is expensive.
- Recommendation: export `DOT`, `FOCUS` and `ACTION` once from a small `cli-matrix-styles.ts` (or from `cli-matrix-rows.ts`) and import in both. Leave `CELL` as two constants, since the width differs on purpose, and say so in a comment.

## Minor

1. `ptah-cli-instances.component.ts:36` and `cli-orchestration-matrix.component.ts:57,1195` — `CLI_TEST_FAILED` has a single definition (good), but it lives in the presentational child and the parent imports it. The sibling `CLI_TEST_NOT_RUN` and `CLI_TEST_NOT_STARTED` live in the matrix (`:124-127`), so the three test-message constants now sit in two files. The comment at matrix `:123` points the reader to "the instance cards". The failure sentence is also built twice with the same expression (`ptah-cli-instances.component.ts:534`, matrix `:1195`). Prefer one `CLI_TEST_*` home next to `cli-matrix-rows.ts` and one `failedTestText(reason)` helper.
2. `ptah-cli-instances.component.ts` is 536 lines. That is justified by one card template and its popovers, and it is presentational as asked: `input()`/`output()` only, no `inject()`, no services. Two soft points: the 13-output surface (`:~470-485`) mirrors the matrix's handlers one-to-one (a sign of a wide seam, not a defect), and the `PtahCliInstance*` types are exported from the component file instead of `cli-matrix-rows.ts` where `InstanceCliMatrixRow` lives.
3. Remaining `btn-xs` in `output-style/output-style-config.component.ts:85` and `output-style/output-style-editor.component.ts:146-196` (about 9 places). They sit under the Settings tree but were not in this change. If the "no btn-xs in Settings" rule is the goal, they are outstanding. If output-style is out of scope, say so in the PR.

## Checked, no finding

- **No dead code in the matrix:** `NativePopoverComponent`, `ProviderMarkComponent`, `ChevronDown` and `CliModelEffortPopoverComponent` are still used by the system rows (12 template uses). `KEY_BADGE`, `TIERS`, `tierSlots`, `tierSummary`, `tierList` and `unsetTitle` exist only in the new component. The matrix no longer carries the key-status or tier code.
- **Boundary:** the parent keeps every write, modal and focus return through the outputs (`cli-orchestration-matrix.component.ts:766-787`), so the split is presentational.
- **Imports:** aliases (`@ptah-extension/ui`) and relative same-folder imports only. No `any`, no casts.
- **Spec quality of `ptah-cli-instances.component.spec.ts` (229 lines):** it covers the empty state with its own Add, disabled Adds while busy, the "Not set" tier slot with its explanation, the Test line variants (including `CLI_TEST_FAILED` + reason), and the output emissions. Behaviour-driven.
- **btn-xs → btn-sm moves** (decision-model-*, add-cli-instance-modal, cli-tier-mapping-modal, copilot-auto-approve-toggle), the Reassign popover width, the tab label wrap rule and the narrow `@container` padding rule: presentation-only; no logic in the diff.
- **`providers-settings.component.ts`:** the own `bg-base-100` is removed (the Settings root is the single page background), with a comment giving the reason.
- **`agent-orchestration-config.component.ts`:** `max-w-full overflow-hidden` on the invisible measuring copy is a layout fix on one element.
- **Harness:** `settings-visual.e2e.spec.ts` renamed the `FoldRegion` `map` to `main` and updated the gate comments consistently. `settings-cli-matrix.entries.ts` #54/#57 follow the new DOM (tier slot label and model asserted separately via `toContainText`, which is looser than the old exact `toHaveText`) and the comment reference was retargeted to `settings-main-agent.entries.ts`.

## Verdict

- Recommendation: APPROVE (the serious item is a cleanup that can be done now or in the same PR)
- Confidence: MEDIUM-HIGH
- What improves it to 9: share `DOT`/`FOCUS`/`ACTION` and one test-message module, move the instance types beside `InstanceCliMatrixRow`, and settle the output-style `btn-xs` scope.

## Follow-up round 2 (last edits)

Scope: `provider-connection-card.component.ts` and spec, the `border-base-content/15` hairline in `providers-settings.component.ts:227` and `ptah-cli-instances.component.ts:68`. Read only; no checks run.

Verdict: APPROVED. 0 blocking, 0 serious, 3 minor.

Checked, no finding:
- Angular rules hold: standalone, OnPush, `input()` (`usedByLabels`, line ~200), `computed` (`usedForText`), no `any`, casts or `@ts-ignore`. `data-testid` values and aria labels are kept; `used-by-segment` and `used-for` are new and pinned in the spec (`spec:140-152`).
- `host: { class: 'block h-full' }` (`card.ts:68`) follows the sibling pattern (`decision-model-key-field.component.ts:61`, `main-agent-scope-badges.component.ts:53`). It is the right place for host layout rather than a wrapper element.
- The hairline `border-base-content/15` matches the token used across settings (`accounts-tab`, `settings-toast`, and others). `providers-settings.component.spec.ts:794` pins it with `arrayContaining`, which is robust to class order.

Minor:
1. `provider-connection-card.component.ts:~92` has a `<p>` inside a `<span>` (`card-subtitle`). Invalid content model (a `p` is not phrasing content). Angular builds it through the DOM so it renders, but a SSR or parse5 path would reshape it. Use a `<span class="block truncate">`; keep the testid.
2. `card.ts:70` `class="block h-full [&>div]:h-full"` on `ptah-native-card` depends on the native card's internal root being a `div`. That is a hidden coupling to its template. Cheaper and safer: a `fill`/class passthrough in `NativeCardComponent`, or a comment naming the dependency. Not worth a new input for one caller.
3. `ptah-cli-instances.component.spec.ts:59` pins only `border-t`, not `border-base-content/15`, so that hairline is unpinned while the providers one is pinned. Add the class to the assertion for parity.

Also: the template comment (`card.ts:75-79`) is long but explains a real layout constraint (80 px card gate). Keep it.
