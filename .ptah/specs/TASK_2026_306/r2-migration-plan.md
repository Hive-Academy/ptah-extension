# R2 — Legacy Skill Adoption: Migration Plan

**Task**: TASK_2026_306
**Scope**: R2 of the harness-sync research set — what to do about the 13 `claude` skill
directories that reconcile reports as `missing` but never writes.
**Status**: design complete, blocked on one decision (see final section).

---

## 1. Grounded Diagnosis

### 1.1 The finding that invalidates the task's original framing

The task was written on the premise that `SkillJunctionService` created the 13 offending
directories, and that R2's job is therefore to _adopt Ptah's own orphaned output_. That
premise is false, and the code makes it falsifiable rather than merely doubtful.

> `SkillJunctionService` did not write those 13 directories and could not have. It created
> _links_ for skills and _copies_ only for commands — `createJunction(sourcePath, linkPath)`
> at `git e107e6f89^:libs/backend/agent-sdk/src/lib/helpers/skill-junction.service.ts:304-356`,
> with no copy fallback — and it explicitly skipped any path already holding a real
> directory (`:336-343`, log text: `Skipping ${skillName}: real directory exists (likely
SDK-created)`). A junction would not be blocked today anyway: `claude-target.ts:480-486`
> migrates one whose target resolves inside a declared source root, and `~/.ptah/plugins` /
> `~/.ptah/skills` are declared (`plugin-config-source-resolver.ts:55`).

Three independent facts, each sufficient on its own:

1. **No copy path existed for skills.** The service's only filesystem write for a skill is
   `createJunction(sourcePath, linkPath)`. There is no `cp -r`, no fallback branch, no
   "if junction creation fails, copy instead". A real directory is not a possible output
   of that function.
   `git e107e6f89^:libs/backend/agent-sdk/src/lib/helpers/skill-junction.service.ts:304-356`

2. **It refused to touch occupied paths.** Before writing, it stats the link path and bails
   if a real directory is present, logging
   `Skipping ${skillName}: real directory exists (likely SDK-created)`. The legacy code
   itself already suspected non-Ptah provenance and deferred to it.
   `git e107e6f89^:.../skill-junction.service.ts:336-343`

3. **Even if it had made junctions, they would not be blocked now.** `claude-target.ts`
   migrates a junction whose resolved target lands inside a declared source root, and
   `~/.ptah/plugins` and `~/.ptah/skills` are both declared roots. A surviving legacy
   junction is a _handled_ case, not a blocked one.
   `libs/backend/harness-sync/src/lib/targets/claude-target.ts:480-486`,
   `libs/backend/harness-sync/src/lib/sources/plugin-config-source-resolver.ts:55`

### 1.2 What the sidecar-manifest story does and does not explain

The prevailing explanation — "commands got a sidecar manifest, skills did not, so skills
lost their ownership record" — is _half_ correct, and the half it gets right is the half
that does not matter here.

Commands needed a manifest **because they were copies**. A copied directory is
indistinguishable from a user-authored one; the only way to prove Ptah wrote it is an
out-of-band record. Skills never needed a manifest **because a link is self-identifying** —
`lstat` says "symlink/junction", `readlink` says where it points, and pointing into a
declared source root _is_ the ownership proof. The asymmetry was correct design, not an
oversight.

So the sidecar accident explains why _commands_ could go orphaned. It does not explain the
13 skill directories, because those are not the residue of a copy Ptah made.

### 1.3 What the 13 actually are

Real directories of **unknown provenance**. At least three non-Ptah candidates exist, and
the evidence does not discriminate between them:

- **The Claude Code SDK itself.** The legacy code's own log text names this suspect:
  `real directory exists (likely SDK-created)`
  (`git e107e6f89^:.../skill-junction.service.ts:336-343`).
- **The pre-TASK_2026_288 install path.** `npx skills add --agent claude-code` wrote
  straight into `{ws}/.claude/skills`, bypassing Ptah's source layer entirely.
  `libs/backend/rpc-handlers/src/lib/harness/io/harness-skill-install.service.ts:17-25`
- **The user.** Hand-authored skills in `.claude/skills` are a documented, supported,
  entirely normal thing for a Claude Code user to have.

**There is no evidence that any of the 13 is Ptah's.** This is the load-bearing conclusion:
it removes the ground under every automatic-adoption option. Adoption requires a claim of
ownership, and we have no artifact that substantiates one. **Consent is the only available
proof of ownership.**

### 1.4 The runtime signature, confirmed live

A real `nx serve ptah-electron` cold start reproduces the condition:

