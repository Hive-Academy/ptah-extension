# Code Logic Review — `TASK_2026_437_0778` (PR #510 SonarCloud security fix)

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 5/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 1              |
| Serious issues      | 1              |
| Moderate issues     | 2              |
| Failure modes found | 3              |

Scope reviewed: the two uncommitted diffs only —
`libs/backend/platform-electron/src/workspace-watch/workspace-watch-host-rss-sampler.js`
(git diff, `-` lines 21-93 vs `+` lines 21-93/135) and
`libs/backend/agent-sdk/src/lib/internal-query/network-backoff.ts` (diff hunk
`@@ -96,7 +96,11 @@`). Both callers of the sampler were read in full:
`workspace-watch-host.stress.harness.ts:139-149` (`readHostRssKb`) and
`:168-214` (`RssPeakMonitor`). No tests were run, per instruction.

## Five logic questions

### 1. How does this fail silently?

It largely does not — both callers already treat a sampling failure as
"unknown, not asserted" rather than success dressed up as data
(`readHostRssKb` returns `undefined` on any throw,
`workspace-watch-host.stress.harness.ts:141-148`; `RssPeakMonitor.sample()`
reports an `error` IPC message on any throw,
`workspace-watch-host-rss-sampler.js:116-124`). The one place a fix in this
diff can silently fail is not in the sampler code itself: `// NOSONAR
typescript:S2245` (`network-backoff.ts:103`) reads to a human as "this closes
the hotspot," but per SonarSource's own community guidance, NOSONAR comments
do not reliably suppress Security Hotspots the way they suppress ordinary
issues — hotspots are reviewed through a separate workflow (mark
Safe/Fixed/Acknowledged via UI or API), and multiple community reports
describe NOSONAR/pragma-style suppressions having no effect on hotspot state
(see Sources). If that holds for S2245 here, the PR's quality gate will still
show the hotspot as `TO_REVIEW` after merge, while the code and its comment
read as if the finding was addressed — a success-looking result for a task
whose entire point is closing a SonarCloud finding.

### 2. What user action produces unexpected behaviour?

Not user-facing: this is test/stress-harness infrastructure
(`workspace-watch-host-rss-sampler.js` header, lines 1-19) and a background
back-off jitter source. No end-user action reaches either file.

### 3. What input data produces a wrong answer?

- `process.env.SystemRoot` set to something that resolves but is not the real
  Windows system directory (e.g. a container image with `SystemRoot` pointed
  at a stub tree, or a redirected/junctioned directory) is joined with no
  validation (`workspace-watch-host-rss-sampler.js:34-40`): no
  `path.win32.isAbsolute` check, no realpath/escape check. Contrast this with
  the sibling implementation the repo already carries for exactly this
  problem, `resolveWindowsSystemExecutable()`
  (`apps/ptah-electron/scripts/windows-system-executable.js:8-49`), which
  requires `SystemRoot` to be absolute, cross-checks it against `WINDIR`, and
  verifies via `realpathSync` that the resolved executable does not escape
  `SystemRoot` through a symlink/junction. The new sampler does none of that
  — it is not wrong today (a bogus `SystemRoot` most likely yields an ENOENT
  from `execFileSync`, which both callers already handle), but it is a
  materially weaker implementation of the same "find a Windows system
  executable safely" problem the repo has already solved once, in the same
  PR's neighbourhood.
- `SystemRoot` unset: falls back to the literal `'C:\\Windows'`
  (`workspace-watch-host-rss-sampler.js:35`), which is correct on every
  supported Windows layout and matches the documented default.

### 4. What happens when a dependency fails?

- Missing `powershell.exe` at the computed path, or missing `ps` at both
  POSIX candidates: `execFileSync`/`resolvePsExecutable()` throw
  (`workspace-watch-host-rss-sampler.js:61-63`, `86-90`). Both call sites
  already wrap this: `readHostRssKb` swallows to `undefined`
  (`workspace-watch-host.stress.harness.ts:141-148`), and the monitor child's
  `sample()` catches and reports over IPC
  (`workspace-watch-host-rss-sampler.js:116-124`), which
  `RssPeakMonitor.child.on('message', …)` turns into a recorded
  `sampleErrors` entry (`workspace-watch-host.stress.harness.ts:192-194`).
  This is unchanged from the pre-fix behaviour when bare `powershell`/`ps`
  was missing from `PATH` — no regression.
