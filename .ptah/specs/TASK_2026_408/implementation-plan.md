# Implementation Plan - TASK_2026_408 (phases 1-2, Codex translation proxy)

## Inputs and constraints

- Requirements used: `.ptah/specs/TASK_2026_408/context.md` (including "Resume point"), `.ptah/specs/TASK_2026_408/task.md`, the launch brief (scope items 1-9), `.ptah/specs/TASK_2026_564_87a6/context.md` (path C evidence), `.ptah/specs/TASK_2026_406/02-full-log-forensics.md:160-183,240-246`.
- Already shipped, not redone: scope item 1 of `context.md` (usage/cache accounting, `4f806f210`, `translateResponsesUsage` in `translation-proxy-helpers.ts:22-39`).
- Ownership exclusions:
  - TASK_2026_561_9e57 owns all compaction policy. No `autoCompactWindow`, threshold, capper or CompactionCoordinator change appears here.
  - TASK_2026_562_4b1d W2.4 owns system-prompt-once and `prompt_cache_key`. This plan edits `responses-request-translator.ts` in exactly two places: the `ResponsesFunctionCallOutputItem` interface (`:67-71`) and `translateToolResultToFunctionCallOutput` (`:391-416`). `translateAnthropicToResponses`, `translateToolsForResponses`, `translateSystemToDeveloper` and `extractSystemText` are untouched. The tool-name guard is a post-pass in a new module (Decision 3).
  - Path C (`apps/ptah-cli/src/services/proxy`) belongs to TASK_2026_564_87a6. Only a header comment is added there.
- Design handoff used: none (no UI work; see Decision 8).
- Missing decision-critical input:
  - The worktree has no `node_modules`. The installed SDK could not be read in place, and the main checkout is off-limits. Resolution: the exact lockfile-pinned tarballs were fetched into `%TEMP%\t408` and their sha512 checked against `package-lock.json`: `@anthropic-ai/claude-agent-sdk@0.3.278` (`:1730-1733`) plus `@anthropic-ai/claude-agent-sdk-win32-x64@0.3.278` (`:1857-1860`), `openai@5.23.2` (`:24266-24269`), `@openai/codex@0.155.1-win32-x64` (`:11251-11254`). Hashes matched for both SDK packages. Evidence below that is labelled "pinned binary" comes from byte-string searches of those artifacts. Minified code has no stable line numbers, so each citation gives the searchable literal instead.
  - Round 1 update: `node_modules` is now present in the worktree (a junction to the installed set). `node_modules/@anthropic-ai/claude-agent-sdk/package.json` reports `0.3.278`, and the `compact_boundary` / `resume` citations below were read from it directly.

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| Stream translator routes only `output_text.delta`, `output_item.added`, `function_call_arguments.delta`, `output_item.done`, `completed`. Every other event, including `response.failed`, `response.incomplete`, `error` and `function_call_arguments.done`, returns `[]` | `libs/backend/auth-providers/src/lib/translation/responses-stream-translator.ts:227-251` | Items 2 and 4 are new `handleEvent` cases |
| When upstream EOF arrives without a terminal event, the base only flags `onTranslationError` and calls `res.end()`, so the SDK gets a truncated SSE body with no `error` event | `translation-proxy-base.ts:1144-1150`; proxy `error` at `:1152-1157` | The base must write a terminal SSE `error` |
| Every upstream status >= 400 except 401 and 429 becomes `sendErrorResponse(res, statusCode, 'api_error', getUpstreamErrorMessage(...))`. The path is shared by the Messages, Chat and Responses lanes | `translation-proxy-base.ts:1009-1026`, `forwardToApi` `:802-1106` | Overflow classification is inserted once, here |
| OpenCode overrides `getUpstreamErrorMessage` so raw upstream bodies never reach clients or logs | `providers/opencode/opencode-translation-proxy.ts:82-94` | The overflow message must be synthesized, never copied from the upstream body |
| The collector treats `error` and `response.failed` as a plain `Error`, which becomes `invalid_response`. `response.incomplete` is accepted only for `max_output_tokens`. Stop reason is `max_tokens` for any incomplete | `responses-stream-collector.ts:135-147`, `:78-81`; error class `:5-14` | Non-streaming parity lives here |
| Base collector catch maps every `ResponsesStreamError` to `502 api_error` `${code}: ${message}` | `translation-proxy-base.ts:752-773` | Gains a mapping-aware status/type |
| The JSON non-stream path ignores `status`. `stopReason` is `end_turn`/`tool_use` only. Tool args use `safeJsonParse` (fabricates `{}`). Tool name is taken verbatim | `translation-proxy-base.ts:1164-1256` (`:1181`, `:1194-1203`) | Needs the same terminal mapping and name reverse map |
| Tool definitions pass names through unchanged | `responses-request-translator.ts:255-265` | Name guard needed |
| History `tool_use` becomes `function_call` with the name unchanged | `responses-request-translator.ts:356-370` | The guard must also rewrite history names |
| `tool_result` output keeps only text blocks, so images are dropped | `responses-request-translator.ts:391-416` (`:398-402`) | Item 5 |
| A tool call takes `blockIndex: this.blockIndex` and the counter is not advanced when the call starts. `output_item.done` rewinds with `this.blockIndex = toolCall.blockIndex + 1`. The lazy delta path assigns an index before start | `responses-stream-translator.ts:314-319`, `:435`, `:356-367` | Two overlapping calls share an index (item 6) |
| The pinned CLI indexes streamed blocks by `index`. `input_json_delta` into a non-`tool_use` block throws (`content_block_type_mismatch`), and a missing index throws `Content block not found` | pinned binary `claude.exe` 0.3.278, literal `case"content_block_delta":{VF=!1;let ei=Rg[xs.index]` | Distinct dense indexes are required for correctness, not just tidiness |
| Existing stream spec pins `[DONE]` finalising once without `response.completed` (end_turn) | `responses-stream-translator.spec.ts:388-418` | That behaviour is kept and documented as a residual |
| Only `translation-proxy-base.ts` imports the Responses request translator, stream translator and collector. The package barrel exports `TranslationProxyBase`, `OpenAIResponseTranslator` and `translateAnthropicToOpenAI` only | `translation/index.ts:18-36`; `auth-providers/src/index.ts:66-74`; repo grep (no importer outside `translation/`) | New modules stay library-internal. No public API change |
| Responses-lane users: Codex (always), OpenCode for GPT models | `providers/codex/codex-translation-proxy.ts:130-132`; `libs/shared/src/lib/providers/entries/opencode-model-routes.ts:21,76-94`, `providers/opencode/opencode-translation-proxy.ts:68-72` | Items 2-6 affect Codex and OpenCode |
| `forwardToApi` users: Copilot, OpenRouter, Sakana, Custom OpenAI (all chat/completions), Local, OpenCode (all lanes), Codex | `providers/*/…-translation-proxy.ts` (`extends TranslationProxyBase`), e.g. `copilot-translation-proxy.ts:24,108`, `openrouter-translation-proxy.ts:41,102`, `sakana-translation-proxy.ts:34,107`, `custom-openai-translation-proxy.ts:89`, `local-model-translation-proxy.ts:37` | Item 1 affects every proxy provider, gated on the overflow classification |
| The Codex static list claims 128000 for all six models and omits `gpt-6-astra` and `gpt-5.6-sol`. It says "kept in sync with SUPPORTED_MODELS in codex-cli.adapter.ts" | `libs/shared/src/lib/providers/entries/codex-provider-entry.ts:13-74` (`:17`) | Item 7 |
| Codex models seen live: `gpt-6-astra` on `providerId=openai-codex`; `gpt-5.6-sol` covered by a ChatGPT subscription | `.ptah/specs/TASK_2026_406/02-full-log-forensics.md:168,179`; `libs/backend/auth-providers/src/lib/auth/model-resolver.spec.ts:133-148` | IDs to add |
| The live window comes only from the `/models` catalog (`contextLengthSource: 'provider'`). Static literals are never recorded as window evidence | `providers/codex/codex-auth.service.ts:322-336`; `provider-models.service.ts:202-224` | Static `contextLength` only affects display and ranking |
| `0` already means "unknown window": API-key catalog entries use it, and the UI hides the hint when <= 0 | `codex-auth.service.ts:339-347`; `libs/frontend/ui/src/lib/native/provider-model-picker/provider-model-picker.component.ts:475-481`; tier ranking flattens <= 0 (`model-tier-derivation.ts:94-98`) | Demote to `0` with no behaviour loss (all six are equal today, so ranking is unchanged) |
| `staticModels[0].id` is a default-model fallback | `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts:1614`; `auth/workspace-provider-profile-resolver.ts:493` | `gpt-5.4` must stay first; append new IDs |
| Static IDs filter platform discovery for Codex | `libs/backend/rpc-handlers/src/lib/handlers/provider-rpc.handlers.ts:276-280` | Adding IDs widens the match set (desired) |
| Localhost base URLs drop the `'user'` tier | `libs/shared/src/lib/utils/auth-env.utils.ts:8-38`; `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:1221-1229` | Behaviour kept; disclosure added |
| A guard spec reads the builder source and requires the literal `settingSources: includesUserSettingSource(` and no localhost literal | `libs/backend/output-styles/src/lib/output-style-activation.resolver.spec.ts:181-200` | Disclosure must not restructure that expression |
| Existing chat-chip notice channel (`SessionMcpNotice`) with a closed code union mirrored in a schema and in the frontend renderer | `libs/shared/src/lib/types/messages/session-mcp-status.ts:64-100`; `libs/shared/src/lib/types/messages/schemas.ts:253-254`; `libs/frontend/chat/src/lib/components/molecules/mcp-status-chip.component.ts:73-74,180-210` | Considered for item 8 (Decision 8) |
| Real-SDK child-process probe pattern (ESM SDK loaded via `node --input-type=module`, pinned-version check, `findPinnedSdk` walking `node_modules`) | `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry-auto-compact-argv.spec.ts:82-148`; `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.auto-compact-argv.spec.ts` | Integration test reuses this shape but lets the SDK spawn the real CLI |
| Proxy spec harness: `FakeTranslationProxy` with `protocol` / `forceResponsesStream` knobs and a real upstream HTTP server | `translation-proxy-base.spec.ts:32-101`, `:630-760`, `:1039-1125` | Unit and HTTP-level tests extend it |
| Harness-sync Codex target: skills in `{ws}/.agents/skills`, commands **unsupported** (home-only upstream), agents `{ws}/.codex/agents/*.toml`, MCP `~/.codex/config.toml` | `libs/backend/harness-sync/src/lib/targets/rival-targets.ts:13,22-24,62-64,110-122` | Ownership doc facts for path B |
| Native adapter: Codex SDK `thread.runStreamed()`; no mid-turn steer or interrupt; curated static model list | `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.ts:1-6,482-490,495-534` | Ownership doc facts for path B |
| Path C: caller tools never reach `chat:start` (`options: {}`); prompt flattened into `<system>`/`<user>`; `tool_result` dropped; `autoApprove` declared, never read; `skill__` placeholders with empty schemas | `apps/ptah-cli/src/services/proxy/anthropic-proxy.service.ts:89,493,674-682`; `anthropic-sse-translator.ts:21,175`; `workspace-mcp-collector.ts:197-213` | Ownership doc facts for path C (fixes owned by TASK_2026_564) |
| Commit scopes include `auth-providers`, `agent-sdk`, `shared`, `cli-agent-runtime`, `cli`, `docs` | `.commitlintrc.json` `scope-enum` | Commit convention |

