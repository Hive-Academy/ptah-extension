# Batch 6 — R2-A backend: make the blocked shortfall legible

**Status**: COMPLETE — **round 2**, after team-leader MODE 2 returned APPROVED WITH FINDINGS
(3 material + 3 minor). All six addressed. Not committed.
**Branch**: `ak/boot-blocker-quota-gate`
**Scope**: Tasks 6.1, 6.2, 6.3. No consent, no quarantine, no repair — that is Batches 8–9.
**Filesystem behaviour**: unchanged. Zero writes added, zero removed. `plan.writes` untouched.

---

## Verification (actual output, `--skip-nx-cache`)

`libs/shared` is now in the affected set (F-A), so the run is wider than round 1.

| Command                                                                       | Result                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx nx run-many -t test -p shared,harness-sync`                              | **shared: 43 suites / 1101 passed. harness-sync: 34 suites / 242 passed.** 0 failed either side                                                                                                                                  |
| `npx nx run-many -t lint -p shared,harness-sync`                              | **0 errors, 1 warning** — `libs/shared/src/lib/types/rpc.types.ts:759` `File has too many lines (3112)`. Pre-existing `max-lines` soft-ceiling warning on a file this batch does not touch (`git status` confirms it unmodified) |
| `npx nx run-many -t build -p shared,harness-sync`                             | **PASS** (+ 2 dependency tasks)                                                                                                                                                                                                  |
| `npx nx run-many -t typecheck -p shared,harness-sync,rpc-handlers,cli-engine` | **PASS** — the two direct consumers of the harness health surface typecheck against the moved function                                                                                                                           |
| `npx prettier --check` on all seven touched files                             | PASS (all reported `unchanged`)                                                                                                                                                                                                  |

**Round-1 → round-2 test deltas, reconciled exactly:**

| Project        | Before Batch 6   | Round 1  | Round 2       | Why                                                                  |
| -------------- | ---------------- | -------- | ------------- | -------------------------------------------------------------------- |
| `shared`       | 42 suites / 1093 | —        | 43 / **1101** | +8: the derivation spec moved here (F-A)                             |
| `harness-sync` | 33 suites / 233  | 35 / 248 | 34 / **242**  | −8 (spec moved to `shared`), +2 new reconciler cases (F-B split, m3) |

`git diff -U0 -- 'libs/backend/harness-sync/**/*.spec.ts' 'libs/shared/**/*.spec.ts'` has
**0 removed lines**. No existing spec edited, no assertion weakened.

> Unrelated concurrent work from Batch 10 is in the same working tree
> (`memory-curator`, `memory-contracts`, `agent-sdk`, `skill-synthesis`) plus the team-leader's
> `tasks.md`. **None of it is mine.** My diff is exactly seven files:
> `libs/shared/src/lib/types/harness-sync.types.ts`,
> `libs/shared/src/lib/types/harness-sync.blocked.spec.ts` (new),
> `libs/backend/harness-sync/src/index.ts`,
> `libs/backend/harness-sync/src/lib/health/harness-health.ts`,
> `libs/backend/harness-sync/src/lib/reconciler/harness-reconciler.service.ts`,
> `libs/backend/harness-sync/src/lib/reconciler/harness-reconciler.blocked-logging.spec.ts` (new),
> `libs/backend/harness-sync/CLAUDE.md`.

---

## Review findings — how each was addressed

### F-A (material) — `blockedTargetPaths` moved to `libs/shared` ✅

Moved verbatim from `harness-sync/src/lib/health/harness-health.ts` to
`libs/shared/src/lib/types/harness-sync.types.ts`, immediately after
`summarizeHarnessHealth`/`harnessHealthLabel` and before the RPC wire shapes. Pure relocation —
the function body is unchanged character for character.

The finding is right and my O1 hedge was wrong on the facts. My own justification #3 for the
placement was "backend log and frontend disclosure cannot disagree", and that goal is
**unreachable** from a backend lib: a frontend lib cannot import `harness-sync`, so Batch 7 would
have had to write a second intersection — precisely the outcome the placement existed to prevent.
Batch 7 has not started, so the window was open.

Consequences, all applied:

- `harness-sync/src/index.ts` no longer exports it, with a comment saying why a second export path
  would be a second place to import it from.
- `harness-health.ts` keeps a short pointer comment where the function used to be, so a reader
  looking in the obvious place is redirected rather than tempted to re-add it.
- `harness-reconciler.service.ts` imports it from `@ptah-extension/shared` (the import was
  widened from `import type {...}` to a value import).
- The unit spec moved to `libs/shared/src/lib/types/harness-sync.blocked.spec.ts`, beside
  `harness-sync.types.spec.ts` which pins `summarizeHarnessHealth` for the same reason.
- `harness-sync/CLAUDE.md` updated in three places: the wire-types paragraph now names
  `blockedTargetPaths()` alongside `summarizeHarnessHealth()`; the Internal Structure bullet says
  the derivation is **not** in `health/harness-health.ts`; and the Guidelines entry "Never
  re-derive 'is the harness healthy'" now carries the same rule for the intersection —
  _"never write the intersection inline, here or in a webview."_

**Note for Batch 7**: import `blockedTargetPaths` from `@ptah-extension/shared`. Do not write
`missing.filter(p => foreign.includes(p))` in the health card.

### F-B (material) — the user action leads with MOVE ✅

Before: `Move or delete these paths, then re-run 'ptah harness doctor --fix'.`

After:

> `Move the occupant aside — the file or directory at each path, or the conflicting key in each
config file — then re-run 'ptah harness doctor --fix'. Nothing here proves Ptah wrote these, so
they may be your own work: keep what you move, and read it before you discard anything.`

The finding is correct and the contradiction was real: the same batch's CLAUDE.md says these are
of unknown provenance and may be hand-authored, D1 is _never destroys unowned user data_, and
`--fix` writes Ptah's copy into whatever the removal leaves behind. The old wording came from
follow-up R1, written under the premise this batch itself falsifies. The word **delete** no longer
appears; "discard" survives only as the thing to do _after_ reading the contents, and the sentence
leads with the reversible action.

A code comment above the string records why, so a future tidy-up does not shorten it back.

`harness-sync/CLAUDE.md` gained the matching sentence in prose, immediately before the quarantine
section: move is reversible, delete is not.

Pinned by a new discriminating spec: asserts the string starts with `Move the occupant aside`,
contains `may be your own work`, and — the load-bearing one —
`expect(action.toLowerCase()).not.toContain('delete')`.

### F-C (material) — the quarantine section is marked PLANNED ✅

Heading is now **`#### Quarantine convention — PLANNED (Batches 8–9), NOT YET IMPLEMENTED`**, and
the section opens with:

> **Nothing in this section exists in the code today.** There is no repair operation, no
> quarantine directory, and no consent surface anywhere in this lib; a blocked path is reported
> and otherwise left alone, permanently.

followed by why it is written ahead of the implementation (Batch 8 needs a settled convention, and
a reader must not go hunting for a `.ptah-quarantine` no code has created). Present-tense
"MOVES … never overwrites in place" became "When the repair is built it will MOVE …". The content
of the U2/U3/U4 table is kept as the reviewer directed; only the tense and the marker changed.

One more tense fix nearby: "which is why the repair is gated on it" → "which is why the **planned**
repair is gated on it".

### m1 (minor) — discriminating count corrected ✅

Round 1 claimed 12/15 discriminating on the strength of _"revert the function and the module does
not resolve"_. That is a compile error, not behavioural discrimination, and by that standard every
spec of every new function qualifies. The corrected accounting is below and is now derived from
two real mutation runs plus a per-case merits judgement, not from module resolution.

### m2 (minor) — the "13" spec no longer claims more than it proves ✅

Kept, retitled, and its comment rewritten to say so plainly. Title is now _"scales to the captured
cold-start COUNTS (missing=13 inside foreign=19) without dropping a member"_, and the comment
states that `coldstart-306.log:844` carries counts only, that the thirteen `legacy-i` names are
**nominal**, that nothing here reproduces the real workspace or establishes the provenance of the
real thirteen — and what it _does_ pin: at that size the derivation returns the whole overlap with
the six non-desired foreign paths excluded, i.e. the number a user sees would be 13 and not 19.