- Linux is unaffected by either lookup: `sampleRssKb` branches on
  `process.platform === 'linux'` first and reads `/proc/<pid>/status`
  directly (`workspace-watch-host-rss-sampler.js:72-75`), before
  `resolvePsExecutable()` is ever reached. The POSIX `ps` path is only live
  on macOS (and any other non-Linux, non-Windows POSIX platform the CI
  machines might run), where `/bin/ps` exists.
- Exotic POSIX platforms where `ps` lives outside `/bin` and `/usr/bin`
  (illumos/Solaris `/usr/bin/ps` is covered; some minimal or non-FHS
  distributions are not) would now report an explicit, correctly-labelled
  error instead of finding the tool via `PATH` — a narrower compatibility
  surface than the bare-name lookup it replaces, in exchange for closing
  S4036. Acceptable here because the actual CI/dev targets are win32, macOS
  and Linux (the last of which never calls this path at all), but it is a
  real, if minor, narrowing worth naming since nothing constrains it further.

### 5. What is missing that the requirements never mentioned?

The requirement, per PR #510's Sonar findings, is "close S4036 and S2245."
For S4036 the diff plausibly does that: Sonar's rule keys off whether the
executable argument is a bare/relative name reachable via `PATH` search;
replacing it with a computed absolute path removes the triggering pattern
entirely (not just an instance of it), the same mechanism the repo's own
precedent (`resolveGitExecutable()`, commit `7fc258681`) already used in this
same PR. For S2245 the diff does the opposite: it leaves the flagged
construct (`Math.random()`) in place and relies on a NOSONAR comment to
suppress it. Nothing in the diff, its comment, or the task brief verifies
that mechanism actually works for a Hotspot-class rule — that verification
step is the missing piece.

## Failure modes

### S2245 hotspot likely reopens on next SonarCloud scan

- Trigger: SonarCloud re-analyzes PR #510 after this commit lands.
- Symptom: the PR's quality gate still lists `typescript:S2245` as
  `TO_REVIEW` (or equivalent), even though the code now carries a
  justification comment — looking, to anyone scanning the diff, like the
  finding was closed.
- Evidence: `network-backoff.ts:99-103` — `Math.random()` is still called;
  only a `// NOSONAR typescript:S2245 — …` comment was added on the same
  line. Community reports (see Sources) describe NOSONAR/inline-suppression
  comments not affecting Security Hotspot status in SonarQube/SonarCloud;
  hotspots are closed by changing their review status (UI "Mark as Safe /
  Fixed / Acknowledged", or the `mcp__sonarqube__change_security_hotspot_status`
  API), not by code comments, because the hotspot workflow tracks a review
  decision independent of whether the analyzer keeps re-raising the
  construct.
- Current handling: none — the diff assumes NOSONAR is sufficient.
- Recommendation: treat the code comment as the human-readable justification
  it already is well-written to be, but pair it with an explicit hotspot
  review: mark the S2245 hotspot "Safe" (with the same justification) via the
  SonarCloud UI or `change_security_hotspot_status`, so the PR decoration and
  the code comment agree. If NOSONAR is later confirmed (by a real SonarCloud
  re-scan of this PR) to close hotspots in this project's configuration, this
  finding is moot — but that confirmation does not exist in the evidence
  reviewed here, and the task brief asked specifically whether NOSONAR "will
  close S2245," which is the open question, not a settled fact.

### Windows executable resolution has no escape/absoluteness guard

- Trigger: `SystemRoot` present but pointing somewhere unexpected (redirected
  profile, container base image quirk, a junction).
- Symptom: `WINDOWS_POWERSHELL_PATH` is computed by blind string-joining
  (`path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', …)`)
  with no check that the result is absolute or stays under the intended root.
- Evidence: `workspace-watch-host-rss-sampler.js:34-40`, contrasted with
  `apps/ptah-electron/scripts/windows-system-executable.js:18-48`, which
  validates absoluteness, cross-checks `WINDIR`, and calls `realpathSync` to
  confirm the resolved file did not escape `SystemRoot`.
- Current handling: none; a bad `SystemRoot` most likely still fails loudly
  via `execFileSync` ENOENT, which both callers already treat as "not
  sampled" — so the practical blast radius today is low, since this is
  test-harness-only code, not a production code path.
- Recommendation: either reuse `resolveWindowsSystemExecutable()` from
  `apps/ptah-electron/scripts/windows-system-executable.js` (it is already
  exported for reuse) or add the same `isAbsolute` + realpath check inline,
  so the two implementations in this codebase of "resolve a fixed Windows
  system executable" do not diverge in rigor.

