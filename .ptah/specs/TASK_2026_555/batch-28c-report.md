# Batch 28c report: masked key hint and last connection check

Executor: backend-developer (in-process subagent). Date: 2026-10-01. Base: HEAD 0daf6ccdd. Nothing is staged or
committed. No `git stash`, restore, checkout, reset or clean was used.

| Task | State |
| --- | --- |
| 28c.1 per-stored-key masked hint | **Done.** Specs, mutation check, verify, build and Gate G are green |
| 28c.2 per-connection last check (status, latency, time) | **Done**, per the decisions in task.md "Batch 28c (2026-10-01)". Specs, verify, build and Gate G are green |

The batch is ready for the orchestrator's cross-side review (antigravity, code-logic-reviewer role) before the commit.

---

## 28c.1: masked key hint

### Root design

The hint is computed in the shared RPC handler, on the read path only, from the value the host already reads to
answer "is a key stored?".

- **Helper:** `libs/backend/rpc-handlers/src/lib/utils/mask-key-hint.ts:25` `maskKeyHint(secret)`.
  - It trims the secret and counts Unicode code points. Fewer than `KEY_HINT_MIN_LENGTH = 12` (`:14`) gives
    `undefined`.
  - Otherwise it returns `'\u2022\u2022\u2022\u2022 ' + last 4`. The bullets are an ASCII escape (`:17`), so the
    source file has no non-ASCII bytes.
  - `undefined`, `null`, a non-string, an empty key and a whitespace-only key all give `undefined`. It never throws.
- **Provider keys:** `auth:getApiKeyStatus` (`auth-rpc.handlers.ts:1489-1520`).
  - It does one `getProviderKey(p.id)` per provider (`:1503`), the same read `hasProviderKey` already did internally
    (`vscode-core/src/services/auth-secrets.service.ts:316-318`).
  - That read gives `hasApiKey`, with the same `!!v && v.length > 0` rule, and `keyHint` through `maskKeyHint`
    (`:1504`). `keyHint` is spread in only when defined.
- **Claude API key:** `auth:getAuthStatus`, in `probeSecrets` (`:822-853`).
  - It does one `getCredential('apiKey')` (`:830`), the same read `hasCredential` already did internally
    (`auth-secrets.service.ts:248-251`).
  - That read gives `hasApiKey` and `apiKeyHint` (`:846`). `apiKeyHint` enters the payload only when defined (`:803`).
  - The hint rides the existing 15 s status cache, which every key write already invalidates.
- **Failure:** `keyStoreReadFailure` (`:859-873`) is used by both read paths (`:851`, `:1517`).
  - It logs the error's type name only and sends Sentry a fresh fixed-text `Error`.
  - It returns `RpcUserError('Could not read the stored keys.', 'PERSISTENCE_UNAVAILABLE')`.
  - The user accepted this behaviour change (task.md "Batch 28c").
- **No new secret-store path or permission prompt.** Both read methods already went through the same
  `IAuthSecretsService` getters.

**Both hosts.** There is one registration, in the shared `rpc-handlers` lib. Each host backs `IAuthSecretsService`
with its own store:

- **VS Code:** `AuthSecretsService` over `ExtensionContext.secrets` (`vscode-core/src/di/register-platform-agnostic.ts:150-153`).
- **Electron (and the CLI):** the same class over the `EXTENSION_CONTEXT` shim.
  - The shim's `secrets.get` delegates to `PLATFORM_TOKENS.SECRET_STORAGE`
    (`vscode-core/src/di/register-storage-shims.ts:54-75`).
  - In Electron that token is `ElectronSecretStorage` (`apps/ptah-electron/src/activation/bootstrap.ts:324-325`).
- No host-specific change was needed.

### Shapes (the contract for 28d)

```ts
type StoredKeyHint = string; // '\u2022\u2022\u2022\u2022 ' + last 4, host-computed   (rpc-auth.types.ts:175)

// auth:getApiKeyStatus  (params: {})
interface AuthGetApiKeyStatusResult { providers: AuthApiKeyStatusEntry[] }     // rpc-auth.types.ts:618
interface AuthApiKeyStatusEntry {
  provider: string; displayName: string; hasApiKey: boolean; isDefault: boolean;
  keyHint?: StoredKeyHint; // :608; absent: no key, key < 12 chars, blank key
}
// auth:getAuthStatus: new optional field
interface AuthGetAuthStatusResponse { /* ... */ apiKeyHint?: StoredKeyHint }   // :189, the Claude API ('anthropic') key
// key-store read failure (both RPCs):
// { success: false, error: 'Could not read the stored keys.', errorCode: 'PERSISTENCE_UNAVAILABLE' }
```