```
[Ptah Electron] Harness reconciled (activation): sources=ok, detectedTargets=5/6,
found=106/119 (all targets), claude=14/27, missing=13, foreign=19, writeFailed=0
```

`D:/projects/ptah-extension/tmp/logs/coldstart-306.log:844`

Read the two numbers together: **`missing=13` alongside `writeFailed=0`**. Nothing failed.
The reconciler did not attempt these writes and then lose — it never enqueued them. Blocked
paths are filtered out before `plan.writes` is built, so the failure counter can never see
them. The health payload reports a 13-item shortfall with a perfect write record, forever,
with no surface anywhere that says why.

That is the actual user-visible defect, and it is real rather than hypothetical.

### 1.5 Restated problem

Not "adopt Ptah's orphaned skills". Rather:

> Thirteen paths in `.claude/skills` are occupied by directories Ptah did not create and
> cannot claim. Reconcile silently declines to write them, reports the shortfall as
> `missing`, and offers the user no explanation and no remedy. Fix the silence first;
> offer a remedy only where the user can supply the ownership proof the filesystem cannot.

---

## 2. Discriminators

The criteria any option must be judged against, in priority order.

| #   | Discriminator                              | Why it decides                                                                                                                                                                               |
| --- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Never destroys unowned user data**       | We cannot prove any of the 13 is ours. Overwriting is data loss with no defensible justification. Hard veto on any option that fails this.                                                   |
| D2  | **Makes the shortfall legible**            | `missing=13, writeFailed=0` is currently unexplainable from any surface. The user cannot act on what they cannot see. This is the defect with the largest blast radius and the smallest fix. |
| D3  | **Ownership claims are consent-backed**    | With no ownership artifact, the only valid source of a claim is the user saying so. Any automatic claim is a guess dressed as a fact.                                                        |
| D4  | **Reversible**                             | Whatever we do to an occupied path must be undoable without the user having a backup they did not know to make.                                                                              |
| D5  | **No new wire surface unless earned**      | Health payload changes ripple through the RPC contract, the frontend health card, and the e2e assertions. Derive before you add.                                                             |
| D6  | **Consistent with prior art in this repo** | The same class of problem was solved one directory over. Diverging needs a reason.                                                                                                           |
| D7  | **Batchable / independently shippable**    | R2 must not become a single 800-line change that blocks on a decision at the end.                                                                                                            |

Note on D5: **`blocked` needs no new wire field.** It is exactly `missing ∩ foreign` in the
existing health payload. Both sets are already computed and already transmitted; the
blocked set is derivable on the consumer side with no contract change at all.

---

## 3. Options

### Option A — Report the blocked set

Compute `blocked = missing ∩ foreign`, surface it in the harness health card, and log it at
reconcile time with the path list and the reason (`occupied by a directory Ptah does not
own`). No filesystem behaviour changes at all.

- Satisfies D1 (touches nothing), D2 (the whole point), D4 (vacuously), D5 (derived, no new
  field), D7 (self-contained).
- Does not satisfy: nothing is repaired. `missing=13` persists until the user acts.

### Option B — Automatic adoption by content heuristic

Compare each occupant against the corresponding source skill (frontmatter `name`, file
hashes, `SKILL.md` shape). Where they match closely enough, treat it as Ptah's and
overwrite with the managed copy.

- Fails **D1** and **D3**. A content match proves the _skill_ is the same skill, not that
  _Ptah wrote this directory_. The SDK path and the `npx skills add` path
  (`harness-skill-install.service.ts:17-25`) both produce content that matches by
  construction — they installed the same upstream skill. The heuristic is maximally
  confident exactly where it is least entitled to be. Rejected on the veto discriminator.

### Option C — Retroactive sidecar manifest

Write manifest entries for the 13 now, so future reconciles treat them as owned.

- Fails **D3** flatly: it manufactures the ownership record rather than discovering it. This
  is Option B with the guess laundered through a file. It also permanently destroys the
  ability to ever ask the question again, since the manifest becomes the answer.

### Option D — Consent-gated repair with quarantine

For each blocked path, offer the user an explicit repair. On consent: **move** the occupant
aside to a timestamped quarantine directory, then write the managed copy. Never overwrite
in place. The quarantined original stays until the user removes it.

- Satisfies D1 (nothing deleted), D3 (consent _is_ the claim), D4 (the move is the undo),
  D6 (matches prior art), D7 (ships after A).
- Cost: needs a consent surface and a quarantine location convention.

### Option E — Redirect the source instead

Point Ptah's source layer at the existing occupant, making the user's directory the
authority.