### POSIX `ps` lookup narrows platform coverage without being scoped to it

- Trigger: a POSIX (non-Linux, non-macOS) CI/dev host whose `ps` lives
  outside `/bin` and `/usr/bin`.
- Symptom: `resolvePsExecutable()` throws
  `workspace-watch RSS sampler: no ps at /bin/ps or /usr/bin/ps` even though
  a working `ps` exists elsewhere on `PATH`.
- Evidence: `workspace-watch-host-rss-sampler.js:41` (`POSIX_PS_CANDIDATES`),
  reached only when `process.platform` is neither `'linux'` nor `'win32'`
  (`:72`, `:77`) — i.e. macOS and other Unix-like platforms.
- Current handling: fails loudly, which both callers already convert into
  "not sampled" / a reported IPC error — not a silent failure, just a
  narrower success surface than before.
- Recommendation: none required for the CI/dev matrix this repo actually
  targets (win32 + macOS + Linux, and Linux never reaches this branch); worth
  a one-line comment noting the two fixed paths are chosen for macOS
  specifically, so a future reader porting this to another POSIX target knows
  to extend the candidate list.

## Blocking issues

### S2245 suppression mechanism is unverified for a Security-Hotspot rule

- File: `libs/backend/agent-sdk/src/lib/internal-query/network-backoff.ts:103`
- Scenario: SonarCloud re-scans PR #510 after this fix is committed.
- Impact: the task's acceptance criterion ("close S2245") is at risk of not
  being met, while the code reads as if it were addressed — the exact
  "success-looking result for a failure" pattern this review is meant to
  catch. Re-opening a PR after merge to chase a hotspot that looks closed in
  the diff is expensive and confusing.
- Fix: mark the hotspot Safe/Acknowledged through SonarCloud's hotspot review
  workflow (UI or `change_security_hotspot_status`) using the same
  justification already written in the code comment, in addition to — not
  instead of — the comment. Confirm against an actual SonarCloud re-scan of
  this PR that the hotspot count drops, rather than relying on NOSONAR alone.

## Serious issues

### Windows path resolution is inconsistent with the repo's own stricter precedent

- File: `libs/backend/platform-electron/src/workspace-watch/workspace-watch-host-rss-sampler.js:34-40`
- Scenario: `SystemRoot` is set but not absolute, or resolves through a
  symlink/junction to a location outside the real system directory.
- Impact: low in practice (this is test-harness-only code and a bad path
  still fails loudly), but it leaves two different rigor levels for the same
  class of problem in the same codebase, one of which (`windows-system-
executable.js`) was clearly written because the simpler form was judged
  insufficient for its use case. A future reader has no way to tell from this
  file alone why the stricter version exists elsewhere and isn't reused here.
- Fix: reuse `resolveWindowsSystemExecutable()` or add the missing
  `isAbsolute`/realpath checks inline.

## Moderate and minor issues

- `workspace-watch-host-rss-sampler.js:41` — POSIX `ps` candidate list is
  correct for the platforms this repo's CI actually runs (macOS; Linux never
  reaches it) but is silently narrower than the previous PATH-search
  behaviour for any other POSIX target. Minor: no action needed, worth a
  comment.
- `network-backoff.ts:99-103` — the justification comment itself is clear and
  well-reasoned (non-secret, bounded, clamped value); the gap is purely
  mechanical (does NOSONAR apply to hotspots), not in the reasoning.

## Data flow

1. `sampleRssKb(pid)` called, either in-process (`readHostRssKb`) or as the
   entry point of a spawned child (`require.main === module`) — OK.
2. Platform branch: Linux reads `/proc/<pid>/status` directly, no exec at all
   — OK, unaffected by this diff.
3. Windows branch: `execFileSync(WINDOWS_POWERSHELL_PATH, …)` — path computed
   once at module load from `process.env.SystemRoot` with no validation; gap
   noted above (Serious), but downstream failure handling is OK.
4. Other-POSIX branch: `execFileSync(resolvePsExecutable(), …)` —
   `resolvePsExecutable()` validates existence via `fs.statSync` before
   caching and before ever being passed to `execFileSync` — OK, this half is
   more careful than the Windows half.
5. Any throw from steps 3/4 propagates to the caller, which either converts
   it to `undefined` (`readHostRssKb`) or reports it over IPC
   (`RssPeakMonitor` child `sample()`, consumed by
   `child.on('message', …)` into `sampleErrors`) — OK, matches pre-existing
   contract.
