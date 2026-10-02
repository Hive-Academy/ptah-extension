# Context

Reported by the user on 2026-09-30 after a manual test of the Apps page in the Electron app.

## User report

- The Apps chat panel does not update in real time. The user had to switch to another page and back to see the agent execution.
- After the switch, tool call messages and text content render correctly. The transcript renderer is not the problem.
- Only the input box must change. The user wants the main chat input on this page.

## Defect 1: the transcript does not update live

### Evidence

- The transcript builds its tree in a `computed` from `AppsSessionService.streamingState()` (`libs/frontend/mcp-apps-page/src/lib/components/apps-transcript.component.ts:134-137`).
- `streamingState` is a `computed` over the active workspace slice (`libs/frontend/mcp-apps-page/src/lib/services/apps-session.service.ts:130-131`).
- Stream events arrive through the claim writer. It copies the slice and sets `streamingState: next` (`apps-session.service.ts:540-547`).

### Hypothesis to confirm first (not proven)

If the streaming reducer mutates the `StreamingState` object in place and returns the same reference, the `computed` at `apps-session.service.ts:130` sees an equal value under `Object.is`. The transcript `computed` then does not run again. A page switch creates the component again, and it reads the mutated state. This matches the report.

Other possible causes to examine:

- The claim `write` is not called for each event, only at turn boundaries.
- `patchOwned` drops the write because the routing id does not match.
- The page component is outside a change detection pass for the push (OnPush with no signal read in the template).

Write a failing test that reproduces the defect before the fix. The test must push stream events through the claim and assert that the transcript tree changes without a new component instance.

## Defect 2: the composer

### Evidence

- The Apps composer is a plain `<textarea>` with Send, Stop and "New conversation" (`apps-page.component.ts:214-251`). Enter sends and Shift+Enter adds a newline (`:449`).
- The model and effort come silently from `ModelStateService` and `EffortStateService` (`apps-session.service.ts:235-248`).
- The main chat input is `ptah-chat-input` in `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.ts:107`. It contains `ptah-model-selector` and `ptah-effort-selector` (`:310-312`).

### Correction to the user's assumption

The user said that the Setup Hub already uses the main chat input. It does not. The AI Team Builder composer is also a plain `<textarea>` (`libs/frontend/harness-builder/src/lib/components/harness-builder-view.component.ts:355-363`). The Setup Hub and the Apps page reuse the same transcript parts from `@ptah-extension/chat` (`ExecutionNodeComponent`, `PermissionRequestCardComponent`, `QuestionCardComponent`). Neither page reuses the composer.

Therefore this task is the first reuse of `ptah-chat-input` outside the coding chat.

### Design question for the architect

`ptah-chat-input` is probably bound to the coding chat tab state (the active tab, the send path and the file mention store). Examine its inputs and injected services. Then choose one of these:

1. Give `ptah-chat-input` a send target input (or an injected send port), so a host page can supply its own send, stop and busy state. The coding chat keeps the current default.
2. Extract the editor part (mentions, slash commands, attachments, pickers) into a presentational component in `chat-ui`. `ptah-chat-input` and the Apps page both use it.

Obey the lib rules: `chat-ui` must not import `chat`. `mcp-apps-page` may import `chat`. Do not fork the component.

## Scope

In scope:

- Fix the live transcript update on the Apps page.
- Use the main chat composer on the Apps page, with `@` file mentions, `/` commands, attachments, and the model and effort pickers.
- Keep Send, Stop and "New conversation" on the Apps page.
- Keep the Apps session separate from the coding chat tabs. A message sent on the Apps page must not appear in a coding chat tab.

Out of scope:

- The AI Team Builder composer. After this task, a follow-up can apply the same composer there with small effort. Record it in `future-enhancements.md`.
- Apps persistence and pinning (TASK_2026_495).
- New surface actions or catalog components.

## Acceptance criteria

1. While the agent runs, text and tool calls appear on the Apps page with no page switch. A unit test proves this, and a Playwright test in `libs/frontend/webview-e2e-harness` proves it in the rendered page.
2. The test for criterion 1 fails on the code before the fix.
3. The Apps composer supports `@` file mentions, `/` commands, attachments and the model and effort pickers, with the same behavior as the coding chat.
4. A model or effort change on the Apps page applies to the Apps session. State whether it also changes the global selection, and test that behavior.
5. The coding chat composer behavior does not change. Its existing specs pass without edits to their assertions.
6. No new boundary lint errors. The changed components stay `OnPush` and standalone.

## Suggested workflow

Partial: architect (composer design question) -> frontend-developer -> senior-tester -> code-logic-reviewer. Fix defect 1 first in its own batch, because it is independent of the composer design.
