# Development Tasks — TASK_2026_316

**Total Tasks**: 27 | **Batches**: 6 | **Status**: 4/6 complete

Two sequenced halves (U1). Batch 1 ships alone and needs no new state. Batches
2–6 add the per-workspace gate and its surfaces.

---

## Batch numbering vs. the orchestrator outline

Nothing in the orchestrator-authored outline was dropped. Its Batch 3 mixed a
backend RPC surface with two Angular components, which violates the repo's
never-mix-backend-and-frontend batching rule, so it is split. Every other batch
keeps its content and its order.

| Outline batch                     | Here                                     |
| --------------------------------- | ---------------------------------------- |
| 1 — plugin gate over user layer   | **Batch 1** (plus one new task, 1.2)     |
| 2 — `SkillSyncGate` + state field | **Batch 2** (migration split out as 2.3) |
| 3.1 — RPC                         | **Batch 3**                              |
| 3.2–3.4 — modal, card, health     | **Batch 4**                              |
| 4 — CLI parity                    | **Batch 5**                              |
| 5 — docs + CLAUDE.md              | **Batch 6**                              |

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS. No blocker; the plan does not need an
architect revision. One risk the outline does not cover is added as its own
task (1.2), and one it covers correctly is promoted from a bullet to its own
task with its own spec (2.3).

### Assumptions verified against the code

| #   | Assumption                                                                                               | Verdict                                                                                                                                                                                                                                                                                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | `harness:` is already in `ALLOWED_METHOD_PREFIXES`, so the runtime half of the dual registration is free | ✅ Verified — `libs/backend/vscode-core/src/messaging/rpc-handler.ts:70`. Batch 3 VERIFIES this line, it does not edit it                                                                                                                                                                                                                                     |
| A2  | The origin sidecar carries `pluginId` and a stable filename                                              | ✅ Verified — `OriginSidecar.pluginId: string \| null` and `ORIGIN_SIDECAR_FILENAME = '.ptah-origin.json'` in `libs/backend/agent-generation/src/lib/services/user-layer/origin-sidecar.types.ts`                                                                                                                                                             |
| A3  | The harness/skills.sh prefixes are opt-OUT and must be exempt from the new filter                        | ✅ Verified — `HARNESS_PLUGIN_PREFIX = 'ptah-harness-'` (`plugin-loader.service.ts:198`) and `SKILLS_SH_PLUGIN_PREFIX = 'ptah-skillssh-'` (`:215`), whose doc comment says "OPT-OUT … active on discovery and stays active until its id lands in `disabledPluginIds`"                                                                                         |
| A4  | `AgentSyncGate` is the shape to copy for Batch 2                                                         | ✅ Verified — `resolve` / `persist` / `enable`, `HARNESS_TARGET_IDS` evidence walk, `derived` flag                                                                                                                                                                                                                                                            |
| A5  | The reconciler has exactly the three wiring points the outline names                                     | ✅ Verified — `harness-reconciler.service.ts:105` (defaulted ctor arg), `:158` (`verify()` resolves, does not persist), `:321`/`:324` (resolve at top of `runReconcile`), `:342-343` (persist a derived decision inside the lock)                                                                                                                             |
| A6  | The prefix guard is the only runtime registration                                                        | ⚠️ **Partly false, and in a helpful direction.** There is a THIRD place: `RPC_METHOD_ENTRIES` at `libs/shared/src/lib/types/rpc.types.ts:3285`, typed `Record<RpcMethodName, true>`. It is compiler-enforced, not silent — adding a key to `RpcMethodRegistry` without adding it there fails to build. Named in task 3.1 so nobody loses an hour to the error |
| A7  | `overlayPluginPaths` is always a truthful picture of the enabled plugin set                              | ❌ **FALSE.** See R1                                                                                                                                                                                                                                                                                                                                          |

### Risks identified

| #   | Risk                                                                                                                                                                                   | Severity   | Mitigation                                                                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | An empty `overlayPluginPaths` from a FAILED plugin-config read is indistinguishable from "no plugins enabled", and under the naive 1.3 filter it reaps the entire skills desired state | **HIGH**   | New task **1.2** — fail-open guard + its own spec case in 1.5                                                                                                  |
| R2  | `skillSyncMode` defaulting to `'selected'` with an empty allowlist deletes every skill copy in every existing workspace on the first reconcile after upgrade                           | **HIGH**   | Task **2.3**, its own task with its own spec (2.6), per the constraint that this is the one failure that destroys user state                                   |
| R3  | Batch 1 is itself destructive-on-upgrade for a user who has clones from a plugin not enabled in the current workspace — those copies WILL be deleted on the next reconcile             | **MEDIUM** | Intended and is the fix (U1), but the user-layer CLONE must survive so re-enabling stays instant and offline. Pinned by task **1.4** and by a spec case in 1.5 |
| R4  | A `'selected'` workspace's unselected slugs, if reported as `missing`, put a permanent amber count on the health badge nobody can clear                                                | **MEDIUM** | Task **4.3** records the decision (do not report) and pins it                                                                                                  |
| R5  | Batch 3's `set-skill-selection` calling plain `reconcile` instead of `propagate`, or calling `propagate` WITHOUT `skipUserLayerRefresh`                                                | **LOW**    | Named explicitly in task 3.2; the exception is the documented `plugins:save-config` one                                                                        |

### Edge cases to handle

