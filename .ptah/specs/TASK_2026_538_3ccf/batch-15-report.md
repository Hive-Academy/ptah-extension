# Batch 15 report — v2 trust-boundary specs

Executor: senior-tester subagent. Batch is test-only; no production file was created or modified.

## Task 15.1 — v2 cases in the shared trust-boundary spec

File modified: `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\shared\src\mcp-apps-contracts\dashboard-trust-boundary.spec.ts`

- Change: append-only. `git diff --stat` shows `249 insertions(+)`, `0` deletions. Every v1 `describe` block (control 1
  through control 5) is byte-for-byte unedited; the new v2 material is added as new `describe` blocks after the last
  v1 block, with a header comment explaining why it exists and what it does and does not prove (matching the v1
  file's own convention).
- New imports (all additive, at the top of the file): `makeSurfaceEnvelope` from
  `../testing/fixtures/surface`, `SURFACE_PATH_DENYLIST` from `./surface-catalog`, `formatSurfaceSubmitMessage`
  from `./surface-submit.format`, `validateSurfaceDocument` / `validateSurfaceUpdateInput` from
  `./surface.validator`.
- New `describe` blocks, each proving its control at the WHOLE-DOCUMENT / WHOLE-REQUEST validator boundary
  (`validateSurfaceDocument` / `validateSurfaceUpdateInput`), the same framing the v1 blocks use ("whole spec, not
  just the node") and a framing that no other v2 spec file exercises (the others test individual schemas or the
  namespace/store layer):
  1. `v2 control 1 — action allowlist`: an unknown action (`shell.exec`, then
     `ptah_harness_install_mcp_server`) embedded in an otherwise valid document is rejected, both as a bare
     document and through a `create` update input.
  2. `v2 control 3a — text format channel stays plain-only`: `title.format: 'markdown'` is rejected at the
     whole-document boundary.
  3. `v2 control 3b — markup characters are inert, unparsed data`: an `<img onerror>`/`<script>` string placed in
     `title.text`, a component `title.text` and a `stat` `value` round-trips byte-for-byte through
     `validateSurfaceDocument` (`ok: true`, and the returned parsed values equal the original string exactly). The
     comment states plainly that proving the RENDERER treats it as text (never `innerHTML`) is TASK_2026_494's
     obligation, exactly as the v1 control 3 block already states for v1.
  4. `v2 control 4 — URL scheme allowlist reused for v2 actions and list items`: `javascript:`, `data:` and
     `http:` URLs are each rejected both as an action `url` and as a list-item `url`, inside an otherwise valid
     document.
  5. `v2 control — prototype-pollution path rejected before any write`: each of `SURFACE_PATH_DENYLIST`
     (`__proto__`, `prototype`, `constructor`) is rejected (a) as a `set-data` patch path through
     `validateSurfaceUpdateInput`, and (b) as a top-level `dataModel` key through `validateSurfaceDocument`; both
     cases assert `Object.prototype` was never mutated to the injected value afterward.
  6. `v2 control — submit content marks an agent-declared label as data, not instructions`: a spoofed action/input
     label containing a fake `[END SURFACE SUBMISSION <the-real-nonce>]` delimiter stays fenced inside the real
     nonce-scoped block and parses back as one JSON value, never as a second delimiter.
- Deliberately NOT added: a backup non-finite-number case (`Infinity`/`-Infinity`/`NaN`). Task 4.4 already pins
  this for stat/chart/data values in `surface-validator.spec.ts:340`, `surface-data-model.spec.ts:224-226` and
  `surface-contract.spec.ts:501`. batches.md's own wording for Task 15.1 is conditional ("backup ... if Task 4.4 has
  not already pinned it") — it has, so adding a duplicate here would violate the "avoid duplicating coverage"
  instruction. This is recorded in a header comment in the file itself, not just here.

### Coverage already present elsewhere (checked, not duplicated)

- Schema-level equivalents of controls 1, 2, 4 and 5 (unknown action, no `any`/passthrough/unknown, URL scheme on
  `SurfaceActionSchema` directly, path/key denylist on every schema) are already pinned in
  `surface-contract.spec.ts` ("surface actions and requests", "surface JSON and path boundary", and "keeps the new
  source free of unchecked schema escape hatches and type-side value imports"). What Task 15.1 adds is the same
  properties proven at the validator entry point instead of at individual schemas.
- Prototype-pollution at the pure data-model layer (`applyDataModelOps`) is pinned in `surface-data-model.spec.ts`
  and `surface-patch.spec.ts` ("rejects denied data segments and leaves Object.prototype untouched"). Task 15.1's
  cases exercise the same property one layer up, through the full request validator.
- The spoofing-label control is pinned exhaustively (multiline values, Unicode line separators, byte-limit
  interaction) in `surface-submit.format.spec.ts`. The new case here is a single confirming instance framed as the
  NFR trust-boundary control, not a repeat of that matrix; a comment says so.

## Task 15.2 — `surface-trust-boundary.spec.ts` in vscode-lm-tools

File created: `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\surface\surface-trust-boundary.spec.ts` (166 lines).

- The file-name/location deviation from the NFR row (which names only `dashboard-trust-boundary.spec.ts`) is
  recorded in the file's header comment, exactly as batches.md Task 15.2 and the plan anticipate: this file needs a
  real `DashboardSurfaceHost` and a real routing id, which only exist in this project.
- Three tests, built on `buildSurfaceNamespace` + a real `SurfaceStateService` + a fake `DashboardSurfaceHost` (same
  setup shape as `surface-namespace.builder.spec.ts`):
  1. **Markup through the push payload**: creates a surface whose title/component-title/value all carry
     `<img src=x onerror=alert(1)><script>alert(document.cookie)</script>`, then inspects the exact 3-arg
     `host.sendMessage(viewId, type, payload)` call the push produces. Asserts the payload's `change.kind` is
     `'snapshot'`, and that the markup string reaches `payload.change.state.content.surface.title.text`,
     `...components[0].title.text` and `...components[0].value` completely unchanged (`toBe(MARKUP)`), and that the
     serialized payload still contains the literal `<script>...</script>` substring — proving nothing between the
     MCP tool call and the host-bound push payload escapes, strips or interprets it.
  2. **Cross-routing-id read, `ptah_surface_get_state`**: a surface created under `tab-a` is read by `tab-b`, both
     with an explicit `surfaceId` and with the unscoped index view (`{}`); both answer `not-found`, and the index
     text for `tab-b` never mentions `tab-a`'s surface id.
  3. **Cross-routing-id write, `ptah_surface_update`**: a `patch` from `tab-b` against `tab-a`'s surface id is
     rejected with a reason naming `not-found`, and `host.sendMessage` is not called.
- The exhaustive cross-routing-id matrix (foreign id, missing id, forged `sessionId`/`routingId` argument, for
  BOTH tools) is already pinned in `surface-namespace.builder.spec.ts` ("returns the same not-found result for
  foreign and missing ids for each tool", `:154-219`; "rejects a forged %s in tool arguments", `:207-219`). This
  file does not repeat that matrix; it adds one confirming case per tool and says so in the header comment, per the
  "avoid duplicating coverage" instruction.
- The Batch 11 carry-forward (no raw error text crosses the RPC boundary; `SURFACE_SUBMIT_INDETERMINATE_DETAIL` /
  `SURFACE_SUBMIT_DEADLINE_DETAIL` are fixed strings) is noted in the header comment as already pinned in
  `surface-submit-turn.service.spec.ts` and `surface-submit-turn.deadline.spec.ts`; it is intentionally not
  duplicated here, as batches.md Task 15.2 directs.

## Risk R12 (security items from the NFR/risk table)

R12 lists prototype pollution, spoofed submit labels, forged renderer parameters and cross-routing reads, and
states "Batch 15 pins them in the trust-boundary specs." Disposition:

- Prototype pollution: pinned at the whole-request boundary in Task 15.1 (new, this batch) and already pinned at
  the data-model layer by Task 1.5/4.4 — both layers now covered.
- Spoofed submit labels: pinned exhaustively by Batch 10 (`surface-submit.format.spec.ts`); Task 15.1 adds one
  confirming trust-boundary case.
- Forged renderer parameters (a `sessionId`/`routingId` argument added by the agent): already pinned by
  `surface-namespace.builder.spec.ts:207-219` ("rejects a forged %s in tool arguments"); not duplicated here.
- Cross-routing reads: pinned at the store/namespace layer by `surface-namespace.builder.spec.ts:154-219`, and now
  also pinned at the push-payload layer (markup case) and confirmed once more per tool in Task 15.2 (new, this
  batch).

## Files touched

- Modified: `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\shared\src\mcp-apps-contracts\dashboard-trust-boundary.spec.ts`
- Created: `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\surface\surface-trust-boundary.spec.ts`

No production file was created or modified. No file outside `libs/shared` and `libs/backend/vscode-lm-tools` was
touched; the concurrent Batch 14 files visible in `git status` (`apps/ptah-electron/src/di/surface-composition.spec.ts`,
`apps/ptah-extension-vscode/src/di/surface-composition.spec.ts`,
`libs/backend/cli-engine/src/lib/surface-composition.spec.ts`, and the modified
`webview-manager-adapter.spec.ts` / `cli-webview-manager-adapter.spec.ts`) were not created or edited by this
batch.

## Line-length note

`dashboard-trust-boundary.spec.ts` is now 754 lines: over the project's 700-line soft ceiling, under the 1,000-line
hard one. This mirrors the precedent already accepted for `surface-validator.spec.ts` (908 lines, Batch 4: "over
the 700-line soft ceiling, under 1,000. Do not split it now."). Splitting would mean either editing v1's block
structure (forbidden — "existing spec assertions stay unedited") or creating a second, disconnected v2
trust-boundary file inside the same directory, which would fragment the single-file "one control, one place"
structure the v1 file already establishes and that batches.md Task 15.1 explicitly asks to extend in place. No
split was made; flagging it here for `future-enhancements.md` is the same disposition Batch 4 used.

## Verification

Command (batch's own, as specified): `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared @ptah-extension/vscode-lm-tools`

Result: all 6 tasks (typecheck × 2, test × 2, lint × 2) succeeded.

- `@ptah-extension/shared` test: 77/77 suites passed, 2,111/2,111 tests passed.
- `@ptah-extension/vscode-lm-tools` test: 65/65 suites passed, 1,394/1,394 tests passed.
- `@ptah-extension/shared` lint: 0 errors, 5 warnings (pre-existing; a direct `eslint` run scoped to
  `dashboard-trust-boundary.spec.ts` alone produced 0 problems).
- `@ptah-extension/vscode-lm-tools` lint: 0 errors, 44 warnings (pre-existing; a direct `eslint` run scoped to
  `surface-trust-boundary.spec.ts` alone produced 0 problems).
- Both `typecheck` targets passed with 0 errors.

No test was left unexecuted, skipped or weakened. No production defect was found by this batch's tests (all cases
passed against the existing implementation from Batches 1, 4, 8-11 and 13; two assertions in the prototype-pollution
cases were corrected during authoring — `toBeUndefined()` is wrong for the `constructor` segment, since
`Object.prototype.constructor` legitimately resolves to `Object`; both cases now assert `not.toBe(true)`, the
injected pollution value, which is correct for all three denylisted segments).

## Revision 1

Codex review `code-logic-review-batch-15.md`: 7/10 NEEDS_REVISION, one MODERATE finding (F1, test-oracle gap). The
prototype-pollution `it.each` tables in the v2 block of `dashboard-trust-boundary.spec.ts` were driven directly by
the production constant `SURFACE_PATH_DENYLIST`. Removing an entry (e.g. `'constructor'`) from that constant would
silently remove its own regression case, so the suite would stay green while the public validators started
accepting the now-undenied segment — a shrinking test oracle tied to the thing it is supposed to police.

### Fix

File: `libs/shared/src/mcp-apps-contracts/dashboard-trust-boundary.spec.ts` (the appended v2 block only; no other
line in the file changed; v1 blocks untouched).

- Replaced `it.each(SURFACE_PATH_DENYLIST)` (both tables: the `set-data` patch-path case and the data-model-key
  case) with `it.each(REQUIRED_DENIED_SEGMENTS)`, a test-owned literal `['__proto__', 'prototype', 'constructor'] as
  const` declared inside the `describe` block. `task-description.md:171` states this exact set is mandatory ("shall
  reject the segments `__proto__`, `prototype` and `constructor`"), which is where the three literal values come
  from.
- Added one new, independent test: `'requires the production denylist to still contain every mandatory segment'`,
  which asserts `SURFACE_PATH_DENYLIST` still `toContain` each of the three required segments. This is the
  independent-membership assertion the review asked for, separate from the case-generation table, so narrowing the
  production constant now fails this test directly, in addition to whichever per-segment cases it would otherwise
  silently drop.
- `SURFACE_PATH_DENYLIST` stays imported and used (in the new membership test), so no import became dead.
- Net size change: `+11` lines net (one new test, a `REQUIRED_DENIED_SEGMENTS` constant and a explanatory comment
  citing the review and the requirement). The file is 765 lines; still the same "over the 700-line soft ceiling,
  under 1,000" disposition recorded in the original report, and still smaller than the accepted
  `surface-validator.spec.ts` precedent (908 lines).

### Mutation proof (requested by the coordinator)

Reproduced the exact regression the review found, then confirmed the fix closes it:

1. Edited `libs/shared/src/mcp-apps-contracts/surface-catalog.ts` in place, removing `'constructor'` from
   `SURFACE_PATH_DENYLIST` (temporary, in-memory-equivalent local edit — not committed, no git command run).
2. Ran `npx nx test @ptah-extension/shared --testPathPattern="dashboard-trust-boundary"`. Result: **3 tests failed**
   (`Test Suites: 1 failed, 76 passed, 77 total`; `Tests: 3 failed, 2106 passed, 2109 total`) — the new membership
   test, the `'constructor'` `set-data`-path case, and the `'constructor'` data-model-key case. Before the fix
   (SURFACE_PATH_DENYLIST-derived tables), the equivalent mutation dropped those same two cases from the table
   entirely and the suite stayed green, per the reviewer's own in-memory probe (`code-logic-review-batch-15.md:146`,
   "12 instead of 14... all passing").
3. Reverted the edit: `git diff --stat libs/shared/src/mcp-apps-contracts/surface-catalog.ts` now shows no output
   (clean; the file matches its pre-mutation state).

This confirms the regression the review demonstrated is now caught: removing a mandatory denylist entry fails the
spec suite instead of silently shrinking it.

### Verification (post-fix, post-revert)

Command: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared` (scoped, as instructed).

- All 3 targets succeeded (typecheck, test, lint), exit 0.
- Test: 77/77 suites passed, 2,112/2,112 tests passed (one more test than the original 2,111 — the new membership
  assertion).
- Lint: cache hit, 0 errors (same baseline as the original report). `npx eslint` scoped directly to
  `dashboard-trust-boundary.spec.ts` produced 0 output (clean).
- `git diff --stat` confirms only `dashboard-trust-boundary.spec.ts` changed on disk relative to the pre-revision
  commit (264 insertions, 0 deletions); `surface-catalog.ts` has no diff.

No file outside `libs/shared/src/mcp-apps-contracts/dashboard-trust-boundary.spec.ts` was left modified. No git
write command was run.
