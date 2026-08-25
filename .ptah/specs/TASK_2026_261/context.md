# Context — TASK_2026_261

> **CORRECTION — this task's premise is false. Cancelled, not reproducible.**
>
> The load-bearing claim below — that `reconcile()` "has no caller in production code" —
> is wrong. Both hosts call it, and have since `fcf26c19e` (2026-06-08):
> `apps/ptah-electron/src/activation/plugin-activation.ts:172` and
> `apps/ptah-extension-vscode/src/activation/plugin-activation.ts:125`.
>
> The grep recorded below was truncated with `head` before it reached `apps/`; every hit
> shown came from `libs/backend`. The conclusion was drawn from an incomplete search.
>
> Everything else here is accurate — the early return, the sidecar hashing, `listClones`
> reading stored flags — but the reading of it is inverted. `mirrorAll()` is deliberately
> create-if-absent so it can run cheaply on every activation without clobbering user edits;
> `reconcile()` is the separate pass that runs only when the manifest hash changed, hashes
> each clone to prove there are no edits to lose, then fast-forwards it. The early return
> is the invariant, not the defect.
>
> The repro steps in this file would not have triggered it either: hand-editing
> `~/.ptah/plugins/**` does not change the manifest `contentHash`, so `fromCache` stays
> true and reconcile is skipped by design.
>
> Outcome: no fix. A 5-test regression guard was added at
> `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-activation-sequence.spec.ts`,
> and a false watermark docstring in Electron's `plugin-activation.ts` — which is what
> produced this misreading — was corrected. See `implementation-report.md`.

## How the chain is supposed to work

```
~/.ptah/plugins/<plugin>/skills/<slug>/SKILL.md      ← ContentDownloadService writes this
        │  UserLayerMirrorService.mirrorAll()
        ▼
~/.ptah/user/skills/<slug>/                          ← the clone the workspace actually uses
        │  SkillJunctionService.createJunctions()
        ▼
<workspace>/.claude/skills/<slug>/                   ← junction (Windows) / symlink (Unix)
```

`buildSkillsMap` uses the user layer as the **base** map and overlays plugin paths
additively, with **user-layer entries winning on collision**
(`skill-junction.service.ts:402-412`). So for any skill that has been mirrored, the
workspace junction resolves to the clone, not to the plugin directory.

## Where it breaks

`user-layer-mirror.service.ts:1237-1249`:

```ts
if (await this.dirExists(targetDir)) {
  const existingSidecar = await readSidecar(targetDir);
  if (!existingSidecar) {
    await this.reconcileMissingSidecar(targetDir, sourceDir, { ... });
  }
  seenSkillSlugs.set(slug, sourceDir);
  result.skipped += 1;
  return;            // ← no re-copy, no hash comparison
}
```

`computeSourceHash` runs only on the **first** copy (line 1254) and is written into the
origin sidecar. On every later activation the clone already exists, so the method returns at
line 1248 and the source hash is never recomputed or compared.

The comment on `mirrorUserLayer` in both apps' `plugin-activation.ts` states this honestly —
"create-if-absent, so it is safe to call on every activation". The mirror is behaving as
designed. What is missing is the thing that was supposed to notice the design's consequence.

## The drift detector exists and is never called

`UserLayerMirrorService.reconcile(sources)` (`:253-287`) walks plugin skills, commands and
agents and classifies each clone as `noop` / `fastForwarded` / `diverged`, setting
`diverged` and `pendingSourceHash` on the sidecar. `fastForwarded` is precisely the
"clone is unmodified, upstream changed, take the new version" case.

```
grep -rn "\.reconcile(" libs/ apps/   →  only libs/api/billing (unrelated subscription.reconcile)
```

**No production caller.** In `libs/backend/agent-generation` the `diverged` flag is written
only inside `reconcile()` and asserted only in `user-layer-mirror.service.spec.ts`.

`listClones()` (`:201-251`) then reports `sidecar.diverged` and `sidecar.pendingSourceHash`
as **stored values** — it does not hash the current source. So the Skills tab's clone view,
which is fed by `skillSynthesis:listClones`, shows every clone as never-diverged regardless
of what happened upstream.

`rebaseClone()` works and is RPC-exposed (`skills-synthesis-rpc.handlers.ts:1203`), with UI
at `skill-clones-view.component.ts:500`. The repair exists. Nothing tells the user to use it.

## Net effect

| Skill kind                               | Junction target                                 | Gets upstream updates?                |
| ---------------------------------------- | ----------------------------------------------- | ------------------------------------- |
| Bundled plugin skill, already mirrored   | `~/.ptah/user/skills/<slug>/`                   | **No** — frozen at first mirror       |
| Bundled plugin skill, never mirrored yet | plugin dir via the overlay                      | Yes                                   |
| Harness-authored (`ptah-harness-*`)      | `~/.ptah/plugins/ptah-harness-*/skills/<slug>/` | Yes — never mirrored, so never frozen |

The irony: `harness-plugins.md` explains that harness plugins are deliberately kept out of
`enabledPluginIds` because "mirroring would freeze its skills at the moment of the mirror".
That reasoning is correct, and it is exactly what happens to every bundled skill that _is_
mirrored.

## Reproduce first

1. Activate with a bundled plugin enabled; confirm `~/.ptah/user/skills/<slug>/SKILL.md`
   exists and `<workspace>/.claude/skills/<slug>` resolves to it.
2. Edit `~/.ptah/plugins/<plugin>/skills/<slug>/SKILL.md` (simulating a content update).
3. Restart / reactivate.
4. Read the file through the workspace junction. Old content ⇒ confirmed.

A `contentHash` change is the real-world trigger, since that is what makes
`ContentDownloadService` rewrite the plugin file in step 2.

## Fix directions (decide, don't default)

1. **Call `reconcile()` during activation**, right after `mirrorAll()`. The method already
   exists, already distinguishes fast-forward from divergence, and already records the
   result. Smallest change that restores the intended behaviour; needs a decision on whether
   `fastForwarded` clones are rebased automatically or only flagged.
2. **Auto-rebase unmodified clones, flag diverged ones.** A clone whose current hash still
   matches its sidecar has no user edits to lose, so taking the update is safe. Diverged
   clones surface in the Skills tab for a manual `rebaseClone`.
3. **Compute drift in `listClones`** instead of reading stored flags. Makes the UI honest
   without changing activation, but costs a hash walk per clone on every list and still
   leaves the workspace serving stale content until the user acts.

Option 2 is the behaviour a user would expect. Option 1 is its prerequisite.

## Watch for

- The user layer is **editable** — `writeEnhancedSkill` exists, and clones carry history and
  revert. Any auto-update must not clobber user edits; that is what the `diverged` flag is
  for, and why "just always re-copy" is the wrong fix.
- Commands and agents go through the same mirror and the same reconcile path. Whatever lands
  should cover all three, not just skills.

## Related

- TASK_2026_258 — `plugins/harness-plugins.md` and `plugins/plugin-storage.md` describe the
  sync path. If this changes, both need review.
- TASK_2026_259 — the prune fix, same `~/.ptah/plugins` tree.
