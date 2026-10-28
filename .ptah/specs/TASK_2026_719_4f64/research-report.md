# Research Report - TASK_2026_719_4f64

## Question

- Decision this supports: how task B lifts the D7 release hold. It covers real named Claude sign-in, `environment()` and A1-A3 certification, main-chat SDK runs, and Claude CLI lane runs.
- Question: how can Ptah sign in, check, and sign out a Claude account in its own `CLAUDE_CONFIG_DIR`, then run SDK chat and a CLI lane with it, while ambient auth stays unchanged?
- Bounds: no login, no credential read, no paid call, no build or test run. Sign-in behaviour without a TTY was NOT tested. Windows was the only OS run locally. macOS and Linux claims come from docs, issues and SDK source. Codex (A4) is out of scope.

## Answer

Use a per-account directory with `CLAUDE_CONFIG_DIR` and `CLAUDE_SECURESTORAGE_CONFIG_DIR` both set to the same canonical string. Use `claude auth login --claudeai` (user completes it in a node-pty terminal or an external terminal), `claude auth status --json` (read-only identity), and `claude auth logout`. Pass a rebuilt, minimal env to every named process: the SDK `env` option replaces the child env entirely, so strip all credential selectors. The predecessor's `parseClaudeAccountStatus` does not match the real JSON shape and must be rewritten. Proof of which account ran comes from `query.accountInfo()` and from `claude auth status` with the same env.

## Coordinator questions (answered explicitly)

1. Field name for the config directory in status JSON.
   - The real field is `configDirectory`, not `configDir`. The parser's `configDir` check can never pass.
   - Installed CLI: `claude --version` printed `2.1.310 (Claude Code)`. Its `claude auth status --json` run (empty temp config dir, API env removed) printed `configDirectory`, plus `projectsDirectory`, `loggedIn`, `authMethod`, `apiProvider`, `analyticsDisabled`. The SDK-bundled 2.1.278 binary has the same keys in its source text (`configDirectory:we()`). The TASK_2026_712 plan cites `configDirectory` from v2.1.268 (`implementation-plan.md:77`), and this agrees.
   - The CLI printed the path with forward slashes on Windows (`C:/Users/.../Temp/tmp.xxxx`). Compare after normalising separators and case.
   - Identity keys (logged in, claude.ai method): `email`, `orgId`, `orgName`, `subscriptionType`. These are from the 2.1.278 source text, not from a logged-in run. The plan said no email/organization schema was established, so this is new evidence, but still unrun.
2. Can `claude auth login` finish when Ptah starts it without a TTY?
   - Not proven either way. Not tested, because a test starts a real OAuth flow, which this task forbids.
   - Evidence against a plain pipe: the login screen is an Ink (terminal UI) component. It has a masked "Paste code here" text field and a "Login successful. Press Enter to continue" step (`claude.exe` 2.1.278 strings). The binary contains the Ink error "Raw mode is not supported on the current process.stdin". Docs say the CLI shows a manual code prompt when the browser cannot reach its local callback server (common in WSL2, SSH, containers).
   - Counter-evidence: `claude auth status` also renders with Ink and ran fine in a non-TTY shell here. So Ink alone does not fail without a TTY; the input steps (code paste, Enter) are the risk.
   - Inference: the browser OAuth callback to the local server can finish the sign-in without keyboard input, but the process may then wait for Enter. Not verified.
   - Recommended launch: node-pty (ConPTY on Windows) with the named env, or an external terminal window. Browser OAuth runs in the user's browser either way. Detect completion by polling `claude auth status --json` (same env) for `loggedIn:true` and the matching `configDirectory`. After success, stop the login process (send Enter, then terminate the tree). Fall back to the external terminal if PTY spawn fails. Do not use `setup-token` (it prints a token and saves nothing).
3. Windows credential location.
   - Docs (fetched 2026-10-25): Windows credentials are in `%USERPROFILE%\.claude\.credentials.json`, and with `CLAUDE_CONFIG_DIR` set the file is under that directory. Source of the SDK 0.3.278 reads the same path: `<CLAUDE_CONFIG_DIR>/.credentials.json`. So the documented default is per-account files in each directory, not a shared store.
   - Caveat (new finding): the bundled 2.1.278 Windows binary also contains a Windows Credential Manager backend (`[windows-credman]` log messages, `Bun.secrets.get/set`, `SecureStorageData too large for Credential Manager`). It is switched on by env `CLAUDE_CODE_FORCE_WINDOWS_CREDMAN=1`, or by the feature flag `cachedGrowthBookFeatures.tengu_windows_credman === true` read from `<CLAUDE_CONFIG_DIR>/.claude.json`. A new named directory has no cached flag, so it starts on the file store, but the CLI may cache the flag later. The binary also has a `plaintext_fallback_used` event and a "Storing credentials in plaintext" warning, so a fallback to the file exists.
   - Unknown: the Credential Manager target name. Its `{service, name}` pair could be per-directory or shared. This was not read. Mitigation: never decide isolation from file presence. Verify isolation with `auth status` under two different dirs, and strip `CLAUDE_CODE_FORCE_WINDOWS_CREDMAN` from the named env. The installed 2.1.310 was not checked for this flag. Run the two-account Windows live test and list the Credential Manager targets by name only (no secret read) before and after.

