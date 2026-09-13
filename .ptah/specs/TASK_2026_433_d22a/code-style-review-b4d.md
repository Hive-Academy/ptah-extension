# Code Style Review — `TASK_2026_433` Batch B4d

## Summary

| Metric          | Value                                |
| --------------- | ------------------------------------ |
| Overall score   | 8/10                                 |
| Assessment      | APPROVED                             |
| Blocking issues | 0                                    |
| Serious issues  | 1                                    |
| Minor issues    | 2                                    |
| Files reviewed  | 11 (6 modified, 5 new/untracked)     |

Scope reviewed: `git diff -- libs/backend/cli-agent-runtime/` at the worktree's
current HEAD, plus the three new collaborator files and their specs. The
overlapping `vscode-lm-tools` diff (B5b) was read only far enough to confirm it
touches no file this batch owns; it is not scored here.

## Five style questions

### 1. What breaks when requirements change in six months?

Not the split itself — `agent-spawn-environment.service.ts:47-82` and
`agent-output-buffer.service.ts:31` show clean, narrow constructors, and
`AgentOutputBuffer` never reaches back into the manager's `agents` map or
`events` emitter; it takes a `TrackedAgent` and an `onFlushDue` callback per
call (`agent-output-buffer.service.ts:52-58`, `84-98`, `105-145`) and hands a
built `AgentOutputDelta` back (`:152-187`). The thing that will break first is
DI wiring: no spec in this diff resolves `TOKENS.AGENT_PROCESS_MANAGER` through
a real tsyringe container with `AgentSpawnEnvironment` and `AgentOutputBuffer`
in it. I built a throwaway probe against
`registerCliAgentRuntimeServices` (same fakes as
`di/register.ptah-cli-registry.smoke.spec.ts`) and it resolved cleanly once
`SETTINGS_TOKENS.REASONING_SETTINGS` was registered — so the wiring is correct
today — but that proof is not committed. A future edit that drops
`@injectable()` from either new class, or breaks the `@inject(AgentSpawnEnvironment)` /
`@inject(AgentOutputBuffer)` pairing in `agent-process-manager.service.ts:319-322`,
compiles fine under ts-jest (unit specs hand-build both collaborators with
`new`, never through the container) and only fails at real host boot, in
production, across all three runtimes at once.

### 2. What would a new team member misread?

Every log line and the one Sentry `errorSource` moved out of
`AgentProcessManager` still say `AgentProcessManager`:
`agent-spawn-environment.service.ts:257-300` (`'[AgentProcessManager] getPreferredCli: ...'`),
`:387-407` (`'[AgentProcessManager] MCP ...'`, `errorSource: 'AgentProcessManager.resolveMcpPort'`),
`:424-428` (`'[AgentProcessManager] Harness preflight failed...'`), and
`agent-output-buffer.service.ts:134-139` (`'[AgentProcessManager] Stream events cap reached...'`).
This is not a mistake — the B4d invariants require every user-facing string
byte-identical, and Sentry/log-search continuity across the split is worth more
than a cosmetic rename — but a reader grepping logs or a Sentry issue for
`AgentSpawnEnvironment` or `AgentOutputBuffer` will find nothing, and would
reasonably assume these two new classes have never logged anything.

### 3. What does this cost to maintain?

The B4d contract deliberately bans a shared test-helper module (batches.md:489),
so the four hand-built-manager spec files (`agent-process-manager.service.spec.ts:341-373`,
`agent-process-manager.restore.spec.ts:59-84`,
`agent-process-manager.workspace-scope.spec.ts:53-79`,
`wiring/sdk-callbacks.spec.ts:361-388`) each carry a near-identical
`new AgentMessageRouter(...) / new AgentSpawnEnvironment(...) / new AgentOutputBuffer(...)`
block. That is a real, acknowledged cost — a future constructor change touches
four call sites instead of one — accepted on purpose so one broken shared
fixture can't silently blind four spec suites at once. The unref-timer guard
duplicated in `AgentOutputBuffer.scheduleFlush` (`agent-output-buffer.service.ts:220-227`,
identical to `AgentProcessManager.unrefTimer` at `agent-process-manager.service.ts`
post-diff line ~1338) is a smaller, unforced version of the same cost: three
lines copied instead of pulled into `agent-process-manager-helpers.ts`, the file
both classes already import shared constants and functions from.

### 4. Where is this inconsistent with the rest of the repository?