Which connections get a hint:

- Moonshot and the other provider rows read `keyHint`.
- The Claude API row is built from `auth.hasApiKey` (`providers-settings-state.service.ts:314-316`) and reads
  `apiKeyHint`.
- Cursor is not in this list: it is stored in the `cursor` slot and reported by `agent:getConfig`.
- Copilot, Codex and Claude CLI store no provider key, so they never get a hint (pinned by a spec).
- The Batch 3 Cursor redaction is untouched.

### Trace (read path only)

1. **Key store read.** `IAuthSecretsService.getProviderKey(id)` or `getCredential('apiKey')` (both hosts, above).
2. **Handler read, once.** `auth-rpc.handlers.ts:1503` and `:830`.
3. **Hint computation.** `maskKeyHint` (`:1504`, `:846`).
4. **RPC field.** `AuthApiKeyStatusEntry.keyHint` and `AuthGetAuthStatusResponse.apiKeyHint`.
5. **Webview type.**
   - `RpcMethodResult<'auth:getApiKeyStatus'>` and `<'auth:getAuthStatus'>` carry the new fields.
   - `ProvidersSettingsStateService.readConnections` already requests both RPCs (`providers-settings-state.service.ts:288`,
     `:290`). Mapping the fields into `ProvidersConnection` and rendering them is 28d work.

**Write path: none.**

- `auth:setApiKey` (`:1334`) and `auth:deleteStoredKey` (`:1378`) never call `maskKeyHint` and never read a key back
  (pinned by a spec).
- The hint is not a parameter of any RPC.

### Security argument

- **What crosses RPC.** At most 4 characters of a key of 12 or more characters. Nothing crosses for a shorter key.
- **Logs.** The only added log is `keyStoreReadFailure`'s fixed message with `{ errorType }`. The existing status
  debug line (`:789`) logs flags only. Spec-proved: no log line or Sentry capture holds a key window longer than 4
  characters, or a bullet.
- **Errors.** Both read RPCs return fixed text. Before, `auth:getAuthStatus` let the raw `error.message` through the
  dispatcher.
- **CLI.** `ptah auth status --verbose`:
  - redacts `apiKeyHint` (it matches `SENSITIVE_KEY_PATTERN`, `apps/ptah-cli/src/cli/output/redactor.ts:28`) unless
    `--reveal` is passed;
  - prints `keyHint`. That is intended exposure: the same hint the Settings UI shows.

### Secret-crossing specs and the mutation check

The shared tree was never mutated.

- **Scratch setup.** A copy of the helper using `slice(-8)` lived in `%TEMP%\b28c-mut\mask-key-hint.wrong.js`. A
  scratch jest config (`%TEMP%\b28c-mut\jest.mut.config.js`) mapped `../utils/mask-key-hint` and `./mask-key-hint` to
  it.
- **Result against the wrong helper:** 9 failed, 16 passed.

| Spec | Wrong helper |
| --- | --- |
| `auth-rpc.handlers.key-hint.spec.ts` › getApiKeyStatus › "returns bullets + last 4 per stored key, and the serialised result holds no other key material" (39- and 44-char fixtures) | **fails** |
| `auth-rpc.handlers.key-hint.spec.ts` › getAuthStatus › "returns the Claude API key hint and nothing else of the key" | **fails** |
| `mask-key-hint.spec.ts` › "never contains more than the last 4 characters of …" (3 fixtures) | **fails** 3/3 |
| `mask-key-hint.spec.ts` › exact format, exactly 12 characters, trimmed key, surrogate pairs | **fail** |
| `auth-rpc.handlers.key-hint.spec.ts` › both "a key-store read failure is a fixed error …" specs | pass. No hint is computed on that path; the specs prove the response, logs and Sentry hold no key window, no bullet, no raw store text and no path |
| `auth-rpc.handlers.key-hint.spec.ts` › "never writes the key or the hint to a log line or Sentry" | pass. It asserts the handler's logging, which does not depend on the helper |

**Mojibake check.**

