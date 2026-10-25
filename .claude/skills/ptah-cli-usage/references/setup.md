# Ptah CLI — install, first run, config and troubleshooting

Covers where the `ptah` binary comes from, the agent-driven setup flow
(`ptah init` / `ptah doctor`), the config directory, the environment
variables that matter for headless runs, and the failure modes you will
actually hit.

---

## 1. Install

```bash
npm i -g @hive-academy/ptah-cli     # provides the `ptah` binary
```

The package declares `"bin": { "ptah": "./main.mjs" }`. On Windows the
global install lands as a `.cmd` shim, which is why any process that
spawns `ptah` must pass `shell: true` on `win32` (see §6).

You can also run it without installing:

```bash
npx -y @hive-academy/ptah-cli --version
```

---

## 2. Agent-driven setup (read this first)

If you are an AI coding agent asked to "set Ptah up" on a user's machine,
follow this exact flow. A fresh install ships with **no default provider**
(`llm.defaultProvider: ""`) and no credentials, so streaming commands exit
`3` (`auth_required`) until you finish setup. Do not skip the verify step.

1. **See what's missing.** Run the readiness oracle in machine mode and
   parse the result:

   ```bash
   ptah doctor            # emits doctor.report
   ```

   Read `effective.ready` (the source of truth — it reflects the exact
   slot the SDK reads), `effective.blockers[]`, and `hints[]` (the literal
   commands to run). When `defaultProvider` is unset, `doctor` reports a
   clear "no provider selected" blocker.

2. **Or get an ordered plan.** Run `ptah init` in machine mode (the
   default whenever stdout is not a TTY, or when `--json` / `--quiet` is
   passed — it NEVER prompts in this mode):

   ```bash
   ptah init              # emits a single init.plan, then exits 0
   ```

   Parse `init.plan.params.steps[]` — an ordered array of
   `{ id, description, command, satisfied }`. For every step where
   `satisfied:false`, run its `command`. Also read `ready`, `route`,
   `blockers`, `license`, and `auth` on the same payload.

3. **Have the human supply secrets — never invent them.** You do not have
   the user's API key or license key. Ask the user to run the credential
   commands themselves (so raw secrets never pass through you):

   ```bash
   ptah provider set-key --provider anthropic --key sk-ant-...   # user runs this
   ptah provider default set anthropic                           # then pick the provider
   ptah license set --key ptah_lic_...                           # optional
   ```

   Alternatively the user can export `ANTHROPIC_API_KEY` in the shell that
   spawns `ptah`. Do NOT fabricate, guess, or hard-code any key.

   **Trust the exit code and `verified`, not a bare `success`.**
   `provider set-key` format-validates the key: a malformed key is
   rejected with exit `3` and `verified:false`; a good key returns exit
   `0` with `verified:true`. `license set` rejects a server-rejected key
   with exit `4` (`license_required`).
   A nonzero exit or `verified:false` means setup did not land.

4. **Verify before proceeding.** Re-run `ptah doctor` and only continue
   when `effective.ready:true`. `doctor` and `session start` agree — if
   `doctor` says ready, a turn will start.

5. **Run the work.**
   - One-shot (fire-and-forget): `ptah session start --task "..." --once`
     — ALWAYS pass `--once` for one-shots so the process exits.
   - Persistent / bridge: `ptah interact` — serialize `task.submit`
     requests (one in flight at a time) and respond to every
     `permission.request` / `question.ask` outbound request. For
     unattended runs set `PTAH_AUTO_APPROVE=true`.

The per-provider recipes in `references/auth-and-providers.md` are the
manual equivalent of what `ptah init` plans for you. The keystone behind
this flow: `provider set-key` writes the exact secret slot the SDK reads
(`AuthSecretsService`) and persists `authMethod`, so a pure-CLI bootstrap
(`set-key` → `default set` → `session start --once`) actually starts a
session — the old `ANTHROPIC_API_KEY`-env-var-only workaround is no longer
required (it still works as an alternative).

---

## 3. Config directory

Persistent state lives under `~/.ptah`:

| Path                       | Holds                                                     |
| -------------------------- | --------------------------------------------------------- |
| `~/.ptah/settings.json`    | Non-secret settings (providers, tiers, orchestration).    |
| `~/.ptah/secrets.enc.json` | Encrypted secret envelopes. Never hand-edit.              |
| `~/.ptah/ptah.db`          | SQLite store (memory, cron, sessions).                    |
| `~/.ptah/proxy/`           | Per-port bearer tokens minted by `ptah proxy start`.      |
| `~/.ptah/proxies/`         | Registry of running proxies, read by `ptah proxy status`. |

Override the whole data directory — settings, secrets, sqlite and
migrations all move with it — with either:

- the global flag `ptah --config <dir> …`, or
- the `PTAH_CONFIG_PATH` environment variable.

