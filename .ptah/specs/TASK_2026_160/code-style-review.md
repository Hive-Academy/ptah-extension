# Code Style Review - TASK_2026_160

## Review Summary

| Metric          | Value              |
| --------------- | ------------------ |
| Overall Score   | 6/10               |
| Assessment      | NEEDS_REVISION     |
| Blocking Issues | 1                  |
| Serious Issues  | 3                  |
| Minor Issues    | 3                  |
| Files Reviewed  | 16 (+3 spec files) |

The adapter code itself (`opencode-cli.adapter.ts`, `pi-cli.adapter.ts`) is genuinely good: header comments carry the same density and "why" focus as `antigravity-cli.adapter.ts`, the emit/buffer machinery is copy-consistent with the sibling adapters, types are precise (no `any`), and the Pi RPC settle-then-kill lifecycle is well-reasoned and well-commented. The problems are in the settings-plumbing layer surrounding the adapters, where the new per-CLI model keys were wired into 3 near-identical RPC handler copies and 2 UI selectors but never registered in the two places that make a setting durable and exportable — a real functional regression relative to how `cursorModel`/`codexModel`/`copilotModel` behave today.

## The 5 Critical Questions

### 1. What could break in 6 months?

A user sets an Antigravity/opencode/Pi model in the VS Code build, restarts, and the selection reverts to "Default" — or works but silently lives in a different storage location than every other CLI's model setting (`libs/backend/platform-core/src/file-settings-keys.ts:56-64`, `libs/backend/platform-core/src/file-settings-keys.ts:196-203`). Nobody will think to check `file-settings-keys.ts` for a "did we forget to register this key" bug 6 months from now — they'll assume the RPC handler or the SDK adapter is broken and waste time in the wrong file, because the 3-handler mirror (`agent-rpc.handlers.ts` × 2 + `cli-agent-rpc.handlers.ts`) all read/write the key identically and give no sign anything is wrong.

### 2. What would confuse a new team member?

A new engineer copying the "add a new per-CLI model setting" recipe will see `cursorModel` threaded through `AgentOrchestrationConfig` → RPC handler → `FILE_BASED_SETTINGS_KEYS` → `FILE_BASED_SETTINGS_DEFAULTS` → `KNOWN_CONFIG_KEYS`, then see `piReasoningEffort` in this very diff correctly following that 4-step recipe (`file-settings-keys.ts:62`, `:202`, `settings-export.types.ts:73`) — but `antigravityModel`/`opencodeModel`/`piModel` stopping at step 2 (type + RPC handler only). That inconsistency within the same commit is more confusing than a missing pattern entirely, because it looks intentional.

### 3. What's the hidden complexity cost?

The `emitOutput`/`emitSegment`/`onOutput`/`onSegment` buffered-pub-sub block (~35 lines: buffer array, callback array, "flush buffer to late subscriber" logic, twice — once for output, once for segments) is now byte-for-byte duplicated in **6** adapter files: `codex-cli.adapter.ts`, `copilot-sdk.adapter.ts`, `cursor-cli.adapter.ts`, `antigravity-cli.adapter.ts`, and now `opencode-cli.adapter.ts` + `pi-cli.adapter.ts`. Six copies of the same non-trivial closure is past the point where "consistent with precedent" is a good excuse — every future bugfix to that buffering logic (e.g. a race between `done` resolving and a late `onSegment` subscriber) now needs 6 coordinated edits.

### 4. What pattern inconsistencies exist?

- `piReasoningEffort` was correctly added to `FILE_BASED_SETTINGS_KEYS` / `FILE_BASED_SETTINGS_DEFAULTS` / `KNOWN_CONFIG_KEYS`; the three new `*Model` keys were not, despite `cursorModel` (the closest sibling — also a non-trademarked CLI name) being present in all three. See Blocking Issue 1.
- The shared `reasoningEffortOptions` array (`agent-orchestration-config.component.ts:760-767`) is reused verbatim for the new Pi reasoning-effort `<select>`, but Pi's own adapter header and `AgentSetConfigParams.piReasoningEffort` doc comment both advertise `off|minimal|low|medium|high|xhigh|max` — the UI array only has `minimal..xhigh`, silently making `off` and `max` unreachable from Settings even though the backend fully supports them.

### 5. What would I do differently?