It isn't, on the axis that matters most: `container.registerSingleton(ClassRef)`
+ `@inject(ClassRef)` (no explicit token) is an established repo-wide pattern
(`plugin-marketplace/di/register.ts:31-34`, `output-styles/di/register.ts:37-57`,
`cli-engine/container.ts:747-760`), and `di/register.ts:44-49` follows it,
registering both new singletons before `TOKENS.AGENT_PROCESS_MANAGER` exactly as
instructed. The one place this batch stands apart from its closest sibling
(`AgentMessageRouter`, `agent-message-router.service.ts:93-98`) is verification
depth: `AgentMessageRouter` has quietly relied on implicit container
construction for longer, with no smoke spec either — so B4d does not regress
anything, it just adds two more classes to an already-unverified corner of the
graph, at the exact moment `AgentProcessManager`'s constructor doubles its
externally-supplied collaborator count.

### 5. What would you have done differently, and why is that better rather than merely other?

I would have shipped one `AGENT_PROCESS_MANAGER`-resolves-through-the-container
smoke spec in this same batch, in `di/`, following
`register.ptah-cli-registry.smoke.spec.ts`'s shape. It costs about the same as
the throwaway probe I wrote to verify this review (under 130 lines, no new
fakes beyond `SETTINGS_TOKENS.REASONING_SETTINGS`), and it is the only test in
the suite that would catch a decorator or registration-order mistake before a
real host does. Everything else about the cut — which two concerns move, which
five stay, the `TrackedAgent` relocation — I would not change; the design
doc's reasoning for leaving S3/S4/S5/S6 in the manager (shared `agents` map,
shared emitter, `messageRouter`'s back-reference) is sound and the code matches it.

## Blocking issues

None.

## Serious issues

### No DI-container smoke coverage for the two new required collaborators

> **Resolved before the B4d commit.** `di/register.agent-process-manager.smoke.spec.ts`
> now resolves `TOKENS.AGENT_PROCESS_MANAGER` through the real container and
> asserts `AgentSpawnEnvironment` and `AgentOutputBuffer` are singletons injected
> into the manager (see `batches.md`, B4d gate record). The finding below is kept
> as the review recorded it; it no longer describes the committed code.

- File: `libs/backend/cli-agent-runtime/src/lib/di/register.ts:44-49`;
  absence confirmed against
  `libs/backend/cli-agent-runtime/src/lib/di/register.ptah-cli-registry.smoke.spec.ts`
  (the only container-resolution smoke spec in the lib, and it never resolves
  `TOKENS.AGENT_PROCESS_MANAGER`)
- Problem: `AgentProcessManager`'s constructor (`agent-process-manager.service.ts:268-323`)
  now requires two more container-managed singletons, `AgentSpawnEnvironment`
  and `AgentOutputBuffer`, on top of `AgentMessageRouter`, which was already
  unverified this way. Every unit spec constructs the manager and its two new
  collaborators with `new` and hand-rolled fakes (`agent-process-manager.service.spec.ts:341-373`,
  and the three other spec files listed under Q3 above); none goes through
  `registerCliAgentRuntimeServices` + `container.resolve`.
