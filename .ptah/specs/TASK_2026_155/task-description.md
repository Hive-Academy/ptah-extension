# Requirements Document - TASK_2026_155

**Task**: Claude Code-style `/goal` workflow for Ptah
**Classification**: WF (workflow feature) | Priority: P1-High | Size: L
**Date**: 2026-07-14 | **Branch at start**: `ak/fix-canvas-issue`
**Source context**: `.ptah/specs/TASK_2026_155/context.md` (approved research — do not re-litigate the mechanism)

---

## 1. Introduction

### Problem Statement

Today a Ptah session stops when the agent decides its turn is done. For long-horizon work ("make all tests pass", "get lint to zero errors", "finish the migration and show a green build"), the user must babysit the session: read the result, notice it isn't finished, and prompt "keep going" — repeatedly. Claude Code shipped `/goal` (v2.1.139, April 2026) and Codex shipped an equivalent shortly after; both let the user declare a **measurable completion condition** once, then keep the session working across turns until an automated evaluator confirms the condition is met. Ptah — whose entire positioning is "AI coding orchestra" — currently has no equivalent, which is a visible competitive gap on the exact axis (autonomous, multi-turn work) where Ptah claims superiority.

### User Value

- **Set-and-walk-away sessions**: user states the end condition once; the session self-continues with evaluator feedback as steering, instead of the user re-prompting.
- **Bounded autonomy, not runaway autonomy**: the evaluator is a cheap read-only judge; the main agent still goes through the normal tool-permission gate. The goal never widens what the agent is allowed to do — only how long it keeps trying.
- **Transparency**: at any moment the user can see the active condition, elapsed time, turns evaluated, evaluator token spend, and the evaluator's last reason for continuing.

### Mechanism (approved — summary)

`/goal <condition>` stores a session-scoped completion condition (≤ 4000 chars) and immediately starts a turn with the condition as the directive. A session-scoped **Stop-hook evaluator loop** runs after each turn: condition + transcript evidence are sent to a small fast (Haiku-class) model that returns achieved yes/no + a short reason. "No" blocks the stop and injects the reason as guidance for the next turn; "yes" clears the goal and records an achieved entry. The evaluator runs **no tools** — it judges only what the main agent surfaced in the transcript, so conditions must be written as transcript-demonstrable end states.

### Verified Codebase Anchors

| Concern                        | Anchor (verified 2026-07-14)                                                                                                                                                                                                                                                            |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stop-hook fan-out              | `libs/backend/agent-sdk/src/lib/helpers/stop-hook-handler.ts` — currently always returns `{ continue: true }`; goal evaluation must be able to return a stop-blocking decision, not just notify. `StopCallbackRegistry` payload (`stop-callback-registry.ts`) is fire-and-forget today. |
| Hook wiring                    | `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts` (hooks assembled into SDK query options)                                                                                                                                                                          |
| Cheap one-shot evaluator query | `libs/backend/agent-sdk/src/lib/internal-query/internal-query.service.ts` — existing headless SDK query path (used by skill-synthesis, memory-curator) is the natural evaluator transport                                                                                               |
| RPC runtime guard              | `libs/backend/vscode-core/src/messaging/rpc-handler.ts:44` `ALLOWED_METHOD_PREFIXES` — `goal:` prefix must be added here AND in `libs/shared/.../rpc.types.ts` (dual-registration rule)                                                                                                 |
| Persistence                    | `libs/backend/persistence-sqlite` (`~/.ptah/ptah.db` + migrations) for goal state surviving session resume                                                                                                                                                                              |
| Slash-command UI               | `libs/frontend/chat/src/lib/directives/slash-trigger.directive.ts` (slash autocomplete) and `libs/frontend/chat/src/lib/services/chat-store/message-dispatch.service.ts` (`isBlockedSlashCommand` intercept point) — `/goal` should hook the same intercept path, not invent a new one  |
| Session identity               | SDK UUID from the system `init` message is the canonical sessionId (agent-sdk CLAUDE.md) — goal records must key on it                                                                                                                                                                  |

