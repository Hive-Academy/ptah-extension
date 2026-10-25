# Batch 35 implementation report: host DI/RPC surface and Claude exit evidence checkpoint

Nothing was run (no jest, tsc, nx, lint). `ptah_get_diagnostics` on the five edited specs timed out at 45 s ("still running"), so the new tests are **unverified until the orchestrator's scoped run**. Command for it: `Verify-ProviderAccountsBatch -Projects @('ptah-extension-vscode','@ptah-extension/rpc-handlers') -Hosts $H`, plus the Electron project because `container.smoke.spec.ts` changed.

## Files changed (5 of the 6 owned)

| File | Change |
| --- | --- |
| `libs/backend/rpc-handlers/src/lib/handlers/provider-account-rpc.handlers.spec.ts` | Extended (not rewritten): new describe "construction and notification evidence (Batch 35)" with 3 tests. |
| `libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.spec.ts` | +1 test: `ProviderAccountRpcHandlers` registered, never resolved. |
| `libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.activation.spec.ts` | +2 tests: activation does not construct the account handler; admission token resolves fail-closed with no SQLite. |
| `libs/backend/rpc-handlers/src/lib/rpc-allowlist.spec.ts` | +4 tests: exact registry / manifest / prefix-allowlist partition for the ten account methods. |
| `apps/ptah-electron/src/di/container.smoke.spec.ts` | +2 tests (D32): resolves `ProviderAccountRpcHandlers` once and registers exactly its ten methods; Electron host profile has `providerAccounts === true`. |
| `apps/ptah-extension-vscode/src/di/expected-resolvable.ts` | **Not changed** (see Decisions). |

New tests:

- **Handler spec**
  - "registration and construction read no account storage": `service.calls` is `[]` and `registerMethod` is called once per method (10).
  - "pushes a sanitized snapshot: no path, email, token or fingerprint": a store row carrying `configDir`, `email`, `accessToken` and `routeFingerprint`; neither the RPC result nor the `provider:accountsChanged` payload contains them.
  - "a refused write pushes nothing and leaves revisions consecutive": a stale rename between two adds; the pushed `requestId`s are [1,3] and the revisions are consecutive.
- **register-shared**
  - "registers the provider account handler lazily, as a singleton binding": `isRegistered` is true; nothing is resolved.
- **activation**
  - "activation leaves the account handler registered but never constructed": resolving it afterwards still throws because `TOKENS.RPC_HANDLER` is unbound, so activation did not build it.
  - "the admission token resolves fail-closed with no SQLite connection, reading no database": `admitClaudeRoute` returns `release-held`.
- **allowlist**
  - Ten distinct methods, all in `RPC_METHOD_NAMES`.
  - Each method is owned exactly once, by `providerAccounts`.
  - The `providerAccounts` entry claims only those methods.
  - Every method is under the allowlisted `provider:` prefix.
- **Electron smoke**
  - Registers fakes for `WEBVIEW_MANAGER` and `ProviderAccountService` (typed `Pick<>`, no casts), resolves the handler twice (same instance), calls `register()`, and compares the registered methods to `METHODS`.
  - Checks `createElectronRpcHostProfile(...).capabilities.providerAccounts`.

Already covered before this batch and not duplicated:

- `manifest.spec.ts` "provider account RPC manifest (D30)": capability gating on and off.
- `rpc-surface.spec.ts` (vscode and electron): non-Electron absent, Electron full.
- `cli-engine/rpc-surface.spec.ts` and `expected-absent.ts`: CLI and VS Code keep `providerAccounts` false and the handler absent.
- The handler spec: CAS, duplicate request, the fb0041487 durable-request-id Add (eviction and restart), refusal copy, release hold.

## Decisions

- **VS Code `expected-resolvable.ts` left unchanged.** The account handler is deliberately absent on VS Code, so it lives in `expected-absent.ts` (already present, D30). Its admission token resolves fail-closed there, and that is proved in `auth-providers/src/lib/di/register.spec.ts` ("hands out fail-closed admission when the SQL connection is not registered"). Adding an unused token export would be dead code, and the VS Code smoke spec is not in my ownership. Reversible: add `AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_ACCOUNT_ADMISSION` as an exported constant plus a smoke case.
- **`ProviderAccountRpcHandlers` not added to the Electron `EXPECTED_RESOLVABLE`.** Only the VS Code copy was owned. The Electron smoke resolves it in a dedicated test instead (D32).
- **"List/message capabilities match handle" for the claude lane (D38): not added.** It does not fit the five owned specs. See OPEN row C17.

## Old-surface cross-check (base 0fc0c3a09, read-only)

Main moved after that base. The merge-base with `main` is 6b63d0dd3, and `git diff 0fc0c3a09 HEAD` is dominated by unrelated drift (skill-synthesis, tray). I therefore compared the inventory rows against HEAD directly.

