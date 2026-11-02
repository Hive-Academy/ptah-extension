# D9 fix 4: Codex resume history

## Root cause and live evidence

There is **no failing thread field** in the captured `thread/list` result. The reported `Codex invalid protocol frame` happened before result schema validation: `codex-app-server-process.ts:328-349` rejects a stdout line larger than `FRAME_BYTES = 1,048,576` (`:26`) and fails the process. The first unfiltered 100-row response in `thread-list-sample.json` is 1,555,547 bytes when compactly serialized. A read-only diagnostic using the repository's Zod validator accepted that entire result. The `source.subAgent.thread_spawn` value on the D9 child also validates. This explains why the live log had a process failure for `thread/list` but no Zod issue paths.

`thread-list-sample.json` contains two raw JSON-RPC response frames from the installed Codex 0.165.0 binary: `frames[0].frame` is the oversized response to the previous `archived:false, limit:100, sourceKinds:[...]` request; `targeted.frame` is the 1,219-byte response to `ancestorThreadId` for parent `01a19cd2-dc3c-7680-ae77-a7c9363246e9` with `limit:20`. It returns child `01a19cd2-f223-74a2-8d7b-c5d007774da7`, `parentThreadId` equal to the parent, and `source.subAgent.thread_spawn.parent_thread_id` equal to the parent. The old code did **not** send a `cwd` filter, despite the task's suggested probe wording; the first captured request matches the actual code. No turn was started by any probe.

The binary-generated types, kept outside the repo at `%TEMP%/ptah-codex-0165-schema-d9/v2/`, confirm `ThreadListParams.ancestorThreadId` and the structured `SessionSource` sub-agent variant. Read-only probes of the same parent and child confirmed `thread/read`, `thread/turns/list`, and `thread/items/list` responses validate; the parent has one `spawnAgent` item whose `receiverThreadIds` contains the child, and the child turn contains its answer. The projector already links child turns to that spawn item (`codex-history-projector.ts:63-103`) and has a card replay spec. No second history-data or projection bug was found. A live Electron resume was not rerun here.

## Changes

- `libs/backend/codex-runtime/src/lib/codex-protocol-methods.ts:102`: model the pinned `ancestorThreadId` list parameter.
- `libs/backend/codex-runtime/src/lib/codex-protocol-schemas.ts:460-464`: allow future string source labels; keep structured `custom` and `subAgent` variants validated. Server objects already strip extra fields, and the sub-agent payload remains JSON-validated.
- `libs/backend/codex-runtime/src/lib/codex-runtime.ts:102-106`: pass the injected runtime logger into history loading.
- `libs/backend/codex-runtime/src/lib/codex-session-history.ts:98-186`: hydrate root turns before auxiliary discovery, request only descendants at 20 per page, and warn with safe Zod issue paths on list failure. A request-local invalid result can continue to the archived list; a process-level frame failure returns the already hydrated root instead of `HISTORY_FAILED`. A frame-size failure has no Zod issues, so its `issues` field is `[]`.
- `libs/backend/codex-runtime/src/lib/codex-session-history.spec.ts:83-164`: adapt logger injection and cover descendant filtering, request-local list rejection with issue paths, and root fallback after process failure.
- `libs/backend/codex-runtime/src/lib/codex-thread-list-live.spec.ts:1-37`: use both captured frames as fixtures, assert the oversized 100-row page, the targeted child, and tolerant source parsing.
- `.ptah/specs/TASK_2026_714_c8a2/thread-list-sample.json`: raw captured list frames and request parameters.
- `.ptah/specs/TASK_2026_714_c8a2/task-D9-fix4-report.md`: this report.

## Verification and limits

The installed binary generated protocol types, returned the captured read-only frames, and validated the D9 parent and child history responses in a temporary diagnostic script. Ptah AST analysis parsed all changed TypeScript files with zero syntax errors. As directed, no Nx, Jest, `tsc`, lint, build, install, or Git command was run; CI must run the specs and a live Electron resume. `rg` was unavailable (`Access is denied`), so source text search used PowerShell `Select-String`. This CLI session exposed no skill invocation mechanism, so no skill was loaded.