---

## 2. Requirements

### Requirement 1: Set a goal

**User Story:** As a Ptah user in any chat session (VS Code webview, Electron, or CLI), I want to type `/goal <condition>` to declare a measurable completion condition, so that the session keeps working across turns until that condition is met without me re-prompting.

#### Acceptance Criteria

1. WHEN the user submits `/goal <condition>` in the chat input THEN the system SHALL store the condition as the session's active goal AND immediately start a turn whose directive is the condition text (plus standing guidance that the session will continue until an evaluator confirms completion).
2. WHEN a goal is set THEN the stored goal record SHALL include: condition text, owning sessionId (SDK canonical UUID), createdAt timestamp, turns-evaluated counter (0), evaluator token spend (0), and last evaluator reason (null).
3. WHEN the submitted condition exceeds 4000 characters THEN the system SHALL reject it with a user-visible error stating the cap AND SHALL NOT modify any existing active goal.
4. WHEN `/goal` is submitted with no condition text AND no goal is active THEN the system SHALL show usage help (set / status / clear syntax) instead of setting an empty goal.
5. WHEN the user sets a goal while another goal is already active in the same session THEN the system SHALL replace the old goal with the new one (replace-on-reset semantics) AND record the old goal as superseded (not achieved).
6. WHEN a goal is set THEN the system SHALL surface (in the confirmation message) guidance that conditions should be transcript-demonstrable end states (e.g., "all tests pass and the passing output is shown") and that turn/time bounds belong inside the condition text.

### Requirement 2: Evaluator loop (Stop-hook)

**User Story:** As a user with an active goal, I want an automated evaluator to check after every turn whether my condition is met, so that the session either continues with concrete guidance or stops cleanly when done.

#### Acceptance Criteria

1. WHEN the main agent's turn ends (SDK Stop hook fires) AND the session has an active goal THEN the system SHALL send the condition plus relevant transcript evidence to a small fast (Haiku-class) evaluator model via a one-shot internal query AND SHALL receive a structured verdict: `achieved: boolean` + short `reason` string.
2. WHEN the evaluator verdict is "not achieved" THEN the Stop hook SHALL block the stop AND feed the evaluator's reason to the main agent as guidance for the next turn AND increment the goal's turns-evaluated counter AND update last-evaluator-reason and token-spend fields.
3. WHEN the evaluator verdict is "achieved" THEN the system SHALL allow the stop, mark the goal achieved (with final reason and timestamp), clear it as the session's active goal, AND surface an "goal achieved" notice in the chat transcript.
4. WHEN the evaluator produces malformed output (unparseable, missing verdict) THEN the system SHALL treat the turn as "not achieved" at most once consecutively; on a second consecutive malformed response the system SHALL allow the stop, keep the goal active, and surface a warning to the user (fail-open, never infinite-retry on a broken evaluator).
5. WHEN a Stop event fires for a session with NO active goal THEN existing Stop-hook behavior SHALL be unchanged (regression guard: current `StopCallbackRegistry` fan-out and `emitTurnEnded` semantics preserved).
6. WHEN the user manually interrupts/cancels the running turn THEN the goal SHALL remain stored but the loop SHALL NOT auto-restart the turn; the goal resumes evaluation on the next completed turn (user interrupt always wins).
7. The evaluator SHALL run zero tools — its input is condition + transcript evidence only; verdicts are based solely on what the main agent surfaced in the transcript.

### Requirement 3: Goal status

**User Story:** As a user, I want `/goal` (bare, with an active goal) or `/goal status` to show the current goal's state, so that I can judge whether the loop is making progress or spinning.

#### Acceptance Criteria

