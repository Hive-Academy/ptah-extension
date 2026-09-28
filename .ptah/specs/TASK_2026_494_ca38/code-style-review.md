# Code Style Review — `TASK_2026_494` — Batch 2 (Lib scaffolds and path mapping)

## Summary

| Metric          | Value                                |
| --------------- | ------------------------------------ |
| Overall score   | 7/10                                 |
| Assessment      | NEEDS_REVISION                       |
| Blocking issues | 1                                    |
| Serious issues  | 0                                    |
| Minor issues    | 1                                    |
| Files reviewed  | 17 (16 new scaffold files + tsconfig.base.json) |

## Five style questions

### 1. What breaks when requirements change in six months?

Nothing structural — the scaffolds carry no logic. The one latent risk is the
`typecheck` target's `forwardAllArgs: false` (`libs/frontend/declarative-dashboard/project.json:20-29`,
`libs/frontend/mcp-apps-page/project.json:20-29`): if a future contributor copies these two
libs instead of `harness-builder` as the new "canonical" pattern, the workaround propagates
and the reason it exists (a CLI-flag mismatch that batches.md itself says should instead be
solved by dropping the flag from the run command) gets lost.

### 2. What would a new team member misread here?

A new contributor scanning `libs/frontend/` for the `typecheck` target convention would find
two different shapes for what should be the same target: harness-builder's plain
`"command": "..."` string (`libs/frontend/harness-builder/project.json:20-25`) versus the new
libs' `"commands": [{ "command": "...", "forwardAllArgs": false }]` array form. Nothing in
either `project.json` explains why the new libs differ; the explanation lives only in
`batch-2-report.md`, which a reader auditing `project.json` files would not open.

### 3. What does this cost to maintain that a simpler shape would not?

Effectively zero beyond finding #1: the two scaffolds are otherwise byte-identical to
`harness-builder`'s `tsconfig.json`, `tsconfig.lib.json`, `tsconfig.spec.json`, `jest.config.ts`,
`eslint.config.mjs` and `src/test-setup.ts` (confirmed by diff-equivalent inspection), so there
is no drift to carry forward once the one target is reverted.

### 4. Where is this inconsistent with the rest of the repository?

- `typecheck` target shape vs. `harness-builder` — see finding B1 below. `forwardAllArgs: false`
  does exist elsewhere in the repo (`apps/ptah-electron/project.json:278,282,286,290`,
  `apps/ptah-extension-vscode/project.json:91,95,108,112`), but those are post-build file-copy
  steps chained via `dependsOn` inside a build pipeline, not a `typecheck` target invoked
  directly the way `harness-builder`'s is — so it is not a precedent for this specific target.
