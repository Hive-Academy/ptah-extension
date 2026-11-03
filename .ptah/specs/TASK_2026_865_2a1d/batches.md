# Batches - TASK_2026_865_2a1d

Total tasks: 25 | Batches: 11 (8 active, 3 HELD) | Complete: 0/11

Worktree (`<wt>`): `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765`
(branch `feat/provider-switch-carryover`). Every path below is absolute. Plan:
`<wt>/.ptah/specs/TASK_2026_865_2a1d/implementation-plan.md` (Revision 2). Binding decisions:
`decisions.md` rows 16-28.

Phases:

- Phase 1 "Carry-over core": Batches 1-8, in this order: shared contracts (1), backend (2-5),
  frontend (6-8). Phase review: code-logic (cross-family; it also covers the F1 and F3 fixes,
  decisions.md row 24), plus style, because the phase adds two public RPC methods.
- Phase 2 "K2 native Codex read": Batches 9-11. HELD (user decision, decisions.md row 27). These
  batches run last and only after row 27 is answered with "build K2". They are dropped as a group.
  Phase review: code-logic (cross-family), scoped to the Phase 2 commits.

Rules every executor gets (CLAUDE.md, repeat in every lane prompt):

- Verify only with the batch's `npm run verify -- -p <projects>` command, in the foreground, with a
  long timeout. Filter the output (`| tail -60`). Confirm that the header says
  "Running target ... for N projects", with N equal to the number of projects requested. No
  `nx run-many`, no positional `nx test A B`, no workspace-wide checks, and no build, serve,
  e2e or package targets.
- Electron first. Do not edit `libs/frontend/onboarding` or the Codex sign-in code. The retired
  proxy stays retired.
- Keep the `chat:continue` and `/compact` AUTH_REQUIRED refusals byte-identical. Do not edit
  `continueSession`, `autoResumeIfInactive`, `chat-slash-command-router.service.ts` or
  `workspace-provider-profile-resolver.ts`.
- No git in executors. The team-leader owns commits. Executors never edit `batches.md` or `task.md`.
- No transcript text in logs, results, errors, banners or notices (AC 8.5).

## Pre-step before Batch 6 (not run by the team-leader)

- Before the first frontend batch (Batch 6) starts, the orchestrator has the visual-reviewer take
  Electron "before" screenshots of the AUTH_REQUIRED re-auth banner, in dark and light themes
  (decisions.md row 2; plan Component 9). Take them on `main` or on this branch before Batch 6.
  Batches 1-5 change no renderer code.
- Store them in the task folder. The visual-reviewer names the files and records the paths in
  `visual-review.md`. Batch 6 does not start until the paths exist.
- Do not use these screenshots for the "after" state. The "after" set is taken after Phase 1:
  the banner without the button, with the button, the busy state, the notice after a button
  carry-over, and the notice after a `/compact` carry-over.

## Plan validation

Status: PASSED WITH RISKS (no BLOCKER; plan issues listed below; the split of the HELD work is a
team-leader decision, recorded under `## Decisions`)

Assumptions:

- A1 (compaction summary carries `isCompactSummary`, may be `isMeta`): unverified. Checked in
  Task 2.3 with a scrubbed fixture from a real compacted JSONL.
- A2 (the first `generating` of the new session is accepted after `attachSession`): unverified.
  Checked in Task 7.4, integration case 1. Fallback: `markTabStreaming` at click and
  `markTabIdle` on failure.
- A3 (the readiness `prepare` probe has no lasting side effect): unverified. Task 4.2 reads
  `workspace-provider-profile-resolver.ts:484-530` and writes its note into the batch report
  for the PR.
- A4 (`resolvedWorkspacePath` is set on the Electron continue path): checked in Task 7.1 (no offer
  and today's `/compact` when it is unset).
- A5 (`send` and `continueExistingSessionForQueueFlush` are the only renderer launches on an
  existing tab): checked in Task 7.1. Search `libs/frontend` for `chat:start`, `chat:continue`
  and `chat:resume` callers that pass an existing tab's `tabId`. Any other caller gets the guard.
- A7 (the Codex history process methods are read-only): HELD. Checked in Task 9.1, which asserts
  that only read methods are requested.
- A8 (`thread/turns/list` accepts `sortDirection: 'desc'`): HELD. Task 9.1 implements the bounded
  `asc` fallback. The manual Electron check is open; see Plan issue P5.
- A9 (after a `'skip'` the session list is refreshed): checked in Task 7.4, integration case 2.
- Verified now: every CREATE target is absent and every MODIFY target exists on disk.
  `SessionHistoryRouter` is exported from `@ptah-extension/agent-sdk` (`src/index.ts:79-86`), so
  Component 3's type import works. `chat:continue` already validates `tabId` and `sessionId` as
  UUIDs (`chat-rpc.schema.ts:95-96`), so the new `uuidString` schemas accept the same ids.
  `flagAuthRequired` already accepts a `null` provider id (`auth-state.service.ts:1217`).
  `SDK_TOKENS.SESSION_HISTORY_ROUTER` is registered by `registerSdkServices`
  (`agent-sdk/src/lib/di/register.ts:311-322`).

| Risk | Severity | Mitigation |
| ---- | -------- | ---------- |
| F1: the provider switches back during `prepare` and the launch reaches the old provider. | HIGH | Task 4.1: post-`prepare` pin on every runtime branch, plus a race spec with zero adapter calls and zero writes. |
| F3: the claimed-surface branch never binds the tab, so the entry stays pending and no notice appears. | HIGH | Tasks 7.3 and 7.4: skip/bind/none claim, plus integration case 2. |
| A transcript leaks into logs or Sentry through the reused `startSession` catch. | HIGH | Task 4.1: a sentinel spec on every logger call, every `captureException` argument and the result. Task 4.2: the same for the service. |
| `ChatRpcHandlers` gains an injection that does not resolve in the cli-engine container (`cli-engine/src/lib/container.ts:129,146,881,975`). | MEDIUM | Task 5.1 uses optional injections where the plan says optional. The Batch 5 verify adds `@ptah-extension/cli-engine` (Plan issue P3). |
| The relink races in AC 7.8 (tab switch, newer refusal, tab closed, tab rebound). | MEDIUM | Task 6.2: race spec with deferred promises. Task 7.4: integration cases. |
| The parallel branch `feat/provider-readiness` also edits `libs/shared/src/lib/types/rpc.types.ts` and `codex-provider.types.ts`. | MEDIUM | Task 1.2 appends registry entries without reordering existing ones. Merge conflicts are resolved at PR time; no code depends on the parallel branch. |
| The `/compact` check falls back on a timeout and silently compacts natively on Codex (HELD direction only). | MEDIUM | Plan issue P4. Recorded for the Phase 2 go/no-go. Task 11.1 logs a timeout fallback with ids only. |
| Pattern redaction misses a secret shape. | MEDIUM | Task 3.2: unit cases for each pattern. Best effort per decisions.md row 10. |
| The readiness probe starts a provider proxy for a check the user never clicks (A3). | LOW | Task 4.2 runs the probe only after a mismatch is found (K22) and writes a note for the PR. |
| The new banner type breaks the third banner writer (`auth-state.service.ts:1378-1384`). | LOW | Task 6.1 keeps that `set(null)` valid and adds a case for it (Plan issue P8). |

Edge cases:

- The same provider for the session and the active connection: not eligible, and no probe runs.
  Handled in Task 4.2.
- A proxy-era Codex Claude SDK identity: not eligible. Task 4.2.
- A native Codex identity while Phase 2 is not built: not eligible, refused before any read, with
  zero router calls. Task 4.2. The router throws without calling the port. Task 3.1.
- A folder mismatch or an unknown session: not eligible, with no read. Task 4.2.
- An empty or unreadable history: `HISTORY_UNREADABLE`, and nothing is started. Tasks 4.2, 6.2.
- A double click, or a concurrent second call: `IN_FLIGHT`, with one start. Tasks 4.2, 6.2.
- A stale generation, a closed tab or a rebound tab at click time. Task 6.2.
- Mid-flight: a tab switch, a newer refusal, a closed tab (`'skip'`, no attach) or a rebound tab
  (`'skip'` plus `chat:abort`). Tasks 6.2, 7.4.
- A transport timeout: the entry stays pending until a chat error, a resolution or the tab's
  removal. Task 6.2.
- `/compact` variants: `/compact focus on tests` is redirected. `/compactx`, `/compact\nfoo` and
  `ultracode: /compact` are not. A queued `/compact` is redirected. A `/compact` on a pending tab
  returns busy. Task 7.1.
- A `/compact` check that is not eligible, fails or times out: `chat:continue` params deep-equal
  to today's. Task 7.1.
- A `START_FAILED` from a compact trigger with no banner and no `providerId`: the banner is flagged
  with `providerId` `null`, which the signature allows. Task 6.2.
- `completeBinding` called twice: one notice. Task 6.2.
- A claim that throws: treated as `'none'` in both branches. Tasks 7.2, 7.3.
- Native (HELD): a repeated cursor gives `stalledCursor`; the item budget runs out; a legacy thread
  gets one `includeTurns` read; `contextCompaction` in the window still gives
  `startsAtCompactionSummary === false`. Tasks 9.1, 10.1.

## Plan issues

Reported, not fixed. Each item names the batch that carries a mitigation or the owner who decides.

- P1 (Serious, contract gap; worked around in the split). Component 12 bundles two things. The
  first is the Claude-session route `SessionHistoryRouter.readCarryOverTranscript`. The
  non-held Component 4 needs it, because Rev 2 replaced Component 4's direct
  `SDK_SESSION_HISTORY_READER` dependency with the router (plan lines 377-382, 435-436). The
  second is the native-only code. The plan does not define the behaviour of `evaluate` or of the
  router for a native session when K2 is not built. Batches decision: Task 3.1 adds the router
  method with the Claude route. On the native route it throws
  `SessionHistoryRouteError('nativePortUnavailable')` without calling the port. Task 4.2 makes a
  native identity not eligible before any read (the original K2 rule). Batch 10 and Batch 11
  replace both when Phase 2 is approved. The plan's `readCarryOverTranscript` options gain
  `nativeBound` only in Batch 10.
- P2 (Moderate, size). The plan counts the K2 native read as "6 production files + 1
  conditional" (decisions.md row 27). With specs and the edits that exist only for the native
  direction, it touches 15 files in 4 projects: codex-runtime, ptah-electron, agent-sdk and
  rpc-handlers. Three of those files were first written in Batches 3-4. That exceeds the batch cap
  of 6 files and 2 projects, so the held work is three held batches in one held phase, not one
  batch. It is still dropped as a unit.
- P3 (Moderate, missing verification). `@ptah-extension/cli-engine` resolves `ChatRpcHandlers` and
  `registerChatServices` (`libs/backend/cli-engine/src/lib/container.ts:129,146,881,975`). It also
  has a strict RPC surface spec (`libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts:136-144`).
  CLAUDE.md requires keeping cli-engine working, but no verify in the plan includes it. The plan
  also lists `SDK_WORKSPACE_PROVIDER_PROFILE_RESOLVER`, `SDK_ACTIVE_PROVIDER_RESOLVER` and
  `SDK_CODEX_AUTH` followed by "(both optional)", so it is unclear which of the three tokens are
  optional. Batches decision: Task 5.1 mirrors `ChatSessionService`'s optionality for each
  token, and the Batch 5 verify and the phase verify add `@ptah-extension/cli-engine`.
- P4 (Moderate, behaviour in the HELD direction). The `/compact` check has a 5 s cap and, on a
  mismatch, runs the readiness `prepare` probe. When the check times out, the fallback sends
  `chat:continue`. For a native Codex session after a switch to Claude, that compacts on Codex:
  the old provider is called, with no notice. The plan does not measure the probe's latency (A3
  checks only side effects). Owner: the user, at the Phase 2 go/no-go (row 27). Options: a longer
  check timeout for `/compact`, or no fallback to native compaction when the check times out.
  Batch 11 adds a fallback log line with ids only, so the fallback is observable either way.