### Verified SDK contract: what makes the installed CLI compact and retry

All from the pinned binary `@anthropic-ai/claude-agent-sdk-win32-x64@0.3.278/claude.exe` (sha512 = `package-lock.json:1860`). `sdk.mjs` has no matcher; `grep -c "prompt is too long" sdk.mjs` = 0. The CLI binary is the consumer.

1. Predicate. Literal: `function QQ(e){let n=e.toLowerCase();return n.includes("prompt is too long")||n.includes("input is too long for requested model")}`. It is case-insensitive and matches a substring anywhere.
2. Thrown-error check. Literal: `function mA(e){if(!(e instanceof Error))return!1;return QQ(e.message)||ju(e.message,"prompt_too_long")}`. It does not look at HTTP status.
3. Conversion. Literal: `if(mA(e)||uD(e))return Eo({content:pI,error:"invalid_request",errorDetails:e.message})` with `var pI="Prompt is too long"`. The error becomes an assistant API-error message whose text starts with `Prompt is too long`.
4. Reactive compact trigger. Literal: `function xme(e){if(!e.isApiErrorMessage)return!1;...r.text.startsWith(pI)}`, used in the query loop (`Se=H?.type==="assistant"&&H.isApiErrorMessage&&xme(H)` leads to the abort-controller retry path) and by `Reactive compact: ...` (`if(xme(he))return{ok:!1,reason:"prompt_too_long",tokenGap:hft(he)}`).
5. Token gap. Literal: `F6e(e){let n=e.match(/prompt is too long[^0-9]*(\d+)\s*tokens?\s*>\s*(\d+)/i)`. With the numbers present the CLI knows how far over the limit it is. Without them `tokenGap` is `undefined` and the retry still happens.
6. Status classifier (telemetry and routing). Literal: `function Yun(e,n,r){if(e===413)return JQ(n)||QQ(n)?"prompt_too_long":void 0;if(e!==400)return;...if(QQ(n))return"prompt_too_long"`.
7. Error message shape, for both JSON and SSE:
   - The bundled Anthropic client builds `APIError.message` via `static makeMessage(e,t,r){let n=t?.message?...:t?JSON.stringify(t):r;if(e&&n)return`${e} ${n}``. For a body `{type:'error',error:{...}}`, `t.message` is undefined, so the message is `"<status> " + JSON.stringify(body)`, which contains the inner message.
   - SSE literal: `if(i.event==="error"){let d=wt(i.data)??i.data,p=d?.error?.type;throw new xt(void 0,d,void 0,e.headers,p)}`. A mid-stream `event: error` throws the same class with no status, and its message is `JSON.stringify(data)`.

**Contract the proxy must emit.** The body is `{"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long: <actual> tokens > <limit> maximum"}}`.

- Before headers are sent, send it as HTTP `400` JSON.
- After `message_start` has been written, send it as an SSE `event: error` frame.
- When the upstream gives no numbers, use `prompt is too long: the request exceeds the model's context window`.

The Anthropic-native message format `prompt is too long: N tokens > M maximum` satisfies both `QQ` and `F6e`.

### Which upstream shapes count as overflow

| Shape | Status | Evidence |
| --- | --- | --- |
| HTTP 400 JSON `{"error":{"code":"context_length_exceeded",...}}` (OpenAI error envelope) | Verified: 400 on overflow when `truncation` is disabled (the proxy never sets `truncation`) | `openai@5.23.2` `resources/responses/responses.d.ts:422-430` ("the request will fail with a 400 error") |
| `code: "context_length_exceeded"` on `response.failed.response.error` or an `error` stream event | Verified the pinned Codex client knows the code, in the same string table as `response.failed` / `response.incomplete` event names. Exact dispatch logic is an Assumption | pinned binary `@openai/codex@0.155.1-win32-x64` `codex.exe`, literal `context_length_e` next to `response.incompl`; display string `context window exceeded` |
| Message patterns (status 400/413 only): `/exceeds the context window/i`, `/maximum context length/i`, `/context[_ ]length[_ ]exceeded/i`, `/prompt is too long/i`, `/input is too long/i` | Assumption, conservative by construction (no generic "too many tokens", which TPM throttles also use). Resolve with live probe P7 in `phase-3-options.md` | Chat Completions phrasing ("This model's maximum context length is N tokens. However, your messages resulted in M tokens") is external knowledge. Anthropic-native `prompt is too long` is covered by `QQ` |
| ChatGPT backend `{"detail": "..."}` bodies | Assumption: scanned with the same message patterns | P7 |

Numbers are extracted only from `prompt is too long: (\d+) tokens > (\d+)` and `maximum context length is (\d+) tokens.*?resulted in (\d+) tokens`. No other upstream text is ever copied into the client message.

## Architecture decision

- Chosen approach: put every new translation rule in three new pure modules next to the existing translators, and change the three consumers (stream translator, collector, proxy base) to call them.
  - `responses-tool-output-images.ts` (added in round 1) downgrades image tool outputs for providers without evidence.
  - `responses-error-mapping.ts` classifies upstream failures and terminal states into Anthropic outcomes.
  - `responses-tool-names.ts` holds the tool-name guard and its reverse map.
  - Streaming and non-streaming parity comes from both paths calling the same classifier with the same inputs, not from two hand-kept copies.
- Rationale:
  - The translators are already "stateless, exported individually for testability" (`responses-request-translator.ts:17-19`), and helpers live beside them (`translation-proxy-helpers.ts`).
  - One classifier gives parity by construction.
  - A post-pass guard keeps the TASK_2026_562 rebase to zero lines for item 3.
- Rejected alternatives:
  - (a) Mangle names inside `translateToolsForResponses` and `translateAssistantMessageToResponses`. This touches two more functions in the 562-owned file and needs a map threaded through `translateAnthropicToResponses`, which W2.4 rewrites.
  - (b) Put overflow detection in each provider's `getUpstreamErrorMessage` override. Seven subclasses would duplicate it, and it still returns `api_error`, which the base hard-codes at `:1022`.
  - (c) Reuse the collector's zod snapshot translator for the JSON path. The collector's validation is stricter than the JSON path's; for example it rejects a `function_call` with no `call_id` (`responses-stream-collector.ts:52`), which would change JSON behaviour beyond this task. Only the terminal classification is shared.
  - (d) A stateful per-session name map. Deterministic hashing makes it unnecessary and survives resume and process restart.
- Assumptions (each has a resolving check):
  - A1. Overflow message patterns: resolved by P7 (not authorized here), with conservative defaults.
  - A2 (retired in round 1). Array `function_call_output.output` is sent **only** to Codex, where the pinned client provides the evidence. Every other Responses provider (OpenCode) gets an explicit text placeholder, so no unverified wire format is ever sent (component 7).
  - A5. The pinned CLI runs reactive compaction when it receives a prompt-too-long error under the SDK's default options. The gate functions around `xYn(e){return!e.hasAttempted&&...&&Gf()&&aU()&&!e.aborted}` are minified and unverified. Check: the first run of component 11 S6. If no `compact_boundary` appears, S6 is reported as overflow propagation only (see component 11).
  - A3. The pinned CLI's reaction to an unknown `/command` in SDK `-p` mode. The literals `Unknown command: /` and `cmd_unknown` exist, but whether it is local rejection or model forwarding must be observed and pinned by the integration test.
  - A4. The CLI tolerates names like `mcp__…` over 64 characters in its own tool list. It must, since it already sends them. The test pins the round trip.
- Effect on existing code:
  - Replaced: the `default: return []` swallow of terminal and error events, the base's silent `res.end()` on truncated streams, the generic `api_error` for overflow bodies, the text-only tool-result mapping, the fabricated static windows, and the block-index arithmetic.
  - Left alone: the Chat Completions translators (`request-translator.ts`, `response-translator.ts`), `[DONE]`-only streaming finalisation (spec-pinned), 401/429 handling, usage accounting (`translateResponsesUsage`), `settingSources` behaviour, and all compaction code.

## Component specifications

### 1. Upstream error classifier (new module)

- Purpose: turn an upstream failure or terminal state into one Anthropic outcome, with no I/O and no logging.
- Responsibilities:
  - `AnthropicErrorMapping { status: 400 | 429 | 502; type: 'invalid_request_error' | 'rate_limit_error' | 'api_error'; message: string }`.
  - `classifyUpstreamHttpError(status: number, rawBody: string): AnthropicErrorMapping | undefined`. Returns a mapping **only** for context overflow; `undefined` keeps today's path byte-identical. It considers statuses 400 and 413 only. It parses the body with a try/catch and reads `error.code`, `error.message`, `message`, `detail`. It never throws.
  - `classifyResponsesError(code: unknown, message: unknown): AnthropicErrorMapping`, for `response.failed.response.error` and the `error` event. Callers must pass both payload shapes:
    - the standalone Responses `error` event carries **top-level** `code` / `message` (`openai@5.23.2 responses.d.ts:1252-1273`);
    - some gateways nest them as `error.{code,message}`. Callers read top-level first, then nested.
    - `context_length_exceeded` or an overflow message becomes prompt-too-long (400, `invalid_request_error`).
    - `rate_limit_exceeded` becomes 429 `rate_limit_error` "Upstream rate limit exceeded".
    - Codes in the installed `ResponseError.code` enum that describe the request (`invalid_prompt`, `invalid_image*`, `image_*`, `unsupported_image_media_type`, `empty_image_file`, `failed_to_download_image`, `image_file_not_found`; `openai@5.23.2 responses.d.ts:1239-1248`) become 400 `invalid_request_error` "Upstream rejected the request (<code>)".
    - Everything else, including a missing code, becomes 502 `api_error` "Upstream Responses request failed (<code or 'unknown'>)".
  - `classifyResponsesTerminal(eventName, response, toolArgs)` returns `{ kind: 'stop'; stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' } | { kind: 'error'; mapping }` per the terminal table below.
    - The caller passes `hadToolUse` and `toolArgs: readonly string[] | undefined`. `toolArgs` holds the final argument strings of every function call. The collector and JSON path take them from `response.output`. The streaming path takes them from `response.output` when present, else from its received-argument accumulator (component 3).
    - The shared helper `isCompleteToolArguments(args: unknown): boolean` is true when the value is a string that `JSON.parse`s to a non-array object. Components 3, 4 and 6 use it.
  - **Precedence rule (one rule, all three paths).** When status is `incomplete`, check tool input **before** mapping the stop reason and before any content translation. If any function call's arguments fail `isCompleteToolArguments`, the outcome is the `upstream_incomplete` error, **whatever the incomplete reason** (`max_output_tokens`, `content_filter`, other, missing). This matches the retained collector rule, which rejects malformed args for any incomplete status (`responses-stream-collector.ts:55-61`). It also forbids the JSON path's `safeJsonParse` `{}` fabrication (`translation-proxy-base.ts:1202`) on incomplete responses. For `completed` responses the per-path handling is unchanged.
  - `promptTooLongMessage(actual?, limit?)` builds the exact contract strings from the SDK contract section.
