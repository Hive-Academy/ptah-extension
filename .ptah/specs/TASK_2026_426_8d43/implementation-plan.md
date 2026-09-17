# Implementation Plan - TASK_2026_426

## Inputs and constraints

- Requirements used:
  - `D:/projects/ptah-extension/.claude-worktrees/skills-tab-clone-management-681582aee5c4/.ptah/specs/TASK_2026_426_8d43/task-description.md` (APPROVED; 22 acceptance criteria are binding)
  - `D:/projects/ptah-extension/.claude-worktrees/skills-tab-clone-management-681582aee5c4/.ptah/specs/TASK_2026_426_8d43/context.md`
- Corrections applied: none (no correction document in the task folder)
- Design handoff used: none (no `visual-design-specification.md` / `design-handoff.md`; this is an extension of an existing surface and reuses its tokens)
- Missing decision-critical input: none. No `research-report.md` exists; nothing in this task needed one — every decision below is settled from repository source.

### Two corrections to the brief, both load-bearing

1. **The shared RPC contract file is `libs/shared/src/lib/types/rpc.types.ts`, not
   `libs/shared/src/lib/types/rpc/rpc.types.ts`.** The `rpc/` subfolder holds the
   per-namespace child type files that the root file imports and re-exports
   (`rpc.types.ts:29`, `:395-420`).
2. **Registering a new method is FOUR sites, not two.** The brief said only the
   shared-types entry is new. Verified:
   - `libs/shared/src/lib/types/rpc/rpc-skill-clone.types.ts` — the params/result
     interfaces.
   - `libs/shared/src/lib/types/rpc.types.ts` — the type import block
     (`:395-420`), the `RpcMethodRegistry` entry (`:622` opens the interface;
     `skillSynthesis:keepClone` sits at `:1738`), AND the `RPC_METHOD_ENTRIES`
     literal (`:3560-3610`) that `RPC_METHOD_NAMES` is derived from (`:3719`).
   - `SkillsSynthesisRpcHandlers.METHODS` — `skills-synthesis-rpc.handlers.ts:236-279`,
     declared `as const satisfies readonly RpcMethodName[]`. `RPC_HANDLER_MANIFEST`
     references this tuple (`host-profile/manifest.ts:322`) and `rpc-allowlist.spec.ts`
     asserts the manifest partitions `RPC_METHOD_NAMES` EXACTLY — so a method added
     to `rpc.types.ts` but not to this tuple fails that spec, and vice versa.
   - `ALLOWED_METHOD_PREFIXES` — `libs/backend/vscode-core/src/messaging/rpc-handler.ts:81`
     already carries `'skillSynthesis:'`. **No change here.** (The root `CLAUDE.md`
     cites `rpc-handler.ts:46` for this array; the array actually starts at `:44`
     and the prefix is at `:81`. Do not "fix" line 46.)

## Codebase evidence

