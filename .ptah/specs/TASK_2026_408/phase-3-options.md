# Phase 3 options - reasoning carry-over on the Codex translation proxy (TASK_2026_408)

Status: decision input only. Nothing here is authorized for implementation, and no provider request was sent while writing it. The live probe plan in section 4 needs explicit user authorization before anyone runs it.

Scope boundary: TASK_2026_562_4b1d W2.4 owns "send the system prompt once" and `prompt_cache_key` in `responses-request-translator.ts`. TASK_2026_561_9e57 owns every compaction policy. The options below must rebase on both.

## 1. Where the proxy is today (verified)

| Fact | Evidence |
| --- | --- |
| Every Responses request is stateless: `store: false`, full history replayed each turn | `libs/backend/auth-providers/src/lib/translation/responses-request-translator.ts:147-152` |
| The request contract has no `include`, `previous_response_id`, `reasoning` or `prompt_cache_key` field | `responses-request-translator.ts:104-117` (`OpenAIResponsesRequest`) |
| Anthropic `thinking` is dropped on the way in (the stated contract strips `thinking, metadata, cache_control, tool_choice`) | `responses-request-translator.ts:120-126` |
| Upstream `reasoning` output items are ignored on the way out: the stream translator only routes text, function-call and terminal events | `responses-stream-translator.ts:227-251` |
| The SSE collector keeps only `message` and `function_call` items | `responses-stream-collector.ts:66-76` |
| The installed OpenAI types say `reasoning.encrypted_content` is how you reuse reasoning items across turns "when using the Responses API statelessly (like when the `store` parameter is set to `false` ...)" | `openai@5.23.2` (lockfile `package-lock.json:24266`), `resources/responses/responses.d.ts:1787-1791`; the item field is `encrypted_content` at `:3224-3226` |
| `previous_response_id`, `store` and `prompt_cache_key` are request fields | same file `:363`, `:4366`, `:4414`, `:374` |
| The pinned Codex CLI (the reference client for the subscription endpoint) contains `reasoning.encrypted_content` (1 hit), `previous_response_id` (4), `prompt_cache_key` (4) and `context_management` (19). It carries no `"store"` literal. | `@openai/codex@0.155.1-win32-x64` `vendor/x86_64-pc-windows-msvc/bin/codex.exe`, byte-string grep. Strings show the client knows the fields. They do not show which ones the subscription endpoint accepts. |

The installed `openai` package comes in only through `exa-js` (`package-lock.json:24266`). Nothing in the repo calls it at runtime. It counts as documentation evidence, not a contract that code depends on.

## 2. Options

### Option A - keep stateless, no reasoning carry-over (status quo)

- Behaviour: every turn reasons from scratch over the replayed transcript.
- Cost: the model re-derives its plans each turn. Reasoning tokens are paid again. Long tool loops can lose their thread. Nothing else changes.
- Risk: none new.
- When right: when the probe (section 4) shows the subscription endpoint rejects `include` or never returns `encrypted_content`.

### Option B - `include: ["reasoning.encrypted_content"]` plus replay of encrypted reasoning items (stays `store: false`)

- Request: add `include: ['reasoning.encrypted_content']`. Put each earlier turn's `{ type: 'reasoning', id, encrypted_content, summary }` item back in `input`, in its original position before the `function_call` / message it produced.
- Response: the stream translator and collector must capture `reasoning` output items (`response.output_item.done` with `item.type === 'reasoning'`).
- Carrier: the host SDK must return that opaque blob on the next request. The only Anthropic-native carrier that round-trips through the SDK transcript is a `thinking` block with a `signature`. Map `encrypted_content` to `thinking.signature` with an empty or summary `thinking` text, then map it back on replay.
  - Assumption to verify: the installed CLI keeps the `signature` of a `thinking` block from a non-Anthropic model across resume and compaction, and does not strip or re-validate it. Evidence to gather: the CLI strips a mismatched signature via `kCe` / `thinking_signature` 400 classification (`claude.exe` 0.3.278, `Yun()` routes `thinking_signature`). That points to server-side validation only, but this needs a real test.
  - `translateAnthropicToResponses` currently drops `thinking` (`responses-request-translator.ts:120-126`). That is TASK_2026_562 W2.4 territory, so this option has to be sequenced after W2.4 lands.
