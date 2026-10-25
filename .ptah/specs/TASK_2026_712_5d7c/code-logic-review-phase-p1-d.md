# Code Logic Review — TASK_2026_712 Phase P1-D (Batches 16–22, first-parent 8fa5c01d9..d9bb1c0b9)

- Review family: **glm-5.3:cloud (Ollama)** on **OpenAI (Codex)** implementer work
- Method: static read. `git diff 8fa5c01d9..d9bb1c0b9 -- <file>` per file, plus full reads of the named-admission and gate code. No tests, nx, tsc, lint or build were run (per the review rules).
- Score: **7/10**
- Verdict: **APPROVED WITH FIXES** (0 Blocking, 0 Serious, 3 Moderate, 6 Minor)

Release-hold posture (D7) is enforced at two independent layers: the SDK-side ports are
registered as `useFactory: () => null` (`libs/backend/agent-sdk/src/lib/di/register.ts`),
and the store-side admission itself always refuses
(`provider-account.service.ts:66-68` returns `this.refusal('release-held')` with the
comment "certification and successful admission belong to later batches"). Because of
that, no reservation can be created in production today, so no named prompt or content
can reach the SDK on any route I traced. The findings below are availability, precision
and latent-certification defects, not release-hold holes.

## Findings

| # | Severity | File:line | Scenario | Fix |
| --- | --- | --- | --- | --- |
| F1 | Moderate (certification-blocking) | `claude-sdk-lane-runner.ts:615-637` | After certification, a named lane finishes. `closeMailbox` (`:93-101`) calls `dispose()`. The settlement microtask (`:615-626`) checks `this.child.exited` at `:618`, but `this.child?.close()` at `:634` only just ran — the exit event has not landed — so the branch takes `retainUnresolvedReservation` (`:623`). `dispose()` is one-shot (`:609`), so no later code re-tries the release when the child is finally known closed. The service comment says "Never sweep persisted reservations" (`provider-account.service.ts:84`). Repeated named lanes then pin the account's run slots until an epoch bump. | Inside the settlement, await the child's exit (or a bounded close-confirm promise) before choosing release vs retain, so the 'child-closed' release is reachable; or make retain mark the lease for TTL reconciliation with an epoch-checked sweeper. |
| F2 | Moderate | `session-metadata-store.ts:1004-1021` | One session row with an unparseable or partial `accountBinding` (partial write, disk corruption, manual edit) makes `getAll()` throw: every row is mapped through `validateAccountLinkage` (`:1009`, `:1011`, `:1021`). The whole session listing, history enumeration and any consumer of `getAll` fails for ALL sessions, ambient included. Fail direction is safe (no silent ambient fallback) but the availability blast radius is one corrupted row to all sessions. | Wrap the per-row mapping in a try/catch: skip and collect the bad rows (with a marker field) instead of failing the list; keep the throw for single-session reads. |
| F3 | Moderate | `agent-process-manager.service.ts:2047-2049` | A transient storage error during a claude-lane `continue` now runs `this.handleExit(agentId, 1, null)` and throws `LaneAccountResumeError`, while the ambient path keeps `AgentContinueError('start_failed')`. The lane is killed, and any caller that maps continue errors by type gets a new, unmapped error class. Fail-closed direction is correct; the error contract is not. | Keep the fail-closed exit, but either carry the account refusal code inside `AgentContinueError`, or add `LaneAccountResumeError` to every continue-error mapping in the RPC/UI layer. |
| F4 | Minor | `session-query-executor.service.ts:646`, `:651`, `:724`, `:1270` | The wait/deadline and catch paths rethrow a bare `namedAccountRefusal()`, collapsing the specific admission code ('stale-epoch', 'conflict', 'invalid-bound') into the default. An operator sees generic text and cannot tell an epoch race from a binding conflict; debugging and telemetry lose the discriminator. | Thread the caught code into the refusal payload before rethrow. |
| F5 | Minor | `sdk-query-options-builder.ts:1650` | For named sessions the model check is `if (models.length && !models.some(...))`. A probe that returns `[]` (unknown install, probe failure) skips validation entirely, so any `resolvedModel` passes. The named session then starts with a model the account may not have, and the failure surfaces mid-session instead of at admission. | For named, treat an empty probe result as a refusal, or mark the model 'unknown' in the session config so the failure is attributable. |
| F6 | Minor | `lane-resume-gate.ts:170-189` (`laneAccountFields`, `snapshotLaneAccountReference`) | An unparseable local account reference produces the `{accountBinding: null}` sentinel, which `snapshotLaneAccountReference` maps to `undefined` — indistinguishable from "never bound". For claude lanes the authoritative store is still consulted (`:211-214`), so no named leak, but the corrupt-local case is recorded as plain ambient instead of a distinct corruption code. | Map the corrupt sentinel to 'invalid-bound' rather than to absence. |
| F7 | Minor | `claude-sdk-lane-runner.ts:215-229` | `handle.continue` checks `closed || aborted` at `:216`, enqueues at `:220` (which can commit the gate turn), then checks `closed || aborted` again at `:221-222` and throws. If the lane closes between commit and the second check, the caller receives a refusal although the turn was pushed; a UI retry enqueues a second turn. | Return the refusal through the turn result instead of throwing after commit, or drop the second check and let the committed turn settle the promise. |
| F8 | Minor (latent — unreachable while admission refuses) | `chat-session.service.ts` `gateAccount` inherited-source branch | A child chat of a bound parent, in a workspace whose active auth method is no longer `claudeCli`, gates on the workspace default only; the parent binding is not read. After certification: parent bound to account A, user switches the workspace to an API key, opens a child chat of that parent → the child starts ambient and copies the named parent's conversation into a different account. Today unreachable because no session can be bound (`admitClaudeRoute` refuses at `provider-account.service.ts:68`). | In that branch, also read the parent's local binding and refuse 'conflict' when one exists, before the child copies parent context. |
| F9 | Minor | `agent-process-manager.service.ts:1955` | `cliSessionId: tracked.info.cliSessionId ?? ''` feeds the lookup schema. A claude lane whose session id has not resolved yet produces a schema failure on `min(1)` and surfaces as 'invalid-bound' — a misleading code for "no session id yet". | Pass `undefined` and let the gate produce a distinct code such as 'no-session'. |