- Terminal table (the single source of truth for both paths):

| Upstream | Outcome | Non-stream HTTP | Stream SSE |
| --- | --- | --- | --- |
| `response.completed`, status `completed` | stop `tool_use` / `end_turn` (unchanged) | 200 | `message_delta` + `message_stop` |
| `response.incomplete`, **any** reason, any tool args incomplete (precedence rule, checked first) | error: 502 `api_error` `upstream_incomplete: Upstream response ended with incomplete tool input` (the existing collector text, `responses-stream-collector.ts:10` rendered by `translation-proxy-base.ts:770`) | 502 | `event: error` same type/message |
| `response.incomplete`, reason `max_output_tokens`, all tool args complete (or no tools) | stop `max_tokens`, usage forwarded | 200 | `message_delta(max_tokens)` + stop |
| `response.incomplete`, reason `content_filter`, all tool args complete (or no tools) | stop `refusal`, usage forwarded | 200 | `message_delta(refusal)` + stop |
| `response.incomplete`, other or missing reason, all tool args complete | error 502 `api_error` `upstream_incomplete: Upstream Responses response incomplete` | 502 | `event: error` |
| `response.failed` (`response.error.{code,message}`) / standalone `error` (top-level `code`, `message`; nested `error.{code,message}` fallback) | `classifyResponsesError(code, message)` | mapping.status | `event: error` mapping.type/message |

- `refusal` choice: the pinned CLI handles `stop_reason==="refusal"`. Literal: `Mr=Hn.stop_reason==="refusal"`. Refusal fallback runs only when a fallback model is armed (`refusalFallbackModel` / `serverRefusalFallback`), and Ptah arms none (grep `refusalFallback` in `libs/backend/agent-sdk/src` finds nothing).
- Verified contracts and entry points: `ResponseFailedEvent`, `ResponseIncompleteEvent`, `ResponseErrorEvent{code,message}`, `IncompleteDetails.reason: 'max_output_tokens'|'content_filter'` (`openai@5.23.2 responses.d.ts:1277-1290,1799-1812,1252-1273,450-455`).
- Dependencies: none beyond TypeScript (optionally zod, already used in the collector, `responses-stream-collector.ts:2`). No imports from the proxy base, so there is no cycle.
- Integration points: components 2, 3, 4.
- Failure behaviour: malformed input yields `undefined` (HTTP) or the generic 502 mapping (stream). Never throws.
- Quality requirements:
  - Security: messages contain only fixed text, sanitized codes (`/^[a-z0-9_]{1,64}$/` or omitted) and parsed integers. No upstream text is copied, which preserves the OpenCode no-raw-payload rule (`opencode-translation-proxy.ts:82`).
- Verification seam: pure unit spec.
- Files:
  - CREATE `D:\projects\ptah-extension-task-408\libs\backend\auth-providers\src\lib\translation\responses-error-mapping.ts`
  - CREATE `D:\projects\ptah-extension-task-408\libs\backend\auth-providers\src\lib\translation\responses-error-mapping.spec.ts`

### 2. HTTP overflow mapping in the shared forwarding lifecycle (Phase 1, item 1)

- Purpose: an upstream overflow reaches the SDK as the prompt-too-long contract, so the CLI compacts and retries instead of stalling. TASK_2026_406 forensics: `02-full-log-forensics.md:165-183` shows an auto-compaction on Codex followed by 180 s of no activity; the report labels that causal link as inference, and `:245` infers the proxy "can stall silently".
- Responsibilities:
  - In `TranslationProxyBase.forwardToApi`, inside the `statusCode >= 400` `end` handler (`translation-proxy-base.ts:1012-1024`), call `classifyUpstreamHttpError(statusCode, errorBody)` first.
  - If a mapping comes back, log `warn` `${logPrefix} [${requestId}] upstream ${statusCode} classified as context overflow` (no body) and send `sendErrorResponse(res, mapping.status, mapping.type, mapping.message)`.
  - Otherwise run the existing lines unchanged.
  - `finishTiming('upstream-error')` is unchanged.
- Verified contracts: `sendErrorResponse` (`translation-proxy-helpers.ts:88-107`); `getUpstreamErrorMessage` (`translation-proxy-base.ts:593-595`) stays the non-overflow path.
- Dependencies: component 1.
- Integration points: every lane of every subclass (compatibility section).
- Failure behaviour: a classifier miss falls back to today's generic behaviour.
- Verification seam: `translation-proxy-base.spec.ts` over HTTP with the `FakeTranslationProxy` upstream.
- Files: MODIFY `D:\projects\ptah-extension-task-408\libs\backend\auth-providers\src\lib\translation\translation-proxy-base.ts` (`forwardToApi` only); MODIFY `…\translation\translation-proxy-base.spec.ts`

### 3. Streaming terminal and error handling (Phase 1, item 2, streaming half)

- Purpose: every Responses stream ends in exactly one Anthropic terminal: `message_delta` + `message_stop`, or `event: error`.
- Responsibilities, in `ResponsesStreamTranslator` (`responses-stream-translator.ts`):
  - **SSE frame state across chunks (delivery prerequisite).** Today `processChunk` keeps `currentEventType` in a local variable, reset on every call (`:186`), and dispatches each `data:` line on its own (`:194-214`). A frame split after `event: response.failed\n`, whose JSON omits the redundant `type`, therefore loses its event name and never reaches the new handlers.
    - Make the pending event name and the pending `data` lines instance fields, next to `lineBuffer` (`:130`).
    - Dispatch on the blank line that ends the frame, joining multiline `data` with `\n`. That is SSE framing, the same rule the collector already applies (`responses-stream-collector.ts:126-159`; split-frame spec `responses-stream-collector.spec.ts:147-152`).
    - Handle CR/CRLF line ends as the collector does (`:167-173`).
    - `[DONE]` stays a `data` payload recognised at dispatch, so `responses-stream-translator.spec.ts:388-418` behaviour is unchanged.
    - Existing fixtures all end frames with `\n\n` (`responsesSse` helper `:36-41`), so today's specs keep passing.
    - A frame still pending at EOF is not dispatched. `terminateTruncated()` reports it, which matches the collector's "SSE dispatch requires a blank line" rule (`:187-188`).
  - **Received-argument accumulator (moved into B1 from component 6).** `ActiveToolCall` gains `receivedArgs: string`, appended on every non-empty `function_call_arguments.delta` whether or not the block has started. Completed calls stay recorded (`closedToolArgs`) after `output_item.done` deletes the active entry (`:437`). B1 needs only this accumulator for the incomplete check; emission logic stays as today until component 6.
  - `handleEvent` (`:227-251`) gains `response.incomplete`, `response.failed` and `error`. All three respect `finalized` (`:231`) and set it. `ResponsesStreamEvent` (`:36-54`) gains optional top-level `code`, `message`, `error` fields. `ResponsesCompletedData` (`:67-77`) gains `error` and `incomplete_details`.
  - `response.incomplete`:
    - Apply the precedence rule first. `toolArgs` comes from `event.response.output` function calls when present, else `receivedArgs` of active plus closed calls. If any are incomplete, emit the `upstream_incomplete` error.
    - Otherwise parse usage with `translateResponsesUsage`, report it via `onUsage` (as `handleResponseCompleted` does at `:463-478`, including its invalid-usage error branch), and emit final events with the mapped stop reason.
  - `response.failed` / `error`:
    - `response.failed` reads `response.error.{code,message}`; the standalone `error` event reads top-level `code` / `message`, then nested `error.*`.
    - Emit `sseEvent('error', {type:'error', error:{type, message}})` and call `onTranslationError()`, which marks timing `invalid-response`; see Risks.
    - Do not emit `content_block_stop` or `message_delta`, matching the existing usage-error branch at `:466-477`.
  - `emitFinalEvents` (`:487-523`) takes an optional `stopReason` override. The default stays `tool_use` / `end_turn` (`:512`).
  - New public `terminateTruncated(): string[]` returns `[event: error api_error "Upstream Responses stream ended before completion"]` and finalises. It returns `[]` if already finalised.
- Responsibilities, in `TranslationProxyBase.handleResponsesStreamingResponse` (`translation-proxy-base.ts:1112-1158`):
  - On `end`, if `!translator.isFinalized()`, call `onTranslationError()`, write `translator.terminateTruncated()`, then `res.end()`.
  - On upstream `error`, write `terminateTruncated()` if `!res.destroyed`, then `res.end()`.
- Verified contracts: the SSE error frame shape is consumed by the pinned client (SDK contract item 7). `MessageStream` from `@anthropic-ai/sdk` is already used in specs (`responses-stream-translator.spec.ts:29,97-104`).
- Dependencies: component 1.
- Failure behaviour: invalid usage on `incomplete` produces the existing `Invalid upstream Responses usage` error. Anything after finalisation is ignored.
- Verification seam: translator unit spec (event lists), `MessageStream.fromReadableStream(...)` rejection/acceptance, and a proxy-base HTTP spec with `stream: true`. The spec must also cover split frames and multiline data (see the test table), feeding `processChunk` one byte at a time as well as split exactly after the `event:` line.
- Batch: all of component 3, including frame state and the accumulator, is in **B1**. Without frame state the Phase 1 events are not reliably delivered, and without the accumulator the incomplete check has no fallback. B1 therefore does not depend on component 6.
- Files: MODIFY `…\translation\responses-stream-translator.ts`, `…\translation\responses-stream-translator.spec.ts`, `…\translation\translation-proxy-base.ts` (`handleResponsesStreamingResponse`), `…\translation\translation-proxy-base.spec.ts`

### 4. Non-streaming terminal handling (Phase 1, item 2, non-streaming half)

