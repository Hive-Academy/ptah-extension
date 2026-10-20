# Code Style Review (Phase 2, Batches 9-13) - TASK_2026_692_f748

Review family: code-style-reviewer (Claude). Read-only. `npx prettier --check` on all changed .ts files passed. No tests, typecheck or lint run.

Score: 7/10. Verdict: NEEDS_REVISION (one Serious finding, no Blocking).

## Findings

### Serious

**S1. Consumers depend on the concrete `IdleCompactionService` instead of the planned interface.**
- `session-lifecycle-manager.ts` (new import near line 74; ctor param `idleCompaction: IdleCompactionService | null`, about line 420) and `compaction-hook-handler.ts` (import line 43, ctor param about line 163).
- The plan (8c, implementation-plan.md:559-561) typed the facade's dependency as `IdleCompactionSignals & { dispose(); boundaryNoticeFor() }`. `SessionQueryExecutor` and `CompactionSessionTap` do use the interface (`session-query-executor.service.ts:58,213,566`), so the same token is typed two ways.
- The facade now imports the service class, which pulls in its whole dependency graph. The hook-handler's other optional collaborators use narrow ports (`IContextUsagePort`, `Pick<>` rekey target, `SubagentBudgetSink`), so this one is the odd one out.
- Fix: add an exported `IdleCompactionFacadePort = IdleCompactionSignals & Pick<IdleCompactionService, 'dispose' | 'boundaryNoticeFor'>` in `idle-compaction.types.ts`. The hook handler needs only the rekey/PostCompact signal subset.

### Moderate

**M1. `session-query-executor.service.ts` is over the max-lines rule and the new code is mixed into it.**
- Non-blank, non-comment lines are 756, against the `max-lines` 700 warn at `eslint.config.mjs:558`. The file is 1081 raw lines, so it was already large before this batch.
- The idle tap producers are one cohesive responsibility: the `requestTracker` field, `guardIdle`, and the rate-limit, compact-boundary, session-bound, turn-end and release emission (lines ~251-269, 281-286, 413, 459-461, 466-471, 509-519). The idle logic is also split from the rest of the signal mapping, not placed with it.
- Fix: move the mapping into a small `idle-tap-signals.ts` in `compaction/idle/`. Give it a function such as `emitIdleSignalsForMessage(idle, tracker, message, ...)` and a `guardIdle` helper, and keep the tap as a thin caller.
- If that is deferred, record it in decisions.md. A new warning is being added to a file that already warns.

**M2. `SDK_IDLE_COMPACTION` registration inlines wiring and uses the string-free cast chain.**
- `register.ts:502-546`. The factory resolves 6 collaborators, does optional-host probing, and builds the `IdleCompactSender` closure. The closure casts `sessionId as Parameters<SessionLifecycleManager['sendIdleCompact']>[0]` where `SessionId` could be imported directly.
- It also imports `PLATFORM_TOKENS` into a registration file that, per its own comment at line 146, avoids platform tokens for decorator injection. This is an agent-sdk to platform-core dependency, which is allowed by the ports rule, but it is a new first use in this file.
- Neighbouring registrations are mostly `useClass` or short factories (see the compaction coordinator at about line 480).
- Fix: use the `SessionId` type, and consider moving the factory body to `createIdleCompactionService(container)` in `compaction/idle/`.

### Minor

- **m1. Token naming and placement.** `tokens.ts:74-75`, `Symbol.for('SdkIdleCompaction')`, follows the `SdkCompactionCoordinator` convention and sits next to it. PASS. The JSDoc is thinner than neighbours, which cite a TASK id and lifecycle (compare line 70-72). Add `(TASK_2026_692)` and "Singleton".
- **m2. Optional-injection default style differs by file.** `session-lifecycle-manager.ts` uses `| null = null` (matches its neighbours, `:417-421`). The hook handler and router use `?:` undefined (matches their neighbours). Each is locally consistent, so this is not a defect.
- **m3. `idleCompactionNoticeFor` (session-lifecycle-manager.ts ~740) has no return type annotation.** It relies on inference through the concrete service. Declare `IdleBoundaryNotice | undefined`. This goes away if S1 is fixed.
- **m4. `compaction-hook-handler.ts` PostCompact restructure (~lines 533-545).** It is split into two `if` blocks so the coordinator receives `postPayloadSessionId ?? postFallbackSessionId`. This is behaviour, not style, so it is routed to the logic reviewer. The block gained no comment saying why the coordinator now tolerates a missing payload id.
- **m5. Router `chat-slash-command-router.service.ts` (~120-140 and ~165-195).** The two admission try/catch blocks are near-duplicates with the same log text, which is the beginning of duplication-with-drift. Extract a private `tryAdmit(sessionId, mode)` helper if a third call site appears. Acceptable now.
- **m6. Comment density.** New executor code is nearly uncommented (e.g. `rate_limit_event` status filter, the `turn` increment moved ahead of the `port/query` guard). The surrounding code explains each ordering. Add one-line why-comments on the moved `this.turn += 1` and on `guardIdle` placement.