- Cost: medium. It touches the request translator, stream translator, collector and non-streaming JSON handler, and needs an SDK integration test that proves the signature survives resume and compaction.
- Risk: the replayed blob is tied to the model. A model switch mid-session (tier change, `normalizeModelId` fallback) must drop reasoning items, or the upstream returns 400. Compaction summaries have no reasoning items, which is fine.
- Privacy: the blob is encrypted by the provider and is not readable. It still ends up in Ptah's session JSONL. Document that.

### Option C - `previous_response_id` with `store: true`

- Behaviour: the server keeps the conversation, and the proxy sends only the delta plus `previous_response_id`.
- Blocker: the translator comment records the Codex subscription contract as `store` "Codex API requires false" (`responses-request-translator.ts:113`). The pinned CLI has no `"store"` literal to contradict or confirm that. Treat C as unavailable on the ChatGPT subscription endpoint until the probe says otherwise. It may still work on the API-key endpoint (`api.openai.com`).
- Structural cost: HIGH. The host SDK owns the transcript and replays all of it. The proxy would have to diff the replay against server state per session, and handle resume, compaction (the SDK rewrites history, which breaks the chain), retries and forks. That is a second source of conversation truth, which `context.md` rules out as an unplanned migration ("do not automatically bolt native Codex sessions onto the host-managed loop").
- Recommendation: reject for the translation proxy. The native Codex adapter (`codex-cli.adapter.ts`, Codex SDK threads) is already the stateful path.

### Option D - `previous_response_id` with `store: false`

Not coherent. Nothing is stored for the id to point at. Listed only so nobody tries it.

### Recommendation

Default to A. Move to B only if the probe confirms (1) the subscription endpoint accepts `include: ['reasoning.encrypted_content']` with `store: false`, (2) it returns `encrypted_content` on reasoning items, and (3) replaying them is accepted and measurably changes behaviour or cached-token counts. Reject C and D for the translation proxy.

## 3. Interaction with other tasks

- TASK_2026_562 W2.4 (`prompt_cache_key`, system prompt once): independent of B at the wire level. B's `thinking` round-trip edits the same request-translator entry point, so B must rebase after W2.4.
- TASK_2026_561 (compaction): B's reasoning items vanish on compaction by construction. No policy change is needed, but 561's integration tests should include one B-enabled resume if B ships.
- Phase 1 of this task (overflow to "prompt is too long"): reasoning items raise the input token count. The overflow mapping still applies unchanged.

## 4. Live probe plan (ChatGPT subscription endpoint) - NOT AUTHORIZED

Preconditions: explicit user authorization, a throwaway workspace, and the user's own Codex login (`~/.codex/auth.json`). Every probe is one short request. No secrets are logged. Record only status codes, field presence and token counts.

Target: `https://chatgpt.com/backend-api/codex/responses` (the route `CodexTranslationProxy.requiresResponsesStream` recognises, `libs/backend/auth-providers/src/lib/providers/codex/codex-translation-proxy.ts:135-139`), with the proxy's own headers from `ICodexAuthService.getHeaders()`.

| # | Request delta vs today's translated request | Record | Decides |
| --- | --- | --- | --- |
| P1 | Baseline: today's body (`store: false`, `stream: true`), one user turn, reasoning model (`gpt-5.4`) | status; output item types; `usage.output_tokens_details.reasoning_tokens` | control |
| P2 | P1 + `include: ["reasoning.encrypted_content"]` | status (400 means B is dead); whether `response.output_item.done` carries `type: "reasoning"` with a non-empty `encrypted_content` | B feasibility |
| P3 | Two-turn tool loop: turn 1 from P2 ends in a `function_call`; turn 2 replays turn 1's reasoning item and function_call and adds `function_call_output` | status; `input_tokens_details.cached_tokens` against the same turn 2 without the reasoning item | B value (cache and continuity) |
| P4 | P3 turn 2 with a different model id | status and error body `code` | B model-switch guard requirement |
| P5 | P1 with `store: true` | status | C availability (expected rejection) |
| P6 | P1 + `previous_response_id` from P1 and `store: true` (only if P5 succeeds) | status | C mechanics |
| P7 | An over-window input (replay a synthetic transcript above the catalog `context_window` from `/models`, `codex-auth.service.ts:322-336`) | HTTP status plus error `code` and message, **or** the `response.failed` / `error` event shape if streamed | Confirms the Phase 1 overflow classifier against the real endpoint (its message patterns are Assumptions in `implementation-plan.md`) |

Exit criteria: write the results into this file under "Probe results (date)". The go/no-go for Option B is P2 = 200 with an `encrypted_content` present, P3 = 200, and P4 behaviour known.
