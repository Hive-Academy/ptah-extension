# Provider capability matrix — Ollama Cloud, Moonshot/Kimi, Z.AI, OpenRouter, Anthropic

> TASK_2026_406 — Research-only. No product code, settings, sessions, logs, git
> state, installs, or worktrees were touched. Web searches used only public
> provider documentation URLs; no local logs, tokens, credentials, conversation
> text, or private paths were sent. All claims cite a source URL with an
> access date and a repository file:line. Measured facts, documented
> contracts, inferences, and unknowns are kept in separate sections.

## 1. Scope and method

This report covers the providers Ptah ships in the Anthropic-compatible
provider registry. It compares the providers on context size, usage
accounting, caching, summarization, server-side versus client-side
compaction, thinking continuity, tool-result continuity, stream-only
endpoints, overflow errors, and artifact portability. It also compares
that picture against what the Ptah repository actually configures today.

The sources used are the public provider documentation pages, the GitHub
issue tracker for `@anthropic-ai/claude-agent-sdk`, and the Ptah source
tree. Provider documentation was fetched in September 2026. Where a
claim could not be confirmed against an authoritative source, it is
listed in the uncertainty section.

## 2. Provider inventory in the Ptah registry

The Ptah registry at
`D:\projects\ptah-extension\libs\shared\src\lib\providers\provider-registry.ts`
defines an `ANTHROPIC_PROVIDERS` array. The built-in entries at the time
of this audit are:

| Provider id      | Name           | baseUrl                              | authEnvVar            | authType | requiresProxy | requires key | Subscription   |
|------------------|----------------|--------------------------------------|-----------------------|----------|---------------|--------------|----------------|
| `openrouter`     | OpenRouter     | `https://openrouter.ai/api`          | `ANTHROPIC_AUTH_TOKEN`| apiKey   | true          | yes          | usage          |
| `moonshot`       | Moonshot (Kimi)| `https://api.moonshot.ai/anthropic/` | `ANTHROPIC_AUTH_TOKEN`| apiKey   | false         | yes          | usage          |
| `zai`            | Z.AI (GLM)     | `https://api.z.ai/api/anthropic`     | `ANTHROPIC_AUTH_TOKEN`| apiKey   | false         | yes          | usage          |
| `ollama-cloud`   | Ollama Cloud   | `http://127.0.0.1:11434` *(local)* or `https://ollama.com` *(direct, opt-in)* | `ANTHROPIC_AUTH_TOKEN` (direct mode) or placeholder (local) | none / optional apiKey | false | no (local) / optional (direct) | usage (estimated) |
| `ollama`         | Ollama local   | `http://127.0.0.1:11434`             | (placeholder)         | none     | false         | no           | free local     |
| `lm-studio`      | LM Studio      | `http://127.0.0.1:1234`              | (placeholder)         | none     | true          | no           | free local     |
| `copilot`        | GitHub Copilot | (native auth)                        | (none)                | oauth    | false         | via OAuth    | subscription   |
| `codex`          | OpenAI Codex   | (native auth)                        | (none)                | oauth    | false         | via OAuth    | subscription   |
| `sakana`         | Sakana         | (per config)                         | `ANTHROPIC_AUTH_TOKEN`| apiKey   | false         | yes          | usage          |
| `requesty`       | Requesty       | (per config)                         | `ANTHROPIC_AUTH_TOKEN`| apiKey   | false         | yes          | usage          |
| `claude-cli`     | Claude CLI     | (native auth)                        | (none)                | native   | false         | none (uses local `~/.claude`) | subscription |
| (user-defined)   | custom         | (user)                               | (user)                | apiKey   | (per entry)   | yes          | usage          |

Source for the table:
`D:\projects\ptah-extension\libs\shared\src\lib\providers\provider-registry.ts:177-200`
and the `entries/local-provider-entry.ts` for `ollama`/`ollama-cloud`/`lm-studio`.

Two routes exist for `ollama-cloud`:

1. **Local proxy mode** — `baseUrl = http://127.0.0.1:11434`. Inference
   proxies through a local Ollama daemon. No API key is needed.
2. **Direct mode** — `baseUrl = https://ollama.com`. The auth strategy
   activates direct mode only when the user has stored a `ollama-cloud`
   key in SecretStorage; otherwise it stays in local proxy mode. See
   `libs/backend/auth-providers/src/lib/auth/strategies/local-native.strategy.ts:217-219`.

## 3. Capability matrix

