# Backlog audit, part 1 (TASK_2026_886_032a)

Auditor: backlog-auditor-1. Base: origin/main 390808edf. Input: `work/backlog-part1.txt` (76 tasks, all `status: backlog`).
Method: read the frontmatter of each `task.md`, then a few targeted greps or `git log` lookups per task. All paths are repo-relative.

## Summary counts

| Verdict | Count |
|---|---|
| ALREADY_DONE | 2 |
| OBSOLETE | 12 |
| DUPLICATE | 1 |
| PARTIAL | 11 |
| STILL_VALID | 42 |
| UNCLEAR | 8 |
| **Total** | **76** |

Main findings:
- Three hosts are gone from main. `apps/ptah-cli` and `apps/ptah-extension-vscode` were removed in 1cee6fafe ("remove the TUI, CLI and VS Code hosts"). `apps/ptah-license-server` was removed in 0dde8a197 ("trim the site to the desktop app"). Every task aimed only at those hosts is OBSOLETE.
- The Tribunal page and its backend validators were retired in dea55817c. That makes TASK_2026_298 and TASK_2026_505 obsolete.
- TASK_2026_519 is fixed in code, but `apps/ptah-electron/src/windows/permission-policy.ts:111-114` still calls it deferred. That comment is now stale.

## Table