6. `NetworkBackoff` constructor wires `this.random`; the NOSONAR comment is
   attached to this exact line — mechanically correct placement, but see
   Blocking issue for whether NOSONAR applies to this rule class at all.

## Requirements fulfilment

| Requirement                                     | Status   | Gap                                                                                                                                                                  |
| ----------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fix javascript:S4036 on the Windows branch      | COMPLETE | None found; matches the repo's own accepted `resolveGitExecutable` precedent pattern.                                                                                |
| Fix javascript:S4036 on the POSIX branch        | COMPLETE | None found; fixed-candidate lookup mirrors the precedent, scoped correctly to platforms that reach it.                                                               |
| Fix typescript:S2245 with justification comment | PARTIAL  | Comment is well-written and correctly placed, but NOSONAR is documented as unreliable for Security-Hotspot rules — the actual hotspot-review-status step is missing. |
| Preserve existing error propagation to callers  | COMPLETE | Both `readHostRssKb` and `RssPeakMonitor` behave identically to before on a missing tool.                                                                            |

Implicit requirements not addressed: parity with the repo's own stricter
Windows-executable-resolution precedent (`windows-system-executable.js`) is
not required by the task brief, but its existence in the same PR makes the
simpler version's gaps easy to spot in review — worth at least a comment
explaining why the lighter form is acceptable here (test harness, not
production, ENOENT already handled).

## Edge cases

| Case                                    | Handled | How                                                 | Concern                                                             |
| --------------------------------------- | ------- | --------------------------------------------------- | ------------------------------------------------------------------- |
| Windows, `SystemRoot` set normally      | YES     | `path.win32.join(SystemRoot, …)`                    | None.                                                               |
| Windows, `SystemRoot` unset             | YES     | Falls back to `'C:\\Windows'`                       | None.                                                               |
| Windows, `SystemRoot` odd/redirected    | PARTIAL | `execFileSync` ENOENT bubbles to caller, caught     | No absolute/escape validation, unlike the sibling precedent file.   |
| macOS, `ps` at `/bin/ps`                | YES     | First `POSIX_PS_CANDIDATES` entry, cached           | None.                                                               |
| Linux                                   | YES     | `/proc/<pid>/status` read directly, no exec at all  | None — `resolvePsExecutable` never reached.                         |
| No `ps` at either POSIX candidate       | YES     | Throws a clear error; both callers already catch it | Narrower than the old PATH search, but scoped to macOS in practice. |
| S2245 NOSONAR suppression on SonarCloud | NO      | Comment added, no hotspot-status change             | Documented as unreliable for Hotspot rules; not verified here.      |

## Verdict

- Recommendation: REVISE
- Confidence: MEDIUM — the S4036 remediation is high-confidence correct by
  pattern-match to an already-used precedent in this same PR; the S2245
  finding rests on external SonarQube community documentation rather than a
  live re-scan of this PR (the SonarQube MCP tools in this session returned
  404s and could not confirm hotspot status directly), so treat it as strong
  but not certain evidence.
- Top risk: the PR is merged believing S2245 is closed because a
  well-justified comment sits on the flagged line, when SonarCloud's hotspot
  workflow may not recognize NOSONAR as a resolution at all — leaving the
  quality gate red (or the hotspot silently `TO_REVIEW`) after the work is
  considered done.
- What a robust implementation would add: (1) an explicit SonarCloud hotspot
  review-status change for S2245, verified against a real re-scan of PR #510,
  not just a code comment; (2) either reuse of
  `resolveWindowsSystemExecutable()` or the same absolute/escape checks
  inlined into the RSS sampler, so the codebase has one rigor level for
  "resolve a fixed Windows system executable," not two.

Sources consulted (web, general SonarQube/SonarCloud behavior — SonarQube MCP
tools returned HTTP 404 for `show_rule` and project search in this session
and could not directly confirm S2245/S4036's current status on this project):

- [Fixing/Suppressing Hotspots doesn't improve Security Review Rating — Sonar Community](https://community.sonarsource.com/t/fixing-suppressing-hotspots-doesnt-improve-security-review-rating/39694)
- [How to suppress warning from Security Hotspot? — Sonar Community](https://community.sonarsource.com/t/how-to-suppress-warning-from-security-hotspot/68746)
- [How to configure ignoring security hotspots — Sonar Community](https://community.sonarsource.com/t/how-to-configure-ignoring-security-hotspots/23595)