| Evidence                                                                                                                           | Location                                                                    | Architectural implication                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reconcile decides on `sourceHash` vs two live hashes only; `currentContentHash` is never read by it                                | `user-layer-mirror.service.ts:1131-1153` (dir), `:1193-1214` (file)          | The save path may write `currentContentHash` freely, but writing `sourceHash` would arm the fast-forward branch and silently eat the user's edit         |
| `currentContentHash` has no reader anywhere except SQLite persistence                                                              | grep: only writers in `user-layer-mirror.service.ts`; read at `skill-enhancer.service.ts:508` → `skill-registry.store.ts:158` | It is bookkeeping, not a control input. Updating it is honest; omitting it would leave a stale value                                                     |
| Fast-forward fires only when `liveCloneHash === sidecar.sourceHash`                                                                | `user-layer-mirror.service.ts:1138`, `:1200`                                | After any user body edit the clone hash differs from `sourceHash`, so the reconciler marks diverged instead of overwriting — this is what satisfies R3.8 |
| `rebaseDirClone` / `rebaseFileClone` snapshot, copy upstream, then set `sourceHash = currentContentHash = newSourceHash`, `diverged:false`, `pendingSourceHash: undefined` | `:773-793`, `:819-839`                                                      | Bulk rebase needs no new sidecar logic at all — composing the existing per-clone call gives the correct end state                                        |
| `keepClone` adopts `pendingSourceHash ?? sourceHash` as the new `sourceHash` and clears `diverged`                                 | `:842-888`                                                                  | Reusing this for a body save would silently adopt the upstream the user never saw. Rejected — see Architecture decision                                  |
| `writeEnhancedSkill` `mkdir`s the clone dir when absent; both `writeEnhanced*` set `lastEnhancedAt: Date.now()`                    | `:504-508`, `:517`, `:552`, `:561`, `refreshEnhancedSidecarDir` `:725-743`   | Neither may be reused for a user save: R3.7 forbids creating a file, and `lastEnhancedAt` drives `enhanceCooldownUntil` (`skills-synthesis-rpc.handlers.ts:1884-1887`) |
| `withSlugLock` serialises by `${kind}/${slug}`, awaits the prior holder, releases in `finally`                                     | `:1306-1332`                                                                | Routing the save through the same public-method pattern gives the NFR Concurrency guarantee with no new primitive                                        |
| `assertUnderUserLayer` refuses outside `~/.ptah/user` and inside `~/.ptah/plugins`; `writeTextAtomic` calls it before any write     | `user-layer-fs-ops.ts:49-63`, `:129-131`                                    | The second gate is already in place on the exact primitive the save will use                                                                            |
| Snapshot helpers: `snapshotDirToHistory` (dir → own `.history/<ts>/`), `snapshotFileToHistory` (file → root `.history/<slug>/<ts>/`) | `user-layer-fs-ops.ts:232-239`, `:263-275`                                  | Mandatory-snapshot NFR is satisfiable with existing code; note the two kinds use DIFFERENT layouts and the dispatch must match `listHistory` (`:580-617`) |
| A clone with NO sidecar means "user-authored, hands off" and is never classified or reaped                                          | `origin-sidecar.types.ts:119-127`, `:155-168`                               | The save must NOT synthesize a sidecar for a clone that has none — doing so enrols a user-authored file into reaping                                     |
| `SlugSchema` already rejects `..`, `/`, `\`, empty, >128 chars; `SkillCloneKindSchema` is the closed kind enum                      | `skills-synthesis-rpc.schema.ts:324-334`                                    | R3.5's three named rejections are satisfied by reusing these, not by writing new ones                                                                    |
| `parseParams` converts a Zod throw into `RpcUserError(..., 'INVALID_PARAMS')`; `toUserError` returns a generic message             | `skills-synthesis-rpc.handlers.ts:1820-1836`, `:1848-1853`                  | NFR Security "never return a raw filesystem error string" is the existing house pattern — reuse verbatim                                                 |
| `readCloneBody` maps kind → path (`<skills>/<slug>/SKILL.md`, `<agents\|commands>/<slug>.md`) and containment-checks before reading | `skills-synthesis-rpc.handlers.ts:1954-1985`                                | The write path must resolve the identical path, or save and re-read disagree                                                                            |
| `rebaseClone` returns `{ failed: true, reason }` instead of throwing for a missing upstream                                        | `skills-synthesis-rpc.handlers.ts:1259-1270`; `mirror` `:764-771`, `:810-817` | A batch can aggregate per-clone outcomes without try/catch gymnastics — R1.4 is cheap                                                                    |
| `rebaseClone` handler clears the SQLite registry flags only when `!result.failed`                                                  | `skills-synthesis-rpc.handlers.ts:1259-1262`                                | `listClones` reads `diverged` from the registry row (`:1877`), so R1.5 holds automatically for bulk rebase                                               |
| `listClones` takes `diverged` from the registry row and `orphaned` from a sidecar sweep                                            | `:1877`, `:1888`, `readOrphanFlags` `:1921-1936`                            | `orphaned` may be `undefined`; the bulk filter must use `=== true` (contract note at `rpc-skill-clone.types.ts:44-47`)                                   |
| `cloneActionModel` already refuses Rebase for `authored`/`synth` and only offers it when `diverged`                                | `clone-action-gating.ts:192-220`, `hasUpstreamSource` `:86-88`              | Bulk eligibility must be derived from this module, not re-invented in the view                                                                           |
| `REBASE_EXPLANATION` is the canonical sentence for what a rebase does                                                              | `clone-action-gating.ts:69-71`                                              | R1.3's confirmation reuses it verbatim rather than authoring a second wording                                                                            |
| `visibleClones` filters by kind only; `tabs` counts by kind                                                                        | `skill-clones-view.component.ts:341-353`                                    | The diverged filter composes with the existing kind filter in one `computed`                                                                             |
| `SkillClonesStateService.divergedCount` exists, counts ALL kinds, and has no production consumer                                   | `skill-clones-state.service.ts:47-49`; grep: only its own spec at `:96`      | Leave it alone; add a per-kind derivation in the view. Changing its semantics would break a passing spec for no gain                                     |
| `CloneDetailDrawerComponent` is strictly presentational — `input()` in, `output()` out, no injected service                        | `clone-detail-drawer.component.ts:363-386`                                  | The editor extends that contract; the RPC call stays in the smart view                                                                                  |
| Drawer renders the body through `ptah-markdown-block`, never `[innerHTML]`                                                         | `clone-detail-drawer.component.ts:251`                                      | The read-only half stays exactly as it is; only an edit MODE is added beside it                                                                          |
| Whole Skills tab already renders a desktop-only placeholder when `!isElectron()`                                                   | `skill-synthesis-tab.component.ts:85-109`; clones view `:97-107`            | R3.9 and the clones half of R2.6 are already satisfied structurally; only the harness deep link is new VS Code surface                                   |
| `SkillsSynthesisRpcHandlers` and the `skillSynthesis` capability are pinned ABSENT in the VS Code host                             | `apps/ptah-extension-vscode/src/di/expected-absent.ts:39`, `:54`            | The deep link must be gated on `isElectron()` or it offers a destination that cannot exist (R2.6)                                                        |
| `thothActiveTab` lives in the per-workspace `ViewSlice`; the only production caller of `setThothActiveTab` is the Thoth shell      | `app-state.service.ts:169-176`, `:334-336`, `:589-594`; `thoth-shell.component.ts:268` | `AppStateManager` is the one place both `marketplace` and `skill-synthesis-ui` can meet; the new intent belongs there but NOT in the retained slice      |
| `harness-health-badge.component.ts:157` is the only instantiation of `ptah-harness-target-row`; it injects only `HarnessHealthStore` | `harness-health-badge.component.ts:23`, `:59`, `:157`, `:202`               | The row stays dumb (`output()`); the badge becomes the container that knows about navigation                                                             |
| `overwrittenLocalEdit` is `string[]` of target-relative paths (`.codex/agents/x.toml`), not slugs                                   | `libs/shared/src/lib/types/harness-sync.types.ts:138`; `workspace-target.ts:886` | Mapping a report entry back to a clone slug would need a per-target inverse transform that does not exist — deep link carries no slug                    |
| The row's own copy already says "Edit skills in the Ptah user layer"; `harness-health.model.ts:94-97` calls it "actionable information" | `harness-target-row.component.ts:131-132`                                   | The deep link is the missing verb on an affordance the repository already decided should be actionable                                                   |

## Architecture decision

- **Chosen approach**: two thin capabilities layered on what exists.
  1. **Bulk rebase is orchestrated in the frontend**, as a sequential loop over the
     existing `skillSynthesis:rebaseClone` RPC, owned by a new injectable
     `CloneBulkRebaseService` in `skill-synthesis-ui`. No new backend method, no new
     rebase implementation, no change to `UserLayerMirrorService`.
  2. **Body save is a new backend write**: one RPC method
     `skillSynthesis:saveCloneBody` → one new public method
     `UserLayerMirrorService.saveCloneBody`, which snapshots, writes atomically, and
     updates exactly ONE sidecar field.

- **Rationale**:
  - R1.2 names `skills-synthesis-rpc.handlers.ts:1229` — the `registerMethod` call
    for `skillSynthesis:rebaseClone` — as "the same rebase path". A frontend loop
    invokes literally that. A backend batch method would have to re-derive
    eligibility, and eligibility is deliberately owned by `clone-action-gating.ts`
    ("the rules are a correctness concern, not a presentation one", `:8-14`), which
    is a frontend module the backend cannot import.
  - Per-clone outcome reporting (R1.4), in-flight control disabling (R1.7) and the
    single post-batch refresh (R1.5) are all UI state. A server-side batch would
    return them as a payload the UI would then have to re-render anyway.
  - The save must be a backend write because `~/.ptah/user` is only reachable
    through `UserLayerFsOps`, and the frontend must not import backend libs.

- **Rejected alternatives**:
  - _A `skillSynthesis:rebaseDiverged` batch RPC._ Loses on three counts: it
    duplicates the eligibility rule across the boundary; it adds a second write
    RPC in a task whose security NFR is about adding one; and it makes partial
    progress invisible until the whole batch settles, which is exactly the risk
    row "Bulk rebase over many clones blocks the UI with no progress".
  - _Parallel `Promise.all` over the eligible set._ `withSlugLock` serialises only
    per slug, so 15 concurrent rebases each run a full directory hash and tree copy
    at once. Sequential costs wall-clock time the user is already waiting through,
    and buys deterministic per-clone progress. Rejected for no upside.
  - _Reusing `writeEnhancedSkill` / `writeEnhancedFileClone` for the save._ They
    `mkdir` a missing clone (`:507`), which violates R3.7, and they stamp
    `lastEnhancedAt` (`:517`, `:552`, `:561`), which feeds `enhanceCooldownUntil`
    (`skills-synthesis-rpc.handlers.ts:1884-1887`) and the drawer's "Last enhanced"
    metric (`clone-detail-drawer.component.ts:426-431`). A manual edit is not an
    enhancement; recording it as one suppresses auto-enhancement and lies in the UI.
  - _Reusing `keepClone`'s sidecar update for the save (open question 2)._ See below.

- **Open question 1 — kind scope of the bulk action: CURRENT KIND ONLY.**
  The list is kind-tabbed (`skill-clones-view.component.ts:341-353`) and the bulk
  action is destructive with no diff preview (explicitly out of scope). A control
  that acts on rows the user cannot see is a trap: they cannot check what is about
  to be replaced, and R1.3's count would name clones off-screen. Acting on exactly
  the visible, filterable set keeps the confirmation honest.
  The measured cost is the 15-agents-plus-1-skill state needing two gestures. That
  is paid for with a required, inert addition to the count readout: when other
  kinds hold eligible clones, the counter appends `(M in other kinds)`. It offers
  no action and starts no write — it simply stops the user believing they are done.
  Evidence that the residual is cheap to compute: the full list is already in
  `this.clones()` across all kinds (`:347`).

- **Open question 2 — sidecar state after a body save: DO NOT clear `diverged`.**
  The save writes `currentContentHash` and nothing else.
  Both candidate answers are DATA-SAFE, and it matters that this is stated
  precisely, because the risk register frames it as a corruption question:
  - Leave the flags: next reconcile sees `liveSourceHash !== sourceHash` and
    `liveCloneHash !== sourceHash` → `markDiverged*` (`:1147`, `:1208`). The body is
    untouched. R3.8 holds.
  - `keepClone` semantics: `sourceHash := pendingSourceHash` → next reconcile is a
    noop (`:1132`). The body is untouched. R3.8 also holds.
  The deciding difference is consent, not bytes. `keepClone` semantics make a Save
  button permanently discard an upstream change the user was never shown —
  `KEEP_MINE_EXPLANATION` (`clone-action-gating.ts:63-66`) exists precisely because
  users pick that outcome by accident. `diverged` means "upstream moved and you have
  local edits — pick one", and editing the body does not make that untrue; the two
  buttons that DO resolve it are already in the same drawer
  (`clone-detail-drawer.component.ts:185-218`). Leaving the flag also keeps the new
  diverged filter and count truthful: a clone the user edited but never reconciled
  still needs attention.
  This is not "diverged forever" — it is diverged until the user presses Rebase or
  Keep mine, which is the existing, reversible, one-click resolution.
  **The one field that must never be written on a save is `sourceHash`.** Setting it
  to the fresh content hash makes `liveCloneHash === sidecar.sourceHash` true, which
  arms the fast-forward branch (`:1138`) and lets the next upstream move silently
  overwrite the user's edit — the exact defect R3.8 forbids.

- **Open question 3 — deep link payload: FILTER ONLY, no clone selection.**
  `overwrittenLocalEdit` carries target-relative output paths
  (`harness-sync.types.ts:138`; pushed as `write.relPath` at `workspace-target.ts:886`),
  e.g. `.codex/agents/backend-developer.toml`. Recovering a `(kind, slug)` from one
  needs a per-target inverse of the fan-out transform, which does not exist and
  would be a new manifest-reverse concept. The criteria require only the filter
  (R2.5), so the link carries only the filter.

- **Assumptions**:
  - _Assumption_: `RPC_METHOD_ENTRIES` in `rpc.types.ts:3560-3610` must gain a
    `'skillSynthesis:saveCloneBody': true,` line alongside the `RpcMethodRegistry`
    entry. **Check**: after adding both, run
    `npx nx run-many -t test -p @ptah-extension/rpc-handlers` and confirm
    `rpc-allowlist.spec.ts` passes; it asserts the manifest partitions
    `RPC_METHOD_NAMES` exactly.
  - _Assumption_: a 1 MiB body cap is generous. **Check**: the largest shipped skill
    body measured in `context.md` is ~16 KB (`~/.ptah/plugins/ptah-core/skills/orchestration`,
    15986 bytes). Executor confirms no shipped clone exceeds the cap before landing it.

- **Effect on existing code**:
  - **Replaced**: the inert `<p data-testid="harness-target-overwritten">`
    (`harness-target-row.component.ts:124-134`) becomes a `<button>` with the same
    testid and copy plus an accessible name. Not added beside — replaced.
  - **Extended in place**: `visibleClones` gains a diverged predicate;
    `CloneDetailDrawerComponent` gains an edit mode that replaces the read-only
    render while active; `SkillsSynthesisRpcHandlers` gains one `registerX` sibling.
  - **Left alone**: `UserLayerMirrorService.rebaseClone` / `keepClone` /
    `writeEnhanced*` / the reconcile path; `HarnessReconcilerService` and every
    `harness-sync` target; `SkillClonesStateService.divergedCount`;
    `lazy-diff-view.component.ts`; the VS Code host profile and `expected-absent.ts`.
  - **No compatibility shim anywhere.** Both capabilities are new surface on an
    Electron-only tab; there is no old path to keep alive.

## Component specifications

### 1. `skillSynthesis:saveCloneBody` wire contract (shared)

- **Purpose**: name the one new RPC method and its payload once, where both sides
  compile against it.
- **Responsibilities**: declare `SkillSynthesisSaveCloneBodyParams` and
  `...Result`; register the method in `RpcMethodRegistry` and `RPC_METHOD_ENTRIES`.
- **Verified contracts and entry points**:
  - Sibling shapes to match: `SkillSynthesisRebaseCloneParams/Result`
    (`rpc-skill-clone.types.ts:156-167`), `SkillSynthesisKeepCloneParams/Result`
    (`:169-177`).
  - `SkillCloneKind` (`rpc-skill-clone.types.ts:9`).
  - Registry interface opens at `rpc.types.ts:622`; the `skillSynthesis:` block runs
    `:1638-1805`; `keepClone` sits at `:1738`.
  - Type import block from the child file: `rpc.types.ts:395-420`.
  - `RPC_METHOD_ENTRIES` `skillSynthesis:` block: `rpc.types.ts:3560-3610`;
    `RPC_METHOD_NAMES` derived at `:3719`.
- **Contract**:

  ```ts
  export interface SkillSynthesisSaveCloneBodyParams {
    kind: SkillCloneKind;
    slug: string;
    /** Full replacement body. Not a patch — the file is overwritten. */
    body: string;
  }
  export interface SkillSynthesisSaveCloneBodyResult {
    kind: SkillCloneKind;
    slug: string;
    /**
     * `.history/<ts>/` stamp of the snapshot taken BEFORE the overwrite.
     * Never null on a successful save: the clone is required to exist
     * (R3.7), so there is always prior content to snapshot.
     */
    historyTs: string;
  }
  ```

- **Dependencies**: none. `libs/shared` imports no other `@ptah-extension/*` lib.
- **Integration points**: `SkillsSynthesisRpcHandlers.METHODS`, the manifest's
  `satisfies` assertion, the frontend RPC facade.
- **Failure behaviour**: compile-time only. A missing `RPC_METHOD_ENTRIES` line
  fails `rpc-allowlist.spec.ts`, not runtime.
- **Quality requirements**: not applicable (type declarations).
- **Verification seam**: `npx nx run-many -t typecheck -p @ptah-extension/shared @ptah-extension/rpc-handlers`
  plus `rpc-allowlist.spec.ts`.
- **Files**:
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/skills-tab-clone-management-681582aee5c4/libs/shared/src/lib/types/rpc/rpc-skill-clone.types.ts`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/skills-tab-clone-management-681582aee5c4/libs/shared/src/lib/types/rpc.types.ts`

### 2. `SkillSaveCloneBodyParamsSchema` — the first validation gate

- **Purpose**: reject a malformed slug, kind or body BEFORE any path is constructed.
- **Responsibilities**: one Zod object, composed from the schema primitives already
  in the file.
- **Verified contracts and entry points**:
  - `SkillCloneKindSchema` — `skills-synthesis-rpc.schema.ts:324`.
  - `SlugSchema` — `:326-334`. Already `.min(1).max(128)`, `/^[a-z0-9][a-z0-9._-]*$/i`,
    and a `.refine` rejecting `..`, `/`, `\`. This covers R3.5's three named cases;
    do not author a second slug rule.
  - Sibling shape: `SkillRebaseCloneParamsSchema` `:393-396`.
- **Contract**:

  ```ts
  /** ~1 MiB. UTF-16 code units, not bytes — z.string().max counts units. */
  const MAX_CLONE_BODY_CHARS = 1_048_576;

  export const SkillSaveCloneBodyParamsSchema = z.object({
    kind: SkillCloneKindSchema,
    slug: SlugSchema,
    body: z.string().min(1).max(MAX_CLONE_BODY_CHARS),
  });
  ```

  `.min(1)` is deliberate: an empty body would be reconciled outward as an empty
  skill in every harness directory. Emptying a clone is not a capability this task
  offers, so it is a rejected input rather than a silent one.
- **Dependencies**: `zod` only.
- **Integration points**: consumed exclusively by component 3 via `parseParams`.
- **Failure behaviour**: throws; `parseParams` (`skills-synthesis-rpc.handlers.ts:1820-1836`)
  converts it to `RpcUserError(..., 'INVALID_PARAMS')` and logs the raw Zod message
  at `warn` server-side only.
- **Quality requirements**: security — this is the boundary the NFR names. It runs
  before `join`, before `assertUnderUserLayer`, before any `fs` call.
- **Verification seam**: a unit spec asserting each of `slug: '../x'`, `slug: 'a/b'`,
  `slug: 'a\\b'`, `kind: 'plugin'`, `body: 42`, `body: ''` fails the parse.
- **Files**:
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/skills-tab-clone-management-681582aee5c4/libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.schema.ts`