1. WHEN the user requests goal status AND a goal is active THEN the system SHALL display: condition text, elapsed time since set, number of turns evaluated, cumulative evaluator token spend (and cost estimate if a price is known for the evaluator model), and the last evaluator reason.
2. WHEN the user requests goal status AND no goal is active THEN the system SHALL say so and show set-usage help, optionally including the most recent completed/cleared goal for the session.
3. WHEN a `goal:status` RPC is called for a given sessionId THEN it SHALL return the same data as the chat command (single source of truth; the chat command and any UI indicator consume the same RPC/service surface).

### Requirement 4: Clear a goal (and aliases)

**User Story:** As a user, I want `/goal clear` to cancel the active goal, so that the session returns to normal one-turn behavior immediately.

#### Acceptance Criteria

1. WHEN the user submits `/goal clear` (or aliases: `stop`, `off`, `reset`, `none`, `cancel`) THEN the system SHALL clear the active goal, record it as cleared-by-user (distinct from achieved/superseded), and confirm in chat.
2. WHEN the goal is cleared mid-turn THEN the currently running turn SHALL finish normally but the Stop-hook evaluator SHALL NOT run for it (no further auto-continuation).
3. WHEN `/goal clear` is submitted with no active goal THEN the system SHALL respond with a no-op notice (no error state).

### Requirement 5: One goal per session, session-scoped

**User Story:** As a user running multiple concurrent sessions (canvas tiles, background agents), I want goals to be strictly per-session, so that one session's goal never affects another session's stop behavior.

#### Acceptance Criteria

1. WHEN goals exist in two different sessions THEN each Stop-hook evaluation SHALL resolve the goal by the canonical SDK sessionId from the hook input AND never evaluate against another session's condition.
2. WHEN a session has an active goal THEN attempting to set a second goal in the same session SHALL follow Requirement 1.5 (replace), never create two concurrently active goals for one session.
3. Goal state SHALL be maintained in the backend (runtime-agnostic libs), not in webview state, so that all three runtimes (VS Code, Electron, CLI) share identical semantics.

### Requirement 6: Persistence and resume

**User Story:** As a user, I want an active goal to survive extension reload / app restart / session resume, so that long-horizon work is not silently orphaned.

#### Acceptance Criteria

1. WHEN a goal is set, updated (per-evaluation counters), achieved, superseded, or cleared THEN the change SHALL be persisted via `persistence-sqlite` (`~/.ptah/ptah.db`, with a proper migration).
2. WHEN a session with a stored active goal is resumed THEN the goal SHALL be restored as active: the evaluator loop re-arms for subsequent turns AND the UI indicator (Req 7) reflects the restored goal. Restoring SHALL NOT auto-start a turn by itself; evaluation resumes when the user (or the loop, once running) completes the next turn.
3. WHEN a session is deleted THEN its goal records SHALL be cleaned up (no orphan rows accumulating).

### Requirement 7: RPC surface and webview UI

**User Story:** As a webview user, I want a visible active-goal indicator with the latest evaluator reason, so that I can see at a glance that the session is in goal mode and why it is still going.

#### Acceptance Criteria

1. A new `goal:` RPC namespace SHALL be registered in BOTH `libs/shared/.../rpc.types.ts` (compile-time contract) AND `ALLOWED_METHOD_PREFIXES` in `libs/backend/vscode-core/src/messaging/rpc-handler.ts` (runtime guard) — minimum methods: set, status, clear (list-history optional). All params/results validated with Zod at the boundary.
2. WHEN a goal is active THEN the chat surface SHALL show a persistent, non-intrusive active-goal indicator (condition summary + turns evaluated + last evaluator reason) that updates as evaluations occur, and offers a one-click clear.
3. `/goal` SHALL appear in the existing slash-command autocomplete (`slash-trigger.directive.ts`) AND be intercepted client-side via the existing dispatch intercept path (`message-dispatch.service.ts`) rather than being sent verbatim to the model.
4. Goal state changes originating in the backend (achieved, evaluator-continue, cleared) SHALL be pushed to the webview (existing message/event channel), not polled.
5. The CLI runtime SHALL be able to drive the same feature through its JSON-RPC surface (set/status/clear); a bespoke CLI UX beyond method parity is NOT required in v1.