- Impact: a mistake invisible to `tsc` and to every existing spec — a missing
  `@injectable()`, a token swapped for the wrong class, a registration
  reordered past `TOKENS.AGENT_PROCESS_MANAGER` in a way that matters for some
  future non-singleton lifecycle — surfaces only when a real host
  (VS Code, Electron, or `cli-engine`) boots and tries to spawn its first
  agent. I verified empirically, with a temporary probe spec built on the
  `register.ptah-cli-registry.smoke.spec.ts` pattern (registering
  `SETTINGS_TOKENS.REASONING_SETTINGS` in addition to that spec's fakes), that
  `container.resolve(TOKENS.AGENT_PROCESS_MANAGER)` succeeds today — so nothing
  is broken now, but nothing stands guard either. The probe was not committed
  (this review is read-only on source).
- Fix: add one spec under `di/` — `register.agent-process-manager.smoke.spec.ts`
  or similar — that builds a container the way the PtahCliRegistry smoke spec
  does (plus `SETTINGS_TOKENS.REASONING_SETTINGS`) and asserts
  `container.resolve(TOKENS.AGENT_PROCESS_MANAGER)` returns an
  `AgentProcessManager` instance. Not a gate on this commit — the split is
  correct as verified — but cheap enough that it belongs in this batch or the
  very next one, before a third collaborator is added to the same constructor.

## Minor issues

- `agent-output-buffer.service.ts:220-227` duplicates
  `AgentProcessManager.unrefTimer`'s guarded-shape unref check instead of
  pulling a shared helper into `agent-process-manager-helpers.ts`, the file
  both classes already import from (`agent-output-buffer.service.ts:9-21`,
  `agent-spawn-environment.service.ts:26-29`). No drift today; worth folding
  into one function next time either file changes.
- Every relocated log prefix and the one Sentry `errorSource` still name
  `AgentProcessManager` from inside `AgentSpawnEnvironment` /
  `AgentOutputBuffer` (see Q2). Correct under this batch's byte-identical-string
  invariant, but worth a deliberate follow-up rename pass once nobody is mid-way
  through grepping old Sentry issues by the old prefix.

## File-by-file

### `agent-spawn-environment.service.ts` (new, 431 lines)

9/10 — 0 blocking, 0 serious, 1 minor (shared log-prefix naming, see above).
Clean single-purpose collaborator: every public method answers one question
about spawn environment (`resolveModel`, `preferredCli`, `maxConcurrentAgents`,
`sdkIdleReleaseMs`, `scopedWorkspaceRoot`/`workspaceRoot`/`isWithinScope`,
`validateWorkingDirectory`, `mcpPort`, `runHarnessPreflight`), holds no
per-agent state, and its optional constructor deps (`:57-81`) carry the same
tokens, `isOptional: true` and doc blocks the manager had, moved verbatim.

### `agent-output-buffer.service.ts` (new, 228 lines)

8/10 — 0 blocking, 0 serious, 1 minor (unref duplication, see above). Owns
`pendingDeltas`/`flushTimers` cleanly, takes `TrackedAgent` and a callback per
call rather than reaching into manager state, and `takeDelta`
(`:152-187`)/`discard` (`:192-199`) preserve the old `flushDelta`/`cleanupFlushTimer`
ordering (timer cleared first, then pending checked, then tracked checked)
exactly.

### `tracked-agent.ts` (new, 68 lines)

9/10 — plain interface extraction, not exported from any barrel per the
design's instruction ("shared contract, not a cap-driven fragment"), doc
comments moved byte-for-byte from the old in-file `interface TrackedAgent`.
Exempted from the ~150-line floor by name, as batches.md anticipates.

### `agent-process-manager.service.ts` (1,741 lines, was 2,381)

8/10 — 0 blocking, 1 serious (DI smoke gap, shared with the collaborators
above), 0 minor. Constructor now takes 7 parameters (`logger`, `cliDetection`,
`subagentRegistry`, `sentryService`, `messageRouter`, `spawnEnvironment`,
`outputBuffer`, `:268-322`), within the ≤8 guardrail. `MIN/MAX/DEFAULT_CONCURRENT_AGENTS`
re-exported from the new file (`:75-82` of the diff) rather than redefined,
satisfying the invariant that `cli-agents/index.ts`'s exports stay untouched —
confirmed `index.ts` has zero diff. Every call site that used to reach a
now-moved private method reaches the collaborator instead
(`this.spawnEnvironment.preferredCli()`, `.validateWorkingDirectory(...)`,
`.runHarnessPreflight(...)`, `.mcpPort()`, `.resolveModel(...)`,
`.resolveReasoningEffort(...)`, `.resolveAutoApprove(...)`,
`.scopedWorkspaceRoot()`, `.isWithinScope(...)`, `.maxConcurrentAgents()`,
`.sdkIdleReleaseMs()`; `this.outputBuffer.appendOutput/appendSegment/appendStreamEvent/takeDelta/discard`).
No public method signature changed.

### `di/register.ts`

9/10 — both collaborators registered as singletons by class token, both
`container.registerSingleton(AgentSpawnEnvironment)` /
`container.registerSingleton(AgentOutputBuffer)` (`:44-45`) placed before
`TOKENS.AGENT_PROCESS_MANAGER` (`:46-49`) as instructed, matching the
established repo-wide `registerSingleton(ClassRef)` idiom. Not exported from
any barrel — no consumer needs them today, per the design.

### Spec files (`.service.spec.ts`, `.restore.spec.ts`, `.workspace-scope.spec.ts`, `wiring/sdk-callbacks.spec.ts`)

8/10 across the four — no shared test-helper module (as required), each file
owns its own hand-built-manager factory. Assertion audit: all 7
`validateWorkingDirectory` cases removed from `agent-process-manager.workspace-scope.spec.ts`
reappear verbatim (title text included) in
`agent-spawn-environment.service.spec.ts:369-455`; all 5
`getMaxConcurrentAgents()` cases (200→20, `it.each([0,-5])`→1, 12→12, NaN→5)
reappear in `agent-spawn-environment.service.spec.ts:225-259`; the
`manager.flushTimers` cast at the old `agent-process-manager.service.spec.ts:2140`
now reads `outputBuffer.flushTimers` (`:2126-2130` post-diff), exactly as
Task 4d.2 required — no re-added manager field. Nothing is silently dropped.

## Pattern compliance

| Repository rule or nearby convention | Status | Evidence |
| --- | --- | --- |
| Facade rule: public class keeps name, DI token, method signatures | PASS | `agent-process-manager.service.ts` keeps `AgentProcessManager`, `TOKENS.AGENT_PROCESS_MANAGER` (`di/register.ts:46-49`), no public signature diff |
| `cli-agents/index.ts` exports unchanged | PASS | `git status` shows no diff for `cli-agents/index.ts`; `MIN/MAX/DEFAULT_CONCURRENT_AGENTS`, `AgentRoleStamp`, `AgentContinueError*`, `AgentReleaseReason` all still defined/re-exported from `agent-process-manager.service.ts` |
| Collaborator nameability (no helpers/utils/common/misc) | PASS | `AgentSpawnEnvironment`, `AgentOutputBuffer` both name a domain concern |
| No file under ~150 lines except the documented exception | PASS | `tracked-agent.ts` (68 lines) is the named exception; the other two new files are 431 and 228 lines |
| Constructor ≤ 8 injected deps | PASS | 7 parameters, `agent-process-manager.service.ts:268-322` |
| `registerSingleton(ClassRef)` + `@inject(ClassRef)` DI idiom | PASS | `di/register.ts:44-45`; matches `plugin-marketplace`, `output-styles`, `cli-engine` |
| Registration order: collaborators before the manager | PASS | `di/register.ts:44-49` |
| No shared test-helper module across spec files | PASS | 4 independent hand-built-manager factories |
| No assertion silently dropped in the move | PASS | 5 `maxConcurrentAgents` + 7 `validateWorkingDirectory` cases traced 1:1 into the new spec |
| Error strings / log prefixes / Sentry `errorSource` byte-identical | PASS | diff shows moved blocks verbatim; see Minor note on naming residue |
| Timer unref behaviour preserved | PASS | both `unrefTimer` (manager) and `AgentOutputBuffer.scheduleFlush`'s inline guard keep the guarded-shape check |
| `AgentOutputBuffer`/`AgentSpawnEnvironment` reach back into manager state | PASS (no reach-back) | Neither imports the manager; `AgentOutputBuffer` takes `TrackedAgent` + callback per call |
| `wiring/agent-events.ts` / `session-metadata-store.ts` untouched | PASS | absent from `git status` |
| DI container resolves `AgentProcessManager` with the new graph | UNVERIFIED IN SUITE at review time; resolved before commit | `di/register.agent-process-manager.smoke.spec.ts` — see Serious finding |

## Maintenance debt

- Introduced: two new, independently testable collaborators with 46 combined
  new test cases (`agent-spawn-environment.service.spec.ts`,
  `agent-output-buffer.service.spec.ts`); one interface extraction
  (`tracked-agent.ts`); four spec files now each carry ~15-20 lines of
  hand-built collaborator wiring instead of positional constructor args.
- Retired: ~640 lines of mixed-concern private methods and two private maps
  (`pendingDeltas`, `flushTimers`) out of `AgentProcessManager`, which drops
  from 2,381 to 1,741 lines.
- Net: positive. The manager is smaller and closer to one concern (state
  ownership + lifecycle); the tradeoff is a currently-unverified DI edge and a
  small amount of duplicated test scaffolding, both cheap to close.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: no committed spec proves the real tsyringe container can
  construct `AgentProcessManager` with `AgentSpawnEnvironment` and
  `AgentOutputBuffer` in its graph; I confirmed by hand that it does, but that
  proof does not survive this review.
- What a 10/10 version would do differently: ship the
  `di/register.agent-process-manager.smoke.spec.ts` in this same batch, and
  fold the duplicated unref-guard into `agent-process-manager-helpers.ts`.