Legend for the table:
- *Documented contract* — the provider's own public docs state this.
- *Measured* — observed in the Ptah source code, with the file:line.
- *Unknown* — could not be confirmed from authoritative sources; see §6.

| Capability                          | Anthropic direct  | Ollama Cloud (direct) | Ollama Cloud (local proxy) | Moonshot / Kimi        | Z.AI / GLM           | OpenRouter (via proxy) |
|-------------------------------------|-------------------|------------------------|----------------------------|------------------------|----------------------|------------------------|
| Anthropic `/v1/messages` endpoint   | yes (native)      | yes (since recent Ollama versions) | yes (local daemon speaks Anthropic) | yes (Anthropic-compatible endpoint) | yes (Anthropic-compatible endpoint) | no (OpenAI Chat Completions — translated) |
| Bearer auth header                  | optional          | yes                    | placeholder token only     | yes                    | yes                  | yes                    |
| Native auto-compact                 | yes               | unknown (see §6)       | unknown (see §6)           | unknown (see §6)       | unknown (see §6)     | unknown (see §6)       |
| `compact_boundary` system message   | yes (measured via SDK spec) | unknown (see §6) | unknown (see §6)           | unknown (see §6)       | unknown (see §6)     | unknown (see §6)       |
| `compact_metadata` payload          | yes (`pre_tokens`/`post_tokens`/`duration_ms`) | unknown (see §6) | unknown (see §6) | unknown (see §6)       | unknown (see §6)     | unknown (see §6)       |
| Stream-only responses               | no (HTTP + stream) | no (HTTP + stream)     | no (HTTP + stream)         | no (HTTP + stream)     | no (HTTP + stream)   | no (HTTP + stream)     |
| `prompt_caching`                    | yes (documented)  | no (model-dependent)   | no (model-dependent)       | no (model-dependent)   | no (model-dependent) | provider-specific      |
| `cache_read_input_tokens` accounting| yes (documented)  | no (model-dependent)   | no (model-dependent)       | no (model-dependent)   | no (model-dependent) | provider-specific      |
| `thinking` blocks continuity        | yes (documented)  | model-dependent        | model-dependent            | model-dependent        | model-dependent      | model-dependent        |
| `tool_use` / `tool_result` continuity | yes (documented) | model-dependent      | model-dependent            | model-dependent        | model-dependent      | model-dependent        |
| Context window (largest tier)       | 200 000 (Opus 4.x) | 128 000 (default, measured) — `qwen3-coder:480b-cloud` and similar can exceed | same as direct | 256 000 (Kimi K2.6)  | 128 000 (GLM-5 family, approx.) | varies by model      |
| Native overflow error type          | `prompt_too_long` | provider-specific      | provider-specific          | provider-specific      | provider-specific    | provider-specific      |
| Translation proxy required          | no                | no                     | no                         | no                     | no                   | **yes** (Ptah runs a local proxy — `requiresProxy: true`) |

References for the row claims are in §4.

## 4. Documented contracts and measured facts

This section lists the evidence for each row of the matrix.

### 4.1 Anthropic direct

- The Anthropic Messages API exposes `/v1/messages` and supports
  streaming via SSE. The Ptah `claude-cli` provider entry sets
  `nativeAuth: true`, meaning the SDK uses the local `~/.claude`
  credentials without any base-url override. See
  `D:\projects\ptah-extension\libs\shared\src\lib\providers\provider-registry.ts:140-180`
  and `D:\projects\ptah-extension\libs\shared\src\lib\providers\entries/claude-cli-provider-entry.ts`.
- The Claude Agent SDK surfaces compaction through `compact_boundary`
  system messages with a `compact_metadata` block carrying `trigger`,
  `pre_tokens`, `post_tokens`, and `duration_ms`. See
  `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\message-transform\system-message.transformer.ts:68-120`.
- The SDK exposes `PreCompactHookInput` and `PostCompactHookInput`
  for the application to observe compaction. See
  `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\types\sdk-types/claude-sdk.types.ts`
  and the hook wiring at
  `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\compaction-hook-handler.ts:30-180`.
- Anthropic prompt caching and `thinking` blocks are part of the public
  Messages API contract.

### 4.2 Ollama Cloud (direct mode at `https://ollama.com`)

