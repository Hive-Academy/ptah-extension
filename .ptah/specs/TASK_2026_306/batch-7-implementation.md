# Batch 7 — R2-A frontend: blocked-paths disclosure on the harness health card

**Status**: COMPLETE. Not committed.
**Branch**: `ak/boot-blocker-quota-gate`
**Scope**: Task 7.1 only. Disclosure — no consent, no quarantine, no repair action (Batches 8–9).
**Wire contract**: unchanged. `libs/shared` is untouched; `git status --porcelain libs/shared` is empty.

---

## Verification (actual output, `--skip-nx-cache`)

| Command                                              | Result                                                                                                                                                                                   |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx nx run-many -t test -p marketplace,shared`      | **marketplace: 9 suites / 134 passed. shared: 43 suites / 1101 passed.** 0 failed either side                                                                                            |
| `npx nx run-many -t lint -p marketplace,shared`      | **0 errors, 2 warnings** — both `max-lines` on `external-marketplaces.component.ts` (753) and `smithery-surface.component.ts` (940). Pre-existing; `git status` confirms both unmodified |
| `npx nx run-many -t typecheck -p marketplace,shared` | **PASS** (`ngc --noEmit` against `tsconfig.lib.json`)                                                                                                                                    |
| `npx nx build ptah-extension-webview`                | **PASS** — bundle generated, + 3 dependency tasks (`markdown`, `shared`, `ui`)                                                                                                           |
| `npx prettier --check` on all five touched files     | PASS                                                                                                                                                                                     |

**`marketplace` has no `build` target** — it is a non-buildable Angular lib compiled into the
consuming app. `nx run-many -t build -p marketplace` is a no-op, so the build gate is the app that
consumes it: `ptah-extension-webview`, which is the shell for both the VS Code and Electron hosts.
`typecheck` is reported alongside it because that is the target which actually runs the Angular
compiler over this lib in isolation.

**Test delta**: marketplace 123 → **134** (+11), exactly the new spec file's case count. `shared`
1101 is unchanged from Batch 6's post-move figure, which is the check that I did not touch it.

`git diff -U0 -- '*.spec.ts'` has **0 removed lines**. No existing spec edited, no assertion
weakened. `harness-health-badge.component.spec.ts` is byte-identical and its 20 cases still pass
against the modified card.

My diff is exactly five files:

- `libs/frontend/marketplace/src/lib/harness/harness-blocked-paths.component.ts` (new)
- `libs/frontend/marketplace/src/lib/harness/harness-blocked-paths.spec.ts` (new)
- `libs/frontend/marketplace/src/lib/harness/harness-health.model.ts`
- `libs/frontend/marketplace/src/lib/harness/harness-health-badge.component.ts`
- `libs/frontend/marketplace/src/index.ts`

---

## The one thing that mattered: importing the derivation, not rewriting it

`harness-health.model.ts` imports `blockedTargetPaths` from `@ptah-extension/shared` and calls it.
There is no second intersection anywhere in this diff:

```
$ grep -rn "blockedTargetPaths" libs apps --include=*.ts   (files, deduped)
libs/shared/src/lib/types/harness-sync.types.ts              definition (:338), Batch 6
libs/shared/src/lib/types/harness-sync.blocked.spec.ts       Batch 6's unit spec
libs/backend/harness-sync/.../harness-reconciler.service.ts  Batch 6's WARN — the one backend call
libs/backend/harness-sync/.../harness-reconciler.blocked-logging.spec.ts   Batch 6's spec
libs/backend/harness-sync/src/index.ts                       COMMENT only — why it is not re-exported
libs/backend/harness-sync/src/lib/health/harness-health.ts   COMMENT only — pointer to where it moved
libs/frontend/marketplace/.../harness-health.model.ts        this batch — the one frontend call
```

Two of those seven are Batch 6's deliberate breadcrumbs, not code: `harness-sync/src/index.ts`
records why there is no re-export, and `health/harness-health.ts` redirects a reader looking where
the function used to live. Three call sites in total, one definition.

No `missing.filter(...)`, no `foreign.includes(...)`, no `new Set(missing)` in the frontend. The
backend WARN and this card are the same function over the same payload, so the count in the log and
the count on the card cannot disagree.

`libs/frontend/marketplace/src/lib/harness/harness-health.model.ts` gains exactly one new function,
`harnessBlockedPaths(health)`, which is **flattening only** — group by target, attach the display
label, total the count. Its docblock says so, and says why (that file opens with "DELIBERATELY NOT A
SECOND REDUCER", and this addition had to stay on the right side of that line).

### One judgement call inside the flattening: undetected targets are excluded

`harnessBlockedPaths` skips `detected: false` targets. This is not in the task text, so it is called
out explicitly.

`summarizeHarnessHealth` (`harness-sync.types.ts:245`) drops undetected targets from every count,
because an uninstalled Codex is not a gap (E17) — that is why the badge above this disclosure reads
"Harness in sync" for a workspace with a phantom Cursor. Including undetected targets here would let
the disclosure print "1 blocked path" directly underneath a badge claiming the harness is whole.
The disclosure exists to explain the badge's number; the one arithmetic a user is guaranteed to
check is that the two agree. Pinned by a discriminating spec (case 4, mutation C below).

---

## What the card renders

Additive block inside the existing popover, between the target rows and the collisions note, behind
`@if (blocked().count > 0)`. **No layout rewrite** — nothing above or below it moved, and the badge
trigger, the summary label, the target rows, the refresh and the Reconcile button are untouched.

Placed **above** the collisions note deliberately: a collision does not raise the badge at all
(`summarizeHarnessHealth` excludes it on purpose), whereas a block is a direct cause of the amber
the user just clicked.

```
┌─ Blocked harness paths ────────────────────────────────┐   (section, aria-label)
│ 13 blocked paths                                        │   h4
│                                                         │
│ Something Ptah does not own already sits there. Each    │   the deliverable
│ one counts as missing because the artifact is not       │
│ installed, and Ptah left it alone because it cannot     │
│ prove it wrote what is already there. A path it         │
│ refuses is never attempted, so a block never shows up   │
│ as a write failure — that is how the harness reads      │
│ short with nothing having failed.                       │
│                                                         │
│ Claude Code                                             │   one group per target
│   .claude/skills/legacy-0                               │   <code>, interpolated
│   …                                                     │
│                                                         │
│ Move the occupant aside — the file or directory at each │   the action
│ path, or the conflicting key in each config file — then │
│ run Reconcile now. Nothing here proves Ptah wrote       │
│ these, so they may be your own work: keep what you      │
│ move, and read it before you discard anything.          │
└─────────────────────────────────────────────────────────┘
```

### The prose, and why it is what it is

**The explanation is the deliverable, not the list.** The AC names that sentence specifically, so it
is asserted on its own (case 5), separately from the paths.

**The action string is Batch 6's, adapted at exactly one point.** Batch 6's backend WARN says
"…then re-run `ptah harness doctor --fix`"; the card says "…then run Reconcile now", because that
button is eight pixels below the sentence and a full reconcile is what writes the path once the
occupant is gone. Everything else — "Move the occupant aside", the "file or directory … or the
conflicting key in each config file" gloss, "Nothing here proves Ptah wrote these, so they may be
your own work: keep what you move, and read it before you discard anything" — is carried over
verbatim. A user comparing the log line against the card must not find two different instructions.

**The word "delete" does not appear anywhere the user can read it**, and a spec asserts that over
the whole rendered section's text, not just the action paragraph. "Discard" survives only as the
thing to do _after_ reading the contents. Provenance is unknown, nothing here is asserted to be
Ptah's, and move is the reversible half.

Precise, because `grep -ic delete` on the component file returns **2**: both hits are in the
class docblock, which states the rule ("It leads with MOVE and never says delete" / "Move is
reversible; delete is not") so a future tidy-up does not shorten the string back. Nothing in the
`template` contains it. The spec asserts on `textContent`, which is the property that matters.

**No repair, consent or quarantine control.** A spec asserts the section contains zero `<button>`
and zero `<input>`. Offering a one-click fix for a file we cannot prove is ours is exactly the claim
the missing ownership proof forbids, and it is Batches 8–9's to make behind consent.

### Standards

`ChangeDetectionStrategy.OnPush` on the new component and unchanged on the badge; signals
(`input.required`, `computed`) and `inject()` throughout; standalone. Paths go through ordinary
interpolation inside `<code>` — **no `[innerHTML]` on any path**. Tailwind classes are whole
literal strings so the scanner sees them. The section carries `aria-label="Blocked harness paths"`
and an `<h4>` under the popover's existing `<h3>`.

The heading string (`13 blocked paths`) is built in a `computed` rather than as two template
interpolations either side of a line break. That is the one number a reader checks against the badge
above it, and it should not be at the mercy of where prettier chooses to wrap — which turned out to
be a live concern: prettier reflowed the explanation paragraph after I first wrote it.

**Component split.** `HarnessBlockedPathsComponent` is its own file rather than inlined into the
badge, matching `HarnessTargetRowComponent` one directory over — a self-contained presentational
block, one input, no state, no output (Complexity Level 1). The badge grew by 23 lines instead of
~70, and stands at 291. Nothing here is near the 700-line ceiling.

---

## Spec inventory — counted, not estimated

**11 cases** in **1 new file**. Counted with `grep -c "^\s*it("` on
`harness-blocked-paths.spec.ts`; `grep -c "it\.each\|test(\|it\.only"` returns **0**, so `it(`
blocks equal Jest cases exactly. Confirmed against the run delta (marketplace 123 → 134 = +11).

They mount the **real badge** with the **real store** against a mocked `ClaudeRpcService` — the same
shape as the existing `harness-health-badge.component.spec.ts`, deliberately. A helper-level test
would pass on a card that renders thirteen paths and no explanation, which is the failure mode the
AC is written against.

### Mutation runs — four, all reverted afterwards (final suite is green at 134/134)

| Mutation | Change                                                        | Result                   |
| -------- | ------------------------------------------------------------- | ------------------------ |
| **A**    | `@if (blocked().count > 0)` → `@if (false)` (disclosure gone) | **7 failed / 4 passed**  |
| **B**    | `blockedTargetPaths(target)` → `[...target.foreign]`          | **4 failed / 7 passed**  |
| **C**    | remove the `if (!target.detected) continue;`                  | **1 failed / 10 passed** |
| **D**    | action string → `Delete these paths, then run Reconcile now.` | **1 failed / 10 passed** |

B, C and D each failed exactly the case written for that property, and nothing else — which is what
makes them useful as regression pins rather than as a blanket "the feature exists" check. Note that
mutation B is the interesting one: it is the shape this batch's brief exists to prevent, and it is
caught behaviourally (wrong paths rendered, wrong count) rather than by a compile error.

| #   | Case                                                                      | Kind                                                                |
| --- | ------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 1   | names the desired paths an unowned file occupies, and only those          | **discriminating** (A, B)                                           |
| 2   | preserves the order the target planned its desired entries in             | **discriminating** (A, B)                                           |
| 3   | groups by target under its display name                                   | **discriminating** (A)                                              |
| 4   | ignores an uninstalled target, never claims a bigger shortfall than badge | **discriminating** (C) — passes A, since nothing renders either way |
| 5   | explains that a refusal is counted as missing, never a write failure      | **discriminating** (A) — the AC sentence                            |
| 6   | leads with move, may-be-your-own-work, never says delete                  | **discriminating** (A, D)                                           |
| 7   | discloses only — no repair, consent or quarantine control                 | **discriminating** (A)                                              |
| 8   | renders nothing at all on a healthy report                                | preserved-behaviour guard — passes A/B/C/D                          |
| 9   | renders nothing when the gaps and the foreign files are disjoint          | **discriminating** (B) — passes A                                   |
| 10  | reads 13 blocked out of 19 foreign, with nothing failed                   | **discriminating** (A, B)                                           |
| 11  | leaves the existing summary and per-target counts untouched               | preserved-behaviour guard — passes A/B/C/D                          |

**9 discriminating, 2 preserved-behaviour guards.**

Cases 8 and 11 pass under every mutation by construction and are named as guards rather than
counted as discrimination. Case 8 pins "hidden when empty" (the AC), case 11 pins that the badge
label, the tone class and the per-target missing count are unchanged by an additive disclosure —
both are properties this batch promised to PRESERVE, so passing both ways is correct rather than
padding. Case 9 is the one that looks like a duplicate of 8 and is not: both lists non-empty but
disjoint is precisely what a `missing.length && foreign.length` shortcut gets wrong, and it is the
only negative case mutation B catches.

**On the captured shape (case 10)**: the fixture is `expected: 27, found: 14, missing: 13,
foreign: 19, writeFailed: 0` — `coldstart-306.log:844`'s counts. The thirteen `legacy-i` names are
**nominal**; nothing here reproduces the real workspace or establishes provenance. What it pins is
that at that size the card shows **13**, not 19, and names none of the six foreign-but-not-desired
paths. Same honesty caveat Batch 6 applied to its own m2 case.

---

## What the reviewer should check

1. `grep -rn "blockedTargetPaths" libs apps` finds the shared definition, Batch 6's two consumers,
   and `harness-health.model.ts` — and **no** hand-rolled intersection anywhere in `libs/frontend`.
2. `git status --porcelain libs/shared` is empty. No wire field added, `rpc.types.ts` untouched,
   `HarnessTargetHealth` unchanged. The AC's escape hatch ("if it appears to need a new wire field,
   stop and report") was never reached — `missing` and `foreign` were both already on the payload.
3. The word "delete" does not appear in the component's `template` (its two occurrences are in the
   docblock recording the rule), and case 6 asserts that over the whole rendered section.
4. The disclosure contains no button, no input, and no RPC call. Nothing in this diff can write to
   the filesystem.
5. `harness-health-badge.component.spec.ts` is unmodified and its cases still pass — the addition is
   additive in fact, not just in intent.
6. The undetected-target exclusion (the one judgement not in the task text) is the right call, or
   say so — it is one `continue` and one spec to change if not.
7. `harnessBlockedPaths` does presentation only. If a future reviewer sees set logic creeping into
   it, that is the drift the F-A relocation existed to prevent.

---

## Observations recorded, NOT actioned

**O1 — the list is uncapped, matching Batch 6's O2.** Every blocked path renders. The popover is
`max-h-[26rem] overflow-y-auto`, so at 13 it scrolls rather than overflows, and at 500 it would be
a long scroll. Deliberate: the AC is "listing the blocked paths", and `ptah harness doctor`'s
`+N more` cap has no equivalent here because there is no second place for the user to go and read
the rest. Recorded so the choice stays visible.

**O2 — no e2e assertions existed to update.** The task's validation note warned health-card
assertions in the e2e suite might need the new element. Checked: `grep` for
`harness-health-badge|harness-collisions|harness-target-|harness-empty|harness-sources-note`
across the repo outside `libs/frontend/marketplace` hits only two backend spec files with
unrelated identifiers, and `apps/ptah-electron-e2e/src/specs/marketplace/marketplace.spec.ts`
contains no `harness` reference at all. So a green e2e run genuinely means nothing moved — but the
converse is also true: **the card has no e2e coverage**, and this disclosure adds none.

**O3 — the disclosure is only reachable on the Plugins page.** `HarnessHealthBadgeComponent` mounts
there and nowhere else, so a user who never opens Marketplace → Plugins still has no surface for
`missing=13`. That is pre-existing (it is where the badge has always lived) and out of scope, but
the R2-A goal is "make the shortfall legible" and this makes it legible in one place, one click
deep. Worth a follow-up decision, not a change here.
