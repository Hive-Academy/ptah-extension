# Batch 8j-2: notification timing and forward compatibility

## Files changed

- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/codex-runtime/src/lib/codex-app-server-process.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/codex-runtime/src/lib/codex-app-server-process.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-8j-2-report.md

## Behaviour

The process marks receipt of a successfully validated initialize response synchronously in receive, before resolving its pending request. Valid notifications arriving after that response and before ready are buffered, up to 64 frames. They flush in arrival order immediately after ready becomes true, after the initialized client notification is written. Flush exceptions retain the same process-failure reason, notification method and original cause as live dispatch. Close, including initialization failure, clears the buffer.

Unknown notification methods are ignored only when the existing validator raises unknownMethod after validating the envelope and the original frame has a string method and no id. They never reach onNotification, including before the initialize response. The injected optional logger logs only the redacted method, never params. A per-process Set retains at most 64 method names; once full, further new names are silently ignored without eviction or repeat logs. Close releases the Set. Existing 1 MiB frame limits also apply.

Known notifications before the initialize response, server initialized notifications at every phase, malformed envelopes, and server requests before ready remain fatal. Unknown server requests after ready retain Method not found replies. No validator or schema file was edited.

## Specs added or updated

- Initialize reply plus remoteControl/status/changed and a second notification in the same stdout chunk: no premature delivery, ordered delivery exactly once after initialized is written.
- Separate chunks delivered synchronously before the start continuation: the same buffering and order guarantees.
- Unknown notification before and after ready: ignored, debug logged once, params excluded, subsequent request completes.
- Unknown notification before the initialize response: ignored.
- Unknown-method logging capped at 64 names, without eviction/relogging, with method-name redaction.
- Approval and unknown server requests before ready remain fatal.
- Server initialized notification before response, before ready and after ready remains fatal.
- Valid notification before initialize response remains fatal.
- Exactly 64 buffered notifications succeed; the 65th fails closed without dispatch.
- Buffered handler exception preserves cause and method and discards the remaining queue.
- Home verification failure discards buffered notifications.
- Replaced the former fatal unknown-method case with a malformed unknown-notification envelope case; a nearby comment explains forward compatibility.
- Changed the invalid-result fixture from extra object keys to null, with a comment: additive result keys will be tolerated by the parallel schema change, but a wrong result type remains invalid.

## model/list conclusion

Kept the request-local invalidResult branch unchanged. Unknown-key tolerance does not make missing required fields or incorrect types valid. This branch rejects and removes only the catalog request and its timer; malformed envelopes remain fatal. Existing specs continue to cover missing catalog fields, another request completing, retrying model/list, and malformed catalog envelopes.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Catch unknownMethod after validation | Catch the typed error; preclassify methods with exported helpers | validateCodexFrame validates the envelope first; catching preserves invalid-envelope and allowlisted-notification validation without duplicating the manifest | Yes |
| Use 64-frame buffer and 64-name non-evicting log Set | Bounded queue and Set; unbounded retention; evict old names | Batch 8j permits bounds of 64; no eviction preserves once-per-method logging and caps total log volume | Yes |
| Preserve live failure diagnostics during flush | Preserve notification method and original exception; report only generic initialize failure | Existing live-handler exception spec and onData fail contract | Yes |
| Keep model/list exception | Keep request-local invalidResult; make all result validation fatal | Batch 8j explicitly retains handling of missing fields/type drift; current catalog regression specs cover isolation | Yes |

## Not done

No verification commands, diagnostics, tests, builds or git operations were run, as instructed for this lane. Specs are authored but unexecuted; the team leader owns verification. No files outside the two assigned source/spec files and this report were modified.
