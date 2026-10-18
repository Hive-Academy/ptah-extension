# Batch B7c implementation report

## Files changed

- Deleted `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat-ui\src\lib\molecules\subagent-transcript-viewer.component.ts`.
- Modified `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat-ui\src\index.ts`: removed the viewer export.
- Modified `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat-streaming\src\lib\agent-monitor.store.ts`: removed `getSubagentTranscript`, its documentation, and its sole `SubagentTranscriptMessage` import.
- Created `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\.ptah\specs\TASK_2026_685_64f4\reports\batch-B7c.md` (this report).

## Evidence

- B7c.1: viewer file is absent; no viewer spec was present; `chat-ui/src/index.ts` no longer exports it.
- B7c.2: the store has no `getSubagentTranscript`, `SubagentTranscriptMessage`, or `subagent:transcript` hit. The store spec contains no test of `getSubagentTranscript`, so no tests were deleted.
- Scoped `ptah_get_diagnostics` requested for the two modified TypeScript files. It returned **unavailable**: TypeScript check still running after 45 seconds, two files unchecked. No test, typecheck, lint, build, serve, e2e, or package command was run under the lane rules.

## Remaining reference scan

Command: `rg -n "getSubagentTranscript|SubagentTranscriptViewer|subagent-transcript-viewer.component|SubagentTranscriptMessage" libs/frontend apps`

```text
libs/frontend\canvas\src\lib\canvas-detail\canvas-lane-view.component.spec.ts:57:  const getSubagentTranscript = jest.fn().mockResolvedValue([]);
libs/frontend\canvas\src\lib\canvas-detail\canvas-lane-view.component.spec.ts:80:    getSubagentTranscript.mockClear();
libs/frontend\canvas\src\lib\canvas-detail\canvas-lane-view.component.spec.ts:100:            getSubagentTranscript,
libs/frontend\canvas\src\lib\canvas-detail\canvas-lane-view.component.spec.ts:345:    expect(getSubagentTranscript).not.toHaveBeenCalled();
libs/frontend\canvas\src\lib\canvas-detail\canvas-lane-view.component.spec.ts:374:    expect(getSubagentTranscript).not.toHaveBeenCalled();
libs/frontend\canvas\src\lib\canvas-detail\canvas-lane-view.component.spec.ts:404:    expect(getSubagentTranscript).not.toHaveBeenCalled();
libs/frontend\canvas\src\lib\canvas-detail\canvas-lane-view.component.spec.ts:767:    expect(getSubagentTranscript).not.toHaveBeenCalled();
libs/frontend\chat\src\lib\components\templates\chat-view.component.spec.ts:428:    getSubagentTranscript: jest.fn(),
libs/frontend\chat\src\lib\components\organisms\agent-monitor-panel.component.spec.ts:519:  let getSubagentTranscriptMock: jest.Mock;
libs/frontend\chat\src\lib\components\organisms\agent-monitor-panel.component.spec.ts:531:    getSubagentTranscriptMock = jest.fn().mockResolvedValue([]);
libs/frontend\chat\src\lib\components\organisms\agent-monitor-panel.component.spec.ts:563:            getSubagentTranscript: getSubagentTranscriptMock,
libs/frontend\chat\src\lib\components\organisms\agent-monitor-panel.component.spec.ts:704:    expect(getSubagentTranscriptMock).not.toHaveBeenCalled();
libs/frontend\chat\src\lib\components\organisms\agent-monitor-panel.component.spec.ts:820:    expect(getSubagentTranscriptMock).not.toHaveBeenCalled();
libs/frontend\chat\src\lib\components\organisms\agent-monitor-panel.component.spec.ts:868:    expect(getSubagentTranscriptMock).not.toHaveBeenCalled();
libs/frontend\chat\src\lib\components\organisms\agent-monitor-panel.component.spec.ts:893:    expect(getSubagentTranscriptMock).not.toHaveBeenCalled();
```

Additional `subagent:transcript` hit: `libs/frontend/chat-streaming/src/lib/agent-monitor.store.spec.ts:810` is a stale comment in an agent ID preservation test. The test does not call the removed method.

## Risks handled

- Left canvas and chat specs with transcript mocks/assertions to their parallel owning lanes; this lane's scope permits reporting those hits, not editing them.
- Left the agent ID preservation test intact because it tests event merge behavior, not the deleted read method. Its stale RPC comment is reported above.
- Did not touch shared RPC contracts or backend dispatcher; B6a/B6b own those removals.
- Did not touch the three protected production files named in the brief.

## Decisions

- **No store spec deletion.** Options: remove the unrelated agent ID preservation test or retain it. Evidence: no `getSubagentTranscript` symbol occurs in `agent-monitor.store.spec.ts`; the sole RPC mention is a comment in a test of preserving `agentId`. Retained the test. Reversible: yes.
- **No canvas mock edit.** Options: remove mock lines or report references. Evidence: canvas spec contains several assertions tied to the mock, so a single-line stub removal would break the spec; the file is owned by another lane. Reported all hits. Reversible: yes.
