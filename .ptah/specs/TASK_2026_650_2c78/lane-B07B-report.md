# B07B implementation report

## Status
Partial implementation. Scoped typecheck, lint, and all setup-wizard tests pass. Do not mark B07B complete: the bound result contract has no detailed agent outcome/count payload, the workflow launcher does not preserve launch origin, and `GenerationWorkflowStore` is outside this batch's edit ownership. These prevent several acceptance points below.

## Files changed and final line counts
Base: `libs/frontend/setup-wizard/src/`.

| File under base | Lines |
| --- | ---: |
| `lib/components/agent-run-card.component.ts` | 45 |
| `lib/components/agent-run-card.component.spec.ts` | 12 |
| `lib/components/agent-generation-progress.component.ts` | 45 |
| `lib/components/agent-generation-progress.component.spec.ts` | 19 |
| `lib/components/agent-next-steps.component.ts` | 90 |
| `lib/components/agent-next-steps.component.spec.ts` | 18 |
| `lib/components/generation-errors.component.ts` | 30 |
| `lib/components/generation-errors.component.spec.ts` | 15 |
| `lib/components/generation-stop-control.component.ts` | 29 |
| `lib/components/generation-stop-control.component.spec.ts` | 18 |
| `lib/components/generation-workflow-shell.component.ts` | 226 |
| `lib/components/generation-workflow-shell.component.spec.ts` | 245 |
| `lib/components/completion.component.ts` | 488 |
| `lib/components/completion.component.spec.ts` | 393 |
| `lib/components/generation-progress.component.ts` | 533 |
| `lib/services/agent-generation.store.ts` | 110 |
| `lib/services/agent-generation.store.spec.ts` | 84 |
| `lib/services/generation-handoff.store.ts` | 111 |
| `lib/services/generation-handoff.store.spec.ts` | 193 |
| `lib/services/generation-run-event-adapter.ts` | 303 |
| `lib/services/generation-run-event-adapter.spec.ts` | 538 |
| `lib/services/setup-wizard/wizard-phase-generation.ts` | 192 |
| `lib/services/setup-wizard/wizard-phase-generation.spec.ts` | 338 |
| `index.ts` | 50 |

## Acceptance and evidence

