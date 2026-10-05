# Batch C4 Report - TASK_2026_610

## Scope

- Requirement: Req 5.12 / implementation-plan component 5: resolved `$diff`, `$tests`, and `$usage` values never enter stored assistant text or outgoing model requests.
- Added two fence-bound boundary tests; existing A5 and AF3 controls remain unchanged.

## Tests added

- `libs/frontend/chat/src/lib/services/message-sender.host-data.spec.ts:342` renders a stored `ptah-ui` fence through the real `buildTurnSourceSnapshot` and `renderPtahUiBlock` pipeline, then sends a real follow-up through `MessageSenderService`.
  - Positive control: resolved display content contains the seeded change-set path, formatted cost `$0.61`, and test label at lines 359-362.
  - Boundary assertions: serialized `chat:continue` parameters exclude every sentinel at line 366; the stored `ExecutionNode.content` is byte-identical and still contains literal `$diff.files` at lines 367-368.
- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.host-data.spec.ts:53` supplies a prior assistant raw fence to the builder stream.
  - Prompt stream preserves the raw fence at line 82 and its serialized form includes `$diff.files` at line 83.
  - It requires `systemPrompt.append` to contain raw `$diff.files` at line 84, and checks both paths for every sentinel at lines 85-88.

## Execution

- `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/services/message-sender.host-data.spec.ts`
  - Observed: 1 suite passed; 3 tests passed; 0 failed.
- `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.host-data.spec.ts`
  - Observed: 1 suite failed; 1 test passed; 1 test failed.
  - Failure: `systemPrompt.append` contains the unresolved source name `$diff`, but not the required raw field expression `$diff.files` (line 84). The provider prompt does preserve the raw fence. This is a product/requirement gap, not a test defect.
  - The initial backend capture was blank; the subsequent foreground execution above produced the recorded failure output.

## Verdict

- Proven: the webview resolves sentinels only for display and does not mutate the stored assistant fence or serialize sentinels into `chat:continue`.
- Not proven: the backend system prompt includes the exact raw `$diff.files` field expression. The new test currently exposes this failure.

## Orchestrator fix (2026-10-04)

The backend failure was a wrong assertion, not a product gap: `expect(systemHint).toContain('$diff.files')` required the system hint to carry the prior assistant fence. The fence belongs to the provider prompt (asserted on the line before). The C3 hint mentions `` without an example by design. The assertion was removed; the sentinel-absence checks on both the prompt and the hint remain.