- `mask-key-hint.spec.ts` "carries no mojibake of the bullet" asserts the UTF-8 bytes `E2 80 A2`.
- No new file has a BOM.
- `mask-key-hint.ts` is pure ASCII.
- The only non-ASCII bytes the batch adds are two U+2022 characters in a doc comment (`rpc-auth.types.ts:167`), which
  is UTF-8 without a BOM.

---

## 28c.2: last connection check per connection

### Decisions applied (task.md "Batch 28c (2026-10-01)")

1. Built-in API-key connections get a new RPC, `auth:checkConnection { providerId }`. It runs the existing
   stored-key probe against the saved endpoint and records the result (user choice).
2. CLI and sign-in connections (Claude CLI, Copilot, Codex) record their status and the check time, with
   `latencyMs: null` (orchestrator choice).
3. The shared parts: the record type, an in-memory store, `lastCheck?` on route providers, and recording in
   `provider:testCustomEntry`.

### Root design

**Shared types** (`libs/shared/src/lib/types/rpc/rpc-auth.types.ts`):

- `ConnectionCheckRecord` (`:278`): `{ status: 'verified' | 'failed'; reason: ConnectionCheckFailureReason | null; latencyMs: number | null; checkedAt: string }`.
  - `status` and `reason` mirror the existing check result type, `AuthVerifyDraftConnectionResult`
    (`outcome` + `ProbeFailureReason`).
  - `ConnectionCheckFailureReason` (`:268`) is `ProbeFailureReason | 'signed-out' | 'not-installed'`.
  - `ProbeFailureReason` itself is unchanged, so the wizard copy map keyed by it is unaffected.
- `EffectiveRouteProvider.lastCheck?` (`:261`).
- `AuthCheckConnectionParams` (`:293`) and `AuthCheckConnectionResult = ConnectionCheckRecord` (`:304`).
- `'auth:checkConnection'` is added to the registry (`rpc.types.ts:867`) and to the method-name map (`:3617`).

**Store:** `libs/backend/rpc-handlers/src/lib/utils/connection-check-recorder.ts`, `ConnectionCheckRecorder`.

- It is in memory only and keyed by provider id. It adds no settings key and persists nothing.
- **Ordering.** A check calls `begin(providerId)` before its first await (`:33`) and gets a monotonic ticket.
  `complete(ticket, record)` (`:42`) keeps the record only if no later-started check is already stored. An older check
  that finishes late never replaces a newer result.
- **One instance per container.** `registerSharedRpcHandlers` registers it with `container.registerSingleton`
  (`register-shared-rpc-handlers.ts:54`). VS Code, Electron and the CLI all call that function
  (`apps/ptah-extension-vscode/src/di/phase-3-handlers.ts:86`, `apps/ptah-electron/src/di/phase-4-handlers.ts:104`,
  `libs/backend/cli-engine/src/lib/container.ts:815`).
  - `AuthRpcHandlers` (`auth-rpc.handlers.ts:276-278`) and `ProviderRpcHandlers` (`provider-rpc.handlers.ts:143-144`)
    inject it with `@inject(ConnectionCheckRecorder)`.

**Checker:** `libs/backend/rpc-handlers/src/lib/handlers/connection-check.ts`.

- `connectionCheckKind(providerId)` (`:57`) maps each id to a kind:

  | Provider | Kind |
  | --- | --- |
  | `anthropic` | `apiKey` |
  | Built-in `authType: 'apiKey'` (Moonshot, Z.AI, OpenRouter, …) | `apiKey` |
  | Saved custom entry | `custom` |
  | `github-copilot` | `copilot` |
  | `openai-codex` | `codex` |
  | `nativeAuth` (`claude-cli`) | `claude-cli` |
  | Local servers and key-optional routes (Ollama, LM Studio, Ollama Cloud) | `null`: no check here |
  | Unknown id | `undefined` |

- `ConnectionChecker.check` (`:89-101`) is single-flight per provider: a second call while one is in flight **joins**
  it (`inFlight`, `:84`). A double click sends one provider request.
- `run` (`:103-127`):
  - It takes the ticket, probes, and records the result.
  - A throw becomes `failed`/`unclassified` with `latencyMs: null`. Only the error type is logged, never the message,
    and the method never rejects.