| Point | Status and file:line evidence | Spec |
| --- | --- | --- |
| B07 selection/source/model in shell | Selection placed at `generation-workflow-shell.component.ts:89`; its existing nested source/model controls bind the tab. | `generation-workflow-shell.component.spec.ts`; existing `agent-selection-list.component.spec.ts` |
| Agent run page and accessible Stop | Run, progress, next steps, errors, and Stop placed at `generation-workflow-shell.component.ts:51,67,97,111,118`; quiet Stop calls the bound store. | `agent-run-card.component.spec.ts`, `agent-generation-progress.component.spec.ts`, `agent-next-steps.component.spec.ts`, `generation-errors.component.spec.ts`, `generation-stop-control.component.spec.ts`, `generation-workflow-shell.component.spec.ts` |
| First open checkpoint; resume outcomes | Read-only discovery and deliberate tabless resume at `agent-generation.store.ts:32,65`; shell offer at `generation-workflow-shell.component.ts:55`. Checkpoint outcomes stay visible after resume. | `agent-generation.store.spec.ts` checkpoint case |
| Three retries, duplicate guard, remaining count, backoff | `agent-generation.store.ts:79-110`; shell binds remaining and pending state to progress card at `generation-workflow-shell.component.ts:67`. | `agent-generation.store.spec.ts` fake-timer retry case |
| Guidance-first advice | Status lookup at `agent-generation.store.ts:49`; shell advice at `generation-workflow-shell.component.ts:73`. | `agent-generation.store.spec.ts` status case |
| Verified terminal over late stream; off-tab finish | `generation-run-event-adapter.ts:75-96,188-209`; independent terminal lookup checks tab, workspace, workflow, run ID. | `generation-run-event-adapter.spec.ts` real chat composition and late stream cases |
| Legacy false completion | `completion.component.ts:416-432` derives tiles only from explicit outcomes; `wizard-phase-generation.ts:48-77` no longer completes an item when progress moves. | `completion.component.spec.ts` no-payload case; `wizard-phase-generation.spec.ts` previous-item case |
| Safe new error display and five examples | Fixed shell error copy at `generation-workflow-shell.component.ts:111`; three-before-disclosure at `generation-errors.component.ts:9`; Quick Start examples at `agent-next-steps.component.ts:53`. | `generation-errors.component.spec.ts`, `agent-next-steps.component.spec.ts` |
| Manual Continue/Skip for failed result or failed background launch | Shell `showNextSteps` at `generation-workflow-shell.component.ts:161`; handoff `manual-recovery` at `generation-handoff.store.ts:85-109`. | `generation-handoff.store.spec.ts` recovery cases |
| Analysis phases remain | Legacy generation and analysis path retained; `wizard-phase-generation.ts:48` and `generation-progress.component.ts` still serve the old wizard. | Existing wizard phase and completion specs |
| Bound detailed final counts, rejected sections, propagation/consent | **Open.** `libs/shared/src/lib/types/rpc/rpc-setup.types.ts:65-85` defines `SetupGenerationResultFacts` without agent outcomes/counts or propagation/consent. The shell exposes only the verified guidance-used marker at `generation-workflow-shell.component.ts:91`. The old completion path still uses its explicit payload. | No valid bound-payload spec can be written with current DTO. |
| Combined five-second countdown; independent CTA | **Partial.** `GenerationHandoffStore.schedule` owns an absolute deadline at `generation-handoff.store.ts:38-48`; shell renders pending and manual CTA at `generation-workflow-shell.component.ts:97`. No shell caller can safely call `schedule`: `GenerationWorkflowLauncherService.open` accepts `origin` but does not store or route it, and tab binding has no origin. Auto-start is therefore absent. | `generation-handoff.store.spec.ts` timer cases cover store only. |
| Interrupted bound Resume; lost status answer/watchdog | **Partial.** Run card offers Resume for `interrupted` at `agent-run-card.component.ts:10`, and existing bound store uses lookup for lost answers. The card's action currently calls tabless checkpoint resume. Failed lookup watchdog and terminal stale-refresh guard require edits to `generation-workflow.store.ts`, outside B07B ownership. | `agent-run-card.component.spec.ts`; existing `generation-workflow.store.spec.ts` |

## Deferred findings

| Finding | Result |
| --- | --- |
| N4 stale ownership | Fixed at `generation-run-event-adapter.ts:212-237`: different run ID aborts only the owned current message, deletes stale ownership, starts a new message. `finish` deletes ownership before early exit at `:188-209`; tab-close cleanup reacts to `tabs()` at `:42-62`. Spec: stale ownership case in `generation-run-event-adapter.spec.ts`. |
| N5 off-tab terminal push | Fixed at `generation-run-event-adapter.ts:75-96,278-296`; real composition spec now completes A while B is bound, opens A from tab strip without shell bind, and asserts A is not busy. |
| Pre-start stream | Bounded 100-event buffer keyed by current tab at `generation-run-event-adapter.ts:33,54-58,106-111`; spec: early stream case. |
| Stale refresh reversal | Open: guard belongs in `generation-workflow.store.ts:177-252`, outside assigned edit ownership. |
| Failed lookup watchdog | Open: retry scheduling belongs in `generation-workflow.store.ts:177-228`, outside assigned edit ownership. |
| Handoff chat-busy check and caller | Busy check fixed at `generation-handoff.store.ts:89-107`, spec: busy chat case. `manualContinue` is wired from the shell, but automatic `schedule` caller remains blocked by absent origin. |

## Parity rows