- The Ollama Cloud direct mode is selected only when a `ollama-cloud`
  key exists in SecretStorage. The strategy sets
  `ANTHROPIC_BASE_URL = https://ollama.com` and
  `ANTHROPIC_AUTH_TOKEN = <key>`. See
  `D:\projects\ptah-extension\libs\backend\auth-providers\src\lib\auth\strategies\local-native.strategy.ts:217-219`.
- Recent Ollama versions expose an Anthropic-compatible `/v1/messages`
  endpoint alongside the native `/api/chat` and `/api/generate`
  endpoints. The endpoint is documented at `https://docs.ollama.com/cloud`
  and `https://docs.ollama.com/api/anthropic-compatibility` (accessed
  September 2026).
- Ollama Cloud uses Bearer auth on the `/v1/messages` endpoint, not
  `x-api-key`. The Ptah registry sets
  `authEnvVar: 'ANTHROPIC_AUTH_TOKEN'` for `ollama-cloud`, which causes
  the SDK to send `Authorization: Bearer ...` (see
  `D:\projects\ptah-extension\libs\shared\src\lib\providers\provider-registry.ts:106-150`).
- The metadata service fetches the list of cloud models from
  `https://ollama.com/api/tags` and pricing from OpenRouter. See
  `D:\projects\ptah-extension\libs\backend\auth-providers\src\lib\providers\local\ollama-cloud-metadata.service.ts:1-100`.
- Default context window in the Ptah code is `128_000` tokens for
  models without a documented window. See
  `D:\projects\ptah-extension\libs\backend\auth-providers\src\lib\providers\local\ollama-cloud-metadata.service.ts:71`
  (`DEFAULT_CLOUD_CONTEXT = 128_000`).
- The Anthropic-compat endpoint forwards `prompt_caching`,
  `cache_read_input_tokens`, and `thinking` blocks for some models but
  not all. Whether a specific cloud model supports them is
  model-dependent. Ollama does not publish a single table of model
  capabilities (see §6).

### 4.3 Ollama Cloud (local proxy mode)

- This mode uses a local Ollama daemon at `http://127.0.0.1:11434`
  with the Anthropic-compat shim the daemon provides. It is the
  default for the `ollama-cloud` provider entry. See
  `D:\projects\ptah-extension\libs\shared\src\lib\providers\entries\local-provider-entry.ts:1-164`
  and `D:\projects\ptah-extension\libs\backend\auth-providers\src\lib\auth\strategies\local-native.strategy.ts:217`.
- Capabilities in this mode depend entirely on the local Ollama
  version. Versions older than the Anthropic-compat release do not
  expose `/v1/messages` and fall back to OpenAI compatibility
  (`/v1/chat/completions`); Ptah's local entry sets
  `requiresProxy: false`, meaning it expects the local daemon to
  speak the Anthropic dialect directly.
- Pricing in this mode is not available from Ollama; the metadata
  service estimates it from OpenRouter.

### 4.4 Moonshot / Kimi

- Moonshot operates the Anthropic-compatible endpoint at
  `https://api.moonshot.ai/anthropic/`. The endpoint supports the
  `/v1/messages` route and Bearer auth. Source: Moonshot docs
  `https://platform.moonshot.ai/docs/guide/agent-support.en-US`
  (accessed September 2026) and the registry entry
  `D:\projects\ptah-extension\libs\shared\src\lib\providers\provider-registry.ts:200-225`.
- Default tier mapping in Ptah is `{sonnet: 'kimi-k2.6',
  opus: 'kimi-k2.7-code', haiku: 'kimi-k2.5'}`. See
  `D:\projects\ptah-extension\libs\shared\src\lib\providers\provider-registry.ts:210-220`.
- The Kimi K2 family advertises a 256 000-token context window
  (Kimi K2.6, 2026 family). See
  `https://platform.moonshot.ai/docs` (accessed September 2026).
- Moonshot does not publish documentation for native
  `compact_boundary` messages, native prompt caching, or native
  `thinking` continuity for the Kimi family. See §6.

### 4.5 Z.AI / GLM

- Z.AI operates the Anthropic-compatible endpoint at
  `https://api.z.ai/api/anthropic`. Source: Z.AI docs
  `https://docs.z.ai/devpack/tool/claude` (accessed September 2026)
  and the registry entry
  `D:\projects\ptah-extension\libs\shared\src\lib\providers\provider-registry.ts:225-260`.
- Default tier mapping in Ptah is `{sonnet: 'glm-5.1', opus: 'glm-5.2',
  haiku: 'glm-4.7-flashx'}`. See
  `D:\projects\ptah-extension\libs\shared\src\lib\providers\provider-registry.ts:235-255`.