The flag wins when both are present. `--config` is a **global** flag, so
it goes before the subcommand.

---

## 4. Headless / unattended runs — environment variables

| Env var                    | When to set                                       | Effect                                                                                                              |
| -------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `PTAH_AUTO_APPROVE`        | CI, daemons, `proxy start` w/o JSON-RPC peer      | Auto-allow every `permission.request` (same as `--auto-approve`).                                                   |
| `PTAH_NO_TTY`              | Containers, CI, anything where `isTTY` may lie    | Force non-TTY mode; suppresses ANSI even with `--human`.                                                            |
| `NO_COLOR`                 | Pipelines, log aggregators                        | Any non-empty value disables ANSI in `--human` mode.                                                                |
| `FORCE_COLOR=0`            | Bridge spawning the CLI from another process      | Disables color in deps that read it (matches Windows spawn pattern). Combine with `setEncoding('utf8')` on streams. |
| `PTAH_LOG_LEVEL`           | Debugging                                         | `debug` \| `info` \| `warn` \| `error`. `debug` writes to **stderr only**; never poisons stdout.                    |
| `PTAH_CONFIG_PATH`         | Sandboxed runs / multi-tenant CI                  | Override the `~/.ptah` data directory (§3).                                                                         |
| `PTAH_HOST_SCHEMA_VERSION` | A host that pins a JSON-RPC schema version        | Compared against the CLI's schema on boot; a mismatch warns on stderr and does not abort.                           |
| `PTAH_MCP_HOST_SESSION_ID` | Set BY `mcp-serve`, read downstream               | Cost-attribution key for the life of an `mcp-serve` process.                                                        |
| `ANTHROPIC_API_KEY`        | Anthropic direct without `set-key`                | Picked up by the api-key auth strategy.                                                                             |
| `ANTHROPIC_AUTH_TOKEN`     | Z.AI / Moonshot / any Anthropic-compatible vendor | Used together with `ANTHROPIC_BASE_URL` to point the SDK at a non-Anthropic endpoint.                               |
| `ANTHROPIC_BASE_URL`       | Custom Anthropic-compatible endpoint              | Overrides the SDK's default base URL.                                                                               |

Reminder: `PTAH_AGENT_CLI_OVERRIDE` is **not** consulted, and there is
nothing for it to override — `agent-cli --cli` accepts every CLI agent
target Ptah has an adapter for. See
`apps/ptah-cli/src/cli/commands/agent-cli.ts`.

---

## 5. Troubleshooting

### `sdk_init_failed`

The `agent-sdk` adapter failed to initialize during the `'full'`
bootstrap. Most common causes: missing API key, unreachable provider,
broken `~/.ptah/settings.json`. Recovery:

```bash
ptah --verbose auth status         # see debug.di.phase events
ptah --reveal provider status      # confirm the right key is stored
ptah provider default get          # confirm the active provider
PTAH_LOG_LEVEL=debug ptah session start --task "ping" --once 2> ptah.log
```

If `requireSdk` was invoked from a metadata-only path (e.g. listing
providers), drop to `mode: 'minimal'` — see
`libs/backend/cli-engine/src/lib/bootstrap/with-engine.ts`. The full
bootstrap only runs for chat / setup / wizard / generation commands.

### `auth_required` from a streaming command

A streaming command (`session start`, `setup`, `analyze`,
`execute-spec`) ran with no usable credentials. Recovery:

```bash
ptah auth status                                        # which providers are healthy?
ptah provider set-key --provider anthropic --key sk-... # or relevant provider
ptah provider default set anthropic
```

Exit code `3`. In CI, also set `PTAH_AUTO_APPROVE=true` so subsequent
permission gates don't block.

### `license_required`

The server rejected a license key handed to `ptah license set`. Recovery:

```bash
ptah license status
ptah license set --key ptah_lic_...
```

Exit code `4`.

### Bridge / spawn issues on Windows

- `spawn('ptah', ...)` with `shell: false` → ENOENT (the `.cmd` shim).
  Fix: `shell: true` on `process.platform === 'win32'`.
- Stale ANSI / mojibake in captured output: set `FORCE_COLOR=0`,
  `NO_COLOR=1`, `PTAH_NO_TTY=1`; `setEncoding('utf8')` on the child's
  stdout.
- Truncated tail of the JSON-RPC stream: `process.stdout.write` is
  async on Windows pipes. Wait for the `task.submit` response and drain
  before tearing down — see the "stdout drain" note in
  `apps/ptah-cli/CLAUDE.md`.

### Logs / verbose mode

- Logger output: **stderr only**. Pipe stdout through `jq` safely.
- `PTAH_LOG_LEVEL=debug` enables noisy backend logs (still stderr).
- `--verbose` enables `debug.di.phase` notifications on stdout (one per
  DI phase). It is a global flag: `ptah --verbose auth status`.