- Add a `createOutputEmitterPair<T>()` helper (or two: one for `string` output, one generic for `CliOutputSegment`) to `cli-adapter.utils.ts` and have all 6 adapters (not just future ones) consume it. This is exactly the kind of "logic-light shared foundation" `cli-adapter.utils.ts` already exists for (`stripAnsiCodes`, `spawnCli`, `buildTaskPrompt` are all this same category of shared adapter plumbing).
- Add a single test asserting `KNOWN_CONFIG_KEYS` / `FILE_BASED_SETTINGS_KEYS` contain every `agentOrchestration.*Model` and `agentOrchestration.*ReasoningEffort` key referenced by `AgentOrchestrationConfig`/`AgentSetConfigParams`, so this class of omission fails CI instead of shipping silently.

## Blocking Issues

### Issue 1: New per-CLI model settings never registered as file-based settings or export keys

- **File**: `libs/backend/platform-core/src/file-settings-keys.ts:56-64` (`FILE_BASED_SETTINGS_KEYS`), `libs/backend/platform-core/src/file-settings-keys.ts:196-203` (`FILE_BASED_SETTINGS_DEFAULTS`), `libs/backend/agent-sdk/src/lib/types/settings-export.types.ts:69-76` (`KNOWN_CONFIG_KEYS`)
- **Problem**: `agentOrchestration.antigravityModel`, `agentOrchestration.opencodeModel`, and `agentOrchestration.piModel` are read/written via `getAgentCfg`/`setAgentCfg`/`getCfg`/`setCfg` in all three RPC handler copies (`apps/ptah-extension-vscode/src/services/rpc/handlers/agent-rpc.handlers.ts:149-151,237-243`; `apps/ptah-electron/.../agent-rpc.handlers.ts:149-151,236-243`; `libs/backend/cli-engine/src/lib/rpc/cli-agent-rpc.handlers.ts:154-156,242-248`) using `IWorkspaceProvider.getConfiguration('ptah', 'agentOrchestration.<key>', ...)`. That routing method (`VscodeWorkspaceProvider.getConfiguration`, `libs/backend/platform-vscode/src/implementations/vscode-workspace-provider.ts:72-82`) only sends a key to `~/.ptah/settings.json` (via `PtahFileSettingsManager`) when `isFileBasedSettingKey(key)` is true, i.e. when the key is listed in `FILE_BASED_SETTINGS_KEYS`. `cursorModel`, `codexModel`, `copilotModel`, and the newly-added `piReasoningEffort` are all present in that Set; `antigravityModel`, `opencodeModel`, `piModel` are not. There is also no matching entry in `FILE_BASED_SETTINGS_DEFAULTS`, and none of the three keys were added to `KNOWN_CONFIG_KEYS` in `settings-export.types.ts`.
- **Impact**: In the VS Code build, these three model settings fall through to `vscode.workspace.getConfiguration('ptah').get('agentOrchestration.antigravityModel', ...)`/`.update(...)`, keys that are **not** declared in `package.json contributes.configuration` (confirmed by grep — the marketplace-trademark rule in the root `CLAUDE.md` is precisely why the file-based routing exists for these CLI-name keys in the first place). The setting silently diverges from the storage location every other CLI model setting uses, and is dropped entirely from `ptah settings export`/`import` (`KNOWN_CONFIG_KEYS` is the exhaustive list `countPopulatedSecrets`/export walks). A user who exports settings to move to a new machine, or who inspects `~/.ptah/settings.json` to hand-edit a value (a documented, supported workflow elsewhere in this component — see the Cursor API key help text), will not find `antigravityModel`/`opencodeModel`/`piModel` there.
- **Fix**: Add `'agentOrchestration.antigravityModel'`, `'agentOrchestration.opencodeModel'`, `'agentOrchestration.piModel'` to `FILE_BASED_SETTINGS_KEYS` and `'agentOrchestration.antigravityModel': ''`, etc. to `FILE_BASED_SETTINGS_DEFAULTS` in `file-settings-keys.ts`, and the same three keys to `KNOWN_CONFIG_KEYS` in `settings-export.types.ts`, mirroring exactly how `cursorModel` and the new `piReasoningEffort` were done in this same diff.

## Serious Issues

### Issue 1: Pi's documented full reasoning-effort scale is unreachable from the UI