- The scaffold files themselves were produced by manually copying `harness-builder`'s files
  rather than by running an Nx generator (`batch-2-report.md:41-43`, "No Nx generator was run").
  `batches.md:24-25` frames Batch 2's own file-counting convention around "a lib scaffold
  produced by one `nx g` generator run counts as ONE generator unit" — implying the batch was
  designed assuming a generator run. The manual copy is faithful to the harness-builder pattern
  (see #3) and `npx nx show projects` confirms Nx's project-graph crystallization discovers both
  projects correctly, so this is not a functional defect, but it is a process deviation from
  what the batch itself anticipated. Minor, listed below (M1).

### 5. What would you have done differently, and why is that better rather than merely other?

Match the team-leader's ruling already recorded in `batches.md`'s own Batch 2 verification
section: keep `typecheck` as a plain `"command"` string identical to `harness-builder`'s, and
drop `--passWithNoTests` from the `nx run-many` verification command (already done per
`batches.md:80-83`) rather than special-casing the target. That keeps every `libs/frontend/*`
non-buildable-lib `typecheck` target mechanically identical, which is what a reader scanning
sibling `project.json` files expects.

## Blocking issues

### B1 — `typecheck` target uses `forwardAllArgs: false` instead of harness-builder's plain `command` form

- File: `libs/frontend/declarative-dashboard/project.json:20-29`, `libs/frontend/mcp-apps-page/project.json:20-29`
- Problem: The batch's own requirement (`batches.md:60-63`, Task 2.1 quality requirements) is
  `test`, `lint`, `typecheck` targets "like harness-builder". Harness-builder's `typecheck`
  target is `"options": { "command": "npx ngc --noEmit --project ...tsconfig.lib.json" }`
  (`libs/frontend/harness-builder/project.json:20-25`). Both new libs instead use
  `"options": { "commands": [{ "command": "...", "forwardAllArgs": false }] }`. This is the item
  the team-leader has already ruled on: revert to harness-builder's plain `"command"` form,
  because `nx.json` targetDefaults already set `passWithNoTests: true` for `@nx/jest:jest`
  (`nx.json:41-47`) and the Batch 2 verification command in `batches.md:79-83` has already been
  corrected to drop the `--passWithNoTests` flag, which is what forced the workaround in the
  first place.
- Impact: A structurally different `typecheck` target shape for these two libs versus every
  other non-buildable `libs/frontend/*` lib, carrying a workaround for a problem the batch
  command itself no longer has.
- Fix: Replace both `typecheck.options` blocks with harness-builder's plain
  `"command": "npx ngc --noEmit --project libs/frontend/<lib>/tsconfig.lib.json"` and confirm
  `npx nx run-many -t lint,typecheck,test -p @ptah-extension/declarative-dashboard @ptah-extension/mcp-apps-page`
  (no `--passWithNoTests`) still exits 0.

## Serious issues

None found. Tag sets, module-boundary compatibility, `strict: true`, absence of a `build`
target, and `tsconfig.base.json` path mapping all check out (see Pattern compliance below).

## Minor issues

- M1 — Scaffold produced by manual copy of `harness-builder` rather than an Nx generator run.
  `batch-2-report.md:41-43` discloses this directly. `batches.md:24-25` frames the batch's file
  count around a generator run ("one `nx g` generator run counts as ONE generator unit"), which
  this batch did not follow. The resulting files are faithful to the pattern and `npx nx show
  projects --projects "@ptah-extension/declarative-dashboard,@ptah-extension/mcp-apps-page" --json`
  confirms Nx discovers both projects, so there is no functional gap — flagged only because the
  next contributor scaffolding a third `libs/frontend/*` lib this way should know the generator
  was skipped here and verify the same fields by hand rather than assuming generator parity.

## File-by-file

### `libs/frontend/declarative-dashboard/project.json` / `libs/frontend/mcp-apps-page/project.json`

Score 7/10 — 1 blocking, 0 serious, 0 minor. Tags are correct and match the plan exactly:
`declarative-dashboard` carries `scope:webview`, `type:ui`, `platform:angular`
(`libs/frontend/declarative-dashboard/project.json:7`, plan `implementation-plan.md:267`);
`mcp-apps-page` carries `scope:webview`, `type:feature`, `platform:angular`
(`libs/frontend/mcp-apps-page/project.json:7`, plan `implementation-plan.md:268`). No `build`
target, matching harness-builder's non-buildable shape. The only defect is B1.

### `libs/frontend/{declarative-dashboard,mcp-apps-page}/{tsconfig.json,tsconfig.lib.json,tsconfig.spec.json}`

Score 10/10 — 0/0/0. Byte-identical to `harness-builder`'s three tsconfig files, including
`"strict": true` and the Angular strict-template `angularCompilerOptions` block.

### `libs/frontend/{declarative-dashboard,mcp-apps-page}/jest.config.ts`

Score 10/10 — 0/0/0. Identical shape to harness-builder's, `displayName` and
`coverageDirectory` correctly renamed per lib.

### `libs/frontend/{declarative-dashboard,mcp-apps-page}/eslint.config.mjs`

Score 10/10 — 0/0/0. Byte-identical to `harness-builder/eslint.config.mjs`; extends the root
`eslint.config.mjs` via a correctly-depth-counted relative import (`../../../eslint.config.mjs`).
Root `eslint.config.mjs` itself is untouched (`git status --porcelain eslint.config.mjs` shows
no change), matching the requirement.

### `libs/frontend/{declarative-dashboard,mcp-apps-page}/src/test-setup.ts` and `src/index.ts`

Score 10/10 — 0/0/0. `test-setup.ts` matches harness-builder's zone setup. `index.ts` is
`export {};` in both, matching the plan's explicit instruction (`implementation-plan.md`
Component 12 scaffold list) that the barrel starts empty; no generator sample component exists
to delete because none was generated.