| Row | Result |
| --- | --- |
| 17 | Agent run and safe error shell at `generation-workflow-shell.component.ts:51,111`; detailed bound errors remain limited by DTO. |
| 20 | Checkpoint item progress at `agent-generation-progress.component.ts:9`; bound overall counts remain open. |
| 21 | Adapter routes text/tools to chat at `generation-run-event-adapter.ts:149-185`; recovery spec covers off-tab finalization. |
| 22 | Stop control at `generation-stop-control.component.ts:9`; exact run cancel is in the existing `GenerationWorkflowStore.stop`. |
| 23 | Read-only checkpoint/resume/retry at `agent-generation.store.ts:32,65,87`. |
| 24 | Tabless checkpoint offer at `generation-workflow-shell.component.ts:55`. |
| 25 | Retry cap/guard/backoff at `agent-generation.store.ts:79-110`. |
| 26 | Bound validation and write authority remain backend-owned; bound payload does not expose propagation/consent. |
| 27 | `generation-handoff.store.ts:38-48` deadline exists, but no origin-aware schedule caller. |
| 35 | Legacy verified completion at `completion.component.ts:416-432`; new next steps/errors at `agent-next-steps.component.ts:9`, `generation-errors.component.ts:9`; bound counts remain open. |

## Checks

- Focused Jest after changes: 3 suites, 18 tests passed; phase regression: 1 suite, 11 tests passed. Earlier focused run: 11 suites, 62 passed, 3 failed on old stream-fallback expectations; corrected and reran the affected 3 suites, 43 passed.
- Final `npx nx run-many -t typecheck,lint -p "@ptah-extension/setup-wizard" ptah-extension-webview --parallel=1`: passed for 2 projects.
- Final `npx nx test "@ptah-extension/setup-wizard" --parallel=1 -- --maxWorkers=2`: 31 suites, 385 tests passed.
- `ptah_get_diagnostics` after edits showed no errors in requested files. It reported two unrelated `capability-id-codec.ts` ES target diagnostics from sibling analysis; the scoped Nx gate passed.
- Prettier applied to every changed source/spec file; the report is UTF-8.

## Notes for B08

The guidance page may use `GenerationHandoffStore.manualContinue`, `startNow`, `skip`, `pending`, and `outcome`. Do not assume an automatic countdown exists yet. `GenerationWorkflowLauncherService` drops the `origin` value after `open`, and `SetupGenerationTabBinding` has no origin; one owner must carry combined origin through the launcher or route before scheduling. A failed background tab creation or chat-busy target now leaves `manual-recovery`. The bound agent result DTO needs detailed final facts before the guidance page or result panel can state counts and propagation/consent. `GenerationWorkflowStore` still needs terminal-read monotonicity and bounded failed-lookup retry.

## Decisions

- Keep discovery read-only until explicit Resume. Options were implicit resume or explicit offer; `wizard:get-resumable-run` is read-only and B07B acceptance requires an offer. Reversible.
- Preserve completed checkpoint outcomes after successful resume. Options were clearing or retaining the checkpoint; retained records make completed work visible until a newer record is read. Reversible.
- Show fixed safe copy for errors in the new shell. Options were host error text or fixed copy; project guidance forbids raw errors/secrets. Reversible.
- Do not infer combined origin from completion state. Options were auto-schedule every agent result or require origin; independent start must only offer CTA and launcher currently drops origin. Reversible once origin is carried.

## Deviations

- B07B remains partial for bound detailed completion and combined countdown. The necessary DTO and launcher files are outside assigned ownership. The existing `GenerationWorkflowStore` is likewise outside ownership for stale refresh and watchdog fixes. Recommend an explicit follow-up owner/scope assignment before commit.
- Legacy `completion.component.ts` and `generation-progress.component.ts` were already over the approximate 400-line size target; this batch made small safety fixes in place without splitting the legacy path.
- The new run card's interrupted Resume uses the tabless checkpoint resume RPC because no bound resume RPC is exposed. It is an offer, but exact bound recovery still needs contract review.

## Proposed Removals

None. The old wizard generation and analysis paths remain available.
