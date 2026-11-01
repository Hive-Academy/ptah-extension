# Code Style Review (P8 re-review) — `TASK_2026_714_c8a2`

Scope: the 50 task commits from `git log --first-parent --no-merges 9b5f4c86c..HEAD`. That is 51 non-spec production files, plus `tools/` and `scripts/`. This replaces the earlier P8 style review. Read-only: no tests, diagnostics or builds were run.

Read in full or in the relevant ranges: `codex-gateway-adapter.ts`, the header of `codex-chat-adapter.ts`, the `codex-chat-host-ports.ts` profile and presentation ranges, and the `codex-runtime-composition.ts` usage and bundled-root ranges. I also read the commit diffs for `session-metadata-store.ts`, `session-rpc.handlers.ts`, `chat-session.service.ts` and `chat-slash-command-router.service.ts`. The rest was checked by grep. I did not read `codex-event-translator.ts`, `codex-approval-bridge.ts` or `codex-protocol-*` in full.

## Summary

| Metric          | Value          |
| --------------- | -------------- |
| Overall score   | 7/10           |
| Assessment      | NEEDS_REVISION |
| Blocking issues | 0              |
| Serious issues  | 3              |
| Moderate issues | 3              |
| Minor issues    | 4              |
| Files reviewed  | ~51 non-spec   |

The boundaries hold, and the frontend contract goes in the right direction. Two earlier P8 findings are closed. The remaining debt is mostly (a) a Codex error contract that is detected by string in two places, (b) Codex constants living in the wrong lib, and (c) files over the 700-line warning that keep growing.

## Five style questions

1. What breaks in six months?
   - `CodexResumeProfileChangedError` is not exported from `@ptah-extension/codex-runtime`. `codex-chat-adapter.ts:787` and `chat-session.service.ts:625-630` match `error.name === 'CodexResumeProfileChangedError'` plus a `'code' in error` probe. Renaming the class or code breaks the UX path at runtime with no compile error.
   - `codex-chat-adapter.ts` (811 lines) and `codex-runtime.ts` (1043 lines) are past the 700-line `max-lines` warning (`eslint.config.mjs:564`).
2. What would a new team member misread?
   - `CODEX_PTAH_TOOL_TIMEOUT_SEC` and `ptahMcpSessionUrl` live in `cli-agent-runtime` (`codex-lane-config.builder.ts:51`). `rpc-handlers` (`codex-chat-host-ports.ts:10`) and the gateway import them from there. The reader will assume this is a lane-only constant.
   - `PTAH_UI_HINT_CODEX = PTAH_UI_HINT_SHARED` (`ptah-ui-hint.ts:15`) is an alias that carries no Codex-specific content.
3. What does this cost to maintain?
   - `session-metadata-store.ts` is 2165 lines and takes Codex-only persistence on top: `codexSessionName`, `codexMessageCount` and `incrementCodexMessageCount`.
   - `session-rpc.handlers.ts:556-558` re-validates the count that the store already validated with `codexMessageCountSchema`.
4. Where is this inconsistent with the repo?
   - `chat-session.service.ts:256` declares a local `StreamlessFollowUpAdmission` interface instead of using an exported type. `NativeSessionControls` is exported at `agent-sdk/src/index.ts:168`, but the router's `acceptsFollowUpWithoutStream` is not part of it. This is the same duck-typing pattern flagged in the earlier P8 S3.
   - `session-metadata-store.ts:1066` has a bare `catch { storedCallerPath = undefined; }` with no `degradation-audit` marker. Neighbouring catches in the same file and in `codex-runtime.ts:583,749` carry one.
5. What would I do differently?
   - Export `CodexResumeProfileChangedError` and an `isCodexResumeProfileChanged(e)` guard from codex-runtime, and let `rpc-handlers` map the code to the user text (the message is currently duplicated at `codex-runtime.ts:67-70` and `chat-session.service.ts`).
   - Move the Ptah MCP URL and timeout into `codex-runtime`, since it is the one core lib. Have the lane and chat host both import from it.
   - Split `CodexContext` out of `codex-runtime.ts`: the file holds the `CodexRuntime` class (about 130 lines) plus the context class (about 800 lines).

## Blocking issues

None. No `as any`, `as unknown as`, `@ts-ignore` or `@ts-expect-error` was found in the touched production files. The one `eslint-disable` in the scope is `chat-session.service.ts:667` (`no-restricted-properties`, with a stated reason), not the module-boundaries rule. The `no-control-regex` disable at `chat-attention-source.service.ts:27` also states its reason. `codex-runtime` imports only `platform-core`, `shared/schemas` and `node:` built-ins, with no `vscode`, `electron` or adapter imports.