---

## 3. Non-Functional Requirements

### Cost & Performance

- **Evaluator model**: MUST be a cheap/fast (Haiku-class) model, resolved via the existing provider/tier machinery — never the session's main model. The choice MUST be a single configurable default, not hardcoded in the hook.
- **Cost bound**: one evaluator call per completed turn per goal — never more than one concurrent evaluation per session; evaluator input SHALL be bounded (recent-transcript window / summary, not the unbounded full transcript) so a long session cannot make per-turn evaluation cost grow without limit. Cumulative evaluator token spend is tracked and shown in status (Req 3).
- **Latency**: evaluation happens inside the Stop hook; it SHALL have a hard timeout (architect to pick; on timeout treat as the malformed-output path of Req 2.4 — fail open, allow stop, keep goal, warn user).

### Safety (no permission escalation)

- Goal mode SHALL NOT change tool-permission behavior: the main agent still passes every tool call through `SdkPermissionHandler` exactly as without a goal. A goal extends persistence, never authority.
- The evaluator query SHALL run with no tools and no filesystem/network capabilities beyond the model call itself.
- The loop SHALL never override an explicit user interrupt (Req 2.6) and SHALL respect any SDK-level stop conditions that indicate a terminal/error state (do not block stop on turns that ended in error/abort — architect to enumerate terminal reasons via existing `narrowTerminalReason`).

### Resilience

- **Evaluator unavailable** (no API key, provider down, model unknown): fail open — allow the stop, keep the goal active, surface a clear warning with remediation hint. The session must never hang or crash because the evaluator is unreachable.
- **Hook safety**: all goal logic in the Stop hook SHALL be wrapped so that an unexpected throw degrades to current behavior (`{ continue: true }`), matching the existing swallow-and-log pattern in `StopHookHandler`.

### Runtime Coverage

- Backend logic (goal manager, evaluator, persistence, RPC handlers) SHALL live in runtime-agnostic backend libs depending only on `platform-core` ports — no branching per runtime. UI lands in the shared webview chat (VS Code + Electron); CLI gets RPC-method parity.
- Frontend↔backend isolation preserved: new shared types/contracts go in `libs/shared` only.

### Compliance / Marketplace

- No new trademarked AI product names (`claude`, `anthropic`, `copilot`, `codex`, `openai`) in non-JS files shipped in the VSIX (docs, templates, package.json contributes). Any user-facing docs mentioning the mechanism follow the existing `ContentDownloadService` runtime-fetch rule.

---

## 4. Scope Boundaries (v1)

**In scope**: everything in Requirements 1–7 above.

**Explicitly OUT of scope for v1:**

1. **No new agent-spawning mechanics.** The goal loop steers the existing single session; Ptah's existing sub-agent / CLI-agent delegation already covers parallelism. The evaluator never spawns agents.
2. **No cross-vendor goal passthrough.** `/goal` applies to Ptah's Claude-SDK session loop only; no forwarding of goal semantics into codex/copilot adapter sessions.
3. **No evaluator tool use** (e.g., letting the evaluator run tests itself) — transcript-judging only, matching upstream behavior.
4. **No workspace-level or multi-session goals** — strictly one goal per session.
5. **No dedicated goal-management panel** — the chat indicator + slash command + RPC is the whole v1 UI. Thoth-shell tabs are untouched.
6. **No backward-compatibility shims**: the Stop-hook handler is modernized in place to support blocking decisions; no parallel "legacy stop path" is kept.

---

## 5. Stakeholders (brief)

| Stakeholder                  | Impact | Success criterion                                                                                           |
| ---------------------------- | ------ | ----------------------------------------------------------------------------------------------------------- |
| End users (all 3 runtimes)   | High   | Can set a goal and return to a finished (or honestly-stopped) session; status always explains what happened |
| Product (competitive parity) | High   | Feature parity with Claude Code `/goal` semantics; demoable in marketing                                    |
| Dev team                     | Medium | Stop-hook refactor doesn't regress existing turn-ended events, background-task, or cron flows               |
| Ops/cost                     | Medium | Evaluator spend visible, bounded, on cheap model only                                                       |

