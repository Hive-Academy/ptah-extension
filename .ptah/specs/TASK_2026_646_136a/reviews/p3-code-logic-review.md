# Code Logic Review — `TASK_2026_646_136a`, phase P3 (Routing engine)

Scope: `libs/backend/lane-routing` at `3f932ea7d`. Paths below are relative to `libs/backend/lane-routing/src`; line numbers refer to that revision. I traced the service, both model transports, setting/probe, candidate gathering, ranking and rotation, matrix persistence, and failure classifier. I also read the P3 requirements and plan, root instructions, and P2 review. The orchestrator reported 17 suites / 377 tests, lint, typecheck, degradation audit and DI lint passing. Scoped `ptah_get_diagnostics` reported zero errors and warnings. I ran no Nx, Jest, build, or git writes.

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 5/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 0 |
| Serious issues | 3 |
| Moderate issues | 3 |
| Minor issues | 0 |
| Failure modes found | 6 |

The ranking and validation path is present: `lib/route-decide.service.ts:105-116` validates input, `lib/pipeline/phase-plan.ts:121-176` constrains/scores/spreads, and `lib/pipeline/phase-resolve.ts:51-81` accepts only an offered choice. The phase still has three material boundary failures: a provider can put request text into logs, a structured call can exceed the promised timeout, and a stale probe can mark a new selection unsupported. These keep the score below 7. The deterministic path and bounded request count remain coherent, keeping it above the 3–4 band.

## Risks the phase had to close

| Risk | Assessment | Evidence |
| --- | --- | --- |
| Unset sends zero decision requests | Closed for these paths | `lib/route-decide.service.ts:326-328` returns `unset`; preflight calls only for `system-one`/`structured` at `:123-131`; gate `dispatchMode` returns ranking at `lib/pipeline/phase-plan.ts:198-201`, and `runPass` sends only in model mode at `lib/route-decide.service.ts:244-264`. |
| Bounded request count and question count | Closed | Gate has two passes (`lib/route-decide.service.ts:185-213`); each sends at most once and slices at `QUESTIONS_PER_REQUEST` (`:244-264`). Preflight sends once (`:123-131`). |
| Hard constraints and offered-option validation | Closed for normal data | `lib/ranking/hard-constraints.ts:142-164,249-318`; `lib/pipeline/answer-validation.ts:33-64`; `lib/pipeline/phase-resolve.ts:64-81`. |
| Timeout and nonblocking fallback | Open: S-2, M-2 | `lib/pipeline/model-call.ts:103-111` awaits the structured port; `lib/pipeline/gather.ts:76-83` awaits several unbounded dependencies. |
| Persisted spread across decisions | Open: M-1 | `lib/route-decide.service.ts:185,231,361-383` saves a snapshot; `lib/ranking/rotation.store.ts:192-204` writes it without a merge. |
| No request text or secrets in logs | Open: S-1 | `lib/decision-model/system-one.client.ts:230-261` logs provider body text. |
| Matrix as data with source/asOf/stale | Implemented for examined path | `lib/matrix/capability-matrix.store.ts:118-145,177-196,448-462`; user and merged view files at `:64-69,199-259,319-346`. |

## Five logic questions

1. **How does this fail silently?** Concurrent gate calls can both choose the same next lane and overwrite each other's rotation state (M-1). A failed rotation write is logged but the result still looks chosen (`lib/route-decide.service.ts:376-383`). A bad matrix edit uses the last valid in-memory matrix (`lib/matrix/capability-matrix.store.ts:231-259`), with a reason rather than a throw.
2. **What user action produces unexpected behaviour?** Changing Ollama model while an old readiness probe is in flight can mark the new model unsupported (S-3). Two simultaneous routing calls for the same phase can repeat a lane instead of rotating (M-1).
3. **What input data produces a wrong answer?** A provider error body that echoes a request containing sensitive text is logged (S-1). A stale probe outcome for model A can be recorded against model B on the same endpoint (S-3).
4. **What happens when a dependency fails, times out, or returns a bad shape?** A structured completer that never settles keeps routing pending despite its abort signal (S-2); a candidate source or matrix read that never settles blocks gathering (M-2). System One response JSON is schema checked at `lib/decision-model/system-one.client.ts:175-199`; structured choice labels are checked at `lib/pipeline/model-call.ts:128-150,173-188`.
5. **What is missing that the requirements never mentioned?** Cancellation guarantees for ports and concurrency control for persisted rotation/probe state are unspecified. The code assumes the structured completer honors `AbortSignal` and that overlapping decisions/settings changes do not occur; S-2, S-3 and M-1 show the cost of those assumptions.