### 3. `registerSaveCloneBody` — the RPC handler

- **Purpose**: validate, confirm the clone exists, delegate the write, and return a
  sanitised result.
- **Responsibilities**: parse params; `requireDesktop` the registry and the mirror;
  reject an unknown clone; call `mirror.saveCloneBody`; map a `written: false`
  result to a user error; never surface a raw filesystem message.
- **Verified contracts and entry points**:
  - `parseParams` — `:1820-1836`; `requireDesktop` — `:1838-1846`;
    `toUserError` — `:1848-1853`; `report` — `:2078-2083`.
  - `registry.getBySlug(kind, slug)` existence check, modelled on
    `registerRebaseClone` `:1239-1245`.
  - `this.agentScope()` — `:1909-1919` — supplies `workspaceRoot`, which is
    meaningful for `agent` and ignored for `skill`/`command`
    (`user-layer-mirror.service.ts:132-141`).
  - `registerMethod` signature — `rpc-handler.ts:154-170`; the `skillSynthesis:`
    prefix is allowed at `:81`.
  - Must be called from `register()` (`:344-391`) and listed in `METHODS` (`:236-279`).
- **Contract**: `parseParams(SkillSaveCloneBodyParamsSchema, params, 'skillSynthesis:saveCloneBody')`
  → `mirror.saveCloneBody({ kind, slug, body, workspaceRoot: this.agentScope() })`.
