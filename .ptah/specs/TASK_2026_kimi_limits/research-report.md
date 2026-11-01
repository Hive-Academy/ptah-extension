# Research Report - TASK_2026_kimi_limits

## Question

- Decision this supports: choose how Ptah should add Kimi Code subscription usage to the existing plan-limit displays.
- Question: which reader, credential selection, owner mapping, and fallback can support Kimi Code without attributing one account's usage to another owner?
- Bounds: this investigation did not make authenticated API requests, inspect credentials, change source files, run builds or tests, or examine unofficial usage endpoints beyond the official current and legacy clients.

## Answer

Add a Kimi Code reader for the official `GET /coding/v1/usages` API, and reuse `IKimiCodeAuthService` for OAuth refresh and shared credentials. This option fits the current reader architecture and needs no new frontend or RPC contract. The implementation must keep direct lane keys, the shared provider key, and the shared OAuth login as distinct owner cases. Keep ledger evidence as the fallback, and reject contradictory or malformed API values instead of displaying them as authoritative.

## Evidence

| Claim | Source | Date | Verified how |
| --- | --- | --- | --- |
| Plan readers are functions in a provider-id record, not a plugin registry. | `libs/backend/auth-providers/src/lib/quota/readers/plan-usage-reader.types.ts:4-11`, `libs/backend/auth-providers/src/lib/quota/plan-usage.service.ts:145-170` | undated; read 2026-11-01 | read the source |
| `PlanUsageService` has no `kimi-code` reader. | `libs/backend/auth-providers/src/lib/quota/plan-usage.service.ts:145-170` | undated; read 2026-11-01 | read the source |
| A missing reader returns `provider-unsupported`. | `libs/backend/auth-providers/src/lib/quota/plan-usage.service.ts:277-308` | undated; read 2026-11-01 | read the source |
| The formatter turns a missing snapshot into `limits not tracked`. | `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-limit.formatter.ts:104-108` | undated; read 2026-11-01 | read the source |
| Kimi lanes can use a direct key or the shared host connection. | `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts:250-273`, `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts:1218-1245` | undated; read 2026-11-01 | read the source |
| A real Kimi lane key already produces a credential owner. | `libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.spec.ts:399-410` | undated; read 2026-11-01 | read the test |
| Kimi OAuth and API-key request credentials have one existing service surface. | `libs/backend/auth-providers/src/lib/providers/kimi-code/kimi-code-provider.types.ts:29-31`, `libs/backend/auth-providers/src/lib/providers/kimi-code/kimi-code-provider.types.ts:52-77` | undated; read 2026-11-01 | read the source |
| The current official client requests `{kimiCodeBaseUrl()}/usages` with a Bearer token. | [official `managed-usage.ts`, pinned commit](https://github.com/MoonshotAI/kimi-code/blob/a2afdbc7d1fa0737d45d5780cc6c2bd38e477b55/packages/oauth/src/managed-usage.ts#L8-L23), [request headers](https://github.com/MoonshotAI/kimi-code/blob/a2afdbc7d1fa0737d45d5780cc6c2bd38e477b55/packages/oauth/src/managed-usage.ts#L218-L246) | commit 2026-10-30; read 2026-11-01 | read official source at commit `a2afdbc7d1fa0737d45d5780cc6c2bd38e477b55` |
| The official response supports five-hour, seven-day, and two monthly entries. | [official usage tests](https://github.com/MoonshotAI/kimi-code/blob/a2afdbc7d1fa0737d45d5780cc6c2bd38e477b55/packages/oauth/test/managed-usage.test.ts#L95-L142) | commit 2026-10-30; read 2026-11-01 | read official tests |
| Users report zero ratios that contradict actual usage and legacy fields. | [issue 3908](https://github.com/MoonshotAI/kimi-code/issues/3908), [issue 3951](https://github.com/MoonshotAI/kimi-code/issues/3951) | 2026-09-18 and 2026-09-20; read 2026-11-01 | read the issue reports |
| Monthly entries can be absent on some plans. | [issue 4046](https://github.com/MoonshotAI/kimi-code/issues/4046), [official optional-entry tests](https://github.com/MoonshotAI/kimi-code/blob/a2afdbc7d1fa0737d45d5780cc6c2bd38e477b55/packages/oauth/test/managed-usage.test.ts#L116-L142) | issue 2026-09-27; source 2026-10-30 | read the issue and official tests |

## Options

| Option | Fit here | Cost to adopt | Known failure mode |
| --- | --- | --- | --- |
| Direct official `/usages` reader, with existing Kimi authentication | Matches the current reader record and shared owner snapshots. Reuses the dashboard, lane RPC, `$limits`, and `ptah_agent_list` paths. | One reader, owner and discovery changes, DI factory changes, and focused tests. | False zero ratios, optional monthly entries, credential-owner races, and unverified API-key acceptance. |
| Existing local `kimi web` server `/api/v1/oauth/usage` | Supplies the same four normalized windows through a local API. | Requires a running server and its local Bearer token. Ptah must not start a daemon for a passive limit read. | The server or token is absent, so this cannot be the primary source. |
| Ledger and error-derived evidence only | Already preserves evidence after a source failure. | No provider API integration. | It cannot show current percentages before a lane emits usable limit evidence. |
| Legacy response fields as the primary parser | The archived official legacy client parses `usage`, `limits`, `detail`, and `window`. | A second compatibility contract with less current evidence. | Legacy fields can disagree with current ratios. The legacy repository was archived in September 2026. |

## Current plan-limit architecture

### Reader contract and registration

- `PlanUsageReader` accepts one `PlanUsageReadRequest` and returns a `PlanUsageReading` (`libs/backend/auth-providers/src/lib/quota/readers/plan-usage-reader.types.ts:57-68`, `libs/backend/auth-providers/src/lib/quota/readers/plan-usage-reader.types.ts:76-87`).
- A target carries an owner and an optional credential reference. It does not carry a secret (`libs/backend/auth-providers/src/lib/quota/readers/plan-usage-reader.types.ts:20-33`, `libs/backend/auth-providers/src/lib/quota/readers/plan-usage-reader.types.ts:44-54`).
- `PlanUsageService` constructs readers for Anthropic, Codex, Ollama Cloud, Antigravity, OpenCode, OpenCode Go, OpenCode Zen, and Grok. Kimi Code is absent (`libs/backend/auth-providers/src/lib/quota/plan-usage.service.ts:145-170`).
- The service caches owner snapshots for 30 seconds and shares concurrent reads for the same owner (`libs/backend/auth-providers/src/lib/quota/plan-usage.service.ts:83-89`, `libs/backend/auth-providers/src/lib/quota/plan-usage.service.ts:177-204`).
- The service resolves a referenced credential before a normal account read. Reader exceptions become `service-unavailable` (`libs/backend/auth-providers/src/lib/quota/plan-usage.service.ts:277-308`, `libs/backend/auth-providers/src/lib/quota/plan-usage.service.ts:310-369`).
- The Codex reader maps primary and secondary windows and marks used and reset values as `provider-api` (`libs/backend/auth-providers/src/lib/quota/readers/codex-plan-usage.reader.ts:51-64`, `libs/backend/auth-providers/src/lib/quota/readers/codex-plan-usage.reader.ts:67-120`).
- The OpenCode Go reader is the closest HTTP example. It selects credentials, disables redirects, sends a Bearer request, and maps rolling, weekly, and monthly windows (`libs/backend/auth-providers/src/lib/quota/readers/opencode-go-plan-usage.reader.ts:39-50`, `libs/backend/auth-providers/src/lib/quota/readers/opencode-go-plan-usage.reader.ts:87-170`).
- Ollama Cloud establishes a window set only after a valid balance response. This is the relevant pattern for malformed or incomplete Kimi responses (`libs/backend/auth-providers/src/lib/quota/readers/ollama-cloud-plan-usage.reader.ts:216-244`).

### Owner, window, usage, reset, and provenance models

- An owner is an `account`, `credential`, `cli-store`, or `unknown` identity. Its key contains a fingerprint, not the original secret (`libs/shared/src/lib/types/plan-limit.types.ts:98-122`).
- A window has a stable key, kind, optional duration, optional used value, and optional reset. Used and reset values have separate provenance fields (`libs/shared/src/lib/types/plan-limit.types.ts:39-96`).
- Provenance can be `provider-api`, `provider-unofficial`, `stream-event`, `error-derived`, or `estimated` (`libs/shared/src/lib/types/plan-limit.types.ts:23-37`).
- Request counts and token usage remain separate from allowance windows (`libs/shared/src/lib/types/plan-limit.types.ts:132-162`).
- `ProviderOwnerResolver` is the single identity-hashing site. It rejects absent and placeholder credentials (`libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.ts:1-18`, `libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.ts:82-92`, `libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.ts:434-444`).
- Generic ptah-cli ownership uses the lane key. Only Ollama Cloud currently has a shared-provider-key fallback (`libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.ts:502-535`).
- Existing tests prove that a real `ptahCli.<id>` key under `kimi-code` produces a credential owner. A missing key produces an unknown owner (`libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.spec.ts:399-410`).

### Discovery and lane lookup gaps

- `planOwnerRead` has no Kimi branch. A Kimi owner therefore receives no read plan (`libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/plan-owner-read.ts:103-111`, `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/plan-owner-read.ts:130-184`).
- Selected-provider discovery has no Kimi branch. Its ptah-cli discovery includes only Ollama Cloud agents (`libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/plan-limit-owner-discovery.service.ts:182-189`, `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/plan-limit-owner-discovery.service.ts:428-446`, `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/plan-limit-owner-discovery.service.ts:592-606`).
- Direct lane lookup special-cases only Ollama Cloud. Other ptah-cli lanes need an owner remembered from a run (`libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/lane-limit-lookup.service.ts:252-272`).
- Spawn-time owner rules include Claude and Ollama Cloud, but not Kimi Code (`libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-lane-plan-limits.ts:81-87`, `libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-lane-plan-limits.ts:127-139`).
- The system-CLI owner resolver needs no Kimi rule because Kimi Code is a ptah-cli provider (`libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/lane-owner.resolver.ts:117-132`, `libs/shared/src/lib/providers/entries/kimi-code-provider-entry.ts:123-142`).

### Display paths

- `ptah_agent_list` uses the shared agent list and limit formatter. A missing snapshot displays `limits not tracked`, and `provider-unsupported` displays `no reader for provider` (`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-limit.formatter.ts:104-122`, `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-limit.formatter.ts:249-260`).
- Electron enables `lanePlanLimits`. Its RPC handler uses the same agent list and limit path, then returns display-only cells (`apps/ptah-electron/src/rpc-host-profile.ts:46-48`, `libs/backend/rpc-handlers/src/lib/handlers/lane-plan-limits-rpc.handlers.ts:128-147`, `libs/backend/rpc-handlers/src/lib/handlers/lane-plan-limits-rpc.handlers.ts:228-256`).
- `$limits` is a reference-counted live source. It calls `agent:getLanePlanLimits` and copies allow-listed fields (`libs/frontend/chat-ui/src/lib/organisms/ptah-ui/sources/ptah-ui-lane-limits.source.ts:39-67`, `libs/frontend/chat-ui/src/lib/organisms/ptah-ui/sources/ptah-ui-lane-limits.source.ts:129-177`).
- The lane RPC result contains no owner, account, or credential data (`libs/shared/src/lib/types/rpc/rpc-lane-plan-limits.types.ts:34-69`).
- Provider settings and the dashboard use `provider:getPlanLimits`. The backend snapshot service discovers owners and reads their usage (`libs/backend/rpc-handlers/src/lib/handlers/provider-rpc.handlers.ts:253-267`, `libs/backend/rpc-handlers/src/lib/services/plan-limits-snapshot.service.ts:84-101`, `libs/backend/rpc-handlers/src/lib/services/plan-limits-snapshot.service.ts:145-172`).
- The snapshot service preserves owner entries with ledger evidence after a timeout or read failure (`libs/backend/rpc-handlers/src/lib/services/plan-limits-snapshot.service.ts:175-241`).
- The frontend store retains the last valid snapshot. The generic provider account card loads and refreshes the selected provider (`libs/frontend/core/src/lib/services/plan-limits.store.ts:175-218`, `libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.ts:154-216`).
- No Kimi-specific frontend component or RPC type is required for the recommended implementation.

## Kimi Code authentication

### Credentials and owner cases

- `KimiCodeRequestCredential` is either an OAuth access token or an API key (`libs/backend/auth-providers/src/lib/providers/kimi-code/kimi-code-provider.types.ts:29-31`).
- `IKimiCodeAuthService` exposes status, request credential resolution, freshness checks, and forced refresh (`libs/backend/auth-providers/src/lib/providers/kimi-code/kimi-code-provider.types.ts:52-77`).
- `resolveRequestCredential` refreshes first, prefers a servable OAuth token, and then uses the stored API key (`libs/backend/auth-providers/src/lib/providers/kimi-code/kimi-code-auth.service.ts:124-143`).
- The credential store selects the configured OAuth credential or scans the credentials directory. It chooses the newest schema-valid file with scope `kimi-code` (`libs/backend/auth-providers/src/lib/providers/kimi-code/kimi-code-credential-store.ts:281-328`).
- Stored OAuth credentials require an access token, refresh token, expiry, scope, and token type. Refresh responses require a rotated refresh token (`libs/backend/auth-providers/src/lib/providers/kimi-code/kimi-code-credential.schemas.ts:14-23`, `libs/backend/auth-providers/src/lib/providers/kimi-code/kimi-code-credential.schemas.ts:37-45`).
- Keyless lanes use the shared host connection. A lane with its own key uses the direct API-key path (`libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts:250-273`, `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts:1218-1245`).
- The keyless proxy binds to the singleton Kimi auth service and uses a placeholder instead of a real lane secret (`libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts:1334-1355`).
- The translation proxy deliberately does not make a rotating OAuth access token the credential owner (`libs/backend/auth-providers/src/lib/providers/kimi-code/kimi-code-translation-proxy.ts:78-88`).

### Base URLs, refresh, and login

- Ptah configures Kimi Code with base URL `https://api.kimi.ai/coding/`, OAuth with API-key fallback, and subscription pricing (`libs/shared/src/lib/providers/entries/kimi-code-provider-entry.ts:123-142`).
- The CLI configuration reader infers `https://api.kimi.ai/coding/v1`. Its default OAuth host is `https://auth.kimi.ai` (`libs/backend/auth-providers/src/lib/providers/kimi-code/kimi-code-config.reader.ts:8-15`, `libs/backend/auth-providers/src/lib/providers/kimi-code/kimi-code-config.reader.ts:27-36`).
- The Kimi home resolver uses `~/.kimi-code`, its credentials directory, and `config.toml` (`libs/backend/auth-providers/src/lib/providers/kimi-code/kimi-code-home-resolver.ts:12-37`).
- The OAuth refresher posts a refresh-token form to `{oauthHost}/api/oauth/token`, disables redirects, and classifies rejected and transient responses (`libs/backend/auth-providers/src/lib/providers/kimi-code/kimi-code-oauth-refresher.ts:71-86`, `libs/backend/auth-providers/src/lib/providers/kimi-code/kimi-code-oauth-refresher.ts:122-150`).
- The translation proxy force-refreshes after an OAuth authentication failure (`libs/backend/auth-providers/src/lib/providers/kimi-code/kimi-code-translation-proxy.ts:61-75`).
- Login runs `kimi login --region <region>`, opens only validated HTTPS verification URLs, and confirms credentials after login (`libs/backend/auth-providers/src/lib/providers/kimi-code/kimi-code-login.service.ts:158-168`, `libs/backend/auth-providers/src/lib/providers/kimi-code/kimi-code-login.service.ts:231-268`, `libs/backend/auth-providers/src/lib/providers/kimi-code/kimi-code-login.service.ts:289-307`).
- The auth service warns when the CLI and Ptah API hosts differ (`libs/backend/auth-providers/src/lib/providers/kimi-code/kimi-code-auth.service.ts:478-493`).

## Official Kimi Code usage API

### Verified current source

The primary source is `MoonshotAI/kimi-code` commit `a2afdbc7d1fa0737d45d5780cc6c2bd38e477b55`, dated 2026-10-30 and retrieved on 2026-11-01.

- The official client defines `https://api.kimi.com/coding/v1` and `https://api.kimi.ai/coding/v1`. It appends `/usages` to the selected base URL ([`managed-usage.ts:8-23`](https://github.com/MoonshotAI/kimi-code/blob/a2afdbc7d1fa0737d45d5780cc6c2bd38e477b55/packages/oauth/src/managed-usage.ts#L8-L23)).
- The exact direct endpoints are `GET https://api.kimi.com/coding/v1/usages` and `GET https://api.kimi.ai/coding/v1/usages`.
- `KIMI_CODE_BASE_URL` can override the official client's base URL ([`managed-usage.ts:8-23`](https://github.com/MoonshotAI/kimi-code/blob/a2afdbc7d1fa0737d45d5780cc6c2bd38e477b55/packages/oauth/src/managed-usage.ts#L8-L23)).
- The request sends `Authorization: Bearer <accessToken>` and `Accept: application/json`. The official timeout is 8000 ms ([`managed-usage.ts:218-246`](https://github.com/MoonshotAI/kimi-code/blob/a2afdbc7d1fa0737d45d5780cc6c2bd38e477b55/packages/oauth/src/managed-usage.ts#L218-L246)).
- Official tests confirm both hosts, exact path validation, host rejection, and only the `Authorization` and `Accept` headers ([`managed-usage.test.ts:31-63`](https://github.com/MoonshotAI/kimi-code/blob/a2afdbc7d1fa0737d45d5780cc6c2bd38e477b55/packages/oauth/test/managed-usage.test.ts#L31-L63), [`managed-usage.test.ts:195-229`](https://github.com/MoonshotAI/kimi-code/blob/a2afdbc7d1fa0737d45d5780cc6c2bd38e477b55/packages/oauth/test/managed-usage.test.ts#L195-L229)).

The official test payload is:

```json
{
  "goods_version": 2,
  "usages": {
    "limit_5h": {
      "used_ratio": 0.3,
      "reset_time": "2026-09-11T18:00:00Z"
    },
    "limit_7d": {
      "used_ratio": 0.2,
      "reset_time": "2026-09-17T00:00:00Z"
    },
    "limit_month_total": {
      "used_ratio": 0.4,
      "reset_time": "2026-10-01T00:00:00Z"
    },
    "limit_month_code": {
      "used_ratio": 0.25,
      "reset_time": "2026-10-01T00:00:00Z"
    }
  }
}
```

Source: [official `managed-usage.test.ts:95-113`](https://github.com/MoonshotAI/kimi-code/blob/a2afdbc7d1fa0737d45d5780cc6c2bd38e477b55/packages/oauth/test/managed-usage.test.ts#L95-L113).

- `used_ratio` accepts a number or numeric string. The official client normalizes it to `usedRatio` ([`managed-usage.ts:108-137`](https://github.com/MoonshotAI/kimi-code/blob/a2afdbc7d1fa0737d45d5780cc6c2bd38e477b55/packages/oauth/src/managed-usage.ts#L108-L137), [`managed-usage.test.ts:116-142`](https://github.com/MoonshotAI/kimi-code/blob/a2afdbc7d1fa0737d45d5780cc6c2bd38e477b55/packages/oauth/test/managed-usage.test.ts#L116-L142)).
- A nonempty `reset_time` becomes `resetAt`. Monthly entries are optional ([`managed-usage.ts:108-137`](https://github.com/MoonshotAI/kimi-code/blob/a2afdbc7d1fa0737d45d5780cc6c2bd38e477b55/packages/oauth/src/managed-usage.ts#L108-L137), [`managed-usage.test.ts:116-142`](https://github.com/MoonshotAI/kimi-code/blob/a2afdbc7d1fa0737d45d5780cc6c2bd38e477b55/packages/oauth/test/managed-usage.test.ts#L116-L142)).
- The source also parses `boosterWallet`, but that value is not a subscription allowance window and is outside this task ([`managed-usage.ts:108-137`](https://github.com/MoonshotAI/kimi-code/blob/a2afdbc7d1fa0737d45d5780cc6c2bd38e477b55/packages/oauth/src/managed-usage.ts#L108-L137)).

### Reliability evidence and disagreement

- [Issue 3908](https://github.com/MoonshotAI/kimi-code/issues/3908), opened 2026-09-18, reports zero `usedRatio` values during verified usage on both official hosts.
- [Issue 3951](https://github.com/MoonshotAI/kimi-code/issues/3951), opened 2026-09-20, reports `usage.used = 100` and `usage.limit = 100` while `usages.limit_7d.used_ratio = 0`. The same account received a weekly-limit HTTP 403.
- [Issue 4046](https://github.com/MoonshotAI/kimi-code/issues/4046), opened 2026-09-27, reports absent monthly entries for a legacy plan.
- These reports disagree with the interpretation that every returned zero is authoritative. The implementation should accept a valid response shape, but reject an explicit legacy-field contradiction instead of displaying a known-false zero.
- The current official TypeScript client outranks the archived legacy Python client for the primary contract. Legacy fields are useful only as a consistency guard, not as the main source.

### Fallbacks

1. Return `service-unavailable` for network failure, timeout, malformed JSON, invalid values, or an explicit contradictory response. Let the existing snapshot service retain stale and ledger evidence (`libs/backend/rpc-handlers/src/lib/services/plan-limits-snapshot.service.ts:175-241`).
2. Keep monthly windows absent when the API omits them. Do not invent zero usage or a reset (`libs/shared/src/lib/types/plan-limit.types.ts:79-96`).
3. Preserve error-derived lane evidence. Add Kimi subscription wording only after real captured errors establish it (`libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/lane-limit-classifier.ts:167-196`, `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/lane-limit-classifier.ts:222-258`).
4. Keep generic HTTP 429 classification separate from subscription exhaustion (`libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/lane-rate-limit-classifier.ts:9-15`, `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/lane-rate-limit-classifier.ts:23-39`).
5. Consider the official local server only as a later optional fallback. It documents `GET /api/v1/oauth/usage` on `http://127.0.0.1:58627`, requires a local Bearer token, and returns normalized `limit5h`, `limit7d`, `monthTotal`, and `monthCode` fields ([official server API, lines 250-258](https://github.com/MoonshotAI/kimi-code/blob/a2afdbc7d1fa0737d45d5780cc6c2bd38e477b55/docs/zh/reference/server-api.md#L250-L258)). Do not start the server or invent token access for the first implementation.

## Recommended implementation plan

### 1. Add the reader

Add `libs/backend/auth-providers/src/lib/quota/readers/kimi-code-plan-usage.reader.ts`, following the HTTP and window-mapping patterns in `opencode-go-plan-usage.reader.ts:87-170` and `codex-plan-usage.reader.ts:67-120`.

- Inject the existing `IKimiCodeAuthService` and a narrow `PlanCredentialSource` surface. Do not read token files directly (`libs/backend/auth-providers/src/lib/providers/kimi-code/kimi-code-provider.types.ts:52-77`).
- For a lane target, resolve its real `ptahCli.<id>` key first. Use the shared Kimi connection only when the slot read succeeds and the value is missing or a placeholder (`libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts:250-273`).
- Do not use the shared connection after a secret-store read failure. That failure cannot prove which credential owns the quota (`libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.ts:722-744`).
- For the main provider target, use the shared connection directly (`libs/backend/auth-providers/src/lib/providers/kimi-code/kimi-code-auth.service.ts:124-143`).
- Require an API-key credential to match a credential owner's fingerprint. Require a CLI-store owner to receive an OAuth credential. Return `service-unavailable` on a race instead of attributing usage to the wrong owner (`libs/shared/src/lib/types/plan-limit.types.ts:98-122`).
- Use the fixed Ptah official endpoint `https://api.kimi.ai/coding/v1/usages`. Do not send credentials to an arbitrary configured host (`libs/shared/src/lib/providers/entries/kimi-code-provider-entry.ts:123-142`).
- Send only the Bearer and Accept headers. Disable redirects, use a bounded timeout, and do not log tokens or response bodies ([official request source](https://github.com/MoonshotAI/kimi-code/blob/a2afdbc7d1fa0737d45d5780cc6c2bd38e477b55/packages/oauth/src/managed-usage.ts#L218-L246)).
- On an OAuth authentication failure, use the existing forced-refresh behavior and retry at most once within the same time budget (`libs/backend/auth-providers/src/lib/providers/kimi-code/kimi-code-translation-proxy.ts:61-75`).
- Validate the boundary with Zod. Require a valid `usages` object before establishing the window set. Accept finite ratios from 0 to 1 in numeric or numeric-string form. Convert ratios to percentages and validate reset timestamps (`libs/backend/auth-providers/src/lib/quota/readers/ollama-cloud-plan-usage.reader.ts:216-244`).
- Reject a response when legacy fields explicitly contradict a zero ratio. Keep undocumented legacy fields out of the primary mapping ([issue 3951](https://github.com/MoonshotAI/kimi-code/issues/3951)).

Map the windows as follows:

| Upstream entry | Ptah key | Ptah kind | Label | Duration |
| --- | --- | --- | --- | --- |
| `limit_5h` | `five_hour` | `five_hour` | `Kimi Code · 5-hour` | 300 minutes |
| `limit_7d` | `weekly` | `weekly` | `Kimi Code · Weekly` | 10080 minutes |
| `limit_month_total` | `monthly` | `monthly` | `Kimi Code · Monthly total` | unknown; omit |
| `limit_month_code` | `other:monthly-code` | `monthly` | `Kimi Code · Monthly code` | unknown; omit |

The separate key for `limit_month_code` prevents a collision with `limit_month_total`. Used and reset provenance should be `provider-api` (`libs/shared/src/lib/types/plan-limit.types.ts:39-96`).

### 2. Resolve the shared connection owner

Change `libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.ts`.

- Add the Kimi Code display name near the existing provider labels (`provider-owner.resolver.ts:94-104`).
- Inject `IKimiCodeAuthService` and add a shared-connection owner method. Use CLI login status to create a CLI-store owner for the Kimi home. Use the shared provider API key to create a credential owner (`provider-owner.resolver.ts:487-535`, `libs/backend/auth-providers/src/lib/providers/kimi-code/kimi-code-auth.service.ts:101-143`).
- Return an unknown owner when no usable credential exists or status resolution fails. Unknown owners must not merge with another owner (`libs/shared/src/lib/types/plan-limit.types.ts:98-122`).
- Extend `ownerForPtahCli` so a real Kimi lane key keeps its existing credential owner. A successfully read missing or placeholder slot should use the shared connection (`provider-owner.resolver.ts:502-535`, `provider-owner.resolver.spec.ts:399-410`).
- Do not add Kimi to `CliStoreOwner` unless the implementation generalizes `cliStorePath`. That function currently supports only Grok, OpenCode, and Antigravity paths (`provider-owner.resolver.ts:136-137`, `provider-owner.resolver.ts:754-760`).

### 3. Connect read, discovery, and lane paths

- Add a `kimi-code` branch in `plan-owner-read.ts:103-184`. Reuse a `ptah-cli-key` reference as lane-selection metadata when `context.ptahCliId` exists.
- Skip generic credential resolution for Kimi in `plan-usage.service.ts:290-308`. The reader must apply the direct-key and shared-connection rule itself.
- Construct the Kimi reader in the reader record at `plan-usage.service.ts:145-170`.
- Add selected-provider Kimi discovery in `plan-limit-owner-discovery.service.ts:428-446`.
- Include enabled Kimi agents in ptah-cli discovery at `plan-limit-owner-discovery.service.ts:592-606`. Deduplicate lanes that share the host connection.
- Include Kimi in direct lane lookup at `lane-limit-lookup.service.ts:252-272`, so limits work before a remembered run.
- Add `'kimi-code': 'stored-key'` to `OWNER_RULES` in `ptah-cli-lane-plan-limits.ts:81-87`. Reuse its owner-resolution call at lines 127-139.
- Do not change plan-billed accounting without separate billing evidence. The current special case covers only Ollama Cloud (`ptah-cli-lane-plan-limits.ts:89-95`).

### 4. Update DI and guards

- Resolve `AUTH_PROVIDERS_TOKENS.SDK_KIMI_CODE_AUTH` in the existing `PlanUsageService` factory at `libs/backend/auth-providers/src/lib/di/register.ts:334-346`.
- Let constructor injection provide the same existing token to `ProviderOwnerResolver`. The token is already registered as a singleton (`libs/backend/auth-providers/src/lib/providers/register-providers.ts:108-122`).
- Add no new DI token. Readers have no individual tokens, and the existing Kimi auth token already represents the required dependency (`libs/backend/auth-providers-tokens/src/lib/tokens.ts:25-28`, `libs/backend/auth-providers-tokens/src/lib/tokens.ts:42-44`).
- Add a focused `PLAN_USAGE_SERVICE` resolution assertion to `apps/ptah-electron/src/di/container.smoke.spec.ts`. Its production-shaped auth harness is at lines 439-480.
- `apps/ptah-electron/src/di/expected-resolvable.ts:21-45` likely needs no change because no token or handler is added.
- `rpc-surface.spec.ts` and `surface-composition.spec.ts` should need no change because the plan adds no RPC method.
- Keep the existing Kimi auth singleton registration test at `libs/backend/auth-providers/src/lib/providers/register-providers.spec.ts:93-108`.

### 5. Add focused tests

- New `kimi-code-plan-usage.reader.spec.ts`: exact URL and headers, redirect rejection, timeout, OAuth and API-key requests, direct-key preference, missing and placeholder fallback, failed slot read, owner fingerprint mismatch, CLI-store credential-kind mismatch, all four window mappings, numeric-string ratios, optional monthly entries, malformed values, contradictory legacy fields, HTTP 401/403/404, malformed JSON, network failure, and secret-safe logging.
- `plan-usage.service.spec.ts`: add the fake Kimi auth dependency, prove reader registration, prove generic credential resolution is skipped, and retain cache and stale behavior.
- `provider-owner.resolver.spec.ts`: preserve the real lane-key case at lines 399-410. Add placeholder-to-OAuth fallback, missing-slot-to-shared-key fallback, failed-slot-read unknown owner, and shared CLI-login, API-key, signed-out, and failed-status cases.
- `plan-owner-read.accounts.spec.ts`: cover a main Kimi target and a lane target with `ptahCliId` (`plan-owner-read.ts:130-184`).
- `plan-limit-owner-discovery.service.spec.ts`: cover selected Kimi OAuth and API-key owners, enabled Kimi lanes, and shared-connection deduplication (`plan-limit-owner-discovery.service.ts:428-446`, `plan-limit-owner-discovery.service.ts:592-606`).
- `lane-limit-lookup.service.spec.ts`: prove direct Kimi lookup before a remembered run (`lane-limit-lookup.service.ts:252-272`).
- `ptah-cli-lane-plan-limits.spec.ts`: prove spawn-time owner resolution for direct and shared credentials (`ptah-cli-lane-plan-limits.ts:81-87`, `ptah-cli-lane-plan-limits.ts:127-139`).
- `apps/ptah-electron/src/di/container.smoke.spec.ts`: resolve `PLAN_USAGE_SERVICE` with the new dependency (`container.smoke.spec.ts:439-480`).

For implementation verification, use `npm run verify -- -p auth-providers,cli-agent-runtime,ptah-electron`, then add only directly affected dependent host projects required by the repository rules. Do not run workspace-wide checks.

## Risks

| Risk | Required control |
| --- | --- |
| A lane key changes between owner resolution and the API read. | Compare the selected credential and credential kind with the target owner. Return unavailable on mismatch (`plan-usage.service.ts:297-307`). |
| A keyless lane is mistaken for a direct-key lane. | Fall back only after a successful missing or placeholder slot read (`provider-owner.resolver.ts:722-744`). |
| A configured host receives an OAuth token. | Use an exact official URL allowlist and disable redirects ([official host tests](https://github.com/MoonshotAI/kimi-code/blob/a2afdbc7d1fa0737d45d5780cc6c2bd38e477b55/packages/oauth/test/managed-usage.test.ts#L31-L63)). |
| The API returns a false zero. | Reject explicit legacy contradictions and retain ledger evidence ([issue 3951](https://github.com/MoonshotAI/kimi-code/issues/3951)). |
| A plan has no monthly quota. | Omit the absent window and do not fabricate values ([issue 4046](https://github.com/MoonshotAI/kimi-code/issues/4046)). |
| A generic 429 becomes subscription exhaustion. | Keep rate-limit classification separate from `classifyLaneLimit` (`lane-rate-limit-classifier.ts:9-15`). |
| Error text or a response body exposes a secret. | Log only provider ids and error kinds, never credentials or bodies (`plan-usage.service.ts:358-365`). |
| A read takes too long or hangs. | Reuse the snapshot budget, bound the HTTP request, and honor cancellation (`plan-limits-snapshot.service.ts:84-101`). |

## Local consequences

- `auth-providers`: add the reader, shared Kimi owner resolution, and DI dependencies. This is the main implementation cost.
- `cli-agent-runtime`: add Kimi to owner read plans, discovery, direct lookup, and spawn-time ownership. Without all four changes, some displays remain empty even with a working reader.
- `rpc-handlers` and frontend libs: no contract or component change is required. Existing snapshots and display cells carry the new windows.
- `ptah-electron`: extend the DI smoke guard. No new RPC capability is required because `lanePlanLimits` is already enabled (`apps/ptah-electron/src/rpc-host-profile.ts:46-48`).
- Failure handling: retain the existing stale snapshot and ledger path rather than adding a Kimi-specific fallback store (`libs/backend/rpc-handlers/src/lib/services/plan-limits-snapshot.service.ts:175-241`).

## Unknowns

- **API-key acceptance:** official source proves the Bearer header for an OAuth access token, but this investigation did not verify a stored API key against `/usages`. The smallest experiment is one authorized request with a test API key, without logging the key or response body.
- **Frequency of false zero ratios:** the issue reports prove occurrences, not prevalence. Compare an authorized account's API response with observed usage before and after a controlled request.
- **Monthly semantics:** the names distinguish total and code quotas, but the inspected sources do not define their billing relationship or exact duration. Display both labels without merging them.
- **Kimi subscription error wording:** no verified local classifier strings were found. Capture sanitized real lane failures before adding subscription-exhaustion patterns.
- **Local server availability:** the official fallback requires an existing server and token. Check for both explicitly before any later implementation uses that path.
- **Live behavior:** no authenticated live API verification was performed. All endpoint and payload claims come from the pinned official source and tests.

## Summary

- Kimi Code currently has no usage reader, owner read plan, discovery, or direct lane lookup.
- The official endpoint is `GET https://api.kimi.ai/coding/v1/usages` with a Bearer token.
- The API provides five-hour, weekly, and optional monthly-total and monthly-code windows.
- Reuse `IKimiCodeAuthService` for OAuth refresh and shared credentials.
- Keep direct lane keys, shared API keys, and shared OAuth logins as distinct owner cases.
- Reject contradictory data and retain stale or error-derived evidence on failure.
- Existing Electron, dashboard, `$limits`, and `ptah_agent_list` displays need no new contract.
- Live API-key acceptance and upstream false-zero frequency remain unverified.
