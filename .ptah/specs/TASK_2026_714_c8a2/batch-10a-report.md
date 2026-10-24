# Batch 10a — Lane profile and events

Implemented the new lane settings projection and per-turn event mapper. Production routing remains disabled. Native lanes remain unusable with the current core: suppression is mandatory and the core refuses it before spawning.

## Files

- `D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-lane-profile.ts`
- `D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-lane-profile.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-lane-events.ts`
- `D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-lane-events.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat/libs/backend/cli-agent-runtime/package.json` — adds `@ptah-extension/codex-runtime: 0.0.1`.
- This report: `D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat/.ptah/specs/TASK_2026_714_c8a2/batch-10a-report.md`.

No legacy files, public indexes, interfaces, registrations, other lane owners, or core sources were edited. No git commands were run.

## Contracts and repository evidence

- Batch boundaries: `batches.md` Phase P10 / Batch 10a; settled C1-C10; `implementation-plan.md` §8.
- Existing lane configuration: `codex-lane-config.builder.ts`, `codex-lane-budgets.ts`, `codex-exec-args.ts`, `codex-config-rejection.ts` and existing specs. The new projection takes the same resolved `CodexLaneConfigInput`; callers retain today's budget resolution (120000 / 2500 / web search enabled when unset).
- Public runtime contracts: `libs/backend/codex-runtime/src/index.ts`, `codex-runtime.types.ts`, `codex-execution-profile.ts`. All new core imports use the public package only.
- Existing output contract: `libs/shared/src/lib/types/agent-process.types.ts:458`; `cli-adapter.interface.ts` already consumes this shared type.
- Usage semantics: core `codex-event-translator.ts` emits per-turn snapshots and repeats the last snapshot at terminal; `libs/shared/src/lib/utils/cli-usage.utils.ts` adds token counters across segments.
- Module boundaries: both projects carry `scope:extension` and `type:feature`; root `eslint.config.mjs:294` permits extension-to-extension and `:410` permits feature-to-feature. Scoped lint passed.
- Both adapters have no I/O, logging, service resolution, or process ownership. No logger is needed or constructed; there are no console calls.

## Legacy-behavior preservation

The result of `buildCodexLaneProfileSettings` contains `settings` for the public `buildCodexExecutionProfile({ session: settings, paths, ... })` and mandatory typed `requirements`. The latter records requirements the current public core schema cannot represent. They are not executable config overrides or permission to drop requirements.

| Legacy setting / behavior                                                                    | Lane field                                                                                    | Native support today                                                                                                     |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| User MCP disabled; names distinct and sorted; empty and ptah excluded                        | requirements.disabledUserMcpServers; settings.lane.suppressedTools entries mcp:name           | blocked-by-core: suppression is rejected before spawn                                                                    |
| agents.enabled=false                                                                         | requirements.agentsEnabled=false; suppressedTools agents                                      | blocked-by-core                                                                                                          |
| features.plugins=false                                                                       | requirements.pluginsEnabled=false; suppressedTools plugins                                    | blocked-by-core                                                                                                          |
| features.apps=false                                                                          | requirements.appsEnabled=false; suppressedTools apps                                          | blocked-by-core                                                                                                          |
| skills.include_instructions=false                                                            | requirements.includeSkillInstructions=false; suppressedTools skills; empty instructionSources | blocked-by-core                                                                                                          |
| Ptah MCP URL scoped to workspace and agent                                                   | settings.mcpServers, using existing ptahMcpServerUrl                                          | blocked-by-core: runtime rejects nonempty mcpServers before spawn                                                        |
| Ptah MCP tool timeout 960 seconds                                                            | requirements.ptahToolTimeoutSeconds                                                           | blocked-by-core: no public execution field / enforcement                                                                 |
| model_auto_compact_token_limit                                                               | requirements.autoCompactTokens                                                                | blocked-by-core: no public execution field / enforcement                                                                 |
| tool_output_token_limit                                                                      | requirements.toolOutputTokenLimit                                                             | blocked-by-core: no public execution field / enforcement                                                                 |
| Zero / negative zero token limits omit keys; invalid resolved token limits omit with warning | absent optional requirement fields; sanitized warnings                                        | yes, projection behavior; native positive limits remain blocked                                                          |
| Web search live or disabled                                                                  | requirements.webSearch                                                                        | blocked-by-core: no public execution field / enforcement                                                                 |
| First turn / resume / continuation role resend                                               | settings.developerPrompt; requirements.roleDelivery=replace                                   | yes, scalar projection; live native resume parity remains unproved                                                       |
| Optional role resend override false / empty role                                             | omitted developerPrompt, same as legacy                                                       | yes, projection behavior                                                                                                 |
| Trimmed reasoning effort, model, workspace                                                   | settings.effort / model / cwd                                                                 | yes, public core fields                                                                                                  |
| Port absent / 0 omits MCP; invalid port warns and omits                                      | empty mcpServers; omitted timeout                                                             | yes, projection behavior                                                                                                 |
| Optional spending / turn controls                                                            | settings.lane.maxBudgetUsd / maxTurns                                                         | blocked-by-core when present and positive; zero spending omits                                                           |
| Legacy approval_policy=never / danger-full-access                                            | deliberately replaced by permissionLevel; default ask; explicitFullAccess=false               | yes: ask is granular-all-true + read-only; plan read-only; auto-edit/yolo workspace-write; full access unproved-disabled |
| Version warning / exec argv / config rejection retry                                         | not copied into native projection                                                             | core owns version pin; no config retry or SDK fallback added                                                             |