## Answers to the review focus

- **Token / registration pattern.** `Symbol.for('SdkIdleCompaction')` in the `SDK_TOKENS` object, registered with `instanceCachingFactory` beside the coordinator. PASS (see M2 for the factory size).
- **Phased-DI guard specs.** `expected-resolvable.ts` in the CLI and VS Code apps contains zero `SDK_TOKENS` entries (grep count 0), and no neighbouring SDK token (`SDK_COMPACTION_COORDINATOR`, `SDK_SESSION_BUDGET`, budget-stop registry) appears in `expected-resolvable.ts`, `surface-composition.spec.ts` or `rpc-surface.spec.ts`. Those files track RPC and host surfaces, not agent-sdk internals, so `container.smoke.spec.ts` in each app (CLI, Electron, VS Code, all touched) is sufficient and matches the precedent. No change is needed. Re-check `tools/di-lint` on push, because the token is consumed through `@inject` with `isOptional` in two classes.
- **Optional injection.** Last-param `{ isOptional: true }` in `session-lifecycle-manager.ts` (the last of the ctor params), `compaction-hook-handler.ts` (last param) and the router (`SDK_COMPACTION_COORDINATOR` at `:62`). PASS. `session-query-executor.service.ts` is not DI-decorated; the signals arrive as a plain ctor argument, which matches how `subagentBudgetMonitor` is passed. PASS.
- **Concrete vs interface.** FAIL in two files (S1). The router correctly depends on the `ManualCompactAdmission` type (a `Pick<>`), not the coordinator class.
- **rpc-handlers imports.** `chat-slash-command-router.service.ts:22` imports `type ManualCompactAdmission` from `@ptah-extension/agent-sdk`, which is exported at `libs/backend/agent-sdk/src/index.ts:143`. No deep paths. PASS.
- **File size.** See M1: 756 against 700.
- **Naming and comments.** File names are kebab-case with role suffixes. Types and methods are domain-named (`requestStarted`, `compactBoundary`, `boundaryNoticeFor`). Comment density is low in the new executor code (m6).

## Five style questions (brief)

1. Six months out: the tap emits one signal per branch, so each new idle signal adds a branch to a 756-line file. Moving them behind a helper (M1) bounds this.
2. A new reader will misread that `IdleCompactionService` is typed as both interface and class on one token (S1).
3. Maintenance cost: the factory closure with its type cast (M2), and the two copied admission blocks (m5).
4. Inconsistency: the concrete-class type on a token whose siblings use ports (S1).
5. Differently: define one facade port type, extract the tap-signal mapper, and keep register.ts to a one-line factory call.

## Pattern compliance

| Rule | Status | Evidence |
| --- | --- | --- |
| Token is `Symbol.for` in token object | PASS | tokens.ts:74-75 |
| Optional injection as last ctor param | PASS | session-lifecycle-manager.ts ~420, compaction-hook-handler.ts ~163, router :62 |
| Depend on port, not adapter/concrete | FAIL | session-lifecycle-manager.ts ~74, compaction-hook-handler.ts :43 |
| Public barrel only across libs | PASS | router :22 |
| max-lines 700 | FAIL (warn) | session-query-executor.service.ts, 756 non-blank/comment lines |
| DI guard specs (expected-resolvable / surface) | NOT_APPLICABLE | no SDK tokens listed there; the smoke specs cover it |
| No `eslint-disable` or `as any` added | PASS | diff scan |
| Prettier | PASS | prettier --check clean |

## Verdict

NEEDS_REVISION. Fix S1 (type the facade and hook handler against a port type); address M1 or record the deferral in decisions.md; M2 and the minors are optional.
