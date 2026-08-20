# TASK_2026_261 — Implementation Report

**Outcome: the reported defect does not exist at HEAD. No fix was required.**

The task was written from a read of the code, not a live profile, and its central
factual claim — that `UserLayerMirrorService.reconcile()` "has no caller in production
code" — is false and has been false since 2026-06-08. I could not construct a spec that
fails against today's code, because the fix the task asks for is already the shipped
behaviour. What I delivered instead is the regression guard that was genuinely missing,
plus one comment correction.

---

## 1. What the task claimed, and what is actually true

| Claim in `task.md` / `context.md`                                                                              | Status at HEAD                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mirrorSkillSlug` returns early when the clone dir exists; no re-copy, no hash compare                         | **True.** `user-layer-mirror.service.ts:1237-1249`, and the same shape at ~1332 (commands) and ~1391 (agents). This is correct and intended — see §4. |
| `reconcile()` classifies noop / fastForwarded / diverged across skills, commands, agents, under `withSlugLock` | **True.** `:253-287`, dispatching to `reconcileDirClone` (`:863`) and `reconcileFileClone` (`:919`).                                                  |
| **"No production caller."**                                                                                    | **False.** Both hosts call it.                                                                                                                        |
| `listClones()` reports stored sidecar flags rather than computing drift                                        | **True**, and correct as designed — see §5.                                                                                                           |

The `grep -rn "\.reconcile(" libs/ apps/` recorded at `context.md:52` reports only
`libs/api/billing`. Re-running that exact grep today returns the two production call
sites as well. They match the pattern (`await mirror.reconcile({`), so the grep in the
spec was either not run or its output was mis-transcribed. That single line is the load-
bearing error the whole task rests on.

### The production callers

```
apps/ptah-electron/src/activation/plugin-activation.ts:151      reconcileUserLayer(...)
apps/ptah-electron/src/activation/wire-runtime.ts:181           ← calls it
apps/ptah-extension-vscode/src/activation/plugin-activation.ts:108  reconcileUserLayer(...)
apps/ptah-extension-vscode/src/activation/wire-runtime.ts:60    ← calls it
```

Both hosts run the identical sequence:

```ts
const userLayerRoots = await mirrorUserLayer(...);   // create-if-absent
contentDownload.ensureContent()
  .then(async (result) => {
    await mirrorUserLayer(...);                      // pick up newly-added slugs
    if (!result.fromCache) {
      await reconcileUserLayer(...);                 // refresh EXISTING clones
    }
  })
  .catch(...);                                       // non-fatal
activateSkillJunctions(..., userLayerRoots);
```

This landed in three commits on 2026-06-08, over two months before the task was written:

```
606665a3b feat(electron): add user-layer reconcile engine for plugin re-downloads
35f3a3944 feat(electron): resolve diverged clones via rebase/keep + pending_source_hash
fcf26c19e feat(electron): wire reconcile into the re-download path + catalog divergence
```

The shipped behaviour is exactly the brief's decided fix direction: fast-forward clones
whose hash still matches their sidecar, flag diverged ones for the manual `rebaseClone`
path, cover all three kinds, snapshot to `.history` before overwriting, non-fatal.

## 2. Reproduction attempt — the required first step

I wrote the repro before touching anything. New file:

**`D:/projects/ptah-extension/libs/backend/agent-generation/src/lib/services/user-layer/user-layer-activation-sequence.spec.ts`**

It models the host activation window end-to-end over a real temp filesystem (`os.homedir`
mocked, same harness as `user-layer-reconcile.spec.ts`), seeding one skill dir, one
command file and one workspace agent file, then simulating a content update to all three.

Five tests, **all passed on the first run, before any change**:

1. `mirrorAll` alone leaves skills, commands AND agents frozen after an upstream update —
   asserts `skillsMirrored/commandsMirrored/agentsMirrored === 0` on the second pass.
   This reproduces the _mechanism_ in the task and proves the reconcile call is
   load-bearing rather than decorative.
2. The full sequence fast-forwards all three kinds — `fastForwarded === 3`, and the clones
   read back `v2`. **This is the test that would have failed had the defect been real.**
3. The sequence is idempotent — a second reconcile with no upstream change is `noop === 3`.
4. A user-edited clone is flagged, never overwritten: the edited skill diverges with a
   `pendingSourceHash`, while the untouched command and agent still fast-forward.
5. Reconcile surfaces a per-slug copy failure as a counted error and still reconciles the
   other kinds — activation is never taken down by a mirror fault.

Test 2 is the direct negation of the task title. It is green against unmodified code.

The repro procedure in `context.md:79-88` would additionally not have triggered
reconcile, because step 2 is a _manual_ edit of `~/.ptah/plugins/**`. Reconcile is gated
on `!result.fromCache`, and `fromCache` is `true` whenever the fetched manifest's
`contentHash` matches the cached one (`content-download.service.ts:187-198`). A hand-edit
does not change the manifest hash. The real-world path the task actually cares about —
"ship a fix to a bundled skill, publish the manifest" — _does_ change `contentHash`,
which forces a download, which sets `fromCache: false`, which runs reconcile. The gate is
correct; the manual repro steps just do not exercise it.

## 3. Call-site analysis — which of the seven need a reconcile pass

Two of seven. The other five are pure consumers.

| Call site                                                   | What it does with the mirror | Reconcile?              |
| ----------------------------------------------------------- | ---------------------------- | ----------------------- |
| `apps/ptah-electron/.../plugin-activation.ts`               | owns the activation window   | **Yes — already there** |
| `apps/ptah-extension-vscode/.../plugin-activation.ts`       | owns the activation window   | **Yes — already there** |
| `apps/ptah-electron/.../cli-agent-sync.ts:35`               | `getUserLayerRoots().agents` | No                      |
| `apps/ptah-electron/.../cli-skill-sync.ts:36`               | `getUserLayerRoots()`        | No                      |
| `apps/ptah-electron/.../skill-repropagation.ts:75,90`       | `getUserLayerRoots()`        | No                      |
| `libs/backend/cli-engine/.../cli-skill-repropagation.ts:68` | `getUserLayerRoots()`        | No                      |

Every one of the five resolves the service purely to read `getUserLayerRoots()` — a path
getter that touches no filesystem. They consume mirror _output_; none owns the moment at
which upstream content changes.

The parent's instinct about the repropagation path was right, and it is the strongest
argument against mechanically touching all seven: `skill-repropagation` and
`cli-skill-repropagation` run per workspace change, and `reconcile()` costs a full
`computeSourceHash` tree walk over every clone of every enabled plugin. Putting it there
would convert a cheap path-lookup into a repeated hash walk of the whole user layer, to
detect a change that can only have originated from a content download the activation
window already handles. Correct answer: leave all five alone.

## 4. Why the create-if-absent mirror is not itself the bug

`context.md:66-77` frames the early return as the defect, and notes the irony that
`harness-plugins.md` describes mirroring as freezing skills. The framing inverts the
design. The mirror and the reconciler are deliberately separate operations:

- `mirrorAll()` runs on **every** activation and must stay cheap and non-destructive. It
  answers "does a clone exist for this slug?" Making it re-copy unconditionally is the
  wrong fix the task's own "Watch for" section correctly warns against — it would clobber
  `writeEnhancedSkill` output on every start.
- `reconcile()` runs **only when upstream actually changed**, and is the only path allowed
  to overwrite, because it is the only one that hashes the clone first to prove there are
  no user edits to lose.

The early return at `:1237-1249` is what makes "never clobber user edits" true. It is not
the defect; it is the invariant.

## 5. `listClones()` — stored flags are the right call

`listClones()` (`:201-251`) reads `sidecar.diverged` / `sidecar.pendingSourceHash` rather
than hashing. That is `context.md`'s option 3, and it should stay rejected. The flags are
written by `reconcile()`, which runs whenever the source _can_ have changed. Between
reconciles the source is by definition unchanged, so the stored flags are accurate. Adding
a hash walk per clone per list call would buy staleness detection only for out-of-band
hand-edits of `~/.ptah/plugins/**`, which is not a shipping path, and would put a full
tree hash on every render of the Skills tab clone view.

## 6. The watermark — explicitly, it is dead as an optimisation

Asked for directly, so stated plainly: **`USER_LAYER_MIRRORED_AT` skips no work.** It
gates a log line and nothing else. Both hosts read it only to decide whether to emit the
"backfill complete" message once (`plugin-activation.ts`, electron `:91-98`, VS Code
`:78-87`). The directory walk runs on every activation regardless — and must, because
that is how newly-added slugs get clones.

It does not earn its place as an optimisation, but it is not worth removing either: as a
first-run flag it costs one `IStateStorage` read and suppresses a log line that would
otherwise fire every start. Keep it; just stop calling it an optimisation.

That mislabelling is not harmless, which is why I made the one code change in this task.
The Electron docstring claimed the watermark "only skips the directory walk after the
first successful backfill" — describing an optimisation that does not exist, and implying
mirroring is watermark-gated. That is precisely the misconception that produces this
task's conclusion: if you believe the walk is skipped after first run, the frozen-clone
story follows, and you stop looking for the reconciler. Corrected in place:

**`D:/projects/ptah-extension/apps/ptah-electron/src/activation/plugin-activation.ts:54-63`**
— docstring now states the watermark gates the log only, the walk runs every activation
and must, and refreshing an existing clone is `reconcileUserLayer`'s job. VS Code's
equivalent docstring was already accurate ("only skips the backfill log after the first
run") and needed no change.

## 7. One real residual, deliberately not fixed

Commands, on Windows, lag by exactly one activation.

`SkillJunctionService` junctions skill _directories_ (`skill-junction.service.ts:709-713`),
so a fast-forward inside a clone dir is visible through the workspace junction
immediately. Commands are different: on Windows they are `copyFileSync`'d into
`.claude/commands/`, with a manifest keyed on the source's `size` + `mtimeMs`
(`:690-698`). Because `reconcileUserLayer` runs inside a non-awaited `.then()` chain while
`activateSkillJunctions` runs synchronously after, a command fast-forwarded post-download
is copied into the workspace only on the _next_ activation, when the manifest comparison
notices the changed size/mtime and re-copies.

I am not changing this, for two reasons. Awaiting the download before activating junctions
would block activation on an HTTPS manifest fetch — a far worse regression than a
one-activation lag, and the non-awaited chain is clearly deliberate. And the lag
self-heals without user action. If it is ever judged worth closing, the correct shape is
to re-run the command sync after a reconcile reports `fastForwarded > 0`, not to make
activation wait on the network. Worth its own task; out of scope here.

## 8. Changes left in the working tree

Not committed, per instruction.

| File                                                                                               | Change                                                                          |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-activation-sequence.spec.ts` | **New.** 5 tests pinning the activation-sequence contract both hosts depend on. |
| `apps/ptah-electron/src/activation/plugin-activation.ts`                                           | Docstring only — corrected the false watermark claim. No behaviour change.      |

No production logic was modified. `catch (error: unknown)` with `instanceof Error`
narrowing is used throughout the code inspected and in the new spec's harness; the spec
drives the service's own `copyTree` / `copyFileAtomic` / sidecar helpers rather than raw
`node:fs` for all clone mutation.

## 9. Verification — real output

```
npx nx test agent-generation --skip-nx-cache
  Test Suites: 24 passed, 24 total
  Tests:       562 passed, 562 total          (baseline before my spec: 23 suites / 557)

npx nx run-many -t typecheck -p agent-generation ptah-electron --skip-nx-cache
  Successfully ran target typecheck for 2 projects

npx nx run-many -t lint -p agent-generation ptah-electron --skip-nx-cache
  ✖ 330 problems (0 errors, 330 warnings)
  Successfully ran target lint for 2 projects
```

The 330 lint warnings are **pre-existing** — all `@typescript-eslint/no-unused-vars` in
files I did not touch (`types/core.types.ts`, `core.types.spec.ts`, and similar). Grepping
the lint output for `activation-sequence` and `plugin-activation` returns nothing: both
files I touched are warning-clean. Not fixed, per instruction.

`ptah-extension-vscode` was not modified, so it is outside the verification scope.

## 10. Recommendation

Close TASK_2026_261 as **not reproducible / already fixed**, referencing `fcf26c19e`.
Keep the new spec — it is the regression guard that would have prevented this task from
being written, and it fails loudly if anyone removes the `reconcile()` call from either
host's activation glue.

Docs are out of scope as instructed, and — worth flagging — `plugins/harness-plugins.md`
and `plugins/plugin-storage.md` need **no** edit after all, since no behaviour changed.
The `harness-plugins.md` reasoning quoted at `context.md:74-77` is in fact still correct:
harness plugins stay out of `enabledPluginIds`, so they are never mirrored, so they are
never reconciled either — they read live from the plugin dir by design.