- **File**: `libs/frontend/chat/src/lib/settings/ptah-ai/agent-orchestration-config.component.ts:760-767`, used at `:679-697` for the Pi `<select>`
- **Tradeoff**: `PiCliAdapter.runSdk` passes `options.reasoningEffort` straight through as `--thinking <effort>` with **no** validation/coercion (`pi-cli.adapter.ts:369-372`, `AgentProcessManager.resolveReasoningEffort` for `cli === 'pi'` explicitly documents "the configured value flows through raw — no in-chat driver and no max→xhigh coercion", `agent-process-manager.service.ts:154-156`), and `AgentSetConfigParams.piReasoningEffort`'s doc comment spells out the full scale as `off|minimal|low|medium|high|xhigh|max` (`rpc-agents.types.ts:155-156`). The shared `reasoningEffortOptions` array used to render the Pi `<select>` only contains `''|minimal|low|medium|high|xhigh` — `off` and `max` are simply not selectable options, even though the backend was specifically built to pass them through unmodified.
- **Recommendation**: Either give Pi its own options array (`piReasoningEffortOptions`) including `off` and `max`, or extend the shared array with the two missing values (checking they don't invalidate Codex/Copilot's narrower accepted set — `mapEffortToCli` at `agent-process-manager.service.ts:130-149` only maps `minimal..xhigh`/`max→xhigh` for those two, so a shared array with `off` would need Codex/Copilot to filter it, not the reverse).

### Issue 2: Sixth copy-paste of the buffered emit/subscribe machinery — past the extraction threshold

- **File**: `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts:426-470`, `pi-cli.adapter.ts:283-327` (byte-identical to `antigravity-cli.adapter.ts:359-403`, and structurally identical to `codex-cli.adapter.ts`, `copilot-sdk.adapter.ts`, `cursor-cli.adapter.ts`)
- **Tradeoff**: This isn't a new violation introduced by this task (the pattern predates it in `codex`/`copilot`/`cursor`/`antigravity`), but this diff is the point where the count crosses from "a few adapters happen to look similar" to "the entire adapter family hand-rolls the same pub/sub buffer, twice per file, 6 times over." `cli-adapter.utils.ts` already exists as the shared home for exactly this class of adapter-plumbing helper (`stripAnsiCodes`, `spawnCli`, `buildTaskPrompt`).
- **Recommendation**: Extract a `createBufferedEmitter<T>()` (or two typed instances: `string` for output, `CliOutputSegment` for segments) into `cli-adapter.utils.ts` and migrate at least the two new adapters to it — ideally the whole family in a follow-up. Not blocking this PR since it matches every sibling adapter's existing shape, but it should be tracked rather than repeated an 7th time on the next adapter.

### Issue 3: New `resolveReasoningEffort('pi')` branch and `MODEL_CONFIG_KEYS` additions have no dedicated unit coverage

- **File**: `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:153-165` (Pi reasoning-effort resolution, deliberately different from the Codex/Copilot path — no `mapEffortToCli` coercion), `:190-198` (`MODEL_CONFIG_KEYS` gains `antigravity`/`opencode`/`pi`)
- **Tradeoff**: `agent-process-manager.service.spec.ts` was touched in this diff (a new `steer()` routing test was added), but no test exercises `resolveReasoningEffort('pi')` returning the raw configured value un-coerced, nor `resolveConfiguredModel('opencode'|'pi'|'antigravity', ...)` reading through `MODEL_CONFIG_KEYS`. Given this method has a _documented_ behavioral difference from the Codex/Copilot branch (no `max→xhigh` coercion), a future refactor that "simplifies" the `if (cli === 'pi')` special-case into the shared `mapEffortToCli` call would silently reintroduce the coercion this code explicitly avoids, and nothing would fail.
- **Recommendation**: Add a couple of table-driven cases to the existing reasoning-effort / model-resolution describe blocks in `agent-process-manager.service.spec.ts` covering `pi` alongside the existing `codex`/`copilot`/`cursor` cases.

## Minor Issues

