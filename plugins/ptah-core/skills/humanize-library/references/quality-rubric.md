# Quality Rubric

Score each flagged file against these dimensions. Use it to decide what to fix and to justify each
batch in the plan. Nothing here is framework-specific — dimension 9 is where this repo's own rules
enter, via the contract card from
[discover-the-repo.md](discover-the-repo.md).

## Table of contents
- [0. Calibrate first](#0-calibrate-first)
- [1. Cohesion (not size)](#1-cohesion-not-size)
- [2. Single Responsibility](#2-single-responsibility)
- [3. Function shape](#3-function-shape)
- [4. Naming](#4-naming)
- [5. Duplication](#5-duplication)
- [6. Abstraction & dependency direction](#6-abstraction--dependency-direction)
- [7. Dead code & noise](#7-dead-code--noise)
- [8. Test safety net](#8-test-safety-net)
- [9. Contract adherence](#9-contract-adherence)
- [Severity ordering](#severity-ordering)

---

## 0. Calibrate first

Before scoring anything, classify the file. Line count is a *search* signal, not a *scoring*
signal, and treating it as one is the single most common way this skill produces a bad plan.

- **`generated`** — codegen output, schema clients, protobuf stubs, anything with a `@generated`
  banner. **Excluded entirely.** Refactoring it is undone on the next build; fix the generator.
- **`types`** — interfaces, enums, DTOs, barrels. Down-weight heavily. A 3000-line type file is
  boring, not broken. It only becomes a finding when consumers must import implementation to reach
  a type.
- **`registry`** — a flat table expressed as code: route lists, command trees, tool schemas, a
  long `switch` whose arms never interact. Down-weight. One symbol per concept, low nesting, and
  fully navigable. It becomes a finding only when (a) arms start sharing mutable state, or (b) the
  same table is *duplicated* elsewhere and drifting.
- **`logic`** — branching, state, nesting, methods calling each other. **This is where "god file"
  means something.** Full weight.

A 900-line `logic` file with four unrelated concerns and no test is far more broken than a
2800-line `registry`. Score accordingly, and say which is which in the audit.

---

## 1. Cohesion (not size)

- The question is never "how long?" It is **"how many jobs?"** A file that does one job and is
  named for that job is correct at any length its job requires.
- Practical trigger for a closer look: past ~600–700 code lines *of `logic` shape*. That is a
  threshold for reading the file, not for splitting it.
- A good split produces files you can each name in a few words. If you cannot name the extracted
  file, the seam is wrong — stop and find a different one.
- Symptom worth more than any line count: **regions of the file that never reference each other.**
  Those regions are the seams.

## 2. Single Responsibility

- One reason to change per file/class/module. A service that does CRUD **and** webhook dispatch
  **and** CSV import **and** routing has four reasons to change → four collaborators.
- Symptoms: a vague name (`XService` doing everything); a long constructor/dependency list;
  disjoint method clusters; private helpers used by only one cluster; a mix of high-level policy
  and low-level I/O in one type.
- Fix: extract focused collaborators; the original becomes a thin facade that delegates and keeps
  its public signatures identical.

## 3. Function shape

- One level of abstraction per function. Do not mix orchestration with low-level munging in one body.
- Functions past ~60 lines, or nesting depth > 3, are candidates — flatten with guard clauses and
  early returns, then extract named steps.
- A function should be holdable in your head: clear inputs, one job, predictable output.

## 4. Naming

- Names state intent, not mechanism or type. `eligibleAgents` over `arr2`; `assignLeadToAgent`
  over `process`. No `tmp`, `data`, `handleStuff`, `doIt`, numeric suffixes.
- Booleans read as predicates: `isAssigned`, `hasOpenOpportunity`.
- Consistency with the surrounding code beats personal preference. Match the neighbours.

## 5. Duplication

Rank duplication by **whether it has already diverged**, not by how much of it there is:

| Kind | Severity | Why |
| --- | --- | --- |
| Two copies that now behave **differently** | **Critical** | A defect already shipped. Two surfaces of one product disagree. |
| A table/list encoded twice with drifting membership | **High** | Silent divergence; the next edit hits one copy. |
| N identical copies of the same block | Medium | Debt, not a defect. Mechanically collapsible. |
| Superficially similar code, different reasons to change | **Not a finding** | Do not merge it. |

- Confirm true duplication (same reason to change) before extracting. Three similar lines are
  cheaper than a wrong abstraction. Extract on the third real repetition.
- Reconciling a *diverged* pair changes behavior. Extract first, preserving both paths exactly
  behind explicit options; reconcile in a separate, sign-off-gated batch. Never in one step.

## 6. Abstraction & dependency direction

- Dependencies point one way, and that way is defined by this repo — see
  [discover-the-repo.md](discover-the-repo.md) Part C. A move that trips the boundary linter means
  the destination is wrong.
- Depend on abstractions where it removes real duplication or exposes a real seam — not
  speculatively. An interface with one implementation and no test double is usually noise.
- Watch for the inverted case: a module that declares an abstraction and then bypasses it (direct
  I/O, direct global access, direct concrete construction) beside the port it is supposed to use.

## 7. Dead code & noise

- Delete unused exports, commented-out blocks, `_unused` renames, tombstone comments
  ("removed X", empty modules left behind for compatibility), and back-compat shims nobody imports.
  Version control is the history.
- Watch for the compound case: dead tests exercising dead modules. Delete both.
- Comments explain *why* — non-obvious intent, gotchas, links to decisions. Delete comments that
  restate the code.

## 8. Test safety net

**This dimension decides whether the plan is safe, and it is the one most often skipped.**

- Score **per file you intend to move**, never per project. Aggregate coverage ratios are actively
  misleading: in most codebases the largest, most-feared file is the *least* tested one.
- For each planned batch ask: if this extraction silently changed behavior, what goes red? Name the
  test. If the answer is "nothing", the batch is not safe as written.
- No net → a characterization test is its own batch, landed and green **before** the extraction.
  Write it against current observable behavior, including behavior you suspect is wrong.
- Mocked-out is not covered. A caller's test that stubs the target proves nothing about the target.
- Note structural tripwires (contract tests, wiring/DI smoke tests, public-API snapshots) — they
  are your cheapest early warning on any registration change.

## 9. Contract adherence

Refactoring must move toward this repo's rules, never away. Score against the **contract card** you
built in step 2, not against remembered conventions from another project.

- **Enforced rules** (lint/CI/boundary/structural tests) — violations are findings. Fix them when
  you are already in the file for a structural reason.
- **Written-but-unenforced rules** — a violation is a finding, but note whether the codebase honours
  the rule broadly or ignores it wholesale. A rule violated in dozens of files is dead: report the
  discrepancy and let the user choose between enforcing it and deleting it. Do not unilaterally
  enforce it across files you had no other reason to open.
- **Observed convention only** — match the neighbours; do not "correct" the codebase to your taste.
- A rule the target folder's *own* documentation states and its *own* code breaks is the strongest
  finding available. Lead with it.

---

## Severity ordering

Order batches by leverage, highest first:

1. **Gate repair** — if typecheck/lint/test do not cover the target, nothing below is verifiable.
2. **Characterization tests** for untested code you intend to move.
3. **Diverged duplication** — a shipped defect, and it only gets harder to see.
4. **`logic` god files** — split by responsibility. Unlocks everything else.
5. **Cross-module duplication** — hoist to the destination Part C allows.
6. **Long / deeply-nested functions.**
7. **Naming and dead code.**
8. **Contract nits** — usually fixed for free while touching a file for reasons 3–7.

Behavior-changing steps sit outside this order entirely: own batch, sequenced last, user sign-off.