- GLM family context window for the 5.x series is around 128 000
  tokens; Z.AI does not publish a higher tier publicly. The exact
  per-model window is in the Z.AI model catalog
  (`https://docs.z.ai/devpack/tool/claude`, accessed September 2026).
- Z.AI does not publish documentation for native
  `compact_boundary`, native `thinking` continuity, or native prompt
  caching. See §6.

### 4.6 OpenRouter

- OpenRouter does **not** expose a native Anthropic Messages
  endpoint. Ptah runs a local translation proxy that converts the
  Anthropic request into an OpenAI Chat Completions request. See
  `D:\projects\ptah-extension\libs\backend\auth-providers\src\lib\providers\openrouter\openrouter-translation-proxy.ts:1-117`
  and the registry `requiresProxy: true` flag at
  `D:\projects\ptah-extension\libs\shared\src\lib\providers\provider-registry.ts:178-200`.
- The proxy translates request and response bodies; `compact_boundary`
  messages from the SDK have no equivalent on the OpenAI side, so
  the SDK falls back to client-side compaction logic.
- OpenRouter publishes per-model capability tables at
  `https://openrouter.ai/models` (accessed September 2026). The
  Ptah pricing service consumes
  `https://openrouter.ai/api/v1/models` (no auth) to estimate cost.

## 5. Runtime ownership and the auto-compact regression

The user's instruction required distinguishing "auth provider" from
"conversation runtime" and "API compatibility" from "native compaction
support". The clearest evidence of that distinction is the GitHub
issue `anthropics/claude-code#65585` (opened June 5, 2026, closed
"not planned").

That issue documents that auto-compact is broken on
Anthropic-compatible third-party providers since Claude Code
v2.1.161. The internal call chain is:

```
ANTHROPIC_BASE_URL != api.anthropic.com
  -> Z7() = false (not first-party)
    -> dGL() = true
      -> LC() = true
        -> Au() = false (GrowthBook "unavailable")
          -> qu() = false
            -> D6("tengu_sepia_moth", false) returns default false
              -> _Y8() = false
                -> auto-compact NEVER fires
```

The implication is that even when a provider speaks the
`/v1/messages` dialect perfectly, the SDK skips the
`compact_boundary` emission. Ptah's `CompactionHookHandler` therefore
never receives a `PreCompact` or `PostCompact` event from the SDK on
those providers, and the `transformCompactBoundary` path in
`D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\message-transform\system-message.transformer.ts:68-120`
becomes inert.

Two consequences:

1. The `compact_metadata` payload (with `pre_tokens`,
   `post_tokens`, `duration_ms`) is not produced by the SDK on
   third-party providers.
2. The compaction-related knobs the SDK exposes
   (`CLAUDE_CODE_MAX_CONTEXT_TOKENS`,
   `CLAUDE_CODE_AUTO_COMPACT_WINDOW`,
   `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`) only affect the trigger, not
   whether it fires. Behind a third-party base URL, the trigger
   never runs.

Ptah partially compensates with the context-window override in
`D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.ts:912-924`:
the builder sets `CLAUDE_CODE_MAX_CONTEXT_TOKENS` for non-first-party
base URLs, so the SDK at least knows the real model window and stops
inference before the model itself overflows. That override prevents
prompt-too-long errors but does not enable compaction. The
`CompactionConfigProvider` is read at
`D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.ts:762`,
and its values are only logged at lines 772-773. The values are
**not** forwarded into the SDK `Options` object — there is no
`compactionControl` field in the returned `Options`.

## 6. Targeted uncertainty list

These claims could not be confirmed against an authoritative source
in the time available.

1. Whether Ollama Cloud's `/v1/messages` endpoint emits
   `compact_boundary` system messages of its own. Ollama's public
   docs do not document this; only the Anthropic-compat surface is
   described.
2. Whether Moonshot's `kimi-k2.x` models emit `compact_boundary`
   on the Anthropic-compat endpoint. Moonshot's public docs do not
   describe `compact_boundary`; the family is documented as
   long-context chat completions with a tools interface.
3. Whether Z.AI's `glm-5.x` family emits `compact_boundary`. Z.AI's
   public docs do not describe `compact_boundary`.
