# Code Logic Review — `TASK_2026_403_403b`

Scope: the six commits `2327e9db0..HEAD` (`864b2f0c2`, `90efd32fe`, `484f1e6ae`,
`1ef1d40f1`, `28cd80567`, `c2ad24bc5`), diffed against `task.md`,
`context.md`, `implementation-plan.md`, `batches.md`.

## Summary

| Metric              | Value                    |
| -------------------- | ------------------------ |
| Overall score        | 8/10                     |
| Assessment            | APPROVED WITH NOTES       |
| Blocking issues      | 0                        |
| Serious issues       | 0                        |
| Moderate issues      | 2                        |
| Failure modes found  | 2 (both mitigated, one incompletely) |

## Five logic questions

### 1. How does this fail silently?

- `extractTaskIdFromPrompt` (`libs/backend/skill-synthesis/src/lib/subagent-metrics-extractor.ts:47,49`)
  returns `null` — not a wrong id, a *missing* one — for a syntactically valid
  suffixed task id that is immediately followed by another underscore-joined
  alphanumeric run with no intervening whitespace or punctuation. Reproduced
  directly against the shipped regex:

  ```
  'task TASK_2026_403_a1f2_v2 was completed'.match(BARE_TASK_ID) === null
  'legacy TASK_2026_146_ORCHESTRA_V2 shipped'.match(BARE_TASK_ID) === null
  ```

  Cause: `(?:_[A-Za-z0-9]+)?` can only consume ONE underscore-delimited
  segment, and once it does, `\b` at `:47`/`:49` requires the next character to
  be non-word. When a second `_word` follows, every backtracking path (with or
  without the optional group, and `\d{3,}` cannot shrink below 3) still lands
  on a word-to-word transition, so the whole match at that position fails —
  there is no fallback that at least recovers the leading `TASK_YYYY_NNN_xxxx`.
  `deriveTaskId` (`:209-213`) then returns `null`, `SkillTriggerService`'s
  caller silently falls back to its window-based heuristic
  (`skill-synthesis/CLAUDE.md` "one path to `analyzeSession`" describes the
  caller chain), and nothing logs or surfaces the miss. This is exactly the
  failure class the task brief's own risk language ("the wider optional-suffix
  group not swallowing a following word") asks to be checked for — the
  as-shipped patterns do not swallow the following word, but they also do not
  survive it: the match dies instead of narrowing to the id that *is* there.
  Not tested by `subagent-metrics-extractor.spec.ts` (its case at `:131-137`
  covers case-folding, not adjacency).

- `GitTaskFolderVisibility.listBeyondWorkspace` correctly never throws, but the
  60 s cache (`git-task-folder-visibility.service.ts:187-190`) can serve a
  stale union to a `create` that happens to race a *very* recent cross-checkout
  push — the design explicitly and correctly accepts this as harmless because
  the exclusive `mkdir` is the real correctness guarantee
  (`task-writer.service.ts:268-273`), so this is a documented degradation, not
  a silent one.

### 2. What user action produces unexpected behaviour?

Creating a task in the VS Code extension host or the CLI, when `origin` is
configured but slow to respond (not absent, not erroring fast — e.g. a
high-latency remote, or a credential-manager GUI prompt that the 5 s/10 s
timeouts must forcibly kill), can add up to ~15–25 s of sequential latency to
`TaskWriterService.create` before it falls back to local-only allocation
(`git-task-folder-visibility.service.ts:223-301`: `worktree list` 10 s +
`fetch` 5 s + `ls-tree` 10 s, awaited in series, not in parallel). This is the
plan's own stated ceiling (`implementation-plan.md:293-296`), not a defect
introduced silently, but neither the plan nor the batches record a measurement
of the *added* latency against the two hosts that pay for it inline — see
Failure modes below.

### 3. What input data produces a wrong answer?

- A task id containing a legacy alphabetic suffix immediately followed by a
  second underscore segment (see Q1) produces `null` instead of the numeric
  base id — a *missing* answer rather than a wrong one, which is the more
  benign failure direction, but still a real gap against the extractor's own
  three-step contract ("exact spec attribution", `:22-24`).
- No other new input-shape defect found. `allocateTaskId` (`id-allocator.ts`)
  is exercised against every boundary the plan names — legacy suffix, 4+ digit
  sequence, malformed suffix, empty input — and the tests in
  `id-allocator.spec.ts:1-72` match the plan's required case list exactly.

### 4. What happens when a dependency fails?

Every one of the five git-dependent failure branches was traced against its
spec and the source together, and each is provably non-throwing:

- `git worktree list` throws or exits non-zero →
  `git-task-folder-visibility.service.ts:223-248` returns `null`, and the
  caller (`:197`) skips BOTH the per-worktree scan and the remote steps —
  verified by the spec's `subcommands()).toEqual(['worktree'])` assertion
  (`git-task-folder-visibility.service.spec.ts:294,310`).
- `git fetch` throws, times out, or exits non-zero → swallowed at
  `:251-274`; execution unconditionally falls through to `remoteSpecFolderNames`
  (`:208-212`), so a stale `origin/main` ref is read anyway — pinned at
  `git-task-folder-visibility.service.spec.ts:316-332`.
- `git ls-tree` throws or exits non-zero → `:276-301` returns `[]`; the
  worktree half is untouched — pinned at `:334-346`.
- A single worktree's `readDirectory` throws (deleted worktree, permission
  error) → `:304-322` isolates the failure to that one worktree — pinned at
  `:348-365`.
- A process **timeout** specifically: `execGitBuffer` (`vscode-core/src/utils/exec-git.ts:246-257`)
  rejects the returned promise on timeout, which every one of the three
  `try`/`catch` wrappers in `GitTaskFolderVisibility` catches identically to
  an ENOENT — confirmed by code inspection, not directly pinned by a spec case
  (the spec drives failure via a rejected/errored fake `exec`, which is
  behaviourally the same path a real timeout takes, so the coverage is sound
  even though no test names "timeout" explicitly).
- A **non-git directory** (`worktreeSpecDirs` sees a non-zero exit or an
  ENOENT-style throw from `git`) is the same branch as "worktree list fails"
  above and is provably covered (`:286-302` in the spec).