Every constructed lane profile contains suppression requirements, including when budgets are zero and MCP is absent. This intentionally trips the current pre-spawn refusal at `codex-runtime.ts:89`. Token budgets, web search and timeout remain typed outside the core schema until core enforcement exists; **a future core change must not simply remove the suppression guard and enable these profiles**. The batch does not claim live native operation, MCP parity, or role-resume proof.

## Event mapping

Instantiate `CodexLaneEvents` once per turn with contextId/processGeneration/threadId/turnId. Call `map(event)`, emit its segments, and settle immediately when its `terminal` status is present. Batch 10b owns actual handle completion/disposal. No exit event or timer is needed.

| Runtime event                       | Existing lane output                                                                                                          |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| textDelta                           | text segment in event order                                                                                                   |
| textFinal                           | only the missing suffix after streamed text; full text for final-only or differing final content                              |
| reasoning                           | thinking segment; final deduplicated against prior reasoning                                                                  |
| toolStarted                         | tool-call with stable toolCallId, name, JSON args, object toolInput when applicable                                           |
| toolCompleted                       | tool-result / tool-result-error with same id and remembered name; no invented name for unmatched completion                   |
| file                                | file-change with path and added / modified / deleted kind, matching existing lane representation                              |
| image                               | explicit info that lane output cannot render images; no image bytes exposed                                                   |
| compaction                          | info with reported phase                                                                                                      |
| approvalRequested / approvalSettled | info; no raw request details                                                                                                  |
| usage                               | retain latest per-turn snapshot; do not increment additive CLI totals yet                                                     |
| error                               | fixed sanitized error segment; no raw message or code forwarded                                                               |
| terminal                            | immediately returns completed / interrupted / failed once; emits latest reported usage once and a sanitized error when needed |

Usage mapping: inputTokens, outputTokens, totalTokens and costUsd retain reported values; cachedInputTokens maps to cacheReadTokens. Missing values stay absent; zero stays zero. No inferred cost, context size, duration, cache writes, or fabricated totals. reasoningOutputTokens has no matching CliOutputSegment field and is not folded into another counter. Terminal-provided usage takes precedence over the retained snapshot. No cumulative snapshot double counting.

Identity mismatch and repeated/out-of-order sequence numbers are ignored without advancing the accepted stream. Terminal clears retained item/tool/usage state and ignores all later events. An aborting owner must discard the per-turn mapper. Final text that disagrees with streamed text is emitted honestly as full final content; the existing append-only lane segment type cannot retract prior content.

## Specs

42 cases across the two new specs:

- Profile: suppression, deterministic user-server exclusion, attributed Ptah URL, timeout, public core builder integration, settled permission mappings, zero and invalid token limits, positive money/turn limits, omitted/invalid MCP ports, role replacement and resume override, repeatability and input immutability.
- Events: interleaved partial/final text, final-only content, reasoning, tool lifecycle and unmatched completions, latest snapshot usage, terminal usage precedence, missing/zero usage fields, all terminal statuses without process exit, duplicate/late/foreign events, sanitized errors, file changes, image limitation, compaction, and approval detail suppression.

## Exact verification

Executed from `D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat` in PowerShell; Select-Object / Select-String are equivalents of the requested tail / grep filters. Commands ran sequentially, without build/install or workspace-wide checks.

1. `ptah_get_diagnostics`, scoped to the two new source files: TypeScript compiler source, clean coverage, 0 errors and 0 warnings.
2. Focused Jest (final run, exit 0):

```powershell
npx jest -c libs/backend/cli-agent-runtime/jest.config.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-lane-profile.spec.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-lane-events.spec.ts --coverage=false --maxWorkers=2 2>&1 | Select-Object -Last 20
```

Result: 2 suites passed, 42 tests passed. Node printed an ESM-loading warning for jest.config.ts; tests completed successfully. Initial run had 4 profile-fixture failures (cwd incorrectly recorded as missing); the fixture now records an existing directory. No production change was needed for that failure.

3. Scoped typecheck and lint (exit 0):

```powershell
npx nx run-many -t typecheck lint -p @ptah-extension/cli-agent-runtime --parallel=1 --output-style=static 2>&1 | Select-String -Pattern 'problems|Successfully|Failed| error ' | Select-Object -Last 10
```

Result: Successfully ran both targets; 51 problems (0 errors, 51 warnings). No module-boundary error.

4. Degradation ratchet (exit 0; no FAIL):

```powershell
npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts 2>&1 | Select-String -Pattern 'cli-agent-runtime|TOTAL'
```

Exact relevant output:

```text
libs/backend/cli-agent-runtime: 0 ok (baseline 1) — directory not found by this scan; run --update-baseline to prune
degradation-audit: TOTAL 276 unsuppressed site(s)
```

Coverage limitation: the audit reports that it did not find this directory in its scan. This satisfies the requested no-FAIL output but is not evidence that every changed file was audited. No baseline was altered.

5. Formatting (exit 0):

```powershell
npx prettier --write libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-lane-profile.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-lane-profile.spec.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-lane-events.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-lane-events.spec.ts libs/backend/cli-agent-runtime/package.json
```

The two specs were formatted again after the fixture fix and approval test addition. This report was also formatted.

## Decisions

| Decision                                                      | Options                                                                              | Evidence                                                                                                | Reversible                                              |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Return public core settings plus mandatory typed requirements | Silently omit unsupported fields; mutate core; explicit requirements beside settings | Ownership excludes core; public schema lacks token/web-search/timeout fields; core refuses suppressions | Yes, integrate requirements when core support is proved |
| Require explicit native permissionLevel, defaulting to ask    | Copy legacy autoApprove/never; settled core levels                                   | C2/C7 and public profile builder                                                                        | Yes, explicit caller level                              |
| Build a scalar replacement role each turn                     | Append previous role; replace role                                                   | Existing builder resend semantics and §8                                                                | Yes; live resume evidence still required                |
| Buffer usage snapshots until terminal                         | Add every snapshot; infer deltas; emit once                                          | Core translator snapshots and additive shared CLI usage fold                                            | Yes                                                     |
| Expose terminal status synchronously from mapping             | Wait for process exit; terminal-driven settlement                                    | Batch 10a / Windows requirement; 10b owns SdkHandle                                                     | Yes                                                     |
| Use fixed error text and explicit image limitation            | Forward arbitrary errors/image bytes; safe lane representation                       | Existing output type lacks images; task requires sanitized errors                                       | Yes, enrich only through a validated safe contract      |
| Retain core refusal and omit legacy rejection retries         | Drop suppression/budgets and retry; fail closed                                      | Current runtime guard, C10, production rollout disabled                                                 | Only after evidence and authorized core work            |

## Remaining integration limits

Batch 10b must consume the terminal result to resolve the lane and dispose the context as required; 10c owns selection/registration. Neither is wired here. Native lanes cannot run under the current core suppression/MCP guard. No live Codex turns were performed.