## Serious issues

### S1. Resume-profile-changed error is matched by name string and its text is duplicated

- File: `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:787-789`; `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:625-635`; class at `libs/backend/codex-runtime/src/lib/codex-runtime.ts:64-73` (not in `codex-runtime/src/index.ts`).
- Problem: a typed domain error exists but is not exported, so two adapter layers detect it with `error.name === '...'` plus `'code' in error` probes. The user-facing sentence is hard-coded twice (the class and the `RpcUserError` in `chat-session.service.ts`).
- Tradeoff: exporting the class and a guard gives a compile-time contract and one message source.
- Recommendation: export from the barrel, use `instanceof` or a guard, and keep only one copy of the text. This also stops `chat-session.service.ts` (2066 lines, already over the limit) from carrying Codex wording.

### S2. Codex constants and the MCP URL helper live in `cli-agent-runtime`

- File: `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-lane-config.builder.ts:51`; `cli-adapters/ptah-mcp-url.ts`; consumers `codex-chat-host-ports.ts:10,340` and `codex-gateway-adapter.ts` (imports `ptahMcpSessionUrl`).
- Problem: the task goal is that `codex-runtime` is the single core and chat and gateway are thin adapters. Instead, chat host ports and the gateway depend on the lane lib for the Codex tool timeout and the session URL. `rpc-handlers` gets a dependency edge to `cli-agent-runtime` for a Codex runtime constant.
- Recommendation: move `CODEX_PTAH_TOOL_TIMEOUT_SEC` and the URL builder into `codex-runtime` (next to `codex-mcp-config.ts`). The lane re-imports them.

### S3. Oversized and still-growing files in the Codex path

- Files:
  - `codex-chat-adapter.ts`: 811 lines. The previous review called out 823 and nothing has been split.
  - `codex-runtime-composition.ts`: 647 lines.
  - `codex-runtime.ts`: 1043 lines, with two classes in one file.
  - `codex-chat-host-ports.ts`: 581 lines, with one factory closure holding the presentation, pending-map and profile logic (lines ~340-470).
- Problem: Round 8m–8o landed fixes into these files rather than into new siblings.
- Recommendation: split `CodexContext` into `codex-context.ts`. In the chat adapter, extract open/resume bookkeeping. In host-ports, move `presentation` into a `codex-chat-approval-presentation.ts`.

## Moderate issues

- M1. `libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts:556-558` has a nested ternary with `Number.isSafeInteger` that duplicates the `codexMessageCount` helper in `session-metadata-store.ts`. Expose one normalised accessor from the store (or `agent-sdk`) and use it here.
- M2. `libs/backend/agent-sdk/src/lib/session-metadata-store.ts:1060-1067` is a bare `catch` that silently falls back to "no caller path". Add a `degradation-audit` marker with the reason, or log. The Codex persistence helpers (`codexSessionName`, `codexMessageCount`, `incrementCodexMessageCount`) are the first natural extraction out of the 2165-line store.
- M3. `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:256,345` uses a local structural interface for the router instead of an exported `agent-sdk` type. Export `StreamlessFollowUpAdmission` (or add the method to `NativeSessionControls`) next to the router.

## Minor issues

- `libs/backend/agent-sdk/src/lib/prompt-harness/ptah-ui-hint.ts:15`: `PTAH_UI_HINT_CODEX` is a pure alias of the shared hint. Use one name unless a Codex variant is planned.
- `libs/backend/gateway-chat-bridge/src/lib/codex-gateway-adapter.ts:17` and `codex-chat-adapter.ts:6` import `Logger` from `vscode-core` (type only). This matches sibling files in both libs. It is a known pre-existing coupling, not a new violation.
- `apps/ptah-electron/src/di/codex-runtime-composition.ts:440-460`: the usage `profileForHome` builds a profile inline with `realpathSync`. `codex-chat-host-ports.ts:421` builds another. Keep as is, but a `buildUsageProfile` helper in codex-runtime would remove the inline shape from the composition root.
- `libs/frontend/chat-streaming/src/lib/permission-handler.service.ts:320,546,553,594`: `console.warn` calls. These are not new in this scope (nothing was added in the task commits), so no action is needed here.

## File-by-file

