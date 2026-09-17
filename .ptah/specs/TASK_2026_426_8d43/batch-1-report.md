# Batch 1 report — TASK_2026_426_8d43

Backend write path: `skillSynthesis:saveCloneBody` end to end. Tasks 1.1–1.5
complete. No git commit made; no `npx nx reset` run; no `project.json` touched;
`libs/backend/vscode-core/src/messaging/rpc-handler.ts` untouched.

## Files changed

### Task 1.1 — wire contract

- MODIFIED `libs/shared/src/lib/types/rpc/rpc-skill-clone.types.ts` —
  `SkillSynthesisSaveCloneBodyParams { kind, slug, body }` and
  `...Result { kind, slug, historyTs }`, beside the `KeepClone` pair.
- MODIFIED `libs/shared/src/lib/types/rpc.types.ts` — all THREE edits: the
  `./rpc/rpc-skill-clone.types` type-import block, the `RpcMethodRegistry`
  entry, and the `RPC_METHOD_ENTRIES` literal that `RPC_METHOD_NAMES` derives
  from.

### Task 1.2 — the first gate

- MODIFIED `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.schema.ts`
  — `SkillSaveCloneBodyParamsSchema`, composed from the EXISTING `SlugSchema`
  and `SkillCloneKindSchema` (no second slug rule authored) plus
  `body: z.string().min(1).max(1_048_576)`.
- MODIFIED `.../skills-synthesis-rpc.schema.spec.ts` — rejects `'../x'`,
  `'a/b'`, `'a\\b'`, `kind: 'plugin'`, `body: 42`, `body: ''`; plus the cap
  boundary both sides.

**1 MiB cap assumption, verified before landing.** Largest body this surface
carries is ~16 KB (`context.md`, `ptah-core/skills/orchestration`, 15 986
bytes). The cap is ~65x the largest real body.

### Task 1.3 — the handler

- MODIFIED `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts`
  — `registerSaveCloneBody()`, called from `register()`, plus the name in the
  `METHODS` tuple (the Concern-1 requirement, same commit). No new constructor
  parameter: `registry` and `mirror` were already injected. `parseParams` /
  `requireDesktop` / `toUserError` / `report` reused verbatim. One `info` log
  with `{ kind, slug, historyTs }` on success.
- MODIFIED `.../skills-synthesis-rpc.handlers.spec.ts` — every row of the plan's
  failure table, plus the success case asserting the mirror is called with
  exactly `{ kind, slug, body, workspaceRoot }`, plus an explicit assertion that
  **no SQLite registry write happens** (`setDiverged` / `setPending` never
  called).

### Task 1.4 — the write

- MODIFIED `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.ts`
  — `SaveCloneBodyArgs` / `SaveCloneBodyResult`, the public `saveCloneBody`
  (lock, then dispatch dir vs file, matching `rebaseClone` / `keepClone`), and
  the private `saveDirCloneBody` / `saveFileCloneBody`.

**The binding rule is honoured.** `currentContentHash` is the only sidecar field
written. `sourceHash`, `diverged`, `pendingSourceHash`, `lastEnhancedAt`,
`clonedAt`, `pluginId`, `version`, `historyDir`, `orphaned` are all carried
through by spread and never assigned. A clone with **no** sidecar gets none
minted — the body write still succeeds. No `mkdir`, no create on a missing
clone; an absent target returns `{ written: false, reason: 'clone-missing' }`.
The snapshot precedes the overwrite unconditionally: `snapshotDirToHistory` for
`skill`, `snapshotFileToHistory` for `agent`/`command`, and both specs assert
the snapshot is discoverable through `listHistory` with the PRIOR body inside.

### Task 1.5 — the five proofs

- MODIFIED `.../user-layer-mirror.service.spec.ts` — a `saveCloneBody` describe
  with six tests over the existing temp-`~/.ptah/user` fixtures: body lands;
  `listHistory` returns exactly one more entry carrying the prior body;
  `sourceHash` / `diverged` / `pendingSourceHash` / `lastEnhancedAt` identical
  before and after while `currentContentHash` changed; missing clone returns
  `written: false` and creates nothing (both layouts); sidecar-less clone
  written with no sidecar minted (both layouts).

## Plan deviation — a FIFTH registration site

The plan and the team-leader's Concern-1 analysis name four registration sites.
There is a fifth, and it goes red:

`apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts` holds an exhaustive,
sorted `expected-absent` list of every method the VS Code host does NOT serve,
and asserts it EXACTLY. `skillSynthesis:saveCloneBody` is Electron-only by
construction (it writes through `UserLayerMirrorService`, unbound in that host),
so the method belongs in that list. Before the edit:

```
● VS Code RPC surface › excludes exactly the pre-refactor Electron-only method list
Test Suites: 1 failed, 4 passed, 5 total
```