- Purpose: the forced-SSE collector and the plain JSON path give the same outcome as component 3 for every row of the terminal table.
- Responsibilities:
  - `ResponsesStreamError` (`responses-stream-collector.ts:5-14`): add code `'upstream_failed'` and an optional readonly `mapping?: AnthropicErrorMapping`. Existing codes and messages are unchanged.
  - Collector validation boundary. `eventSchema` (`responses-stream-collector.ts:33-36`) currently declares only `type` and `response`, and zod strips unknown keys, so the standalone `error` event's `code` / `message` never reach dispatch.
    - Add `code: z.string().nullish()`, `message: z.string().nullish()` and `error: z.object({ code: z.string().nullish(), message: z.string().nullish() }).passthrough().nullish()`.
    - Add `error: z.object({ code: z.string().nullish(), message: z.string().nullish() }).nullish()` to `responseSchema` (`:23-32`) for `response.failed`.
    - Keep all fields optional: bare `{"type":"error"}` / `{"type":"response.failed"}` frames must still reject (spec `:161-167`).
  - Collector `dispatch` (`:126-149`):
    - `error` throws `new ResponsesStreamError('upstream_failed', classifyResponsesError(event.code ?? event.error?.code, event.message ?? event.error?.message))`.
    - `response.failed` reads `response.error` from the leniently parsed snapshot. Use `safeParse`: a failed snapshot may omit `output`, and must still classify rather than become `invalid_response`.
    - `response.incomplete` accepts every reason at dispatch; the terminal decision moves to `onEnd`.
  - `onEnd` (`:178-211`) runs the precedence rule before `collectOutputContent`:
    - An incomplete snapshot with any incomplete tool args gives `upstream_incomplete`, the same code and message as today.
    - Otherwise `classifyResponsesTerminal` gives the stop reason (`max_tokens` / `refusal`) or the `upstream_failed` 502 incomplete mapping for other reasons.
    - `responseStopReason` (`:78-81`) is replaced by that call.
  - Base collector catch (`translation-proxy-base.ts:762-773`): when `error.mapping` is set, send `mapping.status/type/message`. Otherwise keep `502 api_error ${code}: ${message}`.
  - `handleResponsesNonStreamingResponse` (`:1164-1256`), after `JSON.parse`:
    - `status === 'failed'` sends `classifyResponsesError(body.error?.code, body.error?.message)` via `sendErrorResponse` and does not call `onUsage`.
    - `status === 'incomplete'` applies the precedence rule to `output[].arguments` **before** building `content`. Incomplete args of any reason send the 502 `upstream_incomplete` mapping, never a fabricated `{}` (`:1202`). Otherwise `classifyResponsesTerminal` gives the stop reason.
    - Existing success behaviour (lenient ids, `safeJsonParse`) is unchanged for `completed` and a missing status.
- Verified contracts: collector error class and specs `responses-stream-collector.spec.ts:49-100,154-167`; base 502 specs `translation-proxy-base.spec.ts:1039-1125`.
- Dependencies: component 1.
- Failure behaviour: unchanged 502/500 for malformed payloads; mapped statuses for classified failures.
- Verification seam: collector unit spec plus proxy-base HTTP spec with `stream: false` in both modes (`forceResponsesStream` true and false). Fixtures cover both error payload shapes: standalone top-level `{type:'error', code, message}` and nested `response.failed.response.error`. They also include split-frame and multiline-data variants of `response.failed`, `response.incomplete` and `error`.
- Files: MODIFY `…\translation\responses-stream-collector.ts`, `…\translation\responses-stream-collector.spec.ts`, `…\translation\translation-proxy-base.ts` (collector catch plus `handleResponsesNonStreamingResponse`), `…\translation\translation-proxy-base.spec.ts`

### 5. Tool-name guard (Phase 2, item 3)