- P5 (Moderate, HELD). The A8 check needs "one Electron manual read of a long native session". That
  means running the Electron app, which CLAUDE.md forbids unless the user asks, and no lane can
  do it. Options: run the check in the visual-reviewer's Electron session, which is already
  sanctioned for screenshots; or rely on the bounded `asc` fallback that Task 9.1 implements and
  tests. Owner: the orchestrator, at the Phase 2 go/no-go.
- P6 (Moderate, requirements). Requirement 9 (`/compact`) and AC changes 2-8 exist only in the
  plan's `## Proposed requirement changes`, not in `task-description.md`. The `/compact` tests in
  Batches 6-7 map to the proposed AC 9.x. U1 and U2 are still pending (row 27), and the plan is
  built on option A of each. If the user picks U2 = B (`/compact` only opens the offer),
  Tasks 6.2 and 7.1 change, and a non-auth banner mode needs a designer (row 2). Owner: the
  orchestrator records the requirement changes and the U1/U2 answers before Phase 1 review.
- P7 (Minor, unspecified order). In the claimed-surface branch, `liveness.rekey(tabId,
  realSessionId)` runs at `chat-message-handler.service.ts:834-836`, before the point where the
  plan puts the claim ("before `onSurfaceCreated`"). On `'skip'`, the refused tab's liveness entry
  would be rekeyed to a session that has just been aborted. Task 7.3 places the claim before the
  rekey and tests that `'skip'` does not rekey. If the executor finds a reason the rekey must
  stay first, the batch report must give it.
- P8 (Minor, unlisted writer). `AuthStateService` has a third banner writer: it clears a Codex
  banner when Codex auth is healthy (`auth-state.service.ts:1378-1384`). Component 7 lists only
  `:1217-1222`. With `generation` and `origin`, that `set(null)` stays valid. Task 6.1 keeps it,
  adds a case, and Task 6.2 ensures a cleared banner does not revive an offer.
- P9 (Minor, line drift). Component 5 cites the `authErrorFields` helper at `:876-888`; E6 cites
  `:872-886`. The executor re-locates it. Not a contract issue.

## Decisions

| # | Decision | Options | Evidence | Reversible |
| - | -------- | ------- | -------- | ---------- |
| T1 | K2 is three HELD batches (9-11) in one HELD phase, placed last, dropped as a unit. | One 15-file held batch; three held batches. | Batch cap of 6 files and 2 projects; P2; decisions.md rows 27-28; the orchestrator asked for one held batch placed last. | Yes |
| T2 | Without Phase 2, a native identity is not eligible before any read (Task 4.2), and the router's native route throws `nativePortUnavailable` with no port call (Task 3.1). | Leave the native route undefined; omit the router method until Batch 10. | P1; Component 4 needs the router for Claude sessions. | Yes. Batches 10-11 replace both. |
| T3 | `CARRY_OVER_READ_TIMEOUT_MS = 20_000` lands in Batch 3, not in the held phase. | 10 s in Batch 3, then raise it to 20 s in Batch 11. | No compile dependency; 20 s fits inside the 120 s RPC timeout (E27). One edit instead of two. | Yes |
| T4 | The native-only constants (`CARRY_OVER_NATIVE_MAX_*`), `nativeBound` and the `'codex-native'` log source land only in Batches 10-11. | Land them early as unused constants. | The held work stays droppable with no dead code (role rule: no unused code). | Yes |
| T5 | Component 10 (refusal pins), including the native `/compact` host pin, is in Batch 3 (active). | Put the native pin in the held phase. | The pin asserts today's unchanged host behaviour and passes with or without K2. It lands before Batch 4 edits `chat-session.service.ts`. | Yes |
| T6 | Component 13 (`/compact`) is active, in Batches 6-7. Its Codex -> Claude spec case mocks the RPC, so it needs nothing from the held phase. | Hold the Codex -> Claude case. | Orchestrator instruction; plan Component 13 (the renderer does not branch on direction). | Yes |
| T7 | The Batch 5 and Phase 1 verifies add `@ptah-extension/cli-engine`; Phase 1's final verify lists 8 projects. | Follow the plan's list (no cli-engine). | P3; CLAUDE.md ("keep ... cli-engine working"). | Yes |
| T8 | One code-logic review covers Phase 1, plus a style review for the two new public RPC methods. Phase 2 has its own code-logic review. | Separate backend and frontend reviews. | context.md sequence (one codex code-logic review); risk-based review rule; row 24 puts F1/F3 into the phase review. | Yes |
| T9 | Executors: a CLI lane of any family other than the phase reviewer's for the bounded batches (1, 2, 3, 5, 8, 9, 11). Subagents for 4, 6, 7 and 10 (reasons are on each batch). | All lanes; all subagents. | Row 4 makes the codex lane the reviewer, so implementers must be another family. The other live lanes are at 84% weekly or unknown (context.md). | Yes |