- `libs/backend/codex-runtime/src/lib/*` — 8/10. Host-neutral, with ports and Zod at the protocol boundary. `codex-runtime.ts` at 1043 lines is the one structural issue (S3). `CodexResumeProfileChangedError` is not exported (S1).
- `libs/backend/agent-sdk/src/lib/codex-app-server/*` — 7/10. The split into `codex-chat-events`, `-approval-sink`, `-turn-stream` and `-tool-presentation` is a good responsibility split. The adapter stays too big (S3), and the error is matched by name (S1).
- `libs/backend/rpc-handlers/.../codex-host/*` — 7/10. Typed ports, a barrel-only `agent-sdk` import and kebab-case with role suffixes. It depends on `cli-agent-runtime` for Codex constants (S2). The `host-ports` closure is large (S3).
- `chat-session.service.ts`, `session-rpc.handlers.ts`, `chat-slash-command-router.service.ts` — 6.5/10. The task added only small deltas: +31, +26 and +20 lines. The nested ternary, the name-string error match and the local interface (S1, M1, M3) keep the Codex special-casing inside generic files.
- `libs/backend/gateway-chat-bridge/.../codex-gateway-adapter.ts` — 8/10. It uses the gate, `registerCodexRuntime` in a child scope, and a distinct approval sink.
- `libs/backend/cli-agent-runtime/.../codex/*` — 7.5/10. It consumes `codex-runtime` types, but owns constants that belong in the core (S2).
- `libs/backend/auth-providers/.../codex-account-usage.service.ts` — 7.5/10. 526 lines, with three bare catches; the ones I checked carry an audit marker.
- `libs/frontend/chat*`, `libs/shared permission.types.ts` — 9/10. The diff removes Codex-specific wire fields (`allowedDecisions`, the "native" request flag) and the Codex test branches. The only remaining "native" word in scope is a comment about OS notifications (`chat-attention-source.service.ts:132`).
- `apps/ptah-electron/src/di/codex-runtime-composition.ts` — 7/10. It is the correct composition root. Size is the issue (S3).

## Pattern compliance

| Rule or convention | Status | Evidence |
| --- | --- | --- |
| `codex-runtime` is host-neutral (no `vscode`, `electron`, adapters) | PASS | imports are only `platform-core`, `shared/schemas`, `node:` |
| Cross-lib imports go through public barrels | PASS | gateway and host-ports import `@ptah-extension/*` only |
| Chat, gateway and lane adapters are thin over codex-runtime | PARTIAL | constants and URL helper in `cli-agent-runtime` (S2) |
| Tokens are `Symbol.for` in the token object | PASS | `agent-sdk/src/lib/di/tokens.ts:26-58` |
| No `any`, `as unknown as`, `@ts-ignore`, `eslint-disable` of boundaries | PASS | grep over the touched files; two stated-reason disables only |
| Typed contracts instead of duck typing | FAIL | `codex-chat-adapter.ts:787`, `chat-session.service.ts:625-630,256` |
| Logger injection rather than `console` | PASS | no new `console.*` in backend files; frontend `console.warn` is not new |
| `max-lines` 700 | FAIL | 811, 1043, 647 (under the limit), 2066 and 2165 (pre-existing, grew) |
| No Codex special case in frontend | PASS | task diffs remove Codex branches and fields |
| Kebab-case with role suffix | PASS | `codex-chat-*.ts`, `*.service.ts` |

## Maintenance debt

- Introduced: name-string error matching in two layers, Codex constants in the lane lib, and about 150 more lines in already-oversized files (`session-metadata-store.ts`, `chat-session.service.ts`).
- Retired: the earlier P8 S3 `ipc-bridge` `unknown` duck-typing is out of scope here. The Codex fields and branches in the frontend were removed this phase.
- Net: slightly up, concentrated in file size.

## Verdict

- Recommendation: REVISE (NEEDS_REVISION)
- Confidence: MEDIUM. Several large files were read in ranges and by diff, not line by line.
- Key concern: the Codex contract (resume error, tool timeout, MCP URL) leaks across layers by string or via the wrong lib instead of living once in `codex-runtime`.
- A 10/10 version would:
  - Export the resume error and a guard from codex-runtime.
  - Move the Ptah MCP constants into codex-runtime.
  - Split `CodexContext` and the chat adapter below 700 lines.
  - Give the store one normalised native message-count accessor.
  - Keep the Codex branches out of `chat-session.service.ts` and `session-rpc.handlers.ts`.
