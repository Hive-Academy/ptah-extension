# Ptah CLI — auth, providers, license and settings bundles

Covers `ptah auth`, `ptah provider` (keys, default, model tiers),
`ptah license`, and the `ptah settings export` / `import` bundle
commands — everything that touches credentials.

---

## 1. Auth bootstrap recipes

The agent SDK supports five auth strategies
(`libs/backend/auth-providers/src/lib/auth/strategies/`): `api-key`,
`cli`, `oauth-proxy`, `local-native`, `local-proxy`. Each provider in the
registry (`libs/shared/src/lib/providers/provider-registry.ts`) is bound
to one. Pre-seed credentials before invoking any streaming command —
`session start`, `setup`, `analyze`, and `execute-spec` will exit `3`
(`auth_required`) otherwise.

A fresh install has `llm.defaultProvider: ""`, so you MUST pick a provider
(`ptah provider default set <id>`, or let `ptah init` do it) in addition
to supplying credentials. After any recipe, run `ptah doctor` and proceed
only when `effective.ready:true`.

### 1.1 Anthropic direct (API key)

```bash
ptah provider set-key --provider anthropic --key sk-ant-api03-...
ptah provider default set anthropic
ptah doctor        # confirm effective.ready: true
```

`provider set-key` writes the exact secret slot the SDK reads
(`AuthSecretsService` — `ptah.auth.anthropicApiKey`) and persists
`authMethod`, so this three-command bootstrap actually starts a session.
The call format-validates the key: a good key returns
`{ success:true, verified:true }` and exit `0`; a malformed key is
rejected with `verified:false` and exit `3` (`auth_required`). Trust the
exit code + `verified`, not a bare `success`.

The `ANTHROPIC_API_KEY` env var below is an **alternative**, not a
requirement — it is read once on bootstrap and is no longer the only path
that reaches the SDK:

```bash
export ANTHROPIC_API_KEY=sk-ant-api03-...
```

### 1.2 Claude CLI subscription

The Claude CLI's own login flow handles OAuth; Ptah picks up the
existing session via the `cli` strategy.

```bash
claude   # do the OAuth dance once in your shell
ptah config set authMethod claude-cli
ptah auth status
```

### 1.3 GitHub Copilot (device-code)

```bash
ptah auth login copilot
# stderr prints the verification URL + user code; visit it in any browser
# ptah auth status reflects authenticated:true once the device flow lands
```

In `interact` mode, the URL is delivered as an `oauth.url.open` outbound
JSON-RPC request instead of stderr — the peer is expected to open it
(see `apps/ptah-cli/src/cli/oauth/jsonrpc-oauth-url-opener.ts`).

### 1.4 OpenAI Codex

```bash
codex login --device-auth
ptah auth status
# auth login codex is supported but only prints the manual instructions —
# Codex's own CLI owns the device-code flow, Ptah just verifies.
```

See `apps/ptah-cli/src/cli/commands/auth.ts` for the codex handler.

### 1.5 Z.AI (GLM) and Moonshot (Kimi)

Both are Anthropic-compatible vendors using the `api-key` strategy with
a custom base URL.

```bash
ptah provider set-key --provider z-ai --key <ZAI_KEY>
ptah provider set-key --provider moonshot --key <MOONSHOT_KEY>
ptah provider default set z-ai
```

Env-var fallback (when running in CI without `set-key`):

```bash
export ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic
export ANTHROPIC_AUTH_TOKEN=<ZAI_KEY>
```

The api-key strategy honors `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`
when no provider key is stored — see
`libs/backend/auth-providers/src/lib/auth/strategies/api-key.strategy.ts`.

### 1.6 OpenRouter (local translation proxy)

OpenRouter uses the `local-proxy` strategy: Ptah spins up a small
in-process translation proxy that exposes an Anthropic-compatible
endpoint to the SDK while routing to OpenRouter's OpenAI-compatible API.

```bash
ptah provider set-key --provider openrouter --key sk-or-...
ptah provider default set openrouter
# Bootstrap of any streaming command will start the proxy automatically;
# ANTHROPIC_BASE_URL is set to 127.0.0.1:<port> internally.
```

### 1.7 Ollama (local + cloud)

Local Ollama uses the `local-native` strategy and assumes a daemon at
`http://localhost:11434`. Cloud Ollama uses `api-key`.

```bash
# Local
ollama serve &
ptah provider default set ollama

# Cloud
ptah provider set-key --provider ollama-cloud --key <KEY>
ptah provider default set ollama-cloud
```

---

## 2. Pre-seeding credentials in CI (GitHub Actions)

```yaml
- name: Configure Ptah
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    PTAH_AUTO_APPROVE: 'true'
    NO_COLOR: '1'
  run: |
    npm i -g @hive-academy/ptah-cli
    ptah license set --key ${{ secrets.PTAH_LICENSE_KEY }}
    ptah provider set-key --provider anthropic --key "$ANTHROPIC_API_KEY"
    ptah provider default set anthropic
    ptah provider tier set --tier sonnet --model claude-3-5-sonnet-20241022
    ptah auth status
```

---

## 3. Tier mapping (`sonnet` / `opus` / `haiku`)