- [ ] Plugin-config read fails → skills must NOT be reaped → Task 1.2
- [ ] Clone with no sidecar (user-authored) → never filtered → Task 1.3
- [ ] Clone with `pluginId: null` (synth / workspace-authored) → never filtered → Task 1.3
- [ ] `ptah-harness-*` / `ptah-skillssh-*` clone → filtered only by `disabledPluginIds` → Task 1.3
- [ ] Existing workspace with skill entries in any manifest → resolves to `'all'`, loses nothing → Task 2.3
- [ ] Slug in the allowlist AND in `disabledSkillIds` → not propagated (gate is the OUTER filter) → Task 2.4
- [ ] `verify()` never writes a derived skill decision → Task 2.5
- [ ] `persist()` never overwrites a recorded mode → Task 2.2
- [ ] A promoted synth skill / `skills.sh` install has no bundled plugin above it and must still be selectable → Task 4.1
- [ ] A CLI host registering fewer targets than the extension must not read a propagated workspace as un-propagated → Task 2.3

---

## Batch 1 — Restore the plugin gate over the user-layer base ✅ COMPLETE (95ffaea3a)

**Goal**: unchecking a bundled plugin removes its skills from THIS workspace
again, as `skill-toggles.md:38` has always claimed.

**Why it is separable**: no new state, no migration, no UI. It is a filter the
builder already has the inputs for. U1 makes shipping it alone a decision, not
an option.

**Recommended Executor**: `backend-developer`
**Per-task executor override**: task 1.6 (docs prose) → `technical-content-writer`
**Fallback Executor**: `general-purpose`
**Execution Mode**: sequential
**Rationale**: one lib, one builder method, tightly coupled tasks in the same
file, and a filter whose failure mode is mass deletion. Not parallel-eligible.
**Tasks**: 6 | **Dependencies**: none

---

### Task 1.1: Teach the builder which plugin a user-layer clone came from ⏸️ PENDING

**Files**:

- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\user-layer\origin-sidecar.types.ts` (source of truth today)
- `D:\projects\ptah-extension\libs\shared\src\lib\types\` (destination if (b) is taken)
- `D:\projects\ptah-extension\libs\backend\harness-sync\src\lib\manifest\harness-manifest.builder.ts`

The user-layer base loop has no plugin-id concept; the origin sidecar written by
`UserLayerMirrorService` does. **`harness-sync` must NOT import
`agent-generation`** — the forbidden-imports line in
`libs/backend/harness-sync/CLAUDE.md` reads `agent-sdk`, `agent-generation`,
`cli-agent-runtime`, `platform-{cli,electron,vscode}`, anything under
`libs/frontend`.

Two candidate shapes; **pick one and record the reason in
`libs/backend/harness-sync/CLAUDE.md`** (Batch 6 carries the wording, this task
carries the decision):

- **(a)** Read the sidecar filename + `pluginId` field directly in
  `harness-sync`, duplicating only the two constants. Cheap; a second reader of
  a format `agent-generation` owns.
- **(b)** Move `ORIGIN_SIDECAR_FILENAME` + the `OriginSidecar` schema into
  `@ptah-extension/shared` and have both libs read it there. One definition; a
  wire type that is not on any wire.

**Recommendation: (b).** The outline prefers (b) if the schema is stable, and it
is — the sidecar already has three consumers. There is also standing evidence
that (a) drifts: `HARNESS_PLUGIN_ID_PREFIX` in `origin-sidecar.types.ts` and
`HARNESS_PLUGIN_PREFIX` at `plugin-loader.service.ts:198` are already two copies
of one string, and (a) would create the third.

**Quality requirements**:

- Zod at the file boundary when parsing the sidecar; a malformed sidecar reads
  as "no sidecar", never as `pluginId: undefined` silently coerced.
- `catch (error: unknown)`, narrowed with `instanceof Error`.
- No import of `agent-generation` from `harness-sync`, in either shape.

---

### Task 1.2: Fail OPEN when the plugin overlay is unknown ⏸️ PENDING (NEW — R1)

**File**: `D:\projects\ptah-extension\libs\backend\harness-sync\src\lib\sources\harness-source.port.ts`
**Also**: `D:\projects\ptah-extension\libs\backend\harness-sync\src\lib\sources\plugin-config-source-resolver.ts`

**This task is not in the orchestrator outline. It is added because the outline's
1.2 rule, taken literally, is a second mass-reap.**

`createPluginConfigSourceResolver.resolve()` returns an `empty` source state with
`overlayPluginPaths: []` on **three** failure paths
(`plugin-config-source-resolver.ts:81-115`): the reader factory throws, the
reader is `null`, or `getWorkspacePluginConfig()` / `resolveCurrentPluginPaths()`
throws. Today an empty overlay is harmless — the overlay is ADDITIVE, so losing
it costs nothing the user layer does not already carry.

The moment the filter in 1.3 lands, an empty overlay stops meaning "add nothing"
and starts meaning "**every sidecar-carrying clone is filtered**". A transient
plugin-config read failure would then empty the skills desired state, and skills
are manifest-owned, so the removal sweep deletes `.claude/skills/*`,
`.agents/skills/*`, `.github/skills/*` and `.cursor/skills/*` — silently,
reported as an ordinary clean pass. That is the R2 failure arriving a batch
early, in the half the user chose to ship WITHOUT any migration machinery.

**Required shape**: `HarnessSourceState` must be able to say "I have no opinion
about the plugin overlay", distinctly from "the enabled set is empty". Absent =
do not filter.

Follow the idiom the file already uses twice rather than inventing a third:
`legacyLinkRoots?` at `harness-source.port.ts:37` ("Optional so a resolver built
by hand … opts into the STRICT behaviour by saying nothing") and
`agentSyncEnabled?` at `harness-manifest.builder.ts:81` ("Absent means enabled …
a caller that has no opinion gets the pre-gate behaviour rather than an
accidental reap"). Here the safe direction is the opposite of strict, for the
same reason: absent must mean UNFILTERED.

The `empty` literal in `plugin-config-source-resolver.ts:83-90` must NOT set the
new field. Every one of its three `return empty` paths is a read failure.

**Quality requirements**:

- The new field carries a doc comment in the file's existing convention, stating
  in as many words that absent is not an empty enabled set.
- A resolver built by hand in a spec gets pre-gate behaviour.

---

### Task 1.3: Apply the plugin filter to the base loop ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\harness-sync\src\lib\manifest\harness-manifest.builder.ts`
**Anchor**: `HarnessManifestBuilder.buildSkills`, the user-layer loop at `:183-193`
(the overlay loop with the existing `disabledPluginIds` test is `:195-198`)
**Dependencies**: Task 1.1, Task 1.2

Skip a user-layer slug whose sidecar names a plugin that is neither in the
overlay paths nor exempt. Rules, all four required:

- A clone with **no sidecar** is user-authored and is never filtered. Same rule
  the reaper keys off (`OriginSidecar.orphaned` doc comment: "A clone with NO
  sidecar at all is user-authored and is never classified, reaped or marked").
- A clone whose `pluginId` is **null** (synthesized skill, workspace-authored
  agent) is never filtered by this gate.
- A clone whose `pluginId` is a **harness (`ptah-harness-*`) or skills.sh
  (`ptah-skillssh-*`)** plugin is opt-OUT, so it is filtered only by
  `disabledPluginIds` — never by absence from `enabledPluginIds`. Prefixes at
  `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:198` and `:215`.
- A clone whose `pluginId` is a **bundled** plugin is filtered when that id is
  not in the current `overlayPluginPaths` basenames — **and only when task 1.2's
  field says the overlay is known**.

**Note on generality**: the rule keys off `overlayPluginPaths` rather than off a
hardcoded bundled list, so an EXTERNAL marketplace plugin falls out correctly
with no extra branch — enabled means present in the overlay, disabled or
uninstalled means absent.

**Validation notes**: the gate composes as an OUTER filter over
`disabledSkillIds`, which keeps its meaning untouched (see context.md, "Out of
scope").

---

### Task 1.4: Confirm reap semantics — copies go, the CLONE stays ⏸️ PENDING

**Files** (read-and-pin, not necessarily edit):

- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\user-layer\user-layer-orphan-reaper.ts` (`classifyUpstream`, `:123-127`)
- `D:\projects\ptah-extension\libs\backend\harness-sync\src\lib\reconciler\harness-reconciler.service.ts`
  **Dependencies**: Task 1.3

  1.3 is a REMOVAL from the desired state, so the sweep deletes the per-workspace
  copies. That is correct and is the point (R3) — but **confirm it does not also
  reap the user-layer CLONE**. It must not: the clone is what makes re-enabling
  instant and offline, and the reaper's `check-plugin-dir` verdict (return
  `check-plugin-dir` for a clone whose `pluginId` is not in the scanned set, keep
  it while the plugin dir under `~/.ptah/plugins` exists) is deliberate. Disabled
  is distinguished from uninstalled ON PURPOSE — `buildMirrorSources`'
  `pluginsBasePath` doc comment
  (`apps/ptah-electron/src/activation/plugin-activation.ts:90-114`) says so in as
  many words.

Only the per-workspace copies go. If this task finds that the clone IS reaped,
that is a finding for the orchestrator, not something to patch inside 1.3.

---

### Task 1.5: Specs ⏸️ PENDING

**File**: new `D:\projects\ptah-extension\libs\backend\harness-sync\src\lib\reconciler\harness-reconciler.plugin-gate.spec.ts`
**Alternative**: extend `D:\projects\ptah-extension\libs\backend\harness-sync\src\lib\manifest\harness-manifest.builder.spec.ts`, which already pins the two agent filters
**Dependencies**: Tasks 1.2, 1.3, 1.4
**Recommended per-task executor**: `senior-tester` if the batch is re-spawned; otherwise `backend-developer` writes it in-batch

Cases — the first is the R1 case and is not optional:

1. **Plugin overlay UNKNOWN (read failure) → nothing is filtered and nothing is
   reaped.** The regression guard for task 1.2.
2. Bundled plugin disabled → its user-layer skills leave the desired state.
3. Harness (`ptah-harness-*`) plugin absent from `enabledPluginIds` → still desired.
4. skills.sh (`ptah-skillssh-*`) plugin absent from `enabledPluginIds` → still desired.
5. Sidecar-less clone → still desired.
6. `pluginId: null` synth clone → still desired.
7. `disabledPluginIds` containing a harness id → NOT desired.
8. The user-layer clone survives a case-2 reap (R3 / task 1.4).

**Never let a spec touch the real home directory** — every facet and rival target
factory takes a `homeDir` override; pass a temp one. This has already corrupted
a developer's own harness once, during TASK_2026_278 Batch 2.

---

### Task 1.6: Rewrite the skill-toggles doc off junctions ⏸️ PENDING

**File**: `D:\projects\ptah-extension\apps\ptah-docs\src\content\docs\plugins\skill-toggles.md`
**Recommended per-task executor**: `technical-content-writer`
**Dependencies**: Task 1.3

The four-row interaction table is correct again after 1.3 — in particular the
`:38` row (`Disabled` plugin + `Enabled` skill → "Nothing is junctioned — plugin
enablement is the outer gate"), which has been FALSE since TASK_2026_278
replaced `SkillJunctionService` with the reconciler.

The surrounding prose is a separate problem and is still false: "junctions are
rebuilt on save", "no junction is created under `<workspace>/.claude/skills/`".
The whole page is written in terms of junctions. Rewrite it onto the reconciler
(copies, never junctions; manifest-owned; a removal from the desired state is a
delete).

**Do not** add the per-project selection gate here — that is Batch 6, and it does
not exist until Batch 2 ships.

---

**Batch 1 Verification**:

- `npm run lint:all`
- `npm run typecheck:all`
- `npm run test`
- `nx build ptah-docs` (task 1.6 touches the docs site — this is its only gate,
  there is deliberately no `check` target)
- All files exist at the paths above with real implementations, no TODO/STUB
- Spec case 1 (overlay unknown → no reap) present and passing
- `code-logic-reviewer` approved

---

## Batch 2 — `SkillSyncGate` + the state field ✅ COMPLETE

**Goal**: the per-workspace allowlist and its migration, backend only, nothing
wired to a surface.

**Recommended Executor**: `backend-developer`
**Per-task executor override**: task 2.6 (specs) → `senior-tester`
**Fallback Executor**: `general-purpose`
**Execution Mode**: sequential
**Rationale**: one lib, one new class, and a migration whose failure destroys
user state. Architecture-shaped, tightly coupled across builder + reconciler.
Not parallel-eligible.
**Tasks**: 6 | **Dependencies**: Batch 1 committed (2.4 edits the same
`buildSkills` method 1.3 does)

---

### Task 2.1: Extend `HarnessWorkspaceStateSchema` ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\harness-sync\src\lib\gitignore\harness-state-store.ts`
**Anchor**: `HarnessWorkspaceStateSchema` at `:31`

Two optional fields, each with the doc-comment convention the file already uses:

- `skillSyncMode: z.enum(['all', 'selected']).optional()`
- `enabledSkillSlugs: z.array(z.string()).optional()` — meaningful only under
  `'selected'`; absent under `'all'`

**Absence of `skillSyncMode` is NOT `'selected'`.** State that in the schema
comment in the same terms `agentSyncEnabled` uses at `:52-61` ("ABSENT is not
`false`. Agents are manifest-owned, so a bare `false` on an upgrading install
would reap every … `AgentSyncGate` resolves an absent flag from manifest
evidence — prior propagation is prior consent").

**Quality requirements**: the file is written through `atomicWriteWithRetry`
already; do not add a second writer. Never `writeFileSync` on a file this lib
owns.

---

### Task 2.2: `state/skill-sync-gate.ts` ⏸️ PENDING

**File**: new `D:\projects\ptah-extension\libs\backend\harness-sync\src\lib\state\skill-sync-gate.ts`
**Shape to copy**: `D:\projects\ptah-extension\libs\backend\harness-sync\src\lib\state\agent-sync-gate.ts`
**Dependencies**: Task 2.1

**Copy `AgentSyncGate`'s shape, not a variation on it.** The lib's own
Guidelines say so: "`state/agent-sync-gate.ts` is the worked example; copy its
shape rather than inventing a second migration idiom."

Surface:

- `resolve(workspaceRoot): SkillSyncDecision` → `{ mode, slugs, derived }`.
  Read-only. `workspaceRoot` is already normalized — the reconciler resolves
  once at its entry point (E14) and every collaborator below it assumes the real
  root. Migration rule in 2.3.
- `persist(workspaceRoot, decision): boolean` — **never overwrites a recorded
  mode.** It is the migration step, not a way to revoke consent. Called from
  inside the workspace lock.
- `select(cwd, slugs): boolean` — the user's explicit choice. Takes a RAW path
  and normalizes it via `resolveHarnessWorkspaceRoot` (a fixed point, so passing
  an already-resolved root through it is a no-op), because the caller is an RPC
  handler holding `IWorkspaceProvider.getWorkspaceRoot()`. Records
  `skillSyncMode: 'selected'` plus the slug list, and — like
  `AgentSyncGate.enable` recording `wizardCompletedAt` — may record a timestamp
  distinguishing a user choice from a derived one.
- `enableAll(cwd): boolean` — the "just give me everything here" escape hatch.

**Also**: export `SkillSyncGate` from the lib barrel, beside `AgentSyncGate` in
the Public API list.

---

### Task 2.3: THE MIGRATION — absent flag resolves from manifest evidence ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\harness-sync\src\lib\state\skill-sync-gate.ts`
**Dependencies**: Task 2.2

**This is its own task because it is the one failure in this whole plan that
destroys user state, and it is not a bullet inside 2.2.**

Skills are manifest-owned, so an empty desired state is a REAP, not a skip. A
`skillSyncMode` defaulting to `'selected'` with an empty allowlist would not
merely stop propagating: **the first routine reconcile after the upgrade would
delete every `.claude/skills/*`, `.agents/skills/*`, `.github/skills/*` and
`.cursor/skills/*` Ptah had ever written, in every existing workspace, silently,
reported as an ordinary clean pass.** Skills are the largest artifact family by
count, so this is the worst available version of the failure `AgentSyncGate`
exists to prevent.

The resolution table, mirroring the `agentSyncEnabled` table in
`libs/backend/harness-sync/CLAUDE.md`:

| `skillSyncMode` | Any per-target manifest owns a `skill` entry? | Result                 |
| --------------- | --------------------------------------------- | ---------------------- |
| `'all'`         | —                                             | `'all'`                |
| `'selected'`    | —                                             | `'selected'` + slugs   |
| absent          | yes                                           | **`'all'`**            |
| absent          | no                                            | `'selected'` with `[]` |

**Prior propagation IS prior consent.** Those files exist because a previous
version of Ptah put them there and the user has been living with them. A
workspace with no skill entries in any manifest has nothing to lose and starts
gated — which is exactly U2, "a new workspace propagates nothing".

Three properties, none re-derivable from the table alone:

- **Walk every id in `HARNESS_TARGET_IDS`**, not the targets the current host
  registered. The evidence is on disk; a CLI host registering fewer targets than
  the extension did must not read the same workspace as un-propagated and gate
  it. Mirror `AgentSyncGate.hasOwnedAgents` (`agent-sync-gate.ts:113-121`),
  matching `entry.kind === 'skill'`.
- **The resolved value is PERSISTED**, so the evidence walk runs once per
  workspace and the answer cannot flip later just because a reap emptied the
  manifests.
- **The `derived` flag is what tells the reconciler to persist**, and is the
  reason `verify()` can resolve without writing (task 2.5).

---

### Task 2.4: Wire it into the builder ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\harness-sync\src\lib\manifest\harness-manifest.builder.ts`
**Anchors**: `HarnessManifestBuildOptions` at `:63-82`; the `agentSyncEnabled !== false`
default at `:95`; `buildSkills` at `:175`
**Dependencies**: Task 2.2

`HarnessManifestBuildOptions` gains `skillSync?: { mode, slugs }`, **defaulting
to `'all'` when absent** — same rule and same reason as `agentSyncEnabled !== false`
at `:95`, whose doc comment at `:75-80` reads: "The builder is not where the
migration lives … a caller that has no opinion (a spec, a preflight built by
hand) gets the pre-gate behaviour rather than an accidental reap."

`buildSkills` drops a slug not in `slugs` when mode is `'selected'`. **The gate
is the OUTER filter**; `disabledSkillIds` still applies inside it, and so does
Batch 1's plugin filter. Three levels, evaluated outermost-first: skill-sync
gate → plugin enablement → `disabledSkillIds`.

---

### Task 2.5: Wire it into the reconciler ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\harness-sync\src\lib\reconciler\harness-reconciler.service.ts`
**Dependencies**: Task 2.4

Three wiring points, each beside its `agentSync` twin:

- **Constructor `:105`** — DEFAULTED into the constructor, **not nullable**, same
  reasoning as the agent gate's `:99-107` comment: an absent `.gitignore` writer
  means one less file is maintained, but an absent gate would mean the facet
  propagates ungated in any host that forgot to wire it, which is the defect the
  gate exists to close.
- **`runReconcile` `:321`/`:324`** — resolve beside `this.agentSync.resolve(workspaceRoot)`,
  pass into the build options; persist a derived decision inside the lock before
  the targets run, beside `:342-343` (`if (agentSync.derived) this.persistAgentSyncDecision(...)`).
- **`verify()` `:151-158`** — resolve but **never persist**. The existing comment
  at `:153` states the rule: "A derived decision is a write, and `verify()`…" —
  asking what state the harness is in must not change it, and the health badge
  polls `verify()`.

---

### Task 2.6: Specs ⏸️ PENDING

**File**: new `D:\projects\ptah-extension\libs\backend\harness-sync\src\lib\reconciler\harness-reconciler.skill-consent.spec.ts`
**Mirror**: `D:\projects\ptah-extension\libs\backend\harness-sync\src\lib\reconciler\harness-reconciler.agent-consent.spec.ts`
**Recommended per-task executor**: `senior-tester`
**Dependencies**: Tasks 2.3, 2.4, 2.5

**The migration is the load-bearing case and comes first**: an existing
workspace with skill entries in any manifest **must not lose one file**. Assert
on the actual files on disk after a full pass, not only on the resolved mode.

Also pin:

1. A workspace whose manifests own NO skill entry resolves to `'selected'` with `[]`.
2. Evidence is read for every id in `HARNESS_TARGET_IDS`, including targets this
   host did not register.
3. `verify()` does not write `state.json`.
4. `persist` does not overwrite a recorded mode.
5. A `'selected'` workspace propagates exactly its allowlist.
6. A slug in both the allowlist and `disabledSkillIds` is NOT propagated.
7. A caller with no `skillSync` option gets pre-gate behaviour.

Pass a temp `homeDir` override. No spec touches the real home directory.

---

**Batch 2 Verification**:

- `npm run lint:all`
- `npm run typecheck:all`
- `npm run test`
- The migration spec exists and asserts on files on disk
- No new gate defaults OFF for an artifact kind already on disk
- `code-logic-reviewer` approved

---

## Batch 3 — RPC surface ✅ COMPLETE (37402030c)

**Recommended Executor**: `backend-developer`
**Fallback Executor**: `general-purpose`
**Execution Mode**: sequential
**Rationale**: two methods in one namespace across `shared` + `rpc-handlers`;
cross-file with a compile-time coupling (A6). Not parallel-eligible.
**Tasks**: 3 | **Dependencies**: Batch 2 committed

---

### Task 3.1: Declare the two methods ⏸️ PENDING

**Files**:

- `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts`
- `D:\projects\ptah-extension\libs\shared\src\lib\types\harness-sync.types.ts` (payload types, beside the `harness:repairBlocked` types at `:421` and `:476`)
- `D:\projects\ptah-extension\libs\backend\vscode-core\src\messaging\rpc-handler.ts` — **VERIFY ONLY**

**Extend the existing `harness:` namespace rather than adding one.** `harness:`
is already in `ALLOWED_METHOD_PREFIXES` at `rpc-handler.ts:70`, so the runtime
half of the dual registration comes free — the same note is already recorded for
`harness:repairBlocked` in `libs/backend/harness-sync/CLAUDE.md`. **Verify that
line, do not edit it.**

- `harness:get-skill-selection` → `{ mode, slugs, available }`, where `available`
  is every user-layer slug with its display name and description from `SKILL.md`
  frontmatter, plus its origin plugin id.
- `harness:set-skill-selection` `{ mode, slugs }`.

**Three edits in `shared`, not two** (A6): `RpcMethodRegistry` (the entry itself),
`RPC_METHOD_ENTRIES` at `rpc.types.ts:3285` (typed `Record<RpcMethodName, true>`,
so omitting it is a BUILD failure with a `_MissingRpcMethodNames` error at
`:3696`, not a silent gap), and the payload interfaces.

**Quality requirements**: Zod at the handler boundary. `catch (error: unknown)`.

---

### Task 3.2: Implement the handlers ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\harness\` — beside `health\harness-health-rpc.service.ts`, registered through the `HarnessRpcHandlers` facade
**Dependencies**: Task 3.1

- `get-skill-selection` reads through `SkillSyncGate.resolve` plus a user-layer
  walk for `available`. **Read-only — it must not persist a derived decision**,
  for `verify()`'s reason.
- `set-skill-selection` writes through `SkillSyncGate.select` / `enableAll`, then
  **propagates afterwards with `skipUserLayerRefresh`** (R5).

**Why that flag, precisely**: callers use `HarnessPropagationService.propagate`,
not `reconcile` — `reconcile` is the primitive, `propagate` is the operation, and
a bare `reconcile` from a trigger propagates the PREVIOUS state and reports a
clean pass. There are exactly two documented exceptions, host activation and
`plugins:save-config`, and the second passes `skipUserLayerRefresh` "because
enabling a plugin changes the FILTER and never a source's contents". **A skill
selection is the same shape and takes the same exception.**

---

### Task 3.3: Handler specs ⏸️ PENDING

**File**: beside `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\harness\health\harness-health-rpc.service.spec.ts`
**Recommended per-task executor**: `senior-tester`
**Dependencies**: Task 3.2

Pin: `get` does not write; `set` propagates with `skipUserLayerRefresh`; `set`
with `mode: 'all'` clears the allowlist; both methods are reachable through the
prefix guard.

---

**Batch 3 Verification**:

- `npm run lint:all`
- `npm run typecheck:all`
- `npm run test`
- Both methods resolve through `verifyRpcRegistration` (`RPC_METHOD_NAMES`)
- `code-logic-reviewer` approved

---

## Batch 4 — The selection surface ✅ COMPLETE

**Recommended Executor**: `frontend-developer`
**Fallback Executor**: `general-purpose`
**Execution Mode**: sequential
**Rationale**: two Angular components in two libs plus one recorded decision.
Split from Batch 3 because backend and frontend never share a batch.
**Could have run in parallel with Batch 5** — different libs, no shared file, and
both depend only on Batch 3's RPC. Kept sequential because CLI agents are
unavailable this session and one `frontend-developer` cannot fan out.
**Tasks**: 4 | **Dependencies**: Batch 3 committed

---

### Task 4.1: Extend the Configure Ptah Skills modal ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\frontend\chat-ui\src\lib\molecules\setup-plugins\plugin-browser-modal.component.ts`

**Extend it rather than building a second picker.** It already renders per-skill
checkboxes with name + description.

Needs:

- An **all-vs-selected mode control**.
- The selection list keyed on the **USER LAYER**, not on enabled plugins. A
  promoted synth skill and a `skills.sh` install are user-layer slugs with no
  bundled plugin above them, and they must be selectable. This is what
  `available` in `harness:get-skill-selection` exists for.

**Quality requirements**: signals + `inject()`, `ChangeDetectionStrategy.OnPush`
mandatory. No `[innerHTML]` on any skill description — route through
`libs/frontend/markdown` if rendering is needed at all.

---

### Task 4.2: The Dashboard card (U2) ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\` — new card
**Precedent**: `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\harness-card\harness-card.component.ts` (the "Your harness is short" card, TASK_2026_306 Batch 9)
**Dependencies**: Task 4.1

A new workspace propagates nothing, so **it must say so**. U2 rejected the
alternatives explicitly: auto-selecting by workspace analysis (more machinery,
guesses wrong, and a wrong guess is indistinguishable from the bug being
reported), and carrying the previous workspace's selection over (that reproduces
the complaint exactly whenever two projects use different stacks).

Follow the precedent: **one card, one control, routing into the modal.**

**It must not claim a fault.** `sources` is `ok` and the harness is exactly as
the workspace asked. The card says "no skills selected for this project yet",
not "degraded". The precedent card carries exactly one control and performs no
repair itself; this one performs no selection itself.

---

### Task 4.3: Health reporting — record the decision ⏸️ PENDING

**Files**:

- `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\harness\harness-health.store.ts` (verify no change needed)
- decision recorded in `libs/backend/harness-sync/CLAUDE.md` in Batch 6

Decide and record whether a `'selected'` workspace's unselected slugs are
reported anywhere in `HarnessHealth`.

**Recommendation: NO, and this plan adopts it (R4).** An unselected skill is not
`missing` — `missing` means "desired but not owned on disk", and an unselected
slug is **not desired**. Reporting it would put a permanent amber count on the
badge nobody can clear, which is the exact failure mode `summarizeHarnessHealth`
already avoids for collisions and foreign paths ("treating either as a
malfunction would leave a permanently amber badge nobody can clear").

This task is a verification that no code change is required, plus the sentence
Batch 6 will carry.

---

### Task 4.4: Component specs ⏸️ PENDING

**Files**: beside `plugin-browser-modal` and the new card; card spec mirrors `harness-card.spec.ts`
**Recommended per-task executor**: `senior-tester`
**Dependencies**: Tasks 4.1, 4.2

Pin: the card appears only when the workspace is `'selected'` with an empty
allowlist; the card routes into the modal and does nothing else; the modal lists
a user-layer slug with no bundled plugin above it; switching to `'all'` sends
`mode: 'all'`.

---

**Batch 4 Verification**:

- `npm run lint:all`
- `npm run typecheck:all`
- `npm run test`
- Every new/edited component is `OnPush` with signals + `inject()`
- The card claims no fault
- `code-logic-reviewer` approved

---

## Batch 5 — CLI parity ⏸️ PENDING

**Recommended Executor**: `backend-developer`
**Fallback Executor**: `general-purpose`
**Execution Mode**: sequential
**Rationale**: two command files in one app, sharing an output convention.
**Could have run in parallel with Batch 4** (see Batch 4's note).
**Tasks**: 3 | **Dependencies**: Batch 3 committed (not Batch 4)

`apps/ptah-cli` reaches `harness-sync` only through the RPC transport, never by
resolving a token — which is what keeps `ptah harness doctor`, the TUI's
`/harness` and the Marketplace badge on one implementation. Do not break that.

---

### Task 5.1: `ptah skill select` / `ptah skill selection` ⏸️ PENDING

**File**: `D:\projects\ptah-extension\apps\ptah-cli\src\cli\commands\skill.ts`

Already speaks `disabledSkillIds`. Add the selection surface so a headless host
is not stuck with whatever the desktop app last chose:

- `ptah skill select <slug...>` / `--all`
- `ptah skill selection` (show current mode + list)

---

### Task 5.2: Reflect the mode in `ptah harness doctor` ⏸️ PENDING

**Files**:

- `D:\projects\ptah-extension\apps\ptah-cli\src\cli\commands\plugin.ts`
- the `harness doctor` command file (sources line)
  **Dependencies**: Task 5.1

Reflect the mode in `ptah harness doctor`'s **sources line**, so a doctor run in
a workspace propagating nothing explains why rather than reading as empty.

**Do not change the exit code.** The doctor exits 1 when the harness is degraded
or in error, a deliberate divergence from `ptah spec doctor`, and the verdict
comes from `summarizeHarnessHealth` — never from re-deriving the rule at the call
site. A `'selected'` workspace with an empty allowlist is `ok`, not degraded
(R4 / task 4.3), so this line is informational only.

---

### Task 5.3: CLI specs ⏸️ PENDING

**File**: beside `D:\projects\ptah-extension\apps\ptah-cli\src\cli\commands\harness.spec.ts` (which already pins the doctor exit codes)
**Recommended per-task executor**: `senior-tester`
**Dependencies**: Tasks 5.1, 5.2

Pin: `skill select --all` and `skill select <slug...>` hit the right RPC;
`skill selection` prints mode + list; the doctor's exit code is unchanged for a
`'selected'` workspace with an empty allowlist.

---

**Batch 5 Verification**:

- `npm run lint:all`
- `npm run typecheck:all`
- `npm run test`
- `apps/ptah-cli` still reaches `harness-sync` only through RPC
- `code-logic-reviewer` approved

---

## Batch 6 — Docs + CLAUDE.md ⏸️ PENDING

**Recommended Executor**: `technical-content-writer`
**Fallback Executor**: `general-purpose`
**Execution Mode**: sequential
**Rationale**: prose across three files that must agree with each other and with
five batches of shipped behaviour.
**Tasks**: 5 | **Dependencies**: Batches 1–5 committed

---

### Task 6.1: `libs/backend/harness-sync/CLAUDE.md` — the gate table ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\harness-sync\CLAUDE.md`

The gate table currently reads "the whole `agents` COLUMN is gated on user
consent (TASK_2026_286)". It becomes a **skills row too**. Add `skillSyncMode` /
`enabledSkillSlugs` with their scope, their file, and who sets them, in the same
two-row shape as `agentSyncEnabled` / `disabledAgentIds`.

Also correct the sentence this task falsifies: the current text says skills and
commands "are content the user installed or authored on purpose" and that agents
"were the one artifact kind that propagated with no gate at all". That premise
is true of the workspace where the install happened and **false of every other
workspace on the machine**, which is the whole of this report.

---

### Task 6.2: `libs/backend/harness-sync/CLAUDE.md` — Settings + pinning table + the 1.1 decision ⏸️ PENDING

**File**: `D:\projects\ptah-extension\libs\backend\harness-sync\CLAUDE.md`
**Dependencies**: Task 6.1

Three edits:

- Add `skillSyncMode` to the Settings section's "**Neither gate for the `agents`
  facet is a setting, deliberately**" note, with the same per-workspace
  reasoning — a user-global "sync skills" toggle would either propagate into
  every project on the machine or silently mean nothing in most of them. That is
  literally the reported bug, so say so.
- Add the new spec files to the "Where each edge case is pinned" table:
  `reconciler/harness-reconciler.plugin-gate.spec.ts` and
  `reconciler/harness-reconciler.skill-consent.spec.ts`. Consider a new edge-case
  code (E27) for "skills propagated with no per-workspace consent", mirroring
  E26's row.
- **Record the Task 1.1 decision** — sidecar shape (a) or (b) — and the reason.
  Task 1.1 requires this; this is where it lands.
- Record the Task 4.3 decision: unselected slugs are not reported in
  `HarnessHealth`, and why.

---

### Task 6.3: `skill-toggles.md` — the third level ⏸️ PENDING

**File**: `D:\projects\ptah-extension\apps\ptah-docs\src\content\docs\plugins\skill-toggles.md`
**Dependencies**: Task 1.6 (the junction rewrite), Batch 2

The Batch 1 rewrite took the page off junctions. This task adds **the new outer
gate and how it composes** with plugin enablement and `disabledSkillIds` — a
**three-level table replacing the current two-level one**, evaluated
outermost-first: skill-sync gate → plugin enablement → `disabledSkillIds`.

---

### Task 6.4: A new docs page for per-project selection ⏸️ PENDING

**File**: new page under `D:\projects\ptah-extension\apps\ptah-docs\src\content\docs\plugins\`
**Dependencies**: Task 6.3

Linked from the plugins section index. Covers: why a new workspace propagates
nothing (U2), how to select, the `'all'` escape hatch, the CLI equivalents from
Batch 5, and — for upgrading users — that an existing workspace keeps everything
it already had (the 2.3 migration).

---

### Task 6.5: Root `CLAUDE.md` check ⏸️ PENDING

**File**: `D:\projects\ptah-extension\CLAUDE.md`
**Dependencies**: Tasks 6.1–6.4

Verify the `harness-sync` one-line description in the Module Index still reads
true after six batches. Edit only if it does not. Do not restate the gate here —
the lib's own CLAUDE.md owns it.

---

**Batch 6 Verification**:

- `npm run lint:all`
- `nx build ptah-docs` (the docs site's only gate — there is deliberately no
  `check` target)
- Every path, line number and rule from the orchestrator outline survives
  somewhere in the docs or this file
- `code-logic-reviewer` approved

---

## Verification gate (all batches)

`npm run lint:all`, `npm run typecheck:all`, `npm run test`, and
`nx build ptah-docs` (the docs site's only gate — there is deliberately no
`check` target). Per-batch subsets are listed under each batch.

Every commit follows the repo's commitlint conventions. **Hooks are never
bypassed** — no `--no-verify`, no `--no-gpg-sign`. If a hook fails, the
underlying issue gets fixed.

## The manual check that reproduces the report

Run after Batch 4, and again after Batch 6.

1. Enable `ptah-angular` in workspace **A**.
2. Open workspace **B**. Confirm `.claude/skills` in B is empty and the Dashboard
   card offers the picker.
3. Select two skills. Confirm **exactly those two** land in `.claude/skills`,
   `.agents/skills` and `.github/skills`.
4. Re-open workspace **A** and confirm **nothing there was reaped**.

Step 4 is the migration, and it is the only failure in this task that destroys
user state.

## The Batch 1 manual check

Run after Batch 1, before Batch 2 starts.

1. In a workspace with `ptah-angular` enabled, confirm its skills are present in
   `.claude/skills`.
2. Uncheck `ptah-angular` in the Configure modal.
3. Confirm its skills **leave** `.claude/skills`, `.agents/skills`,
   `.github/skills` and `.cursor/skills` — that is the fix for defect 2.
4. Confirm the clone under `~/.ptah/user/skills` **survives** (task 1.4).
5. Re-check `ptah-angular`. Confirm the skills come back **without a download** —
   that is what the surviving clone buys.

---

## Status Icons

| Status         | Meaning                               | Who sets it |
| -------------- | ------------------------------------- | ----------- |
| ⏸️ PENDING     | not started                           | team-leader |
| 🔄 IN PROGRESS | assigned                              | team-leader |
| 🔄 IMPLEMENTED | developer done, awaiting verification | developer   |
| ✅ COMPLETE    | verified and committed                | team-leader |
| ❌ FAILED      | verification failed                   | team-leader |
