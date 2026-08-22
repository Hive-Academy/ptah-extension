# Context — per-session provider selection

## What the user asked

> We are relying solely on the Claude Agent SDK and only one provider for the
> whole session. Is there a way to have different providers per session — run one
> session with Claude and another one, in the same workspace, on Codex? We tried
> to have per-workspace configuration, so different projects and workspaces can
> have different configurations and settings including auth providers.

Follow-up: _"are you sure it's that easy, we have plenty of plumbing around
this?"_ — the answer is no, it is not that easy. This document records what was
verified by reading the code, so the batch plan is not built on a summary.

## The load-bearing architectural fact

There is exactly **one** in-process agent engine: the Claude Agent SDK. Codex and
Copilot are not alternate in-process engines on the chat path — they are reached
through local Anthropic↔OpenAI translation proxies
(`libs/backend/auth-providers/src/lib/providers/codex/codex-translation-proxy.ts`,
`.../copilot/copilot-translation-proxy.ts`). "Selecting a provider" therefore
means pointing `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` at a localhost proxy
for that one query. That is why per-session provider selection is a plumbing
question and not an engine rewrite.

The real `@openai/codex-sdk` and the `@github/copilot` binary live only in the
CLI-agent lane (`libs/backend/cli-agent-runtime`), which is a different product
surface and is already fully multi-vendor per task.

## What already works today (verified by reading)

**The per-call seam is complete, end to end.**

- `AgentSessionStartConfig.providerProfile` is a per-session parameter
  (`libs/shared/src/lib/types/agent-adapter.types.ts:138`, resume at `:161`).
- `SdkAgentAdapter.startChatSession` destructures it and derives
  `effectiveCliJsPath` / `effectiveAuthEnv` / the profile's model from it
  (`libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:474-526`).
- `SdkQueryOptionsBuilder` resolves `authEnvOverride ?? this.authEnv`
  (`libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:591`) and
  merges it into the SUBPROCESS env — `process.env` is never mutated.
- `ProviderProxyPool` was built for exactly this: one running proxy per
  `(workspace, provider)` on its own ephemeral port, with a credential
  fingerprint that invalidates the entry when anything baked in at construction
  changes (`libs/backend/auth-providers/src/lib/auth/provider-proxy-pool.ts:1-133`).
  Its own header states the isolation model: the PORT is isolated, the OAuth AUTH
  STATE is deliberately shared.

**Per-workspace settings and provider already ship, opt-in.**
`WorkspaceScopeResolver` writes path-hashed keys inside the single
`~/.ptah/settings.json` (`app.<type>.workspace.<sha256-16>.<key>`), the UI already
exposes `applyTo: 'global' | 'app' | 'workspace'` via `auth:saveSettings`, and
`WorkspaceProviderProfileResolver` builds an isolated profile plus a dedicated
proxy for a workspace that carries an explicit override.

**Multi-vendor concurrently already works on two surfaces:** a chat tab routed to
a Ptah-CLI agent (`ptahCliId`) resolves its own profile, proxy and secret slot per
agent id (`libs/backend/rpc-handlers/src/lib/chat/ptah-cli/chat-ptah-cli.service.ts:85-128`),
and rival-CLI agent tasks pick their adapter per spawn.

## What does not work, and why it is not a one-liner

1. **The resolver is keyed on the workspace and gated.**
   `resolveProviderProfileForWorkspace(workspacePath, requestedModel)`
   (`workspace-provider-profile-resolver.ts:89`) returns `undefined` unless
   `hasOverrideForPath('anthropicProviderId' | 'authMethod', …)` (`:100-108`).
   Both chat call sites pass the same path
   (`chat-session.service.ts:433-437` start, `:1009-1013` resume), so two tabs on
   one folder cannot differ. This is the actual scope ceiling.

2. **The proxy pool has no session-scoped lifetime.** Key is
   `${workspacePath}::${providerId}` (`provider-proxy-pool.ts:114,131`), teardown
   is `disposeForScope(workspacePath)` on workspace removal, and there is
   deliberately **no idle TTL** — the header explains that an aggressive TTL could
   stop a proxy mid-stream. Session-pinned entries with no disposal hook would
   leak a live proxy per closed tab.

3. **The model for a turn is ambient, not session-scoped.** Both call sites read
   `this.modelSettings.selectedModel.get()` (`chat-session.service.ts:416` and
   `:1004`), which resolves through the ACTIVE workspace. A different provider has
   a different catalogue, so a per-session provider without a per-session model is
   half a feature.

4. **Tier env is a documented minefield.** `libs/backend/auth-providers/CLAUDE.md`
   records three separate writers of `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL`,
   each carrying its own copy of the precedence chain, and warns in terms: _"If you
   add a fifth site, wire the derivation into it"_ — TASK_2026_262 found writers #2
   and #3 one batch apart, and the failure mode is a silent provider 404. This task
   must extend writer #2 (`applyProviderTiers`) and must NOT create a fourth
   writer.

5. **A workspace-pinned session can still inherit global tier ids.**
   `sdk-query-options-builder.ts:747-750` spreads `...process.env` first, and
   `applyProviderTiers` only assigns truthy values — so a tier key the snapshot did
   not set falls through to whatever `ProviderModelsService.applyPersistedTiers`
   wrote globally. The lane path already solves this by assigning present-but-
   `undefined` keys (`provider-auth-resolver.ts:389-395`); the workspace snapshot
   path does not.

6. **`auth:saveSettings` resets the adapter process-wide**
   (`auth-rpc.handlers.ts:424`), so changing one tab's or one workspace's provider
   disturbs every live session.

7. **Frontend selection is global, including in the lane held up as the template.**
   `PtahCliStateService` is a root singleton with one `_selectedAgentId` signal
   (`libs/frontend/core/src/lib/services/ptah-cli-state.service.ts:22`), and
   `MessageSenderService` reads it directly at send time (`message-sender.service.ts:391`).
   Worse, `ChatContinueParams` carries **no** provider id
   (`libs/shared/src/lib/types/rpc/rpc-chat.types.ts:115-145` — `ptahCliId` exists
   on start and on resume, not on continue), so the only thing remembering a tab's
   provider mid-conversation is an in-memory `Map` in `ChatPtahCliService`. It does
   not survive a host restart. Per-tab state in the webview is the largest single
   chunk of this task, and it fixes an existing limitation of the Ptah-CLI lane
   along the way.

8. **The gateway lane never passes a profile at all.** `GatewayChatBridge`'s
   `startNew` / `resumeSession` omit `providerProfile`, so a Discord/Slack turn
   rides the process-global auth even for a workspace that is explicitly pinned.

## Deliberately out of scope

- **Per-workspace credentials.** `IAuthSecretsService.getProviderKey(providerId)`
  has no scope argument — one key per provider, machine-wide. Namespacing the slot
  is possible (the Ptah-CLI registry already does it per agent id) but is a
  separate decision with its own migration surface.
- **Scoping OAuth token state.** Copilot and Codex tokens are machine-global by
  design and are deliberately shared across isolated proxies
  (`provider-proxy-pool.ts:19-26`). Nothing here changes that.
- **Making the resolver non-opt-in.** A default install stays single-provider; a
  session only leaves the global path when something explicitly asks it to.

## Definition of done

Two chat tabs open on the same workspace folder, one pinned to Claude and one to a
Codex/Copilot/OpenRouter profile, both streaming concurrently, each on its own
proxy port, each resolving models from its own catalogue — surviving a tab reload
and a host restart, with no cross-tab tier or auth leakage, and with the
single-provider default path unchanged.