- Inverts the ownership model — the harness stops being a projection of `~/.ptah/user` and
  becomes bidirectional. That is a much larger architectural change than the defect
  warrants, and it breaks the one-way reconciler invariant that `harness-sync` exists to
  hold. Rejected as disproportionate.

---

## 4. Recommendation

> **A + D — report the blocked set, then repair only on explicit consent, quarantining the
> occupant rather than overwriting it.**

Sequenced: **A ships first and alone.** It is the whole of the D2 fix, changes no filesystem
behaviour, and needs no decision from anyone. D follows as a separate batch once the consent
surface is agreed.

### Why this shape

The diagnosis forces it. Because no evidence ties any of the 13 to Ptah (§1.3), consent is
the only ownership proof available (D3), which rules out B and C outright. Because the
occupant may be irreplaceable user work, the repair must move rather than overwrite (D1,
D4). And because `missing=13, writeFailed=0` is already misleading users today
(`coldstart-306.log:844`), the reporting half is worth shipping even if the repair half is
never approved.

### Prior art

This exact problem was solved one directory over:

`libs/backend/rpc-handlers/src/lib/skills-sh/skills-sh-legacy-adoption.ts:98-147`

Legacy `skills.sh` adoption reaches the same two conclusions independently: it adopts a
directory **via a third party's ownership record** rather than by inspecting content, and
when the destination is occupied it **moves rather than overwrites**. Option D is that
policy re-applied with the user standing in for the third party, because in our case no
third-party record exists. Diverging from an in-repo precedent that already survived review
would need a reason we do not have.

### What A costs

Effectively nothing structural. `blocked` is `missing ∩ foreign` over data the health
payload already carries (D5), so the change is a derivation plus a rendering plus a log
line. No RPC contract change, no migration, no filesystem writes.

---

## 5. Blast Radius

### Batch A (reporting)

| Area                          | Impact                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------- |
| `libs/backend/harness-sync`   | Reconcile logging gains the blocked-path list and reason. No plan/write changes. |
| Health payload / RPC contract | **None.** `blocked` derived from existing `missing` + `foreign`.                 |
| Frontend harness health card  | Additive: a blocked-paths disclosure. No layout rewrite.                         |
| Filesystem                    | **None.** Zero writes added or removed.                                          |
| e2e / snapshots               | Health card assertions may need the new disclosure element.                      |
| Risk                          | Low. Pure observability.                                                         |

### Batch D (consent-gated repair)