- **Present at HEAD:**
  - `SYSTEM_CLI_TYPES` = the 7 originals plus `claude` (derived list, no second list).
  - Adapters for codex, copilot, cursor, antigravity, opencode, pi and grok are still registered; `claude` is added conditionally (`cli-detection.service.ts:95`).
  - `maxConcurrentAgents()` and `disabledClis` handling are intact.
  - `agent-cli.ts`: +73/-1 only.
  - `provider-owner.resolver.ts` and `agent-process.types.ts` are additive; the removed email/organization lines moved into the account-aware owner path (`provider-owner.accounts.spec.ts`).
- **Net removal needing an explanation:** `ptah-cli-registry.ts` is 35 added and 326 removed against the merge-base. The stream loop, stderr classification and `--replay-user-messages` handling moved into `claude/claude-sdk-lane-runner.ts` and `claude-sdk-lane-options.ts`. That is the shared extracted runner (Batch 20, decisions around line 159), not an omission. The ambient log text was restored per the decision. It stays covered by `claude-sdk-lane-runner.spec.ts` "preserves complete native options without a PtahCliConfig" and `claude-cli.adapter.spec.ts` "forwards empty native auth, real context and complete policy options to the extracted runner".
- **Omitted capability (blocker): none found.** One residual risk: I did not diff every removed line of `ptah-cli-registry.ts` against the runner. Reviewers should confirm the stderr-severity and `--name` builder behaviour still reach the Ptah CLI (non-claude) path.

## Checkpoint table (Claude requirements and parity rows)

"Spec exists" means I confirmed the file and test titles in the tree. **Pass status is not observed by me**; it relies on the orchestrator's per-batch scoped runs. Test names are abbreviated from the specs.

