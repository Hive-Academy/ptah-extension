# Session Analytics quota repair

## Provider findings

### Claude

- Symptom: fresh provider API values were rendered as `? Not confirmed` with
  `last reset unknown: freshness cannot be confirmed`.
- Root cause: `classifyWindow` in
  `libs/shared/src/lib/utils/plan-limits/window-state.ts:218` required
  `lastResetAt` for every fresh window. The Claude `/usage` mapper intentionally
  maps the provider's next reset (`resetSource: 'provider-api'`) but its response
  does not contain a historical reset timestamp; see
  `libs/backend/auth-providers/src/lib/quota/readers/claude-plan-usage.reader.ts:218`.
- Fix: a fresh provider-API read with a future provider-API reset is confirmed as
  current-window data. This preserves `not-confirmed` for estimated, unofficial,
  reset-less, stale, and passed-reset data. Regression coverage was added in
  `window-state.spec.ts`.

### Codex

- Symptom: Codex 0.160.0 was reported as `cli-version-unsupported`.
- Root cause: `CodexAccountUsageService.assertVersion` compared `codex --version`
  against a hard-coded `0.155.1` protocol generation version before it called
  `account/rateLimits/read`; the guard was at
  `libs/backend/auth-providers/src/lib/providers/codex/codex-account-usage.service.ts:222`.
- Fix: the guard now only establishes that the installed command is executable;
  the actual app-server capability is authoritative. A JSON-RPC method-not-found
  still correctly maps to `cli-version-unsupported`. The Codex service regression
  test now exercises 0.160.0 successfully.
- Owner label: the existing app-server `account/read` path hashes the ChatGPT
  email into an owner key (never exposes it), so a provider account is separated
  correctly without leaking identity.

### Antigravity

- Symptom: `service-unavailable`.
- Root cause / limitation: the only implemented source is an undocumented local
  Antigravity language-server endpoint,
  `/exa.language_server_pb.LanguageServerService/GetUserStatus`, discovered from
  a running `language_server` process with its CSRF token; see
  `antigravity-plan-usage.reader.ts:60-157` and
  `antigravity-ls.provisional.ts:8-35`. It deliberately returns unavailable when
  no exactly-one local server, reachable listener, or schema-compatible response
  is found. This machine had no `language_server` process, so the live endpoint,
  authentication and response cannot be reproduced or safely changed.
- Fixability: not safely fixable without a running Antigravity instance or a
  documented provider API. The UI now says that its local language server/status
  endpoint was unavailable for this refresh instead of showing a raw code.

### OpenCode CLI login

- Symptom: no usage source.
- Reason: no plan-usage source is registered for this provider. It remains an
  honest, human-readable empty state; no percentage is invented.

### Ollama Cloud

- Symptom: `unsupported-auth`.
- Reason: the configured authentication mode cannot expose subscription plan
  windows. The UI displays an API-key-account explanation rather than the raw
  status code.

## Redesign summary

- Provider cards use the shared `ProviderMarkComponent`, compact rounded DaisyUI
  cards and theme badges.
- Usage fills are `success` below 90%, `warning` at the existing 90% near-limit
  threshold, and `error` at a confirmed limit. The grey striped fill and threshold
  marker were removed.
- Future resets read `Resets in … (local time)` and are emphasized. Existing
  `PlanLimitsStore` signals, its shared clock, and `@for` identity tracking are
  retained; no per-card or per-window timer/RPC was added.
- Status codes are mapped to human labels such as `Usage unavailable`, `CLI
update needed`, and `API key account`; detailed notices remain accessible text.

## Files changed

- `libs/backend/auth-providers/src/lib/providers/codex/codex-account-usage.service.ts`
- `libs/backend/auth-providers/src/lib/providers/codex/codex-account.schemas.ts`
- `libs/backend/auth-providers/src/lib/providers/codex/codex-account-usage.service.spec.ts`
- `libs/shared/src/lib/utils/plan-limits/window-state.ts`
- `libs/shared/src/lib/utils/plan-limits/window-state.spec.ts`
- `libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.ts`
- `libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.spec.ts`

## Verification

Attempted the required scoped command:

`npx nx run-many -t typecheck,lint,test -p dashboard,auth-providers,shared --parallel=2`

The runner did not produce a completion result in this lane while numerous other
Nx/Node workers were active, so this is not reported as passing. The focused
test invocation likewise did not return a completion result. No workspace-wide
verification was run.

## Decisions

- Kept Codex's app-server usage read as the source of truth rather than adding a
  fragile `codex exec --json` fallback.
- Did not alter Antigravity's transport without a reproducible server; its local
  protocol is explicitly provisional and broad changes could weaken its CSRF and
  loopback boundary.
- Reused the shared provider mark and the dashboard store clock rather than
  creating a quota-specific icon set or timer.

## Not done

- A live Antigravity probe could not be validated because no language-server
  process is running in this environment.
- Scoped Nx verification remains incomplete because the commands did not finish
  with observable output in this concurrent environment.