- `libs/frontend/chat/src/lib/settings/ptah-ai/agent-orchestration-config.component.ts:719-736` — the "No CLI agents found" help box still only lists install commands for Codex CLI and Copilot, unchanged by this diff. Not a regression (Cursor was already missing too), but since this diff triples the roster of headless CLIs, it would have been a good time to note this box is stale.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts:509` / `pi-cli.adapter.ts:139` — the "runaway line" buffer cap differs between adapters (opencode: `1024 * 1024`, antigravity: `64 * 1024`, pi: shared `LINE_BUF_CAP = 1024 * 1024`) with no comment explaining why opencode/pi tolerate 16x more unterminated buffer than antigravity. Likely intentional (JSONL events can be large; antigravity's plain-text narration lines are short) but worth a one-line note so the next adapter author doesn't have to guess which cap to copy.
- `libs/frontend/chat/src/lib/settings/ptah-ai/agent-orchestration-config.component.ts:906-915` — `onReasoningEffortSelect`'s nested ternary (`cli === 'codex' ? ... : cli === 'copilot' ? ... : 'piReasoningEffort'`) and `setAgentModel`'s 5-way nested ternary (`:985-996`) are getting hard to scan; a small `Record<CliType, keyof AgentOrchestrationConfig>` lookup (the same shape as `MODEL_CONFIG_KEYS` on the backend) would read better and scale to the next CLI without another nesting level.

## File-by-File Analysis

### `opencode-cli.adapter.ts`

**Score**: 8/10
**Issues Found**: 0 blocking, 0 serious (shared DRY concern counted once above), 1 minor (buffer cap comment)

**Analysis**: Strong header doc-comment matching antigravity's density and "why" framing (spawn command, notes on `--auto` vs the missing single yolo-flag, JSONL event → segment dispatch table, MCP config shape, Windows native-binary fallback rationale). `handleTextEvent`'s delta-tracking (diffing against `textTracker` per `part.id`) is a clean solution mirroring "Codex's emitTextDelta" as documented. Types (`OpencodeEvent`, `OpencodePart`, `OpencodeToolState`) are precise and `readonly`. No `any`, no unnarrowed catches (all catches are the standard "start fresh on malformed file" no-op pattern already used by `antigravity-cli.adapter.ts`).

**Specific Concerns**:

1. `resolveOpencodeNativeBinary` (`:130-186`) is a fairly deep candidate-path search; consistent with `CodexCliAdapter.resolveCodexNativeBinary()`'s precedent per the doc comment, so not flagged as new debt, but worth a follow-up test asserting at least one candidate branch resolves correctly on a mocked Windows FS (spec file coverage for this wasn't verified beyond a skim).

### `pi-cli.adapter.ts`

**Score**: 8/10
**Issues Found**: 0 blocking, 0 serious (shared DRY concern + missing-manager-test counted once above), 0 minor

**Analysis**: The best-documented file in this diff — the header explicitly justifies the RPC-mode design choice against the in-process SDK ("this repo already proved in-process agent SDKs fail to load under Node/Electron's ESM loader"), documents the settle-on-`agent_settled`-not-`agent_end` lifecycle decision, and flags the one genuinely unverified assumption (`--session` honoured in `--mode rpc`) with a concrete fallback plan (`switch_session`) rather than hand-waving. `steer()`/`continue()` correctly re-point `activeChild` on every `runTurn()`, so steering always targets the live process — verified against `AgentProcessManager.steer()`'s new `sdkHandle.steer` routing (`agent-process-manager.service.ts:705-709`), which is itself gated behind `adapter.supportsSteer()`, so this can't be invoked on a non-RPC CLI.

**Specific Concerns**:

1. `options.autoApprove` and `options.mcpPort` are both explicitly no-ops with inline comments explaining why (Pi has no gate; no MCP support) — good, this is the "explain WHY it's ignored" pattern that prevents a future maintainer from "fixing" what looks like a missed wiring.

### `cli-adapter.interface.ts`

**Score**: 9/10
**Issues Found**: 0 blocking, 0 serious, 0 minor

**Analysis**: The new `steer?` member is additive (optional), well-documented (explains the preference order over the legacy stdin path and the no-op-when-absent contract), and doesn't disturb any existing adapter's structural typing.

### `agent-process-manager.service.ts`

**Score**: 6/10
**Issues Found**: 0 blocking, 1 serious (missing test coverage — Serious Issue 3), 0 minor

**Analysis**: The `sdkHandle?.steer` routing in `steer()` is correctly placed _after_ the `adapter?.supportsSteer()` guard and _before_ the legacy `tracked.process` check, so the precedence documented in the comment ("preferred over the legacy path") is actually enforced by control flow, not just asserted in prose. `MODEL_CONFIG_KEYS` as a `Partial<Record<CliType, string>>` lookup table is a good pattern — better than the ternary chains in the frontend component (see Minor Issue 3).

### `agent-orchestration-config.component.ts`

**Score**: 6/10
**Issues Found**: 0 blocking (config wiring itself is correct — the registry gap is a backend/shared issue), 1 serious (Serious Issue 1 — reasoning options), 1 minor (ternary chains)

**Analysis**: The three new CLI blocks (Antigravity/opencode/Pi, `:542-711`) faithfully mirror the Codex/Copilot/Cursor blocks' structure — same `<select>`/`<option>` shape, same `select-bordered select-xs w-full` daisyui classes, same "Default" sentinel option, same "Permissions" info paragraph pattern. `OnPush` + signals + `inject()` + `@if`/`@for` control flow all correctly used, no `[innerHTML]`. Good comment on why Antigravity has no reasoning-effort control (baked into model labels) and why Pi's block explains its permission model differently ("no approval gate and no MCP support").

## Pattern Compliance

| Pattern                            | Status | Concern                                                                                                                    |
| ---------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------- |
| `catch (error: unknown)` + narrow  | PASS   | All catches in new files are no-op/fallback catches; none discard a narrowed error incorrectly.                            |
| No `any` / no `@ts-ignore`         | PASS   | Confirmed via grep across all new/changed files in scope.                                                                  |
| Naming (`{tool}-cli.adapter.ts`)   | PASS   | `opencode-cli.adapter.ts`, `pi-cli.adapter.ts` match the established convention exactly.                                   |
| Angular OnPush/signals/`inject()`  | PASS   | Settings component fully compliant, matches sibling blocks structurally.                                                   |
| Hexagonal boundaries               | PASS   | Settings component imports only `@ptah-extension/core`/`shared`; adapters stay in platform-agnostic `cli-agent-runtime`.   |
| File-based settings registry sync  | FAIL   | See Blocking Issue 1 — `*Model` keys not registered in `FILE_BASED_SETTINGS_KEYS`/`_DEFAULTS`/`KNOWN_CONFIG_KEYS`.         |
| RPC handler triple-mirror parity   | PASS   | All three `agent-rpc.handlers.ts`/`cli-agent-rpc.handlers.ts` copies received identical additions — no drift between them. |
| DRY (adapter emit/buffer plumbing) | FAIL   | Now 6 duplicate copies of the same buffering closure; see Serious Issue 2.                                                 |

## Technical Debt Assessment

**Introduced**: Two more copies of the un-extracted emit/buffer boilerplate (Serious Issue 2); a settings-registry gap that will need a coordinated fix across 2 files once discovered (Blocking Issue 1); an untested reasoning-effort/model-resolution code path with a documented behavioral divergence from its neighbors (Serious Issue 3).
**Mitigated**: None directly — this is additive feature work, not a refactor.
**Net Impact**: Net-negative on the settings-registry front (a real, user-visible gap) and neutral-to-slightly-negative on the DRY front (matches precedent but the precedent itself is now overdue for cleanup). The adapter code proper (opencode/pi `runSdk` implementations) is high quality and does not add debt beyond the pre-existing pattern it inherits.

## Verdict

**Recommendation**: REVISE
**Confidence**: HIGH
**Key Concern**: `antigravityModel`/`opencodeModel`/`piModel` are wired through the RPC layer and the UI but never registered in `FILE_BASED_SETTINGS_KEYS`/`FILE_BASED_SETTINGS_DEFAULTS`/`KNOWN_CONFIG_KEYS` — the exact 3-registry pattern this same diff correctly followed for `piReasoningEffort`. This is a quick, mechanical fix (three arrays, one line each) but it's the kind of gap that ships invisibly (everything compiles, the UI dropdown works in the running session) and only surfaces as "my model setting didn't survive a restart" or "my exported settings don't include my opencode model" days or weeks later.

## What Excellence Would Look Like

A 10/10 version of this diff would: (1) include the three missing registry entries alongside `piReasoningEffort` in the same commit — the fact `piReasoningEffort` got it right shows the author knew the pattern, so this is almost certainly an oversight rather than a knowledge gap; (2) extend `reasoningEffortOptions` (or add a Pi-specific variant) to cover the full `off..max` scale the backend was explicitly built to pass through raw; (3) take the "3rd/4th/5th/6th copy of the same helper" signal seriously and land a shared `createBufferedEmitter` in `cli-adapter.utils.ts` as part of adding the _first_ of the two new adapters, then have the second one consume it instead of copying it again; (4) extend `agent-process-manager.service.spec.ts`'s existing reasoning-effort/model-resolution test tables with a `pi` row so its documented "no coercion" behavior is guarded by CI, not just a comment.