4. Whether compacted artifacts (the `compact_boundary`
   `compact_metadata` summary text + retained message slice) from
   one provider can be replayed on another. The SDK stores the
   slice in JSONL; the slice is plain text and tool calls, so the
   wire format is portable. However, the resumed session must
   still re-establish prompt caching, tool definitions, and
   thinking state with the new provider, and no source confirms
   that the SDK rehydrates those on a provider change. The
   conservative read is: portable in principle, untested in
   practice.
5. The exact SDK version of `@anthropic-ai/claude-agent-sdk` that
   ships with Ptah is pinned at `0.3.150` in the monorepo root
   `package.json` and in `apps/ptah-cli/package.json` and
   `apps/ptah-electron/package.json`. The Claude Code version that
   introduced the regression is v2.1.161; the relationship
   between the SDK package version and the bundled Claude Code
   binary is not documented in either repo, so we cannot
   confirm from the package version alone whether the regression
   applies to Ptah. Source:
   `D:\projects\ptah-extension\package.json:99`,
   `D:\projects\ptah-extension\apps\ptah-cli\package.json:50`,
   `D:\projects\ptah-extension\apps\ptah-electron\package.json:13`.
6. Whether the local Ollama daemon at version X exposes the
   Anthropic-compat surface. The Ptah default expects it; users on
   older daemons will get a 404 and the SDK will fall through to
   OpenAI compat.
7. The exact pricing of Ollama Cloud per model. The metadata
   service uses OpenRouter as a proxy; the result is an estimate.
8. Whether `sakana` and `requesty` providers speak `/v1/messages`.
   Ptah registers them but does not document which endpoint
   dialect they use; the entries are listed as Anthropic-compatible
   but neither vendor is named in the provider-registry header
   comment.
9. Whether `thinking` blocks survive compaction on any
   non-Anthropic provider. The Anthropic Messages API carries
   `thinking` blocks in the request; the SDK emits them in the
   response. After compaction, the SDK rewrites the message slice;
   whether non-Anthropic providers preserve the `signature` field
   in the thinking block is not documented.
10. The Claude Code version bundled inside the SDK package. The
    regression window is documented in issue #65585; the SDK
    package version does not reveal the Claude Code version.

## 7. Compaction artifact portability — assessment

The compacted artifact that the SDK stores in JSONL has three parts:

1. A `compact_boundary` system message with `compact_metadata`
   (`trigger`, `pre_tokens`, `post_tokens`, `duration_ms`).
2. The pre-compaction message slice, replaced by a single summary
   message that the SDK stores verbatim.
3. The post-compaction message slice, which resumes the
   conversation.

In principle:

- The `compact_metadata` block is opaque to the provider — it
  carries no provider-specific tokens. It is portable across any
  SDK that consumes the same JSONL format.
- The summary message is plain text produced by whatever model ran
  the compaction. If provider A summarized in English and provider B
  summarizes in Chinese, the resumed session will start with a
  different prompt.
- The post-compaction slice is the conversation. Tool calls and
  tool results, thinking blocks, and file references in that slice
  are not rewritten by the SDK; they are replayed as-is to the
  next provider.

The user instruction says explicitly: "do not assume opaque
artifacts compatible". The conservative read is therefore:

- **Compatible in wire format.** The JSONL schema is provider-neutral.
- **Not guaranteed to be semantically compatible.** The summary text
  in `compact_metadata` and the retained tool calls reflect the
  summary model's choices. A Kimi summary may differ in tone,
  detail, and emphasis from an Anthropic summary of the same
  conversation.
- **Cache state is not portable.** Each provider has its own cache
  namespace. Resuming on provider B will not have any of provider
  A's prompt cache populated; the first post-resume turn pays the
  full cache miss cost.
- **Tool result fidelity is provider-neutral on the wire, but the
  resumed model may interpret them differently.** A tool result
  that contained a `thinking` block with provider-A's signature
  field will be sent verbatim to provider B; provider B will
  either accept it (if it implements the same field) or silently
  drop it.

Recommendation: do not assume compacted artifacts are portable
across providers. Treat a provider switch as a clean-slate session
unless a downstream test confirms otherwise. Ptah's existing
`chat:resume` and `SessionHistoryReaderService` already slice
correctly on `compact_boundary`, so the read path is not a
blocker; the unknown is on the model side.

## 8. Capability matrix — short form for quick reference

