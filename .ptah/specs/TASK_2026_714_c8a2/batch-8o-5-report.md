# Batch 8o-5 — Codex UI hint must not search for skills

## Headline

Codex chat now gets `PTAH_UI_HINT_CODEX` (option a): the same fence sentences as Claude, without the "load the skill" sentence. Claude's `PTAH_UI_HINT` text is unchanged.

## Chosen option and why

**Option (a).** A Codex variant constant, exported beside `PTAH_UI_HINT`, used only by `codex-chat-host-ports.ts`.

Claude delivers the skill by naming it. `sdk-query-options-builder.ts` appends `PTAH_UI_HINT` to the Claude system prompt. Claude's own registry can load `ptah-surface-authoring`. That path still imports `PTAH_UI_HINT` and was not edited.

Codex chat does not receive the skill. `CodexExecutionProfile` allows `instructionSources` of kind `skill` | `file` | `inline`, and `codex-runtime.ts` joins `source.content` into `developerInstructions`. `codex-chat-host-ports.ts` never sets `instructionSources`. The profile builder defaults that array to `[]`. A sentence that says the guidance is already provided (option b) would be false. The skill body was not inlined.

## Exact new text

`PTAH_UI_HINT` (byte-identical to the previous constant):

```
Use ```ptah-ui blocks for compact turn summaries, stats, changed files, test results or charts in Ptah Electron; ```ptah-ui display [id] shows one in the side panel, and reusing an id updates it in place. Reference $diff $tests $usage $agents $limits; the host supplies real values—never type them yourself. Load the ptah-surface-authoring skill for grammar and examples.
```

`PTAH_UI_HINT_CODEX` (shared sentences only; no skill name, no "skill", no path):

```
Use ```ptah-ui blocks for compact turn summaries, stats, changed files, test results or charts in Ptah Electron; ```ptah-ui display [id] shows one in the side panel, and reusing an id updates it in place. Reference $diff $tests $usage $agents $limits; the host supplies real values—never type them yourself.
```

When `config.ptahUiFence === true` and the MCP tool profile is `coding` (or omitted), the Codex `developerPrompt` is that Codex string, joined after any earlier developer prompt with `\n\n`.

## Files changed

- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\prompt-harness\ptah-ui-hint.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\prompt-harness\ptah-ui-hint.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\prompt-harness\index.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\index.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\rpc-handlers\src\lib\chat\codex-host\codex-chat-host-ports.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\rpc-handlers\src\lib\chat\codex-host\codex-chat-host-ports.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-8o-5-report.md`

## Specs

- `ptah-ui-hint.spec.ts` — `keeps the Claude text byte-identical, including the skill sentence` (exact `PTAH_UI_HINT` string, skill sentence present). `keeps the shared sentences and drops the skill-loading sentence` pins `PTAH_UI_HINT_CODEX`.
- `codex-chat-host-ports.spec.ts` — `maps the UI fence for tool profile %s` expects `developerPrompt` to equal `PTAH_UI_HINT_CODEX` and not to contain `ptah-surface-authoring` or `skill`.

Tests were not run (batch rule).

## Could not change

`libs\backend\rpc-handlers\src\lib\chat\session\chat-session.native.spec.ts` (about lines 299 and 368) still expects `developerPrompt` to contain `PTAH_UI_HINT`. That file is outside this batch's scope. Those two assertions will fail until they expect `PTAH_UI_HINT_CODEX`.

## Decisions

- **D21 implementation is option (a).** Codex chat has an empty `instructionSources` list, so it must not be told to load `ptah-surface-authoring`.
- **Resume fingerprint change is acceptable on the dev-gated runtime.** `developerPrompt` is part of the thread identity hashed into `profileFingerprint` (`codex-execution-profile.ts`). A fenced Codex thread stored before this change no longer matches and resume throws `CodexResumeProfileChangedError` (`resume-profile-changed`, "Start a new chat"). That is the same D14a behaviour. D14a treats it as acceptable because the native Codex runtime is dev-gated (`PTAH_CODEX_RUNTIME_DEV=1`) and unreleased, so only live-test threads are affected. Threads that never had the UI fence keep the same developer prompt and fingerprint.
- **Claude text stays one string.** `PTAH_UI_HINT` is the shared sentences plus the original skill sentence, so every existing Claude `toContain(PTAH_UI_HINT)` check still matches the same bytes.

## Agent report

`ptah_agent_report` is not registered in this session (`ptah_agent_report`, `ptah__ptah_agent_report`, and `mcp__ptah__ptah_agent_report` were not found). The summary is in the spawning agent's final message.

## Fix round

Coordinator approved the scope extension. `chat-session.native.spec.ts` now imports `PTAH_UI_HINT_CODEX` and the start and resume profiles expect `developerPrompt` to contain that constant and not `ptah-surface-authoring`. The `PTAH_UI_HINT` import is gone. No other lines in that file changed. The "Could not change" note above is superseded.