Dropped after verification (not defects): the ambient error-path cleanup was suspected
lost when `runSdk`'s catch lost `mailbox.close(); disposeCallbacks(); lanePlanLimits.end()`
(old `claude-cli.adapter.ts:208-212` at 8fa5c01d9). The cleanup moved into the runner and
is complete on all paths: sync query throw `claude-sdk-lane-runner.ts:109-115`, stream
failure/completion `finish()` `:156-170` (mailbox, callbacks, `stopProxy`, plan limits,
pending turns). Ambient parity holds here.

## Guarantee checklist

| # | Guarantee | Verdict | Evidence |
| --- | --- | --- | --- |
| 1 | AMBIENT unchanged byte-for-byte | PASS with one judged deviation | Executor: every ambient branch is `named ? ... : original` (parity on streamInput, resume, errors). Runner: ambient stream-loop log keeps the original message (`claude-sdk-lane-runner.ts:177-179`); cleanup preserved (see dropped finding). Logs: ambient lane log text unchanged (c124a1e4b). Gates: `gateAccount` returns early when no accounts service, no selection, no session id; hosts without `ProviderAccountService` keep exact ambient behavior. Roster: 'claude' is not in `SYSTEM_CLI_TYPES` / `CliDetectionService`, so no ambient claude lane can spawn today; DI `accountBindings` absence (`register.ts:100-186`) is therefore currently inert. **Deviation (the brief's open item):** ambient start, continue, resume, child, handoff, slash, fork and rewind now perform account-store reads (`gateMainSessionAccount` → `resolveAccountBinding` → `lookupBySdkSession`), and a storage failure refuses an operation that previously ran. Judgment below. |
| 2 | Named admission release-held, fail-closed | PASS | Two layers: SDK ports null (`agent-sdk/src/lib/di/register.ts`, `useFactory: () => null` with the documented tsyringe reason) and store admission refusing 'release-held' (`provider-account.service.ts:66-68`). Bootstrap child is control-only: tmpdir cwd, `settingSources: []`, no tools, no MCP, deny-all `canUseTool`, `persistSession: false`, `maxTurns: 1` (`claude-sdk-lane-options.ts`); no workspace, resume or task material reaches it. Real prompt sits behind empty gates that commit only after the full binding checkpoint (`claude-sdk-lane-runner.ts:590-605` gate commit; executor `:735-755`). |
| 3 | Immutable binding; refusals before any work | PASS | Both identity probes check `sameNamedIdentity` (executor `:701`, `:752`; runner baseline `:781-784`); unknown identity never relabelled known (`:668` refuses resume for unknown stored identity); binding equality includes the stored-epoch rule (`stored ? binding.authEpoch > route.authEpoch : !==`); `_saveInternal` preserves an existing binding through merges and refuses binding conflicts (`session-metadata-store.ts`); zod strict schemas with zero-based revisions. Fork and rewind gate BEFORE transcript copy / rewind work (`session-rpc.handlers.ts` calls `gateSessionAccount`, and rewind rethrows `outcome.accountRefusal`); slash gate precedes native intercept; child/handoff gates run before MCP/session config. |
| 4 | Both stores must agree; write failures refuse | PASS | `resolveAccountBinding` (`session-metadata-store.ts:722`) requires the authoritative link AND metadata `accountBinding`, same profile and epoch; `getAccountBound` re-checks on read; `saveAccountBound` forces a flush for bound metadata; `attachSdkSession` is atomic with 'session-linked-elsewhere' / 'run-linked-elsewhere' refusals; an incomplete checkpoint is never resumable because gates close (`:631`) and abort (`:633`) before commit. |
| 5 | Lease safety | PASS as specified, with F1 | Release is called at most once (`dispose()` one-shot `:609`); never released before child closure is known (uncertain child retains, `:618-623`); uncertain retention is exactly the conservative direction the guarantee demands. F1 records that the retained lease has no later release path once admission goes live — an operational gap the guarantee text does not cover but certification must. Both settlement endpoints are stubs returning 'conflict' today (`provider-account.service.ts:74-80`), unreachable while admission refuses. |
| 6 | Every internal caller gated | PASS with F8 | Gated: `startSession`, `continueSession`, `resumeSession` (skipped only for `ptahCliId` resumes, which carry the lane gate instead), the resume-activation entry (gate before `hasLiveSessionStream`), auto-resume preflight (`AutoResumePreflight extends MainSessionAccountSelection`), `startAgentChildSession`, `startHandoffSession`, slash (`routeContinueCommand` gate before `interceptResult.action === 'native'`), fork and rewind, CLI lanes (`continueAgentLane` `accountScoped` `agent-process-manager.service.ts:1950-1952`, `gateResume`, `lane-resume-gate.ts:211-235` always requires the port for claude), restored lanes (restore spreads `laneAccountFields` and `accountScoped` re-checks), separate child chats (F8 branch), SDK-side `executeSlashCommand` / live-session resume refusal (`sdk-agent-adapter.ts`), named import (refused without the lookup port). |
| 7 | No raw paths, tokens or account ids in logs or prompts | PASS | Named stream-loop error logs fixed text ('[ClaudeLane] Stream loop failed.', `claude-sdk-lane-runner.ts:176`); settlement logs fixed text (`:628`); named stderr collapses to generic debug text (`claude-sdk-lane-options.ts`); refusal messages are fixed strings; bootstrap options carry no workspace path; ambient logs keep their original content. Session ids in `[PtahCliRegistry] continue()...` are opaque SDK ids, not account material. |

## Judgment on the brief's open item

**Child chats of an ambient Claude-CLI parent are now storage-gated; a storage read
failure refuses a child that previously launched. Verdict: acceptable fail-closed, not an
ambient regression.**

Reasons:

1. Absence of a binding cannot be proven without reading the authoritative store. The
   both-stores rule (D21) makes "unbound" a store answer, not a local default. Treating
   a storage failure as "unbound" would let a bound session continue ambient — exactly
   the cross-account leak this phase exists to prevent.
2. The failure is loud and typed ('unavailable-storage' through
   `mainSessionAccountFailure`), never a silent downgrade.
3. The new dependency does not create a new failure class: resume already reads session
   metadata from the same storage, so SQLite being down already broke these operations.

Caveats to carry forward: the gated paths add one storage read per continue/slash/turn
(a cache keyed by auth epoch would remove the hot-path cost); `resumeSession` gates and
then the activation entry gates again (two reads per resume); and the RPC/UI
accountSelection contract (D22 deferral) does not yet render these refusals distinctly,
so users will see a generic failure until that batch lands.

## Five logic questions

1. **Silent failure:** F5 (empty probe silently passes any model), F6 (corrupt local
   reference reads as plain ambient). Everything else converts failure into typed
   refusals; the release-hold design fails loudly by construction.
2. **User action with unexpected behaviour:** a bound parent's child chat after the
   workspace auth method changes (F8); a retry after F7's post-commit refusal enqueues a
   second turn.
3. **Input data that gives a wrong answer:** one corrupted `accountBinding` row fails
   every session listing (F2); a corrupted local lane reference maps to "never bound"
   (F6, contained by the authoritative lookup for claude lanes).
4. **Dependency failure:** storage failure refuses named and gated-ambient operations
   fail-closed (judged correct above); a storage blip during a claude lane continue kills
   the lane (F3); probe failure silently widens the model check (F5); admission refusal
   codes collapse in the executor catches (F4).
5. **Missing:** an eventual release path for retained reservations (F1); per-row
   isolation for corrupt bindings (F2); epoch-keyed caching for the per-turn gate reads;
   a distinct 'no-session' code (F9).

## Edge cases checked

| Case | Verdict |
| --- | --- |
| Ambient resume of a never-bound session | OK — lookup absent, gate returns, resume proceeds (one storage read) |
| Bound session, binding deleted while lane is live | OK — restore/continue refuse 'invalid-bound' via the authoritative lookup |
| Bound session, default account changed | OK — gate forces the stored profile; explicit ambient selection refuses 'conflict' |
| Both stores disagree | OK — `resolveAccountBinding` refuses before any prompt work |
| Storage down mid-admission | OK — every await sits behind a 15 s deadline that aborts the lane controller |
| Bootstrap child never responds | OK — deadline aborts, `dispose()` settles, refusal returned |
| Concurrent continues on one named lane | OK — 'busy' refusal while status is running; turn-symbol guards discard stale exits |
| Imported named session | OK — refused without the lookup port; per-session epoch equality; one unbound file aborts the named scan |
| Double gate on resume (service + activation) | OK — redundant but consistent; cost noted above |

## Coverage

Read in full (targeted full-file or full-region reads): `claude-sdk-lane-runner.ts`
(admission, runner lifecycle, enqueue, dispose), `register.ts` (both cli-agent-runtime
and agent-sdk), `lane-resume-gate.ts`, `provider-account.service.ts` (admission,
release/retain stubs, attach/lookup wrappers), `chat-session.service.ts` (diff, gates),
`chat-slash-command-router.service.ts` (diff, gateMainSessionAccount), `p1-d-review-scope.md`,
`code-logic-review-phase-p1-c.md` (format reference), decisions D20–D24.

Read via complete diff hunks: `claude-cli.adapter.ts`, `session-query-executor.service.ts`,
`sdk-query-runner.service.ts`, `sdk-query-options-builder.ts`, `session-metadata-store.ts`,
`session-importer.service.ts`, `provider-account.store.ts`,
`agent-process-manager.service.ts`, `agent-events.ts`, `claude-sdk-lane-options.ts`,
`session-registry.service.ts`, `sdk-agent-adapter.ts`, migration `0059`,
`provider-account.schemas.ts`, `child-chat-session-host.adapter.ts`,
`session-rpc.handlers.ts`, `cli-detection.service.ts` (roster), `agent-process.types.ts`.

Not covered: the small interface/spawner diffs (`cli-adapter.interface.ts`,
`session-spawner.port.ts`, `session-spawner.service.ts`) were skimmed in the diff batch
but not line-audited; no spec or test file was executed (rules); the base-commit
`git show` comparison for the adapter catch was verified and the suspicion dropped.
`retainUnresolvedReservation`'s post-certification server semantics were read only at
the service stub level — the store-side reconciliation does not exist yet, which is why
F1 is certification-blocking rather than a present defect.

## Decisions

- **Open item (ambient storage gating):** settled as acceptable fail-closed, with the
  availability and rendering caveats above. Options were (a) accept fail-closed,
  (b) treat storage failure as unbound for ambient-only sessions. Evidence: D21's
  both-stores rule, the loud typed refusal, and the pre-existing storage dependency of
  resume. (b) reopens the silent-downgrade hole, so (a). Reversible: an epoch-keyed
  "unbound" cache can restore availability later without weakening the check.
- **DI `accountBindings` absence in the ClaudeCliAdapter factory:** not counted as a
  defect. 'claude' is absent from the public roster, the factory comment says the ports
  stay "runtime-local until the Batch 26 roster activation", and no ambient claude lane
  can spawn today. It is a load-bearing wiring requirement for certification: Batch 26
  must pass `accountPersistence` before the roster admits 'claude', or every claude lane
  resume will refuse 'unavailable-storage' (`lane-resume-gate.ts:214`).
- **Known deferrals** (SDK live-turn lease transfer, termination proof, D19 items,
  RPC/UI accountSelection contract): not counted as defects, per the brief.
- F1 is filed against the runner, not the stub service: the stubs are deliberate D7
  posture; the race in the settlement condition is the part that will survive
  certification unchanged.

## Verdict

APPROVED WITH FIXES. No release-hold hole and no ambient behavioral change on healthy
storage beyond the judged gate reads. Fix F1 before certification goes live; F2 and F3
should ride with the next batch touching those files; the Minors can be batched.
Confidence: MEDIUM-HIGH (static read; no specs executed; admission paths unexercisable
while release-held by design).