`TaskWriterService.create` itself adds no new catch for this seam
(`task-writer.service.ts:281-283` comment states this and the code matches:
`visibility.listBeyondWorkspace` is awaited outside any new `try`, relying on
the port's own "never throws" contract, which holds).

### 5. What is missing that the requirements never mentioned?

- **No benchmark for the new call site's cost in VS Code / CLI.** The plan
  measures inline-vs-off-thread spawn cost in general
  (`exec-git.ts:10-40`, TASK_2026_341) but that measurement predates this
  task and was never about `create()`. This task adds the FIRST git spawns to
  a path (`ptah_task_create` / the board's create dialog) that previously did
  none in VS Code and the CLI, and ships it without a host-specific
  measurement of the added latency — the plan calls the tradeoff "acceptable"
  by architecture precedent, not by data for this call site.
- **No log line distinguishes "extractor found nothing" from "extractor
  choked on adjacency."** Both currently look identical (`null`, silently
  handled by the caller's window fallback), so the Q1 defect has no
  observability hook that would surface it even in aggregate.

## Failure modes

### Metrics-extractor regex dies on adjacent underscore text

- Trigger: a subagent's first user prompt contains a valid suffixed (or
  legacy alphabetic-suffixed) task id immediately followed by `_` plus another
  alphanumeric run, with no separating whitespace or punctuation.
- Symptom: `extractTaskIdFromPrompt` returns `null` instead of the id that is
  actually present; the caller's window-based fallback takes over, silently
  and with no distinguishing signal.
- Evidence: `libs/backend/skill-synthesis/src/lib/subagent-metrics-extractor.ts:47,49`;
  reproduced against the compiled regex (see Q1). No spec in
  `subagent-metrics-extractor.spec.ts` exercises this adjacency case, only
  case-folding (`:131-137`) and multi-id ambiguity (`:139-149`).
- Current handling: none — the whole match fails at the `TASK_` anchor
  position and there is no narrower fallback pattern.
- Recommendation: either anchor the optional suffix group with a stronger
  boundary that does not require a following non-word character (e.g. match
  the base id greedily first, then optionally consume exactly one trailing
  `_[A-Za-z0-9]+` only when what follows THAT is itself a boundary — which is
  what the current pattern intends but does not achieve under backtracking),
  or accept the narrower base id as a still-useful lower-confidence match
  before declaring `null`. Given the low practical trigger rate (task ids are
  almost always followed by `/`, whitespace, or punctuation in this
  repository's own conventions), this is Moderate rather than Serious, but it
  is a genuine, demonstrated gap against the stated three-step "exact
  attribution" contract.

### Sequential git timeouts on a previously spawn-free create path

- Trigger: `origin` is configured and reachable but slow (not absent, not a
  fast-erroring offline case) in the VS Code extension host or the CLI, where
  no off-thread spawner is ever bound (confirmed: `SDK_TOKENS.SDK_PROCESS_SPAWNER`
  is registered only in `apps/ptah-electron/src/di/phase-4-handlers.ts:108-111`;
  no VS Code or CLI registration exists anywhere in the tree).
- Symptom: `TaskWriterService.create` (and therefore `ptah_task_create` / the
  board's create dialog / `ptah task create`) can take up to ~15–25 s before
  falling back to local-only allocation, on a user-facing action that
  previously completed with zero git round-trips.
- Evidence: `git-task-folder-visibility.service.ts:223-301` awaits `worktree
  list` (10 s), `fetch` (5 s), `ls-tree` (10 s) strictly in series; timeouts
  are individually bounded and each guarded catch is non-throwing
  (confirmed above), so the WORST case is bounded, not unbounded — but it is a
  real, newly-introduced latency ceiling with no measurement cited for either
  affected host.
- Current handling: the three-call sequence is architecturally necessary
  (fetch must precede `ls-tree` reading a fresh ref; the `implementation-plan.md:293-296`
  states the ceiling as an accepted cost) and the process-tree kill on timeout
  (`exec-git.ts:246-257`, `killProcessTree`) prevents a true hang.
- Recommendation: no code change required to correct a defect (behaviour is
  as designed and every degrade path is provably safe), but the team-leader's
  "Complexity: MEDIUM" characterization should note this residual UX risk for
  a follow-up measurement, since "acceptable" was asserted rather than
  measured for the two hosts that actually pay the inline-spawn cost.

## Blocking issues

None found. Every git failure branch is provably non-throwing and pinned by a
dedicated spec case; the union-once/fresh-suffix/local-rescan invariants in
`TaskWriterService.create` are implemented exactly as specified and pinned by
tests that assert call counts, not just outcomes (`task-writer.service.spec.ts:185-273`).

## Serious issues

None found.

## Moderate and minor issues

- **Moderate** — Metrics-extractor regex adjacency gap. See Failure modes
  above. `subagent-metrics-extractor.ts:47,49`.
- **Moderate** — Unmeasured latency ceiling added to `create()` in two hosts
  that never bind an off-thread spawner. See Failure modes above.
  `git-task-folder-visibility.service.ts:223-301`.
- **Minor** — `task-writer.service.spec.ts:243-273` ("draws a FRESH suffix on
  every attempt") has an inherent, self-acknowledged 1/65536 flake probability
  (two independent 4-hex draws could coincide). The comment at `:268-270`
  correctly identifies this as the property under test rather than a test
  defect, but it is still a source of rare CI noise worth a `jest.retryTimes`
  note or a seeded RNG stub if it is ever observed to flake in practice.
- **Minor** — `git-task-folder-visibility.service.ts:198-202`'s
  own-workspace exclusion relies on `path.relative` equality between a
  `path.join`-built worktree dir and a `path.resolve`-built own-specs dir;
  correct for the absolute, already-normalized paths this codebase produces
  (verified by direct reproduction), but the asymmetry (one side resolved,
  one side only joined) is worth a comment noting why it is safe rather than
  leaving it to be re-derived by the next reader.

## Data flow

1. `ptah_task_create` / board dialog / `ptah task create` → `tasks:create` RPC
   → `TaskWriterService.create(root, input)` — OK, unchanged entry points,
   confirmed no schema edits were needed (`task-writer.service.ts:247-260`).
2. `visibility.listBeyondWorkspace(root)` called ONCE before the retry loop
   (`:283`) — OK, matches the plan's "computed once per create" contract, and
   is pinned by a call-count assertion (`task-writer.service.spec.ts:212-241`).
3. Inside the ≤5-attempt loop: fresh `listFolderNames(specsDir)` (local,
   re-scanned every attempt) unioned with the single cached `beyondWorkspace`
   result, plus a fresh `randomIdSuffix()` — OK, both re-scan and fresh-suffix
   behaviours are independently pinned (`:212-273`).
4. `allocateTaskId(union, suffix)` — OK, pure, validated suffix, deterministic
   given its inputs; malformed-suffix throw is unreachable from the one
   production call site (verified: no other caller exists in the tree).
5. `fs.createDirectoryExclusive` — OK, unchanged CAS semantics; EEXIST retry
   converges because step 3's local re-scan sees the previous winner.
6. `GitTaskFolderVisibility` internally: `worktree list` → per-worktree
   `readDirectory` → best-effort `fetch` → `ls-tree` → dedup → 60 s cache —
   OK, every step independently guarded, non-throwing, degrades to "the
   local scan alone decides," which is exactly pre-existing behaviour.
7. `subagent-metrics-extractor` consumes free-form prompt text, independent of
   the above — GAP for the specific adjacency case in Q1/Failure modes,
   otherwise OK (widened `\d{3,}` and case-verbatim-return both verified
   correct against their pinned specs).
8. Prose/doc renderers (`task-spec.contract.ts`, 15 agent files, both
   orchestration/tribunal skills, both `.claude` and plugin copies, the MCP
   tool description, root and lib `CLAUDE.md`) — OK, spot-checked
   `backend-developer.md` byte-for-byte against the renderer's new output, and
   the `SKILL.md` continuation regex (`^TASK_\d{4}_\d{3,}(?:_[A-Za-z0-9]+)?$`)
   is anchored with `^`/`$` over the WHOLE argument, so it does not share the
   metrics-extractor's adjacency defect (a full-string match has no "text
   after the match" to collide with) — verified against this task's own
   folder name `TASK_2026_403_403b`, which the pattern matches in full.

## Requirements fulfilment

| Requirement                                                                 | Status   | Gap                                                                 |
| ---------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------- |
| Suffixed id format `TASK_YYYY_NNN_xxxx`, allocator emits it                  | COMPLETE | none                                                                  |
| Union scan: local + every worktree + `origin/main`, computed once per create | COMPLETE | none                                                                  |
| Git failures degrade to local-only, never throw                             | COMPLETE | none; all five branches pinned                                       |
| Fresh suffix per retry attempt; `MAX_CREATE_ATTEMPTS`/`ID_ALLOCATION_EXHAUSTED` unchanged | COMPLETE | none                                                                  |
| Off-thread spawner reached by mirrored symbol, optional                     | COMPLETE | symbol pinned as string literal (`git-task-folder-visibility.service.spec.ts:469-470`) |
| Metrics extractor accepts suffixed/legacy ids, keeps exact-attribution contract | PARTIAL  | adjacency case returns `null` instead of the base id (see Q1)         |
| SKILL.md continuation regex + allocation prose updated everywhere            | COMPLETE | spot-checked renderer, one agent file, both `.claude`/plugin skill copies, `relay.md`, root/lib `CLAUDE.md` — all consistent |
| Degradation ratchet not exceeded                                            | COMPLETE | 4 new markers, baseline unchanged at 12 (verified by grep against `tools/degradation-audit/baseline.json:33`) |

Implicit requirements not addressed: a way to tell "no task id in this prompt"
apart from "task id present but unparseable due to adjacency" in the metrics
pipeline's observability (see Q5).

## Edge cases

| Case                                                        | Handled | How                                                    | Concern                                             |
| ------------------------------------------------------------ | ------- | ------------------------------------------------------- | ------------------------------------------------------ |
| Legacy `TASK_2026_146_ORCHESTRA` (non-hex suffix)             | YES     | allocator regex unanchored at end; extractor pattern widened | none                                                   |
| `TASK_2026_1000` (4+ digit sequence)                          | YES     | `\d{3,}` in both allocator and extractor                 | none                                                   |
| Suffixed id in two different cases in one prompt              | YES     | case-insensitive dedup, verbatim first-match return       | none                                                   |
| Suffixed id glued to a further `_word` with no separator       | NO      | regex match fails entirely at that position               | silent `null`, Moderate — see Failure modes            |
| `worktree list` fails on a non-repo directory                | YES     | remote steps skipped too                                  | none                                                   |
| `fetch` fails/times out                                       | YES     | continues to stale `ls-tree`                              | none                                                   |
| Deleted-but-listed worktree                                   | YES     | isolated per-worktree                                     | none                                                   |
| 60 s cache across rapid repeated `create` calls               | YES     | keyed per normalized workspace root                        | acceptable staleness, by design                        |
| Concurrent create race across checkouts                       | YES     | exclusive `mkdir` is still the correctness guarantee        | none                                                   |
| Slow-but-not-failing `origin` in VS Code/CLI                  | YES (bounded) | sequential timeouts sum to ~15-25s worst case        | unmeasured UX cost — Moderate, see Failure modes        |

## Verdict

- Recommendation: APPROVE (with the two moderate notes tracked, not blocking)
- Confidence: HIGH
- Top risk: the metrics-extractor regex's adjacency gap (Q1) is a real,
  reproduced defect, but its blast radius is internal analytics attribution
  falling back to an existing heuristic, not user-facing data loss or an
  incorrect task allocation.
- What a robust implementation would add: (1) a fallback in
  `extractTaskIdFromPrompt` that recovers the bare `TASK_YYYY_NNN` when the
  optional suffix group's boundary fails, rather than discarding the whole
  match; (2) a one-time latency measurement of `TaskWriterService.create` in
  the VS Code extension host and the CLI against a deliberately slow `origin`,
  to convert "acceptable by architecture precedent" into "acceptable,
  measured"; (3) a distinguishing log/metric for "extractor found nothing"
  vs. "extractor's boundary check rejected a candidate," so the Q1 gap would
  have been visible in production telemetry rather than requiring source
  reading to find.