- **Dependencies**: the already-injected `registry` and `mirror` (constructor
  `:298-301`). **No new constructor parameter.**
- **Integration points**: `SkillSynthesisRpcService.saveCloneBody` is its only caller.
- **Failure behaviour**, each mapped explicitly:
  | Condition | Response |
  | --- | --- |
  | Schema reject | `RpcUserError('Invalid parameters for skillSynthesis:saveCloneBody', 'INVALID_PARAMS')`; no path built, no write (R3.5) |
  | No registry row | `RpcUserError('No cloned <kind> found for slug "<slug>".', 'INVALID_PARAMS')` (R3.7) |
  | Registry row present, file absent on disk | mirror returns `written: false, reason: 'clone-missing'` → same `INVALID_PARAMS` error; nothing is created (R3.7) |
  | `assertUnderUserLayer` throws | caught by the generic `catch`; `report(...)` to log+Sentry; `toUserError(...)` to the webview. The refusal surfaces as an error, never a silent no-op (R3.6), and the raw path never crosses the wire (NFR Security) |
  | Mirror or registry absent (non-desktop) | `requireDesktop` → `PERSISTENCE_UNAVAILABLE` |
- **Quality requirements**: security as above. Performance: one hash of a file or a
  small tree; no timeout concern at `PROMOTE_MS`.
- **Verification seam**: handler spec asserting each row of that table, plus a
  success case asserting the mirror is called with exactly
  `{ kind, slug, body, workspaceRoot }`.
- **Files**:
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/skills-tab-clone-management-681582aee5c4/libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts`

### 4. `UserLayerMirrorService.saveCloneBody` — the write

- **Purpose**: replace one clone's body under the per-slug lock, with a snapshot
  first and exactly one sidecar field changed.
- **Responsibilities**: lock, resolve, refuse-if-absent, snapshot, write, rehash,
  patch sidecar.
- **Verified contracts and entry points**:
  - `withSlugLock` — `:1306-1332`. Public-method shape to mirror: `rebaseClone`
    `:473-482`, `keepClone` `:484-493` (lock, then dispatch dir vs file).
  - `getUserLayerRoots(workspaceRoot)` — the agent root is workspace-keyed; roots
    doc at `:132-141`.
  - `this.fsOps.writeTextAtomic` via the private wrapper `:745-750`; the wrapper
    calls `assertUnderUserLayer` at `user-layer-fs-ops.ts:130`.
  - `snapshotDirToHistory` (`:1287-1289` → `user-layer-fs-ops.ts:232`) for `skill`;
    `snapshotFileToHistory` (`:1298-1304` → `user-layer-fs-ops.ts:263`) for
    `agent`/`command`. The two layouts differ and must match `listHistory`
    (`:580-617`), or the new snapshot never appears in the drawer's history list.
  - `computeSourceHash` — `source-hash.ts`; hashes a file directly or a tree
    excluding `.history/` and the sidecar.
  - `readSidecar` / `writeSidecarAtomic` (dir) and `readSidecarAt` /
    `writeSidecarAtomicAt` (file), as used at `:730-742` and `:547-563`.
  - `ORIGIN_SIDECAR_SUFFIX` path shape for file clones — `:532`, `:803`, `:871`.
- **Contract**:

  ```ts
  export interface SaveCloneBodyArgs extends WorkspaceScopedArgs {
    kind: OriginKind;
    slug: string;
    body: string;
  }
  export interface SaveCloneBodyResult {
    kind: OriginKind;
    slug: string;
    /** Snapshot stamp; null only when `written` is false. */
    historyTs: string | null;
    written: boolean;
    /** `'clone-missing'` when the target file/dir is not on disk. */
    reason: string | null;
  }
  ```

  Result-shaped rather than throwing, matching `RebaseResult`'s `failed?`/`reason?`
  idiom (`:149-156`). The mirror lives in `agent-generation` and must not mint RPC
  error types; the handler does the mapping.
- **Sidecar state machine — the binding rule**:

  | Field                | On save                                   | Why                                                                                     |
  | -------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------- |
  | `currentContentHash` | **set** to the post-write hash            | The only field describing live content; every other writer maintains it                   |
  | `sourceHash`         | **untouched — never write it**            | Writing it arms the fast-forward branch (`:1138`, `:1200`) and eats the edit. Defeats R3.8 |
  | `diverged`           | **untouched**                             | Open question 2. Editing a body does not resolve "upstream moved"                          |
  | `pendingSourceHash`  | **untouched**                             | It is the record of WHICH upstream is unaccepted; clearing it loses that                   |
  | `lastEnhancedAt`     | **untouched**                             | Drives `enhanceCooldownUntil` and the "Last enhanced" metric. A user edit is not an enhancement |
  | `clonedAt`, `pluginId`, `version`, `historyDir`, `orphaned` | **untouched**    | Provenance, not content                                                                    |
  | Sidecar entirely absent | **do not create one**                  | No sidecar means "user-authored, hands off" (`origin-sidecar.types.ts:119-127`). Writing one enrols the file into classification and reaping. The body write still succeeds |

  **No SQLite registry write.** `listClones` reads `diverged` and
  `pendingSourceHash` from the registry row (`skills-synthesis-rpc.handlers.ts:1877`,
  `:1882`) and neither changes; `historyCount` is computed live from `listHistory`
  (`:1862-1872`). Calling `registry.setDiverged` here would contradict the decision
  above.
- **Ordered steps** (identical shape for both kinds, differing only in path and
  snapshot helper):
  1. `withSlugLock(kind, slug, …)`.
  2. Resolve root from `getUserLayerRoots(workspaceRoot)`; build
     `<skills>/<slug>/SKILL.md` or `<agents|commands>/<slug>.md` — the same paths
     `readCloneBody` reads (`skills-synthesis-rpc.handlers.ts:1967-1970`).
  3. `assertUnderUserLayer` on the target file (and on the clone dir for `skill`).
  4. Existence probe. Absent → return `{ written: false, reason: 'clone-missing' }`.
     **No `mkdir`, no create.**
  5. Snapshot — `snapshotDirToHistory(cloneDir)` or
     `snapshotFileToHistory(rootDir, slug, cloneFile)`. Capture `basename(...)` as
     `historyTs`.
  6. `writeTextAtomic(targetFile, body)`.
  7. `computeSourceHash(cloneDir | cloneFile)`.
  8. Read sidecar; if present, write back `{ ...existing, currentContentHash }`; if
     absent, skip.
  9. Return `{ kind, slug, historyTs, written: true, reason: null }`.
- **Dependencies**: `fsOps` (already injected), `source-hash`, the sidecar helpers.
  No new dependency, no new DI token.
- **Integration points**: called only by component 3.
- **Failure behaviour**: the snapshot precedes the write, so a write failure leaves
  both the original file (atomic rename never happened) and a recoverable snapshot.
  Any throw propagates through `withSlugLock`'s `finally`, which releases the lock
  (`:1326-1331`). A save issued while a boot-time reconcile holds the same slug lock
  queues behind it rather than interleaving (NFR Concurrency).
- **Quality requirements**: data safety — a destructive write with no preceding
  snapshot is a defect; step 5 is not optional.
- **Verification seam**: service spec against a temp `~/.ptah/user` fixture:
  (a) body lands on disk; (b) a snapshot dir exists and `listHistory` returns one
  more entry; (c) the sidecar's `sourceHash`, `diverged`, `pendingSourceHash` and
  `lastEnhancedAt` are byte-identical before and after, and `currentContentHash`
  changed; (d) a missing clone returns `written: false` and creates no file;
  (e) **the R3.8 regression test**: save, then run the reconcile pass with a MOVED
  upstream, and assert the saved body is still on disk and the clone is marked
  diverged rather than fast-forwarded.
- **Files**:
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/skills-tab-clone-management-681582aee5c4/libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.ts`

### 5. `clone-action-gating` — bulk eligibility and the editor predicate

- **Purpose**: keep every "may this action be offered" rule in the one pure,
  framework-free, unit-tested module.
