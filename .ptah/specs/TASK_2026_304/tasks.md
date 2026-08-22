# Batch breakdown — TASK_2026_304

Ordering is dependency-driven: backend seam first (1–3), then the two correctness
holes that would otherwise poison a pinned session (4), then lifetime and blast
radius (5–6), then the frontend that makes it reachable (7–8), then the adjacent
always-global lane (9), then verification (10).

Batches 1–6 are shippable on their own — they make the capability exist and be
driveable from RPC. Batch 7–8 is what a user sees. Batch 9 is independent and can
be cut without affecting the rest.

---

## Batch 1 — Session-level key on the resolver

**Lib:** `libs/backend/auth-providers`

- Add `resolveProviderProfileForSession(workspacePath, requestedModel, sessionProviderId?)`
  to `WorkspaceProviderProfileResolver` (`src/lib/auth/workspace-provider-profile-resolver.ts:89`).
- When `sessionProviderId` is present: skip the `hasOverrideForPath` gate
  (`:100-108`) and the `resolveActiveAuthForPath` read (`:110-111`), and feed the
  id straight into the existing `buildNativeAnthropicProfile` /
  `buildDirectApiKeyProfile` / `buildProxyProviderProfile` /
  `buildDirectThirdPartyProfile` branches.
- When absent: delegate to today's workspace behaviour, unchanged. Keep
  `resolveProviderProfileForWorkspace` as the no-session overload so existing
  callers and specs do not move.
- Every failure path keeps returning `undefined` (→ caller rides global auth). A
  session pinned to a provider whose credentials are missing must degrade, not
  throw.