## Batch 1: Shared RPC contract — COMPLETE

- Recommended executor: CLI lane, backend TypeScript capability, any family other than the phase
  reviewer's
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
  (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase reviewer is the codex lane, decisions.md row 4)
- Rationale: two type-only files and one project. A self-contained prompt is enough.
- Tasks: 2 | Depends on: none
- Phase: 1 "Carry-over core" | Phase review: covered by the Phase 1 code-logic and style review

### Task 1.1: Carry-over params and result types — COMPLETE

- File: `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/shared/src/lib/types/rpc/rpc-chat.types.ts` (MODIFY)
- Plan reference: implementation-plan.md:221-245 (Component 1)
- Pattern to follow: `ChatContinueResult` at `rpc-chat.types.ts:209-223`
- Quality requirements: add exactly `ChatCarryOverCheckParams`, `ChatCarryOverCheckResult`,
  `ChatCarryOverParams`, `ChatCarryOverFailureReason` and `ChatCarryOverResult` as in the plan. No
  transcript field. `error` is documented as fixed host text. The check result does not name the
  source runtime. `RpcUserErrorCode` is not extended.
- Validation notes: the parallel branch edits the neighbouring `rpc.types.ts`. Append; do not
  reorder.
- Implementation details: import `SessionId` and `RpcUserErrorCode` as the file already does. Use
  discriminated unions on `eligible` and on `success`.

### Task 1.2: Registry entries — COMPLETE

- Depends on: Task 1.1
- File: `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/shared/src/lib/types/rpc.types.ts` (MODIFY)
- Plan reference: implementation-plan.md:226-229; E17 (line 61)
- Pattern to follow: the existing `chat:continue` entries at `rpc.types.ts:127-148` (type import),
  `:1040-1050` (`RpcMethodRegistry`) and `:3386-3405` (`RPC_METHOD_ENTRIES`)
- Quality requirements: `'chat:carry-over-check'` and `'chat:carry-over'` appear in both the
  registry and `RPC_METHOD_ENTRIES`. The compile-time check passes.
- Validation notes: the names must not match the host-source pattern of E18. Proof:
  `host-source-registry.contract.spec.ts` passes unchanged.
- Implementation details: add 2 registry keys and 2 entry keys. Do not touch the replay sanitizer
  allow-list (E19).

### Batch 1 verification

- Both files contain the five types and the two method registrations.
- `npm run verify -- -p @ptah-extension/shared` passes (header: 1 project). Proof: the shared
  typecheck, and `host-source-registry.contract.spec.ts` unchanged.
- No per-batch review. The phase review covers this batch.

## Batch 2: Bounded Claude JSONL carry-over read (agent-sdk) — COMPLETE