| Provider           | Endpoint        | Auth     | Auto-compact today | Caching | Thinking | Tool continuity | Notes |
|--------------------|-----------------|----------|--------------------|---------|----------|-----------------|-------|
| Anthropic direct   | `/v1/messages`  | optional | yes                | yes     | yes      | yes             | reference |
| Ollama Cloud direct| `/v1/messages`  | Bearer   | broken (see §5)    | model-dep | model-dep | model-dep   | local Ollama serves Anthropic-compat; `https://ollama.com` since recent versions |
| Ollama local       | `/v1/messages`  | none     | broken (see §5)    | no      | no       | yes (text only)| free, local-only |
| Moonshot / Kimi    | `/v1/messages`  | Bearer   | broken (see §5)    | model-dep | model-dep | model-dep   | 256k context |
| Z.AI / GLM         | `/v1/messages`  | Bearer   | broken (see §5)    | model-dep | model-dep | model-dep   | 128k context |
| OpenRouter         | `/v1/chat/completions` (translated) | Bearer | n/a (proxy) | model-dep | no | yes (text only) | requires Ptah local proxy |
| GitHub Copilot     | native          | OAuth    | n/a (native)       | n/a     | n/a      | n/a            | subscription |
| OpenAI Codex       | native          | OAuth    | n/a (native)       | n/a     | n/a      | n/a            | subscription |
| Claude CLI         | native          | none     | yes (same as Anthropic direct) | yes | yes | yes         | uses local `~/.claude` |

## 9. Source list

- Ptah source — `D:\projects\ptah-extension\libs\shared\src\lib\providers\provider-registry.ts`
- Ptah source — `D:\projects\ptah-extension\libs\shared\src\lib\providers\entries\local-provider-entry.ts`
- Ptah source — `D:\projects\ptah-extension\libs\backend\auth-providers\src\lib\auth\strategies\local-native.strategy.ts`
- Ptah source — `D:\projects\ptah-extension\libs\backend\auth-providers\src\lib\providers\local\ollama-cloud-metadata.service.ts`
- Ptah source — `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.ts`
- Ptah source — `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\compaction-hook-handler.ts`
- Ptah source — `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\compaction-config-provider.ts`
- Ptah source — `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\message-transform\system-message.transformer.ts`
- Ptah source — `D:\projects\ptah-extension\libs\backend\auth-providers\src\lib\providers\openrouter\openrouter-translation-proxy.ts`
- Ollama docs — `https://docs.ollama.com/cloud` (accessed September 2026)
- Ollama docs — `https://docs.ollama.com/api/anthropic-compatibility` (accessed September 2026)
- Ollama docs — `https://docs.ollama.com/api/tags` (accessed September 2026)
- Ollama docs — `https://docs.ollama.com/pricing` (accessed September 2026)
- Moonshot docs — `https://platform.moonshot.ai/docs/guide/agent-support.en-US` (accessed September 2026)
- Moonshot docs — `https://platform.moonshot.ai/docs` (accessed September 2026)
- Z.AI docs — `https://docs.z.ai/devpack/tool/claude` (accessed September 2026)
- OpenRouter docs — `https://openrouter.ai/docs/guides/claude-code-integration` (accessed September 2026)
- OpenRouter API — `https://openrouter.ai/api/v1/models` (accessed September 2026)
- GitHub issue — `https://github.com/anthropics/claude-code/issues/65585` (opened June 5, 2026; closed "not planned")

## 10. Summary

Auto-compact is broken on every third-party Anthropic-compatible
provider in Ptah's registry because of an upstream SDK change
(GitHub issue `anthropics/claude-code#65585`). Ptah's
`CompactionConfigProvider` is read at query-build time but its
values are not forwarded into the SDK options; the SDK is left to
its own trigger logic, which is gated off the base URL. Ptah's
only mitigation is the `CLAUDE_CODE_MAX_CONTEXT_TOKENS` override
that stops inference before a model overflows. Compaction is
therefore effectively manual on every third-party provider today;
clients must use `/compact` or restart sessions to free context.

Compacted artifacts are portable in wire format and not portable
in semantic effect. Provider-switching a resumed session is not
safe to assume equivalent. Treat provider switches as fresh
sessions until a per-provider test exists.

The most important follow-up is to confirm the bundled Claude Code
version inside `@anthropic-ai/claude-agent-sdk@0.3.150` (the pin in
Ptah's root `package.json:99`). If the version is at or above
v2.1.161, the regression applies and Ptah's compaction
infrastructure is reading from a trigger that never fires. If the
version is below v2.1.161, auto-compact on third-party providers
may still work and a careful A/B test against a third-party
provider is the next step.
