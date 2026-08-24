# Code Logic Review - TASK_2026_315 Batch 6 (C1, C4, C5, C7)

## Review Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall Score       | 7/10     |
| Assessment          | APPROVED |
| Critical Issues     | 0        |
| Serious Issues      | 0        |
| Moderate Issues     | 3        |
| Failure Modes Found | 5        |

This batch is unusual — two of four findings (C1, and half of C4) resolved to
"no code change, argument recorded in a comment." Both arguments were checked
against source line-by-line rather than accepted on the report's word. Both
hold up. The two real code changes (the C4 memoized-report fix, C5's logger
routing, C7's log-volume split) were read in full diff, cross-checked against
their specs, and their three claimed fail-before/pass-after tests were
independently spot-checked by reverting the fix and re-running — all three
genuinely latch (C4 and C7 personally reverted and re-run here; C5 verified by
inspection of a symmetric revert plus its own passing suite). No stub, no
placeholder, no TODO in any touched file. No out-of-scope file opened —
`git diff --stat` outside `harness-sync/**` matches the report's 9-file list
exactly.

The reasons this isn't a 9-10: one of the batch's own "pinned by tests" claims
is not actually true (C4's errno-change re-report is asserted in the docblock
comment but not exercised by any test — see Moderate Issue 1), and the two
sibling C5 fixes quietly diverge in two small ways the report does not call
out (ENOTDIR handling, and whether the "genuinely unreadable" branch is
throttled at all). None of these are wrong enough to send the batch back, but
a reviewer who only read the report's tables would not know they exist.

## The 5 Paranoid Questions

### 1. How does this fail silently?

The `reportedScanFailures` / `reportedUnreadableSkills` / `reportedSkillsDirFailures`
memo structures are all `Map`/`Set` fields with no eviction beyond a per-key
`delete` on success. In a long-running Electron session (this app's default
mode — CLAUDE.md describes an always-on desktop app, not a short CLI
invocation) that opens and closes many distinct workspace folders over hours
or days, each distinct `(dir, errno)` pair the user's machine has ever
produced stays in memory until that exact directory reads successfully again.
This will not visibly break anything — the practical cardinality is bounded by
"how many workspace folders you opened this session," realistically dozens,
not a genuine leak — but it is memory that grows and is never proactively
reclaimed, and nothing here would surface that growth if it were ever wrong
(e.g., a pathological caller passing a fresh, non-deduplicated path per call).

### 2. What user action causes unexpected behaviour?

None of the four fixes change return values or user-facing results — `discoverAgents`,
`discoverSkillsForPlugins`, `discoverCommands`, and `emitVecLoadDiagnostic`
all still produce the same lists / same total-failure diagnostics as before.
The only behavioural surface is log volume and level, which is exactly what
each finding asked to fix. The closest thing to a user action with a changed
outcome is: a user whose `.claude/skills` directory becomes unreadable
(permissions changed) will now get exactly the same Sentry-reporting cadence
as before C5 (the report is explicit that this branch is deliberately left
"as before" for `CommandDiscoveryService"), while the sibling `AgentDiscoveryService`now throttles its equivalent warn branch to once per errno. A user who hits
both failure modes back to back would see asymmetric behaviour between`autocomplete:agents`and`autocomplete:commands` with no comment explaining
why one throttles the real-fault case and the other does not (see Moderate
Issue 2).

### 3. What data makes this produce wrong results?

Nothing found produces a _wrong_ result — the worst case in every fix is a
duplicate log line or a missed throttle, never a wrong skill list, wrong
title, or wrong diagnostic payload. The one place data shape matters is
`plugin-loader.service.ts`'s `errnoOf`-equivalent inline code: `error.code`
read off a caught `unknown` without an `instanceof Error` check first (it
checks `typeof error === 'object'` directly, which is correct and matches the
`agent-discovery.service.ts` twin) — both are defensive against a thrown
non-Error value, which is exactly the kind of thing a stub `fs` mock or a
worker-thread rejection can produce.

### 4. What happens when dependencies fail?

- `TOKENS.LOGGER` failing to resolve: both `agent-discovery.service.ts` and
  `command-discovery.service.ts` register it as a plain constructor
  dependency (not optional), so a missing registration is a hard DI-container
  throw at construction time, not a silent no-op. That is the existing house
  pattern (`register.ts:67` already asserts LOGGER is registered before this
  lib's services are built), so this fix does not introduce a new failure
  surface — it inherits one that already existed for every other consumer of
  the injected `Logger`.
- `SentryService.captureException` throwing: not applicable to C5's changed
  branch — `captureException` is called unconditionally as before, in a
  fire-and-forget style consistent with the rest of the file. Not evaluated
  further as C5 did not touch this contract.
- `fs.readFileSync`/`fs.readdir` failing with an error object lacking `.code`:
  handled — `errnoOf`/`isEnoent` both default to `''`/`false` on a shapeless
  error rather than throwing.

### 5. What's missing that the requirements didn't mention?

The tasks.md acceptance criteria for C5 say "a directory that exists and is
genuinely unreadable... is still surfaced." It does not say "at what
cadence," so `command-discovery.service.ts`'s decision to leave the EACCES
branch completely unthrottled (full warn + Sentry capture on every actual
scan) technically satisfies the letter of the requirement. What is missing is
any acknowledgment that this decision is asymmetric with its own sibling fix
in the same file family, done in the same commit, for the same finding
number. A future reader diffing the two services for "why does one throttle
its real-fault branch and the other doesn't" has to reconstruct the reasoning
from scratch; the report's summary table hides this by describing both as
"unchanged... as before" without flagging that "before" was already
inconsistent between the two files.

## Failure Mode Analysis

### Failure Mode 1: C4's errno-change re-report claim is asserted but untested

- **Trigger**: A skill's `SKILL.md` first fails with `ENOENT` (file absent),
  gets reported once, then later fails with `EACCES` (permissions changed,
  file present but unreadable) without ever having read successfully in
  between.
- **Symptoms**: None visible in practice — by inspection, `reportUnreadableSkill`
  compares `this.reportedUnreadableSkills.get(skillMdPath) === code`, and a
  changed `code` value will correctly fail that comparison and re-log. The
  logic is sound.
- **Impact**: Low as a functional risk (the logic is simple enough to trust by
  reading), but the report's own text claims this is "pinned by tests" among
  "Three properties, all pinned by tests" in `batch-6-report.md` line
  188-195. It is not. `plugin-loader.service.spec.ts`'s only errno-adjacent
  test (`'picks a repaired root back up, and reports it again if it breaks
anew'`) drives ENOENT → readable → ENOENT again — the failure mode never
  changes across that test, so it cannot distinguish "keyed by path" from
  "keyed by (path, errno)". A regression that changed the memo key back to
  path-only would pass every existing test.
- **Current handling**: Correct by inspection, unverified by test.
- **Recommendation**: Add one more case to the "broken-root log volume"
  describe block: break with ENOENT, let it log once, then re-break the same
  path with a mocked EACCES (or any different `NodeJS.ErrnoException.code`)
  without an intervening successful read, and assert a second debug line
  fires. This is a one-test gap, not a design gap.

### Failure Mode 2: C5's two sibling fixes throttle differently with no stated reason

- **Trigger**: `.claude/skills` (command-discovery) vs. `.claude/agents`
  (agent-discovery) both become genuinely unreadable (EACCES/EPERM) on the
  same machine.
- **Symptoms**: `AgentDiscoveryService` logs the warn once per `(dir, errno)`
  and goes quiet; `CommandDiscoveryService` logs the warn and calls
  `sentryService.captureException` on every single scan for as long as the
  fault persists — unthrottled, exactly as it was pre-fix. A user with a
  broken skills directory will generate one Sentry event per cache
  invalidation (workspace switch, file-watcher-triggered rescan) for the
  entire time the directory stays broken; the twin AgentDiscovery path would
  not.
- **Impact**: Bounded in practice, because both services front their scan with
  a `searchAgents`/`searchCommands` cache that only calls the raw
  `discoverAgents`/`discoverCommands` scan on a cache miss (workspace change,
  watcher-driven invalidation) rather than on every RPC call or keystroke —
  confirmed by reading `command-discovery.service.ts:295` and the identical
  pattern in `agent-discovery.service.ts`. So this is not the "per keystroke"
  Sentry storm it would be without that cache, but it is still materially
  noisier than the sibling fix for the identical class of problem, in the
  identical PR, with no comment explaining the asymmetry.
- **Current handling**: Deliberate per the report's table ("as before"), but
  the report frames both branches as symmetric ("Both sites route through the
  injected logger... A directory that exists but is genuinely unreadable...
  is still surfaced") without noting one throttles and the other does not.
- **Recommendation**: Either apply the same per-errno memo to
  `CommandDiscoveryService`'s warn branch (cheap, consistent), or add one
  sentence to the code comment explaining why the two should differ. Not
  blocking — the acceptance criterion ("still surfaced, not swallowed") is
  met either way.

### Failure Mode 3: `ENOTDIR` is an absence signal in one file and a real fault in its sibling

- **Trigger**: A path segment above `.claude/skills` or `.claude/agents`
  turns out to be a file rather than a directory (e.g. a stray `.claude` file
  instead of folder — plausible after a botched extraction or a case-insensitive
  filesystem collision).
- **Symptoms**: `agent-discovery.service.ts`'s `ABSENT_DIR_ERRNOS` treats this
  as the normal "not there" case (debug, throttled). `command-discovery.service.ts`'s
  `isEnoent` only recognises `'ENOENT'`, so the identical condition on the
  skills side is classified as "genuinely unreadable" (warn + Sentry, every
  scan per Failure Mode 2's cadence).
- **Impact**: Low-probability trigger (a directory-shaped path becoming a file
  is rare), but the two implementations disagree on what "absent" means for
  the same underlying OS condition, in the same batch, addressing the same
  finding.
- **Current handling**: Not addressed; likely not noticed because ENOTDIR
  practically never fires for these specific paths.
- **Recommendation**: Either widen `isEnoent` to match `ABSENT_DIR_ERRNOS`, or
  document why skills specifically should treat ENOTDIR as a real fault.
  Cosmetic; not blocking.

### Failure Mode 4: C1's "no user-visible symptom" conclusion rests on one session's absence of an effect, not a proof of its absence in general

- **Trigger**: A machine/workspace where `importFromSessionsIndex`'s
  `fromIndex` is non-zero — i.e., a fresh session import that actually reads
  `entry.customTitle` from the CLI's own `sessions-index.json` for a brand-new
  session, rather than skipping every entry because metadata already existed.
- **Symptoms**: Unknown and unknowable from this repo alone. Whether the
  Claude Code CLI ever writes an AI-generated title into `customTitle` (as
  opposed to only into the pruned `ai-title` sidecar files) is external CLI
  behaviour this codebase does not control and has no visibility into. If it
  does, then on such a machine the failed `generate_session_title` call could
  plausibly mean a truncated-first-prompt name displays where a nicer
  CLI-generated title would have, which is a real (if minor) product
  difference the captured log's `fromIndex: 0` cannot rule out one way or the
  other.
- **Impact**: Low even if this is true — the report's stronger and
  independent argument (a fix would ship an Anthropic model id to an
  `ollama-cloud`-only endpoint, breaking working same-tier queries, and would
  violate the `deriveTiersFromCatalog` "no invented ids" invariant, confirmed
  verbatim in `auth-providers/CLAUDE.md:59-61`) does not depend on this branch
  ever mattering. Even if `fromIndex` were non-zero somewhere, the "obvious
  fix" is still wrong for the same credential-mismatch reason.
- **Current handling**: The report and its code comment both honestly flag
  this as the weak point and do not overclaim past it — the code comment says
  "contributed zero entries in that run," not "never matters," and a separate
  "Could not determine" section admits the curator one-shot queries' actual
  success/failure is unobservable from the log either way.
- **Recommendation**: None required — this is disclosed uncertainty, not a
  defect. Noted here because the task explicitly asked this branch to be
  probed as the argument's weak point, and probing it does not break the
  conclusion.

### Failure Mode 5: Unbounded per-process memoisation maps have no upper bound or TTL

- **Trigger**: A very long-running Electron session (days) that opens many
  distinct workspace roots, each missing the relevant `.claude/*` directory.
- **Symptoms**: `reportedScanFailures` (agent-discovery), `reportedSkillsDirFailures`
  (command-discovery), and `reportedUnreadableSkills` (plugin-loader) all grow
  by one entry per distinct `(path[, errno])` ever seen, with `delete` firing
  only on that exact key's next success. None has a max-size cap or a
  clear-on-dispose hook tied to `dispose()` (which only clears `watchers`, not
  these new fields, in either autocomplete file).
- **Impact**: Negligible for realistic session lengths — the keys are bounded
  by distinct filesystem paths a real user's workspace switching can produce,
  not by request volume, so this is not the "180 items, 58 human prompts"
  class of leak this codebase has hit before (per `agent-sdk/CLAUDE.md`'s
  queued-command history). Flagged because "practically fine today" and
  "structurally unbounded" are different properties, and the codebase's own
  CLAUDE.md conventions elsewhere favour explicit bounds over "it's small in
  practice."
- **Current handling**: Not addressed.
- **Recommendation**: Optional follow-up only — clearing these maps in each
  service's existing `dispose()` would cost one line per service and closes
  the theoretical gap for whatever hosts actually call `dispose()` on
  workspace teardown.

## Critical Issues

None found.

## Serious Issues

None found.

## Data Flow Analysis

```
C4 — discoverSkillsForPlugins(pluginPaths)
  for each pluginPath:
    readdirSync(skillsDir) --fails--> continue (unrelated to C4, unchanged)
    for each entry:
      statSync(entryPath) --fails--> continue (unchanged)
      readFileSync(skillMdPath)
        success --> reportedUnreadableSkills.delete(path)   [ANNOTATED: clears any prior errno]
                --> push skill                              [unchanged shape/order]
        failure --> reportUnreadableSkill(path, error)
                      code = error.code ?? ''
                      map.get(path) === code ?  RETURN (suppressed)
                                              :  map.set(path, code); logger.debug(...)
                --> continue (skill still skipped, unchanged)

C5 — scanAgentDirectory(dir) / scanWorkspaceSkills(dir)
  fs call fails
    errno in {ENOENT, ENOTDIR} (agent) / === 'ENOENT' (command)
      key = `${dir}::${errno}`   (agent)   |   key = dir   (command)
      seen before? RETURN quiet : record + logger.debug
    else (real fault)
      agent: same per-(dir,errno) memo, logger.warn once per mode
      command: NO memo — logger.warn + sentry.captureException EVERY scan
  fs call succeeds
      agent: delete every reportedScanFailures key prefixed `${dir}::`
      command: reportedSkillsDirFailures.delete(dir)

C7 — emitVecLoadDiagnostic(diagnostic)
  module-level `vecLoadDiagnosticEmitted` latch: only ever runs once per process
  diagnostic.ok === true  --> console.debug, {ok, reason, attemptedPath, packageName, fsExists, attempts}
                               (no chain, no error — INTENTIONALLY DROPPED)
  diagnostic.ok === false --> console.warn,   {..full payload.., chain, error}
                               (UNCHANGED shape from before the fix)
  !diagnostic.ok           --> Sentry breadcrumb (unchanged, gated on sentry.isInitialized())
```

### Gap points identified

1. C4/C5's memoisation state lives on the service instance with no eviction
   tied to `dispose()` — see Failure Mode 5. Not a functional gap, a
   housekeeping one.
2. C5's two sibling implementations disagree on which errno values count as
   "absent" and on whether the "real fault" branch is throttled at all — see
   Failure Modes 2 and 3. Neither breaks the stated acceptance criteria.
3. C4's memo-key correctness for the errno-change scenario is unverified by
   test — see Failure Mode 1.

None of these gaps sit on the path between "user does X" and "user sees wrong
data" — they sit entirely in logging/observability plumbing, which is exactly
the category all four findings in this batch belong to.

## Requirements Fulfillment

| Requirement (tasks.md Batch 6)                                                                        | Status                                             | Concern                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6.1 (C1): confirm symptom before choosing a fix; either justified change or written no-change finding | COMPLETE                                           | Symptom stated as observation with line-numbered evidence; no-change argument verified against source and holds even at its stated weak point                                                   |
| 6.1: do not change `ModelResolver`'s tier substitution                                                | COMPLETE                                           | `git diff --stat` confirms only `workspace-provider-profile-resolver.ts` touched, comment-only                                                                                                  |
| 6.2 (C4): broken root reported once, not once per call                                                | COMPLETE                                           | Verified via revert-probe: reverting the memo-key check reintroduces the failure                                                                                                                |
| 6.2: root that becomes readable is still picked up                                                    | COMPLETE                                           | Tested directly (`'picks a repaired root back up...'`)                                                                                                                                          |
| 6.2: if staging guard has a real hole, fix it; if not, say so with evidence                           | COMPLETE                                           | `listSkillSlugs`'s `fs.access` gate at `:133-140`/`:356-375` traced and confirmed to admit only verified slugs; residue explained by a distinct, correctly out-of-scoped non-atomic-move theory |
| 6.3 (C5): both sites route through the logger, not console                                            | COMPLETE                                           | Confirmed in diff for both files; test asserts `console.debug` not called                                                                                                                       |
| 6.3: missing directory not a per-call emission                                                        | COMPLETE                                           | Tested (3 calls -> 2 debug lines for 2 dirs)                                                                                                                                                    |
| 6.3: genuinely unreadable directory still surfaced                                                    | COMPLETE (asymmetric cadence — see Failure Mode 2) | Both files surface it; only `AgentDiscoveryService` also throttles it                                                                                                                           |
| 6.4 (C7): expected miss + successful fallback logs at debug, not error block                          | COMPLETE                                           | Verified via revert-probe                                                                                                                                                                       |
| 6.4: total failure still prints full chain                                                            | COMPLETE                                           | Verified via revert-probe and direct read of the failure branch                                                                                                                                 |
| 6.4: `attemptedFallbacks` reporting on success path preserved                                         | COMPLETE                                           | `sqlite-connection.service.ts` confirmed untouched (`git diff --stat` empty for that file); `attempts` field retained in the new payload                                                        |

### Implicit requirements not explicitly addressed

1. Consistency between the two C5 sibling fixes (throttle cadence, errno
   classification) was never stated as a requirement, but a reader fixing
   "the same smell, same lib" (as the task literally describes it) would
   reasonably expect the same shape in both places.
2. A test proving the errno-keyed design in C4 actually discriminates
   different failure modes (not just presence/absence of failure).

## Edge Case Analysis

| Edge Case                                                                 | Handled                       | How                                                                               | Concern                                                                        |
| ------------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Directory absent (ENOENT)                                                 | YES                           | Debug, throttled, both C5 sites                                                   | None                                                                           |
| Directory present but unreadable (EACCES)                                 | YES                           | Warn, throttled in agent-discovery; warn+Sentry unthrottled in command-discovery  | Asymmetric cadence, not a correctness bug                                      |
| Directory absent via ENOTDIR                                              | PARTIAL                       | Treated as absence in agent-discovery; treated as real fault in command-discovery | Inconsistent, low-probability trigger                                          |
| Skill dir repaired mid-session                                            | YES                           | Scan not cached — re-read every call; log memo cleared on success                 | Verified by test                                                               |
| Skill dir errno changes without an intervening success (ENOENT -> EACCES) | LOGICALLY YES, UNTESTED       | Map keyed by `(path, errno)`, mismatch re-logs                                    | No test exercises this exact transition                                        |
| sqlite-vec fails every strategy                                           | YES                           | Full chain, error, and host facts preserved unconditionally                       | Verified by revert-probe                                                       |
| sqlite-vec loads via primary resolver directly (no fallback)              | YES (by construction)         | `errorChain` empty, `attempts: 0`, same debug shape                               | Not separately tested but same code path as the tested fallback case, low risk |
| Long-running process accumulating memo keys                               | NOT ADDRESSED                 | No TTL/cap/dispose hook                                                           | Practically bounded; theoretically unbounded                                   |
| C1: session import with `fromIndex > 0`                                   | NOT OBSERVABLE FROM THIS REPO | External CLI behaviour                                                            | Disclosed as uncertain by the report itself; does not change the conclusion    |

## Integration Risk Assessment

| Integration                                                                                      | Failure Probability | Impact                                                                                                                                                                           | Mitigation                                                           |
| ------------------------------------------------------------------------------------------------ | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `TOKENS.LOGGER` DI registration missing in a future host                                         | LOW                 | Hard throw at construction, same as every other `Logger`-consuming service in this lib                                                                                           | Pre-existing pattern, not introduced here                            |
| Sentry captureException volume from a genuinely broken `.claude/skills`                          | LOW-MED             | Cost/noise in Sentry, bounded by cache-invalidation frequency rather than request frequency                                                                                      | Not mitigated by this batch; pre-existing behaviour left "as before" |
| `sqlite-connection.service.ts` diverging from `diagnostics.ts`'s expectations in a future change | LOW                 | `emitVecLoadDiagnostic` reads only documented `VecLoadDiagnostic` fields; no coupling beyond the existing type                                                                   | None needed                                                          |
| `plugin-loader.service.ts` memo map interacting with plugin uninstall/reinstall cycles           | LOW                 | Keys are stable absolute paths; an uninstalled-then-reinstalled plugin at the same path correctly re-evaluates on the next read attempt (delete-on-success / same-code-suppress) | None needed                                                          |

## Verdict

**Recommendation**: APPROVE
**Confidence**: HIGH
**Top risk**: None blocking. If forced to name one to watch: the C5 cadence
asymmetry between `AgentDiscoveryService` and `CommandDiscoveryService` for a
genuinely broken, persistent permissions fault — bounded by the existing
cache layer today, but the two "same smell, same lib" fixes no longer behave
identically, and nothing records why.

All stated acceptance criteria for Task 6.1-6.4 are met. Both "no code
change" arguments (C1 in full, half of C4) were independently verified
against source rather than accepted from the report, including the
specifically flagged weak point in C1's argument (the `fromIndex: 0` branch)
— probing it does not overturn the conclusion because the credential-mismatch
argument is independent of it. The three claimed fail-before/pass-after
regression tests were spot-checked by reverting the underlying fix (C4 and
C7, directly, in this session) and by inspection (C5); all genuinely fail
without the fix and pass with it. `npx nx run-many -t test lint typecheck -p
agent-sdk workspace-intelligence thoth-runtime auth-providers persistence-sqlite`
(run via the `run-many` form specifically to avoid the documented single-project
trap) is green — 0 lint/typecheck errors, all relevant suites passing (persistence-sqlite's
native-binary suites skip in this sandbox on an unrelated `NODE_MODULE_VERSION`
mismatch, not caused by anything in this diff).

None of the moderate issues found block landing: they are a missing test for
an already-correct code path (C4), a documented-but-unflagged asymmetry
between two sibling fixes (C5), and a theoretical unbounded-growth pattern
common to memoisation-by-Map that is bounded in practice by real filesystem
cardinality. Recommend folding Failure Mode 1's extra test into this batch
before merge if convenient, but do not consider it a gate.

## What Robust Implementation Would Include

- A single shared "report-once" helper (e.g. `ThrottledLogger` keyed by
  `(subject, mode)`) used by all three call sites in this batch instead of
  three hand-rolled `Map`/`Set` fields with three slightly different
  policies — would have made the C5 asymmetry structurally impossible rather
  than something a reviewer has to notice by diffing two files.
- A test matrix for C4/C5's memo keys that explicitly drives every
  `(absent, present-unreadable, present-readable)` transition pair, not just
  the two pairs each spec happened to cover.
- A `dispose()` hook clearing the memo state, so a workspace-scoped service
  does not carry log-suppression state for directories that belonged to a
  workspace the user closed an hour ago.
- For C1: since the actual gap is "Ptah cannot see whether the CLI's title
  feature ever succeeds," a follow-up (out of scope here) could have the SDK
  wrapper capture the CLI's own `[claude-code:unrecognized_model]` outcome
  distinctly from other stderr noise, so a future investigation would not
  need to re-derive "is this advisory or fatal" from raw log line adjacency.