- **Responsibilities**: add two pure functions and one constant. No component logic.
- **Verified contracts and entry points**:
  - `hasUpstreamSource(clone)` — `:86-88` — already encodes "the backend can resolve
    an upstream for this".
  - `cloneActionModel` — `:148-221` — already returns `rebase: null` for an entry
    with no upstream or no divergence.
  - `REBASE_EXPLANATION` — `:69-71`.
  - `CloneSummary.orphaned` is OPTIONAL and its contract note
    (`rpc-skill-clone.types.ts:44-47`) requires `=== true`, never a truthiness flip.
  - The module is already exported from `libs/frontend/skill-synthesis-ui/src/index.ts:17-28`.
- **Contract**:

  ```ts
  /** Clones of one kind that the bulk rebase may act on. */
  export function eligibleForBulkRebase(
    clones: readonly CloneSummary[],
    kind: SkillCloneKind,
  ): CloneSummary[];
  // kind match AND diverged AND orphaned !== true AND hasUpstreamSource(c)

  /** Whether the drawer may offer the body editor for this entry. */
  export function canEditCloneBody(
    clone: CloneSummary,
    body: string | null,
  ): boolean; // body !== null — R3.1 requires a loaded body to seed from

  export const BULK_REBASE_EXPLANATION: string;
  // REBASE_EXPLANATION plus the batch sentence; the confirmation appends the count.
  ```

  `orphaned === true` excludes the clone (R1.6), and `hasUpstreamSource` excludes
  `authored`/`synth` — without which the batch would fire doomed calls that the
  backend answers `Cannot resolve upstream source`
  (`skills-synthesis-rpc.handlers.ts:1248-1252`).
- **Dependencies**: `@ptah-extension/shared` types only.
- **Integration points**: components 6, 7, 8.
- **Failure behaviour**: pure; returns an empty array rather than throwing.
- **Quality requirements**: maintainability — no eligibility rule may be spelled a
  second time in a template or a component.
- **Verification seam**: extend `clone-action-gating.spec.ts` — orphaned excluded,
  authored/synth excluded, non-diverged excluded, other kinds excluded,
  `orphaned: undefined` INCLUDED (the `=== true` trap).
- **Files**:
  - MODIFY `.../libs/frontend/skill-synthesis-ui/src/lib/components/clones/clone-action-gating.ts`
  - MODIFY `.../libs/frontend/skill-synthesis-ui/src/lib/components/clones/clone-action-gating.spec.ts`
  - MODIFY `.../libs/frontend/skill-synthesis-ui/src/index.ts` (export the two new symbols beside the existing gating exports at `:17-28`)

### 6. `CloneBulkRebaseService` — the batch runner

- **Purpose**: run the per-clone rebase once per eligible clone, sequentially,
  surviving individual failures, exposing progress as signals.
- **Responsibilities**: hold `running` / `progress` / `outcomes`; loop; aggregate.
  It does NOT decide eligibility (component 5), does NOT render, does NOT refresh
  the list (its caller does).
- **Verified contracts and entry points**:
  - `SkillSynthesisRpcService.rebaseClone(kind, slug)` —
    `skill-synthesis-rpc.service.ts:480-493` — returns
    `SkillSynthesisRebaseCloneResult` and throws on transport failure.
  - `SkillSynthesisRebaseCloneResult.failed` / `.reason`
    (`rpc-skill-clone.types.ts:160-167`) is the soft-failure channel; the existing
    single-clone path reads it at `skill-clones-view.component.ts:501-508`.
- **Contract**:

  ```ts
  export interface BulkRebaseOutcome {
    readonly slug: string;
    readonly ok: boolean;
    readonly reason: string | null;
  }
  @Injectable() // provided by the view, not root — its state is one surface's
  export class CloneBulkRebaseService {
    readonly running: Signal<boolean>;
    /** `{ done, total }` while running. */
    readonly progress: Signal<{ done: number; total: number } | null>;
    readonly outcomes: Signal<readonly BulkRebaseOutcome[]>;
    run(clones: readonly CloneSummary[]): Promise<readonly BulkRebaseOutcome[]>;
    reset(): void;
  }
  ```

- **Dependencies**: `SkillSynthesisRpcService` via `inject()`. No backend import.
- **Integration points**: component 7 only.
- **Failure behaviour** (R1.4 in full): each iteration is individually try/caught.
  A thrown transport error and a `failed: true` result both become
  `{ ok: false, reason }` with the slug named, and the loop continues to the next
  clone. `running` is cleared in a `finally`, so an unexpected throw cannot leave
  the UI permanently disabled. The batch never aborts early.
- **Quality requirements**: performance — sequential by design; see the rejected
  alternative. Accessibility — `progress` exists so the caller can announce it.
- **Verification seam**: service spec with a stubbed RPC where clone 2 of 3 throws
  and clone 3 returns `failed: true`: assert all three were attempted, three
  outcomes returned, the two failures name their slugs, and `running` ends `false`.
- **Files**:
  - CREATE `.../libs/frontend/skill-synthesis-ui/src/lib/services/clone-bulk-rebase.service.ts`
  - CREATE `.../libs/frontend/skill-synthesis-ui/src/lib/services/clone-bulk-rebase.service.spec.ts`

### 7. `SkillClonesViewComponent` — filter, count, bulk control, save orchestration

- **Purpose**: the smart shell. Own the new UI state and the RPC orchestration.
- **Responsibilities**: diverged filter signal; per-kind eligible count plus the
  other-kinds residual; the bulk confirmation dialog; disable conflicting controls
  in flight; consume the deep-link intent; forward a body save and reload the detail.
- **Verified contracts and entry points**:
  - `visibleClones` `:341-344` and `currentKind()` `:566-569` — the filter composes
    into the existing `computed`.
  - `tabs` `:346-353` — already counts per kind off the full list, so the residual
    count needs no new data.
  - Existing confirmation dialog `:248-295` (`clones-reconcile-modal`,
    `clones-reconcile-explanation`, `-cancel`, `-confirm`) — the bulk confirmation
    is a second `<dialog>` of the same construction, same `role`/`aria-modal`.
  - `busySlug` `:318`, `showToast` `:577-580`, `toMessage` `:582-584`,
    `state.refreshClones()` `:362-364`, `state.loadDetail` `:371`.
  - The desktop placeholder `:97-107` already covers R2.6/R3.9 for this surface.
  - The `(rebase)`/`(keep)` per-clone bindings `:206-207`, `:231-232` are the
    controls R1.7 must disable.
- **New state**:
  - `divergedOnly = signal<boolean>(false)`.
  - `bulkEligible = computed(() => eligibleForBulkRebase(this.clones(), this.currentKind()))`.
  - `divergedInOtherKinds = computed(...)` — eligible clones whose kind differs.
  - `bulkConfirmOpen = signal<boolean>(false)`.
  - `actionsLocked = computed(() => this.bulk.running() || this.busySlug() !== null)`.
  - `visibleClones` gains `&& (!this.divergedOnly() || c.diverged)`.