### m3 (minor) — preflight is now a decision ✅

**Decision: `logBlocked` emits on `mode: 'full'` passes ONLY.** One guard,
`if (health.mode !== 'full') return;`, at the top of the method.

The reviewer is right that I missed this: `log(health)` runs on every reconcile, and the
preflight no-drift branch falls through to it. Three surfaces could emit and only one should:

| Surface     | Frequency                                                                                                                                         | Emits?  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `full`      | activation, workspace change, content download, plugin toggle, `harness:reconcile`, `ptah harness doctor --fix` — once per boot or user-initiated | **yes** |
| `preflight` | every session start, throttled 60 s per workspace root; the drain's nightly one-shot sessions each hit it                                         | no      |
| `verify()`  | badge poll + `ptah harness doctor`; never reaches `log()` at all, and the doctor already prints these paths grouped by kind                       | no      |

The blocked set is a permanent steady state, so a session-start emission repeats an identical
multi-path WARN object indefinitely and buries the activation line it exists to accompany — the
same argument I made for `verify()`, applied to the path I missed. **Precedent, not invention**:
`maintainGitignore` in this same class already returns early on non-`full` for a sibling reason.

Nothing is lost. Every host's boot line comes from an activation `full` pass, and the manual
repair path defaults to `full`. And the gap itself is not hidden on preflight — the summary line
still warns, and the health report still carries both lists, which the new spec asserts directly
by deriving the blocked set from the returned payload.

### Accepted as implemented, unchanged

The two reason strings (occupied path vs occupied server key), the uncapped path list (O2), and
the `return` → `else` restructure in `log()`.

---

## What the code does now

`blockedTargetPaths(target)` in `@ptah-extension/shared` — `missing ∩ foreign`, order-preserving,
duplicate-collapsing, no new wire field.

`HarnessReconcilerService.logBlocked` — `full` passes only, non-empty sets only, one structured
WARN:

```
[WARN] [harness-sync] Blocked: desired paths an unowned file occupies — refused, not failed
{
  reason, mode, scope: 'all-targets', targetCount, blocked: <n>,
  note:   'Counted in `missing` because the artifact is not installed, and in `foreign` because
           Ptah will not touch a file it cannot prove it wrote. A blocked path never enters the
           write plan, so `writeFailed` can never report one.',
  action: 'Move the occupant aside — … — then re-run `ptah harness doctor --fix`. Nothing here
           proves Ptah wrote these, so they may be your own work: keep what you move, and read it
           before you discard anything.',
  paths:  [ { target, relPath, reason }, … ]
}
```

The summary line above it is byte-identical to before this batch, and the
`writeFailed > 0 || missing > 0` gate is untouched.

---

## Spec inventory — counted, not estimated

**17 cases** in **2 new files**. Counted with `grep -c "  it("`; zero `it.each`, `test(` or
`it.only`, so `it(` blocks = Jest cases exactly. Confirmed against the run deltas
(shared 1093 → 1101 = +8; harness-sync 233 → 242 = +9).

### `libs/shared/src/lib/types/harness-sync.blocked.spec.ts` — 8 cases

Judged on merits, per m1. The six marked discriminating were each checked against a
foreign-passthrough, a missing-passthrough, a foreign-ordered and a no-dedupe implementation, and
each is caught by at least one of them.

| #   | Case                                                     | Kind                                                       |
| --- | -------------------------------------------------------- | ---------------------------------------------------------- |
| 1   | intersection when missing and foreign overlap partially  | **discriminating**                                         |
| 2   | empty when disjoint                                      | **discriminating**                                         |
| 3   | empty when both lists are empty                          | degenerate — passes against almost anything                |
| 4   | empty when only foreign is populated                     | **discriminating** (catches foreign-passthrough)           |
| 5   | empty when only missing is populated                     | **discriminating** (catches missing-passthrough)           |
| 6   | every member when missing is wholly contained in foreign | **discriminating**                                         |
| 7   | preserves `missing` order, collapses duplicates          | **discriminating** (catches foreign-ordered and no-dedupe) |
| 8   | scales to the captured counts (13 inside 19)             | case 6 with bigger numbers — nominal, see m2               |

