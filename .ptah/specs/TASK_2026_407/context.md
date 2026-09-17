# Investigate duplicate assistant response rendering

## User report

The user observed the TASK_2026_406 workflow-start announcement repeated in the chat UI. They requested a separate investigation task, not immediate implementation. Keep this task independent of compaction research; TASK_2026_406 is related context, not a dependency.

The visible main-conversation transcript contains one final announcement. That does not establish where duplication occurred: generation, provider translation, backend delivery, stream reconciliation, replay, or rendering must be distinguished with evidence.

## Supplied UI evidence

```text
Started TASK_2026_406 with the configured Ollama Cloud provider.

Sonnet tier — four parallel investigations

Existing compaction, context accounting, watchdog, and session code.
Full available Electron log history, including rotated logs.
Claude and Codex runtime compaction APIs and controls.
Ollama Cloud, Moonshot, and proxy compatibility.
Opus tier — sequential review

Design an intelligent compaction layer using existing infrastructure.
Challenge the design’s assumptions and verify API support.
Produce a final recommendation with exact code integration points and a validation plan.
Reports will land in .ptah/specs/TASK_2026_406/, with 07-final-research.md as the consolidated deliverable.

Research only: no product-code changes, live compaction, or deployment.

Started TASK_2026_406 with the configured Ollama Cloud provider.

Sonnet tier — four parallel investigations

Existing compaction, context accounting, watchdog, and session code.
Full available Electron log history, including rotated logs.
Claude and Codex runtime compaction APIs and controls.
Ollama Cloud, Moonshot, and proxy compatibility.
Opus tier — sequential review

Design an intelligent compaction layer using existing infrastructure.
Challenge the design’s assumptions and verify API support.
Produce a final recommendation with exact code integration points and a validation plan.
```

The supplied second copy is shorter than the first; do not assume two identical complete messages or that they occupy separate chat bubbles.

## Investigation scope

- Correlate persisted session events, translated provider output, backend stream events, frontend message state and rendered output for the announcement.
- Session context: `472e09c5-57f5-4907-89e7-74db49a9731e`; repository `D:\projects\ptah-extension`; workflow `ollama-intelligent-compaction-research`, run `wf_6d2389f7-9a7`.
- Inspect stream-delta versus complete-message reconciliation: are final snapshots appended to existing text rather than replacing/reconciling it?
- Check message/block IDs, idempotency, duplicate subscriptions, routing across tabs, persisted-history hydration and session replay.
- Check whether background workflow completion notifications or session resume replay a prior assistant message. Timing is a hypothesis, not an established cause.
- Verify active host/provider from evidence rather than assuming the research workers’ Ollama Cloud provider is also the parent conversation’s provider.
- Relevant starting areas: `libs/frontend/chat-streaming`, `chat-routing`, `chat-state`, `chat`, `chat-ui`, and backend `agent-sdk` / provider translation. Read relevant CLAUDE.md and discover actual symbols before proposing edits.
- Logs reside under `C:\Users\abdal\AppData\Roaming\Ptah\logs`; preserve them. Do not publish raw logs, credentials or unrelated conversation content.

## Expected outcome

1. Identify the first layer at which content duplicates, with correlated event/message IDs and source references.
2. Reproduce or provide a precise evidence-backed explanation; explicitly mark unresolved hypotheses.
3. Recommend a narrow fix and regression coverage for streamed-to-final reconciliation, replay/resume, and background notification handling as applicable.
4. Preserve legitimate repeated text; do not propose global text-content deduplication as a substitute for correct event identity.

## Status

Backlog. Task filing only; no investigation worker launched and no product code changed.
