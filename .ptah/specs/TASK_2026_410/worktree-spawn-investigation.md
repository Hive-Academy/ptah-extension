# Agent worktree spawn investigation

Date: 2026-09-10  
Scope: read-only investigation; no Agent spawn was attempted.

## Verdict

Two separate defects/signals are being conflated.

1. **`isolation` is not hardcoded to `worktree` by Ptah.** Ptah's system prompt says the opposite: omit `isolation` by default and request `worktree` only for concurrent conflicting writers (`libs/backend/agent-sdk/src/lib/prompt-harness/ptah-core-prompt.ts:133`). The interactive query supplies the Claude Code preset, not a Ptah-authored `Agent` schema (`libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:796-799`).
2. **The runtime schema exposed to Main is wrong for omission.** The observed `functions.Agent` schema makes `isolation` required and allows `worktree | remote`. The pinned SDK declaration says `isolation?: "worktree"`; current official documentation also describes worktree isolation as opt-in. Because every observed call contained `isolation: "worktree"`, there has still been no valid omission experiment. The evidence does not distinguish a strict-schema conversion from model selection/injection, but the required schema alone is sufficient to prevent omission.
3. **The spawn failure is explained by Ptah's callback contract violation.** Ptah always registers a `WorktreeCreate` callback (`libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:1381-1384,1419-1424`). A configured `WorktreeCreate` hook replaces Claude Code's default git behavior. On git failure, unexpected input, or exception, Ptah returns `{ continue: true }` without `hookSpecificOutput.worktreePath` (`libs/backend/agent-sdk/src/lib/helpers/worktree-hook-handler.ts:141-150,163-174,216-223`). For this event Claude Code discards `continue`; success without a path is itself a failure. That exactly matches: `hook succeeded but returned no worktree path`.

The smallest safe change is therefore **not** to add another isolation default. First repair the hook failure contract so it propagates the underlying git error instead of converting it to pathless success. In parallel, capture the actual outbound `Agent` schema at the provider boundary and fix the component that marks optional properties required. Do not special-case Main to always choose `worktree`.

## Facts and evidence

### A. Ptah does not select worktree isolation by default

- The system prompt explicitly directs Main to spawn in the current working branch with no `isolation` setting by default (`libs/backend/agent-sdk/src/lib/prompt-harness/ptah-core-prompt.ts:133`).
- Task-board isolation is opt-in. Only `start(taskId, true)` appends the worktree directive (`libs/frontend/tasks-ui/src/lib/services/task-start.service.ts:28-31,67-79`). The non-isolated regression test expects `/orchestrate TASK_2026_200` with no isolation hint (`libs/frontend/tasks-ui/src/lib/services/task-start.service.spec.ts:55-60`); the isolated case is separately asserted at `:70-80`.
- Query options use `{ type: 'preset', preset: 'claude_code' }` (`libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:796-799`). There is no local `Agent` JSON schema definition or option that assigns `isolation: 'worktree'` in this path.

Therefore, "always worktree" is not a Ptah prompt/options constant. If the task was launched with the task-board isolate toggle, the directive intentionally asks for worktrees; otherwise Ptah's standing instruction asks for omission.

### B. The live schema conflicts with the SDK contract

- The repository pins `@anthropic-ai/claude-agent-sdk` to `0.3.150` (`package.json:99`; lock resolution at `package-lock.json:1694-1710`).
- The installed `0.3.150` declaration is:

  ```ts
  isolation?: "worktree";
  ```

  Source inspected: `D:/projects/ptah-extension/node_modules/@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:305-342`, especially `:339-341`.
- The same installed SDK declares the callback result as `hookSpecificOutput: { hookEventName: 'WorktreeCreate'; worktreePath: string }` (`sdk.d.ts:5830-5841`).
- The installed package identifies its matching Claude Code version as `2.1.150` (`node_modules/@anthropic-ai/claude-agent-sdk/package.json`, `claudeCodeVersion`). The executable Ptah detects on this machine is `C:/Users/abdal/.local/bin/claude.exe`, version `2.1.259`.
- Ptah prefers a detected/configured external CLI and stores its resolved executable path (`libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:424-441`), then passes that path into SDK query construction (`libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:698-703`; option emitted at `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:784-788,887`). Thus the TypeScript wrapper/type package and the executing Claude Code binary can be on different versions. This is a concrete compatibility risk and plausibly explains why the live schema has a newer `remote` enum member absent from the pinned declaration; it does **not**, by itself, prove which layer added `required`.

