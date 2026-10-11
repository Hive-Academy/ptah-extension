# Implementation Plan - cli-lane-limits

Worktree: `D:\projects\ptah-extension\.claude-worktrees\fix-cli-lane-limits` (branch `fix/cli-lane-limits`, based on `fix/plan-limits-ui` / PR #697, HEAD `0b305d45c`). All paths below are relative to that worktree.

## Inputs and constraints

- Requirements used: the request (no `context.md` / `task-description.md` exists for this task), `CLAUDE.md` (memory-safe verification rules).
- Corrections applied to the earlier trace findings (verified against source):
  - `NO_USAGE_SOURCE_PROVIDERS` is now EMPTY (`libs/backend/auth-providers/src/lib/quota/plan-usage.service.ts:84`). The `no-usage-source` for `opencode`/`opencode-zen` comes from the forced override at `plan-usage.service.ts:306-313`, and from readers that return `noPlan()` (Go reader with no key, `opencode-go-plan-usage.reader.ts:30-34,90`; Grok reader on API-key or custom auth, `grok-account-plan-usage.reader.ts:62-69`).
  - Owner-level evidence and cooldowns are NOT dropped today: `assemble()` always copies `ownerEvidence` and `cooldown` (`plan-usage.service.ts:404-405`). Only ledger **windows** are dropped for ineligible statuses (`plan-usage.service.ts:396-403`, `plan-owner-read.ts:143-145`). The OpenCode "Free usage exceeded" hit has no window key (`lane-limit-classifier.ts:151-152`), so it is filed as owner evidence (`agent-process-manager.service.ts:2459-2464`) and already shows `AT LIMIT (window unknown …)`. Windows ARE lost for Claude-wording hits that name a window (`lane-limit-classifier.ts` `claudeWindow`) and for any provider-read window under an owner whose status later turns ineligible.
  - The Grok lane has NO owner rule: `LaneOwnerResolver.ownerForLane` only handles codex/opencode/antigravity (`lane-owner.resolver.ts:90-99`). So `recordLaneLimits` returns early on `if (!owner) return;` (`agent-process-manager.service.ts:2457`) and every classified Grok hit (`lane-limit-classifier.ts` `matchGrok`) is discarded before it reaches the ledger. This is the largest "lost evidence" gap, not OpenCode.
  - `apps/ptah-cli/src` does not call `registerCliAgentRuntimeServices` directly, but the CLI runs through `withEngine` (`apps/ptah-cli/src/cli/commands/agent-cli.ts:62`), whose container registers auth-providers (`libs/backend/cli-engine/src/lib/container.ts:665`), the runtime incl. `LANE_LIMIT_LOOKUP` (`container.ts:728`) and vscode-lm-tools (`container.ts:825`). The CLI host already has the limits service.
  - There are TWO spawn/list surfaces: stdio (`mcp-stdio/agent-tool.dispatcher.ts:368`, `:721`) and HTTP (`mcp-core/protocol-dispatcher.ts:1134`, `:1360`). Both need the gate.
  - A provider reading of 100 % used (Go, Codex, Grok, Antigravity readers report percent) classifies as `near-limit`, not `limit-reached`, because `limit-reached` needs `exhaustion` evidence (`libs/shared/src/lib/utils/plan-limits/window-state.ts:203-232`). The gate must treat a fresh 100 % window as exhausted.
- Design handoff used: none (backend only).
- Missing decision-critical input: none. Defaults chosen are listed under "Open questions".

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| Lane → owner rule: codex → `ownerForCodexHome` (sync, unknown before first read); opencode → `ownerForCliStore('opencode')`; antigravity → `ownerForAntigravity`; everything else `undefined` | `cli-agent-runtime/src/lib/cli-agents/limits/lane-owner.resolver.ts:88-109` | Single place to add grok, Go-aware opencode and async codex resolution. |
| `LaneOwnerSource` already exposes `resolveCodexHomeOwner` | `lane-owner.resolver.ts:31-39` | Async codex resolution needs no new auth-providers API. |
| Lookup owner: row.quotaOwner ?? rule; ptah-cli only for `ollama-cloud` | `lane-limit-lookup.service.ts:177,208-216` | ptah-cli Claude lanes always `no-owner` in the list. |
| Read plan per provider; keyless for codex/antigravity/opencode/opencode-go/opencode-zen/grok; `null` for anything else | `limits/plan-owner-read.ts:46-53,75-126` | Owner providerId picks the reader; an `opencode-go` owner reaches the Go reader. |
| `snapshotWithoutRead` drops windows for `unsupported-auth/config/provider-unsupported` | `plan-owner-read.ts:56-60,133-152` | Must share the new evidence-keeping rule. |
| Reader table: `opencode` and `opencode-zen` → local stats reader; `opencode-go` → Go reader + local reader | `plan-usage.service.ts:147-160` | Go owner gets windows and local usage. |
| Forced `no-usage-source` for opencode/opencode-zen | `plan-usage.service.ts:306-313` | Correct (no quota API); evidence rule must still keep exhausted windows. |
| `assemble` empties windows when status is in `ELIGIBILITY_STATUSES` | `plan-usage.service.ts:87-94,396-403` | Change point for fix (b). |
| Go reader cli-store mode: key from `OPENCODE_AUTH_CONTENT`, else `<XDG_DATA_HOME or HOME/.local/share>/opencode/auth.json` entry `opencode-go` (`type:'api'`), else `OPENCODE_API_KEY`; non-key → `noPlan()` | `auth-providers/src/lib/quota/readers/opencode-go-plan-usage.reader.ts:13-17,56-89` | Owner selection must call this exact lookup. |
| `cliStorePath('opencode')` uses `XDG_DATA_HOME?.trim() || homedir()/.local/share` (no `HOME`/`USERPROFILE`) | `provider-owner.resolver.ts:641-652` | Path derivation differs from the reader; unify through one helper. |
| `cliStoreOwnerKey(providerId, path)` → `<providerId>#cli-store:<fp>` | `provider-owner.resolver.ts:284-286` | `opencode-go#cli-store:<opencode store>` is a valid, distinct owner. |
| Sync file-read + TTL cache precedent (Gemini active account) | `provider-owner.resolver.ts:118-150` (`FileReader`, `FileStat`, `geminiAccountCache`) | Sync Go-credential check follows this pattern (spawn path is sync). |
| OpenCode 2.x stores credentials in `opencode.db` (SQLite), not `auth.json` | `cli-adapters/opencode-cli.adapter.ts:520-541` | Go detection may miss 2.x logins; documented risk, not fixed here. |
| OpenCode model ids are `<provider>/<model>` from `opencode models` | `opencode-cli.adapter.ts:359-363` | Owner choice can read the model prefix. |
| Discovery lists opencode/antigravity cli stores and grok (when logged in) | `limits/plan-limit-owner-discovery.service.ts:163,390-409` | Dashboard must use the same opencode owner rule as lanes. |
| Classifier per CLI; opencode = "Free usage exceeded" (no window); grok = owner-level | `limits/lane-limit-classifier.ts:151-176` | Zen free-tier hit must not be filed under a Go owner. |
| Run owner set at spawn via `ownerForLane(info.cli)`; re-resolved at exit; evidence filed only with an owner | `cli-agents/agent-process-manager.service.ts:859-869,2433-2465` | APM must pass the model, and remember owners for list lookups. |
| Restored runs carry `ref.quotaOwner` | `agent-process-manager.service.ts:1222-1225` | Seed for the remembered-owner map after restart. |
| ptah-cli owner rules: `claude-cli` → account from `accountInfo()`; `ollama-cloud` → stored key; others none | `ptah-cli/helpers/ptah-cli-lane-plan-limits.ts:80-93` | Claude-backed lanes only get an owner after a run. |
| Lane state: `at-limit` from active owner evidence or exhausted window; cooldown is only an `unknown` reason | `libs/shared/src/lib/utils/plan-limits/lane-state.ts:235-290` | Gate adds cooldown and 100 % windows on top; shared engine untouched. |
| Formatter maps both `no-snapshot` and `no-usage-source` to "no usage source" | `vscode-lm-tools/src/lib/code-execution/mcp-core/agent-limit.formatter.ts:80-110` | Root of the indistinguishable "unknown (…)" text. |
| Limits only appended when `limits !== undefined` (byte parity) | `mcp-core/mcp-response-formatter.ts:1786-1835,1846-1885` | Gate and new text must sit behind the same condition. |
| Stdio spawn: spawn at :390, limits looked up after at :406 / :431 | `mcp-stdio/agent-tool.dispatcher.ts:368-470` | Insert pre-spawn lookup + gate. |
| HTTP spawn: spawn at :1165, limits after at :1191 / :1206 | `mcp-core/protocol-dispatcher.ts:1134-1216` | Same gate on the HTTP surface. |
| `AgentNamespace.limits` optional; failure returns per-row `failed` | `code-execution/types.ts:314-317`; `namespace-builders/agent-namespace.builder.ts:499-516` | Gate never fires when the host has no limits. |
| Shared spawn schema is `.strict()`; parity spec requires advertised keys == schema keys | `mcp-core/agent-spawn-args.schema.ts:22-45`; `mcp-core/agent-spawn-surface-parity.spec.ts:95-103` | `force` must be added to both schema and `inputSchema`. |
| Tool descriptions | `mcp-core/tool-description.builder.ts:603-746` (spawn), `:903-917` (list) | Guidance sentences go here. |
| System prompt delegation section + tool table | `code-execution/ptah-system-prompt.constant.ts:213-275` (list row at :234) | One sentence update. |
| agent-lanes SKILL copies (exactly two, identical) | `.claude/skills/agent-lanes/SKILL.md`, `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/agent-lanes/SKILL.md` (Discover section lines 12-16) | Both edited identically; `lane-rule-single-home.spec.ts` scans the second copy. |
| `noPropertyAccessFromIndexSignature: true` in vscode-lm-tools | `libs/backend/vscode-lm-tools/tsconfig.json:12` | Bracket access for record lookups there. |

## Lane audit (today, at HEAD)

"Exhausted" = the plan is used up and the CLI printed its limit error (or the reader reports 100 %).

| Lane (as listed) | Owner today (file:line) | Reader for that owner | List shows today when exhausted | Gap |
| --- | --- | --- | --- | --- |
| `codex` | `ownerForCodexHome()` — unknown key until the Codex account was read (`lane-owner.resolver.ts:91-92`, `provider-owner.resolver.ts:512-525`) | `openai-codex` reader (`plan-usage.service.ts:149`) | After a read: `near limit (5h 100%)` (100 % is not `limit-reached`, `window-state.ts:232`). Before first read: `unknown (…)` under an `unknown` owner; error evidence ("usage limit") was filed under whichever owner the run had | Sync owner before first read; 100 % not treated as at limit; no gate |
| `opencode` with an OpenCode Go key | `ownerForCliStore('opencode')` → `opencode#cli-store` (`lane-owner.resolver.ts:93-94`) | Go reader exists for `opencode-go` only; `opencode` → local stats reader forced to `no-usage-source` (`plan-usage.service.ts:153,306-313`) | `unknown (no usage source)`; Go windows never read for the lane (only the dashboard reads Go, via a stored provider key) | Lane owner never maps to `opencode-go` |
| `opencode` on Zen (free or paid) | same `opencode#cli-store` | none (no quota API) | Free-tier hit: `AT LIMIT (window unknown, reset unknown) [error-derived] · no usage source` (owner evidence survives). Paid Zen balance: `unknown (no usage source)` | Works for free tier; would break if the lane were moved to the Go owner without a model check |
| `opencode` on a third-party key (Anthropic/OpenAI/… via OpenCode) | same `opencode#cli-store` | none | `unknown (no usage source)` | Not measurable; correct to stay unknown with an honest reason |
| `ptah-cli` on `ollama-cloud` | `ownerForPtahCliKey` (`lane-limit-lookup.service.ts:212-214`) | `ollama-cloud` reader with the agent's key (`plan-owner-read.ts:98-108`) | 429 hit → owner evidence → `AT LIMIT (window unknown …)`; reader windows show `near limit` at 100 % | 100 % not at limit; no gate |
| `ptah-cli` on local `ollama` | none (`lane-limit-lookup.service.ts:215`) | none | `unknown (no usage source)` (from `no-snapshot`, `agent-limit.formatter.ts:102-104`) | Reason text wrong ("not tracked", local has no plan) |
| `grok` | **none** (`lane-owner.resolver.ts:97-98`) | `grok` account reader exists (`plan-usage.service.ts:155`) for `grok#cli-store`, used only by discovery (`plan-limit-owner-discovery.service.ts:403-406`) | `unknown (no usage source)`; the classified `grok-free-usage` hit is dropped at `agent-process-manager.service.ts:2457` | No lane owner → evidence lost, reader unused |
| `antigravity` (the Gemini-account lane) | `ownerForAntigravity()` (`lane-owner.resolver.ts:95-96`) | antigravity reader (language server, then OAuth fallback) (`readers/antigravity-plan-usage.reader.ts:35,77-78`) | `RESOURCE_EXHAUSTED … reset after` → owner evidence with reset → `AT LIMIT (window unknown, resets …)`; reader windows at 100 % → `near limit` | 100 % not at limit; no gate |
| `gemini` | not a lane kind: `SYSTEM_CLI_TYPES` has no `gemini` (`libs/shared/src/lib/types/agent-process.types.ts:70-78`); the Gemini account is served by `antigravity` (`provider-owner.resolver.ts:651`) | — | not listed | None (documented only) |
| `copilot` | none | none | `unknown (no usage source)` | No owner, no reader, no classifier wording; reason text misleading |
| `cursor` | none | none | `unknown (no usage source)` | same |
| `pi` | none | none | `unknown (no usage source)` | same |
| `ptah-cli` on `claude-cli` (Claude-backed) | only `row.quotaOwner`, never set on `agent.list()` rows (`lane-limit-lookup.service.ts:177,206-215`); runs get the account from `accountInfo()` (`ptah-cli-lane-plan-limits.ts:83-85`) | `anthropic` reader needs an open session; without it `service-unavailable`/`no-open-session` + ledger windows (`plan-owner-read.ts:80-97`) | `unknown (no usage source)` even after a run hit "5-hour limit reached" (the window is in the ledger under the account owner, but the list row has no owner) | List cannot reach the account owner |
| `ptah-cli` on other providers (OpenRouter, Moonshot, Z.ai, …) | none | none | `unknown (no usage source)` | Reason text only |

## Architecture decision

- Chosen approach: keep the existing pipeline (`LaneOwnerResolver` → `LaneLimitLookupService` → `PlanUsageService`/ledger → `classifyLaneState` → `agent-limit.formatter`) and fix each stage in place:
  1. Owner rules in `ProviderOwnerResolver`/`LaneOwnerResolver` choose the owner whose reader can measure the lane, using the reader's own credential lookup (one shared helper).
  2. Snapshot assembly keeps ledger windows that carry exhaustion evidence for "no reader" statuses.
  3. A pure gate function in `vscode-lm-tools/mcp-core` decides block / warn / clear from the existing `LaneLimitResult`; both dispatchers call it before `agent.spawn`.
  4. The formatter derives an "effective" state (gate-blocked lanes read as at limit) and gives each unknown cause its own short reason.
- Rationale: every stage already exists, is injected and has specs; the fixes are local to the stage that is wrong. The shared state engine (`lane-state.ts`, `window-state.ts`) stays unchanged because the dashboard (`rpc-handlers` snapshot, `chat-ui` tiles) reads the same semantics.
- Rejected alternatives:
  - Change `classifyWindow` so 100 % = `limit-reached`: it requires exhaustion evidence for the `window-limit` reason (`lane-state.ts` `activeWindowExhaustion`) and changes dashboard tiles. It loses to a gate-level rule that touches only the agent tools.
  - Have the ledger synthesize exhaustion from 100 % readings: that changes what is persisted (`plan-limit-ledger.service.ts:29-36`) and clear-rules. Rejected for blast radius.
  - Gate inside `AgentProcessManager.spawnAgent`: that adds a runtime dependency on vscode-lm-tools-formatted text and blocks non-MCP callers (cron, skill-synthesis lanes, `lane-runner.limits.spec.ts`). The gate is a tool-surface policy, so it lives at the two MCP surfaces.
  - Register limits in `apps/ptah-cli`: already registered through `cli-engine` (see Corrections). A second registration would create a second ledger singleton. Rejected.
  - Merge the two `lookupAgentLimits` copies (stdio/HTTP): only two uses. They stay separate (repo "third use" rule).
- Assumptions (each with its check):
  - A1: OpenCode Go model ids carry the `opencode-go/` provider prefix, and Zen ids carry `opencode/`. Check: run `opencode models` with a Go key and confirm the prefix. If wrong, only the model-prefix branch in `ownerForOpenCode` changes.
  - A2: OpenCode 2.x still honours `auth.json`/`OPENCODE_AUTH_CONTENT`/`OPENCODE_API_KEY` for Go. If it moved the key to `opencode.db`, Go detection returns false and the lane falls back to `opencode#cli-store`. That is safe (`unknown (no usage source)`) but shows no Go windows. Check: inspect a 2.x install that has Go configured.
  - A3: `resolveCodexHomeOwner()` is cheap after the first call (coalesced and cached by the account service, per `provider-owner.resolver.ts:527-536`). Check: the codex reader spec timing. The 3 s lookup deadline bounds it regardless.
- Effect on existing code: no files are deleted. Existing spec expectations change for (1) list/spawn texts whose reason was "no usage source" for no-owner lanes, (2) the cooldown column (now an at-limit form), (3) the snapshot windows of ineligible owners that hold exhaustion evidence, and (4) spawn ordering on named lanes (limits are looked up before the spawn).

## Component specifications

### 1. OpenCode Go credential helper (auth-providers)

- Purpose: one definition of "this machine has an OpenCode Go key in the OpenCode store", shared by the reader and the owner resolver.
- Responsibilities:
  - `openCodeDataDir(env)`: `env['XDG_DATA_HOME']?.trim() || join(env['HOME'] || env['USERPROFILE'] || homedir(), '.local', 'share')` + `opencode`. Use this exact precedence: it is the reader's precedence today (`opencode-go-plan-usage.reader.ts:57-63`).
  - `openCodeGoKeyFromAuth(contents: string | undefined, env)`: parses with the reader's existing zod `AuthSchema` (moved here). Returns the trimmed key, `OPENCODE_API_KEY` as fallback, or `undefined`. It throws only on unparseable JSON, which callers map to "unavailable".
  - `readOpenCodeGoKey(env, readAuth)` (async): reads `OPENCODE_AUTH_CONTENT`, else `auth.json` (ENOENT → `{}`), then calls the parser. Used by the reader.
  - `hasOpenCodeGoCredentialSync(env, readFileSync, statSync)`: the same lookup, synchronous. It uses a 5 s TTL plus an mtime/size cache keyed by path, following `geminiAccountCache` (`provider-owner.resolver.ts:118-150`). It never throws (false on any error) and never returns or logs the key.
- Verified contracts: `AuthSchema` (`opencode-go-plan-usage.reader.ts:13-17`); reader signature `createOpenCodeGoPlanUsageReader(now, fetcher, readAuth, env)` (`:40-45`).
- Dependencies: `node:fs`, `node:path`, `node:os`, `zod`. No vscode-core import.
- Integration points: the Go reader (cli-store branch, `:56-87`) calls `readOpenCodeGoKey`, with behaviour unchanged. `ProviderOwnerResolver.ownerForOpenCode` (Component 2) calls the sync check.
- Failure behaviour: unreadable or invalid file → reader `unavailable()` (as today); sync check → `false` (lane falls back to the `opencode` owner).
- Quality: the key never leaves the helper except to the reader's fetch; no logging of contents.
- Verification seam: new `opencode-go-credential.spec.ts` covers the env precedence, ENOENT, invalid JSON, the `type:'api'` filter, the `OPENCODE_API_KEY` fallback, and the cache invalidating on mtime. The existing `opencode-go-plan-usage.reader.spec.ts` stays green unchanged.
- Files: CREATE `libs/backend/auth-providers/src/lib/quota/opencode-go-credential.ts`, CREATE `libs/backend/auth-providers/src/lib/quota/opencode-go-credential.spec.ts`; MODIFY `libs/backend/auth-providers/src/lib/quota/readers/opencode-go-plan-usage.reader.ts`.

### 2. `ProviderOwnerResolver.ownerForOpenCode(model?)` (auth-providers)

- Purpose: the OpenCode lane owner whose reader can measure it.
- Responsibilities, in order:
  1. If `model` has a `provider/` prefix and the provider is not `opencode-go` → `ownerForCliStore('opencode')`. This covers Zen, third-party keys, and A1.
  2. Else, if `hasOpenCodeGoCredentialSync()` → `quotaOwnerRefFromKey(cliStoreOwnerKey('opencode-go', openCodeDataDir(process.env)))`.
  3. Else `ownerForCliStore('opencode')`.
- Also switch `cliStorePath('opencode')` to `openCodeDataDir(process.env)`, so the `opencode` and `opencode-go` owners and the reader agree on one path (`provider-owner.resolver.ts:645-650`). Note: on a machine where `HOME` differs from `homedir()`, the `opencode#cli-store` key changes once. Old ledger evidence under the previous key ages out (R6 semantics, `lane-owner.resolver.ts:47-52`).
- Verified contracts: `cliStoreOwnerKey` (`:284`), `quotaOwnerRefFromKey` (`:318`), `ownerForCliStore` (`:538-540`), display names already map `opencode-go` → "OpenCode" (`:91`).
- Dependencies: Component 1. Direction stays inside auth-providers.
- Integration: `LaneOwnerSource` (Component 4) and `PlanLimitOwnerDiscoveryService.cliStores` (Component 6).
- Failure: never throws; any error → step 3.
- Verification seam: `provider-owner.resolver.spec.ts`. Cover: Go key present without a model → `opencode-go#cli-store:`; `opencode/…` model → `opencode#cli-store:`; `opencode-go/…` without a key → `opencode#cli-store:`; key absent → `opencode`.
- Files: MODIFY `libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.ts`, `libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.spec.ts`; MODIFY `libs/backend/auth-providers/src/index.ts` (or `quota/index.ts`, whichever barrel exports the resolver; confirm with Grep) to export `openCodeDataDir` only if Component 6 needs it (it does not by default).

### 3. Evidence-keeping snapshot windows (auth-providers)

- Purpose: never discard observed limit hits for owners that have no reader or no plan source.
- Responsibilities: export `snapshotWindowsForStatus(status, ledgerWindows)` from new `quota/plan-snapshot-windows.ts`:
  - `available`, `stale`, `service-unavailable` (and any other non-listed status) → all ledger windows (as today).
  - "No source" statuses `no-usage-source`, `provider-unsupported`, `cli-unavailable`, `cli-version-unsupported` → only ledger windows with `exhaustion !== undefined`. `classifyWindow` then makes them `limit-reached` while the evidence is active (`window-state.ts:207-209`) and drops them by rule once reset.
  - `unsupported-auth`, `unsupported-config` → `[]` (as today: the owner cannot be on a plan, e.g. a Claude API key).
  - `windowSetEstablished` stays `false` for every non-available status (unchanged), so such a lane can never reach `confirmed-room`.
- Use it in `PlanUsageService.assemble` (`plan-usage.service.ts:396-403`, replacing `ineligible ? [] : …` for windows; `windowSetEstablished` logic unchanged), and in `snapshotWithoutRead` (`limits/plan-owner-read.ts:143-145`, Component 5).
- Cooldown and owner evidence: already always kept (`plan-usage.service.ts:404-405`, `plan-owner-read.ts:146-147`). Add a spec assertion that pins this.
- Failure: pure function.
- Verification seam: new `plan-snapshot-windows.spec.ts`. In `plan-usage.service.spec.ts`, add: (a) an `opencode` owner with a ledger window carrying exhaustion → snapshot keeps it, status `no-usage-source`; (b) an `unsupported-auth` owner → no windows; (c) a ledger cooldown survives `no-usage-source`.
- Files: CREATE `libs/backend/auth-providers/src/lib/quota/plan-snapshot-windows.ts`, `…/plan-snapshot-windows.spec.ts`; MODIFY `libs/backend/auth-providers/src/lib/quota/plan-usage.service.ts`, `…/plan-usage.service.spec.ts`; MODIFY the auth-providers barrel to export `snapshotWindowsForStatus` (cli-agent-runtime already imports `PlanLimitLedgerService`/`PlanOwnerTarget` types from `@ptah-extension/auth-providers`, `plan-owner-read.ts:11-14`).

### 4. Lane owner rules (cli-agent-runtime `LaneOwnerResolver`)

- Purpose: map every lane to the owner its reader measures, synchronously at spawn and asynchronously for lookups.
- Responsibilities:
  - `ownerForLane(cli, model?)` (sync; used by APM): `codex` → `ownerForCodexHome()`; `opencode` → `ownerForOpenCode(model)`; `antigravity` → `ownerForAntigravity()`; **`grok` → `ownerForCliStore('grok')`** (new); default `undefined`. The Grok reader itself returns `no-usage-source` for API-key or custom auth (`grok-account-plan-usage.reader.ts:62-69`), so an unconditional owner is safe and lets Grok hits be filed.
  - `resolveOwnerForLane(cli, model?)` (async; used by the lookup): `codex` → `await resolveCodexHomeOwner()` (A3); otherwise `ownerForLane`.
  - Remembered lane owners: `rememberLaneOwner(lane: {cli, ptahCliId?}, owner)` and `lastLaneOwner(lane)`. The map is in-memory, keyed `cli:ptahCliId`, bounded at 64 entries (LRU, like `PLAN_USAGE_MAX_OWNERS`), and stores only owners with `identityKind !== 'unknown'`. It is read only for lanes with no owner rule (ptah-cli on `claude-cli`/others). Rationale: the Claude account is known only after a run (`ptah-cli-lane-plan-limits.ts:12-17`), and discovery already lists such owners via run `ownerKeys` (`plan-limit-owner-discovery.service.ts:469-471` comment). Without this, a Claude-backed lane's recorded "5-hour limit reached" window is invisible to the list.
  - `LaneOwnerSource` gains `'ownerForOpenCode'`.
- Verified contracts: `LaneOwnerSource` pick list (`lane-owner.resolver.ts:31-39`), `ownerForCliStore` accepts `'grok'` (`provider-owner.resolver.ts:114`), `resolveCodexHomeOwner` (`:527-536`).
- Dependencies: auth-providers `ProviderOwnerResolver` (existing direction).
- Failure: sync and async paths catch and log at warn, as today (`lane-owner.resolver.ts:100-108`), and return `undefined`.
- Verification seam: `lane-owner.resolver.spec.ts`. Cover: grok owner; opencode model variants delegate to `ownerForOpenCode`; codex async awaits `resolveCodexHomeOwner`; remember/last round trip; unknown owners are not remembered; LRU bound.
- Files: MODIFY `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/lane-owner.resolver.ts`, `…/lane-owner.resolver.spec.ts`.

### 5. Lane limit lookup + read plan (cli-agent-runtime)

- Purpose: the lookup resolves owners the same way spawn does, and carries the model.
- Responsibilities:
  - `LaneLimitLookupRow` gains optional `model?: string` (doc: "the model a spawn asks for; picks the OpenCode owner").
  - `ownerOf(row)`: `row.cli !== 'ptah-cli'` → `owners.resolveOwnerForLane(row.cli, row.model)`. For ptah-cli: `ollama-cloud` → as today. Otherwise → `owners.lastLaneOwner({cli, ptahCliId})` (may be `undefined` → `no-owner`).
  - `LaneLimitOwnerRules` pick adds `'resolveOwnerForLane' | 'lastLaneOwner'`.
  - `snapshotWithoutRead` uses `snapshotWindowsForStatus` (Component 3); `INELIGIBLE_STATUSES` is deleted.
- Verified contracts: `LaneLimitResult` shape unchanged (`lane-limit-lookup.service.ts:80-86`). `lookup` never rejects (`:122-169`).
- Failure: unchanged deadline/cancel semantics.
- Verification seam: `lane-limit-lookup.service.spec.ts`. Cover: codex resolves async; a ptah-cli Claude lane uses the remembered owner and returns a `limit-reached` window from the ledger via `snapshotWithoutRead`; `model` is passed through. Update `owner-lifecycle.integration.spec.ts` if it stubs `ownerForLane` only.
- Files: MODIFY `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/lane-limit-lookup.service.ts`, `…/lane-limit-lookup.service.spec.ts`, `…/plan-owner-read.ts`, `…/owner-lifecycle.integration.spec.ts` (only if broken by the new pick).

### 6. Owner discovery parity (cli-agent-runtime)

- Purpose: the dashboard card and the lane name the same OpenCode owner.
- Responsibilities: in `cliStores`, the `opencode` entry uses `this.owners.ownerForOpenCode()` instead of `ownerForCliStore('opencode')`, and the discovery owner pick (`plan-limit-owner-discovery.service.ts:128-138`) adds `'ownerForOpenCode'`. Grok listing stays gated on `hasGrokCliLogin` (discovery decides visibility; lanes decide attribution).
- Failure: unchanged (source dropped alone on throw).
- Verification seam: `plan-limit-owner-discovery.service.spec.ts`: with a Go key, the installed opencode yields an `opencode-go#cli-store` entry, and there is no duplicate `opencode` entry.
- Files: MODIFY `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/plan-limit-owner-discovery.service.ts`, `…/plan-limit-owner-discovery.service.spec.ts`.

### 7. AgentProcessManager owner attribution (cli-agent-runtime)

- Purpose: runs file evidence under the owner the list reads.
- Responsibilities:
  - Spawn (`agent-process-manager.service.ts:859-863`): `ownerForLane(info.cli, info.model)`.
  - Exit re-resolution (`:2443-2446`): `ownerForLane(tracked.info.cli, tracked.info.model)`.
  - OpenCode free-tier attribution: in `recordLaneLimits`, when `limit.pattern === 'opencode-free-usage'` and the run owner's `providerId === 'opencode-go'`, file the evidence under `ownerForCliStore`-equivalent `opencode` owner. Expose it via the resolver as `ownerForLane('opencode', 'opencode/')`, or add a narrow `freeTierOwner()`; the implementer picks the first form if it reads cleanly. Reason: "Free usage exceeded" is Zen's free tier (`lane-limit-classifier.ts:12-17`). OpenCode success billing is `unknown` (`:104-108`), so a mis-filed owner-level hit under the Go owner would never clear (`plan-limit-ledger.service.ts:106,253`).
  - Remember owners: call `laneOwners.rememberLaneOwner({cli, ptahCliId}, owner)` wherever `tracked.info.quotaOwner` is set or upgraded: spawn (`:859-869`), `recordQuotaOwner` (`:1003-1016`), exit re-resolution (`:2447`), and restored references (`:1222-1225`).
- Dependencies: existing `laneOwners` injection.
- Failure: remember is a sync map write and never throws. Ledger writes stay in the existing try/catch.
- Verification seam: `agent-process-manager.service.spec.ts`. Cover: a grok failure with "subscription:free-usage-exhausted" now calls `recordOwnerEvidence` with a `grok#cli-store` owner; opencode on a Go owner with "Free usage exceeded" files under the `opencode` owner; `rememberLaneOwner` is called on `recordQuotaOwner`. Also `agent-process-manager.restore.spec.ts` for the restored remember. Mocks of the resolver gain the new methods.
- Files: MODIFY `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts`, `…/agent-process-manager.service.spec.ts`, `…/agent-process-manager.restore.spec.ts`.

### 8. Spawn limit gate (vscode-lm-tools mcp-core, new)

- Purpose: one pure decision, used by both transports: block, warn or clear a spawn on a named lane.
- Responsibilities: `mcp-core/agent-spawn-limit-gate.ts` exports:
  - `laneBlock(limit: AgentLimit, now): LaneBlock | undefined` where `LaneBlock = { kind: 'window' | 'owner' | 'cooldown' | 'full-window'; resetsAt?: number; detail: string }`. Blocking when any of:
    - `limit.state.state === 'at-limit'` (owner evidence or exhausted window). `resetsAt` = the latest known reset among the hit reasons; absent if any hit has no reset.
    - An active cooldown (`snapshot.cooldown.until > now`). `resetsAt = cooldown.until`.
    - A "full" window: an applicable window whose state is `near-limit` or `ok`, with `usedPercent(window.used) >= 100` (`window-state.ts:99`, exported from shared) and `window.resetsAt > now` or unknown. `resetsAt = window.resetsAt`.
  - `spawnGateVerdict(limits, target, now)` → `{ kind: 'clear' } | { kind: 'unknown'; reason: string } | { kind: 'blocked'; limit; block }`.
    - Returns `clear` when `target` is undefined (auto-detect), when no row matches, or when the row is `!installed || disabled`. In those cases the spawn's own error stays the answer.
    - `unknown` when `limit.state.state === 'unknown'` and there is no block.
  - `formatSpawnRefusal(limits, verdict, now)`: the text below plus the alternatives (`formatAlternatives(limits, {targetRowKey})`, `agent-limit.formatter.ts:315`).
  - Refusal text (exact template):
    `agent_spawn refused: <lane> is at its plan limit (<detail>). <Free again <formatToolInstant(resetsAt)> | Reset time unknown>. Nothing was spawned. Pass "force": true to spawn anyway, or pick a lane with room below.` followed by a blank line and the alternatives section.
  - `effectiveLaneState(limit, now)`: `'at-limit'` when `laneBlock` is defined, else `limit.state.state`. Used by the formatter (Component 9) so list, alternatives grouping and gate agree.
- Verified contracts: `AgentLimit`, `findAgentLimit`, `targetRowKey`, `spawnRequestTarget` (`agent-limit.formatter.ts:29-56`); `formatToolInstant`/`formatToolUtc` (`libs/shared/src/lib/utils/plan-limits/plan-limit-format.ts:164,174`); `usedPercent` exported (`plan-limits/index.ts`).
- Dependencies: shared + the formatter module (same lib). No vscode-core import.
- Failure: pure. A malformed limit (no snapshot) → no block.
- Quality: names no vendor in static strings (formatter rule R8, `agent-limit.formatter.ts:8`). Bracket access on any `Record` index (`noPropertyAccessFromIndexSignature`).
- Verification seam: new `agent-spawn-limit-gate.spec.ts`. Cover: at-limit window with reset; owner evidence without reset; active cooldown; expired cooldown → not blocking; 100 % window → blocking; 99 % → not; auto-detect → clear; ptahCliId beats cli; uninstalled row → clear; unknown → unknown with reason.
- Files: CREATE `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-spawn-limit-gate.ts`, `…/agent-spawn-limit-gate.spec.ts`.

### 9. Limit text: distinguishable states and reasons (vscode-lm-tools formatter)

- Purpose: "at limit", "unknown (why)" and "confirmed room" read unambiguously, with a short cause.
- Responsibilities in `agent-limit.formatter.ts`:
  - New `unknownCause(limit)` (wins over `reasons[0]` for the column and the alternatives detail):
    - `lookup === 'no-owner'` → `limits not tracked`
    - `lookup === 'timeout'` → `limit lookup timed out`; `failed` → `limit lookup failed` (as today)
    - `snapshot.status === 'no-usage-source'` → `no usage source`
    - `snapshot.status === 'service-unavailable'` with `unavailableReason === 'no-open-session'` → `no open session`; otherwise → `reader failed`
    - `snapshot.status === 'stale'` → `reader failed, aged value`
    - `provider-unsupported` → `no reader for provider`; `unsupported-config` → `credential missing`; `unsupported-auth` → `API key, no plan`; `cli-unavailable`/`cli-version-unsupported` → status words (as today)
    - else → existing `reasonText(reasons[0])`
  - `reasonText` `no-snapshot` → `limits not tracked` (was `no usage source`, `:102-104`). `noWindowsDetail` gets the same split (`:266-277`).
  - `formatLimitColumn`: when `laneBlock` is `cooldown` → `AT LIMIT (cooldown, retry after <UTC>)`; when `full-window` → `AT LIMIT (<label> 100%, resets <UTC>)`; existing at-limit forms unchanged; `confirmed room` unchanged (the "ok" state; renaming it would churn alternatives headings and the dashboard vocabulary).
  - `formatAlternatives`: group by `effectiveLaneState` instead of `limit.state.state` (`:330-332`).
  - `formatSpawnLimitBlock(limits, target, attempted, now, options?: { forced?: boolean })`:
    - effective unknown → append one line `> Note: limit state unknown (<cause>); spawned without a limit check.` (`attempted` → "attempted").
    - forced past a block → outcome text `The spawn was forced past the limit gate.` instead of "still started".
- `mcp-response-formatter.ts` `formatAgentSpawn(result, options?: { modelTier?; forced? }, limits?)` passes `forced` through (`:1846-1885`). The `limits === undefined` early return stays first, so byte parity holds.
- Failure: pure, inside the existing try/catch → `fallbackJson`.
- Verification seam: `agent-limit.formatter.spec.ts` and `mcp-response-formatter.spec.ts`. Update the expectations that used "no usage source" for no-owner rows and "unknown (cooldown active until …)". Add a parity test: `formatAgentList(agents, roles, undefined)` and `formatAgentSpawn(result, opts, undefined)` equal the pre-change strings (existing parity tests stay green).
- Files: MODIFY `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-limit.formatter.ts`, `…/agent-limit.formatter.spec.ts`, `…/mcp-response-formatter.ts`, `…/mcp-response-formatter.spec.ts`.

### 10. Spawn schema + gate wiring on both transports (vscode-lm-tools)

- Purpose: enforce the gate before `agent.spawn`, with a `force` override.
- Responsibilities:
  - `AgentSpawnArgsSchema` gains `force: z.boolean().optional()` (`agent-spawn-args.schema.ts:22-45`). It is not forwarded to `agent.spawn`.
  - `buildAgentSpawnTool` `inputSchema.properties.force` = `{ type: 'boolean', description: 'Spawn even when ptah_agent_list shows this lane at its plan limit or in a cooldown. Use only when the limit is known to be wrong.' }` (keeps the parity spec green).
  - Stdio `handleSpawn` (`agent-tool.dispatcher.ts:368-470`), after arg parse:
    1. `target = spawnRequestTarget(p)`. If `target` is defined → `limits = await this.lookupAgentLimits(rowsWithModel)`, where `rowsWithModel` = `await this.ptahAPI.agent.list()` with `model: p.model` set on the target row only (via `findAgentLimit`/`targetRowKey`). Use `lookupAgentLimits(rows)` (`:254-265`) with explicit rows.
    2. `verdict = spawnGateVerdict(limits ?? [], target, now)`. Skip it entirely when `limits === undefined` (parity).
    3. `blocked && !p.force` → `toolError(request, formatSpawnRefusal(...), 'mcp_tool_failed', { tool: 'agent_spawn', state: 'lane_at_limit', lane: target, reason: block.kind, ...(block.resetsAt !== undefined && { resetsAt: new Date(block.resetsAt).toISOString() }) })`. `agent.spawn` is NOT called.
    4. Otherwise spawn as today. When step 1 ran, reuse those `limits` for `formatAgentSpawn` and the catch-block `formatSpawnLimitBlock` instead of a second lookup. When it did not run (auto-detect), keep today's post-spawn lookup. Pass `forced: blocked && p.force`.
  - HTTP `ptah_agent_spawn` (`protocol-dispatcher.ts:1134-1216`): the same steps with module-level `lookupAgentLimits(ptahAPI, rows)` (`:244-254`). Refusal via `toolErrorResponse(request, 'Error: ' + refusal)`.
  - Logging: `logger.info('[McpStdio] agent_spawn refused at limit', { cli, ptahCliId, reason })` with no reset-text or owner key; same on HTTP.
- Verified contracts: `toolError` (`agent-tool.dispatcher.ts:71-86`), `toolErrorResponse` (HTTP, used at `protocol-dispatcher.ts:1138-1143`), `AgentNamespace.limits` (`types.ts:314-317`).
- Failure behaviour: lookup failure → `undefined` → no gate (enrichment-only contract, `agent-tool.dispatcher.ts:259-263`). A lookup that returns per-row `failed` → `unknown` → spawn with the note. Deadline ≤ 3 s (`LIMIT_LOOKUP_DEADLINE_MS`) added to named spawns only.
- Verification seam: `agent-spawn-limits.transport.spec.ts` (both transports). Cover: at-limit → refused and `agent.spawn` not called, with `state: 'lane_at_limit'`; `force: true` → spawned and the text contains "forced"; unknown → spawned with the note; `limits` absent → byte-identical text and `agent.spawn` called once; auto-detect → lookup after spawn as today. Also `agent-tool.dispatcher.spec.ts`, `protocol-dispatcher.spec.ts`, `agent-spawn-args.schema.spec.ts`, `agent-spawn-surface-parity.spec.ts`.
- Files: MODIFY `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-spawn-args.schema.ts`, `…/agent-spawn-args.schema.spec.ts`, `…/mcp-stdio/agent-tool.dispatcher.ts`, `…/mcp-stdio/agent-tool.dispatcher.spec.ts`, `…/mcp-core/protocol-dispatcher.ts`, `…/mcp-core/protocol-dispatcher.spec.ts`, `…/mcp-core/agent-spawn-limits.transport.spec.ts`, `…/mcp-core/tool-description.builder.ts` (shared with Component 11).

### 11. Main-agent guidance (descriptions, system prompt, skills)

- Purpose: the main agent reads the limit state before choosing a lane.
- Text (use verbatim, or shorten without changing meaning):
  - `ptah_agent_list` description, append: `Each row shows a Limit state: AT LIMIT lanes refuse spawns until their reset; "unknown (…)" means the limit could not be read, not that the lane has room. Prefer lanes with confirmed room.` Must stay below `DESCRIPTION_CHAR_BUDGET` = 1000 if a budget assertion covers it (`tool-description.builder.spec.ts:37`).
  - `ptah_agent_spawn` description, insert after the ptah_agent_list sentence: `A spawn on a lane at its plan limit or in a cooldown is refused with the reset time and alternatives; pass force: true only when you know the limit is wrong.`
  - System prompt (`ptah-system-prompt.constant.ts:234`): the list row becomes `List available agents, their status and their plan-limit state`. Workflow step 0 (`:263`) gains `— skip lanes whose Limit state is AT LIMIT`.
  - Both SKILL.md copies, §1 Discover (after "Its rows are the only lanes that exist on this machine now."): `Read each row's Limit state: never pick an AT LIMIT lane (spawn refuses it unless force: true); treat "unknown (…)" as unverified, not as room.` Do not paste a table row (the `lane-rule-single-home.spec.ts` "pasted row" rule).
- Verification seam: `tool-description.builder.spec.ts`, `lane-rule-single-home.spec.ts`, `skill-description-shape.spec.ts`, `vendor-roster-drift.spec.ts`, `surface-catalog-reference.spec.ts` (all in vscode-lm-tools). The new sentences name no vendor.
- Files: MODIFY `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts`, `…/mcp-core/tool-description.builder.spec.ts`, `…/code-execution/ptah-system-prompt.constant.ts`, `.claude/skills/agent-lanes/SKILL.md`, `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/agent-lanes/SKILL.md`.

### 12. apps/ptah-cli registration (decision: no change)

- Decision: do not register the limits service in `apps/ptah-cli`. The CLI already resolves `LANE_LIMIT_LOOKUP` through `cli-engine` (`container.ts:665,728,825`), and `PtahAPIBuilder` injects it optionally (`ptah-api-builder.service.ts:519-520,750`).
- Risks: (1) A second registration would create a second ledger/usage singleton set and split evidence. (2) The CLI host's ledger persists in its own `STATE_STORAGE` (`auth-providers/src/lib/di/register.ts:223-233`), so a limit observed in VS Code/Electron is not visible to `ptah` CLI sessions until that host observes it itself. The gate is therefore weaker in the CLI host; it is documented, not fixed.
- Verification seam: none (no code). Optionally add one assertion in an existing cli-engine container spec that `LANE_LIMIT_LOOKUP` resolves. Out of these batches.

## Integration architecture

- Data flow: `ptah_agent_spawn {cli|ptahCliId, model?, force?}` → zod parse → `spawnRequestTarget` → `agent.list()` (+model on target row) → `agent.limits(rows)` → `LaneLimitLookupService.lookup` → `LaneOwnerResolver.resolveOwnerForLane` / `lastLaneOwner` / `ownerForPtahCliKey` → `planOwnerRead` → `PlanUsageService.getOwnerSnapshot` (reader + ledger via `snapshotWindowsForStatus`) or `snapshotWithoutRead` → `classifyLaneState` → `spawnGateVerdict` → refuse (no spawn) | spawn (+ note/warning) → `formatAgentSpawn(…, limits)`.
- Evidence write path: lane exit → `classifyLaneFailure` → `recordLaneLimits` with the owner from `ownerForLane(cli, model)` (grok now included; opencode free-tier → `opencode` owner) → ledger → visible on the next lookup under the same owner key.
- State: the remembered lane-owner map is in-memory, owned by the singleton `LaneOwnerResolver`, LRU 64, seeded on restore. Ledger persistence is unchanged.
- External boundaries: tool args validated by `AgentSpawnArgsSchema` (zod, `.strict()`). The OpenCode `auth.json` is parsed by zod `AuthSchema`, and only a boolean leaves the sync check. No secret in logs (keep the `errorName`-only logging pattern, `lane-limit-lookup.service.ts:193-198`).
- Failure and rollback: any lookup failure → no gate or an `unknown` note; a spawn is never blocked on missing data. `force: true` always spawns. Owner-rule failure → `undefined` owner (as today).
- Observability: `[McpStdio]`/`[MCP]` info log on refusal (lane + reason kind); existing debug logs for lookup failures and classifier matches.

## Architecture-level quality requirements

- Functional:
  - A lane with an active exhausted window, active owner evidence, an active cooldown or a fresh 100 % window is refused unless `force: true`. The refusal names the reset (or "unknown") and lists alternatives.
  - A Grok limit hit appears as `AT LIMIT` on the next list.
  - An OpenCode lane with a Go key shows Go windows.
  - A Claude-backed ptah-cli lane that hit a 5-hour limit shows `AT LIMIT (5-hour …)` while the window is active.
  - Unknown rows name a cause from the fixed set in Component 9.
  - With `agent.limits` absent, list and spawn output are byte-identical to HEAD.
- Performance: named spawns pay at most one lookup (≤ 3 s deadline, 30 s per-owner cache). Auto-detect spawns are unchanged. The sync Go check reads at most one small file per 5 s.
- Security: no key, owner fingerprint or response body in logs or tool text. zod at both boundaries.
- Maintainability: the shared state engine is unchanged. auth-providers stays independent of cli-agent-runtime. No new vscode-core imports. vscode-lm-tools uses bracket access for index signatures.
- Testability: each component has a behavioural spec listed above, plus one transport-level spec that proves the refusal and the byte parity on both surfaces.

## Open questions (defaults chosen; none block)

1. Auto-detected spawns (no `cli`/`ptahCliId`) are NOT gated. The APM default selection (`getPreferredCli`) may still pick an at-limit lane. Default: leave it; the spawn block shows the state. A follow-up could make default selection skip blocked lanes.
2. Copilot, Cursor, Pi and non-Ollama ptah-cli providers have no owner, reader or classifier wording. Default: `unknown (limits not tracked)` and no gate. Adding wordings needs captured real error text.
3. A1/A2 (OpenCode Go model prefix, 2.x credential store). Default: the prefix rule plus `auth.json`. If 2.x hides the key, lanes fall back to the `opencode` owner.
4. Near-limit lanes are not gated (warning only, as today).
5. The cooldown column changes from `unknown (cooldown active until …)` to `AT LIMIT (cooldown, retry after …)`. This is a visible text change for an existing state, required so the list agrees with the gate.

## Team-leader handoff

- Recommended executors: `backend-developer` for every batch (all TypeScript backend libs plus two markdown skill copies).
- Complexity: MEDIUM-HIGH. There are three libs and two transports, and spec churn in formatter and transport specs. The logic is local per component.
- Dependencies and ordering (component level): 1 → 2 → 3 (same lib, one batch) → 4/5/6/7 (need the new auth-providers exports `ownerForOpenCode`, `snapshotWindowsForStatus`). 8/9/10/11 depend only on existing `LaneLimitResult`/shared types, so they can run in parallel with the auth-providers and runtime batches.
- Parallel-safe work (file-disjoint batches):
  - **Batch A — auth-providers (Components 1, 2, 3).** Files: CREATE `libs/backend/auth-providers/src/lib/quota/opencode-go-credential.ts`, `…/opencode-go-credential.spec.ts`, `…/plan-snapshot-windows.ts`, `…/plan-snapshot-windows.spec.ts`; MODIFY `…/quota/readers/opencode-go-plan-usage.reader.ts`, `…/quota/provider-owner.resolver.ts`, `…/quota/provider-owner.resolver.spec.ts`, `…/quota/plan-usage.service.ts`, `…/quota/plan-usage.service.spec.ts`, the auth-providers barrel (`libs/backend/auth-providers/src/lib/quota/index.ts` and/or `libs/backend/auth-providers/src/index.ts`; confirm which exports `ProviderOwnerResolver`). Verify: `npx jest -c libs/backend/auth-providers/jest.config.ts libs/backend/auth-providers/src/lib/quota/opencode-go-credential.spec.ts libs/backend/auth-providers/src/lib/quota/plan-snapshot-windows.spec.ts libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.spec.ts libs/backend/auth-providers/src/lib/quota/plan-usage.service.spec.ts libs/backend/auth-providers/src/lib/quota/readers/opencode-go-plan-usage.reader.spec.ts --coverage=false --maxWorkers=2`; then `npx nx typecheck @ptah-extension/auth-providers --parallel=1`.
  - **Batch B — cli-agent-runtime (Components 4, 5, 6, 7). Starts after Batch A lands.** Files: MODIFY `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/lane-owner.resolver.ts`, `…/lane-owner.resolver.spec.ts`, `…/lane-limit-lookup.service.ts`, `…/lane-limit-lookup.service.spec.ts`, `…/plan-owner-read.ts`, `…/plan-limit-owner-discovery.service.ts`, `…/plan-limit-owner-discovery.service.spec.ts`, `…/owner-lifecycle.integration.spec.ts` (if needed), `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts`, `…/agent-process-manager.service.spec.ts`, `…/agent-process-manager.restore.spec.ts`. Verify: `npx jest -c libs/backend/cli-agent-runtime/jest.config.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/lane-owner.resolver.spec.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/lane-limit-lookup.service.spec.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/plan-limit-owner-discovery.service.spec.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/owner-lifecycle.integration.spec.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.spec.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.restore.spec.ts --coverage=false --maxWorkers=2`; then `npx nx typecheck @ptah-extension/cli-agent-runtime --parallel=1`.
  - **Batch C — vscode-lm-tools gate and text (Components 8, 9, 10; parallel with A/B).** Files: CREATE `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-spawn-limit-gate.ts`, `…/agent-spawn-limit-gate.spec.ts`; MODIFY `…/mcp-core/agent-limit.formatter.ts`, `…/agent-limit.formatter.spec.ts`, `…/mcp-core/mcp-response-formatter.ts`, `…/mcp-response-formatter.spec.ts`, `…/mcp-core/agent-spawn-args.schema.ts`, `…/agent-spawn-args.schema.spec.ts`, `…/mcp-core/protocol-dispatcher.ts`, `…/protocol-dispatcher.spec.ts`, `…/mcp-core/agent-spawn-limits.transport.spec.ts`, `…/mcp-stdio/agent-tool.dispatcher.ts`, `…/mcp-stdio/agent-tool.dispatcher.spec.ts`, and the `force` property only in `…/mcp-core/tool-description.builder.ts`. The builder is shared with Batch D, so assign the whole builder file (property AND description sentences) to Batch C and give Batch D only the prompt and skills. Verify: `npx jest -c libs/backend/vscode-lm-tools/jest.config.ts libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-spawn-limit-gate.spec.ts libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-limit.formatter.spec.ts libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.spec.ts libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-spawn-args.schema.spec.ts libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-spawn-surface-parity.spec.ts libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-spawn-limits.transport.spec.ts libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.spec.ts libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-stdio/agent-tool.dispatcher.spec.ts --coverage=false --maxWorkers=2`; then `npx nx typecheck @ptah-extension/vscode-lm-tools --parallel=1`.
  - **Batch D — guidance text (Component 11, minus the builder; parallel with all).** Files: MODIFY `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-system-prompt.constant.ts`, `.claude/skills/agent-lanes/SKILL.md`, `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/agent-lanes/SKILL.md`. Verify: `npx jest -c libs/backend/vscode-lm-tools/jest.config.ts libs/backend/vscode-lm-tools/src/lib/code-execution/lane-rule-single-home.spec.ts libs/backend/vscode-lm-tools/src/lib/code-execution/vendor-roster-drift.spec.ts libs/backend/vscode-lm-tools/src/lib/code-execution/skill-description-shape.spec.ts libs/backend/vscode-lm-tools/src/lib/code-execution/surface-catalog-reference.spec.ts --coverage=false --maxWorkers=2`. Run it only after Batch C's heavy check finishes (one heavy check at a time).
- Files affected:
  - CREATE: `libs/backend/auth-providers/src/lib/quota/opencode-go-credential.ts`, `…/opencode-go-credential.spec.ts`, `…/plan-snapshot-windows.ts`, `…/plan-snapshot-windows.spec.ts`, `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-spawn-limit-gate.ts`, `…/agent-spawn-limit-gate.spec.ts`.
  - MODIFY: every file listed in Batches A-D.
  - REWRITE: none.
- Verification points:
  - The `opencode-go` owner key is built from the same directory the Go reader reads (one helper).
  - `ownerForLane` covers grok.
  - `snapshotWindowsForStatus` is used in both `assemble` and `snapshotWithoutRead`.
  - `force` appears in both the zod schema and `inputSchema` (parity spec).
  - With `agent.limits` undefined, the list/spawn text is byte-identical and `agent.spawn` is called exactly once.
  - The refusal path never calls `agent.spawn`.
  - No vendor name in new static strings.
  - Prettier on all touched files.
  - Never run builds or workspace-wide checks. Run one heavy check at a time.

## Batch A+B report

Status: implemented. No Jest, typecheck, lint or build was run (orchestrator owns heavy checks). Prettier was run on every file below.

### Changed files

Batch A (auth-providers):
- CREATE `libs/backend/auth-providers/src/lib/quota/opencode-go-credential.ts`: `openCodeDataDir`, `openCodeGoKeyFromAuth`, `readOpenCodeGoKey`, `hasOpenCodeGoCredentialSync` (5 s TTL + mtime/size cache, boolean only), `resetOpenCodeGoCredentialCacheForTests`.
- CREATE `libs/backend/auth-providers/src/lib/quota/opencode-go-credential.spec.ts`
- CREATE `libs/backend/auth-providers/src/lib/quota/plan-snapshot-windows.ts`: `snapshotWindowsForStatus`.
- CREATE `libs/backend/auth-providers/src/lib/quota/plan-snapshot-windows.spec.ts`
- MODIFY `libs/backend/auth-providers/src/lib/quota/readers/opencode-go-plan-usage.reader.ts`: the cli-store branch calls `readOpenCodeGoKey`; `AuthSchema` moved to the helper.
- MODIFY `libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.ts`: `ownerForOpenCode(model?)`; `cliStorePath('opencode')` = `openCodeDataDir()`.
- MODIFY `libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.spec.ts`
- MODIFY `libs/backend/auth-providers/src/lib/quota/plan-usage.service.ts`: `assemble` windows via `snapshotWindowsForStatus`; `windowSetEstablished` unchanged.
- MODIFY `libs/backend/auth-providers/src/lib/quota/plan-usage.service.spec.ts`
- MODIFY `libs/backend/auth-providers/src/lib/quota/index.ts`: exports `snapshotWindowsForStatus` (reaches `src/index.ts` through `export * from './lib/quota'`).

Batch B (cli-agent-runtime):
- MODIFY `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/lane-owner.resolver.ts`: `ownerForLane(cli, model?)` (opencode → `ownerForOpenCode`, grok → `ownerForCliStore('grok')`), `resolveOwnerForLane`, `rememberLaneOwner`/`lastLaneOwner` (LRU 64, known owners only), `LaneOwnerKey` type.
- MODIFY `…/limits/lane-owner.resolver.spec.ts`
- MODIFY `…/limits/lane-limit-lookup.service.ts`: `LaneLimitLookupRow.model`; owner rules pick `resolveOwnerForLane | ownerForPtahCliKey | lastLaneOwner`.
- MODIFY `…/limits/lane-limit-lookup.service.spec.ts`
- MODIFY `…/limits/plan-owner-read.ts`: `snapshotWithoutRead` uses `snapshotWindowsForStatus`; `INELIGIBLE_STATUSES` deleted.
- MODIFY `…/limits/plan-limit-owner-discovery.service.ts`: OpenCode entry from `ownerForOpenCode()`.
- MODIFY `…/limits/plan-limit-owner-discovery.service.spec.ts`
- MODIFY `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts`: model passed to `ownerForLane` at spawn and exit; free-tier hit on a Go owner filed under `ownerForLane('opencode', 'opencode/')`; owners remembered at spawn, `recordQuotaOwner`, exit upgrade and restore.
- MODIFY `…/agent-process-manager.service.spec.ts`
- MODIFY `…/agent-process-manager.restore.spec.ts`
- `owner-lifecycle.integration.spec.ts`: not changed (it builds the real `LaneOwnerResolver`).

### Spec files to run

```
npx jest -c libs/backend/auth-providers/jest.config.ts libs/backend/auth-providers/src/lib/quota/opencode-go-credential.spec.ts libs/backend/auth-providers/src/lib/quota/plan-snapshot-windows.spec.ts libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.spec.ts libs/backend/auth-providers/src/lib/quota/plan-usage.service.spec.ts libs/backend/auth-providers/src/lib/quota/readers/opencode-go-plan-usage.reader.spec.ts --coverage=false --maxWorkers=2
npx jest -c libs/backend/cli-agent-runtime/jest.config.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/lane-owner.resolver.spec.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/lane-limit-lookup.service.spec.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/plan-limit-owner-discovery.service.spec.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/owner-lifecycle.integration.spec.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.spec.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.restore.spec.ts --coverage=false --maxWorkers=2
```

### Nx projects to typecheck

- `npx nx typecheck @ptah-extension/auth-providers --parallel=1`
- `npx nx typecheck @ptah-extension/cli-agent-runtime --parallel=1`

### Deviations and follow-ups

- `openCodeGoKeyFromAuth` also throws when the contents are valid JSON but do not match the auth shape (for example `type: 'oauth'`), not only on unparseable JSON. Reason: the reader returned `unavailable()` on a failed `AuthSchema.safeParse` before; throwing keeps that behaviour unchanged. The sync check maps it to `false`.
- `hasOpenCodeGoCredentialSync` caches the auth-file outcome (usable / blank / absent / invalid), never the key; `OPENCODE_API_KEY` is read live and counts only when the file has no Go entry (same as the reader).
- Free-tier attribution uses the first form from Component 7 (`ownerForLane('opencode', 'opencode/')`); no `freeTierOwner()` was added.
- **Out of batch, will break:** `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.limits.spec.ts` builds `LaneLimitLookupService` with `owners: { ownerForLane, ownerForPtahCliKey }`. It now needs `resolveOwnerForLane: async () => undefined` and `lastLaneOwner: () => undefined` in place of `ownerForLane`. Otherwise it fails typecheck, and its "no-owner" test gets `failed`. This file is in vscode-lm-tools and is not in Batch C's list, so it was not touched here.
- Six rpc-handlers specs `jest.mock('@ptah-extension/auth-providers')` wholesale. They would only see `snapshotWindowsForStatus` as undefined if they reach `snapshotWithoutRead`. I did not check this. If any of them fails, add the export to its mock factory.