| Req / row | Proof (file: test) | Status |
| --- | --- | --- |
| 1 Claude listed as own lane, separate from codex and `claude-cli` ptah provider | `cli-agents/cli-adapters/claude-cli.adapter.spec.ts`: "detects the executable and SDK without status, model probes or inference", "isolates a missing executable"; `agent-cli.spec.ts` | Spec exists |
| 2 Spawn via existing SDK runner, dir on child env only | `agent-sdk/.../claude-account-route-env.spec.ts`: "does not mutate process.env or AuthEnv"; `claude/claude-sdk-lane-runner.spec.ts`: "applies named routing after safe env and never overwrites it" | Spec exists |
| 3 No named profile keeps ambient dir (empty native auth is not `~/.claude`) | `claude-account-route-env.spec.ts`: "preserves the native safe allowlist and does not invent an ambient directory", "adds no account env to a clean ambient constructor"; `claude-sdk-lane-runner.spec.ts`: "preserves complete native options without a PtahCliConfig" | Spec exists |
| 4 Two profiles run together, no host `process.env` write | `claude-account-route-env.spec.ts`: "keeps simultaneous distinct route construction independent of ambient selectors"; `provider-account-route.spec.ts` (same-dir records not isolated) | Spec exists |
| 5 Resume keeps stored profile, no rebind | `agent-process-manager.account-binding.spec.ts`: "retains the original immutable route through a fresh handoff and label/default changes", "refuses a corrupt authoritative record, a missing named link and a changed binding"; `session-metadata-store.account-binding.spec.ts`; `chat-session.account-binding.spec.ts` | Spec exists |
| 6 Quota owner = verified email+org identity | `provider-owner.accounts.spec.ts`: "uses trimmed email and organization, independent of the configuration directory", "separates changed email and changed organization", "never promotes failed route/run proof to the previously known owner"; `plan-owner-read.accounts.spec.ts` | Spec exists |
| 7 One usage tile per verified owner | `usage-analytics/.../claude-ledger.accounts.spec.ts`; `auth-providers/.../plan-usage.accounts.spec.ts` | Spec exists |
| 8 Selection/default change does not move a started run | `agent-process-manager.account-binding.spec.ts` (same retain test); handler spec "sets one scope selection" and "sets the default for both scopes in one write" (future-start writes only) | Spec exists |
| 9 Other lanes unchanged | Per-adapter specs (codex, copilot, cursor, antigravity, opencode, pi, grok) at HEAD; `cli-agent-runtime/.../register.agent-process-manager.smoke.spec.ts` | Spec exists |
| 10 Foreign-route API key/base URL cannot replace the account | `claude-account-route-env.spec.ts`: "clears Windows selector casing...", "applies the named route after all env spreads and preserves permission policy"; `session-query-executor.accounts.spec.ts` | Spec exists |
| 11 No release of named subscription sign-in | Handler spec "release hold (D7)": `startAccountSignIn`/`signOutAccount`/`cancelAccountSignIn` return `release-held`, no calls, no push; `register.spec.ts` fail-closed admission; new activation test | Spec exists (mock level). **Release authorization stays OPEN (user-reserved).** |
| 12 / 13 / 14 Codex (Phase 2) | Out of Claude scope (moved to TASK_2026_715_6cba) | N/A |
| 15 Electron surface: add, status, sign-in, sign-out, choose; dark and light | Add, status, select and default: handler spec writes/reads. UI: Batches 31/32/33 specs (`account-chooser`, `add-account-dialog`, `account-details-drawer`, Providers settings Accounts section). Sign-in and sign-out are `release-held` | Add/status/select proven at mock level. **Rendered Electron dark/light evidence OPEN (held).** |
| 16 Sign-in transitions via mocked seam | `provider-account-actions.service.spec.ts` (mock seam); handler holds named launch | Mock only. **Live named auth OPEN (held).** |
| 17 Lane capabilities match the runner's real handle | `claude-cli.adapter.spec.ts` capability and isolation fixtures (lines ~67-72) | **OPEN**: the D38 "list/message capabilities match handle" test is not written; it does not fit the five owned files. Needs a follow-up in `claude-cli.adapter.spec.ts` |
| 18 Model/effort forwarding and precedence | `claude-cli.adapter.spec.ts`: "forwards explicit models unchanged, ignores modelTier and does not invent a default", "logs unsupported explicit effort without a model and preserves precedence" | Spec exists |
| 19 CLI enum, `--cli`, preferred order derive from `SYSTEM_CLI_TYPES` | `agent-process.types.ts` at HEAD (single list incl. `claude`); `agent-cli.spec.ts`; `cli-engine/.../rpc-surface.spec.ts` | Spec exists |
| 20 Concurrency cap | `agent-process-manager.guard.spec.ts` / `agent-process-manager.service.spec.ts` (touched), `maxConcurrentAgents()` unchanged | Spec exists |
| 21 No secrets in metadata/surfaces | Handler spec "strips fields the summary contract does not name", new "pushes a sanitized snapshot", "redaction" describe; `provider-account.store.spec.ts` | Spec exists. New test unrun |
| 22 No rotation, copy or failover | `provider-account-auth-env.spec.ts`, `provider-account-route.spec.ts`, runner refusal on changed binding | Spec exists |
| 23 Default-account run on VS Code, Electron, CLI, TUI | `ptah-extension-vscode/.../container.smoke.spec.ts`, `rpc-surface.spec.ts`; `ptah-electron` smoke and `rpc-surface.spec.ts`; `ptah-cli/src/di/container.smoke.spec.ts`; `cli-engine/.../rpc-surface.spec.ts` | Spec exists. Scoped runs per host are the orchestrator's |
| 24 No live login or paid call | All specs use temp dirs, fakes and the mock action seam | Holds by construction |
| This batch: methods registered exactly once and allowlisted | `rpc-allowlist.spec.ts` "provider account methods", `manifest.spec.ts` "gates exactly the account methods behind providerAccounts" | New, unrun |
| This batch: capability true on Electron, false elsewhere | Electron smoke "the Electron host profile turns providerAccounts on"; `manifest.spec.ts`; vscode `expected-absent.ts`; cli-engine `expected-absent.ts` | New + existing |
| This batch: capability/workspace refusal | Handler spec "authority": closed workspace gives `UNAUTHORIZED_WORKSPACE`, relative root never resolved, no side effects | Existing |
| This batch: CAS and idempotency incl. fb0041487 durable-id Add | Handler spec "forwards the request ID so a repeated Add after ledger eviction adds no duplicate", "a repeated Add on a new handler instance (restart) adds no duplicate", "refuses a reused request ID carrying different params", "renames at the expected revision and refuses a stale one" | Existing |
| This batch: notification ordering | "pushes one notification per committed revision, in order"; new "a refused write pushes nothing and leaves revisions consecutive" | Existing + new |
| This batch: no eager DB at construction | New handler test; new register-shared and activation tests; `auth-providers/.../register.spec.ts` ("resolves account singletons ... without reading the DB") | New + existing |
| This batch: DI resolves in Electron (D32) | Electron smoke "resolves ProviderAccountRpcHandlers once..." | New, unrun |
| Parity: ambient native provider unchanged | Rows "Native auth returns an empty auth env", "Safe child env allowlist", `with-engine.spec.ts` claudeCli rewrite, `provider-form.spec.ts` | Existing specs |
| Parity: Electron/settings/host rows (Providers settings, `disabledClis`, VS Code settings, hosts share backend) | Providers settings specs and Electron Accounts section spec (Batch 33); orchestration settings specs; host smoke specs listed in req 23 | Existing specs |

## Holds that stay OPEN by design (not claimed)

1. **Live named-account auth** (start/cancel sign-in, sign-out): `release-held`, user-reserved release authorization.
2. **Installed-runtime compatibility A1-A3**: no probe run; mocked proof does not waive it.
3. **Rendered Electron evidence**: dark/light, keyboard/focus, widths 960+, 640-959, <640, embedded 400, vs `prototype/index.html`. No launch authorized.
4. **User-reserved subscription enablement/release.**
5. **C17 / D38** claude-lane capability-vs-handle test: not covered (see table).

## Verdict

Host DI/RPC exactness tests added (five files, 12 new tests); no omitted capability vs the inventory found. The new tests are unrun, so the Claude exit gate stays NOT SATISFIED pending the orchestrator's scoped run, the C17 follow-up, and the held items above.