## Evidence

| Claim | Source | Date | Verified how |
| --- | --- | --- | --- |
| Installed `claude` is 2.1.310. SDK is 0.3.278 and bundles CLI 2.1.278 (`claudeCodeVersion`). | `claude --version`; `node_modules/@anthropic-ai/claude-agent-sdk/package.json:83`; `claude-agent-sdk-win32-x64/package.json` | 2026-10-25 | ran it / read the file |
| `claude auth` has `login [--claudeai\|--console] [--email] [--sso]`, `logout`, `status [--json\|--text]`. `claude setup-token` exists and prints a one-year token (needs subscription). | `claude auth --help`, `auth login --help`, `auth status --help`, `setup-token --help` (2.1.310) | 2026-10-25 | ran help only |
| `auth status` with a fresh empty `CLAUDE_CONFIG_DIR` and API-key env removed prints JSON `{loggedIn:false, authMethod:"none", apiProvider:"firstParty", analyticsDisabled:false, projectsDirectory, configDirectory}` and exits 1. `--text` prints `Not logged in. Run claude auth login to authenticate.` and exits 1. The temp dir was removed. | local run (temp dir only, no real credential) | 2026-10-25 | ran it |
| Logged-in JSON adds `email`, `orgId`, `orgName`, `subscriptionType` (claude.ai method) or `email` (gateway). `apiKeySource` is added when an API key is the source. `forcedLoginMethod` is added when policy sets it. Exit code is 0 only if `loggedIn`. | strings in `claude-agent-sdk-win32-x64/claude.exe` (2.1.278): `s={loggedIn:I,authMethod:f,apiProvider:A,...configDirectory:we()}...process.exit(I?0:1)` | 2026-10-25 | read binary text, not run logged-in |
| Credential store name on macOS: `"Claude Code"+suffix+"-credentials"+("-"+sha256(NFC(dir)).slice(0,8) when a dir is set)`. The dir is `CLAUDE_SECURESTORAGE_CONFIG_DIR` if defined (empty string means default entry), else `CLAUDE_CONFIG_DIR`. The suffix is added if the variable is set, not by its value. | `claude-agent-sdk/sdk.mjs` function `J9` | 2026-10-25 | read the source |
| File store is `<CLAUDE_CONFIG_DIR or ~/.claude>/.credentials.json`. The SDK reads the keychain fallback only when `CLAUDE_CONFIG_DIR`, `ANTHROPIC_API_KEY` and `CLAUDE_CODE_OAUTH_TOKEN` are all unset. | `sdk.mjs` (session-store resume code, `woe(Gt(f,".credentials.json"))`) | 2026-10-25 | read the source |
| Docs: macOS uses Keychain keyed to the config dir. Linux is `~/.claude/.credentials.json` (0600). Windows is `%USERPROFILE%\.claude\.credentials.json`. With `CLAUDE_CONFIG_DIR`, the file is under that dir and the Keychain entry is keyed to it. | https://code.claude.com/docs/en/authentication ("Credential management") | fetched 2026-10-25 | read the page |
| Docs: "Log in with multiple accounts" uses one `CLAUDE_CONFIG_DIR` per account. Console sign-in without an API key stores outside the config dir, so such accounts are not separated, and it "signs you out of any claude.ai login stored on the machine". | same page | fetched 2026-10-25 | read the page |
| Docs: precedence is (1) cloud provider vars, (2) `ANTHROPIC_AUTH_TOKEN`, (3) `ANTHROPIC_API_KEY` (always used with `-p`), (4) `apiKeyHelper`, (5) `CLAUDE_CODE_OAUTH_TOKEN`, (6) Anthropic profile/federation, (7) subscription OAuth from `/login`. A gateway session outranks all. | same page ("Authentication precedence") | fetched 2026-10-25 | read the page |
| `ANTHROPIC_PROFILE` or the federation vars rank above `/login`. An `oidc_federation` active profile ranks above `/login`. A `user_oauth` active profile ranks below. Profiles live in `~/.config/anthropic` or `%APPDATA%\Anthropic`. | same page ("Anthropic profiles") | fetched 2026-10-25 | read the page |
| SDK `options.env` REPLACES the subprocess env (no merge with `process.env`). `pathToClaudeCodeExecutable` selects the binary. | `sdk.d.ts:1565-1585`, `sdk.d.ts:1889` | 2026-10-25 | read the types |
| `accountInfo()` returns `{email, organization, subscriptionType, tokenSource, apiKeySource, apiProvider}`. The `init` system message carries `apiKeySource` of `'ANTHROPIC_API_KEY'\|'apiKeyHelper'\|'/login managed key'\|'none'\|'user'\|'project'\|'org'\|'temporary'\|'oauth'`, `claude_code_version`, `model`, `cwd`. | `sdk.d.ts:23-33`, `:131`, `:5580-5601` | 2026-10-25 | read the types |
| Haiku id strings in the 2.1.278 binary: `claude-haiku-4-5` and `claude-haiku-4-5-20251001`. | grep of `claude.exe` | 2026-10-25 | read binary text |
| `CLAUDE_SECURESTORAGE_CONFIG_DIR` overrides which credential store is used, independently of `CLAUDE_CONFIG_DIR`. It is undocumented as of Claude Code 2.1.301. | https://github.com/anthropics/claude-code/issues/79223 | 2026-10-15 | read search extract |
| macOS: a service name with `-<8 hex>` exists per used config dir. A session whose `CLAUDE_CONFIG_DIR` equals `~/.claude` looks for a suffixed entry that does not exist for a normal login. | https://github.com/anthropics/claude-code/issues/30031 ; https://github.com/thedotmack/claude-mem/issues/4149 | 2026-09 / 2026-10 | read search extract |
| Bug reports: Linux/WSL2 "does not isolate" (closed not planned); credentials written under a literal `~` dir in cwd; macOS shared entry (closed duplicate of #20553). | https://github.com/anthropics/claude-code/issues/47661 ; #37570 ; #70697 ; #20553 | 2026 | read search extract (not reproduced) |
| Concurrent sessions can race on OAuth refresh. `CLAUDE_CODE_OAUTH_TOKEN` can delete the shared macOS Keychain entry on exit. | issues #24317 and #37512, cited inside #70697 | 2026 | read as a citation only |
| 2.1.301 fixed "sign-in refresh timeouts and unexpected sign-outs after a short command such as `claude auth status`". | https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md | fetched 2026-10-25 | read (first 100k characters only) |
| Predecessor parser accepts only keys `configDir, authMethod, email, organization` with `authMethod` `'claude.ai'\|'none'`. `execute` runs `claude auth <kind>` with no flags. `environment()` and `authorization()` fail closed. `certifyClaudeAccountEnvironment` demands every settings object be empty. | `libs/backend/auth-providers/src/lib/accounts/claude-account-command.ts:47-145` | 2026-10-25 | read the file |
| Predecessor A1-A3 text: A1 status gives source/directory. A2 no-prompt query gives `accountInfo()` before data release. A3 selected-dir `.claude.json` behaviour and effective project/local/managed auth precedence. All HELD. | `.ptah/specs/TASK_2026_712_5d7c/implementation-plan.md:80-82`; `decisions.md:299` | 2026-10-22 | read the files |

## Options

| Option | Fit here | Cost to adopt | Known failure mode |
| --- | --- | --- | --- |
| A. `CLAUDE_CONFIG_DIR` + `CLAUDE_SECURESTORAGE_CONFIG_DIR` (same string) + `claude auth login --claudeai` | Matches the predecessor's `certifyClaudeAccountEnvironment` output (lines 74-75). Works on all three OS per docs and SDK source. | Rewrite status parser. Choose a login launcher (below). | Directory string must be byte-identical for login, status and runs on macOS (hash of exact string). A dir equal to `~/.claude` maps to a different macOS entry once the variable is set. Refuse that dir. |
| B. `claude setup-token` and `CLAUDE_CODE_OAUTH_TOKEN` per account | Fits headless. | Ptah must hold a token secret. | Token is printed, not saved. It outranks `/login`. It cannot do Remote Control or connectors. It has no `auth status` identity. It conflicts with "no token reads". Not recommended. |
| C. `--console` login | Not needed for subscription accounts. | None. | Stores outside the config dir and signs out claude.ai login machine-wide. Block it. |
| Login launcher 1: node-pty terminal in Ptah | Keeps the flow in the app. | Medium. node-pty must be available in Electron. | TTY need for `auth login` is untested here. The binary contains Ink "Raw mode is not supported" text, so a TTY is likely required (inferred). Browser callback failure on WSL/SSH leads to a "Paste code here" prompt. |
| Login launcher 2: external terminal | Lowest risk. User completes it personally. | Low. Per-OS terminal spawn (`start`, Terminal.app, `x-terminal-emulator`). | Ptah cannot see the terminal. It must poll `auth status`. |
| Plain pipe spawn (current `execute('login')`, `detached`, no PTY) | Present code. | None. | Likely fails without a TTY (inferred, untested). Do not rely on it. |

## Disagreements

- Linux isolation: issue #47661 says Linux/WSL2 does not isolate. Docs say the file is under `CLAUDE_CONFIG_DIR`. The SDK source (`Gt(f,".credentials.json")` where `f` is `CLAUDE_CONFIG_DIR`) and the docs agree for 2.1.278. The issue is older and was closed "not planned". Treat the docs and source as current, but run the Linux live test (Unknowns) before claiming it.
- macOS isolation: issue #70697 says one shared entry. Issue #30031, #79223 and `sdk.mjs` `J9` show a suffixed per-dir entry. The source decides: isolated, with the "set, not value" caveat.
- Docs list `/login` and `claude auth login`. The CLI reference says nothing about the JSON shape. The shape comes only from the binary and one local run.

## Local consequences

- `claude-account-command.ts` `parseClaudeAccountStatus` (lines 86-100): wrong. Real keys are `loggedIn`, `authMethod`, `apiProvider`, `configDirectory`, `projectsDirectory`, `analyticsDisabled`, `email`, `orgId`, `orgName`, `subscriptionType`, optional `apiKeySource`, `forcedLoginMethod`. Real output rejects at `Object.keys(...).some(...)`. Compare `configDirectory` after path normalisation (the CLI printed forward slashes on Windows). Accept `authMethod` values other than the two (for example API key or gateway) and treat anything other than `claude.ai` as `refuse`. Require `apiProvider === 'firstParty'`. Treat exit code 1 plus `loggedIn:false` as a normal logged-out result, not a failure.
- `execute()` (line 132): use `['auth','login','--claudeai']`. Never `--console`. Optionally pass `--email`.
- `environment()` / `certifyClaudeAccountEnvironment` (lines 51-77): the output shape is right (minimal baseline plus both dir variables). Two gaps: (1) the key list does not cover `ANTHROPIC_PROFILE` aliases beyond the listed names. It does list `ANTHROPIC_PROFILE` and `ANTHROPIC_CONFIG_DIR`. Add `ANTHROPIC_FEDERATION_RULE_ID`, `ANTHROPIC_ORGANIZATION_ID`, `ANTHROPIC_IDENTITY_TOKEN_FILE`, `CLAUDE_CODE_HOST_*` and `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST` (these names appear in the 2.1.278 binary env allowlist). Better: use an allowlist (already done with BASELINE), and add `ANTHROPIC_CONFIG_DIR` pointing to an empty dir inside the account dir to block ambient federation profiles in `%APPDATA%\Anthropic` (idea; untested). (2) `BASELINE` lacks `USERNAME`, `SystemDrive`, `ProgramData`, `ProgramFiles`, `NODE_*` and proxy vars, which may break Windows runs. Test on Windows.
- A3 gate: requiring all effective settings to be `{}` rejects any real user. Ambient risk lives in project/local/managed settings (`apiKeyHelper`, `env` block, `forceLogin*`). User settings come from the named dir. Certify by (a) reading `auth status` with the same env and cwd, (b) confirming `apiProvider==='firstParty'` and `authMethod==='claude.ai'`, and (c) the run-time `accountInfo()` check. Record unresolved managed-policy cases as refusal.
- Version gate: read `claude --version` (installed: `2.1.310 (Claude Code)`) and the SDK-bundled version from the `init` message `claude_code_version`. Fail closed below a floor. Evidence supports a floor of 2.1.278 (all shapes verified in the binary). Inferred safer floor: 2.1.301 (the auth-status sign-out fix). The version that first added `claude auth status --json` was not found. Unknown version stays fail-closed.
- Main chat: pass `options.env = certifyClaudeAccountEnvironment(...)` (the SDK replaces env, so there is no leak by merging). Set `pathToClaudeCodeExecutable` only if Ptah wants the installed 2.1.310 instead of the bundled 2.1.278; the status check and the run should use the same binary so JSON shape and keychain naming agree. Then call `accountInfo()` and verify identity before opening the prompt gate (A2).
- CLI lane: spawn the same executable with the same env object. Never inherit `process.env`.
- Concurrency: main chat and a lane on the same account share one refresh token. Reported refresh races (#24317) mean Ptah should avoid running two processes on one account at once, or treat sign-out as a runtime event.
- Sign-out: `claude auth logout` with the named env. It clears that dir's credential. Verify by `auth status` exit 1.

## Env to strip (named run and named auth commands)

Remove every key in the existing `CLAUDE_ACCOUNT_SELECTOR_KEYS`, plus: `ANTHROPIC_FEDERATION_RULE_ID`, `ANTHROPIC_ORGANIZATION_ID`, `ANTHROPIC_IDENTITY_TOKEN_FILE`, `ANTHROPIC_SCOPE`, `CLAUDE_CODE_HOST_CREDS_FILE`, `CLAUDE_CODE_HOST_AUTH_ENV_VAR`, `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST`, `CLAUDE_CODE_REMOTE_SETTINGS_PATH`, `CLAUDE_CODE_MANAGED_SETTINGS_PATH` (the last three names are from the binary env list, unverified in use). Also remove `ANTHROPIC_API_KEY` (always wins with `-p`/SDK) and `CLAUDE_CODE_OAUTH_TOKEN` (outranks `/login`). Then set the two dir variables. Also set `settingSources` so that project settings cannot add `apiKeyHelper` or `env` auth (A3 item, not verified).

## Command shapes

- Login: `claude auth login --claudeai [--email <e>]`. Opens a browser. Prints a URL and a "Paste code here" fallback. Prints `Login successful` (docs). Exit code not verified.
- Status: `claude auth status --json`. Exit 0 if logged in, 1 if not. Logged-in claude.ai example shape (inferred from source): `{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","analyticsDisabled":false,"projectsDirectory":"...","configDirectory":"...","email":"...","orgId":"...","orgName":"...","subscriptionType":"max"}`.
- Logout: `claude auth logout`. Success text: `Successfully logged out from your Anthropic account.` (binary string).
- Detecting completion: poll `auth status --json` with the named env until `loggedIn` is true, `configDirectory` matches, and `authMethod==='claude.ai'`. Do not read `.credentials.json` or the keychain.

## Cheap live test

Model: `claude-haiku-4-5-20251001` (alias `claude-haiku-4-5`). Confirm account: (1) `init` message `apiKeySource` should be `oauth` or `none`, and never `ANTHROPIC_API_KEY`; (2) `await q.accountInfo()` gives `email`, `organization`, `subscriptionType`, `tokenSource`; (3) compare with `auth status --json` under the same env. Use an empty prompt stream to read `accountInfo()` before any paid turn (A2 plan). Use two accounts with different emails to prove isolation. Also check the default account's `auth status` before and after is unchanged.

## Unknowns

- Whether `claude auth login` needs a TTY. Smallest test: run it under a pipe with a throwaway empty dir and cancel (needs user approval; it starts a real OAuth flow).
- Exact logged-in JSON and exit codes. Smallest test: user logs in once to a throwaway dir, then `auth status --json`.
- The first CLI version with `auth status --json`. Changelog read stopped near 2.1.296.
- Linux and macOS behaviour was not run here. Smallest test: one sign-in per OS and check that no default store changes.
- Whether an ambient federation or active profile (`%APPDATA%\Anthropic`) can outrank the named login, and whether pointing `ANTHROPIC_CONFIG_DIR` to an empty dir blocks it.
- Whether managed or project settings can inject auth after the env is stripped (A3).
- Whether `auth status` refreshes the token and writes the store (changelog 2.1.301 suggests it can).
- Whether the Windows Credential Manager backend (flag `tengu_windows_credman`, env `CLAUDE_CODE_FORCE_WINDOWS_CREDMAN`) is per-directory, and whether it is active in 2.1.310. See coordinator question 3. Also strip `CLAUDE_CODE_FORCE_WINDOWS_CREDMAN` from named env.
- Whether the bundled (2.1.278) and installed (2.1.310) binaries differ in credential naming. Source was read only for 2.1.278.

## Decisions

- Recommend `--claudeai` only. Reversible. Evidence: Console keyless login writes outside the config dir.
- Recommend both dir variables set to one canonical string. Reversible. Evidence: `J9` source and the predecessor's existing choice.