Ptah uses a three-slot tier abstraction so harness configs can request
a model by capability rather than vendor-specific id. Set the slot
to a concrete model id for the active provider:

```bash
ptah provider tier set --tier sonnet --model glm-5.1
ptah provider tier set --tier opus   --model glm-5
ptah provider tier set --tier haiku  --model glm-4.5-air
ptah provider tier get
ptah provider tier clear --tier opus
```

Slots:

| Slot     | Intended use                                     |
| -------- | ------------------------------------------------ |
| `sonnet` | Default workhorse — most agent turns map here    |
| `opus`   | Heavy reasoning — Team Leader, deep analysis     |
| `haiku`  | Cheap classification, intent parsing, retrievals |

Each provider in the registry ships a default tier mapping;
`provider tier set` overrides it.

---

## 4. `ptah license` lifecycle

`ptah license` inspects, sets, and clears the local Ptah license key.
Backed by the shared `LicenseRpcHandlers` registered under the
`license:` RPC namespace (an allowed prefix in
`libs/backend/vscode-core/src/messaging/rpc-handler.ts`). Router wiring:
`apps/ptah-cli/src/cli/router.ts`.

The license is **identity and membership status**, not a feature gate —
tiers are `community` (free, always valid), `builders` (active paid
membership) and `expired` (revoked or payment failed). See
`libs/backend/vscode-core/src/services/license/license-types.ts`.

### `ptah license status`

Inspect the current license state.

| Flag     | Required | Notes      |
| -------- | -------- | ---------- |
| _(none)_ | —        | Read-only. |

- **RPC**: `license:getStatus`.
- **Notification**: `license.status { tier, valid, expiresAt?, … }`.
- **Exit codes**: `0` on success; `5` on RPC failure.

### `ptah license set --key <ptah_lic_…>`

Persist a new license key. The key format is `ptah_lic_<64-hex>` —
enforced by the server, not the CLI.

| Flag    | Required | Default | Notes                                              |
| ------- | -------- | ------- | -------------------------------------------------- |
| `--key` | yes      | —       | `ptah_lic_<64-hex>`; commander validates the flag. |

- **RPC**: `license:setKey`.
- **Notification**: `license.status` (refreshed).
- **Exit codes**: `0`; `2` when `--key` is missing (commander enforces);
  `4` (`LicenseRequired`) when the server rejects the key; `5` on
  transport failure.

### `ptah license clear`

Remove the locally-stored key.

| Flag     | Required | Notes         |
| -------- | -------- | ------------- |
| _(none)_ | —        | Irreversible. |

- **RPC**: `license:clearKey`.
- **Notification**: `license.status` (refreshed).
- **Exit codes**: `0`; `5` on RPC failure.

---

## 5. `ptah settings export` / `import`

Portable settings bundles. These go straight to the SDK's
`SettingsExportService` / `SettingsImportService` via DI, bypassing the
Electron-only save/open dialogs. Source:
`apps/ptah-cli/src/cli/commands/settings.ts`, wired in
`apps/ptah-cli/src/cli/router.ts`.

> **The bundle CONTAINS SECRET MATERIAL.** Treat an exported file exactly
> like a credential file.

### `ptah settings export [--out <path>]`

| Flag    | Required | Default  | Notes                                   |
| ------- | -------- | -------- | --------------------------------------- |
| `--out` | no       | (stdout) | Output path. Written with mode `0o600`. |

- With `--out`, the bundle is written atomically (tmp + rename) with
  permissions `0o600`, and `settings.exported { path, bytes, version }`
  is emitted.
- With **no** `--out`, the bundle goes to **stdout** and the CLI prints a
  reminder on stderr: the caller must chmod the destination itself.
  `settings.exported` is still emitted, with `path: null`.

```bash
# Explicit path — the CLI sets 0o600 for you.
ptah settings export --out ./ptah-bundle.json

# stdout form — YOU are responsible for the permissions.
ptah --json settings export > out.json && chmod 600 out.json
```

Note the flag placement: `--out` is a subcommand-local option and comes
after `export`, while `--json` is global and comes before `settings`.

### `ptah settings import [--in <path>] [--overwrite]`

| Flag          | Required | Default | Notes                                         |
| ------------- | -------- | ------- | --------------------------------------------- |
| `--in`        | no       | (stdin) | Input path. Omit to read the bundle on stdin. |
| `--overwrite` | no       | `false` | Overwrite existing credentials.               |

- Reads stdin when `--in` is omitted.
- **Existing credentials are PRESERVED unless `--overwrite` is passed.**
- Emits `settings.imported { imported, skipped, errors, source }` where
  `source` is the path or `<stdin>`.
- **Exit codes**: `0`; `2` (`UsageError`) on empty input or invalid JSON;
  `1` (`GeneralError`) when `errors[]` is non-empty; `5` on an unhandled
  failure.

```bash
ptah settings import --in ./ptah-bundle.json
cat ./ptah-bundle.json | ptah settings import --overwrite
```

---

## 6. Don't hand-edit secrets

Never edit `~/.ptah/secrets.enc.json`. Use `ptah provider set-key`,
`ptah license set`, or `ptah websearch set-key`. Secrets supplied on a
flag or on stdin land in the platform secret storage; they are never
written into `settings.json`.