| Area                        | Impact                                                                                                                                          |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/backend/harness-sync` | New repair entry point, invoked only from an explicit request — never from activation reconcile.                                                |
| Quarantine convention       | New directory + naming scheme; must be documented and must not itself become a target the reconciler scans.                                     |
| Consent surface             | New RPC method (dual registration: `rpc.types.ts` **and** `ALLOWED_METHOD_PREFIXES` in `rpc-handler.ts:46`) plus a confirmation UI.             |
| Filesystem                  | Moves user directories. Highest-risk surface in the task. Needs its own test coverage for the move-then-write sequence and for partial failure. |
| Cross-platform              | Move semantics across drives/volumes on Windows; the quarantine must live on the same volume as the source or fall back to copy-then-delete.    |
| Risk                        | Medium-high. Gated behind consent and reversible by design, which is precisely why the quarantine is non-negotiable.                            |

### Explicitly out of scope

- Changing how `foreign` is classified.
- The commands/sidecar-manifest path (correctly designed; §1.2).
- Any change to `claude-target.ts:480-486` junction migration — already correct.
- Bidirectional source/target sync (Option E).

---

## 6. Task Breakdown

Batches are independently shippable. **Batch A carries no open decision and can start
immediately.** Batch D must not start before §7 is answered.

### Batch A — Make the shortfall legible

**A1. Derive the blocked set in the reconciler**
Compute `blocked = missing ∩ foreign` at the point where the plan is finalized.

- AC: given the cold-start conditions in `coldstart-306.log:844`, the derived set has 13
  members.
- AC: no change to `plan.writes`; `writeFailed` stays `0`.
- AC: derivation is unit-tested against a fixture with overlapping and disjoint
  `missing`/`foreign` sets, including the empty case.

**A2. Log the blocked set at reconcile time**
Emit one structured line naming each blocked path and the reason.

- AC: reason text distinguishes "occupied by a directory Ptah does not own" from any other
  cause of `missing`.
- AC: the existing one-line summary is unchanged (no log-parsing regressions).
- AC: with zero blocked paths, no line is emitted — silence stays silent when correct.

**A3. Surface blocked paths in the harness health card**
Additive disclosure listing the blocked paths.

- AC: the card explains why `missing` can be non-zero while `writeFailed` is `0`.
- AC: derived client-side from existing payload fields; **no RPC contract change** in the
  diff.
- AC: hidden entirely when the blocked set is empty.

**A4. Document the condition**
Update `libs/backend/harness-sync/CLAUDE.md` with the blocked-path condition and its cause.

- AC: records that `SkillJunctionService` never produced real skill directories, with the
  `git e107e6f89^` citation, so the false premise is not rediscovered.

### Batch D — Consent-gated repair (blocked on §7)

**D1. Quarantine convention**
Define and document the quarantine location and naming.

- AC: quarantined content is never scanned as a source or a target.
- AC: same-volume by default; documented fallback when it is not.

**D2. Repair operation: move-then-write**
Single-path repair: move occupant to quarantine, then write the managed copy.

- AC: **never** overwrites in place — asserted by a test that fails if the occupant's
  inode/content is destroyed.
- AC: if the write fails after the move, the occupant is restored (or the failure names the
  quarantine path explicitly so the user can restore by hand).
- AC: idempotent — a second call on an already-repaired path is a no-op.
- AC: mirrors the move-not-overwrite policy at
  `skills-sh-legacy-adoption.ts:98-147`.

**D3. Consent RPC + confirmation UI**
Explicit per-path (or explicit select-all) consent before any repair runs.

- AC: dual registration — `libs/shared/.../rpc.types.ts` **and** `ALLOWED_METHOD_PREFIXES`
  in `rpc-handler.ts:46`.
- AC: repair is unreachable from activation reconcile; only an explicit user action can
  invoke it.
- AC: the confirmation names the quarantine destination before the user consents.
- AC: Zod validation on the path list at the RPC boundary; paths outside the known blocked
  set are rejected.

**D4. Repair coverage**

- AC: blocked → consent → moved + written → subsequent reconcile reports `missing` reduced
  by the repaired count, `writeFailed=0`.
- AC: declined consent leaves the filesystem byte-identical.

---

## Decision Required

Batch A is unblocked and should proceed regardless of the answers below. These gate Batch D
only.

**1. Is consent-gated repair wanted at all, or is reporting sufficient?**
Given that we cannot show any of the 13 belongs to Ptah, one defensible position is that
these are simply the user's skills, the harness should leave them alone permanently, and
`blocked` should be a normal steady state rather than a defect to repair. That would ship
Batch A and close the task. Recommendation: build D, because a user who _did_ get these from
the old `npx skills add` path (`harness-skill-install.service.ts:17-25`) currently has no
route back to a managed state.

**2. Where does the quarantine live?**
Candidates: alongside the target (`.claude/skills/.ptah-quarantine/<name>-<timestamp>`),
under `~/.ptah/` (uniform, but risks a cross-volume move on Windows), or the OS recycle bin
(free undo, but opaque and not scriptable). Recommendation: alongside the target,
same-volume, with a documented ignore rule so the reconciler never scans it.

**3. Consent granularity: per-path, or one bulk approval?**
Thirteen individual prompts is hostile; one bulk approval weakens the per-path ownership
claim that is the entire justification for the operation. Recommendation: one dialog listing
all blocked paths with per-path checkboxes, defaulting to none selected.

**4. Does the user ever clean up the quarantine, or do we?**
Recommendation: never automatically. The quarantine is the undo; an expiry policy silently
converts a reversible operation into a destructive one on a timer.

---

## Evidence Index

| Claim                                                         | Citation                                                                                  |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Skills were linked, never copied; no fallback                 | `git e107e6f89^:libs/backend/agent-sdk/src/lib/helpers/skill-junction.service.ts:304-356` |
| Legacy code skipped occupied paths, suspected SDK provenance  | `git e107e6f89^:libs/backend/agent-sdk/src/lib/helpers/skill-junction.service.ts:336-343` |
| Surviving junctions are migrated, not blocked                 | `libs/backend/harness-sync/src/lib/targets/claude-target.ts:480-486`                      |
| `~/.ptah/plugins`, `~/.ptah/skills` are declared source roots | `libs/backend/harness-sync/src/lib/sources/plugin-config-source-resolver.ts:55`           |
| Pre-288 installer wrote directly into `{ws}/.claude/skills`   | `libs/backend/rpc-handlers/src/lib/harness/io/harness-skill-install.service.ts:17-25`     |
| Prior art: adopt via third-party record, move not overwrite   | `libs/backend/rpc-handlers/src/lib/skills-sh/skills-sh-legacy-adoption.ts:98-147`         |
| Live signature: `missing=13`, `writeFailed=0`                 | `D:/projects/ptah-extension/tmp/logs/coldstart-306.log:844`                               |