- MODIFIED `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts` — one entry
  added in sorted position with a one-line reason, matching the neighbours.
  Nothing else in the file, and `expected-absent.ts` itself is untouched —
  `SkillsSynthesisRpcHandlers` stays absent as the batch requires.

Flagging it for batch 4 and 5: any further new `skillSynthesis:*` method needs
this fifth site too.

## Verification — commands and observed results

All run from the worktree root.

**Typecheck — PASS**

```
npx nx run-many -t typecheck -p @ptah-extension/shared @ptah-extension/rpc-handlers @ptah-extension/agent-generation
 NX   Running target typecheck for 3 projects:
 NX   Successfully ran target typecheck for 3 projects
```

**Lint — PASS, exit 0, 0 errors**

```
npx nx run-many -t lint -p @ptah-extension/shared @ptah-extension/rpc-handlers @ptah-extension/agent-generation --skip-nx-cache
 NX   Successfully ran target lint for 3 projects
exit=0
```

Only pre-existing warnings (`max-lines`, `no-explicit-any`,
`no-non-null-assertion`) in files this batch did not create.

**Test — the batch command. Header confirmed `3 projects`.**

```
npx nx run-many -t test -p @ptah-extension/shared @ptah-extension/rpc-handlers @ptah-extension/agent-generation --skip-nx-cache
 NX   Running target test for 3 projects:
@ptah-extension/shared          Test Suites: 56 passed, 56 total   Tests: 1375 passed
@ptah-extension/rpc-handlers    Test Suites: 94 passed, 94 total   Tests: 2741 passed, 31 skipped
@ptah-extension/agent-generation  — FLAKY under lane contention, see below
```

`shared` and `rpc-handlers` are green on every run, including
`rpc-allowlist.spec.ts` (the Concern-1 gate), which is inside the 94 green
`rpc-handlers` suites.

**`agent-generation` under three-lane contention — reported honestly.**

Two concurrent `run-many` invocations produced DIFFERENT failures, all of them
5000 ms Jest timeouts on long-running temp-filesystem suites, none of them a
file this batch touched:

- run A: `voice-rpc.handlers.spec.ts` (172 s), `workspace-rpc.handlers.spec.ts`
  (74 s) — 2 failed, 2739 passed
- run B: `user-layer-rebase-origins.spec.ts` (66 s),
  `user-layer-activation-sequence.spec.ts` (70 s) — 4 failed, 966 passed

Run in isolation, both projects are fully green and Nx itself labels the task
flaky:

```
npx nx run @ptah-extension/agent-generation:test --skip-nx-cache
Test Suites: 31 passed, 31 total    Tests: 970 passed, 970 total
 NX   Successfully ran target test for project @ptah-extension/agent-generation
 NX   Nx detected a flaky task

npx nx run @ptah-extension/rpc-handlers:test --skip-nx-cache
Test Suites: 94 passed, 94 total    Tests: 2741 passed, 31 skipped, 2772 total
 NX   Successfully ran target test for project @ptah-extension/rpc-handlers
```

Assessment: three lanes hammering the same worktree and `tmpdir` starve the
5 s-default temp-fs suites. The suites that time out vary run to run and none of
them exercises `saveCloneBody`. **The team-leader should re-run the batch
command once the other two lanes are idle** before treating any of it as a real
failure. My own suites — `user-layer-mirror.service.spec.ts`,
`skills-synthesis-rpc.handlers.spec.ts`, `skills-synthesis-rpc.schema.spec.ts`
— passed on every single run.

**VS Code host — PASS after the fifth-site fix**

```
npx nx run ptah-extension-vscode:test --skip-nx-cache
Test Suites: 5 passed, 5 total    Tests: 39 passed, 39 total
 NX   Successfully ran target test for project ptah-extension-vscode and 26 tasks it depends on
```

**`git diff --name-only` — this batch's entries only** (other names in the
shared worktree belong to the concurrent lanes 2 and 3):

```
apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts
libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.ts
libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.spec.ts
libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts
libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.spec.ts
libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.schema.ts
libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.schema.spec.ts
libs/shared/src/lib/types/rpc.types.ts
libs/shared/src/lib/types/rpc/rpc-skill-clone.types.ts
```

No `project.json`. No `rpc-handler.ts`. No `libs/frontend/**`.

## Out-of-scope observations

- `user-layer-mirror.service.ts` is now 1866 lines (was ~1760). It was already
  well past the 700-line warn before this batch and has already had its facade
  split applied (`UserLayerFsOps`, `UserLayerOrphanReaper`). The two private
  save methods sit beside their `rebase*` / `writeEnhanced*` siblings, where a
  reader looking for "how does a clone get written" will find them. Not a
  finding to act on in this batch.
- The `agent-generation` and `rpc-handlers` temp-filesystem suites use the Jest
  5 s default and take 60–170 s under parallel load. Worth a per-suite
  `jest.setTimeout` at some point; out of scope here.