- Purpose: any tool name that breaks OpenAI's `^[a-zA-Z0-9_-]{1,64}$` is sent upstream under a deterministic compliant alias and returned to the SDK under its original name.
- Responsibilities (new module):
  - `guardResponsesToolNames(request: OpenAIResponsesRequest): { request: OpenAIResponsesRequest; toOriginalName: (upstream: string) => string }`. Pure; returns a new object and never mutates its input.
  - Alias rule:
    - A valid name is kept unchanged.
    - Otherwise the alias is `${sanitized.slice(0, 53)}_${sha256(original).hex.slice(0, 10)}` (at most 64 characters), where `sanitized = original.replace(/[^a-zA-Z0-9_-]/g, '_')`. Use `node:crypto` `createHash('sha256')`.
  - Scope: rewrite `request.tools[].name` and every `input[]` item with `type === 'function_call'` (history replay after resume). The same function applies to both, so historical pairs stay consistent with no state.
  - `toOriginalName` looks up the per-request reverse map. An unknown upstream name passes through unchanged, so the CLI answers `No such tool available: X` (pinned binary literal `No such tool available:`).
  - Collision (two originals producing one alias, or an alias equal to another tool's original): throw `ResponsesToolNameCollisionError`.
- Plumbing, in `translation-proxy-base.ts`:
  - `handleMessages` Responses branch (`:507-510`): call the guard right after `translateAnthropicToResponses`. On collision send `400 invalid_request_error` "Tool name collision after Responses name normalization: <alias>" before any upstream call.
  - `forwardToResponsesApi` (`:702-795`, including the `retryFn` recursion) carries `toOriginalName` into the three handlers:
    - `ResponsesStreamTranslator` constructor: new trailing optional parameter `resolveToolName = (n) => n`, applied where names enter at `:312`, `:359`, `:371`, and in component 6's done paths.
    - `collectResponsesStream`: new trailing optional parameter, applied in `collectFunctionCall` (`responses-stream-collector.ts:63`).
    - `handleResponsesNonStreamingResponse`: applied to the name at `:1201`.
- Dependencies: the `OpenAIResponsesRequest` / `ResponsesFunctionCallItem` types (`responses-request-translator.ts:58-117`), read-only.
- Failure behaviour: collision gives a 400 before forwarding. No other failure mode.
- Quality requirements:
  - Performance: one pass over tools and input, O(n).
  - Security: names are not secrets; the alias uses a hash, not truncation alone, so it cannot be predicted into a collision by accident.
- Verification seam: unit spec on the guard; translator, collector and JSON unit specs with a resolver; proxy-base HTTP spec proving a 70-character MCP-style name round-trips on both the streaming and non-streaming paths and in replayed history.
- Files: CREATE `…\translation\responses-tool-names.ts`, `…\translation\responses-tool-names.spec.ts`; MODIFY `…\translation\translation-proxy-base.ts`, `…\translation\responses-stream-translator.ts`, `…\translation\responses-stream-collector.ts` (plus their specs).

### 6. Stream tool-call state: arguments from `.done` and block-index allocation (Phase 2, items 4 and 6)

- Purpose: each tool call gets its own dense, monotonically increasing block index and exactly one copy of its arguments.
- Responsibilities (`responses-stream-translator.ts`):
  - Block indexes:
    - Replace `blockIndex` arithmetic with an allocator: `nextBlockIndex` plus an open-text-block index.
    - An index is allocated **only when `content_block_start` is emitted**: text start at `:264-273`, tool start at `:320-335` and `:374-400`.
    - Remove the rewind at `:435` and the pre-start assignment at `:356-367`.
    - Sequential streams must yield exactly today's indexes (text 0, tool 1, text 2, …), as asserted by `responses-stream-translator.spec.ts:274-386`.
  - Argument state per call is split in two:
    - `receivedArgs: string`, the argument text received from upstream, introduced in B1 by component 3;
    - `emittedLength: number`, how many characters of `receivedArgs` have already gone out as `input_json_delta`.
    - Invariant: the text emitted to Anthropic is always a prefix of `receivedArgs`.
    - Invariant: emission happens only after that call's `content_block_start`.
  - Deltas (`:345-415`) always append to `receivedArgs`. If the block has started, emit the delta and advance `emittedLength`. If not, buffer: this replaces today's behaviour at `:401-412`, which drops pre-name deltas. Order for one delta event: append to `receivedArgs` once, adopt the name if the event carries one, then run a **single** start-if-needed-and-flush step. If this event starts the block, that flush emits the buffered text plus this delta once, with no separate per-delta emission; if the block had already started, it emits only this delta. Regression: buffered pre-name deltas followed by a delta that supplies the name and the last fragment give one complete input object in the installed `MessageStream`.
  - Start (from `added` with a name, a delta carrying a name, or a done carrying a name) emits `content_block_start`, then **flushes once**: a single `input_json_delta` of `receivedArgs.slice(emittedLength)` if it is non-empty, then advances `emittedLength`.
  - Done payloads: `response.function_call_arguments.done` (`{output_index, item_id, arguments}`, `openai@5.23.2 responses.d.ts:1492-1510`) and `response.output_item.done` with `item.arguments` (`:2939-2956`).
    - If `receivedArgs === ''`, set `receivedArgs = payload`.
    - If `receivedArgs` is non-empty, ignore the payload: the deltas are authoritative, and a differing payload is not merged.
    - Then, if the name is now known and the call has not started, start it (which flushes).
    - If the call has already started, flush the unemitted remainder.
    - Each character is emitted exactly once.
  - `output_item.done` for a call never seen via `added` or delta, but carrying `call_id` + `name`: start, flush, and stop, in that order.
  - `output_item.done` then emits `content_block_stop` for a started call. For a call that never got a name, emit nothing and keep its `receivedArgs` in `closedToolArgs` for the incomplete check.
- Dependencies: component 3's `receivedArgs` / `closedToolArgs` (B1); component 5's `resolveToolName` (same constructor, same batch B2).
- Failure behaviour: a done event for an unknown `output_index` with no name is ignored, as today's `added`-without-item is.
- Verification seam: translator unit spec plus the installed `MessageStream` accumulator (`@anthropic-ai/sdk/lib/MessageStream`, already imported at `responses-stream-translator.spec.ts:29`). The final message's `tool_use.input` must equal the parsed args in four cases:
  - (a) deltas only;
  - (b) done only;
  - (c) deltas plus a matching done, with no duplication;
  - (d) **delayed name**: `added` without a name, then deltas, then `output_item.done` supplying the name and the same arguments. The input is intact and emitted exactly once.

  Two interleaved calls must get distinct indexes and each input intact.
- Files: MODIFY `…\translation\responses-stream-translator.ts`, `…\translation\responses-stream-translator.spec.ts`

### 7. Tool-result image mapping (Phase 2, item 5)

- Decision (revised in round 1): the output format depends on how much evidence each provider has.
  - Codex: images go upstream as Responses `input_image` parts inside an **array** `function_call_output.output`.
  - Every other Responses provider (today OpenCode GPT routes, `opencode-model-routes.ts:76-94`) gets a **string** output with an explicit text placeholder per image.
  - Text-only results stay a plain `string` on all providers, byte-identical to today.
- Mechanism: the translator always builds the array when an image is present. A post-pass module applied in the proxy base downgrades arrays to placeholder strings unless the subclass declares support. That is the same shape as the tool-name guard (component 5).
- Why a post-pass rather than a translator flag: a flag on `translateToolResultToFunctionCallOutput` cannot be reached without threading an option through its callers:
  - `translateUserMessageToResponses` (`:272-318`, call at `:303`);
  - `translateMessagesToResponsesInput` (`:220-244`);
  - `translateAnthropicToResponses` (`:127-161`), the function TASK_2026_562 W2.4 rewrites.

  The post-pass keeps the capability decision entirely out of the 562-owned file.
- Evidence, and why neither universal choice wins:
  - Pro array: the pinned Codex client 0.155.1, the reference client for this endpoint, serializes `FunctionCallOutputContentItem` as an internally tagged enum with variants `InputText`, `InputImage` (2 fields), `InputAudio` and `EncryptedContent`. Pinned binary literals: `internally tagged enum FunctionCallOutputContentItem`, `struct variant FunctionCallOutputContentItem::InputImage with 2 elements`.
  - Against array: the only installed OpenAI types (`openai@5.23.2`, transitive through `exa-js`, `package-lock.json:24266`) declare `output: string` (`responses.d.ts:1554-1576,1980-2003`). Those types predate the feature and are not used by any Ptah code path.
  - A universal placeholder would throw away screenshots from Read, browser and MCP tools on Codex, where the format is evidenced.
  - A universal array would send an unverified wire format to OpenCode. No repo or pinned artifact shows OpenCode accepting it, and no probe is authorized.
- Responsibilities, translator (the two permitted locations only):
  - `ResponsesFunctionCallOutputItem.output` (`responses-request-translator.ts:67-71`) becomes `string | Array<ResponsesInputTextPart | ResponsesInputImagePart>`.
  - `translateToolResultToFunctionCallOutput` (`:391-416`) builds the array in block order:
    - text blocks become `input_text`;
    - images go through `resolveImageMediaType` into `input_image` `data:` URLs, the same resolution as `flattenToResponsesContentParts` (`:434-446`);
    - an unresolvable image becomes `input_text` `[image omitted: unsupported media type]`.
  - `is_error` prefixes `Error: ` on the first text part, or inserts an `input_text` `Error:` part when the first part is an image.
  - No other function in the file changes.
- Responsibilities, post-pass (new module `responses-tool-output-images.ts`):
  - `downgradeToolOutputImages(request: OpenAIResponsesRequest): OpenAIResponsesRequest`. Pure; returns a new object. Every `function_call_output` whose `output` is an array becomes a string:
    - `input_text` parts are kept as their text;
    - each `input_image` becomes `[image omitted: this provider does not accept images in tool results]`;
    - parts are joined with `\n`.
  - A result with only text parts cannot be an array (the translator emits a string for those), so text-only output is never touched.
- Responsibilities, proxy base and Codex:
  - `TranslationProxyBase` gains `protected supportsResponsesToolOutputImages(): boolean { return false; }`, the same override-hook pattern as `requiresResponsesStream` (`translation-proxy-base.ts:657-659`).
  - `handleMessages` Responses branch (`:507-510`), after `guardResponsesToolNames`: `if (!this.supportsResponsesToolOutputImages()) request = downgradeToolOutputImages(request)`.
  - `CodexTranslationProxy` overrides the hook to return `true` (`codex-translation-proxy.ts`, next to `requiresResponsesStream` `:134-139`), with a comment citing the pinned-client evidence.
  - The default is conservative: any future Responses provider gets placeholders until it opts in with evidence.
- Verification seam:
  - Request-translator unit spec: text-only unchanged (existing snapshot `:162`), image produces an array, unresolvable media produces a placeholder part, `is_error` with an image.
  - `responses-tool-output-images.spec.ts`: an array becomes the placeholder string; strings pass through deep-equal; the input object is not mutated.
  - **Codex and OpenCode are tested separately over HTTP**:
    - `codex-stream-parity.spec.ts` (real `CodexTranslationProxy` + fake `ICodexAuthService`, `:1-30`): a Messages request with an image `tool_result` makes the upstream body carry `output` as an array with `input_image`.
    - `opencode-translation-proxy.spec.ts` (real OpenCode proxy + upstream server, `:127-260`) with a GPT model routed to `responses`: the same request makes the upstream body carry a string `output` containing the placeholder and no `input_image`.
  - Integration S5 (Codex) observes the array end to end.
- Files:
  - MODIFY `…\translation\responses-request-translator.ts` (two locations above), `…\translation\responses-request-translator.spec.ts`
  - CREATE `…\translation\responses-tool-output-images.ts`, `…\translation\responses-tool-output-images.spec.ts`
  - MODIFY `…\translation\translation-proxy-base.ts` (hook + post-pass call)
  - MODIFY `D:\projects\ptah-extension-task-408\libs\backend\auth-providers\src\lib\providers\codex\codex-translation-proxy.ts` (override), `…\providers\codex\codex-stream-parity.spec.ts`, `…\providers\opencode\opencode-translation-proxy.spec.ts`

### 8. Codex static model list (Phase 2, item 7)

- Decision: demote the list to IDs-only fallback metadata. Every static `contextLength` becomes `0` ("unknown; the live `/models` catalog is the only window source"), and `gpt-6-astra` and `gpt-5.6-sol` are appended **after** the existing six so `staticModels[0]` stays `gpt-5.4`.
  - Replace the false sync claim at `codex-provider-entry.ts:17` with a comment that the list is display and discovery-filter fallback only, and that windows come from `codex-auth.service.ts` `listModels`.
  - `CODEX_DEFAULT_TIERS` is unchanged.
  - The native adapter's `SUPPORTED_MODELS` (`codex-cli.adapter.ts:502-509`) is left alone and listed as a known limit in the ownership doc.
- Why not "update the windows": no provider evidence in the repo supports a per-model static number. The catalog already supplies real windows (`codex-auth.service.ts:329-334`, recorded only with `contextLengthSource: 'provider'`, `provider-models.service.ts:214-224`). A new literal would go stale the same way.
- Compatibility: `0` is treated as unknown by the UI hint (`provider-model-picker.component.ts:477-478`) and by tier ranking (`model-tier-derivation.ts:95-98`, where all equal values give the same order as today). Static windows are never recorded as capacity evidence (`provider-models.service.ts:207`). Compaction is not touched.
- Verification seam: new shared spec plus existing specs that iterate the list (`libs/shared/src/lib/providers/provider-registry.spec.ts:398-410`, pricing `$0` not published under bare IDs, which now also covers the two new IDs).
- Files:
  - MODIFY `D:\projects\ptah-extension-task-408\libs\shared\src\lib\providers\entries\codex-provider-entry.ts`
  - CREATE `D:\projects\ptah-extension-task-408\libs\shared\src\lib\providers\entries\codex-provider-entry.spec.ts`
  - Pattern sibling: `opencode-provider-entry.spec.ts` in the same folder.

### 9. Disclosure of dropped user-tier settings (Phase 2, item 8)

- Decision: one `info` log at build time plus the ownership doc. No UI notice in this task.
- Justification:
  - The behaviour is intentional and applies to every localhost provider (Copilot, Codex, OpenRouter, Sakana, Custom, Local, OpenCode), not only Codex.
  - The existing chip channel has a closed code union mirrored in three places: `session-mcp-status.ts:71-72,99-100`, `schemas.ts:253-254`, `mcp-status-chip.component.ts:73-74,180-210`. Using it would add a shared-schema change and a frontend change outside this task's libraries, and would show a permanent chip on every proxied session.
  - The log plus doc is the cheapest honest option: it is visible in support logs and in the ownership doc that the code comments point to. Put a UI notice in `future-enhancements` if users report confusion.
- Responsibilities (`sdk-query-options-builder.ts` `build`):
  - Next to the existing `Building SDK query options` log (`:1110-1128`), when `!includesUserSettingSource(effectiveAuthEnv.ANTHROPIC_BASE_URL)` (`effectiveAuthEnv` is in scope from `:996`), log `info`: "[SdkQueryOptionsBuilder] Localhost translation proxy session: user-tier settings (~/.claude skills, commands, agents, hooks, output styles, settings.json) are not loaded; project (.claude/) and local tiers are. See TASK_2026_408 ownership.md."
  - The expression at `:1225-1229` must keep the literal `settingSources: includesUserSettingSource(`, and no localhost regex may be added (guard spec `output-style-activation.resolver.spec.ts:181-200`).
  - Add a 3-line comment there naming this as the host-loop entry point for path A.
- Failure behaviour: none. Logging only.
- Verification seam: `sdk-query-options-builder.spec.ts`. With a localhost base URL the info line is logged once; with a direct Anthropic or absent base URL it is not. `settingSources` is unchanged in both cases.
- Files: MODIFY `D:\projects\ptah-extension-task-408\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.ts`, `…\sdk-query-options-builder.spec.ts`

### 10. Ownership doc and entry-point comments (Phase 2, item 9)

- Doc: CREATE `D:\projects\ptah-extension-task-408\.ptah\specs\TASK_2026_408\ownership.md`, one table row plus limits per path. Every fact below is verified above.
  - A. Translation proxy (host-managed loop).
    - Entry points: `libs/backend/auth-providers/src/lib/translation/translation-proxy-base.ts` (the Codex subclass is `providers/codex/codex-translation-proxy.ts`); the host loop is the Claude Agent SDK session built by `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`.
    - Skills and commands come from project/local `.claude/` only; the user tier is dropped.
    - Limits:
      - stateless `store:false`, with no reasoning carry-over (`phase-3-options.md`);
      - `thinking` and `cache_control` stripped;
      - the Chat Completions lane has no tool-name guard or image-in-tool-result support;
      - `[DONE]`-only streams finish as `end_turn`;
      - no `tool_choice`.
  - B. Native Codex adapter.
    - Entry points: `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.ts` (Codex SDK threads), plus the harness-sync Codex target (`libs/backend/harness-sync/src/lib/targets/rival-targets.ts`).
    - Skills live in `{ws}/.agents/skills` (shared with Antigravity); commands are unsupported; agents are `{ws}/.codex/agents/*.toml`; MCP is `~/.codex/config.toml`.
    - Limits: no steer or interrupt; curated static model list.
  - C. CLI workspace proxy.
    - Entry point: `apps/ptah-cli/src/services/proxy/anthropic-proxy.service.ts`.
    - Limits: the TASK_2026_564 list (tools not forwarded, prompt flattened so `/commands` are not recognised, `tool_result` dropped, `autoApprove` unread, `skill__` placeholders not executable). Fixes are owned by TASK_2026_564_87a6.
- Comments: at most 5 lines each, naming the path, pointing to `.ptah/specs/TASK_2026_408/ownership.md`, and stating the path's main limit. Referencing task IDs from code is established practice (for example `sdk-query-options-builder.ts:243`, TASK_2026_197). Placement:
  - the header of `translation-proxy-base.ts`, in component 2/3's batch because it is the same file;
  - `sdk-query-options-builder.ts` at `settingSources` (component 9);
  - the header of `codex-cli.adapter.ts` (`:1-6`);
  - the header of `anthropic-proxy.service.ts` (`:1-42`).
- Verification seam: lint for the touched files; reviewer checks facts against the citations.
- Files: CREATE `ownership.md`; MODIFY `D:\projects\ptah-extension-task-408\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex-cli.adapter.ts` (comment only), `D:\projects\ptah-extension-task-408\apps\ptah-cli\src\services\proxy\anthropic-proxy.service.ts` (comment only). The translation-proxy-base and builder comments ride with components 3 and 9.

### 11. Integration test through the installed SDK (acceptance)

- Purpose: prove, with the real pinned `@anthropic-ai/claude-agent-sdk` `query()` **and its real CLI binary**, the real `CodexTranslationProxy` and a mocked upstream HTTP server, that:
  - a Skill call and a slash command work through the translation proxy with arguments forwarded;
  - an unknown slash command and an unknown tool are rejected or disclosed;
  - a long tool name round-trips;
  - an upstream overflow reaches the CLI as prompt-too-long and drives a real compaction (asserted via the SDK's `compact_boundary` message). If Assumption A5 fails, S6 proves overflow propagation only, and is reported as exactly that.
- Feasibility, verified:
  - (1) The SDK is ESM-only. The established pattern runs it in a child `node --input-type=module` process loaded by file URL, with a pinned-version assertion (`ptah-cli-registry-auto-compact-argv.spec.ts:82-148`).
  - (2) Without `spawnClaudeCodeProcess`, the SDK spawns the platform binary from its `optionalDependencies`. The installed set covers win32/linux/darwin (`package-lock.json:1812-1860`).
  - (3) The pinned binary honours `ANTHROPIC_BASE_URL`, `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` and `DISABLE_AUTOUPDATER` (54, 42, 17 and 8 literal hits respectively).
  - (4) `settingSources` is a public option (`sdk.d.ts:2151`). The `@anthropic-ai/sdk` package also exists in jest (`responses-stream-translator.spec.ts:29`).
  - Honest caveat: no existing spec launches the real binary. This one is the first, so cold start (a few seconds) sets the timeout. The scenario jest timeout is 120 s.
- Shape:
  - Spec file: CREATE `D:\projects\ptah-extension-task-408\libs\backend\auth-providers\src\lib\translation\translation-proxy.sdk.integration.spec.ts`, project `@ptah-extension/auth-providers`.
  - In the jest process: start a mock upstream `http.createServer` that speaks Responses SSE and records every request body. Start `new CodexTranslationProxy(createMockLogger(), fakeCodexAuth)`, where `fakeCodexAuth` returns `getApiEndpoint()` = mock origin, `getHeaders()` = `{}` and `ensureTokensFresh()` = `false`. The host is not `chatgpt.com`, so `requiresResponsesStream` is false and the SDK's own `stream: true` drives the streaming path.
  - Temp tree:
    - `{tmp}/project/.claude/skills/fixture-skill/SKILL.md` (frontmatter `name`/`description`, body `SKILL-MARKER-7f3 args=$ARGUMENTS`);
    - `{tmp}/project/.claude/commands/fixture-cmd.md` (body `CMD-MARKER-91c $ARGUMENTS`);
    - `{tmp}/home` for `HOME`/`USERPROFILE`/`CLAUDE_CONFIG_DIR`.
  - The child runs `query({ prompt, options })` with:
    - `cwd` = the project;
    - `model: 'gpt-5.4'`;
    - `settingSources: ['project','local']`, mirroring a proxied session;
    - `permissionMode: 'bypassPermissions'`, `allowDangerouslySkipPermissions: true`, `maxTurns: 4`;
    - `env` = `ANTHROPIC_BASE_URL` = proxy URL, `ANTHROPIC_API_KEY` = `test-key`, plus the three isolation env vars above.
  - The child prints every SDK message as JSON lines; the parent asserts on them and on the recorded upstream bodies.
  - The mock upstream scripts by content: a request carrying a scenario marker gets that scenario's scripted reply, and any other request (side queries) gets plain text `ok`. It never errors on unexpected requests.
- Scenarios (all MOCKED upstream; real SDK, CLI and proxy; no live provider):
  - S1 Skill:
    - Turn 1 asserts `tools[]` contains `Skill` and returns a `function_call` named `Skill`, with args built from the advertised `Skill` parameters schema (`skill: 'fixture-skill'`, the args field set to `alpha beta`). Reading the schema from the request avoids hard-coding an unverified input shape.
    - Turn 2's upstream body must contain `SKILL-MARKER-7f3` and `alpha beta`, plus a `function_call_output` whose `call_id` equals turn 1's.
    - The final SDK `result` is `success`.
  - S2 Slash command: prompt `/fixture-cmd hello world`. The first upstream body contains `CMD-MARKER-91c hello world`.
  - S3 Unknown slash command: prompt `/no-such-cmd x`. Pin the observed behaviour (Assumption A3). Expected: local rejection with `Unknown command: /no-such-cmd` in SDK output and no upstream body containing an expansion. If the CLI instead forwards the literal text, assert the literal `/no-such-cmd x` reaches upstream unexpanded, and record that in `ownership.md` as a documented limit. Either way it is disclosed, never silently expanded.
  - S4 Unknown tool: turn 1 returns `function_call` `NoSuchTool`. Turn 2's body has `function_call_output.output` starting `Error:` and containing `No such tool available` (pinned binary literal).
  - S5 Long name round-trip: an in-process SDK MCP server (`createSdkMcpServer` + `tool`, exported by the pinned SDK, `sdk.d.ts:543,9228`) whose server and tool names together exceed 64 characters.
    - The upstream `tools[]` shows the alias, never the original.
    - Turn 1 calls the alias with `{"value":"42"}`; the in-process handler receives `value: "42"`.
    - Turn 2's replayed history uses the same alias.
    - If the handler returns an image content block, turn 2 shows `input_image` in the `function_call_output` (component 7).
  - S6 Overflow triggers compaction, then a successful retry. This is also the one **executed SDK resume** in the suite.
    - Seed: query A runs three scripted turns. Each user prompt carries marker `S6-SEED-n` and about 4 KB of filler; each gets a text reply. Capture `session_id` from A's `result` message.
    - Target: query B uses `resume: <session_id>` (`sdk.d.ts:1991`) with prompt `S6-TARGET`. Upstream requests are matched to their role **by content**, never by order:
      - (i) The first request containing `S6-TARGET` **and** `S6-SEED-1` proves resume replayed history. It returns HTTP 400 `{"error":{"code":"context_length_exceeded","message":"Your input exceeds the context window of this model."}}`.
      - (ii) The summarization request is the next request that contains `S6-SEED-1` and **does not** carry the `S6-TARGET` user turn at the tail. It returns a text summary containing `S6-SUMMARY`.
      - (iii) The retried target request contains `S6-SUMMARY` and `S6-TARGET` but not `S6-SEED-1`. It returns text `S6-DONE`.
    - Assertions:
      - B's SDK message stream contains a `{type:'system', subtype:'compact_boundary'}` message. That type is `SDKCompactBoundaryMessage`, `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:3530-3545`, a member of `SDKMessage` (`:5025`). Its `compact_metadata.trigger` is `'auto'`.
      - The boundary arrives after (i) and before (iii).
      - B's final `result` has `subtype: 'success'` and a result text containing `S6-DONE`.
    - Variant: the same scenario, with (i) answered as HTTP 200 SSE `response.failed` carrying `response.error.code: 'context_length_exceeded'`, split across two chunks after the `event:` line.
    - If the first run shows no `compact_boundary` (A5 false: reactive compaction gated off under default options), do not weaken the assertion silently. Instead:
      - rename the case to `S6 overflow propagation`;
      - assert B's result is an error whose text contains `Prompt is too long` (the CLI's `pI` constant) within the timeout, with no 180 s stall;
      - record in `test-report.md` that compact-and-retry is **not** proven through the SDK.
    - Side queries the mock answers `ok` cannot satisfy (i)-(iii), because each role is keyed on markers.
- Failure behaviour: if the pinned SDK or platform binary is missing, the spec throws a clear error, following `findPinnedSdk`. It never silently skips.
- Files: CREATE the spec above. It may add a small fixture-writer helper inside the spec, not a shared module.

## Integration architecture

- Data flow:
  1. SDK/CLI sends `POST /v1/messages` to `handleMessages`, which runs the envelope zod parse (`translation-proxy-base.ts:386-430`).
  2. `translateAnthropicToResponses` runs (562-owned), then `guardResponsesToolNames` (component 5), then `downgradeToolOutputImages` unless the subclass declares `supportsResponsesToolOutputImages()`; only Codex does (component 7).
  3. `forwardToResponsesApi` calls `forwardToApi`. Upstream status >= 400 goes to `classifyUpstreamHttpError` (component 2), then the mapped or legacy error.
  4. On 2xx the request goes to exactly one of the three handlers. Each ends in `classifyResponsesTerminal`, uses the same `resolveToolName`, and writes Anthropic SSE or JSON.
- State: per request only. The name reverse map lives in the handler closure. The stream translator stays one instance per request (`responses-stream-translator.ts:20`). Nothing persists.
- External boundaries:
  - Upstream bodies are untrusted: parsed with try/catch or zod, never echoed (component 1).
  - The inbound envelope is already validated (`:70-105`).
  - Image `data:` URLs go through `resolveImageMediaType`.
- Failure and rollback: every failure becomes exactly one Anthropic terminal (HTTP error before headers, or an SSE `error` after them). There is no retry inside the proxy beyond today's single 401 retry.
- Observability:
  - Existing `ProxyPhaseTimingRecord` statuses: overflow is `upstream-error`; stream failures are `invalid-response` through `onTranslationError`.
  - New `warn` line on overflow classification (no body) and the `info` disclosure line (component 9).

## Architecture-level quality requirements

- Functional:
  - An overflow in any form listed above yields the exact prompt-too-long contract on both paths.
  - Each terminal-table row yields the same stop reason or error type on the streaming path, the forced-SSE collector path and the JSON path.
  - Aliased names never reach the SDK.
  - No `tool_use.input` is `{}` unless upstream sent `{}`.
  - Block indexes are unique and dense.
- Performance: O(n) passes only. The name guard hashes only invalid names. No timers or observers are added.
- Security: no upstream payload text in client messages or logs (OpenCode rule); codes sanitized; no secrets in logs.
- Maintainability:
  - Responses modules stay library-internal (barrel unchanged, `translation/index.ts`).
  - No new imports across the `auth-providers` to `agent-sdk` boundary.
  - Edits to `responses-request-translator.ts` are limited to the two named locations.
  - The builder's `settingSources` literal is preserved.
- Testability: every behaviour above has a unit spec at the smallest seam, plus HTTP-level proxy specs for both `stream` values, plus the SDK integration spec for the acceptance claims. Every existing spec in `translation/*.spec.ts`, `providers/*/*.spec.ts`, `provider-registry.spec.ts` and `output-style-activation.resolver.spec.ts` stays green without edits to its current expectations (new cases may be added).

### Test specifications (by acceptance criterion)

| Criterion | Spec file (project) | Cases |
| --- | --- | --- |
| Overflow maps to the prompt-too-long shape | `responses-error-mapping.spec.ts` (`@ptah-extension/auth-providers`) | 400/413 with `code: context_length_exceeded`; each message pattern; Chat-style numbers produce `prompt is too long: 130532 tokens > 128000 maximum`; Anthropic native passthrough; 400 non-overflow (`invalid_request` other), 401/403/500 and non-JSON bodies return `undefined`; output never contains a sentinel `private-upstream-value` placed in the body; the output string satisfies `/prompt is too long[^0-9]*(\d+)\s*tokens?\s*>\s*(\d+)/i` when numbers are present |
| Same, over HTTP | `translation-proxy-base.spec.ts` | Responses lane, both `stream` values: status 400, body `{type:'error',error:{type:'invalid_request_error',message:/^prompt is too long/}}`; the chat/completions lane gets the same mapping; a non-overflow 400 keeps today's `api_error` body exactly; timing status `upstream-error`; the installed `@anthropic-ai/sdk` `APIError.generate(400, body)` message contains `prompt is too long` |
| Failed and incomplete streams produce error or stop events | `responses-stream-translator.spec.ts` | Every terminal-table row; the standalone `error` event with top-level `code`/`message` **and** the nested `error.{code,message}` shape; failed with overflow produces an SSE error with the contract message; incomplete `max_output_tokens` gives `message_delta.stop_reason='max_tokens'` with usage; `content_filter` gives `refusal`; incomplete with truncated args gives an error for both reasons; nothing is emitted after finalisation; `terminateTruncated()` gives one error and is idempotent; `MessageStream.fromReadableStream` resolves for stop rows and rejects for error rows |
| SSE framing delivers terminal events | `responses-stream-translator.spec.ts` **and** `responses-stream-collector.spec.ts` (both SSE consumers) | For each of `response.failed`, `response.incomplete` and `error`, with the JSON **omitting** `type` so the `event:` line is the only name: (1) chunk split immediately after `event: <name>\n`; (2) `data` split across two `data:` lines (multiline data joined by `\n`); (3) byte-at-a-time feed; (4) CRLF line ends. Each gives the same outcome as the unsplit frame. The existing `[DONE]` behaviour (`responses-stream-translator.spec.ts:388-418`) and collector split spec (`:147-152`) stay green |
| Streaming equals non-streaming per case | `responses-stream-collector.spec.ts` + `translation-proxy-base.spec.ts` | A shared `it.each` fixture table run through (a) stream `true`, (b) stream `false` + `forceResponsesStream`, (c) stream `false` JSON. It asserts the same stop reason, or the same error type and message with statuses 400/429/502 per mapping. Rows: completed; `max_output_tokens` × {no tools, valid args, invalid args `{"x":`}; `content_filter` × {no tools, valid args, invalid args}; other incomplete reason; `response.failed` × {`context_length_exceeded`, `rate_limit_exceeded`, `server_error`, `invalid_prompt`, no error}; standalone `error` × {top-level code, nested code}. Invalid args give `upstream_incomplete` for **both** reasons on all three paths. EOF before terminal on the stream path produces an SSE `api_error`. The existing `rejects unsuccessful streams` cases (`:161-167`) still reject |
| Long MCP tool name round-trips | `responses-tool-names.spec.ts`, `translation-proxy-base.spec.ts`, integration S5 | 70-character `mcp__server.with.dots__tool` gives an alias of 64 characters or fewer matching the regex, deterministic across calls; valid names unchanged (request deep-equal to input); history `function_call` rewritten identically; reverse lookup; unknown passthrough; collision gives a 400; HTTP both paths return the original `name` in `tool_use` |
| Args only in `.done` | `responses-stream-translator.spec.ts` | `added`, then `function_call_arguments.done` only, then `output_item.done`: exactly one `input_json_delta` with the full args; `output_item.done` args only; deltas plus done give no duplicate; **delayed name** (`added` without a name, then deltas, then `output_item.done` with the name and args) gives one start, then one flushed `input_json_delta`, then a stop; the installed `MessageStream` final `tool_use.input` equals the parsed args in all four cases |
| Image tool result | `responses-request-translator.spec.ts`, `responses-tool-output-images.spec.ts`, `codex-stream-parity.spec.ts` (Codex), `opencode-translation-proxy.spec.ts` (OpenCode), integration S5 | Translator: text-only is still a string (existing snapshot `:162` unchanged); text plus PNG gives `[input_text, input_image(data:image/png;base64,...)]`; unresolvable media gives a placeholder part; `is_error` with an image. Post-pass: an array becomes the placeholder string; no mutation. **Codex** HTTP: the upstream body `output` is an array with `input_image`. **OpenCode** GPT/responses HTTP: the upstream body `output` is a string with the placeholder and no `input_image` |
| Parallel tool calls get distinct block indexes | `responses-stream-translator.spec.ts` | Two `added(function_call)` events before either `done`, with interleaved deltas: indexes 0 and 1 (or 1 and 2 after text); each delta goes to its own index; stops once each; the `MessageStream` final content has two intact `tool_use`; existing index expectations `:274-386` unchanged |
| Multi-turn history pairing (**replay coverage**, not an executed SDK resume) | `responses-tool-names.spec.ts` + `responses-request-translator.spec.ts` | A replayed assistant `tool_use` (long name) plus user `tool_result` (image) in a translated request: `function_call.call_id === function_call_output.call_id`, the alias equals the `tools[]` alias, and order is preserved. The executed resume is S6 in the integration spec |
| Static list | `codex-provider-entry.spec.ts` (`@ptah-extension/shared`) | `staticModels[0].id === 'gpt-5.4'`; includes `gpt-6-astra` and `gpt-5.6-sol`; every `contextLength === 0`; every `CODEX_DEFAULT_TIERS` value is in the list |
| Disclosure | `sdk-query-options-builder.spec.ts` (`@ptah-extension/agent-sdk`) | localhost base URL gives one info line and `settingSources` `['project','local']`; direct gives no line and includes `'user'` |
| Skill, slash command, unknown command and tool, alias, overflow and compaction, all through the installed SDK | `translation-proxy.sdk.integration.spec.ts` (`@ptah-extension/auth-providers`) | S1-S6 as specified. S6 claims compaction only if the `compact_boundary` assertion passes. All upstream traffic is MOCKED; there are no live-provider checks |

## Team-leader handoff

- Recommended executors:
  - backend-developer for components 1-9 and 11 (Node HTTP and translator code, established zod and test patterns).
  - senior-tester to own component 11's first real-binary run and to write `test-report.md` with exact counts, split into mocked and live (live = none).
  - Component 10's doc can go to backend-developer; technical-content-writer is optional.
- Complexity: MEDIUM-HIGH. The code changes are local, but component 11 is the repo's first real-CLI-binary test, and parity across three response paths needs a shared fixture table.
- Dependencies and ordering (component level):
  - Phase 1 (components 1-4) first. TASK_2026_561 A8 depends on it. B1 is self-contained: SSE frame state and the received-argument accumulator are part of component 3 in B1, so component 3's incomplete check never depends on component 6.
  - Component 5 depends on 1-4 landing, because it shares `responses-stream-translator.ts`, `responses-stream-collector.ts` and `translation-proxy-base.ts`.
  - Component 6 extends component 3's accumulator (B1) and shares the stream translator with 5, so it lands in B2.
  - Component 7 touches `translation-proxy-base.ts` (hook + post-pass call) and `codex-translation-proxy.ts`, so it runs **after B2**. Its translator edits alone would be disjoint.
  - Components 8 and 9 are file-disjoint from all translation work.
  - Component 10 is **not** file-disjoint:
    - its base-header comment rides in B1 (`translation-proxy-base.ts`);
    - its builder comment rides with component 9 in B5 (`sdk-query-options-builder.ts`);
    - only `ownership.md`, `codex-cli.adapter.ts` and `anthropic-proxy.service.ts` are its own files.
  - Component 11 runs last (it needs 1-7).
- Proposed batches (requested by the brief; the team-leader may re-derive them):
  - B1 Phase 1: components 1-4, including SSE frame state and the received-argument accumulator.
    - Files: CREATE `responses-error-mapping.ts`, `responses-error-mapping.spec.ts`; MODIFY `responses-stream-translator.ts` (+spec), `responses-stream-collector.ts` (+spec), `translation-proxy-base.ts` (+spec; includes the component-10 header comment).
    - Commit: `fix(auth-providers): map Codex upstream overflow, failed and incomplete responses to Anthropic errors`.
  - B2 (after B1): components 5 and 6.
    - Files: CREATE `responses-tool-names.ts` (+spec); MODIFY `responses-stream-translator.ts` (+spec), `responses-stream-collector.ts` (+spec), `translation-proxy-base.ts` (+spec).
    - Commit: `fix(auth-providers): guard Responses tool names and fix streamed tool-call args and block indexes`.
  - B3 (after B2; parallel with B4/B5): component 7.
    - Files: MODIFY `responses-request-translator.ts` (+spec), `translation-proxy-base.ts` (hook + call only), `providers/codex/codex-translation-proxy.ts`, `providers/codex/codex-stream-parity.spec.ts`, `providers/opencode/opencode-translation-proxy.spec.ts`; CREATE `responses-tool-output-images.ts` (+spec).
    - Commit: `fix(auth-providers): keep tool-result images for Codex and disclose them elsewhere`.
  - B4 (parallel): component 8.
    - Files: MODIFY `libs/shared/.../codex-provider-entry.ts`; CREATE `codex-provider-entry.spec.ts`.
    - Commit: `fix(shared): demote Codex static model windows to catalog-only`.
  - B5 (parallel): components 9 and 10 (except the base header).
    - Files: MODIFY `sdk-query-options-builder.ts` (+spec), `codex-cli.adapter.ts` (comment), `apps/ptah-cli/src/services/proxy/anthropic-proxy.service.ts` (comment); CREATE `.ptah/specs/TASK_2026_408/ownership.md`.
    - Commits: `fix(agent-sdk): disclose dropped user-tier settings on localhost proxy sessions`, and `docs: document translation proxy vs native Codex vs CLI proxy ownership` (the comment-only edits in `cli-agent-runtime` and `apps/ptah-cli` ride in the docs commit).
  - B6 (after B1-B3): component 11.
    - Files: CREATE `translation-proxy.sdk.integration.spec.ts`.
    - Commit: `test(auth-providers): prove skill, command and overflow flows through the installed SDK`. Use `fix(auth-providers): …` if the repo gates `test` type; `.commitlintrc.json` scopes allow `auth-providers`.
- Parallel-safe work:
  - B4 and B5 are file-disjoint from B1, B2, B3 and each other, and can start at any time.
  - B1, then B2, then B3 run sequentially: they reuse `translation-proxy-base.ts`, and B1/B2 also reuse the stream translator and collector.
  - B6 runs last.
- Files affected:
  - CREATE: `libs/backend/auth-providers/src/lib/translation/{responses-error-mapping.ts, responses-error-mapping.spec.ts, responses-tool-names.ts, responses-tool-names.spec.ts, responses-tool-output-images.ts, responses-tool-output-images.spec.ts, translation-proxy.sdk.integration.spec.ts}`; `libs/shared/src/lib/providers/entries/codex-provider-entry.spec.ts`; `.ptah/specs/TASK_2026_408/ownership.md`
  - MODIFY: `libs/backend/auth-providers/src/lib/translation/{responses-stream-translator.ts, responses-stream-translator.spec.ts, responses-stream-collector.ts, responses-stream-collector.spec.ts, translation-proxy-base.ts, translation-proxy-base.spec.ts, responses-request-translator.ts, responses-request-translator.spec.ts}`; `libs/backend/auth-providers/src/lib/providers/codex/{codex-translation-proxy.ts, codex-stream-parity.spec.ts}`; `libs/backend/auth-providers/src/lib/providers/opencode/opencode-translation-proxy.spec.ts`; `libs/shared/src/lib/providers/entries/codex-provider-entry.ts`; `libs/backend/agent-sdk/src/lib/helpers/{sdk-query-options-builder.ts, sdk-query-options-builder.spec.ts}`; `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.ts` (comment); `apps/ptah-cli/src/services/proxy/anthropic-proxy.service.ts` (comment)
  - REWRITE: none
- Compatibility (every importer and provider sharing a changed module):
  - `responses-request-translator.ts`, `responses-stream-translator.ts`, `responses-stream-collector.ts`: sole importer `translation-proxy-base.ts`. Barrel re-exports (`translation/index.ts:18-35`) are not re-exported by the package (`src/index.ts:66-74`).
    - Constructor and function additions are trailing optionals, so existing call sites and specs compile unchanged.
    - The `output` union widening is additive; the only producer and consumer is the translator itself.
    - Affected providers: Codex and OpenCode-GPT. With valid tool names, text-only results and sequential streams, the requests and responses are byte-identical to today.
    - Image-bearing tool results change as follows:
      - Codex gets `input_image` arrays (evidenced by the pinned client).
      - OpenCode gets an explicit placeholder string, still a string as today, but it now says the image was omitted instead of dropping it silently.
      - Subclasses on the Chat Completions lane never reach this code.
  - `translation-proxy-base.ts` `forwardToApi`: all seven subclasses. Only overflow-classified 400/413 bodies change response. OpenCode's raw-body rule is preserved (synthesized message). Copilot, OpenRouter, Sakana, Custom and Local gain compact-and-retry on overflow instead of a hard error.
  - `codex-provider-entry.ts`: consumers `codex-translation-proxy.ts:80` (`/v1/models` IDs, now 8), `provider-rpc.handlers.ts:276-280,316-322`, `provider-models.service.ts:381-395`, `ptah-cli-registry.ts:245,321,1614` (count and first ID; first ID unchanged), `workspace-provider-profile-resolver.ts:493`.
  - `sdk-query-options-builder.ts`: log only; the guard literal is preserved.
- Verification points:
  - `node_modules` is present (junction). Do not run `npm ci` over it unless the junction is broken.
  - Confirm SDK version `0.3.278` in `node_modules/@anthropic-ai/claude-agent-sdk/package.json` before trusting component 11.
  - Commands (changed projects, plus targeted direct-consumer checks only):
    - `npx nx run-many -t test -p @ptah-extension/auth-providers @ptah-extension/shared @ptah-extension/agent-sdk`
    - `npx nx run-many -t lint,typecheck -p @ptah-extension/auth-providers @ptah-extension/shared @ptah-extension/agent-sdk @ptah-extension/cli-agent-runtime ptah-cli` (the last two change by comment only)
    - `npx nx test @ptah-extension/cli-agent-runtime --testPathPattern=ptah-cli-registry` is a changed project, and the spec reads `staticModels[0]` / count.
    - `npx nx test @ptah-extension/output-styles --testPathPattern=output-style-activation.resolver` is not a changed project. It runs because that spec reads `sdk-query-options-builder.ts` source text directly (`:181-200`), so it is the direct-consumer check for the builder edit.
    - `rpc-handlers` is not run: no file in it changes. Its Codex static-list consumer (`provider-rpc.handlers.ts:276-322`) maps IDs and passes `contextLength` through without asserting values.
  - Record exact pass counts per project in `test-report.md`, and mark component 11 as "real SDK + real CLI binary + real proxy, MOCKED upstream".

### Risks

- R1. Component 11 is the first real-binary spec. The CLI may make extra requests: `count_tokens`, which the proxy answers 404 (`translation-proxy-base.ts:378-383`), or side queries, which the mock answers `ok`. Mitigation: a content-scripted mock, isolation env, a 120 s timeout. Fallback if CI cannot run the binary: keep S1-S6 behind a clearly named `describe` that fails loudly when the binary is missing. Do not skip.
- R2. Codex array output rests on pinned-client evidence, not a live Codex call. Mitigation: text-only results are unchanged. If Codex ever rejects the array, the fix is one line: drop the Codex override of `supportsResponsesToolOutputImages`, and the placeholder path is already built and tested. OpenCode is not exposed.
- R6. The frame-based SSE dispatch in the stream translator changes *when* events are emitted: on the frame's blank line instead of on each `data:` line. Conformant upstreams always terminate frames. A non-conformant upstream that never sends blank lines would stall until EOF, then report `terminateTruncated()`. That is the same rule the collector already enforces (`responses-stream-collector.ts:187-188`).
- R3. `onTranslationError` labels upstream-failed streams `invalid-response` in timing records. That is accepted: records are metadata-only, and `compactionCorrelation` is `inexact`. Adding a distinct callback would widen three handler signatures for telemetry alone.
- R4. `[DONE]`-without-terminal still finishes `end_turn` on the stream path (spec-pinned, `responses-stream-translator.spec.ts:388-418`) while the collector rejects it. This is a documented residual in `ownership.md`. Changing it is out of scope, because OpenAI-compatible gateways rely on it.
- R5. Overflow message patterns are Assumptions until live probe P7 (`phase-3-options.md`) is authorized. They are deliberately narrow to avoid turning non-overflow 400s into compaction loops. The CLI's reactive compact already guards its own retry count; see `hasAttempted` in the pinned binary literal `xYn(e){return!e.hasAttempted&&...`.

## Revision log (round 1)

Source: `implementation-plan-review.md` (codex lane, verdict REVISE).

| # | Finding | Change |
| --- | --- | --- |
| 1 (blocking) | Truncated-tool precedence undefined for `content_filter` | Component 1 adds one **precedence rule**: an incomplete status with any incomplete tool args is the `upstream_incomplete` error regardless of reason, checked before stop-reason mapping and content translation. The terminal table is reordered with that row first. Component 3 (stream), component 4 collector `onEnd` and component 4 JSON path all apply it; the JSON path may no longer fabricate `{}` on incomplete. The parity fixture table now crosses `max_output_tokens` and `content_filter` with {no tools, valid args, invalid args}. |
| 2 (blocking) | Event name lost across chunks in the stream translator | Component 3 makes the pending `event:` name and `data:` lines instance state, dispatches on the blank line with multiline `data` joined by `\n`, and handles CRLF, the same framing as the collector. It sits in **B1**, because Phase 1 delivery depends on it. The new test row covers split-after-`event:`, multiline data, byte-at-a-time and CRLF for `response.failed`, `response.incomplete` and `error` on **both** SSE consumers. |
| 3 (blocking) | Received and emitted args conflated; delayed-name args skipped | Component 6 separates `receivedArgs` from `emittedLength`. Pre-name deltas are buffered, not dropped. Start flushes the unemitted remainder once. A done payload fills `receivedArgs` only when it is empty. Added a delayed-name regression through the installed `MessageStream`. |
| 4 (blocking) | Array image output unverified for OpenCode | Component 7: arrays go to **Codex only**, via a `supportsResponsesToolOutputImages()` hook that defaults to false and is overridden in `CodexTranslationProxy`. A new post-pass `downgradeToolOutputImages` rewrites arrays to an explicit placeholder string for everyone else. It is applied in the base, outside the 562-owned functions (a translator flag would need threading through `translateAnthropicToResponses`). Codex and OpenCode are tested separately over HTTP (`codex-stream-parity.spec.ts`, `opencode-translation-proxy.spec.ts`). A2 is retired. B3 moves to after B2. |
| 5 (non-blocking) | Collector `eventSchema` strips standalone `error` fields | Component 4 adds `code`, `message` and nested `error` to `eventSchema`, and `error` to `responseSchema`, all optional. Dispatch reads top-level first, then nested. Fixtures cover both shapes on both SSE consumers and the stream translator. |
| 6 (non-blocking) | S6 did not prove compaction; replay mislabelled | S6 now seeds a 3-turn session, resumes it (an executed SDK resume), and matches the overflow, summary and retry requests by marker. It asserts `SDKCompactBoundaryMessage` (`sdk.d.ts:3530-3545`, `trigger: 'auto'`) between overflow and retry, plus a successful result. If A5 fails it is renamed to overflow propagation, and `test-report.md` must say compaction is not proven. The translator-level history case is relabelled "replay coverage, not an executed SDK resume". |
| 7 (non-blocking) | Verification scope, 3 to 6 dependency, disjointness wording | The test command is now the changed projects only (`auth-providers`, `shared`, `agent-sdk`) plus targeted `cli-agent-runtime` (changed) and `output-styles` (justified: that spec reads the builder source). `rpc-handlers` is dropped. The accumulator moves into B1, so component 3 no longer depends on component 6. The ordering text now states that component 10 shares the base (B1) and builder (B5) files. The parallel-safe claim is corrected to "B4 and B5 are disjoint; B1, then B2, then B3 run in sequence". |
| 8 | Coverage and evidence note | No change needed. The `node_modules` note is updated now that the junction exists. |
