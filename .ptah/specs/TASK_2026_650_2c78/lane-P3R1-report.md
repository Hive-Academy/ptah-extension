# Phase 3 review revision round 1

## S1 — consecutive never-chatted runs

`generation-run-event-adapter.ts:154-176` finalizes only the message owned by this adapter through the public `MessageFinalizationService.finalizeCurrentMessage(tabId, false)` API. It flushes pending chat writes before checking the current message ID. This avoids the null-session `turn_state` revision floor entirely and leaves the next run able to start. The real `TabManagerService`, `GenerationWorkflowStore`, `StreamingHandlerService`, and `MessageFinalizationService` composition passes `finalizes two consecutive never-chatted runs and admits a third start` (`generation-run-event-adapter.spec.ts:227`): both runs clear the streaming message and busy state, and the third start RPC is called. No new chat API was needed.

## S2 — restored run and real chat state

`generation-run-event-adapter.ts:24-26, 154-176, 179-190` tracks the opened message by tab ID and run ID. A lookup-only terminal has no owned message and therefore performs no finalization. A terminal for an adapter-opened message finalizes only if that exact message is still current; streaming, awaiting-background, and sleeping tabs are skipped. The adapter no longer emits synthetic `turn_state`, so it cannot overwrite a real turn's revision, session, abort controller, task fields, or terminal reason.

Specs: `leaves a restored terminal on a real-session tab untouched` (`generation-run-event-adapter.spec.ts:199`) checks the session field snapshot, task fields and terminal reason; `finalizes only its own wizard message without changing real chat turn fields` (`:169`) checks the owned path. The real-service consecutive-run spec (`:227`) also rebinds to a restored terminal while a real session is streaming and verifies the tab snapshot and abort signal are unchanged.

## S3 — reactive route binding

`generation-workflow-shell.component.ts:60-69` converts `ActivatedRoute.paramMap` to a signal. The computed binding now changes with the route, revalidates the tab/workflow against the active workspace, and drives the existing bind effect (`:99-103`). `rebinds one shell instance when route tab and workflow params change` (`generation-workflow-shell.component.spec.ts:132`) verifies agent tab A to guidance tab B on one component instance.

## Checks

- Focused Jest (adapter and shell specs): 2 suites, 8 tests passed.
- Nx typecheck and lint: successfully ran both targets for 2 projects (`@ptah-extension/setup-wizard`, `ptah-extension-webview`).
- Nx test: confirmed `Running target test for 2 projects`; successfully ran test for 2 projects.
- Prettier applied to all four changed source/spec files.
- Scoped `ptah_get_diagnostics` was invoked after edits; its TypeScript service timed out after 45 seconds and reported the files unchecked. Nx typecheck passed.

## Final line counts

| File | Lines |
| --- | ---: |
| `generation-run-event-adapter.ts` | 241 |
| `generation-run-event-adapter.spec.ts` | 346 |
| `generation-workflow-shell.component.ts` | 105 |
| `generation-workflow-shell.component.spec.ts` | 198 |

## Decisions

- **Direct finalization.** Options: public finalizer or synthetic monotonic `turn_state`. Evidence: `MessageFinalizationService` is exported from `@ptah-extension/chat-streaming`; its public `finalizeCurrentMessage` promotes the current tree and clears streaming state. A synthetic state event mutates real-session fields and fails the second null-session revision guard. Reversible: yes.
- **Owner check before finalization.** Options: close every observed terminal or close only an adapter-opened message. Evidence: a restored terminal may belong to a tab now running ordinary chat. Tab/run/message ownership plus the current-message check isolates the wizard tree. Reversible: yes.
- **Route signal.** Options: route snapshot or `toSignal(route.paramMap)`. Evidence: the shell is reused across parameter-only navigation; `snapshot` is not a computed dependency. Reversible: yes.

## Deviations

None from the requested file scope or checks. The diagnostics service timed out; the required Nx typecheck passed.

## Proposed Removals

None.