- **Constraint:** reuse `applyProviderTiers` (tier writer #2). Do NOT add a fourth
  tier writer — see `libs/backend/auth-providers/CLAUDE.md`, "FOUR sites populate
  or read the tier vars".

**Done when:** a unit spec resolves two different profiles for the same
`workspacePath` given two different `sessionProviderId` values, and resolves
today's profile when the argument is omitted.

---

## Batch 2 — RPC contract: `providerId` on the chat namespace

**Libs:** `libs/shared`, `libs/backend/rpc-handlers`

- Add `providerId?: string` to `ChatStartParams`, `ChatContinueParams` and
  `ChatResumeParams` (`libs/shared/src/lib/types/rpc/rpc-chat.types.ts:37,115,~210`),
  mirroring how `ptahCliId` already sits on start and resume. **`ChatContinueParams`
  gets it too** — its absence is why the Ptah-CLI lane needs an in-memory map that
  does not survive a restart.
- Extend the chat Zod schemas in `rpc-handlers` accordingly (schemas are mandatory
  at the boundary).
- **No `ALLOWED_METHOD_PREFIXES` change** — this adds a field to an existing
  namespace, not a new namespace. The dual-registration rule does not fire here;
  say so in the PR so a reviewer does not go looking.

**Done when:** the new field type-checks through the shared contract and is
accepted/rejected correctly by the schema specs.

---

## Batch 3 — Wire the session provider through `ChatSessionService`

**Lib:** `libs/backend/rpc-handlers`

- `chat:start` (`src/lib/chat/session/chat-session.service.ts:433`) and the
  `chat:continue` resume (`:1009`) call `resolveProviderProfileForSession`, passing
  `params.providerId`.
- Record the resolved `providerId` per session in a tab/session-keyed map, in the
  shape `ChatPtahCliService.ptahCliSessions` already uses, so a `chat:continue`
  that omits the field still resumes on the session's own provider. The param
  wins when present; the map is the fallback; the workspace path is the fallback
  below that.
- Leave the `ptahCliId` branch (`:354`) ahead of this one — a Ptah-CLI tab keeps
  its existing dispatch.

**Done when:** start + continue + resume all run a pinned session against the same
provider across turns, verified with a spec that flips the ambient/global provider
between turns and asserts the session does not follow it.

---

## Batch 4 — Two correctness holes a pinned session would otherwise inherit

**Libs:** `libs/backend/auth-providers`, `libs/backend/rpc-handlers`

- **Tier blanking.** `applyProviderTiers`
  (`workspace-provider-profile-resolver.ts:~375-400`) currently assigns only truthy
  values, and `SdkQueryOptionsBuilder` spreads `...process.env` first
  (`sdk-query-options-builder.ts:747-750`) — so an unset tier key leaks the global
  provider's id into a pinned session. Mirror the lane path
  (`provider-auth-resolver.ts:389-395`): assign present-but-`undefined` keys for
  every `ALL_TIER_ENV_KEYS` entry the snapshot does not set. Never `delete`, never
  serialize the env.
- **Session-scoped model.** Replace the ambient
  `modelSettings.selectedModel.get()` reads (`chat-session.service.ts:416`, `:1004`)
  with, in order: `params.model` → the session's provider-scoped model → the
  existing ambient read. A session pinned to provider X must resolve its model from
  X's catalogue, not from whichever workspace is focused.

**Done when:** a spec pins session A to a provider with no `defaultTiers`, sets a
conflicting global tier map, and asserts the subprocess env carries no global tier
id; and a second spec asserts the model of a pinned session does not change when
the ambient workspace selection changes.

---

## Batch 5 — Proxy lifetime: scope key + teardown

**Lib:** `libs/backend/auth-providers`

- Generalize `ProviderProxyPool.key(workspacePath, providerId)`
  (`provider-proxy-pool.ts:131`) to `key(scopeId, providerId)`, where `scopeId` is
  the tabId for a session-pinned session and the workspace path otherwise.
  `disposeForScope` is already prefix-based and generalizes unchanged.
- Add a disposal call on session end so a closed tab does not leak a live proxy.
  Respect the header's rule: no idle TTL, teardown is event-driven only.
- Credential fingerprinting is unchanged — a key/endpoint change must still
  invalidate the entry.

**Done when:** two concurrently pinned sessions in one workspace hold two entries
on distinct ports, and ending one disposes exactly one.

---

## Batch 6 — Stop the global auth reset from nuking live sessions

**Lib:** `libs/backend/rpc-handlers`

- `auth:saveSettings` calls `sdkAdapter.reset()` process-wide
  (`src/lib/handlers/auth-rpc.handlers.ts:424`). Scope it: a save that targets one
  workspace or one provider must dispose only the affected proxy entries and must
  not reset sessions pinned elsewhere.
- Where the saved scope genuinely is global, today's behaviour stays.

**Done when:** a spec saves settings for workspace A and asserts a pinned session
in workspace B keeps streaming with its own profile.

---

## Batch 7 — Per-tab provider + model state in the webview

**Libs:** `libs/frontend/chat-state`, `libs/frontend/core`, `libs/frontend/chat`

- Move provider selection off the root singleton. `PtahCliStateService` holds one
  `_selectedAgentId` for the whole webview
  (`libs/frontend/core/src/lib/services/ptah-cli-state.service.ts:22`) and
  `MessageSenderService` reads it at send time
  (`libs/frontend/chat/src/lib/services/message-sender.service.ts:391`). Add
  `providerId` (and the tab's model) to the per-tab record in `chat-state`, keep
  the root service as the catalogue/default source only.
- `MessageSenderService` sends the ACTIVE TAB's provider on start, continue and
  resume.
- Restore the pin on session load — `session-loader.service.ts:813` already
  re-attaches `ptahCliId`; extend the same path to `providerId`.
- This is the batch that also fixes the existing Ptah-CLI limitation: today
  switching agents switches it for every tab.

**Done when:** two open tabs hold two different provider pins across a webview
reload, and a message sent from tab B carries tab B's provider.

---

## Batch 8 — Provider picker in the composer

**Libs:** `libs/frontend/chat-ui`, `libs/frontend/chat`

- Per-tab provider picker next to the model picker, listing configured Anthropic-
  compatible providers plus Ptah-CLI agents, with the default (= inherit
  workspace/global) as an explicit, obvious first entry.
- The model list follows the picked provider's catalogue.
- Unconfigured provider → surface the existing `AUTH_REQUIRED` error code path
  rather than a dead session.
- `ChangeDetectionStrategy.OnPush`, signals, `inject()` — house rules.

**Done when:** a user can pin a tab from the UI, see the model list change with it,
and get a clear prompt when the picked provider has no credentials.

---

## Batch 9 — Close the gateway always-global hole (independent, cuttable)

**Lib:** `libs/backend/gateway-chat-bridge`

- `startNew` and `resumeSession` pass no `providerProfile`, so a Discord/Slack/
  Telegram turn rides the process-global auth even for an explicitly pinned
  workspace. Inject the resolver and pass the workspace profile — the bridge
  already holds `workspaceRoot`.
- Gateway turns get the WORKSPACE profile, not a session pin; there is no per-tab
  concept on that surface.

**Done when:** a gateway turn in a pinned workspace runs on that workspace's
provider.

---

## Batch 10 — Verification sweep

- `npm run typecheck:all`, `npm run lint:all`, `npm run test`.
- Regression floor, explicitly asserted: an install with **no** provider pin
  anywhere behaves exactly as before — `resolveProviderProfileForSession` returns
  `undefined`, the session rides global auth, no proxy entry is created.
- Manual: two tabs, one workspace, Claude + Codex, both streaming at once; kill one
  tab and confirm exactly one proxy goes away; restart the host and confirm both
  pins come back.

---

## Explicitly not in this task

- **Per-workspace credentials.** `IAuthSecretsService.getProviderKey(providerId)`
  has no scope argument. Namespacing the slot (as `PtahCliRegistry` already does
  per agent id) is a separate task with its own migration surface.
- **Scoping OAuth token state.** Copilot/Codex tokens are machine-global by design
  and shared across isolated proxies on purpose.
- **Making provider pinning the default.** The resolver stays opt-in; an install
  that pins nothing keeps today's single-provider behaviour.