**6 discriminating, 2 not.**

### `libs/backend/harness-sync/src/lib/reconciler/harness-reconciler.blocked-logging.spec.ts` — 9 cases

Two real mutation runs, both reverted afterwards (`grep` confirms the source is clean):

- **Mutation A** — comment out `this.logBlocked(health)`: **5 failed / 4 passed.**
- **Mutation B** — remove the `if (health.mode !== 'full') return;` guard: **1 failed / 8 passed**,
  and the one failure is the preflight case, which is exactly what it is for.

| #   | Case                                                                                      | Kind                                       |
| --- | ----------------------------------------------------------------------------------------- | ------------------------------------------ |
| 1   | names every blocked path, and only the blocked ones                                       | **discriminating** (A)                     |
| 2   | per-path reason; occupied path vs occupied server key                                     | **discriminating** (A)                     |
| 3   | action leads with MOVE, warns the occupant may be the user's, never says delete           | **discriminating** (A; also the F-B guard) |
| 4   | note says a refusal is not a write failure; scope/targetCount/reason/mode labelled        | **discriminating** (A)                     |
| 5   | emits no blocked line when nothing is blocked                                             | preserved-behaviour guard                  |
| 6   | existing summary intact, gate intact, gained no `blocked`/`action` field                  | preserved-behaviour guard                  |
| 7   | adds no write and removes none; occupants byte-identical; unblocked artifacts still land  | preserved-behaviour guard                  |
| 8   | same blocked set on a second converged pass                                               | **discriminating** (A)                     |
| 9   | silent on a preflight pass, gap still in the summary and still derivable from the payload | **discriminating** (B; the m3 guard)       |

**6 discriminating, 3 preserved-behaviour guards.**

### Totals

**12 discriminating, 5 not** (3 preserved-behaviour guards + 2 weak-on-merits health cases). Round
1's corrected baseline was 10/5 over 15 cases; the two added cases (F-B's action guard, m3's
preflight guard) are both discriminating, giving 12/5 over 17.

The reconciler fixture is the captured shape in miniature: a desired skill slug occupied by a
user-written directory (blocked), an undesired foreign skill beside it (foreign but NOT blocked —
this is the case that catches a naive `foreign.length` implementation), and a desired MCP key the
user already defines (blocked, MCP flavour).

---

## What the reviewer should check

1. `blockedTargetPaths` exists in exactly one place — `libs/shared/.../harness-sync.types.ts` — and
   `grep -rn "blockedTargetPaths" libs apps` finds no second implementation and no re-export.
2. The relocation is byte-identical logic; only the docblock changed (it now explains the `shared`
   placement).
3. The summary payload in `log()` is still unchanged field-for-field, and the
   `writeFailed > 0 || missing > 0` gate still decides warn vs debug.
4. The word "delete" does not appear in the action string, and the spec asserting that is present.
5. The CLAUDE.md quarantine section reads as PLANNED throughout — no remaining present-tense claim
   that a repair or a quarantine exists.
6. `harness-sync` gained no dependency. `@ptah-extension/shared` was already a dependency; the
   import was widened from type-only to a value import of one pure function.

---

## Observations recorded, NOT actioned

**O1 — CLOSED.** Superseded by F-A; the derivation is in `shared`.

**O2 — the blocked list is uncapped.** `ptah harness doctor` caps its path groups at 20 with
`+N more`; this line prints every path because the AC says "naming each blocked path". At 13 that
is right; at 500 it is a very long log line. Accepted by the reviewer; recorded so the choice
stays visible.

**O3 — `libs/backend/harness-sync/src/lib/targets/workspace-target.ts` contains two literal NUL
bytes** (offsets 33696 / 33733, inside `transformer.relPathFor('\0')` written as a raw `\0` rather
than the `'\0'` escape). Pre-existing, already recorded under Batch 5, unactioned again here. It
makes `rg`/Grep classify the file as binary and skip it, so verifying the `blocked ⊆ foreign`
invariant in that target needed `grep -a` through Bash. Two characters to fix, and it costs a tool
detour in every investigation that touches this lib.