- `probe` (`:129-160`):
  - **`custom`** (changed in revise round 1, M-1): `probeCustomProvider(entry, storedKey)`, the same probe as
    `provider:testCustomEntry`. See "Revise round 1".
  - **`apiKey`.** It calls `DraftVerificationService.verify({ probeId, providerId, authMode, credential: { kind: 'stored' } })`.
    - This is the **same code path** as `auth:verifyDraftConnection`, not a copy.
    - No `baseUrl` is passed, so `bindStoredDraft` binds the probe to the saved endpoint
      (`auth-providers/src/lib/auth/draft-verification.service.ts:504-526`).
    - No `model` is passed, so the probe uses the existing default: one turn, prompt "Reply with the single word: ok",
      `maxTurns: 1` (`:74`, `:382-395`).
    - With no stored key, the service answers `no-stored-credential` before any request (`:326-336`).
  - **`copilot`.** `copilotAuth.isAuthenticated()`.
  - **`codex`.** `codexAuth.clearCache()`, then `getTokenStatus()`. A stale token counts as `signed-out`.
  - **`claude-cli`.** `cliDetector.performHealthCheck().available`.
  - The last three make no request and record `latencyMs: null`.
- `fromDraftProbe` (`:190-199`):
  - It keeps `outcome`, `reason` and `latencyMs`, rounded to whole ms.
  - A failed or cancelled probe records `latencyMs: null`.
  - The probe's `detail` and `modelUsed` are dropped.
- `testCustomEntryAndRecord` (`:203-244`) is the body of `provider:testCustomEntry`. It moved here so
  `provider-rpc.handlers.ts` drops from 705 counted lines to under the 700 limit.
  - It takes the ticket, probes and records.
  - A key-store or probe throw is recorded as `failed`/`unclassified` and answers the fixed
    `{ ok: false, message: 'Could not test the connection.' }`. Before, the raw error text went through the dispatcher.
  - The wire contract `{ ok, message, latencyMs? }` is unchanged.
- `customProbeCheckRecord` (`:246`) maps the custom probe's classification onto the reason union:

  | Custom probe failure | Recorded reason |
  | --- | --- |
  | `timeout` | `timeout` |
  | `dns`, `unreachable`, `tls` | `unreachable` |
  | `unauthorized` | `credential-rejected` |
  | `not-found`, `no-model` | `model-unavailable` |
  | anything else | `unclassified` |

**RPC:** `auth:checkConnection` (`auth-rpc.handlers.ts:599-630`).

- It validates params with zod at the boundary: `AuthCheckConnectionSchema`, `{ providerId: string, trimmed, 1-128 chars }`,
  `.strict()` (`auth-rpc.schema.ts:87-89`).
- Its errors are fixed `RpcUserError` text only:
  - `'Unknown provider id'` (`INVALID_PARAMS`) for bad params or an unknown id.
  - `'This connection cannot be checked here.'` (`INVALID_PARAMS`) for local and key-optional connections.
- Probe failures are not RPC errors. They come back as a `failed` record.

**Read:** `auth:getEffectiveRoute` adds `lastCheck` to each provider that has a record (`auth-rpc.handlers.ts:539-542`,
`:580`).

- The route only reads. It probes nothing, so it records nothing.
- The existing rule at `:581` ("never manufacture connection timestamps") stays true.
- Custom entries are in the route's catalogue (`getAllAnthropicProviders()` merges them), so their records are
  readable there too.
- **No frontend change was needed.** `ProvidersEffectiveRoute` is `Omit<AuthGetEffectiveRouteResult, …>`
  (`libs/frontend/core/src/lib/services/providers-settings.types.ts:28-31`). `refreshRoute` passes `providers`
  through (`providers-settings-state.service.ts:201`), so `state.route().data.providers[i].lastCheck` is already typed.

### Traces

**Built-in API-key connection (Moonshot):**

1. **Check control (28d).** It calls `auth:checkConnection { providerId: 'moonshot' }`.
2. **RPC.** Zod parses the params, and `connectionCheckKind` returns `'apiKey'` (`auth-rpc.handlers.ts:606-628`).
3. **Checker.** `ConnectionChecker.check` joins or starts the check, then `run` calls `recorder.begin`
   (`connection-check.ts:107`).
4. **Probe.** `DraftVerificationService.verify` with the stored credential.
   - It binds to the saved endpoint and reads the stored key in the host (`:303-337`).
   - It sends one minimal inference request and measures latency around it (`:379`, `:425`).
