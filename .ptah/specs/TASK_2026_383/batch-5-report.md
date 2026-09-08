# Batch 5 — Triage classification across six uncontested libs

## Revision 1 — review response (2026-09-07)

Answering `code-style-review.md` (NEEDS_REVISION, 6/10 — 1 serious, 3 minor) and
`code-logic-review.md` (APPROVED, 8/10 — 2 moderate, 1 failure mode filed
forward). Same worktree, same six libs, still comment-only, still uncommitted.
`nx reset` not run (Batch 6 is concurrently revising `persistence-sqlite`).

### Serious (style) — marker comments now wrap at 80 columns

**Fixed.** All 142 markers are re-wrapped; the longest added line is now exactly
**80** characters, down from **301**. Before: 109/142 markers (77%) ran 150–301
chars on one physical line, concentrated in four libs. After: **0** added lines
exceed 80.

Done mechanically, as instructed, by a throwaway script (written, run, then
deleted — it is not part of the diff). Two safeguards mattered:

1. **The naive version was wrong and the dry run caught it.** Collecting "the
   marker line plus every following `//` line" absorbed **7 pre-existing
   comments** into marker reasons — e.g. `codex-project-trust.ts`, where an
   unrelated "Unreadable reads as untrusted…" note sat directly beneath the
   marker, and `http-mcp-server.service.ts`, where a five-line pre-existing
   explanation would have been swallowed. Fix: the script derives each file's
   **added-line set from `git diff -U0`** and refuses to extend a block onto any
   line this batch did not add. Pre-existing comments are context and are left
   untouched.
2. **Reason text proved unaltered.** The concatenated, whitespace-normalised
   text of every added comment line was captured before and after the rewrap and
   compared: **identical**, byte for byte (26,551 chars). Wrapping changed only
   whitespace and newlines.

**One marker needed a hand edit, and it is worth naming.** Wrapping
`analysis-namespace.builders.ts:393` pushed the reason entirely onto the second
line, leaving `// degradation-audit: optional-capability -` alone on the marker
line. The tool validates the _first_ line's body, so this became a
`bare-suppression` violation and the site went unsuppressed — `vscode-lm-tools`
jumped 2 → 4 and TOTAL 422 → 424. This is a real constraint the tool's header
does not spell out: **a wrapped marker must still carry at least one word of
reason on its own line.** I reworded that one marker minimally (moving
`dependencyGraph.getSymbolIndex` from the first line into a parenthetical on the
second, preserving the symbol name and the meaning) so it satisfies both the
80-column rule and the same-line-reason rule. That is the only reason text this
revision changed, and it was forced. A guard is now in the verification below so
the class cannot recur silently.

### Style minors

- **m-1 — `chrome-launcher-browser-capabilities.ts:584,:627` (242 and 258
  chars).** Fixed by the rewrap; both are now ≤ 80 and read as annotations
  rather than paragraphs.