- Recommended executor: CLI lane, backend TypeScript capability, any family other than the phase
  reviewer's
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
  (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: one project, five files, a pure projection with a mocked reader. Bounded and fully
  specified.
- Tasks: 3 | Depends on: none (it can run beside Batch 1)
- Phase: 1 | Phase review: Phase 1 code-logic

### Task 2.1: Shared transcript type — COMPLETE

- File: `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/backend/agent-sdk/src/lib/helpers/history/history.types.ts` (MODIFY)
- Plan reference: implementation-plan.md:252-255
- Pattern to follow: the existing exported record types in the same file (`:79-87`, `:125-135`)
- Quality requirements: `CarryOverTranscript { turns: readonly CarryOverTurn[];
  windowCoversWholeHistory: boolean; startsAtCompactionSummary: boolean }` and `CarryOverTurn {
  role: 'user' | 'assistant'; text: string; compactionSummary: boolean }`. No barrel change.
- Validation notes: the one type serves both session kinds. The native projector (Batch 10) uses
  it unchanged.
- Implementation details: type-only edit.

### Task 2.2: `extractContentForCarryOver` — COMPLETE

- Depends on: Task 2.1
- Files: `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/backend/agent-sdk/src/lib/helpers/history/history-event-factory.ts` (MODIFY),
  `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/backend/agent-sdk/src/lib/helpers/history/history-event-factory.spec.ts` (MODIFY)
- Plan reference: implementation-plan.md:272-282 (F5 included)
- Pattern to follow: `extractContentForCuration` at `history-event-factory.ts:513-563`
- Quality requirements: apply the text, `tool_use`, `tool_result`, image, document, thinking and
  string rules exactly as the plan lists them. The `content` and `is_error` fields of a
  `tool_result` are never read.
- Validation notes: AC 3.5, 3.6, 3.7.
- Tests that prove the ACs (in `history-event-factory.spec.ts`): reminder removed (AC 3.6);
  `<file path=…>…</file>`, a self-closing file tag and `<folder …/>` become `[file: basename]`,
  for both `/` and `\` separators (AC 3.7); `tool_use` gives `[tool: name]` with no input
  (AC 3.5); `tool_result` with a known id gives `[tool result: name]`, and with an unknown id
  `[tool result]`; a content sentinel and `is_error: true` are absent (AC 3.5); image gives
  `[image omitted]`; thinking and `redacted_thinking` give `''`.

### Task 2.3: `readCarryOverTranscript` — COMPLETE

- Depends on: Task 2.2
- Files: `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/backend/agent-sdk/src/lib/session-history-reader.service.ts` (MODIFY),
  `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/backend/agent-sdk/src/lib/session-history-reader.carry-over.spec.ts` (CREATE)
- Plan reference: implementation-plan.md:256-306
- Pattern to follow: `readHistoryForCuration` at `session-history-reader.service.ts:905-994`, its
  projection at `:784-840`, and the file path build at `:952-963`
- Quality requirements: at most `tailBytes` bytes read, through `readJsonlTail`; never calls
  `readJsonlMessages`; writes nothing; throws instead of returning `[]`; logs no content.
  `windowCoversWholeHistory` comes from `fs.stat(file).size <= tailBytes`.
- Validation notes: A1. Use a scrubbed fixture from a real compacted JSONL for the summary case,
  and record in the report where it came from. The start boundary is only the latest in-window
  non-sidechain `isCompactSummary` record (F6). A `compact_boundary` never moves it.
- Tests that prove the ACs (`session-history-reader.carry-over.spec.ts`):
  - a 10x-bound fixture: `readJsonlTail` is called once with `maxBytes === tailBytes`,
    `readJsonlMessages` is never called, and `windowCoversWholeHistory === false` (AC 3.10,
    Claude half; AC 3.4);
  - a tool pair with a sentinel (AC 3.5); thinking, system, `compact_boundary` and the reminder
    removed (AC 3.6); placeholders (AC 3.7); a sidechain excluded (AC 3.9);
  - a summary just inside the window, and a window with no summary (AC 3.8); two summaries start
    at the later one; a `compact_boundary` without a summary keeps both sides;
  - an invalid id throws and makes no read call (AC 2.6).
- Implementation details: use the injected `JsonlReaderService` and `HistoryEventFactory`
  (`:287-294`). A pre-pass builds `toolNamesById` for the call. Merge consecutive turns with the
  same role, and drop empty turns.

### Batch 2 verification

- The three production edits and the new spec exist with real logic.
- `npm run verify -- -p @ptah-extension/agent-sdk` passes (header: 1 project).
- A1 result recorded in the report.

## Batch 3: Carry-over route, transcript renderer and refusal pins — PENDING

- Recommended executor: CLI lane, backend TypeScript capability, any family other than the phase
  reviewer's
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
  (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: three small, independent pieces (a router method, a pure renderer, spec-only pins).
  Each has a fixed shape. The refusal pins land before Batch 4 edits `chat-session.service.ts`.
- Tasks: 3 | Depends on: Batch 2 (Task 3.1 calls `readCarryOverTranscript`; Task 3.2 types its
  input from the router)
- Phase: 1 | Phase review: Phase 1 code-logic

### Task 3.1: `SessionHistoryRouter.readCarryOverTranscript` (Claude route; native disabled) — PENDING

- Files: `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/backend/agent-sdk/src/lib/codex-app-server/session-history-router.ts` (MODIFY),
  `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/backend/agent-sdk/src/lib/codex-app-server/session-history-router.spec.ts` (MODIFY)
- Plan reference: implementation-plan.md:914-918 (the non-native part of Component 12); Plan
  issue P1; Decision T2
- Pattern to follow: `readSessionEvents` at `session-history-router.ts:61-68`
- Quality requirements: the signature is `readCarryOverTranscript(sessionId, workspacePath, {
  tailBytes, signal })`, returning `Promise<CarryOverTranscript>`. The non-native route delegates
  to `getLegacy().readCarryOverTranscript`. Add `'readCarryOverTranscript'` to the `getLegacy`
  `Pick`. The native route (when `nativeSession` returns a session) throws
  `SessionHistoryRouteError('nativePortUnavailable')` and calls neither `getNative()` nor the
  legacy reader. `invalidNativeIdentity` from `nativeSession` propagates unchanged.
- Validation notes: `register.ts:311-322` already passes the full reader. No registration edit.
- Tests that prove the ACs (`session-history-router.spec.ts`, fixture `:99-109`; the legacy fake
  gains `readCarryOverTranscript`): a non-native id routes to the legacy method with `tailBytes`
  and `signal` unchanged (AC 3.10, Claude half); a native id throws `nativePortUnavailable`, and
  the port's `readHistory` is called 0 times (no native read while K2 is held); existing cases
  unchanged.

### Task 3.2: Transcript renderer and redaction — PENDING

- Files: `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/backend/rpc-handlers/src/lib/chat/session/chat-carry-over-transcript.ts` (CREATE),
  `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/backend/rpc-handlers/src/lib/chat/session/chat-carry-over-transcript.spec.ts` (CREATE)
- Plan reference: implementation-plan.md:314-363 (Component 3), except the native constants
  (Decision T4)
- Pattern to follow: the redaction patterns in `libs/backend/codex-runtime/src/lib/codex-stderr-tail.ts:6-17`
  and `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/route-tool-handlers.ts:38-42`
- Quality requirements: export `CARRY_OVER_READ_TAIL_BYTES = 2 * 1024 * 1024`,
  `CARRY_OVER_TEXT_BUDGET_CHARS = 48_000`, `CARRY_OVER_READ_TIMEOUT_MS = 20_000` (Decision T3),
  and `CARRY_OVER_INSTRUCTION` (it must not start with `/`). Also export `redactKnownSecrets`,
  with the plan's pattern list and no generic base64 rule, and
  `renderCarryOverPrompt(transcript, budget)`, which returns `{ prompt, keptTurns,
  omittedTurns } | null`. The rendered transcript never exceeds the budget. No
  `cli-agent-runtime` import.
- Validation notes: the input type is `Awaited<ReturnType<SessionHistoryRouter['readCarryOverTranscript']>>`,
  imported as a type from `@ptah-extension/agent-sdk` (exported at `src/index.ts:79-86`).
  Redact each turn before measuring it.
- Tests that prove the ACs (`chat-carry-over-transcript.spec.ts`): every turn in order when the
  history fits, with no omission line (AC 3.1); oldest-first drop with the exact count when the
  window covers the whole history or starts at a summary, else `Earlier conversation omitted.`
  (AC 3.2); a single oversize newest turn keeps its end, with the marker (AC 3.3); a
  property-style 10x oversize input always stays within budget (AC 3.4); summary first, summary
  outside the window, and turns before the window (AC 3.8); a transcript with
  `startsAtCompactionSummary: false` and `windowCoversWholeHistory: false` gives the no-count
  line; each secret pattern, in prose and in a summary, is absent from `prompt` (AC 8.2, 8.3);
  empty input gives `null`.

### Task 3.3: Refusal contract pins (specs only) — PENDING

- Files: `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.native.spec.ts` (MODIFY),
  `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.native.spec.ts` (MODIFY)
- Plan reference: implementation-plan.md:815-836 (Component 10); Decision T5
- Pattern to follow: the existing refusal cases at `chat-session.native.spec.ts:576-627` and
  `chat-slash-command-router.native.spec.ts:357`
- Quality requirements: no production edit. The cases must pass against today's code. If one does
  not, stop and report it: the refusal shape differs from E6, which is a plan BLOCKER.
- Tests that prove the ACs: `toStrictEqual({ success:false, sessionId, error:<exact resolver
  text>, errorCode:'AUTH_REQUIRED', providerId:'anthropic' })` and the five sorted keys, for
  `chat:continue` (through `continueSession` when the harness reaches it, else
  `autoResumeIfInactive`) and for `/compact` (AC 1.5, 5.5, 6.3). A native identity with the
  active resolver at `'anthropic'` still calls `runtimeControls.compact(sessionId)` and returns
  `{ success:true, sessionId, settled:true }`.

### Batch 3 verification

- The router method, the renderer module and the pins exist. The pins pass on unchanged
  production code.
- `npm run verify -- -p @ptah-extension/agent-sdk,@ptah-extension/rpc-handlers` passes (header: 2
  projects).

## Batch 4: Carry-over launch pin and `ChatCarryOverService` — PENDING

- Recommended executor: subagent (backend-developer)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
  (the subagent is the first choice here; a non-reviewer-family CLI lane with confirmed room is
  the fallback)
- Subagent reason: the batch holds the F1 fix that the user's Gate 2 decision rests on
  (decisions.md row 24). That is a race pin on three runtime branches in a large service, with a
  positional harness and iterative verify runs. Only non-reviewer-family lanes are eligible
  (row 4), and their capacity is 84% weekly or unknown (context.md). A lane that stops mid-batch
  would leave `chat-session.service.ts` half-edited.
- Review family: different from implementer (Claude subagent vs the codex reviewer)
- Rationale: Component 5 and Component 4 are coupled. Component 4 maps
  `CARRY_OVER_PROVIDER_CHANGED` and passes `{ expectedProviderId }`, so the two run in order in
  one project.
- Tasks: 2 | Depends on: Batches 1, 2, 3
- Phase: 1 | Phase review: Phase 1 code-logic (must confirm F1)

### Task 4.1: `startSession` carry-over launch option (F1, F4) — PENDING

- Files: `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts` (MODIFY),
  `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.host-routing.spec.ts` (MODIFY),
  `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.carry-over-launch.spec.ts` (CREATE)
- Plan reference: implementation-plan.md:475-544 (Component 5); E30, E31
- Pattern to follow: the safe-name logging at `chat-session.service.ts:977-981`, pinned by
  `chat-session.host-routing.spec.ts:455-476`; the positional harness and Sentry fake at
  `chat-session-auth.spec.ts:74-136`
- Quality requirements:
  - Export `CarryOverLaunch` and the fixed constants `CARRY_OVER_PROVIDER_CHANGED` and
    `CARRY_OVER_START_FAILED`. `SdkSessionLaunch` gains `expectedProviderId?`.
  - `assertCarryOverProvider` runs right after `prepare` / `resolveClaudeExecution` returns, and
    before `pendingLineage.set` and any `sdkAdapter` call, on every runtime branch. It re-reads
    the active provider unconditionally and fails closed when the resolver is absent.
  - Host routing admission runs only when `launch` is absent.
  - The carry-over catch branch logs only fixed text plus `loggableErrorName`. `chat:start` and
    `continueSession` stay unchanged.
- Validation notes: do not touch `continueSession`, `autoResumeIfInactive` or the refusal helper
  (`:872-886`). Batch 3's pins must still pass. Re-locate `authErrorFields` (P9).
- Tests that prove the ACs:
  - In `chat-session.host-routing.spec.ts`: `admitUserTurn` is not called for a carry-over launch,
    and is still called without one (AC 8.1).
  - In `chat-session.carry-over-launch.spec.ts`:
    - the pin holds on each branch (Claude with a matching profile, Claude with an `undefined`
      profile, and Codex with a matching `seed.providerId`): one `startChatSession`;
    - F1 race on the Claude, Codex and `undefined`-profile branches: the active fake switches
      back inside `prepare`. Expect 0 `startChatSession`, 0 `resumeSession`, 0 metadata writes
      (including `withCodexStartLineage`), no `pendingLineage` entry, and the result
      `{ success:false, error: CARRY_OVER_PROVIDER_CHANGED }` (AC 2.3, 2.5);
    - a served provider different from the pin is refused; no resolver bound is refused;
    - F4: a sentinel in the message and stack of a throw from `prepare`, and separately from
      `startChatSession`, is absent from every logger call, every `captureException` argument
      and the result (AC 8.5);
    - without `launch`, the same throw takes today's branch (regression pin).

### Task 4.2: `ChatCarryOverService` — PENDING

- Depends on: Task 4.1
- Files: `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/backend/rpc-handlers/src/lib/chat/session/chat-carry-over.service.ts` (CREATE),
  `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/backend/rpc-handlers/src/lib/chat/session/chat-carry-over.service.spec.ts` (CREATE)
- Plan reference: implementation-plan.md:365-473 (Component 4); Decisions T2 and T4
- Pattern to follow: injection of `SDK_TOKENS.SESSION_HISTORY_ROUTER` as at
  `chat-history-read.service.ts:72-73`; `storedChatRuntimeIdentity` at
  `chat-runtime-profile.service.ts:72-86`; `resolveClaudeExecution` at `:49-70`; the optional
  injections of `ChatSessionService` (`chat-session.service.ts:359-362`)
- Quality requirements:
  - `check` and `carryOver` follow the plan's step order.
  - `evaluate` runs in this order: folder, identity, cheap provider comparison, then the
    probe (K22).
  - Eligible sources: the Claude JSONL source only (`runtime === 'claude-sdk'` and
    `providerId !== 'openai-codex'`). A `codex-app-server` identity is NOT eligible while K2 is
    held, and is refused before any router call (T2).
  - The router is called with `{ tailBytes: CARRY_OVER_READ_TAIL_BYTES, signal:
    AbortSignal.timeout(CARRY_OVER_READ_TIMEOUT_MS) }`, with no `nativeBound` (T4).
  - The active id is re-read after the read. `startSession(..., { expectedProviderId: pin })`.
  - `inFlight` is cleared in `finally`. Every result carries fixed text. Logs carry ids and
    `loggableErrorName` only, with `source: 'claude-jsonl'`. No Sentry.
- Validation notes: A3. Read `workspace-provider-profile-resolver.ts:484-530` and write the note
  on proxy start for the PR into the report. Do not call `prepare` with a stored identity
  (AC 2.3).
- Tests that prove the ACs (`chat-carry-over.service.spec.ts`):
  - eligible mismatch: Claude -> Codex, and OpenRouter -> Claude (AC 1.1);
  - same provider: not eligible, and the `prepare` fake is never called (AC 2.5, K22);
  - a probe throw per provider kind, and Codex not signed in (AC 1.3);
  - a proxy-era Codex identity is not eligible (AC 1.2);
  - a native `codex-app-server` identity is not eligible, with the router fake called 0 times (T2);
  - a folder mismatch or an unknown session, with no read (AC 2.6);
  - `prepare` is never called with an identity, and `resumeSession` is called 0 times (AC 2.3);
  - `startSession` is called once with `workspacePath === folder`, no model, a prompt that starts
    with `CARRY_OVER_INSTRUCTION`, and `{ expectedProviderId }` (AC 2.1, 2.2, 2.4);
  - a deferred read plus a provider switch gives `NOT_ELIGIBLE`, no start and 0 metadata writes
    (AC 1.7, 2.5); `CARRY_OVER_PROVIDER_CHANGED` maps to `NOT_ELIGIBLE`;
  - a transcript sentinel in a start error is absent from the result and the logs (AC 8.5);
  - a concurrent second call gives `IN_FLIGHT` and one start (AC 5.4);
  - an empty or unreadable history gives no start (AC 5.1);
  - an AUTH_REQUIRED or CODEX code from the start passes through (AC 5.2);
  - a secret in a transcript and in a summary is absent from the logs and the result, on success
    and on a forced failure (AC 8.3, 8.5);
  - the router fake receives `tailBytes === CARRY_OVER_READ_TAIL_BYTES` (AC 3.10, Claude half).

### Batch 4 verification

- Both production files contain real logic. The F1 race spec has three branch cases.
- `npm run verify -- -p @ptah-extension/rpc-handlers` passes (header: 1 project). The Batch 3
  pins still pass.
- The A3 note is in the report.

## Batch 5: Registration and RPC wiring — PENDING

- Recommended executor: CLI lane, backend TypeScript capability, any family other than the phase
  reviewer's
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
  (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: mechanical registration edits in six files of one project, each with an exact
  precedent.
- Tasks: 2 | Depends on: Batch 4
- Phase: 1 | Phase review: Phase 1 code-logic and style (new public RPC methods)

### Task 5.1: Token and DI registration — PENDING

- Files: `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/backend/rpc-handlers/src/lib/chat/tokens.ts` (MODIFY),
  `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/backend/rpc-handlers/src/lib/chat/di.ts` (MODIFY),
  `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/backend/rpc-handlers/src/lib/chat/di.spec.ts` (MODIFY)
- Plan reference: implementation-plan.md:546-579 (Component 6); E20
- Pattern to follow: `CHAT_TOKENS.HISTORY_READ` and its registration (`di.ts:96-101`); the
  `di.spec.ts:59-60` case
- Quality requirements: `CHAT_TOKENS.CARRY_OVER = Symbol.for('ChatCarryOverService')`, registered
  as a singleton after `SESSION`, with the order comment (`:12-22`) updated.
- Validation notes: P3. Each injection of `ChatCarryOverService` must resolve in the Electron and
  cli-engine containers. The resolver, active-resolver and Codex-auth tokens are `@optional()`
  wherever `ChatSessionService` treats them as optional. Write the choice for each token in the
  report.
- Tests that prove the ACs: `di.spec.ts` resolves `CHAT_TOKENS.CARRY_OVER` as a singleton.

### Task 5.2: Schemas and handler wiring — PENDING

- Depends on: Task 5.1
- Files: `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.ts` (MODIFY),
  `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.ts` (MODIFY),
  `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.spec.ts` (MODIFY)
- Plan reference: implementation-plan.md:550-571
- Pattern to follow: the `uuidString` schemas (`chat-rpc.schema.ts:56`, `:95-96`); `METHODS`
  (`chat-rpc.handlers.ts:117-128`); the parse-failure pattern at `:372-385`; the debug list at
  `:407-420`
- Quality requirements: both schemas use `.strict()` with the plan's caps. A parse failure throws
  `RpcUserError('Invalid carry-over request', 'INVALID_PARAMS')`. No param logging beyond
  `runRpc`.
- Tests that prove the ACs (`chat-rpc.handlers.spec.ts`): the `METHODS` order test (`:231`) and
  the constructor argument (`:116`) are updated; both methods delegate to the service; an invalid
  `sessionId` or `tabId` and an extra key each give `INVALID_PARAMS` (external boundary).
  `rpc-allowlist.spec.ts`, `register-shared-rpc-handlers.spec.ts`, Electron
  `rpc-surface.spec.ts` and `container.smoke.spec.ts`, and cli-engine `rpc-surface.spec.ts` and
  `surface-composition.spec.ts` all pass unchanged.

### Batch 5 verification

- `npm run verify -- -p @ptah-extension/rpc-handlers,ptah-electron,@ptah-extension/cli-engine`
  passes (header: 3 projects; only rpc-handlers files changed; the other two prove that the
  manifest, the RPC surface and DI resolution hold in both containers: P3, T7).

## Batch 6: Banner identity and `ProviderCarryOverService` — PENDING

- Pre-step: the Electron "before" screenshots (see the top of this file) exist before this batch
  starts.
- Recommended executor: subagent (frontend-developer)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
  (the subagent is the first choice here; a non-reviewer-family CLI lane with confirmed room is
  the fallback)
- Subagent reason: the batch is the renderer state machine for every race in Requirement 7. It
  needs deferred-promise specs over real signal state, with iterative chat-project verify runs.
  Eligible non-reviewer-family lanes have capacity that is near-exhausted or unknown
  (context.md), and a stop mid-batch leaves the core banner type half-changed across two
  projects.
- Review family: different from implementer
- Rationale: the service holds both triggers (`start`, `startFromCompact`, `tryCompact`) and the
  claim API that Batch 7 consumes. The core banner change is its only cross-project dependency.
- Tasks: 2 | Depends on: Batch 1 (types); the host side (Batches 4-5) is mocked in specs
- Phase: 1 | Phase review: Phase 1 code-logic

### Task 6.1: `AuthStateService` banner generation and origin — PENDING

- Files: `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/frontend/core/src/lib/services/auth-state.service.ts` (MODIFY),
  `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/frontend/core/src/lib/services/auth-state.service.spec.ts` (MODIFY)
- Plan reference: implementation-plan.md:585-592; E21
- Pattern to follow: the existing banner signal (`auth-state.service.ts:186-189`, `:342`,
  `:1217-1227`)
- Quality requirements: the banner type is `{ providerId, message, generation, origin |
  null }`. `flagAuthRequired(providerId, message, origin?)` returns the new generation.
  `clearAuthRequiredBanner(generation?)` clears only when no generation is given or it matches
  (AC 7.5). Existing callers compile unchanged. The `openai-codex` side effect is unchanged.
- Validation notes: P8. The healthy-Codex `set(null)` at `:1378-1384` stays valid. Add a case for
  it.
- Tests that prove the ACs (`auth-state.service.spec.ts`): the generation increments; the origin
  is stored; a guarded clear with a stale generation is a no-op (AC 7.5); an unguarded clear
  still clears; the Codex healthy-auth clear still works.

### Task 6.2: `ProviderCarryOverService` — PENDING

- Depends on: Task 6.1
- Files: `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/frontend/chat/src/lib/services/provider-carry-over.service.ts` (CREATE),
  `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/frontend/chat/src/lib/services/provider-carry-over.service.spec.ts` (CREATE)
- Plan reference: implementation-plan.md:598-697 (Component 7); `tryCompact` at
  implementation-plan.md:976-981 (Component 13)
- Pattern to follow: `ActionBannerService.showInfo` (`action-banner.service.ts:33-85`); the
  `isHeld` outcome shape (`message-sender.service.ts:382`); `CHAT_ADMISSION_RPC_TIMEOUT_MS`
  (`rpc-chat.types.ts:47`); `VSCodeService.isElectron` as at `message-sender.service.ts:823`
- Quality requirements:
  - Signals `offer` and `pending` (one entry per tab), with `isPending` and `isBusy` as the only
    busy predicates.
  - `offerFor`, `start`, `startFromCompact`, `tryCompact` (with
    `CARRY_OVER_CHECK_TIMEOUT_MS = 5_000`), private `launch` with the plan's failure mapping
    through `ownsUi`, `claimSessionResolution` (pure for `'bind'` and `'none'`),
    `completeBinding` (idempotent; notice text per AC 4.3 and 8.4;
    `CARRY_OVER_NOTICE_MS = 15_000`), and `onChatError`.
  - No timers except `ActionBannerService`'s. No transcript text held.
- Validation notes: U2 is built on option A (disclosure in the notice only for `/compact`, P6). A
  cleared banner (P8) must not revive an offer. A compact `START_FAILED` with no banner and no
  `providerId` calls `flagAuthRequired(null, ...)` with no origin.
- Tests that prove the ACs (`provider-carry-over.service.spec.ts`, with a mocked
  `ClaudeRpcService` using deferred promises, the real `AuthStateService` signals and a stub
  `TabManagerService`):
  - the same decision when only the refusal text differs (AC 1.4);
  - no offer when not eligible or stale (AC 1.2, 1.3, 1.6); the offer carries the four identity
    fields (AC 7.1);
  - click checks: a stale generation, a closed tab (banner cleared) and a rebound tab (AC 7.2,
    4.5); a double click gives one RPC (AC 5.4);
  - deferred races (AC 7.8);
  - failure mappings (AC 5.1, 5.2), including a newer refusal that survives a late failure (F2);
  - a transport timeout keeps the entry, and `onChatError` releases it;
  - the notice appears only after `completeBinding` (AC 4.3, 4.4);
  - `completeBinding` twice gives one notice;
  - `startFromCompact` with no banner and with a matching banner: `NOT_ELIGIBLE` gives
    `'not-eligible'`, `HISTORY_UNREADABLE` without a banner gives the fixed-text outcome, and
    `START_FAILED` AUTH_REQUIRED gives no origin and `errorAlreadyShown` (proposed AC 9.4,
    AC 5.1, 5.2);
  - a pending tab gives `'busy'` with no RPC;
  - `tryCompact`: a check RPC error and a 5 s timeout each give `'not-eligible'` (proposed
    AC 9.3).

### Batch 6 verification

- `npm run verify -- -p @ptah-extension/core,@ptah-extension/chat` passes (header: 2 projects).

## Batch 7: Message sender (offer, guard, `/compact`) and relink guard — PENDING

- Recommended executor: subagent (frontend-developer)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
  (the subagent is the first choice here; a non-reviewer-family CLI lane with confirmed room is
  the fallback)
- Subagent reason: the batch holds the required F3 fix (decisions.md row 24) and an integration
  spec that wires the real `TabManagerService`, `StreamingHandlerService`, `StreamRouter`,
  `ConversationRegistry`, `WorkflowSessionClaimService` and `StreamingSurfaceRegistry`. That
  needs iterative exploration of the test harness. Lane capacity is as in Batch 6.
- Review family: different from implementer
- Rationale: one project, six files. The message-sender `/compact` branch and both relink branches
  meet in the integration spec, which needs all of them.
- Tasks: 4 | Depends on: Batch 6
- Phase: 1 | Phase review: Phase 1 code-logic (must confirm F3)

### Task 7.1: `MessageSenderService` — offer origin, launch guard, `/compact` branch — PENDING

- Files: `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/frontend/chat/src/lib/services/message-sender.service.ts` (MODIFY),
  `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/frontend/chat/src/lib/services/message-sender.service.spec.ts` (MODIFY)
- Plan reference: implementation-plan.md:593-597, 643-646 (Component 7); 962-1020 (Component 13)
- Pattern to follow: `handleAuthRequired` (`:143-157`); the `isHeld` early returns (`:382`,
  `:669`); `runContinueConversation` (`:690-880`)
- Quality requirements:
  - An origin is passed at `:848` only when the session id, the tab id and
    `resolvedWorkspacePath` are all set. `offerFor(generation)` is not awaited, and its errors
    are caught. The `chat:start` call site passes no origin. `result.data.error` is never read
    for the decision.
  - A pending guard sits at both entries.
  - `isCompactCommand` mirrors E43. The `/compact` branch sits after `:766-771` and before
    `:778-797`, and maps `'not-eligible'`, `'busy'` and outcomes as in the plan. Arguments are
    not forwarded (K21).
- Validation notes: A4 (unset `resolvedWorkspacePath` gives no offer and today's `/compact`). A5
  (search for other launch callers and record the result in the report). The refusal path must
  stay byte-identical.
- Tests that prove the ACs (`message-sender.service.spec.ts`):
  - the origin is passed on an AUTH_REQUIRED continue, and `offerFor` is called once (AC 1.1,
    7.1); the start path passes no origin;
  - with `isPending(tabId)`, `send` (both branches) and `continueExistingSessionForQueueFlush`
    return the fixed outcome with no RPC, and another tab still sends (F3 Rev 1, AC 5.4);
  - an eligible `/compact` (Claude -> Codex, and Codex -> Claude with the RPC mocked): one
    `chat:carry-over`, no `chat:continue`, no bubble, success (proposed AC 9.1, 9.2, 9.5);
  - not eligible, a check error and a check timeout each send `chat:continue` with params
    deep-equal to today's (AC 1.5, proposed 9.3);
  - `/compact focus on tests` is redirected; `/compactx`, `/compact\nfoo` and
    `ultracode: /compact` are not;
  - a queued `/compact` through the flush is redirected (proposed 9.6);
  - a busy tab gives the busy outcome with no RPC;
  - a plain prompt never calls `chat:carry-over-check`.

### Task 7.2: Lifecycle branch claim — PENDING

- Depends on: Task 7.1
- Files: `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/frontend/chat/src/lib/services/chat-store/chat-lifecycle.service.ts` (MODIFY),
  `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/frontend/chat/src/lib/services/chat-store/chat-lifecycle.service.spec.ts` (MODIFY)
- Plan reference: implementation-plan.md:715-722 (Component 8)
- Pattern to follow: `handleSessionIdResolved` (`chat-lifecycle.service.ts:139-180`) and
  `handleChatError` (`:202-`)
- Quality requirements: the claim is called first. On `'skip'`, return after the existing
  `loadSessions()` refresh, with no attach and no active-tab fallback. On `'bind'`, run the owner
  attach, then `completeBinding`. On `'none'`, keep today's path. A claim throw counts as
  `'none'`. `handleChatError` calls `onChatError(tabId)`.
- Tests that prove the ACs (`chat-lifecycle.service.spec.ts`): `'skip'` with the tab gone (no
  `attachSession`, including the fallback, AC 7.6); `'skip'` with the tab rebound (AC 7.7);
  `'bind'` attaches, then calls `completeBinding` (AC 4.1); a claim throw follows today's path.

### Task 7.3: Claimed-surface branch claim (F3) — PENDING

- Depends on: Task 7.2
- File: `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/frontend/chat/src/lib/services/chat-message-handler.service.ts` (MODIFY)
- Plan reference: implementation-plan.md:723-740
- Pattern to follow: the existing branch at `chat-message-handler.service.ts:829-855`; the
  `inject()` services at `:73-98`
- Quality requirements: on `'skip'`, return with no `onSurfaceCreated`, no
  `refreshQuestionTargetsForSession` and no attach. On `'bind'`, run today's surface calls, then
  `chatStore.handleSessionIdResolved({ tabId, realSessionId })`. On `'none'`, keep today's code
  byte for byte. A claim throw counts as `'none'`.
- Validation notes: P7. Place the claim before `liveness.rekey` (`:834-836`) so that `'skip'`
  does not rekey the refused tab to the aborted session. If the rekey must stay first, give the
  reason in the report.
- Tests that prove the ACs: Task 7.4, integration case 2.

### Task 7.4: Relink integration spec — PENDING

- Depends on: Task 7.3
- File: `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/frontend/chat/src/lib/services/provider-carry-over.relink.integration.spec.ts` (CREATE)
- Plan reference: implementation-plan.md:750-768; 1015-1016
- Pattern to follow: the existing message-handler and lifecycle specs' wiring of `TabManagerService`
  and `StreamRouter`
- Quality requirements: use the real services named in the plan. Assert the tab id, not the
  active tab.
- Validation notes: resolves A2 (record the result; apply the `markTabStreaming` fallback only if
  the first `generating` is dropped, and say so in the report) and A9.
- Tests that prove the ACs:
  - case 1, lifecycle branch: the tab's `claudeSessionId` is the new id (AC 4.1); the
    conversation sessions are `[old, new]` (AC 4.2); old messages are kept and new text is
    appended (AC 2.2); no refused prompt is resent (AC 4.6);
  - case 2, claimed-surface branch:
    - `'bind'`: the owning tab is bound, `isPending` is false, `onSurfaceCreated` is called once
      with the new id, and `showInfo` is called exactly once, after the attach (AC 4.3, F3);
    - `'skip'` (rebound): no `attachSession` and no `onSurfaceCreated`, no notice,
      `chat:abort { sessionId: newId }` is sent, `isPending` is false, and the session list
      refresh is requested (AC 7.7, A9);
    - `'none'`: today's calls in today's order;
  - case 3: `/compact` -> eligible -> `SESSION_ID_RESOLVED` binds the tab and shows the notice
    once (proposed AC 9.4).

### Batch 7 verification

- `npm run verify -- -p @ptah-extension/chat` passes (header: 1 project). A2, A4, A5 and A9 are
  recorded in the report.

## Batch 8: Banner button and view wiring — PENDING

- Recommended executor: CLI lane, Angular frontend capability, any family other than the phase
  reviewer's
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
  (frontend-developer)
- Subagent reason: N/A (the rendered visual check is the visual-reviewer's, after Phase 1)
- Review family: different from implementer
- Rationale: one input/output pair and one computed binding with an existing spec harness. Bounded.
- Tasks: 2 | Depends on: Batch 6 (Batch 7 is not required, but runs first by phase order)
- Phase: 1 (last batch) | Phase review: Phase 1 code-logic and style; visual review after commit

### Task 8.1: `AuthRequiredBannerComponent` button — PENDING

- Files: `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/frontend/chat/src/lib/components/molecules/notifications/auth-required-banner.component.ts` (MODIFY),
  `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/frontend/chat/src/lib/components/molecules/notifications/auth-required-banner.component.spec.ts` (CREATE)
- Plan reference: implementation-plan.md:780-785 (Component 9)
- Pattern to follow: the existing two buttons in `auth-required-banner.component.ts:21-85`
- Quality requirements: add the inputs `carryOverProvider` and `carryOverBusy` and the output
  `carryOver`. The button is a native `<button type="button">` labelled `Continue with
  {{ provider }}`, placed before the existing action, with no `aria-label` override, with
  `[disabled]` and `aria-busy`, and with `aria-describedby` pointing to a visually hidden
  disclosure span (AC 8.4). Existing buttons, layout and copy stay unchanged.
- Tests that prove the ACs (`auth-required-banner.component.spec.ts`): no button without a
  provider, and the DOM is otherwise today's (AC 1.2, 1.3); the label equals the accessible name;
  the `aria-describedby` text; disabled when busy; the click emits once; existing buttons are
  unchanged.

### Task 8.2: `ChatViewComponent` offer binding — PENDING

- Depends on: Task 8.1
- Files: `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/frontend/chat/src/lib/components/templates/chat-view.component.ts` (MODIFY),
  `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/frontend/chat/src/lib/components/templates/chat-view.component.html` (MODIFY),
  `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts` (MODIFY)
- Plan reference: implementation-plan.md:786-807
- Pattern to follow: `resolvedTabId` (`chat-view.component.ts:859`); the banner handlers
  (`:343-357`); the template block at `chat-view.component.html:147-154`; `makeHarness` (`spec:162`)
  and `sessionContextTabId` (`:177`, `:613-620`)
- Quality requirements: add the computed values `carryOverOffer` (non-null only when the
  generation and the tab match, AC 7.3) and `carryOverBusy`, plus `onCarryOver()` calling
  `start(offer)` once.
- Tests that prove the ACs (`chat-view.component.spec.ts`, a `ProviderCarryOverService` stub in
  the provider list; the banner stub gains `generation` and `origin`): a matching tab gives a
  non-null binding and the output calls `start` once; a non-matching tab gives `null` and today's
  banner; a stale generation gives `null` (AC 7.3).

### Batch 8 verification

- `npm run verify -- -p @ptah-extension/chat` passes (header: 1 project).
- Phase 1 close-out verify, run after the Batch 8 commit and before the phase review (decisions.md
  row 18, Decision T7):
  `npm run verify -- -p @ptah-extension/shared,@ptah-extension/agent-sdk,@ptah-extension/rpc-handlers,@ptah-extension/core,@ptah-extension/chat,@ptah-extension/cli-engine,ptah-electron,ptah-extension-webview`
  (header: 8 projects).
- Then the Phase 1 review (`NEEDS REVIEW`: code-logic plus style), then the visual-reviewer
  "after" screenshots in Electron, dark and light.

## Batch 9: Bounded native Codex tail read (codex-runtime) — PENDING

- Recommended executor: CLI lane, backend TypeScript capability, any family other than the phase
  reviewer's
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
  (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: one project and a fake-request harness that already exists. The protocol shapes are
  pinned in `codex-protocol-methods.ts`.
- Tasks: 2 | Depends on: Phase 1 complete, AND row 27 answered "build K2". If the user drops K2,
  mark Batches 9-11 cancelled in this file, then go to Mode 3.
- Phase: 2 "K2 native Codex read" (HELD) | Phase review: Phase 2 code-logic

### Task 9.1: `readCodexSessionTail` — PENDING

- Files: `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/backend/codex-runtime/src/lib/codex-session-history.ts` (MODIFY),
  `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/backend/codex-runtime/src/lib/codex-session-history.spec.ts` (MODIFY)
- Plan reference: implementation-plan.md:838-858, 882-893 (Component 11)
- Pattern to follow: `pages()` (`codex-session-history.ts:83-98`) and the root read (`:101-102`);
  the fake request harness (`spec:95-127`)
- Quality requirements: read the root only, with newest-first `thread/turns/list` (`itemsView:
  'full'`, `limit: 25`) and a shared item-page budget. A legacy thread gets one `includeTurns`
  read. Never call `thread/list` or any non-read method. Return turns in ascending order.
  `coversWholeHistory` follows the plan's rule. `readCodexSessionHistory` is unchanged.
- Validation notes: A7 and A8. Implement the bounded `asc` fallback (with `coversWholeHistory =
  false`) behind a rejected-`desc` error, and test it. The manual Electron check stays open (P5).
- Tests that prove the ACs: a 10x paginated thread gives at most `maxTurnPages` list calls, all
  `desc` and `limit: 25`, with `coversWholeHistory === false`, the newest turns in ascending
  order, and 0 `thread/list` calls (AC 3.10, Codex half; AC 3.9); a short thread gives
  `coversWholeHistory === true`; the item budget stops older turns; a legacy thread gets one
  read and keeps the newest `maxTurns`; a repeated cursor gives `stalledCursor`; only read
  methods are requested (A7, AC 6.1).

### Task 9.2: `CodexRuntime.readHistoryTail` and reader type — PENDING

- Depends on: Task 9.1
- Files: `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/backend/codex-runtime/src/lib/codex-runtime.types.ts` (MODIFY),
  `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/backend/codex-runtime/src/lib/codex-runtime.ts` (MODIFY),
  `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/backend/codex-runtime/src/lib/codex-runtime.spec.ts` (MODIFY);
  conditional: `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/backend/codex-runtime/src/index.ts`
  (only if the Electron port must name `CodexHistoryTail`)
- Plan reference: implementation-plan.md:859-865
- Pattern to follow: `readHistory` and `readHistoryProcess` (`codex-runtime.ts:171`, `:182-235`)
- Quality requirements: `CodexHistoryReader.readHistoryTail(profile, resume, bound, signal?)`.
  One private method shares the spawn, home verification, abort wiring, `historyReads` tracking
  and `close()`. `readHistory` behaviour is unchanged.
- Tests that prove the ACs (`codex-runtime.spec.ts`): `readHistoryTail` closes the process on
  success, on error and on abort; the existing `readHistory` cases are unchanged.

### Batch 9 verification

- `npm run verify -- -p @ptah-extension/codex-runtime` passes (header: 1 project).

## Batch 10: Native route, projector and Electron port — PENDING

- Recommended executor: subagent (backend-developer)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
  (the subagent is the first choice here; a non-reviewer-family CLI lane with confirmed room is
  the fallback)
- Subagent reason: Task 10.2 moves about 120 lines of identity validation, timeout race,
  concurrency cap and error mapping (`codex-runtime-composition.ts:527-652`) into a helper that
  the existing history view also depends on. A regression there breaks a shipped Electron
  feature, and the work needs iterative verify runs on `ptah-electron`. Lane capacity is as in
  Batch 6.
- Review family: different from implementer
- Rationale: the port interface (agent-sdk) and its only implementation (ptah-electron) change
  together: 6 files, 2 projects.
- Tasks: 2 | Depends on: Batch 9
- Phase: 2 (HELD) | Phase review: Phase 2 code-logic

### Task 10.1: Native carry-over route and projector — PENDING

- Files: `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/backend/agent-sdk/src/lib/codex-app-server/session-history-router.ts` (MODIFY),
  `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/backend/agent-sdk/src/lib/codex-app-server/session-history-router.spec.ts` (MODIFY),
  `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/backend/agent-sdk/src/lib/codex-app-server/codex-carry-over-projector.ts` (CREATE),
  `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/backend/agent-sdk/src/lib/codex-app-server/codex-carry-over-projector.spec.ts` (CREATE)
- Plan reference: implementation-plan.md:907-960 (Component 12, native part); Decision T2
  (replaces Task 3.1's native throw)
- Pattern to follow: `nativeHistory` error collapsing (`session-history-router.ts:98-110`);
  `codex-history-projector.ts`
- Quality requirements: `NativeSessionHistoryPort.readHistoryTail?(session, bound, signal?)`.
  `readCarryOverTranscript` gains `nativeBound`. The native route calls `readHistoryTail`: an
  absent port or method gives `nativePortUnavailable`, errors collapse as in `nativeHistory`, and
  a projection throw gives `nativeReadFailed`. The projector follows the plan's item mapping and
  never reads inputs, outputs, commands, diffs or arguments. `startsAtCompactionSummary` is
  always `false`.
- Tests that prove the ACs:
  - router: a native id routes to `readHistoryTail` with the bound and never calls
    `readHistory`; a port without the method gives `nativePortUnavailable`; a port error is
    collapsed; the Claude route is unchanged;
  - projector: the mapping for each item kind; a sentinel in command output, file diff, MCP
    arguments and reasoning is absent (AC 3.5, 3.6, 3.9); image and mention placeholders
    (AC 3.7); `contextCompaction` gives `startsAtCompactionSummary === false` (AC 3.8).

### Task 10.2: Electron history port `readHistoryTail` — PENDING

- Depends on: Task 10.1
- Files: `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/apps/ptah-electron/src/di/codex-runtime-composition.ts` (MODIFY),
  `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/apps/ptah-electron/src/di/codex-history-port.spec.ts` (CREATE)
- Plan reference: implementation-plan.md:866-870, 896-897
- Pattern to follow: `createElectronCodexHistoryPort` (`codex-runtime-composition.ts:485`,
  `:505-652`)
- Quality requirements: one private helper takes the runtime call, and `readHistory` and
  `readHistoryTail` both use it. The concurrency cap of two is shared. A runtime without
  `readHistoryTail` gives `runtimeFailed`. `readHistory` behaviour is unchanged.
- Tests that prove the ACs (`codex-history-port.spec.ts`): identity validation failures; `busy` at
  the third concurrent read; the timeout path; the bound is passed unchanged to the runtime; a
  `readHistory` regression case.

### Batch 10 verification

- `npm run verify -- -p @ptah-extension/agent-sdk,ptah-electron` passes (header: 2 projects).

## Batch 11: Enable native sources in the carry-over service — PENDING

- Recommended executor: CLI lane, backend TypeScript capability, any family other than the phase
  reviewer's
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
  (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: a small change to two existing modules plus their specs. Each edit is fixed by the
  plan.
- Tasks: 1 | Depends on: Batch 10
- Phase: 2 (HELD, last batch) | Phase review: Phase 2 code-logic

### Task 11.1: Native source kind, native bound and constants — PENDING

- Files: `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/backend/rpc-handlers/src/lib/chat/session/chat-carry-over.service.ts` (MODIFY),
  `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/backend/rpc-handlers/src/lib/chat/session/chat-carry-over.service.spec.ts` (MODIFY),
  `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/backend/rpc-handlers/src/lib/chat/session/chat-carry-over-transcript.ts` (MODIFY),
  `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/backend/rpc-handlers/src/lib/chat/session/chat-carry-over-transcript.spec.ts` (MODIFY, only if
  the constants get a case)
- Plan reference: implementation-plan.md:320-323 (native constants), 377-382, 399-402, 420-421,
  449-455, 470-471; Decisions T2 and T4
- Pattern to follow: Batch 4's `evaluate` and the router call
- Quality requirements: add `CARRY_OVER_NATIVE_MAX_TURNS = 200`,
  `CARRY_OVER_NATIVE_MAX_TURN_PAGES = 8` and `CARRY_OVER_NATIVE_MAX_ITEM_PAGES = 16`. In
  `evaluate`, `codex-app-server` plus `'openai-codex'` becomes eligible. Any other native
  `providerId` stays not eligible, with no router call. The router call passes `nativeBound`.
  Logs carry `source: 'codex-native'`. No native adapter call (no resume, compact or turn).
- Validation notes: P4. Record in the report how long the probe takes in the spec harness. That
  is not real latency; it only shows that the code adds no wait of its own.
- Tests that prove the ACs (`chat-carry-over.service.spec.ts`): native Codex -> Claude is eligible
  (AC 1.1, D9); same provider for a native session is not eligible, with no probe (AC 2.5); a
  native identity with a non-Codex `providerId` is not eligible and the router is called 0 times;
  the router receives the three native constants (AC 3.10); unreadable or empty native history
  gives no start (AC 5.1); no native adapter call (AC 6.1). Replace the Batch 4 case "a native
  identity is not eligible" with these cases.

### Batch 11 verification

- `npm run verify -- -p @ptah-extension/rpc-handlers` passes (header: 1 project).
- Phase 2 close-out verify, after the Batch 11 commit:
  `npm run verify -- -p @ptah-extension/codex-runtime,@ptah-extension/agent-sdk,@ptah-extension/rpc-handlers,@ptah-extension/cli-engine,ptah-electron,ptah-extension-webview`
  (header: 6 projects).
- Then the Phase 2 code-logic review. The visual "after" set gains a `/compact` carry-over from a
  native Codex session.
