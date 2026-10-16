# Batch A1 report

## Item 1 — task reader

- `libs/frontend/chat/src/lib/components/organisms/session-inspector/session-task-reader.ts:60,73,148,187,217,259,306`: keyed the held result, folder filter, stale response/error guard, and document opener by normalized workspace root plus task ID. A document can open only from a result matching the current link.
- Regression: `session-task-reader.spec.ts` — `drops an old root response and opens only the new root task folder`. It covers a held old result, a late old-root response, and the opened path.

## Item 2 — question card focus

- `libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts:624-678`: added regression specs for a card present immediately, one appearing within the 1 s wait, and a missing card that reports `reportAnswerMiss(requestId)`. `focusQuestionCard` remains unchanged; `chat-transcript` was not touched. Current `chat-view.component.html:186-199` renders `ptah-question-card` outside `ptah-chat-transcript`, so transcript windowing cannot unmount it.

## Item 3 — workflow add-on component type

- `libs/frontend/chat/src/lib/tokens/session-workflow-addons.token.ts:1,23`: changed the component contract to `Type<{ readonly tabId: InputSignal<string> }>` matching the host's `ngComponentOutlet` `inputs: { tabId }` bindings. No concrete providers were found in the scoped source, so none needed an update.

## Item 9 — activity panel deferral

- `libs/frontend/chat/src/lib/components/organisms/message-bubble.component.html:140-145`: wrapped the activity panel in `@defer (when activityOpen())` inside its existing visibility guard. Its TypeScript component reference occurs only in the bubble's `imports` and the panel's declaration; no barrel or other eager import was found. Production bundle measurement remains with the orchestrator.

## Verification

- Jest: `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/components/organisms/session-inspector/session-task-reader.spec.ts --coverage=false --maxWorkers=1`: **1 suite passed, 1 test passed, 0 failed**.
- Jest: `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts --coverage=false --maxWorkers=1`: **1 suite passed, 81 tests passed, 0 failed**. The three new focus tests are included.
- `ptah_get_diagnostics` on changed TypeScript files: no diagnostics in changed production files or new spec lines. The checker reports existing errors on other lines of `chat-view.component.spec.ts` and elsewhere in the chat project.
- No build was run.

## Decisions

- Use normalized root plus task ID as the cache key; a request generation would also prevent stale responses, but the composite key also guards `openDocument` and refresh folder matching. Evidence: `resolveLink` includes workspace root and `normalizeWorkspaceRoot` is the existing identity helper. Reversible: yes.
- Defer the panel when the existing open signal becomes true; the button is the only entry point and the panel is hidden until then. Evidence: `message-bubble.component.html:125-145`. Reversible: yes.
- The item 2 finding premise does not hold on main: the question card is rendered outside the transcript, so the render window cannot unmount it. The spawning session accepted retaining `focusQuestionCard` and covering its three existing paths in specs. Evidence: `chat-view.component.html:186-199`, `chat-transcript.component.html:36-45`, and the user's follow-up direction. Reversible: yes.
