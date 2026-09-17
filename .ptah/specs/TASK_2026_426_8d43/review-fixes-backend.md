# CodeRabbit review fixes — backend lane, PR #500, `TASK_2026_426_8d43`

Scope: the save path's backend half only. No file under `libs/frontend/**` was
touched. No commit was created. No `project.json` was edited and `nx reset` was
not run.

## Verdict per finding

| # | Finding | Verdict | Action |
| - | ------- | ------- | ------ |
| A | Whitespace-only body passes `.min(1)` | **VALID** | Fixed — trimmed-length refinement, original value preserved |
| B | Post-write metadata failure reports a failed save over a committed body | **VALID** | Fixed — explicit `metadataIncomplete` on a SUCCESS result (option 2) |
| C | Sidecar-less save reports an unqualified success | **VALID, backend half done** | `reconcileProtected: false` now travels on the result; the reconciler is untouched. The user-facing message needs the frontend lane |

---

## A — a whitespace-only body passed validation

**Confirmed against current source.** `skills-synthesis-rpc.schema.ts:417` was
`z.string().min(1).max(MAX_CLONE_BODY_CHARS)`. `' '` satisfies `.min(1)`, so a
body of `'   '` parsed, was written atomically, and was then reconciled outward
by `harness-sync` as an effectively empty skill into every harness directory —
the exact outcome the non-empty rule exists to prevent.

**Fix** — `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.schema.ts`:

```ts
body: z
  .string()
  .min(1)
  .max(MAX_CLONE_BODY_CHARS)
  .refine((b) => b.trim().length > 0, 'body must not be blank'),
```

The refinement tests the TRIMMED length; the value the schema RETURNS is the
original, untrimmed body. Nothing on the write path trims — a Markdown body's
leading blank line or trailing newline is the author's, and silently reshaping
it would be a second, unasked-for edit. `.min(1)` is kept because it is the
cheaper rejection for the literal empty string and its message is more precise.

**Tests** — `skills-synthesis-rpc.schema.spec.ts` gained four rejection rows
(`' '`, `'   '`, `'\n\n'`, `'\t \r\n '`) plus one positive case proving a body
with real content keeps its surrounding whitespace byte-for-byte.
`skills-synthesis-rpc.handlers.spec.ts` gained a boundary test asserting `'   '`
is refused with `INVALID_PARAMS` and `mirror.saveCloneBody` is never called.

**Before / after** — with `skills-synthesis-rpc.schema.ts` reverted to `HEAD`
and both specs at their new state:

```
● SkillSaveCloneBodyParamsSchema › rejects single-space body before any path is built
● SkillSaveCloneBodyParamsSchema › rejects spaces-only body before any path is built
● SkillSaveCloneBodyParamsSchema › rejects newlines-only body before any path is built
● SkillSaveCloneBodyParamsSchema › rejects tabs-and-newlines body before any path is built
● SkillsSynthesisRpcHandlers … › saveCloneBody › rejects a whitespace-only body before it can reach the mirror
Tests: 5 failed, 443 passed, 448 total
```

After the fix: 448 passed, 0 failed.

---

## B — a post-write metadata failure reported a failed save

**Confirmed against current source.** `saveDirCloneBody` and
`saveFileCloneBody` ran, in order: snapshot → `writeTextAtomic` →
`computeSourceHash` → `readSidecar` → `writeSidecarAtomic`. Any throw in the
last three unwound out of `saveCloneBody`, reached the handler's generic
`catch`, and became `PERSISTENCE_UNAVAILABLE` — while the new body sat committed
on disk. The trigger is not hypothetical: `readSidecarAt`
(`source-hash.ts:136-145`) rethrows anything that is not `ENOENT`, so a sidecar
holding invalid JSON throws inside that block.

**Chosen option: 2 — an explicit "committed, metadata incomplete" result.**

Option 1 (restore the body from the pre-write `.history` snapshot) was rejected
on the review's own tiebreaker: the restore is itself a second destructive
write, it has no snapshot of its own, and if IT fails the user is left with
neither the old body nor the new one — strictly worse than the state option 2
leaves. The state option 2 leaves is also cheap: the only field left stale is
`currentContentHash`, which no control path reads. The reconciler decides on
`sourceHash` and two live hashes (`user-layer-mirror.service.ts` reconcile
branches); `currentContentHash` is bookkeeping with one reader, SQLite
persistence.

**Fix** — `libs/backend/agent-generation/.../user-layer-mirror.service.ts`:

- `SaveCloneBodyResult` gained `metadataIncomplete: boolean`.
- The post-commit steps moved out of both save methods into two named
  collaborators, `refreshSavedSidecarDir` and `refreshSavedSidecarFile`, each
  returning `{ metadataIncomplete, reconcileProtected }` and each catching
  `error: unknown` narrowed with `instanceof Error` before `.message`. The
  failure is logged at `warn` through the injected `Logger` — the same channel
  `reapDeletedUpstream` already uses — and never crosses the RPC boundary.
- The extraction is what makes the commit point legible: the body write is the
  last step that can fail the operation, and everything after it lives in a
  method whose name says it is bookkeeping. Applied identically to the directory
  and the flat-file path.

`libs/backend/rpc-handlers/.../skills-synthesis-rpc.handlers.ts`:
`metadataIncomplete` is explicitly NOT an error branch. It is logged at `warn`
and returned on the successful result. Only `written: false` still maps to
`INVALID_PARAMS`.

**Binding constraints re-verified after the change**: the save still writes
`currentContentHash` and nothing else — `sourceHash`, `diverged`,
`pendingSourceHash` and `lastEnhancedAt` are carried by spread and never
assigned, on either variant; a sidecar-less clone still gets no sidecar minted;
the snapshot still precedes the write; everything is still inside the one
`withSlugLock`. Pinned by the two pre-existing "touches ONLY
currentContentHash" tests and by `frozenFields()` in
`user-layer-save-reconcile.spec.ts`.

**Tests** — `user-layer-mirror.service.spec.ts` gained a
`a post-write bookkeeping failure` describe with one case per kind. Each
corrupts the sidecar with invalid JSON and asserts: `written: true`,
`reason: null`, `metadataIncomplete: true`, a non-null `historyTs`, the new body
readable off disk, `listHistory` one entry longer, and the unreadable sidecar
left byte-identical (the save does not overwrite state it could not read).

**Before / after** — the pre-fix behaviour reproduced by making the bookkeeping
helper `throw error` instead of returning the flag, specs unchanged:

```
● … saveCloneBody › a post-write bookkeeping failure › reports written:true + metadataIncomplete for a corrupt sidecar (skill)
● … saveCloneBody › a post-write bookkeeping failure › reports written:true + metadataIncomplete for a corrupt sidecar (command flat file)
Tests: 2 failed, 24 passed, 26 total
```

Both rejected instead of returning a committed result. After the fix: 26 passed.
(Reverting the whole service file instead fails the suite earlier still, at
`TS2339: Property 'metadataIncomplete' does not exist on type
'SaveCloneBodyResult'` — a type-level failure that masks the behavioural one,
which is why the narrower experiment is the one quoted.)

---

## C — the sidecar-less save claimed an unqualified success

**Confirmed, and scoped as instructed.** `reconcileMissingSidecar` /
`reconcileMissingFileSidecar` are UNCHANGED. They are a pre-existing reconciler
rule affecting every clone kind, and the two `KNOWN LIMITATION` tests in
`user-layer-save-reconcile.spec.ts` that pin the loss are unchanged in what they
prove.

What changed is honesty, minimally:

- `SaveCloneBodyResult.reconcileProtected: boolean` — `true` when the clone has
  an origin sidecar, which is exactly the condition under which the next
  reconcile marks it diverged rather than fast-forwarding; `false` when it has
  none, and `false` when the sidecar could not be read (the conservative
  answer — nothing was learned).
- The flag is set where the knowledge is, inside the two bookkeeping
  collaborators, and travels through the handler onto the wire result
  `SkillSynthesisSaveCloneBodyResult`.
- The sidecar-backed path's behaviour is unchanged and its result shape is
  additive only: `historyTs` still means what it meant, `written`/`reason` on
  the mirror result are untouched.

**The result shape CAN carry this, and the backend half is complete.** Both
`metadataIncomplete` and `reconcileProtected` are on
`SkillSynthesisSaveCloneBodyResult` (`libs/shared/.../rpc-skill-clone.types.ts`)
with doc comments stating what a surface owes the user for each. I verified this
is not a breaking change for the frontend lane:
`npx nx run-many -t typecheck -p … @ptah-extension/skill-synthesis-ui` is green
with the fields REQUIRED — the frontend only passes the result through
(`skill-synthesis-rpc.service.ts:520-534`) and constructs no instance of the
type in production code.

**STOPPING POINT — the frontend half is NOT done, by instruction.** Nothing
renders either flag yet, so today the editor still toasts a plain
`Saved "<slug>"`. Two one-line consumptions are all that remain, both in the
frontend lane's files:

1. `skill-clones-view.component.ts` `onSaveBody` — when
   `result.reconcileProtected === false`, qualify the toast (suggested copy:
   `Saved "<slug>". This entry has no origin record, so a later sync may replace
   it — the snapshot is in History.`).
2. Same place — when `result.metadataIncomplete === true`, say the edit was
   saved but its bookkeeping did not complete (suggested copy:
   `Saved "<slug>". Its content record could not be updated; the file itself is
   correct.`). It must read as a saved edit, never as a failure.

---

## Files

- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/skills-tab-clone-management-681582aee5c4/libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.schema.ts` — blank-body refinement (A)
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/skills-tab-clone-management-681582aee5c4/libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.schema.spec.ts` — 4 rejection rows + 1 whitespace-preservation case (A)
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/skills-tab-clone-management-681582aee5c4/libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.ts` — `metadataIncomplete` + `reconcileProtected`; post-commit bookkeeping extracted into `refreshSavedSidecarDir` / `refreshSavedSidecarFile` (B, C)
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/skills-tab-clone-management-681582aee5c4/libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.spec.ts` — 2 new post-write-failure cases; flag assertions on the 4 existing save cases (B, C)
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/skills-tab-clone-management-681582aee5c4/libs/backend/agent-generation/src/lib/services/user-layer/user-layer-save-reconcile.spec.ts` — `reconcileProtected` asserted `true` on the surviving case and `false` on both `KNOWN LIMITATION` cases; result equality updated; header comment records the flag (C)
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/skills-tab-clone-management-681582aee5c4/libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts` — both flags returned; `metadataIncomplete` logged at `warn` and never mapped to an error (B, C)
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/skills-tab-clone-management-681582aee5c4/libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.spec.ts` — metadata-incomplete success case, sidecar-less case, whitespace-body rejection; existing mirror doubles updated (A, B, C)
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/skills-tab-clone-management-681582aee5c4/libs/shared/src/lib/types/rpc/rpc-skill-clone.types.ts` — the two new wire fields (B, C)

Two files sit outside the three the brief listed. Both are required by the
findings as written: B says "the handler maps to an honest message", which is
`skills-synthesis-rpc.handlers.ts`, and an honest message cannot reach the
surface without a field on the wire result, which is
`libs/shared/.../rpc-skill-clone.types.ts`. Neither is a frontend file.

## Verification

| Command | Result |
| ------- | ------ |
| `npx nx run-many -t test -p @ptah-extension/agent-generation --skip-nx-cache` (alone) | `Running target test for project @ptah-extension/agent-generation` — **32 suites / 979 tests passed** |
| `npx nx run-many -t test -p @ptah-extension/rpc-handlers @ptah-extension/shared --skip-nx-cache` | `Running target test for 2 projects` — shared **56 / 1375 passed**, rpc-handlers **94 suites / 2749 passed, 31 skipped** |
| `npx nx run-many -t typecheck -p @ptah-extension/shared @ptah-extension/rpc-handlers @ptah-extension/agent-generation @ptah-extension/skill-synthesis-ui --skip-nx-cache` | `Successfully ran target typecheck for 4 projects` |
| `npx nx run-many -t lint -p @ptah-extension/agent-generation @ptah-extension/rpc-handlers @ptah-extension/shared --skip-nx-cache` | exit 0, **0 errors**; warnings are pre-existing and in files this change does not touch |

Note on flakiness, not a regression: the first `agent-generation` run showed 3
failures, all `Exceeded timeout of 5000 ms` in
`user-layer-activation-sequence.spec.ts`, and a combined
`rpc-handlers + shared` run showed one in
`skills-sh-source-root.service.spec.ts`. Both are temporary-filesystem suites
unrelated to these files, both passed on a re-run of the same command, and this
is the pre-existing condition on `main` called out in the brief.

## Out-of-scope observations

- `reapDeletedUpstream` still runs outside `withSlugLock`, unlike every
  reconcile branch. Pre-existing; carried from `code-logic-review.md`.
- The `metadataIncomplete` recovery story is the `.history/<historyTs>`
  snapshot, which the drawer already lists. Nothing needs building for it.
- `computeSourceHash` runs before `readSidecar` in both new collaborators, so a
  hash failure and a sidecar failure are indistinguishable in the result. That
  is deliberate: both leave exactly the same stale field and the same
  user-facing statement, and splitting them would be a distinction the surface
  cannot act on.