## Failure modes

| ID | Trigger | Effect | Issue |
| --- | --- | --- | --- |
| FM-1 | Provider error body echoes submitted state | Request text enters logs | S-1 |
| FM-2 | Structured port ignores abort or remains pending | Tool exceeds 3,000 ms plus margin | S-2 |
| FM-3 | Selection changes while old probe is pending | New selection receives old unsupported verdict | S-3 |
| FM-4 | Two gate calls load the same rotation document | Same lane chosen twice; last save wins | M-1 |
| FM-5 | Candidate, limits, roles or matrix port remains pending | No routing result or fallback | M-2 |
| FM-6 | State storage read throws during config construction | DI construction fails before route fallback | M-3 |

## Blocking issues

None established.

## Serious issues

### S-1 Provider error text is logged without redaction

`lib/decision-model/system-one.client.ts:230-245` takes the provider's `error` string or raw body as `detail`; `:255-261` logs it. The request contains user text (`lib/decision-model/decision-payload.ts` through `lib/pipeline/model-refine.ts:220-229`), so an Ollama endpoint or proxy that echoes part of the request in an error body puts prompt text in local logs. A 404/405 detail can additionally flow into the persisted unsupported mark through `lib/route-decide.service.ts:287-291` and `lib/decision-model/decision-model.config.ts:417-426,287-303`. The 200-character cut at `system-one.client.ts:265-268` limits length, not content. Fix: classify by status and safe codes, log only fixed metadata, and keep untrusted body text out of status and persistent marks.

### S-2 Structured decision calls have no enforced return deadline

`lib/route-decide.service.ts:303-309` creates a timeout signal, but `lib/pipeline/model-call.ts:103-111` directly awaits `completer.complete()` and only catches a rejection. A port that ignores the signal, stalls after a provider timeout, or returns a promise that never settles leaves preflight or gate pending forever. The failure classifier repeats the pattern at `lib/failure-class/decision-model-failure-classifier.ts:171-178`. Requirement 4.1 promises a fallback within timeout plus margin. Fix: race the port promise against a deadline, observe late rejection, and return `timeout` (or null for classification) when the deadline wins; keep the signal for cancellation.

### S-3 An old probe can mark a newly selected model unsupported

`lib/decision-model/decision-model.config.ts:251-264` captures selection A, then awaits `probe`; `:409-422` acts on that old result. `markUnsupported` reads **current** selection again at `:287-303`. If the user changes from Ollama model A to B on the same base URL while A's probe runs (`setSelection` at `:155-178`), A's unsupported result creates a mark for B, and `isMarkedUnsupported` matches it at `:268-274`. The change can also occur during a live 404/405 recheck (`:322-345`). Fix: bind probe results to the selection/base URL snapshot and discard them if the current key changed before applying or persisting; serialize mark changes or use a generation token.

## Moderate issues

### M-1 Rotation loses concurrent decisions

Each call captures one rotation document at `lib/route-decide.service.ts:169-185`, computes picks from it, then saves a reconstructed document at `:361-383`. `lib/ranking/rotation.store.ts:192-204` writes that document without re-reading or comparing the stored version. Two simultaneous calls for the same key can both see the same last id, select the same successor, and overwrite one another; calls for different keys can erase the earlier key's update. This defeats Requirement 7's persisted rotation and can concentrate work under concurrent orchestration. Fix: serialize load/choose/save per store, or use an atomic compare-and-swap/transaction and retry on conflict.

### M-2 Gathering has no overall deadline for hanging ports