Current official docs corroborate opt-in semantics: custom subagent `isolation` is optional, and `isolation: worktree` gives that subagent a temporary worktree. See [Create custom subagents](https://code.claude.com/docs/en/sub-agents) and [Run parallel sessions with worktrees](https://code.claude.com/docs/en/worktrees).

### C. The repository's OpenAI-compatible translators do not make optional fields required

Both local tool translators copy `input_schema` unchanged:

- Chat Completions: `libs/backend/auth-providers/src/lib/translation/request-translator.ts:140-153`.
- Responses API: `libs/backend/auth-providers/src/lib/translation/responses-request-translator.ts:232-249`.

Neither walks `properties`, rewrites `required`, adds nullability, nor sets OpenAI `strict`. The local response types do not even model a `strict` field on function definitions (`libs/backend/auth-providers/src/lib/translation/openai-translation.types.ts:66-74`).

So hypothesis 1 must be narrowed:

- A provider/host schema adapter **may** be converting all properties to required before or after these functions.
- These two Ptah translators are **not** that adapter; they preserve whatever `required` array arrives.
- The observed schema must be captured immediately before the provider request and compared with the Claude Code logical tool schema. Without that capture, assigning blame to the provider conversion remains an inference.

Hypothesis 2 is also not proven:

- Ptah's prompt tells the model to omit isolation by default.
- The exposed schema tells it omission is invalid.
- Every actual call used `worktree`; no omission call passed validation.

The required schema is therefore the leading explanation for repeated selection. Prompt injection/default injection cannot be excluded until a raw pre-execution tool call is captured, but no Ptah source found injects the property.

### D. Omitted `isolation` behavior

For an ordinary Agent/subagent call, the SDK type and official subagent docs make worktree isolation opt-in. Omitting `isolation` means the subagent runs from the parent session's current checkout/cwd; no `WorktreeCreate` event should be caused by the Agent isolation option.

Do not confuse that with other products/modes:

- Claude Desktop creates worktree-backed sessions by default.
- Claude Code background **sessions** have separate settings/behavior.
- A custom agent definition can permanently declare `isolation: worktree`.
- Ptah's task-board isolate toggle deliberately adds a natural-language worktree directive.

No live omission spawn was performed here, per the investigation constraint. This conclusion is from the inspectable SDK declaration, Ptah prompt, and official docs; it needs the mock-level regression below before merge.

## WorktreeCreate failure trace

1. Every query builds worktree hooks, regardless of whether the UI callbacks are present (`libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:1364-1384`).
2. The hooks are merged into every query's SDK options (`:1418-1438`), and logging confirms this is treated as an active hook (`:1440-1456`).
3. `WorktreeHookHandler` computes `<cwd>/.claude-worktrees/<name>` and calls `GitInfoService.addWorktree` with `createBranch: true` (`libs/backend/agent-sdk/src/lib/helpers/worktree-hook-handler.ts:152-161`).
4. `GitInfoService` runs `git worktree add -b <branch> <path>` (`libs/backend/vscode-core/src/services/git-info.service.ts:430-450`). On nonzero exit it retains the exact stderr in `result.error` (`:452-456`); on exception it returns the error text (`:460-467`).
5. The hook logs that underlying error, then returns `{ continue: true }` and no path (`libs/backend/agent-sdk/src/lib/helpers/worktree-hook-handler.ts:163-174`). Its catch does the same (`:216-223`).
6. The existing tests explicitly enshrine this invalid fallback: git failure and rejection must resolve to `{ continue: true }` (`libs/backend/agent-sdk/src/lib/helpers/worktree-hook-handler.spec.ts:77-97`).
7. Official hook documentation states that `WorktreeCreate` replaces default git behavior, **discards `continue` and `systemMessage`**, requires a returned path, and fails creation when the hook fails or produces no path. See [Hooks reference — WorktreeCreate output](https://code.claude.com/docs/en/hooks#worktreecreate-output).

The SDK callback bridge was also inspected in installed `sdk.mjs`: `handleHookCallbacks` returns the callback result directly, and `handleControlRequest` serializes that result as the successful control response. There is no bridge transform that strips `hookSpecificOutput`. The successful Ptah branch already returns the correct camel-case shape (`libs/backend/agent-sdk/src/lib/helpers/worktree-hook-handler.ts:205-215`).

Consequently, the generic runtime error proves that one of Ptah's pathless branches ran. It does **not** reveal why `git worktree add` failed. The exact cause is in the adjacent Ptah log entry (`result.error`) and was not present in the worktree artifacts supplied for this investigation. Candidate git causes must not be promoted to facts without that line.

Read-only state inspection found many existing `agent-*` branches and registered worktrees, including nested worktrees, so neither "git worktrees never work here" nor "nested worktrees are categorically unsupported" is supported by current repository state.

## Recommended fix, pending Main review

### 1. Fix failure semantics first (small, local)

In `WorktreeHookHandler`:

- On `!result.success || !result.worktreePath`, throw an `Error` containing `result.error`.
- Do not catch that error and convert it to `{ continue: true }`; let the SDK callback bridge return an error control response.
- Treat unexpected `WorktreeCreate` input the same way.
- Keep the successful `hookSpecificOutput.worktreePath` return unchanged.
- Update the header comments: this hook is not informational/non-blocking. It replaces creation and must either return a usable path or fail.

This change turns the opaque "succeeded but no path" into the real git failure. It does not pretend a failed isolated spawn can safely continue unisolated.

Then use the revealed stderr to make the smallest git-specific correction. Do not guess that correction now.

### 2. Decide whether Ptah should own worktree creation at all

The lower-maintenance option is to stop registering a custom `WorktreeCreate` handler and let the matching Claude Code binary use its default implementation. Current Claude Code handles base-ref selection, reuse, safety checks, and cleanup that Ptah's four-argument `git worktree add` wrapper does not.

That is broader than the failure-semantics patch because Ptah currently uses the hook to broadcast UI refreshes (`libs/backend/cli-agent-runtime/src/lib/wiring/sdk-callbacks.ts:336-391`). Main should decide whether that notification can come from subagent lifecycle/state or a git watcher before removing the hook.

Also review `WorktreeRemove`: the current handler only broadcasts and returns; it performs no removal (`libs/backend/agent-sdk/src/lib/helpers/worktree-hook-handler.ts:227-290`). A custom lifecycle hook must not accidentally suppress SDK cleanup. This needs a contract test before changing it.

### 3. Repair the schema at its owner, not in the prompt

- Capture the `Agent` input schema at two points: as emitted by Claude Code and immediately before the provider HTTP request.
- Assert that `isolation` is absent from `required` when the logical property is optional.
- If an OpenAI strict adapter requires every property in `required`, encode optionality as nullable and map `null` back to omission before tool execution, or disable strict conversion for this built-in tool. Do not turn semantic optionals into mandatory enum choices.
- Add a runtime compatibility check between the pinned Agent SDK and the external CLI selected at `sdk-agent-adapter.ts:424-441`. At minimum warn with both versions; safer is to use the SDK-matched executable unless the user explicitly configures an override.

## Regression tests

1. **Hook success:** existing success test remains; assert exact absolute `hookSpecificOutput.worktreePath` (`worktree-hook-handler.spec.ts:51-75`).
2. **Hook git failure:** replace the `{ continue: true }` expectation at `:77-88` with rejection/error propagation containing the stubbed git error.
3. **Hook exception:** replace `:90-97` with rejection/error propagation; assert it is not serialized as successful pathless output.
4. **Unexpected hook input:** add a case proving it fails explicitly rather than returning pathless success.
5. **Builder registration:** assert the intended policy explicitly—either no custom `WorktreeCreate` hook when default SDK behavior should own creation, or exactly one custom hook when Ptah intentionally owns it. Current merge-only coverage (`sdk-query-options-builder.spec.ts:1462-1496,1572-1587`) does not test the contract.
6. **Schema pass-through:** add Chat Completions and Responses fixtures where `Agent.properties.isolation` exists but `required` omits it; assert the translated schema still omits it. This pins the two known Ptah adapters.
7. **Provider-boundary schema:** with HTTP mocked, capture the final request for the affected OpenAI-compatible provider and assert `isolation` remains omittable. This is the test that locates/prevents an all-properties-required converter.
8. **Omission behavior, no spawn side effect:** invoke the Agent tool executor with a mocked launcher and no `isolation`; assert no `WorktreeCreate` callback and that the child receives the parent cwd. Add separate cases for explicit `worktree` and explicit `remote` if the active CLI contract supports both.
9. **Version skew:** detector/adapter test with SDK `0.3.150` metadata and CLI `2.1.259`; assert the chosen warning/fallback policy.

## What is proven vs open

Proven:

- Ptah does not hardcode Agent isolation to worktree.
- The observed required runtime schema contradicts the pinned SDK optional declaration and current docs.
- Ptah's two repository OpenAI translators preserve schemas verbatim.
- Ptah always installs a custom `WorktreeCreate` callback.
- Ptah returns successful callback responses without paths on all failure branches.
- That response is invalid for `WorktreeCreate` and exactly explains the surfaced error.
- SDK `0.3.150` is executing an independently detected Claude Code `2.1.259` binary on this machine.

Open:

- Which component changed `isolation` from optional to required. Requires pre/post provider schema capture.
- Whether the model would omit isolation if given a valid optional schema. No omission call has run.
- The underlying `git worktree add` stderr for these attempts. It was logged but not supplied in the worktree.
- Whether removal hook registration suppresses cleanup in the exact SDK/CLI version pair. Test before changing it.