5. **Recorder.** `recorder.complete(ticket, record)` stores the result under key `moonshot` (`connection-check.ts:119`).
6. **RPC result.** `ConnectionCheckRecord`.
7. **Read RPC.** `auth:getEffectiveRoute` returns `providers[moonshot].lastCheck` (`auth-rpc.handlers.ts:539-542`).
8. **Frontend type.** `ProvidersEffectiveRoute.providers[].lastCheck?: ConnectionCheckRecord`, available through
   `state.route()`.

**Custom entry:**

1. **Control.** `provider:testCustomEntry { id }` (`provider-rpc.handlers.ts:866`).
2. **Probe and record.** `testCustomEntryAndRecord` runs `begin` → `probeCustomProvider` (real round trip) → `complete`.
3. **Read.** The same route read as above.

**CLI and sign-in connections:**

1. **Control.** `auth:checkConnection` with `github-copilot`, `openai-codex` or `claude-cli`.
2. **Detection.** The token read or CLI detection, with no request.
3. **Record and read.** The record has `latencyMs: null`; the route read is the same as above.

**Not a writer:**

- `auth:verifyDraftConnection` is unchanged and never records (pinned by a spec).
- `auth:getEffectiveRoute` never records, even with `refresh: true` (pinned).
- `auth:testConnection` is unchanged. It polls SDK health, and no Settings control calls it.

### Security argument (28c.2)

- **Where the key lives.** `DraftVerificationService` reads the stored key inside the host, uses it only in the
  per-call override, and never logs or echoes it (its existing contract).
- **What the record holds.** The record holds only `status`, a fixed `reason`, the latency and the time. The probe's
  `detail` (sanitized, but text) is dropped.
- **Logs.** The checker logs the provider id, the status, the reason, the latency and, on a throw, the error type
  only. Spec-proved: no error text and no key window.
- **Boundary.** The RPC refuses anything but a strict `{ providerId }`. A caller cannot redirect the probe: an extra
  field such as `baseUrl` is rejected (spec). The endpoint is always the saved one.
- **Cost.** Single-flight per provider means a double click costs one request, not two.

---

## Changed files (whole batch)