| Task ID | Title (short) | Verdict | Evidence | Recommended status | Confidence |
|---|---|---|---|---|---|
| TASK_2026_241 | Unified installed MCP inventory in Marketplace | PARTIAL | `libs/frontend/marketplace/src/lib/data/marketplace-inventory.store.ts:455-469` merges `mcpDirectory:listInstalled` with session connector rows through `groupInstalledServers`. I found no view grouped by target config file and no fold-in of Smithery or OAuth lists. | backlog | med |
| TASK_2026_246 | Humanize agent-generation (compile gate + split god files) | PARTIAL | Compile gate shipped in 9ecfe8ddb (batch 0). `user-layer-mirror.service.ts` has grown to 2651 lines, so the split has not happened. | backlog | med |
| TASK_2026_266 | Memory graph + vector-space explorer | STILL_VALID | No `memory:graph` RPC or graph component anywhere in libs. | backlog | med |
| TASK_2026_269 | Derive registry.md from task-index watcher | PARTIAL | The main harm is mitigated: ac84da4a9 stopped the registry being read as an ID allocator, and 28cd80567 allocates IDs across every checkout. `RegistryGeneratorService` is still reached only through the RPC (`tasks-rpc.handlers.ts`). `task-index.service.ts` never regenerates it. | backlog | med |
| TASK_2026_274 | One spawnAndCapture utility in platform-core | STILL_VALID | No `spawnAndCapture`. `workspace-intelligence/src/project-analysis/toolchain-probe.ts` (196 lines) still duplicates `cli-adapter.utils.ts`. | backlog | med |
| TASK_2026_275 | Split external-marketplaces.component (5 state machines) | STILL_VALID | `libs/frontend/marketplace/src/lib/external-marketplaces.component.ts` is now 1055 lines (was 961). No store was extracted. | backlog | high |
| TASK_2026_276 | ptah-python plugin + two python skills | STILL_VALID | `libs/shared/src/lib/constants/stack-profiles.ts:183-184` still names `python-workspace-initializer`/`-architect`. `plugins/` has angular, core, dotnet, nx-saas and react, but no python. | backlog | high |
| TASK_2026_279 | Provenance marker for harness skill/command copies | UNCLEAR | b3dc1b83a added hash-based `localEdit`/`agentsInSync` reporting. I could not confirm a skill/command provenance signature. | backlog | low |
| TASK_2026_281 | Close four harness entry points + split RPC facade | UNCLEAR | `agent-process-manager.service.ts:765+` now runs pre-handle checks for `spawnFromSdkHandle` (TASK_2026_614). I did not check the resumeSession and cron cwd paths, or the facade split. | backlog | low |
| TASK_2026_284 | Harness for opencode and pi | PARTIAL | opencode is now a target (`libs/shared/src/lib/types/harness-sync.types.ts:26`, commit 849cf7108). `pi` is still absent from `HARNESS_TARGET_IDS`. | backlog | high |
| TASK_2026_289 | Smithery skills-side provider decision | STILL_VALID | Every Smithery file in `libs/backend/cli-agent-runtime/src/lib/mcp-directory/` is MCP-only. No skills fetch exists. This is still an open scope decision. | backlog | med |
| TASK_2026_292 | ptah_agent_status shows next-turn capability | STILL_VALID | No next-turn or continuable field in the agent status tooling (`vscode-lm-tools/.../agent-namespace.builder.ts`). Only an internal `continueConversation` comment mentions it. | backlog | low |
| TASK_2026_298 | Unify participant concept (family key, model lane) | OBSOLETE | Tribunal page and validators retired in dea55817c. `validateCrucible`/`buildProviderLanes` no longer exist, so the family mismatch it described has no code left. The broader model-vs-agent unification would need a fresh task. | cancelled | med |
| TASK_2026_300 | Enrich markdown renderer (file refs, pattern upgrades) | PARTIAL | Clickable agent file links shipped: `libs/frontend/markdown/src/lib/markdown-file-links.ts`, commits 3bd2e310e and cf8bac264. The recognized-pattern upgrades (diff blocks and similar) are not evident. | backlog | med |
| TASK_2026_302 | DI phase registration not importable under Jest | STILL_VALID | `apps/ptah-electron/src/di/phase-2-diagnostics-override.spec.ts:12-18` still says `require('./phase-2-libraries')` throws under Jest. The spec pins the call site by reading its source. | backlog | high |
| TASK_2026_305 | Enable Resend webhook in production | OBSOLETE | The license server (Resend webhook, MarketingService) was removed in 0dde8a197. | cancelled | high |
| TASK_2026_311 | Refund curation token on provider-exhaustion stall | STILL_VALID | `memory-curator/src/lib/triggers/memory-trigger.service.ts:924-931` `refundUndispatched` refunds only `network-backoff` and `provider-unsupported`. There is no exhaustion case. | backlog | med |
| TASK_2026_312 | Hosts' harness boot lines disagree (VS Code) | OBSOLETE | The VS Code host was removed in 1cee6fafe. Only Electron's line remains. | cancelled | high |
| TASK_2026_313 | Harness disclosure e2e + uncapped Dashboard card | PARTIAL | The Dashboard `ptah-harness-card` no longer exists (removed around 76c137ee3), so the cap half no longer applies. The e2e half for the Marketplace `harness-health-badge` still looks unasserted: `marketplace.spec.ts` only stubs `harness:health`. | backlog (narrow to badge e2e) | low |
| TASK_2026_338 | CodeExecutionMCP never shut down; start/stop race | STILL_VALID | No `stop`/`dispose` of `CODE_EXECUTION_MCP` in `apps/ptah-electron/src/activation/shutdown.ts` or anywhere else in the app. Only `startCodeExecutionMcp` exists (`wire-runtime.ts:448`). | backlog | med |
| TASK_2026_339 | Two resume paths claim MCP without registering | STILL_VALID | `rpc-handlers/src/lib/chat/session/chat-session.service.ts:2555-2561` says `chat:resume --activate` and `ensureSessionActiveForRewind` "never call `ensureRegisteredForSubagents` at all". | backlog | high |
| TASK_2026_355 | Repair CP1252 mojibake em dashes | PARTIAL | 134 occurrences remain in 8 .ts files, down from 344 in 65. Examples: `skill-synthesis/src/lib/triggers/skill-trigger.service.ts`, `auth-providers/.../translation-proxy-base.spec.ts`. No guard spec was found. | backlog | high |
| TASK_2026_358 | Ptah-owned resumable fleet runner (SQLite) | STILL_VALID | No fleet-run tables, migration or runner service in libs. | backlog | med |
| TASK_2026_362 | Native agent loop on pi-ai | STILL_VALID | No `NativeAgentAdapter` or pi-ai loop in `libs/backend`. | backlog | med |
| TASK_2026_369 | SDK fallback content block as model-switch chip | STILL_VALID | No `fallback` content-block type or model-switch chip in shared types or chat-ui. | backlog | low |
| TASK_2026_386 | Git-first review surface (CodeMirror diff, PR, external editor) | PARTIAL | CodeMirror 6 is installed (`package.json:82-86`). `libs/frontend/git-ui` has review-canvas, spot-editor, open-in and task (git dock 239f8013e). `@codemirror/merge` is not adopted, and I did not confirm a ref-vs-ref diff RPC. | backlog | med |
| TASK_2026_388 | Private chat sessions on their own provider | STILL_VALID | No isolated per-session provider runtime found. | backlog | low |
| TASK_2026_391 | Curator extract treats unparseable output as empty | STILL_VALID | `agent-sdk/.../sdk-internal-query.curator-llm.ts:448` returns `extracted` with `parseDrafts(...)`, and `:684-688` returns `[]` for both no-JSON and Zod failure. | backlog | high |
| TASK_2026_393 | Dependency guard for ptah-license-server | OBSOLETE | `apps/ptah-license-server` was removed in 0dde8a197. | cancelled | high |
| TASK_2026_394 | Declare missing runtime imports in published CLI | OBSOLETE | `apps/ptah-cli` was removed in 1cee6fafe. Its package.json no longer exists. | cancelled | high |
| TASK_2026_395 | License-server migrations as deploy step | OBSOLETE | The license server was removed in 0dde8a197. | cancelled | high |
| TASK_2026_407 | Investigate duplicated assistant responses | UNCLEAR | Investigation-only task. No direct evidence either way. | backlog | low |
| TASK_2026_415 | Single-flight boot readiness pull; async harness reads | STILL_VALID | `libs/frontend/core/src/lib/services/boot-status.service.ts:246` `pullReadiness` has no in-flight guard. `harness-sync/src/lib/targets/claude-target.ts:20,654,713-717` still uses `readdirSync`/`existsSync`/`readFileSync`. | backlog | high |
| TASK_2026_422 | Native uuid stamping picks oldest unstamped bubble | STILL_VALID | `libs/frontend/chat-state/src/lib/tab-manager.service.ts:2382` fallback still uses `findIndex`, which takes the first eligible bubble. Pending-continue ids are excluded but failed sends are not. | backlog | med |
| TASK_2026_423 | Codex PowerShell child survives codex.exe kill | STILL_VALID | `@openai/codex-sdk` is still a dependency. `killProcessTree` is used only in the claude detectors, not on the codex lane path. | backlog | low |
| TASK_2026_424 | Cursor adapter waits for stream end | STILL_VALID | `cli-adapters/cursor-cli.adapter.ts:454-467` still returns only after `for await (run.stream())` ends. It has no return on terminal status. | backlog | med |
| TASK_2026_425 | No regression guard for rewind with live prompt boundary | UNCLEAR | No rewind/fork spec mentioning the boundary found in chat-state or chat-streaming. I did not search deeper. | backlog | low |
| TASK_2026_427 | ptah-cli test chain unrunnable in worktree | OBSOLETE | `apps/ptah-cli` was removed in 1cee6fafe. `withEngine` survives only in `worker-host/src/lib/commands/serve.ts`. | cancelled | med |
| TASK_2026_428 | One focus-trap primitive for daisyUI modals | STILL_VALID | 15 frontend .ts files still use `modal modal-open`. The only CDK FocusTrap is in `libs/frontend/ui/.../popover.component.ts`. | backlog | med |
| TASK_2026_429 | Spawned agents misreport lifecycle | UNCLEAR | The lane completion push (TASK_2026_515, PR #555) covers the polling pain. I did not verify the three specific defects (vanishing record, never-exit, hang). | backlog | low |
| TASK_2026_436 | Share Ptah system prompt with every CLI | PARTIAL | Lanes get role and instruction text (`lane-role-condenser.ts`, codex lane config). The harness has no `instructions` facet: `HarnessEntryKind` is still skill, command, agent and mcp. | backlog | low |
| TASK_2026_438 | Lane completion contract reaches orchestrator | DUPLICATE | Covered by TASK_2026_515_b7c3 (status done), PR #555 (e70d80b41). `<agent-lane-completed>` and the `no-deliverable` verdict are live. | done | high |
| TASK_2026_447 | Repair contentless memory_concepts_fts drift | STILL_VALID | The only migration touching `memory_concepts_fts` is `0017_memory_schema_v2.ts`. There is no repair migration. | backlog | med |
| TASK_2026_450 | Stabilize workspace-watch AC-7 stress spec on CI | UNCLEAR | `platform-electron/src/workspace-watch/workspace-watch-host.stress.spec.ts` is still present. I did not check recent CI flake history. | backlog | low |
| TASK_2026_454 | memory-curator to agent-sdk dependency direction | STILL_VALID | `memory-curator/src/lib/curator-llm/curator-pass-admission.ts:55` imports `NetworkBackoff` from agent-sdk, while `queue-slot-timeout.ts:15` still says such an import "would close the cycle". | backlog | high |
| TASK_2026_455 | Measure retention batch timings on better-sqlite3 | STILL_VALID | Manual field measurement. No evidence it was done. | backlog | med |
| TASK_2026_456 | Stabilize three load-sensitive specs | UNCLEAR | I did not identify the R-TL8/11/12 specs cheaply. | backlog | low |
| TASK_2026_457 | Per-field memory lifecycle preview counts | STILL_VALID | `libs/shared/src/lib/types/rpc/rpc-curator-diagnostics.types.ts:136` is still `preview: MemoryLifecyclePreviewDto \| null` (all or nothing). | backlog | high |
| TASK_2026_458 | CLI degrades instead of crashing on early memory failure | STILL_VALID | `cli-engine/src/lib/thoth/register-thoth-libraries.ts:203+` `ensureMemoryContractFallbacks` stubs reader, lister, usage and symbol tokens only, not MEMORY_SEARCH or MEMORY_STORE. cli-engine still boots through worker-host. | backlog | low |
| TASK_2026_459 | Ptah title for peer sessions across workspaces | STILL_VALID | `agent-sdk/src/lib/peer-sessions/peer-session-directory.service.ts:167-177` reads `metadataStore.getAll()` only. There is no cross-workspace aggregate reader. | backlog | low |
| TASK_2026_460 | createChild resets createdAt/cost/tokens | STILL_VALID | `agent-sdk/src/lib/session-metadata-store.ts:2504-2522` still builds a fresh record (`createdAt: now`, `totalCost: 0`). | backlog | med |
| TASK_2026_468 | Per-tile perf sampling + re-measure AC 2 | STILL_VALID | No `sampleState` in apps or libs. | backlog | low |
| TASK_2026_476 | Two cost paths understate instead of "unknown" | PARTIAL | `libs/shared/src/lib/utils/codex-rate-card.ts` now has cache rates, and `codex-lane-events.ts:240-249` carries cached tokens and `costUsd`. I did not verify the catalog zero-cache-rate path. | backlog | low |
| TASK_2026_481 | Move synchronous SQLite reads off Electron main thread | STILL_VALID | persistence-sqlite has only an integrity/backup worker and `slow-statement-timing.ts`. Reads still run on the calling thread. | backlog | med |
| TASK_2026_495 | Pinned apps: store, refresh, text delivery | STILL_VALID | Only an intent comment exists (`libs/shared/src/mcp-apps-contracts/dashboard-catalog.ts:78`). No pinned-app store. | backlog | low |
| TASK_2026_500 | Repair or delete license-server prune targets | OBSOLETE | The license server was removed in 0dde8a197. | cancelled | high |
| TASK_2026_501 | Prove docs and landing deploys after migration | UNCLEAR | `scripts/do-docs-build.sh` and `.do/docs-app.yaml` still exist. I did not check whether a real deploy has run since. | backlog | low |
| TASK_2026_502 | Verify Sentry HTTP instrumentation on NestJS 12 | OBSOLETE | The license server (the only NestJS app) was removed in 0dde8a197. No `@sentry/nestjs` or `@nestjs/core` in `package.json`. | cancelled | high |
| TASK_2026_503 | Smoke test Electron installer on macOS/Linux | STILL_VALID | Manual verification. No evidence it was done. | backlog | med |
| TASK_2026_504 | Replace uuid with crypto.randomUUID | STILL_VALID | `package.json:137` still has `"uuid": "^11.1.0"`. 7 non-spec files import it. | backlog | high |
| TASK_2026_505 | gridstack 12 -> 13 | OBSOLETE | The `nodesCB` call sites went with the Tribunal page (dea55817c), and no .ts file imports gridstack now. Its only use is a CSS import at `apps/ptah-extension-webview/src/styles.css:13`. The real follow-up is removing the dependency, not upgrading it. | cancelled | med |
| TASK_2026_506 | Tailwind 4 and daisyUI 5 | STILL_VALID | `package.json:184,205` still has daisyui ^4.12.24 and tailwindcss ^3.4.18. | backlog | high |
| TASK_2026_507 | @sentry/nestjs 11, drop peer override | OBSOLETE | No `@sentry/nestjs` dependency and no Nest override in `package.json` after the license-server removal (0dde8a197). | cancelled | high |
| TASK_2026_508 | cross-env 7 -> 10 | STILL_VALID | `package.json:183` still has `"cross-env": "^7.0.3"`. | backlog | high |
| TASK_2026_513 | Decide whether session stats include CLI lanes | STILL_VALID | No lane-inclusion flag or label found. | backlog | low |
| TASK_2026_517 | Surface retention fault without opening the tab | STILL_VALID | The verdict exists (`memory-curator/src/lib/retention/memory-storage-health.ts:32`). I found no notification-center or active channel for it. | backlog | low |
| TASK_2026_519 | CDP automation window gets its own partition | ALREADY_DONE | `apps/ptah-electron/src/services/electron-browser-capabilities.ts:504-519` uses `partition: 'ptah-browser-tool'` (in-memory) with sandbox and webSecurity on (7ba5de3bd). The comment at `windows/permission-policy.ts:111-114` is stale. | done | high |
| TASK_2026_520 | Keep workstation paths out of .ptah/specs + guard | STILL_VALID | 102 files under `.ptah/specs` still contain the developer account name. No spec-path guard in scripts, .husky or the CI workflow. | backlog | med |
| TASK_2026_522 | MCP OAuth e2e spec reads real user profile | STILL_VALID | `apps/ptah-electron-e2e/src/specs/rpc-new-features.spec.ts:162-176` asserts 0 connected. `support/electron-launcher.ts:55-58` isolates userData and the DB, not HOME. | backlog | med |
| TASK_2026_527 | VS Code webview ships without CSP | OBSOLETE | The VS Code host (`WebviewHtmlGenerator`) was removed in 1cee6fafe. | cancelled | high |
| TASK_2026_528 | Four backend libs inherit strict:false | STILL_VALID | `auth-providers-tokens`, `memory-contracts`, `settings-core` and `voice-contracts` have no `"strict"` in their tsconfig files. | backlog | high |
| TASK_2026_529 | badge-success/info fail WCAG AA in anubis | STILL_VALID | `apps/ptah-extension-webview/tailwind.config.js:129-133` is unchanged: `info: '#3b82f6'`, `success: '#16a34a'`, `*-content: '#e8e6e1'`. | backlog | high |
| TASK_2026_530 | degradation-audit skips tracked-but-missing files | ALREADY_DONE | `tools/degradation-audit/check-degradation.ts:872` uses `if (!fs.existsSync(absolute)) continue;` on the changed-file path, and the full lint scans the disk through fast-glob (`:792`) rather than the git index (a4db38ed6 / bde45c32f). | done | med |
| TASK_2026_539 | Route host dashboard surfaces into coding sessions; release on close | PARTIAL | `SurfaceUpdateInbox` with routing-id claims exists (`libs/frontend/chat-routing/src/lib/surface-update-inbox.service.ts:48-64`). There is no `surface:release` RPC anywhere. | backlog | low |
| TASK_2026_550 | Speed up and stabilize Electron e2e suite | STILL_VALID | No worker-scoped shared Electron app fixture found in `apps/ptah-electron-e2e/src`. | backlog | low |
| TASK_2026_557 | Orphaned rival-CLI probes hold app open on quit | STILL_VALID | Nothing about probes in `apps/ptah-electron/src/activation/shutdown.ts`, and no fix commit after f0577db74. | backlog | low |

## Notes for the coordinator

- Recommended changes. Mark `done`: 438, 519, 530. Mark `cancelled`: 298, 305, 312, 393, 394, 395, 427, 500, 502, 505, 507, 527.
- PARTIAL tasks should stay `backlog` with their scope narrowed to what is left (column 4).
- Optional follow-ups the evidence suggests. These are not filed:
  - Remove the now-unused `gridstack` dependency and its CSS import.
  - Drop the stale TASK_2026_519 comment in `permission-policy.ts`.
