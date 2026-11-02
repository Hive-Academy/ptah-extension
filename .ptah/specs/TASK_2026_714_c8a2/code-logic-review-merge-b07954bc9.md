# Code Logic Review — merge b07954bc9

Review family: codex  
Implementer family: claude (coordinator)

## Summary

| Metric | Value |
| --- | --- |
| Score | 6/10 |
| Verdict | REVISE |
| Blocking / serious / moderate findings | 0 / 1 / 0 |
| Scope | The five named conflict resolutions and positional `ChatSessionService` constructors in `libs/backend/rpc-handlers` and `apps` |

The merge preserves both parents' named paths, but their combination skips host-routing admission for a native Codex follow-up that resumes an inactive thread. This is a real integration gap, which puts the score below the sound 7–8 band. The other four resolutions are consistent, so this is above the 3–4 band that would require a broader rewrite.

## Findings

### 1. Serious — resumed native Codex follow-up bypasses host routing

- **File:** `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:1663` and `:1723`.
- **Trigger:** An Electron user sends a plain follow-up to an inactive Codex session, such as after an app restart.
- **Trace:** `continueSession` calls `autoResumeIfInactive` with `deliversFollowUp: true` (`:1614-1621`). For native Codex, `resumeSession` starts that turn and sets `promptDelivered` (`:2427-2438`, `:2460-2463`). The `if (promptDelivered)` branch returns success at `:1663-1673`, before the retained main-branch `admitHostRoutingTurn` call at `:1722-1725`.
- **Impact:** Host routing never sees this user turn. Its scope check, prior-turn state and possible next-turn reminder are absent for that turn. `HostRoutingCoordinator.admitUserTurn` begins this work at `libs/backend/rpc-handlers/src/lib/chat/host-routing/host-routing.coordinator.ts:196-238`.
- **Fix:** Admit the plain prompt on the `promptDelivered` success path after `resumeSession` accepts the turn, before returning. Keep the existing post-send admission for ordinary and streamless follow-ups; avoid double admission.

## Five logic questions

1. **How does this fail silently?** The `promptDelivered` return reports success while bypassing admission (`chat-session.service.ts:1663-1673`, `:1723-1725`); the user receives no routing reminder for that turn.
2. **What user action produces unexpected behaviour?** Continuing an inactive native Codex session with a plain prompt takes the resume path (`chat-session.service.ts:1614-1625`, `:2460-2463`).
3. **What input data produces a wrong answer?** Any nonblank, nonslash follow-up prompt on that path is omitted from the routing coordinator's `previousUserTurn` and scope snapshot (`host-routing.coordinator.ts:198-222`).
4. **What happens when a dependency fails?** The retained admission wrapper catches a synchronous coordinator failure and logs its class without failing an already dispatched turn (`chat-session.service.ts:969-983`). The coordinator observes its asynchronous scope-check rejection (`host-routing.coordinator.ts:224-240`). Neither handling covers a call that is skipped.
5. **What is missing that the requirements never mentioned?** The merged host-routing spec covers ordinary start and send, but has no native resume-delivered turn case (`chat-session.host-routing.spec.ts:251-317`); that cross-parent path needs a focused assertion.

## Resolution checks

| Conflict resolution | Result | Evidence |
| --- | --- | --- |
| Lane task-kind alias and Codex factory order | Correct. Lane routing registers the classifier, then Electron aliases it, binds the Codex factory, and registers CLI runtime. Outcome recorder resolves the alias lazily. | `apps/ptah-electron/src/di/phase-2-libraries.ts:294-312`; `libs/backend/lane-routing/src/lib/di/register.ts:205-214`; `libs/backend/lane-outcomes/src/lib/di/register.ts:76-94`; `apps/ptah-electron/src/di/codex-lane-composition.ts:231-236` |
| Smoke-test imports | Correct. All three expected-token lists are imported and used. | `apps/ptah-electron/src/di/container.smoke.spec.ts:101-110`, `:1433-1444` |
| Duplicate SDK token import | Correct. One `SDK_TOKENS` import remains and the token list uses it. | `apps/ptah-electron/src/di/expected-resolvable.ts:1`, `:38-45` |
| Session constructor and methods | Both branch runtime parameters precede main's optional host routing; `sessionIdResolvedEvents` remains last. `codexFailure` and `admitHostRoutingTurn` both remain. | `chat-session.service.ts:363-381`, `:913-983` |
| Start and follow-up calls | Main's start call remains after launch (`:1096-1118`); main's follow-up call remains after send (`:1713-1725`). Branch native Codex start and resume paths remain (`:1501-1515`, `:1661-1673`, `:2427-2463`). The resume early return is Finding 1. | `chat-session.service.ts` at cited lines; compared with `git show origin/main:<path>` and `git show HEAD:<path>` |
| Positional test constructors | The added `undefined` values put `hostRouting` at argument 32, after `runtimeProfile` and `sessionRuntimeRouter` (arguments 30–31). No other constructor in the requested trees supplies an argument after `activeProvider`. | `chat-session.host-routing.spec.ts:198-206`; `chat-session.service.ts:359-380`; `chat-session.account-binding.spec.ts:255-260` |

The positional search found 14 `new ChatSessionService(...)` call sites in `libs/backend/rpc-handlers` and none in `apps`. The only other call reaching `activeProvider` is `chat-session.account-binding.spec.ts:192` (last argument at `:259`); it does not shift. **Other shifted specs: none.**

## Data flow and edge cases

`chat:start` → launch adapter → start stream → admit plain prompt: **OK** (`chat-session.service.ts:1096-1118`).  
Active `chat:continue` → send adapter message → admit plain prompt: **OK** (`:1708-1727`).  
Inactive Codex `chat:continue` → native resume starts prompt → early success return → admission skipped: **Finding 1** (`:1614-1625`, `:1663-1673`).  
Slash and Ptah-CLI paths intentionally skip admission; the host-routing spec covers these exclusions (`chat-session.host-routing.spec.ts:318-423`).

## Decisions and verification

- **Decision:** Treat a successfully resumed native Codex follow-up as a dispatched interactive turn. The alternative is to exempt it from host routing; main's admission contract and the resume code's `promptDelivered` semantics support inclusion. This is reversible by moving the admission call.
- **Verification:** Read-only inspection of staged resolutions, working-tree source, `origin/main` and `HEAD` versions of the session service, the coordinator, and all positional constructor sites. No tests, diagnostics, typecheck, lint, build or other verification command was run, as required by this review assignment. Runtime behavior remains unverified.

## Verdict

**REVISE** — admit the native Codex resume-delivered follow-up and cover that path in the focused host-routing spec. Confidence: high for the control-flow finding; medium for runtime impact without executing checks.
