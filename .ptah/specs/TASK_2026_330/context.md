# TASK_2026_330 — Remove the only tool-blocking SDK hook (PreToolUse: Read)

## Symptom

Background subagents (and the parent, on a notification-started turn) receive the tool
result "The user doesn't want to take this action right now. STOP what you are doing
and wait for the user to tell you how to proceed." for `Read` only. The JSONL record
carries `toolDenialKind: "cancelled"`. Measured on 2026-08-26: 123 of 123 cases across
49 transcripts are `Read`; `Bash` and `Grep` in the same agents, in the same seconds,
succeed. The session is in YOLO mode and `Read` is in `SAFE_TOOLS`, so Ptah's
`canUseTool` never sees these calls. The cancellation resolves in ~5 ms with no
Ptah round trip. Bursts coincide with parent turn boundaries and task-notification
bursts while background agents run.

## Cause

`Read` is the only tool with a pre-execution SDK hook installed by Ptah:
`libs/backend/agent-sdk/src/lib/helpers/pre-tool-use-hook-handler.ts:28-31`
(`PreToolUse`, `matcher: 'Read'`), consumed by
`libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts:188` →
`onPreToolUseRead` (`:585`). A pre-execution hook is a `hook_callback` control request
from `claude.exe` to Ptah; when the CLI cancels that request, the tool itself is
reported cancelled. `PostToolUse` hooks run for every tool and are never observed to
cancel a result.

## Required change

1. Move the Read observation to `PostToolUse` with `matcher: 'Read'`. The
   `PostToolUse` payload has `tool_input` (and `tool_response`); the observation only
   needs `tool_input.file_path`. Reuse the existing `PostToolUseHookHandler` /
   `PostToolUseCallbackRegistry` (`libs/backend/agent-sdk/src/lib/helpers/post-tool-use-*`)
   rather than a second PostToolUse matcher, if it already fans out for all tools —
   filter on `toolName === 'Read'` in the memory trigger.
2. Delete `PreToolUseHookHandler`, `PreToolUseCallbackRegistry`, their DI tokens
   (`SDK_TOKENS.SDK_PRE_TOOL_USE_*`), the barrel exports, and the wiring in
   `sdk-query-options-builder.ts` (`:45`, `:562-563`, merge list ~`:1330`).
   Ptah must install NO `PreToolUse` hook after this task. Update
   `libs/backend/agent-sdk/CLAUDE.md` and `memory-curator/CLAUDE.md` if they mention it.
3. Update `memory-trigger.service.spec.ts` and `observation-queue.store.ts` comments
   that say "PreToolUse Read" (e.g. `observation-queue.store.ts:4`,
   `persistence-sqlite/.../0016_observation_queue.ts:5`) — comments only, no schema change.
4. Spec: `SdkQueryOptionsBuilder` hook list contains no `PreToolUse`; a `PostToolUse`
   for `Read` enqueues the same observation row as before.

## Constraints

- Do not touch `memory-trigger-config.ts` or `file-settings-keys.ts` (TASK_2026_328).
- `catch (error: unknown)`.

## Verify

```bash
npx nx run-many -t test -p @ptah-extension/agent-sdk @ptah-extension/memory-curator
npx nx run-many -t typecheck -p @ptah-extension/agent-sdk @ptah-extension/memory-curator ptah-electron ptah-extension-vscode ptah-cli
```
