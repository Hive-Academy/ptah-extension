# Batch 27 (A16) — Decision-model failure classifier

Worktree: `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing`. No git writes. Nx and Jest were not run (decision #53). The team-leader runs `npx nx test @ptah-extension/lane-routing --parallel=1` and `npx nx lint @ptah-extension/lane-routing`.

## Files

Line counts are physical lines.

Created:

| Lines | Path |
| ----: | ---- |
| 410 | `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\failure-class\decision-model-failure-classifier.ts` |
| 427 | `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\failure-class\decision-model-failure-classifier.spec.ts` |

Modified:

| Lines | Path |
| ----: | ---- |
| 141 | `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\di\register.ts` |
| 160 | `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\di\register.spec.ts` |
| 190 | `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\index.ts` |

`DecisionModelFailureClassifier` implements the shared `LaneFailureClassifier` port (`libs\shared\src\lib\types\lane-outcome.types.ts:191-198`). Source files are under 700 lines. No `@inject`, no `any`, no `@ts-ignore`, no `as unknown as`, no `console.*`.

## Task 27.1

`DecisionModelFailureClassifier` is registered as `LANE_ROUTING_TOKENS.FAILURE_CLASSIFIER`.

- Class: `decision-model-failure-classifier.ts:114-131`. `classify` never rejects. A throw is logged with `runId` and the error name, then the method returns null (`:123-131`).
- Unset selection returns before any client or abort timer (`decision-model-failure-classifier.ts:137-138`).
- One choice question. Options are `LANE_FAILURE_CLASSES`. The classification input is copied field by field onto `state` (`decision-model-failure-classifier.ts:266-290`).
- Acceptance is `validateChoiceAnswer` (`decision-model-failure-classifier.ts:317-323`), which uses `appliesLowConfidenceFallback` (`reasons\confidence.ts:153-160`): a reported number strictly below `CONFIDENCE_THRESHOLD` (0.5, `routing-constants.ts:128`) is not accepted. Null confidence is not low. Any non-null cause, including an answer outside the five classes, returns null (`decision-model-failure-classifier.ts:322-323`).
- Abort budget is `DECISION_REQUEST_TIMEOUT_MS + DECISION_RETURN_MARGIN_MS` (`decision-model-failure-classifier.ts:51-52`, used at `:176` and `:214`).
- Structured selection calls `StructuredDecisionCompleter.complete` once (`decision-model-failure-classifier.ts:171-178`). The port is omitted when the host has not registered it (`:151-158`).
- Ollama and Jev post one System One body `{ model, state, questions }` (`decision-model-failure-classifier.ts:201-223`). Jev with no stored key returns before that post (`:194-199`). A live 404 does not call `recheckAfterLiveNotFound`, so classification cannot add a probe on top of the one request.
- `SystemOneClient.decide` stays typed to the routing payload. This classifier does not cast the classification state into that type.

### Registration

`registerLaneRoutingServices` registers the classifier with `useFactory` / `instanceCachingFactory` (`di\register.ts:125-139`). `STRUCTURED_DECISION` is resolved only through `optional()`, which calls `container.isRegistered(token, true)` (`di\register.ts:43-48` and `:127-130`). No `@inject`. The factory passes no test seams.

The barrel exports the class, the payload builder, the schema, the timeout, and the payload types (`src\index.ts:178-190`).

Hosts do not call `registerLaneRoutingServices` yet (the name appears in `register.ts`, its spec, and `src\index.ts`, plus a comment in `agent-rpc.handlers.ts`). Rule 8 guard specs stay with Batch 30. This batch does not edit `apps/*/src/di` or `cli-engine`.

### Rule 9

`decision-model-failure-classifier.ts` imports `@ptah-extension/shared` (`:14-19`) and modules inside lane-routing. It does not import `lane-outcomes`, `vscode-core`, or any other workspace lib. `register.ts` already imported only `@ptah-extension/platform-core` and `@ptah-extension/shared`. No `package.json` was edited.

## Spec cases

| Case | Where |
| ---- | ----- |
| Decision model unset → zero requests (completer, fetch, and `AbortSignal.timeout` are not called) | `decision-model-failure-classifier.spec.ts:111-126` |
| Fake structured client counts exactly 1 request, returns `crash`, and the abort budget is 3250 | `decision-model-failure-classifier.spec.ts:128-155` (`toHaveBeenCalledTimes(1)` at `:149`) |
| Confidence 0.49 → null, and the client was still called once | `decision-model-failure-classifier.spec.ts:157-173` |
| Chosen-option probability 0.49 → null (System One shape) | `decision-model-failure-classifier.spec.ts:175-193` |
| Confidence 0.5 is accepted; a missing confidence is accepted | `decision-model-failure-classifier.spec.ts:195-222` |
| Answer `overloaded` (outside the five classes) → null, one request | `decision-model-failure-classifier.spec.ts:224-240` |
| Payload field set pinned: request keys, prompt keys, state keys, question keys, the five criteria, schema keys; `leak-me` is not sent | `decision-model-failure-classifier.spec.ts:242-324` (request keys `:266-272`, state keys `:283`, criteria `:304-307`) |
| Ollama posts exactly one System One body whose keys are `model`, `state`, `questions` | `decision-model-failure-classifier.spec.ts:326-372` (keys at `:368`) |
| Structured selection with no port → null, fetch not called | `decision-model-failure-classifier.spec.ts:374-392` |
| Jev with no credential → zero requests | `decision-model-failure-classifier.spec.ts:394-403` |
| A rejecting client resolves null (the port never rejects) and the warn carries `runId` and `name` only | `decision-model-failure-classifier.spec.ts:405-425` |

DI: `register.spec.ts:71-75` resolves one `DecisionModelFailureClassifier` and resolves the same instance again. `register.spec.ts:120-158` registers `STRUCTURED_DECISION` before `registerLaneRoutingServices`, sets a structured selection, and counts exactly one `complete` call.

These specs were not executed. The team-leader runs Jest.

## Assumptions

Batch 27 owns no row in the assumptions table (PA-1..PA-5, PB-1..PB-6, IA-1..IA-5). Nothing in that table was reopened.

- The shared port is `LaneFailureClassifier.classify` (`lane-outcome.types.ts:191-198`). The five classes are `LANE_FAILURE_CLASSES` (`lane-outcome.types.ts:26-32`).
- `isRegistered(token, true)` is the same guard Batch 21 uses (`di\register.ts:43-48`).
- `registerLaneRoutingServices` is not on a host composition root yet, so this registration does not turn a guard spec red. Batch 30 aliases `LANE_OUTCOME_TOKENS.FAILURE_CLASSIFIER` onto this token (SC-3).

## Risks

- R-8 (new lib cycle): no new import outside `@ptah-extension/shared` and `@ptah-extension/platform-core`. `nx lint` is left for the team-leader.
- R-6 (guard specs red before AB14): not triggered. Hosts do not call this register function yet.
- A classification failure must not become a second model call. The classifier does not retry and does not re-check a live 404.

## Decisions

- Both decision-model kinds are handled. Req 10.3 classifies whenever a decision model is set. Structured uses the completer route-decide already uses. Ollama and Jev send the same payload as System One `state` plus one `choice` question, which is what SC-4 specifies. Leaving Ollama and Jev as a silent null was rejected.
- The System One body is posted here instead of through `SystemOneClient.decide`, because that client is typed to the routing field set (`request`, `availableExecutors`, `pastOutcomes`). A cast was rejected.
- Low confidence returns null rather than the proposed class. Routing keeps the proposal for its own result. A failure class is stored only when `validateChoiceAnswer` accepts it.
- The classifier is a plain class built with `useFactory`, same as `DecisionModelConfig` and `RouteDecideService`.

## Verification

Nx and Jest were not run.

ESLint on the five changed files exited 0 with no findings. The spec was checked again after the last test was added; that run also exited 0.

Prettier `--check` on the five changed files:

```
Checking formatting...
All matched files use Prettier code style!
```

The spec was checked again after the last test was added and still matched.

Degradation audit (`--max-warnings=-1`), summary lines (PowerShell has no `grep`; `Select-String` was used). Exit 0. No `FAIL` line.

```
degradation-audit: per-directory totals
degradation-audit: TOTAL 296 unsuppressed site(s)
```

di-lint, last line. Exit 0.

```
di-lint OK: 1843 @inject sites all resolve to a registered token (814 tokens); every container-constructed class names all required and non-equivalent defaulted dependencies
```

This batch adds no `@inject`. The site count differs from Batch 21's 1841 because other lanes are editing the same worktree.

`tsc -p libs/backend/lane-routing/tsconfig.spec.json --noEmit`, first `error TS` lines, all pre-existing index-signature errors in specs this batch did not edit:

```
libs/backend/lane-routing/src/lib/decision-model/decision-payload.spec.ts(51,57): error TS4111: Property 'codex' comes from an index signature, so it must be accessed with ['codex'].
libs/backend/lane-routing/src/lib/decision-model/decision-payload.spec.ts(60,42): error TS4111: Property 'implement' comes from an index signature, so it must be accessed with ['implement'].
libs/backend/lane-routing/src/lib/decision-model/system-one.client.spec.ts(135,27): error TS4111: Property 'implement' comes from an index signature, so it must be accessed with ['implement'].
```

A filter of that same `tsc` output for `failure-class`, `di/register`, and `src/index.ts` printed nothing. Those files have no `error TS`.

## Not done

- `npx nx test @ptah-extension/lane-routing --parallel=1`
- `npx nx lint @ptah-extension/lane-routing`
- Jest on the new specs
- Git commit, push, or a pull request (the team-leader owns git; the lane prompt forbids git writes)
- `ptah_agent_report`: `search_tool` returned no matching tool. One `use_tool` call with that name was rejected (`not a valid MCP tool name`). Not retried.