### `tsconfig.base.json`

Score 9/10 — 0/1(M1 not applicable here)/0. Two new path entries added directly after
`@ptah-extension/harness-builder/services` (`tsconfig.base.json:163-168`), each pointing at
`./libs/frontend/<lib>/src/index.ts`. No `/services` subpath was added, matching D6's "dropped"
instruction. The file has no enforced alphabetical ordering across its ~300 entries (e.g.
`voice-providers` → `settings-core` → `memory-curator` at `tsconfig.base.json:120-131` is not
alphabetical), so placement next to the most closely related existing lib (`harness-builder`,
the nearest non-buildable `libs/frontend/*` scaffold) is consistent with the file's actual,
loosely-grouped convention rather than a violation of one.

## Pattern compliance

| Repository rule or nearby convention | Status | Evidence |
| --- | --- | --- |
| Lib names match plan (`@ptah-extension/declarative-dashboard`, `@ptah-extension/mcp-apps-page`) | PASS | `libs/frontend/declarative-dashboard/project.json:2`, `libs/frontend/mcp-apps-page/project.json:2` vs `implementation-plan.md:267-268` |
| Tags match plan exactly | PASS | `libs/frontend/declarative-dashboard/project.json:7`, `libs/frontend/mcp-apps-page/project.json:7` vs `implementation-plan.md:267-268` |
| `type:ui` may depend only on `type:ui`/`type:util` (declarative-dashboard's planned deps: `shared` = `type:util`) | PASS | `eslint.config.mjs:378-381`; `libs/shared/project.json:6` tags `type:util` |
| `type:feature` may depend on `type:feature`/`type:data-access`/`type:ui`/`type:util`/`type:core` (mcp-apps-page's planned deps: core=`type:core`, chat/chat-routing/chat-streaming=`type:feature`, chat-state=`type:data-access`, declarative-dashboard=`type:ui`, shared=`type:util`) | PASS | `eslint.config.mjs:364-373`; `libs/frontend/core/project.json:7`, `libs/frontend/chat/project.json:7`, `libs/frontend/chat-routing/project.json:7`, `libs/frontend/chat-streaming/project.json:7`, `libs/frontend/chat-state/project.json:7` |
| `scope:webview` may depend only on `scope:shared`/`scope:webview` | PASS | `eslint.config.mjs:263-266`; every dependency listed above is `scope:webview` or `scope:shared` |
| `"strict": true` | PASS | `libs/frontend/declarative-dashboard/tsconfig.json:5`, `libs/frontend/mcp-apps-page/tsconfig.json:5` |
| No `build` target (non-buildable) | PASS | both `project.json` `targets` blocks contain only `test`, `lint`, `typecheck` |
| `test`/`lint` targets match harness-builder | PASS | identical executor/options blocks |
| `typecheck` target matches harness-builder | FAIL | B1 above |
| No `/services` path added | PASS | `git diff tsconfig.base.json` shows only the two bare-import entries |
| Root `eslint.config.mjs` untouched | PASS | `git status --porcelain eslint.config.mjs` empty |
| `mcp-apps-page/services` + `checkDynamicDependenciesExceptions` entry dropped (R7) | PASS (N/A to create) | no `/services` file or entry exists; `implementation-plan.md:275` |

## Maintenance debt

- Introduced: two new non-buildable Angular libs with zero logic (`export {};` barrels only);
  their `test`/`lint` targets are fully aligned with the established `harness-builder` pattern
  and contribute nothing to lint/type-check surface area yet.
- Retired: nothing.
- Net: neutral to slightly positive — the scaffolds set correct module-boundary tags ahead of
  the code that will need them (Batches 3+), reducing the chance of a later retag. The one
  `typecheck` deviation is small and already scoped for a fix round.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Key concern: `typecheck` target shape in both new `project.json` files does not match the
  batch's own "like harness-builder" requirement and the team-leader's ruling to revert it.
- What a 10/10 version would do differently: use harness-builder's plain `"command"` string for
  `typecheck` in both libs (no `forwardAllArgs`), and note the generator-vs-manual-copy choice
  in `batch-2-report.md` up front rather than only in the "how files were produced" section, so
  a future scaffold batch knows to verify field-for-field rather than assume generator parity.