All paths are under `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\`.

| Change | Path | What |
| --- | --- | --- |
| MODIFIED | `libs\shared\src\lib\types\rpc\rpc-auth.types.ts` | hint types; check record, reason, params and result; `lastCheck?` |
| MODIFIED | `libs\shared\src\lib\types\rpc.types.ts` | `auth:getApiKeyStatus` result type; `auth:checkConnection` entry and name |
| MODIFIED | `libs\backend\rpc-handlers\src\lib\handlers\auth-rpc.handlers.ts` | hint read paths, `keyStoreReadFailure`, `auth:checkConnection`, route `lastCheck`, recorder injection |
| MODIFIED | `libs\backend\rpc-handlers\src\lib\handlers\auth-rpc.schema.ts` | `AuthCheckConnectionSchema` |
| MODIFIED | `libs\backend\rpc-handlers\src\lib\handlers\provider-rpc.handlers.ts` | recorder injection; `provider:testCustomEntry` body through `testCustomEntryAndRecord` |
| MODIFIED | `libs\backend\rpc-handlers\src\lib\register-shared-rpc-handlers.ts` | `registerSingleton(ConnectionCheckRecorder)` |
| CREATED | `libs\backend\rpc-handlers\src\lib\utils\mask-key-hint.ts` | (+ spec) |
| CREATED | `libs\backend\rpc-handlers\src\lib\utils\connection-check-recorder.ts` | (+ spec) |
| CREATED | `libs\backend\rpc-handlers\src\lib\handlers\connection-check.ts` | (+ spec) |
| CREATED | `libs\backend\rpc-handlers\src\lib\handlers\auth-rpc.handlers.key-hint.spec.ts` | |
| CREATED | `libs\backend\rpc-handlers\src\lib\handlers\auth-rpc.handlers.check-connection.spec.ts` | |
| CREATED | `libs\backend\rpc-handlers\src\lib\register-shared-rpc-handlers.spec.ts` | |
| MODIFIED (specs) | `auth-rpc.handlers.spec.ts`, `auth-rpc.handlers.delete-stored-key.spec.ts`, `provider-rpc.handlers.spec.ts` | recorder constructor argument; `getCredential` counters (`auth-rpc.handlers.spec.ts:477`, `:729-730`) |
| MODIFIED (specs) | `provider-rpc.custom-entries.spec.ts` | recorder constructor argument + 3 new specs; revise round 1: entry-edit specs |

Revise round 1 changes no file list entry: the fixes are in files already listed (`connection-check-recorder.ts`,
`connection-check.ts`, `auth-rpc.handlers.ts`, `provider-rpc.handlers.ts` and their specs).

That is 9 source files (3 new) and 12 spec files (6 new) across 2 libs. It is over the batch cap, because 28c.2 was
added to this batch by decision.

## Spec list (28c.2)

| File | Specs |
| --- | --- |
| `utils/connection-check-recorder.spec.ts` (5) | no record before a check; keeps a completed check; **an older check that finishes late never replaces a newer result**; a newer check replaces an older one; connections are independent |
| `handlers/connection-check.spec.ts` (34) | `connectionCheckKind` for 10 ids plus a saved custom entry. Stored-key probe called with exactly `{ probeId, providerId, authMode, credential: { kind: 'stored' } }` (no `baseUrl`, no `model`) and recorded. Custom entries use `custom`. A failed probe gives `latencyMs: null` and the detail is dropped. Timeout and cancel. A throw gives `unclassified`, never rejects, and logs no error text. **Concurrent checks join: one provider request, the same result; the next check is a new request.** Different connections run independently. **No stored key gives `no-stored-credential` with no request** (real `DraftVerificationService`; `buildDraftOverride` and `InternalQueryService.execute` not called). Copilot, Codex (cache cleared; stale = signed-out) and Claude CLI give `latencyMs: null` and never call the probe. `customProbeCheckRecord` mapping (11 cases) |
| `handlers/auth-rpc.handlers.check-connection.spec.ts` (14) | zod boundary: none, empty, whitespace, non-string, extra `baseUrl`, over-long id all give fixed `'Unknown provider id'` / `INVALID_PARAMS` with no probe. Unknown id. A local server gives `'This connection cannot be checked here.'` with no probe. Check gives a record, then `route.providers[].lastCheck` equals it. The serialised result has no key window and no probe detail. Sign-in connection gives `latencyMs: null`. The route never records, even with refresh. **`auth:verifyDraftConnection` never writes the record.** Two concurrent RPCs send one probe |
| `handlers/provider-rpc.custom-entries.spec.ts` (+3) | failed test records `unreachable` / `null`. A key-store throw records `unclassified` and answers fixed text without the error or key text. An older test that finishes late does not replace a newer one |
| `register-shared-rpc-handlers.spec.ts` (1) | `ConnectionCheckRecorder` is one instance per container |

## Verification

All logs are in `C:\Users\abdal\AppData\Local\Temp\`.

- **Typecheck and lint.** `npx nx run-many -t typecheck,lint -p @ptah-extension/shared @ptah-extension/rpc-handlers @ptah-extension/core --parallel=2 --skip-nx-cache`
  succeeded for all 3 projects (`b28c-tl3.log`).
  - `tsc -p libs/backend/rpc-handlers/tsconfig.spec.json --noEmit` gives 0 errors.
  - Lint has 0 errors. The remaining warnings on changed files are pre-existing:
    - `auth-rpc.handlers.ts`: `max-lines` and `preserve-caught-error`. On `max-lines`, the file was 1329 counted lines
      after 28c.1 and is now 1375 (1819 raw). The handler code added in this file is the registration and the route
      read; the checker lives in its own 271-line file.
    - `provider-rpc.custom-entries.spec.ts:215`: unused `store`, in untouched code.
  - `provider-rpc.handlers.ts` no longer has a `max-lines` warning (705 counted lines at HEAD).
- **Tests.** `npx nx run-many -t test -p @ptah-extension/shared @ptah-extension/rpc-handlers @ptah-extension/core --parallel=2 --skip-nx-cache -- --maxWorkers=2`
  (`b28c-test3.log`):
  - rpc-handlers: **3493 passed, 4 skipped, 1 failed = the known `harness-skill-selection-rpc.service.spec.ts`**
    ("never writes state.json"), 121 suites.
  - shared: 2202/2202. core: 1085/1085.
  - `register-shared-rpc-handlers.spec.ts` was added after that run and passes alone (1/1).
- **Host DI smoke specs.** The constructors changed, so these were run too; all green:
  - `apps/ptah-extension-vscode/src/di/container.smoke.spec.ts`: 32/32.
  - `apps/ptah-electron/src/di/container.smoke.spec.ts`: 14/14.
  - `apps/ptah-cli/src/di/container.smoke.spec.ts`: 7/7.
  - cli-engine `with-engine.spec.ts`: 60/60.
- **Build.** `npx nx build ptah-extension-webview` exited 0 (`b28c-build3.log`). There is no budget error. The initial
  total is 3.48 MB, with the same pre-existing warning as 28b (976.07 kB over the 2.5 MB warning budget, unchanged).
- **Gate G.** `npx playwright test --config=playwright.config.ts src/lib/scenarios/settings/settings-reachability.e2e.spec.ts --reporter=list`
  gave **9 passed (1.3 m)**, 0 failed (`b28c-gateG3.log`), on the full 28c tree with the webview rebuilt.
  - **Failure record (execution default 7).** The run before it (`b28c-gateG2.log`) did not reach any test. It
    stopped with `Error: ENOSPC: no space left on device, mkdir '…\libs\frontend\webview-e2e-harness\test-results'`:
    drive D: had 0 bytes free.
  - In that same window, the build logged "Successfully ran target build" but exited 1 on Nx's task database
    (`b28c-build2.log`).
  - Once space came back (1.5 to 2.2 GB free), the build was re-run and Gate G ran once, green. This was not a test
    failure, so no repeat run was needed.
  - The 28c.1-only tree had also passed Gate G 9/9 (`b28c-gateG.log`).

## Deviations

1. **`auth:getApiKeyStatus` read failure.** It is now the fixed `'Could not read the stored keys.'` with
   `PERSISTENCE_UNAVAILABLE`, not an empty list. Accepted by the user.
2. **`auth:getAuthStatus` key-store failure.** It is now fixed text, not the raw error message.
3. **The Claude API hint is a second field.** It is `apiKeyHint` on `auth:getAuthStatus`, because that key is not in
   the `auth:getApiKeyStatus` list.
4. **The latency clock is the probe's existing one.** The latency comes from `DraftVerificationService`, which
   measures with `Date.now()` around the request (`draft-verification.service.ts:379`, `:425`). The batch text asked
   for a monotonic clock.
   - The decision said to reuse that code path, so it was not changed. Changing it means editing `auth-providers`, a
     third lib.
   - `customProbeCheckRecord` and `fromDraftProbe` round to whole ms.
5. **Local and key-optional connections get no check.** Ollama, LM Studio and Ollama Cloud answer
   `'This connection cannot be checked here.'`. The decision covered API-key, custom, CLI and sign-in connections
   only. In 28d, these cards should keep the existing route-refresh "Check".
6. **`provider:testCustomEntry` throw path.** A key-store or probe throw now answers
   `{ ok: false, message: 'Could not test the connection.' }` and records a failed check. Before, the raw error went
   through the dispatcher.
7. **Spec changes for the recorder.** The existing specs that construct the handlers gained the recorder argument.
   The 28c.1 secret-read counters now count `getCredential`.

## Out-of-scope observations

- **Drive D: is nearly full** (2.2 GB free after the run). It filled completely during this batch and blocked the
  build and Playwright for a while. The orchestrator should free space before the next single-writer gate.
- **`auth:testConnection` is still SDK-health polling with fixed waits.** No Settings control calls it, and 28d should
  not either.

## Revise round 1

Review: `batch-28c-code-logic-review.md` (NEEDS_REVISION 7.5/10; S-1, M-1, M-2). Paths are relative to
`libs/backend/rpc-handlers/src/lib/`.

### S-1: stale check record after a key or entry change — FIXED

- `utils/connection-check-recorder.ts:63-69` `clear(providerId)` writes a tombstone with a NEW sequence.
  `complete` (`:47-55`) refuses a ticket older than the stored sequence, so a check that started before the clear and
  finishes after it records nothing.
- Call sites:
  - `auth:setApiKey`, new key AND empty key: `handlers/auth-rpc.handlers.ts:1369`, in a `finally` after the write.
  - `auth:deleteStoredKey`: `handlers/auth-rpc.handlers.ts:1422` (success) and `:1425` (store failure).
  - `auth:saveSettings` key fields: `handlers/auth-rpc.handlers.ts:1081` (Claude API key), `:1097` (provider key).
  - `provider:removeCustomEntry`: `handlers/provider-rpc.handlers.ts:847`, in a `finally`.
  - `provider:updateCustomEntry`: `handlers/provider-rpc.handlers.ts:818` calls `clearStaleCheck` (`:884-891`) in a
    `finally`. `customEntryEditStalesCheck` (`handlers/connection-check.ts:304-312`) treats a supplied key (replaced or
    cleared) or any non-display field (endpoint, lane, models, unknown fields) as stale.
- Specs:
  - `connection-check-recorder.spec.ts` "clear (revise round 1, S-1)": forgets the cleared connection only; "a check
    that started BEFORE the clear and finishes AFTER it is not recorded"; a check after the clear is recorded; clearing
    an unchecked connection is harmless.
  - `auth-rpc.handlers.check-connection.spec.ts` "a key change forgets the last check (revise round 1, S-1)":
    auth:deleteStoredKey clears the record, so the route no longer reports verified; the Claude API key case; setApiKey
    with a NEW key; setApiKey with an empty key; saveSettings key fields; "a check that started BEFORE the key was
    deleted and finishes AFTER it is not recorded".
  - `provider-rpc.custom-entries.spec.ts` "custom entry edits and the last connection check": removeCustomEntry clears
    the record (also when the key delete fails); updateCustomEntry with a new endpoint / a new lane / a replaced key /
    a cleared key clears it; a display-only change keeps it.

### M-1: one probe path for custom entries — FIXED

- `handlers/connection-check.ts:149-160`: `auth:checkConnection` for a custom entry calls `probeCustomProvider(entry,
  storedKey)` and maps it with `customProbeCheckRecord` (`:262-287`) — the same probe and mapping as
  `provider:testCustomEntry` (`testCustomEntryAndRecord`, `:228-259`). The stored key comes from
  `IAuthSecretsService.getProviderKey` through the new `readProviderKey` dependency
  (`handlers/auth-rpc.handlers.ts:306`); it is passed straight to the probe, never logged or returned. Single-flight
  join and the begin/complete sequence are unchanged (`:94-132`). No cross-lib import was added
  (`../utils/custom-provider-probe` is in this lib).
- Specs (`connection-check.spec.ts`): "custom entries run the same probe as provider:testCustomEntry, never the draft
  probe (M-1)"; "a gateway without tool support fails auth:checkConnection the same way it fails
  provider:testCustomEntry (M-1)"; "a custom-entry probe that throws records failed/unclassified".

### M-2: invalid params vs unknown id — FIXED

- `handlers/auth-rpc.handlers.ts:614-621`: a schema failure throws `RpcUserError('Invalid parameters for
  auth:checkConnection', 'INVALID_PARAMS')`, the lib's standard `Invalid parameters for <method>` wording (as in
  `memory-rpc.handlers.ts`, `mem-rpc.handlers.ts`, `corpus-rpc.handlers.ts`). `:626` keeps "Unknown provider id" only
  for a well-formed id that names no connection.
- Specs (`auth-rpc.handlers.check-connection.spec.ts`, "auth:checkConnection — boundary validation"): "rejects %s with
  the standard invalid-params text and no probe (M-2)" for no params, empty, whitespace, non-string, extra field and
  over-long ids; "keeps "Unknown provider id" for a well-formed but unknown id (M-2)".

### Verification (revise round 1)

- `npx nx run-many -t typecheck -p @ptah-extension/shared @ptah-extension/rpc-handlers --parallel=2 --skip-nx-cache`:
  succeeded for both projects.
- `npx nx run-many -t lint -p @ptah-extension/shared @ptah-extension/rpc-handlers --skip-nx-cache`: both passed (no
  errors).
- Tests (`--maxWorkers=2`, `--skip-nx-cache`):
  - rpc-handlers: 121/122 suites, **3513 passed, 4 skipped, 1 failed** = the known pre-existing
    `harness-skill-selection-rpc.service.spec.ts` ("never writes state.json").
  - shared: 81/81 suites, 2202/2202.
- No constructor signature changed in this round (the checker gets `readProviderKey` from the already-injected
  `authSecretsService`), so the host DI smoke specs were not re-run. Webview build and Gate G not run (team-leader).