- **m-2 — byte-identical reasons in `user-layer-fs-ops.ts:120` and `:144`.**
  Fixed by making each name its own enclosing method and cross-referencing the
  other, which is what the reviewer asked for ("a shared constant or an `@see`
  cross-reference would say that more directly"). `copyFileAtomic`'s marker now
  names itself and points forward to `writeTextAtomic`; `writeTextAtomic`'s
  names itself and points back. The duplication was faithful, but it no longer
  _reads_ as copy-paste.
- **m-3 — `check-degradation.ts`'s header still models single-line examples.**
  **Not fixed, deliberately.** That file is `tools/degradation-audit/`, outside
  this batch's six libs and owned by Batch 3 / the tool owner; editing it here
  would breach the ownership boundary this batch was scoped by. Filed forward
  with a concrete suggestion: the header should show a wrapped example _and_
  state the constraint this revision discovered the hard way — the reason must
  begin on the marker's own line.

### Logic moderates

- **M-1 — "63 files" vs the actual 79.** Fixed. The prose headline now reads
  **79**, matching the report's own per-lib table (12+22+11+8+18+8 = 79) and
  `git diff --name-only | wc -l` = 79, both re-confirmed after this revision.
- **M-2 — flaky-task framing overstated.** Fixed in place, as an explicit
  correction block beside the original claim rather than a silent rewrite (see
  "One honest note on the test run" below). The distinction the reviewer drew is
  preserved: _assertions pass in isolation_ is confirmed; _concurrency fully
  explains it_ is not shown, and the teardown-leak warning is at least as
  plausible.

### Tool gap — left filed, not fixed

`resolveSuppression` runs before the violation predicate, so a marker on a
non-violating `catch` is silently consumed rather than reported as orphaned.
This is the gap my Task 5.7 `skill-scorecard` fix bumped into. Per instruction it
is **not** touched here and remains a Batch 12 / tool-owner item.

### Revision 1 verification

```
$ npx nx run degradation-audit:lint --skip-nx-cache

  libs/backend/agent-generation: 1 ok (baseline 31)
  libs/backend/cli-agent-runtime: 2 ok (baseline 30)
  libs/backend/harness-sync: 6 ok (baseline 29)
  libs/backend/skill-synthesis: 6 ok (baseline 40)
  libs/backend/vscode-lm-tools: 2 ok (baseline 16)
  libs/backend/workspace-intelligence: 1 ok (baseline 14)

degradation-audit: TOTAL 422 unsuppressed site(s)

 NX   Successfully ran target lint for project degradation-audit
```

TOTAL **422** as required, all six per-directory counts **unchanged** from
Revision 0, zero `bare-suppression`, zero `orphaned-suppression`.

Diff-shape guards, all re-run after the rewrap:

| Guard                                         | Result       |
| --------------------------------------------- | ------------ |
| Markers still present                         | 142          |
| Max added line length                         | 80 (was 301) |
| Added lines over 80 chars                     | 0 (was 109)  |
| Non-comment added lines                       | 0            |
| Marker lines with no reason on their own line | 0            |
| Spec files in the diff                        | 0            |
| Files changed                                 | 79           |
| `baseline.json`                               | untouched    |

**Tests — both results recorded, as instructed.**

Run A (`--skip-nx-cache`, immediately after the rewrap) — **green in one pass**:

```
 NX   Successfully ran target test for 6 projects
Tests: 373 / 957 / 634 (+1 skipped) / 1008 / 1401 (+37 skipped) / 1011  — 5384 passed
```

Run B (a later cached re-run, same tree) — **failed differently**:

```
 NX   Running target test for 6 projects failed
Failed tasks:  @ptah-extension/agent-generation:test
               @ptah-extension/skill-synthesis:test
```

Run B's failures were **not** Revision 0's ts-transform crash — a third distinct
mode:

- `skill-trigger.boot-defer.spec.ts:215` — `expect(enqueueAnalyze)
.toHaveBeenCalledTimes(1)` got 0 after an `advanceUntil(2_000, …)` **real-time**
  poll; the suite took 11.5 s under contention.
- `user-layer-rebase-origins.spec.ts:106` and `user-layer-reap.spec.ts` —
  `Exceeded timeout of 5000 ms`, with the reap suite taking **85 s**.

Both are wall-clock budgets missed under load, not assertion logic. Re-run in
isolation, both projects pass fully:

```
$ npx nx run @ptah-extension/skill-synthesis:test --skip-nx-cache
Tests: 1401 passed, 37 skipped, 1438 total     NX  Successfully ran target test

$ npx nx run @ptah-extension/agent-generation:test --skip-nx-cache
Tests: 957 passed, 957 total                   NX  Successfully ran target test
```

**This batch cannot be the cause, and that is checkable rather than asserted**:
the diff contains **zero** `.spec.ts` files and zero non-comment lines, so no
test's behaviour can depend on it. The instability is a real property of this
suite under parallel load — now seen in three different shapes across runs
(transform crash, timer race, 5 s timeout) — and it predates Batch 5. It is
worth a task of its own; it is not a Batch 5 defect.

### Unchanged from Revision 0

The classification itself is untouched: **141 legitimate / 1 test-only / 18
defect** of 160 sites, defect rate **11.25%**, the A-3 / R-6 15% gate still not
tripped. The 18-defect list below is unmodified. `baseline.json` remains
deliberately un-updated (no `--dir` scoping; Batch 6 owns `persistence-sqlite`)
— the six re-baseline values are in the "Baseline" section and remain correct.

---

**Task**: TASK_2026_383, Batch 5 (Tasks 5.1–5.7)
**Worktree**: `D:/projects/ptah-extension/.claude-worktrees/task-383`, branch
`task/383-degradation-audit`, base HEAD `56d70891`
**Executor**: `backend-developer` (Tier-2 lead) reconciling six CLI lanes
**Nothing committed.** Working tree left dirty for the team-leader.

---

## Headline

**160 classified sites → 141 legitimate / 1 test-only / 18 defect.**
Defect rate **11.25%** (18/160). **The A-3 / R-6 15% gate did NOT trip.**
Batch 12 may proceed on the remaining libs.

The six directories drop from **160 → 18** unsuppressed sites; the repo-wide
total drops **564 → 422**.

---

## Per-lib results

| Lib                                   | Rows    | Legitimate | Defect | Test-only | Audit count (old → new) | Lane       | CLI        |
| ------------------------------------- | ------- | ---------- | ------ | --------- | ----------------------- | ---------- | ---------- |
| `libs/backend/harness-sync`           | 29      | 23         | 6      | 0         | 29 → 6                  | `356f8aab` | codex      |
| `libs/backend/cli-agent-runtime`      | 30      | 28         | 2      | 0         | 30 → 2                  | `1f7dc48c` | claude cli |
| `libs/backend/agent-generation`       | 31      | 30         | 1      | 0         | 31 → 1                  | `d635ef2c` | claude cli |
| `libs/backend/workspace-intelligence` | 14      | 13         | 1      | 0         | 14 → 1                  | `f8fbb98b` | claude cli |
| `libs/backend/skill-synthesis`        | 40      | 33         | 6      | 1         | 40 → 6                  | `30ae7154` | codex      |
| `libs/backend/vscode-lm-tools`        | 16      | 14         | 2      | 0         | 16 → 2                  | `60cc8415` | claude cli |
| **Total**                             | **160** | **141**    | **18** | **1**     | **160 → 18**            |            |            |

The row counts came from the tool, not from `batches.md`'s estimates — the real
inventory is 160 sites, not the ~87 the batch text projected.

---

## The defect list (18) — input to later fix tasks

Every site below was **left byte-for-byte untouched**. No suppression, no fix.

### `harness-sync` (6) — the destructive-empty-state cluster

1. `libs/backend/harness-sync/src/lib/manifest/harness-manifest.builder.ts:390` —
   an unreadable skills source root becomes an authoritative **empty desired
   state**, so reconciliation can reap previously managed skills.
2. `libs/backend/harness-sync/src/lib/manifest/harness-manifest.builder.ts:530` —
   same shape for the commands/agents roots: unreadable source ⇒ empty desired
   state ⇒ managed artifacts reaped.
3. `libs/backend/harness-sync/src/lib/sources/plugin-config-source-resolver.ts:189` —
   an MCP intent-store failure returns `[]`, which reconciliation reads as "the
   user configured no servers" and removes servers they still have.
4. `libs/backend/harness-sync/src/lib/targets/mcp/codex-toml-mcp-facet.ts:183` —
   an unreadable Codex TOML config becomes `''`; the next mutation writes that
   empty content over unrelated user configuration.
5. `libs/backend/harness-sync/src/lib/targets/mcp/json-mcp-facet.ts:172` —
   an unreadable or malformed JSON config becomes `{}`; a subsequent write can
   erase unrelated user entries.
6. `libs/backend/harness-sync/src/lib/targets/workspace-target.ts:413` —
   an agent source-read/transform failure returns `null`, omitting that agent
   from desired state and letting the reaper delete its managed copy.

### `cli-agent-runtime` (2) — corruption reported as absence

7. `libs/backend/cli-agent-runtime/src/lib/mcp-directory/oauth/mcp-oauth-token-store.ts:61` —
   a corrupted stored OAuth token returns `null`, identical to "never
   connected", hiding credential loss behind a silent re-auth prompt.
8. `libs/backend/cli-agent-runtime/src/lib/mcp-directory/smithery-installed-manifest.ts:181` —
   a corrupted per-server config returns `{}` with no log, so the MCP server
   silently runs unconfigured.

### `agent-generation` (1)

9. `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.ts:1600`
   (was `:1575`) — `seedLegacyAgents` swallows **every** error from
   `readdir(legacyRoot)` with no ENOENT check, no log and no error counter,
   unlike every sibling mirror method in the same file, so a real I/O failure
   silently skips the one-time legacy-agent migration.

### `workspace-intelligence` (1)

10. `libs/backend/workspace-intelligence/src/context/context.service.ts:789` —
    an ignore-file parse failure silently drops the user's custom exclude
    patterns, so more files than intended enter the AI context.

### `skill-synthesis` (6)

11. `libs/backend/skill-synthesis/src/lib/skill-curator.service.ts:778` — a failed
    curator report write returns `''`, a path the caller cannot distinguish from
    a real one.
12. `libs/backend/skill-synthesis/src/lib/skill-enhancer.service.ts:1019` —
    `readBody` maps any read failure to `null`, so an unreadable clone is
    reported as a missing one.
13. `libs/backend/skill-synthesis/src/lib/skill-suggestion.store.ts:219` —
    `parseStringArray` turns malformed persisted JSON into `[]`, silently
    emptying a suggestion's membership list.
14. `libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts:853` — a
    failed supersede of an existing candidate is warned and then swallowed, so
    candidate persistence silently does not happen.
15. `libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts:883` — a
    failed `SKILL.md` write returns `null`; the synthesized candidate is lost.
16. `libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts:1109` —
    `isDominatedByAuthoredSkill` **fails open** to `false`, so a registry error
    lets an authored skill be re-synthesized — the exact thing its own doc
    comment says must never happen.

### `vscode-lm-tools` (2)

17. `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/analysis-namespace.builders.ts:364` —
    `getDependencies` turns a real "no workspace folder open" throw into `[]`,
    which the agent reads as "this file has no dependencies". The sibling
    `buildGraph` in the same file surfaces its error message.
18. `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/analysis-namespace.builders.ts:376` —
    `getDependents` has the identical defect.

**Pattern across the 18**: the dominant class is not "an error was ignored" but
**"a failure was encoded as a legitimate empty/negative value"** — `[]`, `{}`,
`''`, `null`, `false` — that a caller cannot tell apart from a true result. Six
of them (`harness-sync`) can drive a _deletion_, which makes that lib the
highest-priority fix target.

---

## Reconcile pass (Task 5.7)

I reviewed `git diff` for each of the six libs myself:

- **Comment-only, verified mechanically**: across all six libs there are **zero**
  non-comment added lines. Command used:
  `git diff -U0 -- <lib> | grep '^+' | grep -v '^++' | grep -vE '^\+\s*//'` →
  empty for every lib.
- **Deletions**: exactly 3, all in `cli-agent-runtime`, and all are pre-existing
  comment lines absorbed verbatim into the new marker comment. No code deleted.
- **Scope**: no lane touched a file outside its own lib. The only other dirty
  paths in the tree are `libs/backend/persistence-sqlite/**` — Batch 6's
  concurrent work, not mine.
- **Marker syntax**: all 142 markers parse against the tool's grammar
  (`optional-capability` + `-`/`–`/`—` + a non-empty reason). Zero
  `bare-suppression` and zero `orphaned-suppression` findings in the final run.
- **Reasons**: every suppression carries a substantive reason naming what is
  optional and what the fallback means, not the word "optional" alone.

### What I overrode

**One fix, `skill-scorecard.service.ts` (codex lane).** The lane wrote a marker
whose reason described `readFindings` ("review findings are optional scorecard
enrichment") but pasted it into the catch of `getScorecards` ~160 lines away.
The consequence was that the flagged site stayed unsuppressed _and_ an unrelated
catch carried a misleading justification — and because the host catch is not
itself a flagged construct, the tool's orphan detector did not report it. This
is exactly the "misplaced comment is never silent" guarantee having a blind
spot; worth noting for the tool owner. I removed the misplaced marker and wrote
a correct one inside `readFindings`'s catch. `skill-synthesis` went 7 → 6, which
is what reconciled the arithmetic (160 − 142 = 18).

### Lanes that did not survive

- `56dc7c99` (antigravity, `cli-agent-runtime`) — ran ~4h of reads, produced
  **zero** edits, then exited 1. Re-spawned as `1f7dc48c` on the claude cli,
  which completed cleanly. Antigravity is not viable for this workload.
- `30ae7154` (codex, `skill-synthesis`) — wrote all 34 of its suppressions, then
  hit an OpenAI **usage limit** before printing its per-row table. Resume was
  impossible (credits exhausted until Sep 7). I reconstructed its classification
  from the diff and the tool's remaining rows, and read all six unsuppressed
  sites myself to write their causes; each maps to the prose summary codex did
  emit before dying. This is the one lib whose per-row _reasons_ are mine rather
  than the lane's.

---

## Baseline: deliberately NOT updated

`check-degradation.ts` parses only `--self-test`, `--self-test-parse-guard` and
`--update-baseline` (lines 861-863). **There is no `--dir` scoping**, so
`--update-baseline` rewrites every directory's entry at once — including
`libs/backend/persistence-sqlite`, which Batch 6 is actively changing. Baking a
mid-flight count for another batch's lib is precisely the hazard flagged in the
brief, so `tools/degradation-audit/baseline.json` is **untouched** (`git diff`
on it is empty).

**Task 5.7's re-baseline is deferred to the team-leader at commit time.** The six
entries to lower:

```
libs/backend/agent-generation:        31 → 1
libs/backend/cli-agent-runtime:       30 → 2
libs/backend/harness-sync:            29 → 6
libs/backend/skill-synthesis:         40 → 6
libs/backend/vscode-lm-tools:         16 → 2
libs/backend/workspace-intelligence:  14 → 1
```

The ratchet only fails on an _increase_, so leaving the baseline high is safe —
the audit passes today; it simply is not yet ratcheted tight.

---

## Verification

```
$ npx nx run degradation-audit:lint

  libs/backend/agent-generation: 1 ok (baseline 31)
  libs/backend/cli-agent-runtime: 2 ok (baseline 30)
  libs/backend/harness-sync: 6 ok (baseline 29)
  libs/backend/skill-synthesis: 6 ok (baseline 40)
  libs/backend/vscode-lm-tools: 2 ok (baseline 16)
  libs/backend/workspace-intelligence: 1 ok (baseline 14)

degradation-audit: TOTAL 422 unsuppressed site(s)     (was 564)

 NX   Successfully ran target lint for project degradation-audit
```

No `bare-suppression` or `orphaned-suppression` row appears anywhere in the
output.

```
$ npx nx run-many -t test -p @ptah-extension/harness-sync \
    @ptah-extension/cli-agent-runtime @ptah-extension/agent-generation \
    @ptah-extension/workspace-intelligence @ptah-extension/skill-synthesis \
    @ptah-extension/vscode-lm-tools

Tests:  373 passed, 373 total
Tests:  634 passed, 1 skipped, 635 total
Tests:  957 passed, 957 total
Tests: 1008 passed, 1008 total
Tests: 1401 passed, 37 skipped, 1438 total
Tests: 1011 passed, 1011 total

 NX   Successfully ran target test for 6 projects
```

`for 6 projects` confirmed — no name was silently dropped from the `run-many`
set. 5384 tests pass; the skips are pre-existing.

**One honest note on the test run**: the _first_ full six-project run reported
three failures (`agent-generation`, `workspace-intelligence`, `skill-synthesis`).
Each was a Jest **ts-transform crash** in `libs/shared/.../messages/index.ts`
under six concurrent heavy projects, not an assertion failure. All three pass in
isolation (`--skip-nx-cache`), Nx itself labelled two of them
`Nx detected a flaky task`, and the rerun above is green. Since this batch adds
only comment lines, no test outcome can depend on it — but the flakiness is real
and belongs in the record.

> **Corrected in Revision 1 (logic M-2).** The framing above overstates the
> case. What is _confirmed_ is narrow: the assertions pass in isolation. What is
> **not** shown is that concurrency fully explains the instability — Nx printed
> `Nx detected a flaky task` for `agent-generation` and `workspace-intelligence`
> even when each ran **alone**, and five of six projects emit
> `A worker process has failed to exit gracefully`, a teardown-leak signature
> that predates this batch and is at least as plausible a contributor as
> concurrency. See Revision 1's verification section for a second, different
> failure mode observed on a later run. Both statements are kept: assertions
> pass in isolation (true), and the cause is not fully diagnosed (also true).

---

## Lane IDs

| Lane | Lib                    | CLI         | Agent ID                               | Outcome                                                |
| ---- | ---------------------- | ----------- | -------------------------------------- | ------------------------------------------------------ |
| 1    | harness-sync           | codex       | `356f8aab-da24-4055-a64f-48094744b795` | completed                                              |
| 2    | cli-agent-runtime      | antigravity | `56dc7c99-5b2d-4715-8aff-1d6b1b3b88c4` | **failed**, 0 edits                                    |
| 2r   | cli-agent-runtime      | claude cli  | `1f7dc48c-5e25-469e-9058-fea9abe5f447` | completed                                              |
| 3    | agent-generation       | claude cli  | `d635ef2c-cd7a-4bfa-9ca7-571e1da9b7c6` | completed                                              |
| 4    | workspace-intelligence | claude cli  | `f8fbb98b-e790-4ff4-99e0-3326ab846d9a` | completed                                              |
| 5    | skill-synthesis        | codex       | `30ae7154-ff71-4a88-9a02-14dce2955b2c` | edits landed, **died on usage limit** before reporting |
| 6    | vscode-lm-tools        | claude cli  | `60cc8415-af89-4fa2-99d5-ad2f6c29fe74` | completed                                              |

Max 3 concurrent throughout. The Ollama Cloud spare
(`pc-85830910-…`) was never needed.

---

## Files changed (all comment-only)

79 files across the six libs, 142 suppression markers. No file created, none
deleted, no production behaviour altered.

| Lib                      | Files touched | Markers |
| ------------------------ | ------------- | ------- |
| `harness-sync`           | 12            | 23      |
| `cli-agent-runtime`      | 22            | 28      |
| `agent-generation`       | 11            | 30      |
| `workspace-intelligence` | 8             | 13      |
| `skill-synthesis`        | 18            | 34      |
| `vscode-lm-tools`        | 8             | 14      |

---

## Out-of-scope observations

- **Tool gap worth a follow-up**: a `degradation-audit:` marker placed on a catch
  that is _not itself flagged_ is neither honoured nor reported. The header
  promises a misplaced comment is "never silent"; the `skill-scorecard` case
  proves it can be. A cheap fix is to report any marker that attaches to no
  flagged construct, regardless of whether some other unflagged construct sits
  next to it.
- The `--update-baseline` flag has no directory scoping. Given that this task
  runs multiple batches in one worktree, a `--dir` filter would remove a real
  foot-gun.
- `libs/backend/agent-sdk` (33), `rpc-handlers` (40) and `apps/ptah-cli` (29) are
  the largest remaining unclassified directories for Batch 12.