- **R1.1**: render the bulk control whenever the kind tab is active; when
  `bulkEligible().length === 0`, render it `disabled` with a stated reason
  ("Nothing to rebase in this kind — no diverged clone has an upstream to rebase
  onto"). Not silently absent.
- **R1.3**: the confirmation names `bulkEligible().length` and renders
  `BULK_REBASE_EXPLANATION`. Nothing is written before `(click)` on confirm.
- **R1.5**: after `bulk.run(...)` settles, call `state.refreshClones()` ONCE. The
  count and the filtered list are `computed` off `state.clones()`, so they update
  with no reload.
- **R1.7**: `[disabled]="actionsLocked()"` on the bulk button, the refresh button,
  the confirm button, and `[busy]` on every card and the drawer.
- **R2.3**: when `divergedOnly()` is true and `visibleClones()` is empty, the
  existing `clones-empty` branch `:181-191` renders distinct copy
  ("No diverged entries in this kind.") — an empty state, never a blank region.
- **R3.2/R3.4**: `onSaveBody(req)` → `state.saveCloneBody(...)` → on success
  `state.loadDetail(slug, kind)` and `state.refreshClones()`, mirroring the
  post-apply refresh already at `:459-466`. `historyCount` rises because the mirror
  snapshotted.
- **R3.3**: cancel is handled entirely inside component 8; no output reaches here.
- **Dependencies**: adds `CloneBulkRebaseService` (component 6) and
  `AppStateManager` (component 9) via `inject()`. Provides
  `CloneBulkRebaseService` on the component so its state dies with the surface.
- **Integration points**: components 5, 6, 8, 9; `SkillClonesStateService`.
- **Failure behaviour**: batch outcomes render as a summary toast naming the failed
  slugs ("Rebased 13 of 15. Failed: `x`, `y`."). A save failure reuses `showToast`
  with `toMessage(err)` — the message is already sanitised server-side by
  `toUserError`.
- **Quality requirements**: accessibility — the filter is a real `<button>` or
  checkbox with `aria-pressed`; the bulk control carries an accessible name naming
  the count; the dialog keeps `role="dialog" aria-modal="true"` and a keyboard-
  reachable Cancel, matching `:249-255`.
  Maintainability — the file is 585 lines and the ceiling is a 700-line WARN.
  Moving the batch loop into component 6 and the eligibility rule into component 5
  is what keeps the addition small. **If the file still crosses 700, the facade rule
  applies**: extract the bulk confirmation dialog as
  `BulkRebaseConfirmComponent` (a nameable collaborator with its own
  inputs/outputs), keeping `ptah-skill-clones-view`'s selector and behaviour.
  Never a `helpers`/`utils` file.
- **Verification seam**: extend `skill-clones-view.component.spec.ts` — filter
  toggles the rendered set; count matches the eligible set; the control is disabled
  with a reason at zero; confirm triggers exactly `N` `rebaseClone` calls; a
  mid-batch failure still reaches the last clone and names the failed slug; the
  empty state renders under an emptied filter; conflicting controls are disabled
  while running.
- **Files**:
  - MODIFY `.../libs/frontend/skill-synthesis-ui/src/lib/components/clones/skill-clones-view.component.ts`
  - MODIFY `.../libs/frontend/skill-synthesis-ui/src/lib/components/clones/skill-clones-view.component.spec.ts`
  - MODIFY `.../libs/frontend/skill-synthesis-ui/src/lib/services/skill-clones-state.service.ts` (add `saveCloneBody`, delegating to the RPC facade and reloading `detail`)
  - MODIFY `.../libs/frontend/skill-synthesis-ui/src/lib/services/skill-synthesis-rpc.service.ts` (add the `saveCloneBody` wrapper beside `keepClone` `:496-509`, at `PROMOTE_MS`)

### 8. `CloneBodyEditorComponent` + drawer edit mode

- **Purpose**: let the user replace a clone body in place, with explicit Save and
  Cancel, without turning the presentational drawer into a smart component.
- **Responsibilities**: the editor owns the draft text and the dirty state; the
  drawer owns which mode the Body section is in and forwards the intent upward.
- **Verified contracts and entry points**:
  - The Body section — `clone-detail-drawer.component.ts:237-261`; the read-only
    render is `<ptah-markdown-block [content]="text" />` at `:251`.
  - Drawer inputs `:365-378`, outputs `:380-386` — the shape the new members join.
  - The lib's Angular conventions: standalone, `OnPush`, signals, `input()`/`output()`.
- **Contract**:

  ```ts
  // clone-body-editor.component.ts — selector 'ptah-clone-body-editor'
  value   = input.required<string>();  // seed (R3.1)
  saving  = input<boolean>(false);
  save    = output<string>();
  cancel  = output<void>();

  // drawer additions
  canEditBody  = input<boolean>(false); // from canEditCloneBody(); false in VS Code
  bodySaving   = input<boolean>(false);
  bodySaved    = output<CloneBodySaveRequest>(); // { clone, body }
  ```

- **R3.1**: an "Edit" affordance appears in the Body section header when
  `canEditBody()`; activating it REPLACES the markdown render with the editor,
  seeded from `body()`.
- **R3.3**: Cancel discards the draft and restores the markdown render. No output is
  emitted, so no write can occur.
- **R3.9**: `canEditBody` is fed from the view, which is behind the Electron
  placeholder (`skill-clones-view.component.ts:97-107`) — the affordance cannot
  render in VS Code.
- **Never `[innerHTML]`.** The editor is a `<textarea>`; the preview stays
  `ptah-markdown-block` (`libs/frontend/markdown`). Both halves are bound as text.
- **Dependencies**: `@angular/forms` for the textarea binding; nothing else. The
  drawer keeps its existing imports (`:79-85`) plus the editor.
- **Integration points**: component 7 handles `bodySaved`.
- **Failure behaviour**: presentational — it emits and waits. While `saving()` is
  true, Save and Cancel are disabled so a double-submit cannot race the lock. A
  failed save leaves the drawer in edit mode with the draft intact; the error
  arrives as the view's toast.
- **Quality requirements**: accessibility — the textarea carries a visible label or
  `aria-label` naming the clone; Save/Cancel are real buttons in DOM order; focus
  moves into the textarea on entering edit mode and back to the Edit button on
  cancel. The drawer is 437 lines; adding a mode switch plus four members keeps it
  well under 700 because the editor itself is a separate file.
- **Verification seam**: a new `clone-body-editor.component.spec.ts` (seeds from
  `value`, emits the edited text on save, emits nothing on cancel, disables both
  while `saving`) plus a drawer spec asserting the markdown block is absent in edit
  mode and the Edit affordance is absent when `canEditBody()` is false.
- **Files**:
  - CREATE `.../libs/frontend/skill-synthesis-ui/src/lib/components/clones/clone-body-editor.component.ts`
  - CREATE `.../libs/frontend/skill-synthesis-ui/src/lib/components/clones/clone-body-editor.component.spec.ts`
  - MODIFY `.../libs/frontend/skill-synthesis-ui/src/lib/components/clones/clone-detail-drawer.component.ts`
  - MODIFY `.../libs/frontend/skill-synthesis-ui/src/index.ts` (export the component and the `CloneBodySaveRequest` type beside the existing drawer exports at `:11-15`)

### 9. The deep link — one-shot intent on `AppStateManager`

- **Purpose**: carry "open Skills → Library, filtered to diverged" from the
  marketplace harness panel to the skills tab across a lib boundary, exactly once.
- **Responsibilities**: `AppStateManager` gains one navigation method and one
  consumable flag. Nothing else learns about the other lib.
- **Verified contracts and entry points**:
  - `setThothActiveTab(tab)` — `app-state.service.ts:589-594`; `ThothActiveTabId`
    includes `'skills'` (`thoth-shell.component.ts:241`).
  - `setCurrentView('thoth')` — the view pointer setter, exercised at
    `app-state.service.spec.ts:536`.
  - `ViewSlice` — `:169-176` — holds RETAINED per-workspace pointers, migrated by
    `switchWorkspace` and cleaned by `removeWorkspaceState` (`:164-168`).
  - `marketplace` already depends on `@ptah-extension/core` (`harness-health.store.ts:2`)
    and on `AppStateManager` (`marketplace-state.service.ts`).
  - The Skills tab's sub-view state: `SkillSubView` union including `'clones'`
    (`skill-synthesis-tab.component.ts:52-57`), `_subView` `:878`, `setSubView` `:915`.
- **Contract**:

  ```ts
  /**
   * A one-shot navigation INTENT, deliberately NOT part of ViewSlice.
   * ViewSlice holds retained pointers that survive a workspace switch; this is
   * consumed on arrival. Putting it in the slice would re-apply the filter every
   * later visit to the Skills tab.
   */
  openSkillsDivergedClones(): void; // setCurrentView('thoth') + setThothActiveTab('skills') + raise the flag
  consumeSkillsDivergedRequest(): boolean; // read-and-clear
  ```

- **Wiring, end to end**:
  1. `HarnessTargetRowComponent` — the `<p>` at `:124-134` becomes a `<button>`
     keeping `data-testid="harness-target-overwritten"` and the existing copy, with
     `aria-label` naming the destination ("… — open the Skills library filtered to
     diverged entries"). It emits a new `openDivergedClones = output<void>()`.
     The row stays pure: one input, one output, no injection (its doc at `:16-35`
     says "takes a `HarnessTargetHealth` and emits nothing" — update that line).
  2. `HarnessHealthBadgeComponent` (`:157`) binds that output to
     `appState.openSkillsDivergedClones()`. It injects `AppStateManager` and
     `VSCodeService` (it currently injects only `HarnessHealthStore`, `:202`).
     **R2.6**: when `!isElectron()`, render the original inert `<p>` instead of the
     button — the destination does not exist in that host
     (`expected-absent.ts:39`, `:54`).
  3. `SkillSynthesisTabComponent` — an `effect()` calls
     `consumeSkillsDivergedRequest()` and, when true, `setSubView('clones')`.
  4. `SkillClonesViewComponent` — the same effect chain sets `divergedOnly` to true,
     so the list arrives already filtered (R2.5).
     Executor's choice of mechanism: a single consumption in the tab that also sets
     an `@Input`-style signal on the view, OR two consumptions of two flags. Prefer
     ONE flag consumed in the tab, passed down as an `input()` on the clones view —
     a read-and-clear consumed twice is a race between two effects.
- **Dependencies**: `marketplace` → `@ptah-extension/core` (existing edge);
  `skill-synthesis-ui` → `@ptah-extension/core` (existing edge,
  `skill-clones-view.component.ts:36`). **No new lib edge, and no
  `marketplace` ↔ `skill-synthesis-ui` edge — which is the point of routing through
  `core`.**
- **Integration points**: components 7 and the Skills tab shell.
- **Failure behaviour**: the flag is read-and-clear. If the Skills tab never mounts,
  the flag simply stays raised until something consumes it; it starts no write and
  affects nothing else. The navigation cannot fail — both setters are synchronous
  signal updates.
- **Quality requirements**: accessibility — a `<button>` is keyboard-reachable by
  construction and carries an accessible name stating where it leads (R2.4).
- **Verification seam**: `app-state.service.spec.ts` — the method sets both
  pointers and raises the flag; the second `consume` returns false. Marketplace spec
  — the control is a button in Electron and inert text in VS Code, and activating it
  calls `openSkillsDivergedClones` exactly once. Skills tab spec — a raised flag
  lands on the `clones` sub-view with the filter applied.
- **Files**:
  - MODIFY `.../libs/frontend/core/src/lib/services/app-state.service.ts`
  - MODIFY `.../libs/frontend/core/src/lib/services/app-state.service.spec.ts`
  - MODIFY `.../libs/frontend/marketplace/src/lib/harness/harness-target-row.component.ts`
  - MODIFY `.../libs/frontend/marketplace/src/lib/harness/harness-health-badge.component.ts`
  - MODIFY `.../libs/frontend/marketplace/src/lib/harness/harness-health-badge.component.spec.ts`
  - MODIFY `.../libs/frontend/skill-synthesis-ui/src/lib/components/skill-synthesis-tab.component.ts`
  - MODIFY `.../libs/frontend/skill-synthesis-ui/src/lib/components/skill-synthesis-tab.component.spec.ts`

## Integration architecture

### Data flow A — bulk rebase (UI signal to disk)

```
click "Rebase all diverged (N)"        skill-clones-view.component.ts
  → bulkConfirmOpen.set(true)          renders count + BULK_REBASE_EXPLANATION (R1.3)
  → confirm
  → CloneBulkRebaseService.run(eligibleForBulkRebase(clones, currentKind))
      for each clone, SEQUENTIALLY:
        SkillSynthesisRpcService.rebaseClone(kind, slug)      rpc.service.ts:480
          → ClaudeRpcService.call('skillSynthesis:rebaseClone')
          → RpcHandler (prefix allowed, rpc-handler.ts:81)
          → registerRebaseClone                              handlers.ts:1229
              parseParams(SkillRebaseCloneParamsSchema)       :1230
              registry.getBySlug → resolveUpstreamSourceDir   :1239, :1246
              mirror.rebaseClone({kind,slug,sourceDir,ws})    :1253
                withSlugLock                                  mirror:474
                  snapshot → clear → copyTree/copyFileAtomic  mirror:775-778 / :821-824
                  sidecar: sourceHash=new, diverged=false,
                           pendingSourceHash=undefined        mirror:781-792 / :827-838
              registry.setDiverged(false); setPending(null)   :1260-1261  (only if !failed)
        outcome recorded; loop continues on failure           (R1.4)
  → state.refreshClones()  ONCE                               (R1.5)
  → count + filtered list recompute from signals; no reload
```

### Data flow B — body save

```
Edit → textarea → Save                 clone-body-editor.component.ts
  → drawer emits bodySaved {clone, body}
  → view: state.saveCloneBody(kind, slug, body)
      → SkillSynthesisRpcService.saveCloneBody
      → ClaudeRpcService.call('skillSynthesis:saveCloneBody')
      → RpcHandler prefix check                        rpc-handler.ts:81 (unchanged)
      → registerSaveCloneBody
          parseParams(SkillSaveCloneBodyParamsSchema)  ← GATE 1: before any join
          registry.getBySlug → reject if absent        (R3.7)
          mirror.saveCloneBody({kind,slug,body,ws})
            withSlugLock(kind, slug)                   mirror:1306
              resolve path from getUserLayerRoots
              assertUnderUserLayer(target)             ← GATE 2  fs-ops:49 (R3.6)
              exists? no → { written:false }           (R3.7, no create)
              snapshotDirToHistory | snapshotFileToHistory   (mandatory, NFR)
              writeTextAtomic  (assertUnderUserLayer again, fs-ops:130)
              computeSourceHash
              sidecar := { ...existing, currentContentHash }  ← ONLY field written
      → state.loadDetail(slug, kind)  → drawer re-renders saved body,
                                        historyCount +1        (R3.4)
```

### Data flow C — deep link

```
harness health panel: "N local edits replaced…"  (button, Electron only)
  → HarnessHealthBadgeComponent → AppStateManager.openSkillsDivergedClones()
      setCurrentView('thoth'); setThothActiveTab('skills'); flag := true
  → SkillSynthesisTabComponent effect consumes flag → setSubView('clones')
  → SkillClonesViewComponent receives it → divergedOnly := true    (R2.5)
```

- **State or persistence**: the sidecar `.ptah-origin.json` is the only persisted
  state this task writes, and it writes exactly one of its fields. The SQLite
  registry is written only by the existing rebase handler, unchanged. All new UI
  state is component-lifetime signals; nothing new is retained across a workspace
  switch, which is why the deep-link intent is deliberately outside `ViewSlice`.

- **External boundaries**: one — `skillSynthesis:saveCloneBody`. Two gates in this
  order: Zod at the handler (before any `join`), then `assertUnderUserLayer` inside
  `writeTextAtomic`. `~/.ptah/plugins` remains refused by
  `user-layer-fs-ops.ts:57-62` and this task does not touch it.

- **Failure and rollback**:
  - _Partial batch failure_: no rollback is attempted or wanted. Each rebase is
    independently committed and independently snapshotted; a failure mid-batch
    leaves earlier clones correctly rebased. Rolling them back would undo work the
    user asked for because a later, unrelated clone had no upstream.
  - _Save failure after snapshot_: the snapshot exists and the original file is
    intact (`writeTextAtomic` renames only on success, `fs-ops:140-142`). The user
    loses nothing.
  - _Save failure after write_ (sidecar write throws): the body is on disk and
    `currentContentHash` is stale. Harmless — nothing reads that field for a
    decision. The next enhancement or rebase rewrites it.
  - _Lock contention_ (a boot reconcile holds the slug): the save queues behind it
    (`withSlugLock:1312-1323`) and then runs. It never writes outside the lock, so a
    half-written clone file is not reachable. If the wait exceeds the RPC timeout the
    frontend surfaces a timeout error and no partial write exists, because the write
    is a single atomic rename.
  - _Missing clone_: `INVALID_PARAMS` naming the slug; nothing created.

- **Observability**: `parseParams` already logs the raw rejection at `warn`
  (`:1828-1830`) while returning a generic message; the generic `catch` calls
  `report(...)` (`:2078-2083`) which logs and captures to Sentry. `saveCloneBody`
  should log one `info` with `{ kind, slug, historyTs }` on success — a user-layer
  write with no trace is the failure mode this whole task exists to make visible.

## Architecture-level quality requirements

- **Functional**: all 22 acceptance criteria. The three with the highest defect cost
  and their owners: R3.8 (body survives a subsequent reconcile) — component 4's
  sidecar table; R1.4 (batch continues past a failure) — component 6's per-iteration
  try/catch; R1.6 (orphaned excluded) — component 5's `orphaned === true`.
- **Performance**: bulk rebase is O(N) sequential round trips; each per-clone rebase
  is already a hash-plus-copy the single-clone path performs today. The `PROMOTE_MS`
  (20 s) budget applies per call, not per batch
  (`skill-synthesis-rpc.service.ts:63`). The batch must show progress rather than
  raise its own timeout.
- **Security**: `skillSynthesis:saveCloneBody` is the only new trust boundary. Zod
  before any path construction; `assertUnderUserLayer` as the second gate; a bounded
  body; no raw filesystem string returned to the webview; `~/.ptah/plugins` stays
  refused; the VS Code host keeps the whole namespace absent.
- **Maintainability**: eligibility rules live only in `clone-action-gating.ts`;
  batch orchestration only in `CloneBulkRebaseService`; the write only in
  `UserLayerMirrorService`. No second rebase implementation, and no eligibility
  predicate duplicated into a template. `skill-clones-view.component.ts` (585) and
  `clone-detail-drawer.component.ts` (437) are watched against the 700-line WARN;
  any split follows the facade rule with a nameable collaborator.
- **Testability**:
  - A save leaves `sourceHash`, `diverged`, `pendingSourceHash` and `lastEnhancedAt`
    unchanged and `currentContentHash` changed.
  - A save followed by a reconcile against a MOVED upstream leaves the saved body on
    disk and the clone diverged — never fast-forwarded.
  - A batch with a failing member attempts every member and names the failed slug.
  - An orphaned clone, an `authored` clone and a `synth` clone are all excluded from
    the batch; `orphaned: undefined` is included.
  - A malformed slug is rejected with no file created anywhere.
  - The harness control is a keyboard-reachable button in Electron and inert text in
    VS Code.

## Team-leader handoff

- **Recommended executors**:
  - Components 1-4 → **backend-developer**. Shared types, a Zod schema, one RPC
    handler and one service method; the sidecar table is the whole risk and it is
    backend reasoning.
  - Components 5-9 → **frontend-developer**. Angular signals, `OnPush`,
    presentational/smart split, accessibility.
  - After both land → **senior-tester** for the two cross-cutting proofs that no
    single batch owns: save-then-reconcile persistence (R3.8) and the partial-batch
    outcome (R1.4).

- **Complexity**: **MEDIUM**. No new lib, no new port, no DI token, no schema
  migration, no new lib edge. The difficulty is concentrated in one place — which
  sidecar fields a save may write — and that is decided here with the reconcile
  branch quoted. Everything else is composition of existing, tested primitives.

- **Dependencies and ordering** (component-level only):
  - Component 1 precedes 2, 3 and the RPC facade wrapper in 7 — they all reference
    its types.
  - Component 4 precedes 3 — the handler calls the mirror method.
  - Component 5 precedes 6, 7 and 8 — all three import its functions.
  - Component 9's `AppStateManager` change precedes the marketplace and Skills-tab
    edits inside 9.
  - The backend group (1-4) and the frontend-only group (5, 6, 8) have no ordering
    relation and can run concurrently. Component 7 needs component 1's types for its
    facade wrapper, so it lands after 1.

- **Parallel-safe work** (file-disjoint):
  - Lane A: components 1 → 2 → 3 → 4 (`libs/shared`, `libs/backend/rpc-handlers`,
    `libs/backend/agent-generation`).
  - Lane B: components 5 → 6 → 8 (`clone-action-gating*`, `clone-bulk-rebase*`,
    `clone-body-editor*`, `clone-detail-drawer.component.ts`).
  - Lane C: component 9's `libs/frontend/core` and `libs/frontend/marketplace` files.
  - **Contended files, which must NOT be split across concurrent lanes**:
    `libs/frontend/skill-synthesis-ui/src/index.ts` (touched by 5, 8) and
    `skill-clones-view.component.ts` (touched by 7 and, via the deep link, 9).
    Assign each to exactly one batch.

- **Files affected**:

  **CREATE**
  - `.../libs/frontend/skill-synthesis-ui/src/lib/services/clone-bulk-rebase.service.ts`
  - `.../libs/frontend/skill-synthesis-ui/src/lib/services/clone-bulk-rebase.service.spec.ts`
  - `.../libs/frontend/skill-synthesis-ui/src/lib/components/clones/clone-body-editor.component.ts`
  - `.../libs/frontend/skill-synthesis-ui/src/lib/components/clones/clone-body-editor.component.spec.ts`

  **MODIFY**
  - `.../libs/shared/src/lib/types/rpc/rpc-skill-clone.types.ts`
  - `.../libs/shared/src/lib/types/rpc.types.ts`
  - `.../libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.schema.ts`
  - `.../libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts`
  - `.../libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.ts`
  - `.../libs/frontend/core/src/lib/services/app-state.service.ts` (+ `.spec.ts`)
  - `.../libs/frontend/marketplace/src/lib/harness/harness-target-row.component.ts`
  - `.../libs/frontend/marketplace/src/lib/harness/harness-health-badge.component.ts` (+ `.spec.ts`)
  - `.../libs/frontend/skill-synthesis-ui/src/index.ts`
  - `.../libs/frontend/skill-synthesis-ui/src/lib/components/clones/clone-action-gating.ts` (+ `.spec.ts`)
  - `.../libs/frontend/skill-synthesis-ui/src/lib/components/clones/clone-detail-drawer.component.ts`
  - `.../libs/frontend/skill-synthesis-ui/src/lib/components/clones/skill-clones-view.component.ts` (+ `.spec.ts`)
  - `.../libs/frontend/skill-synthesis-ui/src/lib/components/skill-synthesis-tab.component.ts` (+ `.spec.ts`)
  - `.../libs/frontend/skill-synthesis-ui/src/lib/services/skill-synthesis-rpc.service.ts`
  - `.../libs/frontend/skill-synthesis-ui/src/lib/services/skill-clones-state.service.ts`
  - `.../libs/frontend/skill-synthesis-ui/CLAUDE.md` — the "Runtime: ELECTRON-ONLY"
    section (`:29`) is correct, but the final Guidelines bullet still says "Do not
    Electron-gate this tab — skills work on VS Code too", which contradicts it and
    contradicts `expected-absent.ts:39`. Delete that bullet in this change; a reader
    following it would try to build VS Code parity this task explicitly rejected.

  **REWRITE**: none.

- **Verification points**:
  - **References to confirm before coding**: `rpc.types.ts:3560-3610` is the
    `RPC_METHOD_ENTRIES` block that also needs the new key; the schema primitives
    `SlugSchema` / `SkillCloneKindSchema` at `skills-synthesis-rpc.schema.ts:324-334`;
    that the file-clone snapshot layout (`.history/<slug>/<ts>/`) matches
    `listHistory`'s expectation at `user-layer-mirror.service.ts:586-593`.
  - **Contracts to honour**: the sidecar table in component 4 is binding —
    `sourceHash` is never written by a save. `orphaned` is compared `=== true`.
    The frontend imports no backend lib. No `[innerHTML]` on a clone body.
    `ALLOWED_METHOD_PREFIXES` is NOT edited.
  - **Data changes to apply**: none. No migration, no new table, no new file format.
    `.ptah-origin.json` gains no field.
  - **Commands that must pass** (project names are the package aliases in
    `project.json`; use `run-many`, never `nx test a b c`):
    ```
    npx nx run-many -t typecheck -p @ptah-extension/shared @ptah-extension/rpc-handlers @ptah-extension/agent-generation @ptah-extension/core @ptah-extension/marketplace @ptah-extension/skill-synthesis-ui
    npx nx run-many -t lint     -p @ptah-extension/shared @ptah-extension/rpc-handlers @ptah-extension/agent-generation @ptah-extension/core @ptah-extension/marketplace @ptah-extension/skill-synthesis-ui
    npx nx run-many -t test     -p @ptah-extension/shared @ptah-extension/rpc-handlers @ptah-extension/agent-generation @ptah-extension/core @ptah-extension/marketplace @ptah-extension/skill-synthesis-ui
    ```
    Read the `Running target test for N projects` header and confirm N is 6 — a
    misspelled project name is silently dropped from the set.
  - **Specific specs that must stay green**: `rpc-allowlist.spec.ts` (the manifest
    partitions `RPC_METHOD_NAMES` exactly), the VS Code host's
    `expected-absent` spec (`SkillsSynthesisRpcHandlers` still absent),
    `skill-clones-state.service.spec.ts:96` (`divergedCount` semantics unchanged),
    `app-state.service.spec.ts:484-581` (the per-workspace pointer block — proof the
    new intent did not leak into `ViewSlice`).
  - No `project.json` is edited, so no `npx nx reset` is required.
