# Code Logic Review — Batch 2, `TASK_2026_437_0778`

Scope: `libs/shared/src/lib/constants/workspace-scan.constants.ts` (+ spec),
`libs/shared/src/lib/utils/nested-repo-roots.ts` (+ spec, + `utils/index.ts`),
`libs/backend/platform-core/src/utils/event-storm-breaker.ts` (+ spec, +
`platform-core/src/index.ts`), `libs/backend/workspace-intelligence/src/file-indexing/workspace-default-excludes.ts`
(+ new spec), `libs/backend/vscode-core/src/utils/worktree-path.ts`,
`libs/backend/agent-sdk/src/lib/helpers/worktree-hook-handler.ts`.

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score        | 7/10                                 |
| Assessment           | APPROVE_WITH_FIXES                   |
| Blocking issues      | 0                                    |
| Serious issues       | 0                                    |
| Moderate issues      | 2                                    |
| Failure modes found  | 2                                    |

`npx nx run-many -t test -p @ptah-extension/shared @ptah-extension/platform-core @ptah-extension/workspace-intelligence @ptah-extension/vscode-core @ptah-extension/agent-sdk`
was run against the worktree. Confirmed: `@ptah-extension/shared` (58 suites,
1504 tests — includes `workspace-scan.constants.spec.ts` and
`nested-repo-roots.spec.ts`) and `@ptah-extension/platform-core` (33 suites,
597 passed/4 todo — includes `event-storm-breaker.spec.ts`) both pass 100%
(re-run individually to confirm, since the 5-project run's `tail -100` only
captured the last two projects' output). `@ptah-extension/workspace-intelligence`
also passed in full (41 suites, 1021 tests — includes the new
`workspace-default-excludes.spec.ts`). Two unrelated failures surfaced in
`@ptah-extension/vscode-core` — `main-loop-watchdog.spec.ts` (Batch 5's file,
a timing race: "condition not met within 2000ms") and
`git-info.service.review.spec.ts` (Batch 3's file, a Windows `EPERM` on
`rmSync` of a temp dir plus a 5000ms Jest timeout, looking environmental/
flaky rather than a real regression). Neither file is in this batch's scope;
they are called out here only so the team-leader doesn't mistake this
review's silence on them for "verified green." Every file this review
actually covers is confirmed passing.

## Five logic questions

### 1. How does this fail silently?

No exception path exists in any of these five files — every function is a
pure predicate/derivation over strings, so there is no "catch and continue"
to audit. The nearer analogue to a silent failure is **an over-broad or
under-broad exclusion that never surfaces**: `isExcludedWorkspacePath`
returning `false` for a directory that should have been excluded produces no
error, no log line, no signal anywhere — a consumer just watches/indexes one
more subtree than intended, indistinguishable from correct behaviour until
someone repeats the 09-14 load pattern. This is the shape of Finding M-1
below (case folding).

### 2. What user action produces unexpected behaviour?

None from these files directly — they have no callers wired to user-facing
behaviour yet in this batch (the git watcher and file-index watcher pick
these up in Batches 4/11). The closest analogue: a user or a sync/backup tool
that recreates `.claude-worktrees` or `.claude/worktrees` with different
letter casing on a Windows workspace (`.Claude-Worktrees`, common after some
OneDrive/antivirus rename-and-restore cycles) would find that directory
un-excluded by the static rule (`workspace-scan.constants.ts:124-127`,
matched case-sensitively at `:158-176`), even though NTFS itself does not
distinguish the two spellings from `.claude-worktrees`.

### 3. What input data produces a wrong answer?

- A worktree/nested-repo directory name that differs from
  `.claude-worktrees` / `.claude/worktrees` only in case, on a
  case-insensitive filesystem (win32 — the exact platform of the 09-14
  incident). See M-1.
- A workspace root supplied as a POSIX-shaped path on Windows (e.g. an MSYS/
  git-bash style `/d/projects/repo` with no drive-colon, no `\\`, no `//`)
  makes `NestedRepoRoots`'s `WINDOWS_ABSOLUTE_PATH` probe
  (`nested-repo-roots.ts:31,48`) classify the workspace as case-*sensitive*
  even though the underlying NTFS volume is not. See m-2 (Minor, since every
  cited producer in this repo supplies native `D:\...`/`D:/...` roots).

### 4. What happens when a dependency fails?

These modules take no I/O dependency (explicitly zero-`path`/zero-`fs` by
the module's own stated contract, verified by reading — no `require`/`import`
of `path`, `fs`, or `os` anywhere in the five files). `readEventStormBreakerOptionsFromEnv`
degrades every unparsable or out-of-range environment value to the compiled
default (`event-storm-breaker.ts:117-136, 266-281`, exercised by the `clamps
an invalid config` and `reads numeric overrides` spec cases) rather than
throwing — correct behaviour for a tunable read at boot.

### 5. What is missing that the requirements never mentioned?

- No test exercises `NestedRepoRoots` combined with a mixed-case rule from
  `NESTED_WORKSPACE_PATH_RULES` in the same scenario — the two are tested in
  isolation (`nested-repo-roots.spec.ts` proves case-folding; `workspace-scan.constants.spec.ts`
  proves the static rule is case-sensitive) but nothing documents, for a
  *reader of the file-index consumer alone*, that the static channel it uses
  today has no case-insensitive backstop until Batch 11 (Task 11.3) lands.
  That gap is real but already tracked as plan defect D4 in `batches.md`, so
  it is not a fresh omission — it is a known, deferred piece of this exact
  incident's fix that a reviewer should still confirm is closed before P2 is
  declared done.

## Failure modes

### M-1: Case-sensitive static exclusion on the incident's own platform

- Trigger: a worktree or nested-repo directory is created with — or later
  renamed to — a case variant of `.claude-worktrees` / `.claude/worktrees`
  (e.g. by a sync tool, an editor "case-correct on save", or manual
  Explorer rename) on Windows, where NTFS treats the variant as the same
  path.
- Symptom: `isExcludedWorkspacePath` (`workspace-scan.constants.ts:158-176`)
  and the globs `toWorkspaceExcludeGlobs` derives from the same rules
  (`:209-219`) both return "not excluded" for the variant-case path. Any
  consumer that has NOT also wired the dynamic, case-folding
  `NestedRepoRoots` layer (`nested-repo-roots.ts:36-153`, case-folds via
  `WINDOWS_ABSOLUTE_PATH` at `:31,48`) watches/indexes the full checkout —
  reproducing the class of defect this task exists to close, on the one
  platform the incident happened on.
- Evidence: `workspace-scan.constants.ts:120-123` documents the choice as
  deliberate ("Matching is case-sensitive, like the single-segment set...");
  pinned by `workspace-scan.constants.spec.ts:228-230` (`['.Claude/Worktrees/x', false]`,
  `['.CLAUDE-WORKTREES/x', false]`) and mirrored in
  `workspace-default-excludes.spec.ts` (no case-variant case in its table at
  all, so the glob channel's case-sensitivity isn't even exercised there).
- Current handling: the design's answer is the *second*, dynamic channel —
  `NestedRepoRoots`, seeded from `git worktree list` and from live `.git`
  discovery, which does fold case on Windows. Per `implementation-plan.md`
  INV-2 and `batches.md` D4, that dynamic layer reaches the git watcher in
  Batch 4 (P1) but reaches the file-index's initial walk / `@` picker only in
  Batch 11 (P2, Task 11.3) — tracked, not silent, but real for the interval
  between.
- Recommendation: when Batch 11 lands, confirm `workspace-indexer.service.ts`
  consults `NestedRepoRoots` (or an equivalent case-folded check) for every
  win32 host, not only the static glob list; until then, record the gap
  explicitly in this batch's own module doc (a one-line "known gap, closed in
  Batch 11" note next to the case-sensitivity paragraph) so a reader of
  `workspace-scan.constants.ts` in isolation doesn't conclude the platform
  gap is already closed.

### m-2: `NestedRepoRoots` case-folding keyed off path shape, not platform

- Trigger: a Windows host whose workspace root is supplied in a non-native
  shape (no drive-colon prefix, no `\\`/`//`) — e.g. a POSIX-shaped path from
  an MSYS/git-bash-style tool.
- Symptom: `caseInsensitive` is computed from `WINDOWS_ABSOLUTE_PATH.test(workspaceRoot)`
  (`nested-repo-roots.ts:48`), so such a root is treated as case-sensitive
  even though the underlying NTFS volume is not; two spellings of the same
  worktree directory would then be tracked as two different roots.
- Evidence: `nested-repo-roots.ts:31,48`; no host in this codebase's cited
  call sites (`git-info.service.ts`, `boot-heavy-services.ts`) is shown
  supplying such a root, so this is a latent gap rather than a reachable one
  today.
- Current handling: none — the constructor has no explicit `platform`
  parameter, only path-shape inference.
- Recommendation: low priority; note it if a future caller (CLI on
  Windows under a POSIX-style shell) starts passing non-native paths. Not a
  blocker for this batch.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

- M-1 above (case-sensitive static rule vs. the incident's own platform) —
  Moderate, tracked/mitigated by design but the batch's own documentation
  should say so explicitly. `workspace-scan.constants.ts:120-127`.
- m-2 above (case-folding inferred from path shape) — Minor/latent.
  `nested-repo-roots.ts:31,48`.
- Minor: `EventStormBreaker`'s `estimatedRate`/`advanceWindow` reset semantics
  on a **forced** (`max-duration`) exit intentionally keep the rate window
  live so the very next event re-enters a storm immediately
  (`event-storm-breaker.ts:216-229`, `poll` comment `:172-176`). This is
  correct per the module's own contract and is pinned by the `forces one
  refresh... then re-arms` spec, but it does mean a storm that never truly
  quiets down produces a steady stream of "entered"/"exited" log lines from
  the caller (one pair every `maxStormMs`) rather than one continuous
  "storming" state — worth a one-line note in the header for whoever reads
  the resulting log during a real incident, so the repeated enter/exit pairs
  aren't mistaken for a flapping bug.

## Data flow

1. `AGENT_WORKTREE_DIR` / `NESTED_WORKSPACE_PATH_RULES` (constants) — OK,
   single literal, both known producers (`worktree-path.ts`,
   `worktree-hook-handler.ts`) now import it instead of duplicating the
   string (confirmed by diff: both former literals replaced).
2. `isExcludedWorkspacePath(path, dirs, rules)` — OK for the tested shapes
   (POSIX/Windows separators, doubled/leading/trailing separators, nested
   depth, mixed rules); gap is case only (M-1).
3. `toWorkspaceExcludeGlobs(rules)` → `DEFAULT_WORKSPACE_EXCLUDES` — OK, the
   drift spec (`workspace-default-excludes.spec.ts`) proves the glob channel
   and the segment-predicate channel agree on every table row it carries, but
   that table never includes a case-variant row, so the drift spec cannot
   catch a future case-sensitivity regression on the glob side specifically.
4. `NestedRepoRoots.fromWorktreeList` / `.add` / `.contains` — OK; case
   folding, `..`-climb rejection, UNC/doubled-separator collapsing, "shallowest
   root wins" and "workspace root itself is never a root" are all covered by
   passing table-driven specs I traced by hand against the implementation.
5. `nestedRepoRootOf` — OK; correctly distinguishes a worktree's `.git` FILE
   and a repo's `.git` DIR (both just "a segment named `.git`"), correctly
   excludes the workspace's own `.git`.
6. `EventStormBreaker` — OK; sliding-window rate estimate, quiet-exit reset,
   forced-exit re-arm, clock-backwards tolerance and NaN/negative/zero/∞
   config clamping are all exercised by fake-clock specs that match the
   implementation's actual branches (traced by hand, not just read for
   presence).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| INV-2 static half: agent worktrees excluded by name, `.claude` alone stays watched | COMPLETE | none — table-tested both ways |
| INV-2 static half: nested-repo/worktree roots excluded by discovery | COMPLETE (utility only) | `NestedRepoRoots` is correct and unit-proven, but not yet wired to any consumer in this batch — expected, per `batches.md` (Batch 4/8/11 wire it) |
| INV-6: pure storm state machine, env-tunable | COMPLETE | none |
| "One literal for the worktree dir name" (plan §1, C1) | COMPLETE | both producers (`worktree-path.ts`, `worktree-hook-handler.ts`) now import `AGENT_WORKTREE_DIR` |
| `DEFAULT_WORKSPACE_EXCLUDES` derives nested rules instead of hand-listing (D4 static half) | COMPLETE | drift spec enforces the superset relationship |
| "Nested repos/worktrees excluded from every consumer including the `@` picker" (context.md user decision) | PARTIAL, by design | this batch ships only the static/pure layer; the `@` picker and the file-index initial walk get dynamic case-folded exclusion in Batch 11 (tracked as D4) |

Implicit requirements not addressed: a header-level note in
`workspace-scan.constants.ts` or `workspace-default-excludes.ts` stating that
case-insensitive matching is intentionally deferred to the dynamic layer
landing in a later batch — currently a reader has to cross-reference
`batches.md` D4 to learn this.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| `.claude` alone (tracked commands/skills/agents) | YES | single-segment rule requires both consecutive names; `.claude` bare table row is `false` | none |
| Windows vs POSIX separators, mixed | YES | `PATH_SEPARATOR` regex splits both; tested combined | none |
| Nested occurrence (`pkg/.claude-worktrees/y`) | YES | segment/rule match at any index, not just index 0 | none |
| False positives (`foo.claude-worktrees`, `.claude/worktrees-old`) | YES | exact-segment equality, not substring | none |
| Case variants on win32 | NO (by design, deferred) | static layer is case-sensitive everywhere | M-1 |
| `..`-climbing relative roots | YES (rejected, not resolved) | `relativeKey` returns `undefined` on any `..` segment | conservative but correct — never silently mis-resolves |
| UNC / doubled separators / trailing slash | YES | `absoluteKey` normalization, tested for UNC and doubled separators | none |
| Clock stepping backwards (breaker) | YES | `estimatedRate`/`advanceWindow` clamp elapsed to `[0, windowMs]` | none |
| Burst exactly at threshold (breaker) | YES | `entered` fires precisely at event 500 (index 499), tested | none |
| Storm that never ends (breaker) | YES | `maxStormMs` forces exit, re-arms on the very next event | log-line churn noted as Minor |
| NaN/±∞/negative env overrides (breaker) | YES | `validOrDefault` + `Number.isFinite` gate | none |
| Empty rule (`[[]]`) | YES | `ruleMatchesAt` returns `false` for a zero-length rule, never matches everything | none |

## Verdict

- Recommendation: APPROVE (with the one documentation fix noted below;
  nothing here blocks Batch 2 from landing)
- Confidence: HIGH — every branch was traced against its spec table by hand,
  and `shared`, `platform-core` and `workspace-intelligence` (the three
  projects that actually contain this batch's files) were independently
  re-run and confirmed 100% passing.
- Top risk: the case-sensitive static exclusion (M-1) sits exactly on the
  platform and exactly on the directory names the 2026-09-14 incident
  involved; it is covered by a planned dynamic layer, but that layer is
  split across three later batches (4, 8, 11), and nothing in this batch's
  own files says so for a reader who only opens these five.
- What a robust implementation would add: (1) a one-line doc note in
  `workspace-scan.constants.ts` pointing at the batch that closes the
  case-insensitive gap for each consumer (git watcher: Batch 4; file index:
  Batch 11); (2) one case-variant row added to
  `workspace-default-excludes.spec.ts`'s table, asserted `false` today and
  flipped to `true` when Batch 11 wires the dynamic layer into the file
  index, so the spec itself tracks the closure instead of only `batches.md`
  D4.

## Delta review (M-1 fix)

Scope: ONLY the case-insensitivity fix in
`libs/shared/src/lib/constants/workspace-scan.constants.ts` (new
`equalsIgnoringAsciiCase`, the `ruleMatchesAt` call site, the per-letter
bracket-class glob emission in `toWorkspaceExcludeGlobs`/`caseInsensitiveGlobName`,
and the doc paragraph at `:120-130`), the matching case rows in
`workspace-scan.constants.spec.ts` and
`workspace-default-excludes.spec.ts`, and the one-line doc addition to
`libs/backend/platform-core/src/utils/event-storm-breaker.ts:29-30`. Nothing
else in the batch was re-read; the rest of the prior review's findings stand
unchanged.

**Verification performed.** Read both changed source functions directly
(worktree files are uncommitted, so git diff would not show them) rather than
relying on git diff, per the brief. Traced `equalsIgnoringAsciiCase`
(`workspace-scan.constants.ts:214-225`) and `caseInsensitiveGlobName`
(`:251-260`) by hand against their call sites, then re-ran
`npx nx run-many -t test -p @ptah-extension/shared @ptah-extension/workspace-intelligence`
from `D:\projects\ptah-437`: both green — `shared` 58/58 suites, 1512/1512
tests (up from 1504 pre-fix, +8 case rows); `workspace-intelligence` 41/41
suites, 1026/1026 tests (up from 1021, +5 case rows in
`workspace-default-excludes.spec.ts`). Also traced every current consumer of
`DEFAULT_WORKSPACE_EXCLUDES`/`toWorkspaceExcludeGlobs` by grep and read:
`type-script-diagnostics-provider.ts:362` and
`workspace-indexer.service.ts:602` (both via `IFileSystemProvider.findFiles`),
and `core-namespace.builders.ts:152` (MCP `findFiles` namespace, same
abstraction). No consumer calls `ts.sys.readDirectory`/TS's own exclude
resolution with this constant — `ts-diagnostics-worker.ts` has zero
references to it, so the TS-native glob dialect the brief asked me to check
for is not actually in this constant's consumer set. The three real glob
engines behind `IFileSystemProvider.findFiles` are `vscode.workspace.findFiles`
(VS Code adapter, minimatch-family, bracket-class aware) and `fast-glob`
(CLI/Electron adapters, micromatch under the hood, bracket-class aware); the
chokidar-backed watcher path (`glob-watch-plan.ts:47,110,114`) also matches
through `picomatch`, the same engine `workspace-default-excludes.spec.ts`
exercises directly. All four therefore parse `[cC]`-style bracket classes
correctly — no dialect mismatch found.

### Correctness of the ASCII fold

`equalsIgnoringAsciiCase` (`:214-225`) is allocation-free: it compares
`charCodeAt` values in a single pass, folding only bytes in `[65,90]`
(`A`-`Z`) down by 32, with no `toLowerCase()`/`toUpperCase()` call and no
intermediate string. This matches the brief's "no `toLowerCase` per segment
in the hot path" requirement — confirmed by reading the function body, not
inferred from the docstring. Non-letter bytes (`.`, `-`, digits) hit the
`x === y` fast path or fail the final compare unchanged, so they are neither
folded nor misclassified as letters. Length is checked first
(`a.length !== b.length`), so no out-of-bounds read is possible when the two
strings differ in length. Correct standard ASCII case-fold; traced by hand
against all shipped rule names (`.claude`, `worktrees`, `.claude-worktrees`)
and against the test table's case-variant rows
(`workspace-scan.constants.spec.ts:229-233`), all of which pass.

Astral/non-ASCII input is handled safely, if incidentally: `charCodeAt`
iterates UTF-16 code units, so a segment containing a non-ASCII letter (e.g.
Cyrillic or Greek) is compared unit-for-unit with no folding applied to it —
consistent with the module's own "non-ASCII names unaffected" claim, since a
non-ASCII segment can only match a rule name that is itself non-ASCII, and
none of the shipped rules are.

### Correctness of the glob bracket classes

`caseInsensitiveGlobName` (`:251-260`) guards each character with
`lower !== upper && /[a-z]/.test(lower)` before emitting a bracket class, so
only base ASCII letters become `[xX]` — non-letters (`.`, `-`) and non-ASCII
letters (whose `toLowerCase()` differs from `toUpperCase()` but fails the
`/[a-z]/` probe) are emitted literally, matching
`equalsIgnoringAsciiCase`'s fold exactly: the two functions agree on which
characters are "foldable" (verified by inspection, not just by the passing
drift spec). No `-`, `^`, `]` or `\` character ever reaches a bracket body
under the shipped rule set (`.claude`, `worktrees`, `.claude-worktrees`
contain none), so the "no other escaping is applied" doc claim
(`:236-237`) holds for what actually ships; nothing in this fix widens that
set. Two-letter brackets are always adjacent single characters
(`[cC]`, `[lL]`, …), never `[a-z]`-style ranges, so there is no risk of a
`-` between two letters being read as a range instead of a literal member.

`toWorkspaceExcludeGlobs`'s exact output is pinned character-for-character by
`workspace-scan.constants.spec.ts:284-288` and confirmed passing; the
drift/equivalence spec (`workspace-scan.constants.spec.ts:244-258`,
`workspace-default-excludes.spec.ts:35-62`) round-trips every table row,
including the new case-variant rows, through both the segment predicate and
the derived glob (via a hand-rolled `globToRegExp` in `shared`'s spec, and via
real `picomatch({ dot: true })` with no `nocase` in
`workspace-intelligence`'s spec) and asserts agreement. I re-read both
`globToRegExp` (`workspace-scan.constants.spec.ts:304-326`) and the picomatch
call by hand: neither is permissive enough to mask a real mismatch — the
hand-rolled regex only special-cases `[...]`, a leading `**/`, and a trailing
`/**`, treating every other glob metacharacter (`*`, and anything not one of
those three shapes) literally-escaped, so it cannot silently swallow a
bracket-class bug; picomatch is the same engine the production watcher path
uses, so that half of the spec is testing production behaviour directly, not
a stand-in.

`['.Claude/Commands/x.md', false]` (`workspace-scan.constants.spec.ts:234`)
and `['.Claude/Commands/x.md', false]` (`workspace-default-excludes.spec.ts:45`)
both pin the no-false-positive requirement: a case variant of the tracked
`.claude/commands` sibling stays included. Confirmed passing in the test run
above.

### Storm-breaker doc line

`event-storm-breaker.ts:29-30` adds "By design, a storm that never goes quiet
therefore logs one enter/exit pair (and issues one refresh) per `maxStormMs`."
This is an accurate paraphrase of the forced-exit re-arm behaviour described
in the same header's Contract section (`:25-28`) and matches the prior
review's Minor recommendation verbatim ("worth a one-line note in the header
for whoever reads the resulting log during a real incident"). Pure
documentation — no behaviour change, no fresh logic to verify beyond
consistency with the code it describes, which I re-read (`:1-30`) and confirm
it correctly summarizes.

### Findings

None blocking, serious, or moderate. The fix fully closes the reachable half
of M-1 (the static segment predicate and its derived glob channel both fold
ASCII case now, and both channels' agreement is spec-pinned) rather than
merely documenting the gap as the original recommendation suggested — that
is a stronger remediation than what was asked for. The **residual** half of
M-1 is unchanged and out of scope here by design: no production code calls
`isExcludedWorkspacePath` yet (confirmed by grep — only spec files reference
it), so the dynamic `NestedRepoRoots` layer for the file-index/`@`-picker
consumers still lands in Batch 11 per `batches.md` D4; this delta does not
claim to close that, and its own doc (`:120-130`) does not overclaim either.

### Verdict

- Recommendation: **APPROVE**
- Confidence: HIGH — both changed functions traced by hand against their
  call sites and test tables, all four real glob consumers identified and
  checked for bracket-class support, and the full scoped test suite re-run
  green with the expected new-row counts.
- Residual risk: none introduced by this fix. The pre-existing, tracked gap
  (static layer not yet wired to any consumer; dynamic case-folding layer
  deferred to Batch 11) is unchanged by this delta and remains tracked as D4.