`lib/pipeline/gather.ts:76-83` awaits `source.rows()` before starting the rest, then awaits limits, roles, matrix and rotation through `Promise.all`. Their helpers catch rejection (`:113-149`, `:264-315`) but do not race a never-settling promise. Only model listing has a timer (`:193-233`). A hung candidate source, outcome reader inside matrix, or filesystem read keeps gate pending, contrary to the nonblocking fallback promise in Requirement 4. Fix: give the gather stage bounded per-dependency deadlines and return named missing-input reasons with neutral data when a deadline wins.

### M-3 A failed unsupported-mark read prevents config construction

`lib/decision-model/decision-model.config.ts:120-126` calls `loadMark()` in the constructor; `:541-556` calls `storage.get` outside a try/catch. An unavailable global state adapter throws before `RouteDecideService.openCaller()` can catch a target-resolution failure (`lib/route-decide.service.ts:345-357`). Rotation's corresponding read already degrades to an empty state (`lib/ranking/rotation.store.ts:153-166`). Fix: catch mark-read failures, log safe error facts, start with a null mark, and allow routing to continue.

## Minor issues

None established.

## Persisted write-path trace

| Write | Runtime reader | Assessment |
| --- | --- | --- |
| Global configuration section `ptah`, key `agentOrchestration.decisionModel`, validated selection (`lib/decision-model/decision-model.config.ts:155-169`; key definitions `lib/decision-model/decision-model.types.ts:98-99`) | `getSelection()` at `config.ts:130-147`, used by route at `lib/route-decide.service.ts:326-351` and classifier at `lib/failure-class/decision-model-failure-classifier.ts:134-143` | Format and scope align; concurrent probe race S-3. |
| Secret storage key `ptah.laneRouting.jevApiKey`, trimmed key/delete (`lib/decision-model/decision-model.config.ts:188-196`; key at `lib/decision-model/decision-model.types.ts:102`) | `hasJevApiKey()` / `resolveSystemOneTarget()` at `config.ts:183-214` | Correct secret-store path; no key value is deliberately logged here. |
| Global state key `ptah.decisionModel.unsupported.v1`, mark `{selection,baseUrl,detail,at}` or `undefined` (`lib/decision-model/decision-model.config.ts:287-303,566-575`; key at `lib/decision-model/decision-model.types.ts:90-91`) | `loadMark()` at `config.ts:541-556`, `markMatches()` at `:559-563`, status at `:268-274` | S-1 can persist untrusted detail; S-3 can bind old verdict to new selection; M-3 on read failure. |
| Global state key `laneRouting.rotation.v1`, versioned capped document (`lib/ranking/rotation.store.ts:90-137,201-204`) | `load()` at `rotation.store.ts:153-179`, passed to `spread()` at `lib/ranking/spread.ts:68-118` | M-1 under concurrent writes. |
| `{ptahHomeDir}/routing/capability-matrix.json`, empty version-1 user template (`lib/matrix/capability-matrix.store.ts:55-69,199-229`) | `readUserMatrix()` / `acceptUserText()` at `:199-259` | Write and read format align; invalid edits retain the last valid in-memory copy. |
| `{ptahHomeDir}/routing/capability-matrix.view.json`, merged view (`lib/matrix/capability-matrix.store.ts:319-346`) | `rememberedViewText()` at `:332-346`; routing resolves from in-memory layers at `:177-196` | Display artifact only; not the routing source. |

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Count two gate model calls as compliant, not a finding | One total / one non-review plus one review | Requirement 12.5 explicitly permits two at gate (`task-description.md:490-496`); service has two passes (`lib/route-decide.service.ts:185-213`) | Yes |
| Treat unset ranking as intended | Send a model request / deterministic ranking | Requirement 1 says zero requests when unset (`task-description.md:111-128`); service gates sending at `lib/route-decide.service.ts:244-264` | Yes |
| Treat configured model provenance as valid when supplied by listing | Reject `configured` / accept listed `configured` | `lib/pipeline/gather.ts:246-261` builds configured facts from actual list entries; scoring uses those at `lib/ranking/score.ts:142-161` | Yes |

No unresolved clarification is needed to act on these findings.