---

## 6. Risks

| Risk                                                                                             | Prob.   | Impact   | Mitigation                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------ | ------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Infinite loop: evaluator keeps saying "not achieved" on an unachievable condition                | High    | High     | Reasons shown live in UI; one-click clear; guidance to embed turn/time bounds in condition text; interrupt always wins. Architect should consider a soft warning after N consecutive continues. |
| Stop-hook refactor regresses existing fan-out (`emitTurnEnded`, background tasks, session crons) | Medium  | Critical | Req 2.5 regression guard; existing behavior is the no-goal fast path; tests must cover both paths.                                                                                              |
| Evaluator misjudges (false "achieved" or judges stale transcript)                                | Medium  | Medium   | Transcript-demonstrable-condition guidance (Req 1.6); reason string always recorded so misjudgment is auditable.                                                                                |
| Blocking the SDK stop is not supported the way we assume (hook contract)                         | Low–Med | Critical | Architect MUST verify the SDK's Stop-hook block/continue contract (`HookJSONOutput` decision fields) in the installed `@anthropic-ai/claude-agent-sdk` version before design sign-off.          |
| Evaluator cost creep on very long sessions                                                       | Medium  | Medium   | Bounded transcript window + spend tracking in status (NFR Cost).                                                                                                                                |
| Concurrent sessions / canvas tiles cross-firing evaluations                                      | Low     | High     | Strict sessionId keying (Req 5.1); one in-flight evaluation per session.                                                                                                                        |

---

## 7. Open Questions for the Architect

1. **Stop-hook blocking contract**: exact `HookJSONOutput` shape to block a stop and inject guidance in the installed SDK version — and whether the injected reason arrives as a user-visible message or hidden directive. (Highest-priority verification; the whole feature rests on it.)
2. **Transcript evidence strategy**: what exactly is sent to the evaluator — `last_assistant_message` only (already in hook input), a recent-N-turns window via `JsonlReaderService` / `SessionHistoryReaderService`, or a running summary? Pick one with a hard token bound.
3. **Evaluator transport**: confirm `InternalQueryService` is suitable from inside a Stop hook (re-entrancy: a one-shot SDK query firing while the parent query's hook is pending), or whether a raw provider HTTP call is safer.
4. **Where GoalManager lives**: inside `agent-sdk` (boundary note: agent-sdk's charter says "no persistence beyond SDK JSONL"), vs. a thin goal service in another backend lib that agent-sdk calls through a registry callback — architect to resolve the lib boundary.
5. **StopCallbackRegistry evolution**: extend the registry to support decision-returning callbacks vs. a dedicated first-class goal evaluator step inside `StopHookHandler` before fan-out.
6. **Resume trigger**: on session resume with a restored active goal, is the goal merely re-armed (Req 6.2, current requirement) or should the UI offer a "resume working toward goal" one-click that starts a turn? (Requirement says re-arm only; UX nicety optional.)
7. **Premium gating**: should `/goal` be feature-gated (FeatureGate/license tier) like other premium features? Assumed NOT gated in v1 unless product says otherwise.
8. **Achieved-goal history retention**: how many completed/cleared goal records to retain per session in SQLite (assume: all, pruned with session deletion — Req 6.3).

---

## 8. Success Metrics

- A user can run "make the failing test in X pass and show the passing output" as a goal and walk away; session self-continues and stops with an achieved notice — demonstrated end-to-end in Electron and VS Code webview, plus RPC-level in CLI.
- Zero regressions in existing Stop-hook consumers (turn-ended events, background-task nudges, session crons) — existing test suites stay green.
- Evaluator spend for a 10-turn goal session stays in Haiku-class cost territory and is fully visible in `/goal status`.
- Goal survives a full extension-host reload and resumes correctly.